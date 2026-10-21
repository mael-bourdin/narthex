import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * WhatsApp through wacli (https://wacli.sh), a WhatsApp Web client linked to the founder's phone like
 * a computer. Not an official WhatsApp API: the founder chooses it knowing WhatsApp may unlink or
 * suspend a number linked this way. Narthex keeps its own wacli store in its data folder and only ever
 * writes to the founder's own chat ("Messages to yourself").
 */

export type WacliRun = (
  args: string[],
  options?: { signal?: AbortSignal; onStderrLine?: (line: string) => void; timeoutMs?: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const runWacli: WacliRun = (args, options = {}) =>
  new Promise((resolve, reject) => {
    // Arguments go straight to the program, never through a shell.
    const child = spawn(process.env.NARTHEX_WACLI_BIN || "wacli", args, { stdio: ["ignore", "pipe", "pipe"], ...(options.signal ? { signal: options.signal } : {}) });
    let stdout = "";
    let stderr = "";
    let pending = "";
    const timer = options.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : undefined;
    child.stdout.on("data", (d: Buffer) => (stdout += d));
    child.stderr.on("data", (d: Buffer) => {
      stderr += d;
      pending += d;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) options.onStderrLine?.(line);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

export function whatsappStore(dir: string): string {
  return join(dir, "whatsapp");
}

export const WHATSAPP_RISK =
  "WhatsApp has no API for this: Narthex goes through wacli, which links your WhatsApp like a computer (WhatsApp Web). It is not official, and WhatsApp may unlink or suspend a number linked this way.";

export const WACLI_INSTALL = "Install wacli first: brew install openclaw/tap/wacli (or see wacli.sh).";

export async function wacliInstalled(run: WacliRun = runWacli): Promise<boolean> {
  try {
    return (await run(["version"], { timeoutMs: 10_000 })).code === 0;
  } catch {
    return false;
  }
}

/** Is a phone linked to Narthex's store, and which number. */
export async function whatsappStatus(dir: string, run: WacliRun = runWacli): Promise<{ linked: boolean; phone?: string }> {
  try {
    const res = await run(["--store", whatsappStore(dir), "--json", "auth", "status"], { timeoutMs: 20_000 });
    const body = JSON.parse(res.stdout || "{}") as { data?: { authenticated?: boolean; phone?: string }; authenticated?: boolean; phone?: string };
    const data = body.data ?? body;
    // "33612345678:12" → the number, without the linked device.
    const phone = data.phone?.split(":")[0]?.replace(/\D/g, "");
    return data.authenticated && phone ? { linked: true, phone } : { linked: false };
  } catch {
    return { linked: false };
  }
}

/**
 * Links the founder's phone: wacli prints the QR payload as an event, the caller draws it, the founder
 * scans it (WhatsApp › Linked devices › Link a device). Resolves with the linked number.
 */
export async function pairWhatsApp(dir: string, onQr: (code: string) => void, signal?: AbortSignal, run: WacliRun = runWacli): Promise<{ ok: true; phone: string } | { ok: false; message: string }> {
  if (!(await wacliInstalled(run))) return { ok: false, message: WACLI_INSTALL };
  let failure: string | undefined;
  try {
    const res = await run(["--store", whatsappStore(dir), "auth", "--qr-format", "text", "--events", "--idle-exit", "10s", "--history-days", "1"], {
      ...(signal ? { signal } : {}),
      onStderrLine: (line) => {
        try {
          const e = JSON.parse(line) as { event?: string; data?: { code?: unknown; message?: unknown } };
          if (e.event === "qr_code" && typeof e.data?.code === "string") onQr(e.data.code);
          if (e.event === "error" && typeof e.data?.message === "string") failure = e.data.message;
        } catch {}
      },
    });
    if (signal?.aborted) return { ok: false, message: "Cancelled." };
    if (res.code !== 0) return { ok: false, message: `Linking didn't work${failure ? `: ${failure}` : ""}. Try again.` };
  } catch (e) {
    return { ok: false, message: signal?.aborted ? "Cancelled." : `wacli could not start: ${e instanceof Error ? e.message : String(e)}` };
  }
  const status = await whatsappStatus(dir, run);
  return status.linked && status.phone ? { ok: true, phone: status.phone } : { ok: false, message: "Linking didn't work. Try again." };
}

/** Writes to the founder's own chat. */
export async function sendWhatsApp(dir: string, phone: string, text: string, run: WacliRun = runWacli): Promise<void> {
  const res = await run(["--store", whatsappStore(dir), "send", "text", "--to", phone, "--allow-self", "--no-preview", "--message", text], { timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(`WhatsApp: sending refused (${res.stderr.trim().split("\n").pop()?.slice(0, 160) ?? res.code}).`);
}

/** Unlinks Narthex from the phone (the phone's chats stay as they are). */
export async function unlinkWhatsApp(dir: string, run: WacliRun = runWacli): Promise<void> {
  await run(["--store", whatsappStore(dir), "auth", "logout"], { timeoutMs: 30_000 }).catch(() => undefined);
}
