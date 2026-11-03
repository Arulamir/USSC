"use client";

import { useEffect, useRef, useState } from "react";

export type DeviceReport = {
  state: "on" | "off" | "mixed" | null;
  source: "ws502_relay" | "tasmota_ir_sent" | "tasmota_ir_received" | null;
  observed_at_utc: string | null;
  stale: boolean;
};
const ids = ["WS502_RUANG_UTAMA", "WS502_RUANG_MAGANG", "WS502_BU_DINI", "WS502_ALL", "AC_KANTOR"];

function reports(value: unknown): Record<string, DeviceReport> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, DeviceReport> = {};
  for (const id of ids) {
    const row = (value as Record<string, unknown>)[id];
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const data = row as Record<string, unknown>;
    if (!["on", "off", "mixed", null].includes(data.state as string | null)
      || !["ws502_relay", "tasmota_ir_sent", "tasmota_ir_received", null].includes(data.source as string | null)
      || typeof data.stale !== "boolean" || (data.observed_at_utc !== null
        && (typeof data.observed_at_utc !== "string" || !Number.isFinite(Date.parse(data.observed_at_utc))))) return null;
    if (data.state != null && (!data.source || data.observed_at_utc == null)) return null;
    if (id === "AC_KANTOR" ? data.source === "ws502_relay" : data.source != null && data.source !== "ws502_relay") return null;
    result[id] = data as DeviceReport;
  }
  return result;
}

export function useOfficeDeviceStates(operatorKey: string) {
  const [states, setStates] = useState<Record<string, DeviceReport>>({});
  const [error, setError] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!operatorKey) { refreshRef.current = () => {}; return; }
    let disposed = false, inFlight = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      inFlight = true; controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), 7000);
      try {
        const response = await fetch("/api/smart-office/control/states", {
          headers: { Authorization: `Bearer ${operatorKey}` }, cache: "no-store", credentials: "omit", signal: controller.signal,
        });
        const body = await response.json();
        const parsed = reports(body?.states);
        if (!response.ok || body?.status !== "success" || !parsed) throw Error("State unavailable");
        if (!disposed) { setStates(parsed); setError(false); }
      } catch {
        if (!disposed) {
          setError(true);
          setStates(previous => Object.fromEntries(Object.entries(previous).map(([id, row]) => [id, { ...row, stale: true }])));
        }
      } finally { clearTimeout(timer); inFlight = false; }
    };
    const resume = () => { void refresh(); };
    refreshRef.current = resume;
    void refresh();
    const interval = setInterval(resume, 5000);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true; controller?.abort(); clearInterval(interval);
      window.removeEventListener("focus", resume); window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [operatorKey]);
  return { states, error, refresh: () => refreshRef.current() };
}
