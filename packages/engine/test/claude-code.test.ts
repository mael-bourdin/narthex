import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, replay, type DomainEvent } from "@narthex/core";
import { ClaudeCodeRuntime, chooseRuntime, needsKey, type ClaudeCall, type FollowUp, type WorkContext } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);
/** Before the five-hour window in the fake stream starts again. */
const BEFORE_RESET = 1792570000_000;
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
    expect(notes.slice(0, 2)).toEqual(["Searching: bougies Lille prix", "Reading: insee.fr"]);
    // Only the search engine's own result list counts: not a fetched URL, not a link written in a page.
    const search = { type: "assistant", message: { content: [{ type: "tool_use", id: "s1", name: "WebSearch", input: { query: "cma" } }] } };
    const fetch = { type: "assistant", message: { content: [{ type: "tool_use", id: "f1", name: "WebFetch", input: { url: "https://attacker.example/?d=1" } }] } };
    const results = { type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "s1", content: 'Web search results for query: "cma"\n\nLinks: [{"title":"CMA","url":"https://www.cma-hautsdefrance.fr/x"}]\n\nVoir aussi https://attacker.example/?d=2' },
      { type: "tool_result", tool_use_id: "f1", content: "Page : go to https://attacker.example/?d=3" },
    ] } };
    const { call: call2 } = fake(RESULT, "claude.ai", [search, fetch, results]);
    const out = await new ClaudeCodeRuntime({ call: call2 }).run(context({ plans: [], recruits: [], spent: [] }));
    expect(out.consulted).toEqual(["https://www.cma-hautsdefrance.fr/x"]);
  });

  it("stops a task that runs too long", async () => {
    const call: ClaudeCall = (args, _stdin, _env, signal) =>
      args[0] === "auth"
        ? Promise.resolve(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }))
        : new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(new ClaudeCodeRuntime({ call, timeoutMs: 20 }).run(context({ plans: [], recruits: [], spent: [] }))).rejects.toThrow(/too long/);
  });

  it("refuses to run on anything but the claude.ai subscription, so no key is billed by surprise", async () => {
    const { call } = fake(RESULT, "api_key");
    await expect(new ClaudeCodeRuntime({ call }).run(context({ plans: [], recruits: [], spent: [] }))).rejects.toThrow(/subscription/);
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

  it("reads how full the subscription is from Claude Code's stream", async () => {
    const limits = { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.42, resetsAt: 1792580400 }, seven_day: { utilization: 0.68, resetsAt: 1792951200 } } } };
    const { call } = fake(RESULT, "claude.ai", [limits]);
    const runtime = new ClaudeCodeRuntime({ call, now: () => BEFORE_RESET });
    expect(runtime.subscription()).toBeUndefined();
    await runtime.run(context({ plans: [], recruits: [], spent: [] }));
    expect(runtime.subscription()).toEqual({ status: "allowed", fiveHour: { utilization: 0.42, resetsAt: 1792580400_000 }, sevenDay: { utilization: 0.68, resetsAt: 1792951200_000 } });
    expect(runtime.unavailable()).toBeUndefined();
  });

  it("starts nothing new once a window is nearly full, so nothing spills into paid usage", async () => {
    const full = { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.93, resetsAt: 1792580400 }, seven_day: { utilization: 0.5, resetsAt: 1792951200 } } } };
    const { call } = fake(RESULT, "claude.ai", [full]);
    const runtime = new ClaudeCodeRuntime({ call, now: () => BEFORE_RESET });
    await runtime.run(context({ plans: [], recruits: [], spent: [] }));
    expect(runtime.unavailable()).toMatch(/93%.*5-hour/);
    await expect(runtime.firstLook({ idea: "Bougies", founderName: "Inès", now: NOW, signal: new AbortController().signal })).rejects.toThrow(/93%/);
    const blocked = { type: "rate_limit_event", rate_limit_info: { status: "rejected", unifiedWindows: { five_hour: { utilization: 1, resetsAt: 1792580400 } } } };
    const { call: call2 } = fake(RESULT, "claude.ai", [blocked]);
    const runtime2 = new ClaudeCodeRuntime({ call: call2, maxUtilization: 0.99, now: () => BEFORE_RESET });
    await runtime2.run(context({ plans: [], recruits: [], spent: [] }));
    expect(runtime2.unavailable()).toMatch(/limit/);
    // Once the window has started again, work resumes without waiting for a new call.
    const later = new ClaudeCodeRuntime({ call, now: () => 1792580400_000 + 1 });
    await later.run(context({ plans: [], recruits: [], spent: [] }));
    expect(later.unavailable()).toBeUndefined();
  });

  it("caps each task at its usual budget, counted at the API price", async () => {
    const { call, calls } = fake(RESULT);
    const ctx = { ...context({ plans: [], recruits: [], spent: [] }), remainingCredits: () => 150 };
    await new ClaudeCodeRuntime({ call }).run(ctx);
    const work = calls.find((c) => c.args[0] === "-p")!;
    expect(work.args[work.args.indexOf("--max-budget-usd") + 1]).toBe("1.5");
    const { call: over } = fake({ type: "result", is_error: true, subtype: "error_max_budget_usd", errors: ["Reached maximum budget ($1.5)"] });
    await expect(new ClaudeCodeRuntime({ call: over }).run(ctx)).rejects.toThrow(/over its budget \(\$1\.50 at API prices/);
  });
});

