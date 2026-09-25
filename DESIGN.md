---
name: Miranova
description: Panel de proveedor de dropshipping con la precisión sobria de un dashboard financiero.
colors:
  ink: "#0a2540"
  ink-2: "#425466"
  ink-3: "#5f6b7a"
  ink-4: "#8792a2"
  accent: "#635bff"
  accent-hover: "#5249f0"
  accent-ink: "#4a42d6"
  accent-soft: "#f1f0ff"
  accent-bg: "#efeeff"
  bg-surface: "#ffffff"
  bg-app: "#f6f8fa"
  bg-hover: "#f1f4f8"
  bg-active: "#eaeef4"
  line: "#e3e8ee"
  line-strong: "#d0d7de"
  success: "#0e6245"
  success-bg: "#e5f6ee"
  success-dot: "#1ea672"
  info: "#0055bc"
  info-bg: "#e6f0fd"
  info-dot: "#2d7ff9"
  warning: "#983705"
  warning-bg: "#fdf3e2"
  warning-dot: "#e5850b"
  danger: "#b3093c"
  danger-bg: "#fdebef"
  danger-dot: "#e5424d"
  neutral: "#4f566b"
  neutral-bg: "#eef1f5"
  neutral-dot: "#a3acb9"
typography:
  display:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\""
  headline:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.022em"
  title:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"cv11\", \"ss01\""
  body-sm:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 550
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo, monospace"
    fontSize: "0.92em"
    fontWeight: 400
rounded:
  sm: "5px"
  md: "7px"
  lg: "10px"
  card-auth: "14px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "28px"
  page-x: "40px"
  sidebar-w: "232px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.bg-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
    height: "32px"
  input:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  nav-item:
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  nav-item-active:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.accent-ink}"
  status-pill:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 8px 0 7px"
    height: "22px"
  status-pill-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success}"
  status-pill-info:
    backgroundColor: "{colors.info-bg}"
    textColor: "{colors.info}"
  status-pill-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
  status-pill-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger}"
  status-pill-accent:
    backgroundColor: "{colors.accent-bg}"
    textColor: "{colors.accent-ink}"
  panel:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.lg}"
    padding: "14px 18px 18px"
  metric:
    backgroundColor: "{colors.bg-surface}"
    typography: "{typography.display}"
    padding: "16px 20px 14px"
  table-header:
    backgroundColor: "{colors.bg-app}"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    padding: "9px 14px"
  table-cell:
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    padding: "11px 14px"
  table-row-selected:
    backgroundColor: "{colors.accent-soft}"
  drawer:
    backgroundColor: "{colors.bg-surface}"
    width: "min(580px, 100vw)"
    padding: "18px 22px 28px"
  tab-active:
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    padding: "8px 10px 10px"
---

# Design System: Miranova

## Overview

**Creative North Star: "El Libro Mayor Preciso"**

Miranova es un tablero de proveedor que se lee como un estado de cuenta bien hecho: tinta azul marino sobre blanco, líneas de 1px que ordenan sin decorar, y un único acento índigo que solo aparece donde hay acción, selección o foco. La referencia es la sobriedad de un dashboard financiero de primer nivel (tipo Stripe Dashboard): densidad alta pero respirable, cifras con dígitos tabulares que se alinean columna a columna, y estados que se leen por punto de color **y** texto.

La densidad es de herramienta de trabajo, no de página de marketing. La información urgente vive en una franja de métricas dividida por líneas verticales (no en tarjetas sueltas), las listas y tablas son la superficie principal, y el detalle de una orden abre en un panel lateral sobre la lista, que se conserva detrás. La profundidad es casi plana: paneles con una sombra de 1px, y sombras reales solo en lo que flota (menús, tooltip, drawer, tarjeta de login).

No hay logo: la marca es un wordmark tipográfico ("Miranova") junto a un cuadrado de tinta de 26px con la inicial. No se inventan activos de marca.

**Key Characteristics:**
- Tinta azul marino (`ink`) para todo el texto primario; grises azulados escalonados para jerarquía.
- Un solo acento índigo (`accent`) para acción primaria, selección, foco y el dato "entregado" en gráficas.
- Barra lateral gris azulado muy claro (`bg-app`) separada del contenido blanco por una línea de 1px.
- Inter variable con `cv11`/`ss01` y cifras tabulares en todo número.
- Estados como píldoras punto + texto, con seis tonos semánticos.
- Franja de métricas con divisores, no tarjetas iguales.
- Detalle en drawer sobre la lista preservada; en celular, filas de tabla apiladas.

## Colors

Una paleta fría y contenida: azul marino, grises azulados, blanco, y un índigo que se gana cada aparición.

### Primary
- **Índigo Acción** (`accent`): botón primario, pestaña activa (subrayado de 2px), ítem de navegación activo (icono), anillo de foco, cursor de texto, barra "entregadas" en la gráfica, primer punto del timeline.
- **Índigo Hover** (`accent-hover`): hover del botón primario y de las barras destacadas.
- **Índigo Tinta** (`accent-ink`): texto en índigo sobre fondo claro (links, nav activa, pestaña activa, fila de orden en hover), más oscuro que el acento para cumplir AA.
- **Lavanda Selección** (`accent-soft`, `accent-bg`): fila seleccionada de la tabla, contador de pestaña activa, píldora de tono acento.

### Neutral
- **Azul Marino Tinta** (`ink`): texto principal, títulos, cifras, fondo del tooltip y del cuadrado de marca.
- **Pizarra** (`ink-2`): texto de navegación, etiquetas de campo y de métrica, texto secundario fuerte.
- **Gris Azulado** (`ink-3`): subtítulos, metadatos, encabezados de tabla, términos de listas clave-valor.
- **Gris Niebla** (`ink-4`): placeholders, iconos en reposo, ejes de gráfica.
- **Blanco Superficie** (`bg-surface`): lienzo del contenido, paneles, tablas, drawer.
- **Papel Frío** (`bg-app`): barra lateral, fondo de login, cabecera de tabla, fondos sutiles y control segmentado.
- **Hover Frío / Presionado** (`bg-hover`, `bg-active`): estados de hover y active en filas, botones y navegación.
- **Línea** (`line`): todo borde y divisor de 1px. **Línea Fuerte** (`line-strong`): borde de botones e inputs, línea base de gráfica.

### Estados (seis tonos, cada uno texto / fondo / punto)
- **Éxito** (`success`, `success-bg`, `success-dot`): Entregado; "lo que te toca" en dinero.
- **Información** (`info`, `info-bg`, `info-dot`): Recolectado, En ruta.
- **Advertencia** (`warning`, `warning-bg`, `warning-dot`): Pendiente, Verificar; saldo sin pagar.
- **Peligro** (`danger`, `danger-bg`, `danger-dot`): Problemas en gestión, No entregado; métrica en alerta; contador de nav.
- **Neutro** (`neutral`, `neutral-bg`, `neutral-dot`): Cancelado, Rechazado, Guía cancelada.
- **Acento** (`accent-ink`, `accent-bg`, `accent`): Creado en sistema (guía creada).

### Named Rules
**The One Voice Rule.** El índigo es el único color de marca. Aparece solo en acción, selección, foco o el dato protagonista de una gráfica; nunca como fondo de sección ni decoración.

**The Dot-and-Word Rule.** Un estado nunca se comunica solo con color: siempre punto de 6–8px más su texto.

**The Ink Not Black Rule.** No hay negro puro: el texto más oscuro es `ink`, y los overlays usan `rgba(10, 37, 64, 0.28)`.

## Typography

**Body Font:** Inter Variable (con Inter, ui-sans-serif, system-ui)
**Mono Font:** ui-monospace (SF Mono, Cascadia Mono, Roboto Mono, Menlo) solo para JSON crudo y códigos.

**Character:** Una sola familia en todos los roles; la jerarquía sale de peso (400/500/550/600/650), tamaño y tracking negativo en títulos, no de familias contrastadas. `font-feature-settings: "cv11", "ss01"` en el body; `tabular-nums` en toda cifra.

### Hierarchy
- **Display** (600, 28px, 1.2, -0.025em, tabular): valores de la franja de métricas (23px en celular; variante de 22px/18px para montos multi-moneda).
- **Headline** (650, 26px, 1.2, -0.022em): título de página (22px en celular).
- **Title** (600, 16px, -0.01em): encabezado de panel, título de cuenta. El título del drawer y de login usa 20px/650.
- **Body** (400, 14px, 1.5): texto base, navegación, pestañas.
- **Body small** (13px): celdas de tabla, botones, inputs, listas clave-valor, crumbs.
- **Label** (550, 12px): encabezados de tabla, píldoras de estado, leyendas, metadatos. Sentence case, sin mayúsculas forzadas ni tracking positivo.

### Named Rules
**The Tabular Rule.** Todo número que se compare (montos, conteos, fechas, números de orden) usa `font-variant-numeric: tabular-nums` y se alinea a la derecha en tablas.

**The Weight Ladder Rule.** La jerarquía se construye con pesos intermedios (550, 650) de la fuente variable, no con colores ni mayúsculas.

## Layout

Rejilla de app de dos columnas: barra lateral fija de 232px (`sidebar-w`) y contenido fluido. La separación es un degradado de fondo que dibuja una línea de 1px `line`, no un borde de elemento. El contenido se centra con máximo de 1240px (920px en páginas angostas) y padding de 28px 40px 72px.

Ritmo de espaciado en múltiplos de 2 y 4: gaps de 8px entre controles, 12–16px dentro de componentes, 20px entre paneles y bajo la franja de métricas, 22px bajo el encabezado de página. Filas de lista con padding de 9–11px vertical y 18px horizontal; celdas de tabla 11px 14px.

Composiciones recurrentes: franja de 4 métricas; `grid-2` (1.65fr / 1fr) para gráfica + lista de atención; `grid-3` para rankings.

Responsive:
- ≤1100px: `grid-2` a una columna, `grid-3` a dos.
- ≤900px: la barra lateral se vuelve un panel off-canvas (min(300px, 86vw)) con scrim; aparece una barra superior sticky de 52px con fondo blanco translúcido y blur; métricas en 2×2; padding de página 20px 16px; controles suben a 36px de alto para toque.
- ≤640px: la tabla de órdenes se apila en filas de grilla (número + estado arriba, cliente + total, fecha abajo); drawer a ancho completo con padding de 16px.

Columnas de tabla menos importantes se ocultan progresivamente (`hide-xl`, `hide-l`, `hide-lg`, `hide-md`, `hide-sm`) en lugar de forzar scroll horizontal.

## Elevation & Depth

Sistema casi plano con profundidad estructural por líneas y tono (`bg-app` vs `bg-surface`). Las superficies en reposo llevan solo una sombra de 1–2px que asienta el borde. Las sombras con cuerpo se reservan para lo que flota sobre el contenido.

### Shadow Vocabulary
- **Asiento** (`box-shadow: 0 1px 1px rgba(10, 37, 64, 0.04), 0 1px 2px rgba(10, 37, 64, 0.06)`): paneles, tablas, franja de métricas, botones, inputs, nav activa, segmento activo.
- **Flotante** (`box-shadow: 0 18px 36px -12px rgba(10, 37, 64, 0.18), 0 6px 14px -6px rgba(10, 37, 64, 0.1)`): menú de cuenta, tooltip de gráfica, tarjeta de login, barra lateral abierta en celular.
- **Drawer** (`box-shadow: -24px 0 48px -16px rgba(10, 37, 64, 0.22)`): panel lateral de detalle, proyectada hacia la izquierda.

### Named Rules
**The Float-Only Shadow Rule.** Una sombra visible significa "esto está encima". Nada en el flujo del documento lleva más que la sombra de asiento.

**The Navy Shadow Rule.** Todas las sombras y overlays se tiñen con la tinta (`rgba(10, 37, 64, …)`), nunca con negro.

## Shapes

Esquinas suavemente redondeadas y pequeñas: 5px (`sm`) para elementos internos (segmentos, ítems de menú, tags, skeleton), 7px (`md`) para controles (botones, inputs, nav, banners, tooltip), 10px (`lg`) para contenedores (paneles, tablas, métricas, menús flotantes), 14px solo en la tarjeta de login. Píldoras y contadores son totalmente redondeados (999px); puntos de estado son círculos.

Bordes siempre de 1px sólido en `line` (o `line-strong` en controles). La única línea de 2px es el subrayado de la pestaña activa. Las líneas de guía de la gráfica son discontinuas; la línea base es sólida. Iconos SVG propios en caja de 16px, trazo de 1.5, extremos y uniones redondeados.

## Components

### Buttons
Discretos y precisos: blancos con borde por defecto, índigo solo para la acción principal.
- **Shape:** esquinas suaves (7px), alto 32px (28px en `sm`, 36px en celular, 38px en login), padding horizontal 12px, gap 6px con icono.
- **Primary:** fondo `accent`, texto blanco, 13px/550, sombra `0 1px 1px rgba(50,50,93,0.12)` con brillo interior de 1px; icono al 85% blanco.
- **Hover / Active:** primario a `accent-hover`, active `#463ee0`; secundario a `bg-hover` con borde `#c1cad3`, active `bg-active`. Transiciones de 120ms.
- **Secondary:** fondo blanco, borde `line-strong`, texto `ink`, sombra de asiento, icono en `ink-3`.
- **Ghost:** transparente sin borde ni sombra, texto `ink-2`, hover `bg-hover`.
- **Danger:** secundario con texto `danger`; hover fondo `danger-bg` y borde `#f3c3cf`.
- **Disabled / Busy:** opacidad 0.55; en envío muestra un spinner de 12px de trazo 1.5px.

### Status Pills (firma)
- **Style:** alto 22px, radio completo, 12px/550, punto de 6px antes del texto. Fondo y texto del tono; punto en el color `-dot` del tono.
- **Tones:** success, info, warning, danger, neutral (por defecto), accent. La asignación de estado a tono vive en un único mapa.
- **Tag:** variante rectangular (20px, radio 5px, fondo `bg-app`, borde `line`, 11.5px/550) para metadatos no semánticos.

### Metric Strip (firma)
- Un solo contenedor (radio 10px, borde `line`, sombra de asiento) dividido en 4 celdas por líneas verticales de 1px; en celular 2×2 con línea horizontal.
- Cada celda: etiqueta 13px/550 `ink-2` con punto de estado opcional, valor Display tabular, pie 13px `ink-3` con flecha que en hover se tiñe de `accent` y se desplaza 2px. Celda enlazada: hover `bg-app`. En alerta, el valor pasa a `danger`.

### Cards / Containers (Panels)
- **Corner Style:** 10px. **Background:** `bg-surface`. **Border:** 1px `line`. **Shadow:** asiento.
- **Internal Padding:** cabecera 14px 18px, cuerpo 14px 18px 18px; listas a sangre con filas separadas por líneas de 1px y pie alineado a la derecha.

### Tables
- Contenedor con radio 10px y borde; cabecera `bg-app` 12px/550 `ink-3`; celdas 13px con padding 11px 14px y líneas de 1px; números a la derecha y tabulares.
- Hover de fila `bg-app`; fila seleccionada `accent-soft`; número de orden 600 que se tiñe `accent-ink` en hover. Paginador en pie con línea superior.
- En ≤640px se convierte en filas apiladas de grilla de dos columnas.

### Inputs / Fields
- **Style:** alto 32px (36px dentro de formularios y en celular), radio 7px, borde `line-strong`, sombra de asiento, 13px; placeholder `ink-4`; select con chevron SVG propio.
- **Hover:** borde `#c1cad3`. **Focus:** borde `accent` y halo `0 0 0 3px accent-ring` (`rgba(99,91,255,0.35)`).
- **Field:** etiqueta 13px/550 `ink-2` sobre el control, gap 6px, pista 12px `ink-3`.
- **Error:** línea de texto `danger` 13px con icono; banners con tono (fondo, borde y texto del tono).

### Navigation
- **Sidebar:** fondo `bg-app`; wordmark 15px/650 con cuadrado de marca `ink`; selector de cuenta como botón blanco; ítems 14px/500 `ink-2`, icono `ink-4`, radio 7px, padding 6px 10px.
- **Hover:** fondo `bg-hover`, texto `ink`. **Active:** fondo blanco con sombra de asiento, texto `accent-ink`, icono `accent`. Contador de problemas como píldora `danger` a la derecha.
- **Cuentas:** punto de estado de sincronización + nombre + metadato 11.5px.
- **Tabs:** 14px/550 `ink-3`; activa en `accent-ink` con subrayado de 2px `accent` y contador en `accent-soft`.
- **Segmented:** contenedor `bg-app` con borde, segmento activo blanco con sombra de asiento.
- **Mobile:** barra superior sticky de 52px (blanco 94% + blur) con botón de menú; sidebar off-canvas con scrim.

### Order Drawer (firma)
- Panel fijo a la derecha, `min(580px, 100vw)`, sombra Drawer, overlay `rgba(10,37,64,0.28)`; entra con desplazamiento de 28px y fundido en 280ms `cubic-bezier(0.16, 1, 0.3, 1)`.
- La lista queda visible detrás; tiene URL propia y cierra con Esc.
- Contenido en secciones separadas por líneas: acciones, lista clave-valor (140px de término), productos con miniatura de 38px, filas de dinero (lo que te toca en `success` 650), timeline con puntos de 8px (el más reciente en `accent`).

### Bar Chart
- Barras de dos capas: recibidas en lavanda claro, entregadas en `accent`; hover aclara la columna con `rgba(99,91,255,0.07)`. Guías discontinuas `line`, base sólida `line-strong`, ejes 11px `ink-4`. Tooltip con fondo `ink`, texto blanco 12px, radio 7px, sombra Flotante.

## Do's and Don'ts

### Do:
- **Do** usar `ink` (#0a2540) para todo texto primario y la escala `ink-2`/`ink-3`/`ink-4` para jerarquía.
- **Do** reservar `accent` (#635bff) para acción primaria, selección, foco y el dato protagonista de una gráfica.
- **Do** mostrar cada estado como píldora punto + texto con uno de los seis tonos.
- **Do** poner cifras en `tabular-nums`, alineadas a la derecha en tablas, y nunca sumar monedas distintas en un mismo valor.
- **Do** agrupar métricas en una franja con divisores de 1px `line`, no en tarjetas separadas.
- **Do** abrir el detalle en el drawer sobre la lista preservada.
- **Do** dibujar bordes de 1px `line` y usar radios 5/7/10px según el nivel (interno/control/contenedor).
- **Do** subir controles a 36px de alto y apilar filas de tabla en celular.

### Don't:
- **Don't** introducir un segundo color de marca ni usar el índigo como fondo de sección.
- **Don't** comunicar un estado solo con color.
- **Don't** poner sombras con cuerpo en elementos en el flujo; solo lo que flota (menú, tooltip, drawer, login) lleva sombra Flotante o Drawer.
- **Don't** usar negro puro para texto, sombras u overlays.
- **Don't** usar mayúsculas forzadas o tracking positivo en etiquetas.
- **Don't** inventar logo ni activos de marca: la marca es el wordmark "Miranova" con su cuadrado de inicial.
- **Don't** usar iconos de librería o de fuente: iconos SVG propios de 16px con trazo 1.5.
