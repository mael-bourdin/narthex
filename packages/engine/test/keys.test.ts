import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { SEUIL } from "@narthex/core";
import {
  chooseSimulation,
  Engine,
  loadConfig,
  MemoryEventStore,
  saveKey,
  SimulatedClock,
  SimulationRuntime,
  verifyAnthropicKey,
  type AgentRuntime,
} from "../src/index.ts";

function fakeModels(behaviour: () => Promise<unknown>) {
  const calls: unknown[] = [];
  return {
    calls,
    client: { models: { list: (params: unknown) => (calls.push(params), behaviour()) } } as unknown as Pick<Anthropic, "models">,
  };
}

describe("verifyAnthropicKey", () => {
  it("verifyAnthropicKey trims", async () => {
    const fake = fakeModels(async () => ({ data: [] }));
    expect(await verifyAnthropicKey("  sk-ant-abc\n", fake.client)).toEqual({ ok: true, key: "sk-ant-abc" });
    expect(fake.calls).toHaveLength(1);
  });

  it("refuses a key Anthropic rejects", async () => {
    const fake = fakeModels(async () => {
      throw new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers());
    });
    expect(await verifyAnthropicKey("sk-ant-bad", fake.client)).toEqual({ ok: false, message: SEUIL.badKey });
  });

  it("says when Anthropic cannot be reached", async () => {
    const fake = fakeModels(async () => {
      throw new Anthropic.APIConnectionError({ message: "offline" });
    });
    const r = await verifyAnthropicKey("sk-ant-x", fake.client);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/joindre Anthropic/);
  });

  it("refuses something that is not a key without calling anyone", async () => {
    const fake = fakeModels(async () => ({}));
    expect(await verifyAnthropicKey("hello", fake.client)).toEqual({ ok: false, message: SEUIL.badKey });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("saving the choice", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("saves a key and lets the mode follow it", () => {
    dir = mkdtempSync(join(tmpdir(), "narthex-"));
    chooseSimulation(dir);
    saveKey(dir, "sk-ant-x");
    expect(loadConfig(dir)).toEqual({ anthropicApiKey: "sk-ant-x" });
  });

  it("remembers the simulation", () => {
    dir = mkdtempSync(join(tmpdir(), "narthex-"));
    chooseSimulation(dir);
    expect(loadConfig(dir).runtime).toBe("simulation");
  });
});

describe("Engine.switchRuntime", () => {
  const claudeLike: AgentRuntime = { ...new SimulationRuntime(), name: "anthropic", run: async () => ({ post: "" }), firstLook: async () => ({ reaction: "", findings: [], simulated: false }) };

  it("switches before the company exists", () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: new SimulationRuntime(), clock: new SimulatedClock(0) });
    e.switchRuntime(claudeLike, new SimulatedClock(0));
    expect(e.status().runtime).toBe("anthropic");
  });

  it("refuses once the company exists", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: new SimulationRuntime(), clock: new SimulatedClock(0) });
    await e.handle("company.found", { name: "M", idea: "Bougies", founderName: "I" });
    expect(() => e.switchRuntime(claudeLike, new SimulatedClock(0))).toThrow(/existe déjà/);
  });
});
