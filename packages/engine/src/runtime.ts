import type { Agent, CompanyState, RoleId, Source, Task, TaskKind } from "@narthex/core";

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
}

export interface WorkResult {
  /** What the agent says in the Fil, first person, one to three sentences. */
  post: string;
  deliverable?: { title: string; summary: string; body: string; sources: Source[] };
  /** New L1 company sheet (co-founder only). */
  memory?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number };
}

/** Something that can make an agent work: Claude, the offline simulation, or a test double. */
export interface AgentRuntime {
  readonly name: "simulation" | "anthropic";
  run(ctx: WorkContext): Promise<WorkResult>;
}
