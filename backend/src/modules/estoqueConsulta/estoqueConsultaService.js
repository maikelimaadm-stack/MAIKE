/**
 * D-PROD-255 (Estoque E1 + E2, P1-04) — consultas SOMENTE LEITURA do estoque.
 *
 *  - `saldo`: produto × depósito, derivado das CAMADAS (`EstoqueLoteNota`,
 *    status 'Disponivel'), a única fonte de saldo do motor (D-PROD-161). Nada é
 *    lido do cache `Produto.estoque_atual`. Quantidade na unidade de estoque do
 *    Produto ('L' para Produto em L; 'KG' para o resto, SACO incluso, que guarda
 *    kg). Custo = `Σ(disponível × custo da camada) ÷ Σ(disponível)`: custo
 *    médio PONDERADO das camadas que restam, só informativo (o motor continua
 *    FIFO por camada; custo médio como regra é decisão futura, D-PROD-255).
 *    Valor = `Σ(disponível × custo da camada)`. Decimais sempre como texto.
 *  - `movimentos`: kardex paginado por keyset `(data_movimentacao DESC, id DESC)`
 *    sobre o índice `MovimentacaoEstoque_keyset_empresa_idx` (D-PROD-185), com
 *    cursor ASSINADO (`estoqueConsultaCursor.js`).
 *  - `movimento`: detalhe de um movimento (saldo antes/depois, custo, camadas
 *    consumidas, documento de origem, par original ↔ estorno).
 *  - opções de filtro (produtos e depósitos).
 *
 * O tenant vem SEMPRE do `auth_context`; `empresa_id` é obrigatória e conferida
 * contra o tenant (`exigirEmpresaDoTenant`). Nada é escrito, nem auditado.
 */
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, textoDeBusca } from '../gestao/gestaoComum.js';
import { ehDiaValido, paginacaoOpcoes, paginarPorNome } from '../patrimonio/patrimonioComum.js';
import { escaparCuringasLike } from '../usuarios/usuarioRepository.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { codificarCursorConsulta, decodificarCursorConsulta } from './estoqueConsultaCursor.js';

export const LIMITE_CONSULTA_PADRAO = LIMITE_PADRAO;
export const LIMITE_CONSULTA_MAXIMO = LIMITE_MAXIMO;

const LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

/** `origem_sistema` do motor: minúsculas e `_` (a lista de origens é do motor; origem sem movimento só devolve vazio). */
const ORIGEM_VALIDA = /^[a-z_]{1,32}$/;

/** Unidade em que o motor expressa a quantidade do Produto: L para L; KG para o resto (SACO guarda kg). */
export const unidadeDeEstoque = (unidadePrincipal) => (unidadePrincipal === 'L' ? 'L' : 'KG');

const texto = (valor, casas) => dec(valor ?? 0).toFixed(casas);
const textoOuNulo = (valor, casas) => (valor === null || valor === undefined ? null : dec(valor).toFixed(casas));
const instante = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
const dia = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null);

const limiteDe = (bruto) => {
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 1) return LIMITE_CONSULTA_PADRAO;
  return Math.min(n, LIMITE_CONSULTA_MAXIMO);
};

/** Busca literal (`%`/`_`/`\` escapados) para ILIKE; '' = sem busca. */
const buscaLiteral = (q) => escaparCuringasLike(textoDeBusca(q));

const exigirPeriodo = (de, ate) => {
  for (const [campo, valor] of [['data_de', de], ['data_ate', ate]]) {
    if (valor !== undefined && valor !== null && valor !== '' && !ehDiaValido(valor)) {
      throw invalido(`${campo} não é uma data válida (AAAA-MM-DD)`, { field: campo, reason: 'data_invalida' });
    }
  }
  if (de && ate && de > ate) throw invalido('o período está invertido: data_de é posterior a data_ate', { field: 'data_ate', reason: 'periodo_invertido' });
};

// ─── saldo (E1) ─────────────────────────────────────────────────────────────

/**
 * @param {any} contexto
 * @param {{ empresa_id?: string, produto_id?: string, local_estoque_id?: string, q?: string, somente_com_saldo?: boolean|string, limit?: number|string, cursor?: string }} query
 */
export const saldo = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const limite = limiteDe(query.limit);
  const somenteComSaldo = !(query.somente_com_saldo === false || query.somente_com_saldo === 'false');
  const q = buscaLiteral(query.q);
  const produtoId = query.produto_id || null;
  const localId = query.local_estoque_id || null;

  const amarra = ['saldo', cli, empresaId, produtoId, localId, q, somenteComSaldo, limite];
  const posicao = query.cursor ? decodificarCursorConsulta(query.cursor, amarra) : null;
  if (posicao && (posicao.length !== 4 || posicao.some((v) => typeof v !== 'string'))) {
    throw invalido('cursor inválido; recomece a consulta sem cursor', { field: 'cursor', reason: 'cursor_invalido' });
  }

  const camadas = Prisma.sql`
    SELECT c.produto_id, c.local_estoque_id AS local_id,
           SUM(c.quantidade_disponivel) AS quantidade,
           SUM(c.quantidade_disponivel * c.custo_unitario) AS valor,
           COUNT(*) FILTER (WHERE c.quantidade_disponivel > 0) AS camadas
      FROM "EstoqueLoteNota" c
     WHERE c.cliente_id = ${cli} AND c.empresa_id = ${empresaId}
       AND c.status IN ('Disponivel', 'Esgotado')
       ${produtoId ? Prisma.sql`AND c.produto_id = ${produtoId}` : Prisma.empty}
       ${localId ? Prisma.sql`AND c.local_estoque_id = ${localId}` : Prisma.empty}
     GROUP BY c.produto_id, c.local_estoque_id
     ${somenteComSaldo ? Prisma.sql`HAVING SUM(c.quantidade_disponivel) > 0` : Prisma.empty}`;
  const busca = q
    ? Prisma.sql`AND (p.nome_produto ILIKE ${`%${q}%`} OR p.codigo_interno ILIKE ${`%${q}%`} OR l.nome ILIKE ${`%${q}%`})`
    : Prisma.empty;
  const juncao = Prisma.sql`
      FROM (${camadas}) g
      JOIN "Produto" p ON p.cliente_id = ${cli} AND p.id = g.produto_id
      JOIN "LocalEstoque" l ON l.cliente_id = ${cli} AND l.id = g.local_id
     WHERE TRUE ${busca}`;

  const [contagem, linhas] = await emTransacao(LEITURA, async (tx) => {
    const c = await tx.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS total ${juncao}`);
    const l = await tx.$queryRaw(Prisma.sql`
      SELECT g.produto_id, g.local_id, g.quantidade, g.valor, g.camadas,
             p.nome_produto, p.codigo_interno, p.unidade_principal_estoque, l.nome AS local_nome
        ${juncao}
        ${posicao ? Prisma.sql`AND (p.nome_produto, l.nome, g.produto_id, g.local_id) > (${posicao[0]}, ${posicao[1]}, ${posicao[2]}, ${posicao[3]})` : Prisma.empty}
       ORDER BY p.nome_produto, l.nome, g.produto_id, g.local_id
       LIMIT ${limite + 1}`);
    return [c, l];
  });

  const total = Number(/** @type {any[]} */ (contagem)[0]?.total ?? 0);
  const brutas = /** @type {any[]} */ (linhas);
  const temMais = brutas.length > limite;
  const pagina = temMais ? brutas.slice(0, limite) : brutas;
  const ultimo = pagina[pagina.length - 1];
  return {
    items: pagina.map((r) => {
      const quantidade = dec(r.quantidade ?? 0);
      const valor = dec(r.valor ?? 0);
      return {
        chave: `${r.produto_id}:${r.local_id}`,
        produto_id: r.produto_id,
        produto_nome: r.nome_produto,
        produto_codigo: r.codigo_interno ?? null,
        local_estoque_id: r.local_id,
        local_estoque_nome: r.local_nome,
        unidade: unidadeDeEstoque(r.unidade_principal_estoque),
        quantidade: quantidade.toFixed(CASAS_QUANTIDADE),
        custo_medio: quantidade.gt(0) ? valor.div(quantidade).toFixed(CASAS_CUSTO) : null,
        valor: valor.toFixed(CASAS_CUSTO),
        camadas: Number(r.camadas ?? 0),
      };
    }),
    next_cursor: temMais && ultimo ? codificarCursorConsulta(amarra, [ultimo.nome_produto, ultimo.local_nome, ultimo.produto_id, ultimo.local_id]) : null,
    has_more: temMais,
    total,
    limit: limite,
  };
};

// ─── movimentos (E2, P1-04) ─────────────────────────────────────────────────

const comoMovimentoResumo = (m) => ({
  id: m.id,
  numero: m.numero_movimentacao,
  data: dia(m.data_movimentacao),
  tipo: m.tipo_movimentacao,
  tipo_detalhado: m.tipo_detalhado ?? null,
  origem_sistema: m.origem_sistema,
  status: m.status,
  estorno: typeof m.tipo_detalhado === 'string' && m.tipo_detalhado.startsWith('estorno'),
  produto_id: m.produto_id,
  produto_nome: m.produto_nome ?? null,
  produto_codigo: m.produto_codigo ?? null,
  quantidade: texto(m.quantidade, CASAS_QUANTIDADE),
  unidade: m.unidade_medida,
  valor_unitario: textoOuNulo(m.valor_unitario, CASAS_CUSTO),
  valor_total: textoOuNulo(m.valor_total, CASAS_CUSTO),
  local_origem_id: m.local_estoque_origem ?? null,
  local_origem: m.local_origem ?? null,
  local_destino_id: m.local_estoque_destino ?? null,
  local_destino: m.local_destino ?? null,
  saldo_antes: textoOuNulo(m.saldo_antes, CASAS_QUANTIDADE),
  saldo_depois: textoOuNulo(m.saldo_depois, CASAS_QUANTIDADE),
  movimento_pai_id: m.movimento_pai_id ?? null,
  movimento_filho_id: m.movimento_filho_id ?? null,
});

/** Campos lidos na listagem (nada de JSON de camadas nem observações). */
const SELECT_RESUMO = Object.freeze({
  id: true, numero_movimentacao: true, data_movimentacao: true, tipo_movimentacao: true, tipo_detalhado: true, origem_sistema: true,
  status: true, produto_id: true, produto_nome: true, produto_codigo: true, quantidade: true, unidade_medida: true, valor_unitario: true,
  valor_total: true, local_estoque_origem: true, local_origem: true, local_estoque_destino: true, local_destino: true, saldo_antes: true,
  saldo_depois: true, movimento_pai_id: true, movimento_filho_id: true,
});

/**
 * @param {any} contexto
 * @param {{ empresa_id?: string, produto_id?: string, local_estoque_id?: string, origem_sistema?: string, tipo_movimentacao?: string,
 *   data_de?: string, data_ate?: string, q?: string, limit?: number|string, cursor?: string }} query
 */
export const movimentos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const limite = limiteDe(query.limit);
  const de = query.data_de || null;
  const ate = query.data_ate || null;
  exigirPeriodo(de, ate);
  if (query.origem_sistema && !ORIGEM_VALIDA.test(query.origem_sistema)) {
    throw invalido('origem_sistema desconhecida', { field: 'origem_sistema', reason: 'origem_desconhecida' });
  }
  const q = buscaLiteral(query.q);

  const amarra = ['movimentos', cli, empresaId, query.produto_id ?? null, query.local_estoque_id ?? null, query.origem_sistema ?? null,
    query.tipo_movimentacao ?? null, de, ate, q, limite];
  const posicao = query.cursor ? decodificarCursorConsulta(query.cursor, amarra) : null;
  const cursorData = posicao && posicao.length === 2 && typeof posicao[0] === 'string' && typeof posicao[1] === 'string' ? new Date(posicao[0]) : null;
  if (posicao && (!cursorData || Number.isNaN(cursorData.getTime()))) {
    throw invalido('cursor inválido; recomece a consulta sem cursor', { field: 'cursor', reason: 'cursor_invalido' });
  }

  /** @type {any[]} */
  const AND = [];
  if (query.produto_id) AND.push({ produto_id: query.produto_id });
  if (query.local_estoque_id) AND.push({ OR: [{ local_estoque_origem: query.local_estoque_id }, { local_estoque_destino: query.local_estoque_id }] });
  if (query.origem_sistema) AND.push({ origem_sistema: query.origem_sistema });
  if (query.tipo_movimentacao) AND.push({ tipo_movimentacao: query.tipo_movimentacao });
  if (de || ate) {
    AND.push({
      data_movimentacao: {
        ...(de ? { gte: new Date(`${de}T00:00:00.000Z`) } : {}),
        ...(ate ? { lt: new Date(new Date(`${ate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000) } : {}),
      },
    });
  }
  if (q) {
    AND.push({
      OR: [
        { numero_movimentacao: { contains: q, mode: 'insensitive' } },
        { produto_nome: { contains: q, mode: 'insensitive' } },
        { numero_documento: { contains: q, mode: 'insensitive' } },
        { motivo_movimentacao: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  const where = { cliente_id: cli, empresa_id: empresaId, ...(AND.length ? { AND } : {}) };
  const comCursor = cursorData
    ? { ...where, AND: [...AND, { OR: [{ data_movimentacao: { lt: cursorData } }, { AND: [{ data_movimentacao: cursorData }, { id: { lt: /** @type {string} */ (posicao?.[1]) } }] }] }] }
    : where;

  const [total, registros] = await emTransacao(LEITURA, async (tx) => [
    await tx.movimentacaoEstoque.count({ where }),
    await tx.movimentacaoEstoque.findMany({
      where: comCursor,
      orderBy: [{ data_movimentacao: 'desc' }, { id: 'desc' }],
      take: limite + 1,
      select: SELECT_RESUMO,
    }),
  ]);
  const temMais = registros.length > limite;
  const pagina = temMais ? registros.slice(0, limite) : registros;
  const ultimo = pagina[pagina.length - 1];
  return {
    items: pagina.map(comoMovimentoResumo),
    next_cursor: temMais && ultimo ? codificarCursorConsulta(amarra, [instante(ultimo.data_movimentacao), ultimo.id]) : null,
    has_more: temMais,
    total,
    limit: limite,
  };
};

/** Documento de origem do movimento (para o link da tela), pela FK do documento ou pelo vínculo do motor. */
const documentoDeOrigem = async (tx, cli, m) => {
  const porMovimento = { OR: [{ movimentacao_estoque_id: m.id }, { movimentacao_estorno_id: m.id }] };
  if (m.origem_sistema === 'operacao_financeira') {
    const item = await tx.operacaoFinanceiraItem.findFirst({
      where: { cliente_id: cli, ...porMovimento },
      select: { operacao: { select: { id: true, numero: true, descricao: true, parceiro_nome: true } } },
    });
    return item ? { tipo: 'LANCAMENTO_FINANCEIRO', id: item.operacao.id, numero: item.operacao.numero, rotulo: `Lançamento nº ${item.operacao.numero}`, pagina: 'LancamentosFinanceiros' } : null;
  }
  if (m.origem_sistema === 'abastecimento_patrimonio') {
    const ab = await tx.abastecimentoBem.findFirst({ where: { cliente_id: cli, ...porMovimento }, select: { id: true, numero: true } });
    return ab ? { tipo: 'ABASTECIMENTO', id: ab.id, numero: ab.numero, rotulo: `Abastecimento nº ${ab.numero}`, pagina: 'Abastecimentos' } : null;
  }
  if (m.origem_sistema === 'apontamento_atividade') {
    const linha = await tx.atividadeApontamentoProduto.findFirst({
      where: { cliente_id: cli, ...porMovimento },
      select: { apontamento: { select: { id: true, atividade: { select: { id: true, numero: true, nome: true } } } } },
    });
    const a = linha?.apontamento?.atividade;
    return a ? { tipo: 'ATIVIDADE', id: a.id, numero: a.numero, rotulo: `Atividade nº ${a.numero} — ${a.nome}`, pagina: 'LancamentoAtividades' } : null;
  }
  return null;
};

const comoParente = (m) =>
  m ? { id: m.id, numero: m.numero_movimentacao, tipo: m.tipo_movimentacao, tipo_detalhado: m.tipo_detalhado ?? null, status: m.status, data: dia(m.data_movimentacao), quantidade: texto(m.quantidade, CASAS_QUANTIDADE), unidade: m.unidade_medida } : null;

/**
 * @param {any} contexto
 * @param {string} id
 * @param {{ empresa_id?: string }} query
 */
export const movimento = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const m = await tx.movimentacaoEstoque.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id } });
    if (!m) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'MovimentacaoEstoque não encontrado');
    const ids = [m.movimento_pai_id, m.movimento_filho_id].filter(Boolean);
    const parentes = ids.length
      ? await tx.movimentacaoEstoque.findMany({ where: { cliente_id: cli, empresa_id: empresaId, id: { in: /** @type {string[]} */ (ids) } }, select: { ...SELECT_RESUMO } })
      : [];
    const parente = (pid) => comoParente(parentes.find((p) => p.id === pid));
    const consumidas = Array.isArray(m.lotes_consumidos) ? /** @type {any[]} */ (m.lotes_consumidos) : [];
    const loteIds = [...new Set(consumidas.map((f) => f?.lote_id).filter((v) => typeof v === 'string'))];
    const lotes = loteIds.length
      ? await tx.estoqueLoteNota.findMany({ where: { cliente_id: cli, empresa_id: empresaId, id: { in: loteIds } }, select: { id: true, numero_documento: true, fornecedor_nome: true, data_documento: true } })
      : [];
    const documento = await documentoDeOrigem(tx, cli, m);
    const unidade = m.unidade_medida;
    return {
      ...comoMovimentoResumo(m),
      custo_medio_antes: textoOuNulo(m.custo_medio_antes, CASAS_CUSTO),
      custo_medio_depois: textoOuNulo(m.custo_medio_depois, CASAS_CUSTO),
      motivo: m.motivo_movimentacao ?? null,
      observacoes: m.observacoes ?? null,
      responsavel: m.usuario_responsavel ?? m.responsavel ?? null,
      fornecedor_nome: m.fornecedor_nome ?? null,
      tipo_documento: m.tipo_documento ?? null,
      numero_documento: m.numero_documento ?? null,
      data_documento: dia(m.data_documento),
      vinculos: {
        area: m.area_vinculada_nome ?? null,
        lote: m.lote_vinculado_nome ?? null,
        maquina: m.maquina_vinculada_nome ?? null,
        centro_custo: m.centro_custo_nome ?? null,
        safra: m.safra_nome ?? null,
      },
      documento,
      camadas_consumidas: consumidas.map((f) => {
        const lote = lotes.find((l) => l.id === f?.lote_id);
        return {
          lote_id: f?.lote_id ?? null,
          quantidade: textoOuNulo(f?.quantidade, CASAS_QUANTIDADE),
          custo_unitario: textoOuNulo(f?.custo_unitario, CASAS_CUSTO),
          numero_documento: lote?.numero_documento ?? null,
          fornecedor_nome: lote?.fornecedor_nome ?? null,
          data_documento: dia(lote?.data_documento),
          unidade,
        };
      }),
      pai: m.movimento_pai_id ? parente(m.movimento_pai_id) : null,
      filho: m.movimento_filho_id ? parente(m.movimento_filho_id) : null,
      criado_em: instante(m.createdAt),
    };
  });
};

// ─── opções dos filtros ─────────────────────────────────────────────────────

/** Produtos da empresa (filtro de produto): `{itens, has_more, next_cursor}`, por nome. */
export const opcoesProdutos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: cli, empresa_id: empresaId }];
  if (q) filtros.push({ OR: [{ nome_produto: { contains: q, mode: 'insensitive' } }, { codigo_interno: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(prisma.produto, {
    where: { AND: filtros },
    campoNome: 'nome_produto',
    select: { id: true, nome_produto: true, codigo_interno: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((p) => ({ id: p.id, nome: p.nome_produto, codigo: p.codigo_interno ?? null })),
  });
};

/** Depósitos (locais de estoque) do tenant: `{itens, has_more, next_cursor}`. */
export const opcoesLocais = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId }];
  if (q) filtros.push({ nome: { contains: q, mode: 'insensitive' } });
  return paginarPorNome(prisma.localEstoque, {
    where: { AND: filtros },
    campoNome: 'nome',
    select: { id: true, nome: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((l) => ({ id: l.id, nome: l.nome })),
  });
};

