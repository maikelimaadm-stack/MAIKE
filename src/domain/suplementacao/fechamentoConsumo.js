/**
 * Fechamento do CONSUMO de um período do cocho — D-PROD-206 (etapa 4 da
 * suplementação). Funções PURAS: sem React, sem rede, sem storage e sem
 * `new Date()`.
 *
 * Quando um abastecimento novo (ou a saída do gado) fecha o período anterior,
 * o consumo real é comparado com o ESPERADO que o lançamento gravou pela
 * formulação (`consumo_esperado_pv_kg`, D-PROD-203: %PV de cada lote, com as
 * regras por categoria):
 *
 *  - consumo real (kg) = fornecido + sobra anterior − sobra final (≥ 0);
 *  - kg/dia do grupo = consumo real ÷ dias; g/cab/dia = kg/dia ÷ cabeças que
 *    CONSOMEM (as de categoria que não consome a formulação ficam fora) × 1000;
 *  - %PV real = kg/dia ÷ peso vivo de quem consome × 100; %PV esperado = o
 *    esperado (kg/dia) ÷ o mesmo peso vivo × 100;
 *  - relação = real ÷ esperado. Farol pela FAIXA de tolerância da formulação
 *    (padrão 15%): abaixo de (100 − faixa)% → "abaixo" (vermelho); acima de
 *    (100 + faixa)% → "acima" (azul); entre os dois, inclusive → "dentro"
 *    (verde). Sem esperado, ou cocho compartilhado (os mesmos animais com o
 *    mesmo produto em outro cocho: não se rateia), → "sem_referencia";
 *  - custo: consumo real × custo/kg da saída de estoque (FIFO) do lançamento;
 *    R$/cab/dia = custo do período ÷ (cabeças que consomem × dias).
 *
 * Sobra não informada (campo vazio no abastecimento) conta como 0, e o
 * resultado fica marcado `sobra_informada: false` ("Aproximado").
 *
 * D-PROD-210 — BASE do consumo da formulação gravada no lançamento
 * (`base_consumo`; evento sem o campo = 'PV'):
 *  - 'PV': como acima; o g/cab/dia é só informação;
 *  - 'G_CAB_DIA' (sal mineral, quantidade fixa por cabeça): a meta é o
 *    g/cab/dia esperado (`consumo_esperado_g_cab_dia` do lançamento; evento sem
 *    ele → esperado kg/dia ÷ cabeças que consomem × 1000). Relação = g/cab/dia
 *    real ÷ g/cab/dia esperado, mesma faixa e mesmo farol. Não há %PV esperado
 *    (null); o %PV real aparece só como informação, quando há peso.
 *
 * D-PROD-212 — dois refinamentos do fechamento (sem mudar o lançamento):
 *  1. PESO MÉDIO DO PERÍODO (só na base PV): o esperado do FECHAMENTO usa, em
 *     cada lote que consome, o peso médio entre o início (lançamento) e o fim do
 *     período (fechamento), projetado pela curva de ganho que o lançamento
 *     gravou no lote (`gmd_mensal_kg`, mesma regra do peso projetado D-PROD-198):
 *     peso médio = peso do lançamento + ganho do período ÷ 2. Esperado do lote =
 *     esperado do lançamento × peso médio ÷ peso do lançamento (o %PV da regra
 *     da categoria não muda). Lote sem peso próprio, sem curva gravada (evento
 *     anterior a esta decisão, lote legado, categoria sem curva) → fica com o
 *     peso do lançamento e o resultado é marcado aproximado, com o motivo. O
 *     esperado do LANÇAMENTO (`consumo_esperado_pv_kg`, taxa do nível do cocho)
 *     não muda. Na base G_CAB_DIA a meta não depende do peso; o peso médio só
 *     entra no %PV informativo. → `pesoMedioDoPeriodo`.
 *  2. A SOBRA ANTIGA SAI PRIMEIRO NO CUSTO: o consumo do período é atendido
 *     primeiro pela sobra herdada do período anterior (às camadas de custo dela)
 *     e depois pelo fornecido do lançamento (ao custo/kg da saída FIFO). A sobra
 *     final fica gravada em camadas (`sobra_final_camadas`, mais antiga primeiro)
 *     para o próximo período. Sem as camadas do período anterior (evento antigo),
 *     a sobra herdada vale o custo/kg do lançamento anterior do cocho; sem ele, o
 *     do lançamento atual, marcado aproximado. → `camadasDaSobraHerdada` e
 *     `custoDoConsumoComSobraPrimeiro` (isoladas: o proprietário avisou que a
 *     regra da sobra ainda vai ser ajustada).
 */

import { ganhoNoPeriodo } from '@/domain/rebanho/ganhoPelaCurva';
import { somarDias } from '@/lib/diaCivil';

/** Faixa de tolerância padrão do farol de consumo, em % do esperado. */
export const FAIXA_TOLERANCIA_PADRAO = 15;

/** @typedef {'abaixo'|'dentro'|'acima'|'sem_referencia'} FarolConsumo */

/** Rótulo, cor e símbolo de cada farol (o texto sempre acompanha a cor). */
export const FAROL_CONSUMO = Object.freeze({
  abaixo: Object.freeze({ rotulo: 'Abaixo', cor: 'vermelho', simbolo: '🔴' }),
  dentro: Object.freeze({ rotulo: 'Dentro', cor: 'verde', simbolo: '🟢' }),
  acima: Object.freeze({ rotulo: 'Acima', cor: 'azul', simbolo: '🔵' }),
  sem_referencia: Object.freeze({ rotulo: 'Sem referência', cor: 'neutro', simbolo: '⚪' }),
});

/** Campos que o fechamento grava no evento (e a reabertura limpa). */
export const CAMPOS_FECHAMENTO_CONSUMO = Object.freeze([
  'consumo_g_cab_dia',
  'consumo_real_pv_percentual',
  'consumo_esperado_pv_percentual',
  'consumo_relacao_esperado',
  'farol_consumo',
  'farol_consumo_motivo',
  'faixa_tolerancia_aplicada',
  'base_consumo_aplicada',
  'sobra_informada',
  'custo_total_periodo',
  'custo_cab_dia',
  // D-PROD-212
  'peso_medio_periodo_kg',
  'peso_medio_periodo_aproximado',
  'peso_medio_periodo_motivo',
  'consumo_esperado_fechamento_kg_dia',
  'sobra_herdada_kg',
  'custo_sobra_herdada_kg',
  'custo_sobra_aproximado',
  'sobra_final_camadas',
]);

/** D-PROD-212 — por que o peso médio do período é aproximado. */
export const MOTIVOS_PESO_MEDIO = Object.freeze(['sem_data', 'sem_lotes', 'sem_curva', 'sem_peso']);

/** @param {unknown} v */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** @param {number} v @param {number} casas */
const arred = (v, casas) => Number(v.toFixed(casas));

/**
 * Faixa de tolerância válida (0 < x ≤ 100), senão o padrão de 15%.
 * @param {unknown} valor
 */
export const faixaDeTolerancia = (valor) => {
  const n = num(valor);
  return n !== null && n > 0 && n <= 100 ? n : FAIXA_TOLERANCIA_PADRAO;
};

/**
 * Farol pela relação real ÷ esperado e a faixa (em %). Os limites exatos
 * (85% e 115% com a faixa de 15%) ficam DENTRO. A relação é comparada em
 * milésimos de ponto percentual para não depender de ruído de ponto flutuante.
 * @param {number|null} relacao
 * @param {number} faixa
 * @returns {FarolConsumo}
 */
export const farolPelaRelacao = (relacao, faixa) => {
  if (relacao === null || !Number.isFinite(relacao)) return 'sem_referencia';
  const pct = Math.round(relacao * 100 * 1000);
  if (pct < Math.round((100 - faixa) * 1000)) return 'abaixo';
  if (pct > Math.round((100 + faixa) * 1000)) return 'acima';
  return 'dentro';
};

/**
 * Cabeças que CONSOMEM a formulação no evento (as de categoria que não
 * consome — `cabecas_nao_consomem`, D-PROD-203 — ficam fora).
 * @param {any} evento
 */
export const cabecasQueConsomem = (evento) => {
  const total = num(evento?.total_cabecas_afetadas) ?? 0;
  const nao = num(evento?.cabecas_nao_consomem) ?? 0;
  return Math.max(0, total - nao);
};

/**
 * Peso vivo (kg) de quem consome, gravado no lançamento (`peso_vivo_consumo_kg`,
 * D-PROD-206). Evento antigo: peso médio dos lotes × cabeças que consomem;
 * sem peso → null.
 * @param {any} evento
 */
export const pesoVivoDeConsumo = (evento) => {
  const gravado = num(evento?.peso_vivo_consumo_kg);
  if (gravado !== null && gravado > 0) return gravado;
  const medio = num(evento?.peso_medio_lotes_kg);
  const cab = cabecasQueConsomem(evento);
  return medio !== null && medio > 0 && cab > 0 ? medio * cab : null;
};

/**
 * D-PROD-212 — peso médio do período e o esperado do FECHAMENTO (base PV).
 *
 * Para cada lote do período que consome (`percentual_pv_lote` > 0; lote antigo
 * sem o campo: com esperado ou gramas), com peso próprio (`peso_medio_lote_kg`)
 * e curva gravada no lançamento (`gmd_mensal_kg`): ganho = curva de (início,
 * fim]; peso médio = peso + ganho ÷ 2; esperado do lote × peso médio ÷ peso. O
 * esperado do fechamento = esperado do lançamento × (Σ esperados corrigidos ÷ Σ
 * esperados dos lotes) — sem ganho em nenhum lote, é exatamente o do lançamento.
 * Peso vivo médio de quem consome = peso vivo do lançamento + Σ cabeças × ganho
 * ÷ 2 dos lotes com curva.
 *
 * @param {object} p
 * @param {any} p.evento evento do período (o lançamento que abriu o ciclo)
 * @param {Array<any>|null|undefined} p.lotesDoEvento linhas de SuplementacaoLote do evento
 * @param {number} p.diasPeriodo dias do período (o fim = data do lançamento + dias)
 * @returns {{ peso_medio_periodo_kg: number|null, peso_vivo_medio_consumo_kg: number|null,
 *   consumo_esperado_fechamento_kg_dia: number|null, aproximado: boolean, motivo: null|'sem_data'|'sem_lotes'|'sem_curva'|'sem_peso' }}
 */
export const pesoMedioDoPeriodo = ({ evento, lotesDoEvento, diasPeriodo }) => {
  const dias = Math.max(1, Math.round(num(diasPeriodo) ?? 1));
  const inicio = typeof evento?.data_lancamento === 'string' ? evento.data_lancamento.slice(0, 10) : '';
  const fim = inicio ? somarDias(inicio, dias) : '';
  const esperadoLanc = num(evento?.consumo_esperado_pv_kg);
  const pvLanc = pesoVivoDeConsumo(evento);
  const cabCons = cabecasQueConsomem(evento);
  const semAjuste = (motivo) => ({
    peso_medio_periodo_kg: pvLanc && cabCons > 0 ? arred(pvLanc / cabCons, 2) : null,
    peso_vivo_medio_consumo_kg: pvLanc,
    consumo_esperado_fechamento_kg_dia: esperadoLanc,
    aproximado: true,
    motivo,
  });
  if (!fim) return semAjuste('sem_data');
  const lotes = Array.isArray(lotesDoEvento) ? lotesDoEvento : [];

  let somaEsperado = 0;
  let somaEsperadoCorrigido = 0;
  let ganhoPeso = 0;
  let consumidores = 0;
  let semCurva = false;
  let semPeso = false;
  for (const lote of lotes) {
    const cab = num(lote?.cabecas_na_area) ?? 0;
    if (!(cab > 0)) continue;
    const pct = num(lote?.percentual_pv_lote);
    const esperadoLote = num(lote?.consumo_esperado_pv_lote_kg);
    const gramas = num(lote?.g_cab_dia_lote);
    const consome = pct !== null ? pct > 0 : (esperadoLote ?? 0) > 0 || (gramas ?? 0) > 0;
    if (!consome) continue;
    consumidores += 1;
    const pesoIni = num(lote?.peso_medio_lote_kg);
    const ganho = pesoIni !== null && pesoIni > 0 ? ganhoNoPeriodo(lote?.gmd_mensal_kg, inicio, fim) : null;
    if (!(pesoIni !== null && pesoIni > 0)) semPeso = true;
    else if (ganho === null) semCurva = true;
    const fator = ganho !== null && pesoIni ? (pesoIni + ganho / 2) / pesoIni : 1;
    if (esperadoLote !== null && esperadoLote > 0) {
      somaEsperado += esperadoLote;
      somaEsperadoCorrigido += esperadoLote * fator;
    }
    if (ganho !== null) ganhoPeso += (cab * ganho) / 2;
  }
  if (consumidores === 0) return semAjuste('sem_lotes');

  const razao = somaEsperado > 0 ? somaEsperadoCorrigido / somaEsperado : 1;
  const pvMedio = pvLanc !== null ? pvLanc + ganhoPeso : null;
  const esperado = esperadoLanc !== null && esperadoLanc > 0 ? esperadoLanc * razao : esperadoLanc;
  return {
    peso_medio_periodo_kg: pvMedio && cabCons > 0 ? arred(pvMedio / cabCons, 2) : null,
    peso_vivo_medio_consumo_kg: pvMedio,
    consumo_esperado_fechamento_kg_dia: esperado === null ? null : arred(esperado, 4),
    aproximado: semCurva || semPeso,
    motivo: semCurva ? 'sem_curva' : semPeso ? 'sem_peso' : null,
  };
};

/**
 * D-PROD-212 — camadas de custo da sobra HERDADA do período anterior (a mais
 * antiga primeiro), ajustadas aos kg da sobra que este período herdou:
 *  - com as camadas que o fechamento anterior gravou (`sobra_final_camadas`):
 *    elas, em proporção, somando os kg herdados;
 *  - sem elas, com o custo/kg do lançamento anterior do cocho: uma camada só;
 *  - sem nada: uma camada ao custo/kg do lançamento ATUAL, marcada aproximada.
 * @param {{ sobraKg: unknown, camadas?: unknown, custoAnteriorKg?: unknown, custoLancamentoKg: unknown }} p
 * @returns {{ camadas: Array<{ kg: number, custo_kg: number|null }>, aproximado: boolean }}
 */
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

/**
 * D-PROD-212 — custo do consumo com a SOBRA ANTIGA SAINDO PRIMEIRO (FIFO no
 * cocho): consome as camadas herdadas, na ordem, e depois o fornecido do
 * lançamento ao custo/kg dele. O que sobra das camadas é a sobra final, em
 * camadas, para o período seguinte. Consumo maior que o disponível (não
 * acontece pela conta do consumo) → o excesso ao custo do lançamento.
 * @param {{ consumoKg: unknown, sobraHerdada: Array<{ kg: number, custo_kg: number|null }>, fornecidoKg: unknown, custoLancamentoKg: number }} p
 * @returns {{ custoTotal: number, sobraFinalCamadas: Array<{ kg: number, custo_kg: number }> }}
 */
export const custoDoConsumoComSobraPrimeiro = ({ consumoKg, sobraHerdada, fornecidoKg, custoLancamentoKg }) => {
  const custoLanc = Number(custoLancamentoKg);
  const camadas = [
    ...(sobraHerdada || []).map((c) => ({ kg: Number(c.kg), custo_kg: c.custo_kg === null ? custoLanc : Number(c.custo_kg) })),
    { kg: Math.max(0, num(fornecidoKg) ?? 0), custo_kg: custoLanc },
  ].filter((c) => c.kg > 0);
  let falta = Math.max(0, num(consumoKg) ?? 0);
  let custo = 0;
  /** @type {Array<{ kg: number, custo_kg: number }>} */
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

/**
 * Resultado do fechamento do consumo — o que gravar no evento.
 *
 * @param {object} p
 * @param {any} p.evento evento do período (o lançamento que abriu o ciclo)
 * @param {number} p.consumoTotalKg consumo real do período (fornecido + sobra anterior − sobra final)
 * @param {number} p.diasPeriodo dias do período (≥ 1)
 * @param {boolean|null} [p.sobraInformada] a sobra final foi medida? null = não se sabe (evento antigo)
 * @param {unknown} [p.faixaPercentual] faixa de tolerância da formulação (null → 15%)
 * @param {unknown} [p.custoUnitarioKg] R$/kg da saída de estoque do lançamento (null → sem custo)
 * @param {boolean} [p.compartilhado] outro cocho atende os mesmos animais com o mesmo produto
 * @param {ReturnType<typeof pesoMedioDoPeriodo>|null} [p.pesoMedio] D-PROD-212: peso médio do período (null = o do lançamento, como antes)
 * @param {unknown} [p.sobraInicialKg] D-PROD-212: kg herdados do período anterior
 * @param {{ camadas?: unknown, custoAnteriorKg?: unknown }|null} [p.sobraHerdada] D-PROD-212: custo da sobra herdada
 *   (null = custo todo pelo lançamento, como antes — prévia e eventos antigos)
 */
export const calcularFechamentoConsumo = ({
  evento,
  consumoTotalKg,
  diasPeriodo,
  sobraInformada = null,
  faixaPercentual = null,
  custoUnitarioKg = null,
  compartilhado = false,
  pesoMedio = null,
  sobraInicialKg = null,
  sobraHerdada = null,
}) => {
  const dias = Math.max(1, Math.round(num(diasPeriodo) ?? 1));
  const total = Math.max(0, num(consumoTotalKg) ?? 0);
  const kgDia = total / dias;
  const cab = cabecasQueConsomem(evento);
  const base = evento?.base_consumo === 'G_CAB_DIA' ? 'G_CAB_DIA' : 'PV';
  const pvMedio = pesoMedio ? num(pesoMedio.peso_vivo_medio_consumo_kg) : null;
  const pv = pvMedio !== null && pvMedio > 0 ? pvMedio : pesoVivoDeConsumo(evento);
  const esperadoLanc = num(evento?.consumo_esperado_pv_kg);
  const esperadoFech = pesoMedio ? num(pesoMedio.consumo_esperado_fechamento_kg_dia) : null;
  // D-PROD-212: na base PV o esperado do fechamento usa o peso médio do período; na base G a meta não muda.
  const esperado = base === 'PV' && esperadoFech !== null ? esperadoFech : esperadoLanc;
  const faixa = faixaDeTolerancia(faixaPercentual);
  const custoKg = num(custoUnitarioKg);

  const gReal = cab > 0 ? (kgDia / cab) * 1000 : null;
  const gEsperadoGravado = num(evento?.consumo_esperado_g_cab_dia);
  const gEsperado = base !== 'G_CAB_DIA'
    ? null
    : gEsperadoGravado !== null && gEsperadoGravado > 0
      ? gEsperadoGravado
      : esperadoLanc !== null && esperadoLanc > 0 && cab > 0 ? (esperadoLanc / cab) * 1000 : null;
  const relacao = base === 'G_CAB_DIA'
    ? (gReal !== null && gEsperado !== null && gEsperado > 0 ? gReal / gEsperado : null)
    : esperado !== null && esperado > 0 ? kgDia / esperado : null;
  /** @type {FarolConsumo} */
  let farol = farolPelaRelacao(relacao, faixa);
  /** @type {null|'sem_esperado'|'cocho_compartilhado'} */
  let motivo = null;
  if (relacao === null) motivo = 'sem_esperado';
  if (compartilhado) {
    farol = 'sem_referencia';
    motivo = 'cocho_compartilhado';
  }

  // Custo: sem `sobraHerdada`, tudo ao custo do lançamento (como na D-PROD-206); com ela, a sobra antiga sai primeiro.
  const temCusto = custoKg !== null && custoKg >= 0;
  let custoTotal = null;
  /** @type {null|Array<{ kg: number, custo_kg: number }>} */
  let sobraFinalCamadas = null;
  let sobraHerdadaKg = null;
  let custoSobraHerdadaKg = null;
  let custoSobraAproximado = null;
  if (temCusto && sobraHerdada) {
    const herdada = camadasDaSobraHerdada({
      sobraKg: sobraInicialKg,
      camadas: sobraHerdada.camadas,
      custoAnteriorKg: sobraHerdada.custoAnteriorKg,
      custoLancamentoKg: custoKg,
    });
    const r = custoDoConsumoComSobraPrimeiro({
      consumoKg: total,
      sobraHerdada: herdada.camadas,
      fornecidoKg: evento?.quantidade_total_kg,
      custoLancamentoKg: custoKg,
    });
    custoTotal = r.custoTotal;
    sobraFinalCamadas = r.sobraFinalCamadas;
    const kgH = herdada.camadas.reduce((t, c) => t + c.kg, 0);
    sobraHerdadaKg = arred(kgH, 3);
    custoSobraHerdadaKg = kgH > 0
      ? arred(herdada.camadas.reduce((t, c) => t + c.kg * (c.custo_kg ?? custoKg), 0) / kgH, 4)
      : null;
    custoSobraAproximado = kgH > 0 ? herdada.aproximado : null;
  } else if (temCusto) {
    custoTotal = total * custoKg;
  }

  return {
    consumo_g_cab_dia: gReal !== null ? arred(gReal, 1) : null,
    consumo_real_pv_percentual: pv ? arred((kgDia / pv) * 100, 4) : null,
    consumo_esperado_pv_percentual: base === 'PV' && pv && esperado !== null && esperado > 0 ? arred((esperado / pv) * 100, 4) : null,
    base_consumo_aplicada: base,
    consumo_esperado_g_cab_dia: gEsperado === null ? null : arred(gEsperado, 1),
    consumo_relacao_esperado: relacao === null ? null : arred(relacao, 4),
    farol_consumo: farol,
    farol_consumo_motivo: motivo,
    faixa_tolerancia_aplicada: faixa,
    sobra_informada: sobraInformada === null || sobraInformada === undefined ? null : Boolean(sobraInformada),
    custo_unitario_kg: temCusto ? custoKg : null,
    custo_total_periodo: custoTotal === null ? null : arred(custoTotal, 2),
    custo_cab_dia: custoTotal === null || cab <= 0 ? null : arred(custoTotal / (cab * dias), 4),
    // D-PROD-212
    peso_medio_periodo_kg: pesoMedio ? num(pesoMedio.peso_medio_periodo_kg) : null,
    peso_medio_periodo_aproximado: pesoMedio ? Boolean(pesoMedio.aproximado) : null,
    peso_medio_periodo_motivo: pesoMedio ? pesoMedio.motivo ?? null : null,
    consumo_esperado_fechamento_kg_dia: pesoMedio && esperado !== null ? arred(esperado, 4) : null,
    sobra_herdada_kg: sobraHerdadaKg,
    custo_sobra_herdada_kg: custoSobraHerdadaKg,
    custo_sobra_aproximado: custoSobraAproximado,
    sobra_final_camadas: sobraFinalCamadas,
  };
};

/**
 * Resumo do fechamento de um evento JÁ fechado, para a tela: usa o que o
 * fechamento gravou (D-PROD-206); evento fechado antes dela é calculado na
 * hora com o que há (sem gravar): `consumo_diario_grupo_kg` × `dias_periodo`,
 * o esperado do lançamento, o custo se houver, sem saber se a sobra foi medida.
 * Período aberto → null.
 * @param {any} evento
 * @param {{ faixaPercentual?: unknown, custoUnitarioKg?: unknown }} [extra] faixa e custo achados fora do evento
 */
export const resumoDoFechamento = (evento, extra = {}) => {
  const dias = num(evento?.dias_periodo);
  if (!evento || dias === null || dias <= 0) return null;
  if (typeof evento.farol_consumo === 'string' && evento.farol_consumo in FAROL_CONSUMO) {
    return {
      consumo_g_cab_dia: num(evento.consumo_g_cab_dia),
      consumo_real_pv_percentual: num(evento.consumo_real_pv_percentual),
      consumo_esperado_pv_percentual: num(evento.consumo_esperado_pv_percentual),
      consumo_relacao_esperado: num(evento.consumo_relacao_esperado),
      farol_consumo: /** @type {FarolConsumo} */ (evento.farol_consumo),
      farol_consumo_motivo: evento.farol_consumo_motivo ?? null,
      faixa_tolerancia_aplicada: faixaDeTolerancia(evento.faixa_tolerancia_aplicada),
      base_consumo_aplicada: evento.base_consumo_aplicada === 'G_CAB_DIA' || evento.base_consumo === 'G_CAB_DIA' ? 'G_CAB_DIA' : 'PV',
      consumo_esperado_g_cab_dia: num(evento.consumo_esperado_g_cab_dia),
      sobra_informada: typeof evento.sobra_informada === 'boolean' ? evento.sobra_informada : null,
      custo_unitario_kg: num(evento.custo_unitario_kg),
      custo_total_periodo: num(evento.custo_total_periodo),
      custo_cab_dia: num(evento.custo_cab_dia),
      // D-PROD-212
      peso_medio_periodo_kg: num(evento.peso_medio_periodo_kg),
      peso_medio_periodo_aproximado: typeof evento.peso_medio_periodo_aproximado === 'boolean' ? evento.peso_medio_periodo_aproximado : null,
      peso_medio_periodo_motivo: typeof evento.peso_medio_periodo_motivo === 'string' ? evento.peso_medio_periodo_motivo : null,
      consumo_esperado_fechamento_kg_dia: num(evento.consumo_esperado_fechamento_kg_dia),
      sobra_herdada_kg: num(evento.sobra_herdada_kg),
      custo_sobra_herdada_kg: num(evento.custo_sobra_herdada_kg),
      custo_sobra_aproximado: typeof evento.custo_sobra_aproximado === 'boolean' ? evento.custo_sobra_aproximado : null,
      sobra_final_camadas: Array.isArray(evento.sobra_final_camadas) ? evento.sobra_final_camadas : null,
    };
  }
  const kgDia = num(evento.consumo_diario_grupo_kg);
  if (kgDia === null) return null;
  return calcularFechamentoConsumo({
    evento,
    consumoTotalKg: kgDia * dias,
    diasPeriodo: dias,
    sobraInformada: null,
    faixaPercentual: evento.faixa_tolerancia_percentual ?? extra.faixaPercentual ?? null,
    custoUnitarioKg: evento.custo_unitario_kg ?? extra.custoUnitarioKg ?? null,
    compartilhado: false,
  });
};

/** Patch que LIMPA o fechamento do consumo (reabertura do período). */
export const PATCH_REABERTURA_CONSUMO = Object.freeze(
  Object.fromEntries(CAMPOS_FECHAMENTO_CONSUMO.map((campo) => [campo, null])),
);
