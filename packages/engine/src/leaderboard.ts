import { leaderboardEntry, type LeaderboardEntry, type StoredEvent } from "@narthex/core";
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
  private readonly options: { host: Pick<Host, "subscribe" | "stateOf" | "handle" | "now">; settings: () => LeaderboardSettings; fetch: Fetch; debounceMs: number };
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private queue: Promise<void> = Promise.resolve();
  private off: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: { host: Pick<Host, "subscribe" | "stateOf" | "handle" | "now">; settings: () => LeaderboardSettings; fetch?: Fetch; debounceMs?: number }) {
    this.options = { fetch: (globalThis.fetch as unknown as Fetch), debounceMs: 60_000, ...options };
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
  }

  stop(): void {
    this.off?.();
    this.off = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
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
    const s = this.options.settings();
    if (s.edition !== "hosted" || !s.url || !s.token) return;
    await this.send(s, "DELETE", companyId).catch(() => {});
  }

  private async send(s: LeaderboardSettings, method: "PUT" | "DELETE", companyId: string, body?: string): Promise<void> {
    await this.options.fetch(`${s.url!.replace(/\/$/, "")}/v1/entries/${encodeURIComponent(companyId)}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  }
}

/** The public ranking, read by the app and the CLI (any edition can look). */
export async function fetchLeaderboard(url: string, fetchImpl: (u: string, i: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }> = globalThis.fetch as never): Promise<{ rank: number; entry: LeaderboardEntry }[]> {
  const res = await fetchImpl(`${url.replace(/\/$/, "")}/v1/leaderboard?limit=100`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("Le classement ne répond pas pour l'instant.");
  const body = (await res.json()) as { entries?: { rank: number; entry: LeaderboardEntry }[] };
  return Array.isArray(body.entries) ? body.entries : [];
}
