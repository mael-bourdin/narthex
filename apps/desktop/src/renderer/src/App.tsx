import { useRef, useState } from "react";
import { fmt } from "@narthex/core";
import { CompanySwitcher } from "./CompanySwitcher.tsx";
import { Reglages, type ReglagesView } from "./Reglages.tsx";
import { Equipe, type EquipeView } from "./Equipe.tsx";
import { Fil } from "./Fil.tsx";
import { Seuil } from "./seuil/Seuil.tsx";
import { Bolt } from "./icons.tsx";
import { Avatar } from "./Avatar.tsx";
import { Logo } from "./ui.tsx";
import { useCompany } from "./useCompany.ts";

type Tab = "Fil" | "Équipe" | "Réglages";
const TABS: Tab[] = ["Fil", "Équipe"];

export function App() {
  const { state, status, refresh } = useCompany();
  const [tab, setTab] = useState<Tab>("Fil");
  const [equipeView, setEquipeView] = useState<EquipeView>("Organigramme");
  const [agentId, setAgentId] = useState<string>();
  const [reglages, setReglages] = useState<ReglagesView>("Profil");
  const openAgent = (id?: string) => {
    setAgentId(id);
    if (id) setTab("Équipe");
  };
  // The first launch keeps the screen until « Entrer », even after the company is founded.
  const firstLaunch = useRef<boolean | undefined>(undefined);
  const [entered, setEntered] = useState(false);
  const [creating, setCreating] = useState(false);
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
  // A new company: the same first launch, with a way back to the current one.
  if (creating) {
    return (
      <div className="creating">
        <button className="link creating-back" onClick={() => setCreating(false)}>
          ← Retour à {state.company?.name}
        </button>
        <Seuil
          onDone={() => {
            setCreating(false);
            setTab("Fil");
            setAgentId(undefined);
            refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className={`app platform-${window.narthex.platform}`}>
      <header className="topbar">
        <CompanySwitcher
          current={state.company?.name ?? ""}
          onSwitch={() => {
            setTab("Fil");
            setAgentId(undefined);
            refresh();
          }}
          onCreate={() => setCreating(true)}
        />
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
          {status.runtime === "claude-code" && <span className="pill muted" title="Développement : ton Claude Code et ton abonnement claude.ai, sans clé API">Claude Code (dev)</span>}
          {status.subscription ? (
            <span
              className={`pill credits${status.unavailable ? " waiting" : ""}`}
              title={status.unavailable ?? "Ton abonnement claude.ai : part utilisée de la fenêtre de 5 h et de la semaine. Rien de nouveau ne démarre au-delà de 90 %."}
            >
              <Bolt /> Abonnement · {[status.subscription.fiveHour, status.subscription.sevenDay].filter((v) => v !== undefined).map((v) => `${Math.round(v! * 100)} %`).join(" · ")}
            </span>
          ) : (
            <span className="pill credits" title="Dépense IA chez ton fournisseur, depuis le début">
              <Bolt /> Dépense IA · {fmt.dollars(state.usage.credits)}
            </span>
          )}
          <button className={tab === "Réglages" ? "avatar-btn on" : "avatar-btn"} onClick={() => setTab("Réglages")} aria-label="Réglages" title="Réglages">
            <Avatar founder size={30} />
          </button>
        </div>
      </header>
      <main className="page">
        {tab === "Fil" && <Fil state={state} status={status} onChange={refresh} onAgent={openAgent} />}
        {tab === "Équipe" && (
          <Equipe state={state} status={status} view={equipeView} agentId={agentId} onView={setEquipeView} onAgent={openAgent} onChange={refresh} />
        )}
        {tab === "Réglages" && <Reglages state={state} status={status} view={reglages} onView={setReglages} onChange={refresh} />}
      </main>
    </div>
  );
}
