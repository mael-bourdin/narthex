import type { RuntimeName } from "./protocol.ts";
import { filView } from "./fil.ts";
import { missions, type Mission } from "./missions.ts";
import type { CompanyState, Id, Timestamp } from "./types.ts";

/** What a teammate says when the founder walks up to them in the Bureau. Real state only. */
export interface BureauDialogue {
  speakerId: Id;
  text: string;
  /** Shows the « ! » above their head. */
  waiting: boolean;
  options: { label: string; mission?: Mission; agent?: Id }[];
}

export function bureauDialogue(state: CompanyState, agentId: Id, now: Timestamp, runtime: RuntimeName): BureauDialogue {
  const agent = state.agents[agentId]!;
  const signs = missions(state, now, runtime);
  const mine = signs.find((m) => (m.kind === "legal" || m.kind === "stuck" || m.kind === "key" || m.kind === "budget" || m.kind === "cancel") && m.speakerId === agentId);
  const later = { label: "Plus tard" };
  if (mine) {
    const text =
      mine.kind === "legal"
        ? `Il me faut ta main pour « ${mine.title} ». ${mine.why}`
        : mine.kind === "stuck"
          ? `Je bloque sur « ${mine.title} » malgré plusieurs essais. ${mine.why}`
          : mine.kind === "key"
          ? "Pour qu'on travaille vraiment, j'ai besoin de ta clé API. Elle reste sur ton ordinateur."
          : mine.kind === "budget"
            ? `On a atteint le budget du jour. ${mine.why}`
            : `Je m'apprête à faire « ${mine.title} ». Tu peux encore l'annuler.`;
    return { speakerId: agentId, text, waiting: true, options: [{ label: mine.kind === "key" ? "Ajouter ma clé" : "Voir", mission: mine }, later] };
  }
  const row = filView(state, now).team.find((r) => r.agent.id === agentId);
  if (row?.current) {
    const detail = row.current.progress && row.current.progress !== "Au travail…" ? row.current.progress : row.current.why;
    return { speakerId: agentId, text: `Je travaille sur « ${row.current.title} ». ${detail.replace(/\.$/, "")}.`, waiting: false, options: [{ label: "Voir ma fiche", agent: agentId }, later] };
  }
  if (runtime === "none") {
    return { speakerId: agentId, text: "Tout est prêt pour commencer. Il ne manque que ta clé : sans elle, je ne peux rien faire.", waiting: false, options: [{ label: "Voir ma fiche", agent: agentId }, later] };
  }
  const next = Object.values(state.tasks)
    .filter((t) => t.agentId === agentId && t.status === "planned")
    .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
  const text = next ? `Je me repose. Ensuite, « ${next.title} ».` : agent.role === "cofondateur" ? "Tout est à jour. Je te préviens dès qu'il y a une décision à prendre." : "Je me repose. Rien de prévu pour l'instant.";
  return { speakerId: agentId, text, waiting: false, options: [{ label: "Voir ma fiche", agent: agentId }, later] };
}
