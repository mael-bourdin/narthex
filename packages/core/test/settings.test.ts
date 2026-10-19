import { describe, expect, it } from "vitest";
import { ALWAYS_ASK, apply, DEFAULT_SETTINGS, guardTask, replay, type DomainEvent } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);
const base = replay([
  { type: "company.founded", company: { id: "c", name: "M", idea: "I", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  { type: "agent.hired", reason: "", agent: { id: "a", name: "Samir", role: "prospection", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
]);

describe("always ask before", () => {
  it("lists the topics the founder can reserve", () => {
    expect(ALWAYS_ASK.map((t) => t.tag)).toEqual(["prix", "publicite-payante", "presse", "contrat-client"]);
  });

  it("recognises a reserved topic from the task's words, not only its tag", () => {
    const r = guardTask(base, { agentId: "a", title: "Baisser les prix de 10 % pour Noël", why: "", kind: "internal" }, NOW);
    expect(r.ok && r.task.kind).toBe("external");
    const ok = guardTask(base, { agentId: "a", title: "Étude de marché : clientes, concurrents, prix", why: "", kind: "internal" }, NOW);
    expect(ok.ok && ok.task.kind).toBe("internal");
  });

  it("lets the founder free a topic", () => {
    const s = apply(base, { type: "settings.changed", patch: { alwaysAsk: [] }, at: NOW });
    const r = guardTask(s, { agentId: "a", title: "Baisser les prix", why: "", kind: "internal" }, NOW);
    expect(r.ok && r.task.kind).toBe("internal");
  });
});

describe("profile", () => {
  it("renames the company and the founder", () => {
    const s = apply(base, { type: "company.updated", patch: { name: "Lumen", city: "Lille", founderName: "Inès Martin" }, at: NOW } as DomainEvent);
    expect(s.company).toMatchObject({ name: "Lumen", city: "Lille", founder: { name: "Inès Martin" } });
  });
});
