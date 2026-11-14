// Acceptance Test E: readiness follows independent practice, not game scores.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readiness } from "./readiness";
import type { History } from "./storage";
import type { Pack } from "./types";

const pack: Pack = JSON.parse(readFileSync(resolve(__dirname, "../../public/packs/calculus1.json"), "utf8"));
const empty: History = { attempts: [], exercises: [], confidence: [] };
const round = (ok: boolean, ts: number) => ({ roundId: "chn-01", topic: "chain-rule" as const, ts, catchCorrect: ok, fixCorrect: ok, whyCorrect: ok, points: ok ? 4 : 0, maxPoints: 4, mistakeLabel: "forgot_inner_derivative", catchAttempts: 1 });
const exAt = (ok: boolean, ts: number) => ({ exerciseId: "yt-chn-01", topic: "chain-rule" as const, ts, attempts: ok ? 1 : 2, correct: ok, firstTry: ok, usedHint: false });

describe("readiness", () => {
  it("needs independent work before giving a score", () => {
    const h: History = { ...empty, attempts: [round(true, 1), round(true, 2)] };
    expect(readiness(pack, h, "chain-rule").score).toBeNull();
  });
  it("is driven by independent results even when game scores are perfect", () => {
    const h: History = {
      attempts: [round(true, 1), round(true, 2), round(true, 3)],
      exercises: [exAt(false, 4), exAt(false, 5)],
      confidence: [{ topic: "chain-rule", ts: 0, rating: 5 }],
    };
    const r = readiness(pack, h, "chain-rule");
    expect(r.score).toBe(20);
    expect(r.message).toContain("missed 2 of your last 2 practice problems");
  });
  it("rises when independent exercises are solved", () => {
    const h: History = { ...empty, exercises: [exAt(true, 1), exAt(true, 2)], attempts: [round(false, 0)] };
    expect(readiness(pack, h, "chain-rule").score).toBe(80);
  });
});
