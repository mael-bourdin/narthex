import { dollars, relative } from "./format.ts";
import { filView } from "./fil.ts";
import { overBudget, spentOn } from "./policy.ts";
import { forFounder } from "./views.ts";
import type { CompanyState, Timestamp } from "./types.ts";

/**
 * What the colored sign at the top of the Fil shows, most important first. Never empty for a company:
 * the founder always sees the one thing that matters now, and acts on it in a popup, never in the Fil.
 */
export interface Mission {
  id: string;
  kind: "key" | "budget" | "legal" | "cancel" | "mission" | "rest";
  eyebrow: string;
  title: string;
  why: string;
  speakerId?: string;
  /** What the popup offers. */
  action: "key" | "budget" | "form" | "fulfill" | "cancel" | "open" | "none";
  label: string;
  taskId?: string;
  obligationId?: string;
}

export function missions(state: CompanyState, now: Timestamp, runtime: "simulation" | "anthropic" | "none"): Mission[] {
  if (!state.company) return [];
  const agents = Object.values(state.agents).sort((a, b) => a.hiredAt - b.hiredAt);
  const margaux = agents.find((a) => a.role === "cofondateur");
  const legalSpeaker = agents.find((a) => a.role === "juridique") ?? margaux;
  const tasks = Object.values(state.tasks);
  const out: Mission[] = [];

  if (runtime === "none") {
    out.push({
      id: "key",
      kind: "key",
      eyebrow: "À faire par toi · pour que l'équipe travaille",
      title: "Ajoute ta clé API",
      why: "Sans elle, l'équipe prépare tout mais ne peut rien faire. Elle reste sur ton ordinateur.",
      ...(margaux ? { speakerId: margaux.id } : {}),
      action: "key",
      label: "Ajouter ma clé",
    });
  }

  if (overBudget(state, now)) {
    out.push({
      id: "budget",
      kind: "budget",
      eyebrow: "L'équipe s'arrête pour aujourd'hui",
      title: "Budget du jour atteint",
      why: `${dollars(spentOn(state, now))} de dépense IA aujourd'hui, sur ${dollars(state.settings.dailyBudgetCredits)} prévus. L'équipe reprend demain, ou tout de suite si tu augmentes le budget.`,
      ...(margaux ? { speakerId: margaux.id } : {}),
      action: "budget",
      label: "Ajuster",
    });
  }

  for (const o of forFounder(state)) {
    out.push({
      id: o.id,
      kind: "legal",
      eyebrow: "À faire par toi · la loi l'impose",
      title: o.title,
      why: o.why,
      ...(legalSpeaker ? { speakerId: legalSpeaker.id } : {}),
      action: o.code === "A3-forme" ? "form" : "fulfill",
      label: o.code === "A3-forme" ? "Choisir" : "Voir",
      obligationId: o.id,
    });
  }

  for (const t of tasks
    .filter((t) => t.status === "planned" && t.kind === "external" && (t.cancellableUntil ?? 0) > now)
    .sort((a, b) => a.cancellableUntil! - b.cancellableUntil!)) {
    out.push({
      id: t.id,
      kind: "cancel",
      eyebrow: `Part ${relative(t.cancellableUntil!, now)} · tu peux l'annuler`,
      title: t.title,
      why: t.why,
      speakerId: t.agentId,
      action: "cancel",
      label: "Voir",
      taskId: t.id,
    });
  }

  const running = tasks.filter((t) => t.status === "running").sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const next = tasks.filter((t) => t.status === "planned" && t.kind !== "external").sort((a, b) => a.scheduledAt - b.scheduledAt);
  const focus = running[0] ?? next[0];
  if (focus) {
    out.push({
      id: focus.id,
      kind: "mission",
      eyebrow: focus.status === "running" ? `En cours · ${state.agents[focus.agentId]?.name ?? ""}` : "Prochaine mission",
      title: focus.title,
      why: focus.progress && focus.progress !== "Au travail…" ? focus.progress : focus.why,
      speakerId: focus.agentId,
      action: "open",
      label: "Voir",
      taskId: focus.id,
    });
  }

  if (out.length === 0) {
    const quest = filView(state, now).quest;
    out.push({
      id: "rest",
      kind: "rest",
      eyebrow: "L'équipe est à jour",
      title: quest?.next ?? "Rien ne presse",
      why: quest ? `${quest.title} : ${quest.done} étapes sur ${quest.total}.` : "L'équipe reprendra dès qu'il y aura quelque chose à faire.",
      ...(margaux ? { speakerId: margaux.id } : {}),
      action: "none",
      label: "",
    });
  }
  return out;
}
