// Client for the classroom server (backend/). Set VITE_API_URL in Vercel.
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

export interface StepView { n: number; text: string; latex: string; detail?: string }
export interface PublicRound {
  id: string; topic: string; difficulty: number; pack_version: string;
  problem_statement: { text: string; latex: string };
  steps: StepView[];
}
export interface Sub { choice: string; correct: boolean }
export interface Results {
  teams_joined: number; teams_submitted: number; min_teams: number; locked: boolean; max_points: number;
  sample?: boolean;
  catch_counts?: Record<string, number>;
  pct_caught?: number; pct_fix?: number; pct_why?: number;
  fix_counts?: Record<string, number>;
  why_counts?: { id: string; label: string; count: number }[];
  scoreboard?: { name: string; points: number }[];
  insights?: string[];
}
export interface Reveal {
  is_fully_correct: boolean; first_incorrect_step: number | null;
  correct_fix: string | null; correct_fix_latex: string | null; correct_fix_text?: string | null;
  correct_why: string | null; correct_why_label: string | null;
  correct_solution: { text: string; latex: string; quote?: string; source?: string }[];
  verified_answer: { latex: string; text?: string }; key_lesson: string; checker: string; claims_checked: number;
  provenance?: string; provenance_text?: string;
}
export interface RoomState {
  code: string; status: "lobby" | "running" | "finished";
  duration_s: number; deadline_ms: number | null; server_now_ms: number; version: number;
  topic_name: string; round: PublicRound; team_count: number; role: "host" | "team" | "viewer";
  teams?: { name: string; submitted: boolean; done: boolean }[];
  submitted_count?: number;
  results?: Results;
  you?: {
    name: string; phase: "catch" | "fix" | "explain" | "done";
    subs: Partial<Record<"catch" | "fix" | "explain", Sub>>;
    points: number; max_points: number;
    options?: {
      first_incorrect_step: number;
      fix_options: { id: string; text: string; latex: string }[];
      why_options: { id: string; label: string }[];
    };
  };
  reveal?: Reveal;
}

export type Auth = { host?: string; team?: string };

async function call<T>(path: string, init: { method?: string; body?: unknown; auth?: Auth; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const code = accessCode.get();
  if (code) headers["X-Access-Code"] = code;
  if (init.auth?.host) headers["X-Host-Token"] = init.auth.host;
  if (init.auth?.team) headers["X-Team-Token"] = init.auth.team;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
  } catch {
    throw new ApiError(
      "Can't reach the classroom server. If it has been idle it may be waking up, which takes up to a minute. Try again shortly.",
      0,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (data as { detail?: unknown }).detail;
    const msg = typeof d === "string" ? d
      : Array.isArray(d) && d[0]?.msg ? String(d[0].msg).replace(/^Value error, /, "")
      : `The server returned an error (HTTP ${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export interface AIStatus { enabled: boolean; provider: string | null; model: string | null; test_mode: boolean; access_code_required: boolean; max_files: number }
export interface Passage { id: string; file: string; text: string }
export interface ExtractResult { documents: { file: string; chars: number }[]; passages?: Passage[]; text?: string; truncated: boolean }
export interface ChatMsg { role: "examiner" | "student" | "candidate"; text: string }

export const accessCode = {
  get(): string { try { return localStorage.getItem("cta:access") ?? ""; } catch { return ""; } },
  set(v: string) { try { localStorage.setItem("cta:access", v); } catch { /* ignore */ } },
};

export const api = {
  aiStatus: () => call<AIStatus>("/api/ai/status"),
  extract: (files: File[], kind: "material" | "past") => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("kind", kind);
    return call<ExtractResult>("/api/material/extract", { method: "POST", form });
  },
  generate: (format: string, passages: Passage[], past_exams: string, count: number) =>
    call<import("./types").CustomPack>("/api/generate", { method: "POST", body: { format, passages, past_exams, count } }),
  grade: (body: { question: string; key_points: string[]; model_answer: string; sources: string[]; answer: string }) =>
    call<{ verdict: "correct" | "partial" | "incorrect"; covered: number[]; feedback: string }>("/api/grade", { method: "POST", body }),
  examiner: (question: { question: string; key_points: string[]; model_answer: string; quote: string }, history: ChatMsg[]) =>
    call<{ reply: string; closed: boolean; score: number | null }>("/api/oral/examiner", { method: "POST", body: { question, history } }),
  candidate: (scenario: object, history: ChatMsg[]) =>
    call<{ reply: string; done: boolean }>("/api/oral/candidate", { method: "POST", body: { scenario, history } }),
  judge: (scenario: object, history: ChatMsg[], claimed_mistake: string, correction: string) =>
    call<{ caught: boolean; corrected: boolean; feedback: string; false_claim: string; correct_claim: string; why: string; quote: string }>(
      "/api/oral/judge", { method: "POST", body: { scenario, history, claimed_mistake, correction } }),
  createCustomRoom: (custom_round: object, duration_s: number) =>
    call<{ code: string; host_token: string }>("/api/rooms", { method: "POST", body: { custom_round, duration_s } }),
  roomSample: (code: string, host: string) => call<Results>(`/api/rooms/${code}/sample`, { auth: { host } }),
  health: () => call<{ ok: boolean }>("/api/health"),
  createRoom: (round_id: string, duration_s: number) =>
    call<{ code: string; host_token: string }>("/api/rooms", { method: "POST", body: { round_id, duration_s } }),
  join: (code: string, team_name: string) =>
    call<{ team_token: string; team_name: string; code: string }>(`/api/rooms/${code}/join`, { method: "POST", body: { team_name } }),
  state: (code: string, auth: Auth) => call<RoomState>(`/api/rooms/${code}/state`, { auth }),
  start: (code: string, host: string) => call<RoomState>(`/api/rooms/${code}/start`, { method: "POST", auth: { host } }),
  reveal: (code: string, host: string) => call<RoomState>(`/api/rooms/${code}/reveal`, { method: "POST", auth: { host } }),
  submit: (code: string, team: string, phase: string, choice: string) =>
    call<RoomState>(`/api/rooms/${code}/submit`, { method: "POST", body: { phase, choice }, auth: { team } }),
  sample: (roundId: string) => call<Results>(`/api/demo/sample-results/${roundId}`),
};

export const wsUrl = (code: string) => `${API_URL.replace(/^http/, "ws")}/api/rooms/${code}/ws`;

// Ephemeral room tokens: kept so a refresh on the same phone keeps your team.
const key = (role: "host" | "team", code: string) => `cta:${role}:${code}`;
export const tokens = {
  get(role: "host" | "team", code: string): { token: string; name?: string } | null {
    try { return JSON.parse(localStorage.getItem(key(role, code)) || "null"); } catch { return null; }
  },
  set(role: "host" | "team", code: string, v: { token: string; name?: string }) {
    try { localStorage.setItem(key(role, code), JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
  clear(role: "host" | "team", code: string) {
    try { localStorage.removeItem(key(role, code)); } catch { /* ignore */ }
  },
};
