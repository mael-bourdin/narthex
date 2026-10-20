import { mkdtempSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type DomainEvent } from "@narthex/core";
import {
  acquireLock,
  Engine,
  MemoryEventStore,
  serve,
  SimulatedClock,
  SimulationRuntime,
  SocketClient,
  socketPath,
  SqliteEventStore,
  type AgentRuntime,
} from "../src/index.ts";

const START = Date.UTC(2026, 9, 19, 7);
const tmp = () => mkdtempSync(join(tmpdir(), "narthex-review-"));

describe("revision: shutdown", () => {
  it("stops starting new work once asked to stop, even when agents keep planning", async () => {
    const sim = new SimulationRuntime();
    let started = 0;
    const runtime: AgentRuntime = {
      name: "simulation",
      firstLook: sim.firstLook.bind(sim),
      run: async (ctx) => {
        started++;
        ctx.plan({ title: `Suite ${started}`, why: "Encore", kind: "internal" });
        await new Promise((r) => setTimeout(r, 5));
        return { post: "Fait." };
      },
    };
    const e = new Engine({ store: new MemoryEventStore(), runtime, clock: new SimulatedClock(START), tickMs: 5 });
    await e.handle("company.found", { name: "Lumen", idea: "Bougies", founderName: "Inès" });
    e.start();
    await new Promise((r) => setTimeout(r, 20));
    const closing = e.close();
    const atClose = started;
    const closed = await Promise.race([closing.then(() => true), new Promise((r) => setTimeout(() => r(false), 1500))]);
    expect(closed).toBe(true);
    expect(started - atClose).toBeLessThanOrEqual(DEFAULT_SETTINGS.concurrency);
  });
});

describe("revision: one writer per company", () => {
  it("never reuses a sequence number when another process wrote in between", () => {
    const file = join(tmp(), "n.sqlite");
    const a = new SqliteEventStore(file);
    const b = new SqliteEventStore(file);
    const ev: DomainEvent = { type: "memory.updated", memory: "x", at: START };
    a.append("c", ev, START);
    b.append("c", ev, START);
    expect(() => a.append("c", ev, START)).not.toThrow();
    expect(a.read("c").map((e) => e.seq)).toEqual([1, 2, 3]);
    a.close();
    b.close();
  });

  it("lets only one working engine open a data folder", () => {
    const dir = tmp();
    const release = acquireLock(dir);
    expect(() => acquireLock(dir)).toThrow(/tourne déjà/);
    release();
    expect(() => acquireLock(dir)()).not.toThrow();
  });
});

describe("revision: local server", () => {
  it("survives malformed lines and answers unknown methods with an error", async () => {
    const dir = tmp();
    const e = new Engine({ store: new MemoryEventStore(), runtime: null, clock: new SimulatedClock(START) });
    const path = socketPath(dir);
    const server = await serve(e, path);
    const raw = connect(path);
    await new Promise((r) => raw.once("connect", r));
    raw.write("null\n42\n\"x\"\n{}\n");
    await new Promise((r) => setTimeout(r, 50));
    const client = (await SocketClient.connect(path))!;
    await expect(client.call("nope.method" as never, {} as never)).rejects.toThrow(/inconnue/);
    expect((await client.call("engine.status", {})).runtime).toBe("none");
    raw.destroy();
    await client.close();
    server.close();
  });
});

describe("revision: Windows pipe names", () => {
  it("differ for two data folders of the same user", async () => {
    const { pipeName } = await import("../src/paths.ts");
    expect(pipeName("mael", "C:\\Users\\mael\\AppData\\Roaming\\Narthex")).not.toBe(pipeName("mael", "C:\\Users\\mael\\Documents\\other"));
  });
});

describe("revision: time and attempts", () => {
  it("keeps a simulated clock advance after a restart", async () => {
    const store = new MemoryEventStore();
    const e = new Engine({ store, runtime: null, clock: new SimulatedClock(START), passive: true });
    await e.handle("company.found", { name: "Lumen", idea: "Bougies", founderName: "Inès" });
    await e.handle("clock.advance", { hours: 48 });
    const last = store.read(store.companies()[0]!).at(-1)!;
    expect(last.ts).toBeGreaterThanOrEqual(START + 48 * 3_600_000);
  });

  it("counts the first look in today's budget", async () => {
    const sim = new SimulationRuntime();
    const e = new Engine({ store: new MemoryEventStore(), runtime: sim, clock: new SimulatedClock(START) });
    const look = { reaction: "Oui.", findings: [{ text: "x", source: "y" }], simulated: false, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits: 40 } };
    const s = await e.handle("company.found", { name: "Lumen", idea: "Bougies", founderName: "Inès", firstLook: look });
    expect(Object.values(s.usage.byDay).reduce((a, b) => a + b, 0)).toBe(40);
  });

  it("does not count a task cut by closing Narthex as a failed attempt", () => {
    const store = new MemoryEventStore();
    const seed: DomainEvent[] = [
      { type: "company.founded", company: { id: "c", name: "L", idea: "I", founder: { name: "I" }, foundedAt: START, stage: "research", paused: false }, settings: DEFAULT_SETTINGS },
      { type: "agent.hired", reason: "", agent: { id: "h", name: "Hugo", role: "juridique", hiredAt: START, status: "idle", skill: { success: 0, failure: 0 }, autonomy: 1 } },
      { type: "task.planned", task: { id: "t", agentId: "h", title: "Statuts", why: "", kind: "internal", status: "planned", tag: "X", createdAt: START, scheduledAt: START } },
      { type: "task.started", taskId: "t", at: START },
    ];
    for (const ev of seed) store.append("c", ev, START);
    const s = new Engine({ store, runtime: null, clock: new SimulatedClock(START) }).getState();
    expect(s.tasks["t"]).toMatchObject({ status: "failed", interrupted: true });
    expect(s.agents["h"]!.skill.failure).toBe(0);
  });
});
