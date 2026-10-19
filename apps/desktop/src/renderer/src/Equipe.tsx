import { calendar, fmt, team, type CompanyState, type EngineStatus } from "@narthex/core";
import { Avatar, Card } from "./ui.tsx";

export function Equipe({ state, status }: { state: CompanyState; status: EngineStatus }) {
  const start = new Date(status.now);
  start.setHours(0, 0, 0, 0);
  const today = calendar(state, start.getTime(), start.getTime() + 86_400_000);
  return (
    <div className="columns">
      <div className="main">
        <h1>Ton équipe</h1>
        <div className="team">
          {team(state).map((m) => (
            <Card key={m.agent.id}>
              <div className="post-head">
                <Avatar agent={m.agent} size={36} />
                <div>
                  <div className="name">{m.agent.name}</div>
                  <div className="muted small">{m.title}</div>
                </div>
              </div>
              <p className="small">
                <span className={m.current ? "dot working" : "dot"} /> {m.current ? m.current.title : m.next ? `Ensuite : ${m.next.title}` : "Au repos"}
              </p>
              <p className="muted small">
                {m.done} tâche{m.done > 1 ? "s" : ""} faite{m.done > 1 ? "s" : ""} · fiabilité {Math.round(m.reliability * 100)} % · autonomie {m.agent.autonomy}/4
              </p>
            </Card>
          ))}
        </div>
      </div>
      <aside className="side">
        <Card title="Aujourd'hui" aside={fmt.day(status.now)}>
          {today.length === 0 && <p className="muted small">Rien de prévu.</p>}
          {today.map((t) => (
            <div key={t.id} className={`row task-${t.status}`}>
              <span className="muted small hour">{fmt.hour(t.startedAt ?? t.scheduledAt)}</span>
              <div>
                <div className="small">{t.title}</div>
                <div className="muted small">{state.agents[t.agentId]?.name}</div>
              </div>
            </div>
          ))}
        </Card>
      </aside>
    </div>
  );
}
