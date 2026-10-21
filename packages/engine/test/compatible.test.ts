import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, replay, type DomainEvent, type TaskLevel } from "@narthex/core";
import { CompatibleRuntime, type CompatibleFetch, type FollowUp, type WorkContext } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 21, 9);

function context(level?: TaskLevel, log = { plans: [] as FollowUp[], spent: [] as number[] }): WorkContext {
  const events: DomainEvent[] = [
    { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
    { type: "agent.hired", reason: "", agent: { id: "l", name: "Léa", role: "recherche", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
    { type: "task.planned", task: { id: "t", agentId: "l", title: "Étude de marché", why: "Savoir", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW, ...(level ? { level } : {}) } },
  ];
  const state = replay(events);
  return {
    state,
    agent: state.agents["l"]!,
    task: state.tasks["t"]!,
    now: NOW,
    signal: new AbortController().signal,
    progress: () => {},
    plan: (f) => (log.plans.push(f), null),
    spend: (u) => void log.spent.push(u.credits),
    recruit: () => null,
    remainingCredits: () => 150,
  };
}

/** Answers each call with the next scripted message, and keeps the requests. */
function fake(replies: object[]) {
  const requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const call: CompatibleFetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const message = replies[Math.min(requests.length - 1, replies.length - 1)];
    return { ok: true, status: 200, json: async () => message, text: async () => "" };
  };
  return { call, requests };
}

const reply = (message: object, usage: object = { prompt_tokens: 100, completion_tokens: 20, cost: 0.0123 }) => ({ choices: [{ message, finish_reason: "stop" }], usage, model: "x" });

describe("CompatibleRuntime (OpenRouter, OpenAI, or any compatible API)", () => {
  it("runs a task on OpenRouter: the model of the level the agent chose, its tools, the web through OpenRouter", async () => {
    const { call, requests } = fake([
      reply({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "publish_deliverable", arguments: JSON.stringify({ title: "Étude", summary: "Une phrase.", body: "## Marché", sources: [{ title: "INSEE", url: "https://insee.fr", checkedAt: "2026-10-21" }] }) },
          },
          { id: "c2", type: "function", function: { name: "plan_task", arguments: JSON.stringify({ title: "Relancer", why: "Tester", kind: "internal", in_hours: 1, assignee: "self", level: "light" }) } },
        ],
        annotations: [{ type: "url_citation", url_citation: { url: "https://www.insee.fr/fr/stat", title: "INSEE" } }],
      }),
      reply({ role: "assistant", content: "J'ai fini l'étude." }),
    ]);
    const log = { plans: [] as FollowUp[], spent: [] as number[] };
    const runtime = new CompatibleRuntime({ provider: "openrouter", apiKey: "sk-or-v1-abc", fetch: call });
    const result = await runtime.run(context("light", log));

    const first = requests[0]!;
    expect(first.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(first.headers.authorization).toBe("Bearer sk-or-v1-abc");
    expect(first.body.model).toBe("deepseek/deepseek-v4.1-flash");
    const tools = first.body.tools as { type: string; function?: { name: string } }[];
    expect(tools.map((t) => t.function?.name ?? t.type)).toEqual(expect.arrayContaining(["openrouter:web_search", "openrouter:web_fetch", "publish_deliverable", "plan_task"]));
    // The tool results go back as tool messages, one per call.
    const second = requests[1]!.body.messages as { role: string; tool_call_id?: string }[];
    expect(second.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);

    expect(result.post).toBe("J'ai fini l'étude.");
    expect(result.deliverable).toMatchObject({ title: "Étude" });
    expect(result.consulted).toEqual(["https://www.insee.fr/fr/stat"]);
    expect(log.plans).toEqual([{ title: "Relancer", why: "Tester", kind: "internal", inHours: 1, level: "light" }]);
    // OpenRouter's own cost, in cents, rounded up.
    expect(log.spent).toEqual([2, 2]);
  });

  it("keeps the founder's model for a role over the agent's level", async () => {
    const { call, requests } = fake([reply({ role: "assistant", content: "ok" })]);
    await new CompatibleRuntime({ provider: "openrouter", apiKey: "k", fetch: call, models: { recherche: "mistralai/mistral-large-4-0" } }).run(context("deep"));
    expect(requests[0]!.body.model).toBe("mistralai/mistral-large-4-0");
  });

  it("talks to OpenAI directly, without OpenRouter's web tools, and prices from the catalogue", async () => {
    const { call, requests } = fake([reply({ role: "assistant", content: "ok" }, { prompt_tokens: 1_000_000, completion_tokens: 0 })]);
    const log = { plans: [] as FollowUp[], spent: [] as number[] };
    await new CompatibleRuntime({ provider: "openai", apiKey: "sk-proj-x", fetch: call, prices: { "gpt-5.6-terra": { input: 2, output: 12 } } }).run(context(undefined, log));
    expect(requests[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(requests[0]!.body.model).toBe("gpt-5.6-terra");
    expect((requests[0]!.body.tools as { type: string }[]).some((t) => t.type.startsWith("openrouter:"))).toBe(false);
    expect(log.spent).toEqual([200]);
  });

  it("does the first look and the memory work through a forced answer", async () => {
    const answer = (args: object) => reply({ role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "answer", arguments: JSON.stringify(args) } }] });
    const { call, requests } = fake([answer({ reaction: "J'adore.", findings: [{ text: "312 boutiques", source: "INSEE" }], team: [{ role: "recherche", why: "Marché" }], later: [] })]);
    const look = await new CompatibleRuntime({ provider: "openrouter", apiKey: "k", fetch: call }).firstLook({ idea: "Bougies", founderName: "Inès", now: NOW, signal: new AbortController().signal });
    expect(look).toMatchObject({ reaction: "J'adore.", team: [{ role: "recherche" }], simulated: false });
    expect((requests[0]!.body.tools as { type: string }[]).some((t) => t.type === "openrouter:web_search")).toBe(true);
  });

  it("says what went wrong in French when the provider refuses", async () => {
    const call: CompatibleFetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "No auth" } }), text: async () => "" });
    await expect(new CompatibleRuntime({ provider: "openrouter", apiKey: "k", fetch: call }).run(context())).rejects.toThrow(/clé/);
  });
});
