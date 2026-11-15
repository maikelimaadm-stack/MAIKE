/**
 * Repositório de Formulações de suplemento da fazenda (D-PROD-203), tabelas
 * físicas "CADFORMULACAO" (model `Formulacao`), "CADFORMULACAOINGREDIENTE"
 * (`FormulacaoIngrediente`) e "CADFORMULACAOREGRA" (`FormulacaoRegraCategoria`).
 *
 * Toda leitura é pela chave do tenant E da fazenda: uma formulação de outra
 * fazenda do mesmo tenant não é encontrada (404), nem de outro tenant. Escrita
 * sempre em transação, recebendo o `tx` do serviço.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const ASC = /** @type {const} */ ('asc');

/** Formulação com o nome do produto, os ingredientes (na ordem) e as regras, com os nomes para exibição. */
const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  nome: true,
  tipo: true,
  produto_id: true,
  percentual_pv_padrao: true,
  consumo_objetivo_g_cab_dia: true,
  faixa_tolerancia_percentual: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
  produto: { select: { nome_produto: true, ativo: true } },
  ingredientes: {
    orderBy: [{ ordem: ASC }, { id: ASC }],
    select: { id: true, produto_id: true, quantidade_kg: true, ordem: true, produto: { select: { nome_produto: true, ativo: true } } },
  },
  regras: {
    orderBy: [{ categoriaManejo: { nome: ASC } }, { id: ASC }],
    select: { id: true, categoria_manejo_id: true, consome: true, percentual_pv: true, categoriaManejo: { select: { nome: true, ativo: true } } },
  },
});

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {{ somenteAtivas?: boolean }} [opcoes]
 */
export const listarFormulacoes = async (clienteId, empresaId, opcoes = {}) =>
  getPrismaClient().formulacao.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, ...(opcoes.somenteAtivas ? { ativo: true } : {}) },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarFormulacao = async (clienteId, empresaId, id, tx) =>
  (tx || getPrismaClient()).formulacao.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id },
    select: SELECAO,
  });

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} nome
 * @param {string} [ignorarId]
 */
export const existeFormulacaoComNome = async (tx, clienteId, empresaId, nome, ignorarId) => {
  const existente = await tx.formulacao.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, nome, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true },
  });
  return Boolean(existente);
};

/**
 * Produtos do tenant pelos ids (o serviço confere a fazenda e o `ativo`).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string[]} ids
 */
export const lerProdutos = async (tx, clienteId, ids) =>
  ids.length
    ? tx.produto.findMany({ where: { cliente_id: clienteId, id: { in: ids } }, select: { id: true, empresa_id: true, nome_produto: true, ativo: true } })
    : [];

/**
 * Categorias de manejo do tenant pelos ids (o serviço confere a fazenda e o `ativo`).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string[]} ids
 */
export const lerCategorias = async (tx, clienteId, ids) =>
  ids.length
    ? tx.categoriaManejo.findMany({ where: { cliente_id: clienteId, id: { in: ids } }, select: { id: true, empresa_id: true, nome: true, ativo: true } })
    : [];

/**
 * Cria a formulação com os ingredientes e as regras, na mesma transação.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Record<string, unknown>} dados
 * @param {Array<{ produto_id: string, quantidade_kg: string }>} ingredientes
 * @param {Array<{ categoria_manejo_id: string, consome: boolean, percentual_pv: string | null }>} regras
 */
export const inserirFormulacao = async (tx, dados, ingredientes, regras) => {
  const criada = await tx.formulacao.create({ data: /** @type {any} */ (dados), select: { id: true, cliente_id: true, empresa_id: true } });
  await gravarFilhas(tx, criada, ingredientes, regras);
  return /** @type {NonNullable<Awaited<ReturnType<typeof buscarFormulacao>>>} */ (await buscarFormulacao(criada.cliente_id, criada.empresa_id, criada.id, tx));
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ id: string, cliente_id: string, empresa_id: string }} formulacao
 * @param {Array<{ produto_id: string, quantidade_kg: string }>} ingredientes
 * @param {Array<{ categoria_manejo_id: string, consome: boolean, percentual_pv: string | null }>} regras
 */
const gravarFilhas = async (tx, formulacao, ingredientes, regras) => {
  const escopo = { cliente_id: formulacao.cliente_id, empresa_id: formulacao.empresa_id, formulacao_id: formulacao.id };
  if (ingredientes.length) {
    await tx.formulacaoIngrediente.createMany({
      data: ingredientes.map((i, ordem) => ({ ...escopo, produto_id: i.produto_id, quantidade_kg: i.quantidade_kg, ordem })),
    });
  }
  if (regras.length) {
    await tx.formulacaoRegraCategoria.createMany({
      data: regras.map((r) => ({ ...escopo, categoria_manejo_id: r.categoria_manejo_id, consome: r.consome, percentual_pv: r.percentual_pv })),
    });
  }
};

/**
 * Atualiza a formulação e, quando enviadas, SUBSTITUI as listas inteiras
 * (ingredientes e/ou regras), na mesma transação.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ id: string, cliente_id: string, empresa_id: string }} formulacao
 * @param {Record<string, unknown>} dados
 * @param {{ ingredientes?: Array<{ produto_id: string, quantidade_kg: string }>, regras?: Array<{ categoria_manejo_id: string, consome: boolean, percentual_pv: string | null }> }} listas
 */
export const atualizarFormulacao = async (tx, formulacao, dados, listas) => {
  const chave = { cliente_id: formulacao.cliente_id, formulacao_id: formulacao.id };
  if (Object.keys(dados).length) {
    await tx.formulacao.update({ where: { cliente_id_id: { cliente_id: formulacao.cliente_id, id: formulacao.id } }, data: dados, select: { id: true } });
  } else {
    // Só as listas mudaram: a formulação também conta como alterada (updatedAt).
    await tx.formulacao.update({ where: { cliente_id_id: { cliente_id: formulacao.cliente_id, id: formulacao.id } }, data: { updatedAt: new Date() }, select: { id: true } });
  }
  if (listas.ingredientes) await tx.formulacaoIngrediente.deleteMany({ where: chave });
  if (listas.regras) await tx.formulacaoRegraCategoria.deleteMany({ where: chave });
  await gravarFilhas(tx, formulacao, listas.ingredientes ?? [], listas.regras ?? []);
  return /** @type {NonNullable<Awaited<ReturnType<typeof buscarFormulacao>>>} */ (await buscarFormulacao(formulacao.cliente_id, formulacao.empresa_id, formulacao.id, tx));
};

/**
 * Trava a formulação `FOR UPDATE` antes de contar quem a usa e de excluir.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId @param {string} empresaId @param {string} id
 */
export const travarFormulacao = async (tx, clienteId, empresaId, id) => {
  await tx.$queryRaw`SELECT id FROM "CADFORMULACAO" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`;
};

/**
 * Quantos lançamentos de suplementação (documento JSON `SuplementacaoEvento.dados`)
 * da MESMA fazenda citam a formulação em `dados->>'formulacao_id'`.
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} cliente
 * @param {string} clienteId @param {string} empresaId @param {string} id
 */
export const contarLancamentosDaFormulacao = async (cliente, clienteId, empresaId, id) => {
  const [linha] = /** @type {Array<{ n: bigint | number }>} */ (
    await cliente.$queryRaw`SELECT count(*) AS n FROM "SuplementacaoEvento" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND dados->>'formulacao_id' = ${id}`
  );
  return Number(linha?.n ?? 0);
};

/**
 * Exclusão física; ingredientes e regras saem junto (FK ON DELETE CASCADE).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId @param {string} id
 */
export const excluirFormulacaoPorId = async (tx, clienteId, id) =>
  tx.formulacao.delete({ where: { cliente_id_id: { cliente_id: clienteId, id } }, select: { id: true } });
