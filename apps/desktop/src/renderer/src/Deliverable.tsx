import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fmt, type CompanyState, type Deliverable } from "@narthex/core";
import { PixelAvatar } from "./PixelAvatar.tsx";

/** A deliverable, opened over any screen. */
export function DeliverableView({ d, state, onClose }: { d: Deliverable; state: CompanyState; onClose(): void }) {
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

