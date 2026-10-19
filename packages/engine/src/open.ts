import { AnthropicRuntime } from "./anthropic.ts";
import { SimulatedClock, systemClock } from "./clock.ts";
import { apiKey, chooseRuntime, loadConfig, type Config } from "./config.ts";
import { Engine } from "./engine.ts";
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
export function openEngine(options: OpenOptions = {}): { engine: Engine; dir: string; config: Config } {
  const env = options.env ?? process.env;
  const dir = options.dir ?? dataDir(env);
  const config = options.config ?? loadConfig(dir);
  const store = new SqliteEventStore(databasePath(dir));
  const runtimeName = chooseRuntime(config, env);

  if (runtimeName === "anthropic") {
    const key = apiKey(config, env);
    const runtime = new AnthropicRuntime({ ...(key ? { apiKey: key } : {}), ...(config.model ? { model: config.model } : {}) });
    return { engine: new Engine({ store, runtime, clock: systemClock, passive: options.passive ?? false }), dir, config };
  }

  // The simulated clock never goes back in time, even after an `avancer`.
  const id = store.companies()[0];
  const last = id ? store.read(id).at(-1)?.ts : undefined;
  // Simulated minutes per real second → simulated ms per real ms.
  const clock = new SimulatedClock(Math.max(Date.now(), (last ?? 0) + 1), (config.simulationSpeed ?? 0) * 60);
  return { engine: new Engine({ store, runtime: new SimulationRuntime(), clock, tickMs: 1_000, passive: options.passive ?? false }), dir, config };
}
