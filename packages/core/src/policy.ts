import { nextOffice } from "./office.ts";
import { dayKey } from "./format.ts";
import { OBLIGATIONS, type ObligationRule } from "./obligations.ts";
import { role } from "./roles.ts";
import {
  STAGES,
  type Agent,
  type CompanyState,
  type Obligation,
  type RoleId,
  type Stage,
  type StaffingEntry,
  type Task,
  type TaskKind,
  type TaskLevel,
  type Timestamp,
} from "./types.ts";

/**
 * Everything the company decides on its own lives here, as pure functions of the state.
 * The engine asks `decide()` what to do next and turns each intent into events.
 * The UI never decides anything.
 */
export type Intent =
  | { type: "advance-stage"; stage: Stage; reason: string }
  | { type: "hire"; role: RoleId; reason: string }
  | { type: "open-obligation"; rule: ObligationRule; due?: Timestamp }
  | { type: "fulfill-obligation"; obligationId: string; by: string }
  | { type: "plan-task"; draft: TaskDraft }
  | { type: "start-task"; taskId: string }
  | { type: "escalate"; obligationId: string; error: string }
  | { type: "move-office"; tier: 0 | 1 | 2 | 3 | 4 };

/** What an agent (or a policy) asks for; `guardTask` turns it into a safe Task. */
export interface TaskDraft {
  agentId: string;
  title: string;
  why: string;
  kind: TaskKind;
  tag?: string;
  scheduledAt?: Timestamp;
  parentId?: string;
  level?: TaskLevel;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** An agent never queues more than this; it keeps runaway self-planning in check. */
export const MAX_PLANNED_PER_AGENT = 5;
/** A failed obligation task is retried with exponential backoff, then left to the founder's attention. */
export const MAX_ATTEMPTS = 3;

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

function reached(state: CompanyState, stage: Stage): boolean {
  return !!state.company && stageIndex(state.company.stage) >= stageIndex(stage);
}

function agentsWith(state: CompanyState, r: RoleId): Agent[] {
  return Object.values(state.agents).filter((a) => a.role === r);
}

function tagDone(state: CompanyState, tag: string): boolean {
  return Object.values(state.tasks).some((t) => t.tag === tag && t.status === "done");
}

function obligationDone(state: CompanyState, code: string): boolean {
  return Object.values(state.obligations).some((o) => o.code === code && o.status === "done");
}

function obligationOpened(state: CompanyState, code: string): boolean {
  return Object.values(state.obligations).some((o) => o.code === code);
}

/** The usual team, when nobody could choose one (no key yet, or no first look). */
export const DEFAULT_STAFFING: readonly StaffingEntry[] = [
  { role: "cofondateur", at: "idea", why: "I'm here from the very first idea." },
  { role: "recherche", at: "research", why: "Before creating anything, we need to know the market." },
  { role: "juridique", at: "research", why: "Someone has to check the name and the activity, then set up the company." },
  { role: "prospection", at: "creation", why: "The study looks good: time to find the first customers." },
  { role: "redaction", at: "creation", why: "We need a website and a voice before the launch." },
  { role: "video", at: "launch", why: "The company exists: time to make it known." },
  { role: "comptable", at: "launch", why: "The first invoice is coming: the books have to be ready before it." },
  { role: "support", at: "operating", why: "The first customers need quick answers." },
];

export function staffingOf(state: CompanyState): readonly StaffingEntry[] {
  return state.staffing ?? DEFAULT_STAFFING;
}

/** First mission each role starts with, so the company moves even before any LLM plans. */
export const KICKOFF: Partial<Record<RoleId, { title: string; why: string; tag: string }>> = {
  cofondateur: {
    title: "Write the company sheet and the plan for the first 30 days",
    why: "The whole team works from this sheet.",
    tag: "plan",
  },
  recherche: {
    title: "Market study: customers, competitors, prices",
    why: "We create nothing before we know there is room for it.",
    tag: "market-study",
  },
  prospection: {
    title: "List the first 50 qualified prospects",
    why: "So there are meetings booked before the launch.",
    tag: "prospects",
  },
  redaction: { title: "Write the website's home page", why: "It's the first thing customers will see.", tag: "site-home" },
  video: { title: "Write the script of the launch video", why: "Thirty seconds to make people want it.", tag: "video-script" },
  comptable: { title: "Prepare the 12-month forecast", why: "To know when the company starts making money.", tag: "forecast" },
};

const STAGE_RULES: readonly { to: Stage; when: (s: CompanyState) => boolean; reason: string }[] = [
  { to: "research", when: (s) => agentsWith(s, "cofondateur").length > 0, reason: "The team is studying the idea." },
  { to: "creation", when: (s) => tagDone(s, "market-study"), reason: "The market study is done: we're setting up the company." },
  { to: "launch", when: (s) => obligationDone(s, "B4-immatriculation"), reason: "The company is registered: we're preparing the launch." },
  { to: "operating", when: (s) => (s.sales?.length ?? 0) > 0 || tagDone(s, "first-sale"), reason: "First sale: the company is up and running." },
];

function obligationApplies(state: CompanyState, rule: ObligationRule): boolean {
  if (!reached(state, rule.opensAt)) return false;
  if (rule.forms) {
    const form = state.company?.legalForm;
    if (!form || !rule.forms.includes(form)) return false;
  }
  return (rule.requires ?? []).every((code) => obligationDone(state, code) || !requiredRuleApplies(state, code));
}

/** A requirement that can never open for this company (e.g. statuts for a micro-entreprise) does not block. */
function requiredRuleApplies(state: CompanyState, code: string): boolean {
  const rule = OBLIGATIONS.find((r) => r.code === code);
  if (!rule?.forms) return true;
  const form = state.company?.legalForm;
  return !form || rule.forms.includes(form);
}

function running(state: CompanyState): Task[] {
  return Object.values(state.tasks).filter((t) => t.status === "running");
}

/** Next decisions, in the order the engine should apply them. Idempotent: same state, same intents. */
export function decide(state: CompanyState, now: Timestamp): Intent[] {
  const company = state.company;
  if (!company || company.paused) return [];
  const intents: Intent[] = [];

  const office = nextOffice(state);
  if (office) intents.push({ type: "move-office", tier: office.tier });

  const nextStage = STAGE_RULES.find((r) => stageIndex(r.to) === stageIndex(company.stage) + 1);
  if (nextStage?.when(state)) intents.push({ type: "advance-stage", stage: nextStage.to, reason: nextStage.reason });

  const hiring = new Set<RoleId>();
  for (const entry of staffingOf(state)) {
    if (!hiring.has(entry.role) && agentsWith(state, entry.role).length === 0 && reached(state, entry.at)) {
      hiring.add(entry.role);
      intents.push({ type: "hire", role: entry.role, reason: entry.why });
    }
  }
  // Whoever a legal duty needs comes when it opens, even if the plan did not foresee them.
  for (const o of Object.values(state.obligations)) {
    if (o.status !== "open" || o.owner === "founder" || hiring.has(o.owner) || agentsWith(state, o.owner).length > 0) continue;
    hiring.add(o.owner);
    intents.push({ type: "hire", role: o.owner, reason: `Someone is needed to ${o.title.charAt(0).toLowerCase()}${o.title.slice(1)}.` });
  }

  for (const rule of OBLIGATIONS) {
    if (!obligationOpened(state, rule.code) && obligationApplies(state, rule)) {
      intents.push({ type: "open-obligation", rule, due: rule.dueInDays ? now + rule.dueInDays * DAY : undefined });
    }
  }

  for (const o of Object.values(state.obligations)) {
    if (o.status !== "open" || o.owner === "founder") continue;
    const done = Object.values(state.tasks).find((t) => t.tag === o.code && t.status === "done");
    if (done) {
      intents.push({ type: "fulfill-obligation", obligationId: o.id, by: done.agentId });
      continue;
    }
    const attempts = Object.values(state.tasks).filter((t) => t.tag === o.code);
    // The founder cancelled the last try: the team waits until told to take it back up.
    if (declinedByFounder(state, o)) continue;
    const covered = attempts.some((t) => t.status === "planned" || t.status === "running");
    // After the founder asks to try again, earlier failures no longer count.
    const failures = attempts.filter((t) => t.status === "failed" && !t.interrupted && (t.endedAt ?? 0) >= (o.retriedAt ?? 0)).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    const owner = agentsWith(state, o.owner)[0];
    if (!covered && owner && failures.length >= MAX_ATTEMPTS && !o.stuck) {
      intents.push({ type: "escalate", obligationId: o.id, error: failures.at(-1)?.error ?? "Unknown error." });
    }
    if (!covered && owner && failures.length < MAX_ATTEMPTS) {
      const lastFailure = Math.max(0, ...failures.map((t) => t.endedAt ?? 0));
      intents.push({
        type: "plan-task",
        draft: {
          agentId: owner.id,
          title: o.title,
          why: o.why,
          kind: obligationKind(o),
          tag: o.code,
          ...(failures.length ? { scheduledAt: lastFailure + 2 ** (failures.length - 1) * HOUR } : {}),
        },
      });
    }
  }

  for (const agent of Object.values(state.agents)) {
    const kickoff = KICKOFF[agent.role];
    if (kickoff && !Object.values(state.tasks).some((t) => t.agentId === agent.id && t.tag === kickoff.tag)) {
      intents.push({ type: "plan-task", draft: { agentId: agent.id, kind: "internal", ...kickoff } });
    }
  }

  // Past today's budget, nothing new starts; work resumes the next day or when the budget is raised.
  if (overBudget(state, now)) return intents;
  let slots = state.settings.concurrency - running(state).length;
  const busy = new Set(running(state).map((t) => t.agentId));
  for (const task of startable(state, now)) {
    if (slots <= 0) break;
    if (busy.has(task.agentId)) continue;
    intents.push({ type: "start-task", taskId: task.id });
    busy.add(task.agentId);
    slots -= 1;
  }
  return intents;
}

/** The latest try of this obligation was cancelled by the founder, after any "try again". */
export function declinedByFounder(state: CompanyState, o: Obligation): boolean {
  const tries = Object.values(state.tasks)
    .filter((t) => t.tag === o.code && (t.endedAt ?? t.createdAt) >= (o.retriedAt ?? 0))
    .sort((a, b) => (a.endedAt ?? a.createdAt) - (b.endedAt ?? b.createdAt));
  const last = tries.at(-1);
  return last?.status === "cancelled" && last.cancelledBy === "founder";
}

/** Credits spent on the day of `at` (Paris time). */
export function spentOn(state: CompanyState, at: Timestamp): number {
  return state.usage.byDay?.[dayKey(at)] ?? 0;
}

export function overBudget(state: CompanyState, now: Timestamp): boolean {
  return spentOn(state, now) >= state.settings.dailyBudgetCredits;
}

function obligationKind(o: Obligation): TaskKind {
  // Filing with an administration or publishing touches the outside world (French titles kept for older logs).
  return /annonce|immatricul|souscrire|plateforme|déposer|deposer|\bpublish\b|\bregister the\b|\btake out\b|\bplatform\b|\bfile form\b/i.test(o.title) ? "external" : "internal";
}

/** Planned tasks that may start now, oldest first. */
export function startable(state: CompanyState, now: Timestamp): Task[] {
  return Object.values(state.tasks)
    .filter((t) => t.status === "planned" && t.kind !== "founder")
    .filter((t) => t.scheduledAt <= now && (t.cancellableUntil ?? 0) <= now)
    .filter((t) => state.agents[t.agentId]?.status === "idle")
    .sort((a, b) => a.scheduledAt - b.scheduledAt || a.createdAt - b.createdAt);
}

export type GuardResult =
  | { ok: true; task: Omit<Task, "id"> }
  | { ok: false; reason: string };

/**
 * Turns a draft into a task the team may run. External actions wait for the cancel window,
 * topics in `alwaysAsk` always count as external, and only the founder does what the law reserves to them.
 */
export function guardTask(state: CompanyState, draft: TaskDraft, now: Timestamp): GuardResult {
  const agent = state.agents[draft.agentId];
  if (!agent) return { ok: false, reason: "Unknown agent." };
  if (draft.kind === "founder") return { ok: false, reason: "Only the entrepreneur can do this: it's an obligation, not a task." };
  const queued = Object.values(state.tasks).filter((t) => t.agentId === agent.id && t.status === "planned").length;
  if (queued >= MAX_PLANNED_PER_AGENT) return { ok: false, reason: `${agent.name} already has ${queued} tasks planned.` };

  const sensitive = (draft.tag !== undefined && state.settings.alwaysAsk.includes(draft.tag)) || reservedTopic(state, draft.title, draft.why) !== undefined;
  // The agent's own label is not trusted: what reads like leaving the company waits for the cancel window.
  const kind: TaskKind = sensitive || touchesOutside(draft.title) ? "external" : draft.kind;
  const scheduledAt = Math.max(draft.scheduledAt ?? now, now);
  const windowMs = state.settings.cancelWindowHours * HOUR * autonomyFactor(agent.autonomy);
  const task: Omit<Task, "id"> = {
    agentId: agent.id,
    title: draft.title,
    why: draft.why,
    kind,
    status: "planned",
    createdAt: now,
    scheduledAt,
    ...(draft.tag ? { tag: draft.tag } : {}),
    ...(draft.level ? { level: draft.level } : {}),
    ...(draft.parentId ? { parentId: draft.parentId } : {}),
    ...(kind === "external" ? { cancellableUntil: Math.max(scheduledAt, now + (sensitive ? state.settings.cancelWindowHours * HOUR : windowMs)) } : {}),
  };
  return { ok: true, task };
}

/** Topics the founder can keep for themself (Settings · Autonomy). Recognised from the task's words, English or French. */
export const ALWAYS_ASK: readonly { tag: string; label: string; words: RegExp }[] = [
  // Actions, not mentions: studying prices is research, changing them is the founder's call.
  // Patterns are written without accents: text is normalised first (JS \b ignores accented letters).
  // Agents write in English; the French alternatives stay for older logs.
  {
    tag: "prix",
    label: "Change prices",
    words: new RegExp(
      [
        /\b(changer|baisser|augmenter|relever|monter|modifier|fixer|appliquer|reduire|passer|ajuster|revoir)\b.{0,60}\b(prix|tarifs?|tarification)\b|\b(nouvelle|nouveaux?) (grille tarifaire|prix|tarifs?)\b|\bgrille tarifaire\b.{0,20}[+-]?\d|\b(remise|reduction|rabais|code promo|promotion de|soldes?)\b.{0,20}\d/.source,
        /\b(change|lower|raise|increase|decrease|cut|drop|reduce|adjust|update|modify|revise|apply|bump)\b.{0,60}\b(prices?|pricing|fees?)\b|\bset (the |our |a |new )?(prices?|pricing)\b|\bnew (price list|pricing|prices?)\b|\bprice list\b.{0,20}[+-]?\d|\b(discount|promo code|coupon|markdown)\b.{0,20}\d|\d+ ?(%|€|\$|euros?) (discount|off)\b/.source,
      ].join("|"),
    ),
  },
  {
    tag: "publicite-payante",
    label: "Paid advertising",
    words: new RegExp(
      [
        /\b(lancer|acheter|payer|financer|creer)\b.{0,40}\b(publicites?|pubs?|annonces? sponsorisees?)\b|\b(lancer|booster|sponsoriser|financer)\b.{0,40}\b(campagnes?|posts?|publications?|ads)\b.{0,40}(€|euros?|par (jour|mois))|\b(google|meta|facebook|instagram|tiktok|linkedin) ads\b|campagne (payante|sponsorisee)|\bsponsoriser\b|\bbooster\b.{0,40}(€|euros?)/.source,
        /\b(launch|buy|pay for|fund|run|create|start)\b.{0,40}\b(ads?|adverts?|advertisements?|advertising|sponsored posts?)\b|\b(boost|sponsor|promote|fund)\b.{0,40}\b(campaigns?|posts?)\b.{0,40}(€|\$|euros?|dollars?|(per|a) (day|week|month))|\bpaid (ads?|advertising|campaigns?|posts?)\b|\bsponsored (campaigns?|posts?|ads?)\b|\bboost(ing)?\b.{0,40}(€|\$|euros?|dollars?)/.source,
      ].join("|"),
    ),
  },
  {
    tag: "presse",
    label: "Talk to the press",
    words:
      /\b(contacter|ecrire|repondre|envoyer)\b.{0,30}\b(presse|journalistes?)\b|communique de presse|\binterview\b|\b(contact|email|e-mail|write to|reply to|respond to|answer|pitch|send)\b.{0,30}\b(press|journalists?|reporters?)\b|\bpress release\b/,
  },
  {
    tag: "contrat-client",
    label: "Sign a customer contract",
    words:
      /\bsigner\b.{0,30}\b(contrat|devis|bon de commande)\b|\benvoyer\b.{0,30}\b(contrat|devis)\b|\bsign\b.{0,30}\b(contracts?|quotes?|purchase orders?|agreements?)\b|\bsend\b.{0,30}\b(contracts?|quotes?)\b/,
  },
];

/** Acting on the outside world (not preparing it): send, publish, order, pay, call, file, put online. */
const OUTSIDE =
  /^\s*(envoyer|expedier|publier|poster|diffuser|commander|acheter|payer|regler|virer|appeler|telephoner|relancer|contacter|ecrire a|deposer|souscrire|signer|resilier|mettre en ligne|lancer la campagne|repondre a|send|ship|publish|post (a|an|the|on|to|our|it|them)|broadcast|order|buy|pay|transfer|wire|call|phone|follow up with|contact|write to|email|e-mail|file|submit|subscribe|take out|sign|terminate|put (.{0,40} )?online|go live|launch the campaign|reply to|respond to)\b/;
const PREPARING = /\b(brouillons?|preparer|rediger|projet de|ebauche|drafts?|drafting|prepare|preparing|outline)\b/;

export function touchesOutside(title: string): boolean {
  const text = plain(title);
  return OUTSIDE.test(text) && !PREPARING.test(text);
}

/** Lowercase, accents removed, so "Écrire" and "ecrire" are the same word for the rules. */
function plain(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** The reserved topic a task touches (title or reason), if the founder asked to be asked about it. */
export function reservedTopic(state: CompanyState, title: string, why = ""): string | undefined {
  const text = plain(`${title} ${why}`);
  return ALWAYS_ASK.find((t) => state.settings.alwaysAsk.includes(t.tag) && t.words.test(text))?.tag;
}

/** Trust shortens the window; the founder's setting stays the ceiling. */
function autonomyFactor(level: Agent["autonomy"]): number {
  return [1, 1, 0.5, 0.25][level - 1] ?? 1;
}

/** Mean of the Beta posterior: how reliable an agent has been so far. */
export function reliability(agent: Agent): number {
  return (agent.skill.success + 1) / (agent.skill.success + agent.skill.failure + 2);
}

/** Autonomy is earned: promote after enough work delivered reliably. */
export function earnedAutonomy(agent: Agent): Agent["autonomy"] {
  const done = agent.skill.success + agent.skill.failure;
  const r = reliability(agent);
  if (done >= 40 && r >= 0.95) return 4;
  if (done >= 20 && r >= 0.9) return 3;
  if (done >= 8 && r >= 0.8) return 2;
  return 1;
}

export function roleTitle(r: RoleId): string {
  return role(r).title;
}
