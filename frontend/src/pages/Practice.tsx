import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, X } from "lucide-react";
import QuestionCard from "../components/QuestionCard";
import ReadinessCard from "../components/ReadinessCard";
import RichText from "../components/RichText";
import { ErrorState, Loading } from "../components/States";
import { usePack } from "../components/usePack";
import { pickSession, readiness } from "../lib/readiness";
import { addConfidence, loadHistory, setKV, type History } from "../lib/storage";
import { lessonPack, type Course, type Exercise, type Format, type Lesson, type Pack, type Passage, type TopicId } from "../lib/types";

const LABELS = ["Not at all", "A little", "Somewhat", "Quite", "Very"];

/** Calculus practice: /practice/:topic */
export default function PracticeCalculus() {
  const topic = useParams().topic as TopicId;
  const { pack, error, retry } = usePack();
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!pack) return <Loading label="Preparing your practice" />;
  if (!pack.topics.some((t) => t.id === topic)) return <ErrorState message={`There's no topic called "${topic}".`} />;
  return <PracticeSession pack={pack} topic={topic} />;
}

/** Practice one lesson of a course, in one format. */
export function PracticeLesson({ course, lesson, format }: { course: Course; lesson: Lesson; format: Format }) {
  return <PracticeSession pack={lessonPack(course, lesson, format)} topic={lesson.id} passages={lesson.passages}
    backTo={`/course/${course.id}/lesson/${lesson.id}`} backLabel={`Back to ${lesson.title}`} />;
}

export function ConfidenceCheck({ title, last, onPick, backTo }: { title: string; last?: number; onPick: (n: number) => void; backTo: string }) {
  return (
    <div className="mx-auto max-w-xl py-6">
      <Link to={backTo} className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> Back</Link>
      <h1 className="mt-6 text-3xl font-bold">How confident are you about {title}?</h1>
      <p className="mt-2 text-navy-mute">Be honest: you'll compare this with how you actually do. It stays on this device.</p>
      <div className="mt-6 grid grid-cols-5 gap-2" role="radiogroup" aria-label="Confidence from 1 to 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={last === n} onClick={() => onPick(n)}
            className={`flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-xl border-2 bg-white px-1 transition-colors hover:border-navy ${last === n ? "border-violet" : "border-line"}`}>
            <span className="font-display text-3xl font-extrabold">{n}</span>
            <span className="text-center text-xs leading-tight text-navy-mute sm:text-sm">{LABELS[n - 1]}</span>
          </button>
        ))}
      </div>
      {last && <p className="mt-3 text-sm text-navy-mute">Last time you said {last}.</p>}
    </div>
  );
}

function PracticeSession({ pack, topic, passages, backTo = "/student", backLabel = "Back to dashboard" }: { pack: Pack; topic: TopicId; passages?: Passage[]; backTo?: string; backLabel?: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [stage, setStage] = useState<"confidence" | "questions" | "summary">("confidence");
  const [session, setSession] = useState<Exercise[]>([]);
  const [i, setI] = useState(0);
  const startedAt = useRef(0);
  const reload = useCallback(() => loadHistory().then((h) => { setHistory(h); return h; }), []);
  useEffect(() => { reload(); }, [reload]);

  if (!history) return <Loading label="Preparing your practice" />;
  const pool = pack.exercises.filter((e) => e.topic === topic);
  const topicName = pack.topics.find((t) => t.id === topic)!.name;
  const begin = (h: History) => {
    setSession(pickSession(pool, h));
    setI(0);
    startedAt.current = Date.now();
    setStage("questions");
  };
  const sourcesFor = (e: Exercise) => (passages ?? []).filter((p) => (e.source_ids ?? []).includes(p.id)).map((p) => p.text.slice(0, 1500));

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6">
      {stage === "confidence" && (
        <ConfidenceCheck title={topicName.toLowerCase()} backTo={backTo} last={history.confidence.find((c) => c.topic === topic)?.rating}
          onPick={async (n) => {
            await addConfidence({ topic, ts: Date.now(), rating: n as 1 | 2 | 3 | 4 | 5 });
            if (!passages) await setKV("lastTopic", topic);
            begin(await reload());
          }} />
      )}

      {stage === "questions" && session[i] && (
        <div className="mx-auto max-w-2xl">
          <Link to={backTo} className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> Stop</Link>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full rounded-full bg-teal transition-all" style={{ width: `${(i / session.length) * 100}%` }} />
          </div>
          <div className="mt-6">
            <QuestionCard key={session[i].id} exercise={session[i]} index={i} total={session.length} sources={sourcesFor(session[i])}
              nextLabel={i + 1 < session.length ? "Next question" : "See my results"}
              onNext={async () => { if (i + 1 < session.length) setI(i + 1); else { await reload(); setStage("summary"); } }} />
          </div>
        </div>
      )}

      {stage === "summary" && (
        <div className="mx-auto grid max-w-2xl gap-5 py-4">
          <h1 className="text-3xl font-bold">Session complete</h1>
          <SessionResults session={session} history={history} since={startedAt.current} />
          <ReadinessCard r={readiness(pack, history, topic)} />
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => begin(history)}>Practice again</button>
            <Link to={backTo} className="btn-ghost">{backLabel}</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function SessionResults({ session, history, since }: { session: Exercise[]; history: History; since: number }) {
  const result = (id: string) => history.exercises.find((e) => e.exerciseId === id && e.ts >= since);
  const right = session.filter((e) => result(e.id)?.correct).length;
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <p className="font-display text-4xl font-extrabold">{right}<span className="text-xl text-navy-mute"> / {session.length}</span></p>
      <ol className="mt-3 divide-y divide-line">
        {session.map((e, k) => {
          const r = result(e.id);
          return (
            <li key={e.id} className="flex items-start gap-3 py-2.5">
              {r?.correct ? <Check size={18} className="mt-0.5 shrink-0 text-teal-ink" aria-label="right" /> : <X size={18} className="mt-0.5 shrink-0 text-coral-ink" aria-label="not right" />}
              <span className="min-w-0 flex-1 text-[15px]">
                <span className="text-navy-mute">Q{k + 1}. </span><RichText text={e.prompt} />
                {r && !r.firstTry && r.correct && <span className="text-navy-mute"> (second try)</span>}
                {r?.mistake && <span className="block text-sm text-coral-ink">{r.mistake}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
