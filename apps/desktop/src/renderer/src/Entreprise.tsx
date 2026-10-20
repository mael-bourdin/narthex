import { useEffect, useState } from "react";
import {
  ENTERPRISE,
  fmt,
  missions,
  overview,
  pageView,
  role,
  spendBreakdown,
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
import { Donnees } from "./Donnees.tsx";
import { firstTableRows, Sign } from "./Fil.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";
import { SectionTabs } from "./SectionTabs.tsx";

const SECTIONS = ENTERPRISE.map((s) => s.section);

/** The Entreprise tab (Figma section 5), from the team's real work only. */
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
  const spec = ENTERPRISE.find((s) => s.section === section)!;
  const current = spec.pages.length ? (page && spec.pages.some((p) => p.page === page) ? page : spec.pages[0]!.page) : undefined;

  return (
    <div className="columns">
      <div className="main">
        <SectionTabs items={SECTIONS} active={section} onSelect={(s) => onNavigate(s)} />
        {spec.pages.length > 0 && (
          <div className="chips pages">
            {spec.pages.map((p) => (
              <button key={p.page} className={p.page === current ? "chip on" : "chip"} onClick={() => onNavigate(section, p.page)}>
                {p.page}
              </button>
            ))}
          </div>
        )}
        {section === "Vue d'ensemble" && <Overview state={state} status={status} onAct={setActing} onOpen={setOpen} />}
        {section === "Données" && <Donnees state={state} status={status} events={events} />}
        {section === "Obligations" && <Obligations state={state} now={status.now} onAct={setActing} />}
        {section === "Tableaux" && <Tables state={state} onOpen={setOpen} />}
        {current && (
          <DomainPage state={state} status={status} section={section} page={current} events={events} onOpen={setOpen} onAgent={onAgent} onTask={(t) => setActing(taskMission(state, t, status.now))} />
        )}
      </div>
      <aside className="side">
        {section === "Vue d'ensemble" ? <OverviewSide state={state} status={status} events={events} /> : <SpendCard state={state} events={events} compact />}
      </aside>
      {open && <DeliverableView d={open} state={state} status={status} onClose={() => setOpen(undefined)} onChange={onChange} />}
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
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

// ---------- Vue d'ensemble ----------

function Overview({ state, status, onAct, onOpen }: { state: CompanyState; status: EngineStatus; onAct(m: Mission): void; onOpen(d: Deliverable): void }) {
  const o = overview(state, status.now);
  const signs = missions(state, status.now, status.runtime);
  const yours = o.milestones.filter((m) => m.state === "you").length;
  const working = Object.values(state.agents).filter((a) => a.status === "working").length;
  const latest = Object.values(state.deliverables).sort((a, b) => b.createdAt - a.createdAt)[0];
  return (
    <>
      <div className="company-head">
        <h1>{o.title}</h1>
        <span className="pill stage">{o.stage}</span>
      </div>
      <p className="muted company-sub">{o.subtitle}</p>
      {signs.length > 0 && <Sign signs={signs} state={state} onAct={onAct} />}
      <section className="pilot">
        <span className={`pilot-dot ${status.runtime === "none" || state.company?.paused ? "waiting" : "on"}`} />
        <div>
          <div>Margaux tient l'entreprise à jour</div>
          <div className="muted small">
            {Object.keys(state.agents).length} agents · {working} au travail
            {latest ? ` · dernier livrable ${fmt.relative(latest.createdAt, status.now)}` : ""}
          </div>
        </div>
        {latest && (
          <button className="btn btn-quiet" onClick={() => onOpen(latest)}>
            Voir le dernier livrable
          </button>
        )}
      </section>
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
    </>
  );
}

function OverviewSide({ state, status, events }: { state: CompanyState; status: EngineStatus; events: StoredEvent[] }) {
  const o = overview(state, status.now);
  const recent = Object.values(state.tasks)
    .filter((t) => t.status === "done" && t.deliverableId)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, 3);
  const month = new Date(status.now).getMonth();
  const spentMonth = events.filter((e) => e.type === "usage.recorded" && new Date((e as { at?: number }).at ?? e.ts).getMonth() === month).reduce((s, e) => s + (e as { credits: number }).credits, 0);
  return (
    <>
      <section className="card">
        <header className="card-head">
          <span>Les chiffres</span>
          <span className="muted">{new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(status.now)}</span>
        </header>
        <div className="kpi">
          <div>
            <div>Dépense IA</div>
            <div className="muted small">Ce mois-ci, sur ton compte Anthropic</div>
          </div>
          <div className="kpi-value">{fmt.dollars(spentMonth)}</div>
        </div>
        <div className="kpi">
          <div>
            <div>Livrables</div>
            <div className="muted small">Études, documents, listes</div>
          </div>
          <div className="kpi-value">{Object.keys(state.deliverables).length}</div>
        </div>
        <div className="kpi">
          <div>
            <div>Missions faites</div>
            <div className="muted small">Lancées seules par l'équipe</div>
          </div>
          <div className="kpi-value">{Object.values(state.tasks).filter((t) => t.status === "done").length}</div>
        </div>
      </section>
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
                <div className="small">{d.title}</div>
                <div className="muted small">{d.who}</div>
              </div>
            </div>
          ))}
        </section>
      )}
      {recent.length > 0 && (
        <section className="card">
          <header className="card-head">
            <span>Derniers livrables</span>
          </header>
          {recent.map((t) => {
            const agent = state.agents[t.agentId];
            return (
              <div key={t.id} className="member-row">
                {agent && <PixelAvatar role={agent.role} size={26} />}
                <div className="member-text">
                  <div className="small">{t.title}</div>
                  <div className="muted small">
                    {agent?.name} · {fmt.relative(t.endedAt ?? t.createdAt, status.now)}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}
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
  onAgent,
  onTask,
}: {
  state: CompanyState;
  status: EngineStatus;
  section: string;
  page: string;
  events: StoredEvent[];
  onOpen(d: Deliverable): void;
  onAgent(id: string): void;
  onTask(t: Task): void;
}) {
  const v = pageView(state, section, page, status.now);
  const [selling, setSelling] = useState(false);
  const sales = state.sales ?? [];
  return (
    <>
      <h1>{page}</h1>
      <section className="owners">
        {v.owners.length > 0
          ? v.owners.map((a) => (
              <button key={a.id} className="chip" onClick={() => onAgent(a.id)}>
                <PixelAvatar role={a.role} size={20} /> {a.name} · {role(a.role).title}
              </button>
            ))
          : v.spec.owners.slice(0, 1).map((r) => (
              <span key={r} className="chip static ghost">
                <PixelAvatar role={r} size={20} dim /> {role(r).defaultName} · {role(r).title} · pas encore là
              </span>
            ))}
      </section>
      {section === "Ventes" && page === "Commandes" && (
        <section className="card sales">
          <header className="card-head">
            <span>Tes ventes</span>
            <button className="btn btn-secondary" onClick={() => setSelling(true)}>
              J'ai fait une vente
            </button>
          </header>
          {sales.length === 0 && <p className="muted small">Aucune vente enregistrée. La première fait passer l'entreprise en activité.</p>}
          {[...sales].reverse().slice(0, 8).map((v) => (
            <div key={v.id} className="sale-line small">
              <span>{v.note ?? "Vente"}</span>
              <span className="muted">
                {v.amountCents !== undefined ? `${(v.amountCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} · ` : ""}
                {fmt.day(v.at)}
              </span>
            </div>
          ))}
          {selling && (
            <ActionModal
              mission={{ id: "sale", kind: "rest", eyebrow: "Ventes", title: "Enregistrer une vente", why: "Le montant est facultatif. L'équipe s'en sert pour ses chiffres.", action: "sale", label: "" }}
              state={state}
              now={status.now}
              onClose={() => setSelling(false)}
              onDone={() => {}}
            />
          )}
        </section>
      )}
      {page === "Dépenses" && <SpendCard state={state} events={events} />}
      {v.tasks.length > 0 && (
        <section className="card">
          <header className="card-head">
            <span>En cours et prévu</span>
            <span className="muted">{v.tasks.length}</span>
          </header>
          {v.tasks.map((t) => (
            <button key={t.id} className="task-line" onClick={() => onTask(t)}>
              {state.agents[t.agentId] && <PixelAvatar role={state.agents[t.agentId]!.role} size={22} />}
              <span className="task-line-title">{t.title}</span>
              <span className={t.status === "running" ? "small accent" : "muted small"}>{t.status === "running" ? "en cours" : t.scheduledAt <= status.now ? "dès que possible" : fmt.relative(t.scheduledAt, status.now)}</span>
            </button>
          ))}
        </section>
      )}
      {v.deliverables.length > 0 ? (
        <section className="fil-list">
          {v.deliverables.map((d) => (
            <DeliverableCard key={d.id} d={d} state={state} now={status.now} onOpen={() => onOpen(d)} />
          ))}
        </section>
      ) : (
        v.empty && (
          <section className="fil-empty">
            <p>Rien ici pour l'instant.</p>
            <p className="muted">{v.empty}</p>
          </section>
        )
      )}
    </>
  );
}

function DeliverableCard({ d, state, now, onOpen }: { d: Deliverable; state: CompanyState; now: number; onOpen(): void }) {
  const agent = state.agents[d.agentId];
  const rows = firstTableRows(d.body, 3);
  return (
    <article className="publication clickable" onClick={onOpen}>
      <header className="post-head">
        {agent && <PixelAvatar role={agent.role} size={32} />}
        <span className="name">{d.title}</span>
        <span className="muted time">{fmt.relative(d.createdAt, now)}</span>
      </header>
      <p className="text muted">{d.summary}</p>
      {rows.length > 0 && (
        <div className="attachment">
          <span className="attachment-table">
            {rows.map((cells, i) => (
              <span key={i} className="attachment-row">
                <span>{cells[0]}</span>
                <span className="muted">{cells[1] ?? ""}</span>
              </span>
            ))}
          </span>
        </div>
      )}
    </article>
  );
}

function SpendCard({ state, events, compact }: { state: CompanyState; events: StoredEvent[]; compact?: boolean }) {
  const b = spendBreakdown(state, events);
  const max = Math.max(1, ...b.byDay.map((d) => d.credits));
  return (
    <section className="card">
      <header className="card-head">
        <span>Dépense IA</span>
        <span className="muted">{fmt.dollars(b.total)} au total</span>
      </header>
      {!compact && b.byDay.length > 0 && (
        <div className="spend-chart" aria-label="Dépense IA par jour, 14 derniers jours">
          {b.byDay.map((d) => (
            <span key={d.day} className="spend-bar" style={{ height: `${Math.max(2, (d.credits / max) * 100)}%` }} title={`${fmt.day(d.day)} : ${fmt.dollars(d.credits)}`} />
          ))}
        </div>
      )}
      {b.byAgent.length === 0 && <p className="muted small">Aucune dépense pour l'instant.</p>}
      {b.byAgent.slice(0, compact ? 4 : 10).map((a) => (
        <div key={a.agentId} className="member-row">
          <PixelAvatar role={a.role} size={24} />
          <div className="member-text">
            <div className="small">{a.name}</div>
          </div>
          <span className="small">{fmt.dollars(a.credits)}</span>
        </div>
      ))}
      <p className="muted small">Facturé par Anthropic sur ton compte. Plafond : {fmt.dollars(state.settings.dailyBudgetCredits)} par jour.</p>
    </section>
  );
}

// ---------- Obligations ----------

function Obligations({ state, now, onAct }: { state: CompanyState; now: number; onAct(m: Mission): void }) {
  const all = Object.values(state.obligations).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  const groups: [string, Obligation[]][] = [
    ["Pour toi", all.filter((o) => o.owner === "founder" && o.status === "open")],
    ["Pour l'équipe", all.filter((o) => o.owner !== "founder" && o.status === "open")],
    ["Faites", all.filter((o) => o.status === "done")],
  ];
  return (
    <>
      <h1>Obligations</h1>
      {all.length === 0 && (
        <section className="fil-empty">
          <p>Aucune obligation ouverte.</p>
          <p className="muted">Hugo les ouvre quand l'étape de l'entreprise les rend nécessaires, avec la règle et sa source.</p>
        </section>
      )}
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <section key={title} className="card">
            <header className="card-head">
              <span>{title}</span>
              <span className="muted">{list.length}</span>
            </header>
            {list.map((o) => {
              const owner = o.owner === "founder" ? undefined : Object.values(state.agents).find((a) => a.role === o.owner);
              const clickable = o.owner === "founder" && o.status === "open";
              return (
                <button key={o.id} className={`task-line${clickable ? "" : " static"}`} disabled={!clickable} onClick={() => clickable && onAct(obligationMission(state, o))}>
                  {owner ? <PixelAvatar role={owner.role} size={22} /> : <PixelAvatar founder size={22} />}
                  <span className="task-line-title">
                    {o.title}
                    <span className="muted small block">{o.why}</span>
                  </span>
                  <span className={o.status === "done" ? "muted small" : o.owner === "founder" ? "small accent" : "muted small"}>
                    {o.status === "done" ? `fait ${fmt.relative(o.doneAt ?? now, now)}` : o.due ? `avant le ${fmt.day(o.due)}` : ""}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
    </>
  );
}

// ---------- Tableaux ----------

function Tables({ state, onOpen }: { state: CompanyState; onOpen(d: Deliverable): void }) {
  const tables = tablesOf(state);
  return (
    <>
      <h1>Tableaux</h1>
      {tables.length === 0 && (
        <section className="fil-empty">
          <p>Pas encore de tableau.</p>
          <p className="muted">Chaque tableau d'un livrable (prospects, concurrents, prix, échéances) sera rassemblé ici.</p>
        </section>
      )}
      {tables.map((t, i) => (
        <section key={i} className="card table-card">
          <header className="card-head">
            <span>{t.deliverable.title}</span>
            <button className="btn btn-quiet" onClick={() => onOpen(t.deliverable)}>
              Ouvrir le livrable
            </button>
          </header>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {t.header.map((h, j) => (
                    <th key={j}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
