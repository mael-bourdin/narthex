import { spawn } from "node:child_process";
import { loadConfig, saveConfig, sendWhatsApp, unlinkWhatsApp, WACLI_INSTALL, wacliInstalled, WHATSAPP_RISK, whatsappStatus, whatsappStore } from "@narthex/engine";
import { bold, dim } from "./style.ts";

const print = (text = ""): void => void process.stdout.write(`${text}\n`);

/** Links WhatsApp from a terminal: wacli draws the QR code itself, the founder scans it. */
export async function linkWhatsApp(dir: string): Promise<boolean> {
  if (!(await wacliInstalled())) {
    print(WACLI_INSTALL);
    return false;
  }
  print(dim(WHATSAPP_RISK));
  print(`On your phone: WhatsApp › ${bold("Linked devices")} › Link a device, then scan:`);
  const code = await new Promise<number>((resolve) => {
    // The terminal QR is drawn by wacli; arguments go straight to it, no shell.
    const child = spawn(process.env.NARTHEX_WACLI_BIN || "wacli", ["--store", whatsappStore(dir), "auth", "--idle-exit", "10s", "--history-days", "1"], { stdio: "inherit" });
    child.on("close", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  const status = await whatsappStatus(dir);
  if (code !== 0 || !status.linked || !status.phone) {
    print("Linking did not go through. Try again with: narthex whatsapp");
    return false;
  }
  saveConfig(dir, { ...loadConfig(dir), whatsapp: { phone: status.phone } });
  await sendWhatsApp(dir, status.phone, "*Margaux* · Co-founder\nYou're connected: the team will write to you here, in your messages to yourself.").catch(() => undefined);
  print(`${bold("Connected.")} The team will write to you on WhatsApp, in “Message yourself”.`);
  return true;
}

/** `narthex whatsapp [off]` */
export async function whatsappCommand(dir: string, arg?: string): Promise<void> {
  const config = loadConfig(dir);
  if (arg === "off") {
    await unlinkWhatsApp(dir);
    const { whatsapp: _gone, ...rest } = config;
    saveConfig(dir, rest);
    return print("WhatsApp disconnected. Your messages stay on your phone.");
  }
  if (config.whatsapp?.phone && arg !== "relink" && arg !== "relier") return print(`WhatsApp: linked to +${config.whatsapp.phone}. ${dim("Disconnect: narthex whatsapp off · link another number: narthex whatsapp relink")}`);
  await linkWhatsApp(dir);
}
