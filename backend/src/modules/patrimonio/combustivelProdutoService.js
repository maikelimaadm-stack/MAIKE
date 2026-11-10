/**
 * D-PROD-157 (R2) — vínculo COMBUSTÍVEL × PRODUTO por empresa e o contrato de
 * leitura dos produtos ELEGÍVEIS de um bem (preparo da P1-02).
 *
 * `TipoCombustivel` é catálogo do TENANT; `Produto` é item REAL da fazenda
 * (`cliente_id + empresa_id`). O vínculo diz, POR EMPRESA, quais produtos
 * reais correspondem a um tipo de combustível — para o futuro abastecimento
 * oferecer só o que é compatível com o tanque e a fazenda. Nada aqui toca
 * estoque, financeiro, FIFO, custo, saldo ou unidade: o produto em KG é
 * exibido em KG (nenhuma conversão L↔KG).
 *
 * Invariantes (banco + serviço):
 *  - FKs compostas com o tenant para Empresa, TipoCombustivel e Produto
 *    (RESTRICT); par (empresa, tipo, produto) único; no máximo UM vínculo
 *    ATIVO por produto na empresa (`ativo_chave` true|NULL + unique).
 *  - `Produto.empresa_id = vínculo.empresa_id` é invariante do SERVIÇO
 *    (`Produto` é tabela antiga, sem unique (cliente_id, empresa_id, id), e a
 *    migration é expand-only): criar/reativar lê o produto com `FOR KEY SHARE`
 *    na mesma transação, e `produtoService` trava o produto (`FOR UPDATE`)
 *    antes de mudar a empresa (vínculo ATIVO → 409) ou excluir (qualquer
 *    vínculo → 409). As leituras (opções, elegíveis) ainda filtram a empresa
 *    do produto: um vínculo incoerente nunca é elegível e a lista o rotula
 *    (`empresa_coerente: false`).
 *  - Toda escrita: tenant da sessão, empresa validada no tenant, trava
 *    `patrimonio:combustivel-produto:<cli>:<emp>:<produto>` (os dois uniques
 *    contêm empresa e produto: toda disputa passa pela mesma trava), uniques
 *    como barreira final (P2002 → código de negócio), auditoria por
 *    allowlist na mesma transação. Sem DELETE: inativação com CAS por `versao`.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { ehViolacaoDeUnique, exigirEmpresaDoTenant, iso, travarEscopo } from '../gestao/gestaoComum.js';
import { atualizarComVersao, exigirVersao, lerAtivo, listarKeyset, paginacaoOpcoes, paginarPorNome } from './patrimonioComum.js';
import { naoEncontrado as combustivelNaoEncontrado } from './tipoCombustivelService.js';
import { naoEncontrado as bemNaoEncontrado } from './bemPatrimonialService.js';

export const ENTIDADE = 'TipoCombustivelProduto';

/** Chave da trava: toda escrita que envolve o produto NA empresa. */
export const chaveVinculo = (clienteId, empresaId, produtoId) => `patrimonio:combustivel-produto:${clienteId}:${empresaId}:${produtoId}`;

// ─── erros de negócio ───────────────────────────────────────────────────────

const MENSAGENS_INVALIDO = Object.freeze({
  inexistente: 'produto não encontrado nesta fazenda; escolha um produto ativo da fazenda; nada foi gravado',
  outra_empresa: 'o produto pertence a outra fazenda: só produtos desta fazenda podem ser vinculados; nada foi gravado',
  inativo: 'o produto está inativo: só produtos ativos podem ser vinculados; nada foi gravado',
  tipo_inativo: 'o tipo de combustível está inativo: reative-o antes de vincular produtos; nada foi gravado',
});
/**
 * 422 do vínculo. `inexistente` vale também para produto de OUTRO tenant
 * (mesma resposta: sem oráculo).
 * @param {'inexistente'|'outra_empresa'|'inativo'|'tipo_inativo'} reason
 */
const invalido = (reason) =>
  new AppError('COMBUSTIVEL_PRODUTO_INVALIDO', MENSAGENS_INVALIDO[reason], {
    details: { field: reason === 'tipo_inativo' ? 'tipo_combustivel_id' : 'produto_id', reason },
  });
const duplicado = () =>
  new AppError('COMBUSTIVEL_PRODUTO_DUPLICADO', 'este produto já está vinculado a este combustível nesta fazenda; nada foi gravado', {
    details: { field: 'produto_id', reason: 'ja_vinculado' },
  });
/** @param {string} vinculoId */
const duplicadoInativo = (vinculoId) =>
  new AppError('COMBUSTIVEL_PRODUTO_DUPLICADO', 'este produto já foi vinculado a este combustível nesta fazenda e o vínculo está inativo: reative-o; nada foi gravado', {
    details: { field: 'produto_id', reason: 'inativo_reative', vinculo_id: vinculoId },
  });
/** @param {string} tipoId */
const emOutroTipo = (tipoId) =>
  new AppError('COMBUSTIVEL_PRODUTO_EM_OUTRO_TIPO', 'este produto já está vinculado a outro combustível nesta fazenda: um produto, um combustível ativo; inative aquele vínculo antes; nada foi gravado', {
    details: { field: 'produto_id', reason: 'vinculado_a_outro_tipo', tipo_combustivel_id: tipoId },
  });
export const naoEncontrado = () => new AppError('COMBUSTIVEL_PRODUTO_NAO_ENCONTRADO', 'vínculo de produto não encontrado nesta fazenda');
const tanqueNaoEncontrado = () =>
  new AppError('BEM_PATRIMONIAL_NAO_ENCONTRADO', 'tanque não encontrado neste bem', { details: { field: 'tanque_id', reason: 'tanque_inexistente' } });

// ─── formas públicas e auditoria ────────────────────────────────────────────

const SELECAO = Object.freeze({
  id: true,
  empresa_id: true,
  tipo_combustivel_id: true,
  produto_id: true,
  ativo: true,
  versao: true,
  createdAt: true,
  updatedAt: true,
  produto: { select: { id: true, empresa_id: true, nome_produto: true, codigo_interno: true, unidade_principal_estoque: true, ativo: true } },
});

/**
 * Forma pública do vínculo (sem tenant). `empresa_coerente=false` quando o
 * produto foi movido para outra fazenda (rastreável; nunca elegível).
 * @param {any} v
 */
export const comoVinculoPublico = (v) => ({
  id: v.id,
  empresa_id: v.empresa_id,
  tipo_combustivel_id: v.tipo_combustivel_id,
  ativo: v.ativo,
  versao: v.versao,
  produto: {
    id: v.produto.id,
    nome: v.produto.nome_produto,
    codigo_interno: v.produto.codigo_interno ?? null,
    unidade_principal_estoque: v.produto.unidade_principal_estoque,
    ativo: v.produto.ativo,
    empresa_coerente: v.produto.empresa_id === v.empresa_id,
  },
  created_date: iso(v.createdAt),
  updated_date: iso(v.updatedAt),
});

/** Auditoria por allowlist: identidades e situação (nunca o nome do produto). */
const paraAuditoria = (v) => ({
  id: v.id,
  empresa_id: v.empresa_id,
  tipo_combustivel_id: v.tipo_combustivel_id,
  produto_id: v.produto_id,
  ativo: v.ativo,
  versao: v.versao,
});

const buscar = (db, clienteId, empresaId, id) => db.tipoCombustivelProduto.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: SELECAO });

// ─── leituras travadas (mesma transação da escrita) ─────────────────────────

/**
 * Tipo do tenant com `FOR KEY SHARE` (a inativação do tipo trava a linha com
 * FOR UPDATE: as duas nunca se cruzam com estado velho). Ausente → 404.
 * @param {any} tx @param {string} clienteId @param {string} tipoId
 */
const tipoTravado = async (tx, clienteId, tipoId) => {
  const [tipo] = /** @type {Array<{id: string, ativo: boolean}>} */ (
    await tx.$queryRaw`SELECT id, ativo FROM "TipoCombustivel" WHERE cliente_id = ${clienteId} AND id = ${tipoId} FOR KEY SHARE`
  );
  if (!tipo) throw combustivelNaoEncontrado();
  return tipo;
};

/**
 * Produto elegível para vínculo ATIVO na empresa: lido com `FOR KEY SHARE`
 * (a exclusão e a troca de empresa do produto travam a linha com FOR UPDATE e
 * esperam este commit — ou este espera o delas e lê o estado novo).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} produtoId
 */
const exigirProdutoDaEmpresa = async (tx, clienteId, empresaId, produtoId) => {
  const [produto] = /** @type {Array<{id: string, empresa_id: string, ativo: boolean}>} */ (
    await tx.$queryRaw`SELECT id, empresa_id, ativo FROM "Produto" WHERE cliente_id = ${clienteId} AND id = ${produtoId} FOR KEY SHARE`
  );
  if (!produto) throw invalido('inexistente');
  if (produto.empresa_id !== empresaId) throw invalido('outra_empresa');
  if (!produto.ativo) throw invalido('inativo');
  return produto;
};

/**
 * Nenhum OUTRO vínculo ativo do produto na empresa (um produto, um combustível).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} produtoId @param {string|null} ignorarId
 */
const exigirSemOutroAtivo = async (tx, clienteId, empresaId, produtoId, ignorarId) => {
  const outro = await tx.tipoCombustivelProduto.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, produto_id: produtoId, ativo: true, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { tipo_combustivel_id: true },
  });
  if (outro) throw emOutroTipo(outro.tipo_combustivel_id);
};

/**
 * Corrida perdida num unique (barreira final; com a trava ela não deveria
 * acontecer): par repetido → DUPLICADO; outro ativo do produto → EM_OUTRO_TIPO
 * com o tipo que venceu (relido fora da transação desfeita).
 *
 * O `escopo` é preenchido DENTRO da transação (empresa validada, produto do
 * vínculo): por isso é lido aqui, na hora do erro, e nunca desestruturado na
 * chamada (valeria os '' iniciais e o details sairia vazio).
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ clienteId: string, empresaId: string, produtoId: string }} escopo
 * @returns {Promise<T>}
 */
const comUnicosDoVinculo = async (fn, escopo) => {
  try {
    return await fn();
  } catch (erro) {
    if (!ehViolacaoDeUnique(erro)) throw erro;
    const alvo = JSON.stringify(/** @type {any} */ (erro)?.meta?.target ?? '');
    if (alvo.includes('ativo_chave') || alvo.includes('produto_ativo')) {
      // Sem empresa/produto não há como achar o vencedor: o erro original sobe.
      if (!escopo.empresaId || !escopo.produtoId) throw erro;
      const vencedor = await getPrismaClient().tipoCombustivelProduto.findFirst({
        where: { cliente_id: escopo.clienteId, empresa_id: escopo.empresaId, produto_id: escopo.produtoId, ativo: true },
        select: { tipo_combustivel_id: true },
      });
      if (!vencedor) throw erro;
      throw emOutroTipo(vencedor.tipo_combustivel_id);
    }
    if (alvo.includes('tipo_combustivel_id') || alvo.includes('par_key')) throw duplicado();
    throw erro;
  }
};

const transacao = (fn) => emTransacao(TRANSACAO_CURTA, fn, {}, MENSAGEM_CONFLITO_SEM_CHAVE);

// ─── API ────────────────────────────────────────────────────────────────────

/**
 * Vínculos do tipo NA empresa (keyset createdAt desc, id desc). Tipo do
 * tenant (senão 404), empresa validada no tenant.
 * @param {any} contexto @param {string} tipoId @param {Record<string, any>} [query]
 */
export const listarDoTipo = async (contexto, tipoId, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const tipo = await prisma.tipoCombustivel.findFirst({ where: { cliente_id: auth.clienteId, id: tipoId }, select: { id: true } });
  if (!tipo) throw combustivelNaoEncontrado();
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId, empresa_id: empresaId, tipo_combustivel_id: tipo.id };
  const ativo = lerAtivo(query.ativo);
  if (ativo !== null) where.ativo = ativo;
  return listarKeyset(prisma.tipoCombustivelProduto, { where, busca: [], query, select: SELECAO, mapItem: comoVinculoPublico });
};

/**
 * Vincula um produto ATIVO da empresa ao tipo ATIVO. 201 com o vínculo.
 * @param {any} contexto @param {string} tipoId @param {{ empresa_id: string, produto_id: string }} entrada
 */
export const vincular = async (contexto, tipoId, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const produtoId = entrada.produto_id;
  /** @type {{ clienteId: string, empresaId: string, produtoId: string }} */
  const escopo = { clienteId: cli, empresaId: '', produtoId };
  return comUnicosDoVinculo(
    () =>
      transacao(async (tx) => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
        escopo.empresaId = empresaId;
        await travarEscopo(tx, chaveVinculo(cli, empresaId, produtoId));
        const tipo = await tipoTravado(tx, cli, tipoId);
        if (!tipo.ativo) throw invalido('tipo_inativo');
        await exigirProdutoDaEmpresa(tx, cli, empresaId, produtoId);
        const par = await tx.tipoCombustivelProduto.findFirst({
          where: { cliente_id: cli, empresa_id: empresaId, tipo_combustivel_id: tipo.id, produto_id: produtoId },
          select: { id: true, ativo: true },
        });
        if (par) throw par.ativo ? duplicado() : duplicadoInativo(par.id);
        await exigirSemOutroAtivo(tx, cli, empresaId, produtoId, null);
        const criado = await tx.tipoCombustivelProduto.create({
          data: { cliente_id: cli, empresa_id: empresaId, tipo_combustivel_id: tipo.id, produto_id: produtoId, ativo: true, ativo_chave: true },
          select: SELECAO,
        });
        await registrarEvento(contexto, { acao: 'create', entidade: ENTIDADE, entidadeId: criado.id, dadosNovos: paraAuditoria(criado) }, tx);
        return comoVinculoPublico(criado);
      }),
    escopo
  );
};

/**
 * Inativa ou reativa (só `ativo` muda; tipo, produto e empresa são imutáveis).
 * CAS por `versao`; sem mudança efetiva devolve o atual sem gravar. Reativar
 * exige as mesmas regras do POST.
 * @param {any} contexto @param {string} id @param {{ empresa_id: string, versao: number, ativo: boolean }} entrada
 */
export const alterarSituacao = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  /** @type {{ clienteId: string, empresaId: string, produtoId: string }} */
  const escopo = { clienteId: cli, empresaId: '', produtoId: '' };
  return comUnicosDoVinculo(
    () =>
      transacao(async (tx) => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
        // O produto do vínculo é imutável: a 1ª leitura dá a chave da trava;
        // a linha é relida com FOR UPDATE depois dela.
        const previa = await tx.tipoCombustivelProduto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, select: { produto_id: true } });
        if (!previa) throw naoEncontrado();
        Object.assign(escopo, { empresaId, produtoId: previa.produto_id });
        await travarEscopo(tx, chaveVinculo(cli, empresaId, previa.produto_id));
        await tx.$queryRaw`SELECT id FROM "TipoCombustivelProduto" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`;
        const antes = await buscar(tx, cli, empresaId, id);
        if (!antes) throw naoEncontrado();
        exigirVersao(antes, entrada.versao);
        if (entrada.ativo === antes.ativo) return comoVinculoPublico(antes);
        if (entrada.ativo) {
          const tipo = await tipoTravado(tx, cli, antes.tipo_combustivel_id);
          if (!tipo.ativo) throw invalido('tipo_inativo');
          await exigirProdutoDaEmpresa(tx, cli, empresaId, antes.produto_id);
          await exigirSemOutroAtivo(tx, cli, empresaId, antes.produto_id, id);
        }
        await atualizarComVersao(tx.tipoCombustivelProduto, {
          clienteId: cli,
          id,
          versao: entrada.versao,
          data: { ativo: entrada.ativo, ativo_chave: entrada.ativo ? true : null },
        });
        if (!entrada.ativo) await tx.tipoCombustivelProduto.updateMany({ where: { cliente_id: cli, tipo_combustivel_id: antes.tipo_combustivel_id, NOT: { empresa_id: empresaId }, ativo: true }, data: { ativo: false, ativo_chave: null, versao: { increment: 1 } } });
        const depois = await buscar(tx, cli, empresaId, id);
        await registrarEvento(
          contexto,
          { acao: 'update', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(antes), dadosNovos: { ...paraAuditoria(depois), campos_alterados: ['ativo'] } },
          tx
        );
        return comoVinculoPublico(depois);
      }),
    escopo
  );
};

/**
 * Opções do seletor "Vincular produto": produtos ATIVOS da empresa (busca por
 * nome ou código interno), keyset (nome, id) crescente, com o vínculo ATIVO
 * de cada um (o produto já ligado a outro tipo não pode ser escolhido).
 * @param {any} contexto @param {Record<string, any>} [query]
 */
export const opcoesProdutos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: cli, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome_produto: { contains: q, mode: 'insensitive' } }, { codigo_interno: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(prisma.produto, {
    where: { AND: filtros },
    campoNome: 'nome_produto',
    select: { id: true, nome_produto: true, unidade_principal_estoque: true },
    limit,
    cursor,
    mapear: async (linhas) => {
      const ativos = linhas.length
        ? await prisma.tipoCombustivelProduto.findMany({
            where: { cliente_id: cli, empresa_id: empresaId, ativo: true, produto_id: { in: linhas.map((l) => l.id) } },
            select: { produto_id: true, tipo_combustivel_id: true, tipoCombustivel: { select: { nome: true } } },
          })
        : [];
      const porProduto = new Map(ativos.map((v) => [v.produto_id, { tipo_combustivel_id: v.tipo_combustivel_id, tipo_nome: v.tipoCombustivel.nome }]));
      return linhas.map((l) => ({ id: l.id, nome: l.nome_produto, unidade_principal_estoque: l.unidade_principal_estoque, vinculo_ativo: porProduto.get(l.id) ?? null }));
    },
  });
};

const comparar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Contrato de LEITURA para a P1-02 (sem tela de abastecimento): produtos
 * elegíveis de cada tanque ATIVO do bem (ou só do `tanqueId`), pela
 * interseção: combustíveis permitidos no tanque (tipos ATIVOS) × vínculos
 * ATIVOS da empresa DO BEM × produtos ATIVOS cuja `empresa_id` é a do bem.
 * Sem vínculo → lista vazia (NUNCA "todos os produtos"). Sem preço, saldo ou
 * custo. Bem fora da empresa/tenant → 404; tanque de outro bem → 404; tanque
 * inativo informado → lista vazia.
 * @param {any} contexto
 * @param {{ empresaId: string, bemId: string, tanqueId?: string|null }} pedido
 * @returns {Promise<{ itens: Array<{ tanque_id: string, tanque_identificador: string, tipo_combustivel_id: string, tipo_combustivel_nome: string, produto_id: string, produto_nome: string, unidade_principal_estoque: string, empresa_id: string }> }>}
 */
export const produtosElegiveisDoBem = async (contexto, { empresaId: empresaPedida, bemId, tanqueId = null }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, empresaPedida);
  const bem = await prisma.bemPatrimonial.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: bemId }, select: { id: true, empresa_id: true } });
  if (!bem) throw bemNaoEncontrado();
  const tanques = await prisma.tanqueBem.findMany({
    where: { cliente_id: cli, bem_id: bem.id, ...(tanqueId ? { id: tanqueId } : { ativo: true }) },
    select: {
      id: true,
      identificador: true,
      ativo: true,
      combustiveis: { select: { combustivel: { select: { id: true, nome: true, ativo: true } } } },
    },
  });
  if (tanqueId && !tanques.length) throw tanqueNaoEncontrado();
  const ativos = tanques.filter((t) => t.ativo).sort((a, b) => comparar(a.identificador, b.identificador) || comparar(a.id, b.id));
  const tipoIds = [...new Set(ativos.flatMap((t) => t.combustiveis.filter((c) => c.combustivel.ativo).map((c) => c.combustivel.id)))];
  if (!tipoIds.length) return { itens: [] };
  const vinculos = await prisma.tipoCombustivelProduto.findMany({
    where: { cliente_id: cli, empresa_id: bem.empresa_id, ativo: true, tipo_combustivel_id: { in: tipoIds }, produto: { ativo: true, empresa_id: bem.empresa_id } },
    select: { tipo_combustivel_id: true, produto: { select: { id: true, nome_produto: true, unidade_principal_estoque: true, empresa_id: true, ativo: true } } },
  });
  /** @type {Map<string, Array<any>>} */
  const porTipo = new Map();
  for (const v of vinculos) {
    // Defesa em profundidade: a coerência de empresa é invariante do serviço; a leitura não confia nela.
    if (!v.produto.ativo || v.produto.empresa_id !== bem.empresa_id) continue;
    const lista = porTipo.get(v.tipo_combustivel_id) ?? [];
    lista.push(v.produto);
    porTipo.set(v.tipo_combustivel_id, lista);
  }
  const itens = [];
  for (const tanque of ativos) {
    const tipos = tanque.combustiveis
      .map((c) => c.combustivel)
      .filter((c) => c.ativo)
      .sort((a, b) => comparar(a.nome, b.nome) || comparar(a.id, b.id));
    for (const tipo of tipos) {
      const produtos = [...(porTipo.get(tipo.id) ?? [])].sort((a, b) => comparar(a.nome_produto, b.nome_produto) || comparar(a.id, b.id));
      for (const p of produtos) {
        itens.push({
          tanque_id: tanque.id,
          tanque_identificador: tanque.identificador,
          tipo_combustivel_id: tipo.id,
          tipo_combustivel_nome: tipo.nome,
          produto_id: p.id,
          produto_nome: p.nome_produto,
          unidade_principal_estoque: p.unidade_principal_estoque,
          empresa_id: bem.empresa_id,
        });
      }
    }
  }
  return { itens };
};
