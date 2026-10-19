import type { RuntimeName } from "./protocol.ts";
import type { StoredEvent } from "./events.ts";
import { duration } from "./format.ts";
import { missions, type Mission } from "./missions.ts";
import type { CompanyState, Deliverable, Timestamp } from "./types.ts";

/** A deliverable opened full page: its sections to read one by one, and what it cost. Real data only. */
export interface DeliverableSheet {
  /** Text before the first section, or the whole document when it has none. */
  intro: string;
  sections: { title: string; lead: string; body: string }[];
  meta: string[];
  /** AI spend of the task that produced it, in cents. */
  spend: number;
  /** What its author waits on from the founder, if anything. */
  next?: Mission;
}

export function deliverableSheet(
  state: CompanyState,
  d: Deliverable,
  events: readonly StoredEvent[],
  now: Timestamp,
  runtime: RuntimeName,
): DeliverableSheet {
  // The page shows the title already; a trailing « --- » only separated sections that are now rows.
  const tidy = (md: string) => md.trim().replace(/(\n\s*(-{3,}|\*{3,}|_{3,})\s*)+$/, "").trim();
  const [intro = "", ...parts] = d.body.replace(/^\s*#[ \t][^\n]*\n/, "").split(/^##[ \t]+/m);
  const sections = parts.map((part) => {
    const [title = "", ...rest] = part.split("\n");
    const body = tidy(rest.join("\n"));
    const firstLine = body.split("\n").find((l) => l.trim() && !l.startsWith("|") && !l.startsWith("#")) ?? "";
    const text = firstLine.replace(/^\s*(\d+[.)]|[-*+>])\s+/, "").replace(/[*_`]/g, "").trim();
    const lead = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
    return { title: title.trim(), lead, body };
  });

  const agent = state.agents[d.agentId];
  const task = state.tasks[d.taskId];
  const domains = [...new Set(d.sources.flatMap((s) => (s.url ? [hostOf(s.url)] : [])).filter(Boolean))];
  const meta = [
    `Rédigé par ${agent?.name ?? "l'équipe"}`,
    ...(task?.startedAt && task.endedAt ? [`${duration(task.endedAt - task.startedAt)} de travail`] : []),
    ...(d.sources.length ? [`${d.sources.length} source${d.sources.length > 1 ? "s" : ""}`] : []),
    ...(domains.length ? [domains.slice(0, 3).join(", ")] : []),
  ];

  const spend = events.reduce((sum, e) => (e.type === "usage.recorded" && e.taskId === d.taskId ? sum + e.credits : sum), 0);
  const next = missions(state, now, runtime).find((m) => m.speakerId === d.agentId && (m.kind === "legal" || m.kind === "cancel"));
  return { intro: tidy(intro), sections, meta, spend, ...(next ? { next } : {}) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The deliverable as a Markdown file the founder keeps (app « Enregistrer », CLI « livrable --md »). */
export function deliverableMarkdown(state: CompanyState, d: Deliverable): string {
  const by = state.agents[d.agentId]?.name ?? "l'équipe";
  const sources = d.sources.map((s) => `- ${s.url ? `[${s.title}](${s.url})` : s.title}${s.checkedAt ? ` · vérifié le ${s.checkedAt}` : ""}`);
  const date = new Date(d.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  return [`# ${d.title}`, `_Rédigé par ${by} · ${date}_`, d.body.trim(), ...(sources.length ? [`## Sources\n\n${sources.join("\n")}`] : [])].join("\n\n") + "\n";
}
