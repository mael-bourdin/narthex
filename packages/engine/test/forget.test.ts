import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, replay, type DomainEvent } from "@narthex/core";
import { Engine, MemoryEventStore, SimulatedClock, SqliteEventStore, type EventStore } from "../src/index.ts";

const START = Date.UTC(2026, 9, 20, 7);
const SECRET = "Inès Martin habite 12 rue des Lilas à Lille";

function seed(store: EventStore) {
  const events: DomainEvent[] = [
    { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "Inès" }, foundedAt: START, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
    { type: "facts.extracted", deliverableId: "d", at: START, added: [{ id: "f", text: SECRET, subject: "Adresse d'Inès", importance: 5, deliverableId: "d", validFrom: START, sensitive: true }, { id: "g", text: "Kraft prend du dépôt-vente", subject: "Kraft", importance: 5, deliverableId: "d", validFrom: START }], invalidated: [] },
    { type: "facts.consolidated", day: "2026-10-19", at: START, added: [{ id: "h", text: `Rappel : ${SECRET}`, subject: "Adresse", importance: 5, deliverableId: "d", validFrom: START, from: ["f"] }], invalidated: ["f"] },
  ];
  for (const e of events) store.append("c", e, START);
}

describe("forget a fact (RGPD: effective erasure)", () => {
  it("removes it from memory, and from the log itself", async () => {
    const store = new MemoryEventStore();
    seed(store);
    const e = new Engine({ store, runtime: null, clock: new SimulatedClock(START) });
    const s = await e.handle("fact.forget", { factId: "f" });
    expect(s.facts["f"]).toBeUndefined();
    expect(s.facts["h"]).toBeUndefined();
    expect(s.facts["g"]).toBeDefined();
    expect(JSON.stringify(store.read("c"))).not.toContain("12 rue des Lilas");
    // Replaying the log from scratch gives the same memory: nothing comes back.
    expect(replay(store.read("c")).facts["f"]).toBeUndefined();
  });

  it("erases it in the SQLite file too", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "narthex-forget-")), "n.sqlite");
    const store = new SqliteEventStore(file);
    seed(store);
    await new Engine({ store, runtime: null, clock: new SimulatedClock(START) }).handle("fact.forget", { factId: "f" });
    store.close();
    expect(readFileSync(file).includes("12 rue des Lilas")).toBe(false);
  });

  it("refuses an unknown fact", async () => {
    const store = new MemoryEventStore();
    seed(store);
    await expect(new Engine({ store, runtime: null, clock: new SimulatedClock(START) }).handle("fact.forget", { factId: "nope" })).rejects.toThrow(/Unknown fact/);
  });
});
