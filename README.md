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
- **Plataformas**: Drop (`soydrop.com`) lista; Dropi próximamente
  (`lib/connectors/`).
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
npm test                     # pruebas del normalizador
```

## Seguridad

- La `service_role key` solo vive en Vercel; las tablas tienen RLS activado sin
  políticas, así que nadie accede con la clave pública.
- El panel exige contraseña (cookie firmada, 30 días).
- `/api/ingest` exige `INGEST_API_KEY`; `/api/cron/sync` exige `CRON_SECRET`.
- Las contraseñas de las plataformas nunca se muestran ni salen del servidor.
- Los datos de clientes son personales: no compartas la API key ni el panel.
