import { apiBlob } from "../api";

const MAX_ENTRIES = 200;
const cache = new Map<string, Promise<string>>();

/** Cheap deterministic hash for cache-busting version strings. */
export function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Get a blob object URL for a path, with module-level memoization.
 * Dedupes concurrent and repeat fetches. Object URLs are reused across
 * components and only revoked when evicted from the LRU cache or invalidated.
 *
 * The caller should include a `?v=<version>` query param so the cache key
 * changes when the underlying image changes (regeneration, canvas edit, etc.).
 */
export function getBlobUrl(path: string): Promise<string> {
  if (!path) return Promise.resolve("");

  const cached = cache.get(path);
  if (cached) {
    cache.delete(path);
    cache.set(path, cached);
    return cached;
  }

  const promise = apiBlob(path)
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => {
      cache.delete(path);
      return "";
    });

  cache.set(path, promise);

  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      const oldPromise = cache.get(oldest);
      cache.delete(oldest);
      oldPromise?.then((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    }
  }

  return promise;
}

/** Invalidate a cached entry (e.g. after image regeneration). */
export function invalidateBlobUrl(path: string): void {
  const promise = cache.get(path);
  cache.delete(path);
  promise?.then((url) => {
    if (url) URL.revokeObjectURL(url);
  });
}

/** Clear all cached blob URLs (e.g. on logout). */
export function clearBlobCache(): void {
  for (const promise of cache.values()) {
    promise.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  cache.clear();
}
