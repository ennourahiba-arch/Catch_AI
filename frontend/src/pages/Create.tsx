import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Loader2, MessagesSquare, PenLine, ListChecks, Upload, X } from "lucide-react";
import { ErrorState, Loading } from "../components/States";
import { accessCode, api, type AIStatus } from "../lib/api";
import { savePack } from "../lib/storage";

const ACCEPT = ".pdf,.docx,.pptx,.txt,.md";
const PROVIDER_NAME: Record<string, string> = { gemini: "Google Gemini", anthropic: "Anthropic Claude", fake: "the simulated test AI" };
type Format = "quiz" | "written" | "oral";

const FORMATS: { id: Format; title: string; text: string; icon: typeof ListChecks }[] = [
  { id: "quiz", title: "Multiple choice", text: "Questions with four options, graded instantly. Wrong options are the mistakes students really make. Can also be used in class.", icon: ListChecks },
  { id: "written", title: "Written exam", text: "Open questions. You write your answer and it's graded against your course, with the key points you missed.", icon: PenLine },
  { id: "oral", title: "Oral exam", text: "An AI examiner asks you questions in a chat, follows up when you're vague, and scores each answer.", icon: MessagesSquare },
];
const COUNTS: Record<Format, number[]> = { quiz: [8, 12, 16, 20], written: [4, 6, 8, 10], oral: [5, 7, 10] };

function FilePicker({ label, help, files, setFiles, max }: { label: string; help: string; files: File[]; setFiles: (f: File[]) => void; max: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    setFiles(next.slice(0, max));
  };
  return (
    <div>
      <p className="font-bold">{label}</p>
      <p className="text-[15px] text-navy-mute">{help}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={`mt-2 flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed bg-white px-4 py-6 text-center transition-colors ${drag ? "border-violet bg-violet-wash/40" : "border-line hover:border-navy-mute"}`}
      >
        <Upload size={22} className="text-navy-mute" aria-hidden />
        <span className="font-bold">Choose files or drop them here</span>
        <span className="text-sm text-navy-mute">PDF, Word (.docx), PowerPoint (.pptx) or text. Up to {max} files, 15 MB each.</span>
      </button>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {files.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {files.map((f) => (
            <li key={f.name + f.size} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-line">
              <span className="flex min-w-0 items-center gap-2"><FileText size={16} className="shrink-0 text-navy-mute" aria-hidden /><span className="truncate">{f.name}</span></span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))} className="rounded p-1 text-navy-mute hover:text-navy">
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Create() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [material, setMaterial] = useState<File[]>([]);
  const [past, setPast] = useState<File[]>([]);
  const [format, setFormat] = useState<Format>("quiz");
  const [count, setCount] = useState(12);
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState(accessCode.get());
  const [busy, setBusy] = useState<null | string>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = () => { setStatusErr(null); api.aiStatus().then(setStatus).catch((e) => setStatusErr(e.message)); };
  useEffect(loadStatus, []);

  if (statusErr) return <ErrorState message={statusErr} onRetry={loadStatus} />;
  if (!status) return <Loading label="Checking the AI setup" />;
  const provider = PROVIDER_NAME[status.provider ?? ""] ?? "the AI provider";

  async function run() {
    setErr(null);
    if (status!.access_code_required) accessCode.set(code.trim());
    try {
      setBusy("Reading your files");
      const [mat, pastRes] = await Promise.all([
        api.extract(material, "material"),
        past.length ? api.extract(past, "past") : Promise.resolve(null),
      ]);
      const passages = mat.passages ?? [];
      setBusy("Writing and checking questions");
      const pack = await api.generate(format, passages, pastRes?.text ?? "", count);
      await savePack({ ...pack, passages, sources: mat.documents.map((d) => d.file), approved: [] });
      navigate(`/mine/${pack.id}`, { state: { truncated: mat.truncated } });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  if (!status.enabled) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-3xl font-bold">Any subject needs an AI connection</h1>
        <p className="mt-3 text-navy-soft">
          Writing practice questions from your own course uses an AI model on the server, and none is set up yet.
          Whoever runs this site can add one in Render: set <code>LLM_PROVIDER</code> to <code>gemini</code> and <code>GEMINI_API_KEY</code> to a key from Google AI Studio.
        </p>
        <p className="mt-3 text-navy-soft">Everything else (Calculus practice, class quizzes, offline practice) keeps working without it.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-8">
      <h1 className="text-3xl font-bold sm:text-4xl">Practice on your own course</h1>
      <p className="mt-2 text-navy-soft">Upload your course and past exams, choose your exam's format, and Rehearsal writes practice questions from your material, for any subject.</p>
      {status.test_mode && (
        <p className="mt-4 rounded-lg bg-coral-wash px-4 py-3 font-bold text-coral-ink">
          Test mode: the server uses a simulated AI, so questions will be placeholder text. Add a real API key in Render for real content.
        </p>
      )}

      <div className="mt-8 grid gap-8">
        <FilePicker label="1. Course material" help="Lecture notes, slides, chapters. Every question will be based on these." files={material} setFiles={setMaterial} max={status.max_files} />
        <FilePicker label="Past exams (recommended)" help="Questions follow their style, wording and difficulty, but every fact comes from your course material." files={past} setFiles={setPast} max={status.max_files} />

        <fieldset>
          <legend className="font-bold">2. Exam format</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-3" role="radiogroup">
            {FORMATS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={format === f.id} onClick={() => { setFormat(f.id); setCount(COUNTS[f.id][1]); }}
                className={`rounded-xl border-2 bg-white p-4 text-left transition-colors ${format === f.id ? "border-navy" : "border-line hover:border-navy-mute"}`}>
                <f.icon size={20} className="text-violet-ink" aria-hidden />
                <span className="mt-2 block font-display text-lg font-bold">{f.title}</span>
                <span className="mt-1 block text-[15px] text-navy-soft">{f.text}</span>
              </button>
            ))}
          </div>
          <label className="mt-4 inline-flex items-center gap-3">
            <span className="text-navy-soft">Number of questions</span>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="min-h-[44px] rounded-lg border border-line bg-white px-3 font-bold">
              {COUNTS[format].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </fieldset>

        <div className="rounded-xl border border-line bg-white p-5">
          <p className="font-bold">3. Before you upload</p>
          <ul className="mt-2 grid gap-1.5 text-[15px] text-navy-soft">
            <li>Your files are read on the server in memory and not stored. The generated pack is saved only on this device.</li>
            <li>The text is sent to {provider} to write the questions.{status.provider === "gemini" && " On Google's free tier, Google may use it to improve its products."}</li>
            <li>Only upload material you're allowed to use, and nothing with personal data such as student names or grades.</li>
          </ul>
          <label className="mt-4 flex items-start gap-3">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-[#5643DE]" />
            <span>I understand, and my files contain no personal data.</span>
          </label>
          {status.access_code_required && (
            <label className="mt-4 grid gap-1.5">
              <span className="font-bold">Access code</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} className="min-h-[48px] max-w-xs rounded-lg border border-line px-3" autoComplete="off" />
              <span className="text-sm text-navy-mute">This server asks for a code before using AI. Get it from whoever runs it.</span>
            </label>
          )}
        </div>

        {err && <p className="rounded-lg bg-coral-wash px-4 py-3 text-coral-ink" role="alert">{err}</p>}
        <button className="btn-primary justify-self-start" disabled={!material.length || !consent || !!busy || (status.access_code_required && !code.trim())} onClick={run}>
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : null}
          {busy ?? "Create my practice questions"}
        </button>
        {busy && <p className="text-sm text-navy-mute" role="status">The AI writes the questions, then every quote is matched against your document and a second AI review checks the answers. This usually takes under a minute. Keep this page open.</p>}
      </div>
    </div>
  );
}
