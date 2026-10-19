export type AmbiancePhase = "hidden" | "on" | "awake" | "calm";

/** Braise de minuit: four blurred lights drifting, with grain. `awake` fires the light burst once. */
export function Ambiance({ phase }: { phase: AmbiancePhase }) {
  return (
    <>
      <div className={`seuil-ambiance ${phase}`}>
        <div className="seuil-blob b1" />
        <div className="seuil-blob b2" />
        <div className="seuil-blob b3" />
        <div className="seuil-blob b4" />
      </div>
      {phase === "awake" && <div className="seuil-burst" />}
      <div className="seuil-grain" />
    </>
  );
}
