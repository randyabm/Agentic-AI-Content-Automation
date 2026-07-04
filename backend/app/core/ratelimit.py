"""In-memory sliding-window rate limiting for unauthenticated auth endpoints.

Single-process only (each uvicorn worker keeps its own counters), which is
enough to blunt online brute force against login / password-reset. If the
deployment ever scales to multiple API replicas, move the counters to Redis.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
    def __init__(self, max_hits: int, window_seconds: float):
        self.max_hits = max_hits
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.max_hits:
                return False
            q.append(now)
            # Opportunistic cleanup so the dict doesn't grow unbounded.
            if len(self._hits) > 10_000:
                stale = [k for k, v in self._hits.items() if not v or now - v[-1] > self.window]
                for k in stale:
                    del self._hits[k]
            return True


def client_ip(request: Request) -> str:
    # Behind the reverse proxy the peer address is the proxy; the original
    # client is the first hop in X-Forwarded-For (set by nginx).
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(limiter: SlidingWindowLimiter, scope: str):
    """FastAPI dependency: apply `limiter` per client IP."""

    def checker(request: Request) -> None:
        if not limiter.allow(f"{scope}:{client_ip(request)}"):
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many attempts. Try again in a few minutes.",
            )

    return checker
