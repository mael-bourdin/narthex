import type { Agent, CompanyState, FirstLook, RoleId, RuntimeName, Source, Task, TaskKind } from "@narthex/core";

/** What an agent asks to do next; the engine runs it through `guardTask` before anything is planned. */
export interface FollowUp {
  title: string;
  why: string;
  kind: TaskKind;
  tag?: string;
  /** Hours from now. */
  inHours?: number;
  /** Hand the work to a teammate with this role instead of doing it oneself. */
  assignee?: RoleId;
}

export interface WorkContext {
  state: CompanyState;
  agent: Agent;
  task: Task;
  now: number;
  signal: AbortSignal;
  /** Live progress shown in the Fil and the Bureau ("31 messages sur 46"). */
  progress(note: string): void;
  /** Plans a follow-up right away and returns why it was refused, if it was. */
  plan(followUp: FollowUp): string | null;
  /** Reports what a model call just cost. The engine counts it at once and stops the task past its budget. */
  spend(usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number }): void;
  /** What is left before this task stops: the smaller of its own budget and the day's. Optional for tests. */
  remainingCredits?(): number;
  /** Co-founder only: brings a teammate now. Returns why it was refused, if it was. */
  recruit(role: RoleId, why: string): string | null;
}

export interface WorkResult {
  /** What the agent says in the Fil, first person, one to three sentences. */
  post: string;
  deliverable?: { title: string; summary: string; body: string; sources: Source[] };
  /** New L1 company sheet (co-founder only). */
  memory?: string;
  /** Pages the agent really read (search results, fetched pages): the only links Narthex will check. */
  consulted?: string[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number };
}

/** What the memory extractor reads: one deliverable, and the facts already known around it. */
export interface FactsInput {
  deliverable: { title: string; summary: string; body: string };
  known: { id: string; text: string }[];
  now: number;
  signal: AbortSignal;
}

/** New facts, and the known ones this deliverable contradicts or updates (Mem0: ADD / UPDATE as invalidate + add). */
export interface FactsResult {
  added: { text: string; subject: string; importance: number; sensitive?: boolean }[];
  invalidated: string[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number };
}

/** End of day: every fact still true, to tidy (research: sleep-time consolidation). */
export interface ConsolidationInput {
  facts: { id: string; text: string; subject: string; importance: number; sensitive: boolean }[];
  now: number;
  signal: AbortSignal;
}

export interface ConsolidationResult {
  /** Several facts saying the same thing become one; the old ones are dated, not erased. */
  merged: { from: string[]; text: string; subject: string; importance: number; sensitive: boolean }[];
  /** Facts another, newer fact contradicts. */
  invalidated: string[];
  /** At most three insights that link several facts, with the facts they rest on. */
  reflections: { from: string[]; text: string; importance: number }[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number };
}

/** After a task, what happened, for the role's playbook (research: ACE reflection). */
export interface ReflectionInput {
  role: RoleId;
  task: { title: string; why: string; kind: TaskKind };
  outcome: "done" | "failed" | "cancelled";
  /** The agent's post or deliverable summary, the error, or the founder's cancel. */
  detail: string;
  lessons: { id: string; text: string }[];
  now: number;
  signal: AbortSignal;
}

export interface ReflectionResult {
  /** At most two new lessons. */
  add: string[];
  helpful: string[];
  harmful: string[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number };
}

/** On the team chat: a colleague answers a piece of work in one or two sentences. */
export interface RemarkInput {
  speaker: { name: string; role: RoleId };
  author: string;
  /** What the author shared (their post and the deliverable's summary). */
  text: string;
  company: string;
  signal: AbortSignal;
}

export interface RemarkResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number };
}

/** Something that can make an agent work: Claude, the offline simulation, or a test double. */
export interface AgentRuntime {
  readonly name: Exclude<RuntimeName, "none">;
  run(ctx: WorkContext): Promise<WorkResult>;
  /** Margaux's quick, sourced look at an idea during the first launch, before the company exists. */
  firstLook(input: { idea: string; founderName: string; now: number; signal: AbortSignal }): Promise<FirstLook>;
  /** L2 memory: facts from a finished deliverable, with a small model, off the critical path. Absent in simulation. */
  extractFacts?(input: FactsInput): Promise<FactsResult>;
  /** End-of-day tidying of L2 memory, with a small model. Absent in simulation. */
  consolidateFacts?(input: ConsolidationInput): Promise<ConsolidationResult>;
  /** L4: lessons for the role's playbook, with a small model. Absent in simulation. */
  reflect?(input: ReflectionInput): Promise<ReflectionResult>;
  /** Team chat: a short answer from a colleague, with a small model. Absent in simulation. */
  remark?(input: RemarkInput): Promise<RemarkResult>;
  /** Why nobody should start work right now (a subscription window nearly full), or undefined. Tasks wait, planned. */
  unavailable?(): string | undefined;
  /** How full the developer's Claude subscription is (claude-code runtime only). */
  subscription?(): SubscriptionUsage | undefined;
}

export interface SubscriptionUsage {
  status: string;
  /** Share used, 0 to 1, and when the window starts again (ms). */
  fiveHour?: { utilization: number; resetsAt: number };
  sevenDay?: { utilization: number; resetsAt: number };
}
