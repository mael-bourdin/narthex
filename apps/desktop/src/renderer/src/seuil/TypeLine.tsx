import { useEffect, useRef, useState } from "react";

const RISE_MS = 1700;

/**
 * The founder types straight into the light: no visible field, only a caret.
 * Enter on a non-empty line sends the words up into the ambiance, then calls `onSubmit`.
 */
export function TypeLine({ masked, onSubmit }: { masked?: boolean; onSubmit: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [rising, setRising] = useState<{ word: string; dx: number; dy: number }[] | null>(null);

  useEffect(() => {
    const focus = () => input.current?.focus();
    focus();
    window.addEventListener("pointerdown", focus);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("pointerdown", focus);
      window.removeEventListener("focus", focus);
    };
  }, []);

  const submit = () => {
    const v = value.trim();
    if (!v || rising) return;
    const words = (masked ? display(v, true) : v).split(" ");
    setRising(words.map((word) => ({ word, dx: (Math.random() - 0.5) * 140, dy: -150 - Math.random() * 130 })));
    setTimeout(() => onSubmit(v), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 200 : RISE_MS);
  };

  return (
    <div className={`seuil-type${masked ? " masked" : ""}`} onClick={() => input.current?.focus()}>
      <input
        ref={input}
        className="seuil-hidden-input"
        value={value}
        onChange={(e) => !rising && setValue(e.target.value.replace(/\r?\n/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        autoComplete="off"
        spellCheck={false}
        aria-label={masked ? "Clé API" : "Ta réponse"}
      />
      {rising ? (
        <p className="rising">
          {rising.map((r, i) => (
            <span key={i} style={{ animationDelay: `${i * 55}ms`, ["--dx" as string]: `${r.dx}px`, ["--dy" as string]: `${r.dy}px` }}>
              {r.word}
            </span>
          ))}
        </p>
      ) : (
        <p>
          {display(value, masked)}
          <span className="seuil-caret" />
        </p>
      )}
    </div>
  );
}

function display(value: string, masked?: boolean): string {
  return masked && value.length > 11 ? value.slice(0, 11) + "•".repeat(Math.min(value.length - 11, 26)) : value;
}
