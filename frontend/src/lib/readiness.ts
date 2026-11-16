// Readiness per topic or pack, from the questions you answered yourself.
import type { History } from "./storage";
import type { Exercise, Pack, TopicId } from "./types";

export const WINDOW = 10;
export const MIN_ANSWERED = 3;
export const SESSION_SIZE = 5;

export interface Readiness {
  topic: TopicId;
  topicName: string;
  confidence: number | null;
  answered: { firstTry: number; later: number; of: number };
  score: number | null;
  message: string | null;
  mistakes: { label: string; count: number }[];
  next: string;
}

export function readiness(pack: Pack, h: History, topic: TopicId): Readiness {
  const topicName = pack.topics.find((t) => t.id === topic)?.name ?? topic;
  const conf = h.confidence.find((c) => c.topic === topic)?.rating ?? null;
  const ex = h.exercises.filter((e) => e.topic === topic).slice(0, WINDOW);
  const firstTry = ex.filter((e) => e.firstTry).length;
  const later = ex.filter((e) => e.correct && !e.firstTry).length;
  const rate = ex.length ? (firstTry + 0.5 * later) / ex.length : 0;
  const score = ex.length >= MIN_ANSWERED ? Math.round(100 * rate) : null;

  const counts: Record<string, number> = {};
  for (const e of ex) if (e.mistake) counts[e.mistake] = (counts[e.mistake] ?? 0) + 1;
  const mistakes = Object.entries(counts).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

  const missed = ex.length - firstTry - later;
  let message: string | null = null;
  if (conf !== null && ex.length >= MIN_ANSWERED) {
    if (conf >= 4 && rate < 0.5) message = `You felt confident (${conf}/5), but missed ${missed} of your last ${ex.length} questions. Let's strengthen that.`;
    else if (conf <= 2 && rate >= 0.8) message = `You rated your confidence ${conf}/5, yet you got ${firstTry + later} of your last ${ex.length} right. You may be readier than you feel.`;
  }

  const order = pack.topics.map((t) => t.id);
  const nextTopic = order[order.indexOf(topic) + 1];
  let next: string;
  if (score === null) next = `Answer ${MIN_ANSWERED - ex.length} more ${MIN_ANSWERED - ex.length === 1 ? "question" : "questions"} to get a readiness score.`;
  else if (mistakes.length && score < 80) next = `Practice again and watch for: ${mistakes[0].label.toLowerCase()}.`;
  else if (score >= 80 && nextTopic) next = `Ready to move on: try ${pack.topics.find((t) => t.id === nextTopic)!.name.toLowerCase()}.`;
  else if (score >= 80) next = "Keep it fresh with a short session every few days.";
  else next = "Do another practice session on this.";

  return { topic, topicName, confidence: conf, answered: { firstTry, later, of: ex.length }, score, message, mistakes, next };
}

/** A practice session: questions never seen first, then ones you got wrong, then the least recent. */
export function pickSession(items: Exercise[], h: History, size = SESSION_SIZE): Exercise[] {
  const last = new Map<string, { ts: number; ok: boolean }>();
  for (const a of h.exercises) if (!last.has(a.exerciseId)) last.set(a.exerciseId, { ts: a.ts, ok: a.firstTry });
  const rank = (e: Exercise) => {
    const l = last.get(e.id);
    if (!l) return [0, e.difficulty, 0];
    return [l.ok ? 2 : 1, 0, l.ts];
  };
  return [...items].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  }).slice(0, size);
}
