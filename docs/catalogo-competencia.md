# Analizador de catálogo · inteligencia competitiva

Herramienta para revisar el catálogo público de proveedores de **Drop**
(`app.soydrop.com`) y ver qué vende la competencia: márgenes, rangos de precio,
qué proveedor tiene más productos y, sobre todo, **el mismo producto ofrecido por
varios proveedores** (para comparar quién lo surte más barato).

No consulta nada en línea ni automatiza la plataforma: trabaja sobre un **export
manual** que haces tú desde el catálogo al que tu cuenta ya tiene acceso.

- Motor (puro, con pruebas): [`lib/catalog.ts`](../lib/catalog.ts)
- CLI de reporte: [`scripts/analyze-catalog.ts`](../scripts/analyze-catalog.ts)

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
