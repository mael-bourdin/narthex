import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  filView,
  fmt,
  role,
  type CompanyState,
  type Deliverable,
  type EngineStatus,
  type FilItem,
  type FilView,
  type LegalForm,
} from "@narthex/core";
import { Chevron, Clock, Doc, Up } from "./icons.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";

const FORMS: LegalForm[] = ["SASU", "SAS", "EURL", "SARL", "EI", "micro"];

const cleanError = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/** The Fil, as in Figma (163:17001): only what really happened, newest first. */
export function Fil({ state, status, onChange }: { state: CompanyState; status: EngineStatus; onChange(): void }) {
  const view = filView(state, status.now);
  const [open, setOpen] = useState<Deliverable>();
  const [error, setError] = useState<string>();

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <div className="columns">
      <div className="main">
        {view.legal.length > 0 && <Pancarte view={view} act={act} />}
        <Pilot state={state} status={status} view={view} />
        {status.runtime === "none" && <KeyCard onDone={onChange} />}
        {error && <p className="error">{error}</p>}
        {view.items.length > 0 ? (
          <section className="fil-list">
            {view.items.map((item) => (
              <Publication key={item.post.id} item={item} now={status.now} onOpen={setOpen} onCancel={(taskId) => act(() => window.narthex.call("task.cancel", { taskId }))} />
            ))}
          </section>
        ) : (
          <section className="fil-empty">
            <p>Le Fil est vide pour l'instant.</p>
            <p className="muted">Chaque travail terminé par l'équipe arrivera ici, avec ses sources et le temps qu'il a pris.</p>
          </section>
        )}
      </div>
      <aside className="side">
        <TeamCard view={view} />
        {view.quest && <QuestCard quest={view.quest} />}
      </aside>
      {open && <DeliverableView d={open} state={state} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

/** The gradient sign: only what the law reserves to the founder, one at a time. */
function Pancarte({ view, act }: { view: FilView; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [index, setIndex] = useState(0);
  const [form, setForm] = useState<LegalForm>("SASU");
  const i = Math.min(index, view.legal.length - 1);
  const { obligation: o, speaker } = view.legal[i]!;
  const total = view.legal.length;
  return (
    <section className="pancarte">
      <div className="pancarte-top">
        <span>À faire par toi · la loi l'impose</span>
        {total > 1 && (
          <span className="pager">
            <button aria-label="Précédente" onClick={() => setIndex((i - 1 + total) % total)}>
              <Chevron left />
            </button>
            {i + 1} / {total}
            <span className="dots">
              {view.legal.map((_, j) => (
                <span key={j} className={j === i ? "dot on" : "dot"} />
              ))}
            </span>
            <button aria-label="Suivante" onClick={() => setIndex((i + 1) % total)}>
              <Chevron />
            </button>
          </span>
        )}
      </div>
      <h2>{o.title}</h2>
      <p>{o.why}</p>
      <div className="pancarte-bottom">
        {speaker && (
          <span className="who">
            <PixelAvatar role={speaker.role} size={26} /> {speaker.name} · {role(speaker.role).title}
          </span>
        )}
        <span className="actions">
          {o.code === "A3-forme" && (
            <select value={form} onChange={(e) => setForm(e.target.value as LegalForm)} aria-label="Forme juridique">
              {FORMS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          )}
          <button
            className="btn btn-primary"
            onClick={() => act(() => window.narthex.call("obligation.fulfill", { obligationId: o.id, ...(o.code === "A3-forme" ? { legalForm: form } : {}) }))}
          >
            C'est fait
          </button>
        </span>
      </div>
    </section>
  );
}

/** « Ton entreprise tourne toute seule »: what is running and what comes next. */
function Pilot({ state, status, view }: { state: CompanyState; status: EngineStatus; view: FilView }) {
  const paused = state.company?.paused;
  const waiting = status.runtime === "none";
  const title = paused ? "L'équipe est en pause" : waiting ? "L'équipe attend ta clé pour travailler" : "Ton entreprise tourne toute seule";
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

function KeyCard({ onDone }: { onDone(): void }) {
  const [key, setKey] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setMessage(undefined);
    const r = await window.narthex.onboarding.submitKey(key);
    setBusy(false);
    if (!r.ok) return setMessage(r.message);
    setKey("");
    setMessage(r.applied ? undefined : "Clé enregistrée. Elle servira au prochain lancement de l'équipe.");
    onDone();
  };
  return (
    <section className="keycard">
      <div className="keycard-head">
        <PixelAvatar role="cofondateur" size={30} />
        <p>Pour que l'équipe travaille vraiment, j'ai besoin de ta clé API Anthropic. Elle reste sur ton ordinateur.</p>
      </div>
      <div className="keycard-row">
        <input type="password" value={key} placeholder="sk-ant-…" onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} aria-label="Clé API Anthropic" />
        <button className="btn btn-primary" disabled={!key.trim() || busy} onClick={submit}>
          {busy ? "Vérification…" : "Ajouter"}
        </button>
      </div>
      {message && <p className="small muted">{message}</p>}
    </section>
  );
}

function Publication({ item, now, onOpen, onCancel }: { item: FilItem; now: number; onOpen(d: Deliverable): void; onCancel(taskId: string): void }) {
  const { post, agent, deliverable, task } = item;
  const cancellable = task && task.status === "planned" && task.kind === "external" && (task.cancellableUntil ?? 0) > now;
  const meta = item.durationMs !== undefined || item.xp !== undefined || item.sources.length > 0;
  return (
    <article className="publication">
      <header className="post-head">
        <PixelAvatar role={agent?.role} size={36} />
        <span className="name">{agent?.name}</span>
        <span className="muted">· {agent ? role(agent.role).title : ""}</span>
        <span className="muted time">{fmt.relative(post.at, now)}</span>
      </header>
      <p className="text">{post.text}</p>
      {deliverable && <Attachment d={deliverable} onOpen={() => onOpen(deliverable)} />}
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
          <button className="btn btn-secondary" onClick={() => onCancel(task.id)}>
            Annuler
          </button>
        </div>
      )}
    </article>
  );
}

/** A deliverable as a pièce jointe: a few rows of its first table when it has one, else its summary. */
function Attachment({ d, onOpen }: { d: Deliverable; onOpen(): void }) {
  const rows = firstTableRows(d.body, 3);
  return (
    <button className="attachment" onClick={onOpen}>
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
    </button>
  );
}

function TeamCard({ view }: { view: FilView }) {
  return (
    <section className="card">
      <header className="card-head">
        <span>Ton équipe</span>
        <span className="muted">cette semaine</span>
      </header>
      {view.team.map((m) => (
        <div key={m.agent.id} className="member-row">
          <PixelAvatar role={m.agent.role} size={32} />
          <div className="member-text">
            <div>{m.agent.name}</div>
            <div className="muted small">
              {m.title} · {m.status === "waiting-you" ? "ta signature" : m.status === "working" && m.current ? lowerFirst(m.current.progress && m.current.progress !== "Au travail…" ? m.current.progress : m.current.title) : hours(m.hoursThisWeek)}
            </div>
          </div>
          <span className={`status-dot ${m.status}`} title={m.status === "working" ? "Au travail" : m.status === "waiting-you" ? "T'attend" : "Au repos"} />
        </div>
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

function DeliverableView({ d, state, onClose }: { d: Deliverable; state: CompanyState; onClose(): void }) {
  const agent = state.agents[d.agentId];
  return (
    <div className="overlay" onClick={onClose}>
      <article className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="link" onClick={onClose}>
          ← Fil
        </button>
        <div className="post-head">
          <PixelAvatar role={agent?.role} size={40} />
          <div>
            <h1>{d.title}</h1>
            <div className="muted small">
              {agent?.name} · {fmt.day(d.createdAt)} · {d.sources.length} source{d.sources.length > 1 ? "s" : ""}
            </div>
          </div>
        </div>
        <div className="doc">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>
            {d.body}
          </ReactMarkdown>
        </div>
        {d.sources.length > 0 && (
          <ul className="sources">
            {d.sources.map((s, i) => (
              <li key={i}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
                {s.checkedAt && <span className="muted"> · vérifié le {s.checkedAt}</span>}
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
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
  return rows;
}

/** Short source names: « noel-a-lille.com, INSEE +3 ». Long page titles are cut to their first words. */
function sourcesLabel(sources: string[]): string {
  const short = [...new Set(sources)].map((s) => {
    const name = s.split(/\s[:(|–—-]\s|\s\(/)[0]!.trim();
    return name.length > 28 ? `${name.slice(0, 27).trimEnd()}…` : name;
  });
  return short.length <= 2 ? short.join(", ") : `${short.slice(0, 2).join(", ")} +${short.length - 2}`;
}

function hours(h: number): string {
  return h === 0 ? "pas encore au travail" : h < 1 ? `${Math.round(h * 60)} min cette semaine` : `${Math.round(h)} h cette semaine`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
