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
  { type: "task.completed", taskId: id, at: NOW - 3 * H, deliverable: { id: `d-${id}`, taskId: id, agentId, title, summary: `Résumé ${title}`, body, sources: [], createdAt: NOW - 3 * H } },
];
const events: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW - 10 * H, stage: "creation", legalForm: "SASU", paused: false }, settings: DEFAULT_SETTINGS },
  ag("m", "Margaux", "cofondateur"),
  ag("hugo", "Hugo", "juridique"),
  ag("samir", "Samir", "prospection"),
  ...done("t1", "samir", "Lister les 50 premiers prospects qualifiés", "| Entreprise | Ville |\n|---|---|\n| Hôtel des Arts | Lille |\n| Fleurs & Co | Roubaix |", "prospects"),
  ...done("t2", "hugo", "Vérifier que le nom est libre", "Rien", "A1-nom"),
  { type: "obligation.opened", obligation: { id: "o1", code: "A3-forme", title: "Choisir la forme juridique", why: "", owner: "founder", status: "open", openedAt: NOW, due: NOW + 3 * 24 * H } },
  { type: "obligation.opened", obligation: { id: "o2", code: "B1-statuts", title: "Préparer les statuts", why: "", owner: "juridique", status: "open", openedAt: NOW, due: NOW + 5 * 24 * H } },
];

describe("ENTERPRISE", () => {
  it("has the sections and pages of the Figma file, plus Données", () => {
    expect(ENTERPRISE.map((s) => s.section)).toEqual(["Vue d'ensemble", "Données", "Finances", "Ventes", "Marketing", "Juridique", "Obligations", "Tableaux"]);
    expect(ENTERPRISE.find((s) => s.section === "Finances")!.pages.map((p) => p.page)).toEqual(["Trésorerie", "Factures et devis", "Dépenses", "Prévisionnel", "Compta et TVA"]);
  });
});

describe("pageView", () => {
  it("shows the real work of the page's domain", () => {
    const v = pageView(replay(events), "Ventes", "Prospects", NOW);
    expect(v.deliverables.map((d) => d.title)).toEqual(["Lister les 50 premiers prospects qualifiés"]);
    expect(v.owners.map((o) => o.name)).toEqual(["Samir"]);
  });

  it("says who will take care of an empty page, and when", () => {
    const v = pageView(replay(events), "Finances", "Factures et devis", NOW);
    expect(v.deliverables).toEqual([]);
    expect(v.empty).toBe("Paul (Comptabilité) s'en chargera : il arrive au lancement.");
  });

  it("puts the legal work and duties in Juridique", () => {
    const v = pageView(replay(events), "Juridique", "Marque", NOW);
    expect(v.deliverables.map((d) => d.title)).toContain("Vérifier que le nom est libre");
  });
});

describe("overview", () => {
  it("tells where the company stands, with the founder's steps marked", () => {
    const o = overview(replay(events), NOW);
    expect(o.title).toBe("Lumen");
    expect(o.subtitle).toBe("SASU · Bougies · dirigée par Inès");
    expect(o.stage).toBe("En création");
    const forme = o.milestones.find((m) => m.title === "Choisir la forme juridique")!;
    expect(forme.state).toBe("you");
    expect(o.deadlines.map((d) => d.title)).toEqual(["Choisir la forme juridique", "Préparer les statuts"]);
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
    expect(t[0]!.header).toEqual(["Entreprise", "Ville"]);
    expect(t[0]!.rows).toEqual([["Hôtel des Arts", "Lille"], ["Fleurs & Co", "Roubaix"]]);
  });
});
