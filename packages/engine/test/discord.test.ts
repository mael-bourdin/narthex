import { describe, expect, it } from "vitest";
import { DiscordApi, DiscordBridge, Host, MemoryEventStore, SimulatedClock, SimulationRuntime, setupCompany, type AgentRuntime, type DiscordCompanySetup } from "../src/index.ts";

const START = Date.UTC(2026, 9, 20, 7);

/** A tiny fake of the Discord REST API: channels, webhooks, messages, reactions, threads. */
function fakeDiscord() {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let n = 0;
  let limited = 1;
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const path = url.replace("https://discord.com/api/v10", "");
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method: init.method, path, ...(body ? { body } : {}) });
    const json = (status: number, value: unknown) => ({ ok: status < 300, status, json: async () => value, headers: { get: () => null } });
    if (path.startsWith("/webhooks/") && limited-- > 0) return json(429, { retry_after: 0.001 });
    if (init.method === "POST" && /^\/guilds\/\w+\/channels$/.test(path)) return json(201, { id: `ch${++n}` });
    if (init.method === "POST" && /\/webhooks$/.test(path)) return json(201, { id: `wh${++n}`, token: `tok${n}` });
    if (init.method === "POST" && path.startsWith("/webhooks/")) return json(200, { id: `msg${++n}`, channel_id: "chX" });
    if (init.method === "POST" && /\/threads$/.test(path)) return json(201, { id: `th${++n}` });
    if (init.method === "PUT") return json(204, null);
    if (init.method === "GET" && path === "/users/@me") return json(200, { id: "bot", username: "Narthex" });
    return json(404, { message: "Unknown" });
  };
  return { api: new DiscordApi("token", { fetch, sleep: async () => {} }), calls };
}

describe("Discord", () => {
  it("creates a category for the company with its channels and a webhook in each", async () => {
    const { api, calls } = fakeDiscord();
    const setup = await setupCompany(api, "g1", "Maison Lumen");
    const created = calls.filter((c) => c.method === "POST" && c.path === "/guilds/g1/channels").map((c) => c.body);
    expect(created[0]).toMatchObject({ name: "Maison Lumen", type: 4 });
    expect(created.slice(1).map((b) => b!.name)).toEqual(["général", "décisions", "recherche", "juridique-et-compta", "ventes-et-com"]);
    expect(created.slice(1).every((b) => b!.parent_id === setup.categoryId && b!.type === 0)).toBe(true);
    expect(Object.keys(setup.channels)).toEqual(["general", "decisions", "recherche", "juridique", "ventes"]);
    expect(setup.channels.recherche.webhookToken).toMatch(/^tok/);
  });

  it("posts each agent under its own name and face, never pings anyone, reacts, and lets a colleague answer in a thread", async () => {
    const { api, calls } = fakeDiscord();
    const remarks: string[] = [];
    const sim = new SimulationRuntime();
    const runtime: AgentRuntime = {
      name: "simulation",
      firstLook: sim.firstLook.bind(sim),
      run: async () => ({ post: "J'ai fini l'étude @everyone.", deliverable: { title: "Étude de marché", summary: "Cinq bougiers à Lille.", body: "…", sources: [] } }),
      remark: async (input) => (remarks.push(input.author), { text: "Bien vu, je m'en sers pour le plan.", usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, credits: 1 } }),
    };
    const host = new Host({ store: new MemoryEventStore(), runtime, clock: new SimulatedClock(START) });
    const setups: Record<string, DiscordCompanySetup> = {};
    const bridge = new DiscordBridge({ host, api, guildId: "g1", setups, save: (id, s) => void (setups[id] = s) });
    bridge.start();
    await host.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    for (let i = 0; i < 6; i++) {
      host.tick();
      await host.idle();
      await bridge.idle();
    }
    const posts = calls.filter((c) => c.method === "POST" && c.path.startsWith("/webhooks/") && c.body?.content);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => JSON.stringify(p.body!.allowed_mentions) === JSON.stringify({ parse: [] }))).toBe(true);
    const study = posts.find((p) => String(p.body!.content).includes("Étude de marché") && !String(p.path).includes("thread_id"))!;
    expect(study.body).toMatchObject({ username: expect.any(String), avatar_url: expect.stringMatching(/\/portraits\/[a-z]+\.jpg$/) });
    expect(calls.some((c) => c.method === "PUT" && c.path.includes(encodeURIComponent("📄")))).toBe(true);
    const reply = posts.find((p) => p.path.includes("thread_id="))!;
    expect(reply.body).toMatchObject({ content: "Bien vu, je m'en sers pour le plan." });
    expect(remarks.length).toBeGreaterThan(0);
    // The remark is paid like any work: it counts in the AI spend.
    expect(host.getState().usage.credits).toBeGreaterThan(0);
    bridge.stop();
  });
});

describe("remarks", () => {
  const input = { speaker: { name: "Margaux", role: "cofondateur" as const }, author: "Léa", text: "J'ai fini l'étude.\n> **Étude** · Cinq bougiers.", company: "Maison Lumen", signal: new AbortController().signal };

  it("are written by Haiku on the API, short, in the colleague's voice", async () => {
    const { AnthropicRuntime } = await import("../src/index.ts");
    const calls: Record<string, unknown>[] = [];
    const client = { beta: { messages: { create: async (p: Record<string, unknown>) => (calls.push(p), { stop_reason: "end_turn", model: "claude-haiku-5-5", usage: { input_tokens: 50, output_tokens: 20 }, content: [{ type: "text", text: "Merci Léa, je cale le plan dessus." }] }) } } } as never;
    const out = await new AnthropicRuntime({ client }).remark(input);
    expect(calls[0]).toMatchObject({ model: "claude-haiku-5-5" });
    expect(String(calls[0]!.system)).toContain("Margaux");
    expect(out.text).toBe("Merci Léa, je cale le plan dessus.");
    expect(out.usage.credits).toBeGreaterThan(0);
  });

  it("go through Claude Code in development", async () => {
    const { ClaudeCodeRuntime } = await import("../src/index.ts");
    const call = async (args: string[]) => JSON.stringify(args[0] === "auth" ? { loggedIn: true, authMethod: "claude.ai" } : { type: "result", is_error: false, usage: {}, structured_output: { text: "Top." } });
    expect((await new ClaudeCodeRuntime({ call }).remark(input)).text).toBe("Top.");
  });
});
