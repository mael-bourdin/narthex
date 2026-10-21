import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, fmt, markdownTables, obligationsFrame, pageFrame, replay, role, ruleOf, tablesFrame, type DomainEvent, type StoredEvent } from "../src/index.ts";

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


const usage = (agentId: string, credits: number, at: number) =>
  ({ type: "usage.recorded", agentId, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits, at, companyId: "c", seq: 0, ts: at }) as StoredEvent;

describe("pageFrame", () => {
  it("counts the prospects of the real list and says who takes care of it", () => {
    const f = pageFrame(replay(events), [], "Ventes", "Prospects", NOW);
    expect(f.figures[0]).toMatchObject({ label: "Pistes listées", value: "2" });
    expect(f.pilot.title).toBe("Samir tient cette page à jour");
    expect(f.who).toEqual([{ role: "prospection", name: "Samir", duty: role("prospection").duty, agentId: "samir", here: true }]);
    expect(f.rules!.items[0]).toEqual({ text: "B2B prospecting only through business addresses, with an unsubscribe link", hint: "CNIL" });
  });

  it("never invents a figure the state does not have", () => {
    const f = pageFrame(replay(events), [], "Finances", "Trésorerie", NOW);
    expect(f.figures[0]).toEqual({ label: "Solde", value: "—", hint: "Ta banque n'est pas encore reliée à Narthex" });
    expect(f.figures[1]!.value).toBe(fmt.euros(0));
    const empty = pageFrame(replay(events), [], "Finances", "Factures et devis", NOW);
    expect(empty.pilot.title).toBe("Rien ici pour l'instant");
    expect(empty.who[0]).toMatchObject({ name: "Paul", here: false, duty: "Arrive au lancement" });
  });

  it("shows the real AI spend and the budget rules on Dépenses", () => {
    const f = pageFrame(replay(events), [usage("samir", 120, NOW), usage("hugo", 30, NOW - 40 * 24 * H)], "Finances", "Dépenses", NOW);
    expect(f.figures.map((x) => x.value)).toEqual([fmt.dollars(120), fmt.dollars(0), fmt.dollars(150)]);
    expect(f.rules!.items[0]!.text).toBe(`${fmt.dollars(DEFAULT_SETTINGS.dailyBudgetCredits)} de dépense IA par jour`);
  });

  it("tells the planned action first, and that it can be cancelled", () => {
    const s = replay([
      ...events,
      { type: "task.planned", task: { id: "t9", agentId: "samir", title: "Écrire aux prospects", why: "", kind: "external", status: "planned", createdAt: NOW, scheduledAt: NOW + 20 * H, cancellableUntil: NOW + 20 * H, tag: "outreach" } },
    ]);
    const f = pageFrame(s, [], "Ventes", "Prospects", NOW);
    expect(f.pilot).toEqual({ title: "Samir : une action part in 20 h", detail: "Écrire aux prospects · tu peux l'annuler d'ici là", agentId: "samir" });
    expect(f.figures[1]).toMatchObject({ label: "Envois prévus", value: "1" });
  });
});

describe("obligationsFrame", () => {
  it("splits the duties between the founder and the team", () => {
    const f = obligationsFrame(replay(events), NOW);
    expect(f.figures.map((x) => [x.label, x.value])).toEqual([["Pour toi", "1"], ["Pour l'équipe", "1"], ["En retard", "0"]]);
    expect(f.pilot.detail).toBe("1 te concerne · aucune en retard");
  });
});

describe("tablesFrame", () => {
  it("counts the tables and their authors", () => {
    const f = tablesFrame(replay(events));
    expect(f.figures.map((x) => x.value)).toEqual(["1", "2", "1"]);
    expect(f.who.map((w) => w.name)).toEqual(["Samir"]);
  });
});

describe("ruleOf", () => {
  it("keeps the first clause and the law it cites", () => {
    expect(ruleOf("Information juridique générale et sourcée seulement : tu ne tranches jamais (loi du 31 déc. 1971, art. 54). Tu proposes alors un avocat.")).toEqual({
      text: "Information juridique générale et sourcée seulement",
      hint: "Loi du 31 déc. 1971, art. 54",
    });
  });
});

describe("markdownTables", () => {
  it("reads every table of a text", () => {
    expect(markdownTables("a\n| A | B |\n|---|---|\n| **1** | 2 |\n\n| C |\n|--|\n| 3 |")).toEqual([
      { header: ["A", "B"], rows: [["1", "2"]] },
      { header: ["C"], rows: [["3"]] },
    ]);
  });
});
