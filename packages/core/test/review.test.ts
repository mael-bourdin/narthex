import { describe, expect, it } from "vitest";
import {
  apply,
  fmt,
  decide,
  DEFAULT_SETTINGS,
  emptyState,
  guardTask,
  missions,
  replay,
  reservedTopic,
  spendBreakdown,
  staffingFrom,
  type DomainEvent,
  type StoredEvent,
} from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);
const HOUR = 3_600_000;
const founded: DomainEvent = {
  type: "company.founded",
  company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false },
  settings: DEFAULT_SETTINGS,
};
const hire = (id: string, role: "cofondateur" | "juridique" | "prospection" | "recherche"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name: id, role, hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});

describe("revision: projection", () => {
  it("replays a log written by a newer version, skipping what it does not know", () => {
    const s = replay([founded]);
    const next = apply(s, { type: "future.event", seq: 9, ts: NOW, companyId: "c" } as unknown as StoredEvent);
    expect(next.lastSeq).toBe(9);
    expect(next.company?.name).toBe("Lumen");
  });

  it("never changes the previous state in place", () => {
    const s = replay([founded]);
    const before = s.lastSeq;
    apply(s, { type: "task.started", taskId: "nope", at: NOW, seq: 42, ts: NOW, companyId: "c" } as StoredEvent);
    expect(s.lastSeq).toBe(before);
  });
});

describe("revision: the founder's cancel is respected", () => {
  const legal: DomainEvent[] = [
    founded,
    hire("m", "cofondateur"),
    hire("h", "juridique"),
    { type: "obligation.opened", obligation: { id: "o", code: "B3-annonce-legale", title: "Publier l'annonce légale", why: "", owner: "juridique", status: "open", openedAt: NOW } },
    { type: "task.planned", task: { id: "t", agentId: "h", title: "Publier l'annonce légale", why: "", kind: "external", status: "planned", tag: "B3-annonce-legale", createdAt: NOW, scheduledAt: NOW, cancellableUntil: NOW + 24 * HOUR } },
    { type: "task.cancelled", taskId: "t", at: NOW + HOUR, by: "founder" },
  ];
  const replans = (events: DomainEvent[]) => decide(replay(events), NOW + 2 * HOUR).filter((i) => i.type === "plan-task" && i.draft.tag === "B3-annonce-legale");

  it("does not plan the same external action again right after the founder cancelled it", () => {
    expect(replans(legal)).toEqual([]);
  });

  it("shows it on the sign, so the founder can take it back up", () => {
    const m = missions(replay(legal), NOW + 2 * HOUR, "anthropic").find((x) => x.obligationId === "o");
    expect(m).toMatchObject({ action: "retry" });
  });

  it("starts again once the founder says so", () => {
    expect(replans([...legal, { type: "obligation.retried", obligationId: "o", at: NOW + 3 * HOUR }])).toHaveLength(1);
  });
});

describe("revision: stages always reachable", () => {
  it("always brings someone to do the market study, even when Margaux picked others", () => {
    const plan = staffingFrom({ reaction: "", findings: [], simulated: false, team: [{ role: "juridique", why: "" }, { role: "technique", why: "" }], later: [] });
    expect(plan.some((e) => e.role === "recherche" && e.at === "research")).toBe(true);
  });

  it("opens the operating stage on the first sale the founder records", () => {
    const s = replay([
      { ...founded, company: { ...(founded as { company: object }).company, stage: "launch" } } as DomainEvent,
      hire("m", "cofondateur"),
      { type: "sale.recorded", sale: { id: "v", at: NOW, amountCents: 3900, note: "Marché de Noël" } },
    ]);
    expect(decide(s, NOW).find((i) => i.type === "advance-stage")).toMatchObject({ stage: "operating" });
  });
});

describe("revision: the journal tells the sale", () => {
  it("lists the founder's sale", async () => {
    const { journalEntries } = await import("../src/index.ts");
    const events = [founded, { type: "sale.recorded", sale: { id: "v", at: NOW, amountCents: 3990, note: "Marché" } }].map((e, i) => ({ ...e, seq: i + 1, ts: NOW, companyId: "c" }) as StoredEvent);
    // French currency formatting puts a narrow no-break space before €.
    expect(journalEntries(replay(events), events).some((e) => /^Tu as enregistré une vente de 39,90\s€ · Marché$/u.test(e.text))).toBe(true);
  });
});

describe("revision: guard on external actions", () => {
  const s = replay([founded, hire("s", "prospection")]);
  it.each([
    "Envoyer les 50 e-mails de prospection",
    "Publier le post Instagram de lancement",
    "Commander 200 pots chez le fournisseur",
    "Appeler les trois concept stores",
    "Mettre en ligne la page d'accueil",
  ])("never lets « %s » leave without a cancel window, whatever the agent says", (title) => {
    const r = guardTask(s, { agentId: "s", title, why: "", kind: "internal" }, NOW);
    expect(r.ok && r.task.kind).toBe("external");
    expect(r.ok && r.task.cancellableUntil).toBeGreaterThan(NOW);
  });

  it("keeps preparing work internal", () => {
    const r = guardTask(s, { agentId: "s", title: "Rédiger les e-mails de prospection (brouillons)", why: "", kind: "internal" }, NOW);
    expect(r.ok && r.task.kind).toBe("internal");
  });

  const asked = replay([{ ...founded, settings: { ...DEFAULT_SETTINGS, alwaysAsk: ["prix", "publicite-payante"] } } as DomainEvent]);
  it.each([
    ["Lancer une campagne Google Ads à 200 € par mois", "publicite-payante"],
    ["Booster nos posts Instagram avec 50 €", "publicite-payante"],
    ["Relever nos tarifs de 10 %", "prix"],
    ["Nouvelle grille tarifaire : +15 %", "prix"],
    ["Augmenter dès le mois prochain, pour tous les abonnés, le prix", "prix"],
    ["Mettre en place une réduction de 20 %", "prix"],
  ])("recognises « %s » as reserved", (title, tag) => {
    expect(reservedTopic(asked, title)).toBe(tag);
  });

  it("still lets research about prices through", () => {
    expect(reservedTopic(asked, "Étude des prix des concurrents à Lille")).toBeUndefined();
  });
});

describe("revision: one clock for money", () => {
  it("counts spend per Paris day in the chart, like the budget", () => {
    // 23:30 UTC on 20 Oct is already 21 Oct in Paris.
    const at = Date.UTC(2026, 9, 20, 23, 30);
    const s = replay([founded]);
    const b = spendBreakdown(s, [{ type: "usage.recorded", agentId: "m", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits: 7, at, seq: 1, ts: at, companyId: "c" }]);
    const day = b.byDay.find((d) => d.credits === 7)!;
    expect(fmt.dayKey(day.day)).toBe(fmt.dayKey(at));
    expect(fmt.dayKey(at)).toBe("2026-10-21");
  });
});

void emptyState;
