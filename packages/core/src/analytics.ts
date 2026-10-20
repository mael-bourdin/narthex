import type { StoredEvent } from "./events.ts";
import { xpFor } from "./fil.ts";
import { dayKey } from "./format.ts";
import type { CompanyState, Id, RoleId, Stage, Timestamp } from "./types.ts";

/**
 * Entreprise · Données: the company's numbers, from real events only (Paris days, like the budget).
 * Money, work, quality, progression; the app draws them, the CLI prints them.
 */
export interface DayPoint {
  /** Noon UTC of the Paris day (always the same date in Paris). */
  day: Timestamp;
  spend: number;
  done: number;
  failed: number;
  /** Revenue recorded that day, in euro cents. */
  revenue: number;
}

export interface Analytics {
  money: { revenue: number; sales: number; spend: number; costPerDeliverable: number | null };
  days: DayPoint[];
  team: { agentId: Id; name: string; role: RoleId; done: number; failed: number; successRate: number | null; spend: number; xp: number; hours: number }[];
  quality: { deliverables: number; sourcesPerDeliverable: number | null; linksAnswering: number | null; facts: number };
  stages: { stage: Stage; at: Timestamp }[];
}

function noonOf(key: string, minusDays = 0): Timestamp {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d - minusDays, 12);
}

export function analytics(state: CompanyState, events: readonly StoredEvent[], now: Timestamp, days = 30): Analytics {
  const today = dayKey(now);
  const points = new Map<string, DayPoint>();
  // Never before the company existed: a young company is not a month of empty days.
  const founded = state.company ? dayKey(state.company.foundedAt) : today;
  const age = Math.round((noonOf(today) - noonOf(founded)) / 86_400_000) + 1;
  for (let i = Math.min(days, Math.max(1, age)) - 1; i >= 0; i--) {
    const day = noonOf(today, i);
    points.set(dayKey(day), { day, spend: 0, done: 0, failed: 0, revenue: 0 });
  }
  const at = (ts: Timestamp) => points.get(dayKey(ts));

  const spendBy = new Map<Id, number>();
  let spend = 0;
  for (const e of events) {
    if (e.type !== "usage.recorded") continue;
    spend += e.credits;
    spendBy.set(e.agentId, (spendBy.get(e.agentId) ?? 0) + e.credits);
    const p = at(e.at ?? e.ts);
    if (p) p.spend += e.credits;
  }

  const tasks = Object.values(state.tasks);
  // Interrupted by closing Narthex: not a failure of the agent (same rule as the policy).
  const failedFor = tasks.filter((t) => t.status === "failed" && !t.interrupted && !(t.error ?? "").startsWith("Interrompue (Narthex"));
  for (const t of tasks) {
    const p = t.status === "done" && t.endedAt ? at(t.endedAt) : undefined;
    if (p) p.done++;
  }
  for (const t of failedFor) {
    const p = t.endedAt ? at(t.endedAt) : undefined;
    if (p) p.failed++;
  }

  const sales = state.sales ?? [];
  for (const s of sales) {
    const p = at(s.at);
    if (p) p.revenue += s.amountCents ?? 0;
  }
  const revenue = sales.reduce((n, s) => n + (s.amountCents ?? 0), 0);

  const deliverables = Object.values(state.deliverables);
  const team = Object.values(state.agents)
    .map((agent) => {
      const own = tasks.filter((t) => t.agentId === agent.id);
      const done = own.filter((t) => t.status === "done");
      const failed = failedFor.filter((t) => t.agentId === agent.id).length;
      const xp = done.reduce((n, t) => n + xpFor(t, t.deliverableId ? (state.deliverables[t.deliverableId]?.sources.length ?? 0) : 0), 0);
      const hours = done.reduce((n, t) => n + (t.startedAt && t.endedAt ? (t.endedAt - t.startedAt) / 3_600_000 : 0), 0);
      return {
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        done: done.length,
        failed,
        successRate: done.length + failed ? done.length / (done.length + failed) : null,
        spend: spendBy.get(agent.id) ?? 0,
        xp,
        hours,
      };
    })
    .sort((a, b) => b.done + b.failed - (a.done + a.failed) || b.xp - a.xp);

  const sources = deliverables.reduce((n, d) => n + d.sources.length, 0);
  const checked = deliverables.flatMap((d) => d.sources.filter((s) => s.reachable !== undefined));
  const stages: Analytics["stages"] = [];
  for (const e of events) {
    if (e.type === "company.founded") stages.push({ stage: e.company.stage, at: e.company.foundedAt });
    if (e.type === "stage.changed") stages.push({ stage: e.stage, at: e.at });
  }

  return {
    money: { revenue, sales: sales.length, spend, costPerDeliverable: deliverables.length ? Math.round(spend / deliverables.length) : null },
    days: [...points.values()],
    team,
    quality: {
      deliverables: deliverables.length,
      sourcesPerDeliverable: deliverables.length ? Math.round((sources / deliverables.length) * 10) / 10 : null,
      linksAnswering: checked.length ? checked.filter((s) => s.reachable).length / checked.length : null,
      facts: Object.values(state.facts).filter((f) => f.invalidAt === undefined).length,
    },
    stages,
  };
}
