import { emptyState, type CompanyState, type CompanySummary, type EngineStatus, type Method, type Params, type Result, type StoredEvent } from "@narthex/core";
import { Engine, type EngineOptions } from "./engine.ts";
import type { AgentRuntime } from "./runtime.ts";

export interface HostOptions extends Omit<EngineOptions, "companyId" | "ownsStore" | "onClose"> {
  /** The company to show first (saved by the app and the CLI); the most recent otherwise. */
  activeCompany?: string;
  /** The founder switched company: remember it for the next launch. */
  onSelect?(companyId: string): void;
  /** Called once everything is closed (releases the data folder lock). */
  onClose?(): void;
}

type Listener = (event: StoredEvent) => void;

/**
 * Several companies in one app: one engine per company, all working at once (each with its own
 * budget), one shown at a time. Same surface as an `Engine`, so the server, the CLI and the app
 * use either. A spare engine without a company does the first launch of the next one.
 */
export class Host {
  private readonly options: HostOptions;
  private readonly engines = new Map<string, Engine>();
  private readonly listeners = new Set<Listener>();
  private nursery: Engine | undefined;
  private active: string | null;
  private running = false;

  constructor(options: HostOptions) {
    this.options = options;
    const ids = options.store.companies();
    for (const id of ids) this.adopt(this.build(id), id);
    this.active = options.activeCompany && this.engines.has(options.activeCompany) ? options.activeCompany : (ids.at(-1) ?? null);
  }

  private build(companyId: string | null): Engine {
    const { activeCompany: _a, onSelect: _s, onClose: _c, ...engine } = this.options;
    return new Engine({ ...engine, companyId, ownsStore: false });
  }

  private adopt(engine: Engine, id: string): void {
    this.engines.set(id, engine);
    if (engine !== this.nursery) engine.subscribe((e) => this.emit(e));
    if (this.running) engine.start();
  }

  /** The engine for the next company; created on demand. */
  private spare(): Engine {
    if (!this.nursery) {
      const engine = this.build(null);
      engine.subscribe((e) => this.emit(e));
      this.nursery = engine;
    }
    return this.nursery;
  }

  private emit(event: StoredEvent): void {
    for (const l of this.listeners) l(event);
  }

  private shown(): Engine | undefined {
    return this.active ? this.engines.get(this.active) : undefined;
  }

  async handle<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    return (await this.dispatch(method, params as never)) as Result<M>;
  }

  private async dispatch(method: Method, params: unknown): Promise<unknown> {
    switch (method) {
      case "companies.list":
        return [...this.engines.entries()].map(([id, e]): CompanySummary => {
          const s = e.getState();
          return { id, name: s.company?.name ?? "?", stage: s.company?.stage ?? "idea", foundedAt: s.company?.foundedAt ?? 0, active: id === this.active, spent: s.usage.credits };
        });
      case "company.select": {
        const id = (params as Params<"company.select">).companyId;
        if (!this.engines.has(id)) throw new Error("Unknown company.");
        this.select(id);
        return this.getState();
      }
      case "company.found": {
        const engine = this.spare();
        const state = await engine.handle("company.found", params as Params<"company.found">);
        const id = engine.status().companyId!;
        this.nursery = undefined;
        this.engines.set(id, engine);
        if (this.running) engine.start();
        this.select(id);
        return state;
      }
      case "onboarding.firstLook":
        return this.spare().handle("onboarding.firstLook", params as Params<"onboarding.firstLook">);
      case "engine.status":
        return this.status();
      case "state.get":
        return this.shown()?.getState() ?? null;
      default: {
        const engine = this.shown();
        if (!engine) throw new Error("No company yet. Start with `narthex init`.");
        return engine.handle(method, params as never);
      }
    }
  }

  private select(id: string): void {
    this.active = id;
    this.options.onSelect?.(id);
  }

  status(): EngineStatus {
    return (this.shown() ?? this.spare()).status();
  }

  getState(): CompanyState {
    return this.shown()?.getState() ?? emptyState();
  }

  /** Any company's state (notifications for a company that is not shown). */
  stateOf(companyId: string): CompanyState | undefined {
    return this.engines.get(companyId)?.getState();
  }

  /** A colleague's answer on the team chat, paid by that company's budget. */
  remark(companyId: string, input: Parameters<Engine["remark"]>[0]): Promise<string | undefined> {
    return this.engines.get(companyId)?.remark(input) ?? Promise.resolve(undefined);
  }

  now(): number {
    return (this.shown() ?? this.spare()).now();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.running = true;
    for (const e of this.engines.values()) e.start();
  }

  tick(): void {
    for (const e of this.engines.values()) e.tick();
  }

  async idle(): Promise<void> {
    await Promise.all([...this.engines.values()].map((e) => e.idle()));
  }

  useRuntime(runtime: AgentRuntime | null): void {
    this.options.runtime = runtime;
    for (const e of this.engines.values()) e.useRuntime(runtime);
    this.nursery?.useRuntime(runtime);
  }

  abortAll(): void {
    for (const e of this.engines.values()) e.abortAll();
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all([...this.engines.values()].map((e) => e.stop()));
  }

  async close(): Promise<void> {
    await Promise.all([...this.engines.values(), ...(this.nursery ? [this.nursery] : [])].map((e) => e.close()));
    this.options.store.close();
    this.options.onClose?.();
  }
}
