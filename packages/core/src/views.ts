import { role } from "./roles.ts";
import { reliability } from "./policy.ts";
import type { Agent, CompanyState, Deliverable, Obligation, Post, Task, Timestamp } from "./types.ts";

/** Read models shared by every client. Pure selectors over `CompanyState`. */

export interface FeedItem {
  post: Post;
  agent?: Agent;
  deliverable?: Deliverable;
  task?: Task;
}

/** The Fil: newest first. Posts made in the same instant keep the order they were written in. */
export function feed(state: CompanyState, limit = 50): FeedItem[] {
  return state.posts
    .map((post, index) => ({ post, index }))
    .sort((a, b) => b.post.at - a.post.at || b.index - a.index)
    .slice(0, limit)
    .map(({ post }) => ({
      post,
      agent: state.agents[post.agentId],
      deliverable: post.deliverableId ? state.deliverables[post.deliverableId] : undefined,
      task: post.taskId ? state.tasks[post.taskId] : undefined,
    }));
}

export interface TeamMember {
  agent: Agent;
  title: string;
  current?: Task;
  next?: Task;
  done: number;
  reliability: number;
}

export function team(state: CompanyState): TeamMember[] {
  return Object.values(state.agents)
    .sort((a, b) => a.hiredAt - b.hiredAt)
    .map((agent) => {
      const tasks = Object.values(state.tasks).filter((t) => t.agentId === agent.id);
      return {
        agent,
        title: role(agent.role).title,
        current: agent.currentTaskId ? state.tasks[agent.currentTaskId] : undefined,
        next: tasks.filter((t) => t.status === "planned").sort((a, b) => a.scheduledAt - b.scheduledAt)[0],
        done: tasks.filter((t) => t.status === "done").length,
        reliability: reliability(agent),
      };
    });
}

/** Calendar: tasks whose time falls in [from, to), optionally for one agent. */
export function calendar(state: CompanyState, from: Timestamp, to: Timestamp, agentId?: string): Task[] {
  return Object.values(state.tasks)
    .filter((t) => t.status !== "cancelled")
    .filter((t) => !agentId || t.agentId === agentId)
    .filter((t) => {
      const at = t.startedAt ?? t.scheduledAt;
      return at >= from && at < to;
    })
    .sort((a, b) => (a.startedAt ?? a.scheduledAt) - (b.startedAt ?? b.scheduledAt));
}

/** What only the founder can do, most urgent first. */
export function forFounder(state: CompanyState): Obligation[] {
  return Object.values(state.obligations)
    .filter((o) => o.owner === "founder" && o.status === "open")
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
}

/** External actions the founder can still cancel. */
export function cancellable(state: CompanyState, now: Timestamp): Task[] {
  return Object.values(state.tasks)
    .filter((t) => t.status === "planned" && t.kind === "external" && (t.cancellableUntil ?? 0) > now)
    .sort((a, b) => (a.cancellableUntil ?? 0) - (b.cancellableUntil ?? 0));
}
