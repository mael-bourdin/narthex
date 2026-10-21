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
