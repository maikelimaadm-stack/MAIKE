/**
 * D-PROD-263 — RATEIO das linhas do registro de campo de VÁRIAS áreas (`POST /atividades/registrar` com `areas[]`).
 *
 * O cliente manda os TOTAIS do dia (o insumo gasto, as horas da máquina, a equipe, o serviço) e os hectares de cada
 * área; o servidor reparte cada linha entre as áreas na proporção dos hectares (a área i leva hᵢ ÷ Σh) e grava um
 * apontamento por área, cada um com a sua parte. Aqui só a conta, sem banco e sem regra de negócio: as partes passam
 * depois pelas MESMAS regras de cada linha (`criarLinhasProduto`, `criarLinhasMaquina`, …).
 *
 *  - Quantidade (insumo, mão de obra, serviço, uso da máquina sem medidor): `total × hᵢ ÷ Σh` com 4 casas (meio para
 *    cima); a ÚLTIMA área leva o resto, e as partes somam EXATAMENTE o total. A parte que fica em zero (ou, no caso raro
 *    do resto, abaixo de zero) sai daquela área e vai para a área de MAIS hectares entre as que ficam: nunca sai linha
 *    zerada.
 *  - Máquina com medidor: o intervalo [leitura_inicial, leitura_final] vira segmentos SEGUIDOS, na ordem das áreas (a
 *    1ª começa na inicial, cada uma começa onde a anterior terminou, a última termina exatamente na final), com o uso
 *    repartido como acima. Várias linhas do MESMO bem (várias passadas no dia) são uma série só: as áreas levam
 *    trechos seguidos dela, na ordem do corpo, e o medidor nunca anda para trás entre um apontamento e o próximo.
 *
 * Cada parte guarda a POSIÇÃO da linha no corpo (`indice`), para a recusa de uma área apontar a linha que o cliente
 * enviou.
 */

import { Dec, dec } from '../financeiro/decimalFinanceiro.js';

const CASAS = 4;

/** @param {import('@prisma/client').Prisma.Decimal[]} v */
const soma = (v) => v.reduce((t, x) => t.plus(x), new Dec(0));

/**
 * A área de mais hectares entre as candidatas (empate: a primeira na ordem do corpo).
 * @param {number[]} candidatas @param {import('@prisma/client').Prisma.Decimal[]} h
 */
const deMaisHectares = (candidatas, h) => candidatas.reduce((m, i) => (h[i].gt(h[m]) ? i : m), candidatas[0]);

/**
 * As partes de `total` por área, na proporção dos hectares. `null` = a linha não vai para aquela área (a parte ficou em
 * zero). Total zero (só o uso de uma máquina com medidor parado): tudo na área de mais hectares.
 * @param {string} total  texto decimal ≥ 0
 * @param {string[]} hectares  um por área, todos > 0
 * @returns {Array<string|null>}
 */
export const partesPorHectares = (total, hectares) => {
  const t = dec(total);
  const h = hectares.map((x) => dec(x));
  const n = h.length;
  const todas = h.map((_, i) => i);
  if (n === 0) return [];
  /** @type {Array<import('@prisma/client').Prisma.Decimal|null>} */
  const partes = new Array(n).fill(null);
  if (!t.gt(0)) {
    partes[deMaisHectares(todas, h)] = t;
    return partes.map((p) => (p === null ? null : p.toFixed(CASAS)));
  }
  const somaH = soma(h);
  for (let i = 0; i < n - 1; i += 1) partes[i] = t.times(h[i]).dividedBy(somaH).toDecimalPlaces(CASAS, Dec.ROUND_HALF_UP);
  partes[n - 1] = t.minus(soma(/** @type {any[]} */ (partes.slice(0, n - 1))));
  // A parte ≤ 0 sai e vai para a área de mais hectares que ficou (repete: somar um resto negativo pode zerar aquela).
  for (;;) {
    const zerada = todas.find((i) => partes[i] !== null && !(/** @type {any} */ (partes[i]).gt(0)));
    if (zerada === undefined) break;
    const valor = /** @type {import('@prisma/client').Prisma.Decimal} */ (partes[zerada]);
    partes[zerada] = null;
    const alvo = deMaisHectares(todas.filter((i) => partes[i] !== null), h);
    partes[alvo] = /** @type {import('@prisma/client').Prisma.Decimal} */ (partes[alvo]).plus(valor);
  }
  return partes.map((p) => (p === null ? null : p.toFixed(CASAS)));
};

/**
 * Os trechos do medidor de UM bem entre as áreas. `linhas`: as linhas com medidor desse bem, na ordem do corpo, cada uma
 * com a inicial e a final já conhecidas (a inicial que o corpo não trouxe é a vigente na data; ver o serviço). A série
 * delas, emendada, é repartida pelos hectares: a área 1 leva o começo, a 2 o trecho seguinte, e assim por diante. Uma
 * linha que cai em duas áreas vira dois trechos (a 1ª termina onde a 2ª começa). A linha de uso zero (inicial = final)
 * fica com a área em cujo trecho ela cai. Devolve os trechos por área, cada um com o `indice` da linha no corpo.
 * @param {Array<{ indice: number, inicial: string, final: string }>} linhas
 * @param {string[]} hectares
 * @returns {Array<Array<{ indice: number, inicial: string, final: string }>>} por área, na ordem do corpo
 */
export const trechosDoMedidor = (linhas, hectares) => {
  /** @type {Array<Array<{ indice: number, inicial: string, final: string }>>} */
  const porArea = hectares.map(() => []);
  if (!linhas.length) return porArea;
  const usos = linhas.map((l) => dec(l.final).minus(dec(l.inicial)));
  const partes = partesPorHectares(soma(usos).toFixed(CASAS), hectares);
  const recebem = partes.map((p, i) => (p === null ? -1 : i)).filter((i) => i >= 0);
  // O trecho da série de cada área que recebe: [de, ate) em uso acumulado.
  const faixas = [];
  let acumulado = new Dec(0);
  for (const i of recebem) {
    const de = acumulado;
    acumulado = acumulado.plus(dec(/** @type {string} */ (partes[i])));
    faixas.push({ area: i, de, ate: acumulado });
  }
  let inicioDaLinha = new Dec(0);
  for (const [k, l] of linhas.entries()) {
    const fimDaLinha = inicioDaLinha.plus(usos[k]);
    const base = dec(l.inicial);
    if (!usos[k].gt(0)) {
      const faixa = faixas.find((f) => inicioDaLinha.gte(f.de) && inicioDaLinha.lt(f.ate)) ?? faixas[faixas.length - 1];
      porArea[faixa.area].push({ indice: l.indice, inicial: base.toFixed(CASAS), final: dec(l.final).toFixed(CASAS) });
    } else {
      for (const f of faixas) {
        const de = Dec.max(inicioDaLinha, f.de);
        const ate = Dec.min(fimDaLinha, f.ate);
        if (!ate.gt(de)) continue;
        porArea[f.area].push({
          indice: l.indice,
          inicial: base.plus(de.minus(inicioDaLinha)).toFixed(CASAS),
          // O último trecho da linha termina EXATAMENTE na final do corpo.
          final: ate.eq(fimDaLinha) ? dec(l.final).toFixed(CASAS) : base.plus(ate.minus(inicioDaLinha)).toFixed(CASAS),
        });
      }
    }
    inicioDaLinha = fimDaLinha;
  }
  for (const lista of porArea) lista.sort((a, b) => a.indice - b.indice);
  return porArea;
};
