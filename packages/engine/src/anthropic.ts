import Anthropic from "@anthropic-ai/sdk";
import { fmt, role, ROLES, type FirstLook, type Finding, type RoleDef, type RoleId, type Source, type TaskKind, type TeamPick } from "@narthex/core";
import type { AgentRuntime, FollowUp, WorkContext, WorkResult } from "./runtime.ts";

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

/**
 * Real agents, on the Messages API with the player's own key.
 * Each role gets a stable, cached prefix (tools → identity and rules → company sheet),
 * then the task. The agent's final text is its post in the Fil.
 */
export class AnthropicRuntime implements AgentRuntime {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly models: Partial<Record<RoleId, string>>;
  private readonly maxTurns: number;

  constructor(options: AnthropicRuntimeOptions = {}) {
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? DEFAULT_MODEL;
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
        system: [
          "Tu es Margaux, co-fondatrice IA d'une petite entreprise française qui n'existe pas encore.",
          "Tu fais un tout premier coup d'œil, rapide et vérifié, sur une idée. Tu ne donnes aucun conseil juridique personnalisé.",
          'Ta réponse finale est uniquement un objet JSON : {"reaction": string, "findings": [{"text": string, "source": string}]}.',
          "reaction : une seule phrase courte et chaleureuse qui réagit à l'idée, sans annoncer que tu vas chercher.",
          "findings : 3 à 5 constats vérifiés sur le web, en France, chacun avec sa source courte (nom du site ou de l'organisme). Trois recherches au plus suffisent.",
          `team : les 1 à 3 coéquipiers dont CETTE idée a besoin maintenant, choisis parmi ${TEAM_CHOICES}. Ne prends pas le juridique si rien de légal ne presse ; une idée technique peut commencer par la recherche technique et de marché. why : une phrase.`,
          "later : 0 à 3 coéquipiers qui viendront quand on créera la société, mêmes postes possibles, sans répéter team.",
          'Format complet : {"reaction": string, "findings": [{"text", "source"}], "team": [{"role", "why"}], "later": [{"role", "why"}]}.',
        ].join("\n"),
        // Searches launched from the tool's own code each count as a use: leave room, ask for few.
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
        messages: [{ role: "user", content: `Nous sommes le ${fmt.day(input.now)}. ${input.founderName} vient de te confier son idée : « ${input.idea} »` }],
      },
      { signal: input.signal },
    );
    if (response.stop_reason === "refusal") throw new Error("Claude a refusé.");
    if (response.stop_reason === "max_tokens" || response.stop_reason === "pause_turn") throw new Error("Réponse incomplète.");
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
    addUsage(usage, response.usage, this.model);
    return { ...parseFirstLook(response.content), simulated: false, usage };
  }

  async run(ctx: WorkContext): Promise<WorkResult> {
    const def = role(ctx.agent.role);
    const model = this.models[ctx.agent.role] ?? this.model;
    const tools = toolsFor(def);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: identity(def, ctx.agent.name) },
      { type: "text", text: companySheet(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    const messages: MessageParam[] = [{ role: "user", content: brief(ctx) }];
    let deliverable: WorkResult["deliverable"];
    let memory: string | undefined;

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (ctx.signal.aborted) throw new Error("Annulée");
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
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
      addUsage(turn, response.usage, model);
      ctx.spend(turn);
      if (ctx.signal.aborted) throw new Error("Budget atteint.");

      if (response.stop_reason === "refusal") throw new Error("Claude a refusé cette tâche.");
      if (response.stop_reason === "max_tokens") throw new Error("Réponse trop longue, interrompue.");
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "pause_turn") continue;

      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (calls.length === 0) {
        const post = response.content
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("\n")
          .trim();
        return { post: post || `C'est fait : ${ctx.task.title}.`, deliverable, memory };
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
            case "update_memory":
              memory = requireString(input, "memory");
              return ok(call.id, "Fiche de l'entreprise mise à jour.");
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

function ok(id: string, content: string): ToolResult {
  return { type: "tool_result", tool_use_id: id, content };
}

function error(id: string, content: string): ToolResult {
  return { type: "tool_result", tool_use_id: id, content, is_error: true };
}

type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
};

/**
 * Credits (1 = 0,01 $) for one call, each kind of token at its real price:
 * fresh input, cache writes (×1.25 for 5 min, ×2 for 1 h), cache reads, output.
 */
export function creditsFor(model: string, u: UsageLike): number {
  const price = PRICES[model] ?? PRICES[DEFAULT_MODEL]!;
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? (u.cache_creation ? 0 : (u.cache_creation_input_tokens ?? 0));
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const usd =
    (u.input_tokens * price.input +
      write5m * price.input * 1.25 +
      write1h * price.input * 2 +
      (u.cache_read_input_tokens ?? 0) * price.cacheRead +
      u.output_tokens * price.output) /
    1_000_000;
  return Math.ceil(usd * 100 - 1e-9);
}

function addUsage(total: NonNullable<WorkResult["usage"]>, u: Anthropic.Beta.BetaUsage, model: string): void {
  total.inputTokens += u.input_tokens + (u.cache_creation_input_tokens ?? 0);
  total.outputTokens += u.output_tokens;
  total.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  total.credits += creditsFor(model, u);
}

// ---------- Prompt: stable prefix first, volatile content last ----------

function identity(def: RoleDef, name: string): string {
  return [
    `Tu es ${name}, ${def.title.toLowerCase()} dans une petite entreprise française que tu fais tourner avec une équipe d'agents IA, pour le compte de son fondateur.`,
    `Ta mission : ${def.mission}`,
    "",
    "Comment tu travailles :",
    "- Tu fais vraiment le travail demandé et tu le livres avec l'outil publish_deliverable (Markdown, sources datées).",
    "- Si une suite est nécessaire, tu la prévois toi-même avec plan_task : personne ne te la demandera. Une action qui touche l'extérieur (envoyer, publier, payer, déposer) est de type external.",
    "- Ce que seule la loi réserve au fondateur (signer, vérifier son identité, choisir sa forme juridique), tu ne le fais pas : tu le lui expliques.",
    "- Tu termines par un court message pour le Fil : à la première personne, une à trois phrases, sobre, précis, sans jargon ni emoji.",
    "",
    "Règles que tu ne transgresses jamais :",
    ...def.guardrails.map((g) => `- ${g}`),
    "",
    `L'équipe possible : ${ROLES.map((r) => `${r.id} (${r.title})`).join(", ")}.`,
  ].join("\n");
}

function companySheet(ctx: WorkContext): string {
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

function brief(ctx: WorkContext): string {
  const recent = Object.values(ctx.state.deliverables)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8)
    .map((d) => `- ${d.title} (${ctx.state.agents[d.agentId]?.name ?? "?"}) : ${d.summary}`);
  const open = Object.values(ctx.state.obligations)
    .filter((o) => o.status === "open")
    .map((o) => `- ${o.title} (${o.owner === "founder" ? "le fondateur" : o.owner})`);
  return [
    `Nous sommes le ${fmt.day(ctx.now)}, ${fmt.hour(ctx.now)}. Étape de l'entreprise : ${ctx.state.company?.stage}.`,
    "",
    `Ta tâche : ${ctx.task.title}`,
    `Pourquoi : ${ctx.task.why}`,
    ctx.task.kind === "external" ? "Le délai d'annulation est passé : tu peux agir." : "",
    "",
    recent.length ? `Derniers livrables de l'équipe :\n${recent.join("\n")}` : "",
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
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as { reaction?: unknown; findings?: unknown };
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

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`Champ « ${key} » manquant.`);
  return v;
}

function parseDeliverable(input: Record<string, unknown>): NonNullable<WorkResult["deliverable"]> {
  const sources: Source[] = Array.isArray(input.sources)
    ? input.sources.flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const o = s as Record<string, unknown>;
        return typeof o.title === "string"
          ? [{ title: o.title, ...(typeof o.url === "string" ? { url: o.url } : {}), ...(typeof o.checkedAt === "string" ? { checkedAt: o.checkedAt } : {}) }]
          : [];
      })
    : [];
  return { title: requireString(input, "title"), summary: requireString(input, "summary"), body: requireString(input, "body"), sources };
}

function parseFollowUp(input: Record<string, unknown>): FollowUp {
  const kind: TaskKind = input.kind === "external" ? "external" : "internal";
  const assignee = typeof input.assignee === "string" && input.assignee !== "self" && (ROLE_IDS as string[]).includes(input.assignee)
    ? (input.assignee as RoleId)
    : undefined;
  const inHours = typeof input.in_hours === "number" && input.in_hours >= 0 ? Math.min(input.in_hours, 24 * 30) : 0;
  return { title: requireString(input, "title"), why: requireString(input, "why"), kind, inHours, ...(assignee ? { assignee } : {}) };
}
