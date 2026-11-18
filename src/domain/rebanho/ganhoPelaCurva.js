/**
 * Ganho de peso pela Curva de Ganho mensal — D-PROD-212. Funções PURAS (sem
 * React, sem rede, sem `new Date()`).
 *
 * É a MESMA regra do peso projetado do servidor (D-PROD-198,
 * `backend/src/modules/rebanhoLedger/pesoProjetado.js` → `ganhoNoPeriodo`):
 * soma o GMD do MÊS de cada dia em (de, ate] — o dia de partida não conta, o
 * dia-alvo conta —, mês a mês. O front não pode importar o backend (fronteira
 * de API), então a regra vive aqui com o mesmo nome e o teste
 * `tests/smoke/fechamentoRefinamentos.test.jsx` confere as duas lado a lado.
 *
 * A curva do lote chega ao front pela projeção de peso da posição
 * (`projecao_peso`, D-PROD-198): o servidor manda o peso de hoje e o peso no
 * fim de cada um dos 12 meses seguintes; daí sai o GMD de cada mês
 * (`curvaDaProjecaoDePeso`). O lançamento de suplementação grava essa curva em
 * cada lote do período (`gmd_mensal_kg`) para o fechamento projetar o peso no
 * fim do período.
 */

export const MESES_CURVA = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);

const DIA_MS = 86_400_000;
const ehDia = (dia) => typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia.slice(0, 10));
const msDoDia = (dia) => Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)));
const diaDeMs = (ms) => new Date(ms).toISOString().slice(0, 10);
const somarDias = (dia, n) => diaDeMs(msDoDia(dia) + n * DIA_MS);
const diasEntre = (de, ate) => Math.round((msDoDia(ate) - msDoDia(de)) / DIA_MS);
const ultimoDiaDoMes = (ano, mes0) => diaDeMs(Date.UTC(ano, mes0 + 1, 0));

/** GMD (kg/dia) do mês `mes0` (0 = janeiro); ausente → null (não se inventa 0). */
export const gmdDoMesOuNulo = (curva, mes0) => {
  const v = curva ? curva[`gmd_${MESES_CURVA[mes0]}`] : undefined;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Ganho (kg) em (de, ate] pela curva — a mesma conta do `ganhoNoPeriodo` do
 * servidor. `ate` ≤ `de` → 0. Mês sem GMD na curva → null (o chamador decide:
 * o fechamento cai para o peso do lançamento e marca aproximado).
 * @param {Record<string, unknown>|null|undefined} curva { gmd_jan, …, gmd_dez }
 * @param {string} de AAAA-MM-DD
 * @param {string} ate AAAA-MM-DD
 * @returns {number|null}
 */
export const ganhoNoPeriodo = (curva, de, ate) => {
  if (!curva || !ehDia(de) || !ehDia(ate)) return null;
  const ini = de.slice(0, 10);
  const fimAlvo = ate.slice(0, 10);
  if (fimAlvo <= ini) return 0;
  let ganho = 0;
  let cursor = somarDias(ini, 1);
  while (cursor <= fimAlvo) {
    const ano = Number(cursor.slice(0, 4));
    const mes0 = Number(cursor.slice(5, 7)) - 1;
    const fimMes = ultimoDiaDoMes(ano, mes0);
    const fim = fimMes < fimAlvo ? fimMes : fimAlvo;
    const gmd = gmdDoMesOuNulo(curva, mes0);
    if (gmd === null) return null;
    ganho += gmd * (diasEntre(cursor, fim) + 1);
    cursor = somarDias(fim, 1);
  }
  return ganho;
};

/**
 * Curva mensal ({ gmd_jan, …, gmd_dez }) a partir da projeção de peso que o
 * servidor manda com a posição (`projecao_peso`, D-PROD-198): peso de `dia` e
 * o peso no fim de cada um dos 12 meses seguintes (`projecao_mensal`). O GMD de
 * cada mês = ganho do mês ÷ dias do mês; o mês de `dia` usa os dias depois dele
 * (ou o `gmd_hoje_kg`, quando `dia` é o último do mês). Sem projeção, ou
 * categoria sem curva (`sem_curva`) → null: o fechamento não inventa GMD.
 * @param {any} projecao `projecao_peso` da posição
 * @returns {Record<string, number>|null}
 */
export const curvaDaProjecaoDePeso = (projecao) => {
  if (!projecao?.disponivel || projecao.sem_curva) return null;
  const dia = typeof projecao.dia === 'string' ? projecao.dia.slice(0, 10) : null;
  const peso = Number(projecao.peso_kg);
  const meses = Array.isArray(projecao.projecao_mensal) ? projecao.projecao_mensal : [];
  if (!ehDia(dia) || !Number.isFinite(peso) || meses.length === 0) return null;
  /** @type {Record<string, number>} */
  const curva = {};
  let anteriorDia = dia;
  let anteriorPeso = peso;
  for (const m of meses) {
    const fim = typeof m?.dia === 'string' ? m.dia.slice(0, 10) : null;
    const w = Number(m?.peso_kg);
    if (!ehDia(fim) || !Number.isFinite(w)) return null;
    const mes0 = Number(fim.slice(5, 7)) - 1;
    const dias = diasEntre(anteriorDia, fim);
    let gmd;
    if (dias > 0) gmd = (w - anteriorPeso) / dias;
    else {
      const hoje = Number(projecao.gmd_hoje_kg);
      gmd = Number.isFinite(hoje) ? hoje : null;
    }
    if (gmd === null) return null;
    curva[`gmd_${MESES_CURVA[mes0]}`] = Number(gmd.toFixed(4));
    anteriorDia = fim;
    anteriorPeso = w;
  }
  return MESES_CURVA.every((m) => typeof curva[`gmd_${m}`] === 'number') ? curva : null;
};
