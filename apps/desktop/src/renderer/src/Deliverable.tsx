import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { deliverableSheet, fmt, type CompanyState, type Deliverable, type EngineStatus, type Mission, type StoredEvent } from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { Avatar } from "./Avatar.tsx";

const Markdown = ({ children }: { children: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>
    {children}
  </ReactMarkdown>
);

/**
 * A deliverable, opened full page over any screen (Figma 160:19482): the document on the left,
 * read section by section; on the right what its author waits on from you, what it cost, its sources.
 */
export function DeliverableView({ d, state, status, onClose, onChange }: { d: Deliverable; state: CompanyState; status: EngineStatus; onClose(): void; onChange(): void }) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [acting, setActing] = useState<Mission>();
  const [saved, setSaved] = useState<string>();
  const [allSources, setAllSources] = useState(false);
  const agent = state.agents[d.agentId];
  const task = state.tasks[d.taskId];
  const sheet = deliverableSheet(state, d, events, status.now, status.runtime);
  // Links that no longer answer come first, so they are never hidden behind « voir les autres ».
  const sources = [...d.sources].sort((a, b) => Number(a.reachable !== false) - Number(b.reachable !== false));

  useEffect(() => {
    void window.narthex.call("events.read", {}).then(setEvents);
  }, [d.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !acting && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, acting]);

  const toggle = (i: number) =>
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="deliverable-page">
      <div className="deliverable-grid">
        <article>
          <button className="link back" onClick={onClose}>
            ← Retour
          </button>
          <div className="deliverable-head">
            <Avatar role={agent?.role} size={40} />
            <div>
              <h1>{d.title}</h1>
              <p className="muted small">{sheet.meta.join(" · ")}</p>
            </div>
          </div>
          {sheet.intro && (
            <div className="doc deliverable-intro">
              <Markdown>{sheet.intro}</Markdown>
            </div>
          )}
          {sheet.sections.length > 0 && (
            <ul className="sections">
              {sheet.sections.map((s, i) => (
                <li key={i} className={opened.has(i) ? "open" : ""}>
                  <button className="section-row" onClick={() => toggle(i)} aria-expanded={opened.has(i)}>
                    <span className="section-title">{s.title}</span>
                    <span className="section-lead">{s.lead}</span>
                    <span className="section-more">{opened.has(i) ? "Replier" : "Lire"}</span>
                  </button>
                  {opened.has(i) && (
                    <div className="doc section-body">
                      <Markdown>{s.body}</Markdown>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>

        <aside className="deliverable-aside">
          {sheet.next && (
            <div className="aside-card">
              <p className="modal-eyebrow">{sheet.next.eyebrow}</p>
              <h2>{sheet.next.title}</h2>
              <p className="muted small">{sheet.next.why}</p>
              <button className="btn btn-primary wide" onClick={() => setActing(sheet.next)}>
                {sheet.next.kind === "cancel" ? "Voir l'action" : "Voir"}
              </button>
            </div>
          )}
          <div className="aside-card">
            <dl className="facts">
              {sheet.spend > 0 && (
                <>
                  <dt>Dépense IA</dt>
                  <dd>{fmt.dollars(sheet.spend)}</dd>
                </>
              )}
              {sheet.links && (
                <>
                  <dt>Liens</dt>
                  <dd className={sheet.links.dead.length ? "warn" : ""}>
                    {sheet.links.dead.length === 0
                      ? `${sheet.links.checked} vérifiés, tous répondent`
                      : `${sheet.links.checked - sheet.links.dead.length} sur ${sheet.links.checked} répondent`}
                  </dd>
                </>
              )}
              <dt>Rendu le</dt>
              <dd>
                {fmt.day(d.createdAt)} à {fmt.hour(d.createdAt)}
              </dd>
              {task?.why && (
                <>
                  <dt>Pourquoi</dt>
                  <dd>{task.why}</dd>
                </>
              )}
            </dl>
            <button
              className="btn btn-quiet wide"
              onClick={() =>
                void window.narthex.deliverable
                  .save(d.id)
                  .then((f) => f && setSaved(f))
                  .catch(() => setSaved(undefined))
              }
            >
              Enregistrer en Markdown
            </button>
            {saved && <p className="muted small">Enregistré : {saved}</p>}
          </div>
          {d.sources.length > 0 && (
            <div className="aside-card">
              <p className="aside-label">Sources · {d.sources.length}</p>
              <ul className="sources">
                {(allSources ? sources : sources.slice(0, 5)).map((s, i) => (
                  <li key={i}>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                    {s.checkedAt && <span className="muted"> · vérifié le {s.checkedAt}</span>}
                    {s.reachable === false && <span className="dead"> · ne répond plus</span>}
                  </li>
                ))}
              </ul>
              {d.sources.length > 5 && (
                <button className="link more" onClick={() => setAllSources(!allSources)}>
                  {allSources ? "Moins de sources" : `Voir les ${d.sources.length - 5} autres`}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
      {acting && <ActionModal mission={acting} state={state} now={status.now} onClose={() => setActing(undefined)} onDone={onChange} />}
    </div>
  );
}
