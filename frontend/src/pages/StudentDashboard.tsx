import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Plus, Swords, Users } from "lucide-react";
import ReadinessCard from "../components/ReadinessCard";
import StreakCard from "../components/StreakCard";
import { streakInfo } from "../lib/streak";
import OfflineStatus from "../components/OfflineStatus";
import { ErrorState, Loading } from "../components/States";
import { usePack } from "../components/usePack";
import { courseReadiness, readiness } from "../lib/readiness";
import { clearAll, getKV, listCourses, loadHistory, newId, saveCourse, setKV, type History } from "../lib/storage";
import type { Course } from "../lib/types";
import type { TopicId } from "../lib/types";

export default function StudentDashboard() {
  const { pack, error, retry } = usePack();
  const [history, setHistory] = useState<History | null>(null);
  const [nickname, setNickname] = useState<string | null | undefined>(undefined);
  const [lastTopic, setLastTopic] = useState<TopicId | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [naming, setNaming] = useState(false);
  const [courseName, setCourseName] = useState("");
  const navigate = useNavigate();

  const refresh = () => {
    loadHistory().then(setHistory);
    getKV<string>("nickname").then((n) => setNickname(n ?? null));
    getKV<TopicId>("lastTopic").then(setLastTopic);
    listCourses().then(setCourses);
  };
  useEffect(refresh, []);

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!pack || !history || nickname === undefined) return <Loading label="Loading your progress" />;

  const ready = pack.topics.map((t) => readiness(pack, history, t.id));
  const recommended = ready.find((r) => r.score === null || r.score < 80)?.topic ?? pack.topics[0].id;
  const continueTopic = lastTopic && pack.topics.some((t) => t.id === lastTopic) ? lastTopic : recommended;
  const anything = history.exercises.length > 0;
  const rated = ready.filter((r) => r.confidence !== null);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      {nickname === null ? (
        <form
          className="max-w-lg"
          onSubmit={(e) => {
            e.preventDefault();
            const n = draft.trim().slice(0, 24);
            if (n) setKV("nickname", n).then(() => setNickname(n));
          }}
        >
          <h1 className="text-3xl font-bold">What should we call you?</h1>
          <p className="mt-1 text-navy-mute">Any nickname works. It's stored on this device only, with no account.</p>
          <div className="mt-4 flex gap-2">
            <label htmlFor="nick" className="sr-only">Nickname</label>
            <input id="nick" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={24} placeholder="e.g. Limit Breaker"
              className="min-h-[48px] flex-1 rounded-full border border-line bg-white px-5 outline-none focus:border-violet" />
            <button className="btn-primary" disabled={!draft.trim()}>Save</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold sm:text-4xl">Hi, {nickname}</h1>
            <p className="mt-1 text-navy-mute">Practice in the format of your real exam: short sessions, instant feedback, and a readiness score.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to={`/practice/${continueTopic}`} className="btn-primary"><Play size={17} aria-hidden /> {anything ? "Continue practicing" : "Start practicing"}</Link>
            <Link to="/duel/new" className="btn-ghost"><Swords size={17} aria-hidden /> Duel a friend</Link>
            <Link to="/join" className="btn-ghost"><Users size={17} aria-hidden /> Join with a code</Link>
          </div>
        </div>
      )}

      {nickname !== null && <div className="mt-8"><StreakCard s={streakInfo(history.exercises)} /></div>}

      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">My courses</h2>
            <p className="text-[15px] text-navy-mute">One per course you're taking, any subject. Add lessons and past exams, practice lesson by lesson, or take a mock exam.</p>
          </div>
          {!naming && <button className="btn-violet" onClick={() => setNaming(true)}><Plus size={17} aria-hidden /> New course</button>}
        </div>
        {naming && (
          <form className="mt-4 flex max-w-lg gap-2" onSubmit={async (e) => {
            e.preventDefault();
            const name = courseName.trim().slice(0, 60);
            if (!name) return;
            const c = { id: newId("c"), name, created_at: new Date().toISOString(), lessons: [], past_exams: null, exam_profile: null, mocks: [] };
            await saveCourse(c);
            navigate(`/course/${c.id}`);
          }}>
            <label htmlFor="cname" className="sr-only">Course name</label>
            <input id="cname" autoFocus value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="e.g. Systems" maxLength={60}
              className="min-h-[48px] flex-1 rounded-full border border-line bg-white px-5 outline-none focus:border-violet" />
            <button className="btn-primary" disabled={!courseName.trim()}>Create</button>
            <button type="button" className="btn-ghost" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        )}
        {courses.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => {
              const r = courseReadiness(c, history);
              const lastMock = [...c.mocks].sort((a, b) => b.ts - a.ts)[0];
              return (
                <Link key={c.id} to={`/course/${c.id}`} className="rounded-xl border-2 border-line bg-white p-5 hover:border-navy">
                  <h3 className="text-lg font-bold">{c.name}</h3>
                  <p className="mt-1 text-[15px] text-navy-mute">{c.lessons.length} {c.lessons.length === 1 ? "lesson" : "lessons"}{c.past_exams ? ", past exams added" : ""}</p>
                  <p className="mt-3 text-[15px]">
                    {r.score !== null ? <>Readiness <b>{r.score}%</b></> : <span className="text-navy-mute">No readiness yet</span>}
                    {lastMock && <span className="text-navy-mute">. Last mock {Math.round((100 * lastMock.score) / lastMock.max)}%</span>}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
        {courses.length === 0 && !naming && (
          <p className="mt-4 rounded-xl border border-dashed border-line bg-white p-5 text-navy-soft">No courses yet. Create one for each course you're taking, for example "Systems", then add its lessons.</p>
        )}
      </section>

      <h2 className="mt-12 text-xl font-bold">Calculus 1: verified question bank</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ready.map((r) => {
          const levels = [...new Set(pack.exercises.filter((x) => x.topic === r.topic).map((x) => x.difficulty))].sort();
          const nEx = pack.exercises.filter((x) => x.topic === r.topic).length;
          return (
            <Link key={r.topic} to={`/practice/${r.topic}`} className={`group rounded-xl border-2 bg-white p-5 transition-colors hover:border-navy ${r.topic === recommended ? "border-violet" : "border-line"}`}>
              {r.topic === recommended && <p className="mb-1 text-sm font-bold text-violet-ink">Recommended next</p>}
              <h3 className="text-lg font-bold">{r.topicName}</h3>
              <p className="mt-1 text-[15px] text-navy-mute">
                {nEx} questions, levels {levels[0]}–{levels[levels.length - 1]}
              </p>
              {r.score !== null ? (
                <>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper" aria-hidden>
                    <div className="h-full rounded-full bg-teal" style={{ width: `${r.score}%` }} />
                  </div>
                  <p className="mt-2 text-[15px]">Readiness {r.score}%</p>
                </>
              ) : (
                <p className="mt-4 text-[15px] font-bold text-violet-ink group-hover:underline">
                  {r.answered.of ? "Keep going for a readiness score" : "Start this topic"}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <h2 className="text-xl font-bold">Readiness</h2>
          {!anything ? (
            <div className="mt-4 rounded-xl border border-dashed border-line bg-white p-6">
              <p className="font-bold">Nothing to show yet.</p>
              <p className="mt-1 text-navy-mute">Practice a topic: rate your confidence, answer 5 exam-style questions with hints when you need them, and see how ready you are.</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-4">
              {ready.filter((r) => r.answered.of).map((r) => <ReadinessCard key={r.topic} r={r} compact />)}
            </div>
          )}
        </section>

        <aside className="grid content-start gap-4">
          {rated.length > 0 && (
            <section className="rounded-xl border border-line bg-white p-5">
              <h2 className="font-bold">Confidence vs. results</h2>
              <table className="mt-3 w-full text-[15px]">
                <thead><tr className="text-left text-navy-mute"><th className="pb-2 font-normal">Topic</th><th className="pb-2 font-normal">You said</th><th className="pb-2 font-normal">Right</th></tr></thead>
                <tbody>
                  {rated.map((r) => (
                    <tr key={r.topic} className="border-t border-line">
                      <td className="py-2 pr-2">{r.topicName}</td>
                      <td className="py-2 font-bold">{r.confidence}/5</td>
                      <td className="py-2 font-bold">{r.answered.of ? `${r.answered.firstTry + r.answered.later} of ${r.answered.of}` : "none yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <OfflineStatus pack={pack} />
          <button
            className="btn-ghost justify-self-start"
            onClick={() => { if (confirm("Delete your nickname and all progress stored on this device?")) clearAll().then(refresh); }}
          >
            Reset progress on this device
          </button>
        </aside>
      </div>
    </div>
  );
}
