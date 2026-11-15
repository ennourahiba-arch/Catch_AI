# Catch the AI

**Catch the mistake before your exam catches you.**

The AI acts as a confident student who makes realistic mistakes. The student becomes the examiner:
**Catch** the first wrong step, **Fix** it, **Explain** why it happened. Every round is verified with
SymPy before it is published, so the mathematics never depends on trusting an LLM.

This repository is at **Phase 3 + any-subject uploads** of the build plan.

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
| Live classroom: room codes, QR join, team lobby, server-authoritative timer | Working (needs the backend on Render) |
| Live updates over WebSockets, automatic polling fallback, reconnection | Working |
| Professor results: % caught / fixed / explained, step and reason charts, scores, data-driven insights | Working |
| Privacy: breakdowns hidden below 3 answering teams; clearly labelled sample data option | Working |
| Home Mode: confidence check (1–5), Catch the AI with 3 attempts and a 3-level hint ladder | Working |
| Your Turn: 17 SymPy-verified exercises; students type answers, graded exactly offline | Working |
| Readiness per topic (80% independent exercises, 20% first-try catches), confidence vs. results | Working |
| Offline: installable PWA, service worker precaches the app and pack; Home Mode works with no internet | Working |
| Any subject: upload PDF/Word/PowerPoint/text + optional past exams; quiz, written or oral format | Working (needs an AI key on Render) |
| Generated rounds: quotes matched word for word against the document, plus an independent AI review | Working |
| Oral exam chat: AI examiner (with a server-side answer-leak guard) and AI candidate to catch | Working (needs an AI key) |
| Class games from uploaded material, after the professor approves each round | Working |
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
│   ├── catchai/exercises.py  Your Turn exercises + checker test vectors
│   └── tests/                pytest: verifier, pack integrity, exercises
├── backend/                  FastAPI classroom server (deploy to Render)
│   ├── app/main.py           Routes, WebSocket hub, server-side timer
│   ├── app/logic.py          Judging, scoring, class aggregates, insights
│   ├── app/db.py             SQLite for temporary rooms (auto-expire)
│   ├── packs/calculus1.json  Server copy of the pack (holds the answer keys)
│   └── tests/                pytest: classroom flow, privacy, anti-cheat
└── frontend/                 React + TypeScript + Vite + Tailwind
    ├── public/packs/calculus1.json   Copy of the pack served to the app
    ├── src/lib/round.ts      Pure scoring/state machine (+ vitest tests)
    ├── src/lib/mathcheck.ts  Exact offline answer checker (cross-tested against SymPy)
    ├── src/lib/readiness.ts  Readiness model
    └── vite.config.ts        Also generates the offline service worker (dist/sw.js)
```


## Any subject: how uploaded material is handled

1. **Reading:** `POST /api/material/extract` reads files in memory (never written to disk) and splits them into
   numbered passages (P1, P2, ...). Past exams are kept as plain text, used only as style examples.
2. **Generating:** `POST /api/generate` asks the AI for rounds in the chosen format. Every question, paragraph and
   claim must cite a passage id and quote it.
3. **Checking** (`backend/app/genpack.py`):
   - Every quote must appear word for word in the cited passage; spacing and punctuation are ignored.
     A fabricated quote drops the item.
   - Answer keys must be internally consistent: for example, the AI's wrong answer must really be the one marked wrong.
   - A second, independent AI call reviews each item against its cited passages. Anything it doesn't approve is dropped.
4. **Labelling:** these rounds say "generated from your document and checked against it", never "verified".
   Calculus keeps its SymPy-verified label.
5. **Storing:** the pack (including the passages) is saved only in the uploader's browser. For a class game, the
   professor must review and approve a round; only that round is sent to the server and it's deleted with the room.

Written Your Turn answers, oral examiner scores and candidate verdicts are graded by AI and labelled as such.
Multiple-choice answers are graded exactly. The examiner and the candidate both run through a server-side check
that replaces any reply repeating the answer key before the question is closed.

`LLM_PROVIDER=fake` runs a simulated AI so the whole pipeline can be tested without a key. Everything it produces
is marked "test mode" in the app. `backend/tests/test_ai.py` uses it to test fabricated quotes, review
rejections, leak attempts, rate limits and class games with generated rounds.

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

### How typed answers are graded (Your Turn)

`frontend/src/lib/mathcheck.ts` parses what the student types and compares it with the answer using exact
fractions (BigInt), never decimals. For derivatives it proves equality of polynomials and powers of x
(e.g. `8(2x+3)^3` equals `64x^3 + 288x^2 + 432x + 216`). For numbers, `0.333` is not accepted for `1/3`.
Anything it can't prove (sin, sqrt, dividing by `x+1`) gets "can't verify that form" and does not count
as an attempt. Every exercise is chosen in Python so its answer is inside that provable class, and
`content/packs/checker_vectors.json` (generated with SymPy) is replayed by the frontend tests, so the two
checkers are shown to agree.

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
pytest                           # 25 tests
```

Always rebuild the pack and commit `content/packs/`, `frontend/public/packs/` and `backend/packs/` after editing templates.

To run the classroom server locally (in a second terminal):

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
pytest                           # 34 tests
```

With no `VITE_API_URL` set, the frontend talks to `http://localhost:8000`. To try several teams on one computer, open extra browser windows in private/incognito mode: each one counts as a separate team.

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

## Step-by-step: deploy the classroom server on Render

The live classroom needs a server that stays running (WebSockets, timers, room state), which Vercel
can't host. The website stays on Vercel; only `backend/` goes to Render.

1. Go to render.com and sign up with GitHub.
2. Click **New → Web Service** and pick your repo.
3. Fill in:
   - **Name:** `catch-ai-api` (this becomes `https://catch-ai-api.onrender.com`; if taken, Render adds letters)
   - **Root Directory:** `backend`
   - **Runtime / Language:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-access-log`
   - **Instance Type:** Free
4. Under **Environment Variables**, add `ALLOWED_ORIGINS` = your Vercel address, e.g.
   `https://catch-ai.vercel.app` (no trailing slash).
5. Click **Create Web Service** and wait for "Live". Check `https://<your-render-url>/api/health`:
   it should show `{"ok":true,...}`.

Then connect the website to it:

6. In Vercel: your project → **Settings → Environment Variables** → add `VITE_API_URL` =
   your Render URL (e.g. `https://catch-ai-api.onrender.com`, no trailing slash).
7. **Deployments** → the latest one → **⋯ → Redeploy**. This is required: the address is built into
   the site at build time, so saving the variable alone changes nothing.

### Turning on the AI features (any subject)

In Render → your service → **Environment**, add:

- `LLM_PROVIDER` = `gemini`
- `GEMINI_API_KEY` = your key from aistudio.google.com (**Get API key**). The free tier is fine for a hackathon.
  On the free tier Google may use what you send to improve its products, and the app tells uploaders this.
- Optional: `ACCESS_CODE` = any word, so only people you give it to can use the AI (protects your quota).
- Optional: `LLM_MODEL`, if the default model name stops working (copy a current one from AI Studio).
- Optional: `LLM_FALLBACK_MODEL`, a lighter model (e.g. a Flash Lite one) used automatically when the main
  model is overloaded. Busy responses (HTTP 429/5xx) are retried twice before switching.

Save, and Render restarts the server. Check `https://<your-render-url>/api/ai/status`: `"enabled": true`.
To use Claude instead, set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` (from console.anthropic.com).

### Render free tier: what to know before a demo

- It **sleeps after 15 minutes without traffic**. The first request after that takes about a minute.
  Open `/api/health` a few minutes before presenting.
- Rooms live in SQLite on the server's temporary disk, so **a sleep or restart deletes open rooms**.
  Create the room right before you use it. (Rooms are temporary by design and auto-delete after 3 hours.)
- A paid instance (about $7/month) never sleeps, if you want zero risk on demo day.

## Testing Home Mode offline (acceptance Test G)

1. On your phone, open the Vercel site and go to **Student** once while online. The **Offline** card on the
   dashboard says "Saved on this device" when it's ready. Optionally use **Add to Home Screen**.
2. Turn on airplane mode.
3. Open the site again (or the home-screen icon), pick a topic and complete a full training session.
   Class games correctly say they can't reach the server.

## Testing the classroom across devices

1. On a laptop: Professor → pick a round → **Create class session**. Project this screen.
2. On 3 phones (or 3 private browser windows): scan the QR code or go to `/join` and enter the code.
3. Watch the team count rise live, then press **Start**. Answer on the phones.
4. Press **End now and reveal**, or wait for the timer. Phones show the solution; the laptop shows results.

With fewer than 3 teams, the breakdown stays hidden; use **Show sample data instead** (it is labelled as invented).

## Demo walkthrough

1. Landing page: the hero shows the AI's flawed solution with step 4 ringed.
2. "Try a sample round now": the endpoint demo. Pick step 4, choose "absolute maximum = 6 at x = 4",
   choose "Forgot to evaluate the interval endpoints", get 4/4 and the verified solution.
3. Professor → Max & min on closed intervals → Round 2: the "lucky" round where the final answer is
   right but step 2 solved f(x) = 0. Good talking point: checking only answers isn't enough.
4. Student dashboard: progress, weak spots and recent rounds, all stored only on this device.

## Known limitations

- Solo practice (Home Mode) loads the pack with answer keys into the browser, which is fine for
  self-study. Class games never send keys to teams: the server reveals the first error to a team only
  after it locks its catch, and the full solution only at the reveal.
- In class, a team that locks a wrong catch sees where the real error is (so it can finish for practice,
  without points). A team could tell its neighbours, as with any classroom quiz.
- The Render free tier sleeps and loses open rooms on restart (see above).
- Typed-answer checking covers polynomials, powers of x and exact numbers. Exercises needing sin, e^x or
  square roots in the answer aren't offered as Your Turn yet (they appear in AI rounds, which use options).
- Uploaded material: scanned PDFs (photos of pages) have no text to read yet. Very long material is cut to about
  90,000 characters per pack. Generated rounds are carefully checked but not proven: a professor should review
  rounds before class, and students should trust their course if something looks wrong.
- The simulated AI (test mode) produces placeholder content; real content needs a key.
- Readiness uses the last 5 rounds and exercises per topic and needs at least 2 exercises before showing
  a score. It describes practice on this device only, not overall ability.
- `npm audit` reports advisories in dev-only tools (Vite, Vitest) and two moderate React Router issues that
  apply to server-side rendering and user-typed redirect paths. Neither applies here (room codes are
  stripped to letters and digits before navigation). Upgrading to Vite 7 / React Router 7 is a later task.
- Content is template-authored. LLM-drafted rounds (Qwen) arrive in Phase 4, through the same verifier.
- The verifier covers the claim types listed above for single-variable functions in `x`.
- Fonts load from Google Fonts; without a connection, the app falls back to system fonts.
