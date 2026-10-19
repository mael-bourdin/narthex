import { describe, expect, it } from "vitest";
import { SEUIL, type CompanyState, type FirstLook } from "@narthex/core";
import { Engine, MemoryEventStore, SimulatedClock, SimulationRuntime, type AgentRuntime } from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);

function engine(runtime: AgentRuntime = new SimulationRuntime()) {
  return new Engine({ store: new MemoryEventStore(), runtime, clock: new SimulatedClock(START) });
}

async function settle(e: Engine): Promise<CompanyState> {
  for (let i = 0; i < 100; i++) {
    await e.idle();
    e.tick();
    if (e.status().running === 0) break;
  }
  return e.getState();
}

const LOOK: FirstLook = {
  reaction: "Des bougies. J'adore.",
  findings: [
    { text: "312 boutiques de bougies artisanales en France", source: "Sirene · INSEE" },
    { text: "Prix moyen : 34 €", source: "42 boutiques analysées" },
    { text: "68 % achètent pour offrir", source: "1 240 avis" },
  ],
  simulated: false,
  usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, credits: 3 },
};

describe("first look", () => {
  it("is simulated, and says so, without a key", async () => {
    const look = await engine().handle("onboarding.firstLook", { idea: "Des bougies", founderName: "Inès" });
    expect(look.simulated).toBe(true);
    expect(look.findings).toHaveLength(4);
    expect(look.findings.every((f) => f.source.endsWith("(exemple)"))).toBe(true);
  });

  it("firstLook failure falls back", async () => {
    const broken: AgentRuntime = { ...new SimulationRuntime(), name: "anthropic", run: async () => ({ post: "" }), firstLook: async () => { throw new Error("offline"); } };
    const look = await engine(broken).handle("onboarding.firstLook", { idea: "Des bougies", founderName: "Inès" });
    expect(look).toEqual({ reaction: SEUIL.noLook, findings: [], simulated: false });
  });

  it("passes a long idea untruncated", async () => {
    const seen: string[] = [];
    const spy: AgentRuntime = { ...new SimulationRuntime(), name: "simulation", run: async () => ({ post: "" }), firstLook: async ({ idea }) => (seen.push(idea), LOOK) };
    const idea = "Bougies ".repeat(50).trim();
    await engine(spy).handle("onboarding.firstLook", { idea, founderName: "Inès" });
    expect(seen[0]).toBe(idea);
  });

  it("becomes Margaux's first deliverable at founding, with its credits", async () => {
    const e = engine();
    await e.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès", firstLook: LOOK });
    const s = await settle(e);
    const margaux = Object.values(s.agents).find((a) => a.role === "cofondateur")!;
    const look = Object.values(s.tasks).find((t) => t.tag === "first-look")!;
    expect(look).toMatchObject({ agentId: margaux.id, status: "done" });
    const d = s.deliverables[look.deliverableId!]!;
    expect(d.sources.map((x) => x.title)).toEqual(LOOK.findings.map((f) => f.source));
    expect(s.posts.some((p) => p.deliverableId === d.id && p.text === LOOK.reaction)).toBe(true);
    expect(s.usage.credits).toBeGreaterThanOrEqual(3);
    // A first look is not the market study: Léa still does hers.
    expect(Object.values(s.tasks).some((t) => t.tag === "market-study")).toBe(true);
  });

  it("does not move the company past the study on its own", async () => {
    const quiet: AgentRuntime = { ...new SimulationRuntime(), name: "simulation", run: () => new Promise(() => {}), firstLook: async () => LOOK };
    const e = engine(quiet);
    await e.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès", firstLook: LOOK });
    e.tick();
    expect(e.getState().company?.stage).toBe("research");
  });
});

describe("the team Margaux chose", () => {
  it("is the team that joins at founding", async () => {
    const e = engine({ ...new SimulationRuntime(), name: "simulation", run: () => new Promise(() => {}), firstLook: async () => LOOK });
    await e.handle("company.found", {
      name: "Capteur",
      idea: "Un capteur de qualité de l'air",
      founderName: "Inès",
      firstLook: { ...LOOK, team: [{ role: "recherche", why: "Le marché" }, { role: "technique", why: "La faisabilité" }], later: [{ role: "juridique", why: "La création" }] },
    });
    e.tick();
    const roles = Object.values(e.getState().agents).map((a) => a.role).sort();
    expect(roles).toEqual(["cofondateur", "recherche", "technique"]);
  });

  it("lets Margaux bring someone during her work", async () => {
    let asked: string | null = "unset";
    const recruiter: AgentRuntime = {
      ...new SimulationRuntime(),
      name: "simulation",
      firstLook: async () => LOOK,
      run: async (ctx) => {
        if (ctx.agent.role === "cofondateur") asked = ctx.recruit("technique", "Il faut vérifier la fabrication.");
        return { post: "ok" };
      },
    };
    const e = engine(recruiter);
    await e.handle("company.found", { name: "M", idea: "I", founderName: "F" });
    await settle(e);
    expect(asked).toBeNull();
    expect(Object.values(e.getState().agents).some((a) => a.role === "technique")).toBe(true);
  });
});
