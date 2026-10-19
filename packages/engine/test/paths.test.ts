import { lstatSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Engine, MemoryEventStore, serve, SimulatedClock, socketPath } from "../src/index.ts";

describe("socketPath", () => {
  it.skipIf(platform() === "win32")("stays under the Unix socket length limit for a deep data folder", () => {
    const deep = `/private/tmp/${"un-dossier-tres-long/".repeat(8)}narthex`;
    const path = socketPath(deep);
    expect(Buffer.byteLength(path)).toBeLessThan(104);
    // Same folder, same socket: the CLI and the app must find each other.
    expect(socketPath(deep)).toBe(path);
    expect(socketPath(`${deep}-autre`)).not.toBe(path);
  });

  it.skipIf(platform() === "win32")("keeps the socket inside a short data folder", () => {
    expect(socketPath("/tmp/n")).toBe("/tmp/n/narthex.sock");
  });
});

describe("socket privacy", () => {
  it.skipIf(platform() === "win32")("puts a fallback socket in a folder only its owner can enter", () => {
    const path = socketPath(`/private/tmp/${"un-dossier-tres-long/".repeat(8)}narthex`);
    const folder = lstatSync(dirname(path));
    expect(folder.isDirectory()).toBe(true);
    expect(folder.isSymbolicLink()).toBe(false);
    expect(folder.uid).toBe(process.getuid!());
    expect(folder.mode & 0o077).toBe(0);
  });

  it.skipIf(platform() === "win32")("lets only its owner connect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "n-"));
    const server = await serve(new Engine({ store: new MemoryEventStore(), runtime: null, clock: new SimulatedClock(0) }), socketPath(dir));
    expect(statSync(socketPath(dir)).mode & 0o077).toBe(0);
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
});
