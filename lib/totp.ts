import { createHmac } from "node:crypto";

// Códigos de verificación en dos pasos (TOTP, RFC 6238): los mismos 6 dígitos
// que muestra Google Authenticator, calculados a partir de la clave secreta
// que la plataforma entrega al activar el 2FA (texto base32 o enlace otpauth://).

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Extrae la clave base32 de un texto pegado por el usuario. Devuelve null si no es válida. */
export function parseTotpSecret(input: string): string | null {
  let s = input.trim();
  if (/^otpauth:\/\//i.test(s)) {
    try {
      s = new URL(s).searchParams.get("secret") ?? "";
    } catch {
      return null;
    }
  }
  s = s.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (s.length < 16 || [...s].some((ch) => !B32.includes(ch))) return null;
  return s;
}

function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Código de 6 dígitos para el instante dado (por defecto, ahora). */
export function totp(secret: string, at = Date.now(), step = 30, digits = 6): string {
  const clean = parseTotpSecret(secret);
  if (!clean) throw new Error("Clave 2FA inválida");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = createHmac("sha1", base32Decode(clean)).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}
