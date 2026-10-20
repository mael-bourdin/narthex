import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { role, ROLES, type FirstLook, type RoleId } from "@narthex/core";
import { brief, companySheet, DEFAULT_MODEL, FACTS_SCHEMA, FACTS_SYSTEM, factsFrom, factsPrompt, MEMORY_MODEL, firstLookFrom, firstLookPrompt, firstLookSystem, identity, parseDeliverable, parseFollowUp } from "./anthropic.ts";
import type { AgentRuntime, FactsInput, FactsResult, WorkContext, WorkResult } from "./runtime.ts";

/**
 * DEVELOPMENT ONLY. The developer's own Claude Code (`claude -p`), on their own claude.ai subscription,
 * to test Narthex without an API key. Anthropic does not allow third-party products to offer claude.ai
 * login or its rate limits: this is never offered to players, only chosen with NARTHEX_RUNTIME=claude-code.
 *
 * One `claude -p` per task. Claude Code has no Narthex tools: the agent returns everything at once,
 * as structured output (its post, deliverable, follow-ups, recruits, company sheet).
 */

/** Runs `claude` with these arguments and stdin, returns stdout, each line as it comes. Injected in tests. */
export type ClaudeCall = (args: string[], stdin: string, env: NodeJS.ProcessEnv, signal?: AbortSignal, onLine?: (line: string) => void) => Promise<string>;

export interface ClaudeCodeRuntimeOptions {
  call?: ClaudeCall;
  model?: string;
  models?: Partial<Record<RoleId, string>>;
  /** Claude Code has no turn limit: a task that runs longer is stopped. 20 minutes by default. */
  timeoutMs?: number;
}

const ROLE_IDS = ROLES.map((r) => r.id);

export class ClaudeCodeRuntime implements AgentRuntime {
  readonly name = "claude-code" as const;
  private readonly call: ClaudeCall;
  private readonly model: string;
  private readonly chosen: string | undefined;
  private readonly models: Partial<Record<RoleId, string>>;
  private readonly timeoutMs: number;
  private checked?: Promise<void>;

  constructor(options: ClaudeCodeRuntimeOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 20 * 60_000;
    this.call = options.call ?? runClaude;
    this.model = options.model ?? DEFAULT_MODEL;
    this.chosen = options.model;
    this.models = options.models ?? {};
  }

  async firstLook(input: { idea: string; founderName: string; now: number; signal: AbortSignal }): Promise<FirstLook> {
    const out = await this.ask(
      { system: firstLookSystem(), prompt: firstLookPrompt(input), schema: FIRST_LOOK_SCHEMA, model: this.model, effort: "low", web: true },
      input.signal,
      () => {},
    );
    return { ...firstLookFrom(out.value), simulated: false, usage: out.usage };
  }

  async extractFacts(input: FactsInput): Promise<FactsResult> {
    const out = await this.ask(
      { system: FACTS_SYSTEM, prompt: factsPrompt(input), schema: FACTS_SCHEMA, model: MEMORY_MODEL, effort: "low", web: false },
      input.signal,
      () => {},
    );
    return { ...factsFrom(out.value), usage: out.usage };
  }

  async run(ctx: WorkContext): Promise<WorkResult> {
    const def = role(ctx.agent.role);
    const cofounder = ctx.agent.role === "cofondateur";
    const out = await this.ask(
      {
        system: `${identity(def, ctx.agent.name)}\n\n${HOW_TO_ANSWER}\n\n${companySheet(ctx)}`,
        prompt: brief(ctx),
        schema: workSchema(cofounder),
        model: this.models[ctx.agent.role] ?? this.chosen ?? def.model,
        effort: def.effort,
        web: def.tools.includes("web_search") || def.tools.includes("web_fetch"),
      },
      ctx.signal,
      (note) => ctx.progress(note),
    );
    ctx.spend(out.usage);
    const v = (out.value ?? {}) as Record<string, unknown>;
    for (const f of list(v.followups)) {
      try {
        ctx.plan(parseFollowUp(f));
      } catch {}
    }
    if (cofounder) for (const r of list(v.recruits)) if (typeof r.role === "string" && typeof r.why === "string") ctx.recruit(r.role as RoleId, r.why);
    const deliverable = v.deliverable && typeof v.deliverable === "object" ? parseDeliverable(v.deliverable as Record<string, unknown>) : undefined;
    if (deliverable) ctx.progress(`Livrable prêt : ${deliverable.title}`);
    const post = typeof v.post === "string" && v.post.trim() ? v.post.trim() : `C'est fait : ${ctx.task.title}.`;
    return { post, consulted: out.consulted, ...(deliverable ? { deliverable } : {}), ...(cofounder && typeof v.memory === "string" && v.memory.trim() ? { memory: v.memory } : {}) };
  }

  private async ask(
    q: { system: string; prompt: string; schema: object; model: string; effort: string; web: boolean },
    signal: AbortSignal,
    progress: (note: string) => void,
  ): Promise<{ value: unknown; usage: NonNullable<WorkResult["usage"]>; consulted: string[] }> {
    await (this.checked ??= this.checkSubscription());
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--json-schema", JSON.stringify(q.schema),
      "--system-prompt", q.system,
      "--model", q.model,
      "--effort", q.effort,
      // Only the web: no files, no shell, no MCP, none of the developer's settings or memory.
      "--tools", q.web ? "WebSearch,WebFetch" : "",
      ...(q.web ? ["--allowedTools", "WebSearch", "WebFetch"] : []),
      "--setting-sources", "",
      "--strict-mcp-config",
      "--no-session-persistence",
    ];
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const consulted = new Set<string>();
    let raw: string;
    try {
      raw = await this.call(args, q.prompt, subscriptionEnv(), AbortSignal.any([signal, timeout]), (line) => {
        const note = progressOf(line);
        if (note) progress(note);
        for (const url of consultedOf(line)) consulted.add(url);
      });
    } catch (e) {
      if (timeout.aborted && !signal.aborted) throw new Error(`Arrêtée : la tâche a duré trop longtemps (plus de ${Math.round(this.timeoutMs / 60_000)} min).`);
      throw e;
    }
    const last = raw.trim().split("\n").filter((l) => l.includes('"type":"result"')).pop() ?? raw;
    const out = JSON.parse(last) as { is_error?: boolean; result?: string; structured_output?: unknown; usage?: Record<string, number> };
    if (out.is_error) throw new Error(out.result || "Claude Code a échoué.");
    if (out.structured_output === undefined) throw new Error("Réponse inattendue de Claude Code.");
    const u = out.usage ?? {};
    // Covered by the subscription: tokens are kept, no dollar is spent.
    const usage = {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      credits: 0,
    };
    return { value: out.structured_output, usage, consulted: [...consulted] };
  }

  /** A key configured in Claude Code itself would be billed: only the claude.ai subscription is accepted. */
  private async checkSubscription(): Promise<void> {
    let auth: { loggedIn?: boolean; authMethod?: string } = {};
    try {
      auth = JSON.parse(await this.call(["auth", "status"], "", subscriptionEnv())) as typeof auth;
    } catch {
      throw new Error("Claude Code introuvable : installe-le et connecte-toi (« claude », puis /login).");
    }
    if (!auth.loggedIn || auth.authMethod !== "claude.ai") {
      this.checked = undefined;
      throw new Error(`Claude Code n'utilise pas ton abonnement claude.ai (${auth.authMethod ?? "non connecté"}) : « claude » puis /login.`);
    }
  }
}

/** The developer's environment without anything that would make Claude Code bill an API key. */
function subscriptionEnv(): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _key, ANTHROPIC_AUTH_TOKEN: _token, ...env } = process.env;
  return env;
}

/** « Je cherche : … » / « Je lis : … » from Claude Code's stream, for the Fil and the Bureau. */
function progressOf(line: string): string | undefined {
  if (!line.includes('"tool_use"')) return undefined;
  try {
    const event = JSON.parse(line) as { type?: string; message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] } };
    const use = event.type === "assistant" ? event.message?.content?.find((c) => c.type === "tool_use") : undefined;
    if (use?.name === "WebSearch" && typeof use.input?.query === "string") return `Je cherche : ${use.input.query}`;
    if (use?.name === "WebFetch" && typeof use.input?.url === "string") {
      try {
        return `Je lis : ${new URL(use.input.url).hostname.replace(/^www\./, "")}`;
      } catch {}
    }
  } catch {}
  return undefined;
}

/** Pages really read: fetched URLs, and the links search results returned (only these get checked). */
function consultedOf(line: string): string[] {
  if (!line.includes("WebFetch") && !line.includes("tool_result")) return [];
  try {
    const event = JSON.parse(line) as { type?: string; message?: { content?: { type: string; name?: string; input?: Record<string, unknown>; content?: unknown }[] } };
    const urls: string[] = [];
    for (const c of event.message?.content ?? []) {
      if (event.type === "assistant" && c.type === "tool_use" && c.name === "WebFetch" && typeof c.input?.url === "string") urls.push(c.input.url);
      if (event.type === "user" && c.type === "tool_result") urls.push(...(JSON.stringify(c.content ?? "").match(/https?:\/\/[^\s"'<>\\)\]]+/g) ?? []));
    }
    return urls;
  } catch {
    return [];
  }
}

function list(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

const runClaude: ClaudeCall = (args, stdin, env, signal, onLine) =>
  new Promise((resolve, reject) => {
    // Run away from any project, so no CLAUDE.md or local settings leak into the agents.
    const child = spawn(process.env.NARTHEX_CLAUDE_BIN || "claude", args, { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "pipe"], ...(signal ? { signal } : {}) });
    let out = "";
    let err = "";
    let pending = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d;
      pending += d;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) onLine?.(line);
    });
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e) => reject(signal?.aborted ? new Error("Annulée") : e));
    child.on("close", (code) => (out.trim() ? resolve(out) : reject(new Error(err.trim() || `claude s'est arrêté (${code}).`))));
    child.stdin.end(stdin);
  });

const HOW_TO_ANSWER = [
  "Ici, tu n'as pas les outils publish_deliverable, plan_task, recruit ni update_memory : tu rends tout d'un coup, dans ta réponse structurée.",
  "- post : ton court message pour le Fil.",
  "- deliverable : ce que tu publierais avec publish_deliverable (Markdown, sources datées), ou rien.",
  "- followups : les tâches que tu prévoirais avec plan_task.",
  "- recruits et memory : seulement si tu es la co-fondatrice.",
].join("\n");

const SOURCE = { type: "object", required: ["title", "url", "checkedAt"], properties: { title: { type: "string" }, url: { type: "string" }, checkedAt: { type: "string" } } };

function workSchema(cofounder: boolean): object {
  return {
    type: "object",
    required: ["post"],
    properties: {
      post: { type: "string" },
      deliverable: {
        type: "object",
        required: ["title", "summary", "body", "sources"],
        properties: { title: { type: "string" }, summary: { type: "string" }, body: { type: "string" }, sources: { type: "array", items: SOURCE } },
      },
      followups: {
        type: "array",
        items: {
          type: "object",
          required: ["title", "why", "kind", "in_hours", "assignee"],
          properties: {
            title: { type: "string" },
            why: { type: "string" },
            kind: { type: "string", enum: ["internal", "external"] },
            in_hours: { type: "number" },
            assignee: { type: "string", enum: ["self", ...ROLE_IDS] },
          },
        },
      },
      ...(cofounder
        ? {
            recruits: {
              type: "array",
              items: { type: "object", required: ["role", "why"], properties: { role: { type: "string", enum: ROLE_IDS.filter((r) => r !== "cofondateur") }, why: { type: "string" } } },
            },
            memory: { type: "string" },
          }
        : {}),
    },
  };
}

const PICK = { type: "object", required: ["role", "why"], properties: { role: { type: "string", enum: ROLE_IDS }, why: { type: "string" } } };
const FIRST_LOOK_SCHEMA = {
  type: "object",
  required: ["reaction", "findings", "team", "later"],
  properties: {
    reaction: { type: "string" },
    findings: { type: "array", items: { type: "object", required: ["text", "source"], properties: { text: { type: "string" }, source: { type: "string" } } } },
    team: { type: "array", items: PICK },
    later: { type: "array", items: PICK },
  },
};
