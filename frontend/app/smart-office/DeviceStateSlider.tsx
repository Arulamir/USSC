"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

type Props = {
  label: string;
  value: "on" | "off" | "mixed" | null;
  disabled: boolean;
  pending: "on" | "off" | null;
  onChange: (state: "on" | "off", requestedAt: number) => void;
};

export default function DeviceStateSlider({ label, value, disabled, pending, onChange }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const gesture = useRef<{ id: number; startX: number; start: number; travel: number } | null>(null);
  const suppressClick = useRef(false);
  const selected = pending ?? value;
  const settled = selected === "on" ? 0 : selected === "off" ? 1 : 0.5;
  const position = drag ?? settled;
  const neutral = drag == null && selected !== "on" && selected !== "off";
  const color = neutral ? "#64748b" : `rgb(${Math.round(4 + 216 * position)}, ${Math.round(120 - 82 * position)}, ${Math.round(87 - 49 * position)})`;

  function choose(next: "on" | "off", eventTime: number) {
    const requestedAt = eventTime > 1e12 ? eventTime : performance.timeOrigin + eventTime;
    if (!disabled && next !== selected) onChange(next, requestedAt);
  }

  function click(event: MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    choose(event.clientX < bounds.left + bounds.width / 2 ? "on" : "off", event.timeStamp);
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !event.isPrimary || gesture.current) return;
    suppressClick.current = false;
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

  function cancel() {
    if (gesture.current) suppressClick.current = true;
    gesture.current = null;
    setDrag(null);
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const delta = event.clientX - current.startX;
    const endpoint = Math.max(0, Math.min(1, current.start + delta / current.travel));
    suppressClick.current = Math.abs(delta) > 5;
    gesture.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const next = endpoint >= 0.8 ? "off" : endpoint <= 0.2 ? "on" : null;
    if (Math.abs(delta) >= 12 && next) choose(next, event.timeStamp);
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const next = event.key === "ArrowLeft" || event.key === "Home" ? "on"
      : event.key === "ArrowRight" || event.key === "End" ? "off"
      : event.key === " " || event.key === "Enter" ? selected === "on" ? "off" : "on" : null;
    if (!next) return;
    event.preventDefault();
    choose(next, event.timeStamp);
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
      onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={keyboard} onClick={click}
      title="Klik ON di kiri atau OFF di kanan. Bisa juga digeser atau memakai panah kiri/kanan.">
      <span className={`office-state-slider-label${!neutral && position < 0.5 ? " is-selected" : ""}`}>ON</span>
      <span className={`office-state-slider-label${!neutral && position >= 0.5 ? " is-selected" : ""}`}>OFF</span>
      <span className="office-state-slider-thumb" aria-hidden="true">
        {pending ? <i className="bi bi-arrow-repeat" /> : <span className="office-state-slider-grip" />}
      </span>
    </div>
  );
}
