import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import type { DomainEvent, Id, StoredEvent } from "@narthex/core";

/**
 * Append-only event log. SQLite in a single file (WAL, zero ops). The interface is small
 * on purpose so a hosted Postgres store can replace it for the paid, hosted version.
 */
export interface EventStore {
  append(companyId: Id, event: DomainEvent, ts: number): StoredEvent;
  read(companyId: Id, afterSeq?: number, limit?: number): StoredEvent[];
  companies(): Id[];
  close(): void;
}

export class MemoryEventStore implements EventStore {
  private readonly logs = new Map<Id, StoredEvent[]>();

  append(companyId: Id, event: DomainEvent, ts: number): StoredEvent {
    const log = this.logs.get(companyId) ?? [];
    const stored = { ...event, companyId, seq: log.length + 1, ts } as StoredEvent;
    log.push(stored);
    this.logs.set(companyId, log);
    return stored;
  }

  read(companyId: Id, afterSeq = 0, limit = Number.MAX_SAFE_INTEGER): StoredEvent[] {
    return (this.logs.get(companyId) ?? []).filter((e) => e.seq > afterSeq).slice(0, limit);
  }

  companies(): Id[] {
    return [...this.logs.keys()];
  }

  close(): void {}
}

export class SqliteEventStore implements EventStore {
  private readonly db: DatabaseSync;
  private readonly seqs = new Map<Id, number>();

  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    // Loaded lazily so the memory store never touches node:sqlite (and its experimental warning).
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS events (
        company_id TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        ts         INTEGER NOT NULL,
        type       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        PRIMARY KEY (company_id, seq)
      );
      CREATE INDEX IF NOT EXISTS events_type ON events (company_id, type);
    `);
  }

  private nextSeq(companyId: Id): number {
    let seq = this.seqs.get(companyId);
    if (seq === undefined) {
      const row = this.db.prepare("SELECT MAX(seq) AS s FROM events WHERE company_id = ?").get(companyId) as { s: number | null };
      seq = row.s ?? 0;
    }
    seq += 1;
    this.seqs.set(companyId, seq);
    return seq;
  }

  append(companyId: Id, event: DomainEvent, ts: number): StoredEvent {
    const seq = this.nextSeq(companyId);
    this.db
      .prepare("INSERT INTO events (company_id, seq, ts, type, payload) VALUES (?, ?, ?, ?, ?)")
      .run(companyId, seq, ts, event.type, JSON.stringify(event));
    return { ...event, companyId, seq, ts } as StoredEvent;
  }

  read(companyId: Id, afterSeq = 0, limit = -1): StoredEvent[] {
    const rows = this.db
      .prepare("SELECT seq, ts, payload FROM events WHERE company_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(companyId, afterSeq, limit) as { seq: number; ts: number; payload: string }[];
    return rows.map((r) => ({ ...(JSON.parse(r.payload) as DomainEvent), companyId, seq: r.seq, ts: r.ts }) as StoredEvent);
  }

  companies(): Id[] {
    const rows = this.db.prepare("SELECT company_id AS id, MIN(ts) AS t FROM events GROUP BY company_id ORDER BY t").all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  close(): void {
    this.db.close();
  }
}
