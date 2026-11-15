import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Check, Loader2, X } from "lucide-react";
import AttemptSheet from "../components/AttemptSheet";
import OptionList from "../components/OptionList";
import TeX from "../components/Math";
import RichText from "../components/RichText";
import { ErrorState, Loading } from "../components/States";
import { ConnBadge, SolutionPanel, Timer } from "../components/Live";
import { api, cleanCode, tokens, type RoomState } from "../lib/api";
import { useCountdown, useRoom } from "../lib/useRoom";

export default function TeamGame() {
  const code = cleanCode(useParams().code ?? "");
  const saved = tokens.get("team", code);
  if (!saved) return <Navigate to={`/join/${code}`} replace />;
  return <Game code={code} token={saved.token} />;
}

function Note({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex gap-2.5 rounded-xl px-4 py-3 ${ok ? "bg-teal-wash" : "bg-coral-wash"}`} role="status">
      {ok ? <Check size={20} className="mt-0.5 shrink-0 text-teal-ink" aria-hidden /> : <X size={20} className="mt-0.5 shrink-0 text-coral-ink" aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

function Game({ code, token }: { code: string; token: string }) {
  const { state, error, conn, refresh, apply, serverNow } = useRoom(code, { team: token });
  const left = useCountdown(state?.status === "running" ? state.deadline_ms : null, serverNow, refresh);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (error && !state) {
    if (error.status === 404) {
      tokens.clear("team", code);
      return <ErrorState message="This room doesn't exist any more. Ask your professor for the new code." />;
    }
    return <ErrorState message={error.message} onRetry={refresh} />;
  }
  if (!state) return <Loading label="Joining the room" />;
  if (!state.you) {
    tokens.clear("team", code);
    return <Navigate to={`/join/${code}`} replace />;
  }
  const you = state.you;

  async function send(phase: string, choice: string) {
    setBusy(true);
    setErr(null);
    try {
      apply(await api.submit(code, token, phase, choice));
      setPick(null);
    } catch (e) {
      setErr((e as Error).message);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <div>
        <p className="text-sm text-navy-mute">Room {state.code}</p>
        <p className="font-display text-xl font-bold">{you.name}</p>
      </div>
      <div className="flex items-center gap-4">
        <ConnBadge conn={conn} />
        {state.status === "running" && <Timer left={left} />}
      </div>
    </div>
  );

  if (state.status === "lobby") {
    return (
      <Shell>
        {header}
        <div className="py-16 text-center">
          <Loader2 className="mx-auto animate-spin text-violet" size={28} aria-hidden />
          <h1 className="mt-4 text-2xl font-bold">You're in. Waiting for the professor to start.</h1>
          <p className="mt-2 text-navy-mute">{state.team_count} {state.team_count === 1 ? "team has" : "teams have"} joined. You'll have {Math.round(state.duration_s / 60)} minutes once it starts.</p>
        </div>
      </Shell>
    );
  }

  if (state.status === "finished") return <Shell>{header}<TeamReveal state={state} /></Shell>;

  const opts = you.options;
  const c = you.subs.catch;
  return (
    <Shell>
      {header}
      <div className="mt-5">
        <p className="text-[15px] text-navy-mute">{state.topic_name}</p>
        <h1 className="text-xl font-bold"><RichText text={state.round.problem_statement.text} /></h1>
        {state.round.problem_statement.latex && <TeX tex={state.round.problem_statement.latex} block className="mt-1 text-lg" />}
      </div>
      <div className="mt-4">
        <AttemptSheet
          round={state.round}
          mode={you.phase === "catch" ? "select" : "review"}
          selected={pick && you.phase === "catch" ? (pick === "none" ? "none" : Number(pick)) : null}
          onSelect={(n) => setPick(String(n))}
          firstError={you.phase !== "catch" ? opts?.first_incorrect_step ?? null : null}
          picked={c ? (c.choice === "none" ? "none" : Number(c.choice)) : null}
          compact
        />
      </div>

      <div className="mt-5 grid gap-4">
        {err && <p className="rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}

        {you.phase === "catch" && (
          <>
            <h2 className="text-xl font-bold">Which step is the first one that's wrong?</h2>
            <button
              type="button"
              aria-pressed={pick === "none"}
              onClick={() => setPick("none")}
              className={`min-h-[52px] rounded-xl border-2 bg-white px-4 py-3 text-left font-bold ${pick === "none" ? "border-teal bg-teal-wash" : "border-line"}`}
            >
              No mistake. The AI got it right.
            </button>
            <button className="btn-primary" disabled={!pick || busy} onClick={() => send("catch", pick!)}>
              {busy && <Loader2 size={17} className="animate-spin" aria-hidden />}
              {!pick ? "Pick a step first" : pick === "none" ? "Lock in: no mistake" : `Lock in step ${pick}`}
            </button>
          </>
        )}

        {you.phase === "fix" && opts && (
          <>
            <Note ok={!!c?.correct}>
              {c?.correct ? <><b>Caught it.</b> Step {opts.first_incorrect_step} is the first error.</>
                : <><b>Not quite.</b> The first error is step {opts.first_incorrect_step}. Finish for practice; points need the catch.</>}
            </Note>
            <h2 className="text-xl font-bold">Fix step {opts.first_incorrect_step}</h2>
            <OptionList legend="Replacement line" options={opts.fix_options} selected={pick} onSelect={setPick} />
            <button className="btn-primary" disabled={!pick || busy} onClick={() => send("fix", pick!)}>Lock in fix</button>
          </>
        )}

        {you.phase === "explain" && opts && (
          <>
            <h2 className="text-xl font-bold">Why did the AI go wrong?</h2>
            <OptionList legend="Reason" options={opts.why_options} selected={pick} onSelect={setPick} />
            <button className="btn-primary" disabled={!pick || busy} onClick={() => send("explain", pick!)}>Lock in explanation</button>
          </>
        )}

        {you.phase === "done" && (
          <div className="rounded-xl bg-navy px-5 py-5 text-white">
            <p className="font-display text-xl font-bold text-white">Answers locked in.</p>
            <p className="mt-1 text-white/80">The full solution appears on your phone when the professor reveals it or time runs out.</p>
          </div>
        )}
      </div>
    </Shell>
  );
}

function TeamReveal({ state }: { state: RoomState }) {
  const you = state.you!;
  const rv = state.reveal!;
  const answered = !!you.subs.catch;
  return (
    <div className="mt-5 grid gap-4">
      <div className="flex items-end justify-between rounded-xl bg-navy px-5 py-4 text-white">
        <div>
          <p className="text-white/70">Your team scored</p>
          <p className="font-display text-4xl font-extrabold">{you.points}<span className="text-xl text-white/60"> / {you.max_points}</span></p>
        </div>
        {!answered && <p className="max-w-[12rem] text-right text-white/80">Time ran out before your team answered.</p>}
      </div>
      <AttemptSheet round={state.round} mode="review" firstError={rv.first_incorrect_step}
        picked={you.subs.catch ? (you.subs.catch.choice === "none" ? "none" : Number(you.subs.catch.choice)) : null} compact />
      {rv.is_fully_correct ? (
        <Note ok={!!you.subs.catch?.correct}><b>There was no mistake.</b> Every step was correct.</Note>
      ) : (
        <>
          <Note ok={!!you.subs.fix?.correct}><b>Correct fix:</b><div className="mt-1">{rv.correct_fix_latex ? <TeX tex={rv.correct_fix_latex} /> : <RichText text={rv.correct_fix_text ?? ""} />}</div></Note>
          <Note ok={!!you.subs.explain?.correct}><b>Why:</b> {rv.correct_why_label}.</Note>
        </>
      )}
      <SolutionPanel reveal={rv} />
      <Link to="/student" className="btn-ghost">Back to my dashboard</Link>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 pb-24 pt-5">{children}</div>;
}
