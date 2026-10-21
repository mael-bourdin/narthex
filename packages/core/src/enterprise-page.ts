import { ARRIVES, markdownTables, pageView, tablesOf, type PageView } from "./enterprise.ts";
import type { StoredEvent } from "./events.ts";
import { day, dayKey, dollars, euros, relative } from "./format.ts";
import { staffingOf } from "./policy.ts";
import { role } from "./roles.ts";
import type { CompanyState, Id, RoleId, Timestamp } from "./types.ts";

/**
 * The frame every Entreprise page shares in Figma (section 5): a status line ("pilot"), the figures card
 * ("The numbers"), the rules the team follows there and who takes care of it. Real data only: when the
 * state has no such number, the figure says so instead of inventing one.
 */

export interface Figure {
  label: string;
  value: string;
  hint: string;
}

export interface Rule {
  text: string;
  hint?: string;
}

export interface Who {
  role: RoleId;
  name: string;
  duty: string;
  agentId?: Id;
  /** False while the teammate has not joined yet: `duty` then says when they arrive. */
  here: boolean;
}

export interface PageFrame {
  pilot: { title: string; detail: string; agentId?: Id };
  /** Period the figures cover, e.g. "October" or "since the start". */
  period: string;
  figures: Figure[];
  rules?: { title: string; aside: string; items: Rule[] };
  who: Who[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const COMMON = new Set(role("cofondateur").guardrails);

/** A guardrail as a short rule: its first clause, and the law it cites when it cites one. */
export function ruleOf(guardrail: string): Rule {
  const law = /\(([^)]+)\)/.exec(guardrail)?.[1];
  const text = guardrail.split(/ ?: /)[0]!.replace(/\s*\([^)]*\)/g, "").replace(/\.$/, "").trim();
  return law ? { text, hint: capitalize(law) } : { text };
}

function money(state: CompanyState, events: readonly StoredEvent[], now: Timestamp) {
  const sales = state.sales ?? [];
  const month = dayKey(now).slice(0, 7);
  let spentMonth = 0;
  let spent = 0;
  for (const e of events) {
    if (e.type !== "usage.recorded") continue;
    spent += e.credits;
    if (dayKey(e.at ?? e.ts).slice(0, 7) === month) spentMonth += e.credits;
  }
  return {
    sales: sales.length,
    revenue: sales.reduce((n, s) => n + (s.amountCents ?? 0), 0),
    lastSale: sales.at(-1)?.at,
    spent,
    spentMonth,
    spentToday: state.usage.byDay[dayKey(now)] ?? 0,
  };
}

function whoOf(state: CompanyState, roles: readonly RoleId[]): Who[] {
  const agents = Object.values(state.agents);
  const plan = staffingOf(state);
  return roles.map((r) => {
    const agent = agents.find((a) => a.role === r);
    const def = role(r);
    if (agent) return { role: r, name: agent.name, duty: def.duty, agentId: agent.id, here: true };
    const planned = plan.find((e) => e.role === r);
    return { role: r, name: def.defaultName, duty: planned ? `Arrives ${ARRIVES[planned.at]}` : "Margaux will bring them in if needed", here: false };
  });
}

function rulesOf(state: CompanyState, roles: readonly RoleId[]): PageFrame["rules"] {
  for (const r of roles) {
    const items = role(r).guardrails.filter((g) => !COMMON.has(g)).map(ruleOf);
    if (items.length === 0) continue;
    const name = Object.values(state.agents).find((a) => a.role === r)?.name ?? role(r).defaultName;
    return { title: `Rules ${name} follows`, aside: "guardrails", items };
  }
  return undefined;
}

function pilotOf(state: CompanyState, v: PageView, now: Timestamp): PageFrame["pilot"] {
  const name = (id: Id) => state.agents[id]?.name ?? "The team";
  const running = v.tasks.find((t) => t.status === "running");
  if (running) return { title: `${name(running.agentId)} is working here`, detail: `${running.title} · started ${relative(running.startedAt ?? running.scheduledAt, now)}`, agentId: running.agentId };
  const next = v.tasks[0];
  if (next) {
    const leaving = next.kind === "external" && (next.cancellableUntil ?? 0) > now;
    return leaving
      ? { title: `${name(next.agentId)}: an action goes out ${relative(next.cancellableUntil!, now)}`, detail: `${next.title} · you can cancel it until then`, agentId: next.agentId }
      : { title: `${name(next.agentId)} has planned what's next`, detail: `${next.title} · ${next.scheduledAt <= now ? "as soon as possible" : relative(next.scheduledAt, now)}`, agentId: next.agentId };
  }
  const last = v.deliverables[0];
  if (last) return { title: `${name(last.agentId)} keeps this page up to date`, detail: `${plural(v.deliverables.length, "deliverable")} · latest ${relative(last.createdAt, now)}`, agentId: last.agentId };
  const owner = v.owners[0];
  return { title: "Nothing here yet", detail: v.empty ?? "", ...(owner ? { agentId: owner.id } : {}) };
}

/** The frame of a domain page (Finances, Sales, Marketing, Legal). */
export function pageFrame(state: CompanyState, events: readonly StoredEvent[], section: string, page: string, now: Timestamp): PageFrame {
  const v = pageView(state, section, page, now);
  const m = money(state, events, now);
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "Europe/Paris" }).format(now);
  const owner = v.owners[0]?.name ?? role(v.spec.owners[0]!).defaultName;
  const who = whoOf(state, v.spec.owners);
  const rules = rulesOf(state, v.spec.owners);
  let pilot = pilotOf(state, v, now);
  const next = v.tasks[0];
  const generic: Figure[] = [
    { label: "Deliverables", value: String(v.deliverables.length), hint: v.deliverables[0] ? `Latest ${relative(v.deliverables[0].createdAt, now)}` : `${owner} hasn't delivered anything here yet` },
    { label: "In progress and planned", value: String(v.tasks.length), hint: next ? `${state.agents[next.agentId]?.name ?? ""} · ${next.status === "running" ? "in progress" : next.scheduledAt <= now ? "as soon as possible" : relative(next.scheduledAt, now)}` : "Nothing planned yet" },
    { label: "Sources cited", value: String(v.deliverables.reduce((n, d) => n + d.sources.length, 0)), hint: "In this page's deliverables" },
  ];
  const salesHint = m.sales ? `${plural(m.sales, "sale")} recorded by you` : "No sale recorded yet";
  let period = "since the start";
  let figures = generic;
  let frameRules = rules;

  if (section === "Finances" && page === "Cash") {
    period = month;
    figures = [
      { label: "Balance", value: "—", hint: "Your bank isn't connected to Narthex yet" },
      { label: "Money in", value: euros(m.revenue), hint: salesHint },
      { label: "AI spend", value: dollars(m.spentMonth), hint: "This month, on your Anthropic account" },
    ];
  } else if (section === "Finances" && page === "Invoices and quotes") {
    figures = [
      { label: "Revenue", value: euros(m.revenue), hint: salesHint },
      { label: "Invoices issued", value: "—", hint: "Narthex doesn't issue invoices yet" },
      generic[1]!,
    ];
  } else if (section === "Finances" && page === "Expenses") {
    period = month;
    figures = [
      { label: "AI spend", value: dollars(m.spentMonth), hint: "This month, on your Anthropic account" },
      { label: "Today", value: dollars(m.spentToday), hint: `Out of a cap of ${dollars(state.settings.dailyBudgetCredits)} a day` },
      { label: "Since the start", value: dollars(m.spent), hint: "The whole team" },
    ];
    pilot = { title: "The team only spends on AI for now", detail: `No purchase without you · cap of ${dollars(state.settings.dailyBudgetCredits)} a day, adjustable in Settings`, ...(pilot.agentId ? { agentId: pilot.agentId } : {}) };
    frameRules = {
      title: "Spending rules",
      aside: "Settings",
      items: [
        { text: `${dollars(state.settings.dailyBudgetCredits)} of AI spend a day`, hint: "Beyond that, nothing new starts that day" },
        { text: `${dollars(state.settings.taskBudgetCredits)} per mission`, hint: "Beyond that, the mission stops and the agent says so" },
        { text: `${state.settings.cancelWindowHours} h to cancel`, hint: "Before every action outside the company" },
      ],
    };
  } else if (section === "Sales" && page === "Prospects") {
    const list = v.deliverables.map((d) => ({ d, t: markdownTables(d.body)[0] })).find((x) => x.t && x.t.rows.length > 0);
    const outgoing = v.tasks.filter((t) => t.kind === "external");
    figures = [
      list
        ? { label: "Leads listed", value: String(list.t!.rows.length), hint: `In ${state.agents[list.d.agentId]?.name ?? owner}'s latest list` }
        : { label: "Leads listed", value: "—", hint: `${owner} hasn't delivered a list yet` },
      { label: "Sends planned", value: String(outgoing.length), hint: outgoing[0] ? `The first one ${relative(outgoing[0].scheduledAt, now)}, can be cancelled` : "Every send waits for the cancel window" },
      { label: "Sales", value: String(m.sales), hint: m.sales ? "Recorded by you" : "The first one puts the company in business" },
    ];
  } else if (section === "Sales" && page === "Orders") {
    figures = [
      { label: "Sales", value: String(m.sales), hint: m.sales ? "Recorded by you" : "The first one puts the company in business" },
      { label: "Revenue", value: euros(m.revenue), hint: "Amounts you entered" },
      { label: "Last sale", value: m.lastSale ? day(m.lastSale) : "—", hint: m.lastSale ? relative(m.lastSale, now) : "No sale yet" },
    ];
    if (m.sales) pilot = { title: plural(m.sales, "sale recorded", "sales recorded"), detail: `Latest ${relative(m.lastSale!, now)} · ${euros(m.revenue)} in total`, ...(pilot.agentId ? { agentId: pilot.agentId } : {}) };
  } else if (section === "Legal" && page === "Documents") {
    const open = Object.values(state.obligations).filter((o) => o.status === "open");
    const yours = open.filter((o) => o.owner === "founder");
    figures = [
      { label: "Documents", value: String(v.deliverables.length), hint: `Written or checked by ${owner}` },
      { label: "For you", value: String(yours.length), hint: yours[0] ? yours[0].title : "Nothing is waiting for you" },
      { label: "Obligations tracked", value: String(open.length - yours.length), hint: `By ${owner} and the team` },
    ];
  }
  return { pilot, period, figures, ...(frameRules ? { rules: frameRules } : {}), who };
}

/** Company · Obligations: what the law asks, split between the founder and the team. */
export function obligationsFrame(state: CompanyState, now: Timestamp): PageFrame {
  const all = Object.values(state.obligations);
  const open = all.filter((o) => o.status === "open");
  const yours = open.filter((o) => o.owner === "founder");
  const late = open.filter((o) => o.due !== undefined && o.due < now);
  const company = state.company?.name ?? "your company";
  const legal = whoOf(state, ["juridique", "cofondateur"]);
  return {
    pilot:
      all.length === 0
        ? { title: "No open obligations", detail: `${legal[0]!.name} opens them when the company's stage calls for them, with the rule and its source`, ...(legal[0]!.agentId ? { agentId: legal[0]!.agentId } : {}) }
        : {
            title: `The team tracks every obligation of ${company}`,
            detail: `${yours.length === 0 ? "None of them is yours" : `${yours.length} ${yours.length > 1 ? "are" : "is"} yours`} · ${late.length ? `${late.length} overdue` : "none overdue"}`,
            ...(legal.find((w) => w.agentId)?.agentId ? { agentId: legal.find((w) => w.agentId)!.agentId! } : {}),
          },
    period: "right now",
    figures: [
      { label: "For you", value: String(yours.length), hint: yours.length ? yours.map((o) => lowerFirst(o.title)).slice(0, 2).join(", ").replace(/^./, (c) => c.toUpperCase()) : "Nothing is waiting for you" },
      { label: "For the team", value: String(open.length - yours.length), hint: `Tracked by ${legal.filter((w) => w.here).map((w) => w.name).join(" and ") || "the team"}` },
      { label: "Overdue", value: String(late.length), hint: late[0] ? late[0].title : `Done: ${all.length - open.length}` },
    ],
    who: legal,
  };
}

/** Company · Tables: every table the team produced. */
export function tablesFrame(state: CompanyState): PageFrame {
  const tables = tablesOf(state);
  const from = new Set(tables.map((t) => t.deliverable.id));
  const authors = [...new Set(tables.map((t) => t.deliverable.agentId))].map((id) => state.agents[id]).filter((a) => a !== undefined);
  return {
    pilot: tables.length
      ? { title: `${plural(tables.length, "table")} taken from ${plural(from.size, "deliverable")}`, detail: "Prospects, competitors, prices, deadlines: every table in a deliverable lands here" }
      : { title: "No table yet", detail: "Every table in a deliverable (prospects, competitors, prices, deadlines) will be gathered here" },
    period: "since the start",
    figures: [
      { label: "Tables", value: String(tables.length), hint: `In ${plural(from.size, "deliverable")}` },
      { label: "Rows", value: String(tables.reduce((n, t) => n + t.rows.length, 0)), hint: "All sources together" },
      { label: "Authors", value: String(authors.length), hint: authors.map((a) => a.name).join(", ") || "Nobody yet" },
    ],
    who: authors.map((a) => ({ role: a.role, name: a.name, duty: role(a.role).duty, agentId: a.id, here: true })),
  };
}
