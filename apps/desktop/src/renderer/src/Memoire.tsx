import { useState } from "react";
import { fmt, isValid, searchJournal, type CompanyState, type Deliverable, type EngineStatus, type Fact } from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { DeliverableView } from "./Deliverable.tsx";
import { SearchIcon } from "./equipe-icons.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";

/**
 * What the team knows (L2 facts, dated) and « pourquoi a-t-on décidé X ? » over the journal (L3).
 * Everything here is real: facts come from deliverables, answers from tasks and their reasons. No model.
 * Same grammar as the Journal (Figma 208:28557): a search field, then one card of dated rows.
 */
export function Memoire({ state, status, onAgent, onChange }: { state: CompanyState; status: EngineStatus; onAgent(id: string): void; onChange(): void }) {
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState<Deliverable>();
  const [old, setOld] = useState(false);
  const [forgetting, setForgetting] = useState<Fact>();
  const asking = question.trim().length > 2;
  const hits = asking ? searchJournal(state, question) : [];
  const facts = Object.values(state.facts);
  const current = facts.filter((f) => isValid(f, status.now)).sort((a, b) => b.importance - a.importance || b.validFrom - a.validFrom);
  const outdated = facts.filter((f) => f.invalidAt !== undefined && f.invalidAt <= status.now).sort((a, b) => b.invalidAt! - a.invalidAt!);
  const source = (id: string) => state.deliverables[id];
  const who = (agentId?: string) => {
    const agent = agentId ? state.agents[agentId] : undefined;
    return agent ? (
      <button className="journal-avatar" onClick={() => onAgent(agent.id)} aria-label={agent.name} title={agent.name}>
        <PixelAvatar role={agent.role} size={28} />
      </button>
    ) : (
      <PixelAvatar role="cofondateur" size={28} />
    );
  };

  return (
    <>
      <h1>Mémoire</h1>
      <div className="eq-tools">
        <label className="eq-search">
          <SearchIcon />
          <input placeholder="Pourquoi a-t-on… ? Que sait-on sur… ?" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Chercher dans la mémoire de l'équipe" />
        </label>
      </div>
      {asking && (
        <section className="card eq-journal">
          <p className="eq-journal-day">Réponses</p>
          {hits.length === 0 && <p className="muted small">Rien dans le journal ni dans la mémoire ne répond à ça.</p>}
          {hits.map((h) => {
            const d = h.kind === "deliverable" ? source(h.id) : h.kind === "fact" ? source(state.facts[h.id]?.deliverableId ?? "") : undefined;
            return (
              <div key={`${h.kind}-${h.id}`} className="eq-journal-row">
                <span className="eq-journal-hour">{fmt.day(h.at)}</span>
                {who(h.agentId)}
                <div className="eq-journal-text">
                  <div>{h.title}</div>
                  {h.why && <div className="muted small">Pourquoi : {h.why}</div>}
                  <div className="eq-fact-meta">
                    <span className="muted small">{h.kind === "task" ? "Tâche" : h.kind === "deliverable" ? "Livrable" : "Fait retenu"}</span>
                    {d && (
                      <button className="eq-quiet-link" onClick={() => setOpen(d)}>
                        {d.title}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="card eq-journal">
        <p className="eq-journal-day">Ce que l'équipe sait</p>
        {current.length === 0 && <p className="muted small">Rien pour l'instant. Chaque livrable terminé y ajoute ce qu'il faut retenir, avec sa date et sa source.</p>}
        {current.map((f) => {
          const d = source(f.deliverableId);
          return (
            <div key={f.id} className="eq-journal-row">
              <span className="eq-journal-hour" title={`Appris le ${fmt.day(f.validFrom)} · importance ${f.importance} sur 10`}>
                <span className={`eq-weight w${Math.ceil(f.importance / 4)}`} />
                {new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(f.validFrom)}
              </span>
              {who(d?.agentId)}
              <div className="eq-journal-text">
                <div>{f.text}</div>
                <div className="eq-fact-meta">
                  <span className="muted small">
                    {[f.subject, f.sensitive ? "réservé à la direction, la compta et le juridique" : "", !d && f.from?.length ? `tiré de ${f.from.length} faits` : ""].filter(Boolean).join(" · ")}
                  </span>
                  {d && (
                    <button className="eq-quiet-link" onClick={() => setOpen(d)} title={d.title}>
                      Source : {d.title}
                    </button>
                  )}
                  <button className="eq-quiet-link" onClick={() => setForgetting(f)}>
                    Oublier
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {outdated.length > 0 && (
          <footer className="eq-journal-foot">
            <span className="muted small">Ce qui n'est plus vrai reste daté, jamais effacé.</span>
            <button className="btn btn-quiet" onClick={() => setOld(!old)}>
              {old ? "Masquer" : "Voir"} ce qui n'est plus vrai ({outdated.length})
            </button>
          </footer>
        )}
      </section>
      {old && outdated.length > 0 && (
        <section className="card eq-journal">
          <p className="eq-journal-day">Plus vrai</p>
          {outdated.map((f) => (
            <div key={f.id} className="eq-journal-row old">
              <span className="eq-journal-hour">{fmt.day(f.invalidAt!)}</span>
              {who(source(f.deliverableId)?.agentId)}
              <div className="eq-journal-text">
                <div>{f.text}</div>
                <div className="muted small">
                  Vrai du {fmt.day(f.validFrom)} au {fmt.day(f.invalidAt!)}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
      {forgetting && (
        <ActionModal
          mission={{
            id: `forget-${forgetting.id}`,
            kind: "rest",
            eyebrow: "Mémoire · effacement définitif",
            title: "Oublier ce fait ?",
            why: `« ${forgetting.text} » sera effacé de la mémoire et du journal, avec ce que l'équipe en a tiré. Le livrable d'où il vient reste tel quel.`,
            action: "forget",
            label: "",
            factId: forgetting.id,
          }}
          state={state}
          now={status.now}
          onClose={() => setForgetting(undefined)}
          onDone={onChange}
        />
      )}
      {open && <DeliverableView d={open} state={state} status={status} onClose={() => setOpen(undefined)} onChange={onChange} />}
    </>
  );
}

/** The Mémoire's side card: how much the team remembers, all counted from real facts. */
export function MemoireNumbers({ state, status }: { state: CompanyState; status: EngineStatus }) {
  const facts = Object.values(state.facts);
  const current = facts.filter((f) => isValid(f, status.now));
  const rows = [
    { label: "Faits retenus", sub: "Encore vrais aujourd'hui", value: current.length },
    { label: "Plus vrais", sub: "Datés, jamais effacés", value: facts.length - current.length },
    { label: "Livrables lus", sub: "D'où viennent les faits", value: new Set(current.map((f) => f.deliverableId).filter(Boolean)).size },
    { label: "Réservés", sub: "Direction, compta et juridique", value: current.filter((f) => f.sensitive).length },
  ];
  return (
    <section className="card eq-numbers">
      <header className="card-head">
        <span>Les chiffres</span>
        <span className="muted eq-aside">mémoire</span>
      </header>
      {rows.map((r) => (
        <div key={r.label} className="eq-number">
          <div>
            <div>{r.label}</div>
            <div className="muted small">{r.sub}</div>
          </div>
          <div className="eq-number-value">{r.value}</div>
        </div>
      ))}
      <p className="muted small eq-note">Chaque agent part de ce qui est connu avant de chercher. Tu peux faire oublier un fait à tout moment.</p>
    </section>
  );
}
