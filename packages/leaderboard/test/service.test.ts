import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, leaderboardEntry, replay } from "@narthex/core";
import { LeaderboardStore, startLeaderboard } from "../src/index.ts";

const NOW = Date.UTC(2026, 9, 21, 9);
const entry = (id: string, name: string, stage: "research" | "launch" = "research") =>
  leaderboardEntry(
    replay([{ type: "company.founded", company: { id, name, idea: "Secret", founder: { name: "Inès Martin" }, foundedAt: NOW, stage, paused: false }, settings: DEFAULT_SETTINGS }]),
    NOW,
    { showRevenue: false },
  );

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function service(now = () => NOW) {
  const store = new LeaderboardStore(":memory:");
  const server = await startLeaderboard({ store, port: 0, now });
  close = () => new Promise((r) => server.close(() => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { store, base };
}

describe("leaderboard service", () => {
  it("publishes the ranking of hosted companies that sent their entry with a valid token", async () => {
    const { store, base } = await service();
    const token = store.issue("Narthex hébergé · Maison Lumen");
    const put = (body: unknown, auth = token) => fetch(`${base}/v1/entries/${(body as { companyId: string }).companyId}`, { method: "PUT", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await put(entry("a", "Maison Lumen", "launch"))).status).toBe(204);
    expect((await put(entry("b", "Atelier Brume"), store.issue("Atelier"))).status).toBe(204);
    const board = (await (await fetch(`${base}/v1/leaderboard`)).json()) as { entries: { rank: number; entry: { name: string; founder: string } }[] };
    expect(board.entries.map((r) => [r.rank, r.entry.name])).toEqual([
      [1, "Maison Lumen"],
      [2, "Atelier Brume"],
    ]);
    expect(JSON.stringify(board)).not.toContain("Secret");
  });

  it("refuses an unknown or revoked token, a malformed entry, and a company owned by another token", async () => {
    const { store, base } = await service();
    const token = store.issue("A");
    const other = store.issue("B");
    const put = (body: unknown, auth: string, id = (body as { companyId?: string }).companyId ?? "x") =>
      fetch(`${base}/v1/entries/${id}`, { method: "PUT", headers: { authorization: `Bearer ${auth}` }, body: JSON.stringify(body) });
    expect((await put(entry("a", "Maison Lumen"), "nope")).status).toBe(401);
    expect((await put({ companyId: "a", name: "x" }, token)).status).toBe(400);
    expect((await put(entry("a", "Maison Lumen"), token, "other-id")).status).toBe(400);
    expect((await put(entry("a", "Maison Lumen"), token)).status).toBe(204);
    expect((await put(entry("a", "Usurpée"), other)).status).toBe(403);
    store.revoke("A");
    expect((await put(entry("a", "Maison Lumen"), token)).status).toBe(401);
  });

  it("lets a company leave the ranking, and refuses huge bodies", async () => {
    const { store, base } = await service();
    const token = store.issue("A");
    await fetch(`${base}/v1/entries/a`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(entry("a", "Maison Lumen")) });
    expect((await fetch(`${base}/v1/entries/a`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } })).status).toBe(204);
    expect(((await (await fetch(`${base}/v1/leaderboard`)).json()) as { entries: unknown[] }).entries).toEqual([]);
    const huge = await fetch(`${base}/v1/entries/a`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: "x".repeat(100_000) }).catch(() => ({ status: 413 }));
    expect(huge.status).toBe(413);
  });

  it("keeps a company with its first instance, even after it left the ranking, and drops a revoked instance's companies", async () => {
    const { store, base } = await service();
    const a = store.issue("A");
    const b = store.issue("B");
    const put = (auth: string, name: string) => fetch(`${base}/v1/entries/a`, { method: "PUT", headers: { authorization: `Bearer ${auth}` }, body: JSON.stringify(entry("a", name)) });
    expect((await put(a, "Maison Lumen")).status).toBe(204);
    expect((await fetch(`${base}/v1/entries/a`, { method: "DELETE", headers: { authorization: `Bearer ${a}` } })).status).toBe(204);
    expect((await put(b, "Usurpée")).status).toBe(403);
    expect((await fetch(`${base}/v1/entries/a`, { method: "DELETE", headers: { authorization: `Bearer ${b}` } })).status).toBe(403);
    expect((await put(a, "Maison Lumen")).status).toBe(204);
    store.revoke("A");
    expect(((await (await fetch(`${base}/v1/leaderboard`)).json()) as { entries: unknown[] }).entries).toEqual([]);
  });

  it("publishes only the fields of an entry, whatever else is sent", async () => {
    const { store, base } = await service();
    const token = store.issue("A");
    await fetch(`${base}/v1/entries/a`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ ...entry("a", "Maison Lumen"), idea: "Secret", html: "<script>" }) });
    const text = await (await fetch(`${base}/v1/leaderboard`)).text();
    expect(text).not.toContain("Secret");
    expect(text).not.toContain("script");
  });

  it("never stores the token itself", async () => {
    const { store } = await service();
    const token = store.issue("A");
    expect(JSON.stringify(store.dump())).not.toContain(token);
  });
});
