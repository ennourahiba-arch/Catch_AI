import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, MessagesSquare, Play, QrCode, Trash2, UserRound } from "lucide-react";
import AttemptSheet from "../components/AttemptSheet";
import RichText from "../components/RichText";
import { ErrorState, Loading } from "../components/States";
import { api, tokens } from "../lib/api";
import { deletePack, getPack, savePack } from "../lib/storage";
import type { CustomPack } from "../lib/types";
import { TrainCustom } from "./Train";
import Oral from "./Oral";

/** Loads a pack from this device's storage. */
export function usePackFromDevice(id: string) {
  const [pack, setPack] = useState<CustomPack | null | undefined>(undefined);
  const reload = useCallback(() => { getPack(id).then((p) => setPack(p ?? null)); }, [id]);
  useEffect(reload, [reload]);
  return { pack, setPack };
}

function Missing() {
  return <ErrorState message="This pack isn't on this device. Packs made from uploaded material are stored only in the browser that created them." />;
}

export function PackTrain() {
  const { pack } = usePackFromDevice(useParams().packId ?? "");
  if (pack === undefined) return <Loading />;
  if (!pack || !pack.rounds.length) return <Missing />;
  return <TrainCustom custom={pack} />;
}

export function PackOral() {
  const params = useParams();
  const { pack } = usePackFromDevice(params.packId ?? "");
  if (pack === undefined) return <Loading />;
  if (!pack?.oral) return <Missing />;
  return <Oral pack={pack} mode={params.mode === "candidate" ? "candidate" : "examiner"} />;
}

export default function MyPack() {
  const id = useParams().packId ?? "";
  const navigate = useNavigate();
  const truncated = (useLocation().state as { truncated?: boolean } | null)?.truncated;
  const { pack, setPack } = usePackFromDevice(id);
  const [open, setOpen] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(3);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (pack === undefined) return <Loading />;
  if (!pack) return <Missing />;

  const approved = new Set(pack.approved ?? []);
  const toggle = async (rid: string) => {
    const next = { ...pack, approved: approved.has(rid) ? [...approved].filter((x) => x !== rid) : [...approved, rid] };
    await savePack(next);
    setPack(next);
  };
  const startClass = async (rid: string) => {
    const r = pack.rounds.find((x) => x.id === rid)!;
    setBusy(rid); setErr(null);
    try {
      const res = await api.createCustomRoom(r, minutes * 60);
      tokens.set("host", res.code, { token: res.host_token });
      navigate(`/host/${res.code}`);
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-6">
      <Link to="/student" className="inline-flex items-center gap-1.5 text-[15px] font-bold text-navy-mute hover:text-navy"><ArrowLeft size={16} aria-hidden /> Dashboard</Link>
      <h1 className="mt-4 text-3xl font-bold sm:text-4xl">{pack.title}</h1>
      <p className="mt-1 text-navy-mute">
        {pack.format === "quiz" ? "Quiz" : pack.format === "written" ? "Written exam" : "Oral exam"} from {pack.sources.join(", ")}.
        Saved only on this device.
      </p>
      {pack.generator.test_mode && <p className="mt-3 rounded-lg bg-coral-wash px-4 py-3 font-bold text-coral-ink">Test mode: made by a simulated AI, so the content is placeholder text.</p>}
      {truncated && <p className="mt-3 rounded-lg bg-paper px-4 py-3 ring-1 ring-line">Your files were long, so only the first part of the material was used. Upload fewer chapters at a time to cover the rest.</p>}
      {pack.dropped.length > 0 && (
        <p className="mt-3 text-[15px] text-navy-soft">
          {pack.dropped.length} generated {pack.dropped.length === 1 ? "item was" : "items were"} thrown out because {pack.dropped.length === 1 ? "it" : "they"} didn't pass the checks against your document.
        </p>
      )}

      {pack.format !== "oral" ? (
        <>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={`/mine/${pack.id}/train`} className="btn-primary"><Play size={17} aria-hidden /> Train on this pack</Link>
          </div>
          <p className="mt-2 text-[15px] text-navy-mute">{pack.rounds.length} rounds and {pack.exercises.length} practice questions.</p>

          <section className="mt-10">
            <h2 className="text-xl font-bold">Use a round in class</h2>
            <p className="mt-1 max-w-[46rem] text-navy-soft">
              Professors: open a round, read it and its answer key, and approve it before using it in a class game. The AI's work was checked against your document, but you know your course best.
            </p>
            <label className="mt-3 inline-flex items-center gap-2"><span className="text-navy-mute">Time</span>
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="min-h-[40px] rounded-lg border border-line bg-white px-2 font-bold">
                <option value={2}>2 min</option><option value={3}>3 min</option><option value={5}>5 min</option>
              </select>
            </label>
            {err && <p className="mt-3 rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}
            <ul className="mt-4 grid gap-3">
              {pack.rounds.map((r, i) => (
                <li key={r.id} className="rounded-xl border border-line bg-white">
                  <button className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <span className="min-w-0">
                      <span className="block font-bold">Round {i + 1}{approved.has(r.id) && <span className="ml-2 text-sm text-teal-ink">approved</span>}</span>
                      <span className="block truncate text-[15px] text-navy-mute">{r.is_fully_correct ? "No mistake" : pack.misconceptions[r.correct_why ?? ""]}</span>
                    </span>
                    <span className="text-sm font-bold text-violet-ink">{open === r.id ? "Close" : "Review"}</span>
                  </button>
                  {open === r.id && (
                    <div className="grid gap-4 border-t border-line p-5">
                      <p className="font-bold"><RichText text={r.problem_statement.text} /></p>
                      <AttemptSheet round={r} mode="static" firstError={r.first_incorrect_step} compact />
                      <dl className="grid gap-2 text-[15px]">
                        <div><dt className="text-navy-mute">Answer key</dt><dd><RichText text={r.verified_answer.text ?? ""} /></dd></div>
                        {!r.is_fully_correct && <div><dt className="text-navy-mute">Misconception</dt><dd>{pack.misconceptions[r.correct_why ?? ""]}</dd></div>}
                      </dl>
                      <div className="flex flex-wrap gap-3">
                        <button className={approved.has(r.id) ? "btn-ghost" : "btn-violet"} onClick={() => toggle(r.id)}>
                          <Check size={17} aria-hidden /> {approved.has(r.id) ? "Approved (undo)" : "I checked it: approve"}
                        </button>
                        <button className="btn-primary" disabled={!approved.has(r.id) || busy === r.id} onClick={() => startClass(r.id)}>
                          {busy === r.id ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <QrCode size={17} aria-hidden />} Create class session
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link to={`/mine/${pack.id}/oral/examiner`} className="rounded-xl border-2 border-line bg-white p-5 hover:border-navy">
            <UserRound size={22} className="text-violet-ink" aria-hidden />
            <h2 className="mt-2 text-xl font-bold">The AI examines you</h2>
            <p className="mt-1 text-navy-soft">{pack.oral!.examiner_questions.length} questions. It follows up on vague answers, and only shows the full answer once you've had your say.</p>
          </Link>
          <Link to={`/mine/${pack.id}/oral/candidate`} className="rounded-xl border-2 border-line bg-white p-5 hover:border-navy">
            <MessagesSquare size={22} className="text-violet-ink" aria-hidden />
            <h2 className="mt-2 text-xl font-bold">You examine the AI</h2>
            <p className="mt-1 text-navy-soft">{pack.oral!.candidate_scenarios.length} scenarios. Question an over-confident AI candidate and catch the mistake it makes.</p>
          </Link>
        </div>
      )}

      <button className="btn-ghost mt-12" onClick={async () => { if (confirm("Delete this pack from this device?")) { await deletePack(pack.id); navigate("/student"); } }}>
        <Trash2 size={16} aria-hidden /> Delete this pack
      </button>
    </div>
  );
}
