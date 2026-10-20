import { useState } from "react";
import { analytics, fmt, STAGE_LABEL, type CompanyState, type DayPoint, type EngineStatus, type StoredEvent } from "@narthex/core";
import { PixelAvatar } from "./PixelAvatar.tsx";

const euros = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 ? 2 : 0 });
const percent = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

/** Entreprise · Données: the company's numbers, real events only, drawn without a library. */
export function Donnees({ state, status, events }: { state: CompanyState; status: EngineStatus; events: StoredEvent[] }) {
  const [range, setRange] = useState<7 | 30>(30);
  const a = analytics(state, events, status.now, range);
  const label = (d: DayPoint) => new Date(d.day).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

  return (
    <>
      <div className="data-head">
        <h1>Données</h1>
        <div className="segmented">
          {([7, 30] as const).map((r) => (
            <button key={r} className={r === range ? "on" : ""} onClick={() => setRange(r)}>
              {r} jours
            </button>
          ))}
        </div>
      </div>

      <section className="kpis">
        <Kpi label="Chiffre d'affaires" value={euros(a.money.revenue)} hint={`${a.money.sales} vente${a.money.sales > 1 ? "s" : ""} enregistrée${a.money.sales > 1 ? "s" : ""}`} />
        <Kpi label="Dépense IA" value={fmt.dollars(a.money.spend)} hint="depuis le début" />
        <Kpi label="Par livrable" value={a.money.costPerDeliverable === null ? "—" : fmt.dollars(a.money.costPerDeliverable)} hint={`${a.quality.deliverables} livrables`} />
        <Kpi label="Liens qui répondent" value={percent(a.quality.linksAnswering)} hint={a.quality.sourcesPerDeliverable === null ? "pas encore de livrable" : `${a.quality.sourcesPerDeliverable.toLocaleString("fr-FR")} sources par livrable`} />
      </section>

      <section className="card chart-card">
        <header className="card-head">
          <span>Ventes et dépense</span>
          <span className="legend small">
            <i className="dot revenue" /> Chiffre d'affaires <i className="dot spend" /> Dépense IA
          </span>
        </header>
        <Bars points={a.days} label={label} series={[{ key: "revenue", className: "revenue", format: euros }, { key: "spend", className: "spend", format: fmt.dollars }]} separate />
      </section>

      <section className="card chart-card">
        <header className="card-head">
          <span>Missions par jour</span>
          <span className="legend small">
            <i className="dot done" /> Terminées <i className="dot failed" /> Pas abouties
          </span>
        </header>
        <Bars points={a.days} label={label} series={[{ key: "done", className: "done", format: String }, { key: "failed", className: "failed", format: String }]} stacked />
      </section>

      <section className="card">
        <header className="card-head">
          <span>L'équipe</span>
          <span className="muted small">depuis le début</span>
        </header>
        <div className="team-table">
          <span className="muted small">Agent</span>
          <span className="muted small">Missions</span>
          <span className="muted small">Réussite</span>
          <span className="muted small">Temps</span>
          <span className="muted small">XP</span>
          <span className="muted small">Dépense</span>
          {a.team.map((t) => {
            const max = Math.max(1, ...a.team.map((x) => x.done + x.failed));
            return [
              <span key={`${t.agentId}n`} className="with-avatar">
                <PixelAvatar role={t.role} size={22} /> {t.name}
              </span>,
              <span key={`${t.agentId}d`} className="bar-cell" title={`${t.done} terminées, ${t.failed} pas abouties`}>
                <span className="bar done" style={{ width: `${(t.done / max) * 100}%` }} />
                <span className="bar failed" style={{ width: `${(t.failed / max) * 100}%` }} />
                <span className="small">{t.done}</span>
              </span>,
              <span key={`${t.agentId}r`} className="small">{percent(t.successRate)}</span>,
              <span key={`${t.agentId}h`} className="small">{t.hours < 1 ? `${Math.max(t.done ? 1 : 0, Math.round(t.hours * 60))} min` : `${Math.round(t.hours)} h`}</span>,
              <span key={`${t.agentId}x`} className="small">{t.xp}</span>,
              <span key={`${t.agentId}s`} className="small">{fmt.dollars(t.spend)}</span>,
            ];
          })}
        </div>
      </section>

      <section className="card">
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
      </section>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card kpi-card">
      <span className="muted small">{label}</span>
      <span className="kpi-big">{value}</span>
      <span className="muted small">{hint}</span>
    </div>
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
