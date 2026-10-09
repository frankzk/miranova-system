// Dinero → Saldo en billeteras: tipo de cambio a USD de cada cuenta (vista account_fx).
import type { FixtureModule } from "./types";

export const fixtures: FixtureModule = {
  tables: {
    account_fx: [
      { account_id: "11111111-1111-4111-8111-111111111111", currency: "HNL", usd_rate: 0.0379 },
      { account_id: "22222222-2222-4222-8222-222222222222", currency: "GTQ", usd_rate: 0.1297 },
    ],
  },
};
