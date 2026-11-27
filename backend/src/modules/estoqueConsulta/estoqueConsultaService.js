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
 *    cursor ASSINADO (`estoqueConsultaCursor.js`). D-PROD-273 (fatia 2): o par excluído (original 'Estornada' +
 *    estorno) sai por padrão (`incluir_excluidos` o traz, com `excluido: true`) e o saldo exibido desconta os
 *    excluídos (`ajustesDeSaldoSemExcluidos`).
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
import { unidadePublica } from '../produtos/unidadeLancamento.js';
import { unidadeEstoqueEfetiva } from '../produtos/produtoUnidadesConversao.js';
import { ORIGEM_SAIDA_ESTOQUE, loteVencido, lotesFifo, ordenarFefo } from '../estoqueFisico/estoqueFisicoMotor.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { MARCA_EXCLUSAO_RECALCULO } from '../estoqueRecalculo/estoqueReplay.js';
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

/**
 * Unidade em que o motor expressa a quantidade do Produto (D-PROD-371): a unidade de estoque dele (KG, L, SC, UN...);
 * KG para o SACO legado (guarda kg) e para o vazio.
 */
export const unidadeDeEstoque = (unidadePrincipal) => unidadeEstoqueEfetiva({ unidade_principal_estoque: unidadePrincipal });

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
             p.nome_produto, p.codigo_interno, p.unidade_principal_estoque, p.controla_lote, p.controla_validade, l.nome AS local_nome
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
        // D-PROD-282: o produto controla lote (a tela abre o detalhe por lote, com validade).
        controla_lote: r.controla_lote === true,
        controla_validade: r.controla_validade === true,
      };
    }),
    next_cursor: temMais && ultimo ? codificarCursorConsulta(amarra, [ultimo.nome_produto, ultimo.local_nome, ultimo.produto_id, ultimo.local_id]) : null,
    has_more: temMais,
    total,
    limit: limite,
  };
};

// ─── lotes disponíveis (D-PROD-282) ─────────────────────────────────────────

/** D-PROD-282: aviso "vence em até N dias" na tela (a regra é só de exibição). */
export const DIAS_AVISO_VENCIMENTO = 30;

/**
 * D-PROD-282 — lotes (camadas Disponivel com saldo) de um produto num depósito, JÁ NA ORDEM FEFO (a sugestão da
 * saída): validade, saldo, custo da camada (o custo da nota, no produto com lote), vencido e dias até vencer, pelo dia
 * de hoje da fazenda. Somente leitura; tenant de `auth_context`; produto e depósito de outro tenant = 404.
 * @param {{ auth: any }} contexto
 * @param {{ empresa_id?: string, produto_id?: string, local_estoque_id?: string }} query
 */
export const lotesDisponiveis = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  return emTransacao(LEITURA, async (tx) => {
    const produto = await tx.produto.findFirst({
      where: { cliente_id: cli, empresa_id: empresaId, id: String(query.produto_id ?? '') },
      select: { id: true, nome_produto: true, unidade_principal_estoque: true, controla_lote: true, controla_validade: true },
    });
    if (!produto) throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado nesta fazenda');
    const local = await tx.localEstoque.findFirst({ where: { cliente_id: cli, id: String(query.local_estoque_id ?? '') }, select: { id: true, nome: true } });
    if (!local) throw new AppError('ESTOQUE_LOCAL_INVALIDO', 'local de estoque não encontrado', { details: { field: 'local_estoque_id', reason: 'local_inexistente' } });
    const { hoje } = await hojeDaEmpresa(tx, cli, empresaId);
    const camadas = ordenarFefo(await lotesFifo(tx, cli, empresaId, produto.id, local.id));
    const diaMs = 24 * 60 * 60 * 1000;
    const hojeMs = new Date(`${hoje}T00:00:00.000Z`).getTime();
    return {
      produto_id: produto.id,
      local_estoque_id: local.id,
      unidade: unidadeDeEstoque(produto.unidade_principal_estoque),
      controla_lote: produto.controla_lote,
      controla_validade: produto.controla_validade,
      hoje,
      dias_aviso: DIAS_AVISO_VENCIMENTO,
      lotes: camadas.map((l) => {
        const validade = l.data_validade ? l.data_validade.toISOString().slice(0, 10) : null;
        return {
          id: l.id,
          lote_fabricante: l.lote_fabricante ?? null,
          data_validade: validade,
          data_documento: dia(l.data_documento),
          quantidade_disponivel: dec(l.quantidade_disponivel).toFixed(CASAS_QUANTIDADE),
          custo_unitario: dec(l.custo_unitario).toFixed(CASAS_CUSTO),
          vencido: loteVencido(l.data_validade, hoje),
          vence_em_dias: l.data_validade ? Math.round((l.data_validade.getTime() - hojeMs) / diaMs) : null,
        };
      }),
    };
  });
};

// ─── movimentos (E2, P1-04) ─────────────────────────────────────────────────

/**
 * D-PROD-273 (fatia 2, "o excluído some das telas") — o PAR EXCLUÍDO: o movimento original 'Estornada' e o estorno
 * dele (`tipo_detalhado` 'estorno_*' com `movimento_pai_id` = o original), no mesmo tenant, empresa e produto. Os
 * dois saem do kardex por padrão e continuam no banco (auditoria); `incluir_excluidos` os traz de volta marcados
 * (`excluido: true`). Só o par COMPLETO conta: 'Estornada' sem estorno e estorno sem pai 'Estornada' aparecem
 * normalmente; movimento ativo nunca some. A transferência excluída são dois pares (S ↔ E_o, R ↔ E_d): a saída S
 * guarda R em `movimento_filho_id` (há uma coluna de filho só), por isso o par é achado sempre pelo lado do estorno
 * (`movimento_pai_id` → a chave do original), nunca pelo filho. CTE materializada uma vez por consulta (os estornos da
 * empresa, ou do produto filtrado, e o original pela chave) e usada como conjunto hash (`NOT IN`; ids nunca nulos).
 * @param {string} cli @param {string} empresaId @param {string|null} [produtoId]
 */
const paresExcluidosCte = (cli, empresaId, produtoId = null) => Prisma.sql`WITH pares AS MATERIALIZED (
    SELECT o.id AS o_id, e.id AS e_id
      FROM "MovimentacaoEstoque" e
      JOIN "MovimentacaoEstoque" o
        ON o.cliente_id = e.cliente_id AND o.id = e.movimento_pai_id AND o.status = 'Estornada'
       AND o.empresa_id = e.empresa_id AND o.produto_id = e.produto_id
     WHERE e.cliente_id = ${cli} AND e.empresa_id = ${empresaId}
       ${produtoId ? Prisma.sql`AND e.produto_id = ${produtoId}` : Prisma.empty}
       AND left(COALESCE(e.tipo_detalhado, ''), 8) = 'estorno_')`;
/** Ids do par excluído (os dois lados), sobre a CTE `pares`. */
const IDS_EXCLUIDOS = Prisma.sql`(SELECT o_id FROM pares UNION ALL SELECT e_id FROM pares)`;

/** Número do motor (numérico) para a ordem canônica; legado não numérico desempata por `createdAt`, `id`. */
const NUMERO_CANONICO = /^\d{1,18}$/;
const chaveDeOrdem = (numero, criado, id) => ({
  n: typeof numero === 'string' && NUMERO_CANONICO.test(numero) ? BigInt(numero) : null,
  t: criado instanceof Date ? criado.getTime() : new Date(criado ?? 0).getTime(),
  id: String(id),
});
/** `a` foi lançado antes de `b` (D-PROD-273 §1.3: `numero_movimentacao` numérico; empate/legado por `createdAt`, `id`). */
const lancadoAntes = (a, b) => {
  if (a.n !== null && b.n !== null && a.n !== b.n) return a.n < b.n;
  if (a.t !== b.t) return a.t < b.t;
  return a.id < b.id;
};
/** Depósito cujo saldo o movimento gravou (`saldo_antes/depois` do motor): Entrada → destino; Saída → origem. */
const depositoDoSaldo = (tipo, origem, destino) => (tipo === 'Entrada' ? destino ?? null : tipo === 'Saída' ? origem ?? null : null);
/** Efeito do movimento no saldo do depósito: Entrada +q, Saída −q (outro tipo: sem efeito conhecido). */
const efeitoNoSaldo = (tipo, quantidade) => (tipo === 'Entrada' ? dec(quantidade ?? 0) : tipo === 'Saída' ? dec(quantidade ?? 0).neg() : null);

/**
 * D-PROD-273 (fatia 2) — saldo EXIBIDO sem os excluídos. O kardex mostra o `saldo_antes/depois` gravado pelo motor;
 * escondido o par, o saldo de um movimento lançado ENTRE o original e o estorno ainda conteria o original. O saldo de
 * cada movimento ativo passa a ser o gravado menos o efeito dos movimentos excluídos do MESMO produto e depósito
 * lançados antes dele (ordem canônica): um par inteiro antes soma zero (o estorno anula o original). Vale com o
 * filtro ligado ou não (o saldo de um movimento ativo não muda ao mostrar os excluídos) e no detalhe; o movimento
 * excluído, quando mostrado, fica com o saldo gravado. D-PROD-273 (fatia 4): o par excluído COM recálculo (marca
 * `exclusao_recalculo:<original>`) fica fora do ajuste — o recálculo já regravou os saldos sem ele. Nada é gravado. Uma leitura dos pares dos produtos da página
 * (índice `cliente_id, produto_id`).
 * @param {any} tx @param {string} cli @param {string} empresaId
 * @param {any[]} linhas movimentos com `excluido`, `produto_id`, `tipo_movimentacao`, locais, `numero_movimentacao`, `createdAt`, `id`
 * @returns {Promise<Map<string, any>>} id → ajuste em Decimal (só os ≠ 0)
 */
const ajustesDeSaldoSemExcluidos = async (tx, cli, empresaId, linhas) => {
  const ativos = linhas.filter((m) => !m.excluido && depositoDoSaldo(m.tipo_movimentacao, m.local_estoque_origem, m.local_estoque_destino));
  /** @type {Map<string, any>} */
  const ajustes = new Map();
  if (!ativos.length) return ajustes;
  const produtos = [...new Set(ativos.map((m) => m.produto_id))];
  const pares = /** @type {any[]} */ (await tx.$queryRaw(Prisma.sql`
    SELECT e.produto_id,
           e.id AS e_id, e.numero_movimentacao AS e_numero, e."createdAt" AS e_criado, e.tipo_movimentacao AS e_tipo,
           e.local_estoque_origem AS e_origem, e.local_estoque_destino AS e_destino, e.quantidade AS e_qtd,
           o.id AS o_id, o.numero_movimentacao AS o_numero, o."createdAt" AS o_criado, o.tipo_movimentacao AS o_tipo,
           o.local_estoque_origem AS o_origem, o.local_estoque_destino AS o_destino, o.quantidade AS o_qtd
      FROM "MovimentacaoEstoque" e
      JOIN "MovimentacaoEstoque" o
        ON o.cliente_id = e.cliente_id AND o.id = e.movimento_pai_id AND o.status = 'Estornada'
       AND o.empresa_id = e.empresa_id AND o.produto_id = e.produto_id
     WHERE e.cliente_id = ${cli} AND e.empresa_id = ${empresaId} AND e.produto_id IN (${Prisma.join(produtos)})
       AND left(COALESCE(e.tipo_detalhado, ''), 8) = 'estorno_'
       -- D-PROD-273 (fatia 4): o par excluído COM recálculo não desconta nada — os saldos depois dele já foram regravados sem ele.
       AND COALESCE(o.movimentacao_grupo_id, '') <> ${MARCA_EXCLUSAO_RECALCULO} || o.id`));
  if (!pares.length) return ajustes;
  // Os excluídos por produto × depósito (o original uma vez só, mesmo com dois estornos).
  const vistos = new Set();
  /** @type {Map<string, any[]>} */
  const porPoco = new Map();
  for (const p of pares) {
    for (const lado of ['o', 'e']) {
      const id = p[`${lado}_id`];
      if (vistos.has(id)) continue;
      vistos.add(id);
      const deposito = depositoDoSaldo(p[`${lado}_tipo`], p[`${lado}_origem`], p[`${lado}_destino`]);
      const efeito = efeitoNoSaldo(p[`${lado}_tipo`], p[`${lado}_qtd`]);
      if (!deposito || !efeito) continue;
      const chave = `${p.produto_id}\u0000${deposito}`;
      if (!porPoco.has(chave)) porPoco.set(chave, []);
      porPoco.get(chave)?.push({ efeito, ordem: chaveDeOrdem(p[`${lado}_numero`], p[`${lado}_criado`], id) });
    }
  }
  for (const m of ativos) {
    const doPoco = porPoco.get(`${m.produto_id}\u0000${depositoDoSaldo(m.tipo_movimentacao, m.local_estoque_origem, m.local_estoque_destino)}`);
    if (!doPoco) continue;
    const ordem = chaveDeOrdem(m.numero_movimentacao, m.createdAt, m.id);
    const ajuste = doPoco.reduce((total, x) => (lancadoAntes(x.ordem, ordem) ? total.plus(x.efeito) : total), dec(0));
    if (!ajuste.isZero()) ajustes.set(m.id, ajuste);
  }
  return ajustes;
};

/** Saldo gravado menos o ajuste (nulo continua nulo). */
const semAjuste = (valor, ajuste) => (valor === null || valor === undefined || !ajuste ? valor : dec(valor).minus(ajuste));

const comoMovimentoResumo = (m, ajuste = null) => ({
  id: m.id,
  numero: m.numero_movimentacao,
  data: dia(m.data_movimentacao),
  tipo: m.tipo_movimentacao,
  tipo_detalhado: m.tipo_detalhado ?? null,
  origem_sistema: m.origem_sistema,
  status: m.status,
  estorno: typeof m.tipo_detalhado === 'string' && m.tipo_detalhado.startsWith('estorno'),
  excluido: m.excluido === true,
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
  saldo_antes: textoOuNulo(semAjuste(m.saldo_antes, ajuste), CASAS_QUANTIDADE),
  saldo_depois: textoOuNulo(semAjuste(m.saldo_depois, ajuste), CASAS_QUANTIDADE),
  movimento_pai_id: m.movimento_pai_id ?? null,
  movimento_filho_id: m.movimento_filho_id ?? null,
  // D-PROD-313: a unidade em que a quantidade foi digitada (D-PROD-310), a quantidade digitada e o fator; nulas = sem conversão.
  ...unidadePublica(m),
});

/** Colunas lidas na listagem (nada de JSON de camadas nem observações); `createdAt` só para a ordem canônica. */
const COLUNAS_RESUMO = Prisma.sql`m.id, m.numero_movimentacao, m.data_movimentacao, m.tipo_movimentacao, m.tipo_detalhado, m.origem_sistema,
  m.status, m.produto_id, m.produto_nome, m.produto_codigo, m.quantidade, m.unidade_medida, m.valor_unitario, m.valor_total,
  m.local_estoque_origem, m.local_origem, m.local_estoque_destino, m.local_destino, m.saldo_antes, m.saldo_depois,
  m.movimento_pai_id, m.movimento_filho_id, m.unidade_lancamento, m.quantidade_lancamento, m.fator_lancamento, m."createdAt"`;

/** Campos do parente no detalhe. */
const SELECT_RESUMO = Object.freeze({
  id: true, numero_movimentacao: true, data_movimentacao: true, tipo_movimentacao: true, tipo_detalhado: true, status: true,
  quantidade: true, unidade_medida: true,
});

/** Instante para comparar com a coluna `timestamp(3)` (sem fuso; o Prisma grava em UTC). @param {Date} d */
const comoTimestamp = (d) => Prisma.sql`${d.toISOString().slice(0, 23)}::timestamp`;

/** `incluir_excluidos` da querystring (boolean do schema; texto se chamado direto). */
const ehVerdade = (v) => v === true || v === 'true';

/**
 * @param {any} contexto
 * @param {{ empresa_id?: string, produto_id?: string, local_estoque_id?: string, origem_sistema?: string, tipo_movimentacao?: string,
 *   data_de?: string, data_ate?: string, q?: string, incluir_excluidos?: boolean|string, limit?: number|string, cursor?: string }} query
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
  const incluirExcluidos = ehVerdade(query.incluir_excluidos);

  const amarra = ['movimentos', cli, empresaId, query.produto_id ?? null, query.local_estoque_id ?? null, query.origem_sistema ?? null,
    query.tipo_movimentacao ?? null, de, ate, q, limite, incluirExcluidos];
  const posicao = query.cursor ? decodificarCursorConsulta(query.cursor, amarra) : null;
  const cursorData = posicao && posicao.length === 2 && typeof posicao[0] === 'string' && typeof posicao[1] === 'string' ? new Date(posicao[0]) : null;
  if (posicao && (!cursorData || Number.isNaN(cursorData.getTime()))) {
    throw invalido('cursor inválido; recomece a consulta sem cursor', { field: 'cursor', reason: 'cursor_invalido' });
  }

  // Tenant e empresa primeiro (keyset `MovimentacaoEstoque_keyset_empresa_idx`, D-PROD-185).
  const filtros = [Prisma.sql`m.cliente_id = ${cli}`, Prisma.sql`m.empresa_id = ${empresaId}`];
  if (query.produto_id) filtros.push(Prisma.sql`m.produto_id = ${query.produto_id}`);
  if (query.local_estoque_id) filtros.push(Prisma.sql`(m.local_estoque_origem = ${query.local_estoque_id} OR m.local_estoque_destino = ${query.local_estoque_id})`);
  if (query.origem_sistema) filtros.push(Prisma.sql`m.origem_sistema = ${query.origem_sistema}`);
  if (query.tipo_movimentacao) filtros.push(Prisma.sql`m.tipo_movimentacao = ${query.tipo_movimentacao}`);
  if (de) filtros.push(Prisma.sql`m.data_movimentacao >= ${comoTimestamp(new Date(`${de}T00:00:00.000Z`))}`);
  if (ate) filtros.push(Prisma.sql`m.data_movimentacao < ${comoTimestamp(new Date(new Date(`${ate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000))}`);
  if (q) {
    const padrao = `%${q}%`;
    filtros.push(Prisma.sql`(m.numero_movimentacao ILIKE ${padrao} OR m.produto_nome ILIKE ${padrao} OR m.numero_documento ILIKE ${padrao} OR m.motivo_movimentacao ILIKE ${padrao})`);
  }
  if (!incluirExcluidos) filtros.push(Prisma.sql`m.id NOT IN ${IDS_EXCLUIDOS}`);
  const where = Prisma.join(filtros, ' AND ');
  const depoisDoCursor = cursorData
    ? Prisma.sql`AND (m.data_movimentacao, m.id) < (${comoTimestamp(cursorData)}, ${/** @type {string} */ (posicao?.[1])})`
    : Prisma.empty;

  const pares = paresExcluidosCte(cli, empresaId, query.produto_id || null);
  const [contagem, registros, ajustes] = await emTransacao(LEITURA, async (tx) => {
    const c = await tx.$queryRaw(Prisma.sql`${pares} SELECT COUNT(*)::int AS total FROM "MovimentacaoEstoque" m WHERE ${where}`);
    const r = /** @type {any[]} */ (await tx.$queryRaw(Prisma.sql`${pares}
      SELECT ${COLUNAS_RESUMO}, ${incluirExcluidos ? Prisma.sql`(m.id IN ${IDS_EXCLUIDOS})` : Prisma.sql`false`} AS excluido
        FROM "MovimentacaoEstoque" m
       WHERE ${where} ${depoisDoCursor}
       ORDER BY m.data_movimentacao DESC, m.id DESC
       LIMIT ${limite + 1}`));
    const pagina = r.length > limite ? r.slice(0, limite) : r;
    return [c, r, await ajustesDeSaldoSemExcluidos(tx, cli, empresaId, pagina)];
  });
  const total = Number(/** @type {any[]} */ (contagem)[0]?.total ?? 0);
  const temMais = registros.length > limite;
  const pagina = temMais ? registros.slice(0, limite) : registros;
  const ultimo = pagina[pagina.length - 1];
  return {
    items: pagina.map((m) => comoMovimentoResumo(m, ajustes.get(m.id) ?? null)),
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
  // D-PROD-259: a entrada manual (e o estorno dela), achada pela FK do item; a tela abre o detalhe dela na mesma tela
  // (sem página própria: a aba Entradas saiu). A origem não é citada aqui (P7: só o motor a conhece).
  const entrada = await tx.entradaEstoqueItem.findFirst({
    where: { cliente_id: cli, ...porMovimento },
    select: { entrada: { select: { id: true, numero: true, motivoCadastro: { select: { nome: true } } } } },
  });
  if (entrada?.entrada) {
    const e = entrada.entrada;
    return { tipo: 'ENTRADA_ESTOQUE', id: e.id, numero: e.numero, rotulo: `Entrada nº ${e.numero}${e.motivoCadastro?.nome ? ` — ${e.motivoCadastro.nome}` : ''}`, pagina: null };
  }
  // D-PROD-264: a saída manual (e o estorno dela), achada pela FK do item; a tela abre o detalhe dela na mesma tela.
  const saida = await tx.saidaEstoqueItem.findFirst({
    where: { cliente_id: cli, ...porMovimento },
    select: { saida: { select: { id: true, numero: true, motivo: { select: { nome: true } } } } },
  });
  // D-PROD-271: a linha substituída pela edição da saída é apagada (o evento guarda o snapshot); o movimento
  // antigo e o estorno dele ainda levam o id da saída em `lancamento_origem_id` (gravado pelo motor).
  const s = saida?.saida
    ?? (m.origem_sistema === ORIGEM_SAIDA_ESTOQUE && m.lancamento_origem_id
      ? await tx.saidaEstoque.findFirst({ where: { cliente_id: cli, id: m.lancamento_origem_id }, select: { id: true, numero: true, motivo: { select: { nome: true } } } })
      : null);
  if (s) return { tipo: 'SAIDA_ESTOQUE', id: s.id, numero: s.numero, rotulo: `Saída nº ${s.numero}${s.motivo?.nome ? ` — ${s.motivo.nome}` : ''}`, pagina: null };
  // D-PROD-272: o ajuste de inventário (sobra, falta e os estornos), achado pela FK do item.
  const ajuste = await tx.ajusteEstoqueItem.findFirst({ where: { cliente_id: cli, ...porMovimento }, select: { ajuste: { select: { id: true, numero: true } } } });
  if (ajuste?.ajuste) return { tipo: 'AJUSTE_ESTOQUE', id: ajuste.ajuste.id, numero: ajuste.ajuste.numero, rotulo: `Ajuste de inventário nº ${ajuste.ajuste.numero}`, pagina: null };
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
    // D-PROD-273 (fatia 2): o detalhe diz se o movimento é de um par excluído e mostra o mesmo saldo da lista.
    const [marca] = /** @type {any[]} */ (await tx.$queryRaw(Prisma.sql`${paresExcluidosCte(cli, empresaId, m.produto_id)} SELECT (${m.id} IN ${IDS_EXCLUIDOS}) AS excluido`));
    const comMarca = { ...m, excluido: marca?.excluido === true };
    const ajuste = (await ajustesDeSaldoSemExcluidos(tx, cli, empresaId, [comMarca])).get(m.id) ?? null;
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
      ...comoMovimentoResumo(comMarca, ajuste),
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

