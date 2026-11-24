/**
 * D-PROD-272 (Estoque → Novo movimento → Ajuste) — regras PURAS do ajuste de inventário: normalização do corpo,
 * unidade e fingerprint. Sem banco.
 *
 *  - Por linha: produto, depósito, unidade (KG, SACO ou L, compatível com o estoque do produto) e a quantidade
 *    CONTADA (pode ser zero). O servidor compara com o saldo do depósito na hora de gravar e lança a diferença.
 *  - `custo_unitario` (por kg ou L, opcional): só é usado na SOBRA de um depósito SEM saldo (sem custo médio).
 *  - Um par produto × depósito por ajuste. O ajuste é sempre do dia de hoje da fazenda (sem data no corpo).
 */
import { resolverUnidade } from '../produtos/produtoUnidadesConversao.js';
import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, dec } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { normalizarLoteDaEntrada, normalizarLotesEscolhidos } from '../estoqueFisico/estoqueFisicoMotor.js';

export const ENTIDADE = 'AjusteEstoque';
export const TIPO_CRIAR = 'estoque_ajuste_criar';
export const TIPO_EXCLUIR = 'estoque_ajuste_excluir';

export const STATUS_CONFIRMADA = 'CONFIRMADA';
export const STATUS_EXCLUIDA = 'EXCLUIDA';
export const SOBRA = 'SOBRA';
export const FALTA = 'FALTA';
export const SEM_DIFERENCA = 'SEM_DIFERENCA';

export const MOTIVO_ACAO_MINIMO = 3;
export const MAX_ITENS = 100;

export const PADRAO_DECIMAL = /^\d{1,10}(\.\d{1,4})?$/;
export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const DECIMAIS = Object.freeze(['quantidade_contada', 'custo_unitario']);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const tamanho = (t) => [...t].length;
const idOpcional = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Decimal só como TEXTO (nunca número do JSON). Roda no `preValidation`. @param {unknown} corpo */
export const recusarCoercaoAjuste = (corpo) => {
  if (!ehObjeto(corpo)) return;
  const itens = Array.isArray(/** @type {any} */ (corpo).itens) ? /** @type {any} */ (corpo).itens : [];
  for (const item of itens) {
    if (!ehObjeto(item)) continue;
    for (const chave of DECIMAIS) {
      const v = item[chave];
      if (v !== undefined && v !== null && typeof v !== 'string') {
        throw new AppError('REQUEST_VALIDATION_FAILED', `${chave} deve ser texto decimal (ex.: "80.5"), nunca número`, {
          details: { field: chave, reason: 'valor_deve_ser_texto', campo: chave },
        });
      }
    }
  }
};

const decimalDoCorpo = (valor, campo, indice) => {
  if (typeof valor !== 'string' || !PADRAO_DECIMAL.test(valor)) throw invalido(`${campo} tem formato inválido`, { field: campo, reason: 'formato', indice });
  return dec(valor).toFixed(CASAS_QUANTIDADE);
};

/** Corpo da criação → ajuste normalizado. @param {unknown} corpo */
export const normalizarCriacao = (corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  if (typeof c.operation_id !== 'string' || !PADRAO_OPERATION_ID.test(c.operation_id)) throw invalido('operation_id inválido', { field: 'operation_id', reason: 'formato' });
  const observacao = textoDoCorpo(c.observacao, 'observacao') ?? null;
  const bruto = Array.isArray(c.itens) ? c.itens : [];
  if (!bruto.length || bruto.length > MAX_ITENS) throw invalido(`informe de 1 a ${MAX_ITENS} itens`, { field: 'itens', reason: 'quantidade_de_itens' });
  const itens = bruto.map((i, indice) => {
    const it = /** @type {Record<string, any>} */ (i ?? {});
    // D-PROD-285: KG, L, SACO ou a sigla de uma unidade de conversão do produto (conferida contra o cadastro depois).
    if (typeof it.unidade !== 'string' || !it.unidade.trim() || it.unidade.trim().length > 8 || it.unidade.trim() === 'UN') throw invalido('unidade inválida (a de estoque ou uma unidade de conversão do produto)', { field: 'unidade', reason: 'unidade', indice });
    it.unidade = it.unidade.trim().toUpperCase();
    const quantidade = decimalDoCorpo(it.quantidade_contada, 'quantidade_contada', indice);
    const custo = it.custo_unitario === undefined || it.custo_unitario === null ? null : dec(decimalDoCorpo(it.custo_unitario, 'custo_unitario', indice)).toFixed(CASAS_CUSTO);
    // D-PROD-282: lote e validade (sobra) e lotes escolhidos (falta), só quando vêm (o objeto de antes não muda).
    const lote = normalizarLoteDaEntrada(it.lote_fabricante, it.data_validade, { indice });
    const lotes = normalizarLotesEscolhidos(it.lotes, { indice });
    return {
      produto_id: it.produto_id, local_estoque_id: it.local_estoque_id, unidade: it.unidade, quantidade_contada: quantidade, custo_unitario: custo,
      ...(lote.fabricante ? { lote_fabricante: lote.fabricante } : {}), ...(lote.validade ? { data_validade: lote.validade } : {}), ...(lotes ? { lotes } : {}),
    };
  });
  const pares = new Set();
  itens.forEach((it, indice) => {
    const chave = `${it.produto_id}\u0000${it.local_estoque_id}`;
    if (pares.has(chave)) throw new AppError('AJUSTE_ESTOQUE_INVALIDO', 'o mesmo produto no mesmo depósito aparece duas vezes; some as quantidades; nada foi gravado', { details: { field: 'itens', reason: 'par_duplicado', indice } });
    pares.add(chave);
  });
  return {
    empresa_id: c.empresa_id, operation_id: c.operation_id, observacao,
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
    id, empresa_id: c.empresa_id, versao: c.versao, motivo_edicao: motivoEdicao,
    campos_fisicos: ['centro_custo_id', 'centro_resultado_id', 'itens'].filter((k) => c[k] !== undefined),
    observacao: textoDoCorpo(c.observacao, 'observacao'),
  };
};

/** Fingerprint canônico (ordem FIXA de chaves). @param {ReturnType<typeof normalizarCriacao>} a */
export const fingerprintDaCriacao = (a) => ({
  v: 1,
  empresa_id: a.empresa_id,
  centro_custo_id: a.centro_custo_id,
  centro_resultado_id: a.centro_resultado_id,
  observacao: a.observacao,
  // D-PROD-282: lote, validade e lotes escolhidos entram no fingerprint só quando vêm.
  itens: a.itens.map((i) => {
    const base = [i.produto_id, i.local_estoque_id, i.unidade, i.quantidade_contada, i.custo_unitario];
    const lote = /** @type {any} */ (i);
    return lote.lote_fabricante || lote.data_validade || lote.lotes
      ? [...base, lote.lote_fabricante ?? null, lote.data_validade ?? null, (lote.lotes ?? []).map((l) => [l.estoque_lote_nota_id, l.quantidade])]
      : base;
  }),
});
/** @param {ReturnType<typeof normalizarExclusao>} a */
export const fingerprintDaExclusao = (a) => ({ v: 1, id: a.id, empresa_id: a.empresa_id, versao: a.versao, motivo: a.motivo });

/**
 * Quantidade contada na unidade de ESTOQUE do Produto (kg, ou L). SACO usa o peso do saco do Produto.
 * @param {{ unidade: string, quantidade_contada: string }} item
 * @param {{ unidade_principal_estoque: string, peso_por_saco_kg: any }} produto
 * @param {number} indice
 */
export const contadoEmEstoque = (item, produto, indice) => {
  // D-PROD-285: a unidade de estoque ou qualquer conversão ativa do produto (a contagem não é compra nem saída).
  const r = resolverUnidade(produto, item.unidade, {
    erro: (reason, mensagem, extra = {}) => new AppError('AJUSTE_ESTOQUE_INVALIDO', mensagem.replace('do lançamento', 'da contagem'), { details: { field: 'unidade', reason, ...extra, indice } }),
  });
  return { fator: r.fator, contado: r.quantidadeEstoque(item.quantidade_contada) };
};
