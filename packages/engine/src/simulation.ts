import { role, type FirstLook } from "@narthex/core";
import type { AgentRuntime, FollowUp, WorkContext, WorkResult } from "./runtime.ts";

/**
 * Offline, deterministic agents. They let anyone try Narthex without an API key,
 * keep the tests free, and give the UI something real to show while it is being built.
 * They never pretend to be real work: every deliverable says it is a simulation.
 */
export class SimulationRuntime implements AgentRuntime {
  readonly name = "simulation" as const;

  private readonly delayMs: number;

  constructor(delayMs = 0) {
    this.delayMs = delayMs;
  }

  async firstLook(): Promise<FirstLook> {
    return {
      reaction: "J'aime beaucoup l'idée.",
      findings: [
        { text: "Des centaines d'artisans vendent déjà quelque chose de proche en France", source: "Registre des entreprises (exemple)" },
        { text: "Les clients achètent surtout pour offrir", source: "Avis clients (exemple)" },
        { text: "Les prix se tiennent dans une fourchette resserrée", source: "Boutiques en ligne (exemple)" },
        { text: "Pour démarrer : micro-entreprise ou SASU", source: "Légifrance (exemple)" },
      ],
      simulated: true,
      team: [
        { role: "recherche", why: "Avant de créer quoi que ce soit, il faut connaître le marché." },
        { role: "juridique", why: "Il faut vérifier le nom et l'activité, puis créer la société." },
      ],
      later: [
        { role: "prospection", why: "Pour trouver les premiers clients." },
        { role: "redaction", why: "Pour le site et les posts." },
      ],
    };
  }

  async run(ctx: WorkContext): Promise<WorkResult> {
    const { task, agent, state } = ctx;
    const company = state.company;
    ctx.progress("Au travail…");
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (ctx.signal.aborted) throw new Error("Annulée");

    const script = SCRIPTS[task.tag ?? ""];
    const idea = company?.idea ?? "ton idée";
    const body = script
      ? script.body(idea, company?.name ?? "ton entreprise")
      : `Travail simulé pour « ${task.title} ».\n\nEn mode réel, ${agent.name} ferait ce travail avec Claude et citerait ses sources.`;

    for (const f of script?.followUps ?? []) ctx.plan(f);

    const effort = role(agent.role).effort;
    return {
      post: script?.post ?? `C'est fait : ${lower(task.title)}.`,
      deliverable: {
        title: task.title,
        summary: script?.summary ?? "Livrable de démonstration (mode simulation).",
        body: `> Mode simulation : contenu d'exemple, sans recherche réelle.\n\n${body}`,
        sources: [],
      },
      ...(task.tag === "plan" ? { memory: `${company?.name} — ${idea}. Lancement visé : dans six semaines.` } : {}),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, credits: effort === "high" ? 40 : effort === "medium" ? 15 : 5 },
    };
  }
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

interface Script {
  post: string;
  summary: string;
  body: (idea: string, name: string) => string;
  followUps?: FollowUp[];
}

const SCRIPTS: Record<string, Script> = {
  plan: {
    post: "J'ai écrit la fiche de l'entreprise et le plan des 30 premiers jours. Léa commence l'étude de marché, Hugo vérifie le nom.",
    summary: "Fiche de l'entreprise, objectifs, plan sur 30 jours.",
    body: (idea, name) =>
      `# ${name}\n\n**L'idée :** ${idea}\n\n## Les 30 premiers jours\n1. Étude de marché (Léa)\n2. Nom et activité vérifiés (Hugo)\n3. Création de la société\n4. Premiers prospects et site\n`,
  },
  "market-study": {
    post: "L'étude de marché est prête. Il y a de la place, surtout pour les cadeaux. Je te mets l'essentiel en pièce jointe.",
    summary: "Taille du marché, clientes, concurrents, prix moyens.",
    body: (idea) =>
      `# Étude de marché\n\n**Idée étudiée :** ${idea}\n\n| Point | Ce qu'on retient |\n|---|---|\n| Clientes | Achètent surtout pour offrir |\n| Concurrents | Nombreux, peu différenciés |\n| Prix | Dans la moyenne haute du marché |\n`,
  },
  prospects: {
    post: "J'ai trouvé 50 entreprises à qui écrire. Je prépare un message pour chacune ; l'envoi part demain, tu peux l'annuler d'ici là.",
    summary: "50 prospects qualifiés, avec la raison de chaque choix.",
    body: () => "# Prospects\n\n50 entreprises locales, classées par probabilité de réponse.\n",
    followUps: [
      { title: "Envoyer les messages de prospection", why: "Pour avoir les premiers rendez-vous avant le lancement.", kind: "external", tag: "outreach", inHours: 20 },
    ],
  },
  outreach: {
    post: "Les messages sont partis. Je lis les réponses au fil de l'eau et je cale les rendez-vous.",
    summary: "Messages envoyés, suivi des réponses.",
    body: () => "# Envoi\n\nMessages personnalisés envoyés. Relance prévue dans 4 jours.\n",
  },
};
