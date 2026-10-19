import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, missions, replay, type DomainEvent } from "../src/index.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 19, 12);
const base: DomainEvent[] = [
  {
    type: "company.founded",
    company: { id: "c", name: "M", idea: "I", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false },
    settings: DEFAULT_SETTINGS,
  },
  { type: "agent.hired", reason: "", agent: { id: "lea", name: "Léa", role: "recherche", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
  { type: "agent.hired", reason: "", agent: { id: "hugo", name: "Hugo", role: "juridique", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
];
const legal: DomainEvent = {
  type: "obligation.opened",
  obligation: { id: "o", code: "A3-forme", title: "Choisir la forme juridique", why: "C'est toi qui choisis.", owner: "founder", status: "open", openedAt: NOW },
};
const study: DomainEvent[] = [
  { type: "task.planned", task: { id: "t", agentId: "lea", title: "Étude de marché", why: "Pour savoir", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
  { type: "task.started", taskId: "t", at: NOW },
];
const outreach: DomainEvent = {
  type: "task.planned",
  task: { id: "x", agentId: "lea", title: "Envoyer 46 messages", why: "Rendez-vous", kind: "external", status: "planned", createdAt: NOW, scheduledAt: NOW, cancellableUntil: NOW + 5 * H },
};

describe("missions (the colored sign)", () => {
  it("asks for the key first when nobody can work", () => {
    const [top] = missions(replay([...base, legal]), NOW, "none");
    expect(top).toMatchObject({ kind: "key", action: "key" });
  });

  it("puts what the law reserves to the founder first once the team can work", () => {
    const [top] = missions(replay([...base, legal, ...study]), NOW, "anthropic");
    expect(top).toMatchObject({ kind: "legal", action: "form", title: "Choisir la forme juridique" });
  });

  it("then an action about to leave, which can still be cancelled", () => {
    const [top] = missions(replay([...base, outreach, ...study]), NOW, "anthropic");
    expect(top).toMatchObject({ kind: "cancel", action: "cancel", taskId: "x" });
  });

  it("else shows the team's most important mission, so the sign is never empty", () => {
    const [top] = missions(replay([...base, ...study]), NOW, "anthropic");
    expect(top).toMatchObject({ kind: "mission", taskId: "t", speakerId: "lea" });
  });

  it("is never empty for a company", () => {
    expect(missions(replay(base), NOW, "anthropic").length).toBeGreaterThan(0);
  });
});
