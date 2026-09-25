"use client";

import { useFormStatus } from "react-dom";

/** Botón que se bloquea y muestra un texto mientras la acción del formulario trabaja. */
export function SubmitButton({
  children,
  pending: pendingText = "Procesando…",
  className = "btn",
  disabled,
}: {
  children: React.ReactNode;
  pending?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? <><span className="spinner" aria-hidden /> {pendingText}</> : children}
    </button>
  );
}
