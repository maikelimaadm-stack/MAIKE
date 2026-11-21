/**
 * Campos que o PATCH de SuplementacaoEvento aceita — D-PROD-212.
 *
 * R2A (D-PROD-99): o evento compõe saída de estoque e rateio por lote; o PATCH
 * só aceita o que o FECHAMENTO/REABERTURA do período grava, nada que mexa em
 * saldo. Até a D-PROD-212 a lista tinha só as 3 métricas de período (sobra,
 * dias, consumo diário do grupo); o fechamento do consumo (D-PROD-206/210:
 * farol, %PV, custo; D-PROD-212: peso médio do período e custo da sobra
 * herdada) mandava mais campos e o servidor recusava o PATCH INTEIRO
 * (REGISTRO_OPERACIONAL_IMUTAVEL) — o período não fechava e a tela avisava
 * "Falha ao fechar o período anterior". Agora a lista fecha também os campos do
 * fechamento do consumo, cada um com o seu tipo. Continua recusado qualquer
 * outro campo (quantidade, produto, lotes, estoque…).
 *
 * Módulo PURO (sem banco), para o teste do front conferir que todo campo que o
 * fechamento grava está aqui.
 */
import { AppError } from '../../shared/errors/AppError.js';

/** Métricas do período (R2A), número ou null. */
export const CAMPOS_METRICA_PERIODO = Object.freeze(['sobra_kg', 'dias_periodo', 'consumo_diario_grupo_kg']);

/** Fechamento do consumo, número ou null. */
export const CAMPOS_FECHAMENTO_NUMERICOS = Object.freeze([
  'consumo_g_cab_dia',
  'consumo_real_pv_percentual',
  'consumo_esperado_pv_percentual',
  'consumo_esperado_g_cab_dia',
  'consumo_relacao_esperado',
  'faixa_tolerancia_aplicada',
  'custo_unitario_kg',
  'custo_total_periodo',
  'custo_cab_dia',
  'peso_medio_periodo_kg',
  'consumo_esperado_fechamento_kg_dia',
  'sobra_herdada_kg',
  'custo_sobra_herdada_kg',
]);

/** Fechamento do consumo, valor fechado ou null. */
export const CAMPOS_FECHAMENTO_ENUM = Object.freeze({
  farol_consumo: Object.freeze(['abaixo', 'dentro', 'acima', 'sem_referencia']),
  farol_consumo_motivo: Object.freeze(['sem_esperado', 'cocho_compartilhado']),
  base_consumo_aplicada: Object.freeze(['PV', 'G_CAB_DIA']),
  peso_medio_periodo_motivo: Object.freeze(['sem_data', 'sem_lotes', 'sem_curva', 'sem_peso']),
});

/** Fechamento do consumo, booleano ou null. */
export const CAMPOS_FECHAMENTO_BOOLEANOS = Object.freeze(['sobra_informada', 'peso_medio_periodo_aproximado', 'custo_sobra_aproximado']);

/** Camadas de custo da sobra final: null ou lista de { kg ≥ 0, custo_kg ≥ 0 }. */
export const CAMPO_CAMADAS_SOBRA = 'sobra_final_camadas';
export const MAX_CAMADAS_SOBRA = 50;

/**
 * D-PROD-268 — QUEM fechou o período: o lançamento seguinte do cocho (`'lancamento'`, com
 * `fechado_por_evento_id` = o evento novo) ou a movimentação do gado (`'movimentacao_gado'`, sem
 * evento). É a prova estrutural que o cancelamento do lançamento usa para reabrir o período
 * anterior; o PATCH endurecido confere os dois na transição aberto → fechado.
 */
export const CAMPO_FECHADO_POR_TIPO = 'fechado_por_tipo';
export const CAMPO_FECHADO_POR_EVENTO = 'fechado_por_evento_id';
export const CAMPOS_FECHAMENTO_ORIGEM = Object.freeze([CAMPO_FECHADO_POR_TIPO, CAMPO_FECHADO_POR_EVENTO]);
export const TIPOS_FECHADO_POR = Object.freeze(['lancamento', 'movimentacao_gado']);

export const CAMPOS_PATCH_PERMITIDOS = Object.freeze([
  ...CAMPOS_METRICA_PERIODO,
  ...CAMPOS_FECHAMENTO_NUMERICOS,
  ...Object.keys(CAMPOS_FECHAMENTO_ENUM),
  ...CAMPOS_FECHAMENTO_BOOLEANOS,
  CAMPO_CAMADAS_SOBRA,
  ...CAMPOS_FECHAMENTO_ORIGEM,
]);

const NUMERICOS = new Set([...CAMPOS_METRICA_PERIODO, ...CAMPOS_FECHAMENTO_NUMERICOS]);
const BOOLEANOS = new Set(CAMPOS_FECHAMENTO_BOOLEANOS);

/** @param {string} entidade @param {string} campo @param {string} reason @param {string} mensagem */
const invalido = (entidade, campo, reason, mensagem) =>
  new AppError('REQUEST_VALIDATION_FAILED', mensagem, { details: { entidade, field: campo, reason } });

/** @param {unknown} v */
const numeroFinito = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Tipo de cada campo do PATCH (os nomes já passaram pela lista fechada).
 * @param {Record<string, unknown>} entrada
 * @param {string} entidade
 */
export const exigirTiposDoFechamento = (entrada, entidade) => {
  for (const [campo, valor] of Object.entries(entrada || {})) {
    if (campo === 'empresa_id' || valor === null) continue;
    if (NUMERICOS.has(campo)) {
      if (!numeroFinito(valor)) throw invalido(entidade, campo, 'type', 'métrica deve ser número ou null');
      continue;
    }
    if (BOOLEANOS.has(campo)) {
      if (typeof valor !== 'boolean') throw invalido(entidade, campo, 'type', 'campo deve ser verdadeiro, falso ou null');
      continue;
    }
    const enumerado = /** @type {Record<string, readonly string[]>} */ (CAMPOS_FECHAMENTO_ENUM)[campo];
    if (enumerado) {
      if (typeof valor !== 'string' || !enumerado.includes(valor)) throw invalido(entidade, campo, 'enum', 'valor fora da lista');
      continue;
    }
    if (campo === CAMPO_FECHADO_POR_TIPO) {
      if (typeof valor !== 'string' || !TIPOS_FECHADO_POR.includes(valor)) throw invalido(entidade, campo, 'enum', 'valor fora da lista');
      continue;
    }
    if (campo === CAMPO_FECHADO_POR_EVENTO) {
      if (typeof valor !== 'string' || !valor.trim() || valor.length > 64) throw invalido(entidade, campo, 'type', 'id do evento que fechou o período');
      continue;
    }
    if (campo === CAMPO_CAMADAS_SOBRA) {
      if (!Array.isArray(valor) || valor.length > MAX_CAMADAS_SOBRA) throw invalido(entidade, campo, 'type', 'camadas devem ser uma lista');
      for (const c of valor) {
        const ok = c && typeof c === 'object' && !Array.isArray(c)
          && Object.keys(c).every((k) => k === 'kg' || k === 'custo_kg')
          && numeroFinito(c.kg) && c.kg >= 0 && numeroFinito(c.custo_kg) && c.custo_kg >= 0;
        if (!ok) throw invalido(entidade, campo, 'type', 'cada camada é { kg, custo_kg } com números ≥ 0');
      }
    }
  }
};
