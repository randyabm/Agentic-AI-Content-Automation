import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, decodeJwtExp, hasSession, setTokens, tryRefresh } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

/** How long before access token expiry we trigger a pre-emptive refresh. */
const REFRESH_LEAD_MS = 60_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<number | null>(null);

  function clearRefreshTimer() {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }

  function schedulePreemptiveRefresh() {
    clearRefreshTimer();
    if (typeof window === "undefined") return;
    const exp = decodeJwtExp(localStorage.getItem("access_token"));
    if (!exp) return;
    const delay = exp - Date.now() - REFRESH_LEAD_MS;
    // Only schedule if we'd fire in the future, and don't fire if the lead
    // time is in the past (token already expired — let the next request's
    // reactive refresh handle it).
    if (delay <= 0) return;
    refreshTimerRef.current = window.setTimeout(async () => {
      // Don't waste a refresh on a hidden tab; the next visible request will
      // trigger the reactive refresh path.
      if (document.visibilityState === "visible" && hasSession()) {
        const ok = await tryRefresh();
        if (ok) schedulePreemptiveRefresh();
      }
    }, delay);
  }

  useEffect(() => {
    if (!hasSession()) {
      setLoading(false);
      return;
    }
    schedulePreemptiveRefresh();
    api<User>("/auth/me")
      .then((u) => {
        setUser(u);
        schedulePreemptiveRefresh();
      })
      .catch(() => {
        clearRefreshTimer();
        setTokens(null, null);
      })
      .finally(() => setLoading(false));
    return () => clearRefreshTimer();
  }, []);

  async function login(email: string, password: string) {
    const tokens = await api<{ access_token: string; refresh_token: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setTokens(tokens.access_token, tokens.refresh_token);
    setUser(await api<User>("/auth/me"));
    schedulePreemptiveRefresh();
  }

  function logout() {
    clearRefreshTimer();
    setTokens(null, null);
    setUser(null);
    window.location.href = "/login";
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
