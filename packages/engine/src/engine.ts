import {
  apply,
  decide,
  emptyState,
  fmt,
  guardTask,
  replay,
  role,
  type Agent,
  type CompanyState,
  type DomainEvent,
  type EngineStatus,
  type Intent,
  type Method,
  type Params,
  type PostKind,
  type Result,
  type RoleId,
  type StoredEvent,
  type TaskDraft,
} from "@narthex/core";
import { SimulatedClock, systemClock, type Clock } from "./clock.ts";
import { newId } from "./ids.ts";
import type { AgentRuntime, FollowUp } from "./runtime.ts";
import type { EventStore } from "./store.ts";

export const ENGINE_VERSION = "0.1.0";

export interface EngineOptions {
  store: EventStore;
  runtime: AgentRuntime;
  clock?: Clock;
  /** How often the company checks what to do next. */
  tickMs?: number;
  /**
   * Passive engines record the founder's actions but never put agents to work.
   * Used by one-shot CLI commands when no `narthex lancer` is running.
   */
  passive?: boolean;
}

type Listener = (event: StoredEvent) => void;

/**
 * One company, running. The engine owns the event log and the projected state;
 * `policy.decide` says what to do, runtimes do the work, everything is an event.
 */
export class Engine {
  private readonly store: EventStore;
  private runtime: AgentRuntime;
  private clock: Clock;
  private readonly tickMs: number;
  private readonly passive: boolean;
  private readonly listeners = new Set<Listener>();
  private readonly work = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private state: CompanyState = emptyState();
  private companyId: string | null;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.runtime = options.runtime;
    this.clock = options.clock ?? systemClock;
    this.tickMs = options.tickMs ?? 5_000;
    this.passive = options.passive ?? false;
    this.companyId = this.store.companies()[0] ?? null;
    if (this.companyId) this.state = replay(this.store.read(this.companyId));
    // Work interrupted by a crash or a quit is recorded as such, never silently lost.
    if (!this.passive) for (const task of Object.values(this.state.tasks)) {
      if (task.status === "running") this.emit({ type: "task.failed", taskId: task.id, at: this.now(), error: "Interrompue (Narthex a été fermé)." });
    }
  }

  // ---------- Lifecycle ----------

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
    this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.idle();
  }

  /** Changes who does the work (e.g. a key was just given during the first launch). Only before founding. */
  switchRuntime(runtime: AgentRuntime, clock: Clock): void {
    if (this.state.company) throw new Error("L'entreprise existe déjà : relance Narthex pour changer de mode.");
    this.runtime = runtime;
    this.clock = clock;
  }

  /** Stops and releases the event store. */
  async close(): Promise<void> {
    await this.stop();
    this.store.close();
  }

  /** Aborts every agent at work; their tasks are recorded as interrupted on next start. */
  abortAll(): void {
    for (const w of this.work.values()) w.controller.abort();
  }

  /** Resolves when no agent is working (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.work.size > 0) await Promise.all([...this.work.values()].map((w) => w.done));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): CompanyState {
    return this.state;
  }

  now(): number {
    return this.clock.now();
  }

  // ---------- API ----------

  async handle<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    return (await this.dispatch(method, params as never)) as Result<M>;
  }

  private async dispatch(method: Method, params: unknown): Promise<unknown> {
    switch (method) {
      case "engine.status":
        return this.status();
      case "state.get":
        return this.state.company ? this.state : null;
      case "events.read": {
        const p = params as Params<"events.read">;
        return this.companyId ? this.store.read(this.companyId, p.afterSeq ?? 0, p.limit ?? -1) : [];
      }
      case "company.found":
        return this.found(params as Params<"company.found">);
      case "company.pause":
        this.requireCompany();
        if (!this.state.company?.paused) this.emit({ type: "company.paused", at: this.now() });
        return this.state;
      case "company.resume":
        this.requireCompany();
        if (this.state.company?.paused) this.emit({ type: "company.resumed", at: this.now() });
        this.tick();
        return this.state;
      case "task.cancel":
        return this.cancel((params as Params<"task.cancel">).taskId);
      case "obligation.fulfill":
        return this.fulfill(params as Params<"obligation.fulfill">);
      case "settings.update":
        this.requireCompany();
        this.emit({ type: "settings.changed", patch: (params as Params<"settings.update">).patch, at: this.now() });
        return this.state;
      case "clock.advance": {
        if (!(this.clock instanceof SimulatedClock)) throw new Error("L'horloge ne s'avance qu'en mode simulation.");
        this.clock.advance((params as Params<"clock.advance">).hours * 3_600_000);
        this.tick();
        return this.status();
      }
    }
  }

  status(): EngineStatus {
    return { version: ENGINE_VERSION, runtime: this.runtime.name, now: this.now(), companyId: this.companyId, running: this.work.size, passive: this.passive };
  }

  private requireCompany(): void {
    if (!this.state.company) throw new Error("Aucune entreprise. Commence par `narthex init`.");
  }

  private found(p: Params<"company.found">): CompanyState {
    if (this.state.company) throw new Error(`Une entreprise existe déjà : ${this.state.company.name}.`);
    if (!p.name.trim() || !p.idea.trim()) throw new Error("Il faut un nom et une idée.");
    this.companyId = newId("co");
    this.emit({
      type: "company.founded",
      company: {
        id: this.companyId,
        name: p.name.trim(),
        idea: p.idea.trim(),
        founder: { name: p.founderName.trim() || "Toi" },
        ...(p.city ? { city: p.city } : {}),
        foundedAt: this.now(),
        stage: "idea",
        paused: false,
      },
      settings: this.state.settings,
    });
    this.tick();
    return this.state;
  }

  private cancel(taskId: string): CompanyState {
    const task = this.state.tasks[taskId];
    if (!task) throw new Error("Tâche inconnue.");
    if (task.status !== "planned" && task.status !== "running") throw new Error("Cette tâche n'est plus annulable.");
    this.work.get(taskId)?.controller.abort();
    this.emit({ type: "task.cancelled", taskId, at: this.now(), by: "founder" });
    this.post(task.agentId, "update", `D'accord, j'annule « ${task.title} ».`, { taskId });
    return this.state;
  }

  private fulfill(p: Params<"obligation.fulfill">): CompanyState {
    const o = this.state.obligations[p.obligationId];
    if (!o) throw new Error("Obligation inconnue.");
    if (o.status === "done") return this.state;
    if (o.owner !== "founder") throw new Error("Cette obligation est suivie par l'équipe.");
    if (o.code === "A3-forme") {
      if (!p.legalForm) throw new Error("Choisis la forme juridique (SASU, SAS, EURL, SARL, EI ou micro).");
      this.emit({ type: "company.updated", patch: { legalForm: p.legalForm }, at: this.now() });
    }
    this.emit({ type: "obligation.fulfilled", obligationId: o.id, at: this.now(), by: "founder" });
    const cofounder = this.agentWith("cofondateur");
    if (cofounder) this.post(cofounder.id, "update", `Merci, « ${o.title} » est fait. L'équipe s'occupe de la suite.`);
    this.tick();
    return this.state;
  }

  // ---------- The loop ----------

  /** Applies policy decisions until there is nothing left to decide. Synchronous by design. */
  tick(): void {
    if (this.passive) return;
    const tried = new Set<string>();
    for (let round = 0; round < 50; round++) {
      const fresh = decide(this.state, this.now()).filter((i) => !tried.has(key(i)));
      if (fresh.length === 0) return;
      for (const intent of fresh) {
        tried.add(key(intent));
        this.applyIntent(intent);
      }
    }
  }

  private applyIntent(intent: Intent): void {
    const now = this.now();
    switch (intent.type) {
      case "advance-stage": {
        this.emit({ type: "stage.changed", stage: intent.stage, at: now });
        const cofounder = this.agentWith("cofondateur");
        if (cofounder) this.post(cofounder.id, "update", intent.reason);
        return;
      }
      case "hire":
        this.hire(intent.role, intent.reason);
        return;
      case "open-obligation": {
        const id = newId("ob");
        const r = intent.rule;
        this.emit({
          type: "obligation.opened",
          obligation: {
            id,
            code: r.code,
            title: r.title,
            why: r.why,
            owner: r.owner,
            status: "open",
            openedAt: now,
            ...(intent.due ? { due: intent.due } : {}),
            ...(r.legalBasis ? { legalBasis: r.legalBasis } : {}),
          },
        });
        if (r.owner === "founder") {
          const speaker = this.agentWith("juridique") ?? this.agentWith("cofondateur");
          if (speaker) this.post(speaker.id, "legal", `Pour toi, la loi l'impose : ${lowerFirst(r.title)}. ${r.why}`);
        }
        return;
      }
      case "fulfill-obligation":
        this.emit({ type: "obligation.fulfilled", obligationId: intent.obligationId, at: now, by: intent.by });
        return;
      case "plan-task":
        this.plan(intent.draft);
        return;
      case "start-task":
        this.startTask(intent.taskId);
        return;
    }
  }

  private hire(r: RoleId, reason: string): void {
    const def = role(r);
    const taken = new Set(Object.values(this.state.agents).map((a) => a.name));
    let name = def.defaultName;
    for (let n = 2; taken.has(name); n++) name = `${def.defaultName} ${n}`;
    const agent: Agent = { id: newId("ag"), name, role: r, hiredAt: this.now(), status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 };
    this.emit({ type: "agent.hired", agent, reason });
    const cofounder = this.agentWith("cofondateur");
    if (r === "cofondateur" || !cofounder) {
      const founder = this.state.company?.founder.name ?? "";
      this.post(agent.id, "hire", `Bonjour ${founder}. Je suis ${name}, ta ${def.title.toLowerCase()}. ${def.mission}`);
    } else {
      this.post(cofounder.id, "hire", `J'ai fait venir ${name} (${def.title.toLowerCase()}). ${reason}`);
    }
  }

  /** Returns why the draft was refused, or null when it was planned. */
  private plan(draft: TaskDraft): string | null {
    const guard = guardTask(this.state, draft, this.now());
    if (!guard.ok) return guard.reason;
    const id = newId("t");
    this.emit({ type: "task.planned", task: { id, ...guard.task } });
    const t = guard.task;
    if (t.kind === "external" && t.cancellableUntil) {
      this.post(t.agentId, "plan", `Je prévois : ${lowerFirst(t.title)}. ${t.why} Tu peux annuler jusqu'à ${fmt.day(t.cancellableUntil)}, ${fmt.hour(t.cancellableUntil)}.`, { taskId: id });
    }
    return null;
  }

  private startTask(taskId: string): void {
    const task = this.state.tasks[taskId];
    const agent = task && this.state.agents[task.agentId];
    if (!task || !agent) return;
    this.emit({ type: "task.started", taskId, at: this.now() });
    const controller = new AbortController();
    const done = this.runTask(taskId, agent, controller).finally(() => {
      this.work.delete(taskId);
      this.tick();
    });
    this.work.set(taskId, { controller, done });
  }

  private async runTask(taskId: string, agent: Agent, controller: AbortController): Promise<void> {
    const task = this.state.tasks[taskId]!;
    try {
      const result = await this.runtime.run({
        state: this.state,
        agent,
        task,
        now: this.now(),
        signal: controller.signal,
        progress: (note) => {
          if (!controller.signal.aborted) this.emit({ type: "task.progressed", taskId, note, at: this.now() });
        },
        plan: (f) => this.planFollowUp(agent, task.id, f),
      });
      if (controller.signal.aborted || this.state.tasks[taskId]?.status !== "running") return;
      if (result.usage) this.emit({ type: "usage.recorded", agentId: agent.id, taskId, ...result.usage });
      if (result.memory) this.emit({ type: "memory.updated", memory: result.memory, at: this.now() });
      const deliverable = result.deliverable
        ? { id: newId("dl"), taskId, agentId: agent.id, createdAt: this.now(), ...result.deliverable }
        : undefined;
      this.emit({ type: "task.completed", taskId, at: this.now(), ...(deliverable ? { deliverable } : {}) });
      this.post(agent.id, deliverable ? "deliverable" : "update", result.post, { taskId, ...(deliverable ? { deliverableId: deliverable.id } : {}) });
    } catch (e) {
      if (controller.signal.aborted || this.state.tasks[taskId]?.status !== "running") return;
      const message = e instanceof Error ? e.message : String(e);
      this.emit({ type: "task.failed", taskId, at: this.now(), error: message });
      this.post(agent.id, "update", `Je n'ai pas pu terminer « ${task.title} » : ${message}`, { taskId });
    }
  }

  private planFollowUp(agent: Agent, parentId: string, f: FollowUp): string | null {
    const assignee = f.assignee ? this.agentWith(f.assignee) : agent;
    if (!assignee) return `Personne n'occupe encore le poste « ${f.assignee} ». Margaux recrutera quand ce sera utile.`;
    return this.plan({
      agentId: assignee.id,
      title: f.title,
      why: f.why,
      kind: f.kind,
      parentId,
      scheduledAt: this.now() + (f.inHours ?? 0) * 3_600_000,
      ...(f.tag ? { tag: f.tag } : {}),
    });
  }

  // ---------- Helpers ----------

  private agentWith(r: RoleId): Agent | undefined {
    return Object.values(this.state.agents).find((a) => a.role === r);
  }

  private post(agentId: string, kind: PostKind, text: string, links: { taskId?: string; deliverableId?: string } = {}): void {
    this.emit({ type: "post.published", post: { id: newId("p"), agentId, at: this.now(), kind, text, ...links } });
  }

  private emit(event: DomainEvent): StoredEvent {
    if (!this.companyId) throw new Error("Aucune entreprise.");
    const stored = this.store.append(this.companyId, event, this.now());
    this.state = apply(this.state, stored);
    for (const listener of this.listeners) {
      try {
        listener(stored);
      } catch {
        // A broken client never stops the company.
      }
    }
    return stored;
  }
}

function key(intent: Intent): string {
  switch (intent.type) {
    case "advance-stage":
      return `stage:${intent.stage}`;
    case "hire":
      return `hire:${intent.role}`;
    case "open-obligation":
      return `open:${intent.rule.code}`;
    case "fulfill-obligation":
      return `fulfill:${intent.obligationId}`;
    case "plan-task":
      return `plan:${intent.draft.agentId}:${intent.draft.tag ?? intent.draft.title}`;
    case "start-task":
      return `start:${intent.taskId}`;
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
