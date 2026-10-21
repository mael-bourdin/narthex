import type { CompanyState, Stage } from "./types.ts";

/**
 * The Bureau grows with the company, like a game: a run-down little house at first, then better and
 * better offices. Thresholds stay hidden: the move is a surprise, announced by Margaux when the real
 * results (stage, revenue, team) allow it. It is a picture of progress, never a real-world lease.
 */
export interface Office {
  tier: 0 | 1 | 2 | 3 | 4;
  name: string;
  /** What Margaux says when the team moves in (Fil and chat). */
  line: string;
  /** Reached when… (hidden from the player). */
  when(state: CompanyState): boolean;
}

const STAGE_ORDER: Stage[] = ["idea", "research", "creation", "launch", "operating"];
const atLeast = (s: CompanyState, stage: Stage) => STAGE_ORDER.indexOf(s.company?.stage ?? "idea") >= STAGE_ORDER.indexOf(stage);
const revenue = (s: CompanyState) => (s.sales ?? []).reduce((n, v) => n + (v.amountCents ?? 0), 0);
const team = (s: CompanyState) => Object.keys(s.agents).length;

export const OFFICES: readonly Office[] = [
  { tier: 0, name: "The little house", line: "", when: () => true },
  {
    tier: 1,
    name: "The small office",
    line: "Surprise: with what we've built, the team can leave the little house. Welcome to the small office, a real desk for everyone.",
    when: (s) => atLeast(s, "launch") || revenue(s) >= 50_000,
  },
  {
    tier: 2,
    name: "The offices in town",
    line: "Sales are coming in: the team treats itself to real offices in town, with light and plants. We're moving.",
    when: (s) => revenue(s) >= 300_000 && (s.sales?.length ?? 0) >= 3,
  },
  {
    tier: 3,
    name: "The whole floor",
    line: "We're growing: a whole floor for the team, with a glass meeting room and a corner to catch your breath.",
    when: (s) => revenue(s) >= 1_500_000 && team(s) >= 6,
  },
  {
    tier: 4,
    name: "The tower",
    line: "This is it: the team moves into a tower, over several floors, with a lift and a view over the whole city.",
    when: (s) => revenue(s) >= 6_000_000,
  },
];

export function officeOf(state: CompanyState): Office {
  return OFFICES[state.office ?? 0]!;
}

/** The best office the company can now afford, if better than the current one. */
export function nextOffice(state: CompanyState): Office | undefined {
  const best = [...OFFICES].reverse().find((o) => o.when(state));
  return best && best.tier > (state.office ?? 0) ? best : undefined;
}
