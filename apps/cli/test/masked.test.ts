import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readMasked } from "../src/seuil.ts";

function fakeTty() {
  const input = Object.assign(new PassThrough(), { isTTY: true, raw: false, setRawMode(this: { raw: boolean }, on: boolean) { this.raw = on; return this; } });
  input.setEncoding("utf8");
  let written = "";
  const output = { write: (s: string) => ((written += s), true) };
  return { input, output, written: () => written };
}

describe("readMasked", () => {
  it("never writes the secret part of a pasted key", async () => {
    const t = fakeTty();
    const result = readMasked("› ", t.input as never, t.output as never);
    t.input.write("sk-ant-api03-SECRETSECRET\r");
    expect(await result).toBe("sk-ant-api03-SECRETSECRET");
    expect(t.written()).not.toContain("SECRET");
    expect(t.written()).toContain("sk-ant-api0");
  });

  it("leaves the terminal as it found it", async () => {
    const t = fakeTty();
    const result = readMasked("› ", t.input as never, t.output as never);
    t.input.write("sk-ant-x\r");
    await result;
    expect(t.input.raw).toBe(false);
  });
});
