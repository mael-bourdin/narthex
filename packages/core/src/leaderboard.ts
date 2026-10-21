import { xpFor } from "./fil.ts";
import type { CompanyState, Stage, Timestamp } from "./types.ts";

/**
 * The public ranking of the companies run on Narthex's hosted version (open-source installs keep
 * their data at home and are not listed). Opt-in; only what a ranking needs is shared: the company's
 * name and city, the founder's first name, its stage and office, sales count, revenue as a band
 * (exact only if the founder chooses), age, XP. Never the idea, documents, or anyone's surname.
 */
export interface LeaderboardEntry {
  companyId: string;
  name: string;
  founder?: string;
  city?: string;
  stage: Stage;
  office: number;
  sales: number;
  revenueBand: string;
  /** Exact revenue in euro cents, only if the founder chose to show it. */
  revenue?: number;
  /** Days since founding. */
  days: number;
  xp: number;
  updatedAt: Timestamp;
}

const BANDS: readonly [number, string][] = [
  [0, "Pas encore de vente"],
  [100_000, "Moins de 1 000 €"],
  [500_000, "1 000 à 5 000 €"],
  [1_000_000, "5 000 à 10 000 €"],
  [5_000_000, "10 000 à 50 000 €"],
  [10_000_000, "50 000 à 100 000 €"],
];

export function revenueBand(cents: number): string {
  if (cents <= 0) return BANDS[0]![1];
  for (const [limit, label] of BANDS.slice(1)) if (cents < limit) return label;
  return "Plus de 100 000 €";
}

export function leaderboardEntry(state: CompanyState, now: Timestamp, options: { showRevenue: boolean }): LeaderboardEntry {
  const c = state.company!;
  const revenue = (state.sales ?? []).reduce((n, s) => n + (s.amountCents ?? 0), 0);
  const xp = Object.values(state.tasks)
    .filter((t) => t.status === "done")
    .reduce((n, t) => n + xpFor(t, t.deliverableId ? (state.deliverables[t.deliverableId]?.sources.length ?? 0) : 0), 0);
  const first = c.founder.name.trim().split(/\s+/)[0];
  return {
    companyId: c.id,
    name: c.name,
    ...(first ? { founder: first } : {}),
    ...(c.city ? { city: c.city } : {}),
    stage: c.stage,
    office: state.office ?? 0,
    sales: (state.sales ?? []).length,
    revenueBand: revenueBand(revenue),
    ...(options.showRevenue ? { revenue } : {}),
    days: Math.max(0, Math.floor((now - c.foundedAt) / 86_400_000)),
    xp,
    updatedAt: now,
  };
}

const STAGES: Stage[] = ["idea", "research", "creation", "launch", "operating"];
const BAND_ORDER = [...BANDS.map(([, l]) => l), "Plus de 100 000 €"];

/** Progress first (stage, office, revenue band, sales), then speed: the younger company wins a tie. */
export function rankLeaderboard(entries: readonly LeaderboardEntry[]): { rank: number; entry: LeaderboardEntry }[] {
  const key = (e: LeaderboardEntry) => [STAGES.indexOf(e.stage), e.office, BAND_ORDER.indexOf(e.revenueBand), e.sales, -e.days];
  const sorted = [...entries].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
    return a.name.localeCompare(b.name, "fr");
  });
  return sorted.map((entry, i) => ({ rank: i + 1, entry }));
}

/** What the leaderboard service accepts: a well-formed entry with sane sizes. */
export function validEntry(value: unknown): value is LeaderboardEntry {
  const e = value as Partial<LeaderboardEntry> | null;
  const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
  const optional = (v: unknown, max: number) => v === undefined || text(v, max);
  const count = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
  return (
    !!e &&
    text(e.companyId, 64) &&
    text(e.name, 80) &&
    optional(e.founder, 40) &&
    optional(e.city, 60) &&
    STAGES.includes(e.stage as Stage) &&
    count(e.office, 4) &&
    count(e.sales, 1_000_000) &&
    BAND_ORDER.includes(e.revenueBand as string) &&
    (e.revenue === undefined || count(e.revenue, 1e12)) &&
    count(e.days, 100_000) &&
    count(e.xp, 1e9) &&
    typeof e.updatedAt === "number"
  );
}
