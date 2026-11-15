"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reviewAnalysisResponseSchema, type ReviewAnalysisResponse } from "../domain/review-analysis";

export function useReviewAnalysis(restaurantId: string, sourceKey: string, active: boolean, unlocked: boolean) {
  const [state, setState] = useState<ReviewAnalysisResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const latest = useRef(0);
  useEffect(() => {
    if (!active) return;
    const run = ++latest.current;
    const controller = new AbortController();
    async function request(method: "GET" | "POST") {
      const response = await fetch(`/api/tactical/reviews/analysis${method === "GET" ? `?restaurantId=${encodeURIComponent(restaurantId)}` : ""}`, {
        method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurantId }) } : {}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(80_000)]),
      });
      if (!response.ok) throw new Error("Something is wrong");
      return reviewAnalysisResponseSchema.parse(await response.json());
    }
    async function load() {
      setPending(true); setError(false);
      try {
        let current = await request("GET");
        if (controller.signal.aborted || run !== latest.current) return;
        setState(current);
        let stalled = 0;
        while (unlocked && current.storage === "mongodb" && current.pending > 0) {
          const before = current.pending;
          current = await request("POST");
          if (controller.signal.aborted || run !== latest.current) return;
          setState(current);
          stalled = current.pending >= before ? stalled + 1 : 0;
          if (stalled >= 45) throw new Error("Something is wrong");
          if (current.pending >= before) await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new Error("Cancelled")); };
            const timer = setTimeout(() => { controller.signal.removeEventListener("abort", abort); resolve(); }, 2000);
            controller.signal.addEventListener("abort", abort, { once: true });
          });
        }
      } catch { if (!controller.signal.aborted && run === latest.current) setError(true); }
      finally { if (!controller.signal.aborted && run === latest.current) setPending(false); }
    }
    void load();
    return () => { controller.abort(); };
  }, [restaurantId, sourceKey, active, unlocked, attempt]);
  return { state, pending, error, refresh };
}
