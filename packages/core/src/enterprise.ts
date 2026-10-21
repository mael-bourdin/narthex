import { dayKey } from "./format.ts";
import type { StoredEvent } from "./events.ts";
import { OBLIGATIONS } from "./obligations.ts";
import { staffingOf, stageIndex } from "./policy.ts";
import { role } from "./roles.ts";
import { forFounder } from "./views.ts";
import type { Agent, CompanyState, Deliverable, Obligation, RoleId, Stage, Task, Timestamp } from "./types.ts";

/**
 * The Entreprise tab (Figma section 5). There is no invented ledger here: each page gathers the team's
 * real deliverables, missions and duties for its domain, and says who will fill it when it is still empty.
 */

export interface PageSpec {
  page: string;
  owners: RoleId[];
  /** Keywords matched against task titles; tags matched exactly. */
  keywords?: RegExp;
  tags?: string[];
  /** Every deliverable of the owners belongs here (e.g. Juridique · Documents). */
  allOfOwners?: boolean;
}

export interface SectionSpec {
  section: string;
  pages: PageSpec[];
}

export const ENTERPRISE: readonly SectionSpec[] = [
  // Keywords match English titles (agents write English) and French ones (older logs).
  { section: "Overview", pages: [] },
  { section: "Data", pages: [] },
  {
    section: "Finances",
    pages: [
      { page: "Cash", owners: ["comptable", "cofondateur"], keywords: /trésorerie|banque|compte pro|capital|\bcash\b|\bbank|business account/i },
      { page: "Invoices and quotes", owners: ["comptable"], keywords: /factur|invoic/i },
      { page: "Expenses", owners: ["comptable"], keywords: /dépense|achat|abonnement|devis|expense|purchase|subscription|\bquotes?\b/i },
      { page: "Forecast", owners: ["comptable", "cofondateur"], keywords: /prévisionnel|budget|chiffre d'affaires|rentab|forecast|revenue|profitab/i, tags: ["forecast"] },
      { page: "Accounting and VAT", owners: ["comptable"], keywords: /tva|compta|cfe|urssaf|impôt|\bvat\b|accounting|bookkeeping|\btax/i, tags: ["C5-cfe", "B6-facturation-electronique"] },
    ],
  },
  {
    section: "Sales",
    pages: [
      { page: "Prospects", owners: ["prospection"], keywords: /prospect/i, tags: ["prospects", "outreach"] },
      { page: "Customers", owners: ["prospection", "support"], keywords: /client|customer/i },
      { page: "Orders", owners: ["prospection"], keywords: /commande|vente|\border|\bsales?\b/i, tags: ["first-sale"] },
      { page: "Support", owners: ["support"], keywords: /support|réclamation|réponse type|complaint|canned repl|\bfaq\b/i },
    ],
  },
  {
    section: "Marketing",
    pages: [
      { page: "Calendar", owners: ["redaction", "video"], keywords: /calendrier|planning|lancement|calendar|schedule|\blaunch/i },
      { page: "Social media", owners: ["redaction"], keywords: /linkedin|instagram|tiktok|réseau|post\b|social/i },
      { page: "Visuals and videos", owners: ["video", "redaction"], keywords: /visuel|logo|photo|vidéo|image|visual|video/i, tags: ["video-script"] },
      { page: "Website", owners: ["redaction"], keywords: /site|page d'accueil|boutique en ligne|home page|online shop|landing page/i, tags: ["site-home"] },
      { page: "Campaigns", owners: ["redaction", "prospection"], keywords: /campagne|newsletter|e-?mailing|publicité|campaign|advert|\bads?\b/i },
    ],
  },
  {
    section: "Legal",
    pages: [
      { page: "Documents", owners: ["juridique"], allOfOwners: true },
      { page: "Brand", owners: ["juridique"], keywords: /nom|marque|inpi|logo|domaine|\bname\b|brand|trademark|domain/i, tags: ["A1-nom"] },
      { page: "Personal data", owners: ["juridique"], keywords: /rgpd|données|cnil|confidentialité|cookies|gdpr|personal data|privacy/i, tags: ["C10-rgpd", "B8-mentions-legales"] },
    ],
  },
  { section: "Obligations", pages: [] },
  { section: "Tables", pages: [] },
];

const SHE: RoleId[] = ["cofondateur", "recherche", "redaction", "technique"];
export const ARRIVES: Record<Stage, string> = {
  idea: "from the idea",
  research: "during the study",
  creation: "when the company is set up",
  launch: "at the launch",
  operating: "once the company is up and running",
};

export interface PageView {
  spec: PageSpec;
  owners: Agent[];
  deliverables: Deliverable[];
  tasks: Task[];
  obligations: Obligation[];
  /** When nothing is there yet: who will fill it, and when. */
  empty?: string;
}

function matches(spec: PageSpec, task: Task | undefined, agent: Agent | undefined): boolean {
  if (!task) return false;
  if (spec.tags?.includes(task.tag ?? "")) return true;
  if (spec.allOfOwners && agent && spec.owners.includes(agent.role)) return true;
  return !!spec.keywords && spec.keywords.test(task.title);
}

export function pageView(state: CompanyState, section: string, page: string, now: Timestamp): PageView {
  const spec = ENTERPRISE.find((s) => s.section === section)?.pages.find((p) => p.page === page);
  if (!spec) throw new Error(`Unknown page: ${section} · ${page}`);
  const agents = Object.values(state.agents);
  const owners = agents.filter((a) => spec.owners.includes(a.role));
  const deliverables = Object.values(state.deliverables)
    .filter((d) => matches(spec, state.tasks[d.taskId], state.agents[d.agentId]))
    .sort((a, b) => b.createdAt - a.createdAt);
  const tasks = Object.values(state.tasks)
    .filter((t) => (t.status === "planned" || t.status === "running") && matches(spec, t, state.agents[t.agentId]))
    .sort((a, b) => a.scheduledAt - b.scheduledAt);
  const obligations = Object.values(state.obligations).filter((o) => spec.tags?.includes(o.code) || (spec.keywords?.test(o.title) && o.owner !== "founder"));
  const view: PageView = { spec, owners, deliverables, tasks, obligations };
  if (deliverables.length === 0 && tasks.length === 0) view.empty = emptyLine(state, spec, owners, now);
  return view;
}

function emptyLine(state: CompanyState, spec: PageSpec, owners: Agent[], _now: Timestamp): string {
  if (owners[0]) {
    const a = owners[0];
    return `${a.name} hasn't delivered anything here yet: it will come with ${SHE.includes(a.role) ? "her" : "his"} next missions.`;
  }
  const planned = staffingOf(state).find((e) => spec.owners.includes(e.role));
  const r = role(planned?.role ?? spec.owners[0]!);
  const she = SHE.includes(r.id);
  return planned
    ? `${r.defaultName} (${r.title}) will take care of it: ${she ? "she" : "he"} arrives ${ARRIVES[planned.at]}.`
    : `${r.defaultName} (${r.title}) will take care of it when Margaux brings ${she ? "her" : "him"} in.`;
}

// ---------- Overview ----------

export interface Milestone {
  title: string;
  who: string;
  state: "done" | "you" | "team" | "later";
  at?: Timestamp;
}

export interface Overview {
  title: string;
  subtitle: string;
  stage: string;
  milestones: Milestone[];
  deadlines: { title: string; who: string; due: Timestamp }[];
}

export const STAGE_LABEL: Record<Stage, string> = { idea: "Idea", research: "Under study", creation: "Being set up", launch: "Launching", operating: "Up and running" };

export function overview(state: CompanyState, now: Timestamp): Overview {
  const c = state.company!;
  const tasks = Object.values(state.tasks);
  const ownerName = (o: Obligation) => (o.owner === "founder" ? "You · required by law" : (Object.values(state.agents).find((a) => a.role === o.owner)?.name ?? role(o.owner).defaultName));
  const study = tasks.find((t) => t.tag === "market-study");
  const milestones: Milestone[] = [
    { title: "Idea written down", who: c.founder.name, state: "done", at: c.foundedAt },
    {
      title: "Market study",
      who: study ? (state.agents[study.agentId]?.name ?? "") : "Coming up",
      state: study?.status === "done" ? "done" : study ? "team" : "later",
      ...(study?.endedAt ? { at: study.endedAt } : {}),
    },
  ];
  const opened = Object.values(state.obligations).sort(
    (a, b) => Number(a.status !== "done") - Number(b.status !== "done") || (a.doneAt ?? a.due ?? 0) - (b.doneAt ?? b.due ?? 0),
  );
  for (const o of opened) {
    milestones.push({
      title: o.title,
      who: ownerName(o),
      state: o.status === "done" ? "done" : o.owner === "founder" ? "you" : "team",
      ...(o.doneAt ? { at: o.doneAt } : o.due ? { at: o.due } : {}),
    });
  }
  const openedCodes = new Set(opened.map((o) => o.code));
  for (const rule of OBLIGATIONS.filter((r) => !openedCodes.has(r.code) && stageIndex(r.opensAt) >= stageIndex(c.stage)).slice(0, 3)) {
    milestones.push({ title: rule.title, who: rule.owner === "founder" ? "You" : role(rule.owner).defaultName, state: "later" });
  }
  const deadlines = Object.values(state.obligations)
    .filter((o) => o.status === "open" && o.due)
    .sort((a, b) => a.due! - b.due!)
    .map((o) => ({ title: o.title, who: ownerName(o), due: o.due! }));
  const idea = c.idea.length > 48 ? `${c.idea.slice(0, 47).trimEnd()}…` : c.idea;
  return {
    title: c.name,
    subtitle: `${c.legalForm ?? "Legal form to choose"} · ${idea} · run by ${c.founder.name}`,
    stage: STAGE_LABEL[c.stage],
    milestones,
    deadlines,
  };
}

/** Founder steps still waiting, for the overview's header line. */
export function waitingOnFounder(state: CompanyState): number {
  return forFounder(state).length;
}

// ---------- AI spend ----------

export interface SpendBreakdown {
  total: number;
  byAgent: { agentId: string; name: string; role: RoleId; credits: number }[];
  byDay: { day: Timestamp; credits: number }[];
}

/** The AI spend from the real usage log, by teammate and by day (14 last days). */
export function spendBreakdown(state: CompanyState, events: readonly StoredEvent[], days = 14): SpendBreakdown {
  const byAgent = new Map<string, number>();
  // Paris days, like the daily budget, whatever the machine's time zone.
  const byDay = new Map<string, number>();
  let total = 0;
  for (const e of events) {
    if (e.type !== "usage.recorded") continue;
    total += e.credits;
    byAgent.set(e.agentId, (byAgent.get(e.agentId) ?? 0) + e.credits);
    const key = dayKey(e.at ?? e.ts);
    byDay.set(key, (byDay.get(key) ?? 0) + e.credits);
  }
  const last = [...byDay.keys()].sort().at(-1);
  const series: { day: Timestamp; credits: number }[] = [];
  if (last) {
    const [y, m, d] = last.split("-").map(Number) as [number, number, number];
    for (let i = days - 1; i >= 0; i--) {
      // Noon UTC always falls on the same date in Paris.
      const day = Date.UTC(y, m - 1, d - i, 12);
      series.push({ day, credits: byDay.get(dayKey(day)) ?? 0 });
    }
  }
  return {
    total,
    byAgent: [...byAgent.entries()]
      .map(([agentId, credits]) => ({ agentId, name: state.agents[agentId]?.name ?? "?", role: state.agents[agentId]?.role ?? "cofondateur", credits }))
      .sort((a, b) => b.credits - a.credits),
    byDay: series,
  };
}

// ---------- Tables ----------

export interface TableOf {
  deliverable: Deliverable;
  header: string[];
  rows: string[][];
}

/** The Markdown tables of one text, in order (header, then rows; bold marks dropped). */
export function markdownTables(body: string): { header: string[]; rows: string[][] }[] {
  const out: { header: string[]; rows: string[][] }[] = [];
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));
  const lines = body.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i]!.trim().startsWith("|") || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) continue;
    const header = cells(lines[i]!);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j]!.trim().startsWith("|"); j++) rows.push(cells(lines[j]!));
    out.push({ header, rows });
    i = j;
  }
  return out;
}

/** Every Markdown table the team produced, newest first. */
export function tablesOf(state: CompanyState): TableOf[] {
  return Object.values(state.deliverables)
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((deliverable) => markdownTables(deliverable.body).map((t) => ({ deliverable, ...t })));
}
