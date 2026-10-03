"use client";

import { useEffect, useRef } from "react";

/**
 * Cuadrícula tipo Pinterest que respeta el orden de lectura: la tarjeta i va a la columna i % n
 * (igual que en la cuadrícula CSS de respaldo, que es lo que se ve antes de que cargue el JS) y
 * sube hasta pegarse a la de arriba. El orden del DOM no cambia: teclado y lector de pantalla
 * recorren las tarjetas en el mismo orden en que se ordenaron.
 * Ancho mínimo de columna y separación: variables CSS --masonry-min y --masonry-gap del contenedor.
 */
export function Masonry({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    let frame = 0;

    const layout = () => {
      frame = 0;
      const items = Array.from(box.children) as HTMLElement[];
      const css = getComputedStyle(box);
      const min = parseFloat(css.getPropertyValue("--masonry-min")) || 216;
      const gap = parseFloat(css.getPropertyValue("--masonry-gap")) || 16;
      const width = box.clientWidth;
      const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
      const colW = (width - gap * (cols - 1)) / cols;
      // primero todos los anchos, luego una sola lectura de altos, luego las posiciones
      for (const el of items) el.style.width = `${colW}px`;
      const heights = items.map((el) => el.offsetHeight);
      const tops = new Array<number>(cols).fill(0);
      items.forEach((el, i) => {
        const c = i % cols;
        el.style.left = `${c * (colW + gap)}px`;
        el.style.top = `${tops[c]}px`;
        tops[c] += heights[i] + gap;
      });
      box.style.height = `${Math.max(0, Math.max(...tops) - gap)}px`;
      box.dataset.masonry = "on";
    };
    // un acomodo por cuadro, aunque carguen muchas fotos a la vez
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(layout);
    };

    const sizes = new ResizeObserver(schedule);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(box);
      for (const el of Array.from(box.children)) sizes.observe(el);
      schedule();
    };
    // al filtrar u ordenar cambian las tarjetas
    const list = new MutationObserver(watch);
    list.observe(box, { childList: true });
    watch();

    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      list.disconnect();
    };
  }, []);

  return <div ref={ref} className={className}>{children}</div>;
}
