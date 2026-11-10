/**
 * D-PROD-159 (Patrimônio P1-02), revisto pela D-PROD-161 (SIMPLIFICA-01) —
 * seletores PRÓPRIOS da tela `pat-abastecimentos` (C12): bens, tanques (com os
 * Produtos aceitos), produtos do bem, produtos do filtro e locais com saldo.
 * Nenhuma dependência das telas de bens ou da Central: quem só tem
 * Abastecimentos não leva 403. Só leitura, sem trava (o comando relê tudo sob
 * as travas).
 *
 * D-PROD-161: saem o catálogo de tipos de combustível (A9), os produtos por
 * tipo com o fator (A10) e todo fator kg/L; tudo sai dos "Produtos aceitos"
 * (`TanqueBemProduto`) de cada tanque, em `L` ou `KG`.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { CASAS_QUANTIDADE, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { ehContador, leituraVigente, pisoOperacional, pontoDoCadastro } from './abastecimentoMedidor.js';
import { NATUREZAS_COM_TANQUE, unidadeDoAbastecimento } from './abastecimentoPlano.js';
import { paginacaoOpcoes, paginarPorNome } from './patrimonioComum.js';
import { UNIDADES_ABASTECIMENTO } from './patrimonioDominio.js';

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
/** Tanques ATIVOS do bem com os Produtos aceitos ATIVOS (ordem identificador, id). */
const lerTanquesAtivos = (db, cli, bemId) =>
  db.tanqueBem.findMany({
    where: { cliente_id: cli, bem_id: bemId, ativo: true },
    orderBy: [{ identificador: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      identificador: true,
      capacidade_litros: true,
      produtos: {
        where: { ativo: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { produto: { select: { id: true, nome_produto: true, codigo_interno: true, unidade_principal_estoque: true, ativo: true, empresa_id: true } } },
      },
    },
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
/**
 * Por que um Produto aceito NÃO serve para abastecer agora (null = serve).
 * Ordem: inativo → outra fazenda → unidade fora de L/KG.
 * @param {{ ativo: boolean, empresa_id: string, unidade_principal_estoque: string }} p @param {string} empresaId
 * @returns {null|'inativo'|'outra_empresa'|'unidade_nao_aceita'}
 */
const motivoDoProduto = (p, empresaId) => {
  if (!p.ativo) return 'inativo';
  if (p.empresa_id !== empresaId) return 'outra_empresa';
  if (!unidadeDoAbastecimento(p.unidade_principal_estoque)) return 'unidade_nao_aceita';
  return null;
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

/** A8: tanques ATIVOS do bem com os Produtos aceitos (e se cada um serve agora), e a leitura vigente do medidor. */
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
      produtos: t.produtos
        .map((a) => a.produto)
        .sort((a, b) => comparar(a.nome_produto, b.nome_produto) || comparar(a.id, b.id))
        .map((p) => {
          const motivo = motivoDoProduto(p, empresaId);
          return {
            id: p.id, nome: p.nome_produto, codigo_interno: p.codigo_interno ?? null, unidade_principal_estoque: p.unidade_principal_estoque, elegivel: motivo === null, motivo,
          };
        }),
    })),
  };
};

/** Leitura consistente SEM trava (o resumo e a página saem do MESMO instantâneo). */
const LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

/**
 * A16 (D-PROD-160, revista pela D-PROD-161): PRODUTOS que o operador pode
 * escolher para o bem, lidos dos "Produtos aceitos" (`TanqueBemProduto`) dos
 * tanques ATIVOS do bem. Elegível = aceite ATIVO num tanque ATIVO ∧ Produto
 * ativo ∧ `empresa_id` = do bem ∧ unidade de estoque `L` ou `KG`. Cada item
 * traz os tanques do bem que o aceitam (o seletor de tanque segue o Produto).
 * Sem tipo de combustível e sem fator. Envelope `{bem, itens, has_more,
 * next_cursor, resumo}`; `resumo` é do conjunto INTEIRO (ignora `q`/`cursor`).
 * Só leitura (sem trava, sem auditoria): a confirmação revalida tudo sob a
 * trava do bem (TOCTOU fail-closed).
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
    /** @param {string} motivo @param {Partial<{total: number, fora_de_unidade: number, inativos_ou_outra_fazenda: number}>} [contas] */
    const vazio = (motivo, contas = {}) => ({
      bem: publico, itens: [], has_more: false, next_cursor: null,
      resumo: { motivo_sem_opcao: motivo, total: 0, fora_de_unidade: 0, inativos_ou_outra_fazenda: 0, ...contas },
    });
    if (!bem.ativo) return vazio('bem_inativo');
    if (!NATUREZAS_COM_TANQUE.includes(bem.natureza)) return vazio('sem_tanque_ativo');
    const tanques = await lerTanquesAtivos(tx, cli, bem.id);
    if (!tanques.length) return vazio('sem_tanque_ativo');

    /** @type {Map<string, any>} */
    const aceitos = new Map();
    /** @type {Map<string, Array<{id: string, identificador: string, capacidade_litros: string}>>} */
    const tanquesPorProduto = new Map();
    for (const t of tanques) {
      for (const a of t.produtos) {
        aceitos.set(a.produto.id, a.produto);
        const lista = tanquesPorProduto.get(a.produto.id) ?? [];
        if (!lista.some((x) => x.id === t.id)) lista.push({ id: t.id, identificador: t.identificador, capacidade_litros: t4(t.capacidade_litros) });
        tanquesPorProduto.set(a.produto.id, lista);
      }
    }
    if (!aceitos.size) return vazio('tanque_sem_produto');

    // Resumo do conjunto INTEIRO (sem `q`, sem `cursor`), no mesmo instantâneo.
    let total = 0;
    let foraDeUnidade = 0;
    let inativosOuOutraFazenda = 0;
    for (const p of aceitos.values()) {
      const m = motivoDoProduto(p, empresaId);
      if (m === null) total += 1;
      else if (m === 'unidade_nao_aceita') foraDeUnidade += 1;
      else inativosOuOutraFazenda += 1;
    }
    const resumo = {
      motivo_sem_opcao: total > 0 ? null : foraDeUnidade > 0 ? 'produto_unidade_incompativel' : 'produto_inativo_ou_outra_fazenda',
      total,
      fora_de_unidade: foraDeUnidade,
      inativos_ou_outra_fazenda: inativosOuOutraFazenda,
    };
    if (!total) return vazio(/** @type {string} */ (resumo.motivo_sem_opcao), resumo);

    // `Produto.empresa_id` e a unidade no próprio filtro: aceite incoerente (produto movido) nunca entra.
    const elegivel = {
      cliente_id: cli, empresa_id: empresaId, ativo: true, unidade_principal_estoque: { in: [...UNIDADES_ABASTECIMENTO] }, id: { in: [...aceitos.keys()] },
    };
    /** @type {any} */
    const busca = q ? { OR: [{ nome_produto: { contains: q, mode: 'insensitive' } }, { codigo_interno: { contains: q, mode: 'insensitive' } }] } : null;
    const pagina = await paginarPorNome(tx.produto, {
      where: busca ? { AND: [elegivel, busca] } : elegivel,
      campoNome: 'nome_produto',
      select: { id: true, nome_produto: true, codigo_interno: true, unidade_principal_estoque: true },
      limit,
      cursor,
      mapear: (linhas) =>
        linhas.map((p) => ({
          id: p.id,
          produto: { id: p.id, nome: p.nome_produto, codigo_interno: p.codigo_interno ?? null, unidade_principal_estoque: p.unidade_principal_estoque },
          tanques: (tanquesPorProduto.get(p.id) ?? []).map((t) => ({ ...t })),
          pronto: true,
        })),
    });
    return { bem: publico, itens: pagina.itens, has_more: pagina.has_more, next_cursor: pagina.next_cursor, resumo };
  });
};

/**
 * A11: produtos da empresa com algum aceite em tanque de bem da empresa OU
 * algum abastecimento na empresa (filtro da lista; inclui inativos e aceites
 * desligados: o histórico continua filtrável).
 */
export const opcoesProdutosFiltro = async (contexto, query = {}) => {
  const { cli, prisma, empresaId } = await inicio(contexto, query);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [
    { cliente_id: cli, empresa_id: empresaId },
    { OR: [{ tanquesAceitos: { some: { tanque: { bem: { empresa_id: empresaId } } } } }, { abastecimentosBem: { some: { empresa_id: empresaId } } }] },
  ];
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

/** A12: locais ATIVOS com saldo (lotes Disponível > 0) do produto NA empresa, na unidade de estoque do Produto. */
export const opcoesLocais = async (contexto, query = {}) => {
  const { cli, prisma, empresaId } = await inicio(contexto, query);
  const produto = await prisma.produto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: query.produto_id }, select: { id: true, unidade_principal_estoque: true } });
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
      .map((l) => ({ local_estoque_id: l.id, local_nome: l.nome, disponivel: t4(saldo.get(l.id) ?? 0), unidade: produto.unidade_principal_estoque })),
  };
};
