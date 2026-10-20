import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, role, type DomainEvent } from "@narthex/core";
import { Engine, identity, MemoryEventStore, SimulatedClock, type AgentRuntime, type ReflectionInput } from "../src/index.ts";

const START = Date.UTC(2026, 9, 20, 7);

function company(fail = false) {
  const store = new MemoryEventStore();
  const seed: DomainEvent[] = [
    { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "Inès" }, foundedAt: START, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
    { type: "agent.hired", reason: "", agent: { id: "h", name: "Hugo", role: "juridique", hiredAt: START, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
    { type: "playbook.updated", role: "juridique", lessons: [{ id: "old", text: "Citer Légifrance avec la date", helpful: 0, harmful: 0, learntAt: START }], at: START },
    { type: "task.planned", task: { id: "t", agentId: "h", title: "Vérifier le nom", why: "Avant d'imprimer", kind: "internal", status: "planned", createdAt: START, scheduledAt: START } },
    { type: "task.planned", task: { id: "x", agentId: "h", title: "Déposer la marque", why: "Protéger le nom", kind: "external", status: "planned", createdAt: START, scheduledAt: START + 3_600_000, cancellableUntil: START + 86_400_000 } },
  ];
  for (const e of seed) store.append("c", e, START);
  const seen: ReflectionInput[] = [];
  const runtime: AgentRuntime = {
    name: "anthropic",
    firstLook: async () => { throw new Error("no"); },
    run: async () => {
      if (fail) throw new Error("INPI injoignable");
      return { post: "Le nom est pris.", deliverable: { title: "Nom", summary: "Pris par une entreprise de Linas.", body: "…", sources: [] } };
    },
    reflect: async (input) => {
      seen.push(input);
      return { add: ["Interroger le registre avant les noms de domaine"], helpful: ["old"], harmful: [], usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, credits: 1 } };
    },
  };
  return { engine: new Engine({ store, runtime, clock: new SimulatedClock(START) }), seen };
}

async function settle(e: Engine) {
  for (let i = 0; i < 6; i++) {
    e.tick();
    await e.idle();
  }
  return e.getState();
}

describe("playbook reflection", () => {
  it("learns from a finished task, with what the role already knew", async () => {
    const { engine, seen } = company();
    const s = await settle(engine);
    const onT = seen.find((r) => r.task.title === "Vérifier le nom")!;
    expect(onT).toMatchObject({ role: "juridique", outcome: "done", lessons: [{ id: "old", text: "Citer Légifrance avec la date" }] });
    expect(onT.detail).toContain("Le nom est pris.");
    const lessons = s.playbooks!.juridique!;
    expect(lessons.map((l) => l.text)).toContain("Interroger le registre avant les noms de domaine");
    expect(lessons.find((l) => l.id === "old")!.helpful).toBeGreaterThan(0);
  });

  it("learns from a failure and from the founder's cancel", async () => {
    const { engine, seen } = company(true);
    await engine.handle("task.cancel", { taskId: "x" });
    await settle(engine);
    expect(seen.find((r) => r.task.title === "Déposer la marque")).toMatchObject({ outcome: "cancelled" });
    expect(seen.find((r) => r.task.title === "Vérifier le nom")).toMatchObject({ outcome: "failed", detail: "INPI injoignable" });
  });

  it("puts the role's lessons in its identity", () => {
    const text = identity(role("juridique"), "Hugo", [{ id: "a", text: "Interroger le registre avant les noms de domaine", helpful: 2, harmful: 0, learntAt: START }]);
    expect(text).toContain("Ce que tu as appris");
    expect(text).toContain("Interroger le registre avant les noms de domaine");
  });
});

describe("reflectors", () => {
  const input: ReflectionInput = { role: "juridique", task: { title: "Vérifier le nom", why: "", kind: "internal" }, outcome: "done", detail: "Le nom est pris.", lessons: [{ id: "old", text: "Citer Légifrance" }], now: START, signal: new AbortController().signal };
  const answer = { add: ["Interroger le registre d'abord"], helpful: ["old"], harmful: [] };

  it("uses Haiku and a forced, strict tool on the API", async () => {
    const { AnthropicRuntime } = await import("../src/index.ts");
    const calls: Record<string, unknown>[] = [];
    const client = { beta: { messages: { create: async (p: Record<string, unknown>) => (calls.push(p), { stop_reason: "tool_use", model: "claude-haiku-5-5", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id: "x", name: "update_playbook", input: answer }] }) } } } as never;
    const out = await new AnthropicRuntime({ client }).reflect(input);
    expect(calls[0]).toMatchObject({ model: "claude-haiku-5-5", tool_choice: { type: "tool", name: "update_playbook" } });
    expect(JSON.stringify(calls[0]!.messages)).toContain("[old]");
    expect(out).toMatchObject(answer);
  });

  it("goes through Claude Code in development", async () => {
    const { ClaudeCodeRuntime } = await import("../src/index.ts");
    const call = async (args: string[]) => JSON.stringify(args[0] === "auth" ? { loggedIn: true, authMethod: "claude.ai" } : { type: "result", is_error: false, usage: {}, structured_output: answer });
    expect((await new ClaudeCodeRuntime({ call }).reflect(input)).add).toEqual(["Interroger le registre d'abord"]);
  });
});
