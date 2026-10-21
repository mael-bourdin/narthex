import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, deliverableMarkdown, deliverableSheet, replay, type DomainEvent, type StoredEvent } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 12);
const HOUR = 3_600_000;
const ag = (id: string, name: string, role: "cofondateur" | "juridique"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name, role, hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const BODY = `J'ai résumé chaque article en une phrase.

## Art. 1 · Forme
Ta société est une SASU. Ta responsabilité est limitée à ce que tu as apporté.

## Art. 2 · Objet
Fabrication et vente de bougies.

| a | b |
|---|---|
| 1 | 2 |`;
const events: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  ag("m", "Margaux", "cofondateur"),
  ag("hugo", "Hugo", "juridique"),
  { type: "task.planned", task: { id: "t", agentId: "hugo", title: "Rédiger les statuts", why: "Pour créer la société", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
  { type: "task.started", taskId: "t", at: NOW },
  {
    type: "task.completed",
    taskId: "t",
    at: NOW + 2 * HOUR + 10 * 60_000,
    deliverable: {
      id: "d",
      taskId: "t",
      agentId: "hugo",
      title: "Statuts",
      summary: "",
      body: BODY,
      sources: [{ title: "Légifrance", url: "https://www.legifrance.gouv.fr/x" }, { title: "INPI", url: "https://www.inpi.fr/y" }, { title: "Légifrance 2", url: "https://legifrance.gouv.fr/z" }],
      createdAt: NOW + 2 * HOUR,
    },
  },
];
const stored = (list: DomainEvent[]): StoredEvent[] => list.map((e, i) => ({ ...e, seq: i + 1, ts: NOW, companyId: "c" }) as StoredEvent);

describe("deliverableSheet", () => {
  it("splits the document into its sections, keeping the intro apart", () => {
    const s = replay(events);
    const sheet = deliverableSheet(s, s.deliverables["d"]!, [], NOW, "anthropic");
    expect(sheet.intro).toBe("J'ai résumé chaque article en une phrase.");
    expect(sheet.sections.map((x) => x.title)).toEqual(["Art. 1 · Forme", "Art. 2 · Objet"]);
    expect(sheet.sections[0]!.lead).toBe("Ta société est une SASU.");
    expect(sheet.sections[1]!.body).toContain("| 1 | 2 |");
  });

  it("says who wrote it, how long it took and where the sources come from", () => {
    const s = replay(events);
    const sheet = deliverableSheet(s, s.deliverables["d"]!, [], NOW, "anthropic");
    expect(sheet.meta).toEqual(["Written by Hugo", "2 h 10 of work", "3 sources", "legifrance.gouv.fr, inpi.fr"]);
  });

  it("counts the AI spend of the task that produced it", () => {
    const s = replay(events);
    const usage = (taskId: string, credits: number): DomainEvent => ({ type: "usage.recorded", agentId: "hugo", taskId, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits });
    const sheet = deliverableSheet(s, s.deliverables["d"]!, stored([usage("t", 40), usage("t", 2), usage("other", 99)]), NOW, "anthropic");
    expect(sheet.spend).toBe(42);
  });

  it("offers what its author waits on from the founder, and nothing invented otherwise", () => {
    const s = replay(events);
    expect(deliverableSheet(s, s.deliverables["d"]!, [], NOW, "anthropic").next).toBeUndefined();
    const s2 = replay([...events, { type: "obligation.opened", obligation: { id: "o", code: "B5-signer-statuts", title: "Signer les statuts", why: "La loi l'exige.", owner: "founder", status: "open", openedAt: NOW } }]);
    expect(deliverableSheet(s2, s2.deliverables["d"]!, [], NOW, "anthropic").next).toMatchObject({ obligationId: "o", speakerId: "hugo" });
  });

  it("leads with the words of a list, drops the repeated title and trailing rules", () => {
    const s = replay(events);
    const body = "# Statuts, version longue\n\n_Vérifié le 19/10._\n\n## En bref\n1. **Les marchés sont fermés.** Pour Lille, c'est fini.\n\n---\n\n## Limites\n- Le quota a été atteint.";
    const sheet = deliverableSheet(s, { ...s.deliverables["d"]!, body }, [], NOW, "anthropic");
    expect(sheet.intro).toBe("_Vérifié le 19/10._");
    expect(sheet.sections.map((x) => x.lead)).toEqual(["Les marchés sont fermés.", "Le quota a été atteint."]);
    expect(sheet.sections[0]!.body.endsWith("Pour Lille, c'est fini.")).toBe(true);
  });

  it("keeps a document without sections whole", () => {
    const s = replay(events);
    const sheet = deliverableSheet(s, { ...s.deliverables["d"]!, body: "Juste un texte." }, [], NOW, "anthropic");
    expect(sheet.sections).toEqual([]);
    expect(sheet.intro).toBe("Juste un texte.");
  });
});

describe("deliverableMarkdown", () => {
  it("writes the document with its title, author and sources, ready to keep", () => {
    const s = replay(events);
    const md = deliverableMarkdown(s, s.deliverables["d"]!);
    expect(md.startsWith("# Statuts\n\n_Written by Hugo · ")).toBe(true);
    expect(md).toMatch(/^_Written by Hugo · \d{1,2} [A-Z][a-z]+ 20\d\d_$/m);
    expect(md).toContain("## Art. 2 · Objet");
    expect(md).toContain("## Sources\n\n- [Légifrance](https://www.legifrance.gouv.fr/x)\n- [INPI](https://www.inpi.fr/y)");
  });
});

describe("checked sources", () => {
  const checked = (results: { url: string; ok: boolean }[]): DomainEvent => ({ type: "sources.checked", deliverableId: "d", at: NOW + 3 * HOUR, results });

  it("keeps which links answered on the deliverable", () => {
    const s = replay([...events, checked([{ url: "https://www.legifrance.gouv.fr/x", ok: true }, { url: "https://www.inpi.fr/y", ok: false }])]);
    const d = s.deliverables["d"]!;
    expect(d.sources.map((x) => x.reachable)).toEqual([true, false, undefined]);
    expect(d.linksCheckedAt).toBe(NOW + 3 * HOUR);
  });

  it("says it on the page: how many links answer, and which do not", () => {
    const s = replay([...events, checked([
      { url: "https://www.legifrance.gouv.fr/x", ok: true },
      { url: "https://www.inpi.fr/y", ok: false },
      { url: "https://legifrance.gouv.fr/z", ok: true },
    ])]);
    const sheet = deliverableSheet(s, s.deliverables["d"]!, [], NOW, "anthropic");
    expect(sheet.links).toEqual({ checked: 3, dead: ["INPI"] });
  });

  it("claims nothing before the check", () => {
    const s = replay(events);
    expect(deliverableSheet(s, s.deliverables["d"]!, [], NOW, "anthropic").links).toBeUndefined();
  });
});
