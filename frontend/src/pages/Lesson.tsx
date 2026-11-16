import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, ListChecks, Loader2, MessagesSquare, PenLine, Play, QrCode, RefreshCw, Trash2 } from "lucide-react";
import ReadinessCard from "../components/ReadinessCard";
import RichText from "../components/RichText";
import { SourceQuote } from "../components/QuestionCard";
import { LETTERS } from "../components/Live";
import { ErrorState, Loading } from "../components/States";
import { accessCode, api } from "../lib/api";
import { readiness } from "../lib/readiness";
import { loadHistory, type History } from "../lib/storage";
import { useAI } from "../lib/useAI";
import { tokens } from "../lib/api";
import { lessonPack, type Bank, type Course, type Format, type Lesson } from "../lib/types";
import { CourseMissing, FORMAT_NAME, useCourse } from "./Course";

const FORMATS: { id: Format; icon: typeof ListChecks; text: string; counts: number[] }[] = [
  { id: "quiz", icon: ListChecks, text: "Four options, graded instantly. Wrong options are real student mistakes. Usable in class.", counts: [8, 12, 16, 20] },
  { id: "written", icon: PenLine, text: "Open questions. Your answer is graded against this lesson, with the key points you missed.", counts: [4, 6, 8, 10] },
  { id: "oral", icon: MessagesSquare, text: "An examiner asks you questions in a chat. Answer by typing or speaking.", counts: [5, 7, 10] },
];

/** Generates a bank for one lesson in one format and saves it in the course. */
export async function createBank(course: Course, lesson: Lesson, format: Format, count: number): Promise<Course> {
  const res = await api.generate(format, lesson.passages, course.past_exams?.text ?? "", count);
  const bank: Bank = {
    format, created_at: res.created_at, generator: res.generator, dropped: res.dropped, approved: [],
    exercises: res.exercises.map((e) => ({ ...e, topic: lesson.id })),
  };
  return {
    ...course,
    exam_profile: course.exam_profile ?? (course.past_exams ? res.exam_profile : null),
    lessons: course.lessons.map((l) => (l.id === lesson.id ? { ...l, banks: { ...l.banks, [format]: bank } } : l)),
  };
}

export function useLesson() {
  const { courseId = "", lessonId = "" } = useParams();
  const c = useCourse(courseId);
  const lesson = c.course?.lessons.find((l) => l.id === lessonId);
  return { ...c, lesson };
}

export default function LessonPage() {
  const navigate = useNavigate();
  const { course, lesson, save } = useLesson();
  const ai = useAI();
  const [history, setHistory] = useState<History | null>(null);
  const [counts, setCounts] = useState<Record<Format, number>>({ quiz: 12, written: 6, oral: 7 });
  const [busy, setBusy] = useState<Format | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState(accessCode.get());
  useEffect(() => { loadHistory().then(setHistory); }, []);

  if (course === undefined || !history) return <Loading />;
  if (!course) return <CourseMissing />;
  if (!lesson) return <ErrorState message="This lesson isn't in the course any more." />;
  const base = `/course/${course.id}/lesson/${lesson.id}`;

  async function generate(f: Format) {
    setBusy(f); setErr(null);
    if (ai.status?.access_code_required) accessCode.set(code.trim());
    try { await save(await createBank(course!, lesson!, f, counts[f])); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  const aiReady = !!ai.status?.enabled && ai.consent && (!ai.status.access_code_required || code.trim());

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-6">
      <Link to={`/course/${course.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> {course.name}</Link>
      <h1 className="mt-4 text-3xl font-bold sm:text-4xl">{lesson.title}</h1>
      <p className="mt-1 text-navy-mute">From {lesson.sources.join(", ")}. Saved only on this device.</p>
      {lesson.truncated && <p className="mt-3 rounded-lg bg-paper px-4 py-3 ring-1 ring-line">These files were long, so only the first part is used. Split very long material into several lessons.</p>}

      <h2 className="mt-8 text-xl font-bold">Practice this lesson</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {FORMATS.map((f) => {
          const bank = lesson.banks[f.id];
          return (
            <div key={f.id} className={`flex flex-col rounded-xl border-2 bg-white p-5 ${bank ? "border-navy" : "border-line"}`}>
              <f.icon size={22} className="text-violet-ink" aria-hidden />
              <h3 className="mt-2 font-display text-lg font-bold">{FORMAT_NAME[f.id]}</h3>
              <p className="mt-1 flex-1 text-[15px] text-navy-soft">{f.text}</p>
              {bank ? (
                <div className="mt-4 grid gap-2">
                  <p className="text-sm text-navy-mute">{bank.exercises.length} questions{bank.generator.test_mode && " (test mode)"}</p>
                  <Link to={`${base}/practice/${f.id}`} className="btn-primary"><Play size={17} aria-hidden /> Practice</Link>
                  <button className="inline-flex items-center justify-center gap-1.5 text-sm font-bold text-navy-mute hover:text-navy disabled:opacity-50" disabled={!aiReady || !!busy}
                    onClick={() => { if (confirm("Replace these questions with a new set?")) generate(f.id); }}>
                    {busy === f.id ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />} New questions
                  </button>
                </div>
              ) : (
                <div className="mt-4 grid gap-2">
                  <label className="inline-flex items-center gap-2 text-[15px]"><span className="text-navy-mute">Questions</span>
                    <select value={counts[f.id]} onChange={(e) => setCounts({ ...counts, [f.id]: Number(e.target.value) })} className="rounded-md border border-line bg-white px-2 py-1 font-bold">
                      {f.counts.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <button className="btn-violet" disabled={!aiReady || !!busy} onClick={() => generate(f.id)}>
                    {busy === f.id ? <><Loader2 size={17} className="animate-spin" aria-hidden /> Writing and checking</> : "Create questions"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {busy && <p className="mt-3 text-sm text-navy-mute" role="status">The AI writes the questions, then every quote is matched against this lesson and a second AI review checks the answers. This usually takes under a minute.</p>}
      {err && <p className="mt-3 rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}

      {ai.status && !ai.status.enabled && <p className="mt-4 rounded-lg bg-paper px-4 py-3 ring-1 ring-line">Creating questions needs an AI connection on the server, which isn't set up yet. Lessons are saved and ready for when it is.</p>}
      {ai.status?.enabled && (!ai.consent || ai.status.access_code_required) && (
        <div className="mt-4 grid gap-3 rounded-xl border border-line bg-white p-5">
          {ai.status.test_mode && <p className="font-bold text-coral-ink">Test mode: the server uses a simulated AI, so questions will be placeholder text.</p>}
          {!ai.consent && (
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={ai.consent} onChange={(e) => ai.setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-[#5643DE]" />
              <span className="text-[15px]">I understand that creating questions sends this lesson's text (and the course's past exams) to {ai.provider}{ai.status.provider === "gemini" && ", which on Google's free tier may use it to improve its products"}. My material contains no personal data.</span>
            </label>
          )}
          {ai.status.access_code_required && (
            <label className="grid max-w-xs gap-1.5"><span className="font-bold">Access code</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} className="min-h-[44px] rounded-lg border border-line px-3" autoComplete="off" />
            </label>
          )}
        </div>
      )}

      <div className="mt-10"><ReadinessCard r={readiness(lessonPack(course, lesson), history, lesson.id)} /></div>

      {lesson.banks.quiz && <ClassQuiz course={course} lesson={lesson} bank={lesson.banks.quiz} save={save} />}

      <button className="btn-ghost mt-12" onClick={async () => {
        if (!confirm(`Delete the lesson "${lesson.title}"?`)) return;
        await save({ ...course, lessons: course.lessons.filter((l) => l.id !== lesson.id) });
        navigate(`/course/${course.id}`);
      }}><Trash2 size={16} aria-hidden /> Delete this lesson</button>
    </div>
  );
}

function ClassQuiz({ course, lesson, bank, save }: { course: Course; lesson: Lesson; bank: Bank; save: (c: Course) => Promise<void> }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [secs, setSecs] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const approved = new Set(bank.approved ?? []);
  const setApproved = (ids: string[]) => save({
    ...course, lessons: course.lessons.map((l) => (l.id === lesson.id ? { ...l, banks: { ...l.banks, quiz: { ...bank, approved: ids } } } : l)),
  });
  async function launch() {
    setBusy(true); setErr(null);
    const questions = bank.exercises.filter((e) => approved.has(e.id)).slice(0, 20).map((e) => ({
      id: e.id, prompt: e.prompt, options: (e.options ?? []).map((o) => ({ text: o, latex: "" })),
      correct: (e.answer as { correct: number }).correct, labels: e.labels ?? [], solution: e.solution,
    }));
    try {
      const r = await api.createQuiz({ title: `${course.name}: ${lesson.title}`, questions, seconds_per_question: secs });
      tokens.set("host", r.code, { token: r.host_token });
      navigate(`/host/${r.code}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold">Multiple-choice questions, and using them in class</h2>
      <p className="mt-1 max-w-[46rem] text-navy-soft">Professors: open a question, check it and its answer, and approve it. Approved questions can go into a live class quiz.</p>
      <ul className="mt-4 grid gap-2.5">
        {bank.exercises.map((e, i) => (
          <li key={e.id} className={`rounded-xl border-2 bg-white ${approved.has(e.id) ? "border-teal" : "border-line"}`}>
            <button className="flex w-full items-start justify-between gap-3 p-4 text-left" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="min-w-0"><span className="text-navy-mute">Q{i + 1}. </span><RichText text={e.prompt} />{approved.has(e.id) && <span className="ml-2 text-sm font-bold text-teal-ink">approved</span>}</span>
              <ChevronDown size={18} className={`mt-1 shrink-0 text-navy-mute ${open === e.id ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {open === e.id && (
              <div className="grid gap-3 border-t border-line p-4">
                <ul className="grid gap-2">
                  {(e.options ?? []).map((o, k) => {
                    const right = k === (e.answer as { correct: number }).correct;
                    return (
                      <li key={k} className="flex gap-3 text-[15px]">
                        <span className={`font-display font-bold ${right ? "text-teal-ink" : "text-navy-mute"}`}>{LETTERS[k]}</span>
                        <span><RichText text={o} /><span className={`block text-sm ${right ? "font-bold text-teal-ink" : "text-navy-mute"}`}>{right ? "Correct" : e.labels?.[k] ?? ""}</span></span>
                      </li>
                    );
                  })}
                </ul>
                {e.solution[0]?.quote && <SourceQuote quote={e.solution[0].quote} source={e.solution[0].source} />}
                <button className={`justify-self-start ${approved.has(e.id) ? "btn-ghost" : "btn-violet"}`}
                  onClick={() => setApproved(approved.has(e.id) ? [...approved].filter((x) => x !== e.id) : [...approved, e.id])}>
                  <Check size={17} aria-hidden /> {approved.has(e.id) ? "Approved (undo)" : "I checked it: approve"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-line bg-white px-4">
          <span className="text-[15px] text-navy-mute">Per question</span>
          <select value={secs} onChange={(e) => setSecs(Number(e.target.value))} className="bg-transparent font-bold outline-none">
            {[30, 45, 60, 90, 120].map((s) => <option key={s} value={s}>{s} s</option>)}
          </select>
        </label>
        <button className="btn-primary" disabled={!approved.size || busy} onClick={launch}>
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <QrCode size={17} aria-hidden />} Create a class quiz ({Math.min(approved.size, 20)} approved)
        </button>
        {err && <p className="w-full text-coral-ink" role="alert">{err}</p>}
      </div>
    </section>
  );
}
