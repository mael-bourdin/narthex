import type { LinkCheck } from "./engine.ts";

/**
 * Does a cited page still answer? HEAD first, GET when a site refuses HEAD.
 * A page behind a login or an anti-bot wall (401, 403, 429) exists: only a missing page
 * (404, 410), a server error or no answer at all counts as dead.
 */
export const httpLinkCheck: LinkCheck = async (url, signal) => {
  if (!/^https?:\/\//i.test(url)) return false;
  const headers = { "user-agent": "Narthex (vérification des sources)" };
  const answer = async (method: "HEAD" | "GET") => {
    try {
      const res = await fetch(url, { method, redirect: "follow", signal, headers });
      void res.body?.cancel();
      return res.status;
    } catch {
      return 0;
    }
  };
  let status = await answer("HEAD");
  if (status === 0 || status === 405 || status === 501 || status >= 500) status = await answer("GET");
  return status > 0 && (status < 400 || status === 401 || status === 403 || status === 429);
};
