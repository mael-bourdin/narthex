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
  print(`Sur ton téléphone : WhatsApp › ${bold("Appareils connectés")} › Connecter un appareil, puis scanne :`);
  const code = await new Promise<number>((resolve) => {
    // The terminal QR is drawn by wacli; arguments go straight to it, no shell.
    const child = spawn(process.env.NARTHEX_WACLI_BIN || "wacli", ["--store", whatsappStore(dir), "auth", "--idle-exit", "10s", "--history-days", "1"], { stdio: "inherit" });
    child.on("close", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  const status = await whatsappStatus(dir);
  if (code !== 0 || !status.linked || !status.phone) {
    print("La liaison n'a pas abouti. Réessaie avec : narthex whatsapp");
    return false;
  }
  saveConfig(dir, { ...loadConfig(dir), whatsapp: { phone: status.phone } });
  await sendWhatsApp(dir, status.phone, "*Margaux* · Co-fondatrice\nC'est branché : l'équipe t'écrira ici, dans tes messages à toi-même.").catch(() => undefined);
  print(`${bold("C'est branché.")} L'équipe t'écrira sur WhatsApp, dans « Messages à moi-même ».`);
  return true;
}

/** `narthex whatsapp [off]` */
export async function whatsappCommand(dir: string, arg?: string): Promise<void> {
  const config = loadConfig(dir);
  if (arg === "off") {
    await unlinkWhatsApp(dir);
    const { whatsapp: _gone, ...rest } = config;
    saveConfig(dir, rest);
    return print("WhatsApp débranché. Tes messages restent sur ton téléphone.");
  }
  if (config.whatsapp?.phone && arg !== "relier") return print(`WhatsApp : relié au +${config.whatsapp.phone}. ${dim("Débrancher : narthex whatsapp off · relier un autre numéro : narthex whatsapp relier")}`);
  await linkWhatsApp(dir);
}
