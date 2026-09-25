# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Dueño de Miranova** (usuario principal). Proveedor de dropshipping con cuentas en varios países y plataformas. Revisa ventas, estados, despachos y dinero de todas las cuentas, desde la computadora y el celular.
- **Atención al cliente.** Busca una orden por número, cliente o teléfono para resolver problemas de entrega.
- **Socios o contador.** Revisan los números: lo vendido, lo que le toca al proveedor, lo liquidado y lo pendiente.

Todos entran con la misma contraseña del panel. No hay roles separados todavía.

## Product Purpose

Reúne en un solo lugar las órdenes que le llegan a Miranova como proveedor en plataformas de dropshipping. Las sincroniza solo cada 10 minutos, sin extensión ni navegador. Sirve para cuatro trabajos, todos importantes:

1. **Despachar a tiempo:** qué está pendiente, qué productos preparar, guías e impresión.
2. **Controlar el dinero:** total vendido, lo que recibe el proveedor, lo liquidado y lo pendiente, por moneda.
3. **Vigilar entregas:** órdenes con problemas, no entregadas, canceladas o rechazadas, por paquetera y dropshipper.
4. **Ver el negocio completo:** comparar países, cuentas, dropshippers y productos.

Éxito: el dueño responde "¿qué despacho hoy, qué problemas hay y cuánto me deben?" en segundos, desde cualquier dispositivo.

## Positioning

La web de Drop muestra una cuenta y un país a la vez. Este panel junta todas las cuentas y países del proveedor (y más adelante otras plataformas, como Dropi) con la vista del proveedor: lo que recibe, lo que le liquidan y lo que debe despachar.

## Operating Context

- **Fuente de datos:** API privada de Drop (`api.soydrop.com`), vía login con correo y contraseña de cada cuenta y selección de cuenta. Dropi viene después.
- **Uso:** oficina y bodega en la computadora; revisiones rápidas en el celular.
- **Monedas y husos:** cada cuenta tiene su país, con moneda propia (HNL, GTQ, USD…) y zona horaria. Nunca se suman monedas distintas.
- **Estados de Drop:** Pendiente, Verificar, Creado en sistema, Recolectado, En ruta a destino, Entregado, No entregado, Problemas en gestión, Guía cancelada, Orden cancelada, Orden rechazada.
- **Paqueteras:** Forza y otras, con guía PDF y enlace de tracking.

## Capabilities and Constraints

- Next.js (App Router) en Vercel, Supabase (Postgres) como base de datos y Vercel Cron cada 10 minutos.
- Por orden: cliente, contacto, dirección (departamento, ciudad, dirección, referencia, indicaciones), dropshipper, paquetera, guía, tracking, etiqueta PDF, productos (SKU, cantidad, precio de venta, precio del proveedor, imagen), total, lo que recibe el proveedor, ganancia neta estimada, pago contra entrega y si ya se liquidó.
- Ajustes: agregar, pausar, sincronizar y eliminar cuentas; contraseñas cifradas; carga del historial por meses.
- Exportación a CSV.
- Idioma: español (Centroamérica).
- Sin decidir: roles o usuarios separados, notificaciones, integración de Dropi.

## Brand Commitments

- Nombre: **Miranova**.
- El usuario pidió un estilo tipo **Stripe** (dashboard sobrio, preciso y de alta calidad), o una referencia mejor si existe.

## Evidence on Hand

Datos reales de órdenes sincronizadas de Drop Honduras (cuenta MIRANOVA). No hay logo ni otros activos de marca en el repositorio: no se debe inventar ninguno.

## Product Principles

1. **Respuestas en segundos.** Lo urgente (por despachar, con problemas, dinero pendiente) va arriba, sin buscarlo.
2. **Cifras honestas.** Nunca mezclar monedas; mostrar siempre de qué cuenta, país y período es cada número.
3. **Todas las cuentas, una vista.** Filtrar por cuenta o país es inmediato, pero la vista por defecto lo junta todo.
4. **Tabla primero, detalle a un clic.** Buscar y escanear órdenes es la acción más frecuente; el detalle abre sin perder el contexto.
5. **Igual de útil en el celular.**

## Accessibility & Inclusion

Contraste AA, uso completo con teclado y objetivos táctiles cómodos en el celular. Los estados no se distinguen solo por color.
