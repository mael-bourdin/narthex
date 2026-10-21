import { describe, expect, it } from "vitest";
import { agentSheet, calendarSummary, DEFAULT_SETTINGS, journalEntries, journalSummary, orgChart, recruitments, replay, type DomainEvent, type StoredEvent } from "../src/index.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 19, 12);
const ag = (id: string, name: string, role: "cofondateur" | "recherche" | "juridique"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name, role, hiredAt: NOW - 10 * H, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const events: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW - 10 * H, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  { type: "staffing.planned", staffing: [
    { role: "cofondateur", at: "idea", why: "" },
    { role: "recherche", at: "research", why: "Le marché" },
    { role: "prospection", at: "creation", why: "Les premiers clients" },
  ] },
  ag("m", "Margaux", "cofondateur"),
  ag("lea", "Léa", "recherche"),
  { type: "task.planned", task: { id: "t1", agentId: "lea", title: "Étude", why: "Savoir", kind: "internal", status: "planned", createdAt: NOW - 9 * H, scheduledAt: NOW - 9 * H } },
  { type: "task.started", taskId: "t1", at: NOW - 6 * H },
  {
    type: "task.completed",
    taskId: "t1",
    at: NOW - 4 * H,
    deliverable: { id: "d1", taskId: "t1", agentId: "lea", title: "Étude", summary: "La demande existe", body: "", sources: [{ title: "INSEE" }, { title: "Pappers", url: "https://www.pappers.fr/entreprise/x" }], createdAt: NOW - 4 * H },
  },
  { type: "task.planned", task: { id: "t2", agentId: "lea", title: "Sonder 30 clientes", why: "Choisir le parfum", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW + 20 * H } },
];

describe("orgChart", () => {
  it("puts the founder, then Margaux, then the team, with who comes next", () => {
    const o = orgChart(replay(events), NOW);
    expect(o.founder).toBe("Inès");
    expect(o.cofounder?.agent.name).toBe("Margaux");
    expect(o.members.map((m) => m.agent.name)).toEqual(["Léa"]);
    expect(o.upcoming.map((u) => u.role.id)).toEqual(["prospection"]);
  });
});

describe("recruitments", () => {
  it("lists who arrived and who Margaux plans to bring, with why and when", () => {
    const r = recruitments(replay(events));
    expect(r.arrived.map((a) => a.agent.name)).toEqual(["Margaux", "Léa"]);
    expect(r.planned).toEqual([{ role: expect.objectContaining({ id: "prospection" }), why: "Les premiers clients", when: "à la création de la société" }]);
  });
});

describe("agentSheet", () => {
  it("tells what an agent does now, plans, and finished, with real numbers", () => {
    const sheet = agentSheet(replay(events), "lea", NOW);
    expect(sheet.stats).toMatchObject({ hoursThisWeek: 2, xp: 50, done: 1, failed: 0 });
    expect(sheet.next.map((t) => t.title)).toEqual(["Sonder 30 clientes"]);
    expect(sheet.finished[0]).toMatchObject({ task: { title: "Étude" }, result: "La demande existe" });
    expect(sheet.sources).toEqual(["INSEE", "Pappers"]);
    expect(sheet.sourceSites).toEqual(["INSEE", "pappers.fr"]);
  });
});

describe("journalEntries", () => {
  it("turns the event log into plain French sentences, newest first", () => {
    const s = replay(events);
    const stored = events.map((e, i) => ({ ...e, companyId: "c", seq: i + 1, ts: NOW - (events.length - i) * H })) as StoredEvent[];
    const j = journalEntries(s, stored);
    expect(j[0]!.text).toBe("Léa a terminé « Étude »");
    expect(j.at(-1)!.text).toBe("Inès a fondé Lumen");
    expect(j.find((e) => e.text.startsWith("Léa rejoint"))?.agentId).toBe("lea");
  });
});

describe("calendarSummary", () => {
  it("counts the period's tasks, done and running, and what waits for the founder", () => {
    const s = replay([
      ...events,
      { type: "obligation.opened", obligation: { id: "o1", code: "B5-signer-statuts", title: "Signer les statuts", why: "La loi", owner: "founder", status: "open", openedAt: NOW } },
    ] as DomainEvent[]);
    const c = calendarSummary(s, NOW - 24 * H, NOW + 24 * H);
    expect(c).toMatchObject({ total: 2, done: 1, running: 0 });
    expect(c.forYou.map((o) => o.title)).toEqual(["Signer les statuts"]);
    expect(calendarSummary(s, NOW - 24 * H, NOW + 24 * H, "m")).toMatchObject({ total: 0, forYou: [] });
  });
});

describe("journalSummary", () => {
  it("counts actions, today's, the founder's cancels and the roles behind them", () => {
    const s = replay(events);
    const stored = events.map((e, i) => ({ ...e, companyId: "c", seq: i + 1, ts: NOW - (events.length - i) * H })) as StoredEvent[];
    const j = journalSummary(s, journalEntries(s, stored), NOW);
    expect(j.total).toBe(journalEntries(s, stored).length);
    expect(j.cancelledByYou).toBe(0);
    expect(j.byRole[0]).toMatchObject({ role: "recherche", title: "Recherche" });
    expect(j.today).toBeGreaterThan(0);
  });
});
