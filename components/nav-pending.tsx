"use client";

import { useLinkStatus } from "next/link";

/** Dentro de un <Link> del menú: punto que late mientras carga la sección (si aún no estaba precargada). */
export function NavPending() {
  const { pending } = useLinkStatus();
  return <span className="nav-pending" data-pending={pending || undefined} aria-hidden />;
}
