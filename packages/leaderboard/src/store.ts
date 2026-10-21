import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import type { LeaderboardEntry } from "@narthex/core";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Tokens of hosted instances (only their hash is kept) and the latest entry of each company.
 * A company belongs to the token that first published it.
 */
export class LeaderboardStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS entries (company_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);
  }

  /** A new token for a hosted instance; shown once, stored as a hash. */
  issue(label: string): string {
    const token = `nxl_${randomBytes(24).toString("base64url")}`;
    this.db.prepare("INSERT INTO tokens (hash, label, created_at) VALUES (?, ?, ?)").run(hash(token), label, Date.now());
    return token;
  }

  revoke(label: string): boolean {
    return Number(this.db.prepare("UPDATE tokens SET revoked = 1 WHERE label = ?").run(label).changes) > 0;
  }

  /** The token's hash if it is known and not revoked. */
  check(token: string): string | undefined {
    const row = this.db.prepare("SELECT hash FROM tokens WHERE hash = ? AND revoked = 0").get(hash(token)) as { hash: string } | undefined;
    return row?.hash;
  }

  owner(companyId: string): string | undefined {
    return (this.db.prepare("SELECT token_hash AS t FROM entries WHERE company_id = ?").get(companyId) as { t: string } | undefined)?.t;
  }

  put(tokenHash: string, entry: LeaderboardEntry, now: number): void {
    this.db
      .prepare("INSERT INTO entries (company_id, token_hash, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(company_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at")
      .run(entry.companyId, tokenHash, JSON.stringify(entry), now);
  }

  remove(companyId: string): void {
    this.db.prepare("DELETE FROM entries WHERE company_id = ?").run(companyId);
  }

  entries(): LeaderboardEntry[] {
    return (this.db.prepare("SELECT payload FROM entries").all() as { payload: string }[]).map((r) => JSON.parse(r.payload) as LeaderboardEntry);
  }

  /** Everything stored, for tests and audits. */
  dump(): unknown {
    return { tokens: this.db.prepare("SELECT * FROM tokens").all(), entries: this.db.prepare("SELECT * FROM entries").all() };
  }

  close(): void {
    this.db.close();
  }
}
