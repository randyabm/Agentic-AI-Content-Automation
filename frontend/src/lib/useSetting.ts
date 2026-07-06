import { useEffect, useState } from "react";
import { api } from "../api";
import type { Setting } from "../types";

// Module-level cache so multiple components don't each refetch /settings.
let cache: Promise<Setting[]> | null = null;

function loadSettings(): Promise<Setting[]> {
  if (!cache) cache = api<Setting[]>("/settings").catch((e) => { cache = null; throw e; });
  return cache;
}

/** Read a boolean platform setting. Returns `fallback` until loaded / on error. */
export function useBoolSetting(key: string, fallback: boolean): boolean {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((settings) => {
        if (!alive) return;
        const row = settings.find((s) => s.key === key);
        setValue(row ? row.value === "true" : fallback);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [key, fallback]);
  return value;
}

/** Whether the Negative prompt field/feature is enabled (default ON). */
export function useNegativePromptEnabled(): boolean {
  return useBoolSetting("negative_prompt_enabled", true);
}
