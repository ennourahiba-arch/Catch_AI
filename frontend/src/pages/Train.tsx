import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ReadinessCard from "../components/ReadinessCard";
import YourTurn from "../components/YourTurn";
import { ErrorState, Loading } from "../components/States";
import { usePack } from "../components/usePack";
import { pickNext, readiness } from "../lib/readiness";
import { addConfidence, loadHistory, setKV, type History } from "../lib/storage";
import type { TopicId } from "../lib/types";
import { RoundPlayer } from "./Play";

type Stage = "confidence" | "round" | "yourturn" | "summary";
const LABELS = ["Not at all", "A little", "Somewhat", "Quite", "Very"];

/** Home Mode: confidence -> Catch the AI (with hints) -> Your Turn -> readiness. */
export default function Train() {
  const topic = useParams().topic as TopicId;
  const { pack, error, retry } = usePack();
  const [history, setHistory] = useState<History | null>(null);
  const [stage, setStage] = useState<Stage>("confidence");
  const [session, setSession] = useState(0);
  const [picks, setPicks] = useState<{ roundId: string; exerciseId: string } | null>(null);

  const reload = useCallback(() => loadHistory().then(setHistory), []);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!pack || !history) return;
    const rounds = pack.rounds.filter((r) => r.topic === topic);
    const exercises = pack.exercises.filter((e) => e.topic === topic);
    if (!rounds.length || !exercises.length) return;
    setPicks({
      roundId: pickNext(rounds, history.attempts.map((a) => ({ id: a.roundId, ts: a.ts }))).id,
      exerciseId: pickNext(exercises, history.exercises.map((e) => ({ id: e.exerciseId, ts: e.ts }))).id,
    });
    // pick once per session, not on every history reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, session, history === null]);

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!pack || !history || !picks) {
    if (pack && !pack.topics.some((t) => t.id === topic)) return <ErrorState message={`There's no topic called "${topic}".`} />;
    return <Loading label="Preparing your training" />;
  }
  const topicName = pack.topics.find((t) => t.id === topic)!.name;
  const round = pack.rounds.find((r) => r.id === picks.roundId)!;
  const exercise = pack.exercises.find((e) => e.id === picks.exerciseId)!;
  const lastConf = history.confidence.find((c) => c.topic === topic)?.rating;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6">
      {stage === "confidence" && (
        <div className="mx-auto max-w-xl py-6">
          <Link to="/student" className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> Dashboard</Link>
          <h1 className="mt-6 text-3xl font-bold">How confident are you that you can solve problems on {topicName.toLowerCase()}?</h1>
          <p className="mt-2 text-navy-mute">Be honest: you'll compare this with how you actually do. It stays on this device.</p>
          <div className="mt-6 grid grid-cols-5 gap-2" role="radiogroup" aria-label="Confidence from 1 to 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={lastConf === n}
                onClick={async () => {
                  await addConfidence({ topic, ts: Date.now(), rating: n as 1 | 2 | 3 | 4 | 5 });
                  await setKV("lastTopic", topic);
                  await reload();
                  setStage("round");
                }}
                className={`flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-xl border-2 bg-white px-1 transition-colors hover:border-navy ${lastConf === n ? "border-violet" : "border-line"}`}
              >
                <span className="font-display text-3xl font-extrabold">{n}</span>
                <span className="text-center text-xs leading-tight text-navy-mute sm:text-sm">{LABELS[n - 1]}</span>
              </button>
            ))}
          </div>
          {lastConf && <p className="mt-3 text-sm text-navy-mute">Last time you said {lastConf}.</p>}
        </div>
      )}

      {stage === "round" && (
        <RoundPlayer key={`${session}-${round.id}`} pack={pack} round={round} mode="home" onNext={() => setStage("yourturn")} />
      )}

      {stage === "yourturn" && (
        <div className="mx-auto max-w-2xl">
          <YourTurn key={`${session}-${exercise.id}`} exercise={exercise} onDone={async () => { await reload(); setStage("summary"); }} />
        </div>
      )}

      {stage === "summary" && (
        <div className="mx-auto grid max-w-2xl gap-5 py-4">
          <h1 className="text-3xl font-bold">How you're doing</h1>
          <ReadinessCard r={readiness(pack, history, topic)} />
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => { setSession((s) => s + 1); setStage("round"); }}>Train this topic again</button>
            <Link to="/student" className="btn-ghost">Back to dashboard</Link>
          </div>
        </div>
      )}
    </div>
  );
}
