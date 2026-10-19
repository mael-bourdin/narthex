import { describe, expect, it } from "vitest";
import {
  apply,
  decide,
  DEFAULT_SETTINGS,
  onboardingTeam,
  replay,
  role,
  staffingFrom,
  type CompanyState,
  type DomainEvent,
  type FirstLook,
} from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 19, 9);
const founded = (stage: "idea" | "research" | "creation" = "research"): DomainEvent => ({
  type: "company.founded",
  company: { id: "c", name: "Lumen", idea: "Un capteur", founder: { name: "Inès" }, foundedAt: NOW, stage, paused: false },
  settings: DEFAULT_SETTINGS,
});
const margaux: DomainEvent = {
  type: "agent.hired",
  reason: "",
  agent: { id: "m", name: "Margaux", role: "cofondateur", hiredAt: NOW, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 },
};
const hires = (s: CompanyState) => decide(s, NOW).flatMap((i) => (i.type === "hire" ? [i.role] : []));

const LOOK: FirstLook = {
  reaction: "Un capteur, beau défi.",
  findings: [],
  simulated: false,
  team: [
    { role: "recherche", why: "Le marché" },
    { role: "technique", why: "La faisabilité du capteur" },
  ],
  later: [{ role: "juridique", why: "Quand on créera la société" }],
};

describe("dynamic staffing", () => {
  it("hires the team Margaux chose, not a fixed one", () => {
    const s = replay([founded(), margaux, { type: "staffing.planned", staffing: staffingFrom(LOOK) }]);
    expect(hires(s)).toEqual(["recherche", "technique"]);
  });

  it("brings the lawyer only when a legal duty needs one", () => {
    let s = replay([founded(), margaux, { type: "staffing.planned", staffing: staffingFrom(LOOK) }]);
    s = apply(s, {
      type: "obligation.opened",
      obligation: { id: "o", code: "A1-nom", title: "Vérifier que le nom est libre", why: "", owner: "juridique", status: "open", openedAt: NOW },
    });
    expect(hires(s)).toContain("juridique");
  });

  it("falls back to the usual team when nobody could choose", () => {
    const s = replay([founded(), margaux]);
    expect(hires(s)).toEqual(["recherche", "juridique"]);
  });

  it("shows in the first launch who Margaux chose and who comes later", () => {
    const team = onboardingTeam(LOOK);
    expect(team.now.map((r) => r.id)).toEqual(["recherche", "technique"]);
    expect(team.later.map((r) => r.id)).toEqual(["juridique"]);
  });

  it("ignores roles that do not exist and repeats", () => {
    const team = onboardingTeam({ ...LOOK, team: [{ role: "astronaute" as never, why: "" }, { role: "recherche", why: "" }, { role: "recherche", why: "" }] });
    expect(team.now.map((r) => r.id)).toEqual(["recherche"]);
  });

  it("knows the technical researcher", () => {
    expect(role("technique").title).toBe("Recherche technique");
  });
});
