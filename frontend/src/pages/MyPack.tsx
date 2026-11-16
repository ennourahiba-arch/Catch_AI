import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, Loader2, MessagesSquare, Play, QrCode, Trash2 } from "lucide-react";
import RichText from "../components/RichText";
import { SourceQuote } from "../components/QuestionCard";
import { ErrorState, Loading } from "../components/States";
import { LETTERS } from "../components/Live";
import { api, tokens } from "../lib/api";
import { deletePack, getPack, savePack } from "../lib/storage";
import { isCurrentPack, type CustomPack } from "../lib/types";
import { PracticeCustom } from "./Practice";
import Oral from "./Oral";

export function usePackFromDevice(id: string) {
  const [pack, setPack] = useState<CustomPack | null | undefined>(undefined);
  const reload = useCallback(() => { getPack(id).then((p) => setPack(p ?? null)); }, [id]);
  useEffect(reload, [reload]);
  return { pack, setPack };
}

const Missing = () => <ErrorState message="This course isn't on this device. Courses made from uploaded material are stored only in the browser that created them." />;

export function PackPractice() {
  const { pack } = usePackFromDevice(useParams().packId ?? "");
  if (pack === undefined) return <Loading />;
  if (!pack || !isCurrentPack(pack)) return <Missing />;
  return pack.format === "oral" ? <Oral pack={pack} /> : <PracticeCustom custom={pack} />;
}

const FORMAT = { quiz: "Multiple-choice exam", written: "Written exam", oral: "Oral exam" };

export default function MyPack() {
  const id = useParams().packId ?? "";
  const navigate = useNavigate();
  const truncated = (useLocation().state as { truncated?: boolean } | null)?.truncated;
  const { pack, setPack } = usePackFromDevice(id);
  const [open, setOpen] = useState<string | null>(null);
  const [secs, setSecs] = useState(60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (pack === undefined) return <Loading />;
  if (!pack) return <Missing />;
  const remove = async () => { if (confirm("Delete this course from this device?")) { await deletePack(pack.id); navigate("/student"); } };
  if (!isCurrentPack(pack)) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-2xl font-bold">{pack.title}</h1>
        <p className="mt-2 text-navy-soft">This was made with an earlier version of the app that worked differently. Delete it and upload the material again to get exam-style practice questions.</p>
        <button className="btn-ghost mt-6" onClick={remove}><Trash2 size={16} aria-hidden /> Delete it</button>
      </div>
    );
  }

  const approved = new Set(pack.approved ?? []);
  const toggle = async (qid: string) => {
    const next = { ...pack, approved: approved.has(qid) ? [...approved].filter((x) => x !== qid) : [...approved, qid] };
    await savePack(next);
    setPack(next);
  };
  async function launch() {
    setBusy(true); setErr(null);
    const questions = pack!.exercises.filter((e) => approved.has(e.id) && e.answer.kind === "mcq").slice(0, 20).map((e) => ({
      id: e.id, prompt: e.prompt, options: (e.options ?? []).map((o) => ({ text: o, latex: "" })),
      correct: (e.answer as { correct: number }).correct, labels: e.labels ?? [], solution: e.solution,
    }));
    try {
      const r = await api.createQuiz({ title: pack!.title, questions, seconds_per_question: secs });
      tokens.set("host", r.code, { token: r.host_token });
      navigate(`/host/${r.code}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  const prof = pack.exam_profile;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-6">
      <Link to="/student" className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> Dashboard</Link>
      <p className="mt-4 font-bold text-violet-ink">{FORMAT[pack.format]}</p>
      <h1 className="text-3xl font-bold sm:text-4xl">{pack.title}</h1>
      <p className="mt-1 text-navy-mute">{pack.exercises.length} practice questions from {pack.sources.join(", ")}. Saved only on this device.</p>
      {pack.generator.test_mode && <p className="mt-3 rounded-lg bg-coral-wash px-4 py-3 font-bold text-coral-ink">Test mode: made by a simulated AI, so the questions are placeholder text.</p>}
      {truncated && <p className="mt-3 rounded-lg bg-paper px-4 py-3 ring-1 ring-line">Your files were long, so only the first part was used. Upload fewer chapters at a time to cover the rest.</p>}
      {pack.dropped.length > 0 && <p className="mt-3 text-[15px] text-navy-soft">{pack.dropped.length} generated {pack.dropped.length === 1 ? "question was" : "questions were"} thrown out because {pack.dropped.length === 1 ? "it" : "they"} didn't pass the checks against your document.</p>}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link to={`/mine/${pack.id}/practice`} className="btn-primary">
          {pack.format === "oral" ? <MessagesSquare size={17} aria-hidden /> : <Play size={17} aria-hidden />} {pack.format === "oral" ? "Start an oral practice" : "Start a practice session"}
        </Link>
      </div>

      {prof && (prof.question_types.length > 0 || prof.duration_minutes) && (
        <section className="mt-8 rounded-xl border border-line bg-white p-5">
          <h2 className="font-bold">Your exam, as read from your past exams</h2>
          <p className="mt-1 text-[15px] text-navy-soft">
            {prof.question_types.length > 0 && <>Question types: {prof.question_types.join(", ")}. </>}
            {prof.number_of_questions && <>About {prof.number_of_questions} questions. </>}
            {prof.duration_minutes && <>{prof.duration_minutes} minutes. </>}
            {prof.notes}
          </p>
          <p className="mt-2 text-sm text-navy-mute">A timed mock exam in this format is coming next.</p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-bold">{pack.format === "quiz" ? "Questions, and using them in class" : "Questions"}</h2>
        {pack.format === "quiz" && (
          <p className="mt-1 max-w-[46rem] text-navy-soft">Professors: open a question, check it and its answer, and approve it. Approved questions can go into a live class quiz.</p>
        )}
        <ul className="mt-4 grid gap-2.5">
          {pack.exercises.map((e, i) => (
            <li key={e.id} className={`rounded-xl border-2 bg-white ${approved.has(e.id) ? "border-teal" : "border-line"}`}>
              <button className="flex w-full items-start justify-between gap-3 p-4 text-left" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                <span className="min-w-0"><span className="text-navy-mute">Q{i + 1}. </span><RichText text={e.prompt} />{approved.has(e.id) && <span className="ml-2 text-sm font-bold text-teal-ink">approved</span>}</span>
                <ChevronDown size={18} className={`mt-1 shrink-0 text-navy-mute ${open === e.id ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {open === e.id && (
                <div className="grid gap-3 border-t border-line p-4">
                  {e.answer.kind === "mcq" ? (
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
                  ) : (
                    <p className="text-[15px]"><b>Model answer:</b> <RichText text={e.answer.kind === "open" ? e.answer.model_answer : ""} /></p>
                  )}
                  {e.solution[0]?.quote && <SourceQuote quote={e.solution[0].quote} source={e.solution[0].source} />}
                  {pack.format === "quiz" && (
                    <button className={`justify-self-start ${approved.has(e.id) ? "btn-ghost" : "btn-violet"}`} onClick={() => toggle(e.id)}>
                      <Check size={17} aria-hidden /> {approved.has(e.id) ? "Approved (undo)" : "I checked it: approve"}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {pack.format === "quiz" && (
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
        )}
      </section>

      <button className="btn-ghost mt-12" onClick={remove}><Trash2 size={16} aria-hidden /> Delete this course</button>
    </div>
  );
}
