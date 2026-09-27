// Simulación local de app_users: un dueño y una persona de operación, ambos con contraseña "demo1234".
import { randomBytes, scryptSync } from "node:crypto";
import type { FixtureModule, Row } from "./types";

// mismo formato que lib/passwords.ts (con N bajo: solo para desarrollo local)
function hash(pw: string) {
  const salt = randomBytes(16);
  const key = scryptSync(pw.normalize("NFKC"), salt, 64, { N: 1024, r: 8, p: 1 });
  return ["scrypt", 1024, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
}

const now = new Date().toISOString();
const base = { active: true, must_change_password: false, session_version: 1, failed_attempts: 0, locked_until: null, last_login_at: null, created_by: null, created_at: now, updated_at: now };

const app_users: Row[] = [
  { ...base, id: "a0000000-0000-4000-8000-000000000001", username: "dueno", name: "Frank Dueño", password_hash: hash("demo1234"), permissions: [], is_owner: true },
  {
    ...base, id: "a0000000-0000-4000-8000-000000000002", username: "andrea", name: "Andrea Operación", password_hash: hash("demo1234"),
    permissions: ["orders", "stores", "stores_edit", "products", "opportunities"], is_owner: false,
  },
];

export const fixtures: FixtureModule = { tables: { app_users } };
