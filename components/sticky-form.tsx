"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * <form> para acciones con useActionState que no pierde lo escrito si la acción responde con un
 * error: React 19 vacía los campos al terminar cada acción, así que se guardan al enviar y se
 * devuelven si el resultado no fue ok. Los campos ocultos y de archivo no se tocan.
 */
export function StickyForm({
  state, ref, onSubmit, children, ...props
}: Omit<React.ComponentProps<"form">, "action"> & { action: (fd: FormData) => void; state: { ok: boolean } | null }) {
  const own = useRef<HTMLFormElement | null>(null);
  const last = useRef<[string, string][] | null>(null);
  const setRef = useCallback(
    (el: HTMLFormElement | null) => {
      own.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  useEffect(() => {
    const form = own.current;
    const values = last.current;
    if (!form || !values || !state || state.ok) return;
    for (const el of Array.from(form.elements) as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]) {
      if (!el.name || ["hidden", "file", "submit", "button"].includes(el.type)) continue;
      const vals = values.filter(([k]) => k === el.name).map(([, v]) => v);
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = vals.includes(el.value);
      else if (vals.length) el.value = vals[0];
    }
  }, [state]);
  return (
    <form
      ref={setRef}
      {...props}
      onSubmit={(e) => {
        onSubmit?.(e);
        if (!e.defaultPrevented) last.current = [...new FormData(e.currentTarget).entries()].filter((x): x is [string, string] => typeof x[1] === "string");
      }}
    >
      {children}
    </form>
  );
}
