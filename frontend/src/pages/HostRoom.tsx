import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { ArrowRight, Check, Eye, Loader2, Lock, Play, Users } from "lucide-react";
import TeX from "../components/Math";
import RichText from "../components/RichText";
import { ErrorState, Loading } from "../components/States";
import { Bars, ConnBadge, LETTERS, OptionBody, SolutionPanel, Timer } from "../components/Live";
import { api, cleanCode, tokens, type QuizSummary, type RoomState } from "../lib/api";
import { useCountdown, useRoom } from "../lib/useRoom";

export default function HostRoom() {
  const code = cleanCode(useParams().code ?? "");
  const saved = tokens.get("host", code);
  if (!saved) return <ErrorState message="This screen belongs to the professor who created the quiz, on the device they created it from. Students join at the Join page instead." />;
  return <Host code={code} token={saved.token} />;
}

function Host({ code, token }: { code: string; token: string }) {
  const { state, error, conn, refresh, apply, serverNow } = useRoom(code, { host: token });
  const left = useCountdown(state?.status === "question" ? state.deadline_ms : null, serverNow, refresh);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (error && !state) return <ErrorState message={error.message} onRetry={error.status === 404 ? undefined : refresh} />;
  if (!state) return <Loading label="Opening the quiz" />;
  if (state.role !== "host") return <ErrorState message="This device doesn't hold the host key for this quiz." />;

  async function act(fn: () => Promise<RoomState>) {
    setBusy(true); setErr(null);
    try { apply(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const last = state.q_index + 1 >= state.total;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] text-navy-mute">{state.title}, room {state.code}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">
            {state.status === "lobby" ? "Teams are joining" : state.status === "finished" ? "Quiz summary" : `Question ${state.q_index + 1} of ${state.total}`}
          </h1>
        </div>
        <ConnBadge conn={conn} />
      </div>
      {err && <p className="mt-4 rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}

      {state.status === "lobby" && <Lobby state={state} busy={busy} onStart={() => act(() => api.start(code, token))} />}

      {(state.status === "question" || state.status === "reveal") && state.question && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid gap-4">
            <div className="rounded-xl border border-line bg-white p-5">
              <p className="text-xl font-bold"><RichText text={state.question.prompt} /></p>
              {state.question.latex && <TeX tex={state.question.latex} block className="mt-2 text-xl" />}
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {state.question.options.map((o, k) => {
                const right = state.status === "reveal" && state.result?.correct === k;
                return (
                  <li key={k} className={`flex items-start gap-3 rounded-xl border-2 p-4 text-lg ${right ? "border-teal bg-teal-wash" : "border-line bg-white"}`}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display font-bold ${right ? "bg-teal-ink text-white" : "bg-paper"}`}>{LETTERS[k]}</span>
                    <span className="min-w-0 pt-0.5"><OptionBody o={o} /></span>
                  </li>
                );
              })}
            </ul>
            {state.status === "reveal" && state.result && <SolutionPanel steps={state.result.solution} />}
          </div>

          <div className="grid gap-5 lg:sticky lg:top-24">
            {state.status === "question" ? (
              <>
                <div className="rounded-xl border border-line bg-white p-5 text-center">
                  <Timer left={left} big />
                  <p className="mt-2 text-lg"><b>{state.answered_count}</b> of {state.team_count} teams have answered</p>
                </div>
                <ul className="flex flex-wrap gap-2" aria-label="Teams">
                  {state.teams?.map((t) => (
                    <li key={t.name} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-bold ${t.answered ? "bg-teal-wash text-teal-ink" : "bg-white text-navy-mute ring-1 ring-line"}`}>
                      {t.answered && <Check size={15} aria-hidden />} {t.name}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-navy-mute">The answer stays hidden until you reveal it, so this screen is safe to project.</p>
                <button className="btn-ghost" disabled={busy} onClick={() => act(() => api.next(code, token))}><Eye size={17} aria-hidden /> Close and show the answer</button>
              </>
            ) : (
              <>
                <RevealStats state={state} />
                <button className="btn-primary" disabled={busy} onClick={() => act(() => api.next(code, token))}>
                  {last ? "Finish and show the summary" : "Next question"} <ArrowRight size={17} aria-hidden />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {state.status === "finished" && state.summary && <Finished state={state} summary={state.summary} token={token} />}
    </div>
  );
}

function Lobby({ state, busy, onStart }: { state: RoomState; busy: boolean; onStart: () => void }) {
  const url = `${window.location.origin}/join/${state.code}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 560, color: { dark: "#151631", light: "#FFFFFF" } }).then(setQr).catch(() => setQr(null));
  }, [url]);
  const n = state.team_count;
  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[auto_1fr] lg:items-start">
      <div className="rounded-xl border border-line bg-white p-5 text-center">
        {qr ? <img src={qr} alt={`QR code linking to ${url}`} className="mx-auto h-64 w-64 sm:h-72 sm:w-72" /> : <div className="mx-auto h-64 w-64 animate-pulse rounded bg-paper" />}
        <p className="mt-3 text-navy-mute">Scan, or go to</p>
        <p className="break-all font-bold">{window.location.host}/join</p>
        <p className="mt-3 text-navy-mute">and enter</p>
        <p className="font-display text-5xl font-extrabold tracking-[0.18em]">{state.code}</p>
      </div>
      <div>
        <p className="flex items-center gap-2 text-xl">
          <Users size={22} aria-hidden /> <span className="font-display text-4xl font-extrabold">{n}</span> {n === 1 ? "team" : "teams"} joined
        </p>
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Teams">
          {state.teams?.map((t) => <li key={t.name} className="rounded-full bg-white px-4 py-2 font-bold ring-1 ring-line">{t.name}</li>)}
          {n === 0 && <li className="text-navy-mute">Waiting for the first team. One phone per team is enough.</li>}
        </ul>
        <p className="mt-4 text-navy-soft">{state.total} {state.total === 1 ? "question" : "questions"}, {state.per_q_s} seconds each.</p>
        {n > 0 && n < 3 && (
          <p className="mt-2 max-w-[36rem] text-[15px] text-navy-mute">With fewer than 3 teams, answer breakdowns stay hidden so no team can be singled out.</p>
        )}
        <button className="btn-primary mt-6" disabled={n === 0 || busy} onClick={onStart}>
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Play size={17} aria-hidden />} Start the quiz
        </button>
      </div>
    </div>
  );
}

function RevealStats({ state }: { state: RoomState }) {
  const r = state.result!;
  if (r.locked) {
    return (
      <div className="rounded-xl border border-line bg-white p-5">
        <p className="flex items-center gap-2 font-bold"><Lock size={17} aria-hidden /> Breakdown hidden</p>
        <p className="mt-1 text-[15px] text-navy-soft">{r.answered} {r.answered === 1 ? "team" : "teams"} answered. Breakdowns appear when at least {r.min_teams} teams answer.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 rounded-xl border border-line bg-white p-5">
      <p><span className="font-display text-4xl font-extrabold">{r.pct_correct}%</span> <span className="text-navy-soft">of teams got it right</span></p>
      <Bars highlight={String(r.correct)} rows={(r.counts ?? []).map((c, k) => ({ key: String(k), count: c, label: <b>Option {LETTERS[k]}</b> }))} />
      {r.top_wrong && (
        <p className="rounded-lg bg-coral-wash px-4 py-3 text-[15px]">
          Most common wrong answer: <b>{LETTERS[r.top_wrong.option]}</b> ({r.top_wrong.count} {r.top_wrong.count === 1 ? "team" : "teams"})
          {r.top_wrong.label && <>. Usually a sign of: <b>{r.top_wrong.label.toLowerCase()}</b>.</>}
        </p>
      )}
    </div>
  );
}

function Finished({ state, summary, token }: { state: RoomState; summary: QuizSummary; token: string }) {
  const [sample, setSample] = useState<QuizSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const s = summary.locked ? sample : summary;
  return (
    <div className="mt-6 grid gap-6">
      {summary.locked && !sample && (
        <div className="max-w-2xl rounded-xl border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Lock size={18} aria-hidden /> Summary hidden for privacy</h2>
          <p className="mt-1 text-navy-soft">{summary.teams} {summary.teams === 1 ? "team" : "teams"} took part. The class summary appears when at least {summary.min_teams} teams play, so no single team can be identified.</p>
          <button className="btn-ghost mt-4" onClick={() => api.sample(state.code, token).then(setSample).catch((e) => setErr(e.message))}>Show sample data instead</button>
          {err && <p className="mt-2 text-coral-ink">{err}</p>}
        </div>
      )}
      {s && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
          <div className="grid gap-5">
            {s.sample && <p className="rounded-lg bg-violet-wash px-4 py-3 font-bold text-violet-ink" role="note">Sample data for demonstration. These are invented teams, not responses from this class.</p>}
            {s.insights && s.insights.length > 0 && (
              <section className="rounded-xl bg-navy p-5 text-white">
                <h2 className="text-lg font-bold text-white">What the class found hard</h2>
                <ul className="mt-2 grid gap-1.5 text-white/90">{s.insights.map((t) => <li key={t}>{t}</li>)}</ul>
              </section>
            )}
            <section className="rounded-xl border border-line bg-white p-5">
              <h2 className="text-lg font-bold">Right answers per question</h2>
              <div className="mt-3">
                <Bars rows={(s.questions ?? []).map((q) => ({ key: String(q.index), count: q.pct_correct ?? 0, label: <span>Q{q.index + 1} <span className="text-navy-mute">({q.pct_correct ?? 0}%)</span></span> }))} />
              </div>
            </section>
          </div>
          {s.scoreboard && (
            <section className="rounded-xl border border-line bg-white p-5">
              <h2 className="text-lg font-bold">Scores</h2>
              <ol className="mt-2 divide-y divide-line">
                {s.scoreboard.map((t, i) => (
                  <li key={t.name} className="flex justify-between py-2">
                    <span><span className="mr-3 font-display font-bold text-navy-mute">{i + 1}</span>{t.name}</span>
                    <span className="font-display font-bold">{t.score}/{s.total}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
      <Link to="/professor" className="btn-primary justify-self-start">Set up another quiz</Link>
    </div>
  );
}
