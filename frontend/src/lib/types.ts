// Mirrors the JSON written by content/catchai/build_pack.py.
// Built-in Calculus topics, or the id of a pack generated from uploaded material.
export type TopicId = string;

export interface Claim {
  type: string;
  [key: string]: unknown;
}

export interface Step {
  n: number;
  text: string;
  latex: string;
  /** e.g. the AI's chosen option and justification in a quiz round */
  detail?: string;
  claim?: Claim;
  verdict?: "valid" | "invalid";
}

export interface SolutionLine { text: string; latex: string; quote?: string; source?: string }

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
  correct_solution: SolutionLine[];
  verified_answer: { latex: string; text?: string; claim?: Claim };
  topic_name?: string;
  key_lesson: string;
  hint_ladder: string[];
  source_provenance: { method: string; description: string; llm: string | null; test_mode?: boolean };
  verification_status: { status: string; checker: string; claims_checked: number; step_verdicts: string[] };
  pack_version: string;
}

export type ExerciseAnswer =
  | { kind: "expression"; coeffs: Record<string, string> }
  | { kind: "points"; values: string[] }
  | { kind: "extremum"; extremum: "max" | "min"; value: string; at: string[] }
  | { kind: "mcq"; correct: number }
  | { kind: "open"; key_points: string[]; model_answer: string };

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
  solution: SolutionLine[];
  options?: string[];
  answer_text?: string;
  source_ids?: string[];
}

/** A pack generated from a student's or professor's own uploaded material. Lives in IndexedDB only. */
export interface CustomPack {
  id: string;
  title: string;
  format: "quiz" | "written" | "oral";
  created_at: string;
  generator: { provider: string | null; model: string; test_mode: boolean };
  rounds: Round[];
  exercises: Exercise[];
  misconceptions: Record<string, string>;
  oral: null | {
    examiner_questions: OralQuestion[];
    candidate_scenarios: OralScenario[];
  };
  dropped: string[];
  passages: { id: string; file: string; text: string }[];
  sources: string[];
  approved?: string[]; // round ids a professor approved for class
}

export interface OralQuestion { question: string; key_points: string[]; model_answer: string; source_id: string; quote: string; source: string }
export interface OralScenario { topic: string; false_claim: string; correct_claim: string; why: string; source_id: string; quote: string; source: string }

export const DEFAULT_SCORING = { catch: 2, fix: 1, explain: 1, no_mistake: 4 };

/** Lets uploaded packs reuse everything built for the Calculus pack. */
export function asPack(c: CustomPack): Pack {
  return {
    pack_id: c.id, subject: c.title, pack_version: "custom", content_hash: c.id,
    topics: [{ id: c.id, name: c.title }], misconceptions: c.misconceptions,
    scoring: DEFAULT_SCORING, rounds: c.rounds, exercises: c.exercises,
  };
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
