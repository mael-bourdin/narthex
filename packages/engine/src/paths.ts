import { createHash } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { homedir, platform, tmpdir, userInfo } from "node:os";
import { join } from "node:path";

/**
 * Where a player's data lives. Override with NARTHEX_HOME (tests, portable installs).
 * - macOS:   ~/Library/Application Support/Narthex
 * - Windows: %APPDATA%\Narthex
 * - Linux:   $XDG_DATA_HOME/narthex or ~/.local/share/narthex
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NARTHEX_HOME) return env.NARTHEX_HOME;
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Narthex");
    case "win32":
      return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Narthex");
    default:
      return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "narthex");
  }
}

/** Local socket the engine listens on: a named pipe on Windows, a Unix socket elsewhere. */
export function socketPath(dir: string = dataDir()): string {
  if (platform() === "win32") return pipeName(userInfo().username, dir);
  const inside = join(dir, "narthex.sock");
  // Unix socket paths are limited (~104 bytes on macOS): a deep data folder gets a short, stable one in /tmp.
  if (Buffer.byteLength(inside) < 100) return inside;
  const id = createHash("sha256").update(dir).digest("hex").slice(0, 16);
  return join(privateRuntimeDir(), `${id}.sock`);
}

/** Named pipes are global: one per user and data folder, hashed so two folders never collide. */
export function pipeName(user: string, dir: string): string {
  return `\\\\.\\pipe\\narthex-${createHash("sha256").update(`${user}:${dir}`).digest("hex").slice(0, 24)}`;
}

/**
 * A folder only the current user can enter, for sockets that cannot live in the data folder.
 * Refuses a folder someone else made, a symlink, or one others can read: a socket there could be
 * hijacked or listened to by another account on the machine.
 */
function privateRuntimeDir(): string {
  const uid = process.getuid?.() ?? 0;
  const base = process.env.XDG_RUNTIME_DIR || (platform() === "darwin" ? "/tmp" : tmpdir());
  const dir = join(base, `narthex-${uid}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid || (st.mode & 0o077) !== 0) {
    throw new Error(`Unsafe folder for Narthex's socket: ${dir}. Delete it or set NARTHEX_HOME to a shorter folder.`);
  }
  return dir;
}

export function databasePath(dir: string = dataDir()): string {
  return join(dir, "narthex.sqlite");
}

export function configPath(dir: string = dataDir()): string {
  return join(dir, "config.json");
}
