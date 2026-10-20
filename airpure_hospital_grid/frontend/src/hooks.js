import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch on mount / dep change; exposes loading, error, reload. Ignores out-of-order responses. */
export function useApi(fn, deps = []) {
  const [state, set] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    set((s) => ({ ...s, loading: true, error: null }));
    return fn().then(
      (data) => { if (id === seq.current) set({ data, loading: false, error: null }); },
      (error) => { if (id === seq.current) set((s) => ({ data: s.data, loading: false, error })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); return () => { seq.current++; }; }, [run]);
  return { ...state, reload: run };
}

/** setInterval that always calls the newest callback and cleans up on unmount. */
export function useInterval(cb, ms, active) {
  const ref = useRef(cb); ref.current = cb;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, active]);
}
