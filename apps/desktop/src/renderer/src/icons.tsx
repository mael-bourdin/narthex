/** Figma icons (Icône / horloge, envoyer, documents, credits, chevron), drawn with currentColor. */
const base = { width: 13, height: 13, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Clock = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 13} height={p.size ?? 13} aria-hidden>
    <circle cx="10" cy="10" r="8.33" />
    <path d="M10 5v5l3.33 1.67" />
  </svg>
);
export const Up = () => (
  <svg {...base} aria-hidden>
    <path d="M10 15.83V4.17M15.83 10 10 4.17 4.17 10" />
  </svg>
);
export const Doc = () => (
  <svg {...base} aria-hidden>
    <path d="M11.67 1.67H5a1.67 1.67 0 0 0-1.67 1.66v13.34A1.67 1.67 0 0 0 5 18.33h10a1.67 1.67 0 0 0 1.67-1.66V6.67l-5-5Z" />
    <path d="M11.67 1.67v5h5" />
  </svg>
);
export const Bolt = () => (
  <svg {...base} aria-hidden>
    <path d="M10.83 1.67 2.5 11.67H10l-.83 6.66 8.33-10H10l.83-6.66Z" />
  </svg>
);
export const Chevron = ({ left }: { left?: boolean }) => (
  <svg {...base} width={14} height={14} style={left ? { transform: "rotate(180deg)" } : undefined} aria-hidden>
    <path d="m7.5 15 5-5-5-5" />
  </svg>
);
