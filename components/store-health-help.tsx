"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HEALTH, type Health } from "@/lib/stores";
import styles from "./store-health-help.module.css";

/** Shared by filters and badges. The help button never activates a filter. */
export function StoreHealthHelp({ health, children }: { health: Health; children?: ReactNode }) {
  const info = HEALTH[health];
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const dismissed = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  function cancelClose() {
    if (timer.current) clearTimeout(timer.current);
  }
  function close() {
    cancelClose();
    pinned.current = false;
    setOpen(false);
  }
  function enter() {
    cancelClose();
    if (!dismissed.current) setOpen(true);
  }
  function leave() {
    dismissed.current = false;
    cancelClose();
    timer.current = setTimeout(() => {
      if (!pinned.current && document.activeElement !== trigger.current) setOpen(false);
    }, 160);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!anchor.current || !panel.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const box = panel.current.getBoundingClientRect();
      const below = rect.bottom + 8;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - box.width - 12)),
        top: Math.max(12, Math.min(
          below + box.height <= window.innerHeight - 12 ? below : rect.top - box.height - 8,
          window.innerHeight - box.height - 12,
        )),
      });
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.dispatchEvent(new CustomEvent("store-health-help-open", { detail: id }));
    function otherHelp(event: Event) {
      if ((event as CustomEvent<string>).detail !== id) {
        pinned.current = false;
        setOpen(false);
      }
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) {
        pinned.current = false;
        setOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Let Escape dismiss the explanation before a surrounding store drawer.
        event.stopPropagation();
        dismissed.current = true;
        pinned.current = false;
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("store-health-help-open", otherHelp);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("store-health-help-open", otherHelp);
    };
  }, [open, id]);

  return (
    <span ref={anchor} className={styles.anchor}
      onPointerEnter={(e) => { if (e.pointerType === "mouse") enter(); }}
      onPointerLeave={leave}>
      {children}
      <button ref={trigger} type="button"
        className={children ? styles.info : `pill ${styles.badge}`}
        data-tone={info.tone}
        aria-label={`Qué significa ${info.label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => { dismissed.current = false; enter(); }}
        onBlur={() => { dismissed.current = false; close(); }}
        onClick={() => {
          cancelClose();
          dismissed.current = false;
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}>
        {!children && info.label}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <circle cx="8" cy="8" r="6" /><path d="M8 7v4" /><circle cx="8" cy="4.7" r=".7" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={panel} id={id} role="tooltip" className={styles.panel} style={position}
          onPointerEnter={enter} onPointerLeave={leave}>
          <strong><span className="dot" data-tone={info.tone} />{info.label}</strong>
          <p>{info.description}</p>
          <p className={styles.example}>{info.example}</p>
          <p className={styles.note}>El estado siempre mira los últimos 7 días y los compara con los 7 anteriores, aunque elijas otro período en la tabla. Se basa en pedidos de la tienda, no en compras de inventario ni pagos.</p>
        </div>, document.body,
      )}
    </span>
  );
}

export function HealthPill({ h, passive = false }: { h: Health; passive?: boolean }) {
  // A badge inside a store link must not introduce a nested button.
  if (passive) return <span className="pill" data-tone={HEALTH[h].tone} title={HEALTH[h].hint}>{HEALTH[h].label}</span>;
  return <StoreHealthHelp health={h} />;
}
