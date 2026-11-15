import { useRef, useState } from "react";
import { Check, Lightbulb, Loader2, PenLine, Quote, X } from "lucide-react";
import MathYourTurn from "./MathYourTurn";
import OptionList from "./OptionList";
import RichText from "./RichText";
import TeX from "./Math";
import { api } from "../lib/api";
import { addExerciseAttempt } from "../lib/storage";
import type { Exercise, SolutionLine } from "../lib/types";

/** Picks the right independent exercise for the answer type. */
export default function YourTurn({ exercise, onDone, sources }: { exercise: Exercise; onDone: () => void; sources?: string[] }) {
  if (exercise.answer.kind === "mcq") return <McqYourTurn exercise={exercise} onDone={onDone} />;
  if (exercise.answer.kind === "open") return <OpenYourTurn exercise={exercise} onDone={onDone} sources={sources ?? []} />;
  return <MathYourTurn exercise={exercise} onDone={onDone} />;
}

export function Header() {
  return (
    <div>
      <p className="flex items-center gap-2 font-bold text-violet-ink"><PenLine size={18} aria-hidden /> Your turn</p>
      <h1 className="mt-1 text-2xl font-bold sm:text-3xl">No AI attempt this time. Solve it the way you would in the exam.</h1>
    </div>
  );
}

export function WorkedSolution({ lines, title = "Worked solution" }: { lines: SolutionLine[]; title?: string }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      <ol className="mt-3 grid gap-3">
        {lines.map((st, i) => (
          <li key={i} className="flex gap-3">
            <span className="font-display font-bold text-teal-ink">{i + 1}</span>
            <span className="min-w-0">
              <RichText text={st.text} className="block" />
              {st.latex && <TeX tex={st.latex} />}
              {st.quote && <SourceQuote quote={st.quote} source={st.source} />}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SourceQuote({ quote, source }: { quote: string; source?: string }) {
  return (
    <span className="mt-2 flex gap-2 rounded-md bg-paper px-3 py-2 text-[15px] text-navy-soft">
      <Quote size={15} className="mt-1 shrink-0 text-navy-mute" aria-hidden />
      <span>“{quote}”{source && <span className="text-navy-mute"> ({source})</span>}</span>
    </span>
  );
}

function Verdict({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex gap-2.5 rounded-xl px-4 py-3 ${ok ? "bg-teal-wash" : "bg-coral-wash"}`} role="status">
      {ok ? <Check size={20} className="mt-0.5 shrink-0 text-teal-ink" aria-hidden /> : <X size={20} className="mt-0.5 shrink-0 text-coral-ink" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

function useRecorder(exercise: Exercise) {
  const saved = useRef(false);
  return (correct: boolean, attempts: number, usedHint: boolean, firstTry = correct && attempts === 1) => {
    if (saved.current) return;
    saved.current = true;
    addExerciseAttempt({ exerciseId: exercise.id, topic: exercise.topic, ts: Date.now(), attempts, correct, firstTry, usedHint }).catch(() => undefined);
  };
}

function McqYourTurn({ exercise, onDone }: { exercise: Exercise; onDone: () => void }) {
  const correct = (exercise.answer as { kind: "mcq"; correct: number }).correct;
  const opts = (exercise.options ?? []).map((o, i) => ({ id: String(i), text: `${"ABCD"[i]}) ${o}` }));
  const [pick, setPick] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string[]>([]);
  const [done, setDone] = useState<null | boolean>(null);
  const [hint, setHint] = useState(false);
  const record = useRecorder(exercise);

  function submit() {
    if (pick === null) return;
    const n = wrong.length + 1;
    if (Number(pick) === correct) { setDone(true); record(true, n, hint); }
    else if (n >= 2) { setWrong([...wrong, pick]); setDone(false); record(false, n, hint); }
    else { setWrong([...wrong, pick]); setPick(null); }
  }

  return (
    <div className="grid gap-5">
      <Header />
      <section className="rounded-xl border border-line bg-white p-5"><RichText text={exercise.prompt} className="text-lg" /></section>
      {done === null ? (
        <>
          {wrong.length > 0 && <Verdict ok={false}><b>Not that one.</b> One more attempt.</Verdict>}
          <OptionList legend="Answer options" options={opts.filter((o) => !wrong.includes(o.id))} selected={pick} onSelect={setPick} />
          {wrong.length > 0 && (hint
            ? <p className="flex gap-2"><Lightbulb size={18} className="mt-0.5 shrink-0 text-violet-ink" aria-hidden /><span><b>Hint.</b> {exercise.hint}</span></p>
            : <button className="justify-self-start font-bold text-violet-ink underline decoration-2 underline-offset-4" onClick={() => setHint(true)}>Need a hint?</button>)}
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" disabled={pick === null} onClick={submit}>Check my answer</button>
            <button className="btn-ghost" onClick={() => { setDone(false); record(false, wrong.length, hint); }}>I'm stuck, show the answer</button>
          </div>
        </>
      ) : (
        <>
          <Verdict ok={done}>{done ? <><b>Correct{wrong.length === 0 ? ", first try" : ""}.</b></> : <><b>The answer is {exercise.answer_text}.</b></>}</Verdict>
          <WorkedSolution lines={exercise.solution} title="Why" />
          <button className="btn-violet justify-self-start" onClick={onDone}>See my readiness</button>
        </>
      )}
    </div>
  );
}

function OpenYourTurn({ exercise, onDone, sources }: { exercise: Exercise; onDone: () => void; sources: string[] }) {
  const a = exercise.answer as { kind: "open"; key_points: string[]; model_answer: string };
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<null | { verdict: "correct" | "partial" | "incorrect"; covered: number[]; feedback: string; self?: boolean }>(null);
  const record = useRecorder(exercise);

  async function gradeWithAI() {
    setBusy(true); setErr(null);
    try {
      const r = await api.grade({ question: exercise.prompt, key_points: a.key_points, model_answer: a.model_answer, sources, answer: text });
      setResult(r);
      record(r.verdict !== "incorrect", 1, false, r.verdict === "correct");
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }
  function selfMark(v: "correct" | "partial" | "incorrect") {
    setResult({ verdict: v, covered: [], feedback: "", self: true });
    record(v !== "incorrect", 1, false, v === "correct");
  }

  return (
    <div className="grid gap-5">
      <Header />
      <section className="rounded-xl border border-line bg-white p-5"><RichText text={exercise.prompt} className="text-lg" /></section>
      {!result ? (
        <>
          <label className="grid gap-1.5">
            <span className="font-bold">Your answer</span>
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 5000))} rows={8}
              className="rounded-xl border border-line bg-white p-4 outline-none focus:border-violet" />
          </label>
          {err && (
            <div className="rounded-lg bg-paper p-4 ring-1 ring-line" role="status">
              <p><b>AI grading isn't available right now.</b> {err}</p>
              <p className="mt-2">You can compare with the model answer and mark yourself instead:</p>
              <p className="mt-2 rounded-md bg-white p-3"><RichText text={a.model_answer} /></p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={() => selfMark("correct")}>I got it</button>
                <button className="btn-ghost" onClick={() => selfMark("partial")}>Partly</button>
                <button className="btn-ghost" onClick={() => selfMark("incorrect")}>Not yet</button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" disabled={!text.trim() || busy} onClick={gradeWithAI}>
              {busy && <Loader2 size={17} className="animate-spin" aria-hidden />} Grade my answer
            </button>
            <button className="btn-ghost" onClick={() => selfMark("incorrect")}>I'm stuck, show the answer</button>
          </div>
          <p className="text-sm text-navy-mute">Written answers are graded by AI against your course material, which needs an internet connection.</p>
        </>
      ) : (
        <>
          <Verdict ok={result.verdict === "correct"}>
            <b>{result.verdict === "correct" ? "Full marks." : result.verdict === "partial" ? "Partly there." : "Not yet."}</b>{" "}
            {result.self ? "You marked this yourself." : result.feedback}
          </Verdict>
          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-lg font-bold">What a full answer contains</h2>
            <ul className="mt-2 grid gap-1.5">
              {a.key_points.map((k, i) => (
                <li key={i} className="flex gap-2">
                  {result.self ? <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-navy-mute" aria-hidden />
                    : result.covered.includes(i) ? <Check size={18} className="mt-0.5 shrink-0 text-teal-ink" aria-label="covered" />
                    : <X size={18} className="mt-0.5 shrink-0 text-coral-ink" aria-label="missing" />}
                  <RichText text={k} />
                </li>
              ))}
            </ul>
          </section>
          <WorkedSolution lines={exercise.solution} title="Model answer" />
          {!result.self && <p className="text-sm text-navy-mute">Graded by AI against your course material. It can make mistakes: check the model answer.</p>}
          <button className="btn-violet justify-self-start" onClick={onDone}>See my readiness</button>
        </>
      )}
    </div>
  );
}
