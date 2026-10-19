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
