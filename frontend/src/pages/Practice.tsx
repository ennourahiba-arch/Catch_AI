import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { ErrorState, Loading } from "../components/States";
import { usePack } from "../components/usePack";
import { listAttempts, type Attempt } from "../lib/storage";

/** Picks the next round for a topic: first unplayed, else the least recently played. */
export default function Practice() {
  const { topic } = useParams();
  const { pack, error, retry } = usePack();
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  useEffect(() => { listAttempts().then(setAttempts); }, []);

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!pack || !attempts) return <Loading label="Choosing your next round" />;
  const rounds = pack.rounds.filter((r) => r.topic === topic);
  if (!rounds.length) return <ErrorState message={`No rounds found for topic "${topic}".`} />;

  const lastPlayed = new Map<string, number>();
  for (const a of attempts) if (!lastPlayed.has(a.roundId)) lastPlayed.set(a.roundId, a.ts);
  const next = rounds.find((r) => !lastPlayed.has(r.id))
    ?? [...rounds].sort((a, b) => lastPlayed.get(a.id)! - lastPlayed.get(b.id)!)[0];
  return <Navigate to={`/play/${next.id}`} replace />;
}
