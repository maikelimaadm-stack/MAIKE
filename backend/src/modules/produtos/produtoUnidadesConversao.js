/**
 * D-PROD-285 — unidades de conversão do produto (o "motor" da conversão de unidade).
 *
 * O produto tem UMA unidade de estoque efetiva: L (litros) ou KG (KG e o SACO legado, que guarda kg). Saldo, custo
 * médio, lote e recálculo ficam sempre nela (D-PROD-256/273/282 não mudam). Uma conversão diz quanto vale 1 unidade
 * alternativa (`sigla`) na unidade de estoque:
 *  - MULTIPLICA fator → 1 sigla = fator (ex.: SACO ×25 → 1 SACO = 25 KG);
 *  - DIVIDE fator     → 1 sigla = 1/fator (ex.: G ÷1000 → 1 G = 0,001 KG).
 *
 * Conta: quantidade de estoque = quantidade × fator (MULTIPLICA) ou quantidade ÷ fator (DIVIDE), arredondada UMA vez
 * em 4 casas (ROUND_HALF_UP). O "fator efetivo" gravado na linha (`fator_kg`, nome legado) é o multiplicador em 4
 * casas (DIVIDE → 1/fator); a quantidade de estoque vem da conta exata acima, nunca de quantidade × fator_kg.
 *
 * Funções puras: quem chama carrega o produto com `unidadesConversao` (só as não excluídas).
 */

import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_QUANTIDADE, Dec, dec, arredondar } from '../financeiro/decimalFinanceiro.js';

export const OPERACOES = Object.freeze(['MULTIPLICA', 'DIVIDE']);
/** Siglas que nunca são conversão: as unidades físicas de estoque e a do serviço (o mesmo CHECK do banco). */
export const SIGLAS_RESERVADAS = Object.freeze(['KG', 'L', 'UN']);
export const FATOR_DIVIDE_MAXIMO = 10000;
export const SIGLA_MAX = 8;
export const CASAS_FATOR = 6;

/** Unidade de estoque EFETIVA: L para L; KG para KG, SACO (legado) e o resto. */
/** @param {any} produto @returns {'KG'|'L'} */
export const unidadeEstoqueEfetiva = (produto) => (produto?.unidade_principal_estoque === 'L' ? 'L' : 'KG');

/** `select` do Prisma para carregar as conversões vigentes (não excluídas) junto do produto. */
export const SELECT_CONVERSOES = Object.freeze({
  where: { excluido_em: null },
  orderBy: [{ ordem: /** @type {const} */ ('asc') }, { sigla: /** @type {const} */ ('asc') }],
  select: { id: true, sigla: true, operacao: true, fator: true, uso_compra: true, uso_venda: true, codigo_barras: true, ativa: true, ordem: true },
});

const texto4 = (d) => dec(d).toFixed(CASAS_QUANTIDADE);

/** Forma pública de uma conversão (decimais em texto canônico). */
export const comoConversaoPublica = (c) => ({
  id: c.id,
  sigla: c.sigla,
  operacao: c.operacao,
  fator: dec(c.fator).toFixed(CASAS_FATOR),
  uso_compra: c.uso_compra !== false,
  uso_venda: c.uso_venda !== false,
  codigo_barras: c.codigo_barras ?? null,
  ativa: c.ativa !== false,
  ordem: c.ordem ?? 0,
});

/** "1 SACO = 25 KG", "1 G = 0,001 KG" (até 6 casas, sem zeros à direita). */
export const equivalencia = (c, unidadeEstoque) => {
  const um = c.operacao === 'DIVIDE' ? new Dec(1).dividedBy(dec(c.fator)) : dec(c.fator);
  const t = um.toDecimalPlaces(CASAS_FATOR, Dec.ROUND_HALF_UP).toFixed().replace('.', ',');
  return `1 ${c.sigla} = ${t} ${unidadeEstoque}`;
};

/** Multiplicador efetivo (4 casas) gravado em `fator_kg`. */
export const fatorEfetivo = (c) =>
  arredondar(c.operacao === 'DIVIDE' ? new Dec(1).dividedBy(dec(c.fator)) : dec(c.fator), CASAS_QUANTIDADE);

/** Quantidade na unidade de estoque, 4 casas, pela operação exata. */
export const converterQuantidade = (quantidade, c) =>
  arredondar(c.operacao === 'DIVIDE' ? dec(quantidade).dividedBy(dec(c.fator)) : dec(quantidade).times(dec(c.fator)), CASAS_QUANTIDADE);

/** Custo por unidade informada → custo por unidade de estoque (`casas` da camada). */
export const converterCusto = (custoInformado, c, casas) =>
  arredondar(c.operacao === 'DIVIDE' ? dec(custoInformado).times(dec(c.fator)) : dec(custoInformado).dividedBy(dec(c.fator)), casas);

const UM = Object.freeze({ sigla: null, operacao: 'MULTIPLICA', fator: '1' });

/**
 * Resolve a unidade digitada num lançamento.
 * @param {any} produto  com `unidade_principal_estoque`, `peso_por_saco_kg` e `unidadesConversao` (opcional)
 * @param {string} unidade  a sigla escolhida (a de estoque ou a de uma conversão ativa)
 * @param {{ uso?: 'compra'|'venda'|null, erro: (reason: string, mensagem: string, extra?: object) => Error }} opcoes
 * @returns {{ conversao: any, unidadeEstoque: 'KG'|'L', fator: InstanceType<typeof Dec>, quantidadeEstoque: (q: any) => InstanceType<typeof Dec>, custoEstoque: (c: any, casas: number) => InstanceType<typeof Dec> }}
 */
export const resolverUnidade = (produto, unidade, { uso = null, erro }) => {
  const unidadeEstoque = unidadeEstoqueEfetiva(produto);
  const u = String(unidade ?? '').trim();
  const pronta = (c) => ({
    conversao: c === UM ? null : c,
    unidadeEstoque,
    fator: fatorEfetivo(c),
    quantidadeEstoque: (q) => converterQuantidade(q, c),
    custoEstoque: (custo, casas) => converterCusto(custo, c, casas),
  });
  if (u === unidadeEstoque) return pronta(UM);
  if (u === 'KG' || u === 'L') {
    throw erro('unidade_incompativel', 'a unidade do lançamento não é compatível com o estoque do produto (nada de conversão entre kg e litros); nada foi gravado', { unidade_produto: unidadeEstoque });
  }
  const conversoes = Array.isArray(produto?.unidadesConversao) ? produto.unidadesConversao : [];
  const c = conversoes.find((x) => x.sigla === u && x.excluido_em == null);
  if (c) {
    if (c.ativa === false) throw erro('unidade_inativa', `a unidade ${u} está desativada no cadastro do produto; nada foi gravado`, { unidade: u });
    if (uso === 'compra' && c.uso_compra === false) throw erro('unidade_sem_uso', `a unidade ${u} não é usada em compra/entrada neste produto; nada foi gravado`, { unidade: u, uso });
    if (uso === 'venda' && c.uso_venda === false) throw erro('unidade_sem_uso', `a unidade ${u} não é usada em venda/saída neste produto; nada foi gravado`, { unidade: u, uso });
    return pronta(c);
  }
  // Legado: SACO pelo `peso_por_saco_kg` (produto que ainda não tem a conversão SACO; a migration a cria para todos).
  if (u === 'SACO' && unidadeEstoque === 'KG') {
    const peso = dec(produto?.peso_por_saco_kg ?? 0);
    if (!peso.gt(0)) throw erro('peso_por_saco_ausente', 'o produto não tem a unidade SACO (nem peso por saco) cadastrada; nada foi gravado');
    return pronta({ sigla: 'SACO', operacao: 'MULTIPLICA', fator: peso });
  }
  throw erro('unidade_nao_cadastrada', `a unidade ${u || '(vazia)'} não está nas unidades de conversão do produto; nada foi gravado`, { unidade: u });
};

// ─── Cadastro (dentro do POST/PATCH do produto) ─────────────────────────────

const invalido = (mensagem, details) => new AppError('REQUEST_VALIDATION_FAILED', `${mensagem}; nada foi gravado`, { details: { field: 'unidades_conversao', ...details } });

/**
 * Normaliza a lista do corpo. Cada item: `{ id?, sigla, operacao, fator, uso_compra?, uso_venda?, codigo_barras?, ativa?, ordem? }`.
 * Recusa: sigla vazia/longa/reservada/igual à unidade de estoque/repetida, operação fora, fator ≤ 0 ou DIVIDE > 10000,
 * nenhum uso.
 * @param {unknown} lista @param {any} produto  o produto (unidade de estoque)
 */
export const normalizarConversoes = (lista, produto) => {
  if (!Array.isArray(lista)) throw invalido('unidades_conversao deve ser uma lista', { reason: 'formato' });
  const unidadeEstoque = unidadeEstoqueEfetiva(produto);
  const vistas = new Set();
  return lista.map((bruto, indice) => {
    const it = /** @type {any} */ (bruto ?? {});
    const extra = { indice };
    const sigla = String(it.sigla ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!sigla) throw invalido('a sigla da unidade é obrigatória', { reason: 'sigla_obrigatoria', ...extra });
    if (sigla.length > SIGLA_MAX) throw invalido(`a sigla tem no máximo ${SIGLA_MAX} caracteres`, { reason: 'sigla_longa', ...extra });
    if (sigla === unidadeEstoque || sigla === String(produto?.unidade_principal_estoque ?? '')) {
      throw invalido(`a unidade alternativa não pode ser a própria unidade de estoque (${unidadeEstoque})`, { reason: 'sigla_igual_principal', sigla, ...extra });
    }
    if (SIGLAS_RESERVADAS.includes(sigla)) throw invalido(`a sigla ${sigla} é reservada (KG, L e UN não são conversão)`, { reason: 'sigla_reservada', sigla, ...extra });
    if (vistas.has(sigla)) throw invalido(`a sigla ${sigla} aparece mais de uma vez`, { reason: 'sigla_repetida', sigla, ...extra });
    vistas.add(sigla);
    if (!OPERACOES.includes(it.operacao)) throw invalido('a operação é MULTIPLICA ou DIVIDE', { reason: 'operacao_invalida', ...extra });
    let fator;
    try {
      fator = new Dec(String(it.fator).trim());
    } catch {
      fator = null;
    }
    if (!fator || !fator.isFinite() || !fator.gt(0)) throw invalido('o fator deve ser maior que zero', { reason: 'fator_invalido', ...extra });
    fator = fator.toDecimalPlaces(CASAS_FATOR, Dec.ROUND_HALF_UP);
    if (!fator.gt(0) || fator.gt('99999999')) throw invalido('o fator está fora do limite', { reason: 'fator_invalido', ...extra });
    if (it.operacao === 'DIVIDE' && fator.gt(FATOR_DIVIDE_MAXIMO)) {
      throw invalido(`no "divide", o fator vai até ${FATOR_DIVIDE_MAXIMO} (a quantidade de estoque tem 4 casas)`, { reason: 'fator_divide_alto', ...extra });
    }
    const usoCompra = it.uso_compra !== false;
    const usoVenda = it.uso_venda !== false;
    if (!usoCompra && !usoVenda) throw invalido('a unidade precisa valer para compra ou para saída', { reason: 'sem_uso', ...extra });
    const codigo = typeof it.codigo_barras === 'string' && it.codigo_barras.trim() ? it.codigo_barras.trim().slice(0, 64) : null;
    return {
      id: typeof it.id === 'string' && it.id ? it.id : null,
      sigla,
      operacao: it.operacao,
      fator: fator.toFixed(CASAS_FATOR),
      uso_compra: usoCompra,
      uso_venda: usoVenda,
      codigo_barras: codigo,
      ativa: it.ativa !== false,
      ordem: Number.isInteger(it.ordem) && it.ordem >= 0 ? it.ordem : indice + 1,
    };
  });
};

/** A sigla aparece em algum lançamento do produto? (então não se apaga, só se desativa) */
const siglaEmUso = async (tx, clienteId, produtoId, sigla) => {
  const onde = { cliente_id: clienteId, produto_id: produtoId, unidade: sigla };
  const [a, b, c, d] = await Promise.all([
    tx.entradaEstoqueItem.count({ where: onde }),
    tx.saidaEstoqueItem.count({ where: onde }),
    tx.ajusteEstoqueItem.count({ where: onde }),
    tx.operacaoFinanceiraItem.count({ where: onde }),
  ]);
  return a + b + c + d > 0;
};

/**
 * Sincroniza as conversões do produto com a lista normalizada (substitui o conjunto vigente). Dentro da transação do
 * POST/PATCH do produto; tenant do `auth_context` (o `clienteId` vem de quem chama).
 *  - nova sigla → INSERT; existente (por id ou sigla) → UPDATE (editar o fator não muda o passado: as linhas gravaram o
 *    fator efetivo e a quantidade de estoque);
 *  - ausente da lista → exclusão lógica (`excluido_em`) se nunca foi usada; usada → só desativa (`ativa = false`).
 * @returns {Promise<{ criadas: number, alteradas: number, excluidas: number, desativadas: number }>}
 */
export const sincronizarConversoes = async (tx, clienteId, produtoId, normalizadas) => {
  const atuais = await tx.produtoUnidadeConversao.findMany({ where: { cliente_id: clienteId, produto_id: produtoId, excluido_em: null } });
  const porId = new Map(atuais.map((c) => [c.id, c]));
  const porSigla = new Map(atuais.map((c) => [c.sigla, c]));
  const mantidas = new Set();
  const r = { criadas: 0, alteradas: 0, excluidas: 0, desativadas: 0 };
  // Primeiro tira as que saem (libera a sigla no único parcial antes de reusá-la).
  const alvo = normalizadas.map((n) => ({ n, atual: (n.id && porId.get(n.id)) || porSigla.get(n.sigla) || null }));
  for (const { atual } of alvo) if (atual) mantidas.add(atual.id);
  for (const c of atuais) {
    if (mantidas.has(c.id)) continue;
    if (await siglaEmUso(tx, clienteId, produtoId, c.sigla)) {
      // Usada em lançamento: não sai; fica desativada (some do seletor; o histórico continua legível).
      if (c.ativa) {
        await tx.produtoUnidadeConversao.update({ where: { id: c.id }, data: { ativa: false } });
        r.desativadas++;
      }
      mantidas.add(c.id);
    } else {
      await tx.produtoUnidadeConversao.update({ where: { id: c.id }, data: { excluido_em: new Date(), ativa: false } });
      r.excluidas++;
    }
  }
  for (const { n, atual } of alvo) {
    const dados = { sigla: n.sigla, operacao: n.operacao, fator: n.fator, uso_compra: n.uso_compra, uso_venda: n.uso_venda, codigo_barras: n.codigo_barras, ativa: n.ativa, ordem: n.ordem };
    if (atual) {
      if (atual.sigla !== n.sigla && (await siglaEmUso(tx, clienteId, produtoId, atual.sigla))) {
        throw invalido(`a unidade ${atual.sigla} já foi usada em lançamento: a sigla não muda (desative-a e crie outra)`, { reason: 'sigla_em_uso', sigla: atual.sigla });
      }
      await tx.produtoUnidadeConversao.update({ where: { id: atual.id }, data: dados });
      r.alteradas++;
    } else {
      // Sigla igual a uma desativada que continua vigente? (mantida por uso) — reativa por UPDATE, não duplica.
      await tx.produtoUnidadeConversao.create({ data: { ...dados, cliente_id: clienteId, produto_id: produtoId } });
      r.criadas++;
    }
  }
  return r;
};

/** Lista vigente (não excluída), pública, com a equivalência em texto. */
export const listarConversoesPublicas = (produto) => {
  const unidadeEstoque = unidadeEstoqueEfetiva(produto);
  const lista = Array.isArray(produto?.unidadesConversao) ? produto.unidadesConversao : [];
  return lista.filter((c) => c.excluido_em == null).map((c) => ({ ...comoConversaoPublica(c), equivalencia: equivalencia(c, unidadeEstoque) }));
};

export { texto4 };
