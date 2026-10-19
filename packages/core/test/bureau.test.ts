import { describe, expect, it } from "vitest";
import { bureauDialogue, DEFAULT_SETTINGS, replay, type DomainEvent } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 12);
const ag = (id: string, name: string, role: "cofondateur" | "recherche" | "juridique"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name, role, hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const base: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  ag("m", "Margaux", "cofondateur"),
  ag("lea", "Léa", "recherche"),
  ag("hugo", "Hugo", "juridique"),
];

describe("bureauDialogue", () => {
  it("lets the one who waits on you ask, with the legal action as a choice", () => {
    const s = replay([...base, { type: "obligation.opened", obligation: { id: "o", code: "B5-signer-statuts", title: "Signer les statuts", why: "La loi l'exige.", owner: "founder", status: "open", openedAt: NOW } }]);
    const d = bureauDialogue(s, "hugo", NOW, "anthropic");
    expect(d.waiting).toBe(true);
    expect(d.text).toContain("Signer les statuts");
    expect(d.options[0]).toMatchObject({ label: "Voir", mission: { obligationId: "o" } });
    expect(d.options.at(-1)!.label).toBe("Plus tard");
  });

  it("says what a working agent is doing, in the first person", () => {
    const s = replay([
      ...base,
      { type: "task.planned", task: { id: "t", agentId: "lea", title: "Étude de marché", why: "Savoir s'il y a de la place", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
      { type: "task.started", taskId: "t", at: NOW },
    ]);
    const d = bureauDialogue(s, "lea", NOW, "anthropic");
    expect(d.text).toBe("Je travaille sur « Étude de marché ». Savoir s'il y a de la place.");
    expect(d.options.map((o) => o.label)).toEqual(["Voir ma fiche", "Plus tard"]);
  });

  it("is honest when nobody can work yet", () => {
    const d = bureauDialogue(replay(base), "lea", NOW, "none");
    expect(d.text).toContain("ta clé");
  });
});
