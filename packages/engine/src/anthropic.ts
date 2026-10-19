import Anthropic from "@anthropic-ai/sdk";
import { fmt, role, ROLES, type RoleDef, type RoleId, type Source, type TaskKind } from "@narthex/core";
import type { AgentRuntime, FollowUp, WorkContext, WorkResult } from "./runtime.ts";

type Tool = Anthropic.Beta.BetaToolUnion;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface AnthropicRuntimeOptions {
  apiKey?: string;
  model?: string;
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
  private readonly maxTurns: number;

  constructor(options: AnthropicRuntimeOptions = {}) {
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTurns = options.maxTurns ?? 12;
  }

  async run(ctx: WorkContext): Promise<WorkResult> {
    const def = role(ctx.agent.role);
    const tools = toolsFor(def);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: identity(def, ctx.agent.name) },
      { type: "text", text: companySheet(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    const messages: MessageParam[] = [{ role: "user", content: brief(ctx) }];
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 };
    let deliverable: WorkResult["deliverable"];
    let memory: string | undefined;

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (ctx.signal.aborted) throw new Error("Annulée");
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: def.effort },
          system,
          tools,
          messages,
        },
        { signal: ctx.signal },
      );
      const response = await stream.finalMessage();
      addUsage(usage, response.usage, this.model);

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
        return { post: post || `C'est fait : ${ctx.task.title}.`, deliverable, memory, usage };
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

function addUsage(total: NonNullable<WorkResult["usage"]>, u: Anthropic.Beta.BetaUsage, model: string): void {
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0);
  const cacheRead = u.cache_read_input_tokens ?? 0;
  total.inputTokens += input;
  total.outputTokens += u.output_tokens;
  total.cacheReadTokens += cacheRead;
  const price = PRICES[model] ?? PRICES[DEFAULT_MODEL]!;
  const usd = (input * price.input + u.output_tokens * price.output + cacheRead * price.cacheRead) / 1_000_000;
  total.credits += Math.ceil(usd * 100);
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

// ---------- Tools ----------

function toolsFor(def: RoleDef): Tool[] {
  const tools: Tool[] = [];
  if (def.tools.includes("web_search")) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 8 });
  if (def.tools.includes("web_fetch")) tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 });
  if (def.tools.includes("publish_deliverable")) tools.push(PUBLISH);
  if (def.tools.includes("plan_task")) tools.push(PLAN);
  if (def.tools.includes("post_update")) tools.push(PROGRESS);
  if (def.tools.includes("update_memory")) tools.push(MEMORY);
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
