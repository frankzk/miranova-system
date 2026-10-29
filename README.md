# Miranova · Pedidos Drop

Sistema para guardar y consultar los pedidos que llegan a la proveeduría Miranova
en **Drop** (`app.soydrop.com/vendor/orders`), usando **Supabase** (base de datos)
y **Vercel** (panel web + API).

```
 app.soydrop.com  ──(extensión Chrome)──►  Vercel /api/ingest  ──►  Supabase
   (tu sesión)       captura el JSON que        normaliza y          orders
                     Drop ya carga              guarda (upsert)      order_items
                                                                     ingest_log
                          Panel web (Vercel) ◄── lista, filtros, detalle, CSV
```

El servidor inicia sesión en cada plataforma con el correo y la contraseña que
guardas en **Ajustes · Cuentas** y descarga las órdenes cada 10 minutos (Vercel
Cron). No hace falta tener el navegador abierto.

- **Varias cuentas**: una por plataforma + país (Drop Honduras, Drop Guatemala,
  Dropi Colombia…). Si un mismo correo tiene varias cuentas en Drop, el panel te
  deja elegir cuál corresponde a cada una.
- **Plataformas**: Drop (`soydrop.com`) y Dropi (`app.dropi.gt` y demás
  países) en `lib/connectors/`.
- **Verificación en dos pasos (2FA)**: si la plataforma pide un código de 6
  dígitos, guarda en la cuenta la *clave secreta* del 2FA (el texto junto al QR);
  el servidor genera el código solo en cada inicio de sesión.
- **Contraseñas** cifradas con AES-256-GCM (`ENCRYPTION_KEY`, solo en Vercel).
- La extensión de Chrome (`extension/`) queda como respaldo opcional.

## Qué guarda

Por pedido: orden de Drop, orden Shopify, estado, dropshipper, cliente, correo,
teléfono, departamento, ciudad, dirección, punto de referencia, indicaciones,
paquetera, guía, total, fecha de creación y el **JSON original** (`raw`).
Por producto: nombre, SKU, cantidad, precio e imagen.

Los productos solo vienen en el detalle de la orden: si en el listado un pedido
sale sin productos, ábrelo una vez en Drop (el panel lo indica).

## Puesta en marcha

### 1. Supabase
1. Crea un proyecto en <https://supabase.com>.
2. En **SQL Editor** pega y ejecuta `supabase/migrations/0001_init.sql`.
3. En **Project Settings → API** copia la *Project URL* y la *service_role key*.

### 2. Vercel
1. Importa este repositorio en <https://vercel.com/new>.
2. Variables de entorno (ver `.env.example`):
   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL de Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (secreta) |
   | `DASHBOARD_PASSWORD` | contraseña para entrar al panel |
   | `INGEST_API_KEY` | clave larga aleatoria (`openssl rand -hex 32`) |
   | `CRON_SECRET` | clave aleatoria (Vercel Cron la envía sola) |
   | `ENCRYPTION_KEY` | clave aleatoria para cifrar contraseñas — **no la cambies** |
3. Deploy. Tu panel queda en `https://<proyecto>.vercel.app`.

### 3. Cuentas
Entra al panel → **Ajustes · Cuentas** → agrega plataforma, país, correo y
contraseña → **Guardar y conectar**. La primera sincronización trae el historial
reciente; luego se actualiza sola cada 10 minutos.

La API de Drop no es pública: el conector (`lib/connectors/soydrop.ts`) usa las
rutas de login que aparecen en el JavaScript de la web de Drop y **descubre** la
ruta de órdenes probando candidatas. Si no la encuentra, en Ajustes → *Más
opciones → Diagnóstico técnico* queda lo que respondió cada ruta.

## Si algún campo sale vacío

Como la API de Drop no está documentada, `lib/normalize.ts` busca cada campo entre
varios nombres posibles. Si algo no aparece:

1. Abre el pedido en el panel → **Datos originales de Drop (JSON)** y mira cómo se
   llama el campo.
2. Añade ese nombre a la lista correspondiente en `lib/normalize.ts`
   (p. ej. `F.carrier`) y despliega.
3. Pulsa **Re-procesar** en el panel: se recalculan todos los pedidos desde su JSON.

Las respuestas crudas recibidas también quedan en la tabla `ingest_log`.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completa los valores
npm run dev                  # http://localhost:3000
npm test                     # pruebas del normalizador y del conector
npm run dev:fixtures         # panel con datos sintéticos, sin Supabase (contraseña: demo)
```

## Tasas de entrega

El menú **Tasas de entrega** (`/delivery-rates`, permiso **Negocio**) compara las
transportadoras por país y cuenta. Permite seleccionar 7, 30 o 90 días, un rango
propio y una antigüedad mínima de 7 o 14 días completos en la zona indicada.
Las fechas filtran la **creación del pedido**; se utiliza su estado actual.

El resumen y cada transportadora muestran ambas tasas: entregados / total de
pedidos y entregados / (entregados + no entregados). Se pueden incluir cancelaciones
y rechazos en la segunda base; la primera siempre incluye todos los estados.
Pendientes, tránsito, gestión y estados desconocidos quedan fuera de completados.
Una base vacía se representa con «—».
Los grupos con menos de 30 operaciones muestran un aviso de muestra pequeña.

Usa consultas de solo lectura paginadas, con caché de un minuto, sin migraciones
ni variables nuevas. La clave privilegiada de Supabase permanece en el servidor.

## Seguridad

### Conciliación bancaria

El menú **Conciliación bancaria** (`/reconciliation`) tiene un permiso propio,
**Conciliación bancaria**, que el dueño puede otorgar en Ajustes → Usuarios.
El selector de empresa separa los registros de Miranova y Mireva. Hay dos pestañas,
**Mercury** y **Boxful**, cada una con su tabla de todos los registros y filtros de
estado. El selector de cuentas Drop no afecta estas tablas. La sección no modifica
los saldos de Drop ni realiza transferencias.

1. Registrar la liquidación Boxful: referencia única, fecha, PDF privado (hasta
   15 MB) y monto enviado en USD. Si el PDF usa otra moneda, guardar también
   el monto y moneda originales; los USD corresponden a la conversión de esa
   transferencia, no a una cotización actual. Al cargar el PDF se proponen
     fecha, referencia e importe mediante lectura directa del texto. La persona
     revisa y corrige los campos antes de guardar; nunca se guarda ni se concilia
     automáticamente. Los valores ambiguos quedan pendientes, sin calcular USD
     a partir de otra moneda ni descontar comisiones. Se muestran citas del PDF.
     Los comprobantes BAC de Boxful se leen por su formato bancario: fecha de
     ejecución, número de referencia y «Monto a Transferir». La comisión del
     banco de origen y el total debitado no sustituyen el importe enviado.
     Los escaneos BAC de una página tienen OCR local con modelo incluido, sin
     créditos de IA ni envíos a terceros. Los datos con baja confianza o totales
     contradictorios quedan pendientes; siempre se revisan antes de guardar.
     Para otros escaneos o formatos que requieren interpretación se intenta la
     integración Anthropic de Ajustes, o AI Gateway de Vercel mediante OIDC;
     esa alternativa requiere credenciales y saldo del proveedor. Si no está
     disponible, se conserva la propuesta parcial y se permite captura manual.
     La lectura directa admite hasta 40 páginas y no envía el PDF a terceros.
2. Registrar el abono Mercury con su referencia/ID, fecha, monto neto recibido
   en USD, remitente y cuenta bancaria.
3. En una fila de la pestaña **Mercury**, abrir **Vincular Boxful**. El selector
   muestra las transferencias Boxful disponibles de esa empresa, con fecha,
   referencia, importe, diferencia y acceso al PDF. Buscar y seleccionar la
   transferencia que corresponde, y confirmar el cruce 1:1:
   **Boxful USD = Mercury USD + comisión USD**.
   La comisión se escribe y justifica explícitamente. Los candidatos se ordenan
   por monto y fecha; nunca se concilian automáticamente. Montos iguales muestran
   una advertencia para que se verifiquen las referencias. Los movimientos
   vinculados permanecen visibles en ambas tablas, con su contraparte y comisión.

La base valida centavos enteros, empresa, origen, versiones y exclusividad de
ambos movimientos, incluidos los intentos simultáneos. Los registros conciliados
no pueden editarse ni anularse hasta revertir el cruce con motivo. Se conservan
las versiones de los movimientos al conciliar y una auditoría de altas,
correcciones, anulaciones y reversiones. La vista Actividad muestra los últimos
100 eventos; el historial completo permanece en la base.

Aplicar `supabase/migrations/20261029184347_bank_reconciliation.sql` antes de
desplegar. Crea las tablas `bank_entries`, `bank_matches`, `bank_audit` y el bucket
privado `bank-documents`, sin acceso de clientes públicos. Los PDFs se sirven
tras verificar el permiso, con enlaces firmados de 2 minutos. No necesita nuevas
variables de entorno ni conexión directa a Mercury.

Verificación: `node --test --experimental-strip-types lib/reconciliation.test.ts
lib/access.test.ts`, `npm run typecheck` y `npm run build`. Con el servidor local
de fixtures en el puerto 3100, ejecutar `node scripts/check-bank-access.mjs`.
Las restricciones reales se prueban ejecutando `scripts/check-bank-database.sql`
entre `BEGIN` y `ROLLBACK`; no deja transacciones de prueba en la base.

Rentabilidad se divide en tres permisos independientes en Ajustes → Usuarios:

Compra, importación, recolección y cada traslado admiten monedas independientes
(USD, GTQ y HNL). Cada importe se convierte por separado antes de sumarlo en USD.
GTQ y HNL usan tasas automáticas del catálogo sincronizado, al guardar y consultar
costos, rentabilidad y Excel. El servidor ignora tasas enviadas por el formulario.
Si falta una tasa necesaria, bloquea el guardado y deja la conversión sin dato.
La migración conserva la moneda original de los importes ya registrados; no cambia
sus cantidades. El selector muestra los productos que ya tienen ficha con el aviso
«Ya vinculado a otra ficha». La revisión de referencias de Honduras está en
`docs/productos-honduras-costos.md`.

- **Costos de productos** (`product_costs`, `/profit/costs`): crear y editar fichas,
  costos, traslados, cantidades y vínculos. No recibe precios comerciales ni utilidades.
- **Precios comerciales** (`product_prices`, `/profit/prices`): consultar y editar
  precios comunidad/usuarios. No recibe costos, notas de costos ni utilidades.
- **Rentabilidad** (`profit`, `/profit`): consultar el análisis de costos, precios,
  márgenes y utilidad. Exportar el análisis requiere también **Exportar**.

Los dueños mantienen todos los accesos. Rentabilidad por sí sola no autoriza editar.
Borrar una ficha elimina también sus precios, por lo que requiere los permisos de
costos y precios. Cada acción verifica el permiso en el servidor. Las escrituras
parciales de costos y precios conservan los campos del otro permiso.

QA local: iniciar `next dev --port 3100` con `MIRANOVA_FIXTURES=1 AUTH_SECRET=demo`
y ejecutar `node scripts/check-profit-access.mjs`. Usa los usuarios sintéticos
`costos`, `precios`, `analista`, `andrea` y `dueno`, con contraseña `demo1234`.
Comprueba rutas, exportaciones, acciones directas sin permiso y conservación de datos.

- La `service_role key` solo vive en Vercel; las tablas tienen RLS activado sin
  políticas, así que nadie accede con la clave pública.
- El panel exige contraseña (cookie firmada, 30 días).
- `/api/ingest` exige `INGEST_API_KEY`; `/api/cron/sync` exige `CRON_SECRET`.
- Las contraseñas de las plataformas nunca se muestran ni salen del servidor.
- Los datos de clientes son personales: no compartas la API key ni el panel.

## Solicitudes por país

«Lo más pedido» compara Producto, Cantidad solicitada, unidades por país, Total repartido y Estado.
El reparto se registra por producto desde Gestionar solicitudes → Editar reparto. Se aceptan
repartos parciales; nunca pueden superar lo solicitado. Las cantidades compartidas antiguas
quedan pendientes, sin duplicarlas entre países. Un destino único permite deducir el reparto.
Los estados operativos son Solicitado, En tránsito y Llegó a Drop; se conserva el archivo
de descartadas. Si varias solicitudes de un producto tienen estados distintos, se muestran
por separado con sus cantidades. Cambiar un estado afecta a toda esa solicitud. Excel
conserva el mismo desglose.

Aplicar la migración request_country_quantities antes de desplegar. Verificar localmente
con datos sintéticos: `node scripts/check-request-allocation.mjs` (servidor de fixtures en 3100).
