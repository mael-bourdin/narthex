import type { Agent, CompanyState, FirstLook, RoleId, Source, Task, TaskKind } from "@narthex/core";

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
  /** Co-founder only: brings a teammate now. Returns why it was refused, if it was. */
  recruit(role: RoleId, why: string): string | null;
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
  /** Margaux's quick, sourced look at an idea during the first launch, before the company exists. */
  firstLook(input: { idea: string; founderName: string; now: number; signal: AbortSignal }): Promise<FirstLook>;
}
