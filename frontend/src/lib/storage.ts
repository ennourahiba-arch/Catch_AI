// Local-only learning history in IndexedDB. Nothing here is sent to a server,
// and professors never see it.
import type { CustomPack, TopicId } from "./types";

export interface Attempt {
  id?: number;
  roundId: string;
  topic: TopicId;
  ts: number;
  catchCorrect: boolean;
  fixCorrect: boolean | null;
  whyCorrect: boolean | null;
  points: number;
  maxPoints: number;
  mistakeLabel: string | null;
  mode?: "quick" | "home";
  catchAttempts?: number;
  hintsUsed?: number;
}

export interface ExerciseAttempt {
  id?: number;
  exerciseId: string;
  topic: TopicId;
  ts: number;
  attempts: number;
  correct: boolean;     // solved within the allowed attempts
  firstTry: boolean;    // solved on the first attempt
  usedHint: boolean;
}

export interface Confidence {
  id?: number;
  topic: TopicId;
  ts: number;
  rating: 1 | 2 | 3 | 4 | 5;
}

type Store = "attempts" | "exercises" | "confidence";
const DB = "catch-the-ai";
const VERSION = 3;
const memory: Record<Store, unknown[]> & { kv: Record<string, unknown>; packs: Record<string, CustomPack> } = { attempts: [], exercises: [], confidence: [], kv: {}, packs: {} };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ["attempts", "exercises", "confidence"]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addTo<T extends { id?: number }>(store: Store, rec: T): Promise<void> {
  try {
    await tx(store, "readwrite", (s) => s.add(rec));
  } catch {
    memory[store].push({ ...rec, id: memory[store].length + 1 });
  }
}

async function listFrom<T extends { ts: number }>(store: Store): Promise<T[]> {
  let rows: T[];
  try {
    rows = await tx<T[]>(store, "readonly", (s) => s.getAll());
  } catch {
    rows = [...(memory[store] as T[])];
  }
  return rows.sort((a, b) => b.ts - a.ts);
}

export const addAttempt = (a: Attempt) => addTo("attempts", a);
export const listAttempts = () => listFrom<Attempt>("attempts");
export const addExerciseAttempt = (a: ExerciseAttempt) => addTo("exercises", a);
export const listExerciseAttempts = () => listFrom<ExerciseAttempt>("exercises");
export const addConfidence = (c: Confidence) => addTo("confidence", c);
export const listConfidence = () => listFrom<Confidence>("confidence");

export async function getKV<T>(key: string): Promise<T | undefined> {
  try {
    return (await tx<T>("kv", "readonly", (s) => s.get(key))) ?? undefined;
  } catch {
    return memory.kv[key] as T | undefined;
  }
}

export async function setKV(key: string, value: unknown): Promise<void> {
  try {
    await tx("kv", "readwrite", (s) => s.put(value, key));
  } catch {
    memory.kv[key] = value;
  }
}

export async function clearAll(): Promise<void> {
  try {
    for (const s of ["attempts", "exercises", "confidence", "kv", "packs"]) await tx(s, "readwrite", (st) => st.clear());
  } catch {
    memory.attempts = []; memory.exercises = []; memory.confidence = []; memory.kv = {}; memory.packs = {};
  }
}

// ---- Packs generated from uploaded material (kept only on this device) ----
export async function savePack(p: CustomPack): Promise<void> {
  try { await tx("packs", "readwrite", (s) => s.put(p)); } catch { memory.packs[p.id] = p; }
}
export async function getPack(id: string): Promise<CustomPack | undefined> {
  try { return (await tx<CustomPack>("packs", "readonly", (s) => s.get(id))) ?? undefined; } catch { return memory.packs[id]; }
}
export async function listPacks(): Promise<CustomPack[]> {
  let all: CustomPack[];
  try { all = await tx<CustomPack[]>("packs", "readonly", (s) => s.getAll()); } catch { all = Object.values(memory.packs); }
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function deletePack(id: string): Promise<void> {
  try { await tx("packs", "readwrite", (s) => s.delete(id)); } catch { delete memory.packs[id]; }
}

export async function loadHistory() {
  const [attempts, exercises, confidence] = await Promise.all([listAttempts(), listExerciseAttempts(), listConfidence()]);
  return { attempts, exercises, confidence };
}
export type History = Awaited<ReturnType<typeof loadHistory>>;
