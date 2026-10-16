"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import "./controls.css";

type ControlDevice = { id: string; label: string; group: "lampu" | "ac" };
type CommandState = "on" | "off";
type Notice = { text: string; kind: "success" | "warning" | "error" };

const TARGETS: ControlDevice[] = [
  { id: "WS502_RUANG_UTAMA", label: "Lampu Ruang Utama", group: "lampu" },
  { id: "WS502_RUANG_MAGANG", label: "Lampu Ruang Magang", group: "lampu" },
  { id: "WS502_BU_DINI", label: "Lampu Ruang Direktur USSC", group: "lampu" },
  { id: "WS502_ALL", label: "Semua Lampu", group: "lampu" },
  { id: "AC_KANTOR", label: "AC Kantor", group: "ac" },
];
const TARGET_IDS = new Set(TARGETS.map((device) => device.id));
const UNKNOWN = "Balasan belum dapat dipastikan. Periksa kondisi fisik perangkat sebelum mengulang. Perintah tidak diulang otomatis.";

function detail(body: Record<string, unknown>, fallback: string) {
  return typeof body.detail === "string" && body.detail.length <= 500 ? body.detail : fallback;
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
}

function readDevices(value: unknown): ControlDevice[] | null {
  if (!Array.isArray(value) || value.length !== TARGETS.length) return null;
  const devices: ControlDevice[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (item === null || typeof item !== "object" || typeof item.id !== "string"
      || !TARGET_IDS.has(item.id) || seen.has(item.id) || typeof item.label !== "string"
      || item.label.length > 100 || !["lampu", "ac"].includes(item.group)) return null;
    seen.add(item.id);
    devices.push({ id: item.id, label: item.label, group: item.group });
  }
  return devices;
}

export default function OfficeControls() {
  const [keyInput, setKeyInput] = useState("");
  const [operatorKey, setOperatorKey] = useState("");
  const [devices, setDevices] = useState<ControlDevice[]>(TARGETS);
  const [unlocking, setUnlocking] = useState(false);
  const [pending, setPending] = useState<{ device: string; state: CommandState } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const busyRef = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const unlocked = operatorKey.length > 0;
  const busy = unlocking || pending !== null;

  useEffect(() => () => activeRequest.current?.abort(), []);

  function lock() {
    if (busyRef.current) return;
    setOperatorKey("");
    setKeyInput("");
    setDevices(TARGETS);
    setNotice(null);
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !keyInput) return;
    busyRef.current = true;
    setUnlocking(true);
    setNotice(null);
    const controller = new AbortController();
    activeRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 17_000);
    try {
      const response = await fetch("/api/smart-office/control/devices", {
        headers: { Authorization: `Bearer ${keyInput}` },
        cache: "no-store", credentials: "omit", signal: controller.signal,
      });
      const body = await readBody(response);
      const allowedDevices = readDevices(body.devices);
      if (!response.ok || body.status !== "success" || !allowedDevices) {
        setNotice({ kind: "error", text: detail(body, "Kontrol belum dapat dibuka. Periksa kunci operator atau hubungi administrator.") });
        return;
      }
      setDevices(allowedDevices);
      setOperatorKey(keyInput);
      setKeyInput("");
    } catch {
      setNotice({ kind: "error", text: "Akses kontrol belum dapat diperiksa. Coba kembali saat koneksi tersedia." });
    } finally {
      clearTimeout(timer);
      activeRequest.current = null;
      busyRef.current = false;
      setUnlocking(false);
    }
  }

  async function sendCommand(device: ControlDevice, state: CommandState) {
    if (!operatorKey || busyRef.current) return;
    let requestId: string;
    try {
      requestId = crypto.randomUUID();
    } catch {
      setNotice({ kind: "error", text: "Kontrol belum dapat disiapkan pada browser ini. Hubungi administrator." });
      return;
    }
    busyRef.current = true;
    setPending({ device: device.id, state });
    setNotice(null);
    const controller = new AbortController();
    activeRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 17_000);
    try {
      const response = await fetch("/api/smart-office/control", {
        method: "POST", cache: "no-store", credentials: "omit", signal: controller.signal,
        headers: {
          Authorization: `Bearer ${operatorKey}`, "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        body: JSON.stringify({ device: device.id, state }),
      });
      const body = await readBody(response);
      if (response.ok && body.status === "accepted_by_ug65" && body.device === device.id
        && body.state === state && body.request_id === requestId && body.physical_state_confirmed === false) {
        setNotice({ kind: "success", text: `Perintah ${state.toUpperCase()} ${device.label} diterima UG65. Kondisi fisik belum dikonfirmasi.` });
      } else if (response.ok || body.status === "unknown" || response.status === 504) {
        setNotice({ kind: "warning", text: detail(body, UNKNOWN) });
      } else {
        setNotice({ kind: "error", text: detail(body, "Perintah belum dapat diproses. Periksa kondisi perangkat sebelum mencoba kembali.") });
      }
      if (response.status === 401 || response.status === 403 || response.status === 503) {
        setOperatorKey("");
        setKeyInput("");
      }
    } catch {
      setNotice({ kind: "warning", text: UNKNOWN });
    } finally {
      clearTimeout(timer);
      activeRequest.current = null;
      busyRef.current = false;
      setPending(null);
    }
  }

  return (
    <section className="office-controls-section" aria-labelledby="office-controls-title">
      <div className="section-title">
        <h3 id="office-controls-title">Kontrol Perangkat</h3>
        <span>{unlocked ? "Akses operator aktif" : "Terkunci"}</span>
      </div>
      <div className="location-card office-controls-panel" aria-busy={busy}>
        <div className="office-controls-access">
          <div className="office-controls-access-copy">
            <i className={`bi ${unlocked ? "bi-shield-check" : "bi-lock"}`} aria-hidden="true" />
            <p>{unlocked ? "Kontrol siap digunakan oleh operator." : "Masukkan kunci operator untuk mengakses kontrol."}</p>
          </div>
          {unlocked ? (
            <button className="office-controls-lock" type="button" onClick={lock} disabled={busy}>Kunci kembali</button>
          ) : (
            <form className="office-controls-form" onSubmit={unlock}>
              <label className="office-controls-key-label" htmlFor="office-operator-key">Kunci operator</label>
              <input id="office-operator-key" type="password" autoComplete="off"
                placeholder="Kunci operator" value={keyInput} disabled={busy} required
                onChange={(event) => setKeyInput(event.target.value)} />
              <button className="office-controls-unlock" type="submit" disabled={busy || !keyInput}>
                {unlocking ? "Memeriksa..." : "Buka kontrol"}
              </button>
            </form>
          )}
        </div>
        <div className="office-controls-grid">
          {devices.map((device) => (
            <div className="office-controls-device" key={device.id}>
              <div className="office-controls-device-name">
                <i className={`bi ${device.group === "ac" ? "bi-snow" : "bi-lightbulb"}`} aria-hidden="true" />
                <span>{device.label}</span>
              </div>
              <div className="office-controls-actions">
                <button className="office-controls-on" type="button" disabled={!unlocked || busy}
                  aria-label={`Nyalakan ${device.label}`} onClick={() => sendCommand(device, "on")}>
                  {pending?.device === device.id && pending.state === "on" ? "Mengirim..." : "ON"}
                </button>
                <button className="office-controls-off" type="button" disabled={!unlocked || busy}
                  aria-label={`Matikan ${device.label}`} onClick={() => sendCommand(device, "off")}>
                  {pending?.device === device.id && pending.state === "off" ? "Mengirim..." : "OFF"}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="office-controls-feedback" aria-live="polite" aria-atomic="true">
          {pending && <p className="office-controls-notice office-controls-notice-warning">Mengirim perintah {pending.state.toUpperCase()} dan menunggu balasan...</p>}
          {notice && <p className={`office-controls-notice office-controls-notice-${notice.kind}`}>{notice.text}</p>}
        </div>
        <p className="office-controls-note">Perintah manual mengikuti aturan otomatisasi kantor.</p>
      </div>
    </section>
  );
}
