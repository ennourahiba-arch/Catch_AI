import { Link } from "react-router-dom";
import { BadgeCheck, GraduationCap, Presentation } from "lucide-react";
import AttemptSheet from "../components/AttemptSheet";
import Math from "../components/Math";
import { usePack } from "../components/usePack";

const DEMO_ID = "int-demo-endpoints";

export default function Landing() {
  const { pack } = usePack();
  const demo = pack?.rounds.find((r) => r.id === DEMO_ID);

  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-10 sm:pt-16 lg:grid-cols-[1fr_1.05fr] lg:items-center">
        <div>
          <h1 className="text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">
            Catch the mistake before your exam catches you.
          </h1>
          <p className="mt-5 max-w-[34rem] text-lg text-navy-soft">
            Here the AI is the student. It solves calculus problems with total confidence and slips up the way real students do.
            You mark its work: find the first wrong step, fix it, and say why it went wrong.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/student" className="btn-primary"><GraduationCap size={18} aria-hidden /> I'm a student</Link>
            <Link to="/professor" className="btn-ghost"><Presentation size={18} aria-hidden /> I'm a professor</Link>
          </div>
          <p className="mt-5">
            <Link to={`/play/${DEMO_ID}`} className="font-bold text-violet-ink underline decoration-2 underline-offset-4 hover:text-navy">
              Try a sample round now
            </Link>
            <span className="text-navy-mute">, no sign-up needed.</span>
          </p>
        </div>

        <div className="relative">
          {demo ? (
            <>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <Math tex={demo.problem_statement.latex} className="text-lg" />
                <span className="shrink-0 text-[15px] text-navy-mute">Find the absolute max</span>
              </div>
              <AttemptSheet round={demo} mode="static" firstError={4} compact />
              <p className="mt-3 text-[15px] text-navy-mute">
                The AI never checked the endpoints. At <Math tex="x = 4" />, <Math tex="f(4) = 6" />, which beats 0.385.
              </p>
            </>
          ) : (
            <div className="sheet h-[26rem] animate-pulse" aria-hidden />
          )}
        </div>
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-bold">How a round works</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              ["Catch", "Find the first step where the AI's reasoning breaks, or decide that there is no mistake at all."],
              ["Fix", "Choose the line that should replace the broken step."],
              ["Explain", "Name the misconception behind it, so you spot the same trap in your own work."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="font-display text-4xl font-extrabold text-coral">{i + 1}</span>
                <div>
                  <h3 className="text-xl font-bold">{t}</h3>
                  <p className="mt-1 text-navy-soft">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold">Home Mode</h2>
          <p className="mt-2 text-navy-soft">
            Train on your own: rate your confidence, catch the AI's mistake with hints when you need them, then solve a fresh
            problem yourself. Your readiness is based on that last part. Progress stays on your device, and it works offline.
          </p>
          <Link to="/student" className="mt-4 inline-block font-bold text-violet-ink underline decoration-2 underline-offset-4">Start training</Link>
        </div>
        <div>
          <h2 className="text-2xl font-bold">Class Mode</h2>
          <p className="mt-2 text-navy-soft">
            A three-minute team challenge in the middle of a lecture. Teams join by QR code on one phone each, and the professor
            sees which misconceptions the room fell for.
          </p>
          <Link to="/professor" className="mt-4 inline-block font-bold text-violet-ink underline decoration-2 underline-offset-4">Set up a class challenge</Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="flex gap-4 rounded-xl bg-navy p-6 text-white sm:p-8">
          <BadgeCheck className="mt-1 shrink-0 text-teal" size={26} aria-hidden />
          <div>
            <h2 className="text-2xl font-bold text-white">Checked by mathematics, not by the AI</h2>
            <p className="mt-2 max-w-[42rem] text-white/80">
              Every step, fix and answer is verified symbolically with SymPy before a round is published. Rounds the checker can't
              decide never reach you. The AI is not here to think instead of you. It's here to make you think.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
