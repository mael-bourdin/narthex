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
  | { type: "start-task"; taskId: string };

/** What an agent (or a policy) asks for; `guardTask` turns it into a safe Task. */
export interface TaskDraft {
  agentId: string;
  title: string;
  why: string;
  kind: TaskKind;
  tag?: string;
  scheduledAt?: Timestamp;
  parentId?: string;
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
  { role: "cofondateur", at: "idea", why: "Je suis là dès la première idée." },
  { role: "recherche", at: "research", why: "Avant de créer quoi que ce soit, il faut connaître le marché." },
  { role: "juridique", at: "research", why: "Il faut vérifier le nom et l'activité, puis créer la société." },
  { role: "prospection", at: "creation", why: "L'étude est bonne : il est temps de trouver les premiers clients." },
  { role: "redaction", at: "creation", why: "Il faut un site et une voix avant le lancement." },
  { role: "video", at: "launch", why: "La société existe : on la fait connaître." },
  { role: "comptable", at: "launch", why: "La première facture arrive : la comptabilité doit être prête avant." },
  { role: "support", at: "operating", why: "Les premiers clients ont besoin de réponses rapides." },
];

export function staffingOf(state: CompanyState): readonly StaffingEntry[] {
  return state.staffing ?? DEFAULT_STAFFING;
}

/** First mission each role starts with, so the company moves even before any LLM plans. */
export const KICKOFF: Partial<Record<RoleId, { title: string; why: string; tag: string }>> = {
  cofondateur: {
    title: "Écrire la fiche de l'entreprise et le plan des 30 premiers jours",
    why: "Toute l'équipe travaille à partir de cette fiche.",
    tag: "plan",
  },
  recherche: {
    title: "Étude de marché : clientes, concurrents, prix",
    why: "On ne crée rien avant de savoir s'il y a de la place.",
    tag: "market-study",
  },
  prospection: {
    title: "Lister les 50 premiers prospects qualifiés",
    why: "Pour avoir des rendez-vous avant le lancement.",
    tag: "prospects",
  },
  redaction: { title: "Écrire la page d'accueil du site", why: "C'est la première chose que verront les clients.", tag: "site-home" },
  video: { title: "Écrire le script de la vidéo de lancement", why: "Trente secondes pour donner envie.", tag: "video-script" },
  comptable: { title: "Préparer le prévisionnel sur 12 mois", why: "Pour savoir quand on gagne de l'argent.", tag: "forecast" },
};

const STAGE_RULES: readonly { to: Stage; when: (s: CompanyState) => boolean; reason: string }[] = [
  { to: "research", when: (s) => agentsWith(s, "cofondateur").length > 0, reason: "L'équipe étudie l'idée." },
  { to: "creation", when: (s) => tagDone(s, "market-study"), reason: "L'étude de marché est faite : on crée la société." },
  { to: "launch", when: (s) => obligationDone(s, "B4-immatriculation"), reason: "La société est immatriculée : on prépare le lancement." },
  { to: "operating", when: (s) => tagDone(s, "first-sale"), reason: "Première vente : l'entreprise tourne." },
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
    intents.push({ type: "hire", role: o.owner, reason: `Il faut quelqu'un pour : ${o.title.charAt(0).toLowerCase()}${o.title.slice(1)}.` });
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
    const covered = attempts.some((t) => t.status === "planned" || t.status === "running");
    const failures = attempts.filter((t) => t.status === "failed");
    const owner = agentsWith(state, o.owner)[0];
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

/** Credits spent on the day of `at` (Paris time). */
export function spentOn(state: CompanyState, at: Timestamp): number {
  return state.usage.byDay?.[dayKey(at)] ?? 0;
}

export function overBudget(state: CompanyState, now: Timestamp): boolean {
  return spentOn(state, now) >= state.settings.dailyBudgetCredits;
}

function obligationKind(o: Obligation): TaskKind {
  // Filing with an administration or publishing touches the outside world.
  return /annonce|immatricul|souscrire|plateforme|déposer|deposer/i.test(o.title) ? "external" : "internal";
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
  if (!agent) return { ok: false, reason: "Agent inconnu." };
  if (draft.kind === "founder") return { ok: false, reason: "Seul l'entrepreneur peut faire cela : c'est une obligation, pas une tâche." };
  const queued = Object.values(state.tasks).filter((t) => t.agentId === agent.id && t.status === "planned").length;
  if (queued >= MAX_PLANNED_PER_AGENT) return { ok: false, reason: `${agent.name} a déjà ${queued} tâches prévues.` };

  const sensitive = (draft.tag !== undefined && state.settings.alwaysAsk.includes(draft.tag)) || reservedTopic(state, draft.title, draft.why) !== undefined;
  const kind: TaskKind = sensitive ? "external" : draft.kind;
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
    ...(draft.parentId ? { parentId: draft.parentId } : {}),
    ...(kind === "external" ? { cancellableUntil: Math.max(scheduledAt, now + (sensitive ? state.settings.cancelWindowHours * HOUR : windowMs)) } : {}),
  };
  return { ok: true, task };
}

/** Topics the founder can keep for themself (Réglages · Autonomie). Recognised from the task's words. */
export const ALWAYS_ASK: readonly { tag: string; label: string; words: RegExp }[] = [
  // Actions, not mentions: studying prices is research, changing them is the founder's call.
  // Patterns are written without accents: text is normalised first (JS \b ignores accented letters).
  { tag: "prix", label: "Changer les prix", words: /\b(changer|baisser|augmenter|modifier|fixer|appliquer|reduire)\b.{0,30}\b(prix|tarifs?)\b|\b(remise|code promo|promotion de)\b/ },
  { tag: "publicite-payante", label: "Publicité payante", words: /\b(lancer|acheter|payer|financer|creer)\b.{0,30}\b(publicites?|annonces? sponsorisees?)\b|campagne (payante|sponsorisee)|\bsponsoriser\b/ },
  { tag: "presse", label: "Parler à la presse", words: /\b(contacter|ecrire|repondre|envoyer)\b.{0,30}\b(presse|journalistes?)\b|communique de presse|\binterview\b/ },
  { tag: "contrat-client", label: "Signer un contrat client", words: /\bsigner\b.{0,30}\b(contrat|devis|bon de commande)\b|\benvoyer\b.{0,30}\b(contrat|devis)\b/ },
];

/** Lowercase, accents removed, so « Écrire » and « ecrire » are the same word for the rules. */
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
