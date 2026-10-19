import type { Timestamp } from "./types.ts";

/** French formatting used by every client, so the CLI and the app say the same thing. */
const TZ = { timeZone: "Europe/Paris" } as const;

export function hour(ts: Timestamp): string {
  const parts = new Intl.DateTimeFormat("fr-FR", { ...TZ, hour: "numeric", minute: "2-digit" }).formatToParts(ts);
  const h = parts.find((p) => p.type === "hour")?.value ?? "0";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return m === "00" ? `${Number(h)} h` : `${Number(h)} h ${m}`;
}

export function day(ts: Timestamp): string {
  return new Intl.DateTimeFormat("fr-FR", { ...TZ, weekday: "short", day: "numeric", month: "short" }).format(ts);
}

export function dayKey(ts: Timestamp): string {
  return new Intl.DateTimeFormat("fr-CA", { ...TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
}

/** "il y a 3 min", "dans 14 h", "hier". */
export function relative(ts: Timestamp, now: Timestamp): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const span = minutes < 1 ? "un instant" : minutes < 60 ? `${minutes} min` : hours < 24 ? `${hours} h` : `${days} j`;
  if (minutes < 1) return "à l'instant";
  if (diff < 0 && days === 1 && hours >= 24) return "hier";
  return diff < 0 ? `il y a ${span}` : `dans ${span}`;
}

export function credits(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/ /g, " ");
}

/** "35 min", "2 h 10", "3 h". Never less than a minute: finished work always took some time. */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
