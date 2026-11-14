// Mirrors the JSON written by content/catchai/build_pack.py.
export type TopicId = "derivatives" | "chain-rule" | "critical-points" | "closed-interval";

export interface Claim {
  type: string;
  [key: string]: unknown;
}

export interface Step {
  n: number;
  text: string;
  latex: string;
  claim: Claim;
  verdict: "valid" | "invalid";
}

export interface Option {
  id: string;
  text: string;
  latex: string;
  claim: Claim;
}

export interface Round {
  id: string;
  topic: TopicId;
  difficulty: number;
  problem_statement: { text: string; latex: string };
  steps: Step[];
  first_incorrect_step: number | null;
  is_fully_correct: boolean;
  mistake_label: string | null;
  corrected_step: (Omit<Option, "id"> & { step: number }) | null;
  fix_options: Option[];
  correct_fix: string | null;
  why_options: { id: string; label: string }[];
  correct_why: string | null;
  correct_solution: { text: string; latex: string }[];
  verified_answer: { latex: string; claim: Claim };
  key_lesson: string;
  hint_ladder: string[];
  source_provenance: { method: string; description: string; llm: string | null };
  verification_status: { status: string; checker: string; claims_checked: number; step_verdicts: string[] };
  pack_version: string;
}

export type ExerciseAnswer =
  | { kind: "expression"; coeffs: Record<string, string> }
  | { kind: "points"; values: string[] }
  | { kind: "extremum"; extremum: "max" | "min"; value: string; at: string[] };

export interface Exercise {
  id: string;
  topic: TopicId;
  difficulty: number;
  prompt: string;
  latex: string;
  answer: ExerciseAnswer;
  answer_latex: string;
  input_help: string;
  hint: string;
  solution: { text: string; latex: string }[];
}

export interface Pack {
  pack_id: string;
  subject: string;
  pack_version: string;
  content_hash: string;
  topics: { id: TopicId; name: string }[];
  misconceptions: Record<string, string>;
  scoring: { catch: number; fix: number; explain: number; no_mistake: number };
  rounds: Round[];
  exercises: Exercise[];
}
