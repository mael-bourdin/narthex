import { DEFAULT_STAFFING } from "./policy.ts";
import { role, ROLES, type RoleDef } from "./roles.ts";
import type { RoleId, StaffingEntry } from "./types.ts";

/** What the founder sees in the first minutes (« le seuil »). Shared by the app and the CLI. */

export interface Finding {
  text: string;
  source: string;
}

/** Margaux's first look at the idea, made before the company exists and recorded at founding. */
export interface TeamPick {
  role: RoleId;
  why: string;
}

export interface FirstLook {
  reaction: string;
  findings: Finding[];
  simulated: boolean;
  /** Who Margaux brings now for this idea, and who will come once the company is being created. */
  team?: TeamPick[];
  later?: TeamPick[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number };
}

export const SEUIL = {
  hello: "Bonsoir. Je suis Margaux, ta future co-fondatrice.",
  askKey: "Pour penser, j'ai besoin d'une clé. Colle ta clé API : Anthropic, OpenAI, ou OpenRouter pour choisir parmi tous les modèles.",
  keyAside: "Elle reste sur ton ordinateur. Tu peux la retirer quand tu veux.",
  checking: "Vérification…",
  badKey: "Cette clé ne marche pas. Vérifie-la et recolle-la.",
  skipKey: "Pas de clé pour l'instant ? Plus tard",
  noKeyYet: "D'accord. L'équipe préparera tout et attendra ta clé pour se mettre au travail.",
  askName: "Je t'entends. Comment tu t'appelles ?",
  askNameNoKey: "Comment tu t'appelles ?",
  askIdea: (name: string) => `Enchantée, ${name}. Raconte-moi ton idée. Une phrase suffit.`,
  searching: "Je regarde ce qui existe déjà…",
  noLook: "Je n'ai pas pu chercher maintenant. Léa s'en occupera dès son arrivée.",
  team: "Il y a de la place pour toi. Je fais venir l'équipe.",
  later: "Arrivera quand on aura quelque chose à vendre",
  askCompany: "On l'appelle comment, ta maison ? Même provisoire.",
  welcome: (company: string) => `Bienvenue chez ${company}. On commence.`,
  enter: "Entrer",
} as const;

/** One line per role: what they will do for the founder. */
export const ROLE_PROMISE: Record<RoleId, string> = {
  cofondateur: "Tient la vision et fait venir l'équipe",
  recherche: "Étudie ton marché et tes concurrents",
  technique: "Vérifie que c'est faisable, techniquement et au bon coût",
  juridique: "Crée ta société, suit tes obligations",
  prospection: "Trouve tes premiers clients",
  redaction: "Écrit ton site et tes posts",
  video: "Fait connaître la marque en vidéo",
  comptable: "Prépare factures, TVA et trésorerie",
  support: "Répond à tes clients",
};

const KNOWN = new Set<string>(ROLES.map((r) => r.id));

function clean(picks: TeamPick[] | undefined, exclude: Set<string>, max: number): TeamPick[] {
  const out: TeamPick[] = [];
  for (const p of picks ?? []) {
    if (!KNOWN.has(p.role) || p.role === "cofondateur" || exclude.has(p.role)) continue;
    exclude.add(p.role);
    out.push(p);
    if (out.length === max) break;
  }
  return out;
}

/** Margaux's choice turned into a staffing plan; the usual plan when she could not choose. */
export function staffingFrom(look?: FirstLook): StaffingEntry[] {
  const seen = new Set<string>();
  const now = clean(look?.team, seen, 3);
  if (now.length === 0) return [...DEFAULT_STAFFING];
  const later = clean(look?.later, seen, 3);
  // Creating the company waits for a market study: someone has to do it, whoever else Margaux picked.
  const study = seen.has("recherche") ? [] : [{ role: "recherche" as const, at: "research" as const, why: "L'étude de marché ouvre la création de la société." }];
  return [
    DEFAULT_STAFFING[0]!,
    ...now.map((p) => ({ role: p.role, at: "research" as const, why: p.why })),
    ...study,
    ...later.map((p) => ({ role: p.role, at: "creation" as const, why: p.why })),
    // Later stages keep the usual roles, unless Margaux already brought them.
    ...DEFAULT_STAFFING.filter((e) => (e.at === "launch" || e.at === "operating") && !seen.has(e.role)),
  ];
}

/** Who joins now and who comes later, as shown during the first launch. */
export function onboardingTeam(look?: FirstLook): { now: RoleDef[]; later: RoleDef[] } {
  const plan = staffingFrom(look);
  return {
    now: plan.filter((e) => e.at === "research").map((e) => role(e.role)),
    later: plan.filter((e) => e.at === "creation").map((e) => role(e.role)),
  };
}
