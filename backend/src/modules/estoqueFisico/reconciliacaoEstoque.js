/**
 * D-PROD-161 (Estoque P0, fatia F4 + R1) — RECONCILIAÇÃO SOMENTE LEITURA do
 * estoque físico (SPEC §5). Confere os invariantes do motor único e classifica
 * o que não fecha; NUNCA corrige nada (sem auto-reparo: o saneamento é da P1,
 * com GO).
 *
 * Invariantes conferidos (SPEC §1.2):
 *  I1 cache    `Produto.estoque_atual` = Σ disponível dos lotes 'Disponivel' da
 *              empresa do produto, em TODOS os locais (também com o filtro de
 *              local: `cobertura.nivel_produto = 'todos_os_locais'`);
 *  I2 local    Σ disponível dos lotes 'Disponivel' por (empresa, produto, local)
 *              = razão dos movimentos (Σ Entrada no destino − Σ Saída na origem,
 *              todos os status: o estorno compensa) e nunca negativo;
 *  I3 lote     0 ≤ disponível ≤ entrada; situação coerente com o saldo; consumo
 *              observado (entrada − disponível) = consumo explicado pelas
 *              fatias FK (financeiro ativo, abastecimento CONFIRMADO), pelo
 *              `lotes_consumidos` das Saídas de suplementação/transferência,
 *              pelo `rateio` do recibo legado (só quando o movimento NÃO tem
 *              `lotes_consumidos`, para não contar duas vezes) e pela compra
 *              estornada;
 *  I4 fato     cada movimento = Σ das suas fatias (JSON, recibo legado ou FK) ou
 *              Σ das camadas de entrada ligadas; par pai/filho coerente;
 *  I5 número   nenhum `numero_movimentacao` provisório (`p-…`) commitado.
 *
 * Classes (a primeira que casar vale; o nível lote não é mascarado pelo nível
 * produto): DADOS_INSUFICIENTES → LIMITACAO_LEGADA → DIVERGENCIA_REAL → OK.
 * Evidência do AuditLog só rebaixa para LIMITACAO_LEGADA quando é RELEVANTE
 * (R1): escrita PROVADA de `estoque_atual` do produto (os dois lados do
 * snapshot com o campo e valores numéricos diferentes; na criação, ≠ 0) ou de
 * quantidade/situação/vínculo do lote (criação, exclusão, ou mudança provada
 * de `quantidade_*`, `status`, `produto_id`, `empresa_id`, `local_estoque_id`,
 * `movimentacao_entrada_id`). Renomeação, custo/fornecedor/documento do lote,
 * nome/preço do produto, quantidade igual em outro formato e criação de
 * movimento manual nunca rebaixam DIVERGENCIA_REAL.
 *
 * Volume (R1, medido em PG17 local com 5.000 produtos, 60.000 lotes, 210.000
 * movimentos, 140.000 recibos e 60.000 AuditLog): a varredura é LIMITADA e
 * fail-closed. Anda por PÁGINAS de produto em ordem de id (keyset): a 1ª
 * consulta de cada página lê os próximos `produtosPorPagina + 1` produtos com
 * a pré-contagem de lotes e movimentos (índice `(cliente_id, produto_id)`) e
 * corta a página no orçamento de linhas (no mínimo 1 produto, que nunca é
 * pulado). Lotes, movimentos e evidências entram por FAIXA de `produto_id`
 * (`(desde, ate]`; a última página é aberta e cobre os órfãos), e os recibos
 * legados por janela de criação do próprio movimento (índice
 * `(cliente_id, createdAt)`: no caminho legado o recibo e o movimento nascem na
 * mesma transação de ≤ 9 s; fora de ±1 h não casa → DADOS_INSUFICIENTES).
 * Acima do orçamento da CHAMADA (linhas ou tempo) a resposta é 200 com
 * `cobertura.completa = false`, `proximo_cursor`, `resumo.situacao =
 * 'INCOMPLETO'` e `por_classe.OK = null`: nada é declarado OK sobre dados
 * parciais. `truncado` é só o corte da LISTA de achados pelo `limite` (os
 * mais graves primeiro, mantidos com memória O(limite + página)).
 *
 * Leitura (SPEC §5.1): uma transação RepeatableRead (um só snapshot por
 * chamada) cuja PRIMEIRA instrução é `SET TRANSACTION READ ONLY` (o PostgreSQL
 * recusa qualquer escrita nela) e a segunda força plano CUSTOM
 * (`plan_cache_mode`: o plano genérico do prepared statement, que o driver
 * passa a usar na 6ª execução, levava 0,9 s a 6,6 s); nenhuma trava de linha
 * nem advisory. Idas ao banco = 4 fixas (+1 com empresa) + 5 por página, sem
 * N+1 por lote ou movimento. Listas entram como `::text[]` e todo WHERE começa
 * por `cliente_id`. Quantidades viram `::text` no SQL e `Dec` aqui; nunca
 * Number. O tenant vem SÓ do `auth_context` (R11). A resposta tem só ids do
 * próprio tenant: nenhum `dados_*` do AuditLog nem dado de usuário.
 */

import { Prisma } from '@prisma/client';

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { ID_DE_CURSOR } from '../../shared/pagination/keysetCursor.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { CASAS_QUANTIDADE, Dec, ZERO, dec, somar } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { agoraDoServidor } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ORIGEM_ABASTECIMENTO, ORIGEM_DEPOSITO, ORIGEM_SISTEMA, ORIGEM_SUPLEMENTACAO } from './estoqueFisicoMotor.js';

/**
 * Origens de movimento do protocolo (motor físico único, D-PROD-161). Vêm dos
 * exports `ORIGEM_*` de `estoqueFisicoMotor.js` (passo 3 da integração da SPEC
 * §8), para que uma origem nova do motor não fique fora do reconciliador por
 * divergência de literal. Os valores são os mesmos que a F4 declarava aqui.
 */
export const ORIGENS_PROTOCOLO = Object.freeze([ORIGEM_SISTEMA, ORIGEM_ABASTECIMENTO, ORIGEM_SUPLEMENTACAO, ORIGEM_DEPOSITO]);
/** Origens cuja fatia vive em JSON (`lotes_consumidos`) ou, no legado, só no recibo. */
const ORIGENS_SEM_FK = Object.freeze([ORIGEM_SUPLEMENTACAO, ORIGEM_DEPOSITO]);
/** Origens com fatia FK própria (`OperacaoFinanceiraConsumoLote`, `AbastecimentoBemConsumoLote`). */
const ORIGENS_COM_FK = Object.freeze([ORIGEM_SISTEMA, ORIGEM_ABASTECIMENTO]);
/** Escritores genéricos antigos (POST de movimento, reversão pelo navegador). */
const ORIGENS_LEGADAS = Object.freeze(['manual', 'reversao']);
const STATUS_LOTE = Object.freeze(['Disponivel', 'Esgotado', 'Estornado']);
const TIPOS_MOVIMENTO = Object.freeze(['Entrada', 'Saída']);
const STATUS_MOVIMENTO = Object.freeze(['Ativa', 'Estornada']);
/** Recibos dos comandos de estoque que guardam o rateio FIFO (`response_json.rateio`). */
const TIPOS_RECIBO = Object.freeze(['saida_suplementacao', 'transferencia_locais']);
/** Campos numéricos do lote cuja mudança PROVADA (os dois lados, valor diferente) é evidência de escritor fora do motor. */
const CAMPOS_QUANTIDADE_LOTE = Object.freeze(['quantidade_entrada', 'quantidade_disponivel']);
/** Situação e vínculos do lote que mudam saldo, cache ou razão (comparação do valor JSON). */
const CAMPOS_VINCULO_LOTE = Object.freeze(['status', 'produto_id', 'empresa_id', 'local_estoque_id', 'movimentacao_entrada_id']);
/** Resíduo de Number por fatia (ou baixa) legada: 1 unidade da 4ª casa. */
const TOLERANCIA_POR_FATIA = new Dec('0.0001');

export const LIMITE_PADRAO = 500;
export const LIMITE_MAXIMO = 2000;
/** Mesmo padrão de `TX_LEITURA`/`LEITURA` dos serviços de financeiro e abastecimento (SPEC §5.1). */
const LEITURA = Object.freeze({ maxWait: 2000, timeout: 20000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

/**
 * Orçamento de UMA chamada (R1). `linhasPorPagina` e `linhasPorChamada` contam
 * a pré-contagem `1 + lotes + movimentos` de cada produto; `tempoMs` é
 * conferido entre páginas e fica bem abaixo dos 20 s da transação, com folga
 * para a última página (medida: ~0,3 s por 200 produtos × 12 lotes × 42
 * movimentos). Só o serviço aceita orçamento menor (testes); o HTTP usa este.
 */
export const ORCAMENTO_PADRAO = Object.freeze({ produtosPorPagina: 200, linhasPorPagina: 20000, linhasPorChamada: 250000, tempoMs: 8000 });
const ORCAMENTO_TETO = Object.freeze({ produtosPorPagina: 1000, linhasPorPagina: 100000, linhasPorChamada: 1000000, tempoMs: 12000 });
/** Janela do recibo legado em torno do `createdAt` do movimento (mesma transação no caminho legado: ≤ 9 s). */
const JANELA_RECIBO = Prisma.raw(`interval '1 hour'`);
const VERSAO_CURSOR = 1;

export const CLASSES = Object.freeze(['DADOS_INSUFICIENTES', 'LIMITACAO_LEGADA', 'DIVERGENCIA_REAL']);
const [DI, LL, DR] = CLASSES;
const NIVEIS = Object.freeze(['produto', 'local', 'lote', 'movimento']);
/** Ordem da lista de achados (a mais grave primeiro; o `limite` corta o fim). */
const GRAVIDADE = Object.freeze({ DIVERGENCIA_REAL: 0, DADOS_INSUFICIENTES: 1, LIMITACAO_LEGADA: 2 });

// ─── SQL ────────────────────────────────────────────────────────────────────
/**
 * Texto (JSON ou coluna) → numeric com 4 casas, ou NULL se não for número. O
 * `rateio` legado guarda float JS (até `5.551115123125783e-17`): a regex aceita
 * expoente curto; qualquer outra coisa vira NULL em vez de erro (um JSON forjado
 * nunca derruba a leitura). Equivale a `new Dec(String(n))` em HALF_UP(4).
 * @param {import('@prisma/client').Prisma.Sql} expr
 */
const num = (expr) => Prisma.sql`(CASE WHEN (${expr}) ~ '^-?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]{1,3})?$' THEN round((${expr})::numeric, 4) END)`;
/** JSON → objeto (`{}` se não for objeto): `jsonb_each`/`->>` nunca falham por forma inesperada. */
const objeto = (expr) => Prisma.sql`(CASE WHEN jsonb_typeof((${expr})::jsonb) = 'object' THEN (${expr})::jsonb ELSE '{}'::jsonb END)`;
/** JSON → lista (`[]` se não for lista). */
const lista = (expr) => Prisma.sql`(CASE WHEN jsonb_typeof((${expr})::jsonb) = 'array' THEN (${expr})::jsonb ELSE '[]'::jsonb END)`;
/** ` AND coluna = valor` (ou nada sem filtro). `coluna` é constante do código, nunca entrada. */
const igual = (coluna, valor) => (valor === null ? Prisma.empty : Prisma.sql` AND ${Prisma.raw(coluna)} = ${valor}`);
/** ` AND coluna > desde AND coluna <= ate` (cada lado só se houver): a faixa de `produto_id` da página. */
const naFaixa = (coluna, faixa) => Prisma.sql`${faixa.desde === null ? Prisma.empty : Prisma.sql` AND ${Prisma.raw(coluna)} > ${faixa.desde}`}${
  faixa.ate === null ? Prisma.empty : Prisma.sql` AND ${Prisma.raw(coluna)} <= ${faixa.ate}`}`;
/** Escopo de lote/movimento da página: faixa de produto + empresa + produto filtrados. */
const escopo = (alias, f, faixa) => Prisma.sql`${naFaixa(`${alias}.produto_id`, faixa)}${igual(`${alias}.empresa_id`, f.empresaId)}${igual(`${alias}.produto_id`, f.produtoId)}`;
/** Local que o movimento afeta (Entrada no destino, Saída na origem). */
const localDoMovimento = (alias) => Prisma.raw(`CASE ${alias}.tipo_movimentacao WHEN 'Entrada' THEN ${alias}.local_estoque_destino WHEN 'Saída' THEN ${alias}.local_estoque_origem END`);
const localDoLote = (f) => igual('l.local_estoque_id', f.localId);
const localDoMov = (alias, f) => (f.localId === null ? Prisma.empty : Prisma.sql` AND (${localDoMovimento(alias)}) = ${f.localId}`);

/**
 * Recibos committed de comando de estoque cujo movimento (suplementação ou
 * saída da transferência) é o `alias` — busca LIMITADA pelo índice
 * `(cliente_id, createdAt)` na janela do próprio movimento (nunca varre todos
 * os recibos do tenant).
 */
const recibosDoMovimento = (cli, alias) => {
  const m = Prisma.raw(alias);
  const corpo = objeto(Prisma.sql`o.response_json`);
  return Prisma.sql`SELECT o."createdAt" AS criado_em, ${lista(Prisma.sql`${corpo} -> 'rateio'`)} AS rateio
    FROM "OperacaoIdempotente" o
    WHERE o.cliente_id = ${cli} AND o."createdAt" >= ${m}."createdAt" - ${JANELA_RECIBO} AND o."createdAt" <= ${m}."createdAt" + ${JANELA_RECIBO}
      AND o.tipo_operacao = ANY(${TIPOS_RECIBO}::text[]) AND o.status = 'committed' AND o.response_json IS NOT NULL
      AND COALESCE(${corpo} -> 'movimentacao' ->> 'id', ${corpo} -> 'movimentacao_saida' ->> 'id') = ${m}.id`;
};
/** Saída legada de suplementação/transferência (a fatia só está no recibo). */
const saidaLegada = (alias) => Prisma.raw(`${alias}.tipo_movimentacao = 'Saída' AND ${alias}.lotes_consumidos IS NULL AND ${alias}.origem_sistema = ANY(ARRAY['${ORIGENS_SEM_FK.join("','")}']::text[])`);

/**
 * Q1 da página: os próximos `n` produtos do escopo depois de `desde`, em ordem
 * de id, com o necessário para I1 (todos os locais, todas as empresas dos
 * lotes) e a pré-contagem de lotes e movimentos que corta a página.
 */
const lerProdutos = (tx, cli, f, desde, n) => tx.$queryRaw`SELECT p.id, p.empresa_id, p.estoque_atual::text AS estoque_atual,
      COALESCE(l.saldo, 0)::text AS saldo_lotes,
      COALESCE(l.n_lotes, 0)::int AS n_lotes,
      COALESCE(l.n_outra_empresa, 0)::int AS n_lotes_outra_empresa,
      COALESCE(l.n_status_desconhecido, 0)::int AS n_lotes_status_desconhecido,
      COALESCE(l.n_sem_movimento_entrada, 0)::int AS n_lotes_sem_movimento_entrada,
      COALESCE(m.n_movimentos, 0)::int AS n_movimentos,
      COALESCE(m.n_outra_empresa, 0)::int AS n_movimentos_outra_empresa,
      COALESCE(m.n_fora_do_protocolo, 0)::int AS n_movimentos_fora_do_protocolo,
      COALESCE(m.n_saidas_legadas, 0)::int AS n_saidas_legadas
    FROM "Produto" p
    LEFT JOIN LATERAL (
      SELECT SUM(x.quantidade_disponivel) FILTER (WHERE x.status = 'Disponivel' AND x.empresa_id = p.empresa_id) AS saldo,
             COUNT(*) AS n_lotes,
             COUNT(*) FILTER (WHERE x.empresa_id <> p.empresa_id) AS n_outra_empresa,
             COUNT(*) FILTER (WHERE x.status <> ALL(${STATUS_LOTE}::text[])) AS n_status_desconhecido,
             COUNT(*) FILTER (WHERE x.movimentacao_entrada_id IS NULL) AS n_sem_movimento_entrada
      FROM "EstoqueLoteNota" x WHERE x.cliente_id = p.cliente_id AND x.produto_id = p.id
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS n_movimentos,
             COUNT(*) FILTER (WHERE y.empresa_id <> p.empresa_id) AS n_outra_empresa,
             COUNT(*) FILTER (WHERE y.origem_sistema <> ALL(${ORIGENS_PROTOCOLO}::text[])) AS n_fora_do_protocolo,
             COUNT(*) FILTER (WHERE ${saidaLegada('y')}) AS n_saidas_legadas
      FROM "MovimentacaoEstoque" y WHERE y.cliente_id = p.cliente_id AND y.produto_id = p.id
    ) m ON true
    WHERE p.cliente_id = ${cli}${igual('p.empresa_id', f.empresaId)}${igual('p.id', f.produtoId)}${desde === null ? Prisma.empty : Prisma.sql` AND p.id > ${desde}`}
    ORDER BY p.id
    LIMIT ${n}`;

/**
 * Q2–Q5 de UMA página (faixa `(desde, ate]` de `produto_id`). Os órfãos (Q6 da
 * SPEC) saem de Q2–Q4 por LEFT JOIN em Produto: a faixa cobre qualquer
 * `produto_id`, exista ou não o produto.
 * @param {any} tx @param {string} cli
 * @param {{ empresaId: string|null, produtoId: string|null, localId: string|null }} f
 * @param {{ desde: string|null, ate: string|null }} faixa
 * @param {string[]} idsProdutos
 */
const lerPagina = async (tx, cli, f, faixa, idsProdutos) => {
  // Q2 — por (empresa, produto, local): lotes × razão dos movimentos (+ local/produto inexistentes).
  const locais = await tx.$queryRaw`WITH lot AS (
      SELECT l.empresa_id, l.produto_id, l.local_estoque_id AS local_id,
             COALESCE(SUM(l.quantidade_disponivel) FILTER (WHERE l.status = 'Disponivel'), 0) AS saldo_lotes,
             COUNT(*) AS n_lotes,
             COUNT(*) FILTER (WHERE l.status <> ALL(${STATUS_LOTE}::text[])) AS n_status_desconhecido,
             COUNT(*) FILTER (WHERE l.movimentacao_entrada_id IS NULL) AS n_sem_movimento_entrada
      FROM "EstoqueLoteNota" l
      WHERE l.cliente_id = ${cli}${escopo('l', f, faixa)}${localDoLote(f)}
      GROUP BY 1, 2, 3
    ), mov AS (
      SELECT m.empresa_id, m.produto_id, (${localDoMovimento('m')}) AS local_id,
             COALESCE(SUM(CASE m.tipo_movimentacao WHEN 'Entrada' THEN m.quantidade WHEN 'Saída' THEN -m.quantidade ELSE 0 END), 0) AS saldo_razao,
             COUNT(*) AS n_movimentos,
             COUNT(*) FILTER (WHERE m.tipo_movimentacao <> ALL(${TIPOS_MOVIMENTO}::text[])) AS n_tipo_desconhecido,
             COUNT(*) FILTER (WHERE m.origem_sistema <> ALL(${ORIGENS_PROTOCOLO}::text[])) AS n_fora_do_protocolo,
             COUNT(*) FILTER (WHERE ${saidaLegada('m')}) AS n_saidas_legadas
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${cli}${escopo('m', f, faixa)}${localDoMov('m', f)}
      GROUP BY 1, 2, 3
    )
    SELECT COALESCE(lot.empresa_id, mov.empresa_id) AS empresa_id,
           COALESCE(lot.produto_id, mov.produto_id) AS produto_id,
           COALESCE(lot.local_id, mov.local_id) AS local_estoque_id,
           COALESCE(lot.saldo_lotes, 0)::text AS saldo_lotes,
           COALESCE(mov.saldo_razao, 0)::text AS saldo_razao,
           COALESCE(lot.n_lotes, 0)::int AS n_lotes,
           COALESCE(mov.n_movimentos, 0)::int AS n_movimentos,
           COALESCE(lot.n_status_desconhecido, 0)::int AS n_status_desconhecido,
           COALESCE(lot.n_sem_movimento_entrada, 0)::int AS n_sem_movimento_entrada,
           COALESCE(mov.n_tipo_desconhecido, 0)::int AS n_tipo_desconhecido,
           COALESCE(mov.n_fora_do_protocolo, 0)::int AS n_fora_do_protocolo,
           COALESCE(mov.n_saidas_legadas, 0)::int AS n_saidas_legadas,
           (le.id IS NULL) AS local_inexistente,
           (p.id IS NULL) AS produto_inexistente,
           p.empresa_id AS produto_empresa_id
    FROM lot
    FULL JOIN mov ON mov.empresa_id = lot.empresa_id AND mov.produto_id = lot.produto_id AND mov.local_id = lot.local_id
    LEFT JOIN "LocalEstoque" le ON le.cliente_id = ${cli} AND le.id = COALESCE(lot.local_id, mov.local_id)
    LEFT JOIN "Produto" p ON p.cliente_id = ${cli} AND p.id = COALESCE(lot.produto_id, mov.produto_id)
    ORDER BY 2, 1, 3`;

  // Q3 — por lote: consumo observado × explicado, coerência da situação e do movimento de entrada.
  const lotes = await tx.$queryRaw`WITH lt AS (
      SELECT l.id, l.empresa_id, l.produto_id, l.local_estoque_id, l.status, l.quantidade_entrada, l.quantidade_disponivel,
             l.movimentacao_entrada_id, l.data_documento, l."createdAt"
      FROM "EstoqueLoteNota" l
      WHERE l.cliente_id = ${cli}${escopo('l', f, faixa)}${localDoLote(f)}
    ), fin AS (
      SELECT c.estoque_lote_nota_id AS lote_id, SUM(c.quantidade) AS consumido
      FROM "OperacaoFinanceiraConsumoLote" c
      JOIN "OperacaoFinanceiraItem" i ON i.cliente_id = c.cliente_id AND i.id = c.item_id
      WHERE c.cliente_id = ${cli} AND c.estoque_lote_nota_id IN (SELECT id FROM lt) AND i.movimentacao_estorno_id IS NULL
      GROUP BY 1
    ), abs AS (
      SELECT f.estoque_lote_nota_id AS lote_id, SUM(f.quantidade) AS consumido
      FROM "AbastecimentoBemConsumoLote" f
      JOIN "AbastecimentoBem" a ON a.cliente_id = f.cliente_id AND a.id = f.abastecimento_id
      WHERE f.cliente_id = ${cli} AND f.estoque_lote_nota_id IN (SELECT id FROM lt) AND a.status = 'CONFIRMADO'
      GROUP BY 1
    ), nov AS (
      SELECT x.elem ->> 'lote_id' AS lote_id, SUM(${num(Prisma.sql`x.elem ->> 'quantidade'`)}) AS consumido
      FROM "MovimentacaoEstoque" m
      CROSS JOIN LATERAL jsonb_array_elements(${lista(Prisma.sql`m.lotes_consumidos`)}) AS x(elem)
      WHERE m.cliente_id = ${cli}${escopo('m', f, faixa)}
        AND m.tipo_movimentacao = 'Saída' AND m.status = 'Ativa' AND m.origem_sistema = ANY(${ORIGENS_SEM_FK}::text[]) AND m.lotes_consumidos IS NOT NULL
      GROUP BY 1
    ), leg AS (
      SELECT lt.id AS lote_id,
             SUM(${num(Prisma.sql`e.elem ->> 'quantidade_consumida'`)}) FILTER (WHERE r.criado_em >= lt."createdAt" - interval '1 hour') AS consumido,
             COUNT(*) FILTER (WHERE r.criado_em >= lt."createdAt" - interval '1 hour') AS fatias,
             COUNT(*) FILTER (WHERE r.criado_em < lt."createdAt" - interval '1 hour') AS fatias_fora_janela
      FROM "MovimentacaoEstoque" m
      CROSS JOIN LATERAL (${recibosDoMovimento(cli, 'm')}) r
      CROSS JOIN LATERAL jsonb_array_elements(r.rateio) AS e(elem)
      JOIN lt ON lt.id = (e.elem ->> 'lote_id')
      WHERE m.cliente_id = ${cli}${escopo('m', f, faixa)} AND m.status = 'Ativa' AND ${saidaLegada('m')}
      GROUP BY 1
    ), compra AS (
      SELECT i.estoque_lote_nota_id AS lote_id, bool_or(i.movimentacao_estorno_id IS NOT NULL) AS estornada
      FROM "OperacaoFinanceiraItem" i
      WHERE i.cliente_id = ${cli} AND i.estoque_lote_nota_id IN (SELECT id FROM lt)
      GROUP BY 1
    ), ent AS (
      SELECT m.id, m.quantidade, m.tipo_movimentacao, m.tipo_detalhado, m.origem_sistema, m.produto_id, m.local_estoque_destino
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${cli} AND m.id IN (SELECT movimentacao_entrada_id FROM lt WHERE movimentacao_entrada_id IS NOT NULL)
    )
    SELECT lt.id, lt.empresa_id, lt.produto_id, lt.local_estoque_id, lt.status,
           lt.quantidade_entrada::text AS entrada, lt.quantidade_disponivel::text AS disponivel, lt.movimentacao_entrada_id,
           (lt.data_documento IS NOT NULL AND lt.data_documento < DATE '2002-01-01') AS data_antiga,
           (p.id IS NULL) AS produto_inexistente, p.empresa_id AS produto_empresa_id,
           (le.id IS NULL) AS local_inexistente,
           COALESCE(fin.consumido, 0)::text AS consumo_financeiro,
           COALESCE(abs.consumido, 0)::text AS consumo_abastecimento,
           COALESCE(nov.consumido, 0)::text AS consumo_movimentos,
           COALESCE(leg.consumido, 0)::text AS consumo_recibos,
           COALESCE(leg.fatias, 0)::int AS fatias_recibo,
           COALESCE(leg.fatias_fora_janela, 0)::int AS fatias_recibo_fora_janela,
           COALESCE(compra.estornada, false) AS compra_estornada,
           (ent.id IS NOT NULL) AS tem_movimento_entrada,
           ent.tipo_movimentacao AS entrada_tipo, ent.tipo_detalhado AS entrada_tipo_detalhado, ent.origem_sistema AS entrada_origem,
           ent.quantidade::text AS entrada_quantidade,
           (ent.id IS NOT NULL AND (ent.produto_id <> lt.produto_id OR ent.local_estoque_destino IS DISTINCT FROM lt.local_estoque_id
             OR ent.tipo_movimentacao <> 'Entrada')) AS entrada_incoerente
    FROM lt
    LEFT JOIN "Produto" p ON p.cliente_id = ${cli} AND p.id = lt.produto_id
    LEFT JOIN "LocalEstoque" le ON le.cliente_id = ${cli} AND le.id = lt.local_estoque_id
    LEFT JOIN fin ON fin.lote_id = lt.id
    LEFT JOIN abs ON abs.lote_id = lt.id
    LEFT JOIN nov ON nov.lote_id = lt.id
    LEFT JOIN leg ON leg.lote_id = lt.id
    LEFT JOIN compra ON compra.lote_id = lt.id
    LEFT JOIN ent ON ent.id = lt.movimentacao_entrada_id
    ORDER BY lt.id`;

  // Q4 — movimentos com alguma regra disparada (os demais só entram na contagem de Q2).
  const movimentos = await tx.$queryRaw`WITH mv AS (
      SELECT m.id, m.empresa_id, m.produto_id, m.tipo_movimentacao, m.tipo_detalhado, m.origem_sistema, m.status, m.quantidade,
             m.numero_movimentacao, m.movimento_pai_id, m.movimento_filho_id, m.lotes_consumidos, m."createdAt",
             (${localDoMovimento('m')}) AS local_id
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${cli}${escopo('m', f, faixa)}${localDoMov('m', f)}
    ), rcm AS (
      SELECT mv.id AS movimento_id, SUM(${num(Prisma.sql`e.elem ->> 'quantidade_consumida'`)}) AS soma, COUNT(e.elem) AS n
      FROM mv
      CROSS JOIN LATERAL (${recibosDoMovimento(cli, 'mv')}) r
      LEFT JOIN LATERAL jsonb_array_elements(r.rateio) AS e(elem) ON true
      WHERE ${saidaLegada('mv')}
      GROUP BY 1
    ), lin AS (
      SELECT l.movimentacao_entrada_id AS movimento_id, SUM(l.quantidade_entrada) AS soma
      FROM "EstoqueLoteNota" l
      WHERE l.cliente_id = ${cli} AND l.movimentacao_entrada_id IS NOT NULL${escopo('l', f, faixa)}
      GROUP BY 1
    ), fk AS (
      SELECT i.movimentacao_estoque_id AS movimento_id, SUM(c.quantidade) AS soma
      FROM "OperacaoFinanceiraConsumoLote" c
      JOIN "OperacaoFinanceiraItem" i ON i.cliente_id = c.cliente_id AND i.id = c.item_id
      WHERE c.cliente_id = ${cli} AND i.movimentacao_estoque_id IN (SELECT id FROM mv)
      GROUP BY 1
      UNION ALL
      SELECT a.movimentacao_estoque_id, SUM(f.quantidade)
      FROM "AbastecimentoBemConsumoLote" f
      JOIN "AbastecimentoBem" a ON a.cliente_id = f.cliente_id AND a.id = f.abastecimento_id
      WHERE f.cliente_id = ${cli} AND a.movimentacao_estoque_id IN (SELECT id FROM mv)
      GROUP BY 1
    ), x AS (
      SELECT mv.id, mv.empresa_id, mv.produto_id, mv.local_id AS local_estoque_id, mv.tipo_movimentacao, mv.tipo_detalhado, mv.origem_sistema, mv.status,
             mv.quantidade::text AS quantidade,
             (p.id IS NULL) AS produto_inexistente, p.empresa_id AS produto_empresa_id,
             (mv.tipo_movimentacao <> ALL(${TIPOS_MOVIMENTO}::text[])) AS tipo_desconhecido,
             (mv.status <> ALL(${STATUS_MOVIMENTO}::text[])) AS status_desconhecido,
             (mv.numero_movimentacao LIKE 'p-%') AS numero_provisorio,
             (mv.status = 'Estornada' AND f.id IS NULL) AS estornada_sem_filho,
             (mv.movimento_filho_id IS NOT NULL AND (f.id IS NULL OR f.movimento_pai_id IS DISTINCT FROM mv.id)) AS par_incoerente,
             (jsonb_typeof(mv.lotes_consumidos::jsonb) = 'array') AS tem_fatias_json,
             fj.soma::text AS soma_fatias_json, COALESCE(fj.n_ilegiveis, 0)::int AS n_fatias_json_ilegiveis,
             (${saidaLegada('mv')}) AS legado,
             (rcm.movimento_id IS NOT NULL) AS tem_recibo, rcm.soma::text AS soma_recibo, COALESCE(rcm.n, 0)::int AS n_fatias_recibo,
             (mv.tipo_movimentacao = 'Entrada' AND mv.tipo_detalhado = 'transferencia_recebida') AS transferencia_recebida,
             (mv.tipo_movimentacao = 'Entrada' AND mv.origem_sistema = ANY(${ORIGENS_PROTOCOLO}::text[]) AND mv.movimento_pai_id IS NULL) AS exige_camada,
             lin.soma::text AS soma_lotes_destino,
             (pai.id IS NOT NULL AND pai.lotes_consumidos IS NULL) AS pai_legado,
             (mv.tipo_movimentacao = 'Saída' AND mv.origem_sistema = ANY(${ORIGENS_COM_FK}::text[]) AND mv.movimento_pai_id IS NULL) AS exige_fk,
             fk.soma::text AS soma_fk
      FROM mv
      LEFT JOIN LATERAL (
        SELECT SUM(${num(Prisma.sql`e.elem ->> 'quantidade'`)}) AS soma, COUNT(*) FILTER (WHERE ${num(Prisma.sql`e.elem ->> 'quantidade'`)} IS NULL) AS n_ilegiveis
        FROM jsonb_array_elements(${lista(Prisma.sql`mv.lotes_consumidos`)}) AS e(elem)
      ) fj ON true
      LEFT JOIN rcm ON rcm.movimento_id = mv.id
      LEFT JOIN lin ON lin.movimento_id = mv.id
      LEFT JOIN fk ON fk.movimento_id = mv.id
      LEFT JOIN "MovimentacaoEstoque" f ON f.cliente_id = ${cli} AND f.id = mv.movimento_filho_id
      LEFT JOIN "MovimentacaoEstoque" pai ON pai.cliente_id = ${cli} AND pai.id = mv.movimento_pai_id
      LEFT JOIN "Produto" p ON p.cliente_id = ${cli} AND p.id = mv.produto_id
    )
    SELECT * FROM x
    WHERE produto_inexistente OR tipo_desconhecido OR status_desconhecido OR produto_empresa_id IS DISTINCT FROM empresa_id
       OR origem_sistema <> ALL(${ORIGENS_PROTOCOLO}::text[]) OR numero_provisorio OR estornada_sem_filho OR par_incoerente
       OR (tem_fatias_json AND (n_fatias_json_ilegiveis > 0 OR soma_fatias_json IS DISTINCT FROM quantidade))
       OR (legado AND (NOT tem_recibo OR soma_recibo IS DISTINCT FROM quantidade))
       OR ((transferencia_recebida OR exige_camada) AND soma_lotes_destino IS DISTINCT FROM quantidade)
       OR (exige_fk AND soma_fk IS DISTINCT FROM quantidade)
    ORDER BY id`;

  // Q5 — evidência RELEVANTE de escritor fora do protocolo no AuditLog (só ids e ações: nenhum `dados_*` sai daqui).
  // Produto: por id da página; lote: por id dos lotes da faixa (laço por índice, nunca a tabela inteira).
  const dados = Prisma.sql`CROSS JOIN LATERAL (SELECT ${objeto(Prisma.sql`a.dados_novos`)} AS nov, ${objeto(Prisma.sql`a.dados_anteriores`)} AS ant) d`;
  const estoqueNov = num(Prisma.sql`d.nov ->> 'estoque_atual'`);
  const estoqueAnt = num(Prisma.sql`d.ant ->> 'estoque_atual'`);
  const auditoria = await tx.$queryRaw`SELECT entidade, entidade_id, acao, produto_id, empresa_id, local_estoque_id, local_estoque_id_anterior, COUNT(*)::int AS n
    FROM (
      SELECT a.entidade, a.entidade_id, a.acao, a.entidade_id AS produto_id,
             COALESCE(d.nov ->> 'empresa_id', d.ant ->> 'empresa_id') AS empresa_id, NULL::text AS local_estoque_id, NULL::text AS local_estoque_id_anterior
      FROM "AuditLog" a ${dados}
      WHERE a.cliente_id = ${cli} AND a.entidade = 'Produto' AND a.entidade_id = ANY(${idsProdutos}::text[])
        AND jsonb_typeof(d.nov -> 'estoque_atual') IN ('number', 'string') AND ${estoqueNov} IS NOT NULL
        AND ((a.acao = 'create' AND ${estoqueNov} <> 0)
          OR (a.acao = 'update' AND jsonb_typeof(d.ant -> 'estoque_atual') IN ('number', 'string') AND ${estoqueAnt} IS NOT NULL AND ${estoqueNov} <> ${estoqueAnt}))
      UNION ALL
      SELECT a.entidade, a.entidade_id, a.acao,
             COALESCE(d.nov ->> 'produto_id', d.ant ->> 'produto_id'), COALESCE(d.nov ->> 'empresa_id', d.ant ->> 'empresa_id'),
             COALESCE(d.nov ->> 'local_estoque_id', d.ant ->> 'local_estoque_id'), d.ant ->> 'local_estoque_id'
      FROM (SELECT l.id FROM "EstoqueLoteNota" l WHERE l.cliente_id = ${cli}${escopo('l', f, faixa)}) lf
      CROSS JOIN LATERAL (SELECT * FROM "AuditLog" a0 WHERE a0.cliente_id = ${cli} AND a0.entidade = 'EstoqueLoteNota' AND a0.entidade_id = lf.id) a
      ${dados}
      WHERE a.acao IN ('create', 'delete') OR (a.acao = 'update' AND (
        EXISTS (SELECT 1 FROM unnest(${CAMPOS_QUANTIDADE_LOTE}::text[]) k(c)
                WHERE (d.nov -> k.c) IS NOT NULL AND (d.ant -> k.c) IS NOT NULL AND ${num(Prisma.sql`d.nov ->> k.c`)} IS DISTINCT FROM ${num(Prisma.sql`d.ant ->> k.c`)})
        OR EXISTS (SELECT 1 FROM unnest(${CAMPOS_VINCULO_LOTE}::text[]) k(c)
                WHERE (d.nov -> k.c) IS NOT NULL AND (d.ant -> k.c) IS NOT NULL AND (d.nov -> k.c) IS DISTINCT FROM (d.ant -> k.c))))
    ) ev
    GROUP BY 1, 2, 3, 4, 5, 6, 7
    ORDER BY 1, 2, 3`;

  return { locais, lotes, movimentos, auditoria };
};

/**
 * Exclusões legadas de lote (o lote já não existe: o produto só aparece no
 * JSON do AuditLog). Uma consulta por CHAMADA; o conjunto é fechado (o DELETE
 * genérico é recusado desde a F3, sem AuditLog).
 */
const lerLotesExcluidos = (tx, cli, f) => tx.$queryRaw`SELECT entidade, entidade_id, acao, produto_id, empresa_id, local_estoque_id, NULL::text AS local_estoque_id_anterior, COUNT(*)::int AS n
    FROM (
      SELECT a.entidade, a.entidade_id, a.acao,
             COALESCE(d.ant ->> 'produto_id', d.nov ->> 'produto_id') AS produto_id,
             COALESCE(d.ant ->> 'empresa_id', d.nov ->> 'empresa_id') AS empresa_id,
             COALESCE(d.ant ->> 'local_estoque_id', d.nov ->> 'local_estoque_id') AS local_estoque_id
      FROM "AuditLog" a
      CROSS JOIN LATERAL (SELECT ${objeto(Prisma.sql`a.dados_novos`)} AS nov, ${objeto(Prisma.sql`a.dados_anteriores`)} AS ant) d
      WHERE a.cliente_id = ${cli} AND a.entidade = 'EstoqueLoteNota' AND a.acao = 'delete'
        AND NOT EXISTS (SELECT 1 FROM "EstoqueLoteNota" l WHERE l.cliente_id = ${cli} AND l.id = a.entidade_id)
    ) ev
    WHERE produto_id IS NOT NULL${igual('ev.empresa_id', f.empresaId)}${igual('ev.produto_id', f.produtoId)}
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY 1, 2, 3`;

// ─── classificação pura ─────────────────────────────────────────────────────
const d = (v) => (v === null || v === undefined || v === '' ? ZERO : dec(v));
const chaveLocal = (empresaId, produtoId, localId) => `${empresaId}\u0000${produtoId}\u0000${localId}`;
/** Agrupa a evidência do AuditLog por uma ou mais chaves (a mesma linha vale para cada chave distinta). */
const agrupar = (linhas, chaves) => {
  /** @type {Map<string, any[]>} */
  const mapa = new Map();
  for (const l of linhas) {
    for (const k of new Set([chaves(l)].flat())) {
      if (k === null || k === undefined) continue;
      mapa.set(k, [...(mapa.get(k) ?? []), l]);
    }
  }
  return mapa;
};
const tagsAuditoria = (lista) => [...new Set(lista.map((a) => `auditoria:${a.entidade}:${a.acao}`))];
/** Ordem total dos achados: classe mais grave, depois nível, depois a chave. */
const compararAchados = (a, b) =>
  GRAVIDADE[a.classe] - GRAVIDADE[b.classe]
  || NIVEIS.indexOf(a.nivel) - NIVEIS.indexOf(b.nivel)
  || JSON.stringify(a.chave).localeCompare(JSON.stringify(b.chave));

/**
 * Sinais disparados → achado (ou null = OK). A primeira classe em CLASSES que
 * tiver sinal vale; dentro dela, a primeira regra na ordem em que foi
 * conferida. As demais regras e a evidência do AuditLog vão em `evidencias`.
 * @param {'produto'|'local'|'lote'|'movimento'} nivel
 * @param {Array<[string, string]>} sinais [classe, regra]
 * @param {Record<string, string|null>} chave
 * @param {{ esperado?: any, observado?: any }} medida
 * @param {string[]} [extras]
 */
const achadoDe = (nivel, sinais, chave, medida, extras = []) => {
  if (!sinais.length) return null;
  const principal = CLASSES.map((c) => sinais.find(([classe]) => classe === c)).find(Boolean);
  const [classe, regra] = /** @type {[string, string]} */ (principal);
  const esperado = medida.esperado === undefined || medida.esperado === null ? null : d(medida.esperado);
  const observado = medida.observado === undefined || medida.observado === null ? null : d(medida.observado);
  return {
    nivel, classe, regra, chave,
    esperado: esperado ? esperado.toFixed(CASAS_QUANTIDADE) : null,
    observado: observado ? observado.toFixed(CASAS_QUANTIDADE) : null,
    diferenca: esperado && observado ? observado.minus(esperado).toFixed(CASAS_QUANTIDADE) : null,
    evidencias: [...new Set([...sinais.filter(([, r]) => r !== regra).map(([, r]) => r), ...extras])],
  };
};
const dentroDaTolerancia = (dif, n) => n > 0 && !dif.isZero() && dif.abs().lte(TOLERANCIA_POR_FATIA.times(n));

/**
 * Classificação PURA (sem banco), exportada para teste unitário: as linhas das
 * consultas (de uma página ou de tudo) viram achados e o resumo por classe.
 * A `auditoria` já chega filtrada pela RELEVÂNCIA (Q5); aqui ela só é ligada ao
 * produto (escritas de `estoque_atual` dele e de quantidade/situação dos lotes
 * dele), ao local (lotes daquele local, antes ou depois) e ao lote (o próprio).
 * @param {{ produtos: any[], locais: any[], lotes: any[], movimentos: any[], auditoria: any[] }} linhas
 */
export const classificarReconciliacao = (linhas) => {
  const { produtos = [], locais = [], lotes = [], movimentos = [], auditoria = [] } = linhas;
  const audLotes = auditoria.filter((a) => a.entidade === 'EstoqueLoteNota');
  const audProduto = agrupar(auditoria.filter((a) => a.entidade === 'Produto'), (a) => a.entidade_id);
  const audLote = agrupar(audLotes, (a) => a.entidade_id);
  const audDoProduto = agrupar(audLotes, (a) => a.produto_id);
  const audDoLocal = agrupar(audLotes, (a) => [a.local_estoque_id, a.local_estoque_id_anterior].filter(Boolean).map((loc) => chaveLocal(a.empresa_id, a.produto_id, loc)));
  /** (empresa, produto, local) com Saída legada de suplementação/transferência SEM recibo: o consumo não tem como ser atribuído. */
  const semRecibo = new Set(movimentos.filter((m) => m.legado && !m.tem_recibo).map((m) => chaveLocal(m.empresa_id, m.produto_id, m.local_estoque_id)));
  /** @type {any[]} */
  const achados = [];
  const registrar = (a) => { if (a) achados.push(a); };

  // ── produto (I1) ──
  for (const p of produtos) {
    const cache = d(p.estoque_atual);
    const saldo = d(p.saldo_lotes);
    const dif = cache.minus(saldo);
    /** @type {Array<[string, string]>} */
    const s = [];
    const audP = audProduto.get(p.id) ?? [];
    const audOutros = audDoProduto.get(p.id) ?? [];
    if (!dif.isZero() || cache.lt(0)) {
      if (p.n_lotes_outra_empresa > 0 || p.n_movimentos_outra_empresa > 0) s.push([DI, 'empresa_divergente']);
      if (p.n_lotes_status_desconhecido > 0) s.push([DI, 'lote_inclassificavel']);
      if (p.n_lotes === 0 && !audP.length && !audOutros.length) s.push([DI, 'cache_sem_lote']);
      if (audP.length) s.push([LL, 'cache_escrito_fora_do_motor']);
      if (p.n_lotes_sem_movimento_entrada > 0 || p.n_movimentos_fora_do_protocolo > 0 || audOutros.length) s.push([LL, 'cache_diverge_legado']);
      if (dentroDaTolerancia(dif, p.n_saidas_legadas)) s.push([LL, 'residuo_number_legado']);
      s.push([DR, cache.lt(0) ? 'cache_negativo' : 'cache_diverge']);
    }
    registrar(achadoDe('produto', s, { empresa_id: p.empresa_id, produto_id: p.id }, { esperado: saldo, observado: cache }, tagsAuditoria([...audP, ...audOutros])));
  }

  // ── (empresa, produto, local) (I2) ──
  for (const r of locais) {
    const lotesL = d(r.saldo_lotes);
    const razao = d(r.saldo_razao);
    const dif = lotesL.minus(razao);
    /** @type {Array<[string, string]>} */
    const s = [];
    const aud = audDoLocal.get(chaveLocal(r.empresa_id, r.produto_id, r.local_estoque_id)) ?? [];
    if (r.produto_inexistente) s.push([DI, 'produto_inexistente']);
    if (r.local_inexistente) s.push([DI, 'local_inexistente']);
    if (r.n_status_desconhecido > 0) s.push([DI, 'status_desconhecido']);
    if (r.n_tipo_desconhecido > 0) s.push([DI, 'tipo_desconhecido']);
    if (!r.produto_inexistente && r.produto_empresa_id !== r.empresa_id) s.push([DI, 'empresa_divergente']);
    if (!dif.isZero() || lotesL.lt(0)) {
      if (r.n_sem_movimento_entrada > 0 || r.n_fora_do_protocolo > 0 || aud.length) s.push([LL, 'razao_diverge_legado']);
      if (dentroDaTolerancia(dif, r.n_saidas_legadas)) s.push([LL, 'residuo_number_legado']);
      s.push([DR, lotesL.lt(0) ? 'saldo_negativo' : 'razao_diverge']);
    }
    registrar(achadoDe('local', s, { empresa_id: r.empresa_id, produto_id: r.produto_id, local_estoque_id: r.local_estoque_id }, { esperado: razao, observado: lotesL }, tagsAuditoria(aud)));
  }

  // ── lote (I3, I4 da entrada) ──
  for (const l of lotes) {
    const entrada = d(l.entrada);
    const disp = d(l.disponivel);
    const observado = entrada.minus(disp);
    const explicado = somar([l.consumo_financeiro, l.consumo_abastecimento, l.consumo_movimentos, l.consumo_recibos].map(d)).plus(l.compra_estornada ? entrada : ZERO);
    const dif = observado.minus(explicado);
    const statusConhecido = STATUS_LOTE.includes(l.status);
    const zeradoDisponivel = l.status === 'Disponivel' && disp.isZero();
    /** @type {Array<[string, string]>} */
    const s = [];
    const aud = audLote.get(l.id) ?? [];
    if (l.produto_inexistente) s.push([DI, 'produto_inexistente']);
    if (!statusConhecido) s.push([DI, 'status_desconhecido']);
    if (!l.produto_inexistente && l.produto_empresa_id !== l.empresa_id) s.push([DI, 'empresa_divergente']);
    if (l.local_inexistente) s.push([DI, 'local_inexistente']);
    if (l.movimentacao_entrada_id && !l.tem_movimento_entrada) s.push([DI, 'movimento_entrada_inexistente']);
    if (!dif.isZero() && semRecibo.has(chaveLocal(l.empresa_id, l.produto_id, l.local_estoque_id))) s.push([DI, 'consumo_legado_sem_recibo']);
    if (!dif.isZero() && l.fatias_recibo_fora_janela > 0) s.push([DI, 'recibo_fora_da_janela']);
    if (!l.movimentacao_entrada_id) s.push([LL, 'lote_sem_movimento_entrada']);
    if (aud.length) s.push([LL, 'lote_escrito_fora_do_motor']);
    if (l.tem_movimento_entrada && !ORIGENS_PROTOCOLO.includes(l.entrada_origem)) s.push([LL, 'entrada_fora_do_protocolo']);
    if (l.entrada_tipo_detalhado === 'transferencia_recebida' && l.data_antiga) s.push([LL, 'data_transferencia_2001']);
    if (zeradoDisponivel && l.fatias_recibo > 0) s.push([LL, 'disponivel_zerado_legado']);
    if (dentroDaTolerancia(dif, l.fatias_recibo)) s.push([LL, 'residuo_number_legado']);
    if (disp.lt(0) || disp.gt(entrada)) s.push([DR, 'fora_da_faixa']);
    if (statusConhecido && disp.gt(0) && l.status !== 'Disponivel') s.push([DR, 'saldo_fora_de_disponivel']);
    if (zeradoDisponivel) s.push([DR, 'disponivel_zerado']);
    if (!dif.isZero()) s.push([DR, 'consumo_nao_explicado']);
    if (l.entrada_incoerente) s.push([DR, 'entrada_incoerente']);
    if (l.tem_movimento_entrada && !l.entrada_incoerente && l.entrada_tipo_detalhado !== 'transferencia_recebida' && !d(l.entrada_quantidade).eq(entrada)) {
      s.push([DR, 'entrada_diverge_do_movimento']);
    }
    registrar(achadoDe('lote', s, { empresa_id: l.empresa_id, produto_id: l.produto_id, local_estoque_id: l.local_estoque_id, lote_id: l.id },
      { esperado: explicado, observado }, tagsAuditoria(aud)));
  }

  // ── movimento (I4, I5) ──
  for (const m of movimentos) {
    const q = d(m.quantidade);
    /** @type {Array<[string, string]>} */
    const s = [];
    /** @type {{ esperado?: any, observado?: any }} */
    let medida = {};
    const fora = !ORIGENS_PROTOCOLO.includes(m.origem_sistema);
    if (m.produto_inexistente) s.push([DI, 'produto_inexistente']);
    if (m.tipo_desconhecido) s.push([DI, 'tipo_desconhecido']);
    if (m.status_desconhecido) s.push([DI, 'status_desconhecido']);
    if (!m.produto_inexistente && m.produto_empresa_id !== m.empresa_id) s.push([DI, 'empresa_divergente']);
    if (fora && !ORIGENS_LEGADAS.includes(m.origem_sistema)) s.push([DI, 'origem_desconhecida']);
    if (m.n_fatias_json_ilegiveis > 0) s.push([DI, 'fatias_ilegiveis']);
    if (m.legado && !m.tem_recibo) s.push([DI, 'consumo_legado_sem_recibo']);
    if (fora && ORIGENS_LEGADAS.includes(m.origem_sistema)) s.push([LL, 'origem_fora_do_protocolo']);
    if (m.numero_provisorio) s.push([DR, 'numero_provisorio']);
    if (m.estornada_sem_filho) s.push([DR, 'estorno_sem_filho']);
    else if (m.par_incoerente) s.push([DR, 'par_incoerente']);
    if (m.tem_fatias_json && !d(m.soma_fatias_json).eq(q)) {
      s.push([DR, 'fatias_divergem_da_quantidade']);
      medida = { esperado: q, observado: d(m.soma_fatias_json) };
    }
    if (m.legado && m.tem_recibo && !d(m.soma_recibo).eq(q)) {
      const dif = d(m.soma_recibo).minus(q);
      if (dentroDaTolerancia(dif, m.n_fatias_recibo)) s.push([LL, 'residuo_number_legado']);
      s.push([DR, 'fatias_divergem_da_quantidade']);
      medida = { esperado: q, observado: d(m.soma_recibo) };
    }
    if ((m.transferencia_recebida || m.exige_camada) && !d(m.soma_lotes_destino).eq(q)) {
      const dif = d(m.soma_lotes_destino).minus(q);
      if (m.transferencia_recebida && m.pai_legado && dentroDaTolerancia(dif, 1)) s.push([LL, 'residuo_number_legado']);
      s.push([DR, m.soma_lotes_destino === null || m.soma_lotes_destino === undefined ? 'entrada_sem_lote' : 'lotes_de_entrada_divergem']);
      medida = { esperado: q, observado: d(m.soma_lotes_destino) };
    }
    if (m.exige_fk && !d(m.soma_fk).eq(q)) {
      s.push([DR, 'fatias_divergem_da_quantidade']);
      medida = { esperado: q, observado: d(m.soma_fk) };
    }
    registrar(achadoDe('movimento', s, { empresa_id: m.empresa_id, produto_id: m.produto_id, local_estoque_id: m.local_estoque_id ?? null, movimento_id: m.id }, medida));
  }

  const totais = {
    produtos: produtos.length,
    locais: locais.length,
    lotes: lotes.length,
    movimentos: locais.reduce((t, r) => t + Number(r.n_movimentos ?? 0), 0),
  };
  // Q2 e Q4 usam o MESMO escopo de movimento (cliente, empresa, produto e o local do lado que o movimento afeta).
  const naoOk = { DIVERGENCIA_REAL: 0, LIMITACAO_LEGADA: 0, DADOS_INSUFICIENTES: 0 };
  for (const a of achados) naoOk[/** @type {keyof typeof naoOk} */ (a.classe)] += 1;
  const total = totais.produtos + totais.locais + totais.lotes + totais.movimentos;
  return {
    resumo: { ...totais, por_classe: { OK: total - achados.length, ...naoOk } },
    achados: achados.sort(compararAchados),
  };
};

// ─── varredura limitada ─────────────────────────────────────────────────────
/** Orçamento efetivo: inteiros ≥ 0 (tempo) ou ≥ 1, nunca acima do teto. */
const normalizarOrcamento = (o = {}) => {
  /** @type {Record<string, number>} */
  const r = {};
  for (const [k, padrao] of Object.entries(ORCAMENTO_PADRAO)) {
    const v = /** @type {any} */ (o)?.[k];
    const minimo = k === 'tempoMs' ? 0 : 1;
    r[k] = Number.isInteger(v) ? Math.min(Math.max(v, minimo), ORCAMENTO_TETO[/** @type {keyof typeof ORCAMENTO_TETO} */ (k)]) : padrao;
  }
  return /** @type {typeof ORCAMENTO_PADRAO} */ (r);
};

/** Cursor opaco da continuação: o último produto varrido + o escopo a que pertence. */
const codificarCursor = (apos, f) =>
  Buffer.from(JSON.stringify({ v: VERSAO_CURSOR, apos, e: f.empresaId, p: f.produtoId, l: f.localId }), 'utf8').toString('base64url');
/**
 * Cursor adulterado, de outra versão ou de OUTRO escopo (empresa/produto/local)
 * → 400 antes de qualquer ida ao banco. Um id de produto de outro tenant só
 * posiciona o keyset dentro do tenant do auth_context (não é oráculo).
 * @param {unknown} bruto
 * @param {{ empresaId: string|null, produtoId: string|null, localId: string|null }} f
 */
const decodificarCursor = (bruto, f) => {
  const invalido = (reason) => new AppError('REQUEST_VALIDATION_FAILED', 'cursor da reconciliação inválido', { details: { field: 'cursor', reason } });
  if (typeof bruto !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(bruto)) throw invalido('cursor_invalido');
  /** @type {any} */
  let c;
  try {
    c = JSON.parse(Buffer.from(bruto, 'base64url').toString('utf8'));
  } catch {
    throw invalido('cursor_invalido');
  }
  const chaves = ['v', 'apos', 'e', 'p', 'l'];
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some((k) => !chaves.includes(k))
    || c.v !== VERSAO_CURSOR || typeof c.apos !== 'string' || !ID_DE_CURSOR.test(c.apos)) throw invalido('cursor_invalido');
  if ((c.e ?? null) !== f.empresaId || (c.p ?? null) !== f.produtoId || (c.l ?? null) !== f.localId) throw invalido('cursor_de_outro_escopo');
  return c.apos;
};

/**
 * A varredura da reconciliação, num `tx` já aberto (a rota abre a transação
 * RepeatableRead; o teste mede as idas ao banco com o próprio `tx`). Idas ao
 * banco: `SET TRANSACTION READ ONLY`, `plan_cache_mode`, a empresa (se
 * filtrada), a pré-contagem do escopo e as exclusões legadas de lote, e 5 por
 * página (Q1 com a pré-contagem da página, Q2–Q5 da faixa).
 * @param {any} tx
 * @param {string} cli tenant do auth_context
 * @param {{ empresaId?: string|null, produtoId?: string|null, localId?: string|null, apos?: string|null, limite?: number }} filtro
 * @param {Partial<typeof ORCAMENTO_PADRAO>} [orcamento]
 */
export const lerReconciliacao = async (tx, cli, filtro = {}, orcamento = undefined) => {
  await tx.$queryRaw`SET TRANSACTION READ ONLY`;
  await tx.$queryRaw`SELECT set_config('plan_cache_mode', 'force_custom_plan', true)`;
  const inicio = Date.now();
  const f = { empresaId: filtro.empresaId ?? null, produtoId: filtro.produtoId ?? null, localId: filtro.localId ?? null };
  const apos = filtro.apos ?? null;
  const limite = Number.isInteger(filtro.limite) ? /** @type {number} */ (filtro.limite) : LIMITE_PADRAO;
  const o = normalizarOrcamento(orcamento);
  if (f.empresaId !== null) await exigirEmpresaDoTenant(tx, cli, f.empresaId);

  const [contagem] = /** @type {any[]} */ (await tx.$queryRaw`SELECT count(*)::int AS total,
      ${apos === null ? Prisma.sql`0` : Prisma.sql`(count(*) FILTER (WHERE p.id <= ${apos}))`}::int AS antes
    FROM "Produto" p WHERE p.cliente_id = ${cli}${igual('p.empresa_id', f.empresaId)}${igual('p.id', f.produtoId)}`);
  const excluidos = /** @type {any[]} */ (await lerLotesExcluidos(tx, cli, f));

  const totais = { produtos: 0, locais: 0, lotes: 0, movimentos: 0 };
  const naoOk = { DIVERGENCIA_REAL: 0, LIMITACAO_LEGADA: 0, DADOS_INSUFICIENTES: 0 };
  /** @type {any[]} */
  let achados = [];
  let desde = apos;
  let paginas = 0;
  let varridos = 0;
  let linhasPrevistas = 0;
  /** @type {null|'orcamento'|'tempo'} */
  let interrompida = null;
  let fim = false;
  while (!fim) {
    const candidatos = /** @type {any[]} */ (await lerProdutos(tx, cli, f, desde, o.produtosPorPagina + 1));
    let k = 0;
    let custo = 0;
    while (k < candidatos.length && k < o.produtosPorPagina) {
      const c = 1 + candidatos[k].n_lotes + candidatos[k].n_movimentos;
      if (k > 0 && custo + c > o.linhasPorPagina) break;
      custo += c;
      k += 1;
    }
    const produtos = candidatos.slice(0, k);
    fim = k === candidatos.length;
    const ate = fim ? null : produtos[k - 1].id;
    const pagina = await lerPagina(tx, cli, f, { desde, ate }, produtos.map((p) => p.id));
    const daPagina = new Set([...produtos.map((p) => p.id), ...pagina.locais.map((r) => r.produto_id), ...pagina.lotes.map((l) => l.produto_id)]);
    const r = classificarReconciliacao({ produtos, ...pagina, auditoria: [...pagina.auditoria, ...excluidos.filter((x) => daPagina.has(x.produto_id))] });
    for (const c of /** @type {(keyof typeof totais)[]} */ (Object.keys(totais))) totais[c] += r.resumo[c];
    for (const c of /** @type {(keyof typeof naoOk)[]} */ (Object.keys(naoOk))) naoOk[c] += r.resumo.por_classe[c];
    achados = [...achados, ...r.achados].sort(compararAchados).slice(0, limite);
    paginas += 1;
    varridos += k;
    linhasPrevistas += custo;
    desde = ate;
    if (!fim) {
      if (linhasPrevistas >= o.linhasPorChamada) interrompida = 'orcamento';
      else if (Date.now() - inicio >= o.tempoMs) interrompida = 'tempo';
      if (interrompida) break;
    }
  }

  const completa = apos === null && fim;
  const totalAchados = naoOk.DIVERGENCIA_REAL + naoOk.LIMITACAO_LEGADA + naoOk.DADOS_INSUFICIENTES;
  const entidades = totais.produtos + totais.locais + totais.lotes + totais.movimentos;
  return {
    truncado: totalAchados > limite,
    cobertura: {
      completa,
      nivel_produto: 'todos_os_locais',
      produtos_no_escopo: contagem.total,
      produtos_antes_do_cursor: contagem.antes,
      produtos_varridos: varridos,
      produtos_restantes: Math.max(contagem.total - contagem.antes - varridos, 0),
      paginas,
      linhas_previstas: linhasPrevistas,
      interrompida_por: interrompida,
      proximo_cursor: fim ? null : codificarCursor(/** @type {string} */ (desde), f),
    },
    resumo: {
      situacao: !completa ? 'INCOMPLETO' : totalAchados ? 'COM_ACHADOS' : 'CONSISTENTE',
      ...totais,
      // Sobre dados parciais nada é declarado OK: só as classes encontradas (limite inferior).
      por_classe: { OK: completa ? entidades - totalAchados : null, ...naoOk },
    },
    achados,
  };
};

// ─── serviço ────────────────────────────────────────────────────────────────
/** Filtro da querystring já validada pelo schema; `limite` padrão 500, máximo 2000; o cursor é conferido aqui (400 sem I/O). */
const normalizarFiltro = (filtro) => {
  const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const limite = Number.isInteger(filtro?.limite) ? Math.min(Math.max(/** @type {number} */ (filtro.limite), 1), LIMITE_MAXIMO) : LIMITE_PADRAO;
  const f = { empresaId: texto(filtro?.empresaId), produtoId: texto(filtro?.produtoId), localId: texto(filtro?.localId), limite };
  const apos = filtro?.cursor === undefined || filtro?.cursor === null ? null : decodificarCursor(filtro.cursor, f);
  return { ...f, apos };
};

/**
 * Reconciliação SOMENTE LEITURA do estoque físico do tenant (SPEC §5), com
 * varredura limitada e cursor de continuação (R1).
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext, requestId?: string }} contexto  tenant SÓ de auth_context (R11)
 * @param {{ empresaId?: string, produtoId?: string, localId?: string, limite?: number, cursor?: string }} [filtro]  limite padrão 500, máx 2000
 * @param {Partial<typeof ORCAMENTO_PADRAO>} [orcamento] só chamadas internas/testes; o HTTP usa `ORCAMENTO_PADRAO`
 */
export const reconciliarEstoque = async (contexto, filtro = {}, orcamento = undefined) => {
  const auth = exigirAuthContext(contexto?.auth);
  const f = normalizarFiltro(filtro);
  const r = await emTransacao(LEITURA, (tx) => lerReconciliacao(tx, auth.clienteId, f, orcamento));
  return {
    escopo: { empresa_id: f.empresaId, produto_id: f.produtoId, local_estoque_id: f.localId, limite: f.limite },
    gerado_em: agoraDoServidor().toISOString(),
    truncado: r.truncado,
    cobertura: r.cobertura,
    resumo: r.resumo,
    achados: r.achados,
  };
};
