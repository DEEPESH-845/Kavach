'use client';

/* Server state, kept out of React state where it can go stale.
 *
 * Deliberately not a state library. There are four things this app needs from one --
 * load, error, refresh, and drop a response that arrived after a newer request -- and all
 * four fit here. Adding TanStack Query for them would be a dependency and a cache to
 * reason about in exchange for nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export type Async<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True only on the first load, so a refresh does not blank the screen. */
  initial: boolean;
  reload: () => void;
};

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState(true);
  const [nonce, setNonce] = useState(0);

  // Monotonic request id. Without it a slow first request can land after a fast second
  // one and overwrite fresher data with older data -- rare, and impossible to reproduce
  // when someone reports it.
  const latest = useRef(0);
  const alive = useRef(true);
  const run = useRef(fetcher);
  run.current = fetcher;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    run.current()
      .then((value) => {
        if (!alive.current || id !== latest.current) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive.current || id !== latest.current) return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)));
      })
      .finally(() => {
        if (!alive.current || id !== latest.current) return;
        setLoading(false);
        setInitial(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, initial, reload };
}

/** Re-run on an interval while the tab is visible. */
export function usePoll(reload: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled || ms <= 0) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => { timer ??= setInterval(reload, ms); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    // A background tab polling a payments API is spend with no reader. Stop when hidden.
    const onVisibility = () => (document.hidden ? stop() : (reload(), start()));

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [reload, ms, enabled]);
}

/** One-shot action (a POST) with its own pending and error state.
 *
 * `fn` is held in a ref that is refreshed on every render, and `call` is memoised with no
 * dependencies. Both halves are load-bearing: a stable `call` keeps it usable in effects
 * and props without re-subscribing, while the ref is what stops it freezing the closure.
 *
 * Memoising `call` around `fn` directly is the bug this shape exists to prevent, and it is
 * not theoretical -- it shipped here. The Agent Gate captured the cart from its first
 * render, so selecting a different cart and submitting posted the ORIGINAL one: the screen
 * showed ALLOW over a cart it had not evaluated. On a screen whose entire job is to report
 * what the backend decided, that is the worst possible failure.
 */
export function useAction<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<T | null>(null);

  const run = useRef(fn);
  run.current = fn;

  const call = useCallback(async (...args: A): Promise<T | null> => {
    setPending(true);
    setError(null);
    try {
      const out = await run.current(...args);
      setResult(out);
      return out;
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)));
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => { setResult(null); setError(null); }, []);
  return { call, pending, error, result, reset };
}
