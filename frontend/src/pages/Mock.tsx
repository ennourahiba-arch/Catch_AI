import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, Clock, Loader2, X } from "lucide-react";
import RichText from "../components/RichText";
import { SourceQuote } from "../components/QuestionCard";
import { Bars, LETTERS, fmt } from "../components/Live";
import { Loading } from "../components/States";
import { accessCode, api } from "../lib/api";
import { addExerciseAttempt, getKV, newId, setKV } from "../lib/storage";
import { useAI } from "../lib/useAI";
import type { Course, Exercise, Passage } from "../lib/types";
import { CourseMissing, useCourse } from "./Course";

const MATERIAL_BUDGET = 85_000; // characters sent to the AI, shared fairly between the chosen lessons

interface Grade { points: number; max: number; verdict: "correct" | "partial" | "incorrect" | "ungraded"; feedback?: string; covered?: number[] }
interface ExamState {
  courseId: string;
  questions: Exercise[];       // multiple choice first, then written
  minutes: number;
  started: number;
  deadline: number;
  answers: Record<string, string>; // mcq: option index as text; written: the answer text
  submitted?: number;
  grades?: Record<string, Grade>;
  lessonTitles: Record<string, string>;
}

const keyFor = (courseId: string) => `mock:${courseId}`;

/** Samples each chosen lesson's passages evenly so all lessons fit in one request, and renumbers them. */
export function buildMaterial(course: Course, lessonIds: string[]): { passages: Passage[]; lessonOf: Record<string, string> } {
  const chosen = course.lessons.filter((l) => lessonIds.includes(l.id) && l.passages.length);
  const budget = Math.floor(MATERIAL_BUDGET / Math.max(1, chosen.length));
  const passages: Passage[] = [];
  const lessonOf: Record<string, string> = {};
  for (const l of chosen) {
    const total = l.passages.reduce((n, p) => n + p.text.length, 0);
    const step = Math.max(1, Math.ceil(total / budget));
    let used = 0;
    for (let i = 0; i < l.passages.length && used < budget; i += step) {
      const id = `P${passages.length + 1}`;
      passages.push({ id, file: l.title, text: l.passages[i].text });
      lessonOf[id] = l.id;
      used += l.passages[i].text.length;
    }
  }
  return { passages, lessonOf };
}

export default function MockPage() {
  const id = useParams().courseId ?? "";
  const { course, save } = useCourse(id);
  const [exam, setExam] = useState<ExamState | null | undefined>(undefined);
  useEffect(() => { getKV<ExamState>(keyFor(id)).then((e) => setExam(e ?? null)); }, [id]);
  const update = (e: ExamState | null) => { setExam(e); setKV(keyFor(id), e); };

  if (course === undefined || exam === undefined) return <Loading />;
  if (!course) return <CourseMissing />;
  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-6">
      <Link to={`/course/${course.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> {course.name}</Link>
      {!exam && <Setup course={course} onReady={update} />}
      {exam && !exam.submitted && <Exam exam={exam} update={update} />}
      {exam?.submitted && <Report course={course} exam={exam} update={update} save={save} />}
    </div>
  );
}

function Setup({ course, onReady }: { course: Course; onReady: (e: ExamState) => void }) {
  const ai = useAI();
  const prof = course.exam_profile;
  const [lessons, setLessons] = useState<string[]>(course.lessons.map((l) => l.id));
  const [minutes, setMinutes] = useState(Math.min(180, Math.max(15, prof?.duration_minutes ?? 45)));
  const types = (prof?.question_types ?? []).join(" ").toLowerCase();
  const wantsWritten = !prof || /writ|short|open|essay|problem|explain|r[ée]dig|d[ée]velopp/.test(types);
  const wantsMcq = !prof || /choice|mcq|qcm|quiz|multiple/.test(types) || !wantsWritten;
  const [mcq, setMcq] = useState(wantsMcq ? Math.min(20, Math.max(5, Math.round(minutes / 4))) : 0);
  const [written, setWritten] = useState(wantsWritten ? Math.min(5, Math.max(2, Math.round(minutes / 20))) : 0);
  const [code, setCode] = useState(accessCode.get());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const durations = [...new Set([20, 30, 45, 60, 90, 120, minutes])].sort((a, b) => a - b);

  async function start() {
    setBusy(true); setErr(null);
    if (ai.status?.access_code_required) accessCode.set(code.trim());
    try {
      const { passages, lessonOf } = buildMaterial(course, lessons);
      const res = await api.mockExam({ passages, past_exams: course.past_exams?.text ?? "", mcq, written });
      const tag = (e: Exercise) => ({ ...e, topic: lessonOf[e.source_ids?.[0] ?? ""] ?? lessons[0] });
      const questions = [...(res.mcq?.exercises ?? []).map(tag), ...(res.written?.exercises ?? []).map(tag)];
      if (!questions.length) throw new Error(res.errors[0] ?? "No questions could be created. Try again.");
      const now = Date.now();
      onReady({
        courseId: course.id, questions, minutes, started: now, deadline: now + minutes * 60_000, answers: {},
        lessonTitles: Object.fromEntries(course.lessons.map((l) => [l.id, l.title])),
      });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const aiReady = !!ai.status?.enabled && ai.consent && (!ai.status.access_code_required || code.trim());
  return (
    <div className="mt-4 grid gap-6">
      <div>
        <h1 className="text-3xl font-bold sm:text-4xl">Mock exam</h1>
        <p className="mt-1 text-navy-soft">Timed, across your lessons, with no hints and no feedback until you hand it in.{prof ? " Set up from what your past exams look like; adjust if needed." : " Add past exams to the course to match your real exam's shape."}</p>
      </div>

      <fieldset className="rounded-xl border border-line bg-white p-5">
        <legend className="px-1 font-bold">Lessons included</legend>
        <ul className="grid gap-2">
          {course.lessons.map((l) => (
            <li key={l.id}>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={lessons.includes(l.id)} disabled={!l.passages.length} className="h-5 w-5 accent-[#151631]"
                  onChange={(e) => setLessons(e.target.checked ? [...lessons, l.id] : lessons.filter((x) => x !== l.id))} />
                <span>{l.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="grid gap-4 rounded-xl border border-line bg-white p-5 sm:grid-cols-3">
        <label className="grid gap-1.5"><span className="font-bold">Time</span>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="min-h-[44px] rounded-lg border border-line bg-white px-3 font-bold">
            {durations.map((d) => <option key={d} value={d}>{d} minutes</option>)}
          </select>
        </label>
        <label className="grid gap-1.5"><span className="font-bold">Multiple choice</span>
          <select value={mcq} onChange={(e) => setMcq(Number(e.target.value))} className="min-h-[44px] rounded-lg border border-line bg-white px-3 font-bold">
            {[0, 5, 8, 10, 12, 15, 20, 25].map((n) => <option key={n} value={n}>{n} questions</option>)}
          </select>
        </label>
        <label className="grid gap-1.5"><span className="font-bold">Written</span>
          <select value={written} onChange={(e) => setWritten(Number(e.target.value))} className="min-h-[44px] rounded-lg border border-line bg-white px-3 font-bold">
            {[0, 1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n} questions</option>)}
          </select>
        </label>
      </div>

      {ai.status && !ai.status.enabled && <p className="rounded-lg bg-paper px-4 py-3 ring-1 ring-line">A mock exam is written by AI from your lessons, and no AI is set up on the server yet.</p>}
      {ai.status?.enabled && (!ai.consent || ai.status.access_code_required) && (
        <div className="grid gap-3 rounded-xl border border-line bg-white p-5">
          {!ai.consent && (
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={ai.consent} onChange={(e) => ai.setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-[#5643DE]" />
              <span className="text-[15px]">I understand that this sends my lessons' text and past exams to {ai.provider}. My material contains no personal data.</span>
            </label>
          )}
          {ai.status.access_code_required && (
            <label className="grid max-w-xs gap-1.5"><span className="font-bold">Access code</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} className="min-h-[44px] rounded-lg border border-line px-3" autoComplete="off" />
            </label>
          )}
        </div>
      )}
      {ai.status?.test_mode && <p className="font-bold text-coral-ink">Test mode: the server uses a simulated AI, so questions will be placeholder text.</p>}
      {err && <p className="rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}
      <div>
        <button className="btn-primary" disabled={!aiReady || busy || !lessons.length || mcq + written === 0} onClick={start}>
          {busy ? <><Loader2 size={17} className="animate-spin" aria-hidden /> Writing your exam</> : <><Clock size={17} aria-hidden /> Create the exam and start the clock</>}
        </button>
        {busy && <p className="mt-2 text-sm text-navy-mute" role="status">Questions are written from your lessons, every quote is matched against them, and a second AI review checks the answers. This can take a minute. The clock starts when the exam appears.</p>}
      </div>
    </div>
  );
}

function useClock(deadline: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function Exam({ exam, update }: { exam: ExamState; update: (e: ExamState) => void }) {
  const left = useClock(exam.deadline);
  const submitted = useRef(false);
  const answered = exam.questions.filter((q) => (exam.answers[q.id] ?? "").trim()).length;
  const submit = () => { if (!submitted.current) { submitted.current = true; update({ ...exam, submitted: Date.now() }); } };
  useEffect(() => { if (left === 0) submit(); }); // time's up: hand in automatically
  const set = (qid: string, v: string) => update({ ...exam, answers: { ...exam.answers, [qid]: v } });
  const mcqs = exam.questions.filter((q) => q.answer.kind === "mcq");
  const open = exam.questions.filter((q) => q.answer.kind === "open");

  return (
    <div className="mt-2">
      <div className="sticky top-[57px] z-20 -mx-4 mb-6 flex items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur">
        <span className={`font-display text-2xl font-extrabold tabular-nums ${left <= 300 ? "text-coral-ink" : ""}`} role="timer" aria-label={`${Math.ceil(left / 60)} minutes left`}>{fmt(left)}</span>
        <span className="text-[15px] text-navy-mute">{answered} of {exam.questions.length} answered</span>
        <button className="btn-primary" onClick={() => { if (confirm(answered < exam.questions.length ? "Some questions are unanswered. Hand in anyway?" : "Hand in your exam?")) submit(); }}>Hand in</button>
      </div>
      <h1 className="text-2xl font-bold">Mock exam</h1>
      <p className="text-navy-mute">{exam.minutes} minutes. Your answers are saved on this device as you go; if you reload, the clock keeps running.</p>

      {mcqs.length > 0 && <h2 className="mt-8 text-xl font-bold">Part A: multiple choice <span className="text-base font-normal text-navy-mute">(1 point each)</span></h2>}
      <ol className="mt-3 grid gap-4">
        {mcqs.map((q, i) => (
          <li key={q.id} className="rounded-xl border border-line bg-white p-5">
            <p className="font-bold"><span className="text-navy-mute">{i + 1}. </span><RichText text={q.prompt} /></p>
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label={`Question ${i + 1}`}>
              {(q.options ?? []).map((o, k) => {
                const on = exam.answers[q.id] === String(k);
                return (
                  <button key={k} role="radio" aria-checked={on} onClick={() => set(q.id, String(k))}
                    className={`flex items-start gap-3 rounded-lg border-2 px-3 py-2 text-left ${on ? "border-navy bg-paper" : "border-line hover:border-navy-mute"}`}>
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${on ? "bg-navy text-white" : "bg-paper"}`}>{LETTERS[k]}</span>
                    <span className="pt-0.5"><RichText text={o} /></span>
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      {open.length > 0 && <h2 className="mt-10 text-xl font-bold">Part {mcqs.length ? "B" : "A"}: written <span className="text-base font-normal text-navy-mute">(2 points each)</span></h2>}
      <ol className="mt-3 grid gap-4">
        {open.map((q, i) => (
          <li key={q.id} className="rounded-xl border border-line bg-white p-5">
            <label className="grid gap-2">
              <span className="font-bold"><span className="text-navy-mute">{mcqs.length + i + 1}. </span><RichText text={q.prompt} /></span>
              <textarea rows={7} value={exam.answers[q.id] ?? ""} onChange={(e) => set(q.id, e.target.value.slice(0, 5000))}
                className="rounded-lg border border-line p-3 outline-none focus:border-violet" />
            </label>
          </li>
        ))}
      </ol>
      <button className="btn-primary mt-8" onClick={() => { if (confirm("Hand in your exam?")) submit(); }}>Hand in</button>
    </div>
  );
}

function Report({ course, exam, update, save }: { course: Course; exam: ExamState; update: (e: ExamState | null) => void; save: (c: Course) => Promise<void> }) {
  const [progress, setProgress] = useState(0);
  const started = useRef(false);
  const grades = exam.grades;

  // Grade once: multiple choice exactly, written answers with AI against the lesson material.
  useEffect(() => {
    if (grades || started.current) return;
    started.current = true;
    (async () => {
      const g: Record<string, Grade> = {};
      for (const q of exam.questions) {
        const ans = (exam.answers[q.id] ?? "").trim();
        if (q.answer.kind === "mcq") {
          g[q.id] = { points: ans !== "" && Number(ans) === q.answer.correct ? 1 : 0, max: 1, verdict: ans !== "" && Number(ans) === q.answer.correct ? "correct" : "incorrect" };
        } else if (q.answer.kind === "open") {
          if (!ans) { g[q.id] = { points: 0, max: 2, verdict: "incorrect", feedback: "No answer was given." }; }
          else {
            try {
              const r = await api.grade({ question: q.prompt, key_points: q.answer.key_points, model_answer: q.answer.model_answer,
                sources: q.solution.map((s) => s.quote ?? "").filter(Boolean), answer: ans });
              g[q.id] = { points: r.verdict === "correct" ? 2 : r.verdict === "partial" ? 1 : 0, max: 2, verdict: r.verdict, feedback: r.feedback, covered: r.covered };
            } catch {
              g[q.id] = { points: 0, max: 2, verdict: "ungraded", feedback: "This answer couldn't be graded (no connection to the AI). Compare it with the model answer below." };
            }
          }
          setProgress((p) => p + 1);
        }
      }
      // Count every answer toward each lesson's readiness, and keep the result in the course.
      for (const q of exam.questions) {
        const gr = g[q.id];
        if (gr.verdict === "ungraded") continue;
        const pick = q.answer.kind === "mcq" ? Number(exam.answers[q.id]) : NaN;
        await addExerciseAttempt({ exerciseId: q.id, topic: q.topic, ts: Date.now(), attempts: 1, correct: gr.verdict !== "incorrect",
          firstTry: gr.verdict === "correct", usedHint: false, mistake: q.answer.kind === "mcq" && gr.verdict === "incorrect" && !Number.isNaN(pick) ? q.labels?.[pick] ?? null : null });
      }
      const byLesson: Record<string, { score: number; max: number }> = {};
      for (const q of exam.questions) {
        const b = (byLesson[q.topic] ??= { score: 0, max: 0 });
        b.score += g[q.id].points; b.max += g[q.id].max;
      }
      const score = Object.values(g).reduce((n, x) => n + x.points, 0);
      const max = Object.values(g).reduce((n, x) => n + x.max, 0);
      await save({ ...course, mocks: [...course.mocks, {
        id: newId("m"), ts: Date.now(), minutes_allowed: exam.minutes, minutes_used: Math.round(((exam.submitted ?? Date.now()) - exam.started) / 60000),
        score, max, by_lesson: Object.entries(byLesson).map(([lesson_id, v]) => ({ lesson_id, title: exam.lessonTitles[lesson_id] ?? "Lesson", ...v })),
      }] });
      update({ ...exam, grades: g });
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const written = exam.questions.filter((q) => q.answer.kind === "open").length;
  const summary = useMemo(() => {
    if (!grades) return null;
    const by: Record<string, { score: number; max: number }> = {};
    for (const q of exam.questions) { const b = (by[q.topic] ??= { score: 0, max: 0 }); b.score += grades[q.id].points; b.max += grades[q.id].max; }
    const score = Object.values(grades).reduce((n, x) => n + x.points, 0);
    const max = Object.values(grades).reduce((n, x) => n + x.max, 0);
    return { by, score, max };
  }, [grades, exam]);

  if (!grades || !summary) {
    return (
      <div className="py-16 text-center" role="status">
        <Loader2 className="mx-auto animate-spin text-violet" size={28} aria-hidden />
        <p className="mt-4 text-xl font-bold">Marking your exam</p>
        {written > 0 && <p className="mt-1 text-navy-mute">Written answers graded: {progress} of {written}</p>}
      </div>
    );
  }
  const used = Math.round(((exam.submitted ?? 0) - exam.started) / 60000);
  const ungraded = Object.values(grades).some((g) => g.verdict === "ungraded");
  return (
    <div className="mt-4 grid gap-6">
      <div className="rounded-xl bg-navy px-6 py-5 text-white">
        <p className="text-white/70">Mock exam result</p>
        <p className="font-display text-5xl font-extrabold">{Math.round((100 * summary.score) / summary.max)}%</p>
        <p className="mt-1 text-white/80">{summary.score} of {summary.max} points, in {used < 1 ? "under a minute" : `${used} of ${exam.minutes} minutes`}.{written > 0 && " Written answers were graded by AI against your lessons; it can make mistakes."}</p>
      </div>
      {ungraded && <p className="rounded-lg bg-paper px-4 py-3 ring-1 ring-line">Some written answers couldn't be graded and count as 0 for now. Check them against the model answers below.</p>}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-lg font-bold">By lesson</h2>
        <div className="mt-3">
          <Bars rows={Object.entries(summary.by).map(([lid, v]) => ({ key: lid, count: Math.round((100 * v.score) / v.max), label: <span>{exam.lessonTitles[lid] ?? "Lesson"} <span className="text-navy-mute">({v.score}/{v.max})</span></span> }))} />
        </div>
        <p className="mt-3 text-sm text-navy-mute">Percent of points per lesson. Weakest lessons are the ones to practice next.</p>
      </section>

      <h2 className="text-xl font-bold">Your answers</h2>
      <ol className="grid gap-4">
        {exam.questions.map((q, i) => {
          const g = grades[q.id];
          const ans = exam.answers[q.id] ?? "";
          return (
            <li key={q.id} className="rounded-xl border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="font-bold"><span className="text-navy-mute">{i + 1}. </span><RichText text={q.prompt} /></p>
                <span className={`shrink-0 font-display font-bold ${g.verdict === "correct" ? "text-teal-ink" : g.verdict === "partial" ? "" : "text-coral-ink"}`}>{g.points}/{g.max}</span>
              </div>
              <p className="mt-1 text-sm text-navy-mute">{exam.lessonTitles[q.topic]}</p>
              {q.answer.kind === "mcq" ? (
                <div className="mt-3 grid gap-1.5 text-[15px]">
                  <p className="flex gap-2">{g.verdict === "correct" ? <Check size={18} className="text-teal-ink" aria-hidden /> : <X size={18} className="text-coral-ink" aria-hidden />}
                    <span>Your answer: {ans === "" ? "none" : <><b>{LETTERS[Number(ans)]}</b> <RichText text={q.options?.[Number(ans)] ?? ""} /></>}</span></p>
                  {g.verdict !== "correct" && <p>Correct: <b>{q.answer_text}</b>{ans !== "" && q.labels?.[Number(ans)] && <span className="text-coral-ink"> (your pick suggests: {q.labels[Number(ans)]!.toLowerCase()})</span>}</p>}
                </div>
              ) : (
                <div className="mt-3 grid gap-2 text-[15px]">
                  <p className="whitespace-pre-line rounded-md bg-paper p-3">{ans || <span className="text-navy-mute">No answer.</span>}</p>
                  {g.feedback && <p><b>Feedback:</b> {g.feedback}</p>}
                  <p><b>Model answer:</b> <RichText text={q.answer.kind === "open" ? q.answer.model_answer : ""} /></p>
                </div>
              )}
              {q.solution[0]?.quote && <SourceQuote quote={q.solution[0].quote} source={q.solution[0].source} />}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" onClick={() => update(null)}>Set up another mock exam</button>
        <Link to={`/course/${course.id}`} className="btn-ghost">Back to {course.name}</Link>
      </div>
    </div>
  );
}
