import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Send, X } from "lucide-react";
import RichText from "../components/RichText";
import { SourceQuote } from "../components/YourTurn";
import { api, type ChatMsg } from "../lib/api";
import { addExerciseAttempt } from "../lib/storage";
import type { CustomPack } from "../lib/types";

function Bubble({ m }: { m: ChatMsg }) {
  const mine = m.role === "student";
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? "bg-navy text-white" : "bg-white ring-1 ring-line"}`}>
        {!mine && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-violet-ink">{m.role === "examiner" ? "Examiner" : "AI candidate"}</p>}
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

export default function Oral({ pack, mode }: { pack: CustomPack; mode: "examiner" | "candidate" }) {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <Link to={`/mine/${pack.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> {pack.title}</Link>
      {pack.generator.test_mode && <p className="mt-3 rounded-lg bg-coral-wash px-4 py-2 text-sm font-bold text-coral-ink">Test mode: the AI's replies are simulated.</p>}
      {mode === "examiner" ? <Examiner pack={pack} /> : <Candidate pack={pack} />}
      <p className="mt-6 text-sm text-navy-mute">The conversation is sent to the AI provider to generate replies and isn't stored by the server. It needs an internet connection.</p>
    </div>
  );
}

function Examiner({ pack }: { pack: CustomPack }) {
  const qs = pack.oral!.examiner_questions;
  const [i, setI] = useState(0);
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [closed, setClosed] = useState(false);
  const [scores, setScores] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useScrollToEnd(history.length);
  const q = qs[i];
  const finished = i >= qs.length;

  useEffect(() => {
    if (finished) return;
    setHistory([{ role: "examiner", text: q.question }]); // the opening question needs no AI call
    setClosed(false);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(text: string) {
    const h: ChatMsg[] = [...history, { role: "student", text }];
    setHistory(h); setBusy(true); setErr(null);
    try {
      const r = await api.examiner({ question: q.question, key_points: q.key_points, model_answer: q.model_answer, quote: q.quote }, h);
      setHistory([...h, { role: "examiner", text: r.reply }]);
      if (r.closed) {
        const sc = r.score ?? 0;
        setClosed(true);
        setScores((s) => [...s, sc]);
        addExerciseAttempt({ exerciseId: `${pack.id}-oral-${i}`, topic: pack.id, ts: Date.now(), attempts: 1, correct: sc > 0, firstTry: sc === 2, usedHint: false }).catch(() => undefined);
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
              <p className="font-bold"><RichText text={x.question} /> <span className="ml-1 text-navy-mute">({scores[k] ?? 0}/2)</span></p>
              <p className="mt-2"><RichText text={x.model_answer} /></p>
              <SourceQuote quote={x.quote} source={x.source} />
            </li>
          ))}
        </ol>
        <button className="btn-primary justify-self-start" onClick={() => { setScores([]); setI(0); }}>Take it again</button>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">The AI examines you</h1>
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

function Candidate({ pack }: { pack: CustomPack }) {
  const scs = pack.oral!.candidate_scenarios;
  const [i, setI] = useState(0);
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accusing, setAccusing] = useState(false);
  const [claim, setClaim] = useState("");
  const [fix, setFix] = useState("");
  const [verdict, setVerdict] = useState<Awaited<ReturnType<typeof api.judge>> | null>(null);
  const end = useScrollToEnd(history.length + (verdict ? 1 : 0));
  const s = scs[i];
  const scenario = s && { topic: s.topic, false_claim: s.false_claim, correct_claim: s.correct_claim, why: s.why, quote: s.quote };
  const asked = history.filter((m) => m.role === "student").length;

  async function send(text: string) {
    const h: ChatMsg[] = [...history, { role: "student", text }];
    setHistory(h); setBusy(true); setErr(null);
    try {
      const r = await api.candidate(scenario, h);
      setHistory([...h, { role: "candidate", text: r.reply }]);
    } catch (e) { setErr((e as Error).message); setHistory(history); } finally { setBusy(false); }
  }
  async function accuse() {
    setBusy(true); setErr(null);
    try {
      const v = await api.judge(scenario, history, claim, fix);
      setVerdict(v);
      addExerciseAttempt({ exerciseId: `${pack.id}-cand-${i}`, topic: pack.id, ts: Date.now(), attempts: 1, correct: v.caught, firstTry: v.caught && v.corrected, usedHint: false }).catch(() => undefined);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const next = () => { setI(i + 1); setHistory([]); setVerdict(null); setAccusing(false); setClaim(""); setFix(""); };

  if (i >= scs.length) {
    return (
      <div className="mt-6 grid gap-4">
        <h1 className="text-3xl font-bold">All scenarios done</h1>
        <p className="text-navy-soft">Your results count toward this pack's readiness on your dashboard.</p>
        <button className="btn-primary justify-self-start" onClick={() => setI(0)}>Start again</button>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">You examine the AI</h1>
        <p className="text-navy-mute">Scenario {i + 1} of {scs.length}</p>
      </div>
      <div className="rounded-xl bg-violet-wash/60 p-4">
        <p>Question the AI candidate about <b><RichText text={s.topic} /></b>. It sounds sure of itself, but it will state one thing that's wrong. Find it.</p>
        <p className="mt-1 text-sm text-navy-mute">{asked} of 10 questions used.</p>
      </div>
      <ol className="grid gap-3" aria-live="polite">{history.map((m, k) => <Bubble key={k} m={m} />)}</ol>
      {busy && !accusing && <p className="flex items-center gap-2 text-navy-mute"><Loader2 size={16} className="animate-spin" aria-hidden /> The candidate is answering</p>}
      {err && <p className="rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}

      {verdict ? (
        <div className="grid gap-4">
          <div className={`flex gap-2.5 rounded-xl px-4 py-3 ${verdict.caught ? "bg-teal-wash" : "bg-coral-wash"}`} role="status">
            {verdict.caught ? <Check size={20} className="mt-0.5 shrink-0 text-teal-ink" aria-hidden /> : <X size={20} className="mt-0.5 shrink-0 text-coral-ink" aria-hidden />}
            <span><b>{verdict.caught ? (verdict.corrected ? "Caught and corrected." : "Caught it, but the correction isn't quite right.") : "That wasn't the planted mistake."}</b> {verdict.feedback}</span>
          </div>
          <section className="rounded-xl border border-line bg-white p-5">
            <p><b>The candidate's mistake:</b> <RichText text={verdict.false_claim} /></p>
            <p className="mt-2"><b>What your course says:</b> <RichText text={verdict.correct_claim} /></p>
            <p className="mt-2"><b>Why students get this wrong:</b> <RichText text={verdict.why} /></p>
            <SourceQuote quote={s.quote} source={s.source} />
            <p className="mt-3 text-sm text-navy-mute">Judged by AI against your course material. It can make mistakes.</p>
          </section>
          <button className="btn-primary justify-self-start" onClick={next}>{i + 1 < scs.length ? "Next scenario" : "Finish"}</button>
        </div>
      ) : accusing ? (
        <div className="grid gap-3 rounded-xl border border-line bg-white p-5">
          <label className="grid gap-1.5"><span className="font-bold">What did the candidate get wrong?</span>
            <textarea value={claim} onChange={(e) => setClaim(e.target.value.slice(0, 1500))} rows={2} className="rounded-lg border border-line p-3 outline-none focus:border-violet" /></label>
          <label className="grid gap-1.5"><span className="font-bold">What's actually correct?</span>
            <textarea value={fix} onChange={(e) => setFix(e.target.value.slice(0, 1500))} rows={2} className="rounded-lg border border-line p-3 outline-none focus:border-violet" /></label>
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" disabled={claim.trim().length < 3 || busy} onClick={accuse}>{busy && <Loader2 size={17} className="animate-spin" aria-hidden />} Submit</button>
            <button className="btn-ghost" onClick={() => setAccusing(false)}>Keep questioning</button>
          </div>
        </div>
      ) : (
        <>
          <Composer onSend={send} busy={busy} placeholder="Ask the candidate a question" disabled={asked >= 10} />
          <button className="btn-violet justify-self-start" disabled={!history.length} onClick={() => setAccusing(true)}>I found the mistake</button>
        </>
      )}
      <div ref={end} />
    </div>
  );
}
