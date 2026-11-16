// Mirrors content/rehearsal/build_pack.py (Calculus) and backend/app/genpack.py (uploads).
export type TopicId = string;

export type ExerciseAnswer =
  | { kind: "expression"; coeffs: Record<string, string> }
  | { kind: "points"; values: string[] }
  | { kind: "extremum"; extremum: "max" | "min"; value: string; at: string[] }
  | { kind: "mcq"; correct: number }
  | { kind: "open"; key_points: string[]; model_answer: string };

export interface SolutionLine { text: string; latex: string; quote?: string; source?: string }

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
  /** uploaded multiple choice */
  options?: string[];
  labels?: (string | null)[];
  answer_text?: string;
  source_ids?: string[];
  provenance?: string;
  /** Calculus: verified multiple-choice version used in class quizzes */
  mcq?: { prompt: string; options: string[]; labels: (string | null)[]; correct: number };
  verification?: { checker: string; status: string };
}

export interface Pack {
  pack_id: string;
  subject: string;
  pack_version: string;
  content_hash: string;
  topics: { id: TopicId; name: string }[];
  exercises: Exercise[];
}

export interface ExamProfile {
  question_types: string[];
  duration_minutes: number | null;
  number_of_questions: number | null;
  notes: string;
}

/** A question bank generated from the user's own material. Lives in IndexedDB only. */
export interface CustomPack {
  id: string;
  version?: number; // 2 for question banks; older packs were "catch the AI" rounds
  title: string;
  format: "quiz" | "written" | "oral";
  created_at: string;
  generator: { provider: string | null; model: string; test_mode: boolean };
  exercises: Exercise[];
  exam_profile: ExamProfile | null;
  dropped: string[];
  passages: { id: string; file: string; text: string }[];
  sources: string[];
  approved?: string[]; // question ids a professor approved for class
}

export const isCurrentPack = (p: CustomPack) => p.version === 2 && Array.isArray(p.exercises);

export function asPack(c: CustomPack): Pack {
  return { pack_id: c.id, subject: c.title, pack_version: "custom", content_hash: c.id, topics: [{ id: c.id, name: c.title }], exercises: c.exercises };
}
