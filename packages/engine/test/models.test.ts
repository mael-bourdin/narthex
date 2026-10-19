import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { emptyState, type Agent, type Task } from "@narthex/core";
import { AnthropicRuntime, Engine, MemoryEventStore, SimulatedClock, SimulationRuntime, type WorkContext } from "../src/index.ts";

describe("model per teammate", () => {
  it("uses the model chosen for the agent's role", async () => {
    const models: string[] = [];
    const client = {
      beta: { messages: { stream: (p: { model: string }) => (models.push(p.model), { finalMessage: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "ok" }] }) }) } },
    } as unknown as Anthropic;
    const agent: Agent = { id: "o", name: "Oscar", role: "video", hiredAt: 0, status: "working", skill: { success: 0, failure: 0 }, autonomy: 1 };
    const task: Task = { id: "t", agentId: "o", title: "Script", why: "", kind: "internal", status: "running", createdAt: 0, scheduledAt: 0 };
    const ctx = { state: emptyState(), agent, task, now: 0, signal: new AbortController().signal, progress() {}, plan: () => null, recruit: () => null, spend() {} } as unknown as WorkContext;
    await new AnthropicRuntime({ client, models: { video: "claude-haiku-5-5" } }).run(ctx);
    await new AnthropicRuntime({ client }).run(ctx);
    expect(models).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
  });
});

describe("company.update", () => {
  it("updates the profile through the API", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: new SimulationRuntime(), clock: new SimulatedClock(0) });
    await e.handle("company.found", { name: "M", idea: "I", founderName: "Inès" });
    const s = await e.handle("company.update", { name: "Maison Lumen", founderName: "Inès Martin", city: "Lille" });
    expect(s.company).toMatchObject({ name: "Maison Lumen", city: "Lille", founder: { name: "Inès Martin" } });
    await expect(e.handle("company.update", { name: "  " })).rejects.toThrow(/nom/);
  });
});
