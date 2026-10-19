import { useState } from "react";
import { Button, Logo } from "./ui.tsx";

/** First launch: the founder only tells the idea. Margaux does the rest. */
export function Onboarding({ onDone }: { onDone(): void }) {
  const [idea, setIdea] = useState("");
  const [founderName, setFounderName] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const ready = idea.trim().length > 10 && founderName.trim() && name.trim();

  const start = async () => {
    try {
      await window.narthex.call("company.found", { idea, founderName, name });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="onboarding">
      <div className="glow" />
      <Logo />
      <h1>Bonjour. Je suis Margaux.</h1>
      <p className="muted">Raconte-moi ton idée en une ou deux phrases. Je m'occupe de monter l'équipe.</p>
      <textarea autoFocus value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Je fabrique des bougies parfumées. Mes amies m'en commandent déjà et j'aimerais en vivre." />
      <div className="fields">
        <input value={founderName} onChange={(e) => setFounderName(e.target.value)} placeholder="Ton prénom" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de l'entreprise (même provisoire)" />
      </div>
      {error && <p className="error">{error}</p>}
      <Button kind="primary" disabled={!ready} onClick={start}>
        C'est parti
      </Button>
    </div>
  );
}
