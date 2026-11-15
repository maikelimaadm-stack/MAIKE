/**
 * Opções dos seletores PRÓPRIOS da tela Lançamento de Atividades (D-PROD-200,
 * contrato §10): quem só tem a tela `op-atividades` não leva 403 das telas de
 * bens ou de usuários. Mesmo formato das opções do apontamento antigo
 * (`opcoesBens`, `opcoesResponsaveis`): só ATIVOS, keyset (nome, id)
 * crescente, busca literal no servidor e envelope `{ itens, has_more,
 * next_cursor }` (limite padrão 50, máx. 100). `empresa_id` é obrigatório e
 * conferido no tenant da sessão.
 *
 * A opção de máquina é só o resumo do bem (`bemPublico`): o centro de custo
 * do cadastro do bem não vai junto, porque na Fatia 2 os centros da atividade
 * vêm do TIPO (snapshot na abertura), nunca do bem.
 *
 * Tipos, áreas e tarefas reusam as rotas que já existem e só pedem login
 * (`/tipos-atividade`, `/areas-pastagem`, `/lancamentos-tarefa`).
 *
 * D-PROD-202 (Fatia 3): os seletores da LINHA DE PRODUTO — produtos (os já
 * usados na atividade primeiro) e locais com saldo —, com a lógica dos
 * seletores do financeiro e do abastecimento, mas com a guarda "ver" desta tela.
 *
 * D-PROD-207 (Fatia 4): os seletores das linhas de MÃO DE OBRA (funcionários)
 * e de SERVIÇO (serviços e parceiros prestadores de serviço).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError, atividadeNotFound } from '../../shared/errors/AppError.js';
import { ZERO, dec } from '../financeiro/decimalFinanceiro.js';
import { lerPapeis } from '../fornecedores/fornecedorDominio.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { opcoesResponsaveis } from '../patrimonio/bemPatrimonialOpcoesService.js';
import { paginacaoOpcoes, paginarPorNome } from '../patrimonio/patrimonioComum.js';
import { UNIDADES_PRODUTO_TANQUE, unidadeEfetivaDoEstoque } from '../patrimonio/patrimonioDominio.js';
import { bemPublico, t4 } from './atividadeComum.js';
import { produtosUsadosNaAtividade } from './atividadeApontamentoProdutoRepository.js';
import { paginarBensAtivos } from './atividadeRepository.js';
import { PAPEL_PRESTADOR } from './atividadeApontamentoServicoService.js';

/**
 * Máquinas ATIVAS da empresa (`GET /atividades-opcoes/bens`); `natureza`
 * filtra (uma ou várias); `q` em nome, número ou código de frota.
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesBens = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  const naturezas = Array.isArray(query.natureza) ? query.natureza : typeof query.natureza === 'string' ? [query.natureza] : [];
  return paginarBensAtivos({ clienteId: auth.clienteId, empresaId, naturezas, q, limit, cursor, mapear: (linhas) => linhas.map(bemPublico) });
};

/**
 * Operadores (`GET /atividades-opcoes/operadores`): usuários ATIVOS do tenant,
 * só `{ id, nome }` (o login é credencial e nunca sai); a empresa é só escopo.
 */
export const opcoesOperadores = opcoesResponsaveis;

// ─── D-PROD-202: seletores da linha de produto ──────────────────────────────

/** Ordem estável por texto (o mesmo comparador dos seletores do abastecimento). */
const comparar = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Produtos que a linha aceita: ATIVOS da fazenda, com unidade de estoque L, KG
 * ou SACO, e que NÃO são combustível (sem aceite que vale: ativo, em tanque
 * ativo de bem ativo — combustível vai pelo abastecimento). É o mesmo critério
 * do serviço da linha: o que não aparece aqui seria recusado lá.
 * @param {string} clienteId @param {string} empresaId
 */
const produtosAceitos = (clienteId, empresaId) => ({
  cliente_id: clienteId,
  empresa_id: empresaId,
  ativo: true,
  unidade_principal_estoque: { in: [...UNIDADES_PRODUTO_TANQUE] },
  tanquesAceitos: { none: { ativo: true, tanque: { ativo: true, bem: { ativo: true } } } },
});

const SELECT_PRODUTO = Object.freeze({ id: true, numero_produto: true, nome_produto: true, unidade_principal_estoque: true, estoque_atual: true });

/** @param {any} p @param {boolean} favorito */
const opcaoDeProduto = (p, favorito) => ({
  id: p.id,
  numero: p.numero_produto,
  nome: p.nome_produto,
  unidade: unidadeEfetivaDoEstoque(p.unidade_principal_estoque),
  unidade_principal_estoque: p.unidade_principal_estoque,
  estoque_atual: t4(p.estoque_atual),
  favorito,
});

/**
 * `GET /atividades-opcoes/produtos?empresa_id=&atividade_id=&q=&cursor=&limit=`:
 * produtos aceitos pela linha, em keyset (nome, id). Com `atividade_id` (da
 * MESMA fazenda; senão 404 `ATIVIDADE_NOT_FOUND`), os já usados em linhas
 * confirmadas dela vêm PRIMEIRO na primeira página (`favorito: true`, do mais
 * usado ao menos usado) e saem das páginas seguintes, sem repetir. Envelope
 * `{ itens, has_more, next_cursor }`; `unidade` = a efetiva do estoque (L | KG).
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesProdutos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {string[]} */
  let favoritosIds = [];
  if (typeof query.atividade_id === 'string' && query.atividade_id) {
    const atividade = await prisma.atividade.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: query.atividade_id }, select: { id: true } });
    if (!atividade) throw atividadeNotFound();
    favoritosIds = await produtosUsadosNaAtividade(prisma, cli, empresaId, atividade.id);
  }
  // `q` já vem escapado por `paginacaoOpcoes` (busca literal: `%`/`_` não são curingas).
  const termo = q || null;
  /** @type {any[]} */
  const busca = termo
    ? [{ OR: [{ nome_produto: { contains: termo, mode: 'insensitive' } }, { numero_produto: { contains: termo } }, { codigo_interno: { contains: termo, mode: 'insensitive' } }] }]
    : [];
  const aceitos = produtosAceitos(cli, empresaId);
  /** @type {any[]} */
  let favoritos = [];
  if (favoritosIds.length && !cursor) {
    const lidos = await prisma.produto.findMany({ where: { AND: [aceitos, { id: { in: favoritosIds } }, ...busca] }, select: SELECT_PRODUTO });
    const posicao = new Map(favoritosIds.map((id, i) => [id, i]));
    favoritos = lidos.sort((a, b) => /** @type {number} */ (posicao.get(a.id)) - /** @type {number} */ (posicao.get(b.id))).map((p) => opcaoDeProduto(p, true));
  }
  const pagina = await paginarPorNome(prisma.produto, {
    where: { AND: [aceitos, ...(favoritosIds.length ? [{ id: { notIn: favoritosIds } }] : []), ...busca] },
    campoNome: 'nome_produto',
    select: SELECT_PRODUTO,
    limit,
    cursor,
    mapear: (linhas) => linhas.map((p) => opcaoDeProduto(p, false)),
  });
  return { ...pagina, itens: [...favoritos, ...pagina.itens] };
};

/**
 * `GET /atividades-opcoes/locais?empresa_id=&produto_id=`: locais ATIVOS com
 * saldo (lotes Disponível > 0) do produto NA fazenda, por nome. `disponivel`
 * na unidade EFETIVA do estoque (`unidade`: L ou KG; SACO → KG). Produto de
 * outra fazenda ou tenant → 404 `PRODUTO_NOT_FOUND` (sem oráculo).
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesLocaisDoProduto = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const produto = await prisma.produto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: String(query.produto_id) }, select: { id: true, unidade_principal_estoque: true } });
  if (!produto) {
    throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado nesta fazenda', { details: { field: 'produto_id', reason: 'produto_nao_encontrado' } });
  }
  const grupos = await prisma.estoqueLoteNota.groupBy({
    by: ['local_estoque_id'],
    where: { cliente_id: cli, empresa_id: empresaId, produto_id: produto.id, status: 'Disponivel', quantidade_disponivel: { gt: 0 } },
    _sum: { quantidade_disponivel: true },
  });
  const ids = grupos.map((g) => g.local_estoque_id).filter((v) => typeof v === 'string');
  const locais = ids.length ? await prisma.localEstoque.findMany({ where: { cliente_id: cli, id: { in: ids }, ativo: true }, select: { id: true, nome: true } }) : [];
  const saldo = new Map(grupos.map((g) => [g.local_estoque_id, g._sum.quantidade_disponivel]));
  const unidade = unidadeEfetivaDoEstoque(produto.unidade_principal_estoque) ?? produto.unidade_principal_estoque;
  return {
    itens: locais
      .sort((a, b) => comparar(a.nome, b.nome) || comparar(a.id, b.id))
      .map((l) => ({
        local_estoque_id: l.id,
        local_nome: l.nome,
        disponivel: dec(saldo.get(l.id) ?? ZERO).toFixed(4),
        unidade,
        unidade_principal_estoque: produto.unidade_principal_estoque,
      })),
  };
};

// ─── D-PROD-207 (Fatia 4): seletores das linhas de mão de obra e de serviço ──

/**
 * `GET /atividades-opcoes/funcionarios?empresa_id=&q=&cursor=&limit=`:
 * funcionários ATIVOS da fazenda, keyset (nome, id), `q` em nome, número ou
 * cargo. Cada opção: `{ id, numero, nome, cargo, tipo, custo_hora, custo_diaria }`
 * (custos como texto com 4 casas, ou nulos).
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesFuncionarios = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }, { cargo: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(prisma.funcionario, {
    where: { AND: filtros },
    select: { id: true, numero: true, nome: true, cargo: true, tipo: true, custo_hora: true, custo_diaria: true },
    limit,
    cursor,
    mapear: (linhas) =>
      linhas.map((f) => ({ id: f.id, numero: f.numero, nome: f.nome, cargo: f.cargo ?? null, tipo: f.tipo, custo_hora: t4(f.custo_hora), custo_diaria: t4(f.custo_diaria) })),
  });
};

/**
 * `GET /atividades-opcoes/servicos?empresa_id=&q=&cursor=&limit=`: serviços
 * ATIVOS da fazenda, keyset (nome, id), `q` em nome ou número. Cada opção:
 * `{ id, numero, nome, unidade, valor_referencia }` (`unidade` = sigla da
 * unidade de medida do serviço; `valor_referencia` texto com 4 casas ou nulo).
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesServicos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }] });
  return paginarPorNome(prisma.servico, {
    where: { AND: filtros },
    select: { id: true, numero: true, nome: true, valor_referencia: true, unidadeMedida: { select: { sigla: true } } },
    limit,
    cursor,
    mapear: (linhas) =>
      linhas.map((s) => ({ id: s.id, numero: s.numero, nome: s.nome, unidade: s.unidadeMedida?.sigla ?? null, valor_referencia: t4(s.valor_referencia) })),
  });
};

/**
 * `GET /atividades-opcoes/parceiros-servico?empresa_id=&q=&cursor=&limit=`:
 * parceiros ATIVOS da fazenda com o papel `prestador_servico` (pelas grafias
 * gravadas, a mesma normalização de `lerPapeis`; `tipos` vazio NÃO entra: a
 * linha exige o papel). Só `{ id, nome }` — nada de documento; o `q` casa só
 * o `nome`.
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesParceirosServico = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  const gravadas = /** @type {Array<{ t: string }>} */ (
    await prisma.$queryRaw`SELECT DISTINCT unnest(tipos) AS t FROM "Fornecedor" WHERE cliente_id = ${auth.clienteId} AND empresa_id = ${empresaId}`
  );
  const grafias = gravadas.map((l) => l.t).filter((t) => typeof t === 'string' && lerPapeis([t]).papeis.includes(PAPEL_PRESTADOR));
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, empresa_id: empresaId, ativo: true }, grafias.length ? { tipos: { hasSome: grafias } } : { id: { in: [] } }];
  // O `q` casa SÓ o nome (o que a opção mostra): razão social e número de cadastro não saem na resposta e não
  // servem de busca (nenhuma opção aparece por um campo que o operador não vê, e nada vira oráculo deles).
  if (q) filtros.push({ nome: { contains: q, mode: 'insensitive' } });
  return paginarPorNome(prisma.fornecedor, {
    where: { AND: filtros },
    select: { id: true, nome: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((p) => ({ id: p.id, nome: p.nome })),
  });
};
