/**
 * D-PROD-273 (fatia 4) — o CUSTO do fechamento do período do cocho, no SERVIDOR.
 *
 * Porte exato (mesma aritmética em Number, mesmos arredondamentos) da parte de custo de
 * `src/domain/suplementacao/fechamentoConsumo.js` (D-PROD-206/212): `camadasDaSobraHerdada`,
 * `custoDoConsumoComSobraPrimeiro` e os campos de custo de `calcularFechamentoConsumo`. O fechamento continua
 * sendo gravado pela tela; o servidor só REFAZ o custo quando a exclusão com recálculo muda o custo/kg da saída de
 * estoque de um lançamento (ou o da sobra que ele herdou). O teste do smoke compara este porte com a função da tela.
 *
 * `recalcularCustosDosCochos` percorre a cadeia de cada cocho (lançamentos ativos em ordem de data e cadastro):
 * para cada lançamento afetado (o custo da saída dele mudou, ou o do fechamento anterior de que herdou a sobra),
 * PRIMEIRO refaz o fechamento com os dados de antes e exige que bata com o gravado (fail-closed: não se recalcula o
 * que não se sabe reproduzir) e SÓ ENTÃO refaz com o custo novo. Puro: sem banco.
 */

/** @param {unknown} v */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** @param {number} v @param {number} casas */
const arred = (v, casas) => Number(v.toFixed(casas));

/** Porte de `camadasDaSobraHerdada` (D-PROD-212). */
export const camadasDaSobraHerdada = ({ sobraKg, camadas, custoAnteriorKg = null, custoLancamentoKg }) => {
  const kg = Math.max(0, num(sobraKg) ?? 0);
  if (!(kg > 0)) return { camadas: [], aproximado: false };
  const validas = Array.isArray(camadas)
    ? camadas
      .map((c) => ({ kg: num(c?.kg), custo_kg: num(c?.custo_kg) }))
      .filter((c) => c.kg !== null && c.kg > 0 && c.custo_kg !== null && c.custo_kg >= 0)
    : [];
  const soma = validas.reduce((t, c) => t + Number(c.kg), 0);
  if (validas.length > 0 && soma > 0) {
    return { camadas: validas.map((c) => ({ kg: (Number(c.kg) / soma) * kg, custo_kg: c.custo_kg })), aproximado: false };
  }
  const anterior = num(custoAnteriorKg);
  if (anterior !== null && anterior >= 0) return { camadas: [{ kg, custo_kg: anterior }], aproximado: false };
  const atual = num(custoLancamentoKg);
  return { camadas: [{ kg, custo_kg: atual !== null && atual >= 0 ? atual : null }], aproximado: true };
};

/** Porte de `custoDoConsumoComSobraPrimeiro` (D-PROD-212). */
export const custoDoConsumoComSobraPrimeiro = ({ consumoKg, sobraHerdada, fornecidoKg, custoLancamentoKg }) => {
  const custoLanc = Number(custoLancamentoKg);
  const camadas = [
    ...(sobraHerdada || []).map((c) => ({ kg: Number(c.kg), custo_kg: c.custo_kg === null ? custoLanc : Number(c.custo_kg) })),
    { kg: Math.max(0, num(fornecidoKg) ?? 0), custo_kg: custoLanc },
  ].filter((c) => c.kg > 0);
  let falta = Math.max(0, num(consumoKg) ?? 0);
  let custo = 0;
  const resto = [];
  for (const c of camadas) {
    const usa = Math.min(c.kg, falta);
    custo += usa * c.custo_kg;
    falta -= usa;
    const sobra = c.kg - usa;
    if (sobra > 1e-9) resto.push({ kg: arred(sobra, 3), custo_kg: arred(c.custo_kg, 4) });
  }
  if (falta > 1e-9) custo += falta * custoLanc;
  return { custoTotal: custo, sobraFinalCamadas: resto };
};

/** Cabeças que consomem (porte de `cabecasQueConsomem`). @param {any} evento */
const cabecasQueConsomem = (evento) => {
  const total = num(evento?.total_cabecas_afetadas) ?? 0;
  const nao = num(evento?.cabecas_nao_consomem) ?? 0;
  return Math.max(0, total - nao);
};

/** Campos de CUSTO que o fechamento grava (o resto do fechamento — consumo, farol, %PV — não depende do custo). */
export const CAMPOS_CUSTO_FECHAMENTO = Object.freeze([
  'custo_unitario_kg', 'custo_total_periodo', 'custo_cab_dia', 'sobra_herdada_kg', 'custo_sobra_herdada_kg', 'custo_sobra_aproximado', 'sobra_final_camadas',
]);

/**
 * Os campos de custo de `calcularFechamentoConsumo` (mesma conta, mesmos arredondamentos).
 * @param {{ evento: any, consumoTotalKg: unknown, diasPeriodo: unknown, custoUnitarioKg: unknown, sobraInicialKg?: unknown,
 *   sobraHerdada?: { camadas?: unknown, custoAnteriorKg?: unknown }|null }} p
 */
export const custoDoFechamento = ({ evento, consumoTotalKg, diasPeriodo, custoUnitarioKg, sobraInicialKg = null, sobraHerdada = null }) => {
  const dias = Math.max(1, Math.round(num(diasPeriodo) ?? 1));
  const total = Math.max(0, num(consumoTotalKg) ?? 0);
  const cab = cabecasQueConsomem(evento);
  const custoKg = num(custoUnitarioKg);
  const temCusto = custoKg !== null && custoKg >= 0;
  let custoTotal = null;
  let sobraFinalCamadas = null;
  let sobraHerdadaKg = null;
  let custoSobraHerdadaKg = null;
  let custoSobraAproximado = null;
  if (temCusto && sobraHerdada) {
    const herdada = camadasDaSobraHerdada({ sobraKg: sobraInicialKg, camadas: sobraHerdada.camadas, custoAnteriorKg: sobraHerdada.custoAnteriorKg, custoLancamentoKg: custoKg });
    const r = custoDoConsumoComSobraPrimeiro({ consumoKg: total, sobraHerdada: herdada.camadas, fornecidoKg: evento?.quantidade_total_kg, custoLancamentoKg: custoKg });
    custoTotal = r.custoTotal;
    sobraFinalCamadas = r.sobraFinalCamadas;
    const kgH = herdada.camadas.reduce((t, c) => t + c.kg, 0);
    sobraHerdadaKg = arred(kgH, 3);
    custoSobraHerdadaKg = kgH > 0 ? arred(herdada.camadas.reduce((t, c) => t + c.kg * (c.custo_kg ?? /** @type {number} */ (custoKg)), 0) / kgH, 4) : null;
    custoSobraAproximado = kgH > 0 ? herdada.aproximado : null;
  } else if (temCusto) {
    custoTotal = total * /** @type {number} */ (custoKg);
  }
  return {
    custo_unitario_kg: temCusto ? custoKg : null,
    custo_total_periodo: custoTotal === null ? null : arred(custoTotal, 2),
    custo_cab_dia: custoTotal === null || cab <= 0 ? null : arred(custoTotal / (cab * dias), 4),
    sobra_herdada_kg: sobraHerdadaKg,
    custo_sobra_herdada_kg: custoSobraHerdadaKg,
    custo_sobra_aproximado: custoSobraAproximado,
    sobra_final_camadas: sobraFinalCamadas,
  };
};

/** JSON com chaves ordenadas (jsonb não guarda a ordem). @param {unknown} v @returns {string} */
const canonico = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(/** @type {any} */ (v)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};
const tem = (o, k) => Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const fechado = (d) => num(d?.dias_periodo) !== null;
/** O fechamento gravou o custo (D-PROD-206). Com `sobra_final_camadas` em lista, é o da D-PROD-212 (sobra antiga primeiro). */
const fechamentoComCusto = (d) => fechado(d) && num(d?.custo_total_periodo) !== null && num(d?.custo_unitario_kg) !== null;
const camadasNaoVazias = (d) => Array.isArray(d?.sobra_final_camadas) && d.sobra_final_camadas.length > 0;

/**
 * Refaz o custo do fechamento de `d` com o custo/kg `custoKg` e o fechamento anterior `anterior` (dados) do cocho.
 * `custoDoAnterior`: o custo/kg do lançamento anterior quando ele não gravou camadas (a tela usa o gravado ou o do
 * movimento dele).
 */
const refazer = (d, custoKg, anterior, custoDoAnterior) => {
  const dias = num(d.dias_periodo);
  const consumoTotal = (num(d.consumo_diario_grupo_kg) ?? 0) * /** @type {number} */ (dias);
  const d212 = Array.isArray(d.sobra_final_camadas);
  const sobraHerdada = !d212 ? null : !anterior ? {} : camadasNaoVazias(anterior) ? { camadas: anterior.sobra_final_camadas } : { custoAnteriorKg: custoDoAnterior };
  return custoDoFechamento({ evento: d, consumoTotalKg: consumoTotal, diasPeriodo: dias, custoUnitarioKg: custoKg, sobraInicialKg: d212 ? d.sobra_herdada_kg : null, sobraHerdada });
};

/** Os campos de custo recalculados batem com os gravados (só os que o fechamento gravou). */
const bate = (d, r) => CAMPOS_CUSTO_FECHAMENTO.every((k) => !tem(d, k) || (d[k] === null && r[k] === null) || canonico(d[k]) === canonico(r[k]));

/**
 * Recalcula o custo dos lançamentos de cocho que dependem das saídas de estoque recalculadas.
 * @param {Array<{ id: string, createdAt: Date|string, dados: any }>} eventos lançamentos ATIVOS dos cochos envolvidos (qualquer ordem)
 * @param {Map<string, { antes: number|null, depois: number|null }>} custos movimento → custo/kg (valor unitário) antes e depois
 * @returns {{ patches: Array<{ id: string, antes: Record<string, unknown>, depois: Record<string, unknown>, dados: any }>,
 *   recusa: null | { reason: string, evento_id: string } }}
 */
export const recalcularCustosDosCochos = (eventos, custos) => {
  /** @type {Map<string, any[]>} */
  const porCocho = new Map();
  for (const e of eventos) {
    const ponto = typeof e.dados?.ponto_suplementacao_id === 'string' ? e.dados.ponto_suplementacao_id : null;
    if (!ponto) continue;
    if (!porCocho.has(ponto)) porCocho.set(ponto, []);
    porCocho.get(ponto)?.push(e);
  }
  const chave = (e) => `${String(e.dados?.data_lancamento ?? '').slice(0, 10)}|${new Date(e.createdAt).toISOString()}|${e.id}`;
  const patches = [];
  for (const lista of porCocho.values()) {
    lista.sort((a, b) => (chave(a) < chave(b) ? -1 : chave(a) > chave(b) ? 1 : 0));
    /** @type {{ antes: any, depois: any, custoAntes: number|null, custoDepois: number|null }|null} */
    let anterior = null;
    for (const e of lista) {
      const d = e.dados ?? {};
      const mov = typeof d.movimentacao_estoque_id === 'string' ? custos.get(d.movimentacao_estoque_id) : undefined;
      const gravado = num(d.custo_unitario_kg);
      const custoAntes = gravado ?? mov?.antes ?? null;
      const custoDepois = mov ? mov.depois : custoAntes;
      if (mov && gravado !== null && mov.antes !== null && gravado !== mov.antes) return { patches: [], recusa: { reason: 'cocho_custo_divergente_do_movimento', evento_id: e.id } };
      const herdaMudou = anterior !== null && canonico(anterior.antes) !== canonico(anterior.depois);
      let novo = d;
      if (fechamentoComCusto(d) && (mov || herdaMudou)) {
        const velho = refazer(d, custoAntes, anterior?.antes ?? null, anterior?.custoAntes ?? null);
        if (!bate(d, velho)) return { patches: [], recusa: { reason: 'cocho_fechamento_nao_reproduzivel', evento_id: e.id } };
        const r = refazer(d, custoDepois, anterior?.depois ?? null, anterior?.custoDepois ?? null);
        novo = { ...d };
        for (const k of CAMPOS_CUSTO_FECHAMENTO) if (tem(d, k)) novo[k] = r[k];
      } else if (mov && gravado !== null) {
        novo = { ...d, custo_unitario_kg: custoDepois };
      }
      if (canonico(novo) !== canonico(d)) {
        /** @type {Record<string, unknown>} */
        const antes = {};
        /** @type {Record<string, unknown>} */
        const depois = {};
        for (const k of CAMPOS_CUSTO_FECHAMENTO) {
          if (canonico(d[k]) !== canonico(novo[k])) {
            antes[k] = d[k] ?? null;
            depois[k] = novo[k] ?? null;
          }
        }
        patches.push({ id: e.id, antes, depois, dados: novo });
      }
      if (fechado(d)) anterior = { antes: d, depois: novo, custoAntes, custoDepois };
    }
  }
  return { patches, recusa: null };
};
