/**
 * Regras puras do manejo de lote (P1.2, D-PROD-18).
 *
 * `DetalhesLote.jsx` tem 1.300 linhas e mistura decisão com efeito: dentro do
 * mesmo laço ele decide *se* o lote de destino existe, *quanto* mover, *qual*
 * status sobra na origem — e já chama a API para cada uma dessas conclusões.
 * As decisões saíram para cá; os efeitos continuaram lá.
 *
 * Nada neste arquivo conhece provider, React, storage ou rede. Toda função
 * recebe dado já carregado e devolve dado — é o que torna DL1–DL5 e DL11–DL13
 * testáveis sem montar a árvore de componentes.
 */

const texto = (valor) => String(valor || '').toUpperCase();
const numero = (valor) => {
  const n = Number(valor || 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Lote de destino que pode absorver a movimentação (unificação automática).
 *
 * Compatível = mesma área de destino, mesmo nome, mesma categoria e ativo.
 * Nome e categoria comparam em maiúsculas porque os dois lados vêm de campo
 * livre digitado pelo usuário.
 *
 * @param {any[]} lotesDestino lotes ativos já carregados do destino
 * @param {{loteOrigem: object, categoriaMovimento: string, areaDestinoId: string}} criterio
 * @returns {object|null} o lote compatível, ou `null` quando não existe (DL1)
 */
export const encontrarLoteDestinoCompativel = (lotesDestino, { loteOrigem, categoriaMovimento, areaDestinoId }) =>
  (lotesDestino || []).find(
    (candidato) =>
      candidato?.area_atual_id === areaDestinoId &&
      texto(candidato?.nome) === texto(loteOrigem?.nome) &&
      texto(candidato?.categoria) === texto(categoriaMovimento) &&
      candidato?.status === 'Ativo'
  ) || null;

/**
 * A movimentação leva o lote inteiro ou parte dele?
 *
 * As duas cópias anteriores desta comparação divergiam: a movimentação usava
 * `quantidadeMover === (lote.quantidade_cabecas || 0)` e a mudança de categoria
 * usava `Number(lote.quantidade_cabecas || 0)`. Com `quantidade_cabecas` vindo
 * como string numérica — o que a Base44 devolve em campo importado — a primeira
 * comparava `10 === '10'` e concluía **parcial** para uma movimentação total:
 * criava um lote duplicado e deixava a origem com saldo zero e status `Ativo`.
 * A regra unificada normaliza os dois lados (QLT-P12-01).
 *
 * @param {number|string} quantidadeMovida
 * @param {number|string} quantidadeDoLote
 * @returns {'total'|'parcial'}
 */
export const modoDaMovimentacao = (quantidadeMovida, quantidadeDoLote) =>
  numero(quantidadeMovida) === numero(quantidadeDoLote) ? 'total' : 'parcial';

/**
 * Quanto sobra na origem e em que status ela fica.
 *
 * Mesma regra para movimentação parcial, morte e abate: o saldo nunca fica
 * negativo, e o lote só é inativado quando zera. Um lote que ainda tem cabeça
 * preserva o status que já tinha — inclusive um status não-`Ativo` definido por
 * outro fluxo.
 *
 * @param {object} lote
 * @param {number|string} quantidadeRemovida
 * @returns {{quantidade_cabecas: number, status: string}}
 */
export const saldoEStatusDaOrigem = (lote, quantidadeRemovida) => {
  const saldo = Math.max(0, numero(lote?.quantidade_cabecas) - numero(quantidadeRemovida));
  return { quantidade_cabecas: saldo, status: saldo > 0 ? lote?.status : 'Inativo' };
};

/**
 * Quanto tirar deste lote, dado o que ainda falta mover.
 *
 * @param {number|string} quantidadeRestante
 * @param {object} lote
 * @returns {number} nunca negativo
 */
export const quantidadeAplicavel = (quantidadeRestante, lote) =>
  Math.max(0, Math.min(numero(quantidadeRestante), numero(lote?.quantidade_cabecas)));

/** Categoria do filhote pelo sexo informado (DL9). */
export const categoriaDoFilhote = (sexo) =>
  sexo === 'Macho' ? 'Bezerro 0 a 12 meses' : 'Bezerra 0 a 12 meses';

/**
 * Lote de filhote que já existe na área — incrementar em vez de criar (DL9).
 *
 * @param {any[]} lotes
 * @param {{empresaId: string, categoria: string, areaId: string}} criterio
 * @returns {object|null}
 */
export const encontrarLoteFilhote = (lotes, { empresaId, categoria, areaId }) =>
  (lotes || []).find(
    (lote) =>
      lote?.empresa_id === empresaId &&
      lote?.categoria === categoria &&
      lote?.area_atual_id === areaId &&
      lote?.status === 'Ativo'
  ) || null;

/**
 * Peso que vale para este lote nesta pesagem (DL13).
 *
 * Peso individual do lote tem precedência sobre o peso da categoria. Peso
 * ausente, zero ou negativo significa "não pesar este lote" — devolve `null`,
 * e o chamador pula o registro.
 *
 * @param {{pesosPorLote?: object, loteId: string, pesoPadrao: number|string}} entrada
 * @returns {number|null}
 */
export const pesoAplicavel = ({ pesosPorLote, loteId, pesoPadrao }) => {
  const individual = (pesosPorLote || {})[loteId];
  const peso = individual ? parseFloat(individual) : parseFloat(String(pesoPadrao));
  return Number.isFinite(peso) && peso > 0 ? peso : null;
};

/** Ganho de peso desde a última pesagem; peso anterior ausente conta como 0. */
export const ganhoDePeso = (pesoNovo, pesoAnterior) => numero(pesoNovo) - numero(pesoAnterior);

/** Preview legado de numeração — criação real usa sequência no servidor (P5.1). */
export const proximoNumeroLote = (lotes) => {
  const maior = (lotes || []).reduce(
    (max, lote) => Math.max(max, parseInt(lote.numero_lote, 10) || 0),
    0
  );
  return String(maior + 1);
};

/**
 * Área de um registro de movimentação pelo ID, que é a fonte de verdade.
 *
 * O nome gravado é cópia de leitura e pode ter ficado vazio: o cliente o
 * tirava de um cache local de áreas que ainda não tinha a área recém-criada
 * (caso real: destino com id certo e `area_destino_nome: ""`).
 *
 * @param {any[]} areas áreas já carregadas
 * @param {string|null|undefined} areaId
 * @returns {object|null}
 */
export const areaPorId = (areas, areaId) =>
  (areaId && (areas || []).find((area) => area?.id === areaId)) || null;

/**
 * Nome legível da área de um movimento: o gravado; senão o da área pelo ID;
 * senão um rótulo curto com o fim do ID (nunca "-" mudo).
 *
 * @param {unknown} nomeGravado
 * @param {string|null|undefined} areaId
 * @param {any[]} areas
 * @returns {string}
 */
export const nomeDaAreaDoMovimento = (nomeGravado, areaId, areas) => {
  const gravado = String(nomeGravado ?? '').trim();
  if (gravado) return gravado;
  if (!areaId) return '';
  const nome = String(areaPorId(areas, areaId)?.nome ?? '').trim();
  return nome || `Área …${String(areaId).slice(-6)}`;
};

/**
 * Campos de saldo/posição exigem o valor lido antes no PATCH /lotes (R2A-R1,
 * D-PROD-97a): o servidor recusa com LOTE_ESTADO_CONFLITO se o lote mudou
 * desde a leitura, em vez de gravar um valor absoluto obsoleto.
 */
export const CAMPOS_COM_ESTADO_ESPERADO = Object.freeze(['quantidade_cabecas', 'status', 'area_atual_id', 'categoria']);

/**
 * @param {object} loteLido o lote como foi lido (base do cálculo)
 * @param {Record<string, unknown>} patch
 */
export const comEstadoEsperado = (loteLido, patch) => {
  const esperado = {};
  for (const campo of CAMPOS_COM_ESTADO_ESPERADO) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, campo)) {
      esperado[campo] = loteLido?.[campo] ?? null;
    }
  }
  return Object.keys(esperado).length ? { ...patch, estado_esperado: esperado } : patch;
};
