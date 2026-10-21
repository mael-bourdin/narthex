import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeName } from "@narthex/core";
import { configPath } from "./paths.ts";

export interface Config {
  /**
   * Which agents run. Claude is never chosen implicitly from an environment variable:
   * a developer with ANTHROPIC_API_KEY exported must not spend credits by surprise.
   * It runs when the player chose it (`narthex config mode anthropic`) or saved a key for Narthex.
   */
  runtime?: "simulation" | "anthropic";
  model?: string;
  /** Prefer the ANTHROPIC_API_KEY environment variable; this is for players who want it saved. */
  anthropicApiKey?: string;
  /** The provider of the key the player gave: Claude (anthropicApiKey) or another one (keys). */
  provider?: "anthropic" | "openrouter" | "openai" | "compatible";
  /** Keys for the other providers, saved for Narthex only. */
  keys?: { openrouter?: string; openai?: string; compatible?: string };
  /** The address of an OpenAI-compatible API (Mistral, Ollama, LM Studio…). */
  baseUrl?: string;
  /** The model for each level (léger, normal, approfondi), over the provider's defaults. */
  levels?: Partial<Record<import("@narthex/core").TaskLevel, string>>;
  /** A model per role, chosen in Réglages · API et modèles. */
  models?: Partial<Record<import("@narthex/core").RoleId, string>>;
  /** Desktop notifications the player wants. */
  notifications?: { legal?: boolean; leaving?: boolean; budget?: boolean; deliverables?: boolean };
  /** The founder's WhatsApp, linked through wacli: the team writes to this number's own chat. */
  whatsapp?: { phone: string };
  /** The founder's Discord: bot token, server, and the channels made for each company. */
  discord?: { token: string; guildId?: string; guildName?: string; setups?: Record<string, import("./connectors/discord.ts").DiscordCompanySetup> };
  /** Open source (default: everything stays at home) or the hosted version (can join the public ranking). */
  edition?: "open-source" | "hosted";
  /** The public ranking: where it lives, this instance's token (hosted), and the founder's choices. */
  leaderboard?: { url?: string; token?: string; share?: boolean; showRevenue?: boolean };
  /** The company the app and the CLI show (several can run). */
  activeCompany?: string;
  /** Simulation only: simulated minutes per real second. */
  simulationSpeed?: number;
}

export function loadConfig(dir: string): Config {
  const file = configPath(dir);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Config;
  } catch {
    throw new Error(`Configuration illisible : ${file}`);
  }
}

export function saveConfig(dir: string, config: Config): void {
  const file = configPath(dir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // Windows ignores POSIX modes; the file lives in the user's own profile folder there.
  try {
    chmodSync(file, 0o600);
  } catch {}
}

/** The key the player saved for Narthex wins: an exported work key must never be billed instead. */
export function apiKey(config: Config, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return config.anthropicApiKey || env.ANTHROPIC_API_KEY || undefined;
}

/**
 * Who does the work. Without a key, nobody: the team plans and waits, and the Fil stays empty
 * rather than showing invented work. The simulation is for development and tests only.
 */
export function chooseRuntime(config: Config, env: NodeJS.ProcessEnv = process.env): RuntimeName {
  // Development only, never saved nor offered to players: the developer's own Claude Code subscription.
  if (env.NARTHEX_RUNTIME === "claude-code") return "claude-code";
  const wanted = env.NARTHEX_RUNTIME === "simulation" || env.NARTHEX_RUNTIME === "anthropic" ? env.NARTHEX_RUNTIME : config.runtime;
  if (wanted === "simulation") return "simulation";
  if (wanted === "anthropic") {
    if (!apiKey(config, env)) throw new Error("Mode Claude choisi, mais aucune clé : « narthex config cle » ou ANTHROPIC_API_KEY.");
    return "anthropic";
  }
  const other = config.provider && config.provider !== "anthropic" ? config.provider : undefined;
  if (other && config.keys?.[other] && (other !== "compatible" || config.baseUrl)) return other;
  return config.anthropicApiKey ? "anthropic" : "none";
}

/** The first launch asks for a key unless the player already chose: a saved key, or a mode. */
export function needsKey(config: Config, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NARTHEX_RUNTIME === "simulation" || env.NARTHEX_RUNTIME === "claude-code") return false;
  const other = config.provider && config.provider !== "anthropic" ? config.keys?.[config.provider] : undefined;
  return !(config.anthropicApiKey || other || config.runtime === "anthropic" || config.runtime === "simulation");
}

/** The ranking settings with their defaults: open source, not shared, revenue as a band. */
export function leaderboardSettings(config: Config): import("./leaderboard.ts").LeaderboardSettings {
  return {
    edition: config.edition ?? "open-source",
    ...(config.leaderboard?.url ? { url: config.leaderboard.url } : {}),
    ...(config.leaderboard?.token ? { token: config.leaderboard.token } : {}),
    share: config.leaderboard?.share ?? false,
    showRevenue: config.leaderboard?.showRevenue ?? false,
  };
}
