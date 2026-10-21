import { describe, expect, it } from "vitest";
import { Engine, MemoryEventStore, SimulatedClock, SimulationRuntime, type AgentRuntime } from "../src/index.ts";

const START = Date.UTC(2026, 9, 21, 9);

describe("a runtime that is not available for now", () => {
  it("leaves tasks planned instead of starting them, then starts them once it is back", async () => {
    const sim = new SimulationRuntime();
    let full: string | undefined = "Abonnement plein";
    let started = 0;
    const runtime: AgentRuntime = {
      name: "claude-code",
      firstLook: sim.firstLook.bind(sim),
      run: async (ctx) => (started++, sim.run(ctx)),
      unavailable: () => full,
    };
    const e = new Engine({ store: new MemoryEventStore(), runtime, clock: new SimulatedClock(START) });
    await e.handle("company.found", { name: "Lumen", idea: "Bougies", founderName: "Inès" });
    e.tick();
    expect(started).toBe(0);
    expect(Object.values(e.getState().tasks).some((t) => t.status === "planned")).toBe(true);
    expect(e.status().unavailable).toBe("Abonnement plein");
    full = undefined;
    e.tick();
    expect(started).toBeGreaterThan(0);
    await e.close();
  });
});
