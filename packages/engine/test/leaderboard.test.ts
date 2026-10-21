import { describe, expect, it } from "vitest";
import { Host, LeaderboardPublisher, MemoryEventStore, SimulatedClock, SimulationRuntime } from "../src/index.ts";

const START = Date.UTC(2026, 9, 21, 9);

function setup(settings: { edition: "hosted" | "open-source"; share: boolean; showRevenue?: boolean }) {
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
    expect(last.body).toMatchObject({ name: "Maison Lumen", founder: "Inès", sales: 1, revenueBand: "1 000 à 5 000 €" });
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
});
