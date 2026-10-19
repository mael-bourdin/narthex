import type {
  Agent,
  Company,
  Deliverable,
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
  | { type: "company.updated"; patch: Partial<Pick<Company, "name" | "city" | "legalForm">>; at: Timestamp }
  | { type: "company.paused"; at: Timestamp }
  | { type: "company.resumed"; at: Timestamp }
  | { type: "stage.changed"; stage: Stage; at: Timestamp }
  | { type: "staffing.planned"; staffing: StaffingEntry[] }
  | { type: "agent.hired"; agent: Agent; reason: string }
  | { type: "task.planned"; task: Task }
  | { type: "task.started"; taskId: Id; at: Timestamp }
  | { type: "task.progressed"; taskId: Id; note: string; at: Timestamp }
  | { type: "task.completed"; taskId: Id; at: Timestamp; deliverable?: Deliverable }
  | { type: "task.failed"; taskId: Id; at: Timestamp; error: string }
  | { type: "task.cancelled"; taskId: Id; at: Timestamp; by: "founder" | "team" }
  | { type: "post.published"; post: Post }
  | { type: "obligation.opened"; obligation: Obligation }
  | { type: "obligation.fulfilled"; obligationId: Id; at: Timestamp; by: "founder" | Id }
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
