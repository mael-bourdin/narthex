import { describe, expect, it } from "vitest";
import { apply, decide, DEFAULT_SETTINGS, missions, replay, spentOn, type DomainEvent } from "../src/index.ts";

const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.UTC(2026, 9, 19, 10);

const base: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "M", idea: "I", founder: { name: "F" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  { type: "agent.hired", reason: "", agent: { id: "m", name: "Margaux", role: "cofondateur", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
  { type: "agent.hired", reason: "", agent: { id: "lea", name: "Léa", role: "recherche", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
  { type: "task.planned", task: { id: "t", agentId: "lea", title: "Étude", why: "", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW, tag: "market-study" } },
];
const spend = (credits: number, at = NOW): DomainEvent => ({ type: "usage.recorded", agentId: "lea", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits, at });
const starts = (s: ReturnType<typeof replay>, now: number) => decide(s, now).filter((i) => i.type === "start-task").length;

describe("daily budget", () => {
  it("has sensible defaults: 3 $ a day, 1,50 $ a task", () => {
    expect(DEFAULT_SETTINGS.dailyBudgetCredits).toBe(300);
    expect(DEFAULT_SETTINGS.taskBudgetCredits).toBe(150);
  });

  it("counts what was spent each day", () => {
    const s = replay([...base, spend(120), spend(80, NOW + 2 * H), spend(50, NOW + DAY)]);
    expect(spentOn(s, NOW)).toBe(200);
    expect(spentOn(s, NOW + DAY)).toBe(50);
  });

  it("starts no new work once today's budget is spent, and resumes the next day", () => {
    const s = replay([...base, spend(300)]);
    expect(starts(s, NOW + H)).toBe(0);
    expect(starts(s, NOW + DAY)).toBe(1);
  });

  it("tells the founder on the sign, with a way to raise it", () => {
    const s = replay([...base, spend(300)]);
    const budget = missions(s, NOW + H, "anthropic").find((m) => m.kind === "budget");
    expect(budget).toMatchObject({ action: "budget", title: "Today's budget reached" });
  });

  it("follows a raised budget", () => {
    let s = replay([...base, spend(300)]);
    s = apply(s, { type: "settings.changed", patch: { dailyBudgetCredits: 600 }, at: NOW });
    expect(starts(s, NOW + H)).toBe(1);
  });
});
