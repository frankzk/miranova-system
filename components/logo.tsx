import { useId } from "react";

// Logo Miranova en vector, recreado a partir del arte de marca:
// monograma "M" dorado (dos postes + V), globo en la abertura, órbita con flecha
// ascendente, y el texto MIRA (dorado) NOVA (plateado / tinta) con A sin barra.
// `tone="light"` = sobre fondo claro (NOVA y poste derecho en tinta azul marino);
// `tone="dark"` = sobre fondo oscuro, como el arte original.

type Tone = "light" | "dark";

function Gradients({ id, tone }: { id: string; tone: Tone }) {
  return (
    <defs>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={tone === "dark" ? "#F7DFA0" : "#E9C57A"} />
        <stop offset="0.5" stopColor="#C99A45" />
        <stop offset="1" stopColor={tone === "dark" ? "#9A6A26" : "#8A5A1C"} />
      </linearGradient>
      <linearGradient id={`${id}-silver`} x1="0" y1="0" x2="0" y2="1">
        {tone === "dark" ? (
          <>
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#B9BEC7" />
          </>
        ) : (
          <>
            <stop offset="0" stopColor="#1C3A5E" />
            <stop offset="1" stopColor="#0A2540" />
          </>
        )}
      </linearGradient>
    </defs>
  );
}

/** Monograma en una caja de 64×64. */
function MarkShapes({ id }: { id: string }) {
  const gold = `url(#${id}-gold)`;
  const silver = `url(#${id}-silver)`;
  return (
    <g>
      {/* órbita superior */}
      <path d="M13 17 A21 21 0 0 1 49 11" fill="none" stroke={gold} strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
      {/* globo con América */}
      <circle cx="32" cy="15" r="10.5" fill="none" stroke={gold} strokeWidth="1.6" />
      <ellipse cx="32" cy="15" rx="4.6" ry="10.5" fill="none" stroke={gold} strokeWidth="1.2" />
      <path d="M21.5 15 H42.5 M23.4 9.5 H40.6" fill="none" stroke={gold} strokeWidth="1.1" />
      {/* postes */}
      <path d="M8 19 L17 30 V56 H8 Z" fill={gold} />
      <path d="M56 19 L47 30 V56 H56 Z" fill={silver} />
      {/* V central */}
      <path d="M6 9 H16.5 L32 30 L47.5 9 H58 L32 44 Z" fill={gold} />
      {/* órbita inferior con flecha */}
      <path d="M4.5 38 C6 55 34 66 55.5 31" fill="none" stroke={gold} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M60.5 23.5 L51.2 27.6 L58.4 33.9 Z" fill={gold} />
    </g>
  );
}

/** Letras geométricas por trazos (sin depender de fuentes). Altura ~40, trazo 5.6. */
function Wordmark({ id, x = 0 }: { id: string; x?: number }) {
  const gold = `url(#${id}-gold)`;
  const silver = `url(#${id}-silver)`;
  const s = { fill: "none", strokeWidth: 5.6, strokeLinejoin: "miter" as const, strokeMiterlimit: 10 };
  return (
    <g transform={`translate(${x} 0)`}>
      <g stroke={gold} {...s}>
        <path d="M2.5 40 V2.5 L19 27 L35.5 2.5 V40" />
        <path d="M62 40 V2.5 H75 a10.5 10.5 0 0 1 0 21 H62 M73 23.5 L86 40" />
        <path d="M96 40 L111 2.5 L126 40" />
      </g>
      {/* la I como rectángulo: un trazo de ancho cero no recibe degradado */}
      <rect x="46.2" y="0" width="5.6" height="42.5" fill={gold} />
      <g stroke={silver} {...s}>
        <path d="M139 40 V2.5 L165 40 V2.5" />
        <circle cx="194" cy="21.25" r="18.75" />
        <path d="M226 2.5 L241 40 L256 2.5" />
        <path d="M266 40 L281 2.5 L296 40" />
      </g>
    </g>
  );
}

export function LogoMark({ size = 32, tone = "dark", title = "Miranova" }: { size?: number; tone?: Tone; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <Gradients id={id} tone={tone} />
      <MarkShapes id={id} />
    </svg>
  );
}

/** Logo horizontal: monograma + MIRANOVA (+ lema opcional). */
export function LogoHorizontal({
  height = 34,
  tone = "light",
  tagline = false,
}: {
  height?: number;
  tone?: Tone;
  tagline?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  // caja: monograma 64×64 a la izquierda; texto a escala 0.5 (alto 20) centrado
  const vbW = 64 + 12 + 150;
  return (
    <svg height={height} viewBox={`0 0 ${vbW} 64`} role="img" aria-label="Miranova — Proveeduría para eCommerce" style={{ display: "block" }}>
      <Gradients id={id} tone={tone} />
      <MarkShapes id={id} />
      <g transform={`translate(76 ${tagline ? 17 : 22}) scale(0.5)`}>
        <Wordmark id={id} />
      </g>
      {tagline && (
        <text
          x={76 + 74}
          y={51}
          textAnchor="middle"
          fontFamily="Inter Variable, Inter, system-ui, sans-serif"
          fontSize="6.3"
          fontWeight={600}
          letterSpacing="1.6"
          fill={tone === "dark" ? "#C9CED6" : "#5F6B7A"}
        >
          PROVEEDURÍA PARA ECOMMERCE
        </text>
      )}
    </svg>
  );
}
