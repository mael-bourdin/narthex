import { describe, expect, it } from "vitest";
import { makeLinkCheck } from "../src/index.ts";

const PUBLIC = "93.184.215.14";

function checker(dns: Record<string, string>, pages: Record<string, { status: number; location?: string }>) {
  const fetched: string[] = [];
  const check = makeLinkCheck({
    lookup: async (host) => (dns[host] ? [dns[host]] : []),
    fetch: async (url) => {
      fetched.push(url);
      const p = pages[url] ?? { status: 404 };
      return { status: p.status, location: p.location };
    },
  });
  return { check, fetched };
}

const signal = () => AbortSignal.timeout(1000);

describe("link check stays on the public web", () => {
  it("checks a public page", async () => {
    const { check } = checker({ "insee.fr": PUBLIC }, { "https://insee.fr/a": { status: 200 } });
    expect(await check("https://insee.fr/a", signal())).toBe(true);
  });

  it.each([
    "http://localhost:3000/admin",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://172.16.4.2/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://0.0.0.0/",
    "http://router.lan/",
  ])("never calls %s", async (url) => {
    const { check, fetched } = checker({ "router.lan": "192.168.1.1", localhost: "127.0.0.1" }, {});
    expect(await check(url, signal())).toBe(false);
    expect(fetched).toEqual([]);
  });

  it("does not follow a redirect into the local network", async () => {
    const { check, fetched } = checker(
      { "evil.example": PUBLIC },
      { "https://evil.example/r": { status: 302, location: "http://127.0.0.1:8080/delete" } },
    );
    expect(await check("https://evil.example/r", signal())).toBe(false);
    expect(fetched).toEqual(["https://evil.example/r"]);
  });

  it("follows a public redirect, a few hops at most", async () => {
    const { check } = checker(
      { "a.fr": PUBLIC, "b.fr": PUBLIC },
      { "https://a.fr/": { status: 301, location: "https://b.fr/x" }, "https://b.fr/x": { status: 200 } },
    );
    expect(await check("https://a.fr/", signal())).toBe(true);
    const loop = checker({ "a.fr": PUBLIC }, { "https://a.fr/": { status: 302, location: "https://a.fr/" } });
    expect(await loop.check("https://a.fr/", signal())).toBe(false);
  });
});
