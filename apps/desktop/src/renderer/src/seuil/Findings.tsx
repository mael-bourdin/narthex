import { useEffect, useState } from "react";
import type { Finding } from "@narthex/core";

/** What Margaux found, one line at a time, each with its source. */
export function Findings({ items, onDone }: { items: Finding[]; onDone?: () => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count >= items.length) {
      const t = setTimeout(() => onDone?.(), 1500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount((c) => c + 1), count === 0 ? 300 : 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, items.length]);
  return (
    <ul className="seuil-findings">
      {items.map((f, i) => (
        <li key={i} className={i < count ? "in" : ""}>
          {f.text}
          <small>{f.source}</small>
        </li>
      ))}
    </ul>
  );
}
