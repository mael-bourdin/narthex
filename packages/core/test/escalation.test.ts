import { describe, expect, it } from "vitest";
import { decide, DEFAULT_SETTINGS, MAX_ATTEMPTS, missions, replay, type DomainEvent } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);
const HOUR = 3_600_000;
const base: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  { type: "agent.hired", reason: "", agent: { id: "m", name: "Margaux", role: "cofondateur", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
  { type: "agent.hired", reason: "", agent: { id: "h", name: "Hugo", role: "juridique", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
  { type: "obligation.opened", obligation: { id: "o", code: "X-statuts", title: "Rédiger les statuts", why: "La loi l'exige.", owner: "juridique", status: "open", openedAt: NOW } },
];
const failed = (n: number, at: number): DomainEvent[] => [
  { type: "task.planned", task: { id: `t${n}`, agentId: "h", title: "Rédiger les statuts", why: "", kind: "internal", status: "planned", tag: "X-statuts", createdAt: at, scheduledAt: at } },
  { type: "task.started", taskId: `t${n}`, at },
  { type: "task.failed", taskId: `t${n}`, at: at + 1, error: n === MAX_ATTEMPTS ? "Le site de l'INPI ne répond pas." : "Erreur" },
];
const allFailed = [...base, ...Array.from({ length: MAX_ATTEMPTS }, (_, i) => failed(i + 1, NOW + i * HOUR)).flat()];
const mine = (events: DomainEvent[]) => decide(replay(events), NOW + 10 * HOUR).filter((i) => (i.type === "plan-task" && i.draft.tag === "X-statuts") || i.type === "escalate");

describe("escalation after repeated failures", () => {
  it("stops retrying and tells the founder once, with the last error", () => {
    expect(mine(allFailed)).toEqual([{ type: "escalate", obligationId: "o", error: "Le site de l'INPI ne répond pas." }]);
  });

  it("does not tell twice", () => {
    expect(mine([...allFailed, { type: "obligation.stuck", obligationId: "o", at: NOW + 5 * HOUR, error: "x" }])).toEqual([]);
  });

  it("puts it on the sign, with the agent who is stuck and a way to try again", () => {
    const s = replay([...allFailed, { type: "obligation.stuck", obligationId: "o", at: NOW + 5 * HOUR, error: "Le site de l'INPI ne répond pas." }]);
    const m = missions(s, NOW + 10 * HOUR, "anthropic").find((x) => x.kind === "stuck");
    expect(m).toMatchObject({ obligationId: "o", speakerId: "h", action: "retry", title: "Rédiger les statuts" });
    expect(m!.why).toContain("Le site de l'INPI ne répond pas.");
  });

  it("starts over when the founder asks to try again", () => {
    const events = [...allFailed, { type: "obligation.stuck", obligationId: "o", at: NOW + 5 * HOUR, error: "x" } as DomainEvent, { type: "obligation.retried", obligationId: "o", at: NOW + 6 * HOUR } as DomainEvent];
    expect(mine(events)).toMatchObject([{ type: "plan-task", draft: { agentId: "h", tag: "X-statuts" } }]);
    expect(replay(events).obligations["o"]!.stuck).toBeUndefined();
    expect(missions(replay(events), NOW + 10 * HOUR, "anthropic").some((x) => x.kind === "stuck")).toBe(false);
  });
});
