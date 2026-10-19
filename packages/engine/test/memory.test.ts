import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type DomainEvent } from "@narthex/core";
import { Engine, MemoryEventStore, SimulatedClock, type AgentRuntime, type FactsInput, type WorkContext } from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);

function company(overBudget = false) {
  const store = new MemoryEventStore();
  const seed: DomainEvent[] = [
    { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: START, stage: "research", paused: false }, settings: { ...DEFAULT_SETTINGS, ...(overBudget ? { dailyBudgetCredits: 3 } : {}) } },
    { type: "agent.hired", reason: "", agent: { id: "l", name: "Léa", role: "recherche", hiredAt: START, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
    { type: "facts.extracted", deliverableId: "old", at: START, added: [{ id: "f0", text: "Prix moyen d'une bougie à Lille : 35 €", subject: "prix", importance: 7, deliverableId: "old", validFrom: START }], invalidated: [] },
  ];
  for (const e of seed) store.append("c", e, START);
  const seen: { inputs: FactsInput[]; briefs: WorkContext[] } = { inputs: [], briefs: [] };
  const runtime: AgentRuntime = {
    name: "anthropic",
    firstLook: async () => { throw new Error("no"); },
    run: async (ctx) => {
      seen.briefs.push(ctx);
      return { post: "Fait.", ...(overBudget ? { usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits: 5 } } : {}), deliverable: { title: "Prix à Lille", summary: "Les prix montent.", body: "Une bougie de 180 g se vend 39 € à Lille.", sources: [] } };
    },
    extractFacts: async (input) => {
      seen.inputs.push(input);
      return {
        added: [{ text: "Une bougie de 180 g se vend 39 € à Lille", subject: "prix", importance: 8 }],
        invalidated: ["f0", "unknown"],
        usage: { inputTokens: 500, outputTokens: 80, cacheReadTokens: 0, credits: 1 },
      };
    },
  };
  return { engine: new Engine({ store, runtime, clock: new SimulatedClock(START) }), seen };
}

async function settle(e: Engine) {
  for (let i = 0; i < 6; i++) {
    e.tick();
    await e.idle();
  }
  return e.getState();
}

describe("memory extraction", () => {
  it("extracts facts from each deliverable after the fact, with what the team already knew", async () => {
    const { engine, seen } = company();
    const s = await settle(engine);
    expect(seen.inputs.length).toBeGreaterThan(0);
    expect(seen.inputs[0]!.known.map((f) => f.id)).toContain("f0");
    const fresh = Object.values(s.facts).filter((f) => f.text.includes("39 €"));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh[0]!.deliverableId).toBe(Object.values(s.deliverables)[0]!.id);
    expect(s.facts["f0"]!.invalidAt).toBeDefined();
    expect(s.facts["unknown"]).toBeUndefined();
    expect(s.usage.credits).toBeGreaterThan(0);
  });

  it("does not spend past the daily budget", async () => {
    const { engine, seen } = company(true);
    await settle(engine);
    expect(seen.inputs).toEqual([]);
  });
});

describe("brief", () => {
  it("starts from what the team knows, within the agent's rights", async () => {
    const { replay } = await import("@narthex/core");
    const { brief } = await import("../src/index.ts");
    const s = replay([
      { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: START, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
      { type: "agent.hired", reason: "", agent: { id: "s", name: "Samir", role: "prospection", hiredAt: START, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
      { type: "task.planned", task: { id: "t", agentId: "s", title: "Proposer nos bougies aux concept stores", why: "Vendre avant Noël", kind: "internal", status: "planned", createdAt: START, scheduledAt: START } },
      {
        type: "facts.extracted",
        deliverableId: "d",
        at: START,
        added: [
          { id: "a", text: "Le concept store Kraft à Lille prend des créateurs en dépôt-vente", subject: "Kraft", importance: 7, deliverableId: "d", validFrom: START },
          { id: "b", text: "Marge sur une bougie vendue en concept store : 12 €", subject: "marge", importance: 9, deliverableId: "d", validFrom: START, sensitive: true },
        ],
        invalidated: [],
      },
    ]);
    const text = brief({ state: s, agent: s.agents["s"]!, task: s.tasks["t"]!, now: START + 1 } as WorkContext);
    expect(text).toContain("Ce que l'équipe sait déjà");
    expect(text).toContain("Kraft à Lille");
    expect(text).not.toContain("Marge");
  });
});

describe("extractors", () => {
  const input = { deliverable: { title: "Prix", summary: "", body: "Une bougie se vend 39 € à Lille." }, known: [{ id: "f0", text: "35 € à Lille" }], now: START, signal: new AbortController().signal };
  const answer = { facts: [{ text: "Une bougie se vend 39 € à Lille", subject: "prix", importance: 8, sensitive: false }], invalidated: ["f0"] };

  it("uses Haiku and a forced, strict tool on the API", async () => {
    const { AnthropicRuntime } = await import("../src/index.ts");
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          create: async (p: Record<string, unknown>) => (
            calls.push(p),
            { stop_reason: "tool_use", usage: { input_tokens: 400, output_tokens: 60 }, content: [{ type: "tool_use", id: "x", name: "record_facts", input: answer }] }
          ),
        },
      },
    } as never;
    const out = await new AnthropicRuntime({ client }).extractFacts(input);
    expect(calls[0]).toMatchObject({ model: "claude-haiku-5-5", tool_choice: { type: "tool", name: "record_facts" } });
    expect(String(calls[0]!.messages && JSON.stringify(calls[0]!.messages))).toContain("[f0]");
    expect(out.added).toEqual([{ text: "Une bougie se vend 39 € à Lille", subject: "prix", importance: 8, sensitive: false }]);
    expect(out.invalidated).toEqual(["f0"]);
    expect(out.usage.credits).toBeGreaterThan(0);
  });

  it("uses Haiku through Claude Code in development, without tools", async () => {
    const { ClaudeCodeRuntime } = await import("../src/index.ts");
    const seen: string[][] = [];
    const call = async (args: string[]) => {
      seen.push(args);
      if (args[0] === "auth") return JSON.stringify({ loggedIn: true, authMethod: "claude.ai" });
      return JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 1, output_tokens: 1 }, structured_output: answer });
    };
    const out = await new ClaudeCodeRuntime({ call }).extractFacts(input);
    const work = seen.find((a) => a[0] === "-p")!;
    expect(work[work.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
    expect(work[work.indexOf("--tools") + 1]).toBe("");
    expect(out.invalidated).toEqual(["f0"]);
    expect(out.usage.credits).toBe(0);
  });
});
