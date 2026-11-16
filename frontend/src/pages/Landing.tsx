import { Link } from "react-router-dom";
import { BadgeCheck, Check, GraduationCap, ListChecks, MessagesSquare, PenLine, Presentation } from "lucide-react";
import TeX from "../components/Math";

/** A static preview of what a practice question looks like. */
function PaperPreview() {
  return (
    <div className="sheet overflow-hidden" aria-label="Example practice question">
      <div className="flex items-baseline justify-between border-b border-line bg-paper/70 py-2.5 pl-[4.25rem] pr-4 text-[15px]">
        <span className="font-bold text-violet-ink">Question 3 of 5</span>
        <span className="text-navy-mute">Chain rule</span>
      </div>
      <div className="grid gap-4 py-5 pl-[4.25rem] pr-5">
        <div>
          <p className="text-navy-soft">Find f′(x).</p>
          <TeX tex="f(x) = (2x + 3)^{4}" className="text-xl" />
        </div>
        <div className="rounded-lg border border-line px-4 py-3">
          <p className="text-sm text-navy-mute">Your answer</p>
          <p className="font-mono text-lg">8(2x+3)^3</p>
        </div>
        <p className="flex items-center gap-2 rounded-lg bg-teal-wash px-4 py-3 font-bold text-teal-ink">
          <Check size={18} aria-hidden /> Correct, first try. Checked exactly, not approximately.
        </p>
      </div>
    </div>
  );
}

const FORMATS = [
  { icon: ListChecks, title: "Multiple choice", text: "Graded instantly. Wrong options are the mistakes students really make, so you learn which trap you fell into." },
  { icon: PenLine, title: "Written exam", text: "Write your answer as you would on paper. It's graded against your course, with the key points you missed." },
  { icon: MessagesSquare, title: "Oral exam", text: "An examiner asks you questions in a chat, follows up when you're vague, and won't hand you the answer." },
];

export default function Landing() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-10 sm:pt-16 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <h1 className="text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">Practice in the format of your real exam.</h1>
          <p className="mt-5 max-w-[34rem] text-lg text-navy-soft">
            Upload your course and past exams. Rehearsal writes practice questions in the same style, grades your answers,
            and shows you how ready you are, for any subject.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/student" className="btn-primary"><GraduationCap size={18} aria-hidden /> I'm a student</Link>
            <Link to="/professor" className="btn-ghost"><Presentation size={18} aria-hidden /> I'm a professor</Link>
          </div>
          <p className="mt-5">
            <Link to="/practice/chain-rule" className="font-bold text-violet-ink underline decoration-2 underline-offset-4 hover:text-navy">Try a Calculus practice session</Link>
            <span className="text-navy-mute">, no sign-up needed.</span>
          </p>
        </div>
        <PaperPreview />
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-3xl font-bold">How a practice session works</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              ["Rate your confidence", "Before you start, say how ready you feel. Later you'll see how that compares with your results."],
              ["Answer five questions", "In your exam's format. Hints unlock as you try, and every answer ends with a worked solution."],
              ["See what to work on", "A readiness score, the mistake you keep making, and what to practice next."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="font-display text-4xl font-extrabold text-coral">{i + 1}</span>
                <div><h3 className="text-xl font-bold">{t}</h3><p className="mt-1 text-navy-soft">{d}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-3xl font-bold">Three exam formats</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {FORMATS.map((f) => (
            <div key={f.title}>
              <f.icon size={22} className="text-violet-ink" aria-hidden />
              <h3 className="mt-2 text-xl font-bold">{f.title}</h3>
              <p className="mt-1 text-navy-soft">{f.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold">On your own</h2>
            <p className="mt-2 text-navy-soft">Short sessions, at your pace. Progress stays on your device, and practice works offline once the questions are saved.</p>
            <Link to="/student" className="mt-4 inline-block font-bold text-violet-ink underline decoration-2 underline-offset-4">Start practicing</Link>
          </div>
          <div>
            <h2 className="text-2xl font-bold">In class</h2>
            <p className="mt-2 text-navy-soft">A live quiz in the middle of a lecture. Teams answer on one phone each, and after every question the professor sees what the room got wrong, and why.</p>
            <Link to="/professor" className="mt-4 inline-block font-bold text-violet-ink underline decoration-2 underline-offset-4">Run a class quiz</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="flex gap-4 rounded-xl bg-navy p-6 text-white sm:p-8">
          <BadgeCheck className="mt-1 shrink-0 text-teal" size={26} aria-hidden />
          <div>
            <h2 className="text-2xl font-bold text-white">Questions you can trust</h2>
            <p className="mt-2 max-w-[44rem] text-white/80">
              Calculus questions are verified with SymPy, a symbolic maths library, and typed answers are checked exactly. Questions from
              your own course quote it word for word, are reviewed by a second, independent AI, and professors approve them before class.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
