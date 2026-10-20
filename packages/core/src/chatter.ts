import type { StoredEvent } from "./events.ts";
import { day, hour } from "./format.ts";
import type { CompanyState, RoleId } from "./types.ts";

/**
 * What the team says on the founder's chat (Discord first): the same real events as the Fil,
 * each in its team's channel, under the agent's own name and face. The founder follows the company
 * without opening the app. Never invented: only events that happened.
 */
export type ChannelKey = "general" | "decisions" | "recherche" | "juridique" | "ventes";

export const CHAT_CHANNELS: readonly { key: ChannelKey; name: string; topic: string }[] = [
  { key: "general", name: "général", topic: "Toute l'équipe : arrivées, étapes, nouvelles." },
  { key: "decisions", name: "décisions", topic: "Ce qui t'attend, et ce qui part bientôt (tu peux l'annuler)." },
  { key: "recherche", name: "recherche", topic: "Études de marché et recherche technique." },
  { key: "juridique", name: "juridique-et-compta", topic: "Société, obligations, chiffres." },
  { key: "ventes", name: "ventes-et-com", topic: "Prospects, site, contenus." },
];

const CHANNEL_OF: Record<RoleId, ChannelKey> = {
  cofondateur: "general",
  recherche: "recherche",
  technique: "recherche",
  juridique: "juridique",
  comptable: "juridique",
  prospection: "ventes",
  redaction: "ventes",
  video: "ventes",
  support: "ventes",
};

export interface ChatMessage {
  channel: ChannelKey;
  as: { name: string; role: RoleId };
  text: string;
  /** Emoji the team adds under the message. */
  reactions: string[];
  /** A colleague who answers in a thread (a short remark written by a small model). */
  replyFrom?: { name: string; role: RoleId };
}

export function chatFor(state: CompanyState, event: StoredEvent): ChatMessage[] {
  const agents = Object.values(state.agents).sort((a, b) => a.hiredAt - b.hiredAt);
  const margaux = agents.find((a) => a.role === "cofondateur");
  const legal = agents.find((a) => a.role === "juridique") ?? margaux;
  const speaker = (a: { name: string; role: RoleId }) => ({ name: a.name, role: a.role });

  switch (event.type) {
    case "post.published": {
      const agent = state.agents[event.post.agentId];
      if (!agent) return [];
      const d = event.post.deliverableId ? state.deliverables[event.post.deliverableId] : undefined;
      // Someone else answers a piece of work: Margaux, or, for hers, the first teammate.
      const colleague = d ? (agent.role === "cofondateur" ? agents.find((a) => a.id !== agent.id) : margaux) : undefined;
      return [
        {
          channel: event.post.kind === "hire" ? "general" : CHANNEL_OF[agent.role],
          as: speaker(agent),
          text: d ? `${event.post.text}\n> **${d.title}** · ${d.summary}` : event.post.text,
          reactions: event.post.kind === "deliverable" ? ["📄"] : event.post.kind === "hire" ? ["👋"] : [],
          ...(colleague ? { replyFrom: speaker(colleague) } : {}),
        },
      ];
    }
    case "obligation.opened": {
      if (event.obligation.owner !== "founder" || !legal) return [];
      const due = event.obligation.due ? ` Avant le ${day(event.obligation.due)}.` : "";
      return [{ channel: "decisions", as: speaker(legal), text: `**À faire par toi : ${event.obligation.title}.** ${event.obligation.why}${due} Tu le fais depuis l'app ou le CLI.`, reactions: ["⚖️"] }];
    }
    case "obligation.stuck": {
      const o = state.obligations[event.obligationId];
      const owner = o && o.owner !== "founder" ? agents.find((a) => a.role === o.owner) : margaux;
      if (!o || !owner) return [];
      return [{ channel: "decisions", as: speaker(owner), text: `Je bloque sur « ${o.title} » malgré plusieurs essais : ${event.error} Dis-moi de reprendre quand tu veux.`, reactions: ["⚠️"] }];
    }
    case "task.planned": {
      const t = event.task;
      const agent = state.agents[t.agentId];
      if (t.kind !== "external" || !t.cancellableUntil || !agent) return [];
      return [{ channel: "decisions", as: speaker(agent), text: `Je prévois : **${t.title}**. ${t.why} Tu peux l'annuler jusqu'au ${day(t.cancellableUntil)} à ${hour(t.cancellableUntil)}.`, reactions: ["⏳"] }];
    }
    case "stage.changed":
      return margaux ? [{ channel: "general", as: speaker(margaux), text: `Nouvelle étape pour ${state.company?.name ?? "la société"} : **${STAGE_SAID[event.stage] ?? event.stage}**.`, reactions: ["🎉"] }] : [];
    case "sale.recorded":
      return margaux ? [{ channel: "general", as: speaker(margaux), text: `Une vente${event.sale.amountCents !== undefined ? ` de ${(event.sale.amountCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""} ! ${event.sale.note ?? ""}`.trim(), reactions: ["🎉"] }] : [];
    default:
      return [];
  }
}

const STAGE_SAID: Record<string, string> = { research: "on étudie l'idée", creation: "on crée la société", launch: "on prépare le lancement", operating: "l'entreprise est en activité" };
