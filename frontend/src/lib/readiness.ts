// Readiness per topic. Based mainly on INDEPENDENT problem solving (Your Turn),
// not on game scores: 80% independent exercises, 20% first-try catches.
import type { History } from "./storage";
import type { Pack, TopicId } from "./types";

export const WINDOW = 5;
export const MIN_INDEPENDENT = 2;

export interface Readiness {
  topic: TopicId;
  topicName: string;
  confidence: number | null;
  catchFirstTry: { hit: number; of: number };
  independent: { firstTry: number; later: number; of: number };
  score: number | null;
  message: string | null;
  misconceptions: { label: string; count: number }[];
  next: string;
}

export function readiness(pack: Pack, h: History, topic: TopicId): Readiness {
  const topicName = pack.topics.find((t) => t.id === topic)?.name ?? topic;
  const conf = h.confidence.find((c) => c.topic === topic)?.rating ?? null;
  const rounds = h.attempts.filter((a) => a.topic === topic).slice(0, WINDOW);
  const ex = h.exercises.filter((e) => e.topic === topic).slice(0, WINDOW);

  const catchHit = rounds.filter((a) => a.catchCorrect && (a.catchAttempts ?? 1) === 1).length;
  const firstTry = ex.filter((e) => e.firstTry).length;
  const later = ex.filter((e) => e.correct && !e.firstTry).length;
  const indepRate = ex.length ? (firstTry + 0.5 * later) / ex.length : 0;
  const catchRate = rounds.length ? catchHit / rounds.length : 0;
  const score = ex.length >= MIN_INDEPENDENT ? Math.round(100 * (0.8 * indepRate + (rounds.length ? 0.2 * catchRate : 0.2 * indepRate))) : null;

  const counts: Record<string, number> = {};
  for (const a of rounds) if (a.mistakeLabel && a.points < a.maxPoints) counts[a.mistakeLabel] = (counts[a.mistakeLabel] ?? 0) + 1;
  const misconceptions = Object.entries(counts)
    .map(([id, count]) => ({ label: pack.misconceptions[id] ?? id, count }))
    .sort((a, b) => b.count - a.count);

  const solved = firstTry + later;
  const missed = ex.length - solved;
  let message: string | null = null;
  if (conf !== null && ex.length >= MIN_INDEPENDENT) {
    if (conf >= 4 && indepRate < 0.5) {
      message = `You felt confident about ${topicName.toLowerCase()} (${conf}/5), but missed ${missed} of your last ${ex.length} practice problems. Let's strengthen that skill.`;
    } else if (conf <= 2 && indepRate >= 0.8) {
      message = `You rated your confidence ${conf}/5, yet you solved ${solved} of your last ${ex.length} problems on your own. You may be readier than you feel.`;
    }
  }

  const order = pack.topics.map((t) => t.id);
  const nextTopic = order[order.indexOf(topic) + 1];
  let next: string;
  if (score === null) next = `Solve ${MIN_INDEPENDENT - ex.length} more Your Turn ${MIN_INDEPENDENT - ex.length === 1 ? "exercise" : "exercises"} on this topic to get a readiness score.`;
  else if (misconceptions.length && score < 80) next = `Train this topic again and watch for: ${misconceptions[0].label.toLowerCase()}.`;
  else if (score >= 80 && nextTopic) next = `Ready to move on: try ${pack.topics.find((t) => t.id === nextTopic)!.name.toLowerCase()}.`;
  else if (score >= 80) next = "Keep this topic fresh with a round every few days.";
  else next = "Do another round and Your Turn exercise on this topic.";

  return {
    topic, topicName, confidence: conf,
    catchFirstTry: { hit: catchHit, of: rounds.length },
    independent: { firstTry, later, of: ex.length },
    score, message, misconceptions, next,
  };
}

/** Next item for a topic: first never attempted, else the least recently attempted. */
export function pickNext<T extends { id: string }>(items: T[], history: { id: string; ts: number }[]): T {
  const last = new Map<string, number>();
  for (const h of history) if (!last.has(h.id)) last.set(h.id, h.ts);
  return items.find((i) => !last.has(i.id)) ?? [...items].sort((a, b) => last.get(a.id)! - last.get(b.id)!)[0];
}
