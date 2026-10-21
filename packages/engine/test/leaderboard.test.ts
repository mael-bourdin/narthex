import { describe, expect, it } from "vitest";
import { Host, LeaderboardPublisher, MemoryEventStore, SimulatedClock, SimulationRuntime } from "../src/index.ts";

const START = Date.UTC(2026, 9, 21, 9);

function setup(settings: { edition: "hosted" | "open-source"; share: boolean; showRevenue?: boolean }, watchMs?: number) {
  const calls: { url: string; method: string; auth: string; body: Record<string, unknown> }[] = [];
  const host = new Host({ store: new MemoryEventStore(), runtime: new SimulationRuntime(), clock: new SimulatedClock(START) });
  const publisher = new LeaderboardPublisher({
    host,
    settings: () => ({ edition: settings.edition, url: "https://classement.example", token: "nxl_abc", share: settings.share, showRevenue: settings.showRevenue ?? false }),
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, auth: init.headers.authorization ?? "", body: init.body ? JSON.parse(init.body) : {} });
      return { ok: true, status: 204 };
    },
    debounceMs: 0,
    ...(watchMs ? { watchMs } : {}),
  });
  return { host, publisher, calls };
}

describe("leaderboard publisher", () => {
  it("publishes each company of a hosted instance that chose to appear, with its token", async () => {
    const { host, publisher, calls } = setup({ edition: "hosted", share: true });
    publisher.start();
    const s = await host.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès Martin" });
    await host.handle("sale.record", { amountCents: 120_000 });
    await publisher.idle();
    const last = calls.at(-1)!;
    expect(last).toMatchObject({ url: `https://classement.example/v1/entries/${s.company!.id}`, method: "PUT", auth: "Bearer nxl_abc" });
    expect(last.body).toMatchObject({ name: "Maison Lumen", founder: "Inès", sales: 1, revenueBand: "€1,000–5,000" });
    expect(last.body.revenue).toBeUndefined();
    publisher.stop();
  });

  it("sends nothing from an open-source install, or when the founder said no", async () => {
    for (const settings of [{ edition: "open-source" as const, share: true }, { edition: "hosted" as const, share: false }]) {
      const { host, publisher, calls } = setup(settings);
      publisher.start();
      await host.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
      await host.handle("sale.record", { amountCents: 120_000 });
      await publisher.idle();
      expect(calls).toEqual([]);
      publisher.stop();
    }
  });

  it("removes the company from the ranking when the founder stops sharing", async () => {
    const { host, publisher, calls } = setup({ edition: "hosted", share: true });
    const s = await host.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    await publisher.withdraw(s.company!.id);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: `https://classement.example/v1/entries/${s.company!.id}` });
  });

  it("follows a change of choice made elsewhere (CLI while the app runs): hiding the amount republishes at once", async () => {
    const settings = { edition: "hosted" as const, share: true, showRevenue: true };
    const { host, publisher, calls } = setup(settings, 10);
    publisher.start();
    await host.handle("company.found", { name: "Maison Lumen", idea: "Bougies", founderName: "Inès" });
    await host.handle("sale.record", { amountCents: 120_000 });
    await publisher.idle();
    expect(calls.at(-1)!.body.revenue).toBe(120_000);
    settings.showRevenue = false;
    await new Promise((r) => setTimeout(r, 40));
    await publisher.idle();
    expect(calls.at(-1)).toMatchObject({ method: "PUT" });
    expect(calls.at(-1)!.body.revenue).toBeUndefined();
    settings.share = false;
    await new Promise((r) => setTimeout(r, 40));
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    publisher.stop();
  });
});

describe("reading the ranking", () => {
  it("drops entries that are malformed or carry control characters", async () => {
    const { fetchLeaderboard } = await import("../src/index.ts");
    const good = { companyId: "c1", name: "Lumen", stage: "research", office: 0, sales: 0, revenueBand: "Pas encore de vente", days: 1, xp: 0, updatedAt: START };
    const body = { entries: [{ rank: 1, entry: good }, { rank: 2, entry: { ...good, companyId: "c2", name: "\u001b]0;pwn\u0007Evil" } }, { rank: 3, entry: { nope: true } }] };
    const entries = await fetchLeaderboard("https://x", async () => ({ ok: true, json: async () => body }));
    expect(entries.map((e) => e.entry.companyId)).toEqual(["c1"]);
  });
});
