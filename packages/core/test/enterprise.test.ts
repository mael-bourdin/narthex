import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, ENTERPRISE, overview, pageView, replay, spendBreakdown, tablesOf, type DomainEvent, type StoredEvent } from "../src/index.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 19, 12);
const ag = (id: string, name: string, role: "cofondateur" | "recherche" | "juridique" | "prospection"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name, role, hiredAt: NOW - 10 * H, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const done = (id: string, agentId: string, title: string, body = "", tag?: string): DomainEvent[] => [
  { type: "task.planned", task: { id, agentId, title, why: "", kind: "internal", status: "planned", createdAt: NOW - 5 * H, scheduledAt: NOW - 5 * H, ...(tag ? { tag } : {}) } },
  { type: "task.started", taskId: id, at: NOW - 4 * H },
  { type: "task.completed", taskId: id, at: NOW - 3 * H, deliverable: { id: `d-${id}`, taskId: id, agentId, title, summary: `Summary of ${title}`, body, sources: [], createdAt: NOW - 3 * H } },
];
const events: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Candles", founder: { name: "Inès" }, foundedAt: NOW - 10 * H, stage: "creation", legalForm: "SASU", paused: false }, settings: DEFAULT_SETTINGS },
  ag("m", "Margaux", "cofondateur"),
  ag("hugo", "Hugo", "juridique"),
  ag("samir", "Samir", "prospection"),
  ...done("t1", "samir", "List the first 50 qualified prospects", "| Company | City |\n|---|---|\n| Hôtel des Arts | Lille |\n| Fleurs & Co | Roubaix |", "prospects"),
  ...done("t2", "hugo", "Check that the name is free", "Nothing", "A1-nom"),
  { type: "obligation.opened", obligation: { id: "o1", code: "A3-forme", title: "Choose the legal form", why: "", owner: "founder", status: "open", openedAt: NOW, due: NOW + 3 * 24 * H } },
  { type: "obligation.opened", obligation: { id: "o2", code: "B1-statuts", title: "Prepare the articles of association (statuts)", why: "", owner: "juridique", status: "open", openedAt: NOW, due: NOW + 5 * 24 * H } },
];

describe("ENTERPRISE", () => {
  it("has the sections and pages of the Figma file, plus Data", () => {
    expect(ENTERPRISE.map((s) => s.section)).toEqual(["Overview", "Data", "Finances", "Sales", "Marketing", "Legal", "Obligations", "Tables"]);
    expect(ENTERPRISE.find((s) => s.section === "Finances")!.pages.map((p) => p.page)).toEqual(["Cash", "Invoices and quotes", "Expenses", "Forecast", "Accounting and VAT"]);
  });
});

describe("pageView", () => {
  it("shows the real work of the page's domain", () => {
    const v = pageView(replay(events), "Sales", "Prospects", NOW);
    expect(v.deliverables.map((d) => d.title)).toEqual(["List the first 50 qualified prospects"]);
    expect(v.owners.map((o) => o.name)).toEqual(["Samir"]);
  });

  it("says who will take care of an empty page, and when", () => {
    const v = pageView(replay(events), "Finances", "Invoices and quotes", NOW);
    expect(v.deliverables).toEqual([]);
    expect(v.empty).toBe("Paul (Accounting) will take care of it: he arrives at the launch.");
  });

  it("puts the legal work and duties in Legal", () => {
    const v = pageView(replay(events), "Legal", "Brand", NOW);
    expect(v.deliverables.map((d) => d.title)).toContain("Check that the name is free");
  });

  it("sorts work by English and older French titles alike", () => {
    const s = replay([
      ...events,
      ...done("t3", "samir", "Draft the invoice template"),
      ...done("t4", "samir", "Modèle de facture"),
      ...done("t5", "hugo", "Record of processing for GDPR"),
    ]);
    expect(pageView(s, "Finances", "Invoices and quotes", NOW).deliverables.map((d) => d.title).sort()).toEqual(["Draft the invoice template", "Modèle de facture"]);
    expect(pageView(s, "Legal", "Personal data", NOW).deliverables.map((d) => d.title)).toContain("Record of processing for GDPR");
  });
});

describe("overview", () => {
  it("tells where the company stands, with the founder's steps marked", () => {
    const o = overview(replay(events), NOW);
    expect(o.title).toBe("Lumen");
    expect(o.subtitle).toBe("SASU · Candles · run by Inès");
    expect(o.stage).toBe("Being set up");
    const forme = o.milestones.find((m) => m.title === "Choose the legal form")!;
    expect(forme).toMatchObject({ state: "you", who: "You · required by law" });
    expect(o.deadlines.map((d) => d.title)).toEqual(["Choose the legal form", "Prepare the articles of association (statuts)"]);
  });
});

describe("spendBreakdown", () => {
  it("splits the AI spend by teammate and by day, from the real log", () => {
    const usage = (agentId: string, credits: number, at: number) =>
      ({ type: "usage.recorded", agentId, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits, at, companyId: "c", seq: 0, ts: at }) as StoredEvent;
    const b = spendBreakdown(replay(events), [usage("samir", 120, NOW), usage("hugo", 30, NOW), usage("samir", 10, NOW - 24 * H)]);
    expect(b.byAgent.map((a) => [a.name, a.credits])).toEqual([["Samir", 130], ["Hugo", 30]]);
    expect(b.total).toBe(160);
    expect(b.byDay.at(-1)!.credits).toBe(150);
  });
});

describe("tablesOf", () => {
  it("collects every table the team produced", () => {
    const t = tablesOf(replay(events));
    expect(t).toHaveLength(1);
    expect(t[0]!.header).toEqual(["Company", "City"]);
    expect(t[0]!.rows).toEqual([["Hôtel des Arts", "Lille"], ["Fleurs & Co", "Roubaix"]]);
  });
});
