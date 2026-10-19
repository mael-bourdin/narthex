import { useEffect, useState } from "react";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Margaux speaks: big, centred, each word out of a blur. `onDone` fires when the last word is in. */
export function Speech({ text, aside, raised, onDone }: { text: string; aside?: string; raised?: boolean; onDone?: () => void }) {
  const [shown, setShown] = useState<{ words: string[]; count: number; fading: boolean }>({ words: [], count: 0, fading: false });

  useEffect(() => {
    let alive = true;
    const words = text.split(" ").filter(Boolean);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 40) : ms));
    void (async () => {
      setShown((s) => ({ ...s, fading: true }));
      await wait(450);
      if (!alive) return;
      setShown({ words, count: 0, fading: false });
      for (let i = 0; i < words.length; i++) {
        await wait(25);
        if (!alive) return;
        setShown({ words, count: i + 1, fading: false });
        const w = words[i]!;
        await wait(65 + w.length * 13 + (/[.?…!]$/.test(w) ? 260 : 0));
      }
      if (alive) onDone?.();
    })();
    return () => {
      alive = false;
    };
    // onDone is a fresh closure each render; the sentence is what restarts the speech.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={`seuil-say${raised ? " raised" : ""}${shown.fading ? " fading" : ""}`} aria-live="polite">
      <p>
        {shown.words.map((w, i) => (
          <span key={`${text}-${i}`} className={i < shown.count ? "w in" : "w"}>
            {w}
          </span>
        ))}
      </p>
      {aside && shown.count === shown.words.length && shown.words.length > 0 && <p className="seuil-aside">{aside}</p>}
    </div>
  );
}
