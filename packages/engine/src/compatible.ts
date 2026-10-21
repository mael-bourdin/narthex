import { CLAUDE_BY_LEVEL, role, roleLevel, type FirstLook, type RoleId, type TaskLevel } from "@narthex/core";
import {
  brief,
  companySheet,
  FACTS_SCHEMA,
  FACTS_SYSTEM,
  factsFrom,
  factsPrompt,
  firstLookFrom,
  firstLookPrompt,
  firstLookSystem,
  identity,
  MAX_POST_CHARS,
  REFLECT_SCHEMA,
  REFLECT_SYSTEM,
  reflectionFrom,
  reflectPrompt,
  remarkSystem,
  TIDY_SCHEMA,
  TIDY_SYSTEM,
  tidyFrom,
  tidyPrompt,
  toolsFor,
  useTool,
  type ToolWork,
} from "./anthropic.ts";
import { FIRST_LOOK_SCHEMA } from "./claude-code.ts";
import { searchCompanies } from "./connectors/entreprises.ts";
import type { AgentRuntime, ConsolidationInput, ConsolidationResult, FactsInput, FactsResult, ReflectionInput, ReflectionResult, RemarkInput, RemarkResult, WorkContext, WorkResult } from "./runtime.ts";

/** Where the models come from: OpenRouter (any model), OpenAI, or any API that speaks the same language (Mistral, Ollama…). */
export type Provider = "openrouter" | "openai" | "compatible";

export type CompatibleFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** USD per million tokens. */
export type Prices = Record<string, { input: number; output: number; cacheRead?: number }>;

export interface CompatibleRuntimeOptions {
  provider: Provider;
  apiKey: string;
  /** For « compatible »: the API's address, e.g. http://localhost:11434/v1 for Ollama. */
  baseURL?: string;
  /** The model for each level; defaults per provider. */
  levels?: Partial<Record<TaskLevel, string>>;
  /** The founder's model for a role (Réglages · API et modèles), over the agent's level. */
  models?: Partial<Record<RoleId, string>>;
  /** One model for everyone, chosen by the founder. */
  model?: string;
  maxTurns?: number;
  fetch?: CompatibleFetch;
  /** Prices when the provider does not say what a call cost; else OpenRouter's public catalogue. */
  prices?: Prices;
  companies?: typeof searchCompanies;
}

const BASE: Record<Exclude<Provider, "compatible">, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};

/** A model for each level, per provider: a quick one, an ordinary one, the strongest. The founder can change them. */
export const DEFAULT_LEVELS: Record<Provider, Partial<Record<TaskLevel, string>>> = {
  openrouter: { light: "deepseek/deepseek-v4.1-flash", standard: "google/gemini-3.8-flash", deep: "openai/gpt-5.6-sol" },
  openai: { light: "gpt-5.6-luna", standard: "gpt-5.6-terra", deep: "gpt-5.6-sol" },
  compatible: {},
};

/** A model we do not know the price of is counted dear: overestimating stops early, underestimating overspends. */
const UNKNOWN_PRICE: { input: number; output: number; cacheRead?: number } = { input: 15, output: 75 };

type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Reply = {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[]; annotations?: { type?: string; url_citation?: { url?: string } }[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number };
  error?: { message?: string };
};
type ToolDef = { type: "function"; function: { name: string; description?: string; parameters: object; strict?: boolean } } | { type: string; parameters?: object };

/**
 * Real agents on any model: OpenRouter (one key, hundreds of models), OpenAI, or an API that speaks
 * OpenAI's chat completions. Same tools, prompts, budgets and guardrails as with Claude.
 * On OpenRouter the web search and page reading run on OpenRouter's side; elsewhere the agents work without the web.
 */
export class CompatibleRuntime implements AgentRuntime {
  readonly name: Provider;
  private readonly base: string;
  private readonly key: string;
  private readonly levels: Partial<Record<TaskLevel, string>>;
  private readonly models: Partial<Record<RoleId, string>>;
  private readonly chosen: string | undefined;
  private readonly maxTurns: number;
  private readonly call: CompatibleFetch;
  private readonly companies: typeof searchCompanies;
  private prices: Prices | undefined;
  private catalogue?: Promise<Prices>;

  constructor(options: CompatibleRuntimeOptions) {
    this.name = options.provider;
    if (options.provider === "compatible" && !options.baseURL) throw new Error("Il manque l'adresse de l'API compatible.");
    this.base = (options.baseURL ?? BASE[options.provider as Exclude<Provider, "compatible">]).replace(/\/$/, "");
    this.key = options.apiKey;
    this.levels = { ...DEFAULT_LEVELS[options.provider], ...options.levels };
    this.models = options.models ?? {};
    this.chosen = options.model;
    this.maxTurns = options.maxTurns ?? 12;
    this.call = options.fetch ?? (globalThis.fetch as unknown as CompatibleFetch);
    this.companies = options.companies ?? searchCompanies;
    this.prices = options.prices;
  }

  /** The model for a level: the founder's choice for everyone, else the level's, else any level that has one. */
  modelFor(level: TaskLevel): string {
    const model = this.chosen ?? this.levels[level] ?? this.levels.standard ?? this.levels.deep ?? this.levels.light;
    if (!model) throw new Error("Aucun modèle choisi : narthex config modele <id>.");
    return model;
  }

  private get web(): boolean {
    return this.name === "openrouter";
  }

  async run(ctx: WorkContext): Promise<WorkResult> {
    const def = role(ctx.agent.role);
    const model = this.models[ctx.agent.role] ?? this.modelFor(ctx.task.level ?? roleLevel(ctx.agent.role));
    const tools = this.toolsOf(def);
    const noWeb = this.web || !(def.tools.includes("web_search") || def.tools.includes("web_fetch")) ? "" : "\n\nIci, tu n'as ni recherche web ni lecture de pages : travaille avec ce que tu sais, et dis-le quand une vérification manque.";
    const messages: Message[] = [
      { role: "system", content: `${identity(def, ctx.agent.name, ctx.state.playbooks?.[ctx.agent.role])}${noWeb}\n\n${companySheet(ctx)}` },
      { role: "user", content: brief(ctx) },
    ];
    let deliverable: WorkResult["deliverable"];
    let memory: string | undefined;
    const consulted = new Set<string>();
    const work: ToolWork = { ctx, consulted, companies: this.companies, deliver: (d) => (deliverable = d), remember: (m) => (memory = m) };

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (ctx.signal.aborted) throw new Error("Annulée");
      const { message, usage } = await this.complete({ model, messages, tools, max_tokens: this.maxTokens(model, ctx.remainingCredits?.()) }, ctx.signal);
      ctx.spend(usage);
      if (ctx.signal.aborted) throw new Error("Budget atteint.");
      for (const a of message.annotations ?? []) if (a.type === "url_citation" && typeof a.url_citation?.url === "string") consulted.add(a.url_citation.url);
      const calls = message.tool_calls ?? [];
      messages.push({ role: "assistant", content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
      if (calls.length === 0) {
        const post = (message.content ?? "").trim();
        return { post: (post || `C'est fait : ${ctx.task.title}.`).slice(0, MAX_POST_CHARS), deliverable, memory, consulted: [...consulted] };
      }
      // Answered in order, one tool message per call.
      for (const c of calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          messages.push({ role: "tool", tool_call_id: c.id, content: "Arguments illisibles : renvoie du JSON valide." });
          continue;
        }
        const out = await useTool(c.function.name, input, work);
        messages.push({ role: "tool", tool_call_id: c.id, content: out.ok ? out.content : `Erreur : ${out.content}` });
      }
    }
    throw new Error(`Pas terminé après ${this.maxTurns} tours.`);
  }

  async firstLook(input: { idea: string; founderName: string; now: number; signal: AbortSignal }): Promise<FirstLook> {
    const out = await this.answer(firstLookSystem(), firstLookPrompt(input), FIRST_LOOK_SCHEMA, this.modelFor("standard"), input.signal, this.web);
    return { ...firstLookFrom(out.value), simulated: false, usage: out.usage };
  }

  async extractFacts(input: FactsInput): Promise<FactsResult> {
    const out = await this.answer(FACTS_SYSTEM, factsPrompt(input), FACTS_SCHEMA, this.modelFor("light"), input.signal);
    return { ...factsFrom(out.value), usage: out.usage };
  }

  async reflect(input: ReflectionInput): Promise<ReflectionResult> {
    const out = await this.answer(REFLECT_SYSTEM, reflectPrompt(input), REFLECT_SCHEMA, this.modelFor("light"), input.signal);
    return { ...reflectionFrom(out.value), usage: out.usage };
  }

  async consolidateFacts(input: ConsolidationInput): Promise<ConsolidationResult> {
    const out = await this.answer(TIDY_SYSTEM, tidyPrompt(input), TIDY_SCHEMA, this.modelFor("light"), input.signal);
    return { ...tidyFrom(out.value), usage: out.usage };
  }

  async remark(input: RemarkInput): Promise<RemarkResult> {
    const { message, usage } = await this.complete(
      { model: this.modelFor("light"), max_tokens: 300, messages: [{ role: "system", content: remarkSystem(input) }, { role: "user", content: input.text }] },
      input.signal,
    );
    return { text: (message.content ?? "").trim(), usage };
  }

  /** A structured answer through a function the model must call (after searching the web, when it may). */
  private async answer(system: string, prompt: string, schema: object, model: string, signal: AbortSignal, web = false): Promise<{ value: unknown; usage: NonNullable<WorkResult["usage"]> }> {
    const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
    const tools: ToolDef[] = [{ type: "function", function: { name: "answer", description: "Ta réponse finale.", parameters: schema } }, ...(web ? [{ type: "openrouter:web_search", parameters: { max_results: 5 } }] : [])];
    const messages: Message[] = [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ];
    for (let turn = 0; turn < 4; turn++) {
      const { message, usage } = await this.complete(
        { model, messages, tools, max_tokens: 16000, tool_choice: web ? "auto" : { type: "function", function: { name: "answer" } } },
        signal,
      );
      for (const k of ["inputTokens", "outputTokens", "cacheReadTokens", "credits"] as const) total[k] += usage[k];
      const call = message.tool_calls?.find((c) => c.function.name === "answer");
      if (call) return { value: JSON.parse(call.function.arguments || "{}"), usage: total };
      messages.push({ role: "assistant", content: message.content ?? null }, { role: "user", content: "Donne maintenant ta réponse avec la fonction answer." });
    }
    throw new Error("Pas de réponse exploitable du modèle.");
  }

  private async complete(body: Record<string, unknown>, signal: AbortSignal): Promise<{ message: NonNullable<NonNullable<Reply["choices"]>[number]["message"]>; usage: NonNullable<WorkResult["usage"]> }> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.key}`, "content-type": "application/json" };
    if (this.name === "openrouter") Object.assign(headers, { "HTTP-Referer": "https://github.com/mael-bourdin/narthex", "X-Title": "Narthex" });
    const res = await this.call(`${this.base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
    const reply = (await res.json().catch(() => ({}))) as Reply;
    if (!res.ok) throw new Error(problem(res.status, reply.error?.message));
    const message = reply.choices?.[0]?.message;
    if (!message) throw new Error("Réponse vide du modèle.");
    const u = reply.usage ?? {};
    const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const prompt = count(u.prompt_tokens);
    const cached = Math.min(prompt, count(u.prompt_tokens_details?.cached_tokens));
    const completion = count(u.completion_tokens);
    // Only OpenRouter's own figure is trusted, and never below zero; any other API is priced by us.
    const reported = this.name === "openrouter" && typeof u.cost === "number" && Number.isFinite(u.cost) && u.cost >= 0 ? Math.ceil(u.cost * 100 - 1e-9) : undefined;
    const credits = reported ?? (await this.creditsFor(String(body.model), prompt, cached, completion));
    const usage = { inputTokens: prompt - cached, outputTokens: completion, cacheReadTokens: cached, credits };
    return { message, usage };
  }

  /** Credits (1 = 0,01 $) at the catalogue price, when the provider does not give the cost. */
  private async creditsFor(model: string, prompt: number, cached: number, completion: number): Promise<number> {
    const p = (await this.priceBook())[model] ?? UNKNOWN_PRICE;
    const usd = ((prompt - cached) * p.input + cached * (p.cacheRead ?? p.input / 10) + completion * p.output) / 1_000_000;
    return Math.ceil(usd * 100 - 1e-9);
  }

  private priceBook(): Promise<Prices> {
    if (this.prices) return Promise.resolve(this.prices);
    // Another API (Mistral, a local model): no call to OpenRouter the player did not ask for; unknown models count dear.
    if (this.name === "compatible") return Promise.resolve((this.prices = {}));
    this.catalogue ??= openRouterPrices(this.call, this.name === "openai" ? "openai/" : "").then(
      (p) => (this.prices = p),
      () => ({}),
    );
    return this.catalogue;
  }

  /** A turn's output never costs more than what is left of the task's and the day's budget. */
  private maxTokens(model: string, remainingCredits: number | undefined): number {
    if (remainingCredits === undefined) return 16000;
    const price = this.prices?.[model] ?? UNKNOWN_PRICE;
    const affordable = Math.floor(((Math.max(0, remainingCredits) / 100) * 1_000_000) / price.output);
    return Math.min(32000, Math.max(1024, affordable));
  }

  private toolsOf(def: ReturnType<typeof role>): ToolDef[] {
    const out: ToolDef[] = [];
    for (const t of toolsFor(def) as { type?: string; name: string; description?: string; input_schema?: object; strict?: boolean }[]) {
      if (t.input_schema) out.push({ type: "function", function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.input_schema } });
      else if (this.web && t.name === "web_search") out.push({ type: "openrouter:web_search", parameters: { max_results: 5 } });
      else if (this.web && t.name === "web_fetch") out.push({ type: "openrouter:web_fetch" });
    }
    return out;
  }
}

function problem(status: number, detail?: string): string {
  if (status === 401 || status === 403) return "Le fournisseur refuse la clé : vérifie-la dans Réglages · API et modèles.";
  if (status === 402) return "Plus de crédit chez le fournisseur : recharge ton compte.";
  if (status === 429) return "Trop de demandes d'un coup chez le fournisseur : l'équipe réessaiera.";
  return `Le fournisseur ne répond pas correctement (${status}${detail ? ` : ${detail.slice(0, 120)}` : ""}).`;
}

/** Prices from OpenRouter's public catalogue (no key needed), in USD per million tokens. */
export async function openRouterPrices(call: CompatibleFetch = globalThis.fetch as unknown as CompatibleFetch, strip = ""): Promise<Prices> {
  const res = await call("https://openrouter.ai/api/v1/models", { method: "GET", headers: {}, body: undefined as never, signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string; input_cache_read?: string } }[] };
  const prices: Prices = {};
  for (const m of body.data ?? []) {
    const input = Number(m.pricing?.prompt) * 1_000_000;
    const output = Number(m.pricing?.completion) * 1_000_000;
    if (!(input >= 0 && output >= 0)) continue;
    const id = strip && m.id.startsWith(strip) ? m.id.slice(strip.length) : m.id;
    const cacheRead = Number(m.pricing?.input_cache_read) * 1_000_000;
    prices[id] = { input, output, ...(cacheRead >= 0 ? { cacheRead } : {}) };
  }
  return prices;
}

/** Models offered in Réglages, per provider (the founder can still type any id in the CLI). */
export const MODEL_CHOICES: Record<"anthropic" | "openrouter" | "openai", { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  ],
  openrouter: [
    { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
    { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
    { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { id: "mistralai/mistral-large-4-0", label: "Mistral Large 4" },
    { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
  ],
  openai: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  ],
};

/** The model each level uses for this provider, the founder's choices included. */
export function levelModels(provider: Provider | "anthropic", chosen: Partial<Record<TaskLevel, string>> = {}): Record<TaskLevel, string> {
  const base = provider === "anthropic" ? CLAUDE_BY_LEVEL : DEFAULT_LEVELS[provider];
  return { light: chosen.light ?? base.light ?? "", standard: chosen.standard ?? base.standard ?? "", deep: chosen.deep ?? base.deep ?? "" };
}
