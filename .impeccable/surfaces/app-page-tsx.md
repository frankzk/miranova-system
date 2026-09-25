---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/orders","app/settings","app/login"]
---

# Panel Miranova (app completa: Inicio, Órdenes, Detalle, Ajustes)

Scope: todas las pantallas autenticadas + login. Visitor mode: Operate.
Audiencia: dueño (principal), atención al cliente y socios/contador; computadora y celular por igual.
Tareas: despachar a tiempo, controlar el dinero, vigilar entregas y ver el negocio completo.
Constraints: monedas nunca mezcladas; español; datos reales de Drop; sin logo existente (wordmark tipográfico).
Unresolved: roles separados, notificaciones, Dropi.

## Direction contract

THESIS: Un tablero de proveedor con la precisión de Stripe Dashboard: "Hoy" responde qué despachar, qué está en problemas y cuánto te toca, antes de cualquier tabla. Rechaza el patrón genérico de 4 tarjetas iguales con número grande: las cifras viven en una franja de métricas con divisores y la acción va junto a cada cifra.

OWN-WORLD: Fondo blanco, barra lateral gris azulado muy claro (#F6F8FA), tinta azul marino (#0A2540), un solo acento índigo (#635BFF) para acción, selección y foco. Estados con puntos de color + texto (verde entregado, azul en tránsito, ámbar pendiente/verificar, rojo problema/no entregado, gris cancelado). Inter con cifras tabulares; bordes de 1px (#E3E8EE), radios de 6px, sombras suaves solo en paneles flotantes. Iconos SVG propios de trazo 1.5.

STORY: El dueño abre, ve "Hoy" filtrable por cuenta, detecta las órdenes con problemas, entra a la lista filtrada con un clic, abre el detalle en un panel lateral, imprime la guía o ve el tracking, y revisa el dinero por moneda.

FIRST VIEWPORT: Barra lateral izquierda (240px) con wordmark "Miranova", navegación (Inicio, Órdenes, Dinero, Cuentas) y la lista de cuentas con su punto de estado de sync. Contenido: título "Inicio" con selector de cuenta y rango a la derecha; franja de métricas (Por despachar · Con problemas · Te toca · Ventas) con divisores verticales; debajo, a la izquierda un gráfico de barras de 30 días (órdenes por día) y a la derecha "Requieren atención" (lista corta con estado). Acción primaria: "Ver órdenes" en cada métrica. En celular: barra superior con menú, métricas en 2×2, gráfico y lista apilados.

FORM: Stripe Dashboard (pinned by the user; beats the roll). Grounded list position 1 of 7; roll assigned index 5 (ledger/estado de cuenta) and ran degraded with no challengers; the user chose the pinned direction over it. Seed key 5a5a26a4. Code-led (no image generation available).

Signature interaction: detalle de orden en panel lateral deslizante (drawer) sobre la lista, con URL propia, Esc para cerrar y la lista preservada detrás.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
