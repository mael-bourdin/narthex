import { describe, expect, it } from "vitest";
import { ALWAYS_ASK, apply, DEFAULT_SETTINGS, guardTask, replay, type DomainEvent } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);
const base = replay([
  { type: "company.founded", company: { id: "c", name: "M", idea: "I", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  { type: "agent.hired", reason: "", agent: { id: "a", name: "Samir", role: "prospection", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
]);

describe("always ask before", () => {
  it("lists the topics the founder can reserve", () => {
    expect(ALWAYS_ASK.map((t) => t.tag)).toEqual(["prix", "publicite-payante", "presse", "contrat-client"]);
  });

  it("recognises a reserved topic from the task's words, not only its tag", () => {
    const r = guardTask(base, { agentId: "a", title: "Baisser les prix de 10 % pour Noël", why: "", kind: "internal" }, NOW);
    expect(r.ok && r.task.kind).toBe("external");
    const ok = guardTask(base, { agentId: "a", title: "Étude de marché : clientes, concurrents, prix", why: "", kind: "internal" }, NOW);
    expect(ok.ok && ok.task.kind).toBe("internal");
  });

  it("lets the founder free a topic", () => {
    const s = apply(base, { type: "settings.changed", patch: { alwaysAsk: [] }, at: NOW });
    const r = guardTask(s, { agentId: "a", title: "Baisser les prix", why: "", kind: "internal" }, NOW);
    expect(r.ok && r.task.kind).toBe("internal");
  });
});

describe("profile", () => {
  it("renames the company and the founder", () => {
    const s = apply(base, { type: "company.updated", patch: { name: "Lumen", city: "Lille", founderName: "Inès Martin" }, at: NOW } as DomainEvent);
    expect(s.company).toMatchObject({ name: "Lumen", city: "Lille", founder: { name: "Inès Martin" } });
  });
});

describe("reserved topics with accents", () => {
  const reserved = (title: string, why = "") => {
    const s = apply(base, { type: "settings.changed", patch: { alwaysAsk: ["prix", "publicite-payante", "presse", "contrat-client"] }, at: NOW });
    const r = guardTask(s, { agentId: "a", title, why, kind: "internal" }, NOW);
    return r.ok && r.task.kind === "external";
  };
  it("recognises accented verbs and capitals", () => {
    expect(reserved("Écrire à la presse locale")).toBe(true);
    expect(reserved("Réduire les prix de 10 %")).toBe(true);
    expect(reserved("Créer une publicité Instagram")).toBe(true);
    expect(reserved("Répondre au journaliste de La Voix du Nord")).toBe(true);
  });
  it("recognises the same topics in English", () => {
    expect(reserved("Write to the local press")).toBe(true);
    expect(reserved("Reply to the journalist from La Voix du Nord")).toBe(true);
    expect(reserved("Draft a press release")).toBe(true);
    expect(reserved("Lower prices by 10%")).toBe(true);
    expect(reserved("Create an Instagram ad")).toBe(true);
    expect(reserved("Sign the contract with Maison Verte")).toBe(true);
    expect(reserved("Send the quote to the shop")).toBe(true);
  });
  it("labels the topics in English", () => {
    expect(ALWAYS_ASK.map((t) => t.label)).toEqual(["Change prices", "Paid advertising", "Talk to the press", "Sign a customer contract"]);
  });
  it("also reads the reason given for the task", () => {
    expect(reserved("Préparer l'offre de Noël", "Pour baisser les prix pendant les fêtes")).toBe(true);
  });
  it("still lets research about these topics through", () => {
    expect(reserved("Étude des prix des concurrents")).toBe(false);
    expect(reserved("Study competitors' prices")).toBe(false);
    expect(reserved("Market study: customers, competitors, prices")).toBe(false);
  });
});
