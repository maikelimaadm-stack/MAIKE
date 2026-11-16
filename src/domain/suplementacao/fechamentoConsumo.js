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
 */

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
]);

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
 */
export const calcularFechamentoConsumo = ({
  evento,
  consumoTotalKg,
  diasPeriodo,
  sobraInformada = null,
  faixaPercentual = null,
  custoUnitarioKg = null,
  compartilhado = false,
}) => {
  const dias = Math.max(1, Math.round(num(diasPeriodo) ?? 1));
  const total = Math.max(0, num(consumoTotalKg) ?? 0);
  const kgDia = total / dias;
  const cab = cabecasQueConsomem(evento);
  const pv = pesoVivoDeConsumo(evento);
  const esperado = num(evento?.consumo_esperado_pv_kg);
  const faixa = faixaDeTolerancia(faixaPercentual);
  const custoKg = num(custoUnitarioKg);

  const base = evento?.base_consumo === 'G_CAB_DIA' ? 'G_CAB_DIA' : 'PV';
  const gReal = cab > 0 ? (kgDia / cab) * 1000 : null;
  const gEsperadoGravado = num(evento?.consumo_esperado_g_cab_dia);
  const gEsperado = base !== 'G_CAB_DIA'
    ? null
    : gEsperadoGravado !== null && gEsperadoGravado > 0
      ? gEsperadoGravado
      : esperado !== null && esperado > 0 && cab > 0 ? (esperado / cab) * 1000 : null;
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

  const custoTotal = custoKg !== null && custoKg >= 0 ? total * custoKg : null;
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
    custo_unitario_kg: custoKg !== null && custoKg >= 0 ? custoKg : null,
    custo_total_periodo: custoTotal === null ? null : arred(custoTotal, 2),
    custo_cab_dia: custoTotal === null || cab <= 0 ? null : arred(custoTotal / (cab * dias), 4),
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
