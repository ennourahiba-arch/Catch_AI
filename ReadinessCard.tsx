import type { Readiness } from "../lib/readiness";

export default function ReadinessCard({ r, compact = false }: { r: Readiness; compact?: boolean }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5" aria-label={`Readiness for ${r.topicName}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className={`${compact ? "text-lg" : "text-2xl"} font-bold`}>{r.topicName}</h2>
          <p className="text-[15px] text-navy-mute">Readiness, based mostly on problems you solved on your own</p>
        </div>
        <p className="shrink-0 text-right">
          {r.score === null
            ? <span className="text-[15px] text-navy-mute">Not enough<br />data yet</span>
            : <span className={`font-display ${compact ? "text-3xl" : "text-5xl"} font-extrabold ${r.score >= 80 ? "text-teal-ink" : r.score < 50 ? "text-coral-ink" : ""}`}>{r.score}%</span>}
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-[15px]">
        <div><dt className="text-navy-mute">Your confidence</dt><dd className="font-bold">{r.confidence ?? "not rated"}{r.confidence !== null && " / 5"}</dd></div>
        <div><dt className="text-navy-mute">Caught first try</dt><dd className="font-bold">{r.catchFirstTry.of ? `${r.catchFirstTry.hit} of ${r.catchFirstTry.of}` : "none yet"}</dd></div>
        <div><dt className="text-navy-mute">Solved yourself</dt><dd className="font-bold">{r.independent.of ? `${r.independent.firstTry + r.independent.later} of ${r.independent.of}` : "none yet"}</dd></div>
      </dl>
      {r.message && <p className="mt-4 rounded-lg bg-coral-wash px-4 py-3">{r.message}</p>}
      {!compact && r.misconceptions.length > 0 && (
        <p className="mt-4"><b>Mistakes you missed recently:</b> {r.misconceptions.slice(0, 2).map((m) => m.label.toLowerCase()).join("; ")}.</p>
      )}
      <p className="mt-4"><b>Next:</b> {r.next}</p>
    </section>
  );
}
