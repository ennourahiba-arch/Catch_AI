import { Flame } from "lucide-react";
import { DAILY_GOAL, type Streak } from "../lib/streak";

export default function StreakCard({ s }: { s: Streak }) {
  const left = Math.max(0, DAILY_GOAL - s.today);
  const message = s.metToday
    ? "Today's goal is done. See you tomorrow."
    : s.atRisk
      ? `Answer ${left} more ${left === 1 ? "question" : "questions"} today to keep your streak.`
      : `Answer ${left} ${left === 1 ? "question" : "questions"} today to ${s.best > 0 ? "start a new streak" : "start your streak"}.`;
  return (
    <section className="rounded-xl border border-line bg-white p-5" aria-label="Daily streak">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full ${s.current > 0 ? "bg-coral-wash text-coral-ink" : "bg-paper text-navy-mute"}`}>
            <Flame size={26} aria-hidden fill={s.metToday ? "currentColor" : "none"} />
          </span>
          <div>
            <p className="font-display text-2xl font-extrabold">{s.current} {s.current === 1 ? "day" : "days"} <span className="text-base font-bold text-navy-mute">streak</span></p>
            <p className="text-[15px] text-navy-soft">{message}</p>
          </div>
        </div>
        <ol className="flex gap-1.5" aria-label="Last 7 days">
          {s.week.map((d) => (
            <li key={d.key} className="flex flex-col items-center gap-1">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold
                ${d.met ? "bg-coral text-white" : d.count > 0 ? "bg-coral-wash text-coral-ink" : "bg-paper text-navy-mute"} ${d.isToday ? "ring-2 ring-navy ring-offset-2 ring-offset-white" : ""}`}
                title={`${d.key}: ${d.count} ${d.count === 1 ? "answer" : "answers"}`}>
                {d.met ? <Flame size={14} aria-hidden fill="currentColor" /> : d.count || ""}
              </span>
              <span className="text-xs text-navy-mute">{d.label}</span>
              <span className="sr-only">{d.key}: {d.met ? "goal met" : `${d.count} answers`}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper" aria-hidden>
          <div className="h-full rounded-full bg-coral transition-all" style={{ width: `${Math.min(100, (s.today / DAILY_GOAL) * 100)}%` }} />
        </div>
        <span className="text-sm text-navy-mute">{Math.min(s.today, DAILY_GOAL)} of {DAILY_GOAL} today{s.best > s.current ? `, best ${s.best} days` : ""}</span>
      </div>
    </section>
  );
}
