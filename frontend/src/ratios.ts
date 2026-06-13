import type { PlatformSpec } from "./types";

// Tie-break order when several ratios cover the same number of platforms.
// Mirrors backend app/services/platforms.py::resolve_platform_ratios.
export const RATIO_PRIORITY = ["1:1", "4:5", "9:16", "16:9", "1.91:1"];

/** Assign one aspect ratio per platform, minimizing distinct ratios (greedy set
 * cover). Overrides pin a platform to a ratio it supports. */
export function resolvePlatformRatios(
  platforms: string[],
  specs: PlatformSpec[],
  overrides: Record<string, string> = {},
): Record<string, string> {
  const supported = (p: string) => specs.find((s) => s.platform === p)?.aspect_ratios ?? [];
  const resolved: Record<string, string> = {};
  let remaining: string[] = [];
  for (const p of platforms) {
    const o = overrides[p];
    if (o && supported(p).includes(o)) resolved[p] = o;
    else remaining.push(p);
  }
  while (remaining.length > 0) {
    const candidates = Array.from(new Set([...Object.values(resolved), ...RATIO_PRIORITY]));
    let best = "";
    let covered: string[] = [];
    for (const ratio of candidates) {
      const takes = remaining.filter((p) => supported(p).includes(ratio));
      if (takes.length > covered.length) {
        best = ratio;
        covered = takes;
      }
    }
    if (!best) {
      best = supported(remaining[0])[0] ?? "1:1";
      covered = [remaining[0]];
    }
    for (const p of covered) resolved[p] = best;
    remaining = remaining.filter((p) => !covered.includes(p));
  }
  return resolved;
}
