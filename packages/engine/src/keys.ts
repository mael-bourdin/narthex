import Anthropic from "@anthropic-ai/sdk";
import { SEUIL } from "@narthex/core";
import { loadConfig, saveConfig, type Config } from "./config.ts";

export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };

/**
 * Checks a pasted key with a call that costs nothing (listing models).
 * The founder sees Margaux's words, never an HTTP error.
 */
export async function verifyAnthropicKey(raw: string, client?: Pick<Anthropic, "models">): Promise<KeyCheck> {
  const key = raw.trim();
  if (!key.startsWith("sk-ant-")) return { ok: false, message: SEUIL.badKey };
  try {
    await (client ?? new Anthropic({ apiKey: key })).models.list({ limit: 1 });
    return { ok: true, key };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, message: SEUIL.badKey };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, message: "Je n'arrive pas à joindre Anthropic. Vérifie ta connexion et recolle la clé." };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
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
