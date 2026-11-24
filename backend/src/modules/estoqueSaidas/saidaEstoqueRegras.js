/**
 * D-PROD-264 (Estoque → Novo movimento → Saída) — regras PURAS da saída manual: normalização do corpo,
 * unidade e fingerprint. Sem banco.
 *
 *  - O motivo vem do cadastro de motivos de SAÍDA (`motivo_id`); o nome vai para o texto do movimento.
 *  - Não se digita valor: a saída é valorizada pelo custo médio do produto no depósito (motor).
 *  - Por linha: produto, depósito, unidade (KG, SACO ou L, compatível com o estoque do produto) e quantidade.
 *    Um par produto × depósito por saída.
 */
import { resolverUnidade } from '../produtos/produtoUnidadesConversao.js';
import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_QUANTIDADE, dec } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { diaDoCorpo } from '../patrimonio/patrimonioComum.js';
import { normalizarLotesEscolhidos } from '../estoqueFisico/estoqueFisicoMotor.js';

export const ENTIDADE = 'SaidaEstoque';
export const TIPO_CRIAR = 'estoque_saida_criar';
export const TIPO_EXCLUIR = 'estoque_saida_excluir';
/** D-PROD-271: a edição com substituição (estorno + saída nova) é idempotente por `operation_id`. */
export const TIPO_EDITAR = 'estoque_saida_editar';

/** D-PROD-271: os 2 modos da edição (a saída guarda o modo no snapshot do evento; não há coluna). */
export const MODO_METADADOS = 'METADADOS';
export const MODO_SUBSTITUICAO = 'SUBSTITUICAO';
/** D-PROD-271: qualquer um destes no corpo do PATCH faz da edição uma SUBSTITUIÇÃO (o corpo é a versão nova completa). */
export const CAMPOS_FISICOS = Object.freeze(['motivo_id', 'data_saida', 'centro_custo_id', 'centro_resultado_id', 'itens']);

export const STATUS_CONFIRMADA = 'CONFIRMADA';
export const STATUS_EXCLUIDA = 'EXCLUIDA';

/** `tipo_detalhado` do movimento de saída e do estorno dela (o texto do movimento leva o nome do motivo). */
export const TIPO_DETALHADO_SAIDA = 'saida_manual';
export const TIPO_DETALHADO_ESTORNO = 'estorno_saida_manual';
export const TEXTO_SAIDA = 'Saída manual';

export const MOTIVO_ACAO_MINIMO = 3;
export const MAX_ITENS = 50;

export const PADRAO_DECIMAL = /^\d{1,10}(\.\d{1,4})?$/;
export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const tamanho = (t) => [...t].length;
const idOpcional = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Decimal só como TEXTO (nunca número do JSON, já corrompido pelo float). Roda no `preValidation`. @param {unknown} corpo */
export const recusarCoercaoSaida = (corpo) => {
  if (!ehObjeto(corpo)) return;
  const itens = Array.isArray(/** @type {any} */ (corpo).itens) ? /** @type {any} */ (corpo).itens : [];
  for (const item of itens) {
    if (!ehObjeto(item)) continue;
    const v = item.quantidade;
    if (v !== undefined && v !== null && typeof v !== 'string') {
      throw new AppError('REQUEST_VALIDATION_FAILED', 'quantidade deve ser texto decimal (ex.: "80.5"), nunca número', {
        details: { field: 'quantidade', reason: 'valor_deve_ser_texto', campo: 'quantidade' },
      });
    }
  }
};

const decimalDoCorpo = (valor, campo, indice) => {
  if (typeof valor !== 'string' || !PADRAO_DECIMAL.test(valor)) throw invalido(`${campo} tem formato inválido`, { field: campo, reason: 'formato', indice });
  return dec(valor).toFixed(CASAS_QUANTIDADE);
};

/** Corpo da criação → saída normalizada (texto higienizado, decimais canônicos). @param {unknown} corpo */
export const normalizarCriacao = (corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  if (typeof c.operation_id !== 'string' || !PADRAO_OPERATION_ID.test(c.operation_id)) throw invalido('operation_id inválido', { field: 'operation_id', reason: 'formato' });
  const motivoId = idOpcional(c.motivo_id);
  if (!motivoId) throw invalido('escolha o motivo da saída', { field: 'motivo_id', reason: 'obrigatorio' });
  const dataSaida = diaDoCorpo(c.data_saida, 'data_saida');
  if (!dataSaida) throw invalido('data_saida é obrigatória', { field: 'data_saida' });
  const observacao = textoDoCorpo(c.observacao, 'observacao') ?? null;
  const bruto = Array.isArray(c.itens) ? c.itens : [];
  if (!bruto.length || bruto.length > MAX_ITENS) throw invalido(`informe de 1 a ${MAX_ITENS} itens`, { field: 'itens', reason: 'quantidade_de_itens' });
  const itens = bruto.map((i, indice) => {
    const it = /** @type {Record<string, any>} */ (i ?? {});
    // D-PROD-288: KG, L, SACO ou a sigla de uma unidade de conversão do produto (conferida contra o cadastro depois).
    if (typeof it.unidade !== 'string' || !it.unidade.trim() || it.unidade.trim().length > 8 || it.unidade.trim() === 'UN') throw invalido('unidade inválida (a de estoque ou uma unidade de conversão do produto)', { field: 'unidade', reason: 'unidade', indice });
    it.unidade = it.unidade.trim().toUpperCase();
    const quantidade = decimalDoCorpo(it.quantidade, 'quantidade', indice);
    if (!dec(quantidade).gt(0)) throw new AppError('SAIDA_ESTOQUE_INVALIDA', 'a quantidade deve ser maior que zero; nada foi gravado', { details: { field: 'quantidade', reason: 'quantidade_zero', indice } });
    // D-PROD-282: lotes escolhidos (produto com lote); ausente → FEFO no servidor. Só entra no objeto quando vem.
    const lotes = normalizarLotesEscolhidos(it.lotes, { indice });
    return { produto_id: it.produto_id, local_estoque_id: it.local_estoque_id, unidade: it.unidade, quantidade, ...(lotes ? { lotes } : {}) };
  });
  const pares = new Set();
  itens.forEach((it, indice) => {
    const chave = `${it.produto_id}\u0000${it.local_estoque_id}`;
    if (pares.has(chave)) throw new AppError('SAIDA_ESTOQUE_INVALIDA', 'o mesmo produto no mesmo depósito aparece duas vezes; some as quantidades; nada foi gravado', { details: { field: 'itens', reason: 'par_duplicado', indice } });
    pares.add(chave);
  });
  return {
    empresa_id: c.empresa_id, operation_id: c.operation_id, motivo_id: motivoId, data_saida: dataSaida, observacao,
    centro_custo_id: idOpcional(c.centro_custo_id), centro_resultado_id: idOpcional(c.centro_resultado_id), itens,
  };
};

/** Corpo da exclusão. @param {string} id @param {unknown} corpo */
export const normalizarExclusao = (id, corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  if (typeof c.operation_id !== 'string' || !PADRAO_OPERATION_ID.test(c.operation_id)) throw invalido('operation_id inválido', { field: 'operation_id', reason: 'formato' });
  const motivo = textoDoCorpo(c.motivo, 'motivo');
  if (!motivo) throw invalido('informe o motivo da exclusão', { field: 'motivo', reason: 'obrigatorio' });
  if (tamanho(motivo) < MOTIVO_ACAO_MINIMO) throw invalido(`o motivo da exclusão deve ter ao menos ${MOTIVO_ACAO_MINIMO} caracteres`, { field: 'motivo', reason: 'motivo_curto' });
  return { id, empresa_id: c.empresa_id, versao: c.versao, operation_id: c.operation_id, motivo };
};

/**
 * Corpo da edição (D-PROD-271). Só `observacao` (+ `versao`, `motivo_edicao`) → METADADOS, como antes
 * (`operation_id`, se vier, não é usado). Qualquer campo físico (`CAMPOS_FISICOS`) → SUBSTITUICAO: o corpo é
 * a versão nova COMPLETA, normalizada e validada como a criação (`normalizarCriacao`).
 * @param {string} id @param {unknown} corpo
 */
export const normalizarEdicao = (id, corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  const motivoEdicao = textoDoCorpo(c.motivo_edicao, 'motivo_edicao');
  if (!motivoEdicao) throw invalido('informe o motivo da edição', { field: 'motivo_edicao', reason: 'obrigatorio' });
  if (tamanho(motivoEdicao) < MOTIVO_ACAO_MINIMO) throw invalido(`o motivo da edição deve ter ao menos ${MOTIVO_ACAO_MINIMO} caracteres`, { field: 'motivo_edicao', reason: 'motivo_curto' });
  if (CAMPOS_FISICOS.some((k) => c[k] !== undefined)) {
    return { modo: MODO_SUBSTITUICAO, id, empresa_id: c.empresa_id, versao: c.versao, motivo_edicao: motivoEdicao, saida: normalizarCriacao(c) };
  }
  return { modo: MODO_METADADOS, id, empresa_id: c.empresa_id, versao: c.versao, motivo_edicao: motivoEdicao, observacao: textoDoCorpo(c.observacao, 'observacao') };
};

/** Fingerprint canônico (ordem FIXA de chaves). @param {ReturnType<typeof normalizarCriacao>} s */
export const fingerprintDaCriacao = (s) => ({
  v: 1,
  empresa_id: s.empresa_id,
  motivo_id: s.motivo_id,
  data_saida: s.data_saida,
  centro_custo_id: s.centro_custo_id,
  centro_resultado_id: s.centro_resultado_id,
  observacao: s.observacao,
  // D-PROD-282: a escolha de lotes entra no fingerprint só quando vem (o reenvio de antes continua casando).
  itens: s.itens.map((i) => (i.lotes ? [i.produto_id, i.local_estoque_id, i.unidade, i.quantidade, i.lotes.map((l) => [l.estoque_lote_nota_id, l.quantidade])] : [i.produto_id, i.local_estoque_id, i.unidade, i.quantidade])),
});
/**
 * D-PROD-271 — fingerprint canônico da edição com substituição (ordem FIXA de chaves).
 * @param {{ id: string, empresa_id: any, versao: any, motivo_edicao: string, saida: ReturnType<typeof normalizarCriacao> }} e
 */
export const fingerprintDaSubstituicao = (e) => ({
  v: 1,
  id: e.id,
  empresa_id: e.empresa_id,
  versao: e.versao,
  motivo_edicao: e.motivo_edicao,
  versao_nova: fingerprintDaCriacao(e.saida),
});

/**
 * D-PROD-271 — a versão nova é FISICAMENTE igual à vigente? (cabeçalho físico e linhas, na ordem). Quando é,
 * a edição não mexe no estoque: só a observação pode ter mudado (vira METADADOS) ou nada mudou.
 * @param {{ motivo_id: string, data_saida: string, centro_custo_id: string|null, centro_resultado_id: string|null }} atual
 * @param {Array<{ produto_id: string, local_estoque_id: string, unidade: string, quantidade: any }>} linhas linhas vigentes, por ordem
 * @param {ReturnType<typeof normalizarCriacao>} nova
 */
export const mesmaVersaoFisica = (atual, linhas, nova) => {
  const cab = ['motivo_id', 'data_saida', 'centro_custo_id', 'centro_resultado_id'];
  if (cab.some((k) => (atual[k] ?? null) !== (nova[k] ?? null))) return false;
  if (linhas.length !== nova.itens.length) return false;
  return nova.itens.every((n, i) => {
    const a = linhas[i];
    // D-PROD-282: uma escolha de lotes na edição é mudança física (relança a saída nos lotes pedidos).
    return !n.lotes && a.produto_id === n.produto_id && a.local_estoque_id === n.local_estoque_id && a.unidade === n.unidade && dec(a.quantidade).eq(dec(n.quantidade));
  });
};
/** @param {ReturnType<typeof normalizarExclusao>} s */
export const fingerprintDaExclusao = (s) => ({ v: 1, id: s.id, empresa_id: s.empresa_id, versao: s.versao, motivo: s.motivo });

/**
 * Quantidade na unidade de ESTOQUE do Produto (kg, ou L). SACO usa o peso do saco do Produto.
 * @param {{ unidade: string, quantidade: string }} item
 * @param {{ unidade_principal_estoque: string, peso_por_saco_kg: any }} produto
 * @param {number} indice
 */
export const quantidadeDeEstoque = (item, produto, indice) => {
  // D-PROD-288: a unidade de estoque ou uma conversão ativa do produto com uso em saída; o motor converte (4 casas).
  const r = resolverUnidade(produto, item.unidade, {
    uso: 'venda',
    erro: (reason, mensagem, extra = {}) => new AppError('SAIDA_ESTOQUE_INVALIDA', mensagem.replace('do lançamento', 'da saída'), { details: { field: 'unidade', reason, ...extra, indice } }),
  });
  return { fator: r.fator, quantidadeEstoque: r.quantidadeEstoque(item.quantidade) };
};
