import { describe, expect, it } from "vitest";
import { curatePlaybook, DEFAULT_SETTINGS, replay, type DomainEvent, type Lesson } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 20, 9);
const lesson = (id: string, text: string, extra: Partial<Lesson> = {}): Lesson => ({ id, text, helpful: 0, harmful: 0, learntAt: NOW, ...extra });

describe("playbooks (L4, ACE deltas)", () => {
  it("adds new lessons, counts helpful and harmful ones", () => {
    const next = curatePlaybook([lesson("a", "Toujours citer la fiche INSEE")], { add: [{ id: "b", text: "Vérifier le registre avant les domaines" }], helpful: ["a"], harmful: [] }, NOW);
    expect(next.map((l) => [l.id, l.helpful])).toEqual([["a", 1], ["b", 0]]);
  });

  it("drops a lesson that hurt more than it helped", () => {
    const next = curatePlaybook([lesson("a", "Promettre un délai de 24 h", { helpful: 0, harmful: 1 })], { add: [], helpful: [], harmful: ["a"] }, NOW);
    expect(next).toEqual([]);
  });

  it("does not add a lesson it already has, even worded differently", () => {
    const next = curatePlaybook([lesson("a", "Vérifier le registre des entreprises avant les noms de domaine")], { add: [{ id: "b", text: "Avant les noms de domaine, vérifier le registre des entreprises" }], helpful: [], harmful: [] }, NOW);
    expect(next.map((l) => l.id)).toEqual(["a"]);
  });

  it("keeps the twelve most useful lessons", () => {
    const many = Array.from({ length: 12 }, (_, i) => lesson(`l${i}`, `Leçon numéro ${i} sur un sujet ${"abcdefghijkl"[i]}`, { helpful: i }));
    const next = curatePlaybook(many, { add: [{ id: "new", text: "Une toute nouvelle façon de faire" }], helpful: [], harmful: [] }, NOW);
    expect(next).toHaveLength(12);
    expect(next.some((l) => l.id === "new")).toBe(true);
    expect(next.some((l) => l.id === "l0")).toBe(false);
  });

  it("lives in the company state, per role", () => {
    const s = replay([
      { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "I" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
      { type: "playbook.updated", role: "juridique", lessons: [lesson("a", "Citer Légifrance")], taskId: "t", at: NOW },
    ] as DomainEvent[]);
    expect(s.playbooks?.juridique?.map((l) => l.text)).toEqual(["Citer Légifrance"]);
  });
});
