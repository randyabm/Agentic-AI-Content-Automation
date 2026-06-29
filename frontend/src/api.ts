const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

let accessToken: string | null = localStorage.getItem("access_token");
let refreshToken: string | null = localStorage.getItem("refresh_token");

/** BroadcastChannel name used to sync token rotations across tabs. */
const TOKEN_CHANNEL_NAME = "auth:tokens";
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(TOKEN_CHANNEL_NAME) : null;

interface TokensUpdatedEvent {
  type: "updated";
  access: string | null;
  refresh: string | null;
  origin: string;
}

const TAB_ORIGIN = Math.random().toString(36).slice(2);

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem("access_token", access);
  else localStorage.removeItem("access_token");
  if (refresh) localStorage.setItem("refresh_token", refresh);
  else localStorage.removeItem("refresh_token");
  if (channel) {
    const evt: TokensUpdatedEvent = { type: "updated", access, refresh, origin: TAB_ORIGIN };
    channel.postMessage(evt);
  }
}

export function hasSession(): boolean {
  return accessToken !== null;
}

/** Decode a JWT and return its `exp` claim as a millisecond timestamp, or null. */
export function decodeJwtExp(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(json);
    return typeof data.exp === "number" ? data.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function syncTokensFromStorage() {
  accessToken = localStorage.getItem("access_token");
  refreshToken = localStorage.getItem("refresh_token");
}

if (channel) {
  channel.addEventListener("message", (e) => {
    const data = e.data as TokensUpdatedEvent | undefined;
    if (!data || data.type !== "updated" || data.origin === TAB_ORIGIN) return;
    syncTokensFromStorage();
  });
} else {
  window.addEventListener("storage", (e) => {
    if (e.key === "access_token" || e.key === "refresh_token") {
      syncTokensFromStorage();
    }
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  // Up to 3 attempts: the first may fail with 401 because another tab already
  // rotated the refresh token (single-use). Wait briefly, re-read localStorage
  // (the other tab has written the new pair), and retry with that.
  const backoffs = [0, 200, 500];
  for (let i = 0; i < backoffs.length; i++) {
    if (backoffs[i] > 0) {
      await sleep(backoffs[i]);
      syncTokensFromStorage();
    }
    if (!refreshToken) return false;
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (res.ok) {
      const data = await res.json();
      setTokens(data.access_token, data.refresh_token);
      return true;
    }
    // 401/403 = refresh token rejected (revoked, expired, unknown). If we have
    // more attempts left, loop again to pick up a fresher token from storage.
    if (res.status !== 401 && res.status !== 403) {
      setTokens(null, null);
      return false;
    }
  }
  setTokens(null, null);
  return false;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });

  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (await tryRefresh()) return api<T>(path, options, true);
    window.location.href = "/login";
    throw new ApiError(401, "Session expired");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let body: unknown = null;
    try {
      body = await res.json();
      const data = body as { detail?: unknown };
      if (typeof data.detail === "string") message = data.detail;
      else if (data.detail) message = JSON.stringify(data.detail);
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Fetch a protected binary resource (image, export) as a Blob, with token refresh. */
export async function apiBlob(path: string, retried = false): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (res.status === 401 && !retried) {
    if (await tryRefresh()) return apiBlob(path, true);
    window.location.href = "/login";
    throw new ApiError(401, "Session expired");
  }
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
  return res.blob();
}

/** Trigger a browser download of a protected file (campaign export). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { API_URL };
