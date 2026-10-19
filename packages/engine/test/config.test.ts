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
