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
    const out = narthex("init", "--idea", "Candles", "--first-name", "Inès", "--name", "Maison Lumen", "--no-start");
    expect(out).toContain(SEUIL.team);
    for (const r of onboardingTeam().now) expect(out).toContain(r.defaultName);
    expect(out).toContain(SEUIL.welcome("Maison Lumen"));
    const feed = narthex("feed");
    expect(feed).toContain("Maison Lumen");
    expect(feed).toContain("team stopped");
  });

  it("founds a second company next to the first, and switches between them", () => {
    narthex("init", "--idea", "Ceramics", "--first-name", "Inès", "--name", "Atelier Brume", "--no-start");
    const list = narthex("companies");
    expect(list).toContain("Maison Lumen");
    expect(list).toContain("Atelier Brume");
    expect(narthex("feed")).toContain("Atelier Brume");
    expect(narthex("switch", "maison")).toContain("Maison Lumen");
    expect(narthex("feed")).toContain("Maison Lumen");
  });

  it("starts over on request, keeping the old company in the archives", () => {
    expect(() => narthex("reset")).toThrow();
    expect(narthex("reset", "--yes")).toContain("archives");
    expect(narthex("feed")).toContain("No company here yet");
    narthex("init", "--idea", "Candles", "--first-name", "Inès", "--name", "Maison Lumen", "--no-start");
  });

  it("shows recruitments and an agent's sheet", () => {
    expect(narthex("hires")).toContain("Joined");
    expect(narthex("agent", "Margaux")).toContain("Done");
    expect(narthex("log")).toContain("Inès");
  });

  it("shows the company, its pages, the AI spend and tables", () => {
    expect(narthex("company")).toContain("Where your company stands");
    expect(narthex("company", "finances")).toContain("Finances · ");
    expect(narthex("spend")).toContain("AI spend");
    expect(narthex("tables")).toBeTruthy();
  });

  it("edits the profile, reserved topics and exports", () => {
    expect(narthex("profile", "--city", "Lille")).toContain("Lille");
    expect(narthex("config", "ask", "presse")).toContain("will ask you first");
    const file = join(dir, "export.json");
    expect(narthex("export", "--file", file)).toContain("Exported");
  });

  it("explains itself", () => {
    expect(narthex("--help")).toContain("narthex start");
  });

  it("still understands the French commands and options", () => {
    expect(narthex("fil")).toContain("Maison Lumen");
    expect(narthex("equipe")).toContain("The team");
    expect(narthex("--aide")).toContain("narthex start");
    expect(narthex("profil", "--ville", "Lyon")).toContain("Lyon");
  });

  it("records Margaux's first look, marked as an example in simulation", () => {
    const state = JSON.parse(narthex("feed", "--json")) as { tasks: Record<string, { tag?: string; deliverableId?: string }>; deliverables: Record<string, { sources: { title: string }[] }> };
    const look = Object.values(state.tasks).find((t) => t.tag === "first-look")!;
    const sources = state.deliverables[look.deliverableId!]!.sources;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((x) => /\((exemple|example)\)$/.test(x.title))).toBe(true);
  });

  it("outputs JSON for scripts", () => {
    const state = JSON.parse(narthex("feed", "--json")) as { company: { name: string } };
    expect(state.company.name).toBe("Maison Lumen");
  });
});

describe("narthex feed without a key", () => {
  const home = mkdtempSync(join(tmpdir(), "narthex-cli-"));
  const bare = { ...process.env, NARTHEX_HOME: home, NO_COLOR: "1" } as NodeJS.ProcessEnv;
  delete bare.NARTHEX_RUNTIME;
  delete bare.ANTHROPIC_API_KEY;
  const run = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin.ts", ...args], { env: bare, encoding: "utf8" });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it("shows the team waiting and invents no work", () => {
    run("init", "--idea", "Candles", "--first-name", "Inès", "--name", "Maison Lumen", "--no-start");
    const feed = run("feed");
    expect(feed).toContain("The team is waiting for your key");
    expect(feed).not.toContain("Done:");
    const state = JSON.parse(run("feed", "--json")) as { deliverables: Record<string, unknown> };
    expect(Object.keys(state.deliverables)).toHaveLength(0);
  });
});

describe("narthex config budget", () => {
  it("sets the daily budget of the company", () => {
    const home = mkdtempSync(join(tmpdir(), "narthex-cli-"));
    const e = { ...process.env, NARTHEX_HOME: home, NARTHEX_RUNTIME: "simulation", NO_COLOR: "1" };
    const run = (...a: string[]) => execFileSync(process.execPath, ["--import", "tsx", "apps/cli/src/bin.ts", ...a], { env: e, encoding: "utf8" });
    run("init", "--idea", "Candles", "--first-name", "Inès", "--name", "Lumen", "--no-start");
    expect(run("config", "budget", "5")).toContain("$5.00");
    const s = JSON.parse(run("feed", "--json")) as { settings: { dailyBudgetCredits: number } };
    expect(s.settings.dailyBudgetCredits).toBe(500);
    rmSync(home, { recursive: true, force: true });
  });
});
