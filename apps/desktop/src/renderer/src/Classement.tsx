import { useEffect, useState, type CSSProperties } from "react";
import "./reglages.css";
import { fmt, OFFICES, STAGE_LABEL, type CompanyState } from "@narthex/core";

type Board = Awaited<ReturnType<typeof window.narthex.leaderboard.get>>;

/**
 * The public ranking of the companies run on the hosted version of Narthex. Anyone can look;
 * only hosted companies whose founder chose to appear are listed. Open source keeps everything at home.
 */
export function Classement({ state }: { state: CompanyState }) {
  const [board, setBoard] = useState<Board>();
  const reload = () => void window.narthex.leaderboard.get().then(setBoard);
  useEffect(reload, []);
  const mine = new Set(board?.mine ?? []);
  const me = board?.entries.find((r) => r.entry.companyId === state.company?.id);

  return (
    <div className="columns">
      <div className="main">
        <h1>Classement</h1>
        <section className="pilot">
          <span className={`dot ${board?.online ? "working" : ""}`} />
          <div>
            <div>{me ? `${state.company?.name} est ${me.rank === 1 ? "1re" : `${me.rank}e`} sur ${board!.entries.length}` : "Les entreprises qui grandissent avec Narthex"}</div>
            <div className="muted small">Étape, bureau, chiffre d'affaires, ventes : la plus avancée en tête, la plus rapide gagne une égalité.</div>
          </div>
        </section>
        <section className="card ranking">
          {!board && <p className="muted small">Chargement…</p>}
          {board && !board.online && <p className="muted small">Le classement n'est pas encore en ligne. Il réunira les entreprises de la version hébergée de Narthex.</p>}
          {board?.error && <p className="muted small">{board.error}</p>}
          {board?.online && !board.error && board.entries.length === 0 && <p className="muted small">Personne n'y figure encore. Les premières entreprises de la version hébergée arrivent.</p>}
          {board && board.entries.length > 0 && (
            <div className="rg-table" style={{ "--grid": "28px 2fr 1fr 1.2fr 1.3fr 56px 48px" } as CSSProperties}>
              <div className="rg-table-title">Les entreprises de la version hébergée</div>
              <div className="rg-cells rg-head">
                <span>#</span>
                <span>Entreprise</span>
                <span>Étape</span>
                <span>Bureau</span>
                <span>Chiffre d'affaires</span>
                <span>Ventes</span>
                <span>Âge</span>
              </div>
              {board.entries.map(({ rank, entry: e }) => (
                <div key={e.companyId} className={`rg-cells rg-line${mine.has(e.companyId) ? " own" : ""}`}>
                  <span className="rg-num rank">{rank}</span>
                  <span className="rg-text">
                    <span>{e.name}</span>
                    <span className="rg-sub">{[e.founder, e.city].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span>{STAGE_LABEL[e.stage]}</span>
                  <span>{OFFICES[e.office]?.name ?? ""}</span>
                  <span className="rg-num">{e.revenue !== undefined ? fmt.euros(e.revenue) : e.revenueBand}</span>
                  <span className="rg-num">{e.sales}</span>
                  <span className="rg-num">{e.days} j</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <aside className="side">
        <section className="card">
          <header className="card-head">
            <span>Ta place</span>
            <span className="muted small">{board?.edition === "hosted" ? "version hébergée" : "open source"}</span>
          </header>
          {board?.edition !== "hosted" ? (
            <p className="muted small">Tu utilises la version open source : tes données restent sur ton ordinateur et tes entreprises n'apparaissent pas au classement. Seules les entreprises de la version hébergée y figurent.</p>
          ) : !board.joinable ? (
            <p className="muted small">Cette instance n'a pas encore de jeton de classement.</p>
          ) : (
            <div className="rg-table">
              <div className="rg-row">
                <span className="rg-text">
                  <span>Apparaître au classement</span>
                  <span className="rg-sub">Nom, ville, ton prénom, étape, bureau, ventes. Jamais ton idée ni tes documents.</span>
                </span>
                <Switch on={board.share} label="Apparaître au classement" onToggle={() => void window.narthex.leaderboard.set({ share: !board.share, showRevenue: board.showRevenue }).then(reload)} />
              </div>
              {board.share && (
                <div className="rg-row">
                  <span className="rg-text">
                    <span>Montrer le montant exact</span>
                    <span className="rg-sub">Sinon, une tranche (par exemple « 1 000 à 5 000 € »).</span>
                  </span>
                  <Switch on={board.showRevenue} label="Montrer le montant exact" onToggle={() => void window.narthex.leaderboard.set({ share: board.share, showRevenue: !board.showRevenue }).then(reload)} />
                </div>
              )}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={on ? "rg-switch on" : "rg-switch"} onClick={onToggle} />;
}
