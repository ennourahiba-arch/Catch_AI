import { Radio, RefreshCw, WifiOff } from "lucide-react";
import TeX from "./Math";
import RichText from "./RichText";
import { SourceQuote } from "./QuestionCard";
import type { QuizOption, SolutionStep } from "../lib/api";
import type { Conn } from "../lib/useRoom";

export const LETTERS = "ABCD";

export function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Timer({ left, big = false }: { left: number | null; big?: boolean }) {
  if (left === null) return null;
  const urgent = left <= 10;
  return (
    <span className={`font-display font-extrabold tabular-nums ${big ? "text-6xl sm:text-7xl" : "text-2xl"} ${urgent ? "text-coral-ink" : "text-navy"}`}
      role="timer" aria-label={`${left} seconds left`}>
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

export function OptionBody({ o }: { o: QuizOption }) {
  return o.latex ? <TeX tex={o.latex} /> : <RichText text={o.text} />;
}

export function Bars({ rows, highlight }: { rows: { key: string; label: React.ReactNode; count: number }[]; highlight?: string | null }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_1fr_2rem] items-center gap-3 sm:grid-cols-[minmax(0,16rem)_1fr_2rem]">
          <span className={`min-w-0 text-[15px] leading-snug ${r.key === highlight ? "font-bold text-teal-ink" : ""}`}>{r.label}</span>
          <span className="h-5 overflow-hidden rounded bg-paper" aria-hidden>
            <span className={`block h-full rounded ${r.key === highlight ? "bg-teal" : "bg-violet/60"}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="text-right font-display font-bold">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function SolutionPanel({ steps, title = "Solution" }: { steps: SolutionStep[]; title?: string }) {
  if (!steps.length) return null;
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h3 className="text-lg font-bold">{title}</h3>
      <ol className="mt-3 grid gap-3">
        {steps.map((st, i) => (
          <li key={i} className="flex gap-3">
            <span className="font-display font-bold text-teal-ink">{i + 1}</span>
            <span className="min-w-0">
              <RichText text={st.text} className={`block ${st.latex ? "text-[15px] text-navy-soft" : ""}`} />
              {st.latex && <TeX tex={st.latex} />}
              {st.quote && <SourceQuote quote={st.quote} source={st.source} />}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
