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
    expect(journalEntries(replay(events), events).some((e) => e.text === "You recorded a sale of €39.90 · Marché")).toBe(true);
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
    "Send the 50 prospecting emails",
    "Publish the Instagram launch post",
    "Order 200 jars from the supplier",
    "Call the three concept stores",
    "Put the home page online",
    "Write to the Lille concept stores",
    "Post the launch video on TikTok",
    "Post today's update on LinkedIn",
    "Reach out to the three concept stores",
    "Purchase 200 jars from the supplier",
    "Share the launch video with the press list",
    "Message the shop owners on Instagram",
    "Text the supplier about the delivery",
    "DM the five best leads",
    "Upload the catalogue to the website",
    "Notify customers of the new opening hours",
    "Invite the first customers to the launch",
    "Book a meeting with the bank",
    "Renew the domain name",
    "Deploy the new home page",
    "Release the spring collection",
    "Announce the launch on social media",
    "Tweet the launch date",
    "Mail the catalogue to the shops",
    "Sell the first 20 candles at the market",
    "Quote a price to Maison Verte",
    "Register the trademark with the INPI",
    "Apply for the BPI innovation grant",
    "List the candles on Etsy",
    "Follow up with the three shops",
    "Email the supplier",
  ])("never lets « %s » leave without a cancel window, whatever the agent says", (title) => {
    const r = guardTask(s, { agentId: "s", title, why: "", kind: "internal" }, NOW);
    expect(r.ok && r.task.kind).toBe("external");
    expect(r.ok && r.task.cancellableUntil).toBeGreaterThan(NOW);
  });

  it.each(["Rédiger les e-mails de prospection (brouillons)", "Send the prospecting emails (drafts)", "Write the launch post", "Post-launch review of the first week", "Draft a reply", "Research competitors", "Analyse prices", "List the first 50 qualified prospects", "Share of voice analysis", "Message for the home page", "Text for the about page", "Prepare the release notes"])(
    "keeps preparing work like « %s » internal",
    (title) => {
      const r = guardTask(s, { agentId: "s", title, why: "", kind: "internal" }, NOW);
      expect(r.ok && r.task.kind).toBe("internal");
    },
  );

  const asked = replay([{ ...founded, settings: { ...DEFAULT_SETTINGS, alwaysAsk: ["prix", "publicite-payante"] } } as DomainEvent]);
  it.each([
    ["Lancer une campagne Google Ads à 200 € par mois", "publicite-payante"],
    ["Booster nos posts Instagram avec 50 €", "publicite-payante"],
    ["Relever nos tarifs de 10 %", "prix"],
    ["Nouvelle grille tarifaire : +15 %", "prix"],
    ["Augmenter dès le mois prochain, pour tous les abonnés, le prix", "prix"],
    ["Mettre en place une réduction de 20 %", "prix"],
    ["Launch a Google Ads campaign at €200 a month", "publicite-payante"],
    ["Boost our Instagram posts with €50", "publicite-payante"],
    ["Run paid ads on Meta", "publicite-payante"],
    ["Raise our prices by 10%", "prix"],
    ["New price list: +15%", "prix"],
    ["Increase, from next month and for every subscriber, the price", "prix"],
    ["Offer a 20% discount", "prix"],
  ])("recognises « %s » as reserved", (title, tag) => {
    expect(reservedTopic(asked, title)).toBe(tag);
  });

  it("still lets research about prices through", () => {
    expect(reservedTopic(asked, "Étude des prix des concurrents à Lille")).toBeUndefined();
    expect(reservedTopic(asked, "Study competitors' prices in Lille")).toBeUndefined();
    expect(reservedTopic(asked, "Market study: customers, competitors, prices")).toBeUndefined();
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

describe("revision: a few minutes of work still count", () => {
  it("does not round three minutes down to nothing", async () => {
    const { filView } = await import("../src/index.ts");
    const s = replay([
      founded,
      hire("m", "cofondateur"),
      { type: "task.planned", task: { id: "t", agentId: "m", title: "Plan", why: "", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
      { type: "task.started", taskId: "t", at: NOW },
      { type: "task.completed", taskId: "t", at: NOW + 3 * 60_000 },
    ]);
    expect(filView(s, NOW + HOUR).team.find((r) => r.agent.id === "m")!.hoursThisWeek).toBeCloseTo(0.05, 2);
  });
});

describe("revision: journal wording", () => {
  it("does not show a task cut by closing Narthex as a failure, and says when an obligation is met", async () => {
    const { journalEntries } = await import("../src/index.ts");
    const list = [
      founded,
      hire("h", "juridique"),
      { type: "obligation.opened", obligation: { id: "o", code: "A1", title: "Vérifier que le nom est libre", why: "", owner: "juridique", status: "open", openedAt: NOW } },
      { type: "task.planned", task: { id: "t", agentId: "h", title: "Vérifier que le nom est libre", why: "", kind: "internal", status: "planned", tag: "A1", createdAt: NOW, scheduledAt: NOW } },
      { type: "task.started", taskId: "t", at: NOW },
      { type: "task.failed", taskId: "t", at: NOW, error: "Interrompue (Narthex a été fermé).", interrupted: true },
      { type: "obligation.fulfilled", obligationId: "o", at: NOW, by: "h" },
    ] as DomainEvent[];
    const events = list.map((e, i) => ({ ...e, seq: i + 1, ts: NOW + i, companyId: "c" }) as StoredEvent);
    const entries = journalEntries(replay(events), events);
    const cut = entries.find((e) => e.text.includes("interrupted"))!;
    expect(cut.kind).not.toBe("problem");
    expect(entries.some((e) => e.text === 'Obligation done: "Vérifier que le nom est libre"')).toBe(true);
  });

  it("reads the English interruption the engine now writes as a cut too", async () => {
    const { journalEntries } = await import("../src/index.ts");
    const list = [
      founded,
      hire("h", "juridique"),
      { type: "task.planned", task: { id: "t", agentId: "h", title: "Check that the name is free", why: "", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
      { type: "task.started", taskId: "t", at: NOW },
      { type: "task.failed", taskId: "t", at: NOW, error: "Interrupted (Narthex was closed)." },
    ] as DomainEvent[];
    const events = list.map((e, i) => ({ ...e, seq: i + 1, ts: NOW + i, companyId: "c" }) as StoredEvent);
    const entries = journalEntries(replay(events), events);
    expect(entries[0]).toMatchObject({ text: '"Check that the name is free" interrupted, will resume later', kind: "work" });
  });
});

describe("revision: closing Narthex is not work", () => {
  it("does not count the time a task sat interrupted as hours worked", async () => {
    const { filView } = await import("../src/index.ts");
    const s = replay([
      founded,
      hire("h", "juridique"),
      { type: "task.planned", task: { id: "t", agentId: "h", title: "Statuts", why: "", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
      { type: "task.started", taskId: "t", at: NOW },
      { type: "task.failed", taskId: "t", at: NOW + 5 * HOUR, error: "Interrompue (Narthex a été fermé).", interrupted: true },
    ]);
    expect(filView(s, NOW + 6 * HOUR).team.find((r) => r.agent.id === "h")!.hoursThisWeek).toBe(0);
  });
});
