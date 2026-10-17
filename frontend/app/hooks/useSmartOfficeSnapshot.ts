"use client";

import { useEffect, useState } from "react";
import { ApiService } from "../../lib/api";
import type { SmartOfficeSnapshot } from "../../lib/smart-office";

export function useSmartOfficeSnapshot() {
  const [snapshot, setSnapshot] = useState<SmartOfficeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let requestId = 0;
    let controller: AbortController | undefined;

    const refresh = async (replacePending = false) => {
      if (disposed || document.visibilityState === "hidden") return;
      if (inFlight && !replacePending) return;
      if (replacePending) controller?.abort();
      const id = ++requestId;
      controller = new AbortController();
      inFlight = true;
      try {
        const response = await ApiService.getSmartOffice(controller.signal);
        if (!disposed && id === requestId) {
          setSnapshot(previous => response.data ?? (previous
            ? { ...previous, stale: true, power_stale: true, power_previous: true, ac_minute_stale: true } : null));
          setError(false);
        }
      } catch {
        if (!disposed && id === requestId) setError(true);
      } finally {
        if (!disposed && id === requestId) {
          inFlight = false;
          setLoading(false);
        }
      }
    };

    const resume = () => { void refresh(true); };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") {
        ++requestId;
        inFlight = false;
        controller?.abort();
      } else {
        resume();
      }
    };
    const pageShown = (event: PageTransitionEvent) => {
      if (event.persisted) resume();
    };

    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", pageShown);
    return () => {
      disposed = true;
      ++requestId;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", pageShown);
    };
  }, []);

  return { snapshot, loading, error };
}
