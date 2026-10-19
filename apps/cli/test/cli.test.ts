import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "narthex-cli-"));
const env = { ...process.env, NARTHEX_HOME: dir, NARTHEX_RUNTIME: "simulation", NO_COLOR: "1" };

function narthex(...args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin.ts", ...args], { env, encoding: "utf8" });
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("narthex CLI", () => {
  it("founds a company without a terminal and shows it", () => {
    expect(narthex("init", "--idee", "Des bougies", "--prenom", "Inès", "--nom", "Maison Lumen", "--sans-lancer")).toContain("C'est parti");
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

  it("outputs JSON for scripts", () => {
    const state = JSON.parse(narthex("fil", "--json")) as { company: { name: string } };
    expect(state.company.name).toBe("Maison Lumen");
  });
});
