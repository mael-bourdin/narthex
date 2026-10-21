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

describe("a key goes to its own provider only", () => {
  it("never sends an OpenRouter or OpenAI key to the address saved for a compatible API", async () => {
    const dir = mkdtempSync(join(tmpdir(), "narthex-prov-"));
    saveProviderKey(dir, "compatible", "local", "http://127.0.0.1:4800/v1");
    saveProviderKey(dir, "openrouter", "sk-or-v1-secret");
    const runtime = makeRuntime(loadConfig(dir), {}) as CompatibleRuntime;
    const urls: string[] = [];
    (runtime as unknown as { call: CompatibleFetch }).call = async (url) => (urls.push(url), { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }], usage: {} }), text: async () => "" });
    await runtime.remark({ speaker: { name: "Léa", role: "recherche" }, author: "Hugo", text: "x", company: "L", signal: new AbortController().signal });
    expect(urls[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(urls.every((u) => u.startsWith("https://openrouter.ai/"))).toBe(true);
    expect(() => new CompatibleRuntime({ provider: "openai", apiKey: "sk-x", baseURL: "http://evil.example/v1" })).not.toThrow();
    const urls2: string[] = [];
    const r2 = new CompatibleRuntime({ provider: "openai", apiKey: "sk-x", baseURL: "http://evil.example/v1", fetch: async (url) => (urls2.push(url), { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: {} }), text: async () => "" }) });
    await r2.remark({ speaker: { name: "Léa", role: "recherche" }, author: "Hugo", text: "x", company: "L", signal: new AbortController().signal });
    expect(urls2[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(urls2.some((u) => u.includes("evil.example"))).toBe(false);
  });
});
