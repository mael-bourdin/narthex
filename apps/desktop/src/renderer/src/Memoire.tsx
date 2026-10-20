import { useState } from "react";
import { fmt, isValid, searchJournal, type CompanyState, type Deliverable, type EngineStatus, type Fact } from "@narthex/core";
import { ActionModal } from "./ActionModal.tsx";
import { DeliverableView } from "./Deliverable.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";

/**
 * What the team knows (L2 facts, dated) and « pourquoi a-t-on décidé X ? » over the journal (L3).
 * Everything here is real: facts come from deliverables, answers from tasks and their reasons. No model.
 */
export function Memoire({ state, status, onAgent, onChange }: { state: CompanyState; status: EngineStatus; onAgent(id: string): void; onChange(): void }) {
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState<Deliverable>();
  const [old, setOld] = useState(false);
  const [forgetting, setForgetting] = useState<Fact>();
  const hits = question.trim().length > 2 ? searchJournal(state, question) : [];
  const facts = Object.values(state.facts);
  const current = facts.filter((f) => isValid(f, status.now)).sort((a, b) => b.importance - a.importance || b.validFrom - a.validFrom);
  const outdated = facts.filter((f) => f.invalidAt !== undefined && f.invalidAt <= status.now).sort((a, b) => b.invalidAt! - a.invalidAt!);
  const source = (id: string) => state.deliverables[id];

  return (
    <>
      <h1>Mémoire</h1>
      <input
        className="search"
        placeholder="Pourquoi a-t-on… ? Que sait-on sur… ?"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        aria-label="Chercher dans la mémoire de l'équipe"
      />
      {question.trim().length > 2 && (
        <section className="card memory-hits">
          {hits.length === 0 && <p className="muted small">Rien dans le journal ni dans la mémoire ne répond à ça.</p>}
          {hits.map((h) => {
            const agent = h.agentId ? state.agents[h.agentId] : undefined;
            const d = h.kind === "deliverable" ? source(h.id) : h.kind === "fact" ? source(state.facts[h.id]?.deliverableId ?? "") : undefined;
            return (
              <div key={`${h.kind}-${h.id}`} className="memory-row">
                {agent ? (
                  <button className="journal-avatar" onClick={() => onAgent(agent.id)} aria-label={agent.name}>
                    <PixelAvatar role={agent.role} size={24} />
                  </button>
                ) : (
                  <span className="memory-dot" />
                )}
                <div>
                  <div className="small">{h.title}</div>
                  {h.why && <div className="muted small">Pourquoi : {h.why}</div>}
                  <div className="muted small">
                    {h.kind === "task" ? "Tâche" : h.kind === "deliverable" ? "Livrable" : "Fait retenu"} · {fmt.day(h.at)}
                    {d && (
                      <>
                        {" · "}
                        <button className="link inline" onClick={() => setOpen(d)}>
                          {d.title}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      <h2 className="memory-title">Ce que l'équipe sait</h2>
      <section className="card memory-facts">
        {current.length === 0 && <p className="muted small">Rien pour l'instant. Chaque livrable terminé y ajoute ce qu'il faut retenir, avec sa date et sa source.</p>}
        {current.map((f) => (
          <div key={f.id} className="memory-row">
            <span className={`memory-weight w${Math.ceil(f.importance / 4)}`} title={`Importance ${f.importance} sur 10`} />
            <div>
              <div className="small">{f.text}</div>
              <div className="muted small">
                {f.subject ? `${f.subject} · ` : ""}appris le {fmt.day(f.validFrom)}
                {f.sensitive ? " · réservé à la direction, la compta et le juridique" : ""}
                {source(f.deliverableId) && (
                  <>
                    {" · "}
                    <button className="link inline" onClick={() => setOpen(source(f.deliverableId))}>
                      {source(f.deliverableId)!.title}
                    </button>
                  </>
                )}
                {" · "}
                <button className="link inline" onClick={() => setForgetting(f)}>
                  Oublier
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>
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

      {outdated.length > 0 && (
        <>
          <button className="link more-old" onClick={() => setOld(!old)}>
            {old ? "Masquer" : "Voir"} ce qui n'est plus vrai ({outdated.length})
          </button>
          {old && (
            <section className="card memory-facts old">
              {outdated.map((f) => (
                <div key={f.id} className="memory-row">
                  <span className="memory-weight" />
                  <div>
                    <div className="small">{f.text}</div>
                    <div className="muted small">
                      Vrai du {fmt.day(f.validFrom)} au {fmt.day(f.invalidAt!)}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {open && <DeliverableView d={open} state={state} status={status} onClose={() => setOpen(undefined)} onChange={onChange} />}
    </>
  );
}
