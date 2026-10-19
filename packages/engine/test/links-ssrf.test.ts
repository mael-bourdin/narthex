import { describe, expect, it } from "vitest";
import { isPublicAddress, makeLinkCheck, pinnedLookup } from "../src/index.ts";

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
    "http://[64:ff9b::7f00:1]/",
    "http://[2002:7f00:1::]/",
    "http://[::7f00:1]/",
    "http://[fd00::1]/",
    "http://[2001:db8::1]/",
    "http://[::ffff:192.168.0.1]/",
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

describe("addresses", () => {
  it("lets only global unicast IPv6 through", () => {
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicAddress("2a00:1450:4007:80e::200e")).toBe(true);
    for (const a of ["64:ff9b::7f00:1", "2002:c0a8:101::", "2001:0:4136:e378::1", "::7f00:1", "fe80::1", "ff02::1"]) expect(isPublicAddress(a)).toBe(false);
  });
});

describe("pinnedLookup", () => {
  const resolve = (addresses: string[]) => async () => addresses;
  const ask = (lookup: ReturnType<typeof pinnedLookup>, host: string) =>
    new Promise<{ err: Error | null; address?: unknown }>((done) => lookup(host, { all: true }, (err, address) => done({ err, address })));

  it("connects only to the addresses it checked", async () => {
    const r = await ask(pinnedLookup(resolve(["93.184.215.14"])), "example.org");
    expect(r.err).toBeNull();
    expect(r.address).toEqual([{ address: "93.184.215.14", family: 4 }]);
  });

  it("refuses the connection if the name now points inside (rebinding)", async () => {
    const r = await ask(pinnedLookup(resolve(["93.184.215.14", "127.0.0.1"])), "example.org");
    expect(r.err?.message).toMatch(/réseau local/);
  });
});
