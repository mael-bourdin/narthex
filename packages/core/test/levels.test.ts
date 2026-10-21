import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, guardTask, replay, roleLevel, type DomainEvent } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 21, 9);

describe("how deep a task goes", () => {
  it("starts from the role: deep where a mistake costs most, light for quick answers", () => {
    expect(roleLevel("juridique")).toBe("deep");
    expect(roleLevel("recherche")).toBe("standard");
    expect(roleLevel("support")).toBe("light");
  });

  it("keeps the level the agent chose when it planned the task", () => {
    const events: DomainEvent[] = [
      { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "I" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
      { type: "agent.hired", reason: "", agent: { id: "l", name: "Léa", role: "recherche", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
    ];
    const guard = guardTask(replay(events), { agentId: "l", title: "Relire une liste", why: "Vite", kind: "internal", level: "light" }, NOW);
    expect(guard.ok && guard.task.level).toBe("light");
  });
});
