import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type DomainEvent } from "@narthex/core";
import { Engine, MemoryEventStore, SimulatedClock, type AgentRuntime, type LinkCheck } from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);

function company(checkLink?: LinkCheck) {
  const store = new MemoryEventStore();
  const seed: DomainEvent[] = [
    { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: START, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
    { type: "agent.hired", reason: "", agent: { id: "h", name: "Hugo", role: "juridique", hiredAt: START, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
    { type: "task.planned", task: { id: "t", agentId: "h", title: "Vérifier le nom", why: "", kind: "internal", status: "planned", createdAt: START, scheduledAt: START } },
  ];
  for (const e of seed) store.append("c", e, START);
  const runtime: AgentRuntime = {
    name: "anthropic",
    firstLook: async () => { throw new Error("no"); },
    run: async () => ({
      post: "Fait.",
      consulted: ["https://www.inpi.fr/a", "https://example.org/404"],
      deliverable: { title: "Nom", summary: "", body: "", sources: [{ title: "INPI", url: "https://www.inpi.fr/a" }, { title: "Mort", url: "https://example.org/404" }, { title: "Sans lien" }] },
    }),
  };
  return new Engine({ store, runtime, clock: new SimulatedClock(START), ...(checkLink ? { checkLink } : {}) });
}

async function settle(e: Engine) {
  for (let i = 0; i < 10; i++) {
    e.tick();
    await e.idle();
  }
  return e.getState();
}

describe("link check", () => {
  it("checks every cited link once the deliverable is in, and records the answer", async () => {
    const asked: string[] = [];
    const s = await settle(company(async (url) => (asked.push(url), !url.includes("404"))));
    const all = Object.values(s.deliverables);
    expect(all.length).toBeGreaterThan(0);
    expect(asked).toHaveLength(2 * all.length);
    for (const d of all) expect(d.sources.map((x) => x.reachable)).toEqual([true, false, undefined]);
  });

  it("does nothing without a checker (simulation, tests)", async () => {
    const s = await settle(company());
    expect(Object.values(s.deliverables)[0]!.linksCheckedAt).toBeUndefined();
  });
});
