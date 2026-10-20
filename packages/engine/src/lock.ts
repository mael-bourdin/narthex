import { mkdirSync, openSync, readFileSync, unlinkSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";

/**
 * One working engine per data folder: two would write the same log and each would ignore the other's
 * events. Taken before the engine is built (so it never marks a live engine's tasks as interrupted),
 * released on close or exit. A lock left by a process that no longer exists is taken over.
 */
export function acquireLock(dir: string): () => void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "engine.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      let held = true;
      const release = () => {
        if (!held) return;
        held = false;
        process.off("exit", release);
        try {
          if (readFileSync(file, "utf8") === String(process.pid)) unlinkSync(file);
        } catch {}
      };
      process.on("exit", release);
      return release;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(readFileSync(file, "utf8"));
      if (pid && alive(pid)) throw new Error(`Narthex tourne déjà sur ces données (processus ${pid}). Utilise-le, ou arrête-le d'abord.`);
      try {
        unlinkSync(file);
      } catch {}
    }
  }
  throw new Error("Impossible de prendre la main sur ces données.");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
