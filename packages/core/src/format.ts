import type { Timestamp } from "./types.ts";

/** English formatting (en-GB, Paris time) used by every client, so the CLI and the app say the same thing. */
const TZ = { timeZone: "Europe/Paris" } as const;

/** "14:05". */
export function hour(ts: Timestamp): string {
  return new Intl.DateTimeFormat("en-GB", { ...TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ts);
}

/** "Mon 19 Oct". */
export function day(ts: Timestamp): string {
  return new Intl.DateTimeFormat("en-GB", { ...TZ, weekday: "short", day: "numeric", month: "short" }).format(ts);
}

export function dayKey(ts: Timestamp): string {
  return new Intl.DateTimeFormat("fr-CA", { ...TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
}

/** "3 min ago", "in 14 h", "yesterday". */
export function relative(ts: Timestamp, now: Timestamp): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const span = minutes < 60 ? `${minutes} min` : hours < 24 ? `${hours} h` : `${days} d`;
  if (minutes < 1) return "just now";
  if (diff < 0 && days === 1 && hours >= 24) return "yesterday";
  return diff < 0 ? `${span} ago` : `in ${span}`;
}

/** The AI spend, in dollars (the engine counts in cents): "$4.94". */
export function dollars(cents: number): string {
  const amount = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(cents) / 100);
  return `${cents < 0 ? "-" : ""}$${amount}`;
}

/** "3", "1.50", "1,50", "$2.5" → cents; NaN when it is not an amount. */
export function parseDollars(text: string): number {
  const cleaned = text.replace(/\$/g, "").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

/** "35 min", "2 h 10", "3 h". Never less than a minute: finished work always took some time. */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Money the company made, from euro cents: "€1,250", "€42.50". */
export function euros(cents: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
