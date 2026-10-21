import {
  ENTERPRISE,
  overview,
  pageView,
  spendBreakdown,
  tablesOf,
  agentSheet,
  journalEntries,
  recruitments,
  overBudget,
  spentOn,
  filView,
  type FilItem,
  calendar,
  cancellable,
  fmt,
  MAX_ATTEMPTS,
  analytics,
  STAGE_LABEL as STAGES_SAID,
  isValid,
  searchJournal,
  forFounder,
  role,
  team,
  WORKING,
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
  idea: "idea",
  research: "research",
  creation: "setting up",
  launch: "launch",
  operating: "operating",
};


export function header(s: CompanyState, status: EngineStatus): string {
  const c = s.company!;
  const mode = status.runtime === "simulation" ? yellow("simulation") : status.runtime === "claude-code" ? yellow("Claude Code (dev, subscription)") : status.runtime === "none" ? yellow("no key") : ({ anthropic: "Claude", openrouter: "OpenRouter", openai: "OpenAI", compatible: "compatible API" } as Record<string, string>)[status.runtime] ?? status.runtime;
  const run = c.paused ? yellow("paused") : status.passive ? dim("team stopped · narthex start") : status.unavailable ? yellow("waiting") : green("the team is working");
  const spend = status.subscription ? subscriptionLine(status.subscription) : `AI spend ${fmt.dollars(s.usage.credits)}`;
  const line = `${bold(clean(c.name))}  ${dim(`· ${STAGE[c.stage]} · ${mode} ·`)} ${run}  ${dim(`· ${spend}`)}`;
  return status.unavailable ? `${line}\n${yellow("!")} ${clean(status.unavailable)}` : line;
}

/** « subscription 42% (5 h) · 68% (week) »: how full the developer's subscription is. */
export function subscriptionLine(sub: NonNullable<EngineStatus["subscription"]>): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const parts = [sub.fiveHour !== undefined ? `${pct(sub.fiveHour)} (5 h)` : "", sub.sevenDay !== undefined ? `${pct(sub.sevenDay)} (week)` : ""].filter(Boolean);
  return parts.length ? `subscription ${parts.join(" · ")}` : "subscription";
}

/** The founder's own to-do: only what the law reserves to them, plus what they can still cancel. */
export function forYou(s: CompanyState, now: number): string {
  const lines: string[] = [];
  for (const o of forFounder(s)) {
    const due = o.due ? dim(` · by ${fmt.day(o.due)}`) : "";
    lines.push(`${violet("!")} ${bold(o.title)}${due}`);
    lines.push(dim(wrapText(o.why, 4)));
    const extra = o.code === "A3-forme" ? " --form SASU" : "";
    lines.push(`    ${dim("→")} narthex done ${o.id}${extra}`);
  }
  for (const o of Object.values(s.obligations)) {
    if (o.status !== "open" || !o.stuck) continue;
    lines.push(`${red("!")} ${bold(`Stuck: ${clean(o.title)}`)} ${dim(`· after ${MAX_ATTEMPTS} attempts`)}`);
    lines.push(dim(wrapText(`Last error: ${o.stuck.error}`, 4)));
    lines.push(`    ${dim("→")} narthex retry ${o.id}`);
  }
  if (overBudget(s, now)) {
    lines.push(`${yellow("!")} ${bold("Today's budget reached")} ${dim(`· ${fmt.dollars(spentOn(s, now))} of ${fmt.dollars(s.settings.dailyBudgetCredits)}, the team picks up tomorrow`)}`);
    lines.push(`    ${dim("→")} narthex config budget <dollars>`);
  }
  for (const t of cancellable(s, now)) {
    const who = s.agents[t.agentId]?.name ?? "?";
    lines.push(`${yellow("◷")} ${who} · ${clean(t.title)} ${dim(`· you can cancel until ${fmt.day(t.cancellableUntil!)} ${fmt.hour(t.cancellableUntil!)}`)}`);
    lines.push(`    ${dim("→")} narthex cancel ${t.id}`);
  }
  return lines.length ? `${bold("For you")}\n${lines.join("\n")}` : "";
}

export function fil(s: CompanyState, status: EngineStatus, limit = 15): string {
  const view = filView(s, status.now, limit);
  const parts = [header(s, status), rule()];
  const you = forYou(s, status.now);
  if (you) parts.push(you, rule());
  parts.push(pilot(s, status, view.pilot), "");
  if (status.runtime === "none") parts.push(`${violet("!")} The team is waiting for your key to work: ${bold("narthex config key")}`, "");
  if (view.items.length === 0) parts.push(dim("The feed is empty for now. Every piece of work the team finishes will land here, with its sources."));
  for (const item of [...view.items].reverse()) parts.push(publication(s, item, status.now));
  return parts.join("\n");
}

function pilot(s: CompanyState, status: EngineStatus, p: ReturnType<typeof filView>["pilot"]): string {
  const waiting = status.runtime === "none" || s.company?.paused;
  const next = p.next ? `${p.next.title}${s.agents[p.next.agentId] ? ` (${s.agents[p.next.agentId]!.name})` : ""}` : undefined;
  if (waiting) return `${yellow("●")} ${s.company?.paused ? "The team is paused" : "The team is waiting for your key"}${next ? dim(` · first task ready: ${clean(next)}`) : ""}`;
  const running = p.running === 0 ? "no task running" : `${p.running} task${p.running > 1 ? "s" : ""} running`;
  return `${green("●")} Your company runs on its own ${dim(`· ${running}${next ? ` · next: ${clean(next)}, ${fmt.relative(p.next!.at, status.now)}` : ""}`)}`;
}

/** One Fil message: who, when, what, the attached work and its real cost in time, XP and sources. */
export function publication(s: CompanyState, item: FilItem, now: number): string {
  const block = postBlock(s, item.post.agentId, item.post.at, item.post.text, now, item.deliverable);
  const meta = [
    item.durationMs !== undefined ? `◷ ${fmt.duration(item.durationMs)}` : "",
    item.xp !== undefined ? `↑ ${item.xp} XP` : "",
    item.sources.length ? `▤ ${clean([...new Set(item.sources)].slice(0, 3).join(", "))}` : "",
  ].filter(Boolean);
  const t = item.task;
  const cancel = t && t.status === "planned" && t.kind === "external" && (t.cancellableUntil ?? 0) > now ? `  ${yellow("◷")} goes out ${fmt.relative(t.cancellableUntil!, now)} ${dim(`· narthex cancel ${t.id}`)}\n` : "";
  return `${block.trimEnd()}\n${meta.length ? `  ${dim(meta.join("   "))}\n` : ""}${cancel}`;
}

export function postBlock(s: CompanyState, agentId: string, at: number, text: string, now: number, d?: Deliverable): string {
  const agent = s.agents[agentId];
  const who = agent ? `${bold(agent.name)} ${dim(`· ${role(agent.role).title}`)}` : bold("?");
  const lines = [`${who} ${dim(`· ${fmt.relative(at, now)}`)}`, wrapText(text)];
  if (d) lines.push(`  ${violet("↳")} ${clean(d.title)} ${dim(`· narthex deliverable ${d.id}`)}`);
  return `${lines.join("\n")}\n`;
}

export function equipe(s: CompanyState, now: number): string {
  const rows = team(s).map((m) => {
    const state = m.current
      ? `${green("●")} ${clean(m.current.progress && !WORKING.includes(m.current.progress) ? m.current.progress : m.current.title)}`
      : m.next
        ? `${dim("○")} ${dim(`next: ${clean(m.next.title)} · ${fmt.relative(m.next.scheduledAt, now)}`)}`
        : `${dim("○ resting")}`;
    const trust = dim(`${m.done} done · reliability ${Math.round(m.reliability * 100)}% · autonomy ${m.agent.autonomy}/4`);
    return `${bold(m.agent.name.padEnd(9))} ${m.title.padEnd(18)} ${state}\n${" ".repeat(29)}${trust}`;
  });
  return [bold("The team"), ...rows].join("\n");
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

/** Day or week agenda; the week starts on Monday. */
export function calendrier(s: CompanyState, now: number, view: "jour" | "semaine", agentId?: string): string {
  const dayMs = 86_400_000;
  const start = startOfDay(now);
  const from = view === "jour" ? start : start - ((new Date(start).getDay() + 6) % 7) * dayMs;
  const to = from + (view === "jour" ? 1 : 7) * dayMs;
  const tasks = calendar(s, from, to, agentId);
  const title = view === "jour" ? fmt.day(from) : `week of ${fmt.day(from)} to ${fmt.day(to - 1)}`;
  const out = [bold(`Calendar · ${title}`)];
  if (tasks.length === 0) out.push(dim("Nothing planned."));
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
  out.push(dim("\n✓ done  ● running  ○ planned  ◷ waiting for your cancel window"));
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
  if (all.length === 0) out.push(dim("None for now."));
  for (const o of all) {
    const owner = o.owner === "founder" ? violet("you") : role(o.owner).title;
    const due = o.due && o.status === "open" ? dim(` · by ${fmt.day(o.due)}`) : "";
    const stuck = o.status === "open" && o.stuck ? ` ${red("· stuck")} ${dim(`narthex retry ${o.id}`)}` : "";
    out.push(`${o.status === "done" ? dim("✓") : "○"} ${o.status === "done" ? dim(o.title) : o.title} ${dim("·")} ${owner}${due}${stuck}`);
  }
  return out.join("\n");
}

export function livrable(s: CompanyState, d: Deliverable): string {
  const agent = s.agents[d.agentId];
  const sources = d.sources.length
    ? `\n${bold("Sources")}\n${d.sources.map((x) => `- ${clean(x.title)}${x.url ? ` ${dim(clean(x.url))}` : ""}${x.checkedAt ? dim(` (checked ${clean(x.checkedAt)})`) : ""}${x.reachable === false ? ` ${red("· no longer answers")}` : ""}`).join("\n")}`
    : "";
  return `${bold(clean(d.title))}\n${dim(`${agent?.name ?? "?"} · ${fmt.day(d.createdAt)} · ${clean(d.summary)}`)}\n${rule()}\n${clean(d.body)}\n${sources}`;
}

/** The log: every action, with who did it, in the same sentences as the app. */
export function journal(s: CompanyState, events: StoredEvent[], last = Infinity): string {
  const entries = journalEntries(s, events).slice(0, last === Infinity ? undefined : last).reverse();
  const lines = entries.map((e) => {
    const when = dim(`${fmt.day(e.at)} ${fmt.hour(e.at)}`.padEnd(18));
    const text = e.kind === "problem" ? red(clean(e.text)) : clean(e.text);
    return `${when} ${text}${e.detail && e.kind === "problem" ? dim(` · ${clean(e.detail)}`) : ""}`;
  });
  return [bold("Log"), ...lines].join("\n");
}

export function recrutementsView(s: CompanyState): string {
  const r = recruitments(s);
  const out = [bold("Planned hires")];
  if (r.planned.length === 0) out.push(dim("The whole planned team is here."));
  for (const p of r.planned) out.push(`  ○ ${p.role.defaultName} · ${p.role.title} ${dim(`· ${p.when}${p.why ? ` · ${clean(p.why)}` : ""}`)}`);
  out.push("", bold("Joined"));
  for (const a of r.arrived) out.push(`  ● ${a.agent.name} · ${a.title} ${dim(`· ${fmt.day(a.agent.hiredAt)}`)}`);
  return out.join("\n");
}

export function agentView(s: CompanyState, agentId: string, now: number): string {
  const sheet = agentSheet(s, agentId, now);
  const h = sheet.stats.hoursThisWeek;
  const out = [
    `${bold(sheet.agent.name)} ${dim(`· ${sheet.title} · joined ${fmt.day(sheet.agent.hiredAt)}`)}`,
    dim(`${h < 1 ? `${Math.round(h * 60)} min` : `${Math.round(h)} h`} this week · ${sheet.stats.xp} XP · ${sheet.stats.done} done · ${sheet.stats.failed} not completed`),
    "",
    bold("Right now"),
    sheet.current ? `  ● ${clean(sheet.current.title)}` : dim("  Resting."),
    "",
    bold("Next"),
    ...(sheet.next.length ? sheet.next.map((t) => `  ○ ${clean(t.title)} ${dim(`· ${t.scheduledAt <= now ? "as soon as possible" : fmt.relative(t.scheduledAt, now)}`)}`) : [dim("  Nothing planned.")]),
    "",
    bold("Done"),
    ...(sheet.finished.length ? sheet.finished.map((f) => `  ✓ ${clean(f.task.title)}${f.deliverableId ? dim(` · narthex deliverable ${f.deliverableId}`) : ""}`) : [dim("  Not yet.")]),
    ...(sheet.lessons.length ? ["", bold("What they learnt"), ...sheet.lessons.map((l) => `  · ${clean(l.text)}`)] : []),
  ];
  return out.join("\n");
}

/** Company: the overview, or one page of a section, from the team's real work. */
export function entreprise(s: CompanyState, now: number, section?: string, page?: string): string {
  const sections = ENTERPRISE.filter((x) => x.pages.length > 0).map((x) => x.section.toLowerCase());
  if (!section || section === "overview" || section === "vue") {
    const o = overview(s, now);
    const icon = { done: green("✓"), you: violet("!"), team: "•", later: dim("○") } as const;
    return [
      `${bold(clean(o.title))} ${dim(`· ${o.stage}`)}`,
      dim(clean(o.subtitle)),
      "",
      bold("Where your company stands"),
      ...o.milestones.map((m) => `  ${icon[m.state]} ${m.state === "later" ? dim(m.title) : m.title} ${dim(`· ${m.who}${m.at ? ` · ${fmt.day(m.at)}` : ""}`)}`),
      "",
      dim(`Sections: ${sections.join(", ")} (narthex company <section> [page])`),
    ].join("\n");
  }
  const spec = ENTERPRISE.find((x) => x.section.toLowerCase().startsWith(section.toLowerCase()));
  if (!spec || spec.pages.length === 0) throw new Error(`Unknown section: ${section}. Choices: ${sections.join(", ")}.`);
  const p = page ? spec.pages.find((x) => x.page.toLowerCase().startsWith(page.toLowerCase())) : spec.pages[0];
  if (!p) throw new Error(`Unknown page: ${page}. Choices: ${spec.pages.map((x) => x.page).join(", ")}.`);
  const v = pageView(s, spec.section, p.page, now);
  const out = [bold(`${spec.section} · ${p.page}`), dim(`Pages: ${spec.pages.map((x) => x.page).join(", ")}`), ""];
  for (const t of v.tasks) out.push(`  ○ ${clean(t.title)} ${dim(`· ${s.agents[t.agentId]?.name ?? ""}`)}`);
  for (const d of v.deliverables) out.push(`  ${violet("↳")} ${clean(d.title)} ${dim(`· ${clean(d.summary)} · narthex deliverable ${d.id}`)}`);
  if (v.empty) out.push(dim(`  ${v.empty}`));
  return out.join("\n");
}

export function depense(s: CompanyState, events: StoredEvent[]): string {
  const b = spendBreakdown(s, events);
  return [
    `${bold("AI spend")} ${dim(`· ${fmt.dollars(b.total)} in total · cap ${fmt.dollars(s.settings.dailyBudgetCredits)} per day`)}`,
    ...b.byAgent.map((a) => `  ${a.name.padEnd(10)} ${fmt.dollars(a.credits)}`),
    ...(b.byDay.length ? ["", dim("Per day:"), ...b.byDay.filter((d) => d.credits > 0).map((d) => `  ${fmt.day(d.day).padEnd(14)} ${fmt.dollars(d.credits)}`)] : []),
  ].join("\n");
}

export function tableaux(s: CompanyState): string {
  const t = tablesOf(s);
  if (t.length === 0) return dim("No table yet.");
  return t
    .map((x) => [bold(clean(x.deliverable.title)), dim(x.header.map(clean).join(" | ")), ...x.rows.map((r) => r.map(clean).join(" | "))].join("\n"))
    .join("\n\n");
}

/** L2 memory: what the team knows now, most important first, then what is no longer true. */
export function memoire(s: CompanyState, now: number): string {
  const facts = Object.values(s.facts);
  const current = facts.filter((f) => isValid(f, now)).sort((a, b) => b.importance - a.importance || b.validFrom - a.validFrom);
  const outdated = facts.filter((f) => f.invalidAt !== undefined && f.invalidAt <= now);
  const out = [bold("What the team knows")];
  if (current.length === 0) out.push(dim("Nothing yet. Every finished deliverable adds what is worth remembering."));
  for (const f of current) {
    const from = s.deliverables[f.deliverableId];
    out.push(`${f.importance >= 8 ? violet("●") : dim("●")} ${clean(f.text)}`);
    out.push(dim(`    ${f.subject ? `${clean(f.subject)} · ` : ""}learnt ${fmt.day(f.validFrom)}${from ? ` · ${clean(from.title)}` : ""}${f.sensitive ? " · restricted" : ""} · ${f.id}`));
  }
  if (outdated.length) out.push("", dim(`${outdated.length} fact${outdated.length > 1 ? "s" : ""} no longer true (kept for the record).`));
  return out.join("\n");
}

/** « Why did we decide X? » over the log: tasks with their reason, deliverables, facts. */
export function pourquoi(s: CompanyState, question: string): string {
  const hits = searchJournal(s, question);
  if (hits.length === 0) return dim("Nothing in the log or in memory answers that.");
  return hits
    .map((h) => {
      const who = h.agentId ? (s.agents[h.agentId]?.name ?? "") : "";
      const kind = h.kind === "task" ? "Task" : h.kind === "deliverable" ? "Deliverable" : "Fact kept";
      return [`${bold(clean(h.title))}`, ...(h.why ? [`  Why: ${clean(h.why)}`] : []), dim(`  ${kind}${who ? ` · ${who}` : ""} · ${fmt.day(h.at)}`)].join("\n");
    })
    .join("\n\n");
}

/** ▁▂▃▅▇ for a series of numbers (zero stays at the floor). */
function sparkline(values: number[]): string {
  const marks = "▁▂▃▄▅▆▇█";
  const max = Math.max(...values, 0);
  return values.map((v) => (max === 0 || v === 0 ? "▁" : marks[Math.min(7, Math.round((v / max) * 7))]!)).join("");
}

/** « narthex data »: the company's numbers, from real events only. */
export function data(s: CompanyState, events: StoredEvent[], now: number, days = 30): string {
  const a = analytics(s, events, now, days);
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const out = [
    bold("Data"),
    `Revenue ${bold(fmt.euros(a.money.revenue))} ${dim(`· ${a.money.sales} sale${a.money.sales === 1 ? "" : "s"}`)}   AI spend ${bold(fmt.dollars(a.money.spend))}   Per deliverable ${bold(a.money.costPerDeliverable === null ? "—" : fmt.dollars(a.money.costPerDeliverable))}`,
    `Deliverables ${a.quality.deliverables} ${dim(`· ${a.quality.sourcesPerDeliverable?.toLocaleString("en-GB") ?? "—"} sources on average · links answering ${pct(a.quality.linksAnswering)} · ${a.quality.facts} facts in memory`)}`,
    "",
    `${dim(`${a.days.length} day${a.days.length > 1 ? "s" : ""}`.padEnd(12))}`,
    `  Sales      ${green(sparkline(a.days.map((d) => d.revenue)))}`,
    `  Spend      ${violet(sparkline(a.days.map((d) => d.spend)))}`,
    `  Tasks      ${sparkline(a.days.map((d) => d.done))}`,
    "",
    bold("The team"),
    ...a.team.map((t) => `  ${t.name.padEnd(10)} ${String(t.done).padStart(3)} done ${dim(`· success ${pct(t.successRate)} · ${t.xp} XP · ${fmt.dollars(t.spend)}`)}`),
    "",
    bold("Progress"),
    ...a.stages.map((st) => `  ${violet("●")} ${STAGES_SAID[st.stage]} ${dim(`· ${fmt.day(st.at)}`)}`),
  ];
  return out.join("\n");
}
