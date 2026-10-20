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
  { tier: 0, name: "La petite maison", line: "", when: () => true },
  {
    tier: 1,
    name: "Le petit local",
    line: "Surprise : avec ce qu'on a construit, l'équipe peut quitter la petite maison. Bienvenue dans le petit local, un vrai bureau pour chacun. Va voir le Bureau.",
    when: (s) => atLeast(s, "launch") || revenue(s) >= 50_000,
  },
  {
    tier: 2,
    name: "Les bureaux en ville",
    line: "Les ventes suivent : l'équipe s'offre de vrais bureaux en ville, avec de la lumière et des plantes. On déménage !",
    when: (s) => revenue(s) >= 300_000 && (s.sales?.length ?? 0) >= 3,
  },
  {
    tier: 3,
    name: "Le plateau",
    line: "On grandit : un plateau entier pour l'équipe, avec une salle de réunion vitrée et un coin pour souffler.",
    when: (s) => revenue(s) >= 1_500_000 && team(s) >= 6,
  },
  {
    tier: 4,
    name: "La tour",
    line: "Ça y est : l'équipe s'installe dans une tour, sur plusieurs étages, avec un ascenseur et une vue sur toute la ville.",
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
