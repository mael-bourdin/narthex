import { role, type ToolName } from "./roles.ts";
import type { CompanyState, Id, LegalForm, RoleId, Timestamp } from "./types.ts";
import type { StoredEvent } from "./events.ts";

/** What the law makes of the founder, by legal form (Réglages · Profil, « Ton rôle »). Neutral wording, no gender guessed. */
export function founderRoles(form: LegalForm | undefined): { title: string; detail: string }[] {
  switch (form) {
    case "SASU":
      return [
        { title: "Présidence", detail: "Tu signes au nom de la société" },
        { title: "Toutes les actions", detail: "Tu approuves toi-même les comptes chaque année" },
      ];
    case "SAS":
      return [
        { title: "Présidence", detail: "Tu signes au nom de la société" },
        { title: "Des actions", detail: "Les associés approuvent les comptes chaque année" },
      ];
    case "EURL":
      return [
        { title: "Gérance", detail: "Tu signes au nom de la société" },
        { title: "Toutes les parts", detail: "Tu approuves toi-même les comptes chaque année" },
      ];
    case "SARL":
      return [
        { title: "Gérance", detail: "Tu signes au nom de la société" },
        { title: "Des parts sociales", detail: "Les associés approuvent les comptes chaque année" },
      ];
    case "EI":
    case "micro":
      return [{ title: "Entreprise individuelle", detail: "Pas de société : tu signes et factures en ton nom" }];
    default:
      return [{ title: "Fondatrice ou fondateur", detail: "Ton rôle légal dépendra de la forme juridique que tu choisiras" }];
  }
}

export interface AgentSpend {
  agentId: Id;
  name: string;
  role: RoleId;
  credits: number;
  /** The task that cost this agent the most over the period, when the spend is tied to one. */
  top?: { taskId: Id; title: string; credits: number };
}

/** AI spend per agent since `since`, with the task that cost each one the most (Réglages · Budget, « Par agent »). */
export function spendByAgent(state: CompanyState, events: readonly StoredEvent[], since: Timestamp): AgentSpend[] {
  const byAgent = new Map<Id, { credits: number; byTask: Map<Id, number> }>();
  for (const e of events) {
    if (e.type !== "usage.recorded" || (e.at ?? e.ts) < since) continue;
    const a = byAgent.get(e.agentId) ?? { credits: 0, byTask: new Map<Id, number>() };
    a.credits += e.credits;
    if (e.taskId) a.byTask.set(e.taskId, (a.byTask.get(e.taskId) ?? 0) + e.credits);
    byAgent.set(e.agentId, a);
  }
  return [...byAgent.entries()]
    .map(([agentId, a]) => {
      const agent = state.agents[agentId];
      const [taskId, credits] = [...a.byTask.entries()].sort((x, y) => y[1] - x[1])[0] ?? [];
      const task = taskId ? state.tasks[taskId] : undefined;
      return {
        agentId,
        name: agent?.name ?? "?",
        role: agent?.role ?? "cofondateur",
        credits: a.credits,
        ...(task && credits !== undefined ? { top: { taskId: task.id, title: task.title, credits } } : {}),
      };
    })
    .sort((x, y) => y.credits - x.credits);
}

/** Names of the hired agents whose job sheet includes `tool`, in hiring order (Réglages · Intégrations, « Qui »). */
export function toolUsers(state: CompanyState, tool: ToolName): string[] {
  return Object.values(state.agents)
    .sort((a, b) => a.hiredAt - b.hiredAt)
    .filter((a) => role(a.role).tools.includes(tool))
    .map((a) => a.name);
}
