import { describe, expect, it } from "vitest";
import { Engine, MemoryEventStore, SimulatedClock, SimulationRuntime } from "../src/index.ts";

describe("sale.record", () => {
  it("records the founder's sale, and refuses nonsense amounts", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: new SimulationRuntime(), clock: new SimulatedClock(0) });
    await e.handle("company.found", { name: "Lumen", idea: "Bougies", founderName: "Inès" });
    const s = await e.handle("sale.record", { amountCents: 3900, note: " Marché de Noël " });
    expect(s.sales).toMatchObject([{ amountCents: 3900, note: "Marché de Noël" }]);
    await expect(e.handle("sale.record", { amountCents: -1 })).rejects.toThrow(/montant/);
    await expect(e.handle("sale.record", { amountCents: Number.NaN })).rejects.toThrow(/montant/);
  });
});

describe("moving to a better office", () => {
  it("happens once real sales allow it, with Margaux saying so", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: new SimulationRuntime(), clock: new SimulatedClock(0) });
    await e.handle("company.found", { name: "Lumen", idea: "Bougies", founderName: "Inès" });
    e.tick();
    expect(e.getState().office ?? 0).toBe(0);
    for (const cents of [150_000, 100_000, 80_000]) await e.handle("sale.record", { amountCents: cents });
    const s = e.getState();
    expect(s.office).toBe(2);
    expect(s.posts.filter((p) => p.text.includes("bureaux en ville"))).toHaveLength(1);
  });
});
