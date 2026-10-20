import { useEffect, useRef, useState } from "react";
import type { CompanyState, EngineStatus } from "@narthex/core";

/** Live company state: fetched once, refreshed (throttled) after every engine event. */
export function useCompany(): { state: CompanyState | null | undefined; status: EngineStatus | undefined; refresh(): void } {
  const [state, setState] = useState<CompanyState | null | undefined>(undefined);
  const [status, setStatus] = useState<EngineStatus>();
  const [tick, setTick] = useState(0);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([window.narthex.call("state.get", {}), window.narthex.call("engine.status", {})]).then(([s, st]) => {
      if (!alive) return;
      setState(s);
      setStatus(st);
      shown.current = st.companyId;
    });
    return () => {
      alive = false;
    };
  }, [tick]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = window.narthex.onEvent((event) => {
      // Other companies keep working in the background: only the one shown refreshes the screen.
      if (shown.current && event.companyId !== shown.current) return;
      timer ??= setTimeout(() => {
        timer = undefined;
        setTick((t) => t + 1);
      }, 150);
    });
    // Relative times ("il y a 3 min") stay true.
    const clock = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => {
      off();
      clearInterval(clock);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { state, status, refresh: () => setTick((t) => t + 1) };
}
