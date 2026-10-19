import { describe, expect, it } from "vitest";
import { chooseRuntime } from "../src/index.ts";

describe("chooseRuntime", () => {
  it("never spends credits just because ANTHROPIC_API_KEY is exported", () => {
    expect(chooseRuntime({}, { ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("simulation");
  });
  it("uses Claude when the player chose it", () => {
    expect(chooseRuntime({ runtime: "anthropic" }, { ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("anthropic");
    expect(chooseRuntime({ anthropicApiKey: "sk-ant-x" }, {})).toBe("anthropic");
  });
  it("refuses Claude mode without a key", () => {
    expect(() => chooseRuntime({ runtime: "anthropic" }, {})).toThrow(/clé/);
  });
  it("lets NARTHEX_RUNTIME force the simulation", () => {
    expect(chooseRuntime({ anthropicApiKey: "sk-ant-x" }, { NARTHEX_RUNTIME: "simulation" })).toBe("simulation");
  });
});

import { needsKey } from "../src/index.ts";

describe("needsKey", () => {
  it("asks for a key on a fresh install", () => {
    expect(needsKey({})).toBe(true);
  });
  it("does not ask once the player chose the simulation", () => {
    expect(needsKey({ runtime: "simulation" })).toBe(false);
  });
  it("does not ask when a key is saved for Narthex", () => {
    expect(needsKey({ anthropicApiKey: "sk-ant-x" })).toBe(false);
  });
});
