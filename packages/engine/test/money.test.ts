import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, emptyState, type Agent, type DomainEvent, type Task } from "@narthex/core";
import { AnthropicRuntime, creditsFor, Engine, MemoryEventStore, SimulatedClock, type AgentRuntime, type WorkContext } from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);

describe("revision: what a call really costs", () => {
  it("counts web searches ($10 per 1,000)", () => {
    expect(creditsFor("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 20 } })).toBe(20);
  });

  it("never prices an unknown model below the most expensive known one", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 0 };
    expect(creditsFor("claude-mystery-9", u)).toBeGreaterThanOrEqual(creditsFor("claude-opus-5-5", u));
  });
});

describe("revision: a turn never costs more than what is left", () => {
  it("lowers max_tokens to the budget that remains", async () => {
    const seen: number[] = [];
    const client = {
      beta: { messages: { stream: (p: { max_tokens: number }) => (seen.push(p.max_tokens), { finalMessage: async () => ({ stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "ok" }] }) }) } },
    } as unknown as Anthropic;
    const agent: Agent = { id: "a", name: "Léa", role: "recherche", hiredAt: 0, status: "working", skill: { success: 0, failure: 0 }, autonomy: 1 };
    const task: Task = { id: "t", agentId: "a", title: "Étude", why: "", kind: "internal", status: "running", createdAt: 0, scheduledAt: 0 };
    const ctx = { state: emptyState(), agent, task, now: 0, signal: new AbortController().signal, progress() {}, plan: () => null, recruit: () => null, spend() {}, remainingCredits: () => 10 } as unknown as WorkContext;
    await new AnthropicRuntime({ client, model: "claude-opus-5-5" }).run(ctx);
    // 10 cents at $20 per million output tokens: 5,000 tokens.
    expect(seen[0]).toBe(5000);
  });
});

describe("revision: the daily budget also stops work in progress", () => {
  it("stops every running task once the day's budget is spent", async () => {
    const store = new MemoryEventStore();
    const seed: DomainEvent[] = [
      { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "I" }, foundedAt: START, stage: "research", paused: false }, settings: { ...DEFAULT_SETTINGS, dailyBudgetCredits: 100, taskBudgetCredits: 1000, concurrency: 3 } },
      ...(["a", "b", "c"] as const).map((id, i): DomainEvent => ({ type: "agent.hired", reason: "", agent: { id, name: id, role: (["recherche", "prospection", "redaction"] as const)[i]!, hiredAt: START, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } })),
    ];
    for (const e of seed) store.append("c", e, START);
    const runtime: AgentRuntime = {
      name: "anthropic",
      firstLook: async () => { throw new Error("no"); },
      run: async (ctx) => {
        for (let i = 0; i < 20; i++) {
          if (ctx.signal.aborted) throw new Error("Annulée");
          ctx.spend({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits: 20 });
          await new Promise((r) => setTimeout(r, 1));
        }
        return { post: "Fait." };
      },
    };
    const e = new Engine({ store, runtime, clock: new SimulatedClock(START) });
    e.tick();
    await e.idle();
    const s = e.getState();
    // Three tasks were running when the day's 1 $ was reached: at most one more turn each.
    expect(s.usage.credits).toBeLessThanOrEqual(100 + 3 * 20);
    expect(Object.values(s.tasks).some((t) => t.status === "failed" && t.interrupted)).toBe(true);
  });
});

describe("revision: the first look is the first launch only", () => {
  it("is refused once the company exists (it costs money outside any budget)", async () => {
    const { SimulationRuntime } = await import("../src/index.ts");
    const e = new Engine({ store: new MemoryEventStore(), runtime: new SimulationRuntime(), clock: new SimulatedClock(START) });
    await e.handle("company.found", { name: "Lumen", idea: "Bougies", founderName: "Inès" });
    await expect(e.handle("onboarding.firstLook", { idea: "Bougies", founderName: "Inès" })).rejects.toThrow(/premier lancement/);
  });
});
