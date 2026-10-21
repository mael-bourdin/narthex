import { leaderboardEntry, validEntry, type LeaderboardEntry, type StoredEvent } from "@narthex/core";
import type { Host } from "./host.ts";

export interface LeaderboardSettings {
  /** Only the hosted version takes part; an open-source install keeps everything at home. */
  edition: "open-source" | "hosted";
  url?: string;
  token?: string;
  /** The founder chose to appear in the ranking. */
  share: boolean;
  /** …and to show the exact revenue instead of a band. */
  showRevenue: boolean;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Events that change a company's place in the ranking. */
const MOVES = new Set(["company.founded", "stage.changed", "office.moved", "sale.recorded", "company.updated"]);

/**
 * Sends each company's public entry to the leaderboard service, for a hosted instance whose founder
 * chose to appear: at start, after anything that changes the ranking, and every six hours. Never from
 * an open-source install. Failures are silent: the ranking is a bonus, never in the way of the work.
 */
export class LeaderboardPublisher {
  private readonly options: { host: Pick<Host, "subscribe" | "stateOf" | "handle" | "now">; settings: () => LeaderboardSettings; fetch: Fetch; debounceMs: number; watchMs: number };
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private queue: Promise<void> = Promise.resolve();
  private off: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private watcher: ReturnType<typeof setInterval> | undefined;
  private seen = "";

  constructor(options: { host: Pick<Host, "subscribe" | "stateOf" | "handle" | "now">; settings: () => LeaderboardSettings; fetch?: Fetch; debounceMs?: number; watchMs?: number }) {
    this.options = { fetch: (globalThis.fetch as unknown as Fetch), debounceMs: 60_000, watchMs: 30_000, ...options };
  }

  private choice(): string {
    const s = this.options.settings();
    return JSON.stringify([s.edition, s.url, s.token, s.share, s.showRevenue]);
  }

  /** The founder may change their choice from another process (the CLI while the app runs): follow it at once. */
  private async follow(): Promise<void> {
    const now = this.choice();
    if (now === this.seen) return;
    this.seen = now;
    const ids = (await this.options.host.handle("companies.list", {})).map((c) => c.id);
    const s = this.options.settings();
    // Stopped sharing: leave now. Otherwise republish with the new choice, without waiting.
    if (!this.active() && s.edition === "hosted" && !s.share) await Promise.all(ids.map((id) => this.withdraw(id)));
    else for (const id of ids) this.queue = this.queue.then(() => this.publish(id)).catch(() => {});
  }

  private active(): LeaderboardSettings | undefined {
    const s = this.options.settings();
    return s.edition === "hosted" && s.share && s.url && s.token ? s : undefined;
  }

  start(): void {
    this.off ??= this.options.host.subscribe((e: StoredEvent) => {
      if (MOVES.has(e.type)) this.schedule(e.companyId);
    });
    void this.options.host.handle("companies.list", {}).then((list) => list.forEach((c) => this.schedule(c.id)));
    this.timer ??= setInterval(() => void this.options.host.handle("companies.list", {}).then((list) => list.forEach((c) => this.schedule(c.id))), 6 * 3_600_000);
    this.timer.unref?.();
    this.seen = this.choice();
    this.watcher ??= setInterval(() => void this.follow().catch(() => {}), this.options.watchMs);
    this.watcher.unref?.();
  }

  stop(): void {
    this.off?.();
    this.off = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = undefined;
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }

  /** Resolves once everything scheduled so far is sent. */
  async idle(): Promise<void> {
    while (this.pending.size) await new Promise((r) => setTimeout(r, Math.max(1, this.options.debounceMs)));
    await this.queue;
  }

  private schedule(companyId: string): void {
    if (!this.active()) return;
    clearTimeout(this.pending.get(companyId));
    this.pending.set(
      companyId,
      setTimeout(() => {
        this.pending.delete(companyId);
        this.queue = this.queue.then(() => this.publish(companyId)).catch(() => {});
      }, this.options.debounceMs),
    );
  }

  private async publish(companyId: string): Promise<void> {
    const s = this.active();
    const state = this.options.host.stateOf(companyId);
    if (!s || !state?.company) return;
    const entry: LeaderboardEntry = leaderboardEntry(state, this.options.host.now(), { showRevenue: s.showRevenue });
    await this.send(s, "PUT", companyId, JSON.stringify(entry));
  }

  /** The founder stopped sharing: the company leaves the ranking. */
  async withdraw(companyId: string): Promise<void> {
    await withdrawFromLeaderboard(this.options.settings(), companyId, this.options.fetch);
  }

  private async send(s: LeaderboardSettings, method: "PUT" | "DELETE", companyId: string, body?: string): Promise<void> {
    await send(this.options.fetch, s, method, companyId, body);
  }
}

async function send(fetchImpl: Fetch, s: LeaderboardSettings, method: "PUT" | "DELETE", companyId: string, body?: string): Promise<{ ok: boolean; status: number }> {
  return fetchImpl(`${s.url!.replace(/\/$/, "")}/v1/entries/${encodeURIComponent(companyId)}`, {
    method,
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(15_000),
  });
}

/** Removes a company from the ranking, whether or not the team is running. False when the service could not be reached. */
export async function withdrawFromLeaderboard(s: LeaderboardSettings, companyId: string, fetchImpl: Fetch = globalThis.fetch as unknown as Fetch): Promise<boolean> {
  if (s.edition !== "hosted" || !s.url || !s.token) return true;
  return send(fetchImpl, s, "DELETE", companyId).then(
    (r) => r.ok || r.status === 404,
    () => false,
  );
}

/** The public ranking, read by the app and the CLI (any edition can look). */
export async function fetchLeaderboard(url: string, fetchImpl: (u: string, i: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }> = globalThis.fetch as never): Promise<{ rank: number; entry: LeaderboardEntry }[]> {
  const res = await fetchImpl(`${url.replace(/\/$/, "")}/v1/leaderboard?limit=100`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("Le classement ne répond pas pour l'instant.");
  const body = (await res.json()) as { entries?: unknown };
  // The service is remote: keep only well-formed entries (no control characters, known stages and bands).
  return Array.isArray(body.entries) ? body.entries.filter((r): r is { rank: number; entry: LeaderboardEntry } => !!r && Number.isInteger(r.rank) && validEntry(r.entry)) : [];
}
