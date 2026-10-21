import { useEffect, useState, type ReactNode } from "react";
import {
  ENTERPRISE,
  filView,
  fmt,
  markdownTables,
  missions,
  obligationsFrame,
  overview,
  pageFrame,
  pageView,
  role,
  spendBreakdown,
  tablesFrame,
  tablesOf,
  type CompanyState,
  type Deliverable,
  type EngineStatus,
  type Mission,
  type Obligation,
  type StoredEvent,
  type Task,
} from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { DeliverableView } from "./Deliverable.tsx";
import { Donnees, DonneesSide } from "./Donnees.tsx";
import { Sign } from "./Fil.tsx";
import { FrameSide, Pilot, Post, TableAttachment, TableIcon } from "./EntrepriseParts.tsx";
import { Clock } from "./icons.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";
import { SectionTabs } from "./SectionTabs.tsx";
import "./entreprise.css";

const SECTIONS = ENTERPRISE.map((s) => s.section);

/** The Entreprise tab (Figma « Narthex — App », section 174:19827), from the team's real work only. */
export function Entreprise({
  state,
  status,
  section,
  page,
  onNavigate,
  onAgent,
  onChange,
}: {
  state: CompanyState;
  status: EngineStatus;
  section: string;
  page?: string;
  onNavigate(section: string, page?: string): void;
  onAgent(id: string): void;
  onChange(): void;
}) {
  const [open, setOpen] = useState<Deliverable>();
  const [acting, setActing] = useState<Mission>();
  const events = useEvents(state.lastSeq);
  const spec = ENTERPRISE.find((s) => s.section === section) ?? ENTERPRISE[0]!;
  const current = spec.pages.length ? (page && spec.pages.some((p) => p.page === page) ? page : spec.pages[0]!.page) : undefined;
  const now = status.now;
  const on = status.runtime !== "none" && !state.company?.paused;
  const onTask = (t: Task) => setActing(taskMission(state, t, now));
  const legalSigns = missions(state, now, status.runtime).filter((m) => m.kind === "legal" || m.kind === "stuck");

  let main: ReactNode = null;
  let side: ReactNode = null;
  if (spec.section === "Vue d'ensemble") {
    main = <Overview state={state} status={status} on={on} onAct={setActing} onAgent={onAgent} />;
    side = <OverviewSide state={state} now={now} events={events} onOpen={setOpen} />;
  } else if (spec.section === "Données") {
    main = <Donnees state={state} status={status} events={events} on={on} onAgent={onAgent} />;
    side = <DonneesSide state={state} status={status} events={events} />;
  } else if (spec.section === "Obligations") {
    const frame = obligationsFrame(state, now);
    main = (
      <>
        <h1 className="ent-title">Obligations</h1>
        {legalSigns.length > 0 && <Sign signs={legalSigns} state={state} onAct={setActing} />}
        <Pilot pilot={frame.pilot} on={on} state={state} onAgent={onAgent} />
        <Obligations state={state} now={now} onAct={setActing} />
      </>
    );
    side = <FrameSide frame={frame} state={state} onAgent={onAgent} />;
  } else if (spec.section === "Tableaux") {
    const frame = tablesFrame(state);
    main = (
      <>
        <h1 className="ent-title">Tableaux</h1>
        <Pilot pilot={frame.pilot} on={on} state={state} onAgent={onAgent} />
        <Tables state={state} now={now} onOpen={setOpen} />
      </>
    );
    side = <FrameSide frame={frame} state={state} onAgent={onAgent} />;
  } else if (current) {
    const frame = pageFrame(state, events, spec.section, current, now);
    main = (
      <>
        <h1 className="ent-title">{spec.section}</h1>
        <nav className="ent-pages">
          {spec.pages.map((p) => (
            <button key={p.page} className={p.page === current ? "on" : ""} onClick={() => onNavigate(spec.section, p.page)}>
              {p.page}
            </button>
          ))}
        </nav>
        {spec.section === "Juridique" && current === "Documents" && legalSigns.length > 0 && <Sign signs={legalSigns} state={state} onAct={setActing} />}
        <Pilot pilot={frame.pilot} on={on} state={state} onAgent={onAgent} />
        <DomainPage state={state} status={status} section={spec.section} page={current} events={events} onOpen={setOpen} onTask={onTask} />
      </>
    );
    side = <FrameSide frame={frame} state={state} onAgent={onAgent} />;
  }

  return (
    <div className="columns ent">
      <div className="main">
        <SectionTabs items={SECTIONS} active={spec.section} onSelect={(s) => onNavigate(s)} />
        {main}
      </div>
      <aside className="side">{side}</aside>
      {open && <DeliverableView d={open} state={state} status={status} onClose={() => setOpen(undefined)} onChange={onChange} />}
      {acting && <ActionModal mission={acting} state={state} now={now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </div>
  );
}

function useEvents(seq: number): StoredEvent[] {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  useEffect(() => {
    void window.narthex.call("events.read", {}).then(setEvents);
  }, [seq]);
  return events;
}

function taskMission(state: CompanyState, t: Task, now: number): Mission {
  const leaving = t.status === "planned" && t.kind === "external" && (t.cancellableUntil ?? 0) > now;
  return {
    id: t.id,
    kind: leaving ? "cancel" : "mission",
    eyebrow: leaving ? `Part ${fmt.relative(t.cancellableUntil!, now)} · tu peux l'annuler` : `${state.agents[t.agentId]?.name ?? ""} · ${t.status === "running" ? "en cours" : "prévue"}`,
    title: t.title,
    why: t.why,
    speakerId: t.agentId,
    action: leaving ? "cancel" : "open",
    label: "Voir",
    taskId: t.id,
  };
}

function obligationMission(state: CompanyState, o: Obligation): Mission {
  const speaker = Object.values(state.agents).find((a) => a.role === "juridique") ?? Object.values(state.agents).find((a) => a.role === "cofondateur");
  return {
    id: o.id,
    kind: "legal",
    eyebrow: "À faire par toi · la loi l'impose",
    title: o.title,
    why: o.why,
    ...(speaker ? { speakerId: speaker.id } : {}),
    action: o.code === "A3-forme" ? "form" : "fulfill",
    label: "Voir",
    obligationId: o.id,
  };
}

/** What the agent said when it delivered, in its own words; the summary when it said nothing. */
function wordsFor(state: CompanyState, d: Deliverable): string | undefined {
  return [...state.posts].reverse().find((p) => p.deliverableId === d.id)?.text;
}

function DeliverablePost({ d, state, now, onOpen }: { d: Deliverable; state: CompanyState; now: number; onOpen(): void }) {
  const table = markdownTables(d.body).find((t) => t.rows.length > 0);
  const words = wordsFor(state, d);
  return (
    <Post agentId={d.agentId} state={state} at={d.createdAt} now={now}>
      <p className="text">{words ?? d.summary}</p>
      {table ? (
        <TableAttachment title={d.title} header={table.header} rows={table.rows} />
      ) : (
        <div className="ent-attach">
          <div className="ent-attach-title">{d.title}</div>
          <div className="ent-attach-line">{words ? d.summary : `${d.sources.length} source${d.sources.length > 1 ? "s" : ""} citée${d.sources.length > 1 ? "s" : ""}`}</div>
        </div>
      )}
      <div className="actions">
        <button className="btn btn-secondary" onClick={onOpen}>
          {table && <TableIcon />}
          {table ? "Tableau complet" : "Ouvrir le livrable"}
        </button>
      </div>
    </Post>
  );
}

function TaskPost({ t, state, now, onTask }: { t: Task; state: CompanyState; now: number; onTask(t: Task): void }) {
  const words = [...state.posts].reverse().find((p) => p.taskId === t.id && p.kind !== "deliverable")?.text;
  const leaving = t.status === "planned" && t.kind === "external" && (t.cancellableUntil ?? 0) > now;
  const when = t.status === "running" ? `En cours · commencée ${fmt.relative(t.startedAt ?? t.scheduledAt, now)}` : `Prévue ${t.scheduledAt <= now ? "dès que possible" : `${fmt.relative(t.scheduledAt, now)}, ${fmt.day(t.scheduledAt)} à ${fmt.hour(t.scheduledAt)}`}`;
  return (
    <Post agentId={t.agentId} state={state} at={t.createdAt} now={now}>
      {(words ?? t.why) && <p className="text">{words ?? t.why}</p>}
      <div className="ent-attach">
        <div className="ent-attach-title">{t.title}</div>
        <div className="ent-attach-line">
          {when}
          {t.kind === "external" ? " · action vers l'extérieur" : ""}
        </div>
      </div>
      <div className="actions">
        {leaving ? (
          <>
            <span className="delay">
              <Clock /> Part {fmt.relative(t.cancellableUntil!, now)}
            </span>
            <button className="btn btn-secondary" onClick={() => onTask(t)}>
              Annuler
            </button>
          </>
        ) : (
          <button className="btn btn-quiet" onClick={() => onTask(t)}>
            Voir la mission
          </button>
        )}
      </div>
    </Post>
  );
}

// ---------- Vue d'ensemble ----------

function Overview({ state, status, on, onAct, onAgent }: { state: CompanyState; status: EngineStatus; on: boolean; onAct(m: Mission): void; onAgent(id: string): void }) {
  const o = overview(state, status.now);
  const signs = missions(state, status.now, status.runtime);
  const quest = filView(state, status.now).quest;
  const yours = o.milestones.filter((m) => m.state === "you").length;
  const agents = Object.values(state.agents);
  const working = agents.filter((a) => a.status === "working").length;
  const latest = Object.values(state.deliverables).sort((a, b) => b.createdAt - a.createdAt)[0];
  const margaux = agents.find((a) => a.role === "cofondateur");
  const pilot = {
    title: state.company?.paused ? "L'équipe est en pause" : status.runtime === "none" ? "L'équipe attend ta clé pour travailler" : "Margaux tient l'entreprise à jour",
    detail: [`${agents.length} agent${agents.length > 1 ? "s" : ""}`, working ? `${working} au travail` : "personne au travail en ce moment", latest ? `dernier livrable ${fmt.relative(latest.createdAt, status.now)}` : ""].filter(Boolean).join(" · "),
    ...(margaux ? { agentId: margaux.id } : {}),
  };
  return (
    <>
      <div className="company-head">
        <h1>{o.title}</h1>
        <span className="pill stage">{o.stage}</span>
      </div>
      <p className="muted company-sub">{o.subtitle}</p>
      {signs.length > 0 && <Sign signs={signs} state={state} onAct={onAct} />}
      <Pilot pilot={pilot} on={on} state={state} onAgent={onAgent} />
      <section className="card">
        <header className="card-head">
          <span>Où en est ta société</span>
          <span className="muted">{yours ? `${yours} étape${yours > 1 ? "s" : ""} demande${yours > 1 ? "nt" : ""} ta main` : "Rien ne t'attend"}</span>
        </header>
        {o.milestones.map((m, i) => (
          <div key={i} className={`milestone ${m.state}`}>
            <span className="milestone-icon">{m.state === "done" ? "✓" : m.state === "you" ? "!" : m.state === "team" ? "•" : ""}</span>
            <div>
              <div>{m.title}</div>
              <div className={m.state === "you" ? "small accent" : "muted small"}>{m.who}</div>
            </div>
            <span className="muted small">{m.at ? (m.state === "done" ? fmt.day(m.at) : `avant le ${fmt.day(m.at)}`) : ""}</span>
          </div>
        ))}
      </section>
      {quest && (
        <section className="card">
          <header className="card-head">
            <span>Objectif de l'étape</span>
            <span className="muted">suivi par Margaux</span>
          </header>
          <div className="ent-goal">
            <div className="ent-goal-top">
              <span>{quest.title}</span>
              <span className="muted small">
                {quest.done} sur {quest.total}
              </span>
            </div>
            <div className="ent-goal-bar">
              <span style={{ width: `${(quest.done / Math.max(1, quest.total)) * 100}%` }} />
            </div>
            <div className="muted small">{quest.next ? `Prochaine étape : ${quest.next.charAt(0).toLowerCase()}${quest.next.slice(1)}` : "Tout est fait pour cette étape"}</div>
          </div>
        </section>
      )}
    </>
  );
}

function OverviewSide({ state, now, events, onOpen }: { state: CompanyState; now: number; events: StoredEvent[]; onOpen(d: Deliverable): void }) {
  const o = overview(state, now);
  const sales = state.sales ?? [];
  const revenue = sales.reduce((n, s) => n + (s.amountCents ?? 0), 0);
  const month = fmt.dayKey(now).slice(0, 7);
  const spentMonth = events.reduce((n, e) => (e.type === "usage.recorded" && fmt.dayKey(e.at ?? e.ts).slice(0, 7) === month ? n + e.credits : n), 0);
  const week = Object.values(state.deliverables)
    .filter((d) => now - d.createdAt < 7 * 86_400_000)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 4);
  return (
    <>
      <FrameSide
        state={state}
        onAgent={() => {}}
        frame={{
          period: new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "Europe/Paris" }).format(now),
          figures: [
            { label: "Chiffre d'affaires", value: fmt.euros(revenue), hint: sales.length ? `${sales.length} vente${sales.length > 1 ? "s" : ""} enregistrée${sales.length > 1 ? "s" : ""} par toi` : "Aucune vente enregistrée" },
            { label: "Dépense IA", value: fmt.dollars(spentMonth), hint: "Ce mois-ci, chez ton fournisseur d'IA" },
            { label: "Livrables", value: String(Object.keys(state.deliverables).length), hint: `${Object.values(state.tasks).filter((t) => t.status === "done").length} missions faites par l'équipe` },
          ],
          who: [],
        }}
      />
      {o.deadlines.length > 0 && (
        <section className="card">
          <header className="card-head">
            <span>Échéances</span>
            <span className="muted">suivies par l'équipe</span>
          </header>
          {o.deadlines.slice(0, 5).map((d, i) => (
            <div key={i} className="deadline">
              <span className="deadline-date">
                <b>{new Date(d.due).getDate()}</b>
                <span className="muted small">{new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(d.due)}</span>
              </span>
              <div>
                <div>{d.title}</div>
                <div className="muted small">{d.who}</div>
              </div>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <header className="card-head">
          <span>Livré cette semaine</span>
          <span className="muted">par l'équipe</span>
        </header>
        {week.length === 0 && <p className="muted small">Rien cette semaine. Chaque livrable terminé arrivera ici.</p>}
        {week.map((d) => {
          const agent = state.agents[d.agentId];
          return (
            <div key={d.id} className="ent-recent" onClick={() => onOpen(d)}>
              <PixelAvatar role={agent?.role} size={32} />
              <div>
                <div className="ent-recent-title">
                  {agent?.name} · {d.title}
                </div>
                <div className="muted small">{fmt.relative(d.createdAt, now)}</div>
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

// ---------- Domain pages ----------

function DomainPage({
  state,
  status,
  section,
  page,
  events,
  onOpen,
  onTask,
}: {
  state: CompanyState;
  status: EngineStatus;
  section: string;
  page: string;
  events: StoredEvent[];
  onOpen(d: Deliverable): void;
  onTask(t: Task): void;
}) {
  const now = status.now;
  const v = pageView(state, section, page, now);
  const documents = section === "Juridique" && page === "Documents";
  const posts = (
    <>
      {v.tasks.map((t) => (
        <TaskPost key={t.id} t={t} state={state} now={now} onTask={onTask} />
      ))}
      {!documents &&
        v.deliverables.map((d) => <DeliverablePost key={d.id} d={d} state={state} now={now} onOpen={() => onOpen(d)} />)}
      {v.deliverables.length === 0 && v.tasks.length === 0 && v.empty && (
        <Post
          state={state}
          now={now}
          {...(v.owners[0] ? { agentId: v.owners[0].id } : { ghost: { role: v.spec.owners[0]!, note: "pas encore là" } })}
        >
          <p className="text">{role(v.owners[0]?.role ?? v.spec.owners[0]!).mission}</p>
          <div className="ent-attach">
            <div className="ent-attach-title">{page}</div>
            <div className="ent-attach-line">Rien encore. Chaque livrable de {v.owners[0]?.name ?? role(v.spec.owners[0]!).defaultName} pour cette page arrivera ici.</div>
          </div>
        </Post>
      )}
    </>
  );
  return (
    <>
      {section === "Ventes" && page === "Commandes" && <SalesCard state={state} now={now} />}
      <section className="fil-list">
        {page === "Dépenses" && <SpendBlock state={state} events={events} />}
        {documents && <DocumentsPost state={state} now={now} deliverables={v.deliverables} tasks={v.tasks} onOpen={onOpen} />}
        {posts}
      </section>
    </>
  );
}

/** Juridique · Documents: every paper of the company in one table (Figma « Documents de la société »). */
function DocumentsPost({ state, now, deliverables, tasks, onOpen }: { state: CompanyState; now: number; deliverables: Deliverable[]; tasks: Task[]; onOpen(d: Deliverable): void }) {
  if (deliverables.length === 0) return null;
  const author = deliverables[0]!.agentId;
  const rows = deliverables.map((d) => [d.title, fmt.day(d.createdAt), <span key="s" className="ent-state ok">Livré</span>]);
  return (
    <Post agentId={author} state={state} at={deliverables[0]!.createdAt} now={now}>
      <TableAttachment
        title="Documents de la société"
        header={["Document", "Date", "État"]}
        widths={["62%", "20%", "18%"]}
        rows={rows}
        limit={8}
        onRow={(i) => onOpen(deliverables[i]!)}
        foot={`Un clic ouvre le document.${tasks.length ? ` ${tasks.length} autre${tasks.length > 1 ? "s" : ""} en préparation.` : ""}`}
      />
    </Post>
  );
}

function SalesCard({ state, now }: { state: CompanyState; now: number }) {
  const [selling, setSelling] = useState(false);
  const sales = state.sales ?? [];
  return (
    <section className="card sales">
      <header className="card-head">
        <span>Tes ventes</span>
        <button className="btn btn-secondary" onClick={() => setSelling(true)}>
          J'ai fait une vente
        </button>
      </header>
      {sales.length === 0 ? (
        <p className="muted small">Aucune vente enregistrée. La première fait passer l'entreprise en activité.</p>
      ) : (
        <TableAttachment
          header={["Vente", "Date", "Montant"]}
          rows={[...sales].reverse().map((s) => [s.note ?? "Vente", fmt.day(s.at), s.amountCents !== undefined ? fmt.euros(s.amountCents) : "—"])}
          numLast
          limit={8}
        />
      )}
      {selling && (
        <ActionModal
          mission={{ id: "sale", kind: "rest", eyebrow: "Ventes", title: "Enregistrer une vente", why: "Le montant est facultatif. L'équipe s'en sert pour ses chiffres.", action: "sale", label: "" }}
          state={state}
          now={now}
          onClose={() => setSelling(false)}
          onDone={() => {}}
        />
      )}
    </section>
  );
}

function SpendBlock({ state, events }: { state: CompanyState; events: StoredEvent[] }) {
  const b = spendBreakdown(state, events);
  const max = Math.max(1, ...b.byDay.map((d) => d.credits));
  return (
    <article className="publication">
      <header className="card-head">
        <span>Dépense IA</span>
        <span className="muted">{fmt.dollars(b.total)} au total · 14 derniers jours</span>
      </header>
      {b.byDay.length > 0 && (
        <div className="spend-chart" aria-label="Dépense IA par jour, 14 derniers jours">
          {b.byDay.map((d) => (
            <span key={d.day} className="spend-bar" style={{ height: `${Math.max(2, (d.credits / max) * 100)}%` }} title={`${fmt.day(d.day)} : ${fmt.dollars(d.credits)}`} />
          ))}
        </div>
      )}
      {b.byAgent.length === 0 ? (
        <p className="muted small">Aucune dépense pour l'instant.</p>
      ) : (
        <TableAttachment
          title="Par coéquipier"
          header={["Qui", "Rôle", "Montant"]}
          rows={b.byAgent.map((a) => [a.name, role(a.role).title, fmt.dollars(a.credits)])}
          numLast
          limit={10}
          foot="Facturé sur ton compte, chez ton fournisseur d'IA."
        />
      )}
    </article>
  );
}

// ---------- Obligations ----------

function Obligations({ state, now, onAct }: { state: CompanyState; now: number; onAct(m: Mission): void }) {
  const all = Object.values(state.obligations).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  const yours = all.filter((o) => o.owner === "founder" && o.status === "open");
  const team = all.filter((o) => o.owner !== "founder" && o.status === "open");
  const done = all.filter((o) => o.status === "done").sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const legal = Object.values(state.agents).find((a) => a.role === "juridique") ?? Object.values(state.agents).find((a) => a.role === "cofondateur");
  const ownerName = (o: Obligation) => (o.owner === "founder" ? "Toi" : (Object.values(state.agents).find((a) => a.role === o.owner)?.name ?? role(o.owner).defaultName));
  const when = (o: Obligation) => (o.due ? (fmt.dayKey(o.due) === fmt.dayKey(now) ? "aujourd'hui" : fmt.day(o.due)) : "—");
  const stateOf = (o: Obligation) =>
    o.stuck ? <span className="ent-state late">Bloquée</span> : o.due && o.due < now ? <span className="ent-state late">En retard</span> : <span className="ent-state team">Suivie</span>;
  const later = overview(state, now).milestones.filter((m) => m.state === "later" && m.title !== "Étude de marché");
  if (all.length === 0 && later.length === 0) return null;
  const last = all.length ? Math.max(...all.map((o) => o.doneAt ?? o.openedAt)) : undefined;
  return (
    <section className="fil-list">
      <Post agentId={legal?.id} state={state} at={last} now={now}>
        {yours.length > 0 && (
          <TableAttachment
            title="Pour toi"
            header={["Quoi", "Quand", "Pourquoi toi"]}
            widths={["34%", "18%", "48%"]}
            rows={yours.map((o) => [o.title, <span key="w" className={o.due && o.due - now < 86_400_000 * 2 ? "ent-you" : undefined}>{when(o)}</span>, o.why])}
            limit={20}
            onRow={(i) => onAct(obligationMission(state, yours[i]!))}
            foot="Un clic t'explique quoi faire."
          />
        )}
        {team.length > 0 && <TableAttachment title="Pour l'équipe" header={["Quoi", "Quand", "Qui", "État"]} widths={["46%", "18%", "18%", "18%"]} rows={team.map((o) => [o.title, when(o), ownerName(o), stateOf(o)])} limit={20} />}
        {later.length > 0 && (
          <TableAttachment
            title="Ensuite"
            header={["Quoi", "Qui", "État"]}
            widths={["46%", "36%", "18%"]}
            rows={later.map((m) => [m.title, m.who, <span key="s" className="ent-state">À venir</span>])}
            foot="Ouvertes par l'équipe quand l'étape de l'entreprise les rend nécessaires."
          />
        )}
        {done.length > 0 && (
          <TableAttachment
            title="Faites"
            header={["Quoi", "Le", "Qui", "État"]}
            widths={["46%", "18%", "18%", "18%"]}
            rows={done.map((o) => [o.title, o.doneAt ? fmt.day(o.doneAt) : "—", ownerName(o), <span key="s" className="ent-state ok">Faite</span>])}
            limit={8}
          />
        )}
      </Post>
    </section>
  );
}

// ---------- Tableaux ----------

function Tables({ state, now, onOpen }: { state: CompanyState; now: number; onOpen(d: Deliverable): void }) {
  // One publication per deliverable, with all its tables as pièces jointes.
  const groups = new Map<string, { d: Deliverable; tables: ReturnType<typeof tablesOf> }>();
  for (const t of tablesOf(state)) {
    const g = groups.get(t.deliverable.id) ?? { d: t.deliverable, tables: [] };
    g.tables.push(t);
    groups.set(t.deliverable.id, g);
  }
  if (groups.size === 0) return null;
  return (
    <section className="fil-list">
      {[...groups.values()].map(({ d, tables }) => (
        <Post key={d.id} agentId={d.agentId} state={state} at={d.createdAt} now={now}>
          <p className="text">{d.title}</p>
          {tables.slice(0, 3).map((t, i) => (
            <TableAttachment key={i} header={t.header} rows={t.rows} limit={5} />
          ))}
          <div className="actions">
            <button className="btn btn-secondary" onClick={() => onOpen(d)}>
              <TableIcon /> {tables.length > 3 ? `Les ${tables.length} tableaux` : "Tableau complet"}
            </button>
          </div>
        </Post>
      ))}
    </section>
  );
}
