import { HIRING } from "./policy.ts";
import { emptyState } from "./projection.ts";
import { role, type RoleDef } from "./roles.ts";
import type { CompanyState, RoleId, Stage } from "./types.ts";

/** What the founder sees in the first minutes (« le seuil »). Shared by the app and the CLI. */

export interface Finding {
  text: string;
  source: string;
}

/** Margaux's first look at the idea, made before the company exists and recorded at founding. */
export interface FirstLook {
  reaction: string;
  findings: Finding[];
  simulated: boolean;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number };
}

export const SEUIL = {
  hello: "Bonsoir. Je suis Margaux, ta future co-fondatrice.",
  askKey: "Pour penser, j'ai besoin d'une clé. Colle ta clé API Anthropic.",
  keyAside: "Elle reste sur ton ordinateur. Tu peux la retirer quand tu veux.",
  checking: "Vérification…",
  badKey: "Cette clé ne marche pas. Vérifie-la et recolle-la.",
  skipKey: "Pas de clé ? Essayer en simulation",
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
  juridique: "Crée ta société, suit tes obligations",
  prospection: "Trouve tes premiers clients",
  redaction: "Écrit ton site et tes posts",
  video: "Fait connaître la marque en vidéo",
  comptable: "Prépare factures, TVA et trésorerie",
  support: "Répond à tes clients",
};

function hiredAt(stage: Stage): RoleId[] {
  const s: CompanyState = {
    ...emptyState(),
    company: { id: "", name: "", idea: "", founder: { name: "" }, foundedAt: 0, stage, paused: false },
  };
  return HIRING.filter((h) => h.when(s)).map((h) => h.role);
}

/** Who joins at the study stage, and who will come next — straight from the hiring rules. */
export function onboardingTeam(): { now: RoleDef[]; later: RoleDef[] } {
  const now = hiredAt("research").filter((r) => r !== "cofondateur");
  const later = hiredAt("creation").filter((r) => r !== "cofondateur" && !now.includes(r));
  return { now: now.map(role), later: later.map(role) };
}
