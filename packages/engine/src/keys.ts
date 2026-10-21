import Anthropic from "@anthropic-ai/sdk";
import { SEUIL } from "@narthex/core";
import { loadConfig, saveConfig, type Config } from "./config.ts";

import type { CompatibleFetch } from "./compatible.ts";

export type KeyCheck = { ok: true; key: string } | { ok: false; message: string };
export type ProviderName = "anthropic" | "openrouter" | "openai";

export const PROVIDER_LABEL: Record<ProviderName | "compatible", string> = { anthropic: "Anthropic (Claude)", openrouter: "OpenRouter", openai: "OpenAI", compatible: "API compatible" };

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
  const next: Config = { ...rest, provider: "anthropic", anthropicApiKey: key };
  saveConfig(dir, next);
  return next;
}

export function chooseSimulation(dir: string): Config {
  const next: Config = { ...loadConfig(dir), runtime: "simulation" };
  saveConfig(dir, next);
  return next;
}

/** Which provider a key belongs to, from its prefix. */
export function detectProvider(raw: string): ProviderName | undefined {
  const key = raw.trim();
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("sk-")) return "openai";
  return undefined;
}

/** Checks any provider's key with a call that costs nothing. Margaux's words, never an HTTP error. */
export async function verifyKey(raw: string, options: { fetch?: CompatibleFetch; timeoutMs?: number } = {}): Promise<{ ok: true; key: string; provider: ProviderName } | { ok: false; message: string }> {
  const key = raw.trim();
  const provider = detectProvider(key);
  if (!provider) return { ok: false, message: SEUIL.badKey };
  if (provider === "anthropic") {
    const check = await verifyAnthropicKey(key);
    return check.ok ? { ...check, provider } : check;
  }
  const call = options.fetch ?? (globalThis.fetch as unknown as CompatibleFetch);
  const url = provider === "openrouter" ? "https://openrouter.ai/api/v1/key" : "https://api.openai.com/v1/models";
  try {
    const res = await call(url, { method: "GET", headers: { authorization: `Bearer ${key}` }, body: undefined as never, signal: AbortSignal.timeout(options.timeoutMs ?? 15_000) });
    if (res.ok) return { ok: true, key, provider };
    if (res.status === 401 || res.status === 403) return { ok: false, message: SEUIL.badKey };
    return { ok: false, message: "Le fournisseur ne répond pas correctement pour l'instant. Réessaie dans un moment." };
  } catch {
    return { ok: false, message: `Je n'arrive pas à joindre ${provider === "openrouter" ? "OpenRouter" : "OpenAI"}. Vérifie ta connexion et recolle la clé.` };
  }
}

/** Saves a key for its provider; the team now runs on it. */
export function saveProviderKey(dir: string, provider: ProviderName | "compatible", key: string, baseUrl?: string): Config {
  const { runtime: _previous, ...rest } = loadConfig(dir);
  const next: Config =
    provider === "anthropic"
      ? { ...rest, provider, anthropicApiKey: key }
      : { ...rest, provider, keys: { ...rest.keys, [provider]: key }, ...(baseUrl ? { baseUrl } : {}) };
  saveConfig(dir, next);
  return next;
}
