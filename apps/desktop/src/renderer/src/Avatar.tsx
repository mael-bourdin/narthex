import type { RoleId } from "@narthex/core";
import cofondateur from "./portraits/cofondateur.jpg";
import comptable from "./portraits/comptable.jpg";
import juridique from "./portraits/juridique.jpg";
import prospection from "./portraits/prospection.jpg";
import recherche from "./portraits/recherche.jpg";
import redaction from "./portraits/redaction.jpg";
import support from "./portraits/support.jpg";
import technique from "./portraits/technique.jpg";
import video from "./portraits/video.jpg";

/** One face per role (Unsplash photos, see portraits/CREDITS.md). */
const PHOTO: Record<RoleId, string> = { cofondateur, recherche, technique, juridique, prospection, redaction, video, comptable, support };

/**
 * A teammate's face. They are AI agents with human faces: the « IA » tag stays on every
 * portrait big enough to carry it, and in the tooltip otherwise (AI Act, art. 50).
 * The founder gets a plain silhouette; a role not hired yet, an empty dashed circle.
 */
export function Avatar({ role, founder, size = 36, dim }: { role?: RoleId; founder?: boolean; size?: number; dim?: boolean }) {
  const style = { width: size, height: size, ...(dim ? { opacity: 0.35 } : {}) };
  if (founder)
    return (
      <span className="avatar founder" style={style} aria-hidden>
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56}>
          <circle cx="12" cy="8.5" r="4" fill="currentColor" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" fill="currentColor" />
        </svg>
      </span>
    );
  if (!role) return <span className="avatar empty" style={style} aria-hidden />;
  return (
    <span className="avatar" style={style} title="Agent IA">
      <img src={PHOTO[role]} alt="" width={size} height={size} draggable={false} />
      {size >= 30 && <span className="avatar-ai">IA</span>}
    </span>
  );
}
