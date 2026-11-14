import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Lightbulb, RotateCcw, X } from "lucide-react";
import AttemptSheet from "../components/AttemptSheet";
import OptionList from "../components/OptionList";
import TeX from "../components/Math";
import { ErrorState, Loading } from "../components/States";
import { usePack } from "../components/usePack";
import {
  MAX_CATCH_ATTEMPTS, hintsAvailable, initialState, maxPoints, score, scoreHome,
  submitCatch, submitCatchHome, submitFix, submitWhy, type CatchChoice, type Phase, type RoundState,
} from "../lib/round";
import { addAttempt } from "../lib/storage";
import type { Pack, Round } from "../lib/types";

const PHASES: { id: Phase; label: string }[] = [
  { id: "catch", label: "Catch" },
  { id: "fix", label: "Fix" },
  { id: "explain", label: "Explain" },
];

/** Quick play: /play/:roundId. One-shot answers, like class mode. */
export default function Play() {
  const { roundId } = useParams();
  const navigate = useNavigate();
  const { pack, error, retry } = usePack();
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!pack) return <Loading />;
  const round = pack.rounds.find((r) => r.id === roundId);
  if (!round) return <ErrorState message={`There is no round called "${roundId}" in pack ${pack.pack_version}.`} />;
  const same = pack.rounds.filter((r) => r.topic === round.topic);
  const next = same[(same.findIndex((r) => r.id === round.id) + 1) % same.length];
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6">
      <RoundPlayer key={round.id} pack={pack} round={round} mode="quick" onNext={() => navigate(`/play/${next.id}`)} />
    </div>
  );
}

export function Stepper({ phase, fullyCorrect }: { phase: Phase; fullyCorrect: boolean }) {
  const order = ["catch", "fix", "explain", "reveal"];
  const cur = order.indexOf(phase);
  const shown = fullyCorrect && phase === "reveal" ? PHASES.slice(0, 1) : PHASES;
  return (
    <ol className="flex items-center gap-2 text-[15px]" aria-label="Round progress">
      {shown.map((p, i) => {
        const idx = order.indexOf(p.id);
        const state = idx < cur ? "done" : idx === cur ? "now" : "next";
        return (
          <li key={p.id} className="flex items-center gap-2" aria-current={state === "now" ? "step" : undefined}>
            {i > 0 && <span className="h-px w-5 bg-line" aria-hidden />}
            <span className={`flex h-7 w-7 items-center justify-center rounded-full font-display font-bold
              ${state === "done" ? "bg-teal text-navy" : state === "now" ? "bg-navy text-white" : "bg-white text-navy-mute ring-1 ring-line"}`}>
              {state === "done" ? <Check size={15} strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            <span className={state === "now" ? "font-bold" : "text-navy-mute"}>{p.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Feedback({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex gap-2.5 rounded-xl px-4 py-3 ${ok ? "bg-teal-wash text-teal-ink" : "bg-coral-wash text-coral-ink"}`} role="status">
      {ok ? <Check size={20} className="mt-0.5 shrink-0" aria-hidden /> : <X size={20} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 text-navy">{children}</div>
    </div>
  );
}

interface PlayerProps {
  pack: Pack;
  round: Round;
  mode: "quick" | "home";
  /** quick: go to the next round. home: continue to Your Turn. */
  onNext: () => void;
  backTo?: string;
}

export function RoundPlayer({ pack, round, mode, onNext, backTo = "/student" }: PlayerProps) {
  const home = mode === "home";
  const [s, setS] = useState<RoundState>(initialState);
  const [catchPick, setCatchPick] = useState<CatchChoice | null>(null);
  const [fixPick, setFixPick] = useState<string | null>(null);
  const [whyPick, setWhyPick] = useState<string | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [saveError, setSaveError] = useState(false);
  const saved = useRef(false);
  const topicName = pack.topics.find((t) => t.id === round.topic)?.name ?? round.topic;
  const points = home ? scoreHome(round, s, pack.scoring) : score(round, s, pack.scoring);
  const max = maxPoints(round, pack.scoring);
  const unlocked = hintsAvailable(s);

  useEffect(() => {
    if (s.phase !== "reveal" || saved.current) return;
    saved.current = true;
    addAttempt({
      roundId: round.id, topic: round.topic, ts: Date.now(),
      catchCorrect: !!s.catchCorrect, fixCorrect: s.fixCorrect, whyCorrect: s.whyCorrect,
      points, maxPoints: max, mistakeLabel: round.mistake_label,
      mode, catchAttempts: s.catchAttempts, hintsUsed: hintsShown,
    }).catch(() => setSaveError(true));
  }, [s, round, points, max, mode, hintsShown]);

  const firstErr = round.first_incorrect_step;
  const lastWrong = s.wrongPicks[s.wrongPicks.length - 1];

  const lockCatch = () => {
    const next = home ? submitCatchHome(round, s, catchPick!) : submitCatch(round, s, catchPick!);
    setS(next);
    setCatchPick(null);
  };

  const catchFeedback = () => {
    if (s.catchCorrect) {
      const tries = home && s.catchAttempts > 1 ? ` on attempt ${s.catchAttempts}` : "";
      return round.is_fully_correct
        ? <><b>Right call{tries}.</b> Every step checks out, and the AI earned this one.</>
        : <><b>Caught it{tries}.</b> Step {firstErr} is the first place the reasoning breaks.</>;
    }
    if (round.is_fully_correct) return <><b>Not this time.</b> There was no mistake. Every step was verified correct.</>;
    if (home) return <><b>Out of attempts.</b> The first error is step {firstErr}. Fix it anyway: practice counts even without points.</>;
    if (s.catchChoice === "none") return <><b>There is a mistake.</b> The first one is in step {firstErr}. Fix it anyway: it still counts for practice, but not for points.</>;
    return <><b>Not that one.</b> Step {s.catchChoice} is valid. The first error is step {firstErr}. Keep going for practice; points need the catch.</>;
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link to={backTo} className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy">
          <ArrowLeft size={16} aria-hidden /> Dashboard
        </Link>
        <Stepper phase={s.phase} fullyCorrect={round.is_fully_correct} />
      </div>

      <div className="mt-6">
        <p className="text-[15px] text-navy-mute">{topicName}, difficulty {round.difficulty} of 3</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{round.problem_statement.text}</h1>
        <TeX tex={round.problem_statement.latex} block className="mt-2 text-xl" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
        <AttemptSheet
          round={round}
          mode={s.phase === "catch" ? "select" : "review"}
          selected={catchPick}
          onSelect={(n) => setCatchPick(n)}
          firstError={s.phase === "catch" ? null : firstErr}
          picked={s.catchChoice}
          ruledOut={s.wrongPicks}
        />

        <div className="lg:sticky lg:top-24">
          <AnimatePresence mode="wait">
            <motion.div key={s.phase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="grid gap-4">
              {s.phase === "catch" && (
                <>
                  {home && lastWrong !== undefined && (
                    <Feedback ok={false}>
                      {lastWrong === "none"
                        ? <><b>There is a mistake somewhere.</b> Look again.</>
                        : <><b>Step {lastWrong} checks out.</b> The first error is somewhere else.</>}
                      {" "}{MAX_CATCH_ATTEMPTS - s.catchAttempts} {MAX_CATCH_ATTEMPTS - s.catchAttempts === 1 ? "attempt" : "attempts"} left.
                    </Feedback>
                  )}
                  <h2 className="text-xl font-bold">Which step is the first one that's wrong?</h2>
                  <p className="text-navy-mute">Tap a step on the AI's paper. Later steps can be wrong only because an earlier one was, so look for the first. If everything checks out, say so.</p>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={catchPick === "none"}
                    disabled={s.wrongPicks.includes("none")}
                    onClick={() => setCatchPick("none")}
                    className={`min-h-[52px] rounded-xl border-2 bg-white px-4 py-3 text-left font-bold transition-colors disabled:opacity-50 ${catchPick === "none" ? "border-teal bg-teal-wash" : "border-line hover:border-navy-mute"}`}
                  >
                    No mistake. The AI got it right.
                  </button>
                  <button className="btn-primary" disabled={catchPick === null} onClick={lockCatch}>
                    {catchPick === null ? "Pick a step first" : catchPick === "none" ? "Lock in: no mistake" : `Lock in step ${catchPick}`}
                  </button>
                  {home && <Hints hints={round.hint_ladder} shown={hintsShown} unlocked={unlocked} onShow={() => setHintsShown((h) => Math.min(unlocked, h + 1))} />}
                </>
              )}

              {s.phase === "fix" && round.corrected_step && (
                <>
                  <Feedback ok={!!s.catchCorrect}>{catchFeedback()}</Feedback>
                  <h2 className="text-xl font-bold">Fix step {firstErr}</h2>
                  <p className="text-navy-mute">Which line should replace it?</p>
                  <OptionList legend={`Replacement for step ${firstErr}`} options={round.fix_options} selected={fixPick} onSelect={setFixPick} />
                  <button className="btn-primary" disabled={!fixPick} onClick={() => setS(submitFix(round, s, fixPick!))}>Lock in fix</button>
                </>
              )}

              {s.phase === "explain" && (
                <>
                  <Feedback ok={!!s.fixCorrect}>
                    {s.fixCorrect ? <><b>That's the correct line.</b> One more question.</> : <><b>Not quite.</b> You'll see the correct line at the end.</>}
                  </Feedback>
                  <h2 className="text-xl font-bold">Why did the AI go wrong?</h2>
                  <OptionList legend="Reason for the mistake" options={round.why_options} selected={whyPick} onSelect={setWhyPick} />
                  <button className="btn-primary" disabled={!whyPick} onClick={() => setS(submitWhy(round, s, whyPick!))}>Lock in explanation</button>
                </>
              )}

              {s.phase === "reveal" && (
                <Reveal pack={pack} round={round} s={s} points={points} max={max} saveError={saveError} catchFeedback={catchFeedback()}>
                  {home ? (
                    <button className="btn-violet" onClick={onNext}>Your turn: solve one yourself <ArrowRight size={17} aria-hidden /></button>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <button className="btn-primary flex-1" onClick={onNext}>Next round</button>
                      <button className="btn-ghost" onClick={() => { setS(initialState); setCatchPick(null); setFixPick(null); setWhyPick(null); setHintsShown(0); saved.current = false; }}>
                        <RotateCcw size={16} aria-hidden /> Replay
                      </button>
                    </div>
                  )}
                </Reveal>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

export function Hints({ hints, shown, unlocked, onShow }: { hints: string[]; shown: number; unlocked: number; onShow: () => void }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4" aria-label="Hints">
      {shown > 0 && (
        <ol className="grid gap-2">
          {hints.slice(0, shown).map((h, i) => (
            <li key={i} className="flex gap-2">
              <Lightbulb size={18} className="mt-0.5 shrink-0 text-violet-ink" aria-hidden />
              <span><b>Hint {i + 1}.</b> {h}</span>
            </li>
          ))}
        </ol>
      )}
      {shown < hints.length && (
        shown < unlocked ? (
          <button className={`font-bold text-violet-ink underline decoration-2 underline-offset-4 ${shown > 0 ? "mt-3" : ""}`} onClick={onShow}>
            {shown === 0 ? "Need a hint?" : `Show hint ${shown + 1}`}
          </button>
        ) : (
          <p className={`text-[15px] text-navy-mute ${shown > 0 ? "mt-3" : ""}`}>Hint {shown + 1} unlocks after your next attempt.</p>
        )
      )}
    </section>
  );
}

function Reveal({ pack, round, s, points, max, saveError, catchFeedback, children }: {
  pack: Pack; round: Round; s: RoundState; points: number; max: number; saveError: boolean;
  catchFeedback: React.ReactNode; children: React.ReactNode;
}) {
  const correctFix = useMemo(() => round.fix_options.find((o) => o.id === round.correct_fix), [round]);
  return (
    <>
      <div className="flex items-end justify-between gap-4 rounded-xl bg-navy px-5 py-4 text-white">
        <div>
          <p className="text-white/70">Round score</p>
          <p className="font-display text-4xl font-extrabold">{points}<span className="text-xl text-white/60"> / {max}</span></p>
        </div>
        <p className="max-w-[14rem] text-right text-[15px] text-white/80">
          {points === max ? "Full marks. You out-checked the AI." : "Read the verified solution below."}
        </p>
      </div>
      <Feedback ok={!!s.catchCorrect}>{catchFeedback}</Feedback>
      {!round.is_fully_correct && (
        <>
          <Feedback ok={!!s.fixCorrect}>
            <b>Fix:</b> {s.fixCorrect ? "correct." : "the right replacement was"}
            {correctFix && <div className="mt-1"><TeX tex={correctFix.latex} /></div>}
          </Feedback>
          <Feedback ok={!!s.whyCorrect}><b>Why:</b> {pack.misconceptions[round.correct_why!]}.</Feedback>
        </>
      )}
      <section className="rounded-xl border border-line bg-white p-5" aria-labelledby="sol-h">
        <h3 id="sol-h" className="text-lg font-bold">Verified solution</h3>
        <ol className="mt-3 grid gap-3">
          {round.correct_solution.map((st, i) => (
            <li key={i} className="flex gap-3">
              <span className="font-display font-bold text-teal-ink">{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-[15px] text-navy-soft">{st.text}</span>
                <TeX tex={st.latex} />
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-lg bg-teal-wash px-4 py-3">
          <p className="text-[15px] font-bold text-teal-ink">Answer</p>
          <TeX tex={round.verified_answer.latex} />
        </div>
        <p className="mt-4"><b>Remember:</b> {round.key_lesson}</p>
        <p className="mt-4 flex items-start gap-1.5 text-sm text-navy-mute">
          <BadgeCheck size={16} className="mt-0.5 shrink-0 text-teal-ink" aria-hidden />
          Every claim in this round ({round.verification_status.claims_checked} in total) was checked symbolically with {round.verification_status.checker} before the pack was published. The attempt was written from a hand-authored mistake template, not generated live by an AI.
        </p>
      </section>
      {saveError && <p className="text-sm text-coral-ink">This result couldn't be saved on this device, so it won't appear in your progress.</p>}
      {children}
    </>
  );
}
