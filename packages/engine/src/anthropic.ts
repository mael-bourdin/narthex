import Anthropic from "@anthropic-ai/sdk";
import { fmt, recallFacts, role, ROLES, type FirstLook, type Finding, type RoleDef, type RoleId, type Source, type TaskKind, type TeamPick } from "@narthex/core";
import type { AgentRuntime, FactsInput, FactsResult, FollowUp, WorkContext, WorkResult } from "./runtime.ts";

type Tool = Anthropic.Beta.BetaToolUnion;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface AnthropicRuntimeOptions {
  apiKey?: string;
  model?: string;
  /** A model per role (Réglages · API et modèles); `model` for the others. */
  models?: Partial<Record<RoleId, string>>;
  /** Hard cap on model turns per task, so a confused agent cannot loop forever. */
  maxTurns?: number;
  client?: Anthropic;
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
  /** The model chosen for everyone (« narthex config modele »), over each role's default. */
  private readonly chosen: string | undefined;
  private readonly models: Partial<Record<RoleId, string>>;
  private readonly maxTurns: number;

  constructor(options: AnthropicRuntimeOptions = {}) {
    // The player's key goes to Anthropic only: no gateway or extra token picked up from the environment.
    this.client = options.client ?? new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), baseURL: "https://api.anthropic.com", authToken: null });
    this.model = options.model ?? DEFAULT_MODEL;
    this.chosen = options.model;
    this.models = options.models ?? {};
    this.maxTurns = options.maxTurns ?? 12;
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
    if (response.stop_reason === "refusal") throw new Error("Claude a refusé.");
    if (response.stop_reason === "max_tokens" || response.stop_reason === "pause_turn") throw new Error("Réponse incomplète.");
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

  async run(ctx: WorkContext): Promise<WorkResult> {
    const def = role(ctx.agent.role);
    const model = this.models[ctx.agent.role] ?? this.chosen ?? def.model;
    const tools = toolsFor(def);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: identity(def, ctx.agent.name) },
      { type: "text", text: companySheet(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    const messages: MessageParam[] = [{ role: "user", content: brief(ctx) }];
    let deliverable: WorkResult["deliverable"];
    let memory: string | undefined;
    const consulted = new Set<string>();

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (ctx.signal.aborted) throw new Error("Annulée");
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
      if (ctx.signal.aborted) throw new Error("Budget atteint.");

      if (response.stop_reason === "refusal") throw new Error("Claude a refusé cette tâche.");
      if (response.stop_reason === "max_tokens") throw new Error("Réponse trop longue, interrompue.");
      for (const url of consultedUrls(response.content)) consulted.add(url);
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "pause_turn") continue;

      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (calls.length === 0) {
        const post = response.content
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("\n")
          .trim();
        return { post: (post || `C'est fait : ${ctx.task.title}.`).slice(0, MAX_POST_CHARS), deliverable, memory, consulted: [...consulted] };
      }

      // All results go back in a single user message, so parallel tool use keeps working.
      const results: ToolResult[] = calls.map((call) => {
        const input = call.input as Record<string, unknown>;
        try {
          switch (call.name) {
            case "publish_deliverable":
              deliverable = parseDeliverable(input);
              ctx.progress(`Livrable prêt : ${deliverable.title}`);
              return ok(call.id, "Livrable enregistré. Termine par ton message pour le Fil.");
            case "plan_task": {
              const refused = ctx.plan(parseFollowUp(input));
              return refused ? error(call.id, refused) : ok(call.id, "Tâche prévue.");
            }
            case "post_progress":
              ctx.progress(requireString(input, "note"));
              return ok(call.id, "Noté.");
            case "recruit": {
              const refused = ctx.recruit(requireString(input, "role") as RoleId, requireString(input, "why"));
              return refused ? error(call.id, refused) : ok(call.id, "Recruté : il ou elle commence tout de suite.");
            }
            case "update_memory": {
              // Read by every agent on every turn: a long or injected sheet would steer and cost forever.
              const next = requireString(input, "memory");
              if (next.length > MAX_MEMORY_CHARS) return error(call.id, `Trop longue (${next.length} caractères) : 300 mots, ${MAX_MEMORY_CHARS} caractères au plus.`);
              memory = next;
              return ok(call.id, "Fiche de l'entreprise mise à jour.");
            }
            default:
              return error(call.id, `Outil inconnu : ${call.name}`);
          }
        } catch (e) {
          return error(call.id, e instanceof Error ? e.message : String(e));
        }
      });
      messages.push({ role: "user", content: results });
    }
    throw new Error(`Pas terminé après ${this.maxTurns} tours.`);
  }
}

const MAX_MEMORY_CHARS = 2500;
const MAX_POST_CHARS = 2000;
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
 * Credits (1 = 0,01 $) for one call, each kind of token at its real price:
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

function addUsage(total: NonNullable<WorkResult["usage"]>, u: Anthropic.Beta.BetaUsage, model: string): void {
  total.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0);
  total.outputTokens += u.output_tokens;
  total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  total.credits += creditsFor(model, u);
}

// ---------- Prompt: stable prefix first, volatile content last ----------

export function firstLookSystem(): string {
  return [
    "Tu es Margaux, co-fondatrice IA d'une petite entreprise française qui n'existe pas encore.",
    "Tu fais un tout premier coup d'œil, rapide et vérifié, sur une idée. Tu ne donnes aucun conseil juridique personnalisé.",
    'Ta réponse finale est uniquement un objet JSON : {"reaction": string, "findings": [{"text": string, "source": string}]}.',
    "reaction : une seule phrase courte et chaleureuse qui réagit à l'idée, sans annoncer que tu vas chercher.",
    "findings : 3 à 5 constats vérifiés sur le web, en France, chacun avec sa source courte (nom du site ou de l'organisme). Trois recherches au plus suffisent.",
    `team : les 1 à 3 coéquipiers dont CETTE idée a besoin maintenant, choisis parmi ${TEAM_CHOICES}. Ne prends pas le juridique si rien de légal ne presse ; une idée technique peut commencer par la recherche technique et de marché. why : une phrase.`,
    "later : 0 à 3 coéquipiers qui viendront quand on créera la société, mêmes postes possibles, sans répéter team.",
    'Format complet : {"reaction": string, "findings": [{"text", "source"}], "team": [{"role", "why"}], "later": [{"role", "why"}]}.',
  ].join("\n");
}

export function firstLookPrompt(input: { idea: string; founderName: string; now: number }): string {
  return `Nous sommes le ${fmt.day(input.now)}. ${input.founderName} vient de te confier son idée : « ${input.idea} »`;
}

export function identity(def: RoleDef, name: string): string {
  return [
    `Tu es ${name}, ${def.title.toLowerCase()} dans une petite entreprise française que tu fais tourner avec une équipe d'agents IA, pour le compte de son fondateur.`,
    `Ta mission : ${def.mission}`,
    "",
    "Comment tu travailles :",
    "- Tu fais vraiment le travail demandé et tu le livres avec l'outil publish_deliverable (Markdown, sources datées).",
    "- Si une suite est nécessaire, tu la prévois toi-même avec plan_task : personne ne te la demandera. Une action qui touche l'extérieur (envoyer, publier, payer, déposer) est de type external.",
    "- Ce que seule la loi réserve au fondateur (signer, vérifier son identité, choisir sa forme juridique), tu ne le fais pas : tu le lui expliques.",
    "- Tu termines par un court message pour le Fil : à la première personne, une à trois phrases, sobre, précis, sans jargon ni emoji. Tu tutoies le fondateur, partout, livrables compris.",
    "",
    "Règles que tu ne transgresses jamais :",
    ...def.guardrails.map((g) => `- ${g}`),
    "",
    `L'équipe possible : ${ROLES.map((r) => `${r.id} (${r.title})`).join(", ")}.`,
  ].join("\n");
}

export function companySheet(ctx: WorkContext): string {
  const c = ctx.state.company;
  const team = Object.values(ctx.state.agents)
    .map((a) => `- ${a.name}, ${role(a.role).title}`)
    .join("\n");
  return [
    "# L'entreprise",
    `Nom : ${c?.name ?? "?"}`,
    `Idée : ${c?.idea ?? "?"}`,
    `Fondateur : ${c?.founder.name ?? "?"}`,
    c?.legalForm ? `Forme : ${c.legalForm}` : "Forme juridique : pas encore choisie",
    c?.city ? `Ville : ${c.city}` : "",
    "",
    "# Fiche partagée",
    ctx.state.memory || "(vide pour l'instant)",
    "",
    "# L'équipe",
    team,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function brief(ctx: WorkContext): string {
  const recent = Object.values(ctx.state.deliverables)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8)
    .map((d) => `- ${d.title} (${ctx.state.agents[d.agentId]?.name ?? "?"}) : ${d.summary}`);
  // L2 memory: the next piece of work starts from what is already known (research: « la recherche suivante part du connu »).
  const known = recallFacts(ctx.state, `${ctx.task.title} ${ctx.task.why}`, { role: ctx.agent.role, now: ctx.now, k: 8 }).map(
    (f) => `- ${f.text} (appris le ${fmt.day(f.validFrom)})`,
  );
  const open = Object.values(ctx.state.obligations)
    .filter((o) => o.status === "open")
    .map((o) => `- ${o.title} (${o.owner === "founder" ? "le fondateur" : o.owner})`);
  return [
    `Nous sommes le ${fmt.day(ctx.now)}, ${fmt.hour(ctx.now)}. Étape de l'entreprise : ${ctx.state.company?.stage}.`,
    "",
    `Ta tâche : ${ctx.task.title}`,
    `Pourquoi : ${ctx.task.why}`,
    ctx.task.kind === "external"
      ? "Le fondateur n'a pas annulé cette action. Mais tu n'as aucun outil pour agir dehors (envoyer, publier, payer, déposer) : prépare tout pour qu'il n'ait plus qu'à le faire, et dis que c'est prêt, jamais que c'est parti."
      : "",
    "",
    recent.length ? `Derniers livrables de l'équipe :\n${recent.join("\n")}` : "",
    known.length ? `Ce que l'équipe sait déjà sur ce sujet (vérifie ce qui a pu changer, ne refais pas ce qui est acquis) :\n${known.join("\n")}` : "",
    open.length ? `Obligations ouvertes :\n${open.join("\n")}` : "",
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
  if (typeof parsed.reaction !== "string" || findings.length === 0) throw new Error("Réponse inattendue.");
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
  "Tu tiens la mémoire d'une petite entreprise française. On te donne un livrable que l'équipe vient de finir et des faits déjà connus, chacun avec son identifiant entre crochets.",
  "facts : 0 à 8 faits durables et utiles plus tard (chiffres, prix, noms de clients, concurrents ou fournisseurs, règles, décisions prises). Une phrase autonome chacun, en français, avec son chiffre, sa date et son lieu quand il y en a. Rien d'inventé, rien qui ne soit pas dans le livrable.",
  "subject : de quoi il s'agit, en deux ou trois mots. importance : 1 (détail) à 10 (change les décisions). sensitive : vrai pour l'argent de l'entreprise ou des personnes, les salaires et les données personnelles.",
  "invalidated : les identifiants des faits connus que ce livrable contredit ou met à jour. Ne répète pas un fait déjà connu et toujours vrai.",
].join("\n");

export function factsPrompt(input: FactsInput): string {
  const known = input.known.length ? input.known.map((f) => `[${f.id}] ${f.text}`).join("\n") : "(aucun)";
  return `Faits déjà connus :\n${known}\n\nLivrable du ${fmt.day(input.now)} : ${input.deliverable.title}\n${input.deliverable.summary}\n\n${input.deliverable.body}`;
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

const RECORD_FACTS: Tool = {
  name: "record_facts",
  description: "Enregistre ce que l'équipe a appris de ce livrable, et les faits connus qu'il rend faux.",
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

// ---------- Tools ----------

function toolsFor(def: RoleDef): Tool[] {
  const tools: Tool[] = [];
  // Searches launched from the tool's own code each count as a use.
  if (def.tools.includes("web_search")) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 20 });
  if (def.tools.includes("web_fetch")) tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 12 });
  if (def.tools.includes("publish_deliverable")) tools.push(PUBLISH);
  if (def.tools.includes("plan_task")) tools.push(PLAN);
  if (def.tools.includes("post_update")) tools.push(PROGRESS);
  if (def.tools.includes("update_memory")) tools.push(MEMORY);
  if (def.tools.includes("recruit")) tools.push(RECRUIT);
  return tools;
}

const PUBLISH: Tool = {
  name: "publish_deliverable",
  description: "Enregistre le livrable de la tâche (un seul par tâche). Le fondateur le lit dans le Fil.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "body", "sources"],
    properties: {
      title: { type: "string" },
      summary: { type: "string", description: "Une phrase." },
      body: { type: "string", description: "Le livrable complet, en Markdown." },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url", "checkedAt"],
          properties: { title: { type: "string" }, url: { type: "string" }, checkedAt: { type: "string", description: "AAAA-MM-JJ" } },
        },
      },
    },
  },
};

const ROLE_IDS = ROLES.map((r) => r.id);
const TEAM_CHOICES = ROLES.filter((r) => r.id !== "cofondateur").map((r) => `${r.id} (${r.title})`).join(", ");

const PLAN: Tool = {
  name: "plan_task",
  description:
    "Prévoit une prochaine tâche pour toi ou un coéquipier. Les actions externes attendent le délai d'annulation du fondateur. Refusée si elle dépasse les règles.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "why", "kind", "in_hours", "assignee"],
    properties: {
      title: { type: "string" },
      why: { type: "string", description: "Pourquoi c'est utile maintenant, en une phrase." },
      kind: { type: "string", enum: ["internal", "external"] },
      in_hours: { type: "number", description: "Dans combien d'heures la commencer (0 = dès que possible)." },
      assignee: { type: "string", enum: ["self", ...ROLE_IDS] },
    },
  },
};

const PROGRESS: Tool = {
  name: "post_progress",
  description: "Donne une nouvelle courte de l'avancement (ex. « 31 messages écrits sur 46 »).",
  strict: true,
  input_schema: { type: "object", additionalProperties: false, required: ["note"], properties: { note: { type: "string" } } },
};

const RECRUIT: Tool = {
  name: "recruit",
  description: "Fait venir un coéquipier maintenant, quand l'entreprise en a vraiment besoin. Un seul par poste.",
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
  description: "Réécrit la fiche partagée de l'entreprise (mission, produit, clients, ton, chiffres clés). 300 mots maximum.",
  strict: true,
  input_schema: { type: "object", additionalProperties: false, required: ["memory"], properties: { memory: { type: "string" } } },
};

// ---------- Input validation (strict tools, but we never trust model output blindly) ----------

function requireString(input: Record<string, unknown>, key: string, max = 200_000): string {
  const v = input[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`Champ « ${key} » manquant.`);
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
  return { title: requireString(input, "title", 200), why: requireString(input, "why", 500), kind, inHours, ...(assignee ? { assignee } : {}) };
}
