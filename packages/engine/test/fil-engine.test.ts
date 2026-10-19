import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { chooseRuntime, AnthropicRuntime, Engine, MemoryEventStore, SimulatedClock, SimulationRuntime } from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);

describe("no key, no fake work", () => {
  it("picks no runtime at all when the player has no key", () => {
    expect(chooseRuntime({}, {})).toBe("none");
  });

  it("keeps the simulation for development only", () => {
    expect(chooseRuntime({}, { NARTHEX_RUNTIME: "simulation" })).toBe("simulation");
  });

  it("plans the team's work but never pretends to do it", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: null, clock: new SimulatedClock(START) });
    await e.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    await e.idle();
    const s = e.getState();
    expect(Object.values(s.tasks).some((t) => t.status === "planned")).toBe(true);
    expect(Object.values(s.tasks).every((t) => t.status === "planned")).toBe(true);
    expect(Object.keys(s.deliverables)).toHaveLength(0);
    expect(e.status().runtime).toBe("none");
  });

  it("starts working as soon as a key arrives, even after founding", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: null, clock: new SimulatedClock(START) });
    await e.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    e.useRuntime(new SimulationRuntime());
    await e.idle();
    expect(Object.values(e.getState().tasks).some((t) => t.status === "done")).toBe(true);
  });
});

describe("a quiet Fil", () => {
  it("says who joined in one message, and nothing about stages or legal duties", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: null, clock: new SimulatedClock(START) });
    await e.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    const posts = e.getState().posts;
    expect(posts.filter((p) => p.kind === "hire")).toHaveLength(1);
    expect(posts[0]!.text).toMatch(/Léa/);
    expect(posts[0]!.text).toMatch(/Hugo/);
    expect(posts.some((p) => p.kind === "legal")).toBe(false);
    expect(posts.some((p) => /étudie l'idée/.test(p.text))).toBe(false);
  });
});

describe("real first look", () => {
  it("reads the answer spread over several text blocks after a web search", async () => {
    const response = {
      stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      content: [
        { type: "text", text: "Je cherche." },
        { type: "server_tool_use", id: "s", name: "web_search", input: {} },
        { type: "web_search_tool_result", tool_use_id: "s", content: [] },
        { type: "text", text: '{"reaction": "Des bougies, j\'adore.", "findings": [{"text": "312 boutiques", ' },
        { type: "text", text: '"source": "INSEE"}, {"text": "34 € en moyenne", "source": "Etsy"}]}' },
      ],
    };
    const calls: Record<string, unknown>[] = [];
    const client = { beta: { messages: { create: async (p: Record<string, unknown>) => (calls.push(p), response) } } } as unknown as Anthropic;
    const look = await new AnthropicRuntime({ client }).firstLook({ idea: "Bougies", founderName: "Inès", now: START, signal: new AbortController().signal });
    expect(look.reaction).toBe("Des bougies, j'adore.");
    expect(look.findings.map((f) => f.source)).toEqual(["INSEE", "Etsy"]);
    expect(look.usage!.credits).toBeGreaterThan(0);
    // Web search always cites; a forced JSON format would be rejected alongside it.
    expect((calls[0]!.output_config as Record<string, unknown>).format).toBeUndefined();
    expect(calls[0]!.max_tokens).toBe(16000);
  });

  it("refuses a cut-off answer instead of guessing", async () => {
    const client = { beta: { messages: { create: async () => ({ stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 }, content: [] }) } } } as unknown as Anthropic;
    await expect(new AnthropicRuntime({ client }).firstLook({ idea: "B", founderName: "I", now: START, signal: new AbortController().signal })).rejects.toThrow();
  });
});
