import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, missions, type CompanyState, type DomainEvent } from "@narthex/core";
import { Engine, MemoryEventStore, SimulatedClock, SimulationRuntime, type AgentRuntime } from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);
const HOUR = 3_600_000;

/** A company whose lawyer can never finish the statuts: every other task works. */
function stuckCompany() {
  const store = new MemoryEventStore();
  const seed: DomainEvent[] = [
    { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: START, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
    { type: "agent.hired", reason: "", agent: { id: "m", name: "Margaux", role: "cofondateur", hiredAt: START, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
    { type: "agent.hired", reason: "", agent: { id: "h", name: "Hugo", role: "juridique", hiredAt: START, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
    { type: "obligation.opened", obligation: { id: "o", code: "X-statuts", title: "Rédiger les statuts", why: "La loi l'exige.", owner: "juridique", status: "open", openedAt: START } },
  ];
  for (const e of seed) store.append("c", e, START);
  const sim = new SimulationRuntime();
  const runtime: AgentRuntime = {
    name: "simulation",
    firstLook: sim.firstLook.bind(sim),
    run: async (ctx) => {
      if (ctx.task.tag === "X-statuts") throw new Error("Le site de l'INPI ne répond pas.");
      return sim.run(ctx);
    },
  };
  const clock = new SimulatedClock(START);
  return { engine: new Engine({ store, runtime, clock }), clock };
}

async function settle(e: Engine, clock: SimulatedClock, hours: number): Promise<CompanyState> {
  for (let h = 0; h < hours; h++) {
    for (let i = 0; i < 20; i++) {
      e.tick();
      await e.idle();
      if (e.status().running === 0) break;
    }
    clock.advance(HOUR);
  }
  return e.getState();
}

describe("escalation", () => {
  it("stops after three failures, Margaux says it once, and the founder can start it over", async () => {
    const { engine, clock } = stuckCompany();
    let s = await settle(engine, clock, 12);
    const tries = () => Object.values(engine.getState().tasks).filter((t) => t.tag === "X-statuts").length;
    expect(tries()).toBe(3);
    expect(s.obligations["o"]!.stuck?.error).toBe("Le site de l'INPI ne répond pas.");
    const said = s.posts.filter((p) => p.agentId === "m" && p.text.includes("Rédiger les statuts") && p.text.includes("3 attempts"));
    expect(said).toHaveLength(1);
    expect(missions(s, clock.now(), "simulation").find((m) => m.kind === "stuck")).toMatchObject({ obligationId: "o", action: "retry", speakerId: "h" });

    s = await settle(engine, clock, 12);
    expect(tries()).toBe(3);

    s = await engine.handle("obligation.retry", { obligationId: "o" });
    expect(s.obligations["o"]!.stuck).toBeUndefined();
    expect(tries()).toBeGreaterThan(3);
    await expect(engine.handle("obligation.retry", { obligationId: "o" })).rejects.toThrow(/not stuck/);

    // Three new failures, and the team stops again: one more message, not a loop.
    s = await settle(engine, clock, 24);
    expect(tries()).toBe(6);
    expect(s.obligations["o"]!.stuck).toBeDefined();
    expect(s.posts.filter((p) => p.agentId === "m" && p.text.includes("3 attempts"))).toHaveLength(2);
  });
});
