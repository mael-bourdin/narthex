import type { StoredEvent } from "./events.ts";
import { day, euros, hour } from "./format.ts";
import { OFFICES } from "./office.ts";
import type { CompanyState, RoleId } from "./types.ts";

/**
 * What the team says on the founder's chat (Discord first): the same real events as the Fil,
 * each in its team's channel, under the agent's own name and face. The founder follows the company
 * without opening the app. Never invented: only events that happened.
 */
export type ChannelKey = "general" | "decisions" | "recherche" | "juridique" | "ventes";

export const CHAT_CHANNELS: readonly { key: ChannelKey; name: string; topic: string }[] = [
  { key: "general", name: "general", topic: "The whole team: arrivals, stages, news." },
  { key: "decisions", name: "decisions", topic: "What's waiting for you, and what goes out soon (you can cancel it)." },
  { key: "recherche", name: "research", topic: "Market studies and technical research." },
  { key: "juridique", name: "legal-and-accounts", topic: "Company, obligations, numbers." },
  { key: "ventes", name: "sales-and-marketing", topic: "Prospects, website, content." },
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
      const due = event.obligation.due ? ` Before ${day(event.obligation.due)}.` : "";
      return [{ channel: "decisions", as: speaker(legal), text: `**For you to do: ${event.obligation.title}.** ${event.obligation.why}${due} You can do it from the app or the CLI.`, reactions: ["⚖️"] }];
    }
    case "obligation.stuck": {
      const o = state.obligations[event.obligationId];
      const owner = o && o.owner !== "founder" ? agents.find((a) => a.role === o.owner) : margaux;
      if (!o || !owner) return [];
      return [{ channel: "decisions", as: speaker(owner), text: `I'm stuck on "${o.title}" after several tries: ${event.error} Tell me to try again whenever you like.`, reactions: ["⚠️"] }];
    }
    case "task.planned": {
      const t = event.task;
      const agent = state.agents[t.agentId];
      if (t.kind !== "external" || !t.cancellableUntil || !agent) return [];
      return [{ channel: "decisions", as: speaker(agent), text: `I'm planning: **${t.title}**. ${t.why} You can cancel it until ${day(t.cancellableUntil)} at ${hour(t.cancellableUntil)}.`, reactions: ["⏳"] }];
    }
    case "stage.changed":
      return margaux ? [{ channel: "general", as: speaker(margaux), text: `New stage for ${state.company?.name ?? "the company"}: **${STAGE_SAID[event.stage] ?? event.stage}**.`, reactions: ["🎉"] }] : [];
    case "office.moved": {
      const line = OFFICES[event.tier]?.line;
      return margaux && line ? [{ channel: "general", as: speaker(margaux), text: line, reactions: ["🎉", "🏢"] }] : [];
    }
    case "sale.recorded":
      return margaux ? [{ channel: "general", as: speaker(margaux), text: `A sale${event.sale.amountCents !== undefined ? ` of ${euros(event.sale.amountCents)}` : ""}! ${event.sale.note ?? ""}`.trim(), reactions: ["🎉"] }] : [];
    default:
      return [];
  }
}

const STAGE_SAID: Record<string, string> = { research: "we're studying the idea", creation: "we're setting up the company", launch: "we're preparing the launch", operating: "the company is up and running" };
