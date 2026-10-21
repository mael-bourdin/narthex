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

  it("gives up on a network that never answers", async () => {
    const fake = fakeModels(() => new Promise(() => {}));
    const r = await verifyAnthropicKey("sk-ant-x", fake.client, 50);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/joindre Anthropic/);
  });

  it("speaks French when Anthropic answers with another error", async () => {
    const fake = fakeModels(async () => {
      throw new Anthropic.InternalServerError(500, undefined, "Internal server error", new Headers());
    });
    const r = await verifyAnthropicKey("sk-ant-x", fake.client);
    expect(!r.ok && r.message).toBe("Anthropic ne répond pas correctement pour l'instant. Réessaie dans un moment.");
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
    expect(loadConfig(dir)).toEqual({ provider: "anthropic", anthropicApiKey: "sk-ant-x" });
  });

  it("remembers the simulation", () => {
    dir = mkdtempSync(join(tmpdir(), "narthex-"));
    chooseSimulation(dir);
    expect(loadConfig(dir).runtime).toBe("simulation");
  });
});

describe("Engine.useRuntime", () => {
  it("takes effect right away, before or after founding", async () => {
    const e = new Engine({ store: new MemoryEventStore(), runtime: null, clock: new SimulatedClock(0) });
    await e.handle("company.found", { name: "M", idea: "Bougies", founderName: "I" });
    e.useRuntime(new SimulationRuntime());
    expect(e.status().runtime).toBe("simulation");
  });
});
