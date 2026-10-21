import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, leaderboardEntry, rankLeaderboard, replay, revenueBand, validEntry, type DomainEvent, type LeaderboardEntry } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;
const company: DomainEvent = {
  type: "company.founded",
  company: { id: "c", name: "Maison Lumen", idea: "Bougies", founder: { name: "Inès Martin" }, city: "Lille", foundedAt: NOW - 10 * DAY, stage: "launch", paused: false },
  settings: DEFAULT_SETTINGS,
};
const sale = (id: string, euros: number): DomainEvent => ({ type: "sale.recorded", sale: { id, at: NOW, amountCents: euros * 100 } });

describe("leaderboard", () => {
  it("shares only what a public ranking needs: no idea, no founder surname, no money unless chosen", () => {
    const s = replay([company, { type: "office.moved", tier: 1, at: NOW }, sale("a", 1200), sale("b", 300)]);
    const hidden = leaderboardEntry(s, NOW, { showRevenue: false });
    expect(hidden).toMatchObject({ companyId: "c", name: "Maison Lumen", founder: "Inès", city: "Lille", stage: "launch", office: 1, sales: 2, days: 10, revenueBand: "1 000 à 5 000 €" });
    expect(hidden.revenue).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain("Martin");
    expect(JSON.stringify(hidden)).not.toContain("Bougies");
    expect(leaderboardEntry(s, NOW, { showRevenue: true }).revenue).toBe(150_000);
  });

  it("bands revenue so it can be compared without being disclosed", () => {
    expect([0, 50_000, 120_000, 2_000_000, 50_000_000].map(revenueBand)).toEqual(["Pas encore de vente", "Moins de 1 000 €", "1 000 à 5 000 €", "10 000 à 50 000 €", "Plus de 100 000 €"]);
  });

  it("ranks by progress: stage, office, then revenue band, then sales; the faster wins a tie", () => {
    const e = (over: Partial<LeaderboardEntry>): LeaderboardEntry => ({ companyId: "x", name: "x", stage: "research", office: 0, sales: 0, revenueBand: "Pas encore de vente", days: 10, xp: 0, updatedAt: NOW, ...over });
    const ranked = rankLeaderboard([
      e({ companyId: "slow", stage: "launch", office: 1, days: 40 }),
      e({ companyId: "seed", stage: "research" }),
      e({ companyId: "fast", stage: "launch", office: 1, days: 12 }),
      e({ companyId: "big", stage: "operating", office: 2, sales: 12, revenueBand: "10 000 à 50 000 €" }),
    ]);
    expect(ranked.map((r) => [r.rank, r.entry.companyId])).toEqual([
      [1, "big"],
      [2, "fast"],
      [3, "slow"],
      [4, "seed"],
    ]);
  });

  it("refuses malformed or oversized entries", () => {
    const s = replay([company]);
    expect(validEntry(leaderboardEntry(s, NOW, { showRevenue: true }))).toBe(true);
    expect(validEntry({ ...leaderboardEntry(s, NOW, { showRevenue: false }), name: "x".repeat(500) })).toBe(false);
    expect(validEntry({ ...leaderboardEntry(s, NOW, { showRevenue: false }), office: 9 })).toBe(false);
    expect(validEntry({ nope: true })).toBe(false);
  });
});
