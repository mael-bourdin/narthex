import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { LinkCheck } from "./engine.ts";

/** What the checker needs from the outside world; injected in tests. */
export interface LinkCheckDeps {
  /** Every address a host name resolves to. */
  lookup(host: string): Promise<string[]>;
  /** One request, redirects not followed. */
  fetch(url: string, init: { method: "HEAD" | "GET"; signal: AbortSignal }): Promise<{ status: number; location?: string | undefined }>;
}

/**
 * The links come from a model, which reads the web: a hostile page could make it cite
 * http://192.168.1.1/… or a redirect to it. Only the public web is ever contacted.
 */
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(net, bits, "ipv4");
// IPv6: only global unicast (2000::/3), minus the prefixes that carry an IPv4 address or are not routed:
// Teredo, documentation, 6to4. NAT64 (64:ff9b::/96), IPv4-compatible (::/96), local and multicast are outside 2000::/3.
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");
for (const [net, bits] of [
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const) PRIVATE.addSubnet(net, bits, "ipv6");

export function isPublicAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPublicAddress(mapped);
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) return GLOBAL_V6.check(address, "ipv6") && !PRIVATE.check(address, "ipv6");
  return !PRIVATE.check(address, "ipv4");
}

async function isPublicUrl(url: URL, lookup: LinkCheckDeps["lookup"]): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPublicAddress(host);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal")) return false;
  const addresses = await lookup(host).catch(() => []);
  return addresses.length > 0 && addresses.every(isPublicAddress);
}

/**
 * Does a cited page still answer? HEAD first, GET when a site refuses HEAD; redirects followed
 * by hand, each hop checked again, five at most. A page behind a login or an anti-bot wall
 * (401, 403, 429) exists: only a missing page (404, 410), a server error or no answer counts as dead.
 */
export function makeLinkCheck(deps: LinkCheckDeps): LinkCheck {
  const status = async (start: string, method: "HEAD" | "GET", signal: AbortSignal): Promise<number> => {
    let current = start;
    for (let hop = 0; hop <= 5; hop++) {
      let url: URL;
      try {
        url = new URL(current);
      } catch {
        return 0;
      }
      if (!(await isPublicUrl(url, deps.lookup))) return 0;
      const res = await deps.fetch(url.href, { method, signal }).catch(() => undefined);
      if (!res) return 0;
      if (res.status >= 300 && res.status < 400 && res.location) {
        current = new URL(res.location, url).href;
        continue;
      }
      return res.status;
    }
    return 0;
  };
  return async (url, signal) => {
    let code = await status(url, "HEAD", signal);
    if (code === 405 || code === 501 || code >= 500) code = await status(url, "GET", signal);
    return code > 0 && (code < 400 || code === 401 || code === 403 || code === 429);
  };
}

/**
 * A `lookup` for the connection itself: it resolves the name, refuses if any address is not public,
 * and hands over only the addresses it checked. The check and the connection share one resolution,
 * so a name cannot point outside for the check and inside for the request (DNS rebinding).
 */
export function pinnedLookup(resolve: (host: string) => Promise<string[]>): LookupFunction {
  return ((hostname: string, options: { all?: boolean }, callback: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
          return callback(Object.assign(new Error(`${hostname} pointe vers le réseau local : lien non vérifié.`), { code: "ENOTFOUND" }));
        }
        const list = addresses.map((address) => ({ address, family: isIP(address) }));
        if (options?.all) callback(null, list);
        else callback(null, list[0]!.address, list[0]!.family);
      },
      (e: NodeJS.ErrnoException) => callback(e),
    );
  }) as LookupFunction;
}

const resolveAll = async (host: string) => (await dnsLookup(host, { all: true })).map((a) => a.address);

/** The real checker: every connection goes through `pinnedLookup`. */
export const httpLinkCheck: LinkCheck = makeLinkCheck({
  lookup: resolveAll,
  fetch: (url, { method, signal }) =>
    new Promise((resolve, reject) => {
      const send = url.startsWith("https:") ? httpsRequest : httpRequest;
      const req = send(url, { method, signal, lookup: pinnedLookup(resolveAll), headers: { "user-agent": "Narthex (vérification des sources)" } }, (res) => {
        res.resume();
        const location = res.headers.location;
        resolve({ status: res.statusCode ?? 0, location: Array.isArray(location) ? location[0] : location });
        req.destroy();
      });
      req.on("error", reject);
      req.end();
    }),
});
