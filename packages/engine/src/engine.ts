import {
  apply,
  decide,
  emptyState,
  fmt,
  declinedByFounder,
  MAX_ATTEMPTS,
  OFFICES,
  METHODS,
  overBudget as dayOverBudget,
  spentOn,
  recallFacts,
  curatePlaybook,
  isValid,
  type Fact,
  guardTask,
  replay,
  role,
  type Agent,
  type CompanyState,
  type DomainEvent,
  type FirstLook,
  type EngineStatus,
  type Intent,
  type Method,
  type Params,
  type PostKind,
  type Result,
  type RoleId,
  type StoredEvent,
  type TaskDraft,
  SEUIL,
  ROLE_PROMISE,
  ROLES,
  staffingFrom,
  staffingOf,
} from "@narthex/core";
import { SimulatedClock, systemClock, type Clock } from "./clock.ts";
import { newId } from "./ids.ts";
import type { AgentRuntime, FollowUp, ReflectionInput, RemarkInput } from "./runtime.ts";
import type { EventStore } from "./store.ts";

export const ENGINE_VERSION = "0.1.0";

export interface EngineOptions {
  store: EventStore;
  /** null: nobody can work yet (no key). The company still plans; nothing is pretended. */
  runtime: AgentRuntime | null;
  clock?: Clock;
  /** How often the company checks what to do next. */
  tickMs?: number;
  /**
   * Passive engines record the founder's actions but never put agents to work.
   * Used by one-shot CLI commands when no `narthex lancer` is running.
   */
  passive?: boolean;
  /**
   * The company this engine runs: `null` for a new one (founded later), absent for the first in the log.
   * Several engines share one store when several companies run (see `Host`).
   */
  companyId?: string | null;
  /** False when a `Host` owns the store and closes it once, after every engine. */
  ownsStore?: boolean;
  /** Called once the engine is closed (releases the data folder lock). */
  onClose?: () => void;
  /** Checks that a cited link answers. Off in simulation and tests; `openEngine` gives the real one. */
  checkLink?: LinkCheck;
}

/** Does this link answer? Never throws: an unreachable link is `false`. */
export type LinkCheck = (url: string, signal: AbortSignal) => Promise<boolean>;

type Listener = (event: StoredEvent) => void;

/**
 * One company, running. The engine owns the event log and the projected state;
 * `policy.decide` says what to do, runtimes do the work, everything is an event.
 */
export class Engine {
  private readonly store: EventStore;
  private runtime: AgentRuntime | null;
  private hiredThisTick: Agent[] = [];
  private readonly clock: Clock;
  private readonly tickMs: number;
  private readonly passive: boolean;
  private readonly listeners = new Set<Listener>();
  private readonly checkLink: LinkCheck | undefined;
  private stopping = false;
  private readonly ownsStore: boolean;
  private readonly onClose: (() => void) | undefined;
  /** Link checks in flight, so `idle` and `close` wait for them. */
  private readonly checks = new Set<Promise<void>>();
  private readonly work = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private state: CompanyState = emptyState();
  private companyId: string | null;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: EngineOptions) {
    this.checkLink = options.checkLink;
    this.onClose = options.onClose;
    this.store = options.store;
    this.runtime = options.runtime;
    this.clock = options.clock ?? systemClock;
    this.tickMs = options.tickMs ?? 5_000;
    this.passive = options.passive ?? false;
    this.companyId = options.companyId === undefined ? (this.store.companies()[0] ?? null) : options.companyId;
    this.ownsStore = options.ownsStore ?? true;
    if (this.companyId) this.state = replay(this.store.read(this.companyId));
    // Work interrupted by a crash or a quit is recorded as such, never silently lost.
    if (!this.passive) for (const task of Object.values(this.state.tasks)) {
      if (task.status === "running") this.emit({ type: "task.failed", taskId: task.id, at: this.now(), error: "Interrupted (Narthex was closed).", interrupted: true });
    }
  }

  // ---------- Lifecycle ----------

  start(): void {
    this.stopping = false;
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
    this.tick();
  }

  async stop(): Promise<void> {
    // Agents finish what they started; nothing new starts, even from a task that ends meanwhile.
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.idle();
  }

  /** Changes who does the work (a key was just given). Work already running finishes with the old one. */
  useRuntime(runtime: AgentRuntime | null): void {
    this.runtime = runtime;
    this.tick();
  }

  /** Stops and releases the event store. */
  async close(): Promise<void> {
    await this.stop();
    if (this.ownsStore) this.store.close();
    this.onClose?.();
  }

  /** Aborts every agent at work; their tasks are recorded as interrupted on next start. */
  abortAll(): void {
    for (const w of this.work.values()) w.controller.abort();
  }

  /** Resolves when no agent is working (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.work.size > 0 || this.checks.size > 0) await Promise.all([...[...this.work.values()].map((w) => w.done), ...this.checks]);
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
    if (typeof method !== "string" || !METHODS.has(method)) throw new Error(`Unknown method: ${String(method).slice(0, 60)}`);
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
      case "onboarding.firstLook":
        return this.firstLook(params as Params<"onboarding.firstLook">);
      case "fact.forget": {
        this.requireCompany();
        const first = (params as Params<"fact.forget">).factId;
        if (!this.state.facts[first]) throw new Error("Unknown fact.");
        // What was drawn from it goes too: a merge or a reflection may repeat its words.
        const ids = new Set([first]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const f of Object.values(this.state.facts)) if (!ids.has(f.id) && f.from?.some((id) => ids.has(id))) (ids.add(f.id), (grew = true));
        }
        this.store.forgetFacts(this.companyId!, ids);
        this.emit({ type: "facts.forgotten", factIds: [...ids], at: this.now() });
        return this.state;
      }
      case "sale.record": {
        this.requireCompany();
        const p = params as Params<"sale.record">;
        if (p.amountCents !== undefined && !(Number.isInteger(p.amountCents) && p.amountCents >= 0 && p.amountCents < 1e11)) throw new Error("The amount is not valid.");
        const note = p.note?.trim().slice(0, 200);
        this.emit({ type: "sale.recorded", sale: { id: newId("sa"), at: this.now(), ...(p.amountCents !== undefined ? { amountCents: p.amountCents } : {}), ...(note ? { note } : {}) } });
        this.tick();
        return this.state;
      }
      case "company.update": {
        this.requireCompany();
        const p = params as Params<"company.update">;
        const patch: { name?: string; city?: string; founderName?: string } = {};
        for (const k of ["name", "city", "founderName"] as const) {
          const v = p[k];
          if (v === undefined) continue;
          if (k !== "city" && !v.trim()) throw new Error(k === "name" ? "The company needs a name." : "A first name is needed.");
          patch[k] = v.trim();
        }
        this.emit({ type: "company.updated", patch, at: this.now() });
        return this.state;
      }
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
      case "obligation.retry": {
        const o = this.state.obligations[(params as Params<"obligation.retry">).obligationId];
        if (!o) throw new Error("Unknown obligation.");
        if (o.status === "done" || (!o.stuck && !declinedByFounder(this.state, o))) throw new Error("This obligation is not stuck.");
        this.emit({ type: "obligation.retried", obligationId: o.id, at: this.now() });
        this.tick();
        return this.state;
      }
      case "settings.update":
        this.requireCompany();
        this.emit({ type: "settings.changed", patch: (params as Params<"settings.update">).patch, at: this.now() });
        return this.state;
      case "clock.advance": {
        if (!(this.clock instanceof SimulatedClock)) throw new Error("The clock only moves forward in simulation mode.");
        this.clock.advance((params as Params<"clock.advance">).hours * 3_600_000);
        // Written down, so the next start resumes from the advanced time even if nothing else happens.
        if (this.companyId) this.emit({ type: "clock.advanced", hours: (params as Params<"clock.advance">).hours, at: this.now() });
        this.tick();
        return this.status();
      }
    }
  }

  status(): EngineStatus {
    const unavailable = this.runtime?.unavailable?.();
    const sub = this.runtime?.subscription?.();
    return {
      version: ENGINE_VERSION,
      runtime: this.runtime?.name ?? "none",
      now: this.now(),
      companyId: this.companyId,
      running: this.work.size,
      passive: this.passive,
      ...(unavailable ? { unavailable } : {}),
      ...(sub
        ? {
            subscription: {
              ...(sub.fiveHour ? { fiveHour: sub.fiveHour.utilization } : {}),
              ...(sub.sevenDay ? { sevenDay: sub.sevenDay.utilization } : {}),
              ...(sub.fiveHour ? { resetsAt: sub.fiveHour.resetsAt } : {}),
            },
          }
        : {}),
    };
  }

  private requireCompany(): void {
    if (!this.state.company) throw new Error("No company yet. Start with `narthex init`.");
  }

  private found(p: Params<"company.found">): CompanyState {
    if (this.state.company) throw new Error(`A company already exists: ${this.state.company.name}.`);
    if (!p.name.trim() || !p.idea.trim()) throw new Error("A name and an idea are needed.");
    this.companyId = newId("co");
    this.emit({
      type: "company.founded",
      company: {
        id: this.companyId,
        name: p.name.trim(),
        idea: p.idea.trim(),
        founder: { name: p.founderName.trim() || "You" },
        ...(p.city ? { city: p.city } : {}),
        foundedAt: this.now(),
        stage: "idea",
        paused: false,
      },
      settings: this.state.settings,
    });
    // The team Margaux chose for this idea; without a first look, the usual plan applies.
    if (p.firstLook?.team?.length) this.emit({ type: "staffing.planned", staffing: staffingFrom(p.firstLook) });
    // Margaux is there from the first second, even when nobody runs the company yet.
    this.hire("cofondateur", "I'm here from the very first idea.");
    if (p.firstLook && p.firstLook.findings.length > 0) this.recordFirstLook(p.firstLook);
    this.tick();
    return this.state;
  }

  private async firstLook(p: Params<"onboarding.firstLook">): Promise<FirstLook> {
    // Paid, and outside any budget (no company yet): only during the first launch.
    if (this.state.company) throw new Error("The first look only happens at the first launch.");
    const fallback: FirstLook = { reaction: SEUIL.noLook, findings: [], simulated: this.runtime?.name === "simulation" };
    if (!this.runtime) return fallback;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      return await this.runtime.firstLook({ idea: p.idea, founderName: p.founderName, now: this.now(), signal: controller.signal });
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Margaux's first look becomes her first deliverable. It is not the market study: Léa still does hers. */
  private recordFirstLook(look: FirstLook): void {
    const margaux = this.agentWith("cofondateur");
    if (!margaux) return;
    const now = this.now();
    const taskId = newId("t");
    this.emit({
      type: "task.planned",
      task: { id: taskId, agentId: margaux.id, title: "First look at the market", why: "To know right away whether there is room.", kind: "internal", status: "planned", tag: "first-look", createdAt: now, scheduledAt: now },
    });
    const deliverable = {
      id: newId("dl"),
      taskId,
      agentId: margaux.id,
      title: "First look at the market",
      summary: look.simulated ? "Example findings (simulation mode)." : `${look.findings.length} sourced findings, before Léa's full study.`,
      body: look.findings.map((f) => `- ${f.text} (${f.source})`).join("\n"),
      sources: look.findings.map((f) => ({ title: f.source })),
      createdAt: now,
    };
    this.emit({ type: "task.completed", taskId, at: now, deliverable });
    if (look.usage) this.emit({ type: "usage.recorded", agentId: margaux.id, taskId, ...look.usage, at: now });
    this.post(margaux.id, "deliverable", look.reaction, { taskId, deliverableId: deliverable.id });
  }

  private cancel(taskId: string): CompanyState {
    const task = this.state.tasks[taskId];
    if (!task) throw new Error("Unknown task.");
    if (task.status !== "planned" && task.status !== "running") throw new Error("This task can no longer be cancelled.");
    this.work.get(taskId)?.controller.abort();
    this.emit({ type: "task.cancelled", taskId, at: this.now(), by: "founder" });
    this.reflect(taskId, "cancelled", "The founder cancelled this task before it went out.");
    this.post(task.agentId, "update", `OK, I'm cancelling "${task.title}".`, { taskId });
    return this.state;
  }

  private fulfill(p: Params<"obligation.fulfill">): CompanyState {
    const o = this.state.obligations[p.obligationId];
    if (!o) throw new Error("Unknown obligation.");
    if (o.status === "done") return this.state;
    if (o.owner !== "founder") throw new Error("The team is handling this obligation.");
    if (o.code === "A3-forme") {
      if (!p.legalForm) throw new Error("Choose the legal form (SASU, SAS, EURL, SARL, EI or micro).");
      this.emit({ type: "company.updated", patch: { legalForm: p.legalForm }, at: this.now() });
    }
    this.emit({ type: "obligation.fulfilled", obligationId: o.id, at: this.now(), by: "founder" });
    const cofounder = this.agentWith("cofondateur");
    if (cofounder) this.post(cofounder.id, "update", `Thanks, "${o.title}" is done. The team takes it from here.`);
    this.tick();
    return this.state;
  }

  // ---------- The loop ----------

  /** Applies policy decisions until there is nothing left to decide. Synchronous by design. */
  tick(): void {
    if (!this.passive && !this.stopping) {
      const tried = new Set<string>();
      for (let round = 0; round < 50; round++) {
        const fresh = decide(this.state, this.now()).filter((i) => !tried.has(key(i)));
        if (fresh.length === 0) break;
        for (const intent of fresh) {
          tried.add(key(intent));
          this.applyIntent(intent);
        }
      }
      this.consolidate();
    }
    this.announceHires();
  }

  /**
   * A colleague's short answer on the team chat (Discord). Paid like any work: recorded in the AI spend,
   * never past the day's budget. Undefined when nobody can or should answer.
   */
  async remark(input: Omit<RemarkInput, "company" | "signal">): Promise<string | undefined> {
    const runtime = this.runtime;
    const agent = Object.values(this.state.agents).find((a) => a.role === input.speaker.role);
    if (!runtime?.remark || !agent || !this.state.company || dayOverBudget(this.state, this.now())) return undefined;
    try {
      const out = await runtime.remark({ ...input, company: this.state.company.name, signal: AbortSignal.timeout(30_000) });
      this.emit({ type: "usage.recorded", agentId: agent.id, ...out.usage, at: this.now() });
      return out.text.trim().slice(0, 600) || undefined;
    } catch {
      return undefined;
    }
  }

  /** One reflection at a time per role, so two never overwrite each other's playbook. */
  private readonly reflecting = new Map<RoleId, Promise<void>>();

  /**
   * L4 (research: ACE): after each outcome, a small model proposes small deltas to the role's playbook;
   * curation is deterministic (`curatePlaybook`). Never past the day's budget; a failure changes nothing.
   */
  private reflect(taskId: string, outcome: ReflectionInput["outcome"], detail: string): void {
    const runtime = this.runtime;
    const task = this.state.tasks[taskId];
    const agent = task && this.state.agents[task.agentId];
    if (!runtime?.reflect || !task || !agent || dayOverBudget(this.state, this.now())) return;
    const r = agent.role;
    const previous = this.reflecting.get(r) ?? Promise.resolve();
    const run = previous.then(async () => {
      try {
        const lessons = this.state.playbooks?.[r] ?? [];
        const out = await runtime.reflect!({
          role: r,
          task: { title: task.title, why: task.why, kind: task.kind },
          outcome,
          detail: detail.slice(0, 4000),
          lessons: lessons.map((l) => ({ id: l.id, text: l.text })),
          now: this.now(),
          signal: AbortSignal.timeout(60_000),
        });
        if (!this.companyId) return;
        this.emit({ type: "usage.recorded", agentId: agent.id, taskId, ...out.usage, at: this.now() });
        const current = this.state.playbooks?.[r] ?? [];
        const next = curatePlaybook(current, { add: out.add.slice(0, 2).map((text) => ({ id: newId("le"), text })), helpful: out.helpful, harmful: out.harmful }, this.now());
        if (JSON.stringify(next) !== JSON.stringify(current)) this.emit({ type: "playbook.updated", role: r, lessons: next, taskId, at: this.now() });
      } catch {
        // A lesson is a bonus: never blocks the work.
      }
    });
    this.reflecting.set(r, run);
    this.checks.add(run);
    void run.finally(() => {
      this.checks.delete(run);
      if (this.reflecting.get(r) === run) this.reflecting.delete(r);
    });
  }

  private consolidating = false;

  /**
   * « Pendant la nuit, l'equipe range ses notes » (research: sleep-time consolidation): on the first tick of
   * a Paris day, a small model tidies the facts learnt before it. Once per day, only if there is something new.
   */
  private consolidate(): void {
    const runtime = this.runtime;
    const now = this.now();
    const today = fmt.dayKey(now);
    if (!runtime?.consolidateFacts || this.consolidating || !this.state.company || dayOverBudget(this.state, now)) return;
    const through = this.state.consolidatedThrough;
    const valid = Object.values(this.state.facts).filter((f) => isValid(f, now));
    const fresh = valid.filter((f) => fmt.dayKey(f.validFrom) < today && (!through || fmt.dayKey(f.validFrom) > through));
    if (fresh.length === 0) return;
    const day = fresh.map((f) => fmt.dayKey(f.validFrom)).sort().at(-1)!;
    const facts = valid.sort((a, b) => b.importance - a.importance || b.validFrom - a.validFrom).slice(0, 150);
    const known = new Map(facts.map((f) => [f.id, f]));
    this.consolidating = true;
    const run = (async () => {
      try {
        const out = await runtime.consolidateFacts!({
          facts: facts.map((f) => ({ id: f.id, text: f.text, subject: f.subject, importance: f.importance, sensitive: !!f.sensitive })),
          now,
          signal: AbortSignal.timeout(120_000),
        });
        if (!this.companyId) return;
        const at = this.now();
        const margaux = Object.values(this.state.agents).find((a) => a.role === "cofondateur");
        if (margaux) this.emit({ type: "usage.recorded", agentId: margaux.id, ...out.usage, at });
        const level = (n: number) => Math.min(10, Math.max(1, Math.round(n)));
        const invalidated = new Set<string>();
        const added: Fact[] = [];
        for (const m of out.merged.slice(0, 40)) {
          const from = m.from.filter((id) => known.has(id));
          if (from.length < 2 || !m.text.trim()) continue;
          for (const id of from) invalidated.add(id);
          // A merge of anything sensitive stays sensitive.
          const sensitive = m.sensitive || from.some((id) => known.get(id)!.sensitive);
          added.push({ id: newId("fa"), text: m.text.trim().slice(0, 600), subject: m.subject.trim().slice(0, 80), importance: level(m.importance), deliverableId: known.get(from[0]!)!.deliverableId, validFrom: at, from, ...(sensitive ? { sensitive: true } : {}) });
        }
        const merged = new Set(invalidated);
        for (const id of out.invalidated) if (known.has(id)) invalidated.add(id);
        const stale = [...invalidated].filter((id) => !merged.has(id)).length;
        for (const r of out.reflections.slice(0, 3)) {
          // A reflection must rest on at least two facts we gave; anything else is a guess.
          const basis = r.from.filter((id) => known.has(id));
          if (basis.length >= 2 && r.text.trim()) added.push({ id: newId("fa"), text: r.text.trim().slice(0, 600), subject: "Reflection", importance: level(r.importance), deliverableId: "", validFrom: at, from: basis, ...(basis.some((id) => known.get(id)!.sensitive) ? { sensitive: true } : {}) });
        }
        this.emit({ type: "facts.consolidated", day, at, added, invalidated: [...invalidated] });
        const merges = added.filter((f) => f.subject !== "Reflection").length;
        const reflections = added.length - merges;
        if (margaux && (merges || invalidated.size || reflections)) {
          const parts = [
            merges ? `${merges} duplicate${merges > 1 ? "s" : ""} merged` : "",
            stale ? `${stale} outdated fact${stale > 1 ? "s" : ""}` : "",
            reflections ? `${reflections} reflection${reflections > 1 ? "s" : ""}` : "",
          ].filter(Boolean);
          this.post(margaux.id, "update", `I tidied yesterday's notes: ${facts.length} facts reread, ${parts.join(", ")}. It's all in Team · Memory.`);
        }
      } catch {
        // Tidying is a bonus: it is tried again on the next tick of a later day.
      } finally {
        this.consolidating = false;
      }
    })();
    this.checks.add(run);
    void run.finally(() => this.checks.delete(run));
  }

  /** Everyone who joined in the same instant is announced by Margaux in a single message. */
  private announceHires(): void {
    const joined = this.hiredThisTick.filter((a) => a.role !== "cofondateur");
    this.hiredThisTick = [];
    const cofounder = this.agentWith("cofondateur");
    if (joined.length === 0 || !cofounder) return;
    const names = joined.map((a) => a.name);
    const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    const what = joined.map((a) => `${a.name} ${lowerFirst(ROLE_PROMISE[a.role])}`).join(", ");
    this.post(cofounder.id, "hire", `I've brought in ${list}. ${what}.`);
  }

  private applyIntent(intent: Intent): void {
    const now = this.now();
    switch (intent.type) {
      case "advance-stage": {
        this.emit({ type: "stage.changed", stage: intent.stage, at: now });
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
        // Founder duties show on the pancarte, not as a post.
        return;
      }
      case "fulfill-obligation":
        this.emit({ type: "obligation.fulfilled", obligationId: intent.obligationId, at: now, by: intent.by });
        return;
      case "plan-task":
        this.plan(intent.draft);
        return;
      case "start-task":
        // A runtime that cannot take work now (subscription window full): the task stays planned.
        if (this.runtime && !this.runtime.unavailable?.()) this.startTask(intent.taskId);
        return;
      case "move-office": {
        this.emit({ type: "office.moved", tier: intent.tier, at: now });
        const margaux = Object.values(this.state.agents).find((a) => a.role === "cofondateur");
        const line = OFFICES[intent.tier]?.line;
        if (margaux && line) this.post(margaux.id, "update", line);
        return;
      }
      case "escalate": {
        const o = this.state.obligations[intent.obligationId];
        this.emit({ type: "obligation.stuck", obligationId: intent.obligationId, at: now, error: intent.error });
        const owner = o && o.owner !== "founder" ? Object.values(this.state.agents).find((a) => a.role === o.owner) : undefined;
        const cofounder = Object.values(this.state.agents).find((a) => a.role === "cofondateur");
        if (o && cofounder) {
          this.post(
            cofounder.id,
            "update",
            `${owner?.name ?? "The team"} can't get "${o.title}" done after ${MAX_ATTEMPTS} attempts. Last error: ${intent.error} We'll stop trying until you tell us to start again.`,
          );
        }
        return;
      }
    }
  }

  private hire(r: RoleId, reason: string): void {
    const def = role(r);
    const taken = new Set(Object.values(this.state.agents).map((a) => a.name));
    let name = def.defaultName;
    for (let n = 2; taken.has(name); n++) name = `${def.defaultName} ${n}`;
    const agent: Agent = { id: newId("ag"), name, role: r, hiredAt: this.now(), status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 };
    this.emit({ type: "agent.hired", agent, reason });
    this.hiredThisTick.push(agent);
  }

  /** Returns why the draft was refused, or null when it was planned. */
  private plan(draft: TaskDraft): string | null {
    const guard = guardTask(this.state, draft, this.now());
    if (!guard.ok) return guard.reason;
    const id = newId("t");
    this.emit({ type: "task.planned", task: { id, ...guard.task } });
    const t = guard.task;
    if (t.kind === "external" && t.cancellableUntil) {
      this.post(t.agentId, "plan", `Next on my list: ${lowerFirst(t.title)}. ${t.why} You can cancel until ${fmt.day(t.cancellableUntil)}, ${fmt.hour(t.cancellableUntil)}.`, { taskId: id });
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
    const runtime = this.runtime;
    let spent = 0;
    // Set from the spend callback: declared wide so later checks are not narrowed to `false`.
    let overBudget = false as false | "task" | "day";
    try {
      if (!runtime) throw new Error("Nobody can work without a key.");
      const result = await runtime.run({
        state: this.state,
        agent,
        task,
        now: this.now(),
        signal: controller.signal,
        progress: (note) => {
          if (!controller.signal.aborted) this.emit({ type: "task.progressed", taskId, note, at: this.now() });
        },
        plan: (f) => this.planFollowUp(agent, task.id, f),
        recruit: (r, why) => this.recruit(agent, r, why),
        spend: (usage) => {
          if (usage.credits <= 0 && usage.inputTokens <= 0) return;
          spent += usage.credits;
          this.emit({ type: "usage.recorded", agentId: agent.id, taskId, ...usage, at: this.now() });
          if (overBudget) return;
          // The day's budget stops work in progress too, not only new starts.
          overBudget = spent > this.state.settings.taskBudgetCredits ? "task" : dayOverBudget(this.state, this.now()) ? "day" : false;
          if (overBudget) controller.abort();
        },
        remainingCredits: () =>
          Math.min(this.state.settings.taskBudgetCredits - spent, this.state.settings.dailyBudgetCredits - spentOn(this.state, this.now())),
      });
      if (overBudget) throw new Error("budget");
      if (controller.signal.aborted || this.state.tasks[taskId]?.status !== "running") return;
      if (result.usage) this.emit({ type: "usage.recorded", agentId: agent.id, taskId, ...result.usage, at: this.now() });
      if (result.memory) this.emit({ type: "memory.updated", memory: result.memory, at: this.now() });
      const deliverable = result.deliverable
        ? { id: newId("dl"), taskId, agentId: agent.id, createdAt: this.now(), ...result.deliverable }
        : undefined;
      this.emit({ type: "task.completed", taskId, at: this.now(), ...(deliverable ? { deliverable } : {}) });
      this.reflect(taskId, "done", [result.post, deliverable ? `Deliverable: ${deliverable.title}. ${deliverable.summary}` : ""].filter(Boolean).join("\n"));
      if (deliverable) {
        this.checkSources(deliverable.id, result.consulted ?? []);
        this.extractFacts(deliverable.id);
      }
      this.post(agent.id, deliverable ? "deliverable" : "update", result.post, { taskId, ...(deliverable ? { deliverableId: deliverable.id } : {}) });
    } catch (e) {
      if (overBudget === "day" && this.state.tasks[taskId]?.status === "running") {
        this.emit({ type: "task.failed", taskId, at: this.now(), error: "Daily budget reached.", interrupted: true });
        this.post(agent.id, "update", `I'm stopping on "${task.title}": the daily budget is reached. I'll pick it up again when the budget allows.`, { taskId });
        return;
      }
      if (overBudget && this.state.tasks[taskId]?.status === "running") {
        const limit = this.state.settings.taskBudgetCredits;
        this.emit({ type: "task.failed", taskId, at: this.now(), error: `Task budget reached (${fmt.dollars(spent)} of ${fmt.dollars(limit)}).` });
        this.post(agent.id, "update", `I'm stopping on "${task.title}": the task went over its ${fmt.dollars(limit)} budget. I'll pick it up again in a shorter way.`, { taskId });
        return;
      }
      if (controller.signal.aborted || this.state.tasks[taskId]?.status !== "running") return;
      const message = e instanceof Error ? e.message : String(e);
      this.emit({ type: "task.failed", taskId, at: this.now(), error: message });
      this.reflect(taskId, "failed", message);
      this.post(agent.id, "update", `I couldn't finish "${task.title}": ${message}`, { taskId });
    }
  }

  /**
   * After delivery, a small model writes what the team learnt to L2 memory (research: extraction
   * Mem0-style, asynchronous, off the critical path). Contradicted facts are dated, never erased.
   */
  private extractFacts(deliverableId: string): void {
    const runtime = this.runtime;
    const d = this.state.deliverables[deliverableId];
    if (!runtime?.extractFacts || !d || dayOverBudget(this.state, this.now())) return;
    const known = recallFacts(this.state, `${d.title} ${d.summary} ${d.body.slice(0, 2000)}`, { role: "cofondateur", now: this.now(), k: 40 });
    const run = (async () => {
      try {
        const out = await runtime.extractFacts!({ deliverable: { title: d.title, summary: d.summary, body: d.body.slice(0, 40_000) }, known: known.map((f) => ({ id: f.id, text: f.text })), now: this.now(), signal: AbortSignal.timeout(120_000) });
        if (!this.companyId) return;
        this.emit({ type: "usage.recorded", agentId: d.agentId, taskId: d.taskId, ...out.usage, at: this.now() });
        const at = this.now();
        const added = out.added
          .filter((f) => f.text.trim())
          .slice(0, 12)
          .map((f) => ({
            id: newId("fa"),
            text: f.text.trim(),
            subject: f.subject.trim(),
            importance: Math.min(10, Math.max(1, Math.round(f.importance))),
            deliverableId,
            validFrom: at,
            ...(f.sensitive ? { sensitive: true } : {}),
          }));
        const knownIds = new Set(known.map((f) => f.id));
        this.emit({ type: "facts.extracted", deliverableId, at, added, invalidated: out.invalidated.filter((id) => knownIds.has(id)) });
      } catch {
        // Memory is a bonus: a failed extraction never blocks the work, and costs nothing more.
      }
    })();
    this.checks.add(run);
    void run.finally(() => this.checks.delete(run));
  }

  /** After delivery, Narthex itself checks that every cited link answers (no model, no cost). */
  private checkSources(deliverableId: string, consulted: readonly string[]): void {
    const check = this.checkLink;
    // Only pages the agent really read: a cited URL from injected text is never called from the player's machine.
    const read = new Set(consulted.map(normalUrl));
    const urls = [...new Set((this.state.deliverables[deliverableId]?.sources ?? []).flatMap((s) => (s.url && read.has(normalUrl(s.url)) ? [s.url] : [])))].slice(0, 40);
    if (!check || urls.length === 0) return;
    const run = (async () => {
      const results = await Promise.all(
        urls.map(async (url) => ({ url, ok: await check(url, AbortSignal.timeout(15_000)).catch(() => false) })),
      );
      if (this.state.deliverables[deliverableId]) this.emit({ type: "sources.checked", deliverableId, at: this.now(), results });
    })();
    this.checks.add(run);
    void run.finally(() => this.checks.delete(run));
  }

  /** Margaux brings someone now: added to the plan and hired at once. */
  private recruit(by: Agent, r: RoleId, why: string): string | null {
    if (by.role !== "cofondateur") return "Only Margaux brings in new teammates.";
    if (!ROLES.some((x) => x.id === r) || r === "cofondateur") return `I don't know this role: ${r}.`;
    if (this.agentWith(r)) return `${this.agentWith(r)!.name} already holds this role.`;
    const stage = this.state.company?.stage ?? "research";
    this.emit({ type: "staffing.planned", staffing: [...staffingOf(this.state), { role: r, at: stage, why }] });
    this.hire(r, why);
    this.announceHires();
    return null;
  }

  private planFollowUp(agent: Agent, parentId: string, f: FollowUp): string | null {
    const assignee = f.assignee ? this.agentWith(f.assignee) : agent;
    if (!assignee) return `Nobody holds the "${f.assignee}" role yet. Margaux will recruit when it's useful.`;
    return this.plan({
      agentId: assignee.id,
      title: f.title,
      why: f.why,
      kind: f.kind,
      parentId,
      scheduledAt: this.now() + (f.inHours ?? 0) * 3_600_000,
      ...(f.tag ? { tag: f.tag } : {}),
      ...(f.level ? { level: f.level } : {}),
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
    if (!this.companyId) throw new Error("No company.");
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
    case "escalate":
      return `escalate:${intent.obligationId}`;
    case "move-office":
      return `office:${intent.tier}`;
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function normalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}
