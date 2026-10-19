import { useEffect, useState } from "react";
import { ROLE_PROMISE, SEUIL, type RoleDef } from "@narthex/core";

const LIGHT: Record<string, string> = {
  recherche: "#7fb3d9",
  juridique: "#b8a6ff",
  prospection: "#e3a07a",
  redaction: "#9fd6a8",
  video: "#e7a3d8",
  comptable: "#e9cf8a",
  support: "#8fd3cf",
};

/** Each teammate arrives as a breathing light that resolves into a name. Those coming later stay dim. */
export function TeamReveal({ now, later, dimmed, onDone }: { now: RoleDef[]; later: RoleDef[]; dimmed?: boolean; onDone?: () => void }) {
  const all = [...now.map((r) => ({ r, later: false })), ...later.map((r) => ({ r, later: true }))];
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count >= all.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setCount((c) => c + 1), count === 0 ? 300 : 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, all.length]);
  return (
    <div className={`seuil-team${dimmed ? " dimmed" : ""}`}>
      {all.map(({ r, later: isLater }, i) => (
        <div key={r.id} className={`member${isLater ? " later" : ""}${i < count ? " in" : ""}`} style={{ ["--c" as string]: LIGHT[r.id] ?? "#cfc8ff" }}>
          <div className="spark" />
          <div className="name">{r.defaultName}</div>
          <div className="role">{r.title}</div>
          <div className="what">{isLater ? SEUIL.later : ROLE_PROMISE[r.id]}</div>
        </div>
      ))}
    </div>
  );
}
