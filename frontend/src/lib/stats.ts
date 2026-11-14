import type { Attempt } from "./storage";
import type { TopicId } from "./types";

export interface TopicStats {
  played: number;
  catches: number;
  points: number;
  maxPoints: number;
}

export function topicStats(attempts: Attempt[]): Record<string, TopicStats> {
  const out: Record<string, TopicStats> = {};
  for (const a of attempts) {
    const t = (out[a.topic] ??= { played: 0, catches: 0, points: 0, maxPoints: 0 });
    t.played += 1;
    t.catches += a.catchCorrect ? 1 : 0;
    t.points += a.points;
    t.maxPoints += a.maxPoints;
  }
  return out;
}

/** Topics with at least 2 attempts and a catch rate below 60%. */
export function topicsToRevisit(attempts: Attempt[]): TopicId[] {
  const s = topicStats(attempts);
  return (Object.keys(s) as TopicId[]).filter((t) => s[t].played >= 2 && s[t].catches / s[t].played < 0.6);
}

/** Misconceptions in rounds the student did not fully solve, most frequent first. */
export function missedMisconceptions(attempts: Attempt[]): { label: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const a of attempts) {
    if (a.mistakeLabel && a.points < a.maxPoints) counts[a.mistakeLabel] = (counts[a.mistakeLabel] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}
