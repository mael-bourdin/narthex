import { describe, expect, it } from "vitest";
import { Host, MemoryEventStore, SimulatedClock, SimulationRuntime } from "../src/index.ts";

const START = Date.UTC(2026, 9, 20, 7);

function host(store = new MemoryEventStore(), selected: string[] = []) {
  return new Host({ store, runtime: new SimulationRuntime(), clock: new SimulatedClock(START), onSelect: (id) => void selected.push(id) });
}

async function settle(h: Host) {
  for (let i = 0; i < 20; i++) {
    h.tick();
    await h.idle();
  }
}

describe("several companies in one app", () => {
  it("founds a second company next to the first, and shows the new one", async () => {
    const selected: string[] = [];
    const h = host(new MemoryEventStore(), selected);
    const a = await h.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    const b = await h.handle("company.found", { name: "Atelier Brume", idea: "Céramique", founderName: "Inès" });
    expect(a.company!.id).not.toBe(b.company!.id);
    const list = await h.handle("companies.list", {});
    expect(list.map((c) => c.name)).toEqual(["Maison Lumen", "Atelier Brume"]);
    expect(list.find((c) => c.active)!.name).toBe("Atelier Brume");
    expect((await h.handle("state.get", {}))!.company!.name).toBe("Atelier Brume");
    expect(selected.at(-1)).toBe(b.company!.id);
  });

  it("switches the company shown, and every company keeps working", async () => {
    const h = host();
    const a = await h.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    await h.handle("company.found", { name: "Atelier Brume", idea: "Céramique", founderName: "Inès" });
    await settle(h);
    const s = await h.handle("company.select", { companyId: a.company!.id });
    expect(s.company!.name).toBe("Maison Lumen");
    expect(h.getState().company!.name).toBe("Maison Lumen");
    for (const c of await h.handle("companies.list", {})) {
      const state = h.stateOf(c.id)!;
      expect(Object.values(state.tasks).some((t) => t.status === "done")).toBe(true);
    }
    await expect(h.handle("company.select", { companyId: "nope" })).rejects.toThrow(/inconnue/);
  });

  it("tells which company each event belongs to", async () => {
    const h = host();
    const seen = new Set<string>();
    h.subscribe((e) => void seen.add(e.companyId));
    await h.handle("company.found", { name: "A", idea: "a", founderName: "I" });
    await h.handle("company.found", { name: "B", idea: "b", founderName: "I" });
    expect(seen.size).toBe(2);
  });

  it("allows the first look of a new company while others exist", async () => {
    const h = host();
    await h.handle("company.found", { name: "A", idea: "a", founderName: "I" });
    const look = await h.handle("onboarding.firstLook", { idea: "Céramique", founderName: "Inès" });
    expect(look.findings.length).toBeGreaterThan(0);
  });

  it("opens an existing single-company log as before", async () => {
    const store = new MemoryEventStore();
    const first = host(store);
    await first.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    await first.close();
    const again = host(store);
    expect(again.getState().company!.name).toBe("Maison Lumen");
    expect(again.status().companyId).toBe(again.getState().company!.id);
  });
});
