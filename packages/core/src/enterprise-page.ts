import { ARRIVES, markdownTables, pageView, tablesOf, type PageView } from "./enterprise.ts";
import type { StoredEvent } from "./events.ts";
import { day, dayKey, dollars, euros, relative } from "./format.ts";
import { staffingOf } from "./policy.ts";
import { role } from "./roles.ts";
import type { CompanyState, Id, RoleId, Timestamp } from "./types.ts";

/**
 * The frame every Entreprise page shares in Figma (section 5): a status line (« pilote »), the figures card
 * (« Les chiffres »), the rules the team follows there and who takes care of it. Real data only: when the
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
  /** Period the figures cover, e.g. « octobre » or « depuis le début ». */
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
    return { role: r, name: def.defaultName, duty: planned ? `Arrive ${ARRIVES[planned.at]}` : "Margaux le fera venir si besoin", here: false };
  });
}

function rulesOf(state: CompanyState, roles: readonly RoleId[]): PageFrame["rules"] {
  for (const r of roles) {
    const items = role(r).guardrails.filter((g) => !COMMON.has(g)).map(ruleOf);
    if (items.length === 0) continue;
    const name = Object.values(state.agents).find((a) => a.role === r)?.name ?? role(r).defaultName;
    return { title: `Règles que ${name} suit`, aside: "garde-fous", items };
  }
  return undefined;
}

function pilotOf(state: CompanyState, v: PageView, now: Timestamp): PageFrame["pilot"] {
  const name = (id: Id) => state.agents[id]?.name ?? "L'équipe";
  const running = v.tasks.find((t) => t.status === "running");
  if (running) return { title: `${name(running.agentId)} est au travail ici`, detail: `${running.title} · commencé ${relative(running.startedAt ?? running.scheduledAt, now)}`, agentId: running.agentId };
  const next = v.tasks[0];
  if (next) {
    const leaving = next.kind === "external" && (next.cancellableUntil ?? 0) > now;
    return leaving
      ? { title: `${name(next.agentId)} : une action part ${relative(next.cancellableUntil!, now)}`, detail: `${next.title} · tu peux l'annuler d'ici là`, agentId: next.agentId }
      : { title: `${name(next.agentId)} a prévu la suite`, detail: `${next.title} · ${next.scheduledAt <= now ? "dès que possible" : relative(next.scheduledAt, now)}`, agentId: next.agentId };
  }
  const last = v.deliverables[0];
  if (last) return { title: `${name(last.agentId)} tient cette page à jour`, detail: `${plural(v.deliverables.length, "livrable")} · dernier ${relative(last.createdAt, now)}`, agentId: last.agentId };
  const owner = v.owners[0];
  return { title: "Rien ici pour l'instant", detail: v.empty ?? "", ...(owner ? { agentId: owner.id } : {}) };
}

/** The frame of a domain page (Finances, Ventes, Marketing, Juridique). */
export function pageFrame(state: CompanyState, events: readonly StoredEvent[], section: string, page: string, now: Timestamp): PageFrame {
  const v = pageView(state, section, page, now);
  const m = money(state, events, now);
  const month = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "Europe/Paris" }).format(now);
  const owner = v.owners[0]?.name ?? role(v.spec.owners[0]!).defaultName;
  const who = whoOf(state, v.spec.owners);
  const rules = rulesOf(state, v.spec.owners);
  let pilot = pilotOf(state, v, now);
  const next = v.tasks[0];
  const generic: Figure[] = [
    { label: "Livrables", value: String(v.deliverables.length), hint: v.deliverables[0] ? `Dernier ${relative(v.deliverables[0].createdAt, now)}` : `${owner} n'a encore rien livré ici` },
    { label: "En cours et prévu", value: String(v.tasks.length), hint: next ? `${state.agents[next.agentId]?.name ?? ""} · ${next.status === "running" ? "en cours" : next.scheduledAt <= now ? "dès que possible" : relative(next.scheduledAt, now)}` : "Rien de prévu pour l'instant" },
    { label: "Sources citées", value: String(v.deliverables.reduce((n, d) => n + d.sources.length, 0)), hint: "Dans les livrables de cette page" },
  ];
  const salesHint = m.sales ? `${plural(m.sales, "vente enregistrée", "ventes enregistrées")} par toi` : "Aucune vente enregistrée";
  let period = "depuis le début";
  let figures = generic;
  let frameRules = rules;

  if (section === "Finances" && page === "Trésorerie") {
    period = month;
    figures = [
      { label: "Solde", value: "—", hint: "Ta banque n'est pas encore reliée à Narthex" },
      { label: "Entrées", value: euros(m.revenue), hint: salesHint },
      { label: "Dépense IA", value: dollars(m.spentMonth), hint: "Ce mois-ci, sur ton compte Anthropic" },
    ];
  } else if (section === "Finances" && page === "Factures et devis") {
    figures = [
      { label: "Chiffre d'affaires", value: euros(m.revenue), hint: salesHint },
      { label: "Factures émises", value: "—", hint: "Pas encore d'émission depuis Narthex" },
      generic[1]!,
    ];
  } else if (section === "Finances" && page === "Dépenses") {
    period = month;
    figures = [
      { label: "Dépense IA", value: dollars(m.spentMonth), hint: "Ce mois-ci, sur ton compte Anthropic" },
      { label: "Aujourd'hui", value: dollars(m.spentToday), hint: `Sur un plafond de ${dollars(state.settings.dailyBudgetCredits)} par jour` },
      { label: "Depuis le début", value: dollars(m.spent), hint: "Toute l'équipe" },
    ];
    pilot = { title: "L'équipe ne dépense que de l'IA pour l'instant", detail: `Aucun achat sans toi · plafond de ${dollars(state.settings.dailyBudgetCredits)} par jour, réglable dans Réglages`, ...(pilot.agentId ? { agentId: pilot.agentId } : {}) };
    frameRules = {
      title: "Règles de dépense",
      aside: "Réglages",
      items: [
        { text: `${dollars(state.settings.dailyBudgetCredits)} de dépense IA par jour`, hint: "Au-delà, plus rien ne démarre ce jour-là" },
        { text: `${dollars(state.settings.taskBudgetCredits)} par mission`, hint: "Au-delà, la mission s'arrête et l'agent le dit" },
        { text: `${state.settings.cancelWindowHours} h pour annuler`, hint: "Avant chaque action vers l'extérieur" },
      ],
    };
  } else if (section === "Ventes" && page === "Prospects") {
    const list = v.deliverables.map((d) => ({ d, t: markdownTables(d.body)[0] })).find((x) => x.t && x.t.rows.length > 0);
    const outgoing = v.tasks.filter((t) => t.kind === "external");
    figures = [
      list
        ? { label: "Pistes listées", value: String(list.t!.rows.length), hint: `Dans la dernière liste de ${state.agents[list.d.agentId]?.name ?? owner}` }
        : { label: "Pistes listées", value: "—", hint: `${owner} n'a pas encore livré de liste` },
      { label: "Envois prévus", value: String(outgoing.length), hint: outgoing[0] ? `Le premier ${relative(outgoing[0].scheduledAt, now)}, annulable` : "Chaque envoi attend le délai d'annulation" },
      { label: "Ventes", value: String(m.sales), hint: m.sales ? "Enregistrées par toi" : "La première fait passer l'entreprise en activité" },
    ];
  } else if (section === "Ventes" && page === "Commandes") {
    figures = [
      { label: "Ventes", value: String(m.sales), hint: m.sales ? "Enregistrées par toi" : "La première fait passer l'entreprise en activité" },
      { label: "Chiffre d'affaires", value: euros(m.revenue), hint: "Montants que tu as indiqués" },
      { label: "Dernière vente", value: m.lastSale ? day(m.lastSale) : "—", hint: m.lastSale ? relative(m.lastSale, now) : "Pas encore de vente" },
    ];
    if (m.sales) pilot = { title: plural(m.sales, "vente enregistrée", "ventes enregistrées"), detail: `Dernière ${relative(m.lastSale!, now)} · ${euros(m.revenue)} au total`, ...(pilot.agentId ? { agentId: pilot.agentId } : {}) };
  } else if (section === "Juridique" && page === "Documents") {
    const open = Object.values(state.obligations).filter((o) => o.status === "open");
    const yours = open.filter((o) => o.owner === "founder");
    figures = [
      { label: "Documents", value: String(v.deliverables.length), hint: `Rédigés ou vérifiés par ${owner}` },
      { label: "Pour toi", value: String(yours.length), hint: yours[0] ? yours[0].title : "Rien ne t'attend" },
      { label: "Obligations suivies", value: String(open.length - yours.length), hint: `Par ${owner} et l'équipe` },
    ];
  }
  return { pilot, period, figures, ...(frameRules ? { rules: frameRules } : {}), who };
}

/** Entreprise · Obligations: what the law asks, split between the founder and the team. */
export function obligationsFrame(state: CompanyState, now: Timestamp): PageFrame {
  const all = Object.values(state.obligations);
  const open = all.filter((o) => o.status === "open");
  const yours = open.filter((o) => o.owner === "founder");
  const late = open.filter((o) => o.due !== undefined && o.due < now);
  const company = state.company?.name ?? "ta société";
  const legal = whoOf(state, ["juridique", "cofondateur"]);
  return {
    pilot:
      all.length === 0
        ? { title: "Aucune obligation ouverte", detail: `${legal[0]!.name} les ouvre quand l'étape de l'entreprise les rend nécessaires, avec la règle et sa source`, ...(legal[0]!.agentId ? { agentId: legal[0]!.agentId } : {}) }
        : {
            title: `L'équipe suit chaque obligation de ${company}`,
            detail: `${yours.length === 0 ? "Aucune ne te concerne" : `${yours.length} te concerne${yours.length > 1 ? "nt" : ""}`} · ${late.length ? `${late.length} en retard` : "aucune en retard"}`,
            ...(legal.find((w) => w.agentId)?.agentId ? { agentId: legal.find((w) => w.agentId)!.agentId! } : {}),
          },
    period: "en ce moment",
    figures: [
      { label: "Pour toi", value: String(yours.length), hint: yours.length ? yours.map((o) => lowerFirst(o.title)).slice(0, 2).join(", ").replace(/^./, (c) => c.toUpperCase()) : "Rien ne t'attend" },
      { label: "Pour l'équipe", value: String(open.length - yours.length), hint: `Suivies par ${legal.filter((w) => w.here).map((w) => w.name).join(" et ") || "l'équipe"}` },
      { label: "En retard", value: String(late.length), hint: late[0] ? late[0].title : `Faites : ${all.length - open.length}` },
    ],
    who: legal,
  };
}

/** Entreprise · Tableaux: every table the team produced. */
export function tablesFrame(state: CompanyState): PageFrame {
  const tables = tablesOf(state);
  const from = new Set(tables.map((t) => t.deliverable.id));
  const authors = [...new Set(tables.map((t) => t.deliverable.agentId))].map((id) => state.agents[id]).filter((a) => a !== undefined);
  return {
    pilot: tables.length
      ? { title: `${plural(tables.length, "tableau", "tableaux")} tirés de ${plural(from.size, "livrable")}`, detail: "Prospects, concurrents, prix, échéances : chaque tableau d'un livrable arrive ici" }
      : { title: "Pas encore de tableau", detail: "Chaque tableau d'un livrable (prospects, concurrents, prix, échéances) sera rassemblé ici" },
    period: "depuis le début",
    figures: [
      { label: "Tableaux", value: String(tables.length), hint: `Dans ${plural(from.size, "livrable")}` },
      { label: "Lignes", value: String(tables.reduce((n, t) => n + t.rows.length, 0)), hint: "Toutes sources confondues" },
      { label: "Auteurs", value: String(authors.length), hint: authors.map((a) => a.name).join(", ") || "Personne encore" },
    ],
    who: authors.map((a) => ({ role: a.role, name: a.name, duty: role(a.role).duty, agentId: a.id, here: true })),
  };
}
