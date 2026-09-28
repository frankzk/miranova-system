// Simulación local del repositorio de fotos: la tabla product_media empieza vacía y los archivos
// se guardan en memoria (ver storage en lib/dev-fixtures.ts y app/api/dev-storage).
import type { FixtureModule, Row } from "./types";

const product_media: Row[] = [];

export const fixtures: FixtureModule = { tables: { product_media } };
