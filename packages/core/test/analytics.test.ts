import { describe, expect, it } from "vitest";
import { analytics, DEFAULT_SETTINGS, fmt, replay, type DomainEvent, type StoredEvent } from "../src/index.ts";

const DAY = 86_400_000;
const D1 = Date.UTC(2026, 9, 19, 10);
const D2 = D1 + DAY;
const NOW = D2 + 2 * 3_600_000;
const hire = (id: string, name: string, role: "cofondateur" | "recherche"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name, role, hiredAt: D1, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const task = (id: string, agentId: string, at: number, ok: boolean, sources = 0): DomainEvent[] => [
  { type: "task.planned", task: { id, agentId, title: id, why: "", kind: "internal", status: "planned", createdAt: at, scheduledAt: at } },
  { type: "task.started", taskId: id, at },
  ok
    ? { type: "task.completed", taskId: id, at: at + 30 * 60_000, deliverable: { id: `d${id}`, taskId: id, agentId, title: id, summary: "", body: "", sources: Array.from({ length: sources }, (_, i) => ({ title: `s${i}`, url: `https://x.fr/${i}`, reachable: i > 0 })), createdAt: at, linksCheckedAt: at } }
    : { type: "task.failed", taskId: id, at: at + 10 * 60_000, error: "x" },
];
const events: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "I" }, foundedAt: D1, stage: "idea", paused: false }, settings: DEFAULT_SETTINGS },
  hire("m", "Margaux", "cofondateur"),
  hire("l", "Léa", "recherche"),
  { type: "stage.changed", stage: "research", at: D1 },
  ...task("t1", "l", D1, true, 4),
  ...task("t2", "l", D2, false),
  ...task("t3", "m", D2, true, 2),
  { type: "usage.recorded", agentId: "l", taskId: "t1", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits: 120, at: D1 },
  { type: "usage.recorded", agentId: "m", taskId: "t3", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits: 30, at: D2 },
  { type: "sale.recorded", sale: { id: "v1", at: D2, amountCents: 3900 } },
  { type: "sale.recorded", sale: { id: "v2", at: D2, amountCents: 4200 } },
];
const stored = events.map((e, i) => ({ ...e, seq: i + 1, ts: "at" in e && typeof e.at === "number" ? e.at : D1, companyId: "c" }) as StoredEvent);
const a = analytics(replay(stored), stored, NOW, 7);

describe("advanced data", () => {
  it("counts money: revenue, AI spend and what a deliverable costs", () => {
    expect(a.money).toMatchObject({ revenue: 8100, sales: 2, spend: 150, costPerDeliverable: 75 });
  });

  it("gives one point per Paris day, from the founding (never before), ending today", () => {
    expect(a.days.map((d) => fmt.dayKey(d.day))).toEqual([fmt.dayKey(D1), fmt.dayKey(D2)]);
    expect(fmt.dayKey(a.days.at(-1)!.day)).toBe(fmt.dayKey(NOW));
    const d2 = a.days.find((d) => fmt.dayKey(d.day) === fmt.dayKey(D2))!;
    expect(d2).toMatchObject({ spend: 30, done: 1, failed: 1, revenue: 8100 });
  });

  it("ranks the team by work done, with success rate and XP", () => {
    expect(a.team.map((t) => [t.name, t.done, t.failed])).toEqual([
      ["Léa", 1, 1],
      ["Margaux", 1, 0],
    ]);
    expect(a.team[0]!.successRate).toBeCloseTo(0.5);
    expect(a.team[0]!.spend).toBe(120);
    expect(a.team[0]!.xp).toBeGreaterThan(0);
  });

  it("measures quality: sources per deliverable and links that answer", () => {
    expect(a.quality.sourcesPerDeliverable).toBe(3);
    expect(a.quality.linksAnswering).toBeCloseTo(4 / 6);
  });

  it("dates every stage reached", () => {
    expect(a.stages.map((s) => s.stage)).toEqual(["idea", "research"]);
  });
});
