// Acceptance tests A, C, D for the round rules, run against the real seed pack.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hintsAvailable, initialState, maxPoints, score, scoreHome, submitCatch, submitCatchHome, submitFix, submitWhy } from "./round";
import type { Pack, Round } from "./types";

const pack: Pack = JSON.parse(readFileSync(resolve(__dirname, "../../public/packs/calculus1.json"), "utf8"));
const byId = (id: string) => pack.rounds.find((r) => r.id === id) as Round;
const demo = byId("int-demo-endpoints");
const clean = pack.rounds.find((r) => r.is_fully_correct) as Round;
const wrongFix = (r: Round) => r.fix_options.find((o) => o.id !== r.correct_fix)!.id;
const wrongWhy = (r: Round) => r.why_options.find((w) => w.id !== r.correct_why)!.id;

describe("Test A: full correct play on the endpoint demo", () => {
  it("awards 4 points for catch + fix + explain", () => {
    let s = submitCatch(demo, initialState, 4);
    expect(s.catchCorrect).toBe(true);
    expect(s.phase).toBe("fix");
    s = submitFix(demo, s, demo.correct_fix!);
    s = submitWhy(demo, s, "forgot_endpoints");
    expect(s.phase).toBe("reveal");
    expect(score(demo, s, pack.scoring)).toBe(4);
  });
});

describe("Test C: wrong answers are rejected", () => {
  it("a valid step picked as the error earns nothing", () => {
    let s = submitCatch(demo, initialState, 3);
    expect(s.catchCorrect).toBe(false);
    s = submitFix(demo, s, demo.correct_fix!);
    s = submitWhy(demo, s, demo.correct_why!);
    expect(score(demo, s, pack.scoring)).toBe(0);
  });
  it("'No mistake' on a mistaken round is wrong", () => {
    expect(submitCatch(demo, initialState, "none").catchCorrect).toBe(false);
  });
  it("wrong fix and wrong explanation only keep the catch points", () => {
    let s = submitCatch(demo, initialState, 4);
    s = submitFix(demo, s, wrongFix(demo));
    s = submitWhy(demo, s, wrongWhy(demo));
    expect(s.fixCorrect).toBe(false);
    expect(s.whyCorrect).toBe(false);
    expect(score(demo, s, pack.scoring)).toBe(pack.scoring.catch);
  });
  it("answers lock: re-submitting does not change the result", () => {
    const s = submitCatch(demo, initialState, 3);
    expect(submitCatch(demo, s, 4)).toBe(s);
  });
});

describe("Test D: a fully correct round", () => {
  it("'No mistake' scores full points and skips fix/explain", () => {
    const s = submitCatch(clean, initialState, "none");
    expect(s.phase).toBe("reveal");
    expect(score(clean, s, pack.scoring)).toBe(maxPoints(clean, pack.scoring));
  });
  it("flagging a step on a correct round scores 0", () => {
    const s = submitCatch(clean, initialState, 2);
    expect(s.phase).toBe("reveal");
    expect(score(clean, s, pack.scoring)).toBe(0);
  });
});

describe("Pack shape", () => {
  it("every mistaken round has exactly one correct fix and explanation among options", () => {
    for (const r of pack.rounds.filter((r) => !r.is_fully_correct)) {
      expect(r.fix_options.filter((o) => o.id === r.correct_fix)).toHaveLength(1);
      expect(r.why_options.filter((w) => w.id === r.correct_why)).toHaveLength(1);
    }
  });
});

describe("Home Mode catch with retries and hints", () => {
  it("rules out a wrong pick, unlocks a hint, then accepts the right step for half catch points", () => {
    let s = submitCatchHome(demo, initialState, 3);
    expect(s.phase).toBe("catch");
    expect(s.wrongPicks).toEqual([3]);
    expect(hintsAvailable(s)).toBe(2);
    expect(submitCatchHome(demo, s, 3)).toBe(s); // same wrong pick is not a new attempt
    s = submitCatchHome(demo, s, 4);
    expect(s.catchCorrect).toBe(true);
    s = submitWhy(demo, submitFix(demo, s, demo.correct_fix!), demo.correct_why!);
    expect(scoreHome(demo, s, pack.scoring)).toBe(pack.scoring.catch / 2 + 2);
  });
  it("after 3 wrong attempts the round moves on with no points", () => {
    let s = initialState;
    for (const c of [1, 2, 3] as const) s = submitCatchHome(demo, s, c);
    expect(s.phase).toBe("fix");
    expect(s.catchCorrect).toBe(false);
    s = submitWhy(demo, submitFix(demo, s, demo.correct_fix!), demo.correct_why!);
    expect(scoreHome(demo, s, pack.scoring)).toBe(0);
  });
  it("first-try catch scores like class mode", () => {
    let s = submitCatchHome(demo, initialState, 4);
    s = submitWhy(demo, submitFix(demo, s, demo.correct_fix!), demo.correct_why!);
    expect(scoreHome(demo, s, pack.scoring)).toBe(4);
  });
});
