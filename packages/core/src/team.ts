import type { StoredEvent } from "./events.ts";
import { filView, xpFor, type TeamRow } from "./fil.ts";
import { staffingOf } from "./policy.ts";
import { role, type RoleDef } from "./roles.ts";
import type { Agent, CompanyState, Id, Stage, Task, Timestamp } from "./types.ts";

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
  };
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
        return [{ at: e.ts, text: `« ${title(e.taskId)} » n'a pas abouti`, detail: e.error, ...(t ? { agentId: t.agentId } : {}), kind: "problem" }];
      }
      case "task.cancelled":
        return [{ at: e.ts, text: `${e.by === "founder" ? "Tu as annulé" : "L'équipe a annulé"} « ${title(e.taskId)} »`, kind: "founder" }];
      case "obligation.fulfilled":
        return [{ at: e.ts, text: `${e.by === "founder" ? "Tu as fait" : `${name(e.by)} a fait`} « ${state.obligations[e.obligationId]?.title ?? ""} »`, kind: e.by === "founder" ? "founder" : "work", ...(e.by !== "founder" ? { agentId: e.by } : {}) }];
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
