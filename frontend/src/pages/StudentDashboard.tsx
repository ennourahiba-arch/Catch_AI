import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package, Play, Users } from "lucide-react";
import { ErrorState, Loading } from "../components/States";
import { usePack } from "../components/usePack";
import { clearAll, getKV, listAttempts, setKV, type Attempt } from "../lib/storage";
import { missedMisconceptions, topicStats, topicsToRevisit } from "../lib/stats";

export default function StudentDashboard() {
  const { pack, error, retry } = usePack();
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [nickname, setNickname] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");

  const refresh = () => {
    listAttempts().then(setAttempts);
    getKV<string>("nickname").then((n) => setNickname(n ?? null));
  };
  useEffect(refresh, []);

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!pack || attempts === null || nickname === undefined) return <Loading label="Loading your progress" />;

  const stats = topicStats(attempts);
  const revisit = topicsToRevisit(attempts);
  const missed = missedMisconceptions(attempts).slice(0, 3);
  const lastTopic = attempts[0]?.topic ?? "closed-interval";
  const totalPts = attempts.reduce((a, b) => a + b.points, 0);
  const totalMax = attempts.reduce((a, b) => a + b.maxPoints, 0);
  const topicName = (id: string) => pack.topics.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      {nickname === null ? (
        <form
          className="max-w-lg"
          onSubmit={(e) => {
            e.preventDefault();
            const n = draft.trim().slice(0, 24);
            if (n) setKV("nickname", n).then(() => setNickname(n));
          }}
        >
          <h1 className="text-3xl font-bold">What should we call you?</h1>
          <p className="mt-1 text-navy-mute">Any nickname works. It's stored on this device only, with no account.</p>
          <div className="mt-4 flex gap-2">
            <label htmlFor="nick" className="sr-only">Nickname</label>
            <input
              id="nick"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={24}
              placeholder="e.g. Limit Breaker"
              className="min-h-[48px] flex-1 rounded-full border border-line bg-white px-5 outline-none focus:border-violet"
            />
            <button className="btn-primary" disabled={!draft.trim()}>Save</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">Hi, {nickname}</h1>
            <p className="mt-1 text-navy-mute">{pack.subject}. Pick up where you left off, or choose a topic.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to={`/practice/${lastTopic}`} className="btn-primary"><Play size={17} aria-hidden /> {attempts.length ? "Continue training" : "Start training"}</Link>
            <span className="inline-flex flex-col">
              <button className="btn-ghost" disabled aria-describedby="join-note"><Users size={17} aria-hidden /> Join class game</button>
              <span id="join-note" className="mt-1 text-center text-xs text-navy-mute">Live class games come in the next build</span>
            </span>
          </div>
        </div>
      )}

      <h2 className="mt-12 text-xl font-bold">Topics</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {pack.topics.map((t) => {
          const n = pack.rounds.filter((r) => r.topic === t.id).length;
          const st = stats[t.id];
          return (
            <Link key={t.id} to={`/practice/${t.id}`} className="group rounded-xl border border-line bg-white p-5 transition-colors hover:border-navy">
              <h3 className="text-lg font-bold">{t.name}</h3>
              <p className="mt-1 text-[15px] text-navy-mute">{n} verified rounds</p>
              {st ? (
                <>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper" aria-hidden>
                    <div className="h-full rounded-full bg-teal" style={{ width: `${Math.round((st.catches / st.played) * 100)}%` }} />
                  </div>
                  <p className="mt-2 text-[15px]">Caught {st.catches} of {st.played} played</p>
                </>
              ) : (
                <p className="mt-4 text-[15px] font-bold text-violet-ink group-hover:underline">Start this topic</p>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <h2 className="text-xl font-bold">Your progress</h2>
          {attempts.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-line bg-white p-6">
              <p className="font-bold">No rounds played yet.</p>
              <p className="mt-1 text-navy-mute">Finish a round and your score, catches and weak spots appear here. Everything stays on this device.</p>
            </div>
          ) : (
            <>
              <p className="mt-3">
                <span className="font-display text-3xl font-extrabold">{attempts.length}</span> rounds,{" "}
                <span className="font-display text-3xl font-extrabold">{totalMax ? Math.round((totalPts / totalMax) * 100) : 0}%</span> of available points
              </p>
              {(revisit.length > 0 || missed.length > 0) && (
                <div className="mt-6 rounded-xl bg-coral-wash p-5">
                  <h3 className="font-bold">Worth revisiting</h3>
                  {revisit.length > 0 && <p className="mt-1">Topics where you caught fewer than 60%: {revisit.map(topicName).join(", ")}.</p>}
                  {missed.length > 0 && (
                    <ul className="mt-2 list-disc pl-5">
                      {missed.map((m) => (
                        <li key={m.label}>{pack.misconceptions[m.label]} ({m.count} {m.count === 1 ? "round" : "rounds"} not fully solved)</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <h3 className="mt-6 font-bold">Recent rounds</h3>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-white">
                {attempts.slice(0, 6).map((a) => (
                  <li key={a.id ?? a.ts} className="flex items-center justify-between gap-3 px-4 py-3">
                    <Link to={`/play/${a.roundId}`} className="min-w-0 hover:underline">
                      <span className="block truncate">{topicName(a.topic)}</span>
                      <span className="text-sm text-navy-mute">{new Date(a.ts).toLocaleString()}</span>
                    </Link>
                    <span className={`shrink-0 font-display font-bold ${a.points === a.maxPoints ? "text-teal-ink" : a.points === 0 ? "text-coral-ink" : ""}`}>
                      {a.points}/{a.maxPoints}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <aside className="grid content-start gap-4">
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 font-bold"><Package size={18} aria-hidden /> Round pack</h2>
            <p className="mt-1 text-[15px] text-navy-soft">
              {pack.subject} v{pack.pack_version}, {pack.rounds.length} verified rounds, loaded from the server.
              Downloading packs for offline use comes with the Home Mode update.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-white p-5">
            <h2 className="font-bold">Coming in the Home Mode update</h2>
            <p className="mt-1 text-[15px] text-navy-soft">
              A confidence check before each topic, hints that unlock as you try, a fresh exam-style problem to solve yourself after
              every round, and a readiness score based on that independent work.
            </p>
          </div>
          <button
            className="btn-ghost justify-self-start"
            onClick={() => {
              if (confirm("Delete your nickname and all progress stored on this device?")) clearAll().then(refresh);
            }}
          >
            Reset progress on this device
          </button>
        </aside>
      </div>
    </div>
  );
}
