# Analizador de catálogo · inteligencia competitiva

Herramienta para revisar el catálogo de proveedores de **Drop**
(`app.soydrop.com`) desde la vista de **dropshipper** y ver qué vende la
competencia: márgenes, rangos de precio, qué proveedor tiene más productos y,
sobre todo, **el mismo producto ofrecido por varios proveedores** (para comparar
quién lo surte más barato).

Hay dos formas de usarlo:

- **A — Automático (en el panel).** Una cuenta de dropshipper marcada como fuente
  de catálogo se sincroniza sola cada 10 minutos y el análisis se ve en
  **Productos → Competencia**. Ver §0.
- **B — Manual (CLI).** Pegas un export del catálogo y corres un reporte en la
  terminal. Ver §1–§3. Útil para una revisión rápida sin tocar la base.

Piezas:
- Motor de análisis (puro, con pruebas): [`lib/catalog.ts`](../lib/catalog.ts)
- Conector (login + descubrir ruta + bajar catálogo): [`lib/connectors/soydrop.ts`](../lib/connectors/soydrop.ts)
- Guardado + sincronización: [`lib/store.ts`](../lib/store.ts) · [`lib/sync.ts`](../lib/sync.ts)
- Página del panel: `app/(app)/products/competencia/page.tsx`
- CLI de reporte: [`scripts/analyze-catalog.ts`](../scripts/analyze-catalog.ts)

## 0. Modo automático (recomendado)

1. **Migración.** En Supabase → SQL Editor, ejecuta
   `supabase/migrations/0025_catalog_spy.sql` (crea la tabla `catalog_products` y
   las columnas `catalog_*` en `accounts`).
2. **Despliega** la rama a Vercel.
3. **Agrega la cuenta.** Panel → *Ajustes · Cuentas* → **Agregar cuenta** →
   plataforma Drop, país, y el correo/contraseña de una cuenta de **dropshipper**
   (no la de Miranova proveedor). Marca **“Solo catálogo de competencia”** y
   guarda. La contraseña se cifra (AES-256) y solo la usa el servidor; nunca sale
   del sistema.
4. El sistema inicia sesión, **descubre** la ruta del catálogo probando
   candidatas (igual que con las órdenes) y baja todas las páginas a
   `catalog_products`. Se repite cada 10 minutos.
5. Míralo en **Productos → Competencia**.

> Si la primera sincronización dice que no encontró la ruta del catálogo, queda un
> diagnóstico en *Ajustes → Diagnóstico* (`debug.catalog_probe`) con lo que
> respondió cada ruta candidata. Con eso se ajustan las candidatas en
> `CATALOG_PATH_CANDIDATES` (en `lib/connectors/soydrop.ts`).

> **Nota sobre términos de servicio:** bajar el catálogo en automático es acceso
> repetido a la API de Drop con una cuenta de dropshipper. Suele ir contra los ToS
> de la plataforma y podría arriesgar esa cuenta; es una decisión del dueño. El
> conector reutiliza el tamaño de página normal y no hace nada para evadir
> detección.

## 1. Sacar el export manual

Elige una de las dos formas:

**A) JSON (recomendado, trae todos los campos)**
1. Abre el catálogo en Drop (p. ej. `app.soydrop.com/dropshipping?vendorId=…`).
2. DevTools (`F12`) → pestaña **Network** → recarga.
3. Busca la llamada a `api.soydrop.com` que devuelve el listado de productos.
4. Clic derecho → **Copy → Copy response** → pégala en un archivo, p. ej. `catalogo.json`.
5. Para abarcar más proveedores/páginas, repite y guarda varios archivos.

**B) CSV**
Pega el listado con estos encabezados (el orden no importa):

```
Producto,Proveedor,ID,Total,Precio proveedor,Precio sugerido
```

## 2. Correr el análisis

```bash
# reporte completo en consola
node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json

# por stdin
cat catalogo.json | node --experimental-strip-types scripts/analyze-catalog.ts

# otra moneda (por defecto CRC)
node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json --currency HNL

# salida en JSON (para importar a otra herramienta)
node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json --json
```

El reporte incluye: resumen (productos, proveedores, stock), estadística de costo /
sugerido / margen, distribución de margen por tramos, ranking por proveedor, los
mejores "primer producto para pautar" (costo bajo + buen margen), el top por margen
y los productos repetidos entre proveedores con quién los da más barato.

## 3. Si un campo sale vacío

Como la API de Drop no está documentada, el parser busca cada campo entre varios
nombres posibles (igual que `lib/normalize.ts`). Si en tu export los nombres son
distintos:

```bash
node --experimental-strip-types scripts/analyze-catalog.ts catalogo.json --inspect
```

Muestra las claves crudas del primer registro y cómo quedó el mapeo. Pasa el nombre
real del campo que salió en `null` y se agrega a la lista de candidatos en
`lib/catalog.ts` (`COST_KEYS`, `SUGGESTED_KEYS`, `VENDOR_KEYS`, etc.).

## 4. Pruebas

```bash
node --test --experimental-strip-types lib/catalog.test.ts
```

## Nota

Esto es investigación de mercado sobre el catálogo que tu cuenta de dropshipper ya
puede ver. Mantén la revisión como uso normal de la plataforma; evita el scraping
automatizado con tu sesión, que suele ir contra los Términos de Servicio de Drop.
