import { Bot } from "lucide-react";
import Math from "./Math";
import Ring from "./Ring";
import type { CatchChoice } from "../lib/round";

interface Props {
  round: { steps: { n: number; text: string; latex: string }[] };
  /** "select": student is choosing. "review": answer revealed. "static": preview only. */
  mode: "select" | "review" | "static";
  selected?: CatchChoice | null;
  onSelect?: (n: number) => void;
  /** In review mode, which step was truly first wrong (null if none). */
  firstError?: number | null;
  /** In review mode, the step the student picked (if any). */
  picked?: CatchChoice | null;
  compact?: boolean;
  /** Home Mode: steps already tried and found valid. */
  ruledOut?: CatchChoice[];
}

export default function AttemptSheet({ round, mode, selected, onSelect, firstError, picked, compact, ruledOut = [] }: Props) {
  return (
    <section className="sheet overflow-hidden" aria-label="The AI's submitted solution">
      <div className="flex items-center gap-2 border-b border-line bg-violet-wash/60 py-2.5 pl-[4.25rem] pr-4 text-[15px]">
        <Bot size={18} className="text-violet-ink" aria-hidden />
        <span className="font-bold text-violet-ink">Submitted by the AI</span>
        <span className="hidden text-navy-mute sm:inline">who is very sure it got this right</span>
      </div>
      <ol className="divide-y divide-line/70" role={mode === "select" ? "radiogroup" : undefined} aria-label={mode === "select" ? "Pick the first incorrect step" : undefined}>
        {round.steps.map((s) => {
          const isSel = mode === "select" && selected === s.n;
          const isErr = mode !== "select" && firstError === s.n;
          const isWrongPick = mode === "review" && picked === s.n && firstError !== s.n;
          const isRuledOut = mode === "select" && ruledOut.includes(s.n);
          const Inner = (
            <>
              <span className="relative flex w-[3.25rem] shrink-0 justify-center pt-0.5">
                <span className={`relative z-10 font-display text-lg font-bold ${isSel || isErr ? "text-coral-ink" : "text-navy-mute"}`}>{s.n}</span>
                {(isSel || isErr) && <Ring className="-left-0.5 -top-2.5 h-12 w-14" key={`${mode}-${s.n}`} />}
              </span>
              <span className="min-w-0 flex-1 pr-4">
                <span className={`block ${compact ? "text-[15px]" : ""} text-navy-soft`}>{s.text}</span>
                <Math tex={s.latex} className="mt-1 max-w-full text-navy" />
                {isErr && <span className="mt-1 block font-display text-[15px] font-bold text-coral-ink">First error</span>}
                {isWrongPick && <span className="mt-1 block text-[15px] text-navy-mute">Your pick. This step is valid.</span>}
                {isRuledOut && <span className="mt-1 block text-[15px] font-bold text-teal-ink">You checked this one: it's valid.</span>}
              </span>
            </>
          );
          const base = `flex w-full items-start py-3.5 text-left ${isErr ? "bg-coral-wash/50" : ""} ${isWrongPick ? "bg-paper" : ""}`;
          return (
            <li key={s.n}>
              {mode === "select" ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  onClick={() => onSelect?.(s.n)}
                  disabled={isRuledOut}
                  className={`${base} transition-colors ${isRuledOut ? "cursor-default opacity-60" : "hover:bg-coral-wash/40"} ${isSel ? "bg-coral-wash/60" : ""}`}
                >
                  <span className="sr-only">Step {s.n}: </span>
                  {Inner}
                </button>
              ) : (
                <div className={base}>{Inner}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
