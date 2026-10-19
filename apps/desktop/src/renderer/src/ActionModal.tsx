import { useEffect, useState } from "react";
import { fmt, role, type CompanyState, type LegalForm, type Mission } from "@narthex/core";
import { PixelAvatar } from "./PixelAvatar.tsx";

const FORMS: { form: LegalForm; hint: string }[] = [
  { form: "SASU", hint: "Seule associée, présidente assimilée salariée" },
  { form: "SAS", hint: "Plusieurs associés, très souple" },
  { form: "EURL", hint: "Seule associée, gérante non salariée" },
  { form: "SARL", hint: "Plusieurs associés, cadre plus strict" },
  { form: "EI", hint: "Entreprise individuelle, sans société" },
  { form: "micro", hint: "Micro-entreprise, le plus simple pour démarrer" },
];

const cleanError = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e));

/**
 * Everything the founder types or decides happens here, never inline in the Fil:
 * the key, the legal form, « c'est fait », cancelling an action that is about to leave.
 */
export function ActionModal({ mission, state, now, onClose, onDone }: { mission: Mission; state: CompanyState; now: number; onClose(): void; onDone(): void }) {
  const [key, setKey] = useState("");
  const [form, setForm] = useState<LegalForm>("SASU");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const speaker = mission.speakerId ? state.agents[mission.speakerId] : undefined;
  const task = mission.taskId ? state.tasks[mission.taskId] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const problem = await fn();
      if (problem) return setMessage(problem);
      onDone();
      onClose();
    } catch (e) {
      setMessage(cleanError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <p className="modal-eyebrow">{mission.eyebrow}</p>
        <h2>{mission.title}</h2>
        <p className="modal-why">{mission.why}</p>
        {speaker && (
          <p className="modal-who">
            <PixelAvatar role={speaker.role} size={24} /> {speaker.name} · {role(speaker.role).title}
          </p>
        )}

        {mission.action === "key" && (
          <div className="modal-body">
            <input
              autoFocus
              type="password"
              value={key}
              placeholder="sk-ant-…"
              aria-label="Clé API Anthropic"
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && key.trim() && run(() => submitKey(key))}
            />
            <p className="muted small">Elle reste sur ton ordinateur. Chaque mission consomme des crédits sur ton compte Anthropic.</p>
          </div>
        )}

        {mission.action === "form" && (
          <div className="modal-body forms">
            {FORMS.map((f) => (
              <label key={f.form} className={f.form === form ? "form-option on" : "form-option"}>
                <input type="radio" name="forme" checked={f.form === form} onChange={() => setForm(f.form)} />
                <span>{f.form}</span>
                <span className="muted small">{f.hint}</span>
              </label>
            ))}
            <p className="muted small">Hugo t'explique les conséquences de chaque forme ; le choix t'appartient.</p>
          </div>
        )}

        {mission.action === "cancel" && task && (
          <div className="modal-body">
            <p className="small">
              Prévu par {state.agents[task.agentId]?.name}. Part {fmt.relative(task.cancellableUntil ?? task.scheduledAt, now)}, le {fmt.day(task.cancellableUntil ?? task.scheduledAt)} à{" "}
              {fmt.hour(task.cancellableUntil ?? task.scheduledAt)}.
            </p>
          </div>
        )}

        {mission.action === "open" && task && (
          <div className="modal-body">
            <p className="small">
              {task.status === "running" ? `En cours depuis ${fmt.relative(task.startedAt ?? now, now).replace("il y a ", "")}` : `Prévue ${fmt.relative(task.scheduledAt, now)}`}
              {task.progress && task.progress !== "Au travail…" ? ` · ${task.progress}` : ""}
            </p>
            <p className="muted small">Pourquoi : {task.why}</p>
          </div>
        )}

        {message && <p className="error small">{message}</p>}

        <div className="modal-actions">
          <button className="btn btn-quiet" onClick={onClose}>
            {mission.action === "cancel" ? "Laisser partir" : "Fermer"}
          </button>
          {mission.action === "key" && (
            <button className="btn btn-primary" disabled={!key.trim() || busy} onClick={() => run(() => submitKey(key))}>
              {busy ? "Vérification…" : "Ajouter ma clé"}
            </button>
          )}
          {mission.action === "form" && (
            <button className="btn btn-primary" disabled={busy} onClick={() => run(() => fulfill(mission.obligationId!, form))}>
              Choisir {form}
            </button>
          )}
          {mission.action === "fulfill" && (
            <button className="btn btn-primary" disabled={busy} onClick={() => run(() => fulfill(mission.obligationId!))}>
              C'est fait
            </button>
          )}
          {mission.action === "cancel" && (
            <button className="btn btn-danger" disabled={busy} onClick={() => run(() => cancel(mission.taskId!))}>
              Annuler l'action
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

async function submitKey(key: string): Promise<string | void> {
  const r = await window.narthex.onboarding.submitKey(key);
  if (!r.ok) return r.message;
  if (!r.applied) return "Clé enregistrée. Elle servira dès que l'équipe sera relancée.";
}

async function fulfill(obligationId: string, legalForm?: LegalForm): Promise<void> {
  await window.narthex.call("obligation.fulfill", { obligationId, ...(legalForm ? { legalForm } : {}) });
}

async function cancel(taskId: string): Promise<void> {
  await window.narthex.call("task.cancel", { taskId });
}
