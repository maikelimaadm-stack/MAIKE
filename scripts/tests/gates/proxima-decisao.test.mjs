// D-PROD-277 — o próximo número de decisão livre (scripts/dev/proxima-decisao.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { numeroDoMarcador, numerosDosTitulos, proximaLivre } from "../../dev/proxima-decisao.mjs";

test("PD-1 lê o único marcador do DECISIONS.md", () => {
  assert.equal(numeroDoMarcador("x\n<!-- Próxima decisão: D-PROD-277 -->\n"), 277);
  assert.throws(() => numeroDoMarcador("sem marcador"), /achei 0/);
  assert.throws(() => numeroDoMarcador("<!-- Próxima decisão: D-PROD-1 -->\n<!-- Próxima decisão: D-PROD-2 -->"), /achei 2/);
});

test("PD-2 o DECISIONS.md do repositório tem exatamente um marcador", () => {
  const n = numeroDoMarcador(readFileSync("docs/engineering/DECISIONS.md", "utf8"));
  assert.ok(Number.isInteger(n) && n > 0);
});

test("PD-3 número citado em PR aberta fica reservado", () => {
  const titulos = ["#350 Estoque: ajuste (D-PROD-272)", "#344 Base1: listas", "#360 exclusão (D-PROD-273, D-PROD-274)"];
  assert.deepEqual(numerosDosTitulos(titulos), [272, 273, 274]);
  assert.equal(proximaLivre(272, [272, 273, 274]), 275);
  assert.equal(proximaLivre(276, [273]), 276);
  assert.equal(proximaLivre(276, []), 276);
});
