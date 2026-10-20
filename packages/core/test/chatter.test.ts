import { describe, expect, it } from "vitest";
import { chatFor, CHAT_CHANNELS, DEFAULT_SETTINGS, replay, type DomainEvent, type StoredEvent } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 20, 9);
const hire = (id: string, name: string, role: "cofondateur" | "recherche" | "juridique" | "prospection"): DomainEvent => ({
  type: "agent.hired",
  reason: "",
  agent: { id, name, role, hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
});
const base: DomainEvent[] = [
  { type: "company.founded", company: { id: "c", name: "Maison Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
  hire("m", "Margaux", "cofondateur"),
  hire("l", "Léa", "recherche"),
  hire("h", "Hugo", "juridique"),
];
const stored = (events: DomainEvent[]) => events.map((e, i) => ({ ...e, seq: i + 1, ts: NOW, companyId: "c" }) as StoredEvent);
const after = (extra: DomainEvent[]) => {
  const all = stored([...base, ...extra]);
  return chatFor(replay(all), all.at(-1)!);
};

describe("what the team says on the chat (Discord)", () => {
  it("has a few clear channels", () => {
    expect(CHAT_CHANNELS.map((c) => c.name)).toEqual(["général", "décisions", "recherche", "juridique-et-compta", "ventes-et-com"]);
  });

  it("posts a deliverable in its team's channel, under the agent's own name, with a reaction and a colleague to answer", () => {
    const out = after([
      { type: "task.planned", task: { id: "t", agentId: "l", title: "Étude de marché", why: "", kind: "internal", status: "planned", createdAt: NOW, scheduledAt: NOW } },
      { type: "task.completed", taskId: "t", at: NOW, deliverable: { id: "d", taskId: "t", agentId: "l", title: "Étude de marché", summary: "Cinq bougiers à Lille.", body: "…", sources: [], createdAt: NOW } },
      { type: "post.published", post: { id: "p", agentId: "l", at: NOW, kind: "deliverable", text: "J'ai fini l'étude.", taskId: "t", deliverableId: "d" } },
    ]);
    expect(out).toEqual([
      {
        channel: "recherche",
        as: { name: "Léa", role: "recherche" },
        text: "J'ai fini l'étude.\n> **Étude de marché** · Cinq bougiers à Lille.",
        reactions: ["📄"],
        replyFrom: { name: "Margaux", role: "cofondateur" },
      },
    ]);
  });

  it("puts what waits on the founder in #décisions", () => {
    const out = after([{ type: "obligation.opened", obligation: { id: "o", code: "A3-forme", title: "Choisir la forme juridique", why: "C'est toi qui choisis.", owner: "founder", status: "open", openedAt: NOW, due: NOW + 7 * 86_400_000 } }]);
    expect(out[0]).toMatchObject({ channel: "decisions", as: { name: "Hugo" }, reactions: ["⚖️"] });
    expect(out[0]!.text).toContain("Choisir la forme juridique");
  });

  it("announces an action that will leave, with the time left to cancel it", () => {
    const out = after([{ type: "task.planned", task: { id: "x", agentId: "h", title: "Déposer la marque", why: "Protéger le nom", kind: "external", status: "planned", createdAt: NOW, scheduledAt: NOW, cancellableUntil: NOW + 86_400_000 } }]);
    expect(out[0]).toMatchObject({ channel: "decisions", as: { name: "Hugo" } });
    expect(out[0]!.text).toMatch(/annuler/);
  });

  it("says nothing for internal bookkeeping", () => {
    expect(after([{ type: "usage.recorded", agentId: "l", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits: 1 }])).toEqual([]);
  });
});
