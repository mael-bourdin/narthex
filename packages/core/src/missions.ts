import type { RuntimeName } from "./protocol.ts";
import { dollars, relative } from "./format.ts";
import { filView } from "./fil.ts";
import { declinedByFounder, MAX_ATTEMPTS, overBudget, spentOn } from "./policy.ts";
import { forFounder } from "./views.ts";
import type { CompanyState, Timestamp } from "./types.ts";

/**
 * What the colored sign at the top of the Fil shows, most important first. Never empty for a company:
 * the founder always sees the one thing that matters now, and acts on it in a popup, never in the Fil.
 */
export interface Mission {
  id: string;
  kind: "key" | "budget" | "legal" | "stuck" | "cancel" | "mission" | "rest";
  eyebrow: string;
  title: string;
  why: string;
  speakerId?: string;
  /** What the popup offers. */
  action: "key" | "budget" | "form" | "fulfill" | "retry" | "cancel" | "open" | "sale" | "forget" | "none";
  label: string;
  taskId?: string;
  obligationId?: string;
  factId?: string;
}

/** The progress line an agent shows before it says anything specific (French in older logs). */
export const WORKING: readonly string[] = ["Working…", "Au travail…"];

export function missions(state: CompanyState, now: Timestamp, runtime: RuntimeName): Mission[] {
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
      eyebrow: "For you to do · so the team can work",
      title: "Add your API key",
      why: "Without it, the team gets everything ready but can't do any of the work. It stays on your computer.",
      ...(margaux ? { speakerId: margaux.id } : {}),
      action: "key",
      label: "Add my key",
    });
  }

  if (overBudget(state, now)) {
    out.push({
      id: "budget",
      kind: "budget",
      eyebrow: "The team stops for today",
      title: "Today's budget reached",
      why: `${dollars(spentOn(state, now))} of AI spend today, out of ${dollars(state.settings.dailyBudgetCredits)} planned. The team picks up again tomorrow, or right away if you raise the budget.`,
      ...(margaux ? { speakerId: margaux.id } : {}),
      action: "budget",
      label: "Adjust",
    });
  }

  for (const o of forFounder(state)) {
    out.push({
      id: o.id,
      kind: "legal",
      eyebrow: "For you to do · required by law",
      title: o.title,
      why: o.why,
      ...(legalSpeaker ? { speakerId: legalSpeaker.id } : {}),
      action: o.code === "A3-forme" ? "form" : "fulfill",
      label: o.code === "A3-forme" ? "Choose" : "View",
      obligationId: o.id,
    });
  }

  for (const o of Object.values(state.obligations)) {
    const declined = o.status === "open" && o.owner !== "founder" && !o.stuck && declinedByFounder(state, o);
    if (o.status !== "open" || (!o.stuck && !declined)) continue;
    const owner = o.owner === "founder" ? undefined : agents.find((a) => a.role === o.owner);
    out.push({
      id: `stuck-${o.id}`,
      kind: "stuck",
      eyebrow: o.stuck ? `Stuck after ${MAX_ATTEMPTS} tries · your call is needed` : "You cancelled it · pick it up when you like",
      title: o.title,
      why: o.stuck
        ? `Last error: ${o.stuck.error} The team stopped trying and is waiting for you to tell it to try again.`
        : "The team won't do it again without you. It is still an obligation: pick it up again when the time is right.",
      ...(owner ? { speakerId: owner.id } : margaux ? { speakerId: margaux.id } : {}),
      action: "retry",
      label: "View",
      obligationId: o.id,
    });
  }

  for (const t of tasks
    .filter((t) => t.status === "planned" && t.kind === "external" && (t.cancellableUntil ?? 0) > now)
    .sort((a, b) => a.cancellableUntil! - b.cancellableUntil!)) {
    out.push({
      id: t.id,
      kind: "cancel",
      eyebrow: `Goes out ${relative(t.cancellableUntil!, now)} · you can cancel it`,
      title: t.title,
      why: t.why,
      speakerId: t.agentId,
      action: "cancel",
      label: "View",
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
      eyebrow: focus.status === "running" ? `In progress · ${state.agents[focus.agentId]?.name ?? ""}` : "Next mission",
      title: focus.title,
      why: focus.progress && !WORKING.includes(focus.progress) ? focus.progress : focus.why,
      speakerId: focus.agentId,
      action: "open",
      label: "View",
      taskId: focus.id,
    });
  }

  if (out.length === 0) {
    const quest = filView(state, now).quest;
    out.push({
      id: "rest",
      kind: "rest",
      eyebrow: "The team is up to date",
      title: quest?.next ?? "Nothing urgent",
      why: quest ? `${quest.title}: ${quest.done} of ${quest.total} steps done.` : "The team will pick up again as soon as there's something to do.",
      ...(margaux ? { speakerId: margaux.id } : {}),
      action: "none",
      label: "",
    });
  }
  return out;
}
