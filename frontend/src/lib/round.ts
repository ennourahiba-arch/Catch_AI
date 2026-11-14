// Pure state machine for one Catch -> Fix -> Explain round.
// No UI here so the rules can be unit-tested (see round.test.ts).
import type { Pack, Round } from "./types";

export type Phase = "catch" | "fix" | "explain" | "reveal";
export type CatchChoice = number | "none";

export interface RoundState {
  phase: Phase;
  catchChoice: CatchChoice | null;
  catchCorrect: boolean | null;
  fixChoice: string | null;
  fixCorrect: boolean | null;
  whyChoice: string | null;
  whyCorrect: boolean | null;
}

export const initialState: RoundState = {
  phase: "catch",
  catchChoice: null,
  catchCorrect: null,
  fixChoice: null,
  fixCorrect: null,
  whyChoice: null,
  whyCorrect: null,
};

export function submitCatch(round: Round, s: RoundState, choice: CatchChoice): RoundState {
  if (s.phase !== "catch") return s; // answers lock once submitted
  if (round.is_fully_correct) {
    return { ...s, catchChoice: choice, catchCorrect: choice === "none", phase: "reveal" };
  }
  return { ...s, catchChoice: choice, catchCorrect: choice === round.first_incorrect_step, phase: "fix" };
}

export function submitFix(round: Round, s: RoundState, optionId: string): RoundState {
  if (s.phase !== "fix") return s;
  return { ...s, fixChoice: optionId, fixCorrect: optionId === round.correct_fix, phase: "explain" };
}

export function submitWhy(round: Round, s: RoundState, whyId: string): RoundState {
  if (s.phase !== "explain") return s;
  return { ...s, whyChoice: whyId, whyCorrect: whyId === round.correct_why, phase: "reveal" };
}

export function maxPoints(round: Round, scoring: Pack["scoring"]): number {
  return round.is_fully_correct ? scoring.no_mistake : scoring.catch + scoring.fix + scoring.explain;
}

/** Fix and explain only earn points when the catch was right: otherwise the
 * student saw which step was wrong before answering them. */
export function score(round: Round, s: RoundState, scoring: Pack["scoring"]): number {
  if (s.phase !== "reveal") return 0;
  if (round.is_fully_correct) return s.catchCorrect ? scoring.no_mistake : 0;
  if (!s.catchCorrect) return 0;
  return scoring.catch + (s.fixCorrect ? scoring.fix : 0) + (s.whyCorrect ? scoring.explain : 0);
}
