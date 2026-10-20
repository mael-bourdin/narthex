import type { DomainEvent, StoredEvent } from "./events.ts";
import { dayKey } from "./format.ts";
import { DEFAULT_SETTINGS, type CompanyState, type Task } from "./types.ts";

export function emptyState(): CompanyState {
  return {
    agents: {},
    tasks: {},
    deliverables: {},
    posts: [],
    obligations: {},
    settings: { ...DEFAULT_SETTINGS },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: 0, byDay: {} },
    memory: "",
    facts: {},
    lastSeq: 0,
  };
}

/**
 * The only reducer. Pure and total: unknown ids are ignored rather than thrown on,
 * so a log written by a newer version still replays.
 */
export function apply(state: CompanyState, event: DomainEvent | StoredEvent): CompanyState {
  // A newer version's event this one does not know is skipped, never thrown on.
  const reduced = reduce(state, event) ?? state;
  if (!("seq" in event)) return reduced;
  return { ...reduced, lastSeq: event.seq };
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
  // Finishing some other task (e.g. one recorded at founding) never frees an agent at work.
  if (!working && agent.currentTaskId && agent.currentTaskId !== taskId) return state;
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
      return { ...state, company: event.company, settings: { ...DEFAULT_SETTINGS, ...event.settings } };
    case "company.updated": {
      if (!state.company) return state;
      const { founderName, ...patch } = event.patch;
      return { ...state, company: { ...state.company, ...patch, ...(founderName ? { founder: { ...state.company.founder, name: founderName } } : {}) } };
    }
    case "company.paused":
      return state.company ? { ...state, company: { ...state.company, paused: true } } : state;
    case "company.resumed":
      return state.company ? { ...state, company: { ...state.company, paused: false } } : state;
    case "stage.changed":
      return state.company ? { ...state, company: { ...state.company, stage: event.stage } } : state;
    case "staffing.planned":
      return { ...state, staffing: event.staffing };
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
    case "task.failed": {
      const next = setAgentWork(patchTask(state, event.taskId, { status: "failed", endedAt: event.at, error: event.error, ...(event.interrupted ? { interrupted: true } : {}) }), event.taskId, false);
      return event.interrupted ? next : scoreAgent(next, event.taskId, false);
    }
    case "task.cancelled": {
      const wasRunning = state.tasks[event.taskId]?.status === "running";
      const next = patchTask(state, event.taskId, { status: "cancelled", endedAt: event.at, cancelledBy: event.by });
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
    case "playbook.updated":
      return { ...state, playbooks: { ...state.playbooks, [event.role]: event.lessons } };
    case "facts.forgotten": {
      const facts = { ...state.facts };
      for (const id of event.factIds) delete facts[id];
      return { ...state, facts };
    }
    case "sale.recorded":
      return { ...state, sales: [...(state.sales ?? []), event.sale] };
    case "facts.extracted":
    case "facts.consolidated": {
      const facts = { ...state.facts };
      for (const id of event.invalidated) if (facts[id] && !facts[id]!.invalidAt) facts[id] = { ...facts[id]!, invalidAt: event.at };
      for (const f of event.added) facts[f.id] = f;
      return { ...state, facts, ...(event.type === "facts.consolidated" ? { consolidatedThrough: event.day } : {}) };
    }
    case "sources.checked": {
      const d = state.deliverables[event.deliverableId];
      if (!d) return state;
      const ok = new Map(event.results.map((r) => [r.url, r.ok]));
      const sources = d.sources.map((s) => (s.url && ok.has(s.url) ? { ...s, reachable: ok.get(s.url)! } : s));
      return { ...state, deliverables: { ...state.deliverables, [d.id]: { ...d, sources, linksCheckedAt: event.at } } };
    }
    case "obligation.stuck": {
      const o = state.obligations[event.obligationId];
      if (!o) return state;
      return { ...state, obligations: { ...state.obligations, [o.id]: { ...o, stuck: { at: event.at, error: event.error } } } };
    }
    case "obligation.retried": {
      const o = state.obligations[event.obligationId];
      if (!o) return state;
      const { stuck: _stuck, ...rest } = o;
      return { ...state, obligations: { ...state.obligations, [o.id]: { ...rest, retriedAt: event.at } } };
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
          byDay:
            event.at === undefined
              ? state.usage.byDay
              : { ...state.usage.byDay, [dayKey(event.at)]: (state.usage.byDay?.[dayKey(event.at)] ?? 0) + event.credits },
        },
      };
    default:
      return state;
  }
}
