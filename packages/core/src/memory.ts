import type { CompanyState, Fact, Id, RoleId, Timestamp } from "./types.ts";

/**
 * Memory recall without a model (research « Mémoire », unified score): keyword relevance (BM25),
 * importance and recency, fused by reciprocal rank (RRF, no calibration), over facts still valid.
 * No embeddings: the score's vector term waits for a local embedding model.
 */

const STOP = new Set(
  "a au aux avec ce ces cet cette d de des du elle en est et il ils je j l la le les leur lui ma mais me mes mon ne nos notre nous on ou par pas pour qu que qui quoi quel quelle sa se ses son sont sur ta te tes toi ton tu un une vos votre vous y pourquoi comment quand a-t-on t avons avez ont fait faire decide choisi".split(" "),
);

/** Lowercase, no accents, no stop words, a naive French plural strip. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9€]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w));
}

function bm25(docs: string[][], query: string[]): number[] {
  const k1 = 1.2;
  const b = 0.75;
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1) || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = [...new Set(query)];
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    return q.reduce((score, t) => {
      const f = tf.get(t) ?? 0;
      if (!f) return score;
      const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      return score + (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
    }, 0);
  });
}

/** Reciprocal rank fusion of several orderings of the same items. */
function rrf<T>(items: T[], orders: ((a: T, b: T) => number)[], k = 60): Map<T, number> {
  const score = new Map<T, number>(items.map((i) => [i, 0]));
  for (const order of orders) [...items].sort(order).forEach((item, rank) => score.set(item, score.get(item)! + 1 / (k + rank + 1)));
  return score;
}

/** Who may read money, pay and personal data (research: ACL per role). */
const SENSITIVE_READERS: RoleId[] = ["cofondateur", "comptable", "juridique"];

export function canRead(role: RoleId, fact: Fact): boolean {
  return !fact.sensitive || SENSITIVE_READERS.includes(role);
}

export function isValid(fact: Fact, at: Timestamp): boolean {
  return fact.validFrom <= at && (fact.invalidAt === undefined || fact.invalidAt > at);
}

/** The facts worth putting in an agent's brief for this task: relevant first, nothing when nothing matches. */
export function recallFacts(state: CompanyState, query: string, options: { role: RoleId; now: Timestamp; k?: number }): Fact[] {
  const candidates = Object.values(state.facts).filter((f) => isValid(f, options.now) && canRead(options.role, f));
  const relevance = bm25(candidates.map((f) => terms(`${f.subject} ${f.text}`)), terms(query));
  const relevant = candidates.map((f, i) => ({ f, r: relevance[i]! })).filter((x) => x.r > 0);
  const fused = rrf(relevant, [(a, b) => b.r - a.r, (a, b) => b.f.importance - a.f.importance, (a, b) => b.f.validFrom - a.f.validFrom]);
  return relevant
    .sort((a, b) => fused.get(b)! - fused.get(a)! || b.r - a.r)
    .slice(0, options.k ?? 8)
    .map((x) => x.f);
}

export interface JournalHit {
  kind: "task" | "deliverable" | "fact";
  id: Id;
  title: string;
  /** For a task: why it was decided. */
  why?: string;
  agentId?: Id;
  at: Timestamp;
}

/** « Pourquoi a-t-on décidé X ? »: the tasks, deliverables and facts that answer, with their reason. No model. */
export function searchJournal(state: CompanyState, question: string, limit = 8): JournalHit[] {
  const hits: (JournalHit & { text: string })[] = [
    ...Object.values(state.tasks).map((t) => ({ kind: "task" as const, id: t.id, title: t.title, why: t.why, agentId: t.agentId, at: t.createdAt, text: `${t.title} ${t.why}` })),
    ...Object.values(state.deliverables).map((d) => ({ kind: "deliverable" as const, id: d.id, title: d.title, agentId: d.agentId, at: d.createdAt, text: `${d.title} ${d.summary}` })),
    ...Object.values(state.facts).filter((f) => f.invalidAt === undefined).map((f) => ({ kind: "fact" as const, id: f.id, title: f.text, at: f.validFrom, text: `${f.subject} ${f.text}` })),
  ];
  const scores = bm25(hits.map((h) => terms(h.text)), terms(question));
  return hits
    .map((h, i) => ({ h, s: scores[i]! }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.h.at - a.h.at)
    .slice(0, limit)
    .map(({ h: { text: _text, ...hit } }) => hit);
}

