import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { onboardingTeam, SEUIL } from "@narthex/core";

const dir = mkdtempSync(join(tmpdir(), "narthex-cli-"));
const env = { ...process.env, NARTHEX_HOME: dir, NARTHEX_RUNTIME: "simulation", NO_COLOR: "1" };

function narthex(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin.ts", ...args], { env, encoding: "utf8" });
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("narthex CLI", () => {
  it("founds a company without a terminal and shows it", () => {
    const out = narthex("init", "--idee", "Des bougies", "--prenom", "Inès", "--nom", "Maison Lumen", "--sans-lancer");
    expect(out).toContain(SEUIL.team);
    for (const r of onboardingTeam().now) expect(out).toContain(r.defaultName);
    expect(out).toContain(SEUIL.welcome("Maison Lumen"));
    const fil = narthex("fil");
    expect(fil).toContain("Maison Lumen");
    expect(fil).toContain("équipe à l'arrêt");
  });

  it("refuses a second company in the same folder", () => {
    expect(() => narthex("init", "--idee", "X", "--prenom", "Y", "--nom", "Z", "--sans-lancer")).toThrow();
  });

  it("starts over on request, keeping the old company in the archives", () => {
    expect(() => narthex("recommencer")).toThrow();
    expect(narthex("recommencer", "--oui")).toContain("archives");
    expect(narthex("fil")).toContain("Pas encore d'entreprise");
    narthex("init", "--idee", "Des bougies", "--prenom", "Inès", "--nom", "Maison Lumen", "--sans-lancer");
  });

  it("shows recruitments and an agent's sheet", () => {
    expect(narthex("recrutements")).toContain("Arrivés");
    expect(narthex("agent", "Margaux")).toContain("Terminées");
    expect(narthex("journal")).toContain("a fondé");
  });

  it("shows the company, its pages, the AI spend and tables", () => {
    expect(narthex("entreprise")).toContain("Où en est ta société");
    expect(narthex("entreprise", "finances", "factures")).toContain("Finances · Factures");
    expect(narthex("depense")).toContain("Dépense IA");
    expect(narthex("tableaux")).toBeTruthy();
  });

  it("edits the profile, reserved topics and exports", () => {
    expect(narthex("profil", "--ville", "Lille")).toContain("Lille");
    expect(narthex("config", "demander", "presse")).toContain("te demandera");
    const file = join(dir, "export.json");
    expect(narthex("exporter", "--fichier", file)).toContain("Exporté");
  });

  it("explains itself", () => {
    expect(narthex("--aide")).toContain("narthex lancer");
  });

  it("records Margaux's first look, marked as an example in simulation", () => {
    const state = JSON.parse(narthex("fil", "--json")) as { tasks: Record<string, { tag?: string; deliverableId?: string }>; deliverables: Record<string, { sources: { title: string }[] }> };
    const look = Object.values(state.tasks).find((t) => t.tag === "first-look")!;
    const sources = state.deliverables[look.deliverableId!]!.sources;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((x) => x.title.endsWith("(exemple)"))).toBe(true);
  });

  it("outputs JSON for scripts", () => {
    const state = JSON.parse(narthex("fil", "--json")) as { company: { name: string } };
    expect(state.company.name).toBe("Maison Lumen");
  });
});

describe("narthex fil without a key", () => {
  const home = mkdtempSync(join(tmpdir(), "narthex-cli-"));
  const bare = { ...process.env, NARTHEX_HOME: home, NO_COLOR: "1" } as NodeJS.ProcessEnv;
  delete bare.NARTHEX_RUNTIME;
  delete bare.ANTHROPIC_API_KEY;
  const run = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin.ts", ...args], { env: bare, encoding: "utf8" });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("shows the team waiting and invents no work", () => {
    run("init", "--idee", "Des bougies", "--prenom", "Inès", "--nom", "Maison Lumen", "--sans-lancer");
    const fil = run("fil");
    expect(fil).toContain("L'équipe attend ta clé");
    expect(fil).not.toContain("C'est fait");
    const state = JSON.parse(run("fil", "--json")) as { deliverables: Record<string, unknown> };
    expect(Object.keys(state.deliverables)).toHaveLength(0);
  });
});

describe("narthex config budget", () => {
  it("sets the daily budget of the company", () => {
    const home = mkdtempSync(join(tmpdir(), "narthex-cli-"));
    const e = { ...process.env, NARTHEX_HOME: home, NARTHEX_RUNTIME: "simulation", NO_COLOR: "1" };
    const run = (...a: string[]) => execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin.ts", ...a], { env: e, encoding: "utf8" });
    run("init", "--idee", "Des bougies", "--prenom", "Inès", "--nom", "Lumen", "--sans-lancer");
    expect(run("config", "budget", "5")).toContain("5,00 $");
    const s = JSON.parse(run("fil", "--json")) as { settings: { dailyBudgetCredits: number } };
    expect(s.settings.dailyBudgetCredits).toBe(500);
    rmSync(home, { recursive: true, force: true });
  });
});
