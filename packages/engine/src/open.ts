import { AnthropicRuntime } from "./anthropic.ts";
import { ClaudeCodeRuntime } from "./claude-code.ts";
import { CompatibleRuntime } from "./compatible.ts";
import type { AgentRuntime } from "./runtime.ts";
import { SimulatedClock, systemClock } from "./clock.ts";
import { apiKey, chooseRuntime, loadConfig, saveConfig, type Config } from "./config.ts";
import { Host } from "./host.ts";
import { httpLinkCheck } from "./links.ts";
import { acquireLock } from "./lock.ts";
import { databasePath, dataDir } from "./paths.ts";
import { SimulationRuntime } from "./simulation.ts";
import { SqliteEventStore } from "./store.ts";

export interface OpenOptions {
  dir?: string;
  env?: NodeJS.ProcessEnv;
  config?: Config;
  passive?: boolean;
}

/** Opens the player's company from their data folder, with the runtime their setup allows. */
export function openEngine(options: OpenOptions = {}): { engine: Host; dir: string; config: Config } {
  const env = options.env ?? process.env;
  const dir = options.dir ?? dataDir(env);
  const config = options.config ?? loadConfig(dir);
  // A working engine owns the folder; a passive one (one-shot CLI command) only reads and records the founder's acts.
  const release = options.passive ? () => {} : acquireLock(dir);
  try {
    return build(dir, env, config, release, options.passive ?? false);
  } catch (e) {
    release();
    throw e;
  }
}

function build(dir: string, env: NodeJS.ProcessEnv, config: Config, onClose: () => void, passive: boolean): { engine: Host; dir: string; config: Config } {
  const store = new SqliteEventStore(databasePath(dir));
  const runtimeName = chooseRuntime(config, env);

  if (runtimeName !== "none" && runtimeName !== "simulation") {
    const runtime = makeRuntime(config, env)!;
    return { engine: new Host({ store, runtime, clock: systemClock, passive, onClose, ...company(dir, config), checkLink: httpLinkCheck }), dir, config };
  }

  if (runtimeName === "none") {
    return { engine: new Host({ store, runtime: null, clock: systemClock, passive, onClose, ...company(dir, config) }), dir, config };
  }

  // The simulated clock never goes back in time, even after an `avancer`.
  const id = store.companies()[0];
  const last = id ? store.read(id).at(-1)?.ts : undefined;
  // Simulated minutes per real second → simulated ms per real ms.
  const clock = new SimulatedClock(Math.max(Date.now(), (last ?? 0) + 1), (config.simulationSpeed ?? 0) * 60);
  return { engine: new Host({ store, runtime: new SimulationRuntime(), clock, tickMs: 1_000, passive, onClose, ...company(dir, config) }), dir, config };
}

/** The agents the player's setup allows: Claude, another provider with their key, or nobody yet (null). */
export function makeRuntime(config: Config, env: NodeJS.ProcessEnv = process.env): AgentRuntime | null {
  const name = chooseRuntime(config, env);
  const common = { ...(config.model ? { model: config.model } : {}), ...(config.models ? { models: config.models } : {}) };
  switch (name) {
    case "anthropic": {
      const key = apiKey(config, env);
      return new AnthropicRuntime({ ...(key ? { apiKey: key } : {}), ...common });
    }
    case "claude-code":
      return new ClaudeCodeRuntime(common);
    case "openrouter":
    case "openai":
    case "compatible":
      return new CompatibleRuntime({ provider: name, apiKey: config.keys![name]!, ...(config.baseUrl ? { baseURL: config.baseUrl } : {}), ...(config.levels ? { levels: config.levels } : {}), ...common });
    case "simulation":
      return new SimulationRuntime();
    default:
      return null;
  }
}

/** The company shown first, and remembering the founder's choice. */
function company(dir: string, config: Config): { activeCompany?: string; onSelect(id: string): void } {
  return {
    ...(config.activeCompany ? { activeCompany: config.activeCompany } : {}),
    onSelect: (id) => {
      const current = loadConfig(dir);
      if (current.activeCompany !== id) saveConfig(dir, { ...current, activeCompany: id });
    },
  };
}
