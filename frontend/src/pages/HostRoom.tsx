import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { Check, Eye, Loader2, Lock, Play, Users } from "lucide-react";
import AttemptSheet from "../components/AttemptSheet";
import TeX from "../components/Math";
import RichText from "../components/RichText";
import { ErrorState, Loading } from "../components/States";
import { Bars, ConnBadge, SolutionPanel, Timer } from "../components/Live";
import { api, cleanCode, tokens, type Results, type RoomState } from "../lib/api";
import { useCountdown, useRoom } from "../lib/useRoom";

export default function HostRoom() {
  const code = cleanCode(useParams().code ?? "");
  const saved = tokens.get("host", code);
  if (!saved) {
    return (
      <ErrorState message="This screen belongs to the professor who created the room, on the device they created it from. Students join at the Join page instead." />
    );
  }
  return <Host code={code} token={saved.token} />;
}

function Host({ code, token }: { code: string; token: string }) {
  const { state, error, conn, refresh, apply, serverNow } = useRoom(code, { host: token });
  const left = useCountdown(state?.status === "running" ? state.deadline_ms : null, serverNow, refresh);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (error && !state) return <ErrorState message={error.message} onRetry={error.status === 404 ? undefined : refresh} />;
  if (!state) return <Loading label="Opening the room" />;
  if (state.role !== "host") return <ErrorState message="This device doesn't hold the host key for this room." />;

  async function act(fn: () => Promise<RoomState>) {
    setBusy(true);
    setErr(null);
    try { apply(await fn()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] text-navy-mute">{state.topic_name}, room {state.code}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">
            {state.status === "lobby" ? "Teams are joining" : state.status === "running" ? "Challenge in progress" : "Results"}
          </h1>
        </div>
        <ConnBadge conn={conn} />
      </div>
      {err && <p className="mt-4 rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}

      {state.status === "lobby" && <Lobby state={state} busy={busy} onStart={() => act(() => api.start(code, token))} />}
      {state.status === "running" && <Running state={state} left={left} busy={busy} onReveal={() => act(() => api.reveal(code, token))} />}
      {state.status === "finished" && <Finished state={state} />}
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
        {n > 0 && n < 3 && (
          <p className="mt-4 max-w-[36rem] text-[15px] text-navy-mute">
            With fewer than 3 teams, the answer breakdown stays hidden after the round so no team can be singled out. You can still show clearly labelled sample data.
          </p>
        )}
        <button className="btn-primary mt-6" disabled={n === 0 || busy} onClick={onStart}>
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Play size={17} aria-hidden />}
          Start the {Math.round(state.duration_s / 60)}-minute challenge
        </button>
      </div>
    </div>
  );
}

function Running({ state, left, busy, onReveal }: { state: RoomState; left: number | null; busy: boolean; onReveal: () => void }) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
      <div>
        <p className={state.round.problem_statement.latex ? "text-[15px] text-navy-mute" : "text-xl font-bold"}><RichText text={state.round.problem_statement.text} /></p>
        {state.round.problem_statement.latex && <TeX tex={state.round.problem_statement.latex} block className="text-xl" />}
        <div className="mt-4"><AttemptSheet round={state.round} mode="static" firstError={null} /></div>
      </div>
      <div className="grid gap-5 lg:sticky lg:top-24">
        <div className="rounded-xl border border-line bg-white p-5 text-center">
          <Timer left={left} big />
          <p className="mt-2 text-lg"><b>{state.submitted_count}</b> of {state.team_count} teams have answered</p>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Team progress">
          {state.teams?.map((t) => (
            <li key={t.name} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-bold ${t.done ? "bg-teal-wash text-teal-ink" : t.submitted ? "bg-violet-wash text-violet-ink" : "bg-white text-navy-mute ring-1 ring-line"}`}>
              {t.done && <Check size={15} aria-hidden />} {t.name}
            </li>
          ))}
        </ul>
        <p className="text-sm text-navy-mute">Answers stay hidden on this screen until the reveal, so it's safe to project.</p>
        <button className="btn-ghost" disabled={busy} onClick={onReveal}><Eye size={17} aria-hidden /> End now and reveal</button>
      </div>
    </div>
  );
}

function Finished({ state }: { state: RoomState }) {
  const rv = state.reveal!;
  const real = state.results!;
  const [sample, setSample] = useState<Results | null>(null);
  const [sampleErr, setSampleErr] = useState<string | null>(null);
  const res = real.locked ? sample : real;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
      <div className="grid gap-5">
        {real.locked && !sample && (
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg font-bold"><Lock size={18} aria-hidden /> Breakdown hidden for privacy</h2>
            <p className="mt-1 text-navy-soft">
              {real.teams_submitted} {real.teams_submitted === 1 ? "team" : "teams"} answered. Response breakdowns appear only when at least {real.min_teams} teams have answered, so no single team can be identified.
            </p>
            <button className="btn-ghost mt-4" onClick={() => api.roomSample(state.code, tokens.get("host", state.code)?.token ?? "").then(setSample).catch((e) => setSampleErr(e.message))}>
              Show sample data instead
            </button>
            {sampleErr && <p className="mt-2 text-coral-ink">{sampleErr}</p>}
          </div>
        )}
        {res && <ResultsView res={res} state={state} />}
      </div>
      <div className="grid gap-5">
        <AttemptSheet round={state.round} mode="review" firstError={rv.first_incorrect_step} compact />
        <SolutionPanel reveal={rv} />
        <Link to="/professor" className="btn-primary">Set up another round</Link>
      </div>
    </div>
  );
}

function Stat({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="font-display text-4xl font-extrabold">{pct}%</p>
      <p className="text-[15px] text-navy-soft">{label}</p>
    </div>
  );
}

function ResultsView({ res, state }: { res: Results; state: RoomState }) {
  const rv = state.reveal!;
  const steps = Object.entries(res.catch_counts ?? {}).map(([k, count]) => ({
    key: k, count, label: k === "none" ? "No mistake" : `Step ${k}`,
  }));
  const right = rv.is_fully_correct ? "none" : String(rv.first_incorrect_step);
  return (
    <>
      {res.sample && (
        <p className="rounded-lg bg-violet-wash px-4 py-3 font-bold text-violet-ink" role="note">
          Sample data for demonstration. These are invented teams, not responses from this class.
        </p>
      )}
      <div className={`grid gap-3 ${rv.is_fully_correct ? "grid-cols-1" : "sm:grid-cols-3"}`}>
        <Stat pct={res.pct_caught ?? 0} label={rv.is_fully_correct ? "said there was no mistake" : `found the first mistake (step ${rv.first_incorrect_step})`} />
        {!rv.is_fully_correct && <Stat pct={res.pct_fix ?? 0} label="chose the correct fix" />}
        {!rv.is_fully_correct && <Stat pct={res.pct_why ?? 0} label="named the right reason" />}
      </div>
      {res.insights && res.insights.length > 0 && (
        <section className="rounded-xl bg-navy p-5 text-white">
          <h2 className="text-lg font-bold text-white">What the room thought</h2>
          <ul className="mt-2 grid gap-1.5 text-white/90">{res.insights.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      )}
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-lg font-bold">Which step teams flagged</h2>
        <div className="mt-3"><Bars rows={steps} highlight={right} /></div>
      </section>
      {!rv.is_fully_correct && res.why_counts && (
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-lg font-bold">Reasons teams gave</h2>
          <div className="mt-3"><Bars rows={res.why_counts.map((w) => ({ key: w.id, label: w.label, count: w.count }))} highlight={rv.correct_why} /></div>
        </section>
      )}
      {res.scoreboard && (
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-lg font-bold">Scores</h2>
          <ol className="mt-2 divide-y divide-line">
            {res.scoreboard.map((t, i) => (
              <li key={t.name} className="flex justify-between py-2">
                <span><span className="mr-3 font-display font-bold text-navy-mute">{i + 1}</span>{t.name}</span>
                <span className="font-display font-bold">{t.points}/{res.max_points}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
