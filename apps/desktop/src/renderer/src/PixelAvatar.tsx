import type { RoleId } from "@narthex/core";

/**
 * The Figma « Avatar pixel » sprites (153:213), drawn from the same 16×16 grid.
 * Every character shares the shape; only hair, skin and clothes change.
 */
export type Palette = { hair: string; skin: string; shirt: string };

export const BY_ROLE: Record<RoleId, Palette> = {
  cofondateur: { hair: "#2B2B33", skin: "#F1C9A5", shirt: "#E9E6F0" }, // Margaux
  recherche: { hair: "#C9A66B", skin: "#F3D0B0", shirt: "#5C7C8A" }, // Léa
  technique: { hair: "#8B5A3C", skin: "#E9BC97", shirt: "#3F6E5E" }, // Nina
  juridique: { hair: "#6B4A2E", skin: "#E8B892", shirt: "#2F3554" }, // Hugo
  prospection: { hair: "#1D1D22", skin: "#B9825C", shirt: "#8A5A6E" }, // Samir
  redaction: { hair: "#A0522D", skin: "#F0C4A0", shirt: "#7A8F5A" }, // Jeanne
  video: { hair: "#E8E2D6", skin: "#E6B48E", shirt: "#4A4E8F" }, // Oscar
  comptable: { hair: "#4A3B2C", skin: "#EBC1A0", shirt: "#8C7A5B" },
  support: { hair: "#2E2E2E", skin: "#D9A27E", shirt: "#3E7C7A" },
};
export const FOUNDER: Palette = { hair: "#3A2A22", skin: "#F1C9A5", shirt: "#CFC8FF" };
const EYES = "#1B1B24";

// [row, firstCol, lastCol, part] on a 16-column grid (Figma unit: 2.25 px at 36 px).
const H = "hair", S = "skin", E = "eye", C = "shirt";
const ROWS: [number, number, number, string][] = [
  [1, 4, 11, H], [2, 3, 12, H], [3, 2, 13, H],
  [4, 2, 2, H], [4, 3, 12, S], [4, 13, 13, H],
  [5, 2, 2, H], [5, 3, 3, S], [5, 4, 5, E], [5, 6, 9, S], [5, 10, 11, E], [5, 12, 12, S], [5, 13, 13, H],
  [6, 2, 2, H], [6, 3, 12, S], [6, 13, 13, H],
  [7, 3, 12, S], [8, 4, 11, S], [9, 5, 10, S],
  [10, 3, 12, C], [11, 2, 13, C], [12, 1, 14, C], [13, 1, 14, C], [14, 1, 14, C], [15, 1, 14, C],
];

export function PixelAvatar({ role, founder, size = 36, dim }: { role?: RoleId; founder?: boolean; size?: number; dim?: boolean }) {
  const p = founder ? FOUNDER : role ? BY_ROLE[role] : null;
  const fill = (part: string) => (part === E ? EYES : part === H ? p!.hair : part === S ? p!.skin : p!.shirt);
  return (
    <svg className="pixel-avatar" width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" style={dim ? { opacity: 0.35 } : undefined} aria-hidden>
      <clipPath id={`av-${size}`}>
        <rect width="16" height="16" rx="4.4" />
      </clipPath>
      <g clipPath={`url(#av-${size})`}>
        <rect width="16" height="16" fill="#1E1E24" />
        {p ? ROWS.map(([r, a, b, part], i) => <rect key={i} x={a} y={r} width={b - a + 1} height={1} fill={fill(part)} />) : <rect x="1" y="1" width="14" height="14" rx="3" fill="none" stroke="#2E3148" strokeDasharray="1 1" strokeWidth=".5" />}
      </g>
    </svg>
  );
}

/**
 * Full-body character for the Bureau (Figma « Sprite »): same palette as the avatar,
 * on a 12×16 grid. `step` alternates the legs while walking.
 */
export function PixelSprite({ role, founder, size = 36, step = 0 }: { role?: RoleId; founder?: boolean; size?: number; step?: 0 | 1 }) {
  const p = founder ? FOUNDER : role ? BY_ROLE[role] : BY_ROLE.cofondateur;
  const pants = "#2b2b38";
  const shoes = "#1b1b24";
  const rows: [number, number, number, string][] = [
    [0, 3, 8, p.hair], [1, 2, 9, p.hair], [2, 2, 2, p.hair], [2, 3, 8, p.skin], [2, 9, 9, p.hair],
    [3, 2, 2, p.hair], [3, 3, 3, p.skin], [3, 4, 4, EYES], [3, 5, 6, p.skin], [3, 7, 7, EYES], [3, 8, 8, p.skin], [3, 9, 9, p.hair],
    [4, 3, 8, p.skin], [5, 4, 7, p.skin],
    [6, 2, 9, p.shirt], [7, 1, 10, p.shirt], [8, 1, 10, p.shirt], [9, 1, 1, p.skin], [9, 2, 9, p.shirt], [9, 10, 10, p.skin],
    [10, 3, 8, pants], [11, 3, 8, pants],
  ];
  const legs: [number, number, number, string][] =
    step === 0
      ? [[12, 3, 4, pants], [12, 7, 8, pants], [13, 3, 4, shoes], [13, 7, 8, shoes]]
      : [[12, 2, 3, pants], [12, 8, 9, pants], [13, 2, 3, shoes], [13, 8, 9, shoes]];
  return (
    <svg width={size * (12 / 16)} height={size} viewBox="0 0 12 14" shapeRendering="crispEdges" aria-hidden className="pixel-sprite">
      {[...rows, ...legs].map(([r, a, b, fill], i) => (
        <rect key={i} x={a} y={r} width={b - a + 1} height={1} fill={fill} />
      ))}
    </svg>
  );
}
