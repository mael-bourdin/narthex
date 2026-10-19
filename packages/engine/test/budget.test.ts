import { describe, expect, it } from "vitest";
import { Engine, MemoryEventStore, SimulatedClock, SimulationRuntime, type AgentRuntime } from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 9);

function spender(perTurn: number, turns: number): AgentRuntime {
  return {
    name: "simulation",
    firstLook: new SimulationRuntime().firstLook,
    run: async (ctx) => {
      for (let i = 0; i < turns; i++) {
        ctx.spend({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, credits: perTurn });
        if (ctx.signal.aborted) throw new Error("Annulée");
        await Promise.resolve();
      }
      return { post: "Fini." };
    },
  };
}

async function settle(e: Engine) {
  for (let i = 0; i < 50; i++) {
    await e.idle();
    e.tick();
    if (e.status().running === 0) break;
  }
  return e.getState();
}

describe("budget while working", () => {
  it("counts credits as they are spent, not only at the end", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: spender(10, 3), clock: new SimulatedClock(START) });
    await e.handle("company.found", { name: "M", idea: "I", founderName: "F" });
    const s = await settle(e);
    expect(s.usage.credits).toBeGreaterThanOrEqual(30);
    expect(Object.values(s.usage.byDay)[0]).toBe(s.usage.credits);
  });

  it("stops a task that goes over its budget and says why", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: spender(60, 10), clock: new SimulatedClock(START) });
    await e.handle("company.found", { name: "M", idea: "I", founderName: "F" });
    await e.handle("settings.update", { patch: { dailyBudgetCredits: 100_000 } });
    const s = await settle(e);
    const stopped = Object.values(s.tasks).filter((t) => t.status === "failed");
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped[0]!.error).toMatch(/budget/i);
    expect(s.posts.some((p) => /budget/i.test(p.text))).toBe(true);
    // 3 turns of 60 cross the 150 limit: never more than 180 per task.
    expect(s.usage.credits / Object.values(s.tasks).filter((t) => t.startedAt).length).toBeLessThanOrEqual(180);
  });

  it("starts nothing more once the day's budget is spent", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: spender(100, 1), clock: new SimulatedClock(START) });
    await e.handle("company.found", { name: "M", idea: "I", founderName: "F" });
    await e.handle("settings.update", { patch: { dailyBudgetCredits: 150, concurrency: 1 } });
    const s = await settle(e);
    expect(s.usage.credits).toBeLessThanOrEqual(200);
    expect(Object.values(s.tasks).some((t) => t.status === "planned")).toBe(true);
  });
});
