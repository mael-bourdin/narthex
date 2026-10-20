import { AVATAR_BACKGROUND, AVATAR_BY_ROLE, AVATAR_EYES, AVATAR_FOUNDER, AVATAR_ROWS, avatarColour, type Palette, type RoleId } from "@narthex/core";

/** The palettes and grid live in the core: the same faces are posted on Discord. */
export const BY_ROLE: Record<RoleId, Palette> = AVATAR_BY_ROLE;
export const FOUNDER: Palette = AVATAR_FOUNDER;
const EYES = AVATAR_EYES;

export function PixelAvatar({ role, founder, size = 36, dim }: { role?: RoleId; founder?: boolean; size?: number; dim?: boolean }) {
  const p = founder ? FOUNDER : role ? BY_ROLE[role] : null;
  const fill = (part: (typeof AVATAR_ROWS)[number][3]) => avatarColour(p!, part);
  return (
    <svg className="pixel-avatar" width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" style={dim ? { opacity: 0.35 } : undefined} aria-hidden>
      <clipPath id={`av-${size}`}>
        <rect width="16" height="16" rx="4.4" />
      </clipPath>
      <g clipPath={`url(#av-${size})`}>
        <rect width="16" height="16" fill={AVATAR_BACKGROUND} />
        {p ? AVATAR_ROWS.map(([r, a, b, part], i) => <rect key={i} x={a} y={r} width={b - a + 1} height={1} fill={fill(part)} />) : <rect x="1" y="1" width="14" height="14" rx="3" fill="none" stroke="#2E3148" strokeDasharray="1 1" strokeWidth=".5" />}
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
