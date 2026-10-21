import type { StoredEvent } from "./events.ts";
import { filView, xpFor, type TeamRow } from "./fil.ts";
import { staffingOf } from "./policy.ts";
import { dayKey } from "./format.ts";
import { role, type RoleDef } from "./roles.ts";
import type { Agent, CompanyState, Id, Lesson, Obligation, RoleId, Stage, Task, Timestamp } from "./types.ts";
import { calendar, forFounder } from "./views.ts";

/** Read models of the Équipe tab. Pure, from real events only. */

const WHEN: Record<Stage, string> = {
  idea: "dès l'idée",
  research: "pendant l'étude",
  creation: "à la création de la société",
  launch: "au lancement",
  operating: "une fois l'entreprise en activité",
};

export interface OrgChart {
  founder: string;
  cofounder?: TeamRow;
  members: TeamRow[];
  upcoming: { role: RoleDef; why: string; when: string }[];
}

export function orgChart(state: CompanyState, now: Timestamp): OrgChart {
  const rows = filView(state, now).team;
  const planned = recruitments(state).planned;
  return {
    founder: state.company?.founder.name ?? "",
    ...(rows.find((r) => r.agent.role === "cofondateur") ? { cofounder: rows.find((r) => r.agent.role === "cofondateur")! } : {}),
    members: rows.filter((r) => r.agent.role !== "cofondateur"),
    upcoming: planned,
  };
}

export function recruitments(state: CompanyState): { arrived: { agent: Agent; title: string }[]; planned: { role: RoleDef; why: string; when: string }[] } {
  const agents = Object.values(state.agents).sort((a, b) => a.hiredAt - b.hiredAt);
  const hired = new Set(agents.map((a) => a.role));
  return {
    arrived: agents.map((agent) => ({ agent, title: role(agent.role).title })),
    planned: staffingOf(state)
      .filter((e) => !hired.has(e.role))
      .map((e) => ({ role: role(e.role), why: e.why, when: WHEN[e.at] })),
  };
}

export interface AgentSheet {
  agent: Agent;
  title: string;
  stats: { hoursThisWeek: number; xp: number; done: number; failed: number };
  current?: Task;
  next: Task[];
  finished: { task: Task; result?: string; deliverableId?: Id }[];
  sources: string[];
  /** The same sources, short: the site's name when there is a link (« insee.fr »), else the title. */
  sourceSites: string[];
  /** L4: what this role learnt from its work, most useful first. */
  lessons: Lesson[];
}

export function agentSheet(state: CompanyState, agentId: Id, now: Timestamp): AgentSheet {
  const agent = state.agents[agentId]!;
  const tasks = Object.values(state.tasks).filter((t) => t.agentId === agentId);
  const row = filView(state, now).team.find((r) => r.agent.id === agentId);
  const done = tasks.filter((t) => t.status === "done").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const deliverableOf = (t: Task) => (t.deliverableId ? state.deliverables[t.deliverableId] : undefined);
  const sources = [...new Set(done.flatMap((t) => deliverableOf(t)?.sources.map((s) => s.title) ?? []))];
  return {
    agent,
    title: role(agent.role).title,
    stats: {
      hoursThisWeek: row?.hoursThisWeek ?? 0,
      xp: done.reduce((sum, t) => sum + xpFor(t, deliverableOf(t)?.sources.length ?? 0), 0),
      done: done.length,
      failed: tasks.filter((t) => t.status === "failed").length,
    },
    ...(agent.currentTaskId && state.tasks[agent.currentTaskId] ? { current: state.tasks[agent.currentTaskId] } : {}),
    next: tasks.filter((t) => t.status === "planned").sort((a, b) => a.scheduledAt - b.scheduledAt),
    finished: done.map((task) => {
      const d = deliverableOf(task);
      return { task, ...(d ? { result: d.summary, deliverableId: d.id } : {}) };
    }),
    sources,
    sourceSites: [...new Set(done.flatMap((t) => deliverableOf(t)?.sources.map(siteOf) ?? []))],
    lessons: [...(state.playbooks?.[agent.role] ?? [])].sort((a, b) => b.helpful - b.harmful - (a.helpful - a.harmful) || b.learntAt - a.learntAt),
  };
}

function siteOf(source: { title: string; url?: string }): string {
  try {
    if (source.url) return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    // Not a URL: the title says it.
  }
  return source.title;
}

export interface JournalEntry {
  at: Timestamp;
  text: string;
  detail?: string;
  agentId?: Id;
  kind: "company" | "team" | "work" | "founder" | "problem";
}

const STAGE_NAME: Record<Stage, string> = { idea: "idée", research: "étude", creation: "création", launch: "lancement", operating: "en activité" };

/** The Journal: every meaningful event, as a sentence, newest first. */
export function journalEntries(state: CompanyState, events: readonly StoredEvent[]): JournalEntry[] {
  const name = (id?: string) => (id && state.agents[id]?.name) || "L'équipe";
  const title = (id: string) => state.tasks[id]?.title ?? "une tâche";
  const entries = events.flatMap((e): JournalEntry[] => {
    switch (e.type) {
      case "company.founded":
        return [{ at: e.ts, text: `${e.company.founder.name} a fondé ${e.company.name}`, kind: "company" }];
      case "agent.hired":
        return [{ at: e.ts, text: `${e.agent.name} rejoint l'équipe (${role(e.agent.role).title})`, detail: e.reason, agentId: e.agent.id, kind: "team" }];
      case "stage.changed":
        return [{ at: e.ts, text: `L'entreprise passe à l'étape « ${STAGE_NAME[e.stage]} »`, kind: "company" }];
      case "task.started": {
        const t = state.tasks[e.taskId];
        return [{ at: e.ts, text: `${name(t?.agentId)} commence « ${title(e.taskId)} »`, ...(t?.why ? { detail: t.why } : {}), ...(t ? { agentId: t.agentId } : {}), kind: "work" }];
      }
      case "task.completed": {
        const t = state.tasks[e.taskId];
        return [{ at: e.ts, text: `${name(t?.agentId)} a terminé « ${title(e.taskId)} »`, ...(e.deliverable ? { detail: e.deliverable.summary } : {}), ...(t ? { agentId: t.agentId } : {}), kind: "work" }];
      }
      case "task.failed": {
        const t = state.tasks[e.taskId];
        // Cut by closing Narthex: not the agent's failure, it will be taken up again.
        if (e.interrupted || e.error.startsWith("Interrompue (Narthex")) return [{ at: e.ts, text: `« ${title(e.taskId)} » interrompue, reprise plus tard`, detail: e.error, ...(t ? { agentId: t.agentId } : {}), kind: "work" }];
        return [{ at: e.ts, text: `« ${title(e.taskId)} » n'a pas abouti`, detail: e.error, ...(t ? { agentId: t.agentId } : {}), kind: "problem" }];
      }
      case "task.cancelled":
        return [{ at: e.ts, text: `${e.by === "founder" ? "Tu as annulé" : "L'équipe a annulé"} « ${title(e.taskId)} »`, kind: "founder" }];
      case "obligation.fulfilled":
        return [{ at: e.ts, text: e.by === "founder" ? `Tu as fait « ${state.obligations[e.obligationId]?.title ?? ""} »` : `Obligation remplie : « ${state.obligations[e.obligationId]?.title ?? ""} »`, kind: e.by === "founder" ? "founder" : "work", ...(e.by !== "founder" ? { agentId: e.by } : {}) }];
      case "sale.recorded":
        return [{ at: e.ts, text: `Tu as enregistré une vente${e.sale.amountCents !== undefined ? ` de ${(e.sale.amountCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""}${e.sale.note ? ` · ${e.sale.note}` : ""}`, kind: "founder" }];
      case "obligation.stuck":
        return [{ at: e.ts, text: `Bloqué sur « ${state.obligations[e.obligationId]?.title ?? ""} » : ${e.error}`, kind: "problem" }];
      case "obligation.retried":
        return [{ at: e.ts, text: `Tu as demandé de reprendre « ${state.obligations[e.obligationId]?.title ?? ""} »`, kind: "founder" }];
      case "company.paused":
        return [{ at: e.ts, text: "Équipe mise en pause", kind: "founder" }];
      case "company.resumed":
        return [{ at: e.ts, text: "L'équipe reprend", kind: "founder" }];
      default:
        return [];
    }
  });
  return entries.reverse();
}

/** The calendar's side card: how much of the shown period is work, done, running, and what waits for the founder. */
export interface CalendarSummary {
  total: number;
  done: number;
  running: number;
  /** Steps the law leaves to the founder, still open (they have no hour: they wait for the founder). */
  forYou: Obligation[];
}

export function calendarSummary(state: CompanyState, from: Timestamp, to: Timestamp, agentId?: string): CalendarSummary {
  const tasks = calendar(state, from, to, agentId);
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    running: tasks.filter((t) => t.status === "running").length,
    forYou: agentId ? [] : forFounder(state),
  };
}

export interface JournalSummary {
  total: number;
  /** Entries of the current Paris day, and how many agents they involve. */
  today: number;
  todayAgents: number;
  cancelledByYou: number;
  /** Entries per role of the agent involved, most active first. */
  byRole: { role: RoleId; title: string; count: number }[];
}

export function journalSummary(state: CompanyState, entries: readonly JournalEntry[], now: Timestamp): JournalSummary {
  const today = entries.filter((e) => dayKey(e.at) === dayKey(now));
  const counts = new Map<RoleId, number>();
  for (const e of entries) {
    const r = e.agentId ? state.agents[e.agentId]?.role : undefined;
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return {
    total: entries.length,
    today: today.length,
    todayAgents: new Set(today.flatMap((e) => (e.agentId ? [e.agentId] : []))).size,
    cancelledByYou: Object.values(state.tasks).filter((t) => t.status === "cancelled" && t.cancelledBy === "founder").length,
    byRole: [...counts].map(([r, count]) => ({ role: r, title: role(r).title, count })).sort((a, b) => b.count - a.count),
  };
}
