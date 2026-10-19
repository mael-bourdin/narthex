import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, filView, replay, xpFor, type DomainEvent, type Task } from "../src/index.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 19, 12);

const founded: DomainEvent = {
  type: "company.founded",
  company: { id: "c", name: "Maison Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW - 30 * H, stage: "research", paused: false },
  settings: DEFAULT_SETTINGS,
};
const hire = (id: string, role: "cofondateur" | "recherche" | "juridique"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name: id, role, hiredAt: NOW - 30 * H, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const planned = (id: string, agentId: string, extra: Partial<Task> = {}): DomainEvent => ({
  type: "task.planned",
  task: { id, agentId, title: id, why: "", kind: "internal", status: "planned", createdAt: NOW - 20 * H, scheduledAt: NOW - 20 * H, ...extra },
});

function company(...events: DomainEvent[]) {
  return replay([founded, hire("margaux", "cofondateur"), hire("lea", "recherche"), hire("hugo", "juridique"), ...events]);
}

describe("xpFor", () => {
  it("rewards sourced and external work, by a written rule", () => {
    const t = { kind: "internal" } as Task;
    expect(xpFor(t, 0)).toBe(30);
    expect(xpFor(t, 3)).toBe(60);
    expect(xpFor(t, 20)).toBe(90);
    expect(xpFor({ kind: "external" } as Task, 0)).toBe(70);
  });
});

describe("filView", () => {
  it("is empty for a company where nothing has been done yet", () => {
    const v = filView(company(), NOW);
    expect(v.items).toEqual([]);
  });

  it("shows each post with the real duration, XP and sources of its work", () => {
    const s = company(
      planned("study", "lea"),
      { type: "task.started", taskId: "study", at: NOW - 5 * H },
      {
        type: "task.completed",
        taskId: "study",
        at: NOW - 2 * H,
        deliverable: { id: "d", taskId: "study", agentId: "lea", title: "Étude", summary: "s", body: "b", sources: [{ title: "INSEE" }, { title: "Pappers" }], createdAt: NOW - 2 * H },
      },
      { type: "post.published", post: { id: "p", agentId: "lea", at: NOW - 2 * H, kind: "deliverable", text: "Fini.", taskId: "study", deliverableId: "d" } },
    );
    const [item] = filView(s, NOW).items;
    expect(item).toMatchObject({ durationMs: 3 * H, xp: 50, sources: ["INSEE", "Pappers"] });
  });

  it("says what runs now and what comes next", () => {
    const s = company(planned("a", "lea"), { type: "task.started", taskId: "a", at: NOW - H }, planned("b", "hugo", { title: "Annonce légale", scheduledAt: NOW + 3 * H }));
    const v = filView(s, NOW);
    expect(v.pilot.running).toBe(1);
    expect(v.pilot.next?.title).toBe("Annonce légale");
  });

  it("counts each teammate's real hours this week", () => {
    const s = company(planned("a", "lea"), { type: "task.started", taskId: "a", at: NOW - 4 * H }, { type: "task.completed", taskId: "a", at: NOW - H });
    const lea = filView(s, NOW).team.find((m) => m.agent.id === "lea")!;
    expect(lea.hoursThisWeek).toBe(3);
    expect(lea.status).toBe("idle");
  });

  it("marks the teammate waiting on the founder", () => {
    const s = company({
      type: "obligation.opened",
      obligation: { id: "o", code: "A3-forme", title: "Choisir la forme juridique", why: "", owner: "founder", status: "open", openedAt: NOW },
    });
    expect(filView(s, NOW).team.find((m) => m.agent.id === "hugo")!.status).toBe("waiting-you");
  });

  it("follows the quest of the current stage", () => {
    expect(filView(company(), NOW).quest).toEqual({ title: "Valider ton idée", done: 0, total: 1, next: "Étude de marché" });
    const s = company(
      { type: "stage.changed", stage: "creation", at: NOW },
      { type: "obligation.opened", obligation: { id: "o1", code: "A1-nom", title: "Nom", why: "", owner: "juridique", status: "open", openedAt: NOW } },
      { type: "obligation.opened", obligation: { id: "o2", code: "A2-activite-reglementee", title: "Activité", why: "", owner: "juridique", status: "open", openedAt: NOW } },
      { type: "obligation.fulfilled", obligationId: "o1", at: NOW, by: "hugo" },
    );
    expect(filView(s, NOW).quest).toEqual({ title: "Créer ta société", done: 1, total: 2, next: "Activité" });
  });
});

import { fmt } from "../src/index.ts";

describe("fmt.duration", () => {
  it("writes durations the French way", () => {
    expect(fmt.duration(35 * 60_000)).toBe("35 min");
    expect(fmt.duration(130 * 60_000)).toBe("2 h 10");
    expect(fmt.duration(3 * 3_600_000)).toBe("3 h");
    expect(fmt.duration(20_000)).toBe("1 min");
  });
});
