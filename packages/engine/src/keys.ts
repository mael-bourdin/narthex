import Anthropic from "@anthropic-ai/sdk";
import { SEUIL } from "@narthex/core";
import { loadConfig, saveConfig, type Config } from "./config.ts";

export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };

/**
 * Checks a pasted key with a call that costs nothing (listing models).
 * The founder sees Margaux's words, never an HTTP error.
 */
const UNREACHABLE = "Je n'arrive pas à joindre Anthropic. Vérifie ta connexion et recolle la clé.";

export async function verifyAnthropicKey(raw: string, client?: Pick<Anthropic, "models">, timeoutMs = 15_000): Promise<KeyCheck> {
  const key = raw.trim();
  if (!key.startsWith("sk-ant-")) return { ok: false, message: SEUIL.badKey };
  let timer: NodeJS.Timeout | undefined;
  // A half-dead network (captive portal) must never leave the founder staring at « Vérification… ».
  const giveUp = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs)));
  try {
    const api = client ?? new Anthropic({ apiKey: key, baseURL: "https://api.anthropic.com", authToken: null, timeout: timeoutMs, maxRetries: 1 });
    const outcome = await Promise.race([api.models.list({ limit: 1 }), giveUp]);
    return outcome === "timeout" ? { ok: false, message: UNREACHABLE } : { ok: true, key };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, message: SEUIL.badKey };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, message: UNREACHABLE };
    return { ok: false, message: "Anthropic ne répond pas correctement pour l'instant. Réessaie dans un moment." };
  } finally {
    clearTimeout(timer);
  }
}

/** A key saved for Narthex is the player's choice of real agents: the mode follows it. */
export function saveKey(dir: string, key: string): Config {
  const { runtime: _previous, ...rest } = loadConfig(dir);
  const next: Config = { ...rest, anthropicApiKey: key };
  saveConfig(dir, next);
  return next;
}

export function chooseSimulation(dir: string): Config {
  const next: Config = { ...loadConfig(dir), runtime: "simulation" };
  saveConfig(dir, next);
  return next;
}
