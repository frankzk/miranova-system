// Registro de simulaciones: cada módulo aporta sus RPC y tablas en memoria.
// Así cada sección simula lo suyo sin tocar lib/dev-fixtures.ts.
import { fixtures as business } from "./business";
import { fixtures as contacts } from "./contacts";
import { fixtures as followups } from "./followups";
import { fixtures as inventory } from "./inventory";
import { fixtures as matrix } from "./matrix";
import { fixtures as opportunities } from "./opportunities";
import { fixtures as overview } from "./overview";
import { fixtures as productPerformance } from "./product-performance";
import { fixtures as storeDetail } from "./store-detail";
import { fixtures as stores } from "./stores";
import type { FixtureModule } from "./types";

export const MODULES: FixtureModule[] = [stores, overview, storeDetail, followups, productPerformance, matrix, opportunities, business, inventory, contacts];
