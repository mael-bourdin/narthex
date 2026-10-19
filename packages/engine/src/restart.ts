import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, saveConfig } from "./config.ts";
import { databasePath } from "./paths.ts";

/**
 * « Recommencer »: moves the company's journal into archives/<date>/ so the next launch plays
 * the first launch again. Nothing is deleted. A saved key is kept; a simulation choice is forgotten,
 * so the key step comes back. The engine must not be running.
 * Returns the archive folder, or null when there was no company.
 */
export function archiveCompany(dir: string, now = Date.now()): string | null {
  const { runtime, ...rest } = loadConfig(dir);
  if (runtime === "simulation") saveConfig(dir, rest);

  const db = databasePath(dir);
  if (!existsSync(db)) return null;
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = join(dir, "archives", stamp);
  mkdirSync(target, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(db + suffix)) renameSync(db + suffix, join(target, `narthex.sqlite${suffix}`));
  }
  return target;
}
