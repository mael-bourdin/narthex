import type { DomainEvent, StoredEvent } from "./events.ts";
import { DEFAULT_SETTINGS, type CompanyState, type Task } from "./types.ts";

export function emptyState(): CompanyState {
  return {
    agents: {},
    tasks: {},
    deliverables: {},
    posts: [],
    obligations: {},
    settings: { ...DEFAULT_SETTINGS },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0 },
    memory: "",
    lastSeq: 0,
  };
}

/**
 * The only reducer. Pure and total: unknown ids are ignored rather than thrown on,
 * so a log written by a newer version still replays.
 */
export function apply(state: CompanyState, event: DomainEvent | StoredEvent): CompanyState {
  const next = reduce(state, event);
  if ("seq" in event) next.lastSeq = event.seq;
  return next;
}

export function replay(events: Iterable<DomainEvent | StoredEvent>, from: CompanyState = emptyState()): CompanyState {
  let state = from;
  for (const event of events) state = apply(state, event);
  return state;
}

function patchTask(state: CompanyState, id: string, patch: Partial<Task>): CompanyState {
  const task = state.tasks[id];
  if (!task) return state;
  return { ...state, tasks: { ...state.tasks, [id]: { ...task, ...patch } } };
}

function setAgentWork(state: CompanyState, taskId: string, working: boolean): CompanyState {
  const task = state.tasks[taskId];
  const agent = task && state.agents[task.agentId];
  if (!task || !agent) return state;
  const updated = working
    ? { ...agent, status: "working" as const, currentTaskId: taskId }
    : { ...agent, status: "idle" as const, currentTaskId: undefined };
  return { ...state, agents: { ...state.agents, [agent.id]: updated } };
}

function scoreAgent(state: CompanyState, taskId: string, ok: boolean): CompanyState {
  const task = state.tasks[taskId];
  const agent = task && state.agents[task.agentId];
  if (!task || !agent) return state;
  const skill = ok
    ? { ...agent.skill, success: agent.skill.success + 1 }
    : { ...agent.skill, failure: agent.skill.failure + 1 };
  return { ...state, agents: { ...state.agents, [agent.id]: { ...agent, skill } } };
}

function reduce(state: CompanyState, event: DomainEvent): CompanyState {
  switch (event.type) {
    case "company.founded":
      return { ...state, company: event.company, settings: { ...event.settings } };
    case "company.updated":
      return state.company ? { ...state, company: { ...state.company, ...event.patch } } : state;
    case "company.paused":
      return state.company ? { ...state, company: { ...state.company, paused: true } } : state;
    case "company.resumed":
      return state.company ? { ...state, company: { ...state.company, paused: false } } : state;
    case "stage.changed":
      return state.company ? { ...state, company: { ...state.company, stage: event.stage } } : state;
    case "agent.hired":
      return { ...state, agents: { ...state.agents, [event.agent.id]: event.agent } };
    case "task.planned":
      return { ...state, tasks: { ...state.tasks, [event.task.id]: event.task } };
    case "task.started":
      return setAgentWork(patchTask(state, event.taskId, { status: "running", startedAt: event.at }), event.taskId, true);
    case "task.progressed":
      return patchTask(state, event.taskId, { progress: event.note });
    case "task.completed": {
      let next = patchTask(state, event.taskId, {
        status: "done",
        endedAt: event.at,
        deliverableId: event.deliverable?.id,
      });
      if (event.deliverable) {
        next = { ...next, deliverables: { ...next.deliverables, [event.deliverable.id]: event.deliverable } };
      }
      return scoreAgent(setAgentWork(next, event.taskId, false), event.taskId, true);
    }
    case "task.failed":
      return scoreAgent(
        setAgentWork(patchTask(state, event.taskId, { status: "failed", endedAt: event.at, error: event.error }), event.taskId, false),
        event.taskId,
        false,
      );
    case "task.cancelled": {
      const wasRunning = state.tasks[event.taskId]?.status === "running";
      const next = patchTask(state, event.taskId, { status: "cancelled", endedAt: event.at });
      return wasRunning ? setAgentWork(next, event.taskId, false) : next;
    }
    case "post.published":
      return { ...state, posts: [...state.posts, event.post] };
    case "obligation.opened":
      return { ...state, obligations: { ...state.obligations, [event.obligation.id]: event.obligation } };
    case "obligation.fulfilled": {
      const o = state.obligations[event.obligationId];
      if (!o) return state;
      return { ...state, obligations: { ...state.obligations, [o.id]: { ...o, status: "done", doneAt: event.at } } };
    }
    case "settings.changed":
      return { ...state, settings: { ...state.settings, ...event.patch } };
    case "memory.updated":
      return { ...state, memory: event.memory };
    case "usage.recorded":
      return {
        ...state,
        usage: {
          inputTokens: state.usage.inputTokens + event.inputTokens,
          outputTokens: state.usage.outputTokens + event.outputTokens,
          cacheReadTokens: state.usage.cacheReadTokens + event.cacheReadTokens,
          credits: state.usage.credits + event.credits,
        },
      };
  }
}
