/**
 * D-PROD-155 — seletores da tela de Lançamentos (guardados pela PRÓPRIA tela,
 * `visualizar`), todos paginados por keyset (nome, id) em ordem alfabética e
 * com busca no servidor: nenhum teto silencioso, qualquer ativo é alcançável.
 * Envelope `{ itens, has_more, next_cursor }` (o mesmo das opções da P2).
 */

import { SELECT_CONVERSOES, listarConversoesPublicas } from '../produtos/produtoUnidadesConversao.js';
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { lerPapeis } from '../fornecedores/fornecedorDominio.js';
import { exigirEmpresaDoTenant, invalido, textoDeBusca } from '../gestao/gestaoComum.js';
import { caminhosDe } from '../gestao/naturezaFinanceiraService.js';
import { escaparCuringasLike } from '../usuarios/usuarioRepository.js';
import { CASAS_QUANTIDADE, ZERO, dec, texto } from './decimalFinanceiro.js';
import { ID_DE_CURSOR } from '../../shared/pagination/keysetCursor.js';

export const LIMITE_OPCOES_PADRAO = 50;
export const LIMITE_OPCOES_MAXIMO = 100;

const codificar = (nome, id) => Buffer.from(JSON.stringify([nome, id]), 'utf8').toString('base64url');
/** Nome que um registro pode ter: até 255 caracteres (as colunas de nome), sem NUL e sem surrogate isolado. */
const NOME_IMPOSSIVEL = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/**
 * Cursor adulterado (id fora do padrão, nome com NUL, surrogate isolado ou
 * maior que as colunas) → null → 400 `cursor_invalido`, nunca 500 no banco
 * (22021) ou no engine (JSON). Os demais caracteres de controle podem estar
 * num nome gravado e continuam aceitos.
 */
const decodificar = (bruto) => {
  try {
    const v = JSON.parse(Buffer.from(String(bruto), 'base64url').toString('utf8'));
    if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'string' || typeof v[1] !== 'string') return null;
    if (!ID_DE_CURSOR.test(v[1]) || NOME_IMPOSSIVEL.test(v[0]) || [...v[0]].length > 255) return null;
    return { nome: v[0], id: v[1] };
  } catch {
    return null;
  }
};

const paginacao = (query) => {
  const n = Number(query.limit);
  const limit = Number.isInteger(n) && n >= 1 ? Math.min(n, LIMITE_OPCOES_MAXIMO) : LIMITE_OPCOES_PADRAO;
  const cursor = query.cursor ? decodificar(query.cursor) : null;
  if (query.cursor && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'cursor_invalido' });
  // Busca literal: o `contains` do Prisma não escapa `%`/`_` (q=% casaria tudo).
  const q = escaparCuringasLike(textoDeBusca(query.q));
  return { limit, cursor, q };
};

/** Página keyset genérica por (campoNome, id) crescente. */
const pagina = async (delegado, { where, campoNome, select, limit, cursor, mapear }) => {
  const AND = [where];
  if (cursor) AND.push({ OR: [{ [campoNome]: { gt: cursor.nome } }, { [campoNome]: cursor.nome, id: { gt: cursor.id } }] });
  const linhas = await delegado.findMany({ where: { AND }, orderBy: [{ [campoNome]: 'asc' }, { id: 'asc' }], take: limit + 1, select });
  const vis = linhas.slice(0, limit);
  const ultimo = vis[vis.length - 1];
  return {
    itens: await mapear(vis),
    has_more: linhas.length > limit,
    next_cursor: linhas.length > limit && ultimo ? codificar(ultimo[campoNome], ultimo.id) : null,
  };
};

/** Parceiros ativos da empresa com o papel da direção (PAGAR: fornecedor/prestador ou legado; RECEBER: cliente). */
export const opcoesParceiros = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacao(query);
  // Grafias GRAVADAS dos papéis (aliases históricos) pela mesma normalização de `lerPapeis`.
  const gravadas = /** @type {Array<{ t: string }>} */ (
    await prisma.$queryRaw`SELECT DISTINCT unnest(tipos) AS t FROM "Fornecedor" WHERE cliente_id = ${auth.clienteId} AND empresa_id = ${empresaId}`
  );
  const papeisAceitos = query.direcao === 'RECEBER' ? ['cliente'] : ['fornecedor', 'prestador_servico'];
  const grafias = gravadas.map((l) => l.t).filter((t) => typeof t === 'string' && lerPapeis([t]).papeis.some((p) => papeisAceitos.includes(p)));
  const OR = [...(grafias.length ? [{ tipos: { hasSome: grafias } }] : []), ...(query.direcao === 'RECEBER' ? [] : [{ tipos: { isEmpty: true } }])];
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, empresa_id: empresaId, ativo: true }, OR.length ? { OR } : { id: { in: [] } }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { razao_social: { contains: q, mode: 'insensitive' } }, { numero_cadastro: { contains: q } }] });
  return pagina(prisma.fornecedor, {
    where: { AND: filtros },
    campoNome: 'nome',
    select: { id: true, numero_cadastro: true, nome: true, tipos: true },
    limit,
    cursor,
    mapear: async (linhas) => linhas.map((r) => ({ id: r.id, numero: r.numero_cadastro, nome: r.nome, papeis: lerPapeis(r.tipos).papeis })),
  });
};

/** Produtos ativos da empresa (unidade principal, peso por saco e estoque atual em string). */
export const opcoesProdutos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacao(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome_produto: { contains: q, mode: 'insensitive' } }, { numero_produto: { contains: q } }, { codigo_interno: { contains: q, mode: 'insensitive' } }] });
  return pagina(prisma.produto, {
    where: { AND: filtros },
    campoNome: 'nome_produto',
    select: { id: true, numero_produto: true, nome_produto: true, unidade_principal_estoque: true, peso_por_saco_kg: true, estoque_atual: true, unidadesConversao: SELECT_CONVERSOES },
    limit,
    cursor,
    mapear: async (linhas) =>
      linhas.map((p) => ({
        id: p.id,
        numero: p.numero_produto,
        nome: p.nome_produto,
        unidade_principal_estoque: p.unidade_principal_estoque,
        peso_por_saco_kg: texto(p.peso_por_saco_kg, CASAS_QUANTIDADE),
        estoque_atual: texto(p.estoque_atual, CASAS_QUANTIDADE),
        // D-PROD-286: unidades de conversão ativas (compra e venda escolhem a unidade; o servidor converte).
        unidades_conversao: listarConversoesPublicas(p).filter((c) => c.ativa),
      })),
  });
};

/** Locais ativos do TENANT (o local é compartilhado entre empresas; o saldo não). */
export const opcoesLocais = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { limit, cursor, q } = paginacao(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero_local: { contains: q } }] });
  return pagina(prisma.localEstoque, {
    where: { AND: filtros },
    campoNome: 'nome',
    select: { id: true, numero_local: true, nome: true },
    limit,
    cursor,
    mapear: async (linhas) => linhas.map((l) => ({ id: l.id, numero: l.numero_local, nome: l.nome })),
  });
};

/** Saldo disponível (lotes Disponivel) do produto por local, SÓ desta empresa. */
export const opcoesSaldos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const produto = await prisma.produto.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: String(query.produto_id) } }, select: { empresa_id: true } });
  if (!produto || produto.empresa_id !== empresaId) {
    throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado nesta empresa', { details: { field: 'produto_id', reason: 'produto_nao_encontrado' } });
  }
  const grupos = await prisma.estoqueLoteNota.groupBy({
    by: ['local_estoque_id'],
    where: { cliente_id: auth.clienteId, empresa_id: empresaId, produto_id: String(query.produto_id), status: 'Disponivel', quantidade_disponivel: { gt: 0 } },
    _sum: { quantidade_disponivel: true },
  });
  const ids = grupos.map((g) => g.local_estoque_id);
  const locais = ids.length
    ? await prisma.localEstoque.findMany({ where: { cliente_id: auth.clienteId, id: { in: ids } }, select: { id: true, nome: true } })
    : [];
  const nomes = new Map(locais.map((l) => [l.id, l.nome]));
  return {
    itens: grupos
      .map((g) => ({
        local_estoque_id: g.local_estoque_id,
        local_nome: nomes.get(g.local_estoque_id) ?? null,
        disponivel_kg: (g._sum.quantidade_disponivel == null ? ZERO : dec(g._sum.quantidade_disponivel)).toFixed(CASAS_QUANTIDADE),
      }))
      .sort((a, b) => String(a.local_nome ?? '').localeCompare(String(b.local_nome ?? '')) || a.local_estoque_id.localeCompare(b.local_estoque_id)),
  };
};

/** Naturezas ATIVAS e ANALÍTICAS (sem filha ativa) do tipo pedido, com o caminho. */
export const opcoesNaturezas = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacao(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, empresa_id: empresaId, tipo: query.tipo, ativo: true, filhos: { none: { ativo: true } } }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }] });
  return pagina(prisma.naturezaFinanceira, {
    where: { AND: filtros },
    campoNome: 'nome',
    select: { id: true, numero: true, nome: true, tipo: true },
    limit,
    cursor,
    mapear: async (linhas) => {
      const caminhos = await caminhosDe(prisma, auth.clienteId, empresaId, linhas.map((r) => r.id));
      return linhas.map((r) => ({ id: r.id, numero: r.numero, nome: r.nome, caminho: caminhos.get(r.id)?.caminho ?? r.nome, tipo: r.tipo }));
    },
  });
};

/** Centros (custo ou resultado) ATIVOS da empresa. */
export const opcoesCentros = (lado) => async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacao(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }] });
  return pagina(lado === 'custo' ? prisma.centroCusto : prisma.centroResultado, {
    where: { AND: filtros },
    campoNome: 'nome',
    select: { id: true, numero: true, nome: true },
    limit,
    cursor,
    mapear: async (linhas) => linhas.map((c) => ({ id: c.id, numero: c.numero, nome: c.nome })),
  });
};
