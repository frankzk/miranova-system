"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { BankEntry } from "@/lib/reconciliation";
import { BankMatchForm } from "./reconciliation-forms";
import { IconChevronDown, IconClose } from "./icons";

/** Selector junto al abono. El portal evita que la tabla recorte las opciones. */
export function BankLinkPicker({
  mercury,
  candidates,
}: {
  mercury: BankEntry;
  candidates: BankEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    top: 8,
    left: 8,
    width: 500,
    maxHeight: 600,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(500, window.innerWidth - 24);
      const maxHeight = Math.min(680, window.innerHeight - 24);
      const height = Math.min(
        panel.current?.scrollHeight ?? maxHeight,
        maxHeight,
      );
      const top = Math.max(
        12,
        Math.min(rect.bottom + 8, window.innerHeight - height - 12),
      );
      setPosition({
        top,
        left: Math.max(
          12,
          Math.min(rect.right - width, window.innerWidth - width - 12),
        ),
        width,
        maxHeight,
      });
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node) || !panel.current?.contains(e.target))
        place();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLInputElement>('input[type="search"]')
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const focus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", focus);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn bank-link-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Vincular Boxful al abono ${mercury.reference}`}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m6 10 4-4M5.5 6.5 4 8a2.8 2.8 0 0 0 4 4l1.5-1.5M6.5 5.5 8 4a2.8 2.8 0 0 1 4 4l-1.5 1.5" />
        </svg>
        Vincular Boxful <span className="tag">{candidates.length}</span>
        <IconChevronDown />
      </button>
      {open &&
        createPortal(
          <div
            className="bank-link-popover"
            role="dialog"
            aria-modal="false"
            aria-labelledby={`${id}-title`}
            id={id}
            ref={panel}
            style={{ position: "fixed", ...position }}
          >
            <div className="bank-link-head">
              <div>
                <h2 id={`${id}-title`}>Vincular transferencia Boxful</h2>
                <p>Elige el comprobante de este abono.</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label="Cerrar selector Boxful"
                onClick={close}
              >
                <IconClose />
              </button>
            </div>
            <div className="bank-link-body">
              <BankMatchForm
                mercury={mercury}
                candidates={candidates}
                onLinked={close}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
