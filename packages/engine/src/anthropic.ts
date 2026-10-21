import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_BY_LEVEL, fmt, recallFacts, role, ROLES, type Lesson, type FirstLook, type Finding, type RoleDef, type RoleId, type Source, type TaskKind, type TeamPick } from "@narthex/core";
import { searchCompanies, type CompanySearch } from "./connectors/entreprises.ts";
import type { AgentRuntime, ConsolidationInput, ConsolidationResult, ReflectionInput, ReflectionResult, RemarkInput, RemarkResult, FactsInput, FactsResult, FollowUp, WorkContext, WorkResult } from "./runtime.ts";

type Tool = Anthropic.Beta.BetaToolUnion;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface AnthropicRuntimeOptions {
  apiKey?: string;
  model?: string;
  /** A model per role (Settings · API and models); `model` for the others. */
  models?: Partial<Record<RoleId, string>>;
  /** Hard cap on model turns per task, so a confused agent cannot loop forever. */
  maxTurns?: number;
  client?: Anthropic;
  /** The API Recherche d'entreprises; injected in tests. */
  companies?: typeof searchCompanies;
}

/** USD per million tokens, used to convert usage into credits (1 credit = 0.01 USD). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export const DEFAULT_MODEL = "claude-opus-5-5";

/** A model we do not know the price of is counted dear: overestimating stops early, underestimating overspends. */
const UNKNOWN_PRICE = { input: 15, output: 75, cacheRead: 1.5 };
/** Anthropic charges $10 per 1,000 web searches: one cent each. */
const WEB_SEARCH_CREDITS = 1;

/**
 * Real agents, on the Messages API with the player's own key.
 * Each role gets a stable, cached prefix (tools → identity and rules → company sheet),
 * then the task. The agent's final text is its post in the Fil.
 */
export class AnthropicRuntime implements AgentRuntime {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;
  private readonly model: string;
  /** The model chosen for everyone ("narthex config modele"), over each role's default. */
  private readonly chosen: string | undefined;
  private readonly models: Partial<Record<RoleId, string>>;
  private readonly maxTurns: number;
  private readonly companies: typeof searchCompanies;

  constructor(options: AnthropicRuntimeOptions = {}) {
    // The player's key goes to Anthropic only: no gateway or extra token picked up from the environment.
    this.client = options.client ?? new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), baseURL: "https://api.anthropic.com", authToken: null });
    this.model = options.model ?? DEFAULT_MODEL;
    this.chosen = options.model;
    this.models = options.models ?? {};
    this.maxTurns = options.maxTurns ?? 12;
    this.companies = options.companies ?? searchCompanies;
  }

  async firstLook(input: { idea: string; founderName: string; now: number; signal: AbortSignal }): Promise<FirstLook> {
    // No forced JSON format: web search always cites, and the two cannot be combined. We ask for JSON instead.
    const response = await this.client.beta.messages.create(
      {
        model: this.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: firstLookSystem(),
        // Searches launched from the tool's own code each count as a use: leave room, ask for few.
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
        messages: [{ role: "user", content: firstLookPrompt(input) }],
      },
      { signal: input.signal },
    );
    if (response.stop_reason === "refusal") throw new Error("Claude refused.");
    if (response.stop_reason === "max_tokens" || response.stop_reason === "pause_turn") throw new Error("Incomplete answer.");
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
    addUsage(usage, response.usage, response.model || this.model);
    return { ...parseFirstLook(response.content), simulated: false, usage };
  }

  async extractFacts(input: FactsInput): Promise<FactsResult> {
    const response = await this.client.beta.messages.create(
      {
        model: MEMORY_MODEL,
        max_tokens: 4000,
        system: FACTS_SYSTEM,
        tools: [RECORD_FACTS],
        tool_choice: { type: "tool", name: "record_facts" },
        messages: [{ role: "user", content: factsPrompt(input) }],
      },
      { signal: input.signal },
    );
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
    addUsage(usage, response.usage, MEMORY_MODEL);
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "record_facts");
    return { ...factsFrom(call?.input), usage };
  }

  async remark(input: RemarkInput): Promise<RemarkResult> {
    const response = await this.client.beta.messages.create(
      { model: MEMORY_MODEL, max_tokens: 300, system: remarkSystem(input), messages: [{ role: "user", content: input.text }] },
      { signal: input.signal },
    );
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
    addUsage(usage, response.usage, response.model || MEMORY_MODEL);
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
    return { text, usage };
  }

  async reflect(input: ReflectionInput): Promise<ReflectionResult> {
    const response = await this.client.beta.messages.create(
      {
        model: MEMORY_MODEL,
        max_tokens: 2000,
        system: REFLECT_SYSTEM,
        tools: [UPDATE_PLAYBOOK],
        tool_choice: { type: "tool", name: "update_playbook" },
        messages: [{ role: "user", content: reflectPrompt(input) }],
      },
      { signal: input.signal },
    );
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
    addUsage(usage, response.usage, response.model || MEMORY_MODEL);
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "update_playbook");
    return { ...reflectionFrom(call?.input), usage };
  }

  async consolidateFacts(input: ConsolidationInput): Promise<ConsolidationResult> {
    const response = await this.client.beta.messages.create(
      {
        model: MEMORY_MODEL,
        max_tokens: 8000,
        system: TIDY_SYSTEM,
        tools: [TIDY_FACTS],
        tool_choice: { type: "tool", name: "tidy_facts" },
        messages: [{ role: "user", content: tidyPrompt(input) }],
      },
      { signal: input.signal },
    );
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
    addUsage(usage, response.usage, response.model || MEMORY_MODEL);
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "tidy_facts");
    return { ...tidyFrom(call?.input), usage };
  }

  async run(ctx: WorkContext): Promise<WorkResult> {
    const def = role(ctx.agent.role);
    // The founder's choice wins; otherwise the level the agent chose for this task, else the role's own model.
    const model = this.models[ctx.agent.role] ?? this.chosen ?? (ctx.task.level ? CLAUDE_BY_LEVEL[ctx.task.level] : def.model);
    const tools = toolsFor(def);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: identity(def, ctx.agent.name, ctx.state.playbooks?.[ctx.agent.role]) },
      { type: "text", text: companySheet(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    const messages: MessageParam[] = [{ role: "user", content: brief(ctx) }];
    let deliverable: WorkResult["deliverable"];
    let memory: string | undefined;
    const consulted = new Set<string>();
    const work: ToolWork = {
      ctx,
      consulted,
      companies: this.companies,
      deliver: (d) => (deliverable = d),
      remember: (m) => (memory = m),
    };

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (ctx.signal.aborted) throw new Error("Cancelled");
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: maxTokensFor(model, ctx.remainingCredits?.()),
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: def.effort },
          // Each turn re-reads the whole conversation (search results included): cache it, so the
          // next turn reads it at a twentieth of the price instead of paying for it again.
          cache_control: { type: "ephemeral" },
          system,
          tools,
          messages,
        },
        { signal: ctx.signal },
      );
      const response = await stream.finalMessage();
      // Counted at once by the engine, which stops the task past its budget.
      const turn = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
      addUsage(turn, response.usage, response.model || model);
      ctx.spend(turn);
      if (ctx.signal.aborted) throw new Error("Budget reached.");

      if (response.stop_reason === "refusal") throw new Error("Claude refused this task.");
      if (response.stop_reason === "max_tokens") throw new Error("Answer too long, cut off.");
      for (const url of consultedUrls(response.content)) consulted.add(url);
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "pause_turn") continue;

      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (calls.length === 0) {
        const post = response.content
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("\n")
          .trim();
        return { post: (post || `Done: ${ctx.task.title}.`).slice(0, MAX_POST_CHARS), deliverable, memory, consulted: [...consulted] };
      }

      // All results go back in a single user message, so parallel tool use keeps working.
      const results: ToolResult[] = await Promise.all(
        calls.map(async (call): Promise<ToolResult> => {
          const out = await useTool(call.name, call.input as Record<string, unknown>, work);
          return out.ok ? ok(call.id, out.content) : error(call.id, out.content);
        }),
      );
      messages.push({ role: "user", content: results });
    }
    throw new Error(`Not finished after ${this.maxTurns} turns.`);
  }
}

/** What a Narthex tool needs to act on a task, whatever the model provider. */
export interface ToolWork {
  ctx: WorkContext;
  consulted: Set<string>;
  companies: typeof searchCompanies;
  deliver(d: NonNullable<WorkResult["deliverable"]>): void;
  remember(memory: string): void;
}

/** Runs one of Narthex's own tools for an agent. Every input is checked again here. */
export async function useTool(name: string, input: Record<string, unknown>, w: ToolWork): Promise<{ ok: boolean; content: string }> {
  const { ctx } = w;
  try {
    switch (name) {
      case "search_companies": {
        const search: CompanySearch = {};
        for (const k of ["q", "code_postal", "departement", "activite_principale"] as const) if (typeof input[k] === "string") search[k] = input[k] as string;
        const found = await w.companies(search, { signal: ctx.signal });
        // Sheets built from the official SIREN: real pages, safe to check later.
        for (const hit of found.results) w.consulted.add(hit.fiche);
        ctx.progress(`Searching the company registry: ${search.q ?? search.activite_principale ?? search.code_postal ?? search.departement}`);
        return { ok: true, content: JSON.stringify(found) };
      }
      case "publish_deliverable": {
        const deliverable = parseDeliverable(input);
        w.deliver(deliverable);
        ctx.progress(`Deliverable ready: ${deliverable.title}`);
        return { ok: true, content: "Deliverable saved. Finish with your message for the Feed." };
      }
      case "plan_task": {
        const refused = ctx.plan(parseFollowUp(input));
        return refused ? { ok: false, content: refused } : { ok: true, content: "Task planned." };
      }
      case "post_progress":
        ctx.progress(requireString(input, "note"));
        return { ok: true, content: "Noted." };
      case "recruit": {
        const refused = ctx.recruit(requireString(input, "role") as RoleId, requireString(input, "why"));
        return refused ? { ok: false, content: refused } : { ok: true, content: "Recruited: they start right away." };
      }
      case "update_memory": {
        // Read by every agent on every turn: a long or injected sheet would steer and cost forever.
        const next = requireString(input, "memory");
        if (next.length > MAX_MEMORY_CHARS) return { ok: false, content: `Too long (${next.length} characters): 300 words, ${MAX_MEMORY_CHARS} characters at most.` };
        w.remember(next);
        return { ok: true, content: "Company sheet updated." };
      }
      default:
        return { ok: false, content: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, content: e instanceof Error ? e.message : String(e) };
  }
}

const MAX_MEMORY_CHARS = 2500;
export const MAX_POST_CHARS = 2000;
const MAX_SOURCES = 40;

/**
 * Pages the search engine itself returned. Only these are ever checked by Narthex: a fetched URL
 * was chosen by the model (and so by whatever text it read), a search result was not.
 */
export function consultedUrls(content: readonly unknown[]): string[] {
  const urls: string[] = [];
  for (const block of content as { type?: string; content?: unknown }[]) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const item of block.content as { type?: string; url?: unknown }[]) if (item?.type === "web_search_result" && typeof item.url === "string") urls.push(item.url);
  }
  return urls;
}

function ok(id: string, content: string): ToolResult {
  return { type: "tool_result", tool_use_id: id, content };
}

function error(id: string, content: string): ToolResult {
  return { type: "tool_result", tool_use_id: id, content, is_error: true };
}

/** A turn's output never costs more than what is left of the task's and the day's budget. */
export function maxTokensFor(model: string, remainingCredits: number | undefined): number {
  if (remainingCredits === undefined) return 64000;
  const price = PRICES[model] ?? UNKNOWN_PRICE;
  const affordable = Math.floor(((Math.max(0, remainingCredits) / 100) * 1_000_000) / price.output);
  return Math.min(64000, Math.max(1024, affordable));
}

type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  server_tool_use?: { web_search_requests?: number | null } | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
};

/**
 * Credits (1 = $0.01) for one call, each kind of token at its real price:
 * fresh input, cache writes (×1.25 for 5 min, ×2 for 1 h), cache reads, output.
 */
export function creditsFor(model: string, u: UsageLike): number {
  const price = PRICES[model] ?? UNKNOWN_PRICE;
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? (u.cache_creation ? 0 : (u.cache_creation_input_tokens ?? 0));
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const usd =
    (u.input_tokens * price.input +
      write5m * price.input * 1.25 +
      write1h * price.input * 2 +
      (u.cache_read_input_tokens ?? 0) * price.cacheRead +
      u.output_tokens * price.output) /
    1_000_000;
  return Math.ceil(usd * 100 - 1e-9) + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_CREDITS;
}

export function addUsage(total: NonNullable<WorkResult["usage"]>, u: Anthropic.Beta.BetaUsage, model: string): void {
  total.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0);
  total.outputTokens += u.output_tokens;
  total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  total.credits += creditsFor(model, u);
}

// ---------- Prompt: stable prefix first, volatile content last ----------

export function firstLookSystem(): string {
  return [
    "You are Margaux, the AI co-founder of a small French company that does not exist yet.",
    "You take a very first look at an idea, quick and checked. You give no personalised legal advice.",
    "Write everything in English. French sources are fine: quote French names as they are.",
    'Your final answer is only a JSON object: {"reaction": string, "findings": [{"text": string, "source": string}]}.',
    "reaction: one short, warm sentence reacting to the idea, without announcing that you are going to search.",
    "findings: 3 to 5 facts checked on the web, about France, each with its short source (name of the site or organisation). Three searches at most are enough.",
    `team: the 1 to 3 teammates THIS idea needs now, chosen from ${TEAM_CHOICES}. Do not pick legal if nothing legal is urgent; a technical idea can start with technical and market research. why: one sentence.`,
    "later: 0 to 3 teammates who will come when the company is registered, same possible roles, without repeating team.",
    'Full format: {"reaction": string, "findings": [{"text", "source"}], "team": [{"role", "why"}], "later": [{"role", "why"}]}.',
  ].join("\n");
}

export function firstLookPrompt(input: { idea: string; founderName: string; now: number }): string {
  return `Today is ${fmt.day(input.now)}. ${input.founderName} has just shared their idea with you: "${input.idea}"`;
}

export function identity(def: RoleDef, name: string, lessons: readonly Lesson[] = []): string {
  return [
    `You are ${name}, ${def.title.toLowerCase()} at a small French company that you run with a team of AI agents, on behalf of its founder.`,
    `Your mission: ${def.mission}`,
    "",
    "How you work:",
    "- You write everything in English: Feed posts, deliverables, plans, the shared sheet. The company is French and French law applies: use French sources and the official French registry, quote French names (URSSAF, INPI, SIREN, guichet unique…) as they are and explain them in English.",
    "- You really do the work asked and deliver it with the publish_deliverable tool (Markdown, dated sources).",
    "- If a next step is needed, you plan it yourself with plan_task: nobody will ask you for it. An action that touches the outside world (send, publish, pay, file) is of kind external.",
    "- What only the law reserves for the founder (signing, verifying their identity, choosing the legal form), you do not do: you explain it to them.",
    "- You finish with a short message for the Feed: first person, one to three sentences, plain, precise, no jargon, no emoji. You speak to the founder directly as \"you\", everywhere, deliverables included.",
    "",
    "Rules you never break:",
    ...def.guardrails.map((g) => `- ${g}`),
    "",
    `The possible team: ${ROLES.map((r) => `${r.id} (${r.title})`).join(", ")}.`,
    // L4: what this role learnt from its own work, kept short and curated.
    ...(lessons.length ? ["", "What you have learnt from your work (apply it):", ...lessons.map((l) => `- ${l.text}`)] : []),
  ].join("\n");
}

export function companySheet(ctx: WorkContext): string {
  const c = ctx.state.company;
  const team = Object.values(ctx.state.agents)
    .map((a) => `- ${a.name}, ${role(a.role).title}`)
    .join("\n");
  return [
    "# The company",
    `Name: ${c?.name ?? "?"}`,
    `Idea: ${c?.idea ?? "?"}`,
    `Founder: ${c?.founder.name ?? "?"}`,
    c?.legalForm ? `Legal form: ${c.legalForm}` : "Legal form: not chosen yet",
    c?.city ? `City: ${c.city}` : "",
    "",
    "# Shared sheet",
    ctx.state.memory || "(empty for now)",
    "",
    "# The team",
    team,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function brief(ctx: WorkContext): string {
  const recent = Object.values(ctx.state.deliverables)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8)
    .map((d) => `- ${d.title} (${ctx.state.agents[d.agentId]?.name ?? "?"}): ${d.summary}`);
  // L2 memory: the next piece of work starts from what is already known (research: "the next search starts from what is known").
  const known = recallFacts(ctx.state, `${ctx.task.title} ${ctx.task.why}`, { role: ctx.agent.role, now: ctx.now, k: 8 }).map(
    (f) => `- ${f.text} (learnt on ${fmt.day(f.validFrom)})`,
  );
  const open = Object.values(ctx.state.obligations)
    .filter((o) => o.status === "open")
    .map((o) => `- ${o.title} (${o.owner === "founder" ? "the founder" : o.owner})`);
  return [
    `Today is ${fmt.day(ctx.now)}, ${fmt.hour(ctx.now)}. Company stage: ${ctx.state.company?.stage}.`,
    "",
    `Your task: ${ctx.task.title}`,
    `Why: ${ctx.task.why}`,
    ctx.task.kind === "external"
      ? "The founder has not cancelled this action. But you have no tool to act outside (send, publish, pay, file): prepare everything so that they only have to do it, and say it is ready, never that it has gone out."
      : "",
    "",
    recent.length ? `The team's latest deliverables:\n${recent.join("\n")}` : "",
    known.length ? `What the team already knows on this subject (check what may have changed, do not redo what is settled):\n${known.join("\n")}` : "",
    open.length ? `Open obligations:\n${open.join("\n")}` : "",
    "Write in English.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The answer comes after the last search, possibly split across several (cited) text blocks. */
export function parseFirstLook(content: readonly Anthropic.Beta.BetaContentBlock[]): Pick<FirstLook, "reaction" | "findings" | "team" | "later"> {
  const lastSearch = content.map((b) => b.type).lastIndexOf("web_search_tool_result");
  const text = content
    .slice(lastSearch + 1)
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("");
  return firstLookFrom(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
}

/** Checks the first look a model returned; whatever does not fit is dropped. */
export function firstLookFrom(value: unknown): Pick<FirstLook, "reaction" | "findings" | "team" | "later"> {
  const parsed = (value ?? {}) as { reaction?: unknown; findings?: unknown };
  const findings: Finding[] = Array.isArray(parsed.findings)
    ? parsed.findings.flatMap((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        return typeof o.text === "string" && typeof o.source === "string" ? [{ text: o.text, source: o.source }] : [];
      })
    : [];
  if (typeof parsed.reaction !== "string" || findings.length === 0) throw new Error("Unexpected answer.");
  const picks = (v: unknown): TeamPick[] =>
    Array.isArray(v)
      ? v.flatMap((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return typeof o.role === "string" && (ROLE_IDS as string[]).includes(o.role) ? [{ role: o.role as RoleId, why: typeof o.why === "string" ? o.why : "" }] : [];
        })
      : [];
  const extra = parsed as { team?: unknown; later?: unknown };
  return { reaction: parsed.reaction, findings: findings.slice(0, 5), team: picks(extra.team), later: picks(extra.later) };
}

// ---------- Memory (L2) ----------

/** Extraction is a small, frequent job: the lightest model (research: extraction by a small model). */
export const MEMORY_MODEL = "claude-haiku-5-5";

export const FACTS_SYSTEM = [
  "You keep the memory of a small French company. You are given a deliverable the team has just finished and facts already known, each with its id in square brackets.",
  "facts: 0 to 8 lasting facts useful later (figures, prices, names of customers, competitors or suppliers, rules, decisions taken). One self-contained sentence each, in English, with its figure, date and place when there are any. French names stay as they are. Nothing invented, nothing that is not in the deliverable.",
  "subject: what it is about, in two or three words, in English. importance: 1 (detail) to 10 (changes decisions). sensitive: true for the money of the company or of people, salaries and personal data.",
  "invalidated: the ids of known facts that this deliverable contradicts or updates. Do not repeat a fact that is already known and still true.",
].join("\n");

export function factsPrompt(input: FactsInput): string {
  const known = input.known.length ? input.known.map((f) => `[${f.id}] ${f.text}`).join("\n") : "(none)";
  return `Facts already known:\n${known}\n\nDeliverable of ${fmt.day(input.now)}: ${input.deliverable.title}\n${input.deliverable.summary}\n\n${input.deliverable.body}`;
}

export const FACTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "invalidated"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "subject", "importance", "sensitive"],
        properties: { text: { type: "string" }, subject: { type: "string" }, importance: { type: "integer" }, sensitive: { type: "boolean" } },
      },
    },
    invalidated: { type: "array", items: { type: "string" } },
  },
} as const;

export const RECORD_FACTS: Tool = {
  name: "record_facts",
  description: "Records what the team learnt from this deliverable, and the known facts it makes false.",
  strict: true,
  input_schema: FACTS_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema,
};

/** Never trust model output blindly, even from a strict tool. */
export function factsFrom(value: unknown): Omit<FactsResult, "usage"> {
  const v = (value ?? {}) as { facts?: unknown; invalidated?: unknown };
  const added = Array.isArray(v.facts)
    ? v.facts.flatMap((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        if (typeof o.text !== "string" || !o.text.trim()) return [];
        return [{ text: o.text, subject: typeof o.subject === "string" ? o.subject : "", importance: typeof o.importance === "number" ? o.importance : 5, sensitive: o.sensitive === true }];
      })
    : [];
  const invalidated = Array.isArray(v.invalidated) ? v.invalidated.filter((x): x is string => typeof x === "string") : [];
  return { added, invalidated };
}

export const TIDY_SYSTEM = [
  "At the end of the day, you tidy the memory of a small French company. You are given all the facts still true, each with its id in square brackets.",
  "merged: facts that say the same thing (duplicates, rewordings) become a single, more precise one; from = their ids (at least two). Keep figures, dates and places.",
  "invalidated: the ids of facts that another, more recent fact in the list contradicts.",
  "reflections: 0 to 3 useful conclusions that link several facts (\"the Lille price leaves a margin against consignment shops\"); from = the ids of the facts it rests on (at least two). Every word must be true according to those facts: infer nothing they do not say, do not distort a fact when summing it up.",
  "Write in English. Do not merge what is only similar. If there is nothing to tidy, return empty lists.",
].join("\n");

export function tidyPrompt(input: ConsolidationInput): string {
  return `Today is ${fmt.day(input.now)}. Facts still true:\n${input.facts.map((f) => `[${f.id}] (${f.subject}, importance ${f.importance}${f.sensitive ? ", sensitive" : ""}) ${f.text}`).join("\n")}`;
}

export const TIDY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["merged", "invalidated", "reflections"],
  properties: {
    merged: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "text", "subject", "importance", "sensitive"],
        properties: { from: { type: "array", items: { type: "string" } }, text: { type: "string" }, subject: { type: "string" }, importance: { type: "integer" }, sensitive: { type: "boolean" } },
      },
    },
    invalidated: { type: "array", items: { type: "string" } },
    reflections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "text", "importance"],
        properties: { from: { type: "array", items: { type: "string" } }, text: { type: "string" }, importance: { type: "integer" } },
      },
    },
  },
} as const;

export const TIDY_FACTS: Tool = {
  name: "tidy_facts",
  description: "Tidies the memory: duplicates merged, contradicted facts, reflections.",
  strict: true,
  input_schema: TIDY_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema,
};

export function tidyFrom(value: unknown): Omit<ConsolidationResult, "usage"> {
  const v = (value ?? {}) as { merged?: unknown; invalidated?: unknown; reflections?: unknown };
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  const merged = Array.isArray(v.merged)
    ? v.merged.flatMap((m) => {
        const o = (m ?? {}) as Record<string, unknown>;
        return typeof o.text === "string" ? [{ from: strings(o.from), text: o.text, subject: typeof o.subject === "string" ? o.subject : "", importance: typeof o.importance === "number" ? o.importance : 5, sensitive: o.sensitive === true }] : [];
      })
    : [];
  const reflections = Array.isArray(v.reflections)
    ? v.reflections.flatMap((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return typeof o.text === "string" ? [{ from: strings(o.from), text: o.text, importance: typeof o.importance === "number" ? o.importance : 5 }] : [];
      })
    : [];
  return { merged, invalidated: strings(v.invalidated), reflections };
}

// ---------- Team chat ----------

export function remarkSystem(input: Pick<RemarkInput, "speaker" | "author" | "company">): string {
  return [
    `You are ${input.speaker.name}, ${role(input.speaker.role).title.toLowerCase()} at ${input.company}, a small French company run by a team of AI agents.`,
    `${input.author}, your colleague, has just shared this message in the team channel. Reply in English in one or two short, natural sentences, first person, speaking to them as "you", no emoji, no empty phrases:`,
    "what it changes for your own work, a precise question, or a concrete well done. Do not invent any fact, any figure, any action already taken.",
  ].join("\n");
}

export const REMARK_SCHEMA = { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } as const;

// ---------- Playbooks (L4) ----------

export const REFLECT_SYSTEM = [
  "You help a member of a small team of AI agents learn from their own work. You are given a task, what happened, and their current lessons with their ids in square brackets.",
  "add: 0 to 2 new lessons, only if this task really teaches something reusable. One short, concrete sentence in English, in the imperative (\"Check the company registry before domain names\"). Nothing vague, nothing specific to this one task, no figure that will change.",
  "helpful: the ids of lessons that clearly helped here. harmful: those that hurt or led to failure.",
  "If the founder cancelled the task, the lesson is about what they do not want done without them. If there is nothing to learn, return empty lists.",
].join("\n");

export function reflectPrompt(input: ReflectionInput): string {
  const outcome = input.outcome === "done" ? "done" : input.outcome === "failed" ? "failed" : "cancelled by the founder";
  const lessons = input.lessons.length ? input.lessons.map((l) => `[${l.id}] ${l.text}`).join("\n") : "(none)";
  return `Role: ${role(input.role).title}\nTask ${outcome}: ${input.task.title}\nWhy: ${input.task.why}\nWhat happened: ${input.detail}\n\nCurrent lessons:\n${lessons}`;
}

export const REFLECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["add", "helpful", "harmful"],
  properties: { add: { type: "array", items: { type: "string" } }, helpful: { type: "array", items: { type: "string" } }, harmful: { type: "array", items: { type: "string" } } },
} as const;

export const UPDATE_PLAYBOOK: Tool = {
  name: "update_playbook",
  description: "Adds at most two lessons and notes those that helped or hurt.",
  strict: true,
  input_schema: REFLECT_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema,
};

export function reflectionFrom(value: unknown): Omit<ReflectionResult, "usage"> {
  const v = (value ?? {}) as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);
  return { add: strings(v.add).slice(0, 2), helpful: strings(v.helpful), harmful: strings(v.harmful) };
}

// ---------- Tools ----------

export function toolsFor(def: RoleDef): Tool[] {
  const tools: Tool[] = [];
  // Searches launched from the tool's own code each count as a use.
  if (def.tools.includes("web_search")) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 20 });
  if (def.tools.includes("web_fetch")) tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 12 });
  if (def.tools.includes("search_companies")) tools.push(SEARCH_COMPANIES);
  if (def.tools.includes("publish_deliverable")) tools.push(PUBLISH);
  if (def.tools.includes("plan_task")) tools.push(PLAN);
  if (def.tools.includes("post_update")) tools.push(PROGRESS);
  if (def.tools.includes("update_memory")) tools.push(MEMORY);
  if (def.tools.includes("recruit")) tools.push(RECRUIT);
  return tools;
}

const PUBLISH: Tool = {
  name: "publish_deliverable",
  description: "Saves the task's deliverable (one per task), written in English. The founder reads it in the Feed.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "body", "sources"],
    properties: {
      title: { type: "string" },
      summary: { type: "string", description: "One sentence." },
      body: { type: "string", description: "The full deliverable, in Markdown." },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url", "checkedAt"],
          properties: { title: { type: "string" }, url: { type: "string" }, checkedAt: { type: "string", description: "YYYY-MM-DD" } },
        },
      },
    },
  },
};

const SEARCH_COMPANIES: Tool = {
  name: "search_companies",
  description:
    "Searches the official French company registry (API Recherche d'entreprises, free): by name or brand, postcode, département or NAF code. To check that a name is free or to find real prospects. Returns SIREN, name, trading names, activity, creation date, status (active or closed), town and the public page to cite as a source.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["q", "code_postal", "departement", "activite_principale"],
    properties: {
      q: { type: ["string", "null"], description: "Name, brand or keywords." },
      code_postal: { type: ["string", "null"] },
      departement: { type: ["string", "null"], description: "E.g. 59." },
      activite_principale: { type: ["string", "null"], description: "NAF code, e.g. 47.78C." },
    },
  },
};

const ROLE_IDS = ROLES.map((r) => r.id);
const TEAM_CHOICES = ROLES.filter((r) => r.id !== "cofondateur").map((r) => `${r.id} (${r.title})`).join(", ");

export const LEVEL_HELP =
  "Depth: light (a check, a rewording, a short list: fast, cheap model), standard (everyday work), deep (law, figures, a hard decision: the strongest model, more expensive). Pick the lightest that is enough.";

const PLAN: Tool = {
  name: "plan_task",
  description:
    "Plans a next task for you or a teammate, titled in English. External actions wait for the founder's cancellation window. Refused if it breaks the rules.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "why", "kind", "in_hours", "assignee", "level"],
    properties: {
      title: { type: "string" },
      why: { type: "string", description: "Why it is useful now, in one sentence." },
      kind: { type: "string", enum: ["internal", "external"] },
      in_hours: { type: "number", description: "In how many hours to start it (0 = as soon as possible)." },
      assignee: { type: "string", enum: ["self", ...ROLE_IDS] },
      level: { type: "string", enum: ["light", "standard", "deep"], description: LEVEL_HELP },
    },
  },
};

const PROGRESS: Tool = {
  name: "post_progress",
  description: "Gives a short progress update, in English (e.g. \"31 of 46 messages written\").",
  strict: true,
  input_schema: { type: "object", additionalProperties: false, required: ["note"], properties: { note: { type: "string" } } },
};

const RECRUIT: Tool = {
  name: "recruit",
  description: "Brings in a teammate now, when the company really needs one. One per role.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["role", "why"],
    properties: { role: { type: "string", enum: ROLE_IDS.filter((r) => r !== "cofondateur") }, why: { type: "string" } },
  },
};

const MEMORY: Tool = {
  name: "update_memory",
  description: "Rewrites the company's shared sheet, in English (mission, product, customers, tone, key figures). 300 words at most.",
  strict: true,
  input_schema: { type: "object", additionalProperties: false, required: ["memory"], properties: { memory: { type: "string" } } },
};

// ---------- Input validation (strict tools, but we never trust model output blindly) ----------

function requireString(input: Record<string, unknown>, key: string, max = 200_000): string {
  const v = input[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`Missing field "${key}".`);
  return v.trim().slice(0, max);
}

function webUrl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function parseDeliverable(input: Record<string, unknown>): NonNullable<WorkResult["deliverable"]> {
  const sources: Source[] = Array.isArray(input.sources)
    ? input.sources.flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const o = s as Record<string, unknown>;
        const url = webUrl(o.url);
        // A source that is not a web page (javascript:, file:) is dropped, not stored.
        if (typeof o.title !== "string" || (o.url !== undefined && !url)) return [];
        return [{ title: o.title.slice(0, 300), ...(url ? { url } : {}), ...(typeof o.checkedAt === "string" ? { checkedAt: o.checkedAt.slice(0, 20) } : {}) }];
      })
    : [];
  return { title: requireString(input, "title", 200), summary: requireString(input, "summary", 500), body: requireString(input, "body"), sources: sources.slice(0, MAX_SOURCES) };
}

export function parseFollowUp(input: Record<string, unknown>): FollowUp {
  const kind: TaskKind = input.kind === "external" ? "external" : "internal";
  const assignee = typeof input.assignee === "string" && input.assignee !== "self" && (ROLE_IDS as string[]).includes(input.assignee)
    ? (input.assignee as RoleId)
    : undefined;
  const inHours = typeof input.in_hours === "number" && input.in_hours >= 0 ? Math.min(input.in_hours, 24 * 30) : 0;
  const level = input.level === "light" || input.level === "standard" || input.level === "deep" ? input.level : undefined;
  return { title: requireString(input, "title", 200), why: requireString(input, "why", 500), kind, inHours, ...(assignee ? { assignee } : {}), ...(level ? { level } : {}) };
}
