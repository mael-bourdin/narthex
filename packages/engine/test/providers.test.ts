import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseRuntime, CompatibleRuntime, detectProvider, loadConfig, makeRuntime, needsKey, saveProviderKey, verifyKey, type CompatibleFetch } from "../src/index.ts";

describe("any provider's key", () => {
  it("knows the provider from the key", () => {
    expect(detectProvider("sk-ant-api03-x")).toBe("anthropic");
    expect(detectProvider("sk-or-v1-x")).toBe("openrouter");
    expect(detectProvider("sk-proj-x")).toBe("openai");
    expect(detectProvider("sk-x")).toBe("openai");
    expect(detectProvider("hello")).toBeUndefined();
  });

  it("runs the provider whose key the player saved, and never asks again", () => {
    const dir = mkdtempSync(join(tmpdir(), "narthex-prov-"));
    saveProviderKey(dir, "openrouter", "sk-or-v1-abc");
    const config = loadConfig(dir);
    expect(chooseRuntime(config, {})).toBe("openrouter");
    expect(needsKey(config, {})).toBe(false);
    expect(makeRuntime(config, {})).toBeInstanceOf(CompatibleRuntime);
    // An exported Anthropic key is still never used by surprise.
    expect(chooseRuntime({}, { ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("none");
  });

  it("checks an OpenRouter or OpenAI key with a call that costs nothing", async () => {
    const seen: string[] = [];
    const ok: CompatibleFetch = async (url) => (seen.push(url), { ok: true, status: 200, json: async () => ({}), text: async () => "" });
    expect(await verifyKey(" sk-or-v1-abc ", { fetch: ok })).toEqual({ ok: true, key: "sk-or-v1-abc", provider: "openrouter" });
    expect(await verifyKey("sk-proj-abc", { fetch: ok })).toMatchObject({ ok: true, provider: "openai" });
    expect(seen).toEqual(["https://openrouter.ai/api/v1/key", "https://api.openai.com/v1/models"]);
    const no: CompatibleFetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => "" });
    expect(await verifyKey("sk-or-v1-bad", { fetch: no })).toMatchObject({ ok: false });
    expect(await verifyKey("bonjour")).toMatchObject({ ok: false });
  });
});
