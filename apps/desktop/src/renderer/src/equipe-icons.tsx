/** Icons of the Équipe pages (Figma « Icône / recherche, filtre, télécharger, coche »), drawn with currentColor. */
const ICON = { width: 14, height: 14, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const SearchIcon = () => (
  <svg {...ICON} aria-hidden>
    <circle cx="9" cy="9" r="5.8" />
    <path d="m13.5 13.5 3.5 3.5" />
  </svg>
);
export const FilterIcon = () => (
  <svg {...ICON} aria-hidden>
    <path d="M3.3 5.8h13.4M5.8 10h8.4M8.3 14.2h3.4" />
  </svg>
);
export const DownloadIcon = () => (
  <svg {...ICON} aria-hidden>
    <path d="M10 3.3v9.2M6.3 8.8 10 12.5l3.7-3.7M3.3 16.7h13.4" />
  </svg>
);
export const Check = () => (
  <svg {...ICON} aria-hidden>
    <path d="m4.2 10.4 3.7 3.7 7.9-8.3" />
  </svg>
);

