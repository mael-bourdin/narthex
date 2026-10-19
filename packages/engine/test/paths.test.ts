import { platform } from "node:os";
import { describe, expect, it } from "vitest";
import { socketPath } from "../src/index.ts";

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
