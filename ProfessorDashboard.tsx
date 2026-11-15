import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BadgeCheck, FileUp, Loader2, Play, QrCode } from "lucide-react";
import { api, tokens } from "../lib/api";
import AttemptSheet from "../components/AttemptSheet";
import Math from "../components/Math";
import { ErrorState, Loading } from "../components/States";
import { usePack } from "../components/usePack";
import type { TopicId } from "../lib/types";

export default function ProfessorDashboard() {
  const { pack, error, retry } = usePack();
  const [topic, setTopic] = useState<TopicId>("closed-interval");
  const [roundId, setRoundId] = useState<string>("int-demo-endpoints");
  const [minutes, setMinutes] = useState(3);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const navigate = useNavigate();

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!pack) return <Loading />;
  const rounds = pack.rounds.filter((r) => r.topic === topic);
  const round = rounds.find((r) => r.id === roundId) ?? rounds[0];
  const fix = round.fix_options.find((o) => o.id === round.correct_fix);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <h1 className="text-3xl font-bold sm:text-4xl">Prepare a class challenge</h1>
      <p className="mt-1 max-w-[40rem] text-navy-mute">
        {pack.subject}. Choose a topic and a verified round. You see the answer key here; students never do until the reveal.
      </p>

      <Link to="/create" className="mt-6 flex items-center justify-between gap-4 rounded-xl border-2 border-violet bg-white p-5 hover:bg-violet-wash/40">
        <span>
          <span className="block font-bold">Any subject: build rounds from your own course</span>
          <span className="block text-[15px] text-navy-soft">Upload notes, slides and past exams. You review and approve each round before it reaches your class.</span>
        </span>
        <FileUp size={22} className="shrink-0 text-violet-ink" aria-hidden />
      </Link>
      <h2 className="mt-10 text-xl font-bold">Calculus 1: mathematically verified pack</h2>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Topic">
        {pack.topics.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === topic}
            onClick={() => { setTopic(t.id); setRoundId(pack.rounds.find((r) => r.topic === t.id)!.id); }}
            className={`min-h-[44px] rounded-full px-4 font-bold ${t.id === topic ? "bg-navy text-white" : "border border-line bg-white text-navy-soft hover:border-navy-mute"}`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <ul className="grid content-start gap-2" aria-label="Rounds">
          {rounds.map((r, i) => (
            <li key={r.id}>
              <button
                onClick={() => setRoundId(r.id)}
                aria-current={r.id === round.id}
                className={`w-full rounded-xl border-2 bg-white px-4 py-3 text-left ${r.id === round.id ? "border-navy" : "border-transparent hover:border-line"}`}
              >
                <span className="block font-bold">
                  Round {i + 1}{r.id.startsWith("int-demo") && <span className="ml-2 text-sm text-violet-ink">demo</span>}
                </span>
                <span className="block text-[15px] text-navy-mute">
                  {r.is_fully_correct ? "No mistake" : pack.misconceptions[r.mistake_label!]}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="grid gap-5">
          <div className="rounded-xl border border-line bg-white p-5">
            <p className="text-[15px] text-navy-mute">{round.problem_statement.text} Difficulty {round.difficulty} of 3.</p>
            <Math tex={round.problem_statement.latex} block className="mt-1 text-left text-lg" />
          </div>
          <AttemptSheet round={round} mode="static" firstError={round.first_incorrect_step} />

          <section className="rounded-xl border border-line bg-white p-5" aria-labelledby="key-h">
            <h2 id="key-h" className="text-lg font-bold">Answer key</h2>
            {round.is_fully_correct ? (
              <p className="mt-2">There is no mistake. Teams score by choosing <b>No mistake</b>.</p>
            ) : (
              <dl className="mt-3 grid gap-3">
                <div><dt className="text-[15px] text-navy-mute">First error</dt><dd className="font-bold">Step {round.first_incorrect_step}</dd></div>
                <div><dt className="text-[15px] text-navy-mute">Correct fix</dt><dd>{fix && <Math tex={fix.latex} />}</dd></div>
                <div><dt className="text-[15px] text-navy-mute">Misconception</dt><dd className="font-bold">{pack.misconceptions[round.correct_why!]}</dd></div>
              </dl>
            )}
            <p className="mt-4"><b>Teaching point:</b> {round.key_lesson}</p>
            <p className="mt-4 flex items-start gap-1.5 text-sm text-navy-mute">
              <BadgeCheck size={16} className="mt-0.5 shrink-0 text-teal-ink" aria-hidden />
              {round.verification_status.claims_checked} claims verified with {round.verification_status.checker}. Source: hand-authored mistake template, pack v{round.pack_version}.
            </p>
          </section>

          <div className="flex flex-wrap items-start gap-3">
            <Link to={`/play/${round.id}`} className="btn-violet"><Play size={17} aria-hidden /> Try it as a student</Link>
            <label className="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-line bg-white px-4">
              <span className="text-[15px] text-navy-mute">Time</span>
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="bg-transparent font-bold outline-none">
                <option value={2}>2 min</option>
                <option value={3}>3 min</option>
                <option value={5}>5 min</option>
              </select>
            </label>
            <button
              className="btn-primary"
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                setCreateErr(null);
                try {
                  const r = await api.createRoom(round.id, minutes * 60);
                  tokens.set("host", r.code, { token: r.host_token });
                  navigate(`/host/${r.code}`);
                } catch (e) {
                  setCreateErr((e as Error).message);
                  setCreating(false);
                }
              }}
            >
              {creating ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <QrCode size={17} aria-hidden />} Create class session
            </button>
          </div>
          {createErr && <p className="rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{createErr}</p>}
        </div>
      </div>
    </div>
  );
}
