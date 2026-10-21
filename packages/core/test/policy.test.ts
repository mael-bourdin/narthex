import { describe, expect, it } from "vitest";
import {
  apply,
  decide,
  DEFAULT_SETTINGS,
  emptyState,
  guardTask,
  OBLIGATIONS,
  replay,
  type Agent,
  type CompanyState,
  type DomainEvent,
} from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);

function founded(): CompanyState {
  return replay([
    {
      type: "company.founded",
      company: { id: "c1", name: "Maison Lumen", idea: "Des bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "idea", paused: false },
      settings: DEFAULT_SETTINGS,
    },
  ]);
}

function agent(id: string, role: Agent["role"]): DomainEvent {
  return {
    type: "agent.hired",
    reason: "",
    agent: { id, name: id, role, hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
  };
}

describe("decide", () => {
  it("hires the co-founder first and nothing else at the idea stage", () => {
    const intents = decide(founded(), NOW);
    expect(intents.filter((i) => i.type === "hire").map((i) => i.type === "hire" && i.role)).toEqual(["cofondateur"]);
  });

  it("moves to research once the co-founder is there, then hires research and legal", () => {
    let s = apply(founded(), agent("a1", "cofondateur"));
    expect(decide(s, NOW)[0]).toMatchObject({ type: "advance-stage", stage: "research" });
    s = apply(s, { type: "stage.changed", stage: "research", at: NOW });
    const roles = decide(s, NOW).flatMap((i) => (i.type === "hire" ? [i.role] : []));
    expect(roles).toEqual(["recherche", "juridique"]);
  });

  it("does nothing while paused", () => {
    const s = apply(founded(), { type: "company.paused", at: NOW });
    expect(decide(s, NOW)).toEqual([]);
  });

  it("opens statuts only for companies, once the form is chosen", () => {
    let s = apply(founded(), { type: "stage.changed", stage: "creation", at: NOW });
    const a3 = OBLIGATIONS.find((r) => r.code === "A3-forme")!;
    const a2 = OBLIGATIONS.find((r) => r.code === "A2-activite-reglementee")!;
    for (const [i, rule] of [a2, a3].entries()) {
      s = apply(s, { type: "obligation.opened", obligation: { id: `o${i}`, code: rule.code, title: rule.title, why: rule.why, owner: rule.owner, status: "open", openedAt: NOW } });
      s = apply(s, { type: "obligation.fulfilled", obligationId: `o${i}`, at: NOW, by: "founder" });
    }
    const codes = () => decide(s, NOW).flatMap((i) => (i.type === "open-obligation" ? [i.rule.code] : []));
    expect(codes()).not.toContain("B1-statuts");
    s = apply(s, { type: "company.updated", patch: { legalForm: "micro" }, at: NOW });
    expect(codes()).not.toContain("B1-statuts");
    s = apply(s, { type: "company.updated", patch: { legalForm: "SASU" }, at: NOW });
    expect(codes()).toContain("B1-statuts");
  });
});

describe("obligation tasks", () => {
  it("treats filings and publications as external, from the English titles", () => {
    let s = apply(apply(founded(), agent("h", "juridique")), agent("p", "comptable"));
    const team = OBLIGATIONS.filter((r) => r.owner !== "founder");
    for (const [i, rule] of team.entries()) {
      s = apply(s, { type: "obligation.opened", obligation: { id: `o${i}`, code: rule.code, title: rule.title, why: rule.why, owner: rule.owner, status: "open", openedAt: NOW } });
    }
    const kinds = Object.fromEntries(decide(s, NOW).flatMap((i) => (i.type === "plan-task" && i.draft.tag?.match(/^[A-C]\d/) ? [[i.draft.tag, i.draft.kind]] : [])));
    expect(kinds).toEqual({
      "A1-nom": "internal",
      "A2-activite-reglementee": "internal",
      "B1-statuts": "internal",
      "B3-annonce-legale": "external",
      "B4-immatriculation": "external",
      "B6-facturation-electronique": "external",
      "B7-rc-pro": "external",
      "B8-mentions-legales": "internal",
      "C5-cfe": "external",
      "C10-rgpd": "internal",
    });
  });

  it("asks for a teammate in plain English when a duty has no owner", () => {
    let s = apply(founded(), { type: "staffing.planned", staffing: [{ role: "cofondateur", at: "idea", why: "" }] });
    s = apply(s, { type: "obligation.opened", obligation: { id: "o", code: "A1-nom", title: "Check that the name is free", why: "", owner: "juridique", status: "open", openedAt: NOW } });
    expect(decide(s, NOW).find((i) => i.type === "hire" && i.role === "juridique")).toMatchObject({ reason: "Someone is needed to check that the name is free." });
  });
});

describe("guardTask", () => {
  const base = apply(founded(), agent("a1", "prospection"));

  it("makes external actions wait for the cancel window", () => {
    const r = guardTask(base, { agentId: "a1", title: "Envoyer 46 messages", why: "Rendez-vous", kind: "external" }, NOW);
    expect(r.ok && r.task.cancellableUntil).toBe(NOW + 24 * 3_600_000);
  });

  it("runs internal work right away", () => {
    const r = guardTask(base, { agentId: "a1", title: "Lister", why: "", kind: "internal" }, NOW);
    expect(r.ok && r.task.cancellableUntil).toBeUndefined();
  });

  it("treats always-ask topics as external", () => {
    const r = guardTask(base, { agentId: "a1", title: "Baisser le prix", why: "", kind: "internal", tag: "prix" }, NOW);
    expect(r.ok && r.task.kind).toBe("external");
  });

  it("refuses what only the founder may do", () => {
    expect(guardTask(base, { agentId: "a1", title: "Signer", why: "", kind: "founder" }, NOW).ok).toBe(false);
  });

  it("caps self-planning", () => {
    let s = base;
    for (let i = 0; i < 5; i++) {
      const r = guardTask(s, { agentId: "a1", title: `t${i}`, why: "", kind: "internal", scheduledAt: NOW + 3_600_000 }, NOW);
      if (!r.ok) throw new Error(r.reason);
      s = apply(s, { type: "task.planned", task: { id: `t${i}`, ...r.task } });
    }
    expect(guardTask(s, { agentId: "a1", title: "t6", why: "", kind: "internal" }, NOW).ok).toBe(false);
  });
});

describe("projection", () => {
  it("frees the agent and scores it when a task completes", () => {
    let s = apply(emptyState(), agent("a1", "recherche"));
    s = apply(s, { type: "task.planned", task: { id: "t1", agentId: "a1", title: "x", why: "", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } });
    s = apply(s, { type: "task.started", taskId: "t1", at: NOW });
    expect(s.agents.a1?.status).toBe("working");
    s = apply(s, { type: "task.completed", taskId: "t1", at: NOW + 1 });
    expect(s.agents.a1).toMatchObject({ status: "idle", skill: { success: 1, failure: 0 } });
  });
});
