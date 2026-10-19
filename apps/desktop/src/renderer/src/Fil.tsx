import { useState } from "react";
import {
  cancellable,
  feed,
  fmt,
  forFounder,
  role,
  type CompanyState,
  type Deliverable,
  type EngineStatus,
  type LegalForm,
  type Obligation,
} from "@narthex/core";
import { Avatar, Button, Card } from "./ui.tsx";

const FORMS: LegalForm[] = ["SASU", "SAS", "EURL", "SARL", "EI", "micro"];

export function Fil({ state, status, onChange }: { state: CompanyState; status: EngineStatus; onChange(): void }) {
  const [open, setOpen] = useState<Deliverable>();
  const [error, setError] = useState<string>();
  const legal = forFounder(state);
  const pending = cancellable(state, status.now);
  const items = feed(state, 60);

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));
    }
  };

  return (
    <div className="columns">
      <div className="main">
        {legal[0] && <Pancarte o={legal[0]} total={legal.length} state={state} onDone={(form) => act(() => window.narthex.call("obligation.fulfill", { obligationId: legal[0]!.id, ...(form ? { legalForm: form } : {}) }))} />}
        {error && <p className="error">{error}</p>}
        {pending.map((t) => (
          <Card key={t.id}>
            <PostHead state={state} agentId={t.agentId} at={t.createdAt} now={status.now} />
            <p className="text">{t.title}. {t.why}</p>
            <div className="actions">
              <span className="delay">◷ Part {fmt.relative(t.cancellableUntil!, status.now)}</span>
              <Button onClick={() => act(() => window.narthex.call("task.cancel", { taskId: t.id }))}>Annuler</Button>
            </div>
          </Card>
        ))}
        {items.map(({ post, deliverable }) => (
          <Card key={post.id}>
            <PostHead state={state} agentId={post.agentId} at={post.at} now={status.now} />
            <p className="text">{post.text}</p>
            {deliverable && (
              <button className="attachment" onClick={() => setOpen(deliverable)}>
                <span className="attachment-title">{deliverable.title}</span>
                <span className="muted">{deliverable.summary}</span>
              </button>
            )}
          </Card>
        ))}
      </div>
      <aside className="side">
        <Card title="Les chiffres" aside={state.company?.name}>
          <Kpi label="Agents" value={Object.keys(state.agents).length} detail="Recrutés au bon moment par Margaux" />
          <Kpi label="Tâches faites" value={Object.values(state.tasks).filter((t) => t.status === "done").length} detail="Lancées seules par l'équipe" />
          <Kpi label="Crédits" value={fmt.credits(state.usage.credits)} detail={status.runtime === "simulation" ? "Simulés" : "Consommés sur ta clé"} />
        </Card>
        <Card title="En ce moment">
          {Object.values(state.agents).map((a) => {
            const t = a.currentTaskId ? state.tasks[a.currentTaskId] : undefined;
            return (
              <div key={a.id} className={t ? "row" : "row resting"}>
                <Avatar agent={a} size={28} />
                <div>
                  <div>{a.name}</div>
                  <div className="muted small">{t ? (t.progress && t.progress !== "Au travail…" ? t.progress : t.title) : "Au repos"}</div>
                </div>
              </div>
            );
          })}
        </Card>
      </aside>
      {open && <DeliverableView d={open} state={state} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function PostHead({ state, agentId, at, now }: { state: CompanyState; agentId: string; at: number; now: number }) {
  const agent = state.agents[agentId];
  return (
    <div className="post-head">
      <Avatar agent={agent} />
      <span className="name">{agent?.name}</span>
      <span className="muted">· {agent ? role(agent.role).title : ""}</span>
      <span className="muted time">{fmt.relative(at, now)}</span>
    </div>
  );
}

/** The gradient sign: only for what the law reserves to the founder. */
function Pancarte({ o, total, state, onDone }: { o: Obligation; total: number; state: CompanyState; onDone(form?: LegalForm): void }) {
  const [form, setForm] = useState<LegalForm>("SASU");
  const legal = Object.values(state.agents).find((a) => a.role === "juridique");
  return (
    <section className="pancarte">
      <div className="pancarte-top">
        <span>À faire par toi · la loi l'impose</span>
        {total > 1 && <span>1 / {total}</span>}
      </div>
      <h2>{o.title}</h2>
      <p>{o.why}</p>
      <div className="pancarte-bottom">
        <span className="who">
          <Avatar agent={legal} size={24} /> {legal ? `${legal.name} · Juridique` : ""}
        </span>
        <span className="actions">
          {o.code === "A3-forme" && (
            <select value={form} onChange={(e) => setForm(e.target.value as LegalForm)}>
              {FORMS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          )}
          <Button kind="primary" onClick={() => onDone(o.code === "A3-forme" ? form : undefined)}>
            C'est fait
          </Button>
        </span>
      </div>
    </section>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="kpi">
      <div>
        <div>{label}</div>
        <div className="muted small">{detail}</div>
      </div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function DeliverableView({ d, state, onClose }: { d: Deliverable; state: CompanyState; onClose(): void }) {
  const agent = state.agents[d.agentId];
  return (
    <div className="overlay" onClick={onClose}>
      <article className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="link" onClick={onClose}>← Fil</button>
        <div className="post-head">
          <Avatar agent={agent} size={40} />
          <div>
            <h1>{d.title}</h1>
            <div className="muted small">{agent?.name} · {fmt.day(d.createdAt)} · {d.sources.length} source{d.sources.length > 1 ? "s" : ""}</div>
          </div>
        </div>
        <pre className="doc">{d.body}</pre>
        {d.sources.length > 0 && (
          <ul className="sources">
            {d.sources.map((s, i) => (
              <li key={i}>
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}
                {s.checkedAt && <span className="muted"> · vérifié le {s.checkedAt}</span>}
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
