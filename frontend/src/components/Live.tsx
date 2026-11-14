import { BadgeCheck, Radio, RefreshCw, WifiOff } from "lucide-react";
import TeX from "./Math";
import type { Reveal } from "../lib/api";
import type { Conn } from "../lib/useRoom";

export function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Timer({ left, big = false }: { left: number | null; big?: boolean }) {
  if (left === null) return null;
  const urgent = left <= 30;
  return (
    <span
      className={`font-display font-extrabold tabular-nums ${big ? "text-6xl sm:text-7xl" : "text-2xl"} ${urgent ? "text-coral-ink" : "text-navy"}`}
      role="timer"
      aria-label={`${left} seconds left`}
    >
      {fmt(left)}
    </span>
  );
}

export function ConnBadge({ conn }: { conn: Conn }) {
  const map = {
    connecting: { icon: RefreshCw, text: "Connecting", cls: "text-navy-mute" },
    live: { icon: Radio, text: "Live", cls: "text-teal-ink" },
    polling: { icon: RefreshCw, text: "Reconnecting, still updating", cls: "text-navy-mute" },
    offline: { icon: WifiOff, text: "Can't reach the server", cls: "text-coral-ink" },
  }[conn];
  const Icon = map.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${map.cls}`} role="status" aria-live="polite">
      <Icon size={15} aria-hidden /> {map.text}
    </span>
  );
}

export function Bars({ rows, highlight }: { rows: { key: string; label: React.ReactNode; count: number }[]; highlight?: string | null }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3 sm:grid-cols-[minmax(0,14rem)_1fr_2rem]">
          <span className={`text-[15px] leading-snug ${r.key === highlight ? "font-bold text-teal-ink" : ""}`}>{r.label}</span>
          <span className="h-5 overflow-hidden rounded bg-paper" aria-hidden>
            <span className={`block h-full rounded ${r.key === highlight ? "bg-teal" : "bg-violet/60"}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="text-right font-display font-bold">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function SolutionPanel({ reveal }: { reveal: Reveal }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5" aria-labelledby="sol-h">
      <h3 id="sol-h" className="text-lg font-bold">Verified solution</h3>
      <ol className="mt-3 grid gap-3">
        {reveal.correct_solution.map((st, i) => (
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
        <TeX tex={reveal.verified_answer.latex} />
      </div>
      <p className="mt-4"><b>Remember:</b> {reveal.key_lesson}</p>
      <p className="mt-4 flex items-start gap-1.5 text-sm text-navy-mute">
        <BadgeCheck size={16} className="mt-0.5 shrink-0 text-teal-ink" aria-hidden />
        All {reveal.claims_checked} claims in this round were checked with {reveal.checker} before class.
      </p>
    </section>
  );
}
