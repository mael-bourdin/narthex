import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { rankLeaderboard, validEntry, type LeaderboardEntry } from "@narthex/core";
import type { LeaderboardStore } from "./store.ts";

const MAX_BODY = 8 * 1024;

/**
 * The public leaderboard: GET /v1/leaderboard for everyone; PUT and DELETE /v1/entries/:companyId
 * for hosted instances, with their token (Authorization: Bearer). Nothing else is stored or served.
 */
export function startLeaderboard(options: { store: LeaderboardStore; port: number; host?: string; now?: () => number }): Promise<Server> {
  const { store } = options;
  const now = options.now ?? Date.now;
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => send(res, 500, { error: "Internal error." }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/v1/leaderboard") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      return send(res, 200, { updatedAt: now(), entries: rankLeaderboard(store.entries()).slice(0, limit) }, { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" });
    }
    const match = url.pathname.match(/^\/v1\/entries\/([\w-]{1,64})$/);
    if (!match || (req.method !== "PUT" && req.method !== "DELETE")) return send(res, 404, { error: "Not found." });
    const companyId = match[1]!;
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const tokenHash = token ? store.check(token) : undefined;
    if (!tokenHash) return send(res, 401, { error: "Unknown or revoked token." });
    const taken = { error: "This company is published by another instance." };
    if (req.method === "DELETE") return store.remove(tokenHash, companyId) ? send(res, 204) : send(res, 403, taken);
    const raw = await body(req);
    if (raw === undefined) return send(res, 413, { error: "Entry too large." });
    let entry: unknown;
    try {
      entry = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: "Invalid JSON." });
    }
    if (!validEntry(entry) || entry.companyId !== companyId) return send(res, 400, { error: "Invalid entry." });
    return store.put(tokenHash, { ...publicFields(entry), updatedAt: now() }, now()) ? send(res, 204) : send(res, 403, taken);
  }

  return new Promise((resolve) => server.listen(options.port, options.host ?? "127.0.0.1", () => resolve(server)));
}

/** Only the fields of a ranking entry are kept, whatever else the request carried. */
function publicFields(e: LeaderboardEntry): LeaderboardEntry {
  return {
    companyId: e.companyId,
    name: e.name,
    ...(e.founder !== undefined ? { founder: e.founder } : {}),
    ...(e.city !== undefined ? { city: e.city } : {}),
    stage: e.stage,
    office: e.office,
    sales: e.sales,
    revenueBand: e.revenueBand,
    ...(e.revenue !== undefined ? { revenue: e.revenue } : {}),
    days: e.days,
    xp: e.xp,
    updatedAt: e.updatedAt,
  };
}

function body(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    // A slow client cannot hold the request open forever.
    req.setTimeout(10_000, () => {
      resolve(undefined);
      req.destroy();
    });
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function send(res: ServerResponse, status: number, value?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...(value === undefined ? {} : { "content-type": "application/json; charset=utf-8" }), ...headers });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}
