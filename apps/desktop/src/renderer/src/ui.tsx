import type { ReactNode } from "react";
import type { Agent } from "@narthex/core";

/** Small building blocks matching the Figma components (Narthex/Components page). */

const HUES: Record<string, number> = { cofondateur: 260, recherche: 190, juridique: 220, prospection: 20, redaction: 140, video: 300, comptable: 45, support: 170 };

export function Avatar({ agent, size = 32 }: { agent?: Agent; size?: number }) {
  const hue = agent ? (HUES[agent.role] ?? 240) : 240;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue} 35% 28%)`, color: `hsl(${hue} 80% 86%)` }}
      aria-hidden
    >
      {agent?.name.charAt(0) ?? "?"}
    </span>
  );
}

export function Card({ title, aside, children }: { title?: string; aside?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && (
        <header className="card-head">
          <span>{title}</span>
          {aside && <span className="muted">{aside}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  kind = "secondary",
  onClick,
  children,
  disabled,
}: {
  kind?: "primary" | "secondary" | "quiet";
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button className={`btn btn-${kind}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** The seuil: an open door with light rising behind it. */
export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <defs>
        <linearGradient id="light" x1="11" y1="20" x2="11" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C9B8FF" />
          <stop offset="1" stopColor="#C9B8FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M5 19V10a6 6 0 0 1 12 0v9" stroke="#E6E4DD" strokeWidth="1.6" />
      <rect x="8" y="10" width="6" height="9" fill="url(#light)" />
      <path d="M3 19.5h16" stroke="#E6E4DD" strokeWidth="1.6" />
    </svg>
  );
}
