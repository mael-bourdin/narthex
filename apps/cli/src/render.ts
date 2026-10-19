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
  const mode = status.runtime === "simulation" ? yellow("simulation") : status.runtime === "claude-code" ? yellow("Claude Code (dev, abonnement)") : status.runtime === "none" ? yellow("sans clé") : "Claude";
  const run = c.paused ? yellow("en pause") : status.passive ? dim("équipe à l'arrêt · narthex lancer") : green("l'équipe travaille");
  return `${bold(clean(c.name))}  ${dim(`· ${STAGE[c.stage]} · ${mode} ·`)} ${run}  ${dim(`· dépense IA ${fmt.dollars(s.usage.credits)}`)}`;
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
  for (const o of Object.values(s.obligations)) {
    if (o.status !== "open" || !o.stuck) continue;
    lines.push(`${red("!")} ${bold(`Bloqué : ${clean(o.title)}`)} ${dim(`· après ${MAX_ATTEMPTS} essais`)}`);
    lines.push(dim(wrapText(`Dernière erreur : ${o.stuck.error}`, 4)));
    lines.push(`    ${dim("→")} narthex reessayer ${o.id}`);
  }
  if (overBudget(s, now)) {
    lines.push(`${yellow("!")} ${bold("Budget du jour atteint")} ${dim(`· ${fmt.dollars(spentOn(s, now))} sur ${fmt.dollars(s.settings.dailyBudgetCredits)}, l'équipe reprend demain`)}`);
    lines.push(`    ${dim("→")} narthex config budget <dollars>`);
  }
  for (const t of cancellable(s, now)) {
    const who = s.agents[t.agentId]?.name ?? "?";
    lines.push(`${yellow("◷")} ${who} · ${clean(t.title)} ${dim(`· annulable jusqu'à ${fmt.day(t.cancellableUntil!)} ${fmt.hour(t.cancellableUntil!)}`)}`);
    lines.push(`    ${dim("→")} narthex annuler ${t.id}`);
  }
  return lines.length ? `${bold("Pour toi")}\n${lines.join("\n")}` : "";
}

export function fil(s: CompanyState, status: EngineStatus, limit = 15): string {
  const view = filView(s, status.now, limit);
  const parts = [header(s, status), rule()];
  const you = forYou(s, status.now);
  if (you) parts.push(you, rule());
  parts.push(pilot(s, status, view.pilot), "");
  if (status.runtime === "none") parts.push(`${violet("!")} L'équipe attend ta clé pour travailler : ${bold("narthex config cle")}`, "");
  if (view.items.length === 0) parts.push(dim("Le Fil est vide pour l'instant. Chaque travail terminé par l'équipe arrivera ici, avec ses sources."));
  for (const item of [...view.items].reverse()) parts.push(publication(s, item, status.now));
  return parts.join("\n");
}

function pilot(s: CompanyState, status: EngineStatus, p: ReturnType<typeof filView>["pilot"]): string {
  const waiting = status.runtime === "none" || s.company?.paused;
  const next = p.next ? `${p.next.title}${s.agents[p.next.agentId] ? ` (${s.agents[p.next.agentId]!.name})` : ""}` : undefined;
  if (waiting) return `${yellow("●")} ${s.company?.paused ? "L'équipe est en pause" : "L'équipe attend ta clé"}${next ? dim(` · première mission prête : ${clean(next)}`) : ""}`;
  const running = p.running === 0 ? "aucune mission en cours" : `${p.running} mission${p.running > 1 ? "s" : ""} en cours`;
  return `${green("●")} Ton entreprise tourne toute seule ${dim(`· ${running}${next ? ` · prochaine action : ${clean(next)}, ${fmt.relative(p.next!.at, status.now)}` : ""}`)}`;
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
  const cancel = t && t.status === "planned" && t.kind === "external" && (t.cancellableUntil ?? 0) > now ? `  ${yellow("◷")} part ${fmt.relative(t.cancellableUntil!, now)} ${dim(`· narthex annuler ${t.id}`)}\n` : "";
  return `${block.trimEnd()}\n${meta.length ? `  ${dim(meta.join("   "))}\n` : ""}${cancel}`;
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
    const stuck = o.status === "open" && o.stuck ? ` ${red("· bloquée")} ${dim(`narthex reessayer ${o.id}`)}` : "";
    out.push(`${o.status === "done" ? dim("✓") : "○"} ${o.status === "done" ? dim(o.title) : o.title} ${dim("·")} ${owner}${due}${stuck}`);
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

/** The Journal: every action, with who did it, in the same sentences as the app. */
export function journal(s: CompanyState, events: StoredEvent[], last = Infinity): string {
  const entries = journalEntries(s, events).slice(0, last === Infinity ? undefined : last).reverse();
  const lines = entries.map((e) => {
    const when = dim(`${fmt.day(e.at)} ${fmt.hour(e.at)}`.padEnd(18));
    const text = e.kind === "problem" ? red(clean(e.text)) : clean(e.text);
    return `${when} ${text}${e.detail && e.kind === "problem" ? dim(` · ${clean(e.detail)}`) : ""}`;
  });
  return [bold("Journal"), ...lines].join("\n");
}

export function recrutementsView(s: CompanyState): string {
  const r = recruitments(s);
  const out = [bold("Recrutements prévus")];
  if (r.planned.length === 0) out.push(dim("Toute l'équipe prévue est là."));
  for (const p of r.planned) out.push(`  ○ ${p.role.defaultName} · ${p.role.title} ${dim(`· ${p.when}${p.why ? ` · ${clean(p.why)}` : ""}`)}`);
  out.push("", bold("Arrivés"));
  for (const a of r.arrived) out.push(`  ● ${a.agent.name} · ${a.title} ${dim(`· ${fmt.day(a.agent.hiredAt)}`)}`);
  return out.join("\n");
}

export function agentView(s: CompanyState, agentId: string, now: number): string {
  const sheet = agentSheet(s, agentId, now);
  const h = sheet.stats.hoursThisWeek;
  const out = [
    `${bold(sheet.agent.name)} ${dim(`· ${sheet.title} · arrivé le ${fmt.day(sheet.agent.hiredAt)}`)}`,
    dim(`${h < 1 ? `${Math.round(h * 60)} min` : `${Math.round(h)} h`} cette semaine · ${sheet.stats.xp} XP · ${sheet.stats.done} terminées · ${sheet.stats.failed} pas abouties`),
    "",
    bold("En ce moment"),
    sheet.current ? `  ● ${clean(sheet.current.title)}` : dim("  Au repos."),
    "",
    bold("Ensuite"),
    ...(sheet.next.length ? sheet.next.map((t) => `  ○ ${clean(t.title)} ${dim(`· ${t.scheduledAt <= now ? "dès que possible" : fmt.relative(t.scheduledAt, now)}`)}`) : [dim("  Rien de prévu.")]),
    "",
    bold("Terminées"),
    ...(sheet.finished.length ? sheet.finished.map((f) => `  ✓ ${clean(f.task.title)}${f.deliverableId ? dim(` · narthex livrable ${f.deliverableId}`) : ""}`) : [dim("  Pas encore.")]),
  ];
  return out.join("\n");
}

/** Entreprise: the overview, or one page of a section, from the team's real work. */
export function entreprise(s: CompanyState, now: number, section?: string, page?: string): string {
  if (!section || section === "vue") {
    const o = overview(s, now);
    const icon = { done: green("✓"), you: violet("!"), team: "•", later: dim("○") } as const;
    return [
      `${bold(clean(o.title))} ${dim(`· ${o.stage}`)}`,
      dim(clean(o.subtitle)),
      "",
      bold("Où en est ta société"),
      ...o.milestones.map((m) => `  ${icon[m.state]} ${m.state === "later" ? dim(m.title) : m.title} ${dim(`· ${m.who}${m.at ? ` · ${fmt.day(m.at)}` : ""}`)}`),
      "",
      dim("Sections : finances, ventes, marketing, juridique (narthex entreprise <section> [page])"),
    ].join("\n");
  }
  const spec = ENTERPRISE.find((x) => x.section.toLowerCase().startsWith(section.toLowerCase()));
  if (!spec || spec.pages.length === 0) throw new Error(`Section inconnue : ${section}. Choix : finances, ventes, marketing, juridique.`);
  const p = page ? spec.pages.find((x) => x.page.toLowerCase().startsWith(page.toLowerCase())) : spec.pages[0];
  if (!p) throw new Error(`Page inconnue : ${page}. Choix : ${spec.pages.map((x) => x.page).join(", ")}.`);
  const v = pageView(s, spec.section, p.page, now);
  const out = [bold(`${spec.section} · ${p.page}`), dim(`Pages : ${spec.pages.map((x) => x.page).join(", ")}`), ""];
  for (const t of v.tasks) out.push(`  ○ ${clean(t.title)} ${dim(`· ${s.agents[t.agentId]?.name ?? ""}`)}`);
  for (const d of v.deliverables) out.push(`  ${violet("↳")} ${clean(d.title)} ${dim(`· ${clean(d.summary)} · narthex livrable ${d.id}`)}`);
  if (v.empty) out.push(dim(`  ${v.empty}`));
  return out.join("\n");
}

export function depense(s: CompanyState, events: StoredEvent[]): string {
  const b = spendBreakdown(s, events);
  return [
    `${bold("Dépense IA")} ${dim(`· ${fmt.dollars(b.total)} au total · plafond ${fmt.dollars(s.settings.dailyBudgetCredits)} par jour`)}`,
    ...b.byAgent.map((a) => `  ${a.name.padEnd(10)} ${fmt.dollars(a.credits)}`),
    ...(b.byDay.length ? ["", dim("Par jour :"), ...b.byDay.filter((d) => d.credits > 0).map((d) => `  ${fmt.day(d.day).padEnd(14)} ${fmt.dollars(d.credits)}`)] : []),
  ].join("\n");
}

export function tableaux(s: CompanyState): string {
  const t = tablesOf(s);
  if (t.length === 0) return dim("Pas encore de tableau.");
  return t
    .map((x) => [bold(clean(x.deliverable.title)), dim(x.header.map(clean).join(" | ")), ...x.rows.map((r) => r.map(clean).join(" | "))].join("\n"))
    .join("\n\n");
}
