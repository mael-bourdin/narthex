import {
  calendar,
  cancellable,
  feed,
  fmt,
  forFounder,
  role,
  team,
  type CompanyState,
  type Deliverable,
  type EngineStatus,
  type Stage,
  type StoredEvent,
  type Task,
} from "@narthex/core";
import { bold, clean, dim, green, red, rule, violet, wrapText, yellow } from "./style.ts";

/** Pure renderers: state in, text out. Every screen of the app has its terminal twin here. */

const STAGE: Record<Stage, string> = {
  idea: "idée",
  research: "étude",
  creation: "création",
  launch: "lancement",
  operating: "en activité",
};

export function header(s: CompanyState, status: EngineStatus): string {
  const c = s.company!;
  const mode = status.runtime === "simulation" ? yellow("simulation") : "Claude";
  const run = c.paused ? yellow("en pause") : status.passive ? dim("équipe à l'arrêt · narthex lancer") : green("l'équipe travaille");
  return `${bold(clean(c.name))}  ${dim(`· ${STAGE[c.stage]} · ${mode} ·`)} ${run}  ${dim(`· ${fmt.credits(s.usage.credits)} crédits`)}`;
}

/** The founder's own to-do: only what the law reserves to them, plus what they can still cancel. */
export function forYou(s: CompanyState, now: number): string {
  const lines: string[] = [];
  for (const o of forFounder(s)) {
    const due = o.due ? dim(` · avant le ${fmt.day(o.due)}`) : "";
    lines.push(`${violet("!")} ${bold(o.title)}${due}`);
    lines.push(dim(wrapText(o.why, 4)));
    const extra = o.code === "A3-forme" ? " --forme SASU" : "";
    lines.push(`    ${dim("→")} narthex valider ${o.id}${extra}`);
  }
  for (const t of cancellable(s, now)) {
    const who = s.agents[t.agentId]?.name ?? "?";
    lines.push(`${yellow("◷")} ${who} · ${clean(t.title)} ${dim(`· annulable jusqu'à ${fmt.day(t.cancellableUntil!)} ${fmt.hour(t.cancellableUntil!)}`)}`);
    lines.push(`    ${dim("→")} narthex annuler ${t.id}`);
  }
  return lines.length ? `${bold("Pour toi")}\n${lines.join("\n")}` : "";
}

export function fil(s: CompanyState, status: EngineStatus, limit = 15): string {
  const parts = [header(s, status), rule()];
  const you = forYou(s, status.now);
  if (you) parts.push(you, rule());
  const items = feed(s, limit);
  if (items.length === 0) parts.push(dim(status.passive ? "Rien encore. Lance l'équipe : narthex lancer" : "L'équipe arrive…"));
  for (const item of items.reverse()) parts.push(postBlock(s, item.post.agentId, item.post.at, item.post.text, status.now, item.deliverable));
  return parts.join("\n");
}

export function postBlock(s: CompanyState, agentId: string, at: number, text: string, now: number, d?: Deliverable): string {
  const agent = s.agents[agentId];
  const who = agent ? `${bold(agent.name)} ${dim(`· ${role(agent.role).title}`)}` : bold("?");
  const lines = [`${who} ${dim(`· ${fmt.relative(at, now)}`)}`, wrapText(text)];
  if (d) lines.push(`  ${violet("↳")} ${clean(d.title)} ${dim(`· narthex livrable ${d.id}`)}`);
  return `${lines.join("\n")}\n`;
}

export function equipe(s: CompanyState, now: number): string {
  const rows = team(s).map((m) => {
    const state = m.current
      ? `${green("●")} ${clean(m.current.progress && m.current.progress !== "Au travail…" ? m.current.progress : m.current.title)}`
      : m.next
        ? `${dim("○")} ${dim(`ensuite : ${clean(m.next.title)} · ${fmt.relative(m.next.scheduledAt, now)}`)}`
        : `${dim("○ au repos")}`;
    const trust = dim(`${m.done} faite${m.done > 1 ? "s" : ""} · fiabilité ${Math.round(m.reliability * 100)} % · autonomie ${m.agent.autonomy}/4`);
    return `${bold(m.agent.name.padEnd(9))} ${m.title.padEnd(15)} ${state}\n${" ".repeat(26)}${trust}`;
  });
  return [bold("L'équipe"), ...rows].join("\n");
}

function mark(t: Task): string {
  switch (t.status) {
    case "done":
      return dim("✓");
    case "running":
      return green("●");
    case "failed":
      return red("✗");
    case "cancelled":
      return dim("–");
    default:
      return t.kind === "external" ? yellow("◷") : "○";
  }
}

/** Day or week agenda; the week starts on Monday, like a French calendar. */
export function calendrier(s: CompanyState, now: number, view: "jour" | "semaine", agentId?: string): string {
  const dayMs = 86_400_000;
  const start = startOfDay(now);
  const from = view === "jour" ? start : start - ((new Date(start).getDay() + 6) % 7) * dayMs;
  const to = from + (view === "jour" ? 1 : 7) * dayMs;
  const tasks = calendar(s, from, to, agentId);
  const title = view === "jour" ? fmt.day(from) : `semaine du ${fmt.day(from)} au ${fmt.day(to - 1)}`;
  const out = [bold(`Calendrier · ${title}`)];
  if (tasks.length === 0) out.push(dim("Rien de prévu."));
  let current = "";
  for (const t of tasks) {
    const at = t.startedAt ?? t.scheduledAt;
    const day = fmt.day(at);
    if (view === "semaine" && day !== current) {
      current = day;
      out.push(`\n${bold(day)}`);
    }
    const who = s.agents[t.agentId]?.name ?? "?";
    out.push(`  ${dim(fmt.hour(at).padStart(7))}  ${mark(t)} ${who.padEnd(8)} ${clean(t.title)}`);
  }
  out.push(dim("\n✓ faite  ● en cours  ○ prévue  ◷ attend ton délai d'annulation"));
  return out.join("\n");
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function obligations(s: CompanyState): string {
  const all = Object.values(s.obligations).sort((a, b) => (a.status === b.status ? (a.due ?? Infinity) - (b.due ?? Infinity) : a.status === "open" ? -1 : 1));
  const out = [bold("Obligations")];
  if (all.length === 0) out.push(dim("Aucune pour l'instant."));
  for (const o of all) {
    const owner = o.owner === "founder" ? violet("toi") : role(o.owner).title;
    const due = o.due && o.status === "open" ? dim(` · avant le ${fmt.day(o.due)}`) : "";
    out.push(`${o.status === "done" ? dim("✓") : "○"} ${o.status === "done" ? dim(o.title) : o.title} ${dim("·")} ${owner}${due}`);
  }
  return out.join("\n");
}

export function livrable(s: CompanyState, d: Deliverable): string {
  const agent = s.agents[d.agentId];
  const sources = d.sources.length
    ? `\n${bold("Sources")}\n${d.sources.map((x) => `- ${clean(x.title)}${x.url ? ` ${dim(clean(x.url))}` : ""}${x.checkedAt ? dim(` (vérifié le ${clean(x.checkedAt)})`) : ""}`).join("\n")}`
    : "";
  return `${bold(clean(d.title))}\n${dim(`${agent?.name ?? "?"} · ${fmt.day(d.createdAt)} · ${clean(d.summary)}`)}\n${rule()}\n${clean(d.body)}\n${sources}`;
}

/** The Journal: every action, with who did it. Built from the raw event log. */
export function journal(s: CompanyState, events: StoredEvent[], last = Infinity): string {
  const name = (id?: string) => (id && s.agents[id]?.name) || "?";
  const taskTitle = (id: string) => clean(s.tasks[id]?.title ?? id);
  const lines = events.flatMap((e) => {
    const when = dim(`${fmt.day(e.ts)} ${fmt.hour(e.ts)}`.padEnd(18));
    switch (e.type) {
      case "company.founded":
        return [`${when} ${e.company.founder.name} a fondé ${e.company.name}`];
      case "agent.hired":
        return [`${when} ${e.agent.name} rejoint l'équipe (${role(e.agent.role).title})`];
      case "stage.changed":
        return [`${when} L'entreprise passe à l'étape « ${STAGE[e.stage]} »`];
      case "task.started":
        return [`${when} ${name(s.tasks[e.taskId]?.agentId)} commence « ${taskTitle(e.taskId)} »`];
      case "task.completed":
        return [`${when} ${name(s.tasks[e.taskId]?.agentId)} termine « ${taskTitle(e.taskId)} »`];
      case "task.failed":
        return [`${when} ${red("échec")} « ${taskTitle(e.taskId)} » : ${clean(e.error)}`];
      case "task.cancelled":
        return [`${when} ${e.by === "founder" ? "Tu as annulé" : "L'équipe a annulé"} « ${taskTitle(e.taskId)} »`];
      case "obligation.fulfilled":
        return [`${when} ${e.by === "founder" ? "Tu as fait" : `${name(e.by)} a fait`} « ${s.obligations[e.obligationId]?.title ?? ""} »`];
      case "company.paused":
        return [`${when} Équipe mise en pause`];
      case "company.resumed":
        return [`${when} L'équipe reprend`];
      default:
        return [];
    }
  });
  return [bold("Journal"), ...lines.slice(-last)].join("\n");
}
