import type { StoredEvent } from "./events.ts";
import type { FirstLook } from "./onboarding.ts";
import type { CompanyState, Id, LegalForm, Settings } from "./types.ts";

/**
 * The engine's API. Every client (CLI, desktop, a future web app) speaks only this,
 * over JSON lines on a local socket or in-process. Add a method here, then handle it in `Engine.handle`.
 */
export interface Methods {
  "engine.status": { params: Record<string, never>; result: EngineStatus };
  "company.found": { params: FoundParams; result: CompanyState };
  "company.pause": { params: Record<string, never>; result: CompanyState };
  "company.update": { params: { name?: string; city?: string; founderName?: string }; result: CompanyState };
  "company.resume": { params: Record<string, never>; result: CompanyState };
  "state.get": { params: Record<string, never>; result: CompanyState | null };
  "events.read": { params: { afterSeq?: number; limit?: number }; result: StoredEvent[] };
  "task.cancel": { params: { taskId: Id }; result: CompanyState };
  "obligation.fulfill": { params: { obligationId: Id; legalForm?: LegalForm }; result: CompanyState };
  "settings.update": { params: { patch: Partial<Settings> }; result: CompanyState };
  "clock.advance": { params: { hours: number }; result: EngineStatus };
  /** Margaux's quick, sourced look at an idea, before the company exists. Never throws. */
  "onboarding.firstLook": { params: { idea: string; founderName: string }; result: FirstLook };
}

export type Method = keyof Methods;
export type Params<M extends Method> = Methods[M]["params"];
export type Result<M extends Method> = Methods[M]["result"];

export interface FoundParams {
  name: string;
  idea: string;
  founderName: string;
  city?: string;
  /** Recorded at founding as Margaux's first deliverable, with its credits. */
  firstLook?: FirstLook;
}

export interface EngineStatus {
  version: string;
  /** "anthropic" calls Claude with the player's key; "none" means no key yet (nobody works);
   * "simulation" runs scripted agents offline, for development and tests only. */
  runtime: "simulation" | "anthropic" | "none";
  /** Simulated clock in simulation mode, wall clock otherwise. */
  now: number;
  companyId: Id | null;
  running: number;
  /** True when nobody is running the company: actions are recorded, agents wait for `narthex lancer`. */
  passive: boolean;
}

export interface RpcRequest<M extends Method = Method> {
  id: number;
  method: M;
  params: Params<M>;
}

export type RpcResponse<M extends Method = Method> =
  | { id: number; result: Result<M> }
  | { id: number; error: { message: string; code?: string } };

/** Pushed by the engine to every connected client after each appended event. */
export interface RpcNotification {
  event: StoredEvent;
}

export const PROTOCOL_VERSION = 1;
