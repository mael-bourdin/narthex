import { useState } from "react";
import {
  filView,
  fmt,
  missions,
  role,
  type CompanyState,
  type Deliverable,
  type EngineStatus,
  type FilItem,
  type FilView,
  type Mission,
  type Task,
} from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { DeliverableView } from "./Deliverable.tsx";
import { Chevron, Clock, Doc, Up } from "./icons.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";


/** The Fil, as in Figma (163:17001): only what really happened, newest first. */
export function Fil({ state, status, onChange, onAgent }: { state: CompanyState; status: EngineStatus; onChange(): void; onAgent(id: string): void }) {
  const view = filView(state, status.now);
  const signs = missions(state, status.now, status.runtime);
  const [open, setOpen] = useState<Deliverable>();
  const [acting, setActing] = useState<Mission>();

  return (
    <div className="columns">
      <div className="main main-split">
        {/* The sign never scrolls away: the most important thing stays in view. */}
        {signs.length > 0 && <Sign signs={signs} state={state} onAct={setActing} />}
        <div className="main-scroll">
        <Pilot state={state} status={status} view={view} />
        {view.items.length > 0 ? (
          <section className="fil-list">
            {view.items.map((item) => (
              <Publication key={item.post.id} item={item} now={status.now} onOpen={setOpen} onTask={(t) => setActing(taskMission(state, t, status.now))} />
            ))}
          </section>
        ) : (
          <section className="fil-empty">
            <p>Le Fil est vide pour l'instant.</p>
            <p className="muted">Chaque travail terminé par l'équipe arrivera ici, avec ses sources et le temps qu'il a pris.</p>
          </section>
        )}
        </div>
      </div>
      <aside className="side">
        <TeamCard view={view} onAgent={onAgent} />
        {view.quest && <QuestCard quest={view.quest} />}
      </aside>
      {open && <DeliverableView d={open} state={state} status={status} onClose={() => setOpen(undefined)} onChange={onChange} />}
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </div>
  );
}

/** A task clicked in the Fil opens the same popup as the sign's missions. */
function taskMission(state: CompanyState, t: Task, now: number): Mission {
  const leaving = t.status === "planned" && t.kind === "external" && (t.cancellableUntil ?? 0) > now;
  const label = { planned: "prévue", running: "en cours", done: "faite", failed: "pas aboutie", cancelled: "annulée" }[t.status];
  return {
    id: t.id,
    kind: leaving ? "cancel" : "mission",
    eyebrow: leaving ? `Part ${fmt.relative(t.cancellableUntil!, now)} · tu peux l'annuler` : `${state.agents[t.agentId]?.name ?? ""} · ${label}`,
    title: t.title,
    why: t.why,
    speakerId: t.agentId,
    action: leaving ? "cancel" : "open",
    label: "Voir",
    taskId: t.id,
  };
}

/**
 * The colored sign: always the most important thing right now (the key, a legal duty, an action
 * about to leave, the team's main mission). Acting on it opens a popup, never a field in the Fil.
 */
export function Sign({ signs, state, onAct }: { signs: Mission[]; state: CompanyState; onAct(m: Mission): void }) {
  const [index, setIndex] = useState(0);
  const i = Math.min(index, signs.length - 1);
  const m = signs[i]!;
  const total = signs.length;
  const speaker = m.speakerId ? state.agents[m.speakerId] : undefined;
  return (
    <section className={`pancarte kind-${m.kind}`}>
      <div className="pancarte-light" aria-hidden>
        <span className="l1" />
        <span className="l2" />
        <span className="l3" />
        <span className="l4" />
        <span className="l5" />
      </div>
      <div className="pancarte-top">
        <span>{m.eyebrow}</span>
        {total > 1 && (
          <span className="pager">
            <button aria-label="Précédente" onClick={() => setIndex((i - 1 + total) % total)}>
              <Chevron left />
            </button>
            {i + 1} / {total}
            <span className="dots">
              {signs.map((_, j) => (
                <span key={j} className={j === i ? "dot on" : "dot"} />
              ))}
            </span>
            <button aria-label="Suivante" onClick={() => setIndex((i + 1) % total)}>
              <Chevron />
            </button>
          </span>
        )}
      </div>
      <h2>{m.title}</h2>
      <p>{m.why}</p>
      <div className="pancarte-bottom">
        {speaker ? (
          <span className="who">
            <PixelAvatar role={speaker.role} size={26} /> {speaker.name} · {role(speaker.role).title}
          </span>
        ) : (
          <span />
        )}
        {m.action !== "none" && (
          <button className="btn btn-inverse" onClick={() => onAct(m)}>
            {m.label}
          </button>
        )}
      </div>
    </section>
  );
}

/** « Ton entreprise tourne toute seule »: what is running and what comes next. */
function Pilot({ state, status, view }: { state: CompanyState; status: EngineStatus; view: FilView }) {
  const paused = state.company?.paused;
  const waiting = status.runtime === "none" || Boolean(status.unavailable);
  const title = paused ? "L'équipe est en pause" : status.runtime === "none" ? "L'équipe attend ta clé pour travailler" : status.unavailable ?? "Ton entreprise tourne toute seule";
  const parts: string[] = [];
  if (!waiting && !paused) parts.push(view.pilot.running === 0 ? "aucune mission en cours" : `${view.pilot.running} mission${view.pilot.running > 1 ? "s" : ""} en cours`);
  if (view.pilot.next) {
    const who = state.agents[view.pilot.next.agentId]?.name;
    const what = `${lowerFirst(view.pilot.next.title)}${who ? ` (${who})` : ""}`;
    parts.push(waiting || paused ? `première mission prête : ${what}` : `prochaine action : ${what}, ${fmt.relative(view.pilot.next.at, status.now)}`);
  }
  return (
    <section className="pilot">
      <span className={`pilot-dot ${paused || waiting ? "waiting" : "on"}`} />
      <div>
        <div>{title}</div>
        {parts.length > 0 && <div className="muted small">{capitalize(parts.join(" · "))}</div>}
      </div>
    </section>
  );
}

function Publication({ item, now, onOpen, onTask }: { item: FilItem; now: number; onOpen(d: Deliverable): void; onTask(t: Task): void }) {
  const { post, agent, deliverable, task } = item;
  const clickable = Boolean(deliverable || task);
  const open = () => (deliverable ? onOpen(deliverable) : task ? onTask(task) : undefined);
  const cancellable = task && task.status === "planned" && task.kind === "external" && (task.cancellableUntil ?? 0) > now;
  const meta = item.durationMs !== undefined || item.xp !== undefined || item.sources.length > 0;
  return (
    <article className={clickable ? "publication clickable" : "publication"} onClick={open}>
      <header className="post-head">
        <PixelAvatar role={agent?.role} size={36} />
        <span className="name">{agent?.name}</span>
        <span className="muted">· {agent ? role(agent.role).title : ""}</span>
        <span className="muted time">{fmt.relative(post.at, now)}</span>
      </header>
      <p className="text">{post.text}</p>
      {deliverable && <Attachment d={deliverable} />}
      {meta && (
        <div className="meta">
          {item.durationMs !== undefined && (
            <span>
              <Clock /> {fmt.duration(item.durationMs)}
            </span>
          )}
          {item.xp !== undefined && (
            <span>
              <Up /> {item.xp} XP
            </span>
          )}
          {item.sources.length > 0 && (
            <span>
              <Doc /> {sourcesLabel(item.sources)}
            </span>
          )}
        </div>
      )}
      {cancellable && (
        <div className="actions">
          <span className="delay">
            <Clock /> Part {fmt.relative(task.cancellableUntil!, now)}
          </span>
          <button
            className="btn btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              onTask(task);
            }}
          >
            Annuler
          </button>
        </div>
      )}
    </article>
  );
}

/** A deliverable as a pièce jointe: a few rows of its first table when it has one, else its summary. */
function Attachment({ d }: { d: Deliverable }) {
  const rows = firstTableRows(d.body, 3);
  return (
    <div className="attachment">
      <span className="attachment-title">{d.title}</span>
      {rows.length > 0 ? (
        <span className="attachment-table">
          {rows.map((cells, i) => (
            <span key={i} className="attachment-row">
              <span>{cells[0]}</span>
              <span className="muted">{cells[1] ?? ""}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="muted">{d.summary}</span>
      )}
    </div>
  );
}

function TeamCard({ view, onAgent }: { view: FilView; onAgent(id: string): void }) {
  return (
    <section className="card">
      <header className="card-head">
        <span>Ton équipe</span>
        <span className="muted">cette semaine</span>
      </header>
      {view.team.map((m) => (
        <button key={m.agent.id} className="member-row as-button" onClick={() => onAgent(m.agent.id)}>
          <PixelAvatar role={m.agent.role} size={32} />
          <div className="member-text">
            <div>{m.agent.name}</div>
            <div className="muted small">
              {m.title} · {m.status === "waiting-you" ? "ta signature" : m.status === "working" && m.current ? lowerFirst(m.current.progress && m.current.progress !== "Au travail…" ? m.current.progress : m.current.title) : hours(m.hoursThisWeek)}
            </div>
          </div>
          <span className={`status-dot ${m.status}`} title={m.status === "working" ? "Au travail" : m.status === "waiting-you" ? "T'attend" : "Au repos"} />
        </button>
      ))}
      {view.upcoming && (
        <div className="member-row ghost">
          <PixelAvatar size={32} />
          <div className="member-text">
            <div>{view.upcoming.title}</div>
            <div className="muted small">Margaux le fera venir quand ce sera utile</div>
          </div>
        </div>
      )}
    </section>
  );
}

function QuestCard({ quest }: { quest: NonNullable<FilView["quest"]> }) {
  return (
    <section className="card">
      <header className="card-head">
        <span>Quête</span>
        <span className="muted">
          {quest.done} / {quest.total}
        </span>
      </header>
      <div className="small">{quest.title}</div>
      <div className="quest-bar">
        {Array.from({ length: quest.total }, (_, i) => (
          <span key={i} className={i < quest.done ? "on" : ""} />
        ))}
      </div>
      {quest.next && <div className="muted small">Prochaine étape : {lowerFirst(quest.next)}.</div>}
    </section>
  );
}

// ---------- helpers ----------

/** Data rows (header and separator skipped) of the first Markdown table. */
export function firstTableRows(markdown: string, limit: number): string[][] {
  const lines = markdown.split("\n").map((l) => l.trim());
  const start = lines.findIndex((l, i) => l.startsWith("|") && /^\|?\s*:?-{2,}/.test(lines[i + 1] ?? ""));
  if (start < 0) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*/g, "")));
    if (rows.length === limit) break;
  }
  // A leading « 1, 2, 3 » column says nothing in a two-cell preview: show what follows it.
  const numbered = rows.length > 0 && rows.every((r) => /^(#|n°)?\s*\d+\.?$/i.test(r[0] ?? "") && r.length > 1);
  return numbered ? rows.map((r) => r.slice(1)) : rows;
}

/** Short source names: « noel-a-lille.com, INSEE +3 ». Long page titles are cut to their first words. */
function sourcesLabel(sources: string[]): string {
  // Several pages of one site (« API Recherche d'entreprises : … ») count once.
  const short = [
    ...new Set(
      sources.map((s) => {
        const name = s.split(/\s[:(|–—-]\s|\s\(/)[0]!.trim();
        return name.length > 28 ? `${name.slice(0, 27).trimEnd()}…` : name;
      }),
    ),
  ];
  return short.length <= 2 ? short.join(", ") : `${short.slice(0, 2).join(", ")} +${short.length - 2}`;
}

function hours(h: number): string {
  return h === 0 ? "pas encore au travail" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min cette semaine` : `${Math.round(h)} h cette semaine`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
