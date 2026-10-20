import type {
  Agent,
  Company,
  Deliverable,
  Fact,
  Lesson,
  RoleId,
  Sale,
  Id,
  Obligation,
  Post,
  Settings,
  Stage,
  StaffingEntry,
  Task,
  Timestamp,
} from "./types.ts";

/**
 * Every state change is one of these events, appended to the company's log.
 * Events are facts in the past tense; they are never edited or deleted.
 */
export type DomainEvent =
  | { type: "company.founded"; company: Company; settings: Settings }
  | { type: "company.updated"; patch: Partial<Pick<Company, "name" | "city" | "legalForm">> & { founderName?: string }; at: Timestamp }
  | { type: "company.paused"; at: Timestamp }
  | { type: "company.resumed"; at: Timestamp }
  | { type: "stage.changed"; stage: Stage; at: Timestamp }
  | { type: "staffing.planned"; staffing: StaffingEntry[] }
  | { type: "agent.hired"; agent: Agent; reason: string }
  | { type: "task.planned"; task: Task }
  | { type: "task.started"; taskId: Id; at: Timestamp }
  | { type: "task.progressed"; taskId: Id; note: string; at: Timestamp }
  | { type: "task.completed"; taskId: Id; at: Timestamp; deliverable?: Deliverable }
  /** `interrupted`: Narthex was closed mid-task; not the agent's failure, not an attempt. */
  | { type: "task.failed"; taskId: Id; at: Timestamp; error: string; interrupted?: boolean }
  | { type: "clock.advanced"; hours: number; at: Timestamp }
  | { type: "task.cancelled"; taskId: Id; at: Timestamp; by: "founder" | "team" }
  | { type: "post.published"; post: Post }
  | { type: "obligation.opened"; obligation: Obligation }
  | { type: "obligation.fulfilled"; obligationId: Id; at: Timestamp; by: "founder" | Id }
  | { type: "sale.recorded"; sale: Sale }
  /** The team moved to a better office (the Bureau's next level). */
  | { type: "office.moved"; tier: 0 | 1 | 2 | 3 | 4; at: Timestamp }
  /** RGPD erasure: these facts are gone, and their text was erased from the log itself. */
  | { type: "facts.forgotten"; factIds: Id[]; at: Timestamp }
  /** The whole curated playbook of a role after a reflection on one task. */
  | { type: "playbook.updated"; role: RoleId; lessons: Lesson[]; taskId?: Id; at: Timestamp }
  /** End of a Paris day: duplicates merged, stale facts dated, reflections added (`day` = the day tidied). */
  | { type: "facts.consolidated"; day: string; at: Timestamp; added: Fact[]; invalidated: Id[] }
  | { type: "facts.extracted"; deliverableId: Id; at: Timestamp; added: Fact[]; invalidated: Id[] }
  | { type: "sources.checked"; deliverableId: Id; at: Timestamp; results: { url: string; ok: boolean }[] }
  | { type: "obligation.stuck"; obligationId: Id; at: Timestamp; error: string }
  | { type: "obligation.retried"; obligationId: Id; at: Timestamp }
  | { type: "settings.changed"; patch: Partial<Settings>; at: Timestamp }
  | { type: "memory.updated"; memory: string; at: Timestamp }
  | {
      type: "usage.recorded";
      agentId: Id;
      taskId?: Id;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      credits: number;
      /** When it was spent (counts toward that day's budget). */
      at?: Timestamp;
    };

export type EventType = DomainEvent["type"];

export type StoredEvent = DomainEvent & { companyId: Id; seq: number; ts: Timestamp };
