import type { ReactNode } from "react";
import { fmt, role, type CompanyState, type PageFrame, type RoleId } from "@narthex/core";
import { PixelAvatar } from "./PixelAvatar.tsx";

/** Pieces of the Entreprise pages, after the Figma components (pilote, chiffres, publication, pièce jointe). */

/** The pilote line: a dot, what is going on, and the teammate to look at. */
export function Pilot({ pilot, on, state, onAgent }: { pilot: PageFrame["pilot"]; on: boolean; state: CompanyState; onAgent(id: string): void }) {
  const agent = pilot.agentId ? state.agents[pilot.agentId] : undefined;
  return (
    <section className="pilot">
      <span className={`pilot-dot ${on ? "on" : "waiting"}`} />
      <div>
        <div>{pilot.title}</div>
        {pilot.detail && (
          <div className="muted small" title={pilot.detail}>
            {pilot.detail}
          </div>
        )}
      </div>
      {agent && (
        <button className="pilot-link" onClick={() => onAgent(agent.id)}>
          Voir {agent.name}
        </button>
      )}
    </section>
  );
}

/** Right column: « Les chiffres », the rules followed there, « Qui s'en occupe ». */
export function FrameSide({ frame, state, onAgent }: { frame: Pick<PageFrame, "period" | "figures" | "rules" | "who">; state: CompanyState; onAgent(id: string): void }) {
  return (
    <>
      <section className="card">
        <header className="card-head">
          <span>Les chiffres</span>
          <span className="muted">{frame.period}</span>
        </header>
        {frame.figures.map((f) => (
          <div key={f.label} className="ent-figure">
            <div>
              <div>{f.label}</div>
              <div className="muted small">{f.hint}</div>
            </div>
            <span className="ent-figure-value">{f.value}</span>
          </div>
        ))}
      </section>
      {frame.rules && (
        <section className="card">
          <header className="card-head">
            <span>{frame.rules.title}</span>
            <span className="muted">{frame.rules.aside}</span>
          </header>
          {frame.rules.items.map((r) => (
            <div key={r.text} className="ent-rule">
              <div className="small">{r.text}</div>
              {r.hint && <div className="muted small">{r.hint}</div>}
            </div>
          ))}
        </section>
      )}
      {frame.who.length > 0 && (
        <section className="card">
          <header className="card-head">
            <span>Qui s'en occupe</span>
          </header>
          {frame.who.map((w) =>
            w.agentId && state.agents[w.agentId] ? (
              <button key={w.role} className="member-row as-button" onClick={() => onAgent(w.agentId!)}>
                <PixelAvatar role={w.role} size={32} />
                <div className="member-text">
                  <div>{w.name}</div>
                  <div className="muted small">{w.duty}</div>
                </div>
              </button>
            ) : (
              <div key={w.role} className="member-row ghost">
                <PixelAvatar role={w.role} size={32} dim />
                <div className="member-text">
                  <div>
                    {w.name} · {role(w.role).title}
                  </div>
                  <div className="muted small">{w.duty}</div>
                </div>
              </div>
            ),
          )}
        </section>
      )}
    </>
  );
}

export const TableIcon = () => (
  <svg width={14} height={14} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2.5" y="3.33" width="15" height="13.33" rx="1.67" />
    <path d="M2.5 8.33h15M2.5 12.5h15M7.5 8.33v8.34" />
  </svg>
);

/** A publication: an agent's head line, its words, then whatever it attached. */
export function Post({ agentId, state, at, now, ghost, children }: { agentId?: string; state: CompanyState; at?: number; now: number; ghost?: { role: RoleId; note: string }; children: ReactNode }) {
  const agent = agentId ? state.agents[agentId] : undefined;
  const r = agent?.role ?? ghost?.role;
  return (
    <article className={ghost ? "publication ghost" : "publication"}>
      <header className="post-head">
        <PixelAvatar role={r} size={36} dim={!!ghost} />
        <span className="name">{agent?.name ?? (r ? role(r).defaultName : "")}</span>
        {r && <span className="post-role">· {role(r).title}{ghost ? ` · ${ghost.note}` : ""}</span>}
        {at !== undefined && <span className="muted time">{fmt.relative(at, now)}</span>}
      </header>
      {children}
    </article>
  );
}

/** A Markdown table as a pièce jointe: a few rows, then how many more. */
export function TableAttachment({
  title,
  header,
  rows,
  limit = 5,
  onRow,
  foot,
  columns = 4,
  widths,
  numLast,
}: {
  title?: string;
  header: string[];
  rows: ReactNode[][];
  limit?: number;
  onRow?(i: number): void;
  foot?: string;
  columns?: number;
  /** Column widths (CSS), in the order shown; the first column takes 40 % by default. */
  widths?: string[];
  /** Right-align the last column (amounts). */
  numLast?: boolean;
}) {
  // A « # » or « 1, 2, 3 » column says nothing in a preview; past `columns`, the full table is one click away.
  const numbered = header.length > 1 && rows.length > 0 && rows.every((r) => typeof r[0] === "string" && /^(#|n°)?\s*\d+\.?$/i.test(r[0]));
  const keep = header.map((_, i) => i).filter((i) => !(numbered && i === 0)).slice(0, columns);
  const shown = rows.slice(0, limit);
  const more = rows.length - shown.length;
  return (
    <div className="ent-attach">
      {title && <div className="ent-attach-title">{title}</div>}
      <table className="ent-table">
        <thead>
          <tr>
            {keep.map((i, k) => (
              <th key={i} className={numLast && k === keep.length - 1 ? "num" : undefined} style={{ width: widths?.[k] ?? (k === 0 && keep.length > 2 ? "40%" : undefined) }}>
                {header[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className={onRow ? "clickable" : undefined} onClick={onRow ? () => onRow(i) : undefined}>
              {keep.map((j, k) => (
                <td key={j} className={numLast && k === keep.length - 1 ? "num" : undefined} title={typeof r[j] === "string" ? (r[j] as string) : undefined}>
                  {r[j] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(more > 0 || foot) && <div className="ent-attach-foot">{[more > 0 ? `Et ${more} autre${more > 1 ? "s" : ""}.` : "", foot ?? ""].filter(Boolean).join(" ")}</div>}
    </div>
  );
}

