import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, founderRoles, replay, spendByAgent, toolUsers, type DomainEvent, type StoredEvent } from "../src/index.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 19, 12);
const ag = (id: string, name: string, role: "cofondateur" | "juridique" | "redaction", at: number): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name, role, hiredAt: at, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const plan = (id: string, agentId: string, title: string): DomainEvent => ({
  type: "task.planned",
  task: { id, agentId, title, why: "", kind: "internal", status: "planned", createdAt: NOW - 5 * H, scheduledAt: NOW - 5 * H },
});
const use = (agentId: string, credits: number, at: number, taskId?: string): DomainEvent => ({
  type: "usage.recorded",
  agentId,
  ...(taskId ? { taskId } : {}),
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  credits,
  at,
});
const events: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW - 10 * H, stage: "creation", paused: false }, settings: DEFAULT_SETTINGS },
  ag("m", "Margaux", "cofondateur", NOW - 10 * H),
  ag("hugo", "Hugo", "juridique", NOW - 9 * H),
  ag("jeanne", "Jeanne", "redaction", NOW - 8 * H),
  plan("t1", "hugo", "Rédiger les statuts"),
  plan("t2", "hugo", "Vérifier le nom"),
  use("hugo", 40, NOW - 2 * H, "t1"),
  use("hugo", 10, NOW - 2 * H, "t2"),
  use("hugo", 25, NOW - H, "t1"),
  use("m", 30, NOW - H),
  use("m", 500, NOW - 40 * 24 * H),
];
const stored: StoredEvent[] = events.map((e, i) => ({ ...e, companyId: "c", seq: i + 1, ts: NOW - 50 * 24 * H }));
const state = replay(stored);

describe("founderRoles", () => {
  it("names what the law makes of the founder, by legal form", () => {
    expect(founderRoles("SASU").map((r) => r.title)).toEqual(["Présidence", "Toutes les actions"]);
    expect(founderRoles("EURL")[0]!.title).toBe("Gérance");
    expect(founderRoles("micro")).toHaveLength(1);
  });
  it("says it depends on the legal form while none is chosen", () => {
    expect(founderRoles(undefined)[0]!.detail).toMatch(/forme juridique/);
  });
});

describe("spendByAgent", () => {
  it("sums the spend per agent since a date, biggest first, with the costliest task", () => {
    const rows = spendByAgent(state, stored, NOW - 30 * 24 * H);
    expect(rows.map((r) => [r.name, r.credits])).toEqual([
      ["Hugo", 75],
      ["Margaux", 30],
    ]);
    expect(rows[0]!.top).toEqual({ taskId: "t1", title: "Rédiger les statuts", credits: 65 });
    expect(rows[1]!.top).toBeUndefined();
  });
});

describe("toolUsers", () => {
  it("lists the hired agents whose job sheet has the tool, in hiring order", () => {
    expect(toolUsers(state, "web_search")).toEqual(["Margaux", "Hugo", "Jeanne"]);
    expect(toolUsers(state, "recruit")).toEqual(["Margaux"]);
  });
});
