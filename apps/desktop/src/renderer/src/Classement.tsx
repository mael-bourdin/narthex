import { useEffect, useState } from "react";
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
            <div className="ranking-table">
              <span className="muted small">#</span>
              <span className="muted small">Entreprise</span>
              <span className="muted small">Étape</span>
              <span className="muted small">Bureau</span>
              <span className="muted small">Chiffre d'affaires</span>
              <span className="muted small">Ventes</span>
              <span className="muted small">Âge</span>
              {board.entries.map(({ rank, entry: e }) => {
                const own = mine.has(e.companyId) ? " own" : "";
                return [
                  <span key={`${e.companyId}r`} className={`rank${rank <= 3 ? ` top${rank}` : ""}${own}`}>{rank}</span>,
                  <span key={`${e.companyId}n`} className={`ranking-name${own}`}>
                    {e.name}
                    <span className="muted small block">{[e.founder, e.city].filter(Boolean).join(" · ")}</span>
                  </span>,
                  <span key={`${e.companyId}s`} className={`small${own}`}>{STAGE_LABEL[e.stage]}</span>,
                  <span key={`${e.companyId}o`} className={`small${own}`}>{OFFICES[e.office]?.name ?? ""}</span>,
                  <span key={`${e.companyId}c`} className={`small${own}`}>{e.revenue !== undefined ? fmt.euros(e.revenue) : e.revenueBand}</span>,
                  <span key={`${e.companyId}v`} className={`small${own}`}>{e.sales}</span>,
                  <span key={`${e.companyId}d`} className={`small muted${own}`}>{e.days} j</span>,
                ];
              })}
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
            <div className="choices">
              <label className="choice">
                <input type="checkbox" checked={board.share} onChange={(e) => void window.narthex.leaderboard.set({ share: e.target.checked, showRevenue: board.showRevenue }).then(reload)} />
                <span>
                  Apparaître au classement
                  <span className="muted small block">Nom, ville, ton prénom, étape, bureau, ventes. Jamais ton idée ni tes documents.</span>
                </span>
              </label>
              <label className="choice">
                <input type="checkbox" disabled={!board.share} checked={board.showRevenue} onChange={(e) => void window.narthex.leaderboard.set({ share: board.share, showRevenue: e.target.checked }).then(reload)} />
                <span>
                  Montrer le montant exact
                  <span className="muted small block">Sinon, une tranche (par exemple « 1 000 à 5 000 € »).</span>
                </span>
              </label>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
