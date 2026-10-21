import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, recallFacts, replay, searchJournal, type DomainEvent, type Fact } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);
const DAY = 86_400_000;
const hire = (id: string, name: string, role: "cofondateur" | "recherche" | "prospection" | "comptable"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name, role, hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const fact = (id: string, text: string, extra: Partial<Fact> = {}): Fact => ({
  id,
  text,
  subject: "",
  importance: 5,
  deliverableId: "d",
  validFrom: NOW,
  ...extra,
});
const base: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  hire("m", "Margaux", "cofondateur"),
  hire("l", "Léa", "recherche"),
  hire("s", "Samir", "prospection"),
  hire("p", "Paul", "comptable"),
];

describe("facts (L2)", () => {
  it("keeps what the team learnt, and dates what is no longer true instead of erasing it", () => {
    const s = replay([
      ...base,
      { type: "facts.extracted", deliverableId: "d1", at: NOW, added: [fact("f1", "Une bougie de 180 g se vend 39 € chez les bougiers lillois haut de gamme", { deliverableId: "d1" })], invalidated: [] },
      { type: "facts.extracted", deliverableId: "d2", at: NOW + DAY, added: [fact("f2", "Une bougie de 180 g se vend 42 € à Lille depuis octobre", { deliverableId: "d2", validFrom: NOW + DAY })], invalidated: ["f1"] },
    ]);
    expect(Object.keys(s.facts)).toEqual(["f1", "f2"]);
    expect(s.facts["f1"]!.invalidAt).toBe(NOW + DAY);
    expect(s.facts["f2"]!.invalidAt).toBeUndefined();
  });

  it("recalls what matters for a task: relevant, still valid, accents and plurals aside", () => {
    const s = replay([
      ...base,
      {
        type: "facts.extracted",
        deliverableId: "d",
        at: NOW,
        added: [
          fact("price-old", "Prix moyen d'une bougie artisanale à Lille : 35 €", { importance: 8 }),
          fact("price", "Prix moyen d'une bougie artisanale à Lille : 39 €", { importance: 8 }),
          fact("shop", "Le concept store Kraft à Lille prend des créateurs en dépôt-vente", { importance: 6 }),
          fact("cire", "La cire de soja coûte 8 € le kilo chez le fournisseur Perles&Co", { importance: 4 }),
        ],
        invalidated: [],
      },
      { type: "facts.extracted", deliverableId: "d", at: NOW + 1, added: [], invalidated: ["price-old"] },
    ]);
    const found = recallFacts(s, "Fixer les prix des bougies", { role: "recherche", now: NOW + DAY, k: 2 });
    expect(found.map((f) => f.id)).toEqual(["price"]);
    expect(recallFacts(s, "Fixer le prix", { role: "recherche", now: NOW + DAY, k: 5 }).some((f) => f.id === "price-old")).toBe(false);
  });

  it("keeps sensitive facts to the roles that need them", () => {
    const s = replay([
      ...base,
      { type: "facts.extracted", deliverableId: "d", at: NOW, added: [fact("cash", "Trésorerie : 2 300 € sur le compte en novembre", { sensitive: true, importance: 9 })], invalidated: [] },
    ]);
    expect(recallFacts(s, "trésorerie", { role: "prospection", now: NOW, k: 5 })).toEqual([]);
    expect(recallFacts(s, "trésorerie", { role: "comptable", now: NOW, k: 5 }).map((f) => f.id)).toEqual(["cash"]);
  });

  it("recalls nothing rather than anything when nothing matches", () => {
    const s = replay([...base, { type: "facts.extracted", deliverableId: "d", at: NOW, added: [fact("f", "La cire de soja coûte 8 € le kilo")], invalidated: [] }]);
    expect(recallFacts(s, "Écrire la page d'accueil", { role: "recherche", now: NOW, k: 5 })).toEqual([]);
  });
});

describe("journal search (L3): « pourquoi a-t-on décidé X ? »", () => {
  it("finds the task and its reason, newest first among equals", () => {
    const s = replay([
      ...base,
      { type: "task.planned", task: { id: "t1", agentId: "s", title: "Contacter les concept stores lillois", why: "Le dépôt-vente est le canal le plus rapide avant Noël", kind: "external", status: "planned", createdAt: NOW, scheduledAt: NOW } },
      { type: "task.planned", task: { id: "t2", agentId: "l", title: "Étude de marché", why: "Savoir où se placer", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
    ]);
    const hits = searchJournal(s, "pourquoi a-t-on choisi le dépôt-vente ?");
    expect(hits[0]).toMatchObject({ kind: "task", id: "t1", title: "Contacter les concept stores lillois", why: "Le dépôt-vente est le canal le plus rapide avant Noël", agentId: "s" });
    expect(hits.some((h) => h.id === "t2")).toBe(false);
  });

  it("never answers with what is no longer true", () => {
    const s = replay([
      ...base,
      { type: "facts.extracted", deliverableId: "d", at: NOW, added: [fact("old", "Le nom Maison Lumen semble libre")], invalidated: [] },
      { type: "facts.extracted", deliverableId: "d", at: NOW + DAY, added: [fact("new", "Le nom Maison Lumen est déjà pris", { validFrom: NOW + DAY })], invalidated: ["old"] },
    ]);
    expect(searchJournal(s, "nom Maison Lumen").map((h) => h.id)).toEqual(["new"]);
  });
});

describe("terms", () => {
  it("drops English and French stop words alike", async () => {
    const { terms } = await import("../src/memory.ts");
    expect(terms("Why did we decide the price of the candles?")).toEqual(["price", "candle"]);
    expect(terms("Pourquoi a-t-on choisi le parfum des bougies ?")).toEqual(["parfum", "bougie"]);
  });
});
