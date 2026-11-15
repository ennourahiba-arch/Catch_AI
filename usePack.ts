import { useCallback, useEffect, useState } from "react";
import { loadPack } from "../lib/pack";
import type { Pack } from "../lib/types";

export function usePack() {
  const [pack, setPack] = useState<Pack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    loadPack().then(setPack).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  return { pack, error, retry: load };
}
