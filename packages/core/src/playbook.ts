import { terms } from "./memory.ts";
import type { Lesson, Timestamp } from "./types.ts";

/** What the reflector proposes after one task (research: ACE, generation → reflection → curation). */
export interface PlaybookDelta {
  add: { id: string; text: string }[];
  helpful: string[];
  harmful: string[];
}

export const MAX_LESSONS = 12;

function similar(a: string, b: string): boolean {
  const x = new Set(terms(a));
  const y = new Set(terms(b));
  if (x.size === 0 || y.size === 0) return false;
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared / Math.min(x.size, y.size) >= 0.7;
}

/**
 * Curation without a model: counts updated, a lesson that hurt more than it helped dropped,
 * near-duplicates refused, then the most useful twelve kept (fresh ones win ties). Small deltas,
 * never a rewrite: the playbook cannot collapse into a vague summary (research: brevity bias).
 */
export function curatePlaybook(current: readonly Lesson[], delta: PlaybookDelta, now: Timestamp): Lesson[] {
  const helpful = new Set(delta.helpful);
  const harmful = new Set(delta.harmful);
  const kept = current
    .map((l) => ({ ...l, helpful: l.helpful + (helpful.has(l.id) ? 1 : 0), harmful: l.harmful + (harmful.has(l.id) ? 1 : 0) }))
    .filter((l) => l.harmful <= l.helpful);
  const fresh: Lesson[] = [];
  for (const a of delta.add) {
    const text = a.text.trim().replace(/\s+/g, " ").slice(0, 300);
    if (!text || [...kept, ...fresh].some((l) => similar(l.text, text))) continue;
    fresh.push({ id: a.id, text, helpful: 0, harmful: 0, learntAt: now });
  }
  const all = [...kept, ...fresh];
  if (all.length <= MAX_LESSONS) return all;
  const rank = (l: Lesson) => l.helpful - l.harmful;
  const keep = new Set(
    [...all]
      .sort((a, b) => rank(b) - rank(a) || Number(fresh.includes(b)) - Number(fresh.includes(a)) || b.learntAt - a.learntAt)
      .slice(0, MAX_LESSONS)
      .map((l) => l.id),
  );
  return all.filter((l) => keep.has(l.id));
}
