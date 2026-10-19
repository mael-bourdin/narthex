import { useRef, useState } from "react";
import { fmt } from "@narthex/core";
import { Entreprise } from "./Entreprise.tsx";
import { Equipe, type EquipeView } from "./Equipe.tsx";
import { Fil } from "./Fil.tsx";
import { Seuil } from "./seuil/Seuil.tsx";
import { Bolt } from "./icons.tsx";
import { PixelAvatar } from "./PixelAvatar.tsx";
import { Logo } from "./ui.tsx";
import { useCompany } from "./useCompany.ts";

type Tab = "Fil" | "Bureau" | "Équipe" | "Entreprise";
const TABS: Tab[] = ["Fil", "Bureau", "Équipe", "Entreprise"];

export function App() {
  const { state, status, refresh } = useCompany();
  const [tab, setTab] = useState<Tab>("Fil");
  const [equipeView, setEquipeView] = useState<EquipeView>("Organigramme");
  const [agentId, setAgentId] = useState<string>();
  const [entreprise, setEntreprise] = useState<{ section: string; page?: string }>({ section: "Vue d'ensemble" });
  const openAgent = (id?: string) => {
    setAgentId(id);
    if (id) setTab("Équipe");
  };
  // The first launch keeps the screen until « Entrer », even after the company is founded.
  const firstLaunch = useRef<boolean | undefined>(undefined);
  const [entered, setEntered] = useState(false);
  if (firstLaunch.current === undefined && state !== undefined) firstLaunch.current = state === null;

  if (state === undefined || !status) return <div className="splash"><Logo /></div>;
  if (firstLaunch.current && !entered) {
    return (
      <Seuil
        onDone={() => {
          setEntered(true);
          refresh();
        }}
      />
    );
  }
  if (state === null) return <div className="splash"><Logo /></div>;

  return (
    <div className={`app platform-${window.narthex.platform}`}>
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>narthex</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={t === tab ? "tab active" : "tab"}
              onClick={() => {
                setTab(t);
                setAgentId(undefined);
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="top-right">
          {status.runtime === "simulation" && <span className="pill muted" title="Agents simulés, pour le développement">Simulation</span>}
          <span className="pill credits" title="Dépense IA sur ton compte Anthropic, depuis le début">
            <Bolt /> Dépense IA · {fmt.dollars(state.usage.credits)}
          </span>
          <PixelAvatar founder size={30} />
        </div>
      </header>
      <main className="page">
        {tab === "Fil" && <Fil state={state} status={status} onChange={refresh} onAgent={openAgent} />}
        {tab === "Équipe" && (
          <Equipe state={state} status={status} view={equipeView} agentId={agentId} onView={setEquipeView} onAgent={openAgent} onChange={refresh} />
        )}
        {tab === "Entreprise" && (
          <Entreprise
            state={state}
            status={status}
            section={entreprise.section}
            {...(entreprise.page ? { page: entreprise.page } : {})}
            onNavigate={(section, page) => setEntreprise({ section, ...(page ? { page } : {}) })}
            onAgent={openAgent}
            onChange={refresh}
          />
        )}
        {tab === "Bureau" && (
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
