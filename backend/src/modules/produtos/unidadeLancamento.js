/**
 * D-PROD-309 — a quantidade digitada numa UNIDADE DE CONVERSÃO do cadastro do produto (D-PROD-288) no cocho, na
 * transferência entre locais e na linha de produto da atividade (emenda aprovada pelo proprietário em 2026-11-25).
 *
 * O corpo pode trazer `unidade_lancamento` (o id ou a sigla de uma conversão do produto) e `quantidade_lancamento` (a
 * quantidade nessa unidade). O servidor lê o fator do CADASTRO do produto, converte para a unidade de estoque (KG ou L)
 * pelo MESMO motor da compra do financeiro (`resolverUnidade`: uma conta, 4 casas, ROUND_HALF_UP) e grava a unidade, a
 * quantidade digitada e o fator efetivo (o multiplicador em 4 casas, como o `fator_kg` das outras linhas). A quantidade
 * do movimento continua na unidade de estoque. Editar mantém o fator GRAVADO (como a retificação do financeiro,
 * `comPesoGravado`): o passado não muda porque o cadastro mudou depois.
 *
 * Sem unidade (ou com a própria unidade de estoque), nada muda: a quantidade é a de sempre e nada é gravado a mais.
 * O abastecimento continua sem conversão (Constituição, D-PROD-162; `07-DO-NOT-DO.md`).
 *
 * Recusas (422 `UNIDADE_LANCAMENTO_INVALIDA`, `details.field`/`details.reason`): `unidade_inativa`,
 * `unidade_nao_cadastrada`, `unidade_de_outro_produto`, `unidade_sem_uso`, `unidade_incompativel`,
 * `peso_por_saco_ausente` e `quantidade_divergente` (o corpo mandou também `quantidade`, na unidade de estoque, e ela
 * não bate com a conta do servidor — o fator mudou entre a tela e o envio). Formato: 400 `REQUEST_VALIDATION_FAILED`.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_QUANTIDADE, Dec, LIMITE_ESTOQUE, dec, paraBanco } from '../financeiro/decimalFinanceiro.js';
import { resolverUnidade, unidadeEstoqueEfetiva } from './produtoUnidadesConversao.js';

/** Texto decimal da quantidade digitada: até 10 dígitos inteiros e 4 casas. */
const PADRAO = /^\d{1,10}(\.\d{1,4})?$/;

const invalido = (mensagem, details) => new AppError('REQUEST_VALIDATION_FAILED', `${mensagem}; nada foi gravado`, { details });

/**
 * @typedef {{ unidade_lancamento: string, quantidade_lancamento: string }} UnidadeDoCorpo
 * @typedef {{ unidade: string, fator: any }} FatorGravado  a sigla e o fator efetivo gravados (edição)
 * @typedef {{ unidade: string|null, quantidadeLancamento: string|null, fator: string|null, quantidadeEstoque: InstanceType<typeof Dec> }} Conversao
 */

/**
 * Lê `unidade_lancamento` e `quantidade_lancamento` do corpo. As duas juntas, ou nenhuma (`null`); `unidade_lancamento:
 * null` = a unidade de estoque (sem conversão). A quantidade vem em texto decimal (até 4 casas) ou número (arredondado
 * a 4 casas, meio para cima, uma vez — a mesma fronteira do `kgDeEntrada`), sempre > 0.
 * @param {Record<string, any>} corpo @param {string} [prefixo]  ex.: `produtos[0].` (nas mensagens)
 * @returns {UnidadeDoCorpo|null}
 */
export const unidadeDoCorpo = (corpo, prefixo = '') => {
  const u = corpo?.unidade_lancamento;
  const q = corpo?.quantidade_lancamento;
  const semU = u === undefined || u === null;
  const semQ = q === undefined || q === null;
  if (semU && semQ) return null;
  if (semU || semQ) {
    throw invalido(`${prefixo}unidade_lancamento e ${prefixo}quantidade_lancamento vão juntas`, { field: `${prefixo}${semU ? 'unidade_lancamento' : 'quantidade_lancamento'}`, reason: 'unidade_lancamento_incompleta' });
  }
  if (typeof u !== 'string' || !u.trim() || u.trim().length > 64) {
    throw invalido(`${prefixo}unidade_lancamento deve ser o id ou a sigla de uma unidade do produto`, { field: `${prefixo}unidade_lancamento`, reason: 'formato' });
  }
  /** @type {InstanceType<typeof Dec>|null} */
  let valor = null;
  if (typeof q === 'string' && PADRAO.test(q.trim())) valor = new Dec(q.trim());
  else if (typeof q === 'number' && Number.isFinite(q)) valor = new Dec(String(q)).toDecimalPlaces(CASAS_QUANTIDADE, Dec.ROUND_HALF_UP);
  if (!valor) {
    throw invalido(`${prefixo}quantidade_lancamento tem formato inválido: texto decimal com até 4 casas (ex.: "10.5")`, { field: `${prefixo}quantidade_lancamento`, reason: 'formato' });
  }
  if (!valor.gt(0)) throw invalido(`${prefixo}quantidade_lancamento deve ser maior que zero`, { field: `${prefixo}quantidade_lancamento`, reason: 'quantidade_nao_positiva' });
  return { unidade_lancamento: u.trim(), quantidade_lancamento: valor.toFixed(CASAS_QUANTIDADE) };
};

/** A parte do fingerprint: só quando a unidade vem (o reenvio de antes continua casando). @param {UnidadeDoCorpo|null} u */
export const unidadeNoFingerprint = (u) => (u ? { unidade_lancamento: u.unidade_lancamento, quantidade_lancamento: u.quantidade_lancamento } : {});

/**
 * As conversões vigentes (não excluídas) do produto, para o `resolverUnidade` (o produto lido pelo comando não as traz).
 * @param {any} tx @param {string} clienteId @param {any} produto
 */
export const comConversoes = async (tx, clienteId, produto) => {
  if (Array.isArray(produto?.unidadesConversao)) return produto;
  const unidadesConversao = await tx.produtoUnidadeConversao.findMany({
    where: { cliente_id: clienteId, produto_id: produto.id, excluido_em: null },
    select: { id: true, sigla: true, operacao: true, fator: true, uso_compra: true, uso_venda: true, ativa: true, excluido_em: true },
  });
  return { ...produto, unidadesConversao };
};

/**
 * 422 `UNIDADE_LANCAMENTO_INVALIDA` (nada foi gravado).
 * @param {string} reason @param {string} mensagem @param {Record<string, unknown>} [extra]
 */
export const unidadeInvalida = (reason, mensagem, extra = {}) =>
  new AppError('UNIDADE_LANCAMENTO_INVALIDA', mensagem.endsWith('nada foi gravado') ? mensagem : `${mensagem}; nada foi gravado`, {
    details: { field: 'unidade_lancamento', reason, ...extra },
  });

/**
 * Converte a quantidade digitada para a unidade de estoque do produto.
 *  - sem `unidade` (ou com a própria unidade de estoque): a quantidade é a de estoque, nada a gravar;
 *  - o id ou a sigla de uma conversão do PRODUTO: o fator do cadastro (ou o GRAVADO, na edição na mesma sigla);
 *  - id de conversão de outro produto → `unidade_de_outro_produto`; desativada → `unidade_inativa`; desconhecida →
 *    `unidade_nao_cadastrada`; KG ↔ L → `unidade_incompativel`; sem o uso pedido → `unidade_sem_uso`.
 * @param {any} tx @param {{ clienteId: string, produto: any, unidade: UnidadeDoCorpo|null, uso?: 'compra'|'venda'|null,
 *   gravado?: FatorGravado|null, contextoErro?: Record<string, unknown> }} a
 * @returns {Promise<Conversao|null>}  null sem unidade de conversão
 */
export const converterUnidadeDoLancamento = async (tx, { clienteId, produto: bruto, unidade, uso = null, gravado = null, contextoErro = {} }) => {
  if (!unidade) return null;
  const produto = await comConversoes(tx, clienteId, bruto);
  const estoque = unidadeEstoqueEfetiva(produto);
  const crua = unidade.unidade_lancamento;
  const porId = produto.unidadesConversao.find((/** @type {any} */ c) => c.id === crua);
  let sigla = porId ? porId.sigla : crua.toUpperCase();
  if (sigla === estoque) return null; // a própria unidade de estoque: nada a converter nem a gravar
  // O id de uma conversão de OUTRO produto (do tenant) não vale aqui (sem oráculo de outro tenant: só o deste).
  if (!porId && !produto.unidadesConversao.some((/** @type {any} */ c) => c.sigla === sigla)) {
    const deOutro = await tx.produtoUnidadeConversao.findFirst({ where: { cliente_id: clienteId, id: crua }, select: { produto_id: true } });
    if (deOutro && deOutro.produto_id !== produto.id) {
      throw unidadeInvalida('unidade_de_outro_produto', 'a unidade escolhida é de outro produto', { ...contextoErro, unidade: crua });
    }
  }
  // Edição: a sigla já gravada mantém o fator GRAVADO (a mesma regra da retificação do financeiro, `comPesoGravado`).
  const comGravado = gravado && gravado.unidade === sigla
    ? { ...produto, unidadesConversao: [...produto.unidadesConversao.filter((/** @type {any} */ c) => c.sigla !== sigla), { sigla, operacao: 'MULTIPLICA', fator: gravado.fator, ativa: true, uso_compra: true, uso_venda: true }] }
    : produto;
  const r = resolverUnidade(comGravado, sigla, {
    uso,
    erro: (reason, mensagem, extra = {}) => unidadeInvalida(reason, mensagem.replace('do lançamento', 'digitada').replace(/; nada foi gravado$/, ''), { ...contextoErro, ...extra, unidade: sigla }),
  });
  sigla = r.conversao?.sigla ?? sigla;
  const quantidadeEstoque = r.quantidadeEstoque(unidade.quantidade_lancamento);
  if (!quantidadeEstoque.gt(0)) {
    throw unidadeInvalida('quantidade_estoque_zero', `a quantidade em ${estoque} (arredondada a 4 casas) é zero`, { ...contextoErro, field: 'quantidade_lancamento' });
  }
  if (quantidadeEstoque.gt(LIMITE_ESTOQUE)) {
    throw unidadeInvalida('valor_excede_limite_estoque', `a quantidade em ${estoque} passa do limite do estoque`, { ...contextoErro, field: 'quantidade_lancamento' });
  }
  return {
    unidade: sigla,
    quantidadeLancamento: unidade.quantidade_lancamento,
    fator: paraBanco(r.fator, CASAS_QUANTIDADE),
    quantidadeEstoque,
  };
};

/**
 * O corpo mandou também a quantidade na unidade de estoque (a conta que a tela mostrou): ela tem de bater com a do
 * servidor; senão 422 `quantidade_divergente` (o cadastro mudou entre a tela e o envio).
 * @param {unknown} quantidadeDoCorpo @param {Conversao|null} conversao @param {Record<string, unknown>} [contextoErro]
 */
export const conferirQuantidadeDoCorpo = (quantidadeDoCorpo, conversao, contextoErro = {}) => {
  if (!conversao || quantidadeDoCorpo === undefined || quantidadeDoCorpo === null) return;
  let q;
  try {
    q = new Dec(String(quantidadeDoCorpo).trim()).toDecimalPlaces(CASAS_QUANTIDADE, Dec.ROUND_HALF_UP);
  } catch {
    q = null;
  }
  if (!q || !q.eq(conversao.quantidadeEstoque)) {
    throw unidadeInvalida(
      'quantidade_divergente',
      `${conversao.quantidadeLancamento.replace(/\.?0+$/, '')} ${conversao.unidade} dão ${conversao.quantidadeEstoque.toFixed(CASAS_QUANTIDADE)} na unidade de estoque pelo cadastro do produto, e não a quantidade enviada (o fator mudou?)`,
      { ...contextoErro, field: 'quantidade', quantidade_estoque: conversao.quantidadeEstoque.toFixed(CASAS_QUANTIDADE), fator: conversao.fator }
    );
  }
};

/** As colunas gravadas (movimento e linha): a unidade, a quantidade digitada e o fator efetivo. @param {Conversao|null} c */
export const colunasDaUnidade = (c) =>
  c?.unidade ? { unidade_lancamento: c.unidade, quantidade_lancamento: c.quantidadeLancamento, fator_lancamento: c.fator } : {};

/** Forma pública (texto canônico): as três ou nulas. @param {any} r */
export const unidadePublica = (r) => ({
  unidade_lancamento: r?.unidade_lancamento ?? null,
  quantidade_lancamento: r?.quantidade_lancamento == null ? null : dec(r.quantidade_lancamento).toFixed(CASAS_QUANTIDADE),
  fator_lancamento: r?.fator_lancamento == null ? null : dec(r.fator_lancamento).toFixed(CASAS_QUANTIDADE),
});
