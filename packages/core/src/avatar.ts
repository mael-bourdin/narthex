import type { RoleId } from "./types.ts";

/**
 * The Figma « Avatar pixel » sprites (153:213), drawn from the same 16×16 grid.
 * Every character shares the shape; only hair, skin and clothes change.
 * Shared by the app (SVG) and the PNGs posted with each agent's messages on Discord.
 */
export type Palette = { hair: string; skin: string; shirt: string };

export const AVATAR_BY_ROLE: Record<RoleId, Palette> = {
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
export const AVATAR_FOUNDER: Palette = { hair: "#3A2A22", skin: "#F1C9A5", shirt: "#CFC8FF" };
export const AVATAR_EYES = "#1B1B24";
export const AVATAR_BACKGROUND = "#1E1E24";

export type AvatarPart = "hair" | "skin" | "eye" | "shirt";
// [row, firstCol, lastCol, part] on a 16-column grid (Figma unit: 2.25 px at 36 px).
export const AVATAR_ROWS: readonly [number, number, number, AvatarPart][] = [
  [1, 4, 11, "hair"], [2, 3, 12, "hair"], [3, 2, 13, "hair"],
  [4, 2, 2, "hair"], [4, 3, 12, "skin"], [4, 13, 13, "hair"],
  [5, 2, 2, "hair"], [5, 3, 3, "skin"], [5, 4, 5, "eye"], [5, 6, 9, "skin"], [5, 10, 11, "eye"], [5, 12, 12, "skin"], [5, 13, 13, "hair"],
  [6, 2, 2, "hair"], [6, 3, 12, "skin"], [6, 13, 13, "hair"],
  [7, 3, 12, "skin"], [8, 4, 11, "skin"], [9, 5, 10, "skin"],
  [10, 3, 12, "shirt"], [11, 2, 13, "shirt"], [12, 1, 14, "shirt"], [13, 1, 14, "shirt"], [14, 1, 14, "shirt"], [15, 1, 14, "shirt"],
];

export function avatarColour(p: Palette, part: AvatarPart): string {
  return part === "eye" ? AVATAR_EYES : p[part];
}

/** Where each role's avatar PNG is served from (the public repository), for Discord. */
export function avatarUrl(role: RoleId | "founder"): string {
  return `https://raw.githubusercontent.com/mael-bourdin/narthex/main/assets/avatars/${role}.png`;
}
