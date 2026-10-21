import { describe, expect, it } from "vitest";
import {
  apply,
  decide,
  DEFAULT_SETTINGS,
  onboardingTeam,
  replay,
  SEUIL,
  type DomainEvent,
} from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);

describe("onboardingTeam", () => {
  it("shows who joins now, from the hiring rules", () => {
    expect(onboardingTeam().now.map((r) => r.id)).toEqual(["recherche", "juridique"]);
  });
  it("shows who comes next, dimmed", () => {
    expect(onboardingTeam().later.map((r) => r.id)).toEqual(["prospection", "redaction"]);
  });
});

describe("SEUIL copy", () => {
  it("greets the founder by name", () => {
    expect(SEUIL.askIdea("Inès")).toBe("Nice to meet you, Inès. Tell me your idea. One sentence is enough.");
    expect(SEUIL.welcome("Maison Lumen")).toBe("Welcome to Maison Lumen. Let's begin.");
  });
});

const hired = (id: string, role: "cofondateur" | "recherche"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name: id, role, hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const task = (id: string, agentId: string, tag?: string): DomainEvent => ({
  type: "task.planned",
  task: { id, agentId, title: id, why: "", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW, ...(tag ? { tag } : {}) },
});

describe("work bookkeeping", () => {
  it("does not free an agent when another of its tasks completes", () => {
    let s = replay([hired("a1", "recherche"), task("t1", "a1"), task("t2", "a1")]);
    s = apply(s, { type: "task.started", taskId: "t1", at: NOW });
    s = apply(s, { type: "task.completed", taskId: "t2", at: NOW });
    expect(s.agents.a1).toMatchObject({ status: "working", currentTaskId: "t1" });
  });

  it("still plans the kickoff when the agent's only task is the first look", () => {
    let s = replay([
      {
        type: "company.founded",
        company: { id: "c", name: "M", idea: "I", founder: { name: "F" }, foundedAt: NOW, stage: "research", paused: false },
        settings: DEFAULT_SETTINGS,
      },
      hired("m", "cofondateur"),
      task("look", "m", "first-look"),
    ]);
    s = apply(s, { type: "task.completed", taskId: "look", at: NOW });
    const planned = decide(s, NOW).flatMap((i) => (i.type === "plan-task" ? [i.draft.tag] : []));
    expect(planned).toContain("plan");
  });
});
