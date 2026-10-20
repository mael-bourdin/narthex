import { describe, expect, it } from "vitest";
import { chatFor, decide, DEFAULT_SETTINGS, officeOf, OFFICES, replay, type DomainEvent, type StoredEvent } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 20, 9);
const company = (stage: "research" | "creation" | "launch" | "operating" = "research"): DomainEvent => ({
  type: "company.founded",
  company: { id: "c", name: "Lumen", idea: "Bougies", founder: { name: "Inès" }, foundedAt: NOW, stage, paused: false },
  settings: DEFAULT_SETTINGS,
});
const margaux: DomainEvent = { type: "agent.hired", reason: "", agent: { id: "m", name: "Margaux", role: "cofondateur", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } };
const sale = (id: string, euros: number): DomainEvent => ({ type: "sale.recorded", sale: { id, at: NOW, amountCents: euros * 100 } });
const moves = (events: DomainEvent[]) => decide(replay(events), NOW).filter((i) => i.type === "move-office");

describe("the office grows with the company", () => {
  it("starts in a run-down little house", () => {
    expect(officeOf(replay([company(), margaux]))).toMatchObject({ tier: 0 });
    expect(OFFICES.map((o) => o.tier)).toEqual([0, 1, 2, 3, 4]);
  });

  it("moves when real results allow it, straight to the best office affordable", () => {
    expect(moves([company(), margaux])).toEqual([]);
    expect(moves([company("launch"), margaux])).toEqual([{ type: "move-office", tier: 1 }]);
    expect(moves([company(), margaux, sale("a", 1500), sale("b", 1000), sale("c", 800)])).toEqual([{ type: "move-office", tier: 2 }]);
  });

  it("never moves back, never announces the same office twice", () => {
    const moved: DomainEvent = { type: "office.moved", tier: 2, at: NOW };
    expect(moves([company("launch"), margaux, moved])).toEqual([]);
    expect(officeOf(replay([company(), margaux, moved])).tier).toBe(2);
  });

  it("is announced on the team chat as a surprise", () => {
    const events = [company(), margaux, { type: "office.moved", tier: 1, at: NOW } as DomainEvent].map((e, i) => ({ ...e, seq: i + 1, ts: NOW, companyId: "c" }) as StoredEvent);
    const out = chatFor(replay(events), events.at(-1)!);
    expect(out[0]).toMatchObject({ channel: "general", as: { name: "Margaux" }, reactions: ["🎉", "🏢"] });
  });
});
