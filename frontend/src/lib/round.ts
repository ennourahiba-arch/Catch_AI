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
  /** Home Mode only: how many catch attempts, and which wrong picks were ruled out. */
  catchAttempts: number;
  wrongPicks: CatchChoice[];
}

export const initialState: RoundState = {
  phase: "catch",
  catchChoice: null,
  catchCorrect: null,
  fixChoice: null,
  fixCorrect: null,
  whyChoice: null,
  whyCorrect: null,
  catchAttempts: 0,
  wrongPicks: [],
};

export function submitCatch(round: Round, s: RoundState, choice: CatchChoice): RoundState {
  if (s.phase !== "catch") return s; // answers lock once submitted
  if (round.is_fully_correct) {
    return { ...s, catchChoice: choice, catchCorrect: choice === "none", phase: "reveal", catchAttempts: 1 };
  }
  return { ...s, catchChoice: choice, catchCorrect: choice === round.first_incorrect_step, phase: "fix", catchAttempts: 1 };
}

// ---------------- Home Mode ----------------
export const MAX_CATCH_ATTEMPTS = 3;

/** Home Mode catch: a wrong pick is ruled out and the student tries again,
 * up to MAX_CATCH_ATTEMPTS. Repeating an already ruled-out pick is ignored. */
export function submitCatchHome(round: Round, s: RoundState, choice: CatchChoice): RoundState {
  if (s.phase !== "catch" || s.wrongPicks.includes(choice)) return s;
  const attempts = s.catchAttempts + 1;
  const correct = round.is_fully_correct ? choice === "none" : choice === round.first_incorrect_step;
  if (correct || attempts >= MAX_CATCH_ATTEMPTS) {
    const next: Phase = round.is_fully_correct ? "reveal" : "fix";
    return { ...s, catchChoice: choice, catchCorrect: correct, catchAttempts: attempts,
      wrongPicks: correct ? s.wrongPicks : [...s.wrongPicks, choice], phase: next };
  }
  return { ...s, catchAttempts: attempts, wrongPicks: [...s.wrongPicks, choice] };
}

/** Hint 1 is always available; each further wrong attempt unlocks the next. */
export const hintsAvailable = (s: RoundState) => Math.min(3, 1 + s.wrongPicks.length);

/** Full catch points on the first try, half after retries. */
export function scoreHome(round: Round, s: RoundState, scoring: Pack["scoring"]): number {
  if (s.phase !== "reveal" || !s.catchCorrect) return 0;
  const first = s.catchAttempts === 1;
  if (round.is_fully_correct) return first ? scoring.no_mistake : scoring.no_mistake / 2;
  return (first ? scoring.catch : scoring.catch / 2) + (s.fixCorrect ? scoring.fix : 0) + (s.whyCorrect ? scoring.explain : 0);
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
