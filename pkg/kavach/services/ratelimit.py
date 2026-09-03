"""A token bucket per caller, in process. Stdlib only.

For the handful of endpoints a stranger can drive from a QR code or a demo button: step-up
resolution, checkout, the MCP surface, demo reset. It bounds abuse of one process; it is not
a substitute for an edge rate limit in front of many.
ponytail: per-process dict; move to the edge or a shared store when there is more than one.
"""

from __future__ import annotations

import threading
import time


class Bucket:
    def __init__(self, per_minute: int, burst: int | None = None):
        self.rate = per_minute / 60.0
        self.capacity = float(burst or per_minute)
        self._state: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            tokens, last = self._state.get(key, (self.capacity, now))
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            if tokens < 1.0:
                self._state[key] = (tokens, now)
                return False
            self._state[key] = (tokens - 1.0, now)
            if len(self._state) > 10_000:
                stale = [k for k, (_, t) in self._state.items() if now - t > 600]
                for k in stale:
                    del self._state[k]
            return True
