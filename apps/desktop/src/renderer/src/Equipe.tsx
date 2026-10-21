import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  agentSheet,
  calendar,
  calendarSummary,
  fmt,
  forFounder,
  journalEntries,
  journalSummary,
  missions,
  orgChart,
  overview,
  recruitments,
  role,
  type CompanyState,
  type Deliverable,
  type EngineStatus,
  type JournalEntry,
  type Mission,
  type RoleId,
  type StoredEvent,
  type Task,
  type TeamRow,
} from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { DeliverableView } from "./Deliverable.tsx";
import { Check, DownloadIcon, FilterIcon, SearchIcon } from "./equipe-icons.tsx";
import { Chevron, Clock } from "./icons.tsx";
import { Memoire, MemoireNumbers } from "./Memoire.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";
import { SectionTabs } from "./SectionTabs.tsx";
import "./equipe.css";

export type EquipeView = "Organigramme" | "Calendrier" | "Recrutements prévus" | "Journal" | "Mémoire";
const VIEWS: EquipeView[] = ["Organigramme", "Calendrier", "Recrutements prévus", "Journal", "Mémoire"];

/** Roles whose default teammate is a woman: French agreement (« arrivée », « elle »). */
const SHE: readonly RoleId[] = ["cofondateur", "recherche", "redaction", "technique"];

/** The Équipe tab (Figma « Équipe · … » frames): who works, when, who comes next, and everything they did. */
export function Equipe({
  state,
  status,
  view,
  agentId,
  onView,
  onAgent,
  onBureau,
  onChange,
}: {
  state: CompanyState;
  status: EngineStatus;
  view: EquipeView;
  agentId?: string;
  onView(v: EquipeView): void;
  onAgent(id?: string): void;
  /** Opens the Bureau, where the founder walks up to an agent to talk. */
  onBureau?(): void;
  onChange(): void;
}) {
  if (agentId && state.agents[agentId]) return <AgentPage state={state} status={status} agentId={agentId} onBack={() => onAgent(undefined)} onBureau={onBureau} onChange={onChange} />;
  const page = (side: ReactNode, main: ReactNode) => (
    <div className="columns">
      <div className="main eq-main">
        <SectionTabs items={VIEWS} active={view} onSelect={onView} />
        {main}
      </div>
      <aside className="side">{side}</aside>
    </div>
  );
  if (view === "Calendrier") return <Calendrier state={state} status={status} page={page} onAgent={onAgent} onChange={onChange} />;
  if (view === "Recrutements prévus") return <Recrutements state={state} status={status} page={page} onBureau={onBureau} />;
  if (view === "Journal") return <Journal state={state} status={status} page={page} onAgent={onAgent} />;
  if (view === "Mémoire")
    return page(<MemoireNumbers state={state} status={status} />, <Memoire state={state} status={status} onAgent={onAgent} onChange={onChange} />);
  return <Organigramme state={state} status={status} page={page} onAgent={onAgent} onView={onView} onBureau={onBureau} onChange={onChange} />;
}

type Page = (side: ReactNode, main: ReactNode) => ReactNode;

// ---------- Shared pieces (Figma « Narthex — Components ») ----------

/** The status card at the top of a page (same grammar as the Fil's pilot): a dot, a line, a quiet action. */
function StatusCard({ tone, title, sub, action }: { tone: "on" | "waiting"; title: string; sub: string; action?: { label: string; onClick(): void } }) {
  return (
    <section className="pilot eq-status">
      <span className={`pilot-dot ${tone}`} />
      <div className="eq-status-text">
        <div>{title}</div>
        <div className="muted small">{sub}</div>
      </div>
      {action && (
        <button className="btn btn-quiet" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </section>
  );
}

/** « Les chiffres »: a titled card of label / sub-label / big value rows. */
function Numbers({ title, aside, rows }: { title: string; aside?: string; rows: { label: string; sub?: string; value: ReactNode; text?: boolean }[] }) {
  return (
    <section className="card eq-numbers">
      <header className="card-head">
        <span>{title}</span>
        {aside && <span className="muted eq-aside">{aside}</span>}
      </header>
      {rows.map((r) => (
        <div key={r.label} className="eq-number">
          <div>
            <div>{r.label}</div>
            {r.sub && <div className="muted small">{r.sub}</div>}
          </div>
          <div className={r.text ? "eq-number-text" : "eq-number-value"}>{r.value}</div>
        </div>
      ))}
    </section>
  );
}

/** A list of people (« En ce moment », « Arrivés »): avatar, name, one muted line; resting people fade. */
function People({ title, aside, rows }: { title: string; aside?: string; rows: { id: string; role: RoleId; name: string; line: string; resting?: boolean; onClick?(): void }[] }) {
  return (
    <section className="card eq-people">
      <header className="card-head">
        <span>{title}</span>
        {aside && <span className="muted eq-aside">{aside}</span>}
      </header>
      {rows.map((r) => (
        <button key={r.id} className={`eq-person${r.resting ? " resting" : ""}`} onClick={r.onClick} disabled={!r.onClick}>
          <PixelAvatar role={r.role} size={32} />
          <span className="eq-person-text">
            <span>{r.name}</span>
            <span className="muted small">{r.line}</span>
          </span>
        </button>
      ))}
    </section>
  );
}

function hours(h: number): string {
  return h < 1 ? `${Math.round(h * 60)} min` : `${Math.round(h)} h`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function teamRows(state: CompanyState, now: number): TeamRow[] {
  const o = orgChart(state, now);
  return [o.cofounder, ...o.members].filter(Boolean) as TeamRow[];
}

/** What an agent is doing, in one line: the task, what it waits for, or when it starts again. */
function statusLine(row: TeamRow, state: CompanyState, status: EngineStatus): string {
  if (row.current) return row.current.progress && row.current.progress !== "Au travail…" ? row.current.progress : row.current.title;
  if (row.status === "waiting-you") return "T'attend";
  if (state.company?.paused) return "En pause";
  const next = Object.values(state.tasks)
    .filter((t) => t.agentId === row.agent.id && t.status === "planned" && t.kind !== "founder")
    .map((t) => Math.max(t.scheduledAt, t.cancellableUntil ?? 0))
    .sort((a, b) => a - b)[0];
  if (next === undefined) return "Au repos";
  if (status.runtime === "none") return "Attend ta clé";
  if (next <= status.now) return "Reprend dès que possible";
  return fmt.dayKey(next) === fmt.dayKey(status.now) ? `Au repos jusqu'à ${fmt.hour(next)}` : `Au repos, reprend ${fmt.day(next)}`;
}

function margauxOf(state: CompanyState) {
  return Object.values(state.agents).find((a) => a.role === "cofondateur");
}

/** A message from Margaux, in the Fil's publication grammar. */
function MargauxPost({ state, children, time }: { state: CompanyState; children: ReactNode; time?: string }) {
  const margaux = margauxOf(state);
  return (
    <article className="publication">
      <header className="post-head">
        <PixelAvatar role="cofondateur" size={36} />
        <span className="name">{margaux?.name ?? role("cofondateur").defaultName}</span>
        <span className="muted">· {role("cofondateur").title}</span>
        {time && <span className="muted time">{time}</span>}
      </header>
      {children}
    </article>
  );
}

// ---------- Organigramme (Figma 208:27577) ----------

function Organigramme({
  state,
  status,
  page,
  onAgent,
  onView,
  onBureau,
  onChange,
}: {
  state: CompanyState;
  status: EngineStatus;
  page: Page;
  onAgent(id: string): void;
  onView(v: EquipeView): void;
  onBureau?(): void;
  onChange(): void;
}) {
  const o = orgChart(state, status.now);
  const rows = teamRows(state, status.now);
  const [legal, setLegal] = useState<Mission>();
  const forYou = forFounder(state);
  const legalMission = missions(state, status.now, status.runtime).find((m) => m.kind === "legal");
  const margaux = margauxOf(state);
  const company = state.company;
  const paused = company?.paused;
  const working = rows.filter((r) => r.status === "working").length;
  const hoursWeek = rows.reduce((h, r) => h + r.hoursThisWeek, 0);

  const side = (
    <>
      <Numbers
        title="Les chiffres"
        aside="cette semaine"
        rows={[
          { label: "Agents", sub: o.upcoming[0] ? `${capitalize(o.upcoming[0].role.title.toLowerCase())} : arrive ${o.upcoming[0].when}` : "Toute l'équipe prévue est là", value: rows.length },
          { label: "Travail de l'équipe", sub: "Sans toi", value: hours(hoursWeek) },
          { label: "Dépense IA", sub: company ? `Depuis le ${fmt.day(company.foundedAt)}` : "Depuis le début", value: fmt.dollars(state.usage.credits) },
        ]}
      />
    </>
  );

  return page(
    side,
    <>
      <h1>Ton équipe</h1>
      <StatusCard
        tone={paused || status.runtime === "none" ? "waiting" : "on"}
        title={
          paused
            ? `L'équipe de ${company?.name ?? "ton entreprise"} est en pause`
            : `${rows.length} agent${rows.length > 1 ? "s" : ""} ${rows.length > 1 ? "travaillent" : "travaille"} pour ${company?.name ?? "toi"}`
        }
        sub={`Organisation à plat · ${status.runtime === "none" ? "attend ta clé pour se mettre au travail" : working ? `${working} au travail en ce moment` : `${margaux?.name ?? "Margaux"} recrute quand le besoin arrive`}`}
        {...(onBureau && margaux ? { action: { label: `Parler à ${margaux.name}`, onClick: onBureau } } : {})}
      />
      <section className="fil-list eq-list">
        {forYou[0] && (
          <button className={`eq-row${legalMission ? " clickable" : ""}`} onClick={() => legalMission && setLegal(legalMission)} disabled={!legalMission}>
            <PixelAvatar founder size={36} />
            <span className="eq-row-who">
              <span className="eq-row-name">{o.founder}</span>
              <span className="muted small">Fondatrice · toi</span>
            </span>
            <span className="eq-row-what">
              <span className="status-dot waiting-you" />
              <span>
                {forYou[0].title} t'attend{forYou.length > 1 ? ` (+ ${forYou.length - 1})` : ""}
                <span className="muted small block">La loi te le réserve</span>
              </span>
            </span>
          </button>
        )}
        {rows.map((r) => (
          <AgentRow key={r.agent.id} row={r} state={state} status={status} onClick={() => onAgent(r.agent.id)} />
        ))}
        {o.upcoming.map((u) => (
          <div key={u.role.id} className="eq-row ghost">
            <span className="eq-slot" />
            <span className="eq-row-who">
              <span className="eq-row-name">{u.role.title}</span>
              <span className="muted small">Arrive {u.when}</span>
            </span>
            <span className="eq-row-what muted">{u.why}</span>
          </div>
        ))}
      </section>
      {margaux && (
        <section className="fil-list">
          <MargauxPost state={state}>
            <p className="text">
              J'ai monté une petite équipe, chacun sur un domaine. Pas de chef intermédiaire : tout le monde me parle directement, et je te parle à toi. On grandira quand le travail le
              demandera.
            </p>
            <div className="actions">
              <button className="btn btn-secondary" onClick={() => onView("Recrutements prévus")}>
                Recrutements prévus
              </button>
              <button className="btn btn-quiet" onClick={() => onView("Journal")}>
                Ce qu'on a fait
              </button>
            </div>
          </MargauxPost>
        </section>
      )}
      {legal && <ActionModal mission={legal} state={state} now={status.now} onClose={() => setLegal(undefined)} onDone={onChange} />}
    </>,
  );
}

/** One teammate: what they are doing and since when, or what comes next for them. */
function AgentRow({ row, state, status, onClick }: { row: TeamRow; state: CompanyState; status: EngineStatus; onClick(): void }) {
  const next = Object.values(state.tasks)
    .filter((t) => t.agentId === row.agent.id && t.status === "planned" && t.kind !== "founder" && t.id !== row.current?.id)
    .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
  const since = row.current?.startedAt ? fmt.duration(status.now - row.current.startedAt) : undefined;
  const detail = row.current
    ? [row.current.progress && row.current.progress !== "Au travail…" ? row.current.title : "", since ? `depuis ${since}` : ""].filter(Boolean).join(" · ")
    : next
      ? `Ensuite : ${lowerFirst(next.title)}`
      : "";
  return (
    <button className="eq-row clickable" onClick={onClick}>
      <PixelAvatar role={row.agent.role} size={36} />
      <span className="eq-row-who">
        <span className="eq-row-name">{row.agent.name}</span>
        <span className="muted small">{row.title}</span>
      </span>
      <span className="eq-row-what">
        <span className={`status-dot ${row.status}`} />
        <span>
          {statusLine(row, state, status)}
          {detail && <span className="muted small block">{detail}</span>}
        </span>
      </span>
    </button>
  );
}

// ---------- Calendrier (Figma 205:26380 semaine, 205:27440 jour, 206:26380 mois, 206:27571 semaine d'un agent) ----------

type Scope = "Jour" | "Semaine" | "Mois";
const DAY = 86_400_000;
const DATE = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", o);

/** Office hours by default, widened to whatever the team really did: agents also work at night. */
function hoursFor(tasks: readonly Task[], visible: (t: Task) => boolean): number[] {
  let first = 8;
  let last = 19;
  for (const t of tasks) {
    if (!visible(t)) continue;
    // Start hours only: an interrupted task « ends » whenever Narthex reopened, often the next day.
    const start = new Date(t.startedAt ?? t.scheduledAt);
    first = Math.min(first, start.getHours());
    last = Math.max(last, start.getHours() + 3);
  }
  return Array.from({ length: Math.min(24, last + 1) - first }, (_, i) => first + i);
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function weekLabel(from: number): string {
  const to = from + 6 * DAY;
  const sameMonth = new Date(from).getMonth() === new Date(to).getMonth();
  return `Semaine du ${DATE(sameMonth ? { day: "numeric" } : { day: "numeric", month: "long" }).format(from)} au ${DATE({ day: "numeric", month: "long" }).format(to)}`;
}

function blockClass(t: Task, now: number): string {
  if (t.status === "done") return "done";
  if (t.status === "running") return "running";
  if (t.status === "failed") return "failed";
  return t.kind === "external" && (t.cancellableUntil ?? 0) > now ? "external" : "planned";
}

function Calendrier({ state, status, page, onAgent, onChange }: { state: CompanyState; status: EngineStatus; page: Page; onAgent(id: string): void; onChange(): void }) {
  const [scope, setScope] = useState<Scope>("Semaine");
  const [anchor, setAnchor] = useState(() => startOfDay(status.now));
  const [agentId, setAgentId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const agents = Object.values(state.agents).sort((a, b) => a.hiredAt - b.hiredAt);
  const filtered = scope === "Jour" ? undefined : agentId;

  const range = useMemo(() => {
    if (scope === "Jour") return { from: anchor, to: anchor + DAY, label: capitalize(DATE({ weekday: "long", day: "numeric", month: "long" }).format(anchor)) };
    if (scope === "Semaine") {
      const from = anchor - ((new Date(anchor).getDay() + 6) % 7) * DAY;
      return { from, to: from + 7 * DAY, label: weekLabel(from) };
    }
    const d = new Date(anchor);
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    return { from, to, label: capitalize(DATE({ month: "long", year: "numeric" }).format(from)) };
  }, [scope, anchor]);
  const tasks = calendar(state, range.from, range.to, filtered);
  const summary = calendarSummary(state, range.from, range.to, filtered);
  // The selected task stays in the side column while it is on screen.
  const selected = selectedId ? tasks.find((t) => t.id === selectedId) : undefined;
  const step = (dir: number) => {
    if (scope === "Mois") {
      const d = new Date(anchor);
      setAnchor(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime());
    } else setAnchor(anchor + dir * (scope === "Jour" ? 1 : 7) * DAY);
  };
  const filteredAgent = filtered ? state.agents[filtered] : undefined;
  const period = scope === "Jour" ? "Ce jour-là" : scope === "Semaine" ? "Cette semaine" : "Ce mois-ci";
  const isCurrent = status.now >= range.from && status.now < range.to;
  const periodTitle = isCurrent ? (scope === "Jour" ? "Aujourd'hui" : period) : scope === "Jour" ? "Ce jour-là" : scope === "Semaine" ? "Cette semaine-là" : "Ce mois-là";
  const aside =
    scope === "Jour"
      ? fmt.day(range.from)
      : scope === "Semaine"
        ? `${DATE({ day: "numeric" }).format(range.from)} – ${DATE({ day: "numeric", month: "short" }).format(range.to - DAY)}`
        : DATE({ month: "long" }).format(range.from);
  const deadlines = scope === "Mois" && !filtered ? overview(state, status.now).deadlines.filter((d) => d.due >= status.now).slice(0, 4) : [];

  const side = (
    <>
      {selected && <TaskCard task={selected} state={state} status={status} onAgent={onAgent} onClose={() => setSelectedId(undefined)} onChange={onChange} />}
      {filteredAgent ? (
        <section className="card eq-numbers">
          <header className="card-head">
            <span>
              {filteredAgent.name} {periodTitle.toLowerCase()}
            </span>
          </header>
          <div className="eq-who">
            <PixelAvatar role={filteredAgent.role} size={32} />
            <span>
              <span>
                {filteredAgent.name} · {role(filteredAgent.role).title}
              </span>
              <span className="muted small">
                {summary.total === 0
                  ? "Rien de prévu sur cette période"
                  : `${summary.total} tâche${summary.total > 1 ? "s" : ""}, ${summary.total > 1 ? "toutes décidées" : "décidée"} par ${SHE.includes(filteredAgent.role) ? "elle" : "lui"}`}
              </span>
            </span>
          </div>
          <div className="eq-number">
            <div>
              <div>Faites</div>
              <div className="muted small">{summary.running ? `${summary.running} en cours` : "Aucune en cours"}</div>
            </div>
            <div className="eq-number-value">{summary.done}</div>
          </div>
        </section>
      ) : (
        <Numbers
          title={periodTitle}
          aside={aside}
          rows={[
            { label: "Tâches", sub: "Décidées seules par l'équipe", value: summary.total },
            { label: "Faites", sub: summary.running ? `${summary.running} en cours` : "Aucune en cours", value: summary.done },
            ...(summary.forYou.length
              ? [{ label: "Pour toi", sub: summary.forYou.map((o) => capitalize(lowerFirst(o.title))).slice(0, 2).join(", "), value: summary.forYou.length }]
              : []),
          ]}
        />
      )}
      {deadlines.length > 0 && (
        <section className="card">
          <header className="card-head">
            <span>Prochaines grandes étapes</span>
          </header>
          {deadlines.map((d) => (
            <div key={d.title} className="eq-deadline">
              <span className="eq-deadline-date">
                <b>{new Date(d.due).getDate()}</b>
                <span className="muted small">{DATE({ month: "short" }).format(d.due)}</span>
              </span>
              <span>
                <span>{d.title}</span>
                <span className="muted small">{d.who}</span>
              </span>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <header className="card-head">
          <span>Légende</span>
        </header>
        <div className="eq-legend">
          <span>
            <i className="eq-swatch done" /> Faite
          </span>
          <span>
            <i className="eq-swatch running" /> En cours
          </span>
          <span>
            <i className="eq-swatch planned" /> Prévue
          </span>
          <span>
            <i className="eq-swatch external" /> Prévue, annulable
          </span>
          <span>
            <i className="eq-swatch failed" /> Pas aboutie
          </span>
        </div>
      </section>
    </>
  );

  return page(
    side,
    <>
      <h1>Calendrier de l'équipe</h1>
      <div className="eq-cal-bar">
        <button className="icon-btn" aria-label="Précédent" onClick={() => step(-1)}>
          <Chevron left />
        </button>
        <button className="icon-btn" aria-label="Suivant" onClick={() => step(1)}>
          <Chevron />
        </button>
        <span className="eq-cal-label">{range.label}</span>
        <button className="btn btn-quiet" onClick={() => setAnchor(startOfDay(status.now))}>
          Aujourd'hui
        </button>
        <span className="segmented eq-segmented">
          {(["Jour", "Semaine", "Mois"] as Scope[]).map((s) => (
            <button key={s} className={s === scope ? "on" : ""} onClick={() => setScope(s)}>
              {s}
            </button>
          ))}
        </span>
      </div>
      {scope !== "Jour" && (
        <div className="chips eq-chips">
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
        <MonthGrid tasks={tasks} from={range.from} to={range.to} now={status.now} state={state} selectedId={selectedId} onSelect={(t) => setSelectedId(t.id)} />
      ) : (
        <HourGrid
          columns={
            scope === "Jour"
              ? agents.map((a) => ({ key: a.id, label: a.name, role: a.role, filter: (t: Task) => t.agentId === a.id, day: range.from, today: range.from === startOfDay(status.now) }))
              : Array.from({ length: 7 }, (_, i) => {
                  const day = range.from + i * DAY;
                  return {
                    key: String(day),
                    label: DATE({ weekday: "short" }).format(day),
                    sub: String(new Date(day).getDate()),
                    filter: (t: Task) => startOfDay(t.startedAt ?? t.scheduledAt) === day,
                    day,
                    today: day === startOfDay(status.now),
                  };
                })
          }
          byAgent={scope === "Jour"}
          tasks={tasks}
          state={state}
          now={status.now}
          showAgent={scope !== "Jour" && !agentId}
          selectedId={selectedId}
          onSelect={(t) => setSelectedId(t.id)}
        />
      )}
    </>,
  );
}

/** The selected task, in the side column (Figma « Tâche » card): who, when, why, its state, and what can be done. */
function TaskCard({ task, state, status, onAgent, onClose, onChange }: { task: Task; state: CompanyState; status: EngineStatus; onAgent(id: string): void; onClose(): void; onChange(): void }) {
  const [cancelling, setCancelling] = useState(false);
  const [open, setOpen] = useState<Deliverable>();
  const agent = state.agents[task.agentId];
  const now = status.now;
  const start = task.startedAt ?? task.scheduledAt;
  const cut = task.interrupted || (task.error ?? "").startsWith("Interrompue (Narthex");
  const end = task.endedAt && !cut && task.endedAt - start < DAY ? task.endedAt : undefined;
  const cancellable = task.status === "planned" && task.kind === "external" && (task.cancellableUntil ?? 0) > now;
  const leaves = Math.max(task.scheduledAt, task.cancellableUntil ?? 0);
  const deliverable = task.deliverableId ? state.deliverables[task.deliverableId] : undefined;
  const stateLine =
    task.status === "done"
      ? `Faite · ${fmt.relative(task.endedAt ?? start, now)}`
      : task.status === "running"
        ? `En cours · depuis ${fmt.duration(now - start)}`
        : task.status === "failed"
          ? cut
            ? "Interrompue · reprise plus tard"
            : "Pas aboutie"
          : cancellable
            ? `Prévue · part ${fmt.relative(leaves, now)}, tu peux l'annuler`
            : leaves <= now
              ? "Prévue · dès que possible"
              : `Prévue · ${fmt.relative(leaves, now)}`;
  return (
    <section className="card eq-task">
      <header className="eq-task-head">
        {agent && (
          <button className="eq-who as-link" onClick={() => onAgent(agent.id)}>
            <PixelAvatar role={agent.role} size={32} />
            <span>
              <span>{agent.name}</span>
              <span className="muted small">{role(agent.role).title}</span>
            </span>
          </button>
        )}
        <button className="eq-close" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </header>
      <h2 className="eq-task-title">{task.title}</h2>
      <div className="eq-field">
        <span className="muted small">Quand</span>
        <span>
          {capitalize(DATE({ weekday: "long", day: "numeric", month: "long" }).format(start))}, {fmt.hour(start)}
          {end ? ` – ${fmt.hour(end)}` : ""}
        </span>
      </div>
      <div className="eq-field">
        <span className="muted small">Pourquoi</span>
        <span>{task.why}</span>
      </div>
      {deliverable && (
        <div className="eq-field">
          <span className="muted small">Résultat</span>
          <span className="eq-clamp">{deliverable.summary}</span>
        </div>
      )}
      <div className="eq-field">
        <span className="muted small">État</span>
        <span className={task.status === "failed" && !cut ? "error" : "accent"}>{stateLine}</span>
      </div>
      {(cancellable || deliverable) && (
        <div className="actions">
          {cancellable && (
            <button className="btn btn-secondary" onClick={() => setCancelling(true)}>
              Annuler
            </button>
          )}
          {deliverable && (
            <button className={cancellable ? "btn btn-quiet" : "btn btn-secondary"} onClick={() => setOpen(deliverable)}>
              Voir le livrable
            </button>
          )}
        </div>
      )}
      {open && <DeliverableView d={open} state={state} status={status} onClose={() => setOpen(undefined)} onChange={onChange} />}
      {cancelling && (
        <ActionModal
          mission={{ id: task.id, kind: "cancel", eyebrow: `Part ${fmt.relative(task.cancellableUntil!, now)} · tu peux l'annuler`, title: task.title, why: task.why, speakerId: task.agentId, action: "cancel", label: "Voir", taskId: task.id }}
          state={state}
          now={now}
          onClose={() => setCancelling(false)}
          onDone={onChange}
        />
      )}
    </section>
  );
}

function HourGrid({
  columns,
  byAgent,
  tasks,
  state,
  now,
  showAgent,
  selectedId,
  onSelect,
}: {
  columns: { key: string; label: string; sub?: string; role?: RoleId; filter(t: Task): boolean; day: number; today?: boolean }[];
  byAgent: boolean;
  tasks: Task[];
  state: CompanyState;
  now: number;
  showAgent: boolean;
  selectedId?: string;
  onSelect(t: Task): void;
}) {
  const ROW = 58;
  const GUTTER = 44;
  const HOURS = hoursFor(tasks, (t) => columns.some((c) => c.filter(t)));
  // Open on the latest work shown (or the morning), not on empty night hours.
  const scroller = useRef<HTMLDivElement>(null);
  const latest = Math.max(8, ...tasks.filter((t) => columns.some((c) => c.filter(t))).map((t) => new Date(t.startedAt ?? t.scheduledAt).getHours()));
  useEffect(() => {
    scroller.current?.scrollTo({ top: Math.max(0, (latest - 2 - HOURS[0]!) * ROW) });
  }, [latest, HOURS[0]]);
  const hourOf = (ts: number) => {
    const d = new Date(ts);
    return d.getHours() + d.getMinutes() / 60;
  };
  const col = `(100% - ${GUTTER}px) / ${columns.length}`;
  return (
    <section className="card eq-cal" style={{ ["--cols" as string]: columns.length }}>
      <div className={`eq-cal-head${byAgent ? " by-agent" : ""}`}>
        <span />
        {columns.map((c) => (
          <span key={c.key} className={c.today && !byAgent ? "today" : ""}>
            {c.role && <PixelAvatar role={c.role} size={24} />}
            <span className="eq-cal-day">{c.label}</span>
            {c.sub && <span className="eq-cal-date">{c.sub}</span>}
          </span>
        ))}
      </div>
      <div className="eq-cal-scroll" ref={scroller}>
        <div className="eq-cal-body" style={{ height: HOURS.length * ROW }}>
          {HOURS.map((h, i) => (
            <span key={h} className="eq-cal-hour" style={{ top: i * ROW }}>
              <span>{h} h</span>
            </span>
          ))}
          {columns.map((c, ci) => (
            <span key={c.key} className="eq-cal-col" style={{ left: `calc(${GUTTER}px + ${col} * ${ci})`, width: `calc(${col})` }} />
          ))}
          {columns.map((c, ci) => {
            const own = tasks
              .filter(c.filter)
              .map((t) => {
                const start = Math.min(Math.max(hourOf(t.startedAt ?? t.scheduledAt), HOURS[0]!), HOURS.at(-1)! + 0.5);
                // An interrupted task « ends » when Narthex reopened: draw it short, not across the night.
                const cut = t.interrupted || (t.error ?? "").startsWith("Interrompue (Narthex");
                const end = Math.max(t.endedAt && !cut && t.endedAt - (t.startedAt ?? t.scheduledAt) < DAY ? hourOf(t.endedAt) : start + 1, start + 0.75);
                return { t, start, end };
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
            return groups.map(({ items, start, end }) => {
              const t = items[0]!.t;
              const height = Math.max((Math.min(end, HOURS.at(-1)! + 1) - start) * ROW - 4, items.length > 1 ? 92 : 66);
              const shown = items.find((i) => i.t.id === selectedId)?.t ?? items.find((i) => i.t.status === "running")?.t ?? t;
              const agent = state.agents[shown.agentId];
              return (
                <button
                  key={t.id}
                  className={`eq-block ${blockClass(shown, now)}${items.some((i) => i.t.id === selectedId) ? " selected" : ""}`}
                  style={{ left: `calc(${GUTTER}px + ${col} * ${ci} + 3px)`, width: `calc(${col} - 6px)`, top: (start - HOURS[0]!) * ROW + 2, height }}
                  onClick={() => onSelect(shown)}
                  title={items.map((i) => i.t.title).join("\n")}
                >
                  <span className="eq-block-top">
                    {showAgent && agent && <PixelAvatar role={agent.role} size={14} />}
                    {fmt.hour(shown.startedAt ?? shown.scheduledAt)}
                  </span>
                  <span className="eq-block-title">{shown.title}</span>
                  {items.length > 1 && <span className="eq-block-more">+ {items.length - 1} autre{items.length > 2 ? "s" : ""}</span>}
                </button>
              );
            });
          })}
          {(() => {
            // The « now » line spans the whole day view, or only today's column in the week view.
            const today = byAgent ? (columns[0]?.today ? 0 : -1) : columns.findIndex((c) => c.today);
            if (today < 0) return null;
            const top = (hourOf(now) - HOURS[0]!) * ROW;
            if (top < 0 || top > HOURS.length * ROW) return null;
            const style = byAgent ? { top, left: GUTTER, right: 0 } : { top, left: `calc(${GUTTER}px + ${col} * ${today})`, width: `calc(${col})` };
            return <span className="eq-now" style={style} />;
          })()}
        </div>
      </div>
    </section>
  );
}

function MonthGrid({
  tasks,
  from,
  to,
  now,
  state,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  from: number;
  to: number;
  now: number;
  state: CompanyState;
  selectedId?: string;
  onSelect(t: Task): void;
}) {
  const first = from - ((new Date(from).getDay() + 6) % 7) * DAY;
  const days: number[] = [];
  for (let d = first; d < to || days.length % 7 !== 0; d += DAY) days.push(startOfDay(d + 3_600_000));
  return (
    <section className="card eq-month">
      {["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].map((d) => (
        <span key={d} className="eq-month-head">
          {d}
        </span>
      ))}
      {days.map((d) => {
        const own = tasks.filter((t) => startOfDay(t.startedAt ?? t.scheduledAt) === d);
        const outside = d < from || d >= to;
        const date = new Date(d);
        return (
          <div key={d} className={`eq-month-cell${outside ? " outside" : ""}${own.length === 0 ? " empty" : ""}`}>
            <span className={d === startOfDay(now) ? "eq-month-day today" : "eq-month-day"}>
              {date.getDate() === 1 && outside ? DATE({ day: "numeric", month: "short" }).format(d) : date.getDate()}
            </span>
            {own.slice(0, 2).map((t) => (
              <button key={t.id} className={`eq-month-task ${blockClass(t, now)}${t.id === selectedId ? " selected" : ""}`} onClick={() => onSelect(t)} title={t.title}>
                {state.agents[t.agentId] && <PixelAvatar role={state.agents[t.agentId]!.role} size={12} />}
                <span>{t.title}</span>
              </button>
            ))}
            {own.length > 2 && <span className="eq-month-more">+ {own.length - 2} autre{own.length - 2 > 1 ? "s" : ""}</span>}
          </div>
        );
      })}
    </section>
  );
}

// ---------- Recrutements prévus (Figma 208:28150) ----------

function Recrutements({ state, status, page, onBureau }: { state: CompanyState; status: EngineStatus; page: Page; onBureau?(): void }) {
  const r = recruitments(state);
  const margaux = margauxOf(state);
  const [next, ...later] = r.planned;
  const name = margaux?.name ?? role("cofondateur").defaultName;

  const side = (
    <>
      <Numbers
        title="Les chiffres"
        aside="à venir"
        rows={[
          ...(next ? [{ label: "Prochain", sub: capitalize(next.when), value: next.role.title, text: true }] : []),
          { label: "Équipe prévue", sub: `${r.arrived.length} déjà là`, value: r.arrived.length + r.planned.length },
          { label: "Dépense IA", sub: "Toute l'équipe, depuis le début", value: fmt.dollars(state.usage.credits) },
        ]}
      />
      <People
        title="Arrivés"
        aside={String(r.arrived.length)}
        rows={r.arrived.map(({ agent, title }) => ({ id: agent.id, role: agent.role, name: agent.name, line: `${fmt.day(agent.hiredAt)} · ${title}` }))}
      />
    </>
  );

  return page(
    side,
    <>
      <h1>Recrutements prévus</h1>
      <StatusCard
        tone="on"
        title={`${name} recrute quand le besoin arrive`}
        sub="Pas avant : chaque agent ajoute de la dépense IA"
        {...(onBureau && margaux ? { action: { label: `Parler à ${name}`, onClick: onBureau } } : {})}
      />
      <section className="fil-list">
        {!next && (
          <MargauxPost state={state}>
            <p className="text">Toute l'équipe prévue est là. Je ferai venir quelqu'un d'autre seulement si l'entreprise en a vraiment besoin.</p>
          </MargauxPost>
        )}
        {next && (
          <MargauxPost state={state}>
            <p className="text">
              Le prochain à rejoindre l'équipe, c'est {next.role.defaultName} ({next.role.title.toLowerCase()}). Je {SHE.includes(next.role.id) ? "la" : "le"} fais venir {next.when}.
              {next.why ? ` ${next.why}` : ""}
            </p>
            <div className="attachment eq-recruit">
              <span className="eq-slot" />
              <span>
                <span className="attachment-title">
                  {next.role.defaultName} · {next.role.title}
                </span>
                <span className="muted small">Arrive {next.when}</span>
              </span>
            </div>
            <div className="actions">
              <span className="delay">
                <Clock /> Arrive {next.when}
              </span>
            </div>
          </MargauxPost>
        )}
        {later.length > 0 && (
          <MargauxPost state={state}>
            <p className="text">Et ensuite, si tout se passe comme prévu :</p>
            <div className="attachment eq-table">
              <span className="attachment-title">Plus tard</span>
              <div className="eq-table-row head">
                <span>Rôle</span>
                <span>Quand</span>
                <span>Pourquoi</span>
              </div>
              {later.map((p) => (
                <div key={p.role.id} className="eq-table-row">
                  <span>{p.role.title}</span>
                  <span>{capitalize(p.when)}</span>
                  <span>{p.why}</span>
                </div>
              ))}
              <span className="muted small eq-table-foot">Les dates suivent l'avancement de l'entreprise. {name} te prévient dans le Fil à chaque arrivée.</span>
            </div>
          </MargauxPost>
        )}
      </section>
    </>,
  );
}

// ---------- Journal (Figma 208:28557) ----------

function useEvents(seq: number): StoredEvent[] {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  useEffect(() => {
    void window.narthex.call("events.read", {}).then(setEvents);
  }, [seq]);
  return events;
}

const KINDS: { id: JournalEntry["kind"]; label: string }[] = [
  { id: "work", label: "Travail" },
  { id: "team", label: "Équipe" },
  { id: "company", label: "Entreprise" },
  { id: "founder", label: "Toi" },
  { id: "problem", label: "Problèmes" },
];
const PAGE = 60;

function Journal({ state, status, page, onAgent }: { state: CompanyState; status: EngineStatus; page: Page; onAgent(id: string): void }) {
  const events = useEvents(state.lastSeq);
  const [search, setSearch] = useState("");
  const [agentId, setAgentId] = useState("");
  const [kind, setKind] = useState("");
  const [shown, setShown] = useState(PAGE);
  const all = journalEntries(state, events);
  const summary = journalSummary(state, all, status.now);
  const q = search.trim().toLowerCase();
  const rows = all.filter((e) => (!agentId || e.agentId === agentId) && (!kind || e.kind === kind) && (!q || `${e.text} ${e.detail ?? ""}`.toLowerCase().includes(q)));
  const today = fmt.dayKey(status.now);
  const yesterday = fmt.dayKey(status.now - DAY);
  const dayLabel = (at: number) => (fmt.dayKey(at) === today ? "Aujourd'hui" : fmt.dayKey(at) === yesterday ? "Hier" : capitalize(fmt.day(at)));
  const exportRows = () => {
    const text = rows.map((e) => `${fmt.day(e.at)} ${fmt.hour(e.at)}\t${e.text}${e.detail ? `\t${e.detail.replace(/\s+/g, " ")}` : ""}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`Journal · ${state.company?.name ?? ""}\n\n${text}\n`], { type: "text/plain;charset=utf-8" }));
    a.download = "journal.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  let lastDay = "";

  const side = (
    <>
      <Numbers
        title="Les chiffres"
        {...(state.company ? { aside: `depuis le ${DATE({ day: "numeric", month: "short" }).format(state.company.foundedAt)}` } : {})}
        rows={[
          { label: "Actions", sub: "Tout ce qui s'est passé", value: summary.total },
          { label: "Aujourd'hui", sub: summary.todayAgents ? `Par ${summary.todayAgents} agent${summary.todayAgents > 1 ? "s" : ""}` : "Personne n'a encore agi", value: summary.today },
          { label: "Annulées par toi", sub: "Tu peux annuler une action prévue", value: summary.cancelledByYou },
        ]}
      />
      {summary.byRole.length > 0 && (
        <section className="card">
          <header className="card-head">
            <span>Par métier</span>
          </header>
          {summary.byRole.map((r) => (
            <div key={r.role} className="eq-type">
              <span>{r.title}</span>
              <span className="muted small">
                {r.count} action{r.count > 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );

  return page(
    side,
    <>
      <h1>Journal</h1>
      <div className="eq-tools">
        <label className="eq-search">
          <SearchIcon />
          <input placeholder="Rechercher une action" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher dans le journal" />
        </label>
        <label className="eq-filter">
          <FilterIcon />
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
            <option value="">Tous les agents</option>
            {Object.values(state.agents).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="eq-filter">
          <FilterIcon />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">Tous les types</option>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-secondary eq-export" onClick={exportRows} disabled={rows.length === 0}>
          <DownloadIcon /> Exporter
        </button>
      </div>
      <section className="card eq-journal">
        {rows.length === 0 && <p className="muted small">Rien ne correspond.</p>}
        {rows.slice(0, shown).map((e, i) => {
          const day = dayLabel(e.at);
          const head = day !== lastDay;
          lastDay = day;
          const agent = e.agentId ? state.agents[e.agentId] : undefined;
          return (
            <div key={i}>
              {head && <p className="eq-journal-day">{day}</p>}
              <div className={`eq-journal-row ${e.kind}`} title={e.detail}>
                <span className="eq-journal-hour">{fmt.hour(e.at)}</span>
                {agent ? (
                  <button className="journal-avatar" onClick={() => onAgent(agent.id)} aria-label={agent.name}>
                    <PixelAvatar role={agent.role} size={28} />
                  </button>
                ) : (
                  <PixelAvatar founder size={28} />
                )}
                <div className="eq-journal-text">
                  <div>{e.text}</div>
                  {e.detail && <div className="muted small">{e.detail}</div>}
                </div>
              </div>
            </div>
          );
        })}
        {rows.length > 0 && (
          <footer className="eq-journal-foot">
            <span className="muted small">
              {Math.min(shown, rows.length)} sur {rows.length} · survole une ligne pour lire le détail en entier
            </span>
            {rows.length > shown && (
              <button className="btn btn-quiet" onClick={() => setShown(shown + PAGE)}>
                Afficher plus
              </button>
            )}
          </footer>
        )}
      </section>
    </>,
  );
}

// ---------- Fiche agent (Figma 167:16930) ----------

function AgentPage({ state, status, agentId, onBack, onBureau, onChange }: { state: CompanyState; status: EngineStatus; agentId: string; onBack(): void; onBureau?(): void; onChange(): void }) {
  const sheet = agentSheet(state, agentId, status.now);
  const [open, setOpen] = useState<Deliverable>();
  const [cancelling, setCancelling] = useState<Task>();
  const { agent } = sheet;
  const she = SHE.includes(agent.role);
  const margaux = margauxOf(state);
  const recruited =
    agent.role === "cofondateur" ? `Là depuis le début, le ${fmt.day(agent.hiredAt)}` : `Recruté${she ? "e" : ""} le ${fmt.day(agent.hiredAt)}${margaux ? ` par ${margaux.name}` : ""}`;
  return (
    <div className="columns agent-page">
      <aside className="side">
        <section className="card eq-agent-card">
          <div className="eq-portrait">
            <PixelAvatar role={agent.role} size={84} />
          </div>
          <h2>{agent.name}</h2>
          <p className="eq-agent-role">{sheet.title}</p>
          <p className="muted small">{recruited}</p>
          <div className="eq-agent-stats">
            <div>
              <span>Cette semaine</span>
              <span>{hours(sheet.stats.hoursThisWeek)}</span>
            </div>
            <div>
              <span>XP apportée</span>
              <span>{sheet.stats.xp}</span>
            </div>
            <div>
              <span>Missions terminées</span>
              <span>{sheet.stats.done}</span>
            </div>
            <div>
              <span>Pas abouties</span>
              <span>{sheet.stats.failed}</span>
            </div>
          </div>
          {sheet.sourceSites.length > 0 && (
            <div className="chips eq-agent-sources">
              {sheet.sourceSites.slice(0, 6).map((s) => (
                <span key={s} className="chip static" title={s}>
                  {s.length > 18 ? `${s.slice(0, 17)}…` : s}
                </span>
              ))}
              {sheet.sourceSites.length > 6 && <span className="chip static muted">+ {sheet.sourceSites.length - 6}</span>}
            </div>
          )}
          {onBureau && (
            <button className="btn btn-secondary wide" onClick={onBureau}>
              Lui parler dans le bureau
            </button>
          )}
        </section>
      </aside>
      <div className="main eq-main">
        <button className="link" onClick={onBack}>
          ← Équipe
        </button>
        <h3 className="eq-h">En ce moment</h3>
        {sheet.current ? (
          <div className="eq-item">
            <div className="eq-item-line">
              <span>{sheet.current.title}</span>
              {sheet.current.startedAt && <span className="muted small">depuis {fmt.duration(status.now - sheet.current.startedAt)}</span>}
            </div>
            <div className="muted small">Pourquoi : {sheet.current.why}</div>
            {sheet.current.progress && sheet.current.progress !== "Au travail…" && <div className="small accent">{sheet.current.progress}</div>}
            <div className="progress indeterminate eq-progress" />
          </div>
        ) : (
          <p className="muted small eq-empty">{status.runtime === "none" ? "Attend ta clé pour se mettre au travail." : state.company?.paused ? "L'équipe est en pause." : "Au repos."}</p>
        )}
        <h3 className="eq-h">
          Ce qu'{she ? "elle" : "il"} a décidé de faire ensuite <span className="muted small">Tu peux annuler une mission, jamais besoin d'en lancer une.</span>
        </h3>
        {sheet.next.length === 0 && <p className="muted small eq-empty">Rien de prévu pour l'instant.</p>}
        {sheet.next.map((t) => {
          const cancellable = t.kind === "external" && (t.cancellableUntil ?? 0) > status.now;
          const at = Math.max(t.scheduledAt, t.cancellableUntil ?? 0);
          return (
            <div key={t.id} className="eq-item">
              <div className="eq-item-line">
                <span>{t.title}</span>
                <span className="small accent">{at <= status.now ? "dès que possible" : fmt.relative(at, status.now)}</span>
              </div>
              <div className="eq-item-line">
                <span className="muted small">Pourquoi : {t.why}</span>
                {cancellable && (
                  <button className="btn btn-secondary eq-small-btn" onClick={() => setCancelling(t)}>
                    Annuler
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <h3 className="eq-h">Ce qu'{she ? "elle" : "il"} a appris</h3>
        {sheet.lessons.length === 0 ? (
          <p className="muted small eq-empty">Rien encore : après chaque mission, l'équipe note ce qui a aidé ou gêné.</p>
        ) : (
          <>
            {sheet.lessons.map((l) => (
              <div key={l.id} className="eq-lesson">
                <span className="eq-lesson-check">
                  <Check />
                </span>
                <div>
                  <div>{l.text}</div>
                  <div className="muted small">
                    Appris le {fmt.day(l.learntAt)}
                    {l.helpful > 0 ? ` · utile ${l.helpful} fois` : ""}
                  </div>
                </div>
              </div>
            ))}
            <p className="muted small">Partagé par tous les agents {lowerFirst(sheet.title)}, appliqué à chaque mission.</p>
          </>
        )}
        <h3 className="eq-h">Terminées</h3>
        {sheet.finished.length === 0 && <p className="muted small eq-empty">Pas encore de mission terminée.</p>}
        {sheet.finished.map(({ task, result, deliverableId }) => (
          <button key={task.id} className="eq-item clickable" onClick={() => deliverableId && setOpen(state.deliverables[deliverableId])} disabled={!deliverableId}>
            <div className="eq-item-line">
              <span>{task.title}</span>
              <span className="muted small">{fmt.relative(task.endedAt ?? task.createdAt, status.now)}</span>
            </div>
            {result && <div className="muted small eq-clamp">Résultat : {result}</div>}
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
