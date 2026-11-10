/**
 * D-PROD-159 (Patrimônio P1-02) — seletores PRÓPRIOS da tela
 * `pat-abastecimentos` (C12): bens, tanques, tipos de combustível, produtos,
 * produtos do filtro e locais com saldo. Nenhuma dependência das telas de bens
 * ou da Central: quem só tem Abastecimentos não leva 403. Só leitura, sem
 * trava (o comando relê tudo sob as travas).
 *
 * D-PROD-160 (Patrimônio UX-02) — A16 `produtos-do-bem`: os PRODUTOS que o
 * operador escolhe para o bem, já filtrados por todo o caminho bem → tanques
 * ativos → combustíveis permitidos (ativos, em L) → vínculo ATIVO na empresa →
 * Produto ativo da empresa em KG; o tipo de combustível vem do vínculo (nunca
 * de mapa no front) e o fator vigente acompanha (ou `bloqueios: ['sem_fator']`).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
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

/** Colunas do bem que A8 e A16 leem (público + ponto do cadastro do medidor). */
const SELECT_BEM = Object.freeze({
  id: true, numero: true, codigo_frota: true, nome: true, natureza: true, ativo: true, medidor_tipo: true, medidor_unidade: true, medidor_leitura_atual: true, medidor_data_leitura: true,
});
/** O bem da EMPRESA (inexistente = outra fazenda = outro tenant: o mesmo 404, sem oráculo). */
const lerBem = async (db, cli, empresaId, bemId) => {
  const bem = await db.bemPatrimonial.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: bemId }, select: SELECT_BEM });
  if (!bem) throw bemNaoEncontrado();
  return bem;
};
/** Tanques ATIVOS do bem com os combustíveis permitidos (ordem identificador, id). */
const lerTanquesAtivos = (db, cli, bemId) =>
  db.tanqueBem.findMany({
    where: { cliente_id: cli, bem_id: bemId, ativo: true },
    orderBy: [{ identificador: 'asc' }, { id: 'asc' }],
    select: { id: true, identificador: true, capacidade_litros: true, combustiveis: { select: { combustivel: { select: { id: true, codigo: true, nome: true, unidade: true, ativo: true } } } } },
  });
/** O objeto `bem` público de A8 e A16 (com a leitura vigente do medidor). */
const bemPublico = async (db, cli, bem) => {
  const leitura = ehContador(bem.medidor_tipo) ? leituraVigente(pontoDoCadastro(bem), await pisoOperacional(db, cli, bem.id, bem.medidor_tipo)) : null;
  return {
    id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota ?? null, nome: bem.nome, natureza: bem.natureza, ativo: bem.ativo,
    medidor: { tipo: bem.medidor_tipo ?? null, unidade: bem.medidor_unidade ?? null },
    leitura_vigente: leitura,
  };
};
/** Combustíveis do tanque que o abastecimento aceita: ATIVOS e medidos em litros. */
const combustiveisAceitos = (t) => t.combustiveis.map((c) => c.combustivel).filter((c) => c.ativo && c.unidade === 'L');

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
  const bem = await lerBem(prisma, cli, empresaId, query.bem_id);
  const tanques = await lerTanquesAtivos(prisma, cli, bem.id);
  return {
    bem: await bemPublico(prisma, cli, bem),
    itens: tanques.map((t) => ({
      id: t.id,
      identificador: t.identificador,
      capacidade_litros: t4(t.capacidade_litros),
      combustiveis: combustiveisAceitos(t)
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

/** Leitura consistente SEM trava (o resumo e a página saem do MESMO instantâneo). */
const LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

/**
 * A16 (D-PROD-160): PRODUTOS que o operador pode escolher para o bem, NA
 * empresa, cada um com o tipo de combustível derivado do seu vínculo ATIVO
 * (F1: um Produto tem no máximo um combustível ativo por fazenda), os tanques
 * do bem que aceitam esse tipo e o fator vigente do par (ou `null` com
 * `bloqueios: ['sem_fator']`). Fora das opções (e contados no `resumo`):
 * produto inativo, de outra fazenda, fora de KG, vínculo inativo ou de tipo
 * que nenhum tanque ativo do bem aceita. Envelope `{bem, itens, has_more,
 * next_cursor, resumo}`; `resumo` é do conjunto INTEIRO (ignora `q`/`cursor`).
 * Só leitura (sem trava, sem auditoria): a confirmação revalida tudo sob a
 * trava do vínculo (TOCTOU fail-closed).
 * @param {any} contexto @param {Record<string, any>} [query]
 */
export const opcoesProdutosDoBem = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const { limit, cursor, q } = paginacaoOpcoes(query);
    const bem = await lerBem(tx, cli, empresaId, query.bem_id);
    const publico = await bemPublico(tx, cli, bem);
    /** `motivo_sem_opcao` ∈ bem_inativo | sem_tanque_ativo | tanque_sem_combustivel (os outros dois saem do resumo). @param {string} motivo */
    const vazio = (motivo) => ({
      bem: publico, itens: [], has_more: false, next_cursor: null, resumo: { motivo_sem_opcao: motivo, total: 0, sem_fator: 0, fora_de_kg: 0, tipos_sem_produto: [] },
    });
    if (!bem.ativo) return vazio('bem_inativo');
    if (!NATUREZAS_COM_TANQUE.includes(bem.natureza)) return vazio('sem_tanque_ativo');
    const tanques = await lerTanquesAtivos(tx, cli, bem.id);
    if (!tanques.length) return vazio('sem_tanque_ativo');

    /** @type {Map<string, {id: string, codigo: string, nome: string}>} */
    const tiposAceitos = new Map();
    /** @type {Map<string, Array<{id: string, identificador: string, capacidade_litros: string}>>} */
    const tanquesPorTipo = new Map();
    for (const t of tanques) {
      for (const c of combustiveisAceitos(t)) {
        if (!tiposAceitos.has(c.id)) tiposAceitos.set(c.id, { id: c.id, codigo: c.codigo, nome: c.nome });
        const lista = tanquesPorTipo.get(c.id) ?? [];
        if (!lista.some((x) => x.id === t.id)) lista.push({ id: t.id, identificador: t.identificador, capacidade_litros: t4(t.capacidade_litros) });
        tanquesPorTipo.set(c.id, lista);
      }
    }
    if (!tiposAceitos.size) return vazio('tanque_sem_combustivel');

    const baseVinculo = { empresa_id: empresaId, tipo_combustivel_id: { in: [...tiposAceitos.keys()] } };
    // `Produto.empresa_id` no próprio filtro: vínculo incoerente (produto movido) nunca entra.
    const elegivel = { cliente_id: cli, empresa_id: empresaId, ativo: true, unidade_principal_estoque: 'KG', vinculosCombustivel: { some: baseVinculo } };

    // Resumo do conjunto INTEIRO (sem `q`, sem `cursor`).
    const total = await tx.produto.count({ where: elegivel });
    const comFator = await tx.produto.count({
      where: { ...elegivel, vinculosCombustivel: { some: { ...baseVinculo, conversoes: { some: { ativo: true } } } } },
    });
    const foraDeKg = await tx.produto.count({
      where: { cliente_id: cli, empresa_id: empresaId, ativo: true, unidade_principal_estoque: { not: 'KG' }, vinculosCombustivel: { some: baseVinculo } },
    });
    const comProduto = await tx.tipoCombustivelProduto.groupBy({
      by: ['tipo_combustivel_id'],
      where: { cliente_id: cli, ...baseVinculo, produto: { ativo: true, empresa_id: empresaId } },
    });
    const tiposComProduto = new Set(comProduto.map((g) => g.tipo_combustivel_id));
    const tiposSemProduto = [...tiposAceitos.values()]
      .filter((t) => !tiposComProduto.has(t.id))
      .sort((a, b) => comparar(a.nome, b.nome) || comparar(a.id, b.id))
      .map((t) => ({ id: t.id, nome: t.nome }));
    const resumo = {
      motivo_sem_opcao: total > 0 ? null : foraDeKg > 0 ? 'produto_unidade_nao_kg' : 'nenhum_produto_associado',
      total,
      sem_fator: total - comFator,
      fora_de_kg: foraDeKg,
      tipos_sem_produto: tiposSemProduto,
    };

    /** @type {any} */
    const busca = q ? { OR: [{ nome_produto: { contains: q, mode: 'insensitive' } }, { codigo_interno: { contains: q, mode: 'insensitive' } }] } : null;
    const pagina = await paginarPorNome(tx.produto, {
      where: busca ? { AND: [elegivel, busca] } : elegivel,
      campoNome: 'nome_produto',
      select: { id: true, nome_produto: true, codigo_interno: true, unidade_principal_estoque: true },
      limit,
      cursor,
      mapear: async (linhas) => {
        if (!linhas.length) return [];
        const ids = linhas.map((l) => l.id);
        const vinculos = await tx.tipoCombustivelProduto.findMany({
          where: { cliente_id: cli, ...baseVinculo, produto_id: { in: ids } },
          select: { produto_id: true, tipo_combustivel_id: true },
        });
        /** @type {Map<string, string>} */
        const tipoDoProduto = new Map();
        for (const v of vinculos) {
          // F1 (unique `TipoCombustivelProduto_produto_ativo_key`): no máximo UM vínculo ativo por produto na empresa.
          if (tipoDoProduto.has(v.produto_id)) throw new Error(`invariante F1 violada: produto ${v.produto_id} com mais de um vínculo ativo na empresa`);
          tipoDoProduto.set(v.produto_id, v.tipo_combustivel_id);
        }
        const conversoes = await tx.conversaoCombustivelProduto.findMany({
          where: { cliente_id: cli, empresa_id: empresaId, ativo: true, produto_id: { in: ids }, tipo_combustivel_id: { in: [...new Set(tipoDoProduto.values())] } },
          select: { id: true, produto_id: true, tipo_combustivel_id: true, versao: true, sequencia: true, kg_por_litro: true },
        });
        // Par EXATO (tipo, produto): o fator de outro par nunca serve.
        const fatorDoPar = new Map(conversoes.map((c) => [`${c.tipo_combustivel_id}|${c.produto_id}`, c]));
        return linhas.map((p) => {
          const tipoId = tipoDoProduto.get(p.id);
          const tipo = tipoId ? tiposAceitos.get(tipoId) : undefined;
          // Mesmo instantâneo do filtro: o produto da página tem o vínculo ativo de um tipo aceito.
          if (!tipoId || !tipo) throw new Error(`invariante violada: produto ${p.id} sem vínculo ativo de tipo aceito no instantâneo`);
          const c = fatorDoPar.get(`${tipoId}|${p.id}`);
          const bloqueios = c ? [] : ['sem_fator'];
          return {
            id: p.id,
            produto: { id: p.id, nome: p.nome_produto, codigo_interno: p.codigo_interno ?? null, unidade_principal_estoque: p.unidade_principal_estoque },
            tipo_combustivel: { id: tipo.id, codigo: tipo.codigo, nome: tipo.nome },
            conversao: c ? { id: c.id, versao: c.versao, sequencia: c.sequencia, kg_por_litro: dec(c.kg_por_litro).toFixed(CASAS_PRECO) } : null,
            tanques: (tanquesPorTipo.get(tipo.id) ?? []).map((t) => ({ ...t })),
            bloqueios,
            pronto: bloqueios.length === 0,
          };
        });
      },
    });
    return { bem: publico, itens: pagina.itens, has_more: pagina.has_more, next_cursor: pagina.next_cursor, resumo };
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
