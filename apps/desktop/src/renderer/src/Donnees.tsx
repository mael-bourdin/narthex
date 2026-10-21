import { useState } from "react";
import { analytics, fmt, STAGE_LABEL, type CompanyState, type DayPoint, type EngineStatus, type StoredEvent } from "@narthex/core";
import { FrameSide, Pilot } from "./EntrepriseParts.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";

const percent = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

/**
 * Entreprise · Données: the company's numbers, real events only, drawn without a library.
 * No Figma frame: same grammar as the other Entreprise pages (pilote, one card of blocks, « Les chiffres »).
 */
export function Donnees({ state, status, events, on, onAgent }: { state: CompanyState; status: EngineStatus; events: StoredEvent[]; on: boolean; onAgent(id: string): void }) {
  const [range, setRange] = useState<7 | 30>(30);
  const a = analytics(state, events, status.now, range);
  const label = (d: DayPoint) => new Date(d.day).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });
  const max = Math.max(1, ...a.team.map((x) => x.done + x.failed));

  return (
    <>
      <div className="ent-title-row">
        <h1 className="ent-title">Données</h1>
        <div className="segmented">
          {([7, 30] as const).map((r) => (
            <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>
              {r} jours
            </button>
          ))}
        </div>
      </div>
      <Pilot
        pilot={{ title: "Rien d'estimé ici", detail: "Les ventes que tu as enregistrées, la dépense IA de chaque appel et les missions de l'équipe, jour par jour (Paris)" }}
        on={on}
        state={state}
        onAgent={onAgent}
      />

      <section className="fil-list">
        <article className="publication">
          <header className="card-head">
            <span>Ventes et dépense</span>
            <span className="legend small">
              <i className="dot revenue" /> Chiffre d'affaires <i className="dot spend" /> Dépense IA
            </span>
          </header>
          <Bars points={a.days} label={label} series={[{ key: "revenue", className: "revenue", format: fmt.euros }, { key: "spend", className: "spend", format: fmt.dollars }]} separate />
        </article>

        <article className="publication">
          <header className="card-head">
            <span>Missions par jour</span>
            <span className="legend small">
              <i className="dot done" /> Terminées <i className="dot failed" /> Pas abouties
            </span>
          </header>
          <Bars points={a.days} label={label} series={[{ key: "done", className: "done", format: String }, { key: "failed", className: "failed", format: String }]} stacked />
        </article>

        <article className="publication">
          <header className="card-head">
            <span>L'équipe</span>
            <span className="muted small">depuis le début</span>
          </header>
          <div className="ent-attach">
            <table className="ent-table auto">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Missions</th>
                  <th>Réussite</th>
                  <th>Temps</th>
                  <th>XP</th>
                  <th className="num">Dépense</th>
                </tr>
              </thead>
              <tbody>
                {a.team.map((t) => (
                  <tr key={t.agentId}>
                    <td>
                      <span className="with-avatar">
                        <PixelAvatar role={t.role} size={22} /> {t.name}
                      </span>
                    </td>
                    <td>
                      <span className="bar-cell" title={`${t.done} terminées, ${t.failed} pas abouties`}>
                        <span className="bar done" style={{ width: `${(t.done / max) * 70}px` }} />
                        <span className="bar failed" style={{ width: `${(t.failed / max) * 70}px` }} />
                        <span className="small">{t.done}</span>
                      </span>
                    </td>
                    <td>{percent(t.successRate)}</td>
                    <td>{t.hours < 1 ? `${Math.max(t.done ? 1 : 0, Math.round(t.hours * 60))} min` : `${Math.round(t.hours)} h`}</td>
                    <td>{t.xp}</td>
                    <td className="num">{fmt.dollars(t.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="publication">
          <header className="card-head">
            <span>Progression</span>
            <span className="muted small">{a.quality.facts} faits en mémoire</span>
          </header>
          <ol className="timeline">
            {a.stages.map((s, i) => (
              <li key={i}>
                <span className="timeline-dot" />
                <span>{STAGE_LABEL[s.stage]}</span>
                <span className="muted small">{fmt.day(s.at)}</span>
              </li>
            ))}
          </ol>
        </article>
      </section>
    </>
  );
}

/** Right column of Données: the totals since the start, whatever the range of the charts. */
export function DonneesSide({ state, status, events }: { state: CompanyState; status: EngineStatus; events: StoredEvent[] }) {
  const a = analytics(state, events, status.now, 7);
  return (
    <FrameSide
      state={state}
      onAgent={() => {}}
      frame={{
        period: "depuis le début",
        figures: [
          { label: "Chiffre d'affaires", value: fmt.euros(a.money.revenue), hint: `${a.money.sales} vente${a.money.sales > 1 ? "s" : ""} enregistrée${a.money.sales > 1 ? "s" : ""}` },
          { label: "Dépense IA", value: fmt.dollars(a.money.spend), hint: "Chez ton fournisseur d'IA" },
          { label: "Par livrable", value: a.money.costPerDeliverable === null ? "—" : fmt.dollars(a.money.costPerDeliverable), hint: `${a.quality.deliverables} livrables` },
          { label: "Liens qui répondent", value: percent(a.quality.linksAnswering), hint: a.quality.sourcesPerDeliverable === null ? "Pas encore de livrable" : `${a.quality.sourcesPerDeliverable.toLocaleString("fr-FR")} sources par livrable` },
        ],
        who: [],
      }}
    />
  );
}

type Key = "revenue" | "spend" | "done" | "failed";

/** Daily bars: side by side (each series on its own scale) or stacked (one scale). */
function Bars({
  points,
  series,
  label,
  stacked,
  separate,
}: {
  points: DayPoint[];
  series: { key: Key; className: string; format(n: number): string }[];
  label(p: DayPoint): string;
  stacked?: boolean;
  separate?: boolean;
}) {
  const W = 720;
  const H = 160;
  const pad = 18;
  const slot = (W - pad) / points.length;
  const width = Math.min(28, Math.max(2, slot * (stacked ? 0.6 : 0.36)));
  const max = (key: Key) => Math.max(1, ...points.map((p) => p[key]));
  const shared = Math.max(1, ...points.map((p) => series.reduce((n, s) => n + p[s.key], 0)));
  const every = Math.ceil(points.length / 8);
  const empty = points.every((p) => series.every((s) => p[s.key] === 0));
  return (
    <svg className="bars" viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={empty ? "Pas encore de données sur cette période" : "Graphique par jour"}>
      <line x1={0} x2={W} y1={H} y2={H} className="axis" />
      {points.map((p, i) => {
        // Bars sit in the middle of their day's slot, however few days there are.
        const x = pad + i * slot + (slot - (stacked ? width : series.length * (width + 2))) / 2;
        let base = H;
        return (
          <g key={p.day}>
            {series.map((s, j) => {
              const value = p[s.key];
              const h = (value / (stacked ? shared : separate ? max(s.key) : shared)) * (H - 8);
              const y = stacked ? base - h : H - h;
              if (stacked) base -= h;
              const left = stacked ? x : x + j * (width + 2);
              return value > 0 ? (
                <rect key={s.key} className={`bar ${s.className}`} x={left} y={y} width={width} height={Math.max(1, h)} rx={2}>
                  <title>{`${label(p)} · ${s.format(value)}`}</title>
                </rect>
              ) : null;
            })}
            {i % every === 0 && (
              <text x={x + width / 2} y={H + 16} className="tick" textAnchor="middle">
                {label(p)}
              </text>
            )}
          </g>
        );
      })}
      {empty && (
        <text x={W / 2} y={H / 2} className="tick" textAnchor="middle">
          Pas encore de données sur cette période
        </text>
      )}
    </svg>
  );
}
