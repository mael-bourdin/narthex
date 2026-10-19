import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveCompany, databasePath, Engine, loadConfig, needsKey, saveConfig, SimulatedClock, SqliteEventStore } from "../src/index.ts";

describe("archiveCompany", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function withCompany(): Promise<void> {
    const e = new Engine({ store: new SqliteEventStore(databasePath(dir)), runtime: null, clock: new SimulatedClock(0) });
    await e.handle("company.found", { name: "Citeme", idea: "Une idée", founderName: "Maël" });
    await e.close();
  }

  it("moves the company aside so the first launch plays again, without deleting it", async () => {
    dir = mkdtempSync(join(tmpdir(), "narthex-"));
    await withCompany();
    const archived = archiveCompany(dir, Date.UTC(2026, 9, 19, 14, 30));
    expect(existsSync(databasePath(dir))).toBe(false);
    expect(readdirSync(archived!)).toContain("narthex.sqlite");
    const reopened = new Engine({ store: new SqliteEventStore(databasePath(dir)), runtime: null, clock: new SimulatedClock(0) });
    expect(reopened.getState().company).toBeUndefined();
    await reopened.close();
  });

  it("forgets the simulation choice but keeps a saved key", () => {
    dir = mkdtempSync(join(tmpdir(), "narthex-"));
    saveConfig(dir, { runtime: "simulation" });
    archiveCompany(dir);
    expect(needsKey(loadConfig(dir), {})).toBe(true);
    saveConfig(dir, { anthropicApiKey: "sk-ant-x", runtime: "simulation" });
    archiveCompany(dir);
    expect(loadConfig(dir)).toEqual({ anthropicApiKey: "sk-ant-x" });
  });

  it("says when there is nothing to archive", () => {
    dir = mkdtempSync(join(tmpdir(), "narthex-"));
    expect(archiveCompany(dir)).toBeNull();
  });
});
