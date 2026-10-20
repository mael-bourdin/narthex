import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, replay, type DomainEvent } from "@narthex/core";
import { ClaudeCodeRuntime, chooseRuntime, needsKey, type ClaudeCall, type FollowUp, type WorkContext } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);
const events: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  { type: "agent.hired", reason: "", agent: { id: "m", name: "Margaux", role: "cofondateur", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
  { type: "task.planned", task: { id: "t", agentId: "m", title: "Étude de marché", why: "Savoir", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
];

function context(log: { plans: FollowUp[]; recruits: string[]; spent: number[] }): WorkContext {
  const state = replay(events);
  return {
    state,
    agent: state.agents["m"]!,
    task: state.tasks["t"]!,
    now: NOW,
    signal: new AbortController().signal,
    progress: () => {},
    plan: (f) => (log.plans.push(f), null),
    spend: (u) => void log.spent.push(u.inputTokens),
    recruit: (role) => (log.recruits.push(role), null),
  };
}

const RESULT = {
  type: "result",
  is_error: false,
  usage: { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: 5, output_tokens: 20 },
  structured_output: {
    post: "J'ai fini l'étude.",
    deliverable: { title: "Étude", summary: "Une phrase.", body: "## Marché\nIl existe.", sources: [{ title: "INSEE", url: "https://insee.fr", checkedAt: "2026-10-19" }] },
    followups: [{ title: "Contacter des boutiques", why: "Tester", kind: "external", in_hours: 2, assignee: "self" }],
    recruits: [{ role: "recherche", why: "Creuser" }],
    memory: "Bougies à Lille.",
  },
};

function fake(output: object, auth = "claude.ai", stream: object[] = []) {
  const calls: { args: string[]; stdin: string; env: NodeJS.ProcessEnv }[] = [];
  const call: ClaudeCall = async (args, stdin, env, _signal, onLine) => {
    calls.push({ args, stdin, env });
    if (args[0] === "auth") return JSON.stringify({ loggedIn: true, authMethod: auth });
    const lines = [...stream, output].map((o) => JSON.stringify(o));
    for (const l of lines) onLine?.(l);
    return lines.join("\n");
  };
  return { call, calls };
}

describe("ClaudeCodeRuntime (dev only: the developer's own Claude Code)", () => {
  it("runs a task through claude -p, without the API key, and brings back the work", async () => {
    const { call, calls } = fake(RESULT);
    const log = { plans: [] as FollowUp[], recruits: [] as string[], spent: [] as number[] };
    const result = await new ClaudeCodeRuntime({ call }).run(context(log));

    const work = calls.find((c) => c.args[0] === "-p")!;
    expect(work.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(work.args).toContain("--json-schema");
    expect(work.args[work.args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(work.args[work.args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(work.stdin).toContain("Étude de marché");

    expect(result.post).toBe("J'ai fini l'étude.");
    expect(result.deliverable).toMatchObject({ title: "Étude", sources: [{ title: "INSEE", url: "https://insee.fr" }] });
    expect(result.memory).toBe("Bougies à Lille.");
    expect(log.plans).toEqual([{ title: "Contacter des boutiques", why: "Tester", kind: "external", inHours: 2 }]);
    expect(log.recruits).toEqual(["recherche"]);
    expect(log.spent).toEqual([100]);
  });

  it("tells the Fil what the agent is looking up, live", async () => {
    const notes: string[] = [];
    const tool = (name: string, input: object) => ({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
    const { call } = fake(RESULT, "claude.ai", [tool("WebSearch", { query: "bougies Lille prix" }), tool("WebFetch", { url: "https://www.insee.fr/fr/stat" })]);
    const ctx = { ...context({ plans: [], recruits: [], spent: [] }), progress: (n: string) => void notes.push(n) };
    await new ClaudeCodeRuntime({ call }).run(ctx);
    expect(notes.slice(0, 2)).toEqual(["Je cherche : bougies Lille prix", "Je lis : insee.fr"]);
    const { call: call2 } = fake(RESULT, "claude.ai", [tool("WebFetch", { url: "https://www.insee.fr/fr/stat" }), { type: "user", message: { content: [{ type: "tool_result", content: "Links: [{\"url\":\"https://www.cma-hautsdefrance.fr/x\"}]" }] } }]);
    const out = await new ClaudeCodeRuntime({ call: call2 }).run(context({ plans: [], recruits: [], spent: [] }));
    expect(out.consulted).toEqual(["https://www.insee.fr/fr/stat", "https://www.cma-hautsdefrance.fr/x"]);
  });

  it("stops a task that runs too long", async () => {
    const call: ClaudeCall = (args, _stdin, _env, signal) =>
      args[0] === "auth"
        ? Promise.resolve(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }))
        : new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(new ClaudeCodeRuntime({ call, timeoutMs: 20 }).run(context({ plans: [], recruits: [], spent: [] }))).rejects.toThrow(/trop longtemps/);
  });

  it("refuses to run on anything but the claude.ai subscription, so no key is billed by surprise", async () => {
    const { call } = fake(RESULT, "api_key");
    await expect(new ClaudeCodeRuntime({ call }).run(context({ plans: [], recruits: [], spent: [] }))).rejects.toThrow(/abonnement/);
  });

  it("reports Claude Code's own error", async () => {
    const { call } = fake({ type: "result", is_error: true, result: "Rate limit reached" });
    await expect(new ClaudeCodeRuntime({ call }).run(context({ plans: [], recruits: [], spent: [] }))).rejects.toThrow("Rate limit reached");
  });

  it("does the first look the same way", async () => {
    const { call } = fake({
      type: "result",
      is_error: false,
      usage: { input_tokens: 1, output_tokens: 1 },
      structured_output: { reaction: "J'adore.", findings: [{ text: "312 boutiques", source: "INSEE" }], team: [{ role: "recherche", why: "Marché" }], later: [] },
    });
    const look = await new ClaudeCodeRuntime({ call }).firstLook({ idea: "Bougies", founderName: "Inès", now: NOW, signal: new AbortController().signal });
    expect(look).toMatchObject({ reaction: "J'adore.", findings: [{ text: "312 boutiques", source: "INSEE" }], team: [{ role: "recherche" }], simulated: false });
  });

  it("is chosen only from the environment, never from the saved config", () => {
    expect(chooseRuntime({}, { NARTHEX_RUNTIME: "claude-code" })).toBe("claude-code");
    expect(chooseRuntime({ runtime: "claude-code" } as never, {})).toBe("none");
    expect(needsKey({}, { NARTHEX_RUNTIME: "claude-code" })).toBe(false);
  });
});
