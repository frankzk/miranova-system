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

Drop no tiene API pública, así que la forma más fiable es una **extensión de Chrome**
que lee las respuestas que la propia web de Drop recibe mientras navegas tus órdenes
(no pide tu contraseña ni hace peticiones extra). Cada vez que abres el listado o el
detalle de una orden, esos datos se envían al panel. Opcionalmente hay un **cron** que
consulta Drop directamente si configuras su endpoint y token.

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
   | `CRON_SECRET` | *(opcional)* otra clave aleatoria |
3. Deploy. Tu panel queda en `https://<proyecto>.vercel.app`.

### 3. Extensión de Chrome
1. Abre `chrome://extensions`, activa **Modo desarrollador**.
2. **Cargar extensión sin empaquetar** → elige la carpeta `extension/`.
3. Haz clic en el ícono de la extensión, pon la URL del panel y el `INGEST_API_KEY`,
   pulsa **Guardar** (debe decir “✓ Conectado”).
4. Entra a `app.soydrop.com/vendor/orders` y recorre las páginas / abre las órdenes.
   El ícono muestra cuántos pedidos se enviaron en el último lote.

## Sincronización automática (opcional)

Si quieres que el servidor consulte Drop sin tener el navegador abierto:

1. En Drop abre DevTools (F12) → **Network**, filtra por `Fetch/XHR` y recarga
   la página de órdenes.
2. Busca la petición que devuelve la lista de órdenes; copia su URL y el valor de
   la cabecera `Authorization`.
3. En Vercel define `DROP_API_ORDERS_URL` (pon `{page}` donde va el número de
   página, ej. `...?page={page}&limit=50`) y `DROP_AUTH_HEADER`.

`vercel.json` lo ejecuta una vez al día (límite del plan Hobby); en Pro puedes
subirlo a cada hora. Ojo: el token de Drop caduca, y cuando pase el cron
responderá 502 hasta que lo renueves. La extensión no tiene ese problema.

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
npm test                     # pruebas del normalizador
```

## Seguridad

- La `service_role key` solo vive en Vercel; las tablas tienen RLS activado sin
  políticas, así que nadie accede con la clave pública.
- El panel exige contraseña (cookie firmada, 30 días).
- `/api/ingest` exige `INGEST_API_KEY`; `/api/cron/sync` exige `CRON_SECRET`.
- Los datos de clientes son personales: no compartas la API key ni el panel.
