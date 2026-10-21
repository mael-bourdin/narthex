import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type DomainEvent } from "@narthex/core";
import { Engine, MemoryEventStore, SimulatedClock, type AgentRuntime, type ConsolidationInput } from "../src/index.ts";

// 19 Oct 2026, 15:00 in Paris; the next Paris day starts at 22:00 UTC.
const DAY1 = Date.UTC(2026, 9, 19, 13);
const NEXT_DAY = Date.UTC(2026, 9, 19, 22, 30);

function company(seenInputs: ConsolidationInput[], budget = DEFAULT_SETTINGS.dailyBudgetCredits) {
  const store = new MemoryEventStore();
  const fact = (id: string, text: string) => ({ id, text, subject: "prix", importance: 6, deliverableId: "d", validFrom: DAY1 });
  const seed: DomainEvent[] = [
    { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "Inès" }, foundedAt: DAY1, stage: "research", paused: false }, settings: { ...DEFAULT_SETTINGS, dailyBudgetCredits: budget } },
    { type: "agent.hired", reason: "", agent: { id: "m", name: "Margaux", role: "cofondateur", hiredAt: DAY1, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
    { type: "facts.extracted", deliverableId: "d", at: DAY1, added: [fact("a", "Une bougie se vend 39 € à Lille"), fact("b", "Prix d'une bougie à Lille : 39 €"), fact("c", "Kraft prend des créateurs en dépôt-vente")], invalidated: [] },
  ];
  for (const e of seed) store.append("c", e, DAY1);
  const runtime: AgentRuntime = {
    name: "anthropic",
    firstLook: async () => { throw new Error("no"); },
    run: async () => ({ post: "Fait." }),
    consolidateFacts: async (input) => {
      seenInputs.push(input);
      return {
        merged: [{ from: ["a", "b"], text: "Une bougie se vend 39 € à Lille", subject: "prix", importance: 7, sensitive: false }],
        invalidated: [],
        reflections: [{ from: ["b", "c"], text: "Le prix lillois laisse de la marge face au dépôt-vente", importance: 8 }, { from: ["c"], text: "Une seule source : écartée", importance: 9 }],
        usage: { inputTokens: 300, outputTokens: 50, cacheReadTokens: 0, credits: 1 },
      };
    },
  };
  const clock = new SimulatedClock(DAY1);
  return { engine: new Engine({ store, runtime, clock }), clock };
}

async function run(e: Engine) {
  for (let i = 0; i < 4; i++) {
    e.tick();
    await e.idle();
  }
  return e.getState();
}

describe("end-of-day consolidation (« pendant la nuit, l'équipe range ses notes »)", () => {
  it("waits for the day to end", async () => {
    const seen: ConsolidationInput[] = [];
    const { engine } = company(seen);
    await run(engine);
    expect(seen).toEqual([]);
  });

  it("tidies yesterday's notes once: merges duplicates, adds reflections, Margaux says it", async () => {
    const seen: ConsolidationInput[] = [];
    const { engine, clock } = company(seen);
    clock.advance(NEXT_DAY - DAY1);
    let s = await run(engine);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.facts.map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
    expect(s.facts["a"]!.invalidAt).toBeDefined();
    expect(s.facts["b"]!.invalidAt).toBeDefined();
    expect(s.facts["c"]!.invalidAt).toBeUndefined();
    const valid = Object.values(s.facts).filter((f) => !f.invalidAt);
    expect(valid.some((f) => f.text === "Une bougie se vend 39 € à Lille")).toBe(true);
    expect(valid.some((f) => f.subject === "Reflection" && f.importance === 8)).toBe(true);
    const said = s.posts.filter((p) => p.agentId === "m" && /tidied yesterday's notes/.test(p.text));
    expect(said).toHaveLength(1);
    expect(said[0]!.text).toContain("1 duplicate merged");
    expect(said[0]!.text).toContain("1 reflection");
    expect(valid.some((f) => f.text === "Une seule source : écartée")).toBe(false);
    s = await run(engine);
    expect(seen).toHaveLength(1);
  });

  it("skips a day without new notes, and never past the daily budget", async () => {
    const seen: ConsolidationInput[] = [];
    const { engine, clock } = company(seen, 0);
    clock.advance(NEXT_DAY - DAY1);
    await run(engine);
    expect(seen).toEqual([]);
  });
});

describe("consolidators", () => {
  const input = { facts: [{ id: "a", text: "39 € à Lille", subject: "prix", importance: 6, sensitive: false }, { id: "b", text: "Prix lillois : 39 €", subject: "prix", importance: 6, sensitive: false }], now: DAY1, signal: new AbortController().signal };
  const answer = { merged: [{ from: ["a", "b"], text: "Une bougie se vend 39 € à Lille", subject: "prix", importance: 7, sensitive: false }], invalidated: [], reflections: [{ from: ["a", "b"], text: "R", importance: 8 }] };

  it("uses Haiku and a forced, strict tool on the API", async () => {
    const { AnthropicRuntime } = await import("../src/index.ts");
    const calls: Record<string, unknown>[] = [];
    const client = { beta: { messages: { create: async (p: Record<string, unknown>) => (calls.push(p), { stop_reason: "tool_use", model: "claude-haiku-5-5", usage: { input_tokens: 400, output_tokens: 60 }, content: [{ type: "tool_use", id: "x", name: "tidy_facts", input: answer }] }) } } } as never;
    const out = await new AnthropicRuntime({ client }).consolidateFacts(input);
    expect(calls[0]).toMatchObject({ model: "claude-haiku-5-5", tool_choice: { type: "tool", name: "tidy_facts" } });
    expect(JSON.stringify(calls[0]!.messages)).toContain("[a]");
    expect(out.merged[0]!.from).toEqual(["a", "b"]);
    expect(out.reflections).toEqual([{ from: ["a", "b"], text: "R", importance: 8 }]);
  });

  it("goes through Claude Code in development", async () => {
    const { ClaudeCodeRuntime } = await import("../src/index.ts");
    const call = async (args: string[]) => JSON.stringify(args[0] === "auth" ? { loggedIn: true, authMethod: "claude.ai" } : { type: "result", is_error: false, usage: {}, structured_output: answer });
    const out = await new ClaudeCodeRuntime({ call }).consolidateFacts(input);
    expect(out.merged).toHaveLength(1);
    expect(out.usage.credits).toBe(0);
  });
});
