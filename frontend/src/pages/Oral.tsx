import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import RichText from "../components/RichText";
import { SourceQuote } from "../components/QuestionCard";
import { ConfidenceCheck } from "./Practice";
import { pickSession } from "../lib/readiness";
import { addConfidence, loadHistory } from "../lib/storage";
import { api, type ChatMsg } from "../lib/api";
import { addExerciseAttempt } from "../lib/storage";
import type { CustomPack, Exercise } from "../lib/types";

function Bubble({ m }: { m: ChatMsg }) {
  const mine = m.role === "student";
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? "bg-navy text-white" : "bg-white ring-1 ring-line"}`}>
        {!mine && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-violet-ink">Examiner</p>}
        <RichText text={m.text} />
      </div>
    </li>
  );
}

function Composer({ onSend, busy, placeholder, disabled }: { onSend: (t: string) => void; busy: boolean; placeholder: string; disabled?: boolean }) {
  const [text, setText] = useState("");
  const send = () => { const t = text.trim(); if (t && !busy) { onSend(t); setText(""); } };
  return (
    <div className="flex items-end gap-2">
      <label className="sr-only" htmlFor="oral-input">Your message</label>
      <textarea id="oral-input" value={text} onChange={(e) => setText(e.target.value.slice(0, 3000))} rows={2} placeholder={placeholder} disabled={disabled}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        className="min-h-[56px] flex-1 resize-y rounded-xl border border-line bg-white p-3 outline-none focus:border-violet disabled:opacity-50" />
      <button className="btn-primary h-[56px] w-[56px] !px-0" aria-label="Send" disabled={!text.trim() || busy || disabled} onClick={send}>
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
      </button>
    </div>
  );
}

function useScrollToEnd(dep: unknown) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [dep]);
  return end;
}

/** Oral exam practice: an AI examiner asks questions from your course and follows up. */
export default function Oral({ pack }: { pack: CustomPack }) {
  const [qs, setQs] = useState<Exercise[] | null>(null);
  const [last, setLast] = useState<number | undefined>();
  useEffect(() => { loadHistory().then((h) => setLast(h.confidence.find((c) => c.topic === pack.id)?.rating)); }, [pack.id]);
  if (!qs) {
    return (
      <div className="px-4">
        <ConfidenceCheck title={pack.title} last={last} backTo={`/mine/${pack.id}`} onPick={async (n) => {
          await addConfidence({ topic: pack.id, ts: Date.now(), rating: n as 1 | 2 | 3 | 4 | 5 });
          setQs(pickSession(pack.exercises, await loadHistory()));
        }} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <Link to={`/mine/${pack.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> {pack.title}</Link>
      {pack.generator.test_mode && <p className="mt-3 rounded-lg bg-coral-wash px-4 py-2 text-sm font-bold text-coral-ink">Test mode: the examiner's replies are simulated.</p>}
      <Examiner pack={pack} qs={qs} onRestart={async () => setQs(pickSession(pack.exercises, await loadHistory()))} />
      <p className="mt-6 text-sm text-navy-mute">The conversation is sent to the AI provider to generate the examiner's replies and isn't stored by the server. It needs an internet connection.</p>
    </div>
  );
}

function Examiner({ pack, qs, onRestart }: { pack: CustomPack; qs: Exercise[]; onRestart: () => void }) {
  const [i, setI] = useState(0);
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [closed, setClosed] = useState(false);
  const [scores, setScores] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useScrollToEnd(history.length);
  const ex = qs[i];
  const finished = i >= qs.length;
  const q = ex && {
    question: ex.prompt,
    key_points: ex.answer.kind === "open" ? ex.answer.key_points : [],
    model_answer: ex.answer.kind === "open" ? ex.answer.model_answer : "",
    quote: ex.solution[0]?.quote ?? "",
  };

  useEffect(() => {
    if (finished) return;
    setHistory([{ role: "examiner", text: q.question }]); // the opening question needs no AI call
    setClosed(false);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(text: string) {
    const h: ChatMsg[] = [...history, { role: "student", text }];
    setHistory(h); setBusy(true); setErr(null);
    try {
      const r = await api.examiner(q, h);
      setHistory([...h, { role: "examiner", text: r.reply }]);
      if (r.closed) {
        const sc = r.score ?? 0;
        setClosed(true);
        setScores((s) => [...s, sc]);
        addExerciseAttempt({ exerciseId: ex.id, topic: pack.id, ts: Date.now(), attempts: 1, correct: sc > 0, firstTry: sc === 2, usedHint: false }).catch(() => undefined);
      }
    } catch (e) {
      setErr((e as Error).message);
      setHistory(history);
    } finally { setBusy(false); }
  }

  if (finished) {
    const total = scores.reduce((a, b) => a + b, 0);
    return (
      <div className="mt-6 grid gap-5">
        <h1 className="text-3xl font-bold">Oral exam finished</h1>
        <div className="rounded-xl bg-navy px-5 py-4 text-white">
          <p className="text-white/70">Your score</p>
          <p className="font-display text-4xl font-extrabold">{total}<span className="text-xl text-white/60"> / {qs.length * 2}</span></p>
          <p className="mt-1 text-sm text-white/70">Scored by the AI examiner against your course material. It can make mistakes.</p>
        </div>
        <ol className="grid gap-4">
          {qs.map((x, k) => (
            <li key={k} className="rounded-xl border border-line bg-white p-5">
              <p className="font-bold"><RichText text={x.prompt} /> <span className="ml-1 text-navy-mute">({scores[k] ?? 0}/2)</span></p>
              <p className="mt-2"><RichText text={x.answer.kind === "open" ? x.answer.model_answer : ""} /></p>
              {x.solution[0]?.quote && <SourceQuote quote={x.solution[0].quote} source={x.solution[0].source} />}
            </li>
          ))}
        </ol>
        <button className="btn-primary justify-self-start" onClick={() => { setScores([]); setI(0); onRestart(); }}>Practice again</button>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Oral exam practice</h1>
        <p className="text-navy-mute">Question {i + 1} of {qs.length}</p>
      </div>
      <p className="text-navy-soft">Answer as you would out loud. If your answer is vague, the examiner asks a follow-up. It won't give the answer until the question is closed.</p>
      <ol className="grid gap-3" aria-live="polite">{history.map((m, k) => <Bubble key={k} m={m} />)}</ol>
      {busy && <p className="flex items-center gap-2 text-navy-mute"><Loader2 size={16} className="animate-spin" aria-hidden /> The examiner is thinking</p>}
      {err && <p className="rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}
      {closed ? (
        <button className="btn-primary justify-self-start" onClick={() => setI(i + 1)}>{i + 1 < qs.length ? "Next question" : "See my results"}</button>
      ) : (
        <Composer onSend={send} busy={busy} placeholder="Type your answer" />
      )}
      <div ref={end} />
    </div>
  );
}
