# Catch the AI

**Catch the mistake before your exam catches you.**

The AI acts as a confident student who makes realistic mistakes. The student becomes the examiner:
**Catch** the first wrong step, **Fix** it, **Explain** why it happened. Every round is verified with
SymPy before it is published, so the mathematics never depends on trusting an LLM.

This repository is at **Phase 1 (functional foundation)** of the build plan.

## What works now, and what doesn't yet

| Area | Status |
|---|---|
| Landing page, student dashboard, professor dashboard, routing | Working |
| KaTeX maths rendering | Working |
| Seed pack: 21 verified Calculus 1 rounds across 4 topics, 5 of them fully correct (24%) | Working |
| Catch → Fix → Explain → verified solution reveal | Working |
| Local progress (IndexedDB, on-device only), nickname, reset | Working |
| Professor round preview with answer key and verification details | Working |
| Mandatory demo round (x³ − 6x² + 11x − 6 on [0, 4], forgotten endpoints) | Working |
| "Correct answer from wrong reasoning" round (solved f(x) = 0) | Working |
| Live classroom (rooms, QR join, timer, live results) | **Phase 2, not built.** Buttons are visibly disabled and say so. |
| Confidence check, hints, Your Turn exercise, readiness, offline PWA | **Phase 3, not built.** |
| Qwen generation, Examiner agent, answer-leak guard | **Phase 4, not built.** |

Nothing in the app is simulated. All round content comes from hand-authored mistake templates (labelled
as such in the app), not from live AI generation.

## Repository layout

```
catch-the-ai/
├── content/                  Python: maths verification + round pack builder
│   ├── catchai/verify.py     SymPy claim checker (the source of truth)
│   ├── catchai/templates.py  Hand-authored misconception templates
│   ├── catchai/build_pack.py Verifies drafts, exports the versioned pack
│   ├── packs/                Built pack + review queue for rejected drafts
│   └── tests/                pytest: verifier cases + pack integrity
└── frontend/                 React + TypeScript + Vite + Tailwind
    ├── public/packs/calculus1.json   Copy of the pack served to the app
    └── src/lib/round.ts      Pure scoring/state machine (+ vitest tests)
```

`backend/` (FastAPI classroom server) will be added in Phase 2.

## How verification works

Every step in a round carries a structured claim, for example
`{"type": "absolute_extremum", "f": "x**3 - 6*x**2 + 11*x - 6", "interval": ["0","4"], "kind": "max", "value": "6", "at": ["4"]}`.
`verify.py` recomputes the truth independently with SymPy and returns `valid`, `invalid` or `unverifiable`.

- Equality is only ever proven symbolically. Numeric substitution is used only to *disprove* equality
  (one exact counterexample is a proof of inequality).
- The pack builder rejects a round if the answer key's "first error" disagrees with the verifier, if an
  unverifiable claim appears before the first error, if the fix options don't contain exactly one valid
  answer, or if the corrected solution isn't fully valid. Rejected rounds go to `packs/review_queue.json`.
- Supported claim types: equivalent expressions, derivatives, compositions, critical points (on R or an
  interval), evaluations, local extrema (second-derivative test), absolute extrema on closed intervals.
  Anything else is `unverifiable`, never graded.

Scoring: catch 2, fix 1, explain 1 (4 total). Fix and explain only earn points if the catch was correct,
because a wrong catch reveals the true error step. A correct "No mistake" on a correct round scores 4.

---

## Step-by-step: run it locally

You need **Node.js 20+** and **Python 3.10+**, plus **Git**.

```bash
# 1. Get the code into your repo folder, then:
cd catch-the-ai

# 2. Run the web app
cd frontend
npm install
npm run dev          # open http://localhost:5173

# 3. (Optional) run the frontend tests and a production build
npm test
npm run build
```

The pack is already built and committed, so you don't need Python just to run the app.
To change content or run the maths tests:

```bash
cd content
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m catchai.build_pack     # re-verifies every round and rewrites both pack copies
pytest                           # 19 tests
```

Always rebuild the pack and commit both `content/packs/` and `frontend/public/packs/` after editing templates.

## Step-by-step: GitHub

```bash
cd catch-the-ai
git init
git add .
git commit -m "Catch the AI: Phase 1"
git branch -M main
git remote add origin https://github.com/<you>/catch-the-ai.git
git push -u origin main
```

## Step-by-step: deploy on Vercel

1. Go to vercel.com, sign in with GitHub, click **Add New → Project**, and import the repo.
2. Set **Root Directory** to `frontend` (important: the app is not at the repo root).
3. Framework preset: **Vite**. Build command `npm run build`, output directory `dist` (the defaults).
4. No environment variables are needed for Phase 1.
5. Click **Deploy**. `frontend/vercel.json` already rewrites routes like `/play/...` to the app, so
   refreshing any page works.

Every push to `main` redeploys automatically.

### Important for Phase 2: the classroom server can't live on Vercel as-is

The live classroom needs a long-running server (WebSockets, server-authoritative timers, room state).
Vercel's Python functions are short-lived, have no WebSocket support, and their filesystem is wiped, so
SQLite would lose every room. Two workable options:

- **Recommended:** keep the frontend on Vercel and host the FastAPI backend on Render, Railway or Fly.io
  (all have free or cheap tiers and support WebSockets). The frontend reads `VITE_API_URL`.
- **All-Vercel:** use polling instead of WebSockets and store rooms in a hosted store such as Upstash
  Redis. Doable, but more moving parts.

Decide before Phase 2 starts.

## Demo walkthrough (Phase 1)

1. Landing page: the hero shows the AI's flawed solution with step 4 ringed.
2. "Try a sample round now": the endpoint demo. Pick step 4, choose "absolute maximum = 6 at x = 4",
   choose "Forgot to evaluate the interval endpoints", get 4/4 and the verified solution.
3. Professor → Max & min on closed intervals → Round 2: the "lucky" round where the final answer is
   right but step 2 solved f(x) = 0. Good talking point: checking only answers isn't enough.
4. Student dashboard: progress, weak spots and recent rounds, all stored only on this device.

## Known limitations

- The seed pack ships answer keys to the browser, which is fine for solo practice but not for a graded
  class game. In Phase 2 the server will hold keys and only reveal them after the round ends.
- Content is template-authored. LLM-drafted rounds (Qwen) arrive in Phase 4, through the same verifier.
- The verifier covers the claim types listed above for single-variable functions in `x`.
- Fonts load from Google Fonts; without a connection, the app falls back to system fonts.
