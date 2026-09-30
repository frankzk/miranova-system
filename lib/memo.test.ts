import assert from "node:assert/strict";
import { test } from "node:test";
import { clearMemo, memo } from "./memo.ts";

test("memoria corta: reutiliza dentro del plazo, vuelve a consultar después y no guarda errores", async () => {
  clearMemo();
  let calls = 0;
  const fn = async () => ++calls;
  assert.equal(await memo("k", 1000, fn, 0), 1);
  assert.equal(await memo("k", 1000, fn, 999), 1);
  assert.equal(await memo("otra", 1000, fn, 999), 2);
  assert.equal(await memo("k", 1000, fn, 1000), 3);

  let fail = true;
  const flaky = async () => {
    if (fail) throw new Error("x");
    return "ok";
  };
  await assert.rejects(memo("f", 1000, flaky, 0));
  await new Promise((r) => setTimeout(r, 0));
  fail = false;
  assert.equal(await memo("f", 1000, flaky, 1), "ok");
});
