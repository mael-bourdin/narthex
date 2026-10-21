import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Host, MemoryEventStore, pairWhatsApp, sendWhatsApp, SimulatedClock, SimulationRuntime, WACLI_INSTALL, WhatsAppBridge, whatsappStatus, type WacliRun } from "../src/index.ts";

const dir = () => mkdtempSync(join(tmpdir(), "narthex-wa-"));

/** A wacli that knows `version`, `auth` (QR then success), `auth status`, `send`. */
function fakeWacli(opts: { installed?: boolean; pairs?: boolean } = {}) {
  const calls: string[][] = [];
  let linked = false;
  const run: WacliRun = async (args, o) => {
    calls.push(args);
    if (args[0] === "version") return { code: opts.installed === false ? 127 : 0, stdout: "wacli 1.0", stderr: "" };
    const cmd = args.slice(args.indexOf("--store") + 2).filter((a) => a !== "--json");
    if (cmd[0] === "auth" && cmd[1] === "status")
      return { code: 0, stdout: JSON.stringify({ success: true, data: linked ? { authenticated: true, linked_jid: "33612345678:12@s.whatsapp.net", phone: "33612345678:12" } : { authenticated: false } }), stderr: "" };
    if (cmd[0] === "auth") {
      o?.onStderrLine?.(JSON.stringify({ event: "auth_starting", ts: 1 }));
      o?.onStderrLine?.(JSON.stringify({ event: "qr_code", data: { code: "2@abc,def" }, ts: 2 }));
      if (opts.pairs === false) return { code: 1, stdout: "", stderr: "" };
      o?.onStderrLine?.(JSON.stringify({ event: "connected", ts: 3 }));
      linked = true;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd[0] === "send") return { code: 0, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "unknown" };
  };
  return { run, calls };
}

describe("WhatsApp through wacli", () => {
  it("links the founder's phone: shows the QR, then knows the number", async () => {
    const { run, calls } = fakeWacli();
    const d = dir();
    const qrs: string[] = [];
    expect(await pairWhatsApp(d, (q) => qrs.push(q), undefined, run)).toEqual({ ok: true, phone: "33612345678" });
    expect(qrs).toEqual(["2@abc,def"]);
    // Narthex's own store, never the founder's default wacli store.
    expect(calls.find((c) => c.includes("auth") && !c.includes("status"))).toEqual(expect.arrayContaining(["--store", join(d, "whatsapp"), "--qr-format", "text", "--events"]));
    expect(await whatsappStatus(d, run)).toEqual({ linked: true, phone: "33612345678" });
  });

  it("says how to install wacli when it is missing, and when the link fails", async () => {
    expect(await pairWhatsApp(dir(), () => {}, undefined, fakeWacli({ installed: false }).run)).toEqual({ ok: false, message: WACLI_INSTALL });
    expect(await pairWhatsApp(dir(), () => {}, undefined, fakeWacli({ pairs: false }).run)).toMatchObject({ ok: false });
  });

  it("writes only to the founder's own chat", async () => {
    const { run, calls } = fakeWacli();
    await sendWhatsApp(dir(), "33612345678", "Bonjour", run);
    const send = calls.at(-1)!;
    expect(send).toEqual(expect.arrayContaining(["send", "text", "--to", "33612345678", "--allow-self", "--message", "Bonjour"]));
  });

  it("posts the team's real news, signed by the agent, in WhatsApp's formatting", async () => {
    const host = new Host({ store: new MemoryEventStore(), runtime: new SimulationRuntime(), clock: new SimulatedClock(Date.UTC(2026, 9, 21, 9)) });
    const sent: string[] = [];
    const bridge = new WhatsAppBridge({ host, send: async (t) => void sent.push(t), spacingMs: 0 });
    bridge.start();
    await host.handle("company.found", { name: "Lumen", idea: "Bougies", founderName: "Inès" });
    await bridge.idle();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]).toMatch(/^\*Margaux\* · Co-founder · Lumen\n/);
    expect(sent.join("\n")).not.toContain("**");
    bridge.stop();
  });
});
