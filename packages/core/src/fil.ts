import { HIRING } from "./policy.ts";
import { OBLIGATIONS } from "./obligations.ts";
import { role, type RoleDef } from "./roles.ts";
import { forFounder } from "./views.ts";
import type { Agent, CompanyState, Deliverable, Obligation, Post, Stage, Task, Timestamp } from "./types.ts";

/**
 * Everything the Fil shows, computed from what really happened. Shared by the app and the CLI.
 * Nothing here is invented: durations come from task events, XP from a written rule, sources from deliverables.
 */

/** XP rule: 30 for finished work, +10 per source (up to 6), +40 when it touched the outside world. */
export function xpFor(task: Pick<Task, "kind">, sources: number): number {
  return 30 + 10 * Math.min(sources, 6) + (task.kind === "external" ? 40 : 0);
}

export interface FilItem {
  post: Post;
  agent?: Agent;
  task?: Task;
  deliverable?: Deliverable;
  /** Real time the work took, when the post reports finished work. */
  durationMs?: number;
  xp?: number;
  sources: string[];
}

export interface TeamRow {
  agent: Agent;
  title: string;
  status: "working" | "idle" | "waiting-you";
  current?: Task;
  hoursThisWeek: number;
}

export interface Quest {
  title: string;
  done: number;
  total: number;
  next?: string;
}

export interface FilView {
  /** What only the founder can do, the most urgent first, with who explains it. */
  legal: { obligation: Obligation; speaker?: Agent }[];
  pilot: { running: number; next?: { title: string; at: Timestamp; agentId: string } };
  items: FilItem[];
  team: TeamRow[];
  upcoming?: RoleDef;
  quest?: Quest;
}

const WEEK = 7 * 24 * 3_600_000;

const QUEST_TITLE: Record<Stage, (s: CompanyState) => string | undefined> = {
  idea: () => undefined,
  research: () => "Valider ton idée",
  creation: (s) => `Créer ta ${s.company?.legalForm ?? "société"}`,
  launch: () => "Préparer le lancement",
  operating: () => undefined,
};

export function filView(state: CompanyState, now: Timestamp, limit = 60): FilView {
  const tasks = Object.values(state.tasks);
  const agents = Object.values(state.agents).sort((a, b) => a.hiredAt - b.hiredAt);
  const legalSpeaker = agents.find((a) => a.role === "juridique") ?? agents.find((a) => a.role === "cofondateur");
  const founderOpen = forFounder(state);

  const items = state.posts
    .map((post, index) => ({ post, index }))
    .sort((a, b) => b.post.at - a.post.at || b.index - a.index)
    .slice(0, limit)
    .map(({ post }): FilItem => {
      const task = post.taskId ? state.tasks[post.taskId] : undefined;
      const deliverable = post.deliverableId ? state.deliverables[post.deliverableId] : undefined;
      const sources = deliverable?.sources.map((s) => s.title) ?? [];
      const finished = task?.status === "done" && post.kind === "deliverable";
      return {
        post,
        agent: state.agents[post.agentId],
        task,
        deliverable,
        sources,
        ...(finished && task.startedAt && task.endedAt ? { durationMs: task.endedAt - task.startedAt } : {}),
        ...(finished ? { xp: xpFor(task, sources.length) } : {}),
      };
    });

  const running = tasks.filter((t) => t.status === "running");
  const next = tasks
    .filter((t) => t.status === "planned" && t.kind !== "founder")
    .map((t) => ({ title: t.title, at: Math.max(t.scheduledAt, t.cancellableUntil ?? 0), agentId: t.agentId }))
    .sort((a, b) => a.at - b.at)[0];

  const team = agents.map((agent): TeamRow => {
    const worked = tasks
      .filter((t) => t.agentId === agent.id && t.startedAt !== undefined)
      .reduce((ms, t) => {
        const end = t.endedAt ?? (t.status === "running" ? now : t.startedAt!);
        return ms + Math.max(0, end - Math.max(t.startedAt!, now - WEEK));
      }, 0);
    const waiting = founderOpen.length > 0 && agent.id === legalSpeaker?.id && agent.status !== "working";
    return {
      agent,
      title: role(agent.role).title,
      status: agent.status === "working" ? "working" : waiting ? "waiting-you" : "idle",
      ...(agent.currentTaskId && state.tasks[agent.currentTaskId] ? { current: state.tasks[agent.currentTaskId] } : {}),
      hoursThisWeek: Math.round((worked / 3_600_000) * 10) / 10,
    };
  });

  const hired = new Set(agents.map((a) => a.role));
  const upcoming = HIRING.find((h) => !hired.has(h.role));

  return {
    legal: founderOpen.map((obligation) => ({ obligation, ...(legalSpeaker ? { speaker: legalSpeaker } : {}) })),
    pilot: { running: running.length, ...(next ? { next } : {}) },
    items,
    team,
    ...(upcoming ? { upcoming: role(upcoming.role) } : {}),
    ...questOf(state),
  };
}

function questOf(state: CompanyState): { quest?: Quest } {
  const stage = state.company?.stage;
  if (!stage) return {};
  const title = QUEST_TITLE[stage](state);
  if (!title) return {};
  const codes = new Set(OBLIGATIONS.filter((r) => r.opensAt === stage).map((r) => r.code));
  const steps: { title: string; done: boolean; due?: number }[] = Object.values(state.obligations)
    .filter((o) => codes.has(o.code))
    .map((o) => ({ title: o.title, done: o.status === "done", ...(o.due ? { due: o.due } : {}) }));
  if (stage === "research") {
    const study = Object.values(state.tasks).some((t) => t.tag === "market-study" && t.status === "done");
    steps.push({ title: "Étude de marché", done: study });
  }
  if (steps.length === 0) return {};
  const next = steps.filter((s) => !s.done).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity))[0];
  return { quest: { title, done: steps.filter((s) => s.done).length, total: steps.length, ...(next ? { next: next.title } : {}) } };
}

