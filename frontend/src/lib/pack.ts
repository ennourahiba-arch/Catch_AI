import type { Pack } from "./types";

let cached: Promise<Pack> | null = null;

export function loadPack(): Promise<Pack> {
  if (!cached) {
    cached = fetch("/packs/calculus1.json")
      .then((r) => {
        if (!r.ok) throw new Error(`The question bank could not be loaded (HTTP ${r.status}).`);
        return r.json() as Promise<Pack>;
      })
      .catch((e) => {
        cached = null; // allow retry
        throw e;
      });
  }
  return cached;
}
