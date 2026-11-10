/**
 * D-PROD-159 (Patrimônio P1-02) — seletores PRÓPRIOS da tela
 * `pat-abastecimentos` (C12): bens, tanques, tipos de combustível, produtos,
 * produtos do filtro e locais com saldo. Nenhuma dependência das telas de bens
 * ou da Central: quem só tem Abastecimentos não leva 403. Só leitura, sem
 * trava (o comando relê tudo sob as travas).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_QUANTIDADE, CASAS_PRECO, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { ehContador, leituraVigente, pisoOperacional, pontoDoCadastro } from './abastecimentoMedidor.js';
import { NATUREZAS_COM_TANQUE } from './abastecimentoPlano.js';
import { paginacaoOpcoes, paginarPorNome } from './patrimonioComum.js';

const bemNaoEncontrado = () =>
  new AppError('BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem patrimonial não encontrado nesta fazenda', { details: { field: 'bem_id', reason: 'bem_inexistente' } });
const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const t4 = (v) => dec(v).toFixed(CASAS_QUANTIDADE);

const inicio = async (contexto, query) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  return { cli: auth.clienteId, prisma, empresaId };
};

/** A7: bens com tanque da empresa (`uso=formulario`: só ativos com tanque ativo; `filtro`: todos). */
export const opcoesBens = async (contexto, query = {}) => {
  const { cli, prisma, empresaId } = await inicio(contexto, query);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  const uso = query.uso === 'filtro' ? 'filtro' : 'formulario';
  /** @type {any[]} */
  const filtros = [{ cliente_id: cli, empresa_id: empresaId, natureza: { in: [...NATUREZAS_COM_TANQUE] } }];
  if (uso === 'formulario') filtros.push({ ativo: true, tanques: { some: { ativo: true } } });
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo_frota: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }] });
  return paginarPorNome(prisma.bemPatrimonial, {
    where: { AND: filtros },
    campoNome: 'nome',
    select: { id: true, numero: true, codigo_frota: true, nome: true, natureza: true, ativo: true, medidor_tipo: true, medidor_unidade: true },
    limit,
    cursor,
    mapear: (linhas) =>
      linhas.map((b) => ({
        id: b.id, numero: b.numero, codigo_frota: b.codigo_frota ?? null, nome: b.nome, natureza: b.natureza, ativo: b.ativo,
        medidor: { tipo: b.medidor_tipo ?? null, unidade: b.medidor_unidade ?? null },
      })),
  });
};

/** A8: tanques ATIVOS do bem com os combustíveis ATIVOS medidos em litros, e a leitura vigente do medidor. */
export const opcoesTanques = async (contexto, query = {}) => {
  const { cli, prisma, empresaId } = await inicio(contexto, query);
  const bem = await prisma.bemPatrimonial.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, id: query.bem_id },
    select: { id: true, numero: true, codigo_frota: true, nome: true, natureza: true, ativo: true, medidor_tipo: true, medidor_unidade: true, medidor_leitura_atual: true, medidor_data_leitura: true },
  });
  if (!bem) throw bemNaoEncontrado();
  const tanques = await prisma.tanqueBem.findMany({
    where: { cliente_id: cli, bem_id: bem.id, ativo: true },
    orderBy: [{ identificador: 'asc' }, { id: 'asc' }],
    select: { id: true, identificador: true, capacidade_litros: true, combustiveis: { select: { combustivel: { select: { id: true, codigo: true, nome: true, unidade: true, ativo: true } } } } },
  });
  const leitura = ehContador(bem.medidor_tipo) ? leituraVigente(pontoDoCadastro(bem), await pisoOperacional(prisma, cli, bem.id, bem.medidor_tipo)) : null;
  return {
    bem: {
      id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota ?? null, nome: bem.nome, natureza: bem.natureza, ativo: bem.ativo,
      medidor: { tipo: bem.medidor_tipo ?? null, unidade: bem.medidor_unidade ?? null },
      leitura_vigente: leitura,
    },
    itens: tanques.map((t) => ({
      id: t.id,
      identificador: t.identificador,
      capacidade_litros: t4(t.capacidade_litros),
      combustiveis: t.combustiveis
        .map((c) => c.combustivel)
        .filter((c) => c.ativo && c.unidade === 'L')
        .sort((a, b) => comparar(a.nome, b.nome) || comparar(a.id, b.id))
        .map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome })),
    })),
  };
};

/** A9: tipos de combustível ATIVOS medidos em litros (catálogo do tenant; `empresa_id` ignorado). */
export const opcoesTipos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true, unidade: 'L' }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(prisma.tipoCombustivel, {
    where: { AND: filtros },
    campoNome: 'nome',
    select: { id: true, codigo: true, nome: true, unidade: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((t) => ({ id: t.id, codigo: t.codigo, nome: t.nome, unidade: t.unidade })),
  });
};

/** A10: produtos ATIVOS da empresa com vínculo ATIVO ao tipo, e a conversão vigente de cada um. */
export const opcoesProdutos = async (contexto, query = {}) => {
  const { cli, prisma, empresaId } = await inicio(contexto, query);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  const tipoId = query.tipo_combustivel_id;
  /** @type {any[]} */
  const filtros = [{ cliente_id: cli, empresa_id: empresaId, ativo: true, vinculosCombustivel: { some: { empresa_id: empresaId, tipo_combustivel_id: tipoId, ativo: true } } }];
  if (q) filtros.push({ OR: [{ nome_produto: { contains: q, mode: 'insensitive' } }, { codigo_interno: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(prisma.produto, {
    where: { AND: filtros },
    campoNome: 'nome_produto',
    select: { id: true, nome_produto: true, codigo_interno: true, unidade_principal_estoque: true },
    limit,
    cursor,
    mapear: async (linhas) => {
      const conversoes = linhas.length
        ? await prisma.conversaoCombustivelProduto.findMany({
            where: { cliente_id: cli, empresa_id: empresaId, tipo_combustivel_id: tipoId, ativo: true, produto_id: { in: linhas.map((l) => l.id) } },
            select: { id: true, produto_id: true, versao: true, sequencia: true, kg_por_litro: true },
          })
        : [];
      const porProduto = new Map(conversoes.map((c) => [c.produto_id, c]));
      return linhas.map((p) => {
        const c = porProduto.get(p.id);
        return {
          id: p.id,
          nome: p.nome_produto,
          codigo_interno: p.codigo_interno ?? null,
          unidade_principal_estoque: p.unidade_principal_estoque,
          conversao: c ? { id: c.id, versao: c.versao, sequencia: c.sequencia, kg_por_litro: dec(c.kg_por_litro).toFixed(CASAS_PRECO) } : null,
        };
      });
    },
  });
};

/** A11: produtos da empresa com QUALQUER vínculo de combustível (filtro da lista; inclui inativos). */
export const opcoesProdutosFiltro = async (contexto, query = {}) => {
  const { cli, prisma, empresaId } = await inicio(contexto, query);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: cli, empresa_id: empresaId, vinculosCombustivel: { some: { empresa_id: empresaId } } }];
  if (q) filtros.push({ OR: [{ nome_produto: { contains: q, mode: 'insensitive' } }, { codigo_interno: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(prisma.produto, {
    where: { AND: filtros },
    campoNome: 'nome_produto',
    select: { id: true, nome_produto: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((p) => ({ id: p.id, nome: p.nome_produto })),
  });
};

/** A12: locais ATIVOS com saldo (lotes Disponível > 0) do produto NA empresa. */
export const opcoesLocais = async (contexto, query = {}) => {
  const { cli, prisma, empresaId } = await inicio(contexto, query);
  const produto = await prisma.produto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: query.produto_id }, select: { id: true } });
  if (!produto) {
    throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado nesta fazenda', { details: { field: 'produto_id', reason: 'produto_nao_encontrado' } });
  }
  const grupos = await prisma.estoqueLoteNota.groupBy({
    by: ['local_estoque_id'],
    where: { cliente_id: cli, empresa_id: empresaId, produto_id: produto.id, status: 'Disponivel', quantidade_disponivel: { gt: 0 } },
    _sum: { quantidade_disponivel: true },
  });
  const ids = grupos.map((g) => g.local_estoque_id).filter((v) => typeof v === 'string');
  const locais = ids.length
    ? await prisma.localEstoque.findMany({ where: { cliente_id: cli, id: { in: ids }, ativo: true }, select: { id: true, nome: true } })
    : [];
  const saldo = new Map(grupos.map((g) => [g.local_estoque_id, g._sum.quantidade_disponivel]));
  return {
    itens: locais
      .sort((a, b) => comparar(a.nome, b.nome) || comparar(a.id, b.id))
      .map((l) => ({ local_estoque_id: l.id, local_nome: l.nome, disponivel_kg: t4(saldo.get(l.id) ?? 0) })),
  };
};
