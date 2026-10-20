/**
 * Renders every agent's pixel avatar to assets/avatars/<role>.png (128×128), for Discord webhooks,
 * which take an image URL. Run after changing a palette: node scripts/avatars.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { AVATAR_BACKGROUND, AVATAR_BY_ROLE, AVATAR_FOUNDER, AVATAR_ROWS, avatarColour, type Palette } from "../packages/core/src/index.ts";

const CELL = 8;
const SIZE = 16 * CELL;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([head, body, crc]);
}

export function avatarPng(p: Palette): Buffer {
  const grid = Array.from({ length: 16 }, () => Array<string>(16).fill(AVATAR_BACKGROUND));
  for (const [row, a, b, part] of AVATAR_ROWS) for (let c = a; c <= b; c++) grid[row]![c] = avatarColour(p, part);
  const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
  for (let y = 0; y < SIZE; y++) {
    const line = y * (SIZE * 3 + 1);
    raw[line] = 0; // no filter
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = rgb(grid[Math.floor(y / CELL)]![Math.floor(x / CELL)]!);
      raw.set([r, g, b], line + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const out = join(import.meta.dirname, "..", "assets", "avatars");
mkdirSync(out, { recursive: true });
for (const [role, palette] of Object.entries(AVATAR_BY_ROLE)) writeFileSync(join(out, `${role}.png`), avatarPng(palette));
writeFileSync(join(out, "founder.png"), avatarPng(AVATAR_FOUNDER));
console.log(`${Object.keys(AVATAR_BY_ROLE).length + 1} avatars → ${out}`);
