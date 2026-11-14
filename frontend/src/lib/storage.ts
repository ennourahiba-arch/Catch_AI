// Local-only learning history in IndexedDB. Nothing here is sent to a server.
import type { TopicId } from "./types";

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
}

const DB = "catch-the-ai";
const VERSION = 1;
let memory: { attempts: Attempt[]; kv: Record<string, unknown> } | null = null;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("attempts")) db.createObjectStore("attempts", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
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

// Falls back to in-memory storage (e.g. private browsing without IndexedDB).
function mem() {
  if (!memory) memory = { attempts: [], kv: {} };
  return memory;
}

export async function addAttempt(a: Attempt): Promise<void> {
  try {
    await tx("attempts", "readwrite", (s) => s.add(a));
  } catch {
    mem().attempts.push({ ...a, id: mem().attempts.length + 1 });
  }
}

export async function listAttempts(): Promise<Attempt[]> {
  try {
    return (await tx<Attempt[]>("attempts", "readonly", (s) => s.getAll())).sort((a, b) => b.ts - a.ts);
  } catch {
    return [...mem().attempts].sort((a, b) => b.ts - a.ts);
  }
}

export async function getKV<T>(key: string): Promise<T | undefined> {
  try {
    return (await tx<T>("kv", "readonly", (s) => s.get(key))) ?? undefined;
  } catch {
    return mem().kv[key] as T | undefined;
  }
}

export async function setKV(key: string, value: unknown): Promise<void> {
  try {
    await tx("kv", "readwrite", (s) => s.put(value, key));
  } catch {
    mem().kv[key] = value;
  }
}

export async function clearAll(): Promise<void> {
  try {
    await tx("attempts", "readwrite", (s) => s.clear());
    await tx("kv", "readwrite", (s) => s.clear());
  } catch {
    memory = null;
  }
}
