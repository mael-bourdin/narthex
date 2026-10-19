import { useState } from "react";
import { fmt } from "@narthex/core";
import { Equipe } from "./Equipe.tsx";
import { Fil } from "./Fil.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { Logo } from "./ui.tsx";
import { useCompany } from "./useCompany.ts";

type Tab = "Fil" | "Bureau" | "Équipe" | "Entreprise";
const TABS: Tab[] = ["Fil", "Bureau", "Équipe", "Entreprise"];

export function App() {
  const { state, status, refresh } = useCompany();
  const [tab, setTab] = useState<Tab>("Fil");

  if (state === undefined || !status) return <div className="splash"><Logo /></div>;
  if (state === null) return <Onboarding onDone={refresh} />;

  return (
    <div className={`app platform-${window.narthex.platform}`}>
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>narthex</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="top-right">
          {status.runtime === "simulation" && <span className="pill muted" title="Agents simulés : rien ne sort de ton ordinateur.">Simulation</span>}
          {state.company?.paused && <span className="pill">En pause</span>}
          <span className="pill" title="Crédits utilisés">⚡ {fmt.credits(state.usage.credits)}</span>
        </div>
      </header>
      <main className="page">
        {tab === "Fil" && <Fil state={state} status={status} onChange={refresh} />}
        {tab === "Équipe" && <Equipe state={state} status={status} />}
        {(tab === "Bureau" || tab === "Entreprise") && (
          <div className="columns">
            <div className="main">
              <h1>{tab}</h1>
              <p className="muted">Cette vue arrive bientôt. Les maquettes sont dans Figma ; en attendant, tout est dans le Fil et dans « narthex » en ligne de commande.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
