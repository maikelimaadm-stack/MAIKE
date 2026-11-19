/**
 * D-PROD-257 (Estoque → Entradas) — regras PURAS da entrada manual documentada: motivos fechados,
 * normalização do corpo, custo zero e fingerprint. Sem banco. A origem do motor da entrada
 * NUNCA aparece aqui: quem a conhece é o motor (P7 da D-PROD-177), por `aplicarEntradaDocumentada`.
 */
import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { diaDoCorpo } from '../patrimonio/patrimonioComum.js';

export const ENTIDADE = 'EntradaEstoque';
export const TIPO_CRIAR = 'estoque_entrada_criar';
export const TIPO_EXCLUIR = 'estoque_entrada_excluir';

export const STATUS_CONFIRMADA = 'CONFIRMADA';
export const STATUS_EXCLUIDA = 'EXCLUIDA';

export const MOTIVO_IMPLANTACAO = 'SALDO_IMPLANTACAO';
export const MOTIVO_DOACAO = 'DOACAO';
export const MOTIVO_OUTRA = 'OUTRA_COM_JUSTIFICATIVA';
/** D-PROD-177: três motivos FECHADOS (não há COMPRA, AJUSTE_INVENTARIO nem DEVOLUCAO). */
export const MOTIVOS = Object.freeze([MOTIVO_IMPLANTACAO, MOTIVO_DOACAO, MOTIVO_OUTRA]);

/** Sufixo do `tipo_detalhado` do movimento e texto do movimento, por motivo. */
export const ROTULOS_DO_MOTIVO = Object.freeze({
  [MOTIVO_IMPLANTACAO]: { slug: 'saldo_implantacao', texto: 'Entrada de saldo de implantação do estoque' },
  [MOTIVO_DOACAO]: { slug: 'doacao', texto: 'Entrada por doação recebida' },
  [MOTIVO_OUTRA]: { slug: 'outra_com_justificativa', texto: 'Entrada manual com justificativa' },
});

export const JUSTIFICATIVA_MINIMA_OUTRA = 20;
export const JUSTIFICATIVA_MINIMA_CUSTO_ZERO = 10;
export const MOTIVO_ACAO_MINIMO = 3;
export const MAX_ITENS = 50;

export const PADRAO_DECIMAL = /^\d{1,10}(\.\d{1,4})?$/;
export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const UNIDADES = Object.freeze(['KG', 'SACO', 'L']);
const DECIMAIS_DO_CORPO = Object.freeze(['quantidade', 'custo_unitario']);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const tamanho = (t) => [...t].length;

/** Decimal só como TEXTO (nunca número do JSON, já corrompido pelo float). Roda no `preValidation`. @param {unknown} corpo */
export const recusarCoercaoEntrada = (corpo) => {
  if (!ehObjeto(corpo)) return;
  const c = /** @type {Record<string, any>} */ (corpo);
  const itens = Array.isArray(c.itens) ? c.itens : [];
  for (const item of itens) {
    if (!ehObjeto(item)) continue;
    for (const chave of DECIMAIS_DO_CORPO) {
      const v = item[chave];
      if (v !== undefined && v !== null && typeof v !== 'string') {
        throw new AppError('REQUEST_VALIDATION_FAILED', `${chave} deve ser texto decimal (ex.: "80.5"), nunca número`, {
          details: { field: chave, reason: 'valor_deve_ser_texto', campo: chave },
        });
      }
    }
  }
};

/** Chave de identidade do documento: aparada e em maiúsculas (a normalização da P3). @param {string|null|undefined} t */
export const chaveDoDocumento = (t) => (typeof t === 'string' && t.trim() ? t.trim().toUpperCase() : null);

/**
 * Custo zero (regra da D-PROD-257): só com a declaração explícita `custo_zero = true` e, na implantação e
 * em "outra", com a justificativa (a doação é, ela mesma, o motivo). Custo > 0 com `custo_zero` é incoerente.
 * @param {{ motivo: string, justificativa: string|null, custo_unitario: string, custo_zero: boolean }} p
 */
export const conferirCustoZero = (p) => {
  const zero = dec(p.custo_unitario).eq(0);
  if (!zero) {
    if (p.custo_zero) throw new AppError('ENTRADA_ESTOQUE_CUSTO_ZERO', 'custo_zero só vale com custo zero; nada foi gravado', { details: { field: 'custo_unitario', reason: 'custo_zero_com_custo' } });
    return;
  }
  if (!p.custo_zero) {
    throw new AppError('ENTRADA_ESTOQUE_CUSTO_ZERO', 'custo zero exige a declaração explícita e o motivo; informe o custo ou marque "custo zero"; nada foi gravado', {
      details: { field: 'custo_unitario', reason: 'custo_zero_nao_declarado' },
    });
  }
  if (p.motivo !== MOTIVO_DOACAO && tamanho(p.justificativa ?? '') < JUSTIFICATIVA_MINIMA_CUSTO_ZERO) {
    throw new AppError('ENTRADA_ESTOQUE_CUSTO_ZERO', `custo zero exige a justificativa (ao menos ${JUSTIFICATIVA_MINIMA_CUSTO_ZERO} caracteres); nada foi gravado`, {
      details: { field: 'justificativa', reason: 'custo_zero_sem_justificativa' },
    });
  }
};

const decimalDoCorpo = (valor, campo, indice) => {
  if (typeof valor !== 'string' || !PADRAO_DECIMAL.test(valor)) {
    throw invalido(`${campo} tem formato inválido`, { field: campo, reason: 'formato', indice });
  }
  return dec(valor).toFixed(CASAS_QUANTIDADE);
};

/** Corpo da criação → entrada normalizada (texto higienizado, decimais canônicos). @param {unknown} corpo */
export const normalizarCriacao = (corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  if (typeof c.operation_id !== 'string' || !PADRAO_OPERATION_ID.test(c.operation_id)) {
    throw invalido('operation_id inválido', { field: 'operation_id', reason: 'formato' });
  }
  if (!MOTIVOS.includes(c.motivo)) throw invalido('motivo inválido (SALDO_IMPLANTACAO, DOACAO ou OUTRA_COM_JUSTIFICATIVA)', { field: 'motivo', reason: 'motivo_fechado' });
  const dataEntrada = diaDoCorpo(c.data_entrada, 'data_entrada');
  if (!dataEntrada) throw invalido('data_entrada é obrigatória', { field: 'data_entrada' });
  const documento = textoDoCorpo(c.documento_numero, 'documento_numero') ?? null;
  const observacao = textoDoCorpo(c.observacao, 'observacao') ?? null;
  const justificativa = textoDoCorpo(c.justificativa, 'justificativa') ?? null;
  if (documento && tamanho(documento) > 64) throw invalido('documento_numero passa de 64 caracteres', { field: 'documento_numero', reason: 'tamanho' });
  if (c.motivo === MOTIVO_OUTRA && tamanho(justificativa ?? '') < JUSTIFICATIVA_MINIMA_OUTRA) {
    throw new AppError('ENTRADA_ESTOQUE_INVALIDA', `a justificativa é obrigatória em "outra" (ao menos ${JUSTIFICATIVA_MINIMA_OUTRA} caracteres); nada foi gravado`, {
      details: { field: 'justificativa', reason: 'justificativa_obrigatoria' },
    });
  }
  const bruto = Array.isArray(c.itens) ? c.itens : [];
  if (!bruto.length || bruto.length > MAX_ITENS) throw invalido(`informe de 1 a ${MAX_ITENS} itens`, { field: 'itens', reason: 'quantidade_de_itens' });
  const itens = bruto.map((i, indice) => {
    const it = /** @type {Record<string, any>} */ (i ?? {});
    if (!UNIDADES.includes(it.unidade)) throw invalido('unidade inválida (KG, SACO ou L)', { field: 'unidade', reason: 'unidade', indice });
    const quantidade = decimalDoCorpo(it.quantidade, 'quantidade', indice);
    if (!dec(quantidade).gt(0)) throw new AppError('ENTRADA_ESTOQUE_INVALIDA', 'a quantidade deve ser maior que zero; nada foi gravado', { details: { field: 'quantidade', reason: 'quantidade_zero', indice } });
    const custo = decimalDoCorpo(it.custo_unitario, 'custo_unitario', indice);
    const custo_zero = it.custo_zero === true;
    conferirCustoZero({ motivo: c.motivo, justificativa, custo_unitario: custo, custo_zero });
    return { produto_id: it.produto_id, local_estoque_id: it.local_estoque_id, unidade: it.unidade, quantidade, custo_unitario: custo, custo_zero };
  });
  const pares = new Set();
  itens.forEach((it, indice) => {
    const chave = `${it.produto_id}\u0000${it.local_estoque_id}`;
    if (pares.has(chave)) throw new AppError('ENTRADA_ESTOQUE_INVALIDA', 'o mesmo produto no mesmo depósito aparece duas vezes; some as quantidades; nada foi gravado', { details: { field: 'itens', reason: 'par_duplicado', indice } });
    pares.add(chave);
  });
  return { empresa_id: c.empresa_id, operation_id: c.operation_id, motivo: c.motivo, data_entrada: dataEntrada, documento_numero: documento, observacao, justificativa, itens };
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

/** Corpo da edição (só observação e justificativa). @param {string} id @param {unknown} corpo */
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
    motivo: c.motivo,
    campos_fisicos: ['data_entrada', 'documento_numero', 'itens'].filter((k) => c[k] !== undefined),
    observacao: textoDoCorpo(c.observacao, 'observacao'),
    justificativa: textoDoCorpo(c.justificativa, 'justificativa'),
  };
};

/** Fingerprint canônico (ordem FIXA de chaves; v1). @param {ReturnType<typeof normalizarCriacao>} e */
export const fingerprintDaCriacao = (e) => ({
  v: 1,
  empresa_id: e.empresa_id,
  motivo: e.motivo,
  data_entrada: e.data_entrada,
  documento_numero: e.documento_numero,
  observacao: e.observacao,
  justificativa: e.justificativa,
  itens: e.itens.map((i) => [i.produto_id, i.local_estoque_id, i.unidade, i.quantidade, i.custo_unitario, i.custo_zero]),
});
/** @param {ReturnType<typeof normalizarExclusao>} e */
export const fingerprintDaExclusao = (e) => ({ v: 1, id: e.id, empresa_id: e.empresa_id, versao: e.versao, motivo: e.motivo });

/**
 * Quantidade e custo na unidade de ESTOQUE do Produto (kg, ou L). SACO usa o peso do saco do Produto;
 * o custo da camada é o custo por unidade informada ÷ fator, em `CASAS_CUSTO`.
 * @param {{ unidade: string, quantidade: string, custo_unitario: string }} item
 * @param {{ unidade_principal_estoque: string, peso_por_saco_kg: any }} produto
 */
export const efeitoDoItem = (item, produto) => {
  const principal = produto.unidade_principal_estoque === 'L' ? 'L' : 'KG';
  if ((principal === 'L') !== (item.unidade === 'L') || (principal === 'L' && item.unidade !== 'L')) {
    throw new AppError('ENTRADA_ESTOQUE_INVALIDA', 'a unidade da entrada não é compatível com o estoque do produto; nada foi gravado', { details: { field: 'unidade', reason: 'unidade_incompativel', unidade_produto: principal } });
  }
  let fator = dec(1);
  if (item.unidade === 'SACO') {
    fator = dec(produto.peso_por_saco_kg ?? 0);
    if (!fator.gt(0)) throw new AppError('ENTRADA_ESTOQUE_INVALIDA', 'o produto não tem peso por saco cadastrado; nada foi gravado', { details: { field: 'unidade', reason: 'peso_por_saco_ausente' } });
  }
  const quantidadeEstoque = arredondar(dec(item.quantidade).times(fator), CASAS_QUANTIDADE);
  const custoKg = arredondar(dec(item.custo_unitario).dividedBy(fator), CASAS_CUSTO);
  const valorTotal = arredondar(dec(item.quantidade).times(dec(item.custo_unitario)), CASAS_CUSTO);
  return { fator, quantidadeEstoque, custoKg, valorTotal };
};
