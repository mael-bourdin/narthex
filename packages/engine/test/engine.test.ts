import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forFounder, type CompanyState } from "@narthex/core";
import {
  Engine,
  MemoryEventStore,
  serve,
  SimulatedClock,
  SimulationRuntime,
  SocketClient,
  SqliteEventStore,
  socketPath,
  type AgentRuntime,
} from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);
const HOUR = 3_600_000;

function make(runtime: AgentRuntime = new SimulationRuntime()) {
  const clock = new SimulatedClock(START);
  const engine = new Engine({ store: new MemoryEventStore(), runtime, clock });
  return { engine, clock };
}

/** Lets every agent finish and the company react, until it has nothing left to do right now. */
async function settle(engine: Engine): Promise<CompanyState> {
  for (let i = 0; i < 100; i++) {
    await engine.idle();
    engine.tick();
    if (engine.status().running === 0) break;
  }
  return engine.getState();
}

function names(s: CompanyState): string[] {
  return Object.values(s.agents).map((a) => a.name);
}

describe("Engine (simulation)", () => {
  it("founds a company and lets the team start on its own", async () => {
    const { engine } = make();
    await engine.handle("company.found", { name: "Maison Lumen", idea: "Des bougies à la cire de colza, faites à Lille", founderName: "Inès" });
    const s = await settle(engine);

    expect(names(s)).toEqual(expect.arrayContaining(["Margaux", "Léa", "Hugo"]));
    // The market study is done, so the company moved to creation and hired for it.
    expect(s.company?.stage).toBe("creation");
    expect(names(s)).toEqual(expect.arrayContaining(["Samir", "Jeanne"]));
    expect(s.posts.length).toBeGreaterThan(5);
    // The law leaves the choice of legal form to the founder.
    expect(forFounder(s).map((o) => o.code)).toContain("A3-forme");
  });

  it("makes external actions wait, and lets the founder cancel them", async () => {
    const { engine } = make();
    await engine.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    let s = await settle(engine);
    const outreach = Object.values(s.tasks).find((t) => t.tag === "outreach");
    expect(outreach).toMatchObject({ status: "planned", kind: "external" });
    expect(outreach!.cancellableUntil).toBeGreaterThan(engine.now());

    s = await engine.handle("task.cancel", { taskId: outreach!.id });
    expect(s.tasks[outreach!.id]?.status).toBe("cancelled");
  });

  it("runs external actions once the cancel window has passed", async () => {
    const { engine, clock } = make();
    await engine.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    await settle(engine);
    clock.advance(25 * HOUR);
    const s = await settle(engine);
    expect(Object.values(s.tasks).find((t) => t.tag === "outreach")?.status).toBe("done");
  });

  it("walks the creation checklist once the founder acts", async () => {
    const { engine, clock } = make();
    await engine.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    let s = await settle(engine);
    const form = forFounder(s).find((o) => o.code === "A3-forme")!;
    await expect(engine.handle("obligation.fulfill", { obligationId: form.id })).rejects.toThrow(/forme/);
    s = await engine.handle("obligation.fulfill", { obligationId: form.id, legalForm: "SASU" });
    s = await settle(engine);
    expect(s.company?.legalForm).toBe("SASU");

    // Sign, deposit, verify identity: the founder's part. The team files everything else.
    for (let round = 0; round < 6; round++) {
      for (const o of forFounder(s)) await engine.handle("obligation.fulfill", { obligationId: o.id });
      clock.advance(25 * HOUR);
      s = await settle(engine);
    }
    expect(s.company?.stage).toBe("launch");
    expect(names(s)).toEqual(expect.arrayContaining(["Oscar", "Paul"]));
  });

  it("records a failed task and frees the agent", async () => {
    const failing: AgentRuntime = { name: "simulation", run: async () => { throw new Error("Panne"); }, firstLook: new SimulationRuntime().firstLook };
    const { engine } = make(failing);
    await engine.handle("company.found", { name: "X", idea: "Y", founderName: "Z" });
    const s = await settle(engine);
    const failed = Object.values(s.tasks).filter((t) => t.status === "failed");
    expect(failed.length).toBeGreaterThan(0);
    expect(Object.values(s.agents).every((a) => a.status === "idle")).toBe(true);
  });

  it("does nothing while paused", async () => {
    const { engine } = make();
    await engine.handle("company.found", { name: "X", idea: "Y", founderName: "Z" });
    await settle(engine);
    const before = engine.getState().posts.length;
    await engine.handle("company.pause", {});
    const s = await settle(engine);
    expect(s.posts.length).toBe(before);
  });
});

describe("persistence and transport", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replays the same company from SQLite", async () => {
    dir = mkdtempSync(join(tmpdir(), "narthex-"));
    const file = join(dir, "n.sqlite");
    const a = new Engine({ store: new SqliteEventStore(file), runtime: new SimulationRuntime(), clock: new SimulatedClock(START) });
    await a.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    const before = await settle(a);
    const b = new Engine({ store: new SqliteEventStore(file), runtime: new SimulationRuntime(), clock: new SimulatedClock(START) });
    expect(b.getState().posts.length).toBe(before.posts.length);
    expect(b.getState().company?.name).toBe("Maison Lumen");
    // Windows cannot delete a database file that is still open.
    await a.close();
    await b.close();
  });

  it("serves the engine on a local socket", async () => {
    dir = mkdtempSync(join(tmpdir(), "narthex-"));
    const { engine } = make();
    const server = await serve(engine, socketPath(dir));
    const client = await SocketClient.connect(socketPath(dir));
    expect(client).not.toBeNull();
    const seen: string[] = [];
    client!.subscribe((e) => seen.push(e.type));
    const s = await client!.call("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    expect(s.company?.name).toBe("Maison Lumen");
    await expect(client!.call("company.found", { name: "B", idea: "C", founderName: "D" })).rejects.toThrow(/existe déjà/);
    await settle(engine);
    expect(seen).toContain("agent.hired");
    await client!.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
