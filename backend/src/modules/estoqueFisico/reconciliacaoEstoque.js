/**
 * D-PROD-161 (Estoque P0, fatia F4) — RECONCILIAÇÃO SOMENTE LEITURA do estoque
 * físico (SPEC §5). Confere os invariantes do motor único e classifica o que
 * não fecha; NUNCA corrige nada (sem auto-reparo: o saneamento é da P1, com GO).
 *
 * Invariantes conferidos (SPEC §1.2):
 *  I1 cache    `Produto.estoque_atual` = Σ disponível dos lotes 'Disponivel' da
 *              empresa do produto, em todos os locais;
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
 *
 * Leitura (SPEC §5.1): uma transação RepeatableRead (um só snapshot) cuja
 * PRIMEIRA instrução é `SET TRANSACTION READ ONLY` (defesa extra: o PostgreSQL
 * recusa qualquer escrita nela); nenhuma trava de linha nem advisory, então
 * nunca espera nem bloqueia confirmar/cancelar/suplementar. Número FIXO de idas
 * ao banco (≤ 7: READ ONLY, empresa, Q1–Q5), sem N+1; listas entram como
 * `::text[]` e todo WHERE começa por `cliente_id` (índices `(cliente_id,
 * produto_id)` de lote e movimento). Quantidades viram `::text` no SQL e `Dec`
 * aqui; nunca Number. O tenant vem SÓ do `auth_context` (R11). A resposta tem
 * só ids do próprio tenant: nenhum `dados_*` do AuditLog nem dado de usuário.
 */

import { Prisma } from '@prisma/client';

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { CASAS_QUANTIDADE, Dec, ZERO, dec, somar } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { agoraDoServidor } from '../rebanhoLedger/rebanhoLedgerTempo.js';

/**
 * Origens de movimento do protocolo (motor físico único). Declaradas aqui para
 * não depender da fatia F1; os valores são os de `estoqueFisicoMotor.js`
 * (`ORIGEM_SISTEMA`, `ORIGEM_ABASTECIMENTO`, `ORIGEM_SUPLEMENTACAO`, `ORIGEM_DEPOSITO`).
 */
export const ORIGENS_PROTOCOLO = Object.freeze(['operacao_financeira', 'abastecimento_patrimonio', 'suplementacao', 'deposito']);
/** Origens cuja fatia vive em JSON (`lotes_consumidos`) ou, no legado, só no recibo. */
const ORIGENS_SEM_FK = Object.freeze(['suplementacao', 'deposito']);
/** Origens com fatia FK própria (`OperacaoFinanceiraConsumoLote`, `AbastecimentoBemConsumoLote`). */
const ORIGENS_COM_FK = Object.freeze(['operacao_financeira', 'abastecimento_patrimonio']);
/** Escritores genéricos antigos (POST de movimento, reversão pelo navegador). */
const ORIGENS_LEGADAS = Object.freeze(['manual', 'reversao']);
const STATUS_LOTE = Object.freeze(['Disponivel', 'Esgotado', 'Estornado']);
const TIPOS_MOVIMENTO = Object.freeze(['Entrada', 'Saída']);
const STATUS_MOVIMENTO = Object.freeze(['Ativa', 'Estornada']);
/** Recibos dos comandos de estoque que guardam o rateio FIFO (`response_json.rateio`). */
const TIPOS_RECIBO = Object.freeze(['saida_suplementacao', 'transferencia_locais']);
/** Colunas do lote que um PATCH pode mudar sem ser escritor fora do protocolo (renomeação do local). */
const CAMPOS_LIVRES_LOTE = Object.freeze(['local_estoque_nome', 'updated_date', 'updatedAt']);
const ENTIDADES_AUDITADAS = Object.freeze(['Produto', 'EstoqueLoteNota', 'MovimentacaoEstoque']);
/** Resíduo de Number por fatia (ou baixa) legada: 1 unidade da 4ª casa. */
const TOLERANCIA_POR_FATIA = new Dec('0.0001');

export const LIMITE_PADRAO = 500;
export const LIMITE_MAXIMO = 2000;
/** Mesmo padrão de `TX_LEITURA`/`LEITURA` dos serviços de financeiro e abastecimento (SPEC §5.1). */
const LEITURA = Object.freeze({ maxWait: 2000, timeout: 20000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

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

/** Recibos committed dos comandos de estoque: id do movimento (suplementação ou saída da transferência) + rateio. */
const recibosSql = (cli) => Prisma.sql`SELECT o."createdAt" AS criado_em,
    COALESCE(${objeto(Prisma.sql`o.response_json`)} -> 'movimentacao' ->> 'id', ${objeto(Prisma.sql`o.response_json`)} -> 'movimentacao_saida' ->> 'id') AS movimento_id,
    ${lista(Prisma.sql`${objeto(Prisma.sql`o.response_json`)} -> 'rateio'`)} AS rateio
  FROM "OperacaoIdempotente" o
  WHERE o.cliente_id = ${cli} AND o.tipo_operacao = ANY(${TIPOS_RECIBO}::text[]) AND o.status = 'committed' AND o.response_json IS NOT NULL`;

/**
 * As consultas da reconciliação, num `tx` já aberto (a rota abre a transação
 * RepeatableRead; o teste mede as idas ao banco com o próprio `tx`). Número
 * FIXO de idas: `SET TRANSACTION READ ONLY`, a empresa (se filtrada) e Q1–Q5.
 * Os órfãos (Q6 da SPEC) saem de Q2–Q4 por LEFT JOIN em Produto.
 * @param {any} tx
 * @param {string} cli tenant do auth_context
 * @param {{ empresaId?: string|null, produtoId?: string|null, localId?: string|null }} filtro
 */
export const lerReconciliacao = async (tx, cli, filtro = {}) => {
  await tx.$queryRaw`SET TRANSACTION READ ONLY`;
  const emp = filtro.empresaId ?? null;
  const prod = filtro.produtoId ?? null;
  const loc = filtro.localId ?? null;
  if (emp !== null) await exigirEmpresaDoTenant(tx, cli, emp);

  // Q1 — produtos do escopo + o necessário para I1 (todos os locais, todas as empresas dos lotes).
  const produtos = await tx.$queryRaw`SELECT p.id, p.empresa_id, p.estoque_atual::text AS estoque_atual,
      COALESCE(l.saldo, 0)::text AS saldo_lotes,
      COALESCE(l.n_lotes, 0)::int AS n_lotes,
      COALESCE(l.n_outra_empresa, 0)::int AS n_lotes_outra_empresa,
      COALESCE(l.n_status_desconhecido, 0)::int AS n_lotes_status_desconhecido,
      COALESCE(l.n_sem_movimento_entrada, 0)::int AS n_lotes_sem_movimento_entrada,
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
      SELECT COUNT(*) FILTER (WHERE y.empresa_id <> p.empresa_id) AS n_outra_empresa,
             COUNT(*) FILTER (WHERE y.origem_sistema <> ALL(${ORIGENS_PROTOCOLO}::text[])) AS n_fora_do_protocolo,
             COUNT(*) FILTER (WHERE y.tipo_movimentacao = 'Saída' AND y.origem_sistema = ANY(${ORIGENS_SEM_FK}::text[]) AND y.lotes_consumidos IS NULL) AS n_saidas_legadas
      FROM "MovimentacaoEstoque" y WHERE y.cliente_id = p.cliente_id AND y.produto_id = p.id
    ) m ON true
    WHERE p.cliente_id = ${cli} AND (${emp}::text IS NULL OR p.empresa_id = ${emp}) AND (${prod}::text IS NULL OR p.id = ${prod})
    ORDER BY p.id`;

  // Q2 — por (empresa, produto, local): lotes × razão dos movimentos (+ local/produto inexistentes).
  const locais = await tx.$queryRaw`WITH lot AS (
      SELECT l.empresa_id, l.produto_id, l.local_estoque_id AS local_id,
             COALESCE(SUM(l.quantidade_disponivel) FILTER (WHERE l.status = 'Disponivel'), 0) AS saldo_lotes,
             COUNT(*) AS n_lotes,
             COUNT(*) FILTER (WHERE l.status <> ALL(${STATUS_LOTE}::text[])) AS n_status_desconhecido,
             COUNT(*) FILTER (WHERE l.movimentacao_entrada_id IS NULL) AS n_sem_movimento_entrada
      FROM "EstoqueLoteNota" l
      WHERE l.cliente_id = ${cli} AND (${emp}::text IS NULL OR l.empresa_id = ${emp}) AND (${prod}::text IS NULL OR l.produto_id = ${prod})
      GROUP BY 1, 2, 3
    ), mov AS (
      SELECT m.empresa_id, m.produto_id,
             CASE m.tipo_movimentacao WHEN 'Entrada' THEN m.local_estoque_destino WHEN 'Saída' THEN m.local_estoque_origem END AS local_id,
             COALESCE(SUM(CASE m.tipo_movimentacao WHEN 'Entrada' THEN m.quantidade WHEN 'Saída' THEN -m.quantidade ELSE 0 END), 0) AS saldo_razao,
             COUNT(*) AS n_movimentos,
             COUNT(*) FILTER (WHERE m.tipo_movimentacao <> ALL(${TIPOS_MOVIMENTO}::text[])) AS n_tipo_desconhecido,
             COUNT(*) FILTER (WHERE m.origem_sistema <> ALL(${ORIGENS_PROTOCOLO}::text[])) AS n_fora_do_protocolo,
             COUNT(*) FILTER (WHERE m.tipo_movimentacao = 'Saída' AND m.origem_sistema = ANY(${ORIGENS_SEM_FK}::text[]) AND m.lotes_consumidos IS NULL) AS n_saidas_legadas
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${cli} AND (${emp}::text IS NULL OR m.empresa_id = ${emp}) AND (${prod}::text IS NULL OR m.produto_id = ${prod})
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
    WHERE ${loc}::text IS NULL OR COALESCE(lot.local_id, mov.local_id) = ${loc}
    ORDER BY 2, 1, 3`;

  // Q3 — por lote: consumo observado × explicado, coerência da situação e do movimento de entrada.
  const lotes = await tx.$queryRaw`WITH lt AS (
      SELECT l.id, l.empresa_id, l.produto_id, l.local_estoque_id, l.status, l.quantidade_entrada, l.quantidade_disponivel,
             l.movimentacao_entrada_id, l.data_documento, l."createdAt"
      FROM "EstoqueLoteNota" l
      WHERE l.cliente_id = ${cli} AND (${emp}::text IS NULL OR l.empresa_id = ${emp}) AND (${prod}::text IS NULL OR l.produto_id = ${prod})
        AND (${loc}::text IS NULL OR l.local_estoque_id = ${loc})
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
      WHERE m.cliente_id = ${cli} AND (${emp}::text IS NULL OR m.empresa_id = ${emp}) AND (${prod}::text IS NULL OR m.produto_id = ${prod})
        AND m.tipo_movimentacao = 'Saída' AND m.status = 'Ativa' AND m.origem_sistema = ANY(${ORIGENS_SEM_FK}::text[]) AND m.lotes_consumidos IS NOT NULL
      GROUP BY 1
    ), rcb AS (${recibosSql(cli)}
    ), leg AS (
      SELECT lt.id AS lote_id,
             SUM(${num(Prisma.sql`e.elem ->> 'quantidade_consumida'`)}) FILTER (WHERE r.criado_em >= lt."createdAt" - interval '1 hour') AS consumido,
             COUNT(*) FILTER (WHERE r.criado_em >= lt."createdAt" - interval '1 hour') AS fatias,
             COUNT(*) FILTER (WHERE r.criado_em < lt."createdAt" - interval '1 hour') AS fatias_fora_janela
      FROM rcb r
      JOIN "MovimentacaoEstoque" m ON m.cliente_id = ${cli} AND m.id = r.movimento_id
        AND m.lotes_consumidos IS NULL AND m.tipo_movimentacao = 'Saída' AND m.status = 'Ativa'
      CROSS JOIN LATERAL jsonb_array_elements(r.rateio) AS e(elem)
      JOIN lt ON lt.id = (e.elem ->> 'lote_id')
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
             m.numero_movimentacao, m.movimento_pai_id, m.movimento_filho_id, m.lotes_consumidos,
             CASE m.tipo_movimentacao WHEN 'Entrada' THEN m.local_estoque_destino WHEN 'Saída' THEN m.local_estoque_origem END AS local_id
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${cli} AND (${emp}::text IS NULL OR m.empresa_id = ${emp}) AND (${prod}::text IS NULL OR m.produto_id = ${prod})
    ), rcb AS (${recibosSql(cli)}
    ), rcm AS (
      SELECT r.movimento_id, SUM(${num(Prisma.sql`e.elem ->> 'quantidade_consumida'`)}) AS soma, COUNT(e.elem) AS n
      FROM rcb r LEFT JOIN LATERAL jsonb_array_elements(r.rateio) AS e(elem) ON true
      WHERE r.movimento_id IN (SELECT id FROM mv)
      GROUP BY 1
    ), lin AS (
      SELECT l.movimentacao_entrada_id AS movimento_id, SUM(l.quantidade_entrada) AS soma
      FROM "EstoqueLoteNota" l
      WHERE l.cliente_id = ${cli} AND l.movimentacao_entrada_id IS NOT NULL
        AND (${emp}::text IS NULL OR l.empresa_id = ${emp}) AND (${prod}::text IS NULL OR l.produto_id = ${prod})
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
             (mv.tipo_movimentacao = 'Saída' AND mv.origem_sistema = ANY(${ORIGENS_SEM_FK}::text[]) AND mv.lotes_consumidos IS NULL) AS legado,
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
      WHERE ${loc}::text IS NULL OR mv.local_id = ${loc}
    )
    SELECT * FROM x
    WHERE produto_inexistente OR tipo_desconhecido OR status_desconhecido OR produto_empresa_id IS DISTINCT FROM empresa_id
       OR origem_sistema <> ALL(${ORIGENS_PROTOCOLO}::text[]) OR numero_provisorio OR estornada_sem_filho OR par_incoerente
       OR (tem_fatias_json AND (n_fatias_json_ilegiveis > 0 OR soma_fatias_json IS DISTINCT FROM quantidade))
       OR (legado AND (NOT tem_recibo OR soma_recibo IS DISTINCT FROM quantidade))
       OR ((transferencia_recebida OR exige_camada) AND soma_lotes_destino IS DISTINCT FROM quantidade)
       OR (exige_fk AND soma_fk IS DISTINCT FROM quantidade)
    ORDER BY id`;

  // Q5 — evidência de escritor FORA do protocolo no AuditLog (só ids e ações: nenhum `dados_*` sai daqui).
  const auditoria = await tx.$queryRaw`SELECT entidade, entidade_id, acao, produto_id, empresa_id, local_estoque_id, COUNT(*)::int AS n
    FROM (
      SELECT a.entidade, a.entidade_id, a.acao,
             CASE WHEN a.entidade = 'Produto' THEN a.entidade_id ELSE COALESCE(d.nov ->> 'produto_id', d.ant ->> 'produto_id') END AS produto_id,
             COALESCE(d.nov ->> 'empresa_id', d.ant ->> 'empresa_id') AS empresa_id,
             COALESCE(d.nov ->> 'local_estoque_id', d.ant ->> 'local_estoque_id') AS local_estoque_id
      FROM "AuditLog" a
      CROSS JOIN LATERAL (SELECT ${objeto(Prisma.sql`a.dados_novos`)} AS nov, ${objeto(Prisma.sql`a.dados_anteriores`)} AS ant) d
      WHERE a.cliente_id = ${cli} AND a.entidade = ANY(${ENTIDADES_AUDITADAS}::text[])
        AND (
          (a.entidade = 'Produto' AND a.acao IN ('create', 'update') AND jsonb_typeof(d.nov -> 'estoque_atual') IN ('number', 'string')
            AND ${num(Prisma.sql`d.nov ->> 'estoque_atual'`)} IS DISTINCT FROM COALESCE(${num(Prisma.sql`d.ant ->> 'estoque_atual'`)}, 0))
          OR (a.entidade = 'EstoqueLoteNota' AND (a.acao IN ('create', 'delete') OR (a.acao = 'update' AND EXISTS (
            SELECT 1 FROM jsonb_each(d.nov) n FULL JOIN jsonb_each(d.ant) o ON o.key = n.key
            WHERE COALESCE(n.key, o.key) <> ALL(${CAMPOS_LIVRES_LOTE}::text[]) AND n.value IS DISTINCT FROM o.value))))
          OR (a.entidade = 'MovimentacaoEstoque' AND a.acao = 'create' AND COALESCE(d.nov ->> 'origem_sistema', '') <> ALL(${ORIGENS_PROTOCOLO}::text[]))
        )
    ) ev
    WHERE (${emp}::text IS NULL OR ev.empresa_id = ${emp}) AND (${prod}::text IS NULL OR ev.produto_id = ${prod})
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY 1, 2, 3`;

  return { produtos, locais, lotes, movimentos, auditoria };
};

// ─── classificação pura ─────────────────────────────────────────────────────
const d = (v) => (v === null || v === undefined || v === '' ? ZERO : dec(v));
const chaveLocal = (empresaId, produtoId, localId) => `${empresaId}\u0000${produtoId}\u0000${localId}`;
/** Agrupa a evidência do AuditLog por uma chave. */
const agrupar = (linhas, chave) => {
  /** @type {Map<string, any[]>} */
  const mapa = new Map();
  for (const l of linhas) {
    const k = chave(l);
    if (k === null || k === undefined) continue;
    mapa.set(k, [...(mapa.get(k) ?? []), l]);
  }
  return mapa;
};
const tagsAuditoria = (lista) => [...new Set(lista.map((a) => `auditoria:${a.entidade}:${a.acao}`))];

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
 * consultas viram achados e o resumo por classe.
 * @param {{ produtos: any[], locais: any[], lotes: any[], movimentos: any[], auditoria: any[] }} linhas
 */
export const classificarReconciliacao = (linhas) => {
  const { produtos = [], locais = [], lotes = [], movimentos = [], auditoria = [] } = linhas;
  const audProduto = agrupar(auditoria.filter((a) => a.entidade === 'Produto'), (a) => a.entidade_id);
  const audLote = agrupar(auditoria.filter((a) => a.entidade === 'EstoqueLoteNota'), (a) => a.entidade_id);
  const audDoProduto = agrupar(auditoria.filter((a) => a.entidade !== 'Produto'), (a) => a.produto_id);
  const audDoLocal = agrupar(auditoria.filter((a) => a.entidade === 'EstoqueLoteNota'), (a) => (a.local_estoque_id ? chaveLocal(a.empresa_id, a.produto_id, a.local_estoque_id) : null));
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
  const ordenados = achados.sort((a, b) =>
    GRAVIDADE[a.classe] - GRAVIDADE[b.classe]
    || NIVEIS.indexOf(a.nivel) - NIVEIS.indexOf(b.nivel)
    || JSON.stringify(a.chave).localeCompare(JSON.stringify(b.chave)));
  return {
    resumo: { ...totais, por_classe: { OK: total - achados.length, ...naoOk } },
    achados: ordenados,
  };
};

// ─── serviço ────────────────────────────────────────────────────────────────
/** Filtro da querystring já validada pelo schema; `limite` padrão 500, máximo 2000. */
const normalizarFiltro = (filtro) => {
  const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const limite = Number.isInteger(filtro?.limite) ? Math.min(Math.max(/** @type {number} */ (filtro.limite), 1), LIMITE_MAXIMO) : LIMITE_PADRAO;
  return { empresaId: texto(filtro?.empresaId), produtoId: texto(filtro?.produtoId), localId: texto(filtro?.localId), limite };
};

/**
 * Reconciliação SOMENTE LEITURA do estoque físico do tenant (SPEC §5).
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext, requestId?: string }} contexto  tenant SÓ de auth_context (R11)
 * @param {{ empresaId?: string, produtoId?: string, localId?: string, limite?: number }} [filtro]  limite padrão 500, máx 2000
 */
export const reconciliarEstoque = async (contexto, filtro = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const f = normalizarFiltro(filtro);
  const linhas = await emTransacao(LEITURA, (tx) => lerReconciliacao(tx, auth.clienteId, f));
  const { resumo, achados } = classificarReconciliacao(/** @type {any} */ (linhas));
  return {
    escopo: { empresa_id: f.empresaId, produto_id: f.produtoId, local_estoque_id: f.localId, limite: f.limite },
    gerado_em: agoraDoServidor().toISOString(),
    truncado: achados.length > f.limite,
    resumo,
    achados: achados.slice(0, f.limite),
  };
};
