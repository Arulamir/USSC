"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

type Props = {
  label: string;
  value: "on" | "off" | "mixed" | null;
  disabled: boolean;
  pending: "on" | "off" | null;
  onChange: (state: "on" | "off") => void;
};

export default function DeviceStateSlider({ label, value, disabled, pending, onChange }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const gesture = useRef<{ id: number; startX: number; start: number; travel: number } | null>(null);
  const selected = pending ?? value;
  const settled = selected === "on" ? 1 : selected === "off" ? 0 : 0.5;
  const position = drag ?? settled;
  const neutral = drag == null && selected !== "on" && selected !== "off";
  const color = neutral ? "#64748b" : `rgb(${Math.round(220 - 216 * position)}, ${Math.round(38 + 82 * position)}, ${Math.round(38 + 49 * position)})`;

  function start(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !event.isPrimary || gesture.current) return;
    gesture.current = { id: event.pointerId, startX: event.clientX, start: settled,
      travel: (event.currentTarget.getBoundingClientRect().width - 8) / 2 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || disabled) return;
    const delta = event.clientX - current.startX;
    if (Math.abs(delta) > 5) setDrag(Math.max(0, Math.min(1, current.start + delta / current.travel)));
  }

  function cancel() { gesture.current = null; setDrag(null); }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const delta = event.clientX - current.startX;
    const endpoint = Math.max(0, Math.min(1, current.start + delta / current.travel));
    cancel();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const next = endpoint >= 0.8 ? "on" : endpoint <= 0.2 ? "off" : null;
    if (!disabled && Math.abs(delta) >= 12 && next && next !== value) onChange(next);
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const next = event.key === "ArrowRight" || event.key === "End" ? "on"
      : event.key === "ArrowLeft" || event.key === "Home" ? "off" : null;
    if (!next) return;
    event.preventDefault();
    if (next !== value) onChange(next);
  }

  const text = pending ? `Mengirim ${pending.toUpperCase()}` : value === "mixed" ? "Sebagian ON, sebagian OFF"
    : value ? value.toUpperCase() : "Status belum tersedia";
  return (
    <div role="slider" tabIndex={disabled ? -1 : 0} aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position * 100)}
      aria-valuetext={text} aria-disabled={disabled} aria-busy={Boolean(pending)}
      className={`office-state-slider${drag != null ? " is-dragging" : ""}${neutral ? " is-neutral" : ""}`}
      style={{ "--slider-position": position, "--slider-color": color } as CSSProperties}
      onPointerDown={start} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={keyboard}
      title="Geser ke kiri untuk OFF atau ke kanan untuk ON. Keyboard: panah kiri/kanan.">
      <span className={`office-state-slider-label${!neutral && position < 0.5 ? " is-selected" : ""}`}>OFF</span>
      <span className={`office-state-slider-label${!neutral && position >= 0.5 ? " is-selected" : ""}`}>ON</span>
      <span className="office-state-slider-thumb" aria-hidden="true">
        {pending ? <i className="bi bi-arrow-repeat" /> : <span className="office-state-slider-grip" />}
      </span>
    </div>
  );
}
