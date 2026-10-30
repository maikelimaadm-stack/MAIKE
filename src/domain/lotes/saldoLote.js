/**
 * Entrada no rebanho — regra pura (D-PROD-85).
 *
 * O Cadastro de Lotes é o lançamento da ENTRADA, como o recebimento de um
 * estoque: mostra o que foi lançado e nada que aconteça depois. Saldo,
 * movimentações, saídas, mudanças de categoria e pesagens são do Mapa Geral.
 *
 * - **Quantidade de entrada:** `quantidade_entrada`, o retrato imutável do dia
 *   em que as cabeças ENTRARAM no rebanho (compra, ajuste, inventário,
 *   nascimento). Lançar 500 e depois movimentar: o Cadastro continua 500.
 * - **Lote gerado por manejo** (parte de uma movimentação, reversão, mudança de
 *   categoria ou recomposição) não é entrada: as cabeças já existiam no lote de
 *   origem. Não aparece no Cadastro e não soma como entrada (500, não 550).
 *
 * Nada aqui conhece React, rede ou storage.
 */

/** @param {unknown} valor */
const semAcento = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

/**
 * Origens de lote gerado por manejo a partir de cabeças que já estavam no
 * rebanho (comparadas sem acento e sem caixa). "EDIÇÃO MOVIMENTAÇÃO" é a
 * recomposição criada ao editar/desfazer uma movimentação
 * (`movimentacaoReconciliation`). Nascimento NÃO entra: são cabeças novas,
 * uma entrada de verdade. Mesma lista do servidor
 * (`backend/src/modules/lotes/loteOrigem.js`).
 */
const ORIGENS_DERIVADAS_DE_MANEJO = Object.freeze(
  new Set(['MOVIMENTACAO', 'REVERSAO MOVIMENTACAO', 'MUDANCA DE CATEGORIA', 'EDICAO MOVIMENTACAO'])
);

/**
 * Quantidade de cabeças como inteiro. Aceita número ou string numérica
 * (legado importado); vazio, nulo ou não-numérico vira 0.
 * @param {unknown} valor
 * @returns {number}
 */
export const quantidadeDeCabecas = (valor) => {
  if (valor === null || valor === undefined) return 0;
  const texto = typeof valor === 'string' ? valor.trim() : valor;
  if (texto === '') return 0;
  const n = Number(texto);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * O lote nasceu de um manejo sobre cabeças que já existiam?
 * @param {{ origem?: unknown } | null | undefined} lote
 */
export const ehLoteDerivadoDeManejo = (lote) => ORIGENS_DERIVADAS_DE_MANEJO.has(semAcento(lote?.origem));

/**
 * Cabeças que entraram no rebanho por este lote (0 para lote derivado).
 * @param {object | null | undefined} lote
 */
export const entradaHistoricaDoLote = (lote) =>
  ehLoteDerivadoDeManejo(lote) ? 0 : quantidadeDeCabecas(/** @type {any} */ (lote)?.quantidade_entrada);

/**
 * O lote é uma entrada no rebanho (pertence ao Cadastro de Lotes)?
 * @param {object | null | undefined} lote
 */
export const ehEntradaNoRebanho = (lote) => !ehLoteDerivadoDeManejo(lote);

/**
 * O lote já tem algo depois da entrada? (D-PROD-86). Devolve o motivo estável
 * ou `null`. Com histórico, o Cadastro não edita nem exclui o lançamento —
 * mesma regra do servidor (`loteService`):
 * - gerado por manejo (as cabeças vieram de outro lote);
 * - registro vinculado (movimentação, suplementação, tarefa, manejo técnico);
 * - estado divergente da entrada (recebeu/perdeu cabeças, mudou de área ou de
 *   categoria) — pega o destino de uma unificação, que não tem registro próprio.
 *
 * @param {Record<string, any> | null | undefined} lote
 * @param {{ has: (id: string) => boolean }} [idsComRegistro]
 * @returns {null | 'lote_gerado_por_manejo' | 'registros_vinculados' | 'lote_com_manejo'}
 */
export const motivoDeHistoricoDoLote = (lote, idsComRegistro) => {
  if (!lote) return null;
  if (ehLoteDerivadoDeManejo(lote)) return 'lote_gerado_por_manejo';
  if (lote.id && idsComRegistro?.has(String(lote.id))) return 'registros_vinculados';
  const divergiu =
    quantidadeDeCabecas(lote.quantidade_cabecas) !== quantidadeDeCabecas(lote.quantidade_entrada) ||
    (lote.area_atual_id ?? null) !== (lote.area_entrada_id ?? null) ||
    (Boolean(lote.categoria_manejo_entrada_id) && lote.categoria_manejo_id !== lote.categoria_manejo_entrada_id);
  return divergiu ? 'lote_com_manejo' : null;
};
