import { DEFAULT_STAFFING } from "./policy.ts";
import { role, ROLES, type RoleDef } from "./roles.ts";
import type { RoleId, StaffingEntry } from "./types.ts";

/** What the founder sees in the first minutes ("the threshold", SEUIL). Shared by the app and the CLI. */

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
  hello: "Good evening. I'm Margaux, your future co-founder.",
  askKey: "To think, I need a key. Paste your API key: Anthropic, OpenAI, or OpenRouter to choose from every model.",
  keyAside: "It stays on your computer. You can remove it whenever you like.",
  checking: "Checking…",
  askWhatsApp: "One last thing: do you want us to write to you on WhatsApp? You'll follow the team without opening the app.",
  whatsAppLater: "You can connect it later: narthex whatsapp, or Settings · Integrations.",
  badKey: "This key doesn't work. Check it and paste it again.",
  skipKey: "No key for now? Later",
  noKeyYet: "All right. The team will get everything ready and wait for your key to start working.",
  askName: "I can hear you. What's your name?",
  askNameNoKey: "What's your name?",
  askIdea: (name: string) => `Nice to meet you, ${name}. Tell me your idea. One sentence is enough.`,
  searching: "I'm looking at what already exists…",
  noLook: "I couldn't search just now. Léa will take care of it as soon as she arrives.",
  team: "There's room for you. I'm bringing in the team.",
  later: "Joins once we have something to sell",
  askCompany: "What do we call your company? Even a working name will do.",
  welcome: (company: string) => `Welcome to ${company}. Let's begin.`,
  enter: "Enter",
} as const;

/** One line per role: what they will do for the founder. */
export const ROLE_PROMISE: Record<RoleId, string> = {
  cofondateur: "Holds the vision and brings in the team",
  recherche: "Studies your market and your competitors",
  technique: "Checks it can be done, technically and at the right cost",
  juridique: "Sets up your company, keeps track of your obligations",
  prospection: "Finds your first customers",
  redaction: "Writes your website and your posts",
  video: "Makes the brand known through video",
  comptable: "Prepares invoices, VAT and cash flow",
  support: "Answers your customers",
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
  const study = seen.has("recherche") ? [] : [{ role: "recherche" as const, at: "research" as const, why: "The market study opens the way to creating the company." }];
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
