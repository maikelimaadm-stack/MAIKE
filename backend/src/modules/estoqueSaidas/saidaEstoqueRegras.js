/**
 * D-PROD-264 (Estoque → Novo movimento → Saída) — regras PURAS da saída manual: normalização do corpo,
 * unidade e fingerprint. Sem banco.
 *
 *  - O motivo vem do cadastro de motivos de SAÍDA (`motivo_id`); o nome vai para o texto do movimento.
 *  - Não se digita valor: a saída é valorizada pelo custo médio do produto no depósito (motor).
 *  - Por linha: produto, depósito, unidade (KG, SACO ou L, compatível com o estoque do produto) e quantidade.
 *    Um par produto × depósito por saída.
 */
import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_QUANTIDADE, arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { diaDoCorpo } from '../patrimonio/patrimonioComum.js';

export const ENTIDADE = 'SaidaEstoque';
export const TIPO_CRIAR = 'estoque_saida_criar';
export const TIPO_EXCLUIR = 'estoque_saida_excluir';

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
const UNIDADES = Object.freeze(['KG', 'SACO', 'L']);

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
    if (!UNIDADES.includes(it.unidade)) throw invalido('unidade inválida (KG, SACO ou L)', { field: 'unidade', reason: 'unidade', indice });
    const quantidade = decimalDoCorpo(it.quantidade, 'quantidade', indice);
    if (!dec(quantidade).gt(0)) throw new AppError('SAIDA_ESTOQUE_INVALIDA', 'a quantidade deve ser maior que zero; nada foi gravado', { details: { field: 'quantidade', reason: 'quantidade_zero', indice } });
    return { produto_id: it.produto_id, local_estoque_id: it.local_estoque_id, unidade: it.unidade, quantidade };
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

/** Corpo da edição (só a observação). @param {string} id @param {unknown} corpo */
export const normalizarEdicao = (id, corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  const motivoEdicao = textoDoCorpo(c.motivo_edicao, 'motivo_edicao');
  if (!motivoEdicao) throw invalido('informe o motivo da edição', { field: 'motivo_edicao', reason: 'obrigatorio' });
  if (tamanho(motivoEdicao) < MOTIVO_ACAO_MINIMO) throw invalido(`o motivo da edição deve ter ao menos ${MOTIVO_ACAO_MINIMO} caracteres`, { field: 'motivo_edicao', reason: 'motivo_curto' });
  return {
    id,
    empresa_id: c.empresa_id,
    versao: c.versao,
    motivo_edicao: motivoEdicao,
    campos_fisicos: ['motivo_id', 'data_saida', 'centro_custo_id', 'centro_resultado_id', 'itens'].filter((k) => c[k] !== undefined),
    observacao: textoDoCorpo(c.observacao, 'observacao'),
  };
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
  itens: s.itens.map((i) => [i.produto_id, i.local_estoque_id, i.unidade, i.quantidade]),
});
/** @param {ReturnType<typeof normalizarExclusao>} s */
export const fingerprintDaExclusao = (s) => ({ v: 1, id: s.id, empresa_id: s.empresa_id, versao: s.versao, motivo: s.motivo });

/**
 * Quantidade na unidade de ESTOQUE do Produto (kg, ou L). SACO usa o peso do saco do Produto.
 * @param {{ unidade: string, quantidade: string }} item
 * @param {{ unidade_principal_estoque: string, peso_por_saco_kg: any }} produto
 * @param {number} indice
 */
export const quantidadeDeEstoque = (item, produto, indice) => {
  const principal = produto.unidade_principal_estoque === 'L' ? 'L' : 'KG';
  if ((principal === 'L') !== (item.unidade === 'L')) {
    throw new AppError('SAIDA_ESTOQUE_INVALIDA', 'a unidade da saída não é compatível com o estoque do produto; nada foi gravado', {
      details: { field: 'unidade', reason: 'unidade_incompativel', unidade_produto: principal, indice },
    });
  }
  let fator = dec(1);
  if (item.unidade === 'SACO') {
    fator = dec(produto.peso_por_saco_kg ?? 0);
    if (!fator.gt(0)) throw new AppError('SAIDA_ESTOQUE_INVALIDA', 'o produto não tem peso por saco cadastrado; nada foi gravado', { details: { field: 'unidade', reason: 'peso_por_saco_ausente', indice } });
  }
  return { fator, quantidadeEstoque: arredondar(dec(item.quantidade).times(fator), CASAS_QUANTIDADE) };
};
