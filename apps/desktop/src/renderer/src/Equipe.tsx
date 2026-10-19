import { useEffect, useMemo, useState } from "react";
import {
  agentSheet,
  calendar,
  fmt,
  journalEntries,
  orgChart,
  recruitments,
  type CompanyState,
  type RoleId,
  type Deliverable,
  type EngineStatus,
  type StoredEvent,
  type Task,
  type TeamRow,
} from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { DeliverableView } from "./Deliverable.tsx";
import { Chevron } from "./icons.tsx";
import { Memoire } from "./Memoire.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";
import { SectionTabs } from "./SectionTabs.tsx";

export type EquipeView = "Organigramme" | "Calendrier" | "Recrutements prévus" | "Journal" | "Mémoire";
const VIEWS: EquipeView[] = ["Organigramme", "Calendrier", "Recrutements prévus", "Journal", "Mémoire"];

/** The Équipe tab (Figma section 4): who works, when, who comes next, and everything they did. */
export function Equipe({
  state,
  status,
  view,
  agentId,
  onView,
  onAgent,
  onChange,
}: {
  state: CompanyState;
  status: EngineStatus;
  view: EquipeView;
  agentId?: string;
  onView(v: EquipeView): void;
  onAgent(id?: string): void;
  onChange(): void;
}) {
  if (agentId && state.agents[agentId]) return <AgentPage state={state} status={status} agentId={agentId} onBack={() => onAgent(undefined)} onChange={onChange} />;
  return (
    <div className="columns">
      <div className="main">
        <SectionTabs items={VIEWS} active={view} onSelect={onView} />
        {view === "Organigramme" && <Organigramme state={state} status={status} onAgent={onAgent} />}
        {view === "Calendrier" && <Calendrier state={state} status={status} onChange={onChange} />}
        {view === "Recrutements prévus" && <Recrutements state={state} />}
        {view === "Journal" && <Journal state={state} onAgent={onAgent} />}
        {view === "Mémoire" && <Memoire state={state} status={status} onAgent={onAgent} onChange={onChange} />}
      </div>
      <aside className="side">
        <TeamNumbers state={state} status={status} />
        <NowCard state={state} status={status} onAgent={onAgent} />
      </aside>
    </div>
  );
}

// ---------- Organigramme ----------

function Organigramme({ state, status, onAgent }: { state: CompanyState; status: EngineStatus; onAgent(id: string): void }) {
  const o = orgChart(state, status.now);
  return (
    <>
      <h1>Ton équipe</h1>
      <section className="card org">
        <div className="org-node founder">
          <PixelAvatar founder size={32} />
          <div>
            <div className="name">{o.founder}</div>
            <div className="muted small">Fondatrice · toi</div>
          </div>
        </div>
        {o.cofounder && (
          <>
            <span className="org-line" />
            <OrgNode row={o.cofounder} onClick={() => onAgent(o.cofounder!.agent.id)} />
          </>
        )}
        {(o.members.length > 0 || o.upcoming.length > 0) && <span className="org-line" />}
        <div className="org-grid">
          {o.members.map((m) => (
            <OrgNode key={m.agent.id} row={m} onClick={() => onAgent(m.agent.id)} />
          ))}
          {o.upcoming.map((u) => (
            <div key={u.role.id} className="org-node ghost">
              <PixelAvatar role={u.role.id} size={32} dim />
              <div>
                <div className="name">{u.role.defaultName}</div>
                <div className="muted small">{u.role.title} · arrive {u.when}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function OrgNode({ row, onClick }: { row: TeamRow; onClick(): void }) {
  const what = row.current ? row.current.progress && row.current.progress !== "Au travail…" ? row.current.progress : row.current.title : row.status === "waiting-you" ? "T'attend" : "Au repos";
  return (
    <button className="org-node" onClick={onClick}>
      <PixelAvatar role={row.agent.role} size={32} />
      <div>
        <div className="name">{row.agent.name}</div>
        <div className="muted small">{row.title}</div>
        <div className="small org-what">
          <span className={`status-dot ${row.status}`} /> {what}
        </div>
      </div>
    </button>
  );
}

// ---------- Calendrier ----------

type Scope = "Jour" | "Semaine" | "Mois";
const DAY = 86_400_000;
const HOURS = Array.from({ length: 12 }, (_, i) => 8 + i);

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function Calendrier({ state, status, onChange }: { state: CompanyState; status: EngineStatus; onChange(): void }) {
  const [scope, setScope] = useState<Scope>("Semaine");
  const [anchor, setAnchor] = useState(() => startOfDay(status.now));
  const [agentId, setAgentId] = useState<string>();
  const [selected, setSelected] = useState<Task>();
  const agents = Object.values(state.agents).sort((a, b) => a.hiredAt - b.hiredAt);

  const range = useMemo(() => {
    if (scope === "Jour") return { from: anchor, to: anchor + DAY, label: fmt.day(anchor) };
    if (scope === "Semaine") {
      const from = anchor - ((new Date(anchor).getDay() + 6) % 7) * DAY;
      return { from, to: from + 7 * DAY, label: `Semaine du ${fmt.day(from)} au ${fmt.day(from + 6 * DAY)}` };
    }
    const d = new Date(anchor);
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    return { from, to, label: new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(from) };
  }, [scope, anchor]);
  const tasks = calendar(state, range.from, range.to, agentId);
  const step = (dir: number) => {
    if (scope === "Mois") {
      const d = new Date(anchor);
      setAnchor(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime());
    } else setAnchor(anchor + dir * (scope === "Jour" ? 1 : 7) * DAY);
  };

  return (
    <>
      <h1>Calendrier de l'équipe</h1>
      <div className="cal-bar">
        <button className="icon-btn" aria-label="Précédent" onClick={() => step(-1)}>
          <Chevron left />
        </button>
        <button className="icon-btn" aria-label="Suivant" onClick={() => step(1)}>
          <Chevron />
        </button>
        <span className="cal-label">{range.label}</span>
        <button className="btn btn-quiet" onClick={() => setAnchor(startOfDay(status.now))}>
          Aujourd'hui
        </button>
        <span className="segmented">
          {(["Jour", "Semaine", "Mois"] as Scope[]).map((s) => (
            <button key={s} className={s === scope ? "on" : ""} onClick={() => setScope(s)}>
              {s}
            </button>
          ))}
        </span>
      </div>
      {scope !== "Jour" && (
        <div className="chips">
          <button className={!agentId ? "chip on" : "chip"} onClick={() => setAgentId(undefined)}>
            Toute l'équipe
          </button>
          {agents.map((a) => (
            <button key={a.id} className={agentId === a.id ? "chip on" : "chip"} onClick={() => setAgentId(a.id)}>
              <PixelAvatar role={a.role} size={20} /> {a.name}
            </button>
          ))}
        </div>
      )}
      {scope === "Mois" ? (
        <MonthGrid tasks={tasks} from={range.from} to={range.to} now={status.now} state={state} onSelect={setSelected} />
      ) : (
        <HourGrid
          columns={
            scope === "Jour"
              ? agents.map((a) => ({ key: a.id, label: a.name, role: a.role, filter: (t: Task) => t.agentId === a.id, day: range.from }))
              : Array.from({ length: 7 }, (_, i) => {
                  const day = range.from + i * DAY;
                  return { key: String(day), label: fmt.day(day), filter: (t: Task) => startOfDay(t.startedAt ?? t.scheduledAt) === day, day, today: day === startOfDay(status.now) };
                })
          }
          tasks={tasks}
          state={state}
          now={status.now}
          showAgent={scope !== "Jour"}
          onSelect={setSelected}
        />
      )}
      <p className="legend small muted">
        <span className="lg done" /> Faite <span className="lg running" /> En cours <span className="lg planned" /> Prévue <span className="lg external" /> Prévue, annulable
      </p>
      {selected && (
        <ActionModal
          mission={{
            id: selected.id,
            kind: selected.status === "planned" && selected.kind === "external" && (selected.cancellableUntil ?? 0) > status.now ? "cancel" : "mission",
            eyebrow: `${state.agents[selected.agentId]?.name ?? ""} · ${fmt.day(selected.startedAt ?? selected.scheduledAt)}, ${fmt.hour(selected.startedAt ?? selected.scheduledAt)}`,
            title: selected.title,
            why: selected.why,
            speakerId: selected.agentId,
            action: selected.status === "planned" && selected.kind === "external" && (selected.cancellableUntil ?? 0) > status.now ? "cancel" : "open",
            label: "Voir",
            taskId: selected.id,
          }}
          state={state}
          now={status.now}
          onClose={() => setSelected(undefined)}
          onDone={onChange}
        />
      )}
    </>
  );
}

function blockClass(t: Task, now: number): string {
  if (t.status === "done") return "done";
  if (t.status === "running") return "running";
  if (t.status === "failed") return "failed";
  return t.kind === "external" && (t.cancellableUntil ?? 0) > now ? "external" : "planned";
}

function HourGrid({
  columns,
  tasks,
  state,
  now,
  showAgent,
  onSelect,
}: {
  columns: { key: string; label: string; role?: RoleId; filter(t: Task): boolean; day: number; today?: boolean }[];
  tasks: Task[];
  state: CompanyState;
  now: number;
  showAgent: boolean;
  onSelect(t: Task): void;
}) {
  const ROW = 44;
  const hourOf = (ts: number) => {
    const d = new Date(ts);
    return d.getHours() + d.getMinutes() / 60;
  };
  return (
    <section className="card cal-grid" style={{ ["--cols" as string]: columns.length }}>
      <div className="cal-head">
        <span />
        {columns.map((c) => (
          <span key={c.key} className={c.today ? "today" : ""}>
            {c.role && <PixelAvatar role={c.role} size={22} />}
            {c.label}
          </span>
        ))}
      </div>
      <div className="cal-body" style={{ height: HOURS.length * ROW }}>
        {HOURS.map((h, i) => (
          <span key={h} className="cal-hour" style={{ top: i * ROW }}>
            {h} h
          </span>
        ))}
        {columns.map((c, ci) => {
          // Tasks that overlap share their column side by side instead of piling up.
          const own = tasks
            .filter(c.filter)
            .map((t) => {
              const start = Math.min(Math.max(hourOf(t.startedAt ?? t.scheduledAt), HOURS[0]!), HOURS.at(-1)! + 0.5);
              const end = Math.max(t.endedAt ? hourOf(t.endedAt) : start + 1, start + 0.75);
              return { t, start, end, lane: 0 };
            })
            .sort((a, b) => a.start - b.start);
          // Work that overlaps (often a few minutes each) is grouped in one block: « titre + 2 autres ».
          const groups: { items: typeof own; start: number; end: number }[] = [];
          for (const b of own) {
            const last = groups.at(-1);
            if (last && b.start < last.end) {
              last.items.push(b);
              last.end = Math.max(last.end, b.end);
            } else groups.push({ items: [b], start: b.start, end: b.end });
          }
          const col = `(100% - 44px) / ${columns.length}`;
          return groups.map(({ items, start, end }) => {
            const t = items[0]!.t;
            const height = Math.max((Math.min(end, HOURS.at(-1)! + 1) - start) * ROW - 4, items.length > 1 ? 54 : 34);
            const agent = state.agents[t.agentId];
            const status = items.some((i) => i.t.status === "running") ? items.find((i) => i.t.status === "running")!.t : t;
            return (
              <button
                key={t.id}
                className={`cal-block ${blockClass(status, now)}`}
                style={{ left: `calc(44px + ${col} * ${ci} + 3px)`, width: `calc(${col} - 6px)`, top: (start - HOURS[0]!) * ROW + 2, height }}
                onClick={() => onSelect(status)}
                title={items.map((i) => i.t.title).join("\n")}
              >
                <span className="cal-block-top">
                  {showAgent && agent && <PixelAvatar role={agent.role} size={14} />}
                  {fmt.hour(t.startedAt ?? t.scheduledAt)}
                </span>
                <span>{status.title}</span>
                {items.length > 1 && <span className="cal-more-inline">+ {items.length - 1} autre{items.length > 2 ? "s" : ""}</span>}
              </button>
            );
          });
        })}
        {(() => {
          // The « now » line spans the whole day view, or only today's column in the week view.
          const today = columns.findIndex((c) => c.today);
          if (today < 0 && !columns.every((c) => c.day === startOfDay(now))) return null;
          const col = `(100% - 44px) / ${columns.length}`;
          const style = today < 0 ? { top: (hourOf(now) - HOURS[0]!) * ROW } : { top: (hourOf(now) - HOURS[0]!) * ROW, left: `calc(44px + ${col} * ${today})`, width: `calc(${col})`, right: "auto" };
          return <span className="cal-now" style={style} />;
        })()}
      </div>
    </section>
  );
}

function MonthGrid({ tasks, from, to, now, state, onSelect }: { tasks: Task[]; from: number; to: number; now: number; state: CompanyState; onSelect(t: Task): void }) {
  const first = from - ((new Date(from).getDay() + 6) % 7) * DAY;
  const days: number[] = [];
  for (let d = first; d < to || days.length % 7 !== 0; d += DAY) days.push(startOfDay(d + 3_600_000));
  return (
    <section className="card month">
      {["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].map((d) => (
        <span key={d} className="month-head muted small">
          {d}
        </span>
      ))}
      {days.map((d) => {
        const own = tasks.filter((t) => startOfDay(t.startedAt ?? t.scheduledAt) === d);
        const outside = d < from || d >= to;
        return (
          <div key={d} className={`month-cell${outside ? " outside" : ""}`}>
            <span className={d === startOfDay(now) ? "month-day today" : "month-day"}>{new Date(d).getDate()}</span>
            {own.slice(0, 2).map((t) => (
              <button key={t.id} className={`month-task ${blockClass(t, now)}`} onClick={() => onSelect(t)}>
                {state.agents[t.agentId] && <PixelAvatar role={state.agents[t.agentId]!.role} size={12} />}
                <span>{t.title}</span>
              </button>
            ))}
            {own.length > 2 && <span className="muted small">+ {own.length - 2} autre{own.length - 2 > 1 ? "s" : ""}</span>}
          </div>
        );
      })}
    </section>
  );
}

// ---------- Recrutements prévus ----------

function Recrutements({ state }: { state: CompanyState }) {
  const r = recruitments(state);
  const margaux = Object.values(state.agents).find((a) => a.role === "cofondateur");
  return (
    <>
      <h1>Recrutements prévus</h1>
      <section className="fil-list">
        <article className="publication">
          <header className="post-head">
            <PixelAvatar role="cofondateur" size={36} />
            <span className="name">{margaux?.name ?? "Margaux"}</span>
            <span className="muted">· Co-fondatrice</span>
          </header>
          <p className="text">
            {r.planned.length === 0
              ? "Toute l'équipe prévue est là. Je ferai venir quelqu'un d'autre seulement si l'entreprise en a vraiment besoin."
              : "Je fais venir chacun quand l'entreprise en a besoin, pas avant : chaque coéquipier a un coût en dépense IA."}
          </p>
          {r.planned.length > 0 && (
            <div className="attachment">
              <span className="attachment-title">À venir</span>
              <span className="attachment-table">
                {r.planned.map((p) => (
                  <span key={p.role.id} className="attachment-row recruit-row">
                    <span>
                      <PixelAvatar role={p.role.id} size={20} dim /> {p.role.defaultName} · {p.role.title}
                    </span>
                    <span className="muted">
                      {p.when}
                      {p.why ? ` · ${p.why}` : ""}
                    </span>
                  </span>
                ))}
              </span>
            </div>
          )}
        </article>
      </section>
      <section className="card">
        <header className="card-head">
          <span>Arrivés</span>
          <span className="muted">{r.arrived.length}</span>
        </header>
        {r.arrived.map(({ agent, title }) => (
          <div key={agent.id} className="member-row">
            <PixelAvatar role={agent.role} size={28} />
            <div className="member-text">
              <div>{agent.name}</div>
              <div className="muted small">
                {title} · arrivé{agent.role === "cofondateur" || agent.role === "recherche" || agent.role === "redaction" || agent.role === "technique" ? "e" : ""} le {fmt.day(agent.hiredAt)}
              </div>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

// ---------- Journal ----------

function useEvents(seq: number): StoredEvent[] {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  useEffect(() => {
    void window.narthex.call("events.read", {}).then(setEvents);
  }, [seq]);
  return events;
}

function Journal({ state, onAgent }: { state: CompanyState; onAgent(id: string): void }) {
  const events = useEvents(state.lastSeq);
  const [search, setSearch] = useState("");
  const [agentId, setAgentId] = useState<string>();
  const all = journalEntries(state, events);
  const q = search.trim().toLowerCase();
  const rows = all.filter((e) => (!agentId || e.agentId === agentId) && (!q || `${e.text} ${e.detail ?? ""}`.toLowerCase().includes(q)));
  let lastDay = "";
  return (
    <>
      <h1>Journal</h1>
      <div className="journal-tools">
        <input className="search" placeholder="Rechercher une action" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher dans le journal" />
        <div className="chips">
          <button className={!agentId ? "chip on" : "chip"} onClick={() => setAgentId(undefined)}>
            Tous
          </button>
          {Object.values(state.agents).map((a) => (
            <button key={a.id} className={agentId === a.id ? "chip on" : "chip"} onClick={() => setAgentId(a.id)}>
              <PixelAvatar role={a.role} size={18} /> {a.name}
            </button>
          ))}
        </div>
      </div>
      <section className="card journal">
        {rows.length === 0 && <p className="muted small">Rien ne correspond.</p>}
        {rows.map((e, i) => {
          const day = fmt.day(e.at);
          const head = day !== lastDay;
          lastDay = day;
          const agent = e.agentId ? state.agents[e.agentId] : undefined;
          return (
            <div key={i}>
              {head && <p className="journal-day muted small">{day}</p>}
              <div className={`journal-row ${e.kind}`}>
                <span className="muted small journal-hour">{fmt.hour(e.at)}</span>
                {agent ? (
                  <button className="journal-avatar" onClick={() => onAgent(agent.id)} aria-label={agent.name}>
                    <PixelAvatar role={agent.role} size={24} />
                  </button>
                ) : (
                  <PixelAvatar founder size={24} />
                )}
                <div>
                  <div className="small">{e.text}</div>
                  {e.detail && <div className="muted small">{e.detail}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

// ---------- Fiche agent ----------

function AgentPage({ state, status, agentId, onBack, onChange }: { state: CompanyState; status: EngineStatus; agentId: string; onBack(): void; onChange(): void }) {
  const sheet = agentSheet(state, agentId, status.now);
  const [open, setOpen] = useState<Deliverable>();
  const [cancelling, setCancelling] = useState<Task>();
  const { agent } = sheet;
  const she = ["cofondateur", "recherche", "redaction", "technique"].includes(agent.role);
  return (
    <div className="columns agent-page">
      <aside className="side agent-card-col">
        <section className="card agent-card">
          <div className="agent-portrait">
            <PixelAvatar role={agent.role} size={96} />
          </div>
          <h2>{agent.name}</h2>
          <p className="muted">{sheet.title}</p>
          <p className="muted small">
            Arrivé{she ? "e" : ""} le {fmt.day(agent.hiredAt)}
          </p>
          <div className="kpi">
            <span>Cette semaine</span>
            <span>{sheet.stats.hoursThisWeek < 1 ? `${Math.round(sheet.stats.hoursThisWeek * 60)} min` : `${Math.round(sheet.stats.hoursThisWeek)} h`}</span>
          </div>
          <div className="kpi">
            <span>XP apportée</span>
            <span>{sheet.stats.xp}</span>
          </div>
          <div className="kpi">
            <span>Missions terminées</span>
            <span>{sheet.stats.done}</span>
          </div>
          <div className="kpi">
            <span>Pas abouties</span>
            <span>{sheet.stats.failed}</span>
          </div>
          {sheet.sources.length > 0 && (
            <div className="chips">
              {sheet.sources.slice(0, 8).map((s) => (
                <span key={s} className="chip static">
                  {s.length > 24 ? `${s.slice(0, 23)}…` : s}
                </span>
              ))}
            </div>
          )}
        </section>
      </aside>
      <div className="main">
        <button className="link" onClick={onBack}>
          ← Équipe
        </button>
        <h3 className="agent-h">En ce moment</h3>
        {sheet.current ? (
          <div className="agent-item">
            <div>{sheet.current.title}</div>
            <div className="muted small">Pourquoi : {sheet.current.why}</div>
            {sheet.current.progress && sheet.current.progress !== "Au travail…" && <div className="small accent">{sheet.current.progress}</div>}
            <div className="progress indeterminate" />
          </div>
        ) : (
          <p className="muted small">{status.runtime === "none" ? "Attend ta clé pour se mettre au travail." : "Au repos."}</p>
        )}
        <h3 className="agent-h">
          Ce qu'{she ? "elle" : "il"} a décidé de faire ensuite <span className="muted small">Tu peux annuler une mission, jamais besoin d'en lancer une.</span>
        </h3>
        {sheet.next.length === 0 && <p className="muted small">Rien de prévu pour l'instant.</p>}
        {sheet.next.map((t) => {
          const cancellable = t.kind === "external" && (t.cancellableUntil ?? 0) > status.now;
          return (
            <div key={t.id} className="agent-item row">
              <div>
                <div>{t.title}</div>
                <div className="muted small">Pourquoi : {t.why}</div>
              </div>
              <div className="agent-when">
                <span className="small accent">{whenNext(Math.max(t.scheduledAt, t.cancellableUntil ?? 0), status.now)}</span>
                {cancellable && (
                  <button className="btn btn-quiet" onClick={() => setCancelling(t)}>
                    Annuler
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <h3 className="agent-h">Terminées</h3>
        {sheet.finished.length === 0 && <p className="muted small">Pas encore de mission terminée.</p>}
        {sheet.finished.map(({ task, result, deliverableId }) => (
          <button key={task.id} className="agent-item row clickable" onClick={() => deliverableId && setOpen(state.deliverables[deliverableId])} disabled={!deliverableId}>
            <div>
              <div>{task.title}</div>
              {result && <div className="muted small">Résultat : {result}</div>}
            </div>
            <span className="muted small">{fmt.relative(task.endedAt ?? task.createdAt, status.now)}</span>
          </button>
        ))}
      </div>
      {open && <DeliverableView d={open} state={state} status={status} onClose={() => setOpen(undefined)} onChange={onChange} />}
      {cancelling && (
        <ActionModal
          mission={{
            id: cancelling.id,
            kind: "cancel",
            eyebrow: `Part ${fmt.relative(cancelling.cancellableUntil!, status.now)} · tu peux l'annuler`,
            title: cancelling.title,
            why: cancelling.why,
            speakerId: cancelling.agentId,
            action: "cancel",
            label: "Voir",
            taskId: cancelling.id,
          }}
          state={state}
          now={status.now}
          onClose={() => setCancelling(undefined)}
          onDone={onChange}
        />
      )}
    </div>
  );
}

/** A planned task whose time has passed waits for a free agent (or a key): say so, not « il y a 3 h ». */
function whenNext(at: number, now: number): string {
  return at <= now ? "dès que possible" : fmt.relative(at, now);
}

// ---------- Right column ----------

function TeamNumbers({ state, status }: { state: CompanyState; status: EngineStatus }) {
  const o = orgChart(state, status.now);
  const rows = [o.cofounder, ...o.members].filter(Boolean) as TeamRow[];
  const hours = rows.reduce((h, r) => h + r.hoursThisWeek, 0);
  return (
    <section className="card">
      <header className="card-head">
        <span>Les chiffres</span>
        <span className="muted">cette semaine</span>
      </header>
      <div className="kpi">
        <div>
          <div>Agents</div>
          <div className="muted small">{o.upcoming.length ? `${o.upcoming.length} à venir` : "Toute l'équipe prévue est là"}</div>
        </div>
        <div className="kpi-value">{rows.length}</div>
      </div>
      <div className="kpi">
        <div>
          <div>Travail de l'équipe</div>
          <div className="muted small">Sans toi</div>
        </div>
        <div className="kpi-value">{hours < 1 ? `${Math.round(hours * 60)} min` : `${Math.round(hours)} h`}</div>
      </div>
      <div className="kpi">
        <div>
          <div>Dépense IA</div>
          <div className="muted small">Depuis le début</div>
        </div>
        <div className="kpi-value">{fmt.dollars(state.usage.credits)}</div>
      </div>
    </section>
  );
}

function NowCard({ state, status, onAgent }: { state: CompanyState; status: EngineStatus; onAgent(id: string): void }) {
  const o = orgChart(state, status.now);
  const rows = [o.cofounder, ...o.members].filter(Boolean) as TeamRow[];
  return (
    <section className="card">
      <header className="card-head">
        <span>En ce moment</span>
      </header>
      {rows.map((r) => (
        <button key={r.agent.id} className={`member-row as-button${r.status === "idle" ? " resting" : ""}`} onClick={() => onAgent(r.agent.id)}>
          <PixelAvatar role={r.agent.role} size={28} />
          <div className="member-text">
            <div>{r.agent.name}</div>
            <div className="muted small">{r.current ? r.current.title : r.status === "waiting-you" ? "T'attend" : "Au repos"}</div>
          </div>
          <span className={`status-dot ${r.status}`} />
        </button>
      ))}
    </section>
  );
}

