/**
 * D-PROD-161 (Estoque P0, fatia F4 + R1 + R2) — RECONCILIAÇÃO SOMENTE LEITURA
 * do estoque físico (SPEC §5). Confere os invariantes do motor único e
 * classifica o que não fecha; NUNCA corrige nada (sem auto-reparo: o
 * saneamento é da P1, com GO).
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
 *              fatias FK (financeiro ativo, abastecimento CONFIRMADO e, D-PROD-202,
 *              linha de produto CONFIRMADO do apontamento da atividade), pelo
 *              `lotes_consumidos` das Saídas de suplementação/transferência,
 *              pelo `rateio` do recibo legado (só quando o movimento NÃO tem
 *              `lotes_consumidos`, para não contar duas vezes) e pela compra
 *              estornada;
 *  I4 fato     cada movimento = Σ das suas fatias (JSON, recibo legado ou FK) ou
 *              Σ das camadas de entrada ligadas; par pai/filho coerente; na
 *              transferência do motor, cada fatia aponta (`lote_destino_id`) a
 *              UMA camada de destino do filho, no local de destino, com a mesma
 *              quantidade e o mesmo custo (R2: `linhagem_transferencia_diverge`);
 *  I5 número   nenhum `numero_movimentacao` provisório (`p-…`) commitado.
 *
 * Classes (a primeira que casar vale; o nível lote não é mascarado pelo nível
 * produto): DADOS_INSUFICIENTES → LIMITACAO_LEGADA → DIVERGENCIA_REAL → OK.
 * Evidência do AuditLog só rebaixa para LIMITACAO_LEGADA quando é RELEVANTE
 * (R1): escrita PROVADA de `estoque_atual` do produto (os dois lados do
 * snapshot com o campo e valores numéricos diferentes; na criação, ≠ 0) ou de
 * quantidade/situação/vínculo do lote (criação, exclusão, ou mudança provada
 * de `quantidade_*`, `status`, `produto_id`, `empresa_id`, `local_estoque_id`,
 * `movimentacao_entrada_id`). Renomeação, procedência, custo/fornecedor/
 * documento do lote, nome/preço do produto, quantidade igual em outro formato
 * e criação de movimento manual nunca rebaixam DIVERGENCIA_REAL. Só conta
 * AuditLog do PRÓPRIO tenant (toda consulta começa por `cliente_id`).
 *
 * Volume (R1 + R2, medidos em PG17 local; números em
 * `scratchpad/estoque-p0/r2-carga/medicao.md`): toda chamada tem trabalho e
 * memória LIMITADOS e a resposta diz exatamente o que cobriu. A varredura tem
 * TRÊS fases, em ordem, cada uma com keyset próprio:
 *  1. 'chaves'   — páginas de CHAVES de produto em ordem de id: a chave é todo
 *     `produto_id` que existe em Produto, em lote OU em movimento do escopo
 *     (varredura solta do índice `(cliente_id, produto_id)`; R2). Órfãos antes
 *     do primeiro, entre dois ou depois do último id de Produto — e o tenant
 *     sem nenhum Produto — são chaves como as outras: a pré-contagem `1 +
 *     lotes + movimentos + 2 × recibos legados` de cada chave corta a página
 *     no orçamento e cobre TODA linha que a página lê (nenhuma faixa aberta sem
 *     conta; os recibos que Q3 e Q4 leem para as saídas legadas — em leitura
 *     linear, R2/LC-2 — entram na conta). Lotes e
 *     movimentos de uma página voltam ao Node só quando SUSPEITOS (o SQL
 *     agrega e filtra; um produto de 50.000 lotes consistentes devolve 1 linha
 *     por local), com teto `anomaliasPorConsulta` (acima dele a página é
 *     TRUNCADA e declarada); órfãos são contados no SQL (classe fixa
 *     DADOS_INSUFICIENTES/produto_inexistente) e só uma amostra de `limite`
 *     linhas volta.
 *  2. 'exclusoes' e 3. 'exclusoes_sem_id' — o histórico de AuditLog de
 *     EstoqueLoteNota em ordem do índice `(cliente_id, entidade, entidade_id)`
 *     (e depois o de `entidade_id` nulo), em blocos de no máximo
 *     `linhasPorPagina` linhas LIDAS (o LIMIT fica antes de qualquer filtro):
 *     cada exclusão legada (o lote já não existe) vira um achado próprio —
 *     LIMITACAO_LEGADA/lote_excluido_fora_do_motor, ou DADOS_INSUFICIENTES/
 *     lote_excluido_produto_inexistente quando nem o produto existe (nunca
 *     omitida em silêncio).
 * A evidência de exclusão que REBAIXA um produto/local divergente só é buscada
 * quando muda a classe dele: reaproveita a fase de exclusões se ela foi lida
 * inteira na MESMA chamada; senão é UMA busca por chamada com teto físico
 * `auditoriaPorChamada` (sem índice em JSON/`acao`, zero DDL). Acima do teto a
 * evidência é PARCIAL: nada é rebaixado sem prova e a cobertura é declarada
 * incompleta (`evidencia_exclusoes = 'parcial'`).
 * O orçamento da CHAMADA (`linhasPorChamada`, `tempoMs`) é conferido antes de
 * cada página/bloco (a primeira sempre roda: toda chamada avança); acima dele
 * a resposta é 200 com `proximo_cursor` e `resumo.situacao = 'INCOMPLETO'`.
 *
 * Contrato da cobertura (R2): uma chamada é UM snapshot (RepeatableRead).
 *  - `fim_do_escopo`: esta chamada chegou ao fim das três fases
 *    (`proximo_cursor = null`); senão a continuação é o cursor.
 *  - `cumulativa`: contadores da varredura inteira desde a 1ª chamada (vêm
 *    ASSINADOS no cursor), para rastrear a cobertura acumulada.
 *  - `conclusao_global = 'COMPROVADA'` (= `completa`) SÓ quando o escopo
 *    inteiro foi verificado nesta chamada, num único snapshot, sem página
 *    truncada e sem evidência parcial; aí `situacao` é CONSISTENTE ou
 *    COM_ACHADOS e `por_classe.OK` é número. Em qualquer outro caso
 *    `conclusao_global = 'INCONCLUSIVA'`, `por_classe.OK = null` e
 *    `motivos_inconclusiva` diz por quê: 'continua_no_cursor' (→ INCOMPLETO),
 *    'paginas_truncadas' / 'evidencia_de_exclusao_parcial' (→ INCOMPLETO) e
 *    'varios_snapshots' (varredura inteira, mas em várias chamadas →
 *    INCONCLUSIVO: lotes podem ter mudado entre elas; nunca falso OK).
 *  - `truncado` continua sendo só o corte da LISTA de achados pelo `limite`.
 *
 * Cursor (R2): `base64url(JSON(estado) ‖ HMAC-SHA256(k, amarra ‖ "\n" ‖
 * JSON(estado)))`, com `k = HKDF-SHA256(AUTH_SECRET, sal "maike-estoque-fisico",
 * rótulo "maike-estoque-reconciliacao-cursor:v2")` e `amarra` = versão, tenant
 * do auth_context, empresa, produto, local e limite. Conferido em tempo
 * constante ANTES de qualquer ida ao banco; adulterado, de outro tenant ou
 * escopo, de outra versão, sem assinatura, vencido (24 h) ou do futuro → o
 * MESMO 400 `REQUEST_VALIDATION_FAILED {field:'cursor', reason:'cursor_invalido'}`
 * (sem oráculo). Nenhum cursor válido amplia o escopo: o tenant e os filtros
 * vêm do token e da query e são reaplicados em todo SQL. Âncora apagada entre
 * as chamadas não é erro (keyset `id > âncora`).
 *
 * Leitura (SPEC §5.1): uma transação RepeatableRead cuja PRIMEIRA instrução é
 * `SET TRANSACTION READ ONLY` (o PostgreSQL recusa qualquer escrita nela) e a
 * segunda, só nesta transação, força plano CUSTOM, desliga o JIT e limita cada
 * instrução a 15 s (`plan_cache_mode`, `jit`, `statement_timeout`: ver R1);
 * nenhuma trava de linha nem advisory. Idas ao banco = 3 fixas (+1 com
 * empresa) + 5 por página + 1 por bloco de exclusões (+1 da busca de
 * evidência, só quando necessária), sem N+1 por lote ou movimento. Listas
 * entram como `::text[]` e todo WHERE e todo JOIN filtram `cliente_id`.
 * Quantidades viram `::text` no SQL e `Dec` aqui; nunca Number. O tenant vem SÓ
 * do `auth_context` (R11). A resposta tem só ids do próprio tenant: nenhum
 * `dados_*` do AuditLog nem dado de usuário.
 */

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { env } from '../../config/env.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { CASAS_QUANTIDADE, Dec, ZERO, dec, somar } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { agoraDoServidor } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ORIGEM_ABASTECIMENTO, ORIGEM_AJUSTE_ESTOQUE, ORIGEM_APONTAMENTO, ORIGEM_DEPOSITO, ORIGEM_SAIDA_ESTOQUE, ORIGEM_SISTEMA, ORIGEM_SUPLEMENTACAO, ORIGENS_DOCUMENTADAS } from './estoqueFisicoMotor.js';

/**
 * Origens de movimento do protocolo (motor físico único, D-PROD-161). Vêm dos
 * exports `ORIGEM_*` de `estoqueFisicoMotor.js` (passo 3 da integração da SPEC
 * §8), para que uma origem nova do motor não fique fora do reconciliador por
 * divergência de literal. Os valores são os mesmos que a F4 declarava aqui.
 */
export const ORIGENS_PROTOCOLO = Object.freeze([ORIGEM_SISTEMA, ORIGEM_ABASTECIMENTO, ORIGEM_SUPLEMENTACAO, ORIGEM_DEPOSITO, ORIGEM_APONTAMENTO, ...ORIGENS_DOCUMENTADAS]);
/**
 * Origens cuja fatia vive em JSON (`lotes_consumidos`) ou, no legado, só no recibo. D-PROD-264: a saída
 * manual documentada grava sempre as fatias no movimento (nunca cai no ramo do recibo legado).
 */
const ORIGENS_SEM_FK = Object.freeze([ORIGEM_SUPLEMENTACAO, ORIGEM_DEPOSITO, ORIGEM_SAIDA_ESTOQUE, ORIGEM_AJUSTE_ESTOQUE]);
/**
 * D-PROD-267: só as origens ANTIGAS têm saída sem fatia em JSON (explicada pelo recibo). As documentadas (saída
 * manual, ajuste) gravam sempre as fatias; a única saída delas sem JSON é o estorno da sobra do ajuste (camada
 * inteira, explicada pela FK do estorno), que não é "consumo legado".
 */
const ORIGENS_SEM_FK_LEGADAS = Object.freeze([ORIGEM_SUPLEMENTACAO, ORIGEM_DEPOSITO]);
/**
 * Origens com fatia FK própria (`OperacaoFinanceiraConsumoLote`, `AbastecimentoBemConsumoLote` e,
 * D-PROD-202, `AtividadeApontamentoProdutoConsumoLote`, a linha de produto do apontamento da atividade).
 */
const ORIGENS_COM_FK = Object.freeze([ORIGEM_SISTEMA, ORIGEM_ABASTECIMENTO, ORIGEM_APONTAMENTO]);
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
 * Orçamento de UMA chamada (R1 + R2). `produtosPorPagina` conta CHAVES de
 * produto (com órfãos); `linhasPorPagina` e `linhasPorChamada` contam a
 * pré-contagem `1 + lotes + movimentos + 2 × recibos legados` de cada chave e as linhas de AuditLog
 * LIDAS pela fase de exclusões; `tempoMs` é conferido entre páginas/blocos e
 * fica bem abaixo dos 20 s da transação; `instrucaoMs` é o
 * `statement_timeout`; `anomaliasPorConsulta` é o teto de lotes/movimentos/
 * evidências SUSPEITOS que uma página devolve ao Node (acima → página
 * truncada, declarada); `auditoriaPorChamada` é o teto de linhas de AuditLog
 * LIDAS pela busca de evidência de exclusão. Só o serviço aceita outro
 * orçamento (testes); o HTTP usa este.
 */
export const ORCAMENTO_PADRAO = Object.freeze({
  produtosPorPagina: 200, linhasPorPagina: 20000, linhasPorChamada: 250000, tempoMs: 8000, instrucaoMs: 15000,
  anomaliasPorConsulta: 20000, auditoriaPorChamada: 250000,
});
const ORCAMENTO_TETO = Object.freeze({
  produtosPorPagina: 1000, linhasPorPagina: 100000, linhasPorChamada: 1000000, tempoMs: 12000, instrucaoMs: 15000,
  anomaliasPorConsulta: 100000, auditoriaPorChamada: 1000000,
});
/**
 * Janela do recibo legado em torno do `createdAt` do movimento. No caminho
 * legado o recibo é reservado na 1ª instrução e o movimento gravado na MESMA
 * transação (`TRANSACAO_CURTA`, timeout 9 s), os dois com o relógio do servidor
 * (UTC, gravado pelo Prisma): 10 min é mais de 60× essa folga. Fora dela o
 * recibo não casa → DADOS_INSUFICIENTES (nunca OK).
 */
const JANELA_TEXTO = `interval '10 minutes'`;
const JANELA_RECIBO = Prisma.raw(JANELA_TEXTO);

export const CLASSES = Object.freeze(['DADOS_INSUFICIENTES', 'LIMITACAO_LEGADA', 'DIVERGENCIA_REAL']);
const [DI, LL, DR] = CLASSES;
const NIVEIS = Object.freeze(['produto', 'local', 'lote', 'movimento']);
/** Ordem da lista de achados (a mais grave primeiro; o `limite` corta o fim). */
const GRAVIDADE = Object.freeze({ DIVERGENCIA_REAL: 0, DADOS_INSUFICIENTES: 1, LIMITACAO_LEGADA: 2 });
/** Fases da varredura, na ordem (`estado.f` do cursor). */
const FASES = Object.freeze({ k: 'chaves', x: 'exclusoes', n: 'exclusoes_sem_id', fim: 'fim' });

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
/** ` AND coluna > desde` (ou nada no começo do keyset). */
const depois = (coluna, desde) => (desde === null ? Prisma.empty : Prisma.sql` AND ${Prisma.raw(coluna)} > ${desde}`);
/** ` AND coluna > desde AND coluna <= ate` (cada lado só se houver): a faixa de `produto_id` da página. */
const naFaixa = (coluna, faixa) => Prisma.sql`${depois(coluna, faixa.desde)}${faixa.ate === null ? Prisma.empty : Prisma.sql` AND ${Prisma.raw(coluna)} <= ${faixa.ate}`}`;
/** Escopo de lote/movimento da página: faixa de produto + empresa + produto filtrados. */
const escopo = (alias, f, faixa) => Prisma.sql`${naFaixa(`${alias}.produto_id`, faixa)}${igual(`${alias}.empresa_id`, f.empresaId)}${igual(`${alias}.produto_id`, f.produtoId)}`;
/** Local que o movimento afeta (Entrada no destino, Saída na origem). */
const localDoMovimento = (alias) => Prisma.raw(`CASE ${alias}.tipo_movimentacao WHEN 'Entrada' THEN ${alias}.local_estoque_destino WHEN 'Saída' THEN ${alias}.local_estoque_origem END`);
const localDoLote = (f) => igual('l.local_estoque_id', f.localId);
const localDoMov = (alias, f) => (f.localId === null ? Prisma.empty : Prisma.sql` AND (${localDoMovimento(alias)}) = ${f.localId}`);
/** Produto e empresa do lote no JSON do AuditLog (o anterior primeiro: na exclusão só ele existe). */
const produtoDoJson = Prisma.sql`COALESCE(d.ant ->> 'produto_id', d.nov ->> 'produto_id')`;
const empresaDoJson = Prisma.sql`COALESCE(d.ant ->> 'empresa_id', d.nov ->> 'empresa_id')`;
const localDoJson = Prisma.sql`COALESCE(d.ant ->> 'local_estoque_id', d.nov ->> 'local_estoque_id')`;

/**
 * Recibo legado em LEITURA LINEAR (R2, achado LC-2). Antes era um LATERAL por
 * saída legada sobre todos os recibos da janela dela: O(saídas × recibos na
 * janela) — 2.000 saídas numa rajada de 22.000 recibos levavam 10,7 s por
 * consulta e prendiam a varredura do tenant num 409 perpétuo. Agora:
 *  1. `intervalosDosRecibos`: as janelas ±JANELA_RECIBO das saídas legadas
 *     FUNDIDAS em intervalos disjuntos (todas têm a mesma largura: a ordem por
 *     instante basta);
 *  2. `recibosNosIntervalos`: UMA varredura do índice `(cliente_id, createdAt)`
 *     por intervalo — cada recibo é lido no máximo UMA vez por consulta — com o
 *     id do movimento tirado do JSON;
 *  3. `casaRecibo`: o casamento com a saída é um hash pelo id, com a janela do
 *     `createdAt` da PRÓPRIA saída (a mesma regra de antes).
 * O número de recibos que a página lê entra na pré-contagem (`lerChaves`).
 * @param {import('@prisma/client').Prisma.Sql} instantes consulta com a coluna `t` (o `createdAt` de cada saída legada)
 */
const intervalosDosRecibos = (instantes) => Prisma.sql`SELECT min(g.t) - ${JANELA_RECIBO} AS ini, max(g.t) + ${JANELA_RECIBO} AS fim
  FROM (
    SELECT s1.t, sum(s1.novo) OVER (ORDER BY s1.t ROWS UNBOUNDED PRECEDING) AS grupo
    FROM (SELECT s0.t, CASE WHEN s0.t - lag(s0.t) OVER (ORDER BY s0.t) <= 2 * ${JANELA_RECIBO} THEN 0 ELSE 1 END AS novo FROM (${instantes}) s0) s1
  ) g
  GROUP BY g.grupo`;
/**
 * Recibos committed de comando de estoque (`TIPOS_RECIBO`) dentro dos
 * intervalos: `(movimento_id, criado_em, rateio)`.
 * @param {string} cli @param {import('@prisma/client').Prisma.Sql} intervalos
 */
const recibosNosIntervalos = (cli, intervalos) => {
  const corpo = objeto(Prisma.sql`o.response_json`);
  return Prisma.sql`SELECT r.movimento_id, r.criado_em, r.rateio FROM (${intervalos}) iv
    CROSS JOIN LATERAL (
      SELECT COALESCE(${corpo} -> 'movimentacao' ->> 'id', ${corpo} -> 'movimentacao_saida' ->> 'id') AS movimento_id, o."createdAt" AS criado_em,
             ${lista(Prisma.sql`${corpo} -> 'rateio'`)} AS rateio
      FROM "OperacaoIdempotente" o
      WHERE o.cliente_id = ${cli} AND o."createdAt" >= iv.ini AND o."createdAt" <= iv.fim
        AND o.tipo_operacao = ANY(${TIPOS_RECIBO}::text[]) AND o.status = 'committed' AND o.response_json IS NOT NULL
      OFFSET 0
    ) r`;
};
/** Recibo `r` da saída `s` (colunas `id`, `t`): mesmo id do movimento E dentro da janela do `createdAt` da saída. */
const casaRecibo = (s, r) => Prisma.raw(`${r}.movimento_id = ${s}.id AND ${r}.criado_em >= ${s}.t - ${JANELA_TEXTO} AND ${r}.criado_em <= ${s}.t + ${JANELA_TEXTO}`);
/** Saída legada de suplementação/transferência (a fatia só está no recibo). */
const saidaLegada = (alias) => Prisma.raw(`${alias}.tipo_movimentacao = 'Saída' AND ${alias}.lotes_consumidos IS NULL AND ${alias}.origem_sistema = ANY(ARRAY['${ORIGENS_SEM_FK_LEGADAS.join("','")}']::text[])`);

/**
 * Próximo `produto_id` de uma tabela depois de `anterior` (passo da varredura
 * solta do índice `(cliente_id, produto_id)`: uma descida de índice por chave
 * distinta, nunca a tabela inteira).
 */
const proximaChave = (tabela, alias, cli, f, anterior) => Prisma.sql`SELECT ${Prisma.raw(alias)}.produto_id FROM ${Prisma.raw(`"${tabela}" ${alias}`)}
  WHERE ${Prisma.raw(alias)}.cliente_id = ${cli}${anterior}${igual(`${alias}.empresa_id`, f.empresaId)}${igual(`${alias}.produto_id`, f.produtoId)}
  ORDER BY ${Prisma.raw(alias)}.produto_id LIMIT 1`;

/**
 * Q1 da página: as próximas `n` CHAVES depois de `desde`, em ordem de id — a
 * união dos ids de Produto do escopo com os `produto_id` distintos de lote e de
 * movimento do escopo (assim um órfão é chave como qualquer produto) — com o
 * necessário para I1 e a pré-contagem `1 + lotes + movimentos + 2 × recibos
 * legados` que corta a página no orçamento.
 */
const lerChaves = (tx, cli, f, desde, n) => tx.$queryRaw`WITH RECURSIVE
    ${f.produtoId === null ? Prisma.empty : Prisma.sql`unica(id) AS (SELECT ${f.produtoId}::text WHERE ${desde === null ? Prisma.sql`true` : Prisma.sql`${f.produtoId}::text > ${desde}`}),`}
    lk(id) AS (
      (${proximaChave('EstoqueLoteNota', 'l', cli, f, depois('l.produto_id', desde))})
      UNION ALL
      SELECT (${proximaChave('EstoqueLoteNota', 'l', cli, f, Prisma.sql` AND l.produto_id > lk.id`)}) FROM lk WHERE lk.id IS NOT NULL
    ),
    mk(id) AS (
      (${proximaChave('MovimentacaoEstoque', 'm', cli, f, depois('m.produto_id', desde))})
      UNION ALL
      SELECT (${proximaChave('MovimentacaoEstoque', 'm', cli, f, Prisma.sql` AND m.produto_id > mk.id`)}) FROM mk WHERE mk.id IS NOT NULL
    ),
    chaves AS (${f.produtoId !== null
    // filtro de produto: a única chave possível é o próprio id (a varredura solta seria uma passada inútil no índice)
    ? Prisma.sql`SELECT id FROM unica`
    : Prisma.sql`
      SELECT u.id FROM (
        (SELECT p.id::text AS id FROM "Produto" p WHERE p.cliente_id = ${cli}${igual('p.empresa_id', f.empresaId)}${depois('p.id', desde)}
          ORDER BY p.id LIMIT ${n}::int)
        UNION (SELECT lk.id::text FROM lk WHERE lk.id IS NOT NULL LIMIT ${n}::int)
        UNION (SELECT mk.id::text FROM mk WHERE mk.id IS NOT NULL LIMIT ${n}::int)
      ) u ORDER BY u.id LIMIT ${n}::int`}
    )
    SELECT c.id, (p.id IS NOT NULL) AS existe,
      (p.id IS NOT NULL${f.empresaId === null ? Prisma.empty : Prisma.sql` AND p.empresa_id = ${f.empresaId}`}) AS no_escopo,
      p.empresa_id, p.estoque_atual::text AS estoque_atual,
      COALESCE(l.saldo, 0)::text AS saldo_lotes,
      COALESCE(l.n_lotes, 0)::int AS n_lotes,
      COALESCE(l.n_outra_empresa, 0)::int AS n_lotes_outra_empresa,
      COALESCE(l.n_status_desconhecido, 0)::int AS n_lotes_status_desconhecido,
      COALESCE(l.n_sem_movimento_entrada, 0)::int AS n_lotes_sem_movimento_entrada,
      COALESCE(m.n_movimentos, 0)::int AS n_movimentos,
      COALESCE(m.n_outra_empresa, 0)::int AS n_movimentos_outra_empresa,
      COALESCE(m.n_fora_do_protocolo, 0)::int AS n_movimentos_fora_do_protocolo,
      COALESCE(m.n_saidas_legadas, 0)::int AS n_saidas_legadas,
      COALESCE(rc.n_recibos, 0)::int AS n_recibos_legados
    FROM chaves c
    LEFT JOIN LATERAL (SELECT p.id, p.empresa_id, p.estoque_atual FROM "Produto" p WHERE p.cliente_id = ${cli} AND p.id = c.id OFFSET 0) p ON true
    LEFT JOIN LATERAL (
      SELECT SUM(x.quantidade_disponivel) FILTER (WHERE x.status = 'Disponivel' AND x.empresa_id = p.empresa_id) AS saldo,
             COUNT(*) AS n_lotes,
             COUNT(*) FILTER (WHERE x.empresa_id <> p.empresa_id) AS n_outra_empresa,
             COUNT(*) FILTER (WHERE x.status <> ALL(${STATUS_LOTE}::text[])) AS n_status_desconhecido,
             COUNT(*) FILTER (WHERE x.movimentacao_entrada_id IS NULL) AS n_sem_movimento_entrada
      FROM "EstoqueLoteNota" x WHERE x.cliente_id = ${cli} AND x.produto_id = c.id
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS n_movimentos,
             COUNT(*) FILTER (WHERE y.empresa_id <> p.empresa_id) AS n_outra_empresa,
             COUNT(*) FILTER (WHERE y.origem_sistema <> ALL(${ORIGENS_PROTOCOLO}::text[])) AS n_fora_do_protocolo,
             COUNT(*) FILTER (WHERE ${saidaLegada('y')}) AS n_saidas_legadas
      FROM "MovimentacaoEstoque" y WHERE y.cliente_id = ${cli} AND y.produto_id = c.id
    ) m ON true
    LEFT JOIN LATERAL (
      -- R2 (LC-2): linhas de recibo que Q3/Q4 vão ler para as saídas legadas desta chave (todas as do intervalo, de
      -- qualquer tipo: é o que o índice visita). Só roda para chave com saída legada.
      SELECT sum(k.n) AS n_recibos
      FROM (${intervalosDosRecibos(Prisma.sql`SELECT z."createdAt" AS t FROM "MovimentacaoEstoque" z
          WHERE z.cliente_id = ${cli} AND z.produto_id = c.id${igual('z.empresa_id', f.empresaId)} AND ${saidaLegada('z')} AND COALESCE(m.n_saidas_legadas, 0) > 0`)}) iv
      CROSS JOIN LATERAL (SELECT count(*) AS n FROM "OperacaoIdempotente" o WHERE o.cliente_id = ${cli} AND o."createdAt" >= iv.ini AND o."createdAt" <= iv.fim) k
    ) rc ON true
    ORDER BY c.id`;

/**
 * Q5 — evidência RELEVANTE de escritor fora do protocolo no AuditLog (só ids e
 * ações: nenhum `dados_*` sai daqui). Produto: por id dos produtos da página;
 * lote: por id dos lotes da faixa. As duas buscas são LATERAL `OFFSET 0`
 * dirigidas pela chave (uma descida no índice `(cliente_id, entidade,
 * entidade_id)` por produto/lote): o plano fica preso ao escopo da página
 * mesmo com estatística velha (medido: com o `= ANY(ARRAY(...))` de R1 e a
 * estatística de antes de uma carga, o planejador lia o histórico de lotes do
 * tenant inteiro).
 */
const lerAuditoria = (tx, cli, f, faixa, idsProdutos, teto) => {
  const dados = Prisma.sql`CROSS JOIN LATERAL (SELECT ${objeto(Prisma.sql`a.dados_novos`)} AS nov, ${objeto(Prisma.sql`a.dados_anteriores`)} AS ant) d`;
  const estoqueNov = num(Prisma.sql`d.nov ->> 'estoque_atual'`);
  const estoqueAnt = num(Prisma.sql`d.ant ->> 'estoque_atual'`);
  return tx.$queryRaw`SELECT entidade, entidade_id, acao, produto_id, empresa_id, local_estoque_id, local_estoque_id_anterior, COUNT(*)::int AS n
    FROM (
      SELECT a.entidade, a.entidade_id, a.acao, a.entidade_id AS produto_id,
             ${empresaDoJson} AS empresa_id, NULL::text AS local_estoque_id, NULL::text AS local_estoque_id_anterior
      FROM unnest(${idsProdutos}::text[]) AS pid(id)
      CROSS JOIN LATERAL (
        SELECT a.entidade, a.entidade_id, a.acao, a.dados_novos, a.dados_anteriores FROM "AuditLog" a
        WHERE a.cliente_id = ${cli} AND a.entidade = 'Produto' AND a.entidade_id = pid.id OFFSET 0
      ) a
      ${dados}
      WHERE jsonb_typeof(d.nov -> 'estoque_atual') IN ('number', 'string') AND ${estoqueNov} IS NOT NULL
        AND ((a.acao = 'create' AND ${estoqueNov} <> 0)
          OR (a.acao = 'update' AND jsonb_typeof(d.ant -> 'estoque_atual') IN ('number', 'string') AND ${estoqueAnt} IS NOT NULL AND ${estoqueNov} <> ${estoqueAnt}))
      UNION ALL
      SELECT a.entidade, a.entidade_id, a.acao,
             COALESCE(d.nov ->> 'produto_id', d.ant ->> 'produto_id'), COALESCE(d.nov ->> 'empresa_id', d.ant ->> 'empresa_id'),
             COALESCE(d.nov ->> 'local_estoque_id', d.ant ->> 'local_estoque_id'), d.ant ->> 'local_estoque_id'
      FROM "EstoqueLoteNota" l
      CROSS JOIN LATERAL (
        SELECT a.entidade, a.entidade_id, a.acao, a.dados_novos, a.dados_anteriores FROM "AuditLog" a
        WHERE a.cliente_id = ${cli} AND a.entidade = 'EstoqueLoteNota' AND a.entidade_id = l.id OFFSET 0
      ) a
      ${dados}
      WHERE l.cliente_id = ${cli}${escopo('l', f, faixa)}
        AND (a.acao IN ('create', 'delete') OR (a.acao = 'update' AND (
        EXISTS (SELECT 1 FROM unnest(${CAMPOS_QUANTIDADE_LOTE}::text[]) k(c)
                WHERE (d.nov -> k.c) IS NOT NULL AND (d.ant -> k.c) IS NOT NULL AND ${num(Prisma.sql`d.nov ->> k.c`)} IS DISTINCT FROM ${num(Prisma.sql`d.ant ->> k.c`)})
        OR EXISTS (SELECT 1 FROM unnest(${CAMPOS_VINCULO_LOTE}::text[]) k(c)
                WHERE (d.nov -> k.c) IS NOT NULL AND (d.ant -> k.c) IS NOT NULL AND (d.nov -> k.c) IS DISTINCT FROM (d.ant -> k.c)))))
    ) ev
    GROUP BY 1, 2, 3, 4, 5, 6, 7
    ORDER BY 1, 2, 3
    LIMIT ${teto + 1}::int`;
};

/** Q2 — por (empresa, produto, local): lotes × razão dos movimentos (+ local/produto inexistentes). Uma linha por grupo. */
const lerLocais = (tx, cli, f, faixa) => tx.$queryRaw`WITH lot AS (
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
    LEFT JOIN "Produto" p ON p.cliente_id = ${cli} AND p.id = COALESCE(lot.produto_id, mov.produto_id)${naFaixa('p.id', faixa)}
    ORDER BY 2, 1, 3`;

/**
 * D-PROD-202 (Fatia 3 do Lançamento de Atividades; antes D-PROD-193, I-y, I-z; lição do hotfix #259) — fatias FK
 * das linhas de PRODUTO do apontamento da atividade (`AtividadeApontamentoProduto` e
 * `AtividadeApontamentoProdutoConsumoLote`). O código pode subir antes da migration das duas tabelas
 * (`20261114600000_atividade_linhas_produto_maquina`, EXPAND): sem elas (`comItens` falso, lido do catálogo por
 * `to_regclass` na 2ª instrução fixa da leitura), o CTE e o ramo do `fk` viram consultas VAZIAS do mesmo formato —
 * nunca 500, nem 25P02 no resto da transação.
 *
 * Consumo por lote das linhas CONFIRMADO (linha cancelada — na edição, no cancelamento da linha, do apontamento ou
 * da atividade — devolveu a fatia pelo estorno exato: não conta).
 */
const consumoDosItensDoApontamento = (cli, comItens) => (comItens
  ? Prisma.sql`SELECT f.estoque_lote_nota_id AS lote_id, SUM(f.quantidade) AS consumido
      FROM "AtividadeApontamentoProdutoConsumoLote" f
      JOIN "AtividadeApontamentoProduto" i ON i.cliente_id = f.cliente_id AND i.id = f.linha_id
      WHERE f.cliente_id = ${cli} AND f.estoque_lote_nota_id = ANY(ARRAY(SELECT id FROM lt)) AND i.status = 'CONFIRMADO'
      GROUP BY 1`
  : Prisma.sql`SELECT NULL::text AS lote_id, 0::numeric AS consumido WHERE false`);
/** Σ das fatias por movimento de SAÍDA da linha (de qualquer situação: o original estornado continua com as fatias). */
const fatiasFkDosItensDoApontamento = (cli, comItens) => (comItens
  ? Prisma.sql`SELECT i.movimentacao_estoque_id, SUM(f.quantidade)
      FROM "AtividadeApontamentoProduto" i
      JOIN "AtividadeApontamentoProdutoConsumoLote" f ON f.cliente_id = i.cliente_id AND f.linha_id = i.id
      WHERE i.cliente_id = ${cli} AND i.movimentacao_estoque_id = ANY(ARRAY(SELECT id FROM mv))
      GROUP BY 1`
  : Prisma.sql`SELECT NULL::text, 0::numeric WHERE false`);

const COLUNAS_LOTE = Prisma.raw(`y.id, y.empresa_id, y.produto_id, y.local_estoque_id, y.status, y.q_entrada::text AS entrada, y.q_disp::text AS disponivel,
  y.movimentacao_entrada_id, y.data_antiga, y.produto_inexistente, y.produto_empresa_id, y.local_inexistente,
  y.c_fin::text AS consumo_financeiro, y.c_abs::text AS consumo_abastecimento, y.c_apo::text AS consumo_apontamento, y.c_nov::text AS consumo_movimentos, y.c_leg::text AS consumo_recibos,
  y.fatias_recibo, y.fatias_recibo_fora_janela, y.compra_estornada, y.tem_movimento_entrada, y.entrada_tipo, y.entrada_tipo_detalhado,
  y.entrada_origem, y.q_ent_mov::text AS entrada_quantidade, y.entrada_incoerente, y.linhagem_motor`);

/**
 * Q3 — por lote: consumo observado × explicado, coerência da situação e do
 * movimento de entrada. O SQL agrega e devolve SÓ os lotes suspeitos (qualquer
 * condição que a classificação confere, ou evidência do AuditLog), até
 * `teto + 1` (o excesso marca a página truncada), e uma AMOSTRA de `amostra`
 * lotes órfãos (os órfãos são contados por Q2: classe fixa).
 */
const lerLotes = (tx, cli, f, faixa, evidencia, teto, amostra, comItens) => {
  // Sem amostra de órfãos a CTE `y` é lida uma vez só (o PostgreSQL a embute e filtra em fluxo, sem materializar
  // a página inteira em disco); com amostra, os dois ramos leem a mesma `y` materializada.
  const comAmostra = amostra > 0;
  return tx.$queryRaw`WITH lt AS (
      SELECT l.id, l.empresa_id, l.produto_id, l.local_estoque_id, l.status, l.quantidade_entrada, l.quantidade_disponivel,
             l.movimentacao_entrada_id, l.data_documento, l."createdAt"
      FROM "EstoqueLoteNota" l
      WHERE l.cliente_id = ${cli}${escopo('l', f, faixa)}${localDoLote(f)}
    ), fin AS (
      SELECT c.estoque_lote_nota_id AS lote_id, SUM(c.quantidade) AS consumido
      FROM "OperacaoFinanceiraConsumoLote" c
      JOIN "OperacaoFinanceiraItem" i ON i.cliente_id = c.cliente_id AND i.id = c.item_id
      WHERE c.cliente_id = ${cli} AND c.estoque_lote_nota_id = ANY(ARRAY(SELECT id FROM lt)) AND i.movimentacao_estorno_id IS NULL
      GROUP BY 1
    ), abs AS (
      SELECT f.estoque_lote_nota_id AS lote_id, SUM(f.quantidade) AS consumido
      FROM "AbastecimentoBemConsumoLote" f
      JOIN "AbastecimentoBem" a ON a.cliente_id = f.cliente_id AND a.id = f.abastecimento_id
      WHERE f.cliente_id = ${cli} AND f.estoque_lote_nota_id = ANY(ARRAY(SELECT id FROM lt)) AND a.status = 'CONFIRMADO'
      GROUP BY 1
    ), apo AS (
      ${consumoDosItensDoApontamento(cli, comItens)}
    ), nov AS (
      SELECT x.elem ->> 'lote_id' AS lote_id, SUM(${num(Prisma.sql`x.elem ->> 'quantidade'`)}) AS consumido
      FROM "MovimentacaoEstoque" m
      CROSS JOIN LATERAL jsonb_array_elements(${lista(Prisma.sql`m.lotes_consumidos`)}) AS x(elem)
      WHERE m.cliente_id = ${cli}${escopo('m', f, faixa)}
        AND m.tipo_movimentacao = 'Saída' AND m.status = 'Ativa' AND m.origem_sistema = ANY(${ORIGENS_SEM_FK}::text[]) AND m.lotes_consumidos IS NOT NULL
      GROUP BY 1
    ), ls AS MATERIALIZED (
      SELECT m.id, m."createdAt" AS t
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${cli}${escopo('m', f, faixa)} AND m.status = 'Ativa' AND ${saidaLegada('m')}
    ), rl AS MATERIALIZED (${recibosNosIntervalos(cli, intervalosDosRecibos(Prisma.sql`SELECT ls.t FROM ls`))}
    ), fatias_recibo AS MATERIALIZED (
      -- R2 (LC-2): recibos lidos UMA vez por intervalo (rl) e casados por hash (id + janela da própria saída);
      -- MATERIALIZED: as fatias saem primeiro e só depois cruzam com os lotes (um hash).
      SELECT e.elem ->> 'lote_id' AS lote_id, ${num(Prisma.sql`e.elem ->> 'quantidade_consumida'`)} AS quantidade, r.criado_em
      FROM ls
      JOIN rl r ON ${casaRecibo('ls', 'r')}
      CROSS JOIN LATERAL jsonb_array_elements(r.rateio) AS e(elem)
    ), leg AS (
      SELECT lt.id AS lote_id,
             SUM(fr.quantidade) FILTER (WHERE fr.criado_em >= lt."createdAt" - interval '1 hour') AS consumido,
             COUNT(*) FILTER (WHERE fr.criado_em >= lt."createdAt" - interval '1 hour') AS fatias,
             COUNT(*) FILTER (WHERE fr.criado_em < lt."createdAt" - interval '1 hour') AS fatias_fora_janela
      FROM fatias_recibo fr
      JOIN lt ON lt.id = fr.lote_id
      GROUP BY 1
    ), compra AS (
      SELECT u.lote_id, bool_or(u.estornada) AS estornada FROM (
        SELECT i.estoque_lote_nota_id AS lote_id, (i.movimentacao_estorno_id IS NOT NULL) AS estornada
        FROM "OperacaoFinanceiraItem" i
        WHERE i.cliente_id = ${cli} AND i.estoque_lote_nota_id = ANY(ARRAY(SELECT id FROM lt))
        UNION ALL
        -- D-PROD-257: a camada da entrada documentada estornada (exclusão) é explicada pela FK do estorno, como a compra.
        SELECT e.estoque_lote_nota_id, (e.movimentacao_estorno_id IS NOT NULL)
        FROM "EntradaEstoqueItem" e
        WHERE e.cliente_id = ${cli} AND e.estoque_lote_nota_id = ANY(ARRAY(SELECT id FROM lt))
        UNION ALL
        -- D-PROD-267: a camada da sobra de um ajuste de inventário excluído é explicada pela FK do estorno, como a entrada.
        SELECT a.estoque_lote_nota_id, (a.movimentacao_estorno_id IS NOT NULL)
        FROM "AjusteEstoqueItem" a
        WHERE a.cliente_id = ${cli} AND a.estoque_lote_nota_id = ANY(ARRAY(SELECT id FROM lt))
      ) u
      GROUP BY 1
    ), x AS (
      SELECT lt.id, lt.empresa_id, lt.produto_id, lt.local_estoque_id, lt.status, lt.quantidade_entrada AS q_entrada, lt.quantidade_disponivel AS q_disp,
             lt.movimentacao_entrada_id, (lt.data_documento IS NOT NULL AND lt.data_documento < DATE '2002-01-01') AS data_antiga,
             (p.id IS NULL) AS produto_inexistente, p.empresa_id AS produto_empresa_id, (le.id IS NULL) AS local_inexistente,
             COALESCE(fin.consumido, 0) AS c_fin, COALESCE(abs.consumido, 0) AS c_abs, COALESCE(apo.consumido, 0) AS c_apo,
             COALESCE(nov.consumido, 0) AS c_nov, COALESCE(leg.consumido, 0) AS c_leg,
             COALESCE(leg.fatias, 0)::int AS fatias_recibo, COALESCE(leg.fatias_fora_janela, 0)::int AS fatias_recibo_fora_janela,
             COALESCE(compra.estornada, false) AS compra_estornada,
             (ent.id IS NOT NULL) AS tem_movimento_entrada, ent.tipo_movimentacao AS entrada_tipo, ent.tipo_detalhado AS entrada_tipo_detalhado,
             ent.origem_sistema AS entrada_origem, ent.quantidade AS q_ent_mov,
             (ent.id IS NOT NULL AND (ent.produto_id <> lt.produto_id OR ent.local_estoque_destino IS DISTINCT FROM lt.local_estoque_id
               OR ent.tipo_movimentacao <> 'Entrada')) AS entrada_incoerente,
             COALESCE(lm.ok, false) AS linhagem_motor
      FROM lt
      LEFT JOIN "Produto" p ON p.cliente_id = ${cli} AND p.id = lt.produto_id${naFaixa('p.id', faixa)}
      LEFT JOIN "LocalEstoque" le ON le.cliente_id = ${cli} AND le.id = lt.local_estoque_id
      LEFT JOIN fin ON fin.lote_id = lt.id
      LEFT JOIN abs ON abs.lote_id = lt.id
      LEFT JOIN apo ON apo.lote_id = lt.id
      LEFT JOIN nov ON nov.lote_id = lt.id
      LEFT JOIN leg ON leg.lote_id = lt.id
      LEFT JOIN compra ON compra.lote_id = lt.id
      LEFT JOIN "MovimentacaoEstoque" ent ON ent.cliente_id = ${cli} AND ent.id = lt.movimentacao_entrada_id
      -- R2 (A-01): camada < 2002 criada pelo MOTOR — a saída-pai cita esta camada em lotes_consumidos[].lote_destino_id —
      -- tem a data COPIADA da origem: não é o bug de 2001 do comando legado. LATERAL parametrizado (uma descida na chave
      -- primária por camada) e só avaliado quando a data é antiga (filtro de uma vez sobre a linha de fora).
      LEFT JOIN LATERAL (
        SELECT true AS ok FROM "MovimentacaoEstoque" pai
        WHERE pai.cliente_id = ${cli} AND pai.id = ent.movimento_pai_id
          AND lt.data_documento < DATE '2002-01-01' AND ent.tipo_detalhado = 'transferencia_recebida'
          AND pai.tipo_detalhado = 'transferencia_enviada' AND pai.lotes_consumidos IS NOT NULL
          AND ${lista(Prisma.sql`pai.lotes_consumidos`)} @> jsonb_build_array(jsonb_build_object('lote_destino_id', lt.id::text))
        OFFSET 0
      ) lm ON true
    ), y AS ${comAmostra ? Prisma.sql`MATERIALIZED` : Prisma.empty} (
      SELECT x.*, ((x.q_entrada - x.q_disp) - (x.c_fin + x.c_abs + x.c_apo + x.c_nov + x.c_leg + CASE WHEN x.compra_estornada THEN x.q_entrada ELSE 0 END)) AS dif
      FROM x
    )
    (SELECT ${COLUNAS_LOTE}, false AS amostra_orfa FROM y
      WHERE NOT y.produto_inexistente AND (
        y.status <> ALL(${STATUS_LOTE}::text[])
        OR y.produto_empresa_id IS DISTINCT FROM y.empresa_id
        OR y.local_inexistente
        OR COALESCE(y.movimentacao_entrada_id, '') = ''
        OR NOT y.tem_movimento_entrada
        OR y.dif <> 0
        OR NOT COALESCE(y.entrada_origem = ANY(${ORIGENS_PROTOCOLO}::text[]), false)
        OR (y.entrada_tipo_detalhado = 'transferencia_recebida' AND y.data_antiga AND NOT y.linhagem_motor)
        OR (y.status = 'Disponivel' AND y.q_disp = 0)
        OR y.q_disp < 0 OR y.q_disp > y.q_entrada
        OR (y.status <> 'Disponivel' AND y.q_disp > 0)
        OR y.entrada_incoerente
        OR (y.entrada_tipo_detalhado IS DISTINCT FROM 'transferencia_recebida' AND y.q_ent_mov IS DISTINCT FROM y.q_entrada)
        OR y.id = ANY(${evidencia}::text[]))
      ORDER BY y.id LIMIT ${teto + 1}::int)
    ${comAmostra ? Prisma.sql`UNION ALL
    (SELECT ${COLUNAS_LOTE}, true AS amostra_orfa FROM y WHERE y.produto_inexistente
      ORDER BY y.empresa_id, y.produto_id, y.local_estoque_id, y.id LIMIT ${amostra}::int)` : Prisma.empty}`;
};

const COLUNAS_MOVIMENTO = Prisma.raw('x.*');

/**
 * Q4 — movimentos com alguma regra disparada (os demais só entram na contagem
 * de Q2), até `teto + 1` não órfãos e uma AMOSTRA de `amostra` órfãos.
 */
const lerMovimentos = (tx, cli, f, faixa, teto, amostra, comItens) => {
  const comAmostra = amostra > 0; // idem `lerLotes`: sem amostra, `x` é embutida e filtrada em fluxo
  return tx.$queryRaw`WITH mv AS (
      SELECT m.id, m.empresa_id, m.produto_id, m.tipo_movimentacao, m.tipo_detalhado, m.origem_sistema, m.status, m.quantidade,
             m.numero_movimentacao, m.movimento_pai_id, m.movimento_filho_id, m.lotes_consumidos, m."createdAt", m.local_estoque_destino,
             (${localDoMovimento('m')}) AS local_id
      FROM "MovimentacaoEstoque" m
      WHERE m.cliente_id = ${cli}${escopo('m', f, faixa)}${localDoMov('m', f)}
    ), lsm AS MATERIALIZED (
      SELECT mv.id, mv."createdAt" AS t FROM mv WHERE ${saidaLegada('mv')}
    ), rlm AS MATERIALIZED (${recibosNosIntervalos(cli, intervalosDosRecibos(Prisma.sql`SELECT lsm.t FROM lsm`))}
    ), rcm AS (
      -- R2 (LC-2): idem Q3 — leitura linear dos recibos e casamento por hash
      SELECT lsm.id AS movimento_id, SUM(${num(Prisma.sql`e.elem ->> 'quantidade_consumida'`)}) AS soma, COUNT(e.elem) AS n
      FROM lsm
      JOIN rlm r ON ${casaRecibo('lsm', 'r')}
      LEFT JOIN LATERAL jsonb_array_elements(r.rateio) AS e(elem) ON true
      GROUP BY 1
    ), lin AS (
      SELECT l.movimentacao_entrada_id AS movimento_id, SUM(l.quantidade_entrada) AS soma
      FROM "EstoqueLoteNota" l
      WHERE l.cliente_id = ${cli} AND l.movimentacao_entrada_id IS NOT NULL${escopo('l', f, faixa)}
      GROUP BY 1
    ), fk AS (
      SELECT i.movimentacao_estoque_id AS movimento_id, SUM(c.quantidade) AS soma
      FROM "OperacaoFinanceiraItem" i
      JOIN "OperacaoFinanceiraConsumoLote" c ON c.cliente_id = i.cliente_id AND c.item_id = i.id
      WHERE i.cliente_id = ${cli} AND i.movimentacao_estoque_id = ANY(ARRAY(SELECT id FROM mv))
      GROUP BY 1
      UNION ALL
      SELECT a.movimentacao_estoque_id, SUM(f.quantidade)
      FROM "AbastecimentoBem" a
      JOIN "AbastecimentoBemConsumoLote" f ON f.cliente_id = a.cliente_id AND f.abastecimento_id = a.id
      WHERE a.cliente_id = ${cli} AND a.movimentacao_estoque_id = ANY(ARRAY(SELECT id FROM mv))
      GROUP BY 1
      UNION ALL
      ${fatiasFkDosItensDoApontamento(cli, comItens)}
    ), ltr AS (
      -- R2: linhagem da transferência do motor — cada fatia aponta a UMA camada de destino do filho, no local de destino,
      -- do mesmo produto e empresa, com a mesma quantidade e o mesmo custo (lote_destino_id em JSON, sem FK).
      SELECT mv.id AS movimento_id,
             bool_or(fx.destino IS NULL OR d.id IS NULL OR mv.movimento_filho_id IS NULL
               OR d.movimentacao_entrada_id IS DISTINCT FROM mv.movimento_filho_id OR d.produto_id <> mv.produto_id OR d.empresa_id <> mv.empresa_id
               OR d.local_estoque_id IS DISTINCT FROM mv.local_estoque_destino
               OR d.quantidade_entrada IS DISTINCT FROM fx.quantidade) AS diverge,
             COUNT(*) AS n, COUNT(DISTINCT fx.destino) AS n_destinos
      FROM mv
      CROSS JOIN LATERAL (
        SELECT e.elem ->> 'lote_destino_id' AS destino, ${num(Prisma.sql`e.elem ->> 'quantidade'`)} AS quantidade, ${num(Prisma.sql`e.elem ->> 'custo_unitario'`)} AS custo
        FROM jsonb_array_elements(${lista(Prisma.sql`mv.lotes_consumidos`)}) AS e(elem)
      ) fx
      LEFT JOIN "EstoqueLoteNota" d ON d.cliente_id = ${cli} AND d.id = fx.destino
      WHERE mv.tipo_movimentacao = 'Saída' AND mv.tipo_detalhado = 'transferencia_enviada' AND mv.lotes_consumidos IS NOT NULL
      GROUP BY 1
    ), x AS ${comAmostra ? Prisma.sql`MATERIALIZED` : Prisma.empty} (
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
             fk.soma::text AS soma_fk,
             (ltr.movimento_id IS NOT NULL AND (ltr.diverge OR ltr.n_destinos < ltr.n)) AS linhagem_diverge
      FROM mv
      LEFT JOIN LATERAL (
        SELECT SUM(${num(Prisma.sql`e.elem ->> 'quantidade'`)}) AS soma, COUNT(*) FILTER (WHERE ${num(Prisma.sql`e.elem ->> 'quantidade'`)} IS NULL) AS n_ilegiveis
        FROM jsonb_array_elements(${lista(Prisma.sql`mv.lotes_consumidos`)}) AS e(elem)
      ) fj ON true
      LEFT JOIN rcm ON rcm.movimento_id = mv.id
      LEFT JOIN lin ON lin.movimento_id = mv.id
      LEFT JOIN fk ON fk.movimento_id = mv.id
      LEFT JOIN ltr ON ltr.movimento_id = mv.id
      LEFT JOIN "MovimentacaoEstoque" f ON f.cliente_id = ${cli} AND f.id = mv.movimento_filho_id
      LEFT JOIN "MovimentacaoEstoque" pai ON pai.cliente_id = ${cli} AND pai.id = mv.movimento_pai_id
      LEFT JOIN "Produto" p ON p.cliente_id = ${cli} AND p.id = mv.produto_id${naFaixa('p.id', faixa)}
    )
    (SELECT ${COLUNAS_MOVIMENTO}, false AS amostra_orfa FROM x
      WHERE NOT produto_inexistente AND (tipo_desconhecido OR status_desconhecido OR produto_empresa_id IS DISTINCT FROM empresa_id
       OR NOT COALESCE(origem_sistema = ANY(${ORIGENS_PROTOCOLO}::text[]), false) OR numero_provisorio OR estornada_sem_filho OR par_incoerente
       OR (tem_fatias_json AND (n_fatias_json_ilegiveis > 0 OR soma_fatias_json IS DISTINCT FROM quantidade))
       OR (legado AND (NOT tem_recibo OR soma_recibo IS DISTINCT FROM quantidade))
       OR ((transferencia_recebida OR exige_camada) AND soma_lotes_destino IS DISTINCT FROM quantidade)
       OR (exige_fk AND soma_fk IS DISTINCT FROM quantidade)
       OR linhagem_diverge)
      ORDER BY id LIMIT ${teto + 1}::int)
    ${comAmostra ? Prisma.sql`UNION ALL
    (SELECT ${COLUNAS_MOVIMENTO}, true AS amostra_orfa FROM x WHERE produto_inexistente
      ORDER BY empresa_id, produto_id, local_estoque_id, id LIMIT ${amostra}::int)` : Prisma.empty}`;
};

/** Exclusão legada no JSON do AuditLog: produto, empresa e local do lote apagado (e se o produto ainda existe no tenant). */
const infoExclusao = (cli) => Prisma.sql`jsonb_build_object('lote_id', b.entidade_id, 'produto_id', ${produtoDoJson}, 'empresa_id', ${empresaDoJson},
  'local_estoque_id', ${localDoJson}, 'produto_existe', EXISTS (SELECT 1 FROM "Produto" p WHERE p.cliente_id = ${cli} AND p.id = ${produtoDoJson}))`;

/**
 * Exclusões legadas de um BLOCO do histórico de AuditLog de EstoqueLoteNota:
 * lê no máximo `n` linhas em ordem do índice `(cliente_id, entidade,
 * entidade_id)` (o LIMIT vem ANTES de qualquer filtro: `n` é o que se LÊ, não o
 * que volta), numa só passada que agrega a contagem, a última chave lida e as
 * exclusões do bloco (o lote já não existe no tenant) — sem materializar o
 * bloco. `semId`: o resto do histórico, com `entidade_id` nulo, em ordem de id.
 * Filtros de empresa/produto valem sobre o JSON; o de local só filtra os
 * achados (a evidência do nível produto usa todos os locais).
 */
const lerBlocoExclusoes = (tx, cli, f, apos, n, semId) => {
  const chave = semId
    ? Prisma.sql`a.entidade_id IS NULL${apos.id === null ? Prisma.empty : Prisma.sql` AND a.id > ${apos.id}`} ORDER BY a.id`
    : Prisma.sql`a.entidade_id IS NOT NULL${apos.entidade === null ? Prisma.empty : Prisma.sql` AND a.entidade_id >= ${apos.entidade} AND (a.entidade_id > ${apos.entidade} OR a.id > ${apos.id})`}
      ORDER BY a.entidade_id, a.id`;
  // `ha_sem_id`: um passo de índice que poupa a fase do `entidade_id` nulo quando ela não tem nada.
  const semIdExiste = semId ? Prisma.sql`true` : Prisma.sql`EXISTS (SELECT 1 FROM "AuditLog" z WHERE z.cliente_id = ${cli} AND z.entidade = 'EstoqueLoteNota' AND z.entidade_id IS NULL)`;
  return tx.$queryRaw`SELECT count(*)::int AS lidas, ${semIdExiste} AS ha_sem_id,
      (max(ARRAY[COALESCE(b.entidade_id::text, ''), b.id::text]))[1] AS ult_entidade,
      (max(ARRAY[COALESCE(b.entidade_id::text, ''), b.id::text]))[2] AS ult_id,
      COALESCE(jsonb_agg(e.info) FILTER (WHERE e.info IS NOT NULL), '[]'::jsonb) AS exclusoes
    FROM (
      SELECT a.entidade_id, a.id, a.acao,
             CASE WHEN a.acao = 'delete' THEN a.dados_anteriores END AS ant_bruto,
             CASE WHEN a.acao = 'delete' THEN a.dados_novos END AS nov_bruto
      FROM "AuditLog" a
      WHERE a.cliente_id = ${cli} AND a.entidade = 'EstoqueLoteNota' AND ${chave}
      LIMIT ${n}::int
    ) b
    LEFT JOIN LATERAL (
      SELECT ${infoExclusao(cli)} AS info
      FROM (SELECT ${objeto(Prisma.sql`b.nov_bruto`)} AS nov, ${objeto(Prisma.sql`b.ant_bruto`)} AS ant) d
      WHERE b.acao = 'delete' AND NOT EXISTS (SELECT 1 FROM "EstoqueLoteNota" l WHERE l.cliente_id = ${cli} AND l.id = b.entidade_id)
        ${f.empresaId === null ? Prisma.empty : Prisma.sql`AND ${empresaDoJson} = ${f.empresaId}`}
        ${f.produtoId === null ? Prisma.empty : Prisma.sql`AND ${produtoDoJson} = ${f.produtoId}`}
    ) e ON true`;
};

/**
 * Busca da evidência de exclusão para os produtos divergentes da chamada
 * (UMA por chamada, só quando muda a classe de algum): o histórico de AuditLog
 * de EstoqueLoteNota em ordem do índice, com teto físico `teto + 1` linhas
 * LIDAS (o LIMIT antes do filtro de JSON), agregado numa passada.
 */
const lerEvidenciaExclusoes = (tx, cli, f, produtos, teto) => tx.$queryRaw`SELECT count(*)::int AS lidas,
      COALESCE(jsonb_agg(e.info) FILTER (WHERE e.info IS NOT NULL), '[]'::jsonb) AS exclusoes
    FROM (
      SELECT a.entidade_id, a.id, a.acao,
             CASE WHEN a.acao = 'delete' THEN a.dados_anteriores END AS ant_bruto,
             CASE WHEN a.acao = 'delete' THEN a.dados_novos END AS nov_bruto
      FROM "AuditLog" a
      WHERE a.cliente_id = ${cli} AND a.entidade = 'EstoqueLoteNota'
      ORDER BY a.entidade_id
      LIMIT ${teto + 1}::int
    ) b
    LEFT JOIN LATERAL (
      SELECT ${infoExclusao(cli)} AS info
      FROM (SELECT ${objeto(Prisma.sql`b.nov_bruto`)} AS nov, ${objeto(Prisma.sql`b.ant_bruto`)} AS ant) d
      WHERE b.acao = 'delete' AND NOT EXISTS (SELECT 1 FROM "EstoqueLoteNota" l WHERE l.cliente_id = ${cli} AND l.id = b.entidade_id)
        AND ${produtoDoJson} = ANY(${produtos}::text[])
        ${f.empresaId === null ? Prisma.empty : Prisma.sql`AND ${empresaDoJson} = ${f.empresaId}`}
    ) e ON true`;

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
      const lista0 = mapa.get(k);
      if (lista0) lista0.push(l);
      else mapa.set(k, [l]);
    }
  }
  return mapa;
};
const tagsAuditoria = (lista0) => [...new Set(lista0.map((a) => `auditoria:${a.entidade}:${a.acao}`))];
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

/** Índices da evidência do AuditLog: produto (escritas de `estoque_atual`), lote (o próprio), produto e local dos lotes. */
const indexarAuditoria = (auditoria) => {
  const audLotes = auditoria.filter((a) => a.entidade === 'EstoqueLoteNota');
  return {
    audProduto: agrupar(auditoria.filter((a) => a.entidade === 'Produto'), (a) => a.entidade_id),
    audLote: agrupar(audLotes, (a) => a.entidade_id),
    audDoProduto: agrupar(audLotes, (a) => a.produto_id),
    audDoLocal: agrupar(audLotes, (a) => [a.local_estoque_id, a.local_estoque_id_anterior].filter(Boolean).map((loc) => chaveLocal(a.empresa_id, a.produto_id, loc))),
  };
};

/** Produto (I1). `audP`: escritas de `estoque_atual` dele; `audOutros`: escritas/exclusões dos lotes dele. */
const achadoProduto = (p, audP, audOutros) => {
  const cache = d(p.estoque_atual);
  const saldo = d(p.saldo_lotes);
  const dif = cache.minus(saldo);
  /** @type {Array<[string, string]>} */
  const s = [];
  if (!dif.isZero() || cache.lt(0)) {
    if (p.n_lotes_outra_empresa > 0 || p.n_movimentos_outra_empresa > 0) s.push([DI, 'empresa_divergente']);
    if (p.n_lotes_status_desconhecido > 0) s.push([DI, 'lote_inclassificavel']);
    if (p.n_lotes === 0 && !audP.length && !audOutros.length) s.push([DI, 'cache_sem_lote']);
    if (audP.length) s.push([LL, 'cache_escrito_fora_do_motor']);
    if (p.n_lotes_sem_movimento_entrada > 0 || p.n_movimentos_fora_do_protocolo > 0 || audOutros.length) s.push([LL, 'cache_diverge_legado']);
    if (dentroDaTolerancia(dif, p.n_saidas_legadas)) s.push([LL, 'residuo_number_legado']);
    s.push([DR, cache.lt(0) ? 'cache_negativo' : 'cache_diverge']);
  }
  return achadoDe('produto', s, { empresa_id: p.empresa_id, produto_id: p.id }, { esperado: saldo, observado: cache }, tagsAuditoria([...audP, ...audOutros]));
};

/** (empresa, produto, local) (I2). `aud`: escritas/exclusões de lotes daquele local (antes ou depois). */
const achadoLocal = (r, aud) => {
  const lotesL = d(r.saldo_lotes);
  const razao = d(r.saldo_razao);
  const dif = lotesL.minus(razao);
  /** @type {Array<[string, string]>} */
  const s = [];
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
  return achadoDe('local', s, { empresa_id: r.empresa_id, produto_id: r.produto_id, local_estoque_id: r.local_estoque_id }, { esperado: razao, observado: lotesL }, tagsAuditoria(aud));
};

/** Lote (I3, I4 da entrada). `semRecibo`: (empresa, produto, local) com Saída legada sem recibo. */
const achadoLote = (l, aud, semRecibo) => {
  const entrada = d(l.entrada);
  const disp = d(l.disponivel);
  const observado = entrada.minus(disp);
  const explicado = somar([l.consumo_financeiro, l.consumo_abastecimento, l.consumo_apontamento, l.consumo_movimentos, l.consumo_recibos].map(d))
    .plus(l.compra_estornada ? entrada : ZERO);
  const dif = observado.minus(explicado);
  const statusConhecido = STATUS_LOTE.includes(l.status);
  const zeradoDisponivel = l.status === 'Disponivel' && disp.isZero();
  /** @type {Array<[string, string]>} */
  const s = [];
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
  // R2 (A-01): só a camada LEGADA (sem linhagem do motor) é o bug 2001; a do motor nunca mascara divergência física.
  if (l.entrada_tipo_detalhado === 'transferencia_recebida' && l.data_antiga && !l.linhagem_motor) s.push([LL, 'data_transferencia_2001']);
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
  return achadoDe('lote', s, { empresa_id: l.empresa_id, produto_id: l.produto_id, local_estoque_id: l.local_estoque_id, lote_id: l.id },
    { esperado: explicado, observado }, tagsAuditoria(aud));
};

/** Movimento (I4, I5). */
const achadoMovimento = (m) => {
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
  if (m.linhagem_diverge) s.push([DR, 'linhagem_transferencia_diverge']);
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
  return achadoDe('movimento', s, { empresa_id: m.empresa_id, produto_id: m.produto_id, local_estoque_id: m.local_estoque_id ?? null, movimento_id: m.id }, medida);
};

/**
 * Exclusão legada de lote (R2): o lote foi apagado pelo DELETE genérico (antes
 * da P0) e só existe no AuditLog. Sempre é achado — nunca omitido: com o
 * produto no tenant, LIMITACAO_LEGADA; sem ele (ou sem produto no JSON),
 * DADOS_INSUFICIENTES.
 */
const achadoExclusao = (x) => achadoDe('lote',
  [x.produto_existe ? [LL, 'lote_excluido_fora_do_motor'] : [DI, 'lote_excluido_produto_inexistente']],
  { empresa_id: x.empresa_id ?? null, produto_id: x.produto_id ?? null, local_estoque_id: x.local_estoque_id ?? null, lote_id: x.lote_id ?? null },
  {}, ['auditoria:EstoqueLoteNota:delete']);

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
  const ix = indexarAuditoria(auditoria);
  const semRecibo = new Set(movimentos.filter((m) => m.legado && !m.tem_recibo).map((m) => chaveLocal(m.empresa_id, m.produto_id, m.local_estoque_id)));
  const achados = [
    ...produtos.map((p) => achadoProduto(p, ix.audProduto.get(p.id) ?? [], ix.audDoProduto.get(p.id) ?? [])),
    ...locais.map((r) => achadoLocal(r, ix.audDoLocal.get(chaveLocal(r.empresa_id, r.produto_id, r.local_estoque_id)) ?? [])),
    ...lotes.map((l) => achadoLote(l, ix.audLote.get(l.id) ?? [], semRecibo)),
    ...movimentos.map(achadoMovimento),
  ].filter(Boolean);
  const totais = {
    produtos: produtos.length,
    locais: locais.length,
    lotes: lotes.length,
    movimentos: locais.reduce((t, r) => t + Number(r.n_movimentos ?? 0), 0),
  };
  const naoOk = { DIVERGENCIA_REAL: 0, LIMITACAO_LEGADA: 0, DADOS_INSUFICIENTES: 0 };
  for (const a of achados) naoOk[/** @type {keyof typeof naoOk} */ (a.classe)] += 1;
  const total = totais.produtos + totais.locais + totais.lotes + totais.movimentos;
  return {
    resumo: { ...totais, por_classe: { OK: total - achados.length, ...naoOk } },
    achados: achados.sort(compararAchados),
  };
};

// ─── cursor autenticado (R2) ────────────────────────────────────────────────
const VERSAO_CURSOR = 2;
const ROTULO_CURSOR = 'maike-estoque-reconciliacao-cursor:v2';
const SAL_CURSOR = 'maike-estoque-fisico';
const TAMANHO_MAC = 32;
const VALIDADE_CURSOR_MS = 24 * 60 * 60 * 1000;
const FOLGA_RELOGIO_MS = 5 * 60 * 1000;
/** Contadores cumulativos que viajam ASSINADOS no cursor (ordem fixa). */
const CONTADORES = Object.freeze(['chaves', 'produtos', 'orfas', 'locais', 'lotes', 'movimentos', 'exclusoes', 'DIVERGENCIA_REAL', 'LIMITACAO_LEGADA',
  'DADOS_INSUFICIENTES', 'paginas', 'truncadas', 'evidenciaParcial']);
const CHAVES_ESTADO = Object.freeze(['a', 'c', 'f', 'n', 't', 't0', 'v', 'xe', 'xi']);

/** Recusa ÚNICA do cursor (mesma mensagem e detalhe para qualquer desvio: sem oráculo). */
const cursorInvalido = () => new AppError('REQUEST_VALIDATION_FAILED', 'cursor da reconciliação inválido; recomece sem cursor', {
  details: { field: 'cursor', reason: 'cursor_invalido' },
});

let chaveCursorCache = /** @type {Buffer|null} */ (null);
let segredoCursorCache = /** @type {string|null} */ (null);
const chaveCursor = () => {
  const segredo = env.authSecret;
  if (!segredo) throw new AppError('INTERNAL_ERROR', 'segredo do servidor ausente');
  if (segredoCursorCache !== segredo) {
    chaveCursorCache = Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.from(SAL_CURSOR, 'utf8'), ROTULO_CURSOR, TAMANHO_MAC));
    segredoCursorCache = segredo;
  }
  return /** @type {Buffer} */ (chaveCursorCache);
};
/** Tudo a que o cursor fica amarrado: versão, tenant do auth_context, empresa, produto, local e limite. */
const amarra = (cli, f, limite) => JSON.stringify(['estoque-reconciliacao', VERSAO_CURSOR, cli, f.empresaId, f.produtoId, f.localId, limite]);
const macDe = (cli, f, limite, corpo) => createHmac('sha256', chaveCursor()).update(amarra(cli, f, limite)).update('\n').update(corpo).digest();

/** @param {any} estado @param {string} cli @param {{ empresaId: string|null, produtoId: string|null, localId: string|null }} f @param {number} limite */
const codificarCursor = (estado, cli, f, limite) => {
  const corpo = Buffer.from(JSON.stringify(estado), 'utf8');
  return Buffer.concat([corpo, macDe(cli, f, limite, corpo)]).toString('base64url');
};
const textoDeChave = (v) => typeof v === 'string' && v.length <= 128 && !v.includes('\u0000');
const inteiroNaoNegativo = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * Confere o cursor ANTES de qualquer ida ao banco: forma, assinatura (tempo
 * constante), versão, campos, fase, posições, contadores e validade (24 h,
 * relógio do servidor com 5 min de folga). Qualquer desvio → `cursorInvalido()`.
 * @param {unknown} bruto @param {string} cli
 * @param {{ empresaId: string|null, produtoId: string|null, localId: string|null }} f
 * @param {number} limite @param {number} agora ms
 */
const decodificarCursor = (bruto, cli, f, limite, agora) => {
  if (typeof bruto !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(bruto)) throw cursorInvalido();
  const bytes = Buffer.from(bruto, 'base64url');
  if (bytes.toString('base64url') !== bruto || bytes.length <= TAMANHO_MAC) throw cursorInvalido();
  const corpo = bytes.subarray(0, bytes.length - TAMANHO_MAC);
  const recebido = bytes.subarray(bytes.length - TAMANHO_MAC);
  if (!timingSafeEqual(macDe(cli, f, limite, corpo), recebido)) throw cursorInvalido();
  /** @type {any} */
  let e;
  try {
    e = JSON.parse(corpo.toString('utf8'));
  } catch {
    throw cursorInvalido();
  }
  const ok = e && typeof e === 'object' && !Array.isArray(e)
    && Object.keys(e).sort().join(',') === CHAVES_ESTADO.join(',')
    && e.v === VERSAO_CURSOR
    && ['k', 'x', 'n'].includes(e.f)
    && (e.a === null || textoDeChave(e.a))
    && (e.xe === null || textoDeChave(e.xe)) && (e.xi === null || textoDeChave(e.xi))
    && (e.f === 'k' ? e.xe === null && e.xi === null : e.a === null)
    && (e.f !== 'x' || (e.xe === null) === (e.xi === null))
    && (e.f !== 'n' || e.xe === null)
    && Number.isSafeInteger(e.c) && e.c >= 1
    && inteiroNaoNegativo(e.t0) && inteiroNaoNegativo(e.t) && e.t0 <= e.t
    && e.t <= agora + FOLGA_RELOGIO_MS && agora - e.t <= VALIDADE_CURSOR_MS
    && Array.isArray(e.n) && e.n.length === CONTADORES.length && e.n.every(inteiroNaoNegativo);
  if (!ok) throw cursorInvalido();
  return /** @type {{ v: number, f: 'k'|'x'|'n', a: string|null, xe: string|null, xi: string|null, t0: number, t: number, c: number, n: number[] }} */ (e);
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
const normalizarLimite = (v) => (Number.isInteger(v) ? Math.min(Math.max(/** @type {number} */ (v), 1), LIMITE_MAXIMO) : LIMITE_PADRAO);
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const lerJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v ?? []);

/**
 * A varredura da reconciliação, num `tx` já aberto (a rota abre a transação
 * RepeatableRead; o teste mede as idas ao banco e a estatística da transação
 * com o próprio `tx`). Ver o cabeçalho para as fases, o orçamento e o
 * contrato da cobertura.
 * @param {any} tx
 * @param {string} cli tenant do auth_context
 * @param {{ empresaId?: string|null, produtoId?: string|null, localId?: string|null, limite?: number, cursor?: string,
 *   estado?: ReturnType<typeof decodificarCursor>|null }} filtro  `cursor` cru (conferido aqui) ou `estado` já conferido
 * @param {Partial<typeof ORCAMENTO_PADRAO>} [orcamento]
 * @param {Date} [instante] o "agora" do servidor desta chamada
 */
export const lerReconciliacao = async (tx, cli, filtro = {}, orcamento = undefined, instante = agoraDoServidor()) => {
  const f = { empresaId: texto(filtro.empresaId), produtoId: texto(filtro.produtoId), localId: texto(filtro.localId) };
  const limite = normalizarLimite(filtro.limite);
  const agora = instante.getTime();
  const anterior = filtro.estado !== undefined ? filtro.estado
    : (filtro.cursor === undefined || filtro.cursor === null ? null : decodificarCursor(filtro.cursor, cli, f, limite, agora));
  await tx.$queryRaw`SET TRANSACTION READ ONLY`;
  const o = normalizarOrcamento(orcamento);
  // `statement_timeout` (< 20 s da transação): uma consulta nunca sobrevive à transação que o Prisma já
  // abandonou (medido no código anterior: plano genérico rodando 8 min 50 s depois do timeout de 20 s).
  // D-PROD-202 (antes D-PROD-193, I-z): a MESMA 2ª instrução lê do catálogo se as tabelas das linhas de produto do
  // apontamento da atividade já existem (`to_regclass` nunca falha): nenhuma ida a mais ao banco.
  const [config] = /** @type {Array<{ com_itens_apontamento: boolean }>} */ (await tx.$queryRaw`SELECT set_config('plan_cache_mode', 'force_custom_plan', true), set_config('jit', 'off', true),
    set_config('statement_timeout', ${`${o.instrucaoMs}ms`}, true),
    (to_regclass('public."AtividadeApontamentoProduto"') IS NOT NULL AND to_regclass('public."AtividadeApontamentoProdutoConsumoLote"') IS NOT NULL) AS com_itens_apontamento`);
  const comItens = Boolean(config?.com_itens_apontamento);
  const inicio = Date.now();
  if (f.empresaId !== null) await exigirEmpresaDoTenant(tx, cli, f.empresaId);

  /** @type {'k'|'x'|'n'|'fim'} */
  let fase = anterior?.f ?? 'k';
  let desde = anterior?.a ?? null;
  let aposX = { entidade: anterior?.xe ?? null, id: anterior?.xi ?? null };
  const [contagem] = /** @type {any[]} */ (await tx.$queryRaw`SELECT count(*)::int AS total,
      ${fase === 'k' && desde !== null ? Prisma.sql`(count(*) FILTER (WHERE p.id <= ${desde}))` : fase === 'k' ? Prisma.sql`0` : Prisma.sql`count(*)`}::int AS antes
    FROM "Produto" p WHERE p.cliente_id = ${cli}${igual('p.empresa_id', f.empresaId)}${igual('p.id', f.produtoId)}`);

  const atual = Object.fromEntries(CONTADORES.map((k) => [k, 0]));
  /** @type {any[]} */
  let achados = [];
  /** Produtos/locais divergentes cuja classe a evidência de exclusão mudaria: decididos no fim da chamada. */
  /** @type {Array<{ tipo: 'produto'|'local', linha: any, aud: any[], audP?: any[] }>} */
  const adiados = [];
  /** Exclusões lidas pela fase de exclusões nesta chamada (servem de evidência se a fase for lida inteira aqui). */
  /** @type {any[]} */
  const exclusoesDaFase = [];
  const faseXDesdeOInicio = fase === 'k' || (fase === 'x' && aposX.entidade === null);
  let linhasPrevistas = 0;
  let exclusoesLidas = 0;
  let unidades = 0;
  /** @type {null|'orcamento'|'tempo'} */
  let interrompida = null;
  const registrar = (lista0, a) => {
    if (!a) return;
    atual[a.classe] += 1;
    lista0.push(a);
  };
  const juntar = (lista0) => { achados = [...achados, ...lista0].sort(compararAchados).slice(0, limite); };
  const FALSA_EXCLUSAO = Object.freeze({ entidade: 'EstoqueLoteNota', acao: 'delete' });
  const mudaComExclusao = (a0, a1) => (a0?.classe ?? null) !== (a1?.classe ?? null) || (a0?.regra ?? null) !== (a1?.regra ?? null);

  while (fase !== 'fim') {
    if (unidades > 0) {
      if (linhasPrevistas >= o.linhasPorChamada) interrompida = 'orcamento';
      else if (Date.now() - inicio >= o.tempoMs) interrompida = 'tempo';
      if (interrompida) break;
    }
    unidades += 1;
    if (fase === 'k') {
      const candidatos = /** @type {any[]} */ (await lerChaves(tx, cli, f, desde, o.produtosPorPagina + 1));
      if (!candidatos.length) {
        unidades -= 1; // nenhuma chave depois da âncora: passa às exclusões sem gastar a vez
        fase = 'x';
        continue;
      }
      // Corte da página pela pré-contagem: a 1ª chave sempre entra (uma chave mais pesada que a página é varrida
      // sozinha: nunca pulada nem partida); as seguintes, até `linhasPorPagina`. Depois da 1ª unidade da chamada,
      // nada passa do que ainda cabe no orçamento da CHAMADA: a chave pesada que não cabe fica para a próxima
      // chamada, onde abre a página.
      const resto = unidades > 1 ? o.linhasPorChamada - linhasPrevistas : Infinity;
      let k = 0;
      let custo = 0;
      while (k < candidatos.length && k < o.produtosPorPagina) {
        // R2 (LC-2): + as linhas de recibo legado que Q3 e Q4 leem (cada uma lê o intervalo da chave uma vez)
        const c = 1 + candidatos[k].n_lotes + candidatos[k].n_movimentos + 2 * candidatos[k].n_recibos_legados;
        if (custo + c > resto || (k > 0 && custo + c > o.linhasPorPagina)) break;
        custo += c;
        k += 1;
      }
      if (k === 0) {
        interrompida = 'orcamento';
        break;
      }
      const chaves = candidatos.slice(0, k);
      const faixa = { desde, ate: chaves[k - 1].id };
      const produtos = chaves.filter((c) => c.no_escopo);
      const teto = o.anomaliasPorConsulta;
      const auditoria = /** @type {any[]} */ (await lerAuditoria(tx, cli, f, faixa, produtos.map((p) => p.id), teto));
      const locais = /** @type {any[]} */ (await lerLocais(tx, cli, f, faixa));
      const evidencia = [...new Set(auditoria.filter((a) => a.entidade === 'EstoqueLoteNota').map((a) => a.entidade_id))];
      // Amostra de órfãos: só as vagas da lista que um DADOS_INSUFICIENTES ainda pode ocupar (a contagem é exata no SQL).
      const vagas = chaves.some((c) => !c.existe) ? Math.max(limite - achados.filter((a) => GRAVIDADE[a.classe] <= GRAVIDADE.DADOS_INSUFICIENTES).length, 0) : 0;
      const lotes = /** @type {any[]} */ (await lerLotes(tx, cli, f, faixa, evidencia, teto, vagas, comItens));
      const movimentos = /** @type {any[]} */ (await lerMovimentos(tx, cli, f, faixa, teto, vagas, comItens));
      const lotesSuspeitos = lotes.filter((l) => !l.amostra_orfa);
      const movsSuspeitos = movimentos.filter((m) => !m.amostra_orfa);
      const truncada = auditoria.length > teto || lotesSuspeitos.length > teto || movsSuspeitos.length > teto;
      const lotesDaPagina = [...lotesSuspeitos.slice(0, teto), ...lotes.filter((l) => l.amostra_orfa)];
      const movsDaPagina = [...movsSuspeitos.slice(0, teto), ...movimentos.filter((m) => m.amostra_orfa)];
      const ix = indexarAuditoria(auditoria.slice(0, teto));
      const semRecibo = new Set(movsDaPagina.filter((m) => m.legado && !m.tem_recibo).map((m) => chaveLocal(m.empresa_id, m.produto_id, m.local_estoque_id)));
      /** @type {any[]} */
      const daPagina = [];
      for (const p of produtos) {
        const audP = ix.audProduto.get(p.id) ?? [];
        const audOutros = ix.audDoProduto.get(p.id) ?? [];
        const a0 = achadoProduto(p, audP, audOutros);
        if (mudaComExclusao(a0, achadoProduto(p, audP, [...audOutros, FALSA_EXCLUSAO]))) adiados.push({ tipo: 'produto', linha: p, aud: audOutros, audP });
        else registrar(daPagina, a0);
      }
      for (const r of locais) {
        const aud = ix.audDoLocal.get(chaveLocal(r.empresa_id, r.produto_id, r.local_estoque_id)) ?? [];
        const a0 = achadoLocal(r, aud);
        if (!r.produto_inexistente && mudaComExclusao(a0, achadoLocal(r, [...aud, FALSA_EXCLUSAO]))) adiados.push({ tipo: 'local', linha: r, aud });
        else registrar(daPagina, a0);
      }
      for (const l of lotesDaPagina) registrar(daPagina, achadoLote(l, ix.audLote.get(l.id) ?? [], semRecibo));
      for (const m of movsDaPagina) registrar(daPagina, achadoMovimento(m));
      // órfãos além da amostra: classe fixa (DADOS_INSUFICIENTES/produto_inexistente), contados no SQL (Q2)
      const orfaosLotes = locais.filter((r) => r.produto_inexistente).reduce((t, r) => t + r.n_lotes, 0);
      const orfaosMovs = locais.filter((r) => r.produto_inexistente).reduce((t, r) => t + r.n_movimentos, 0);
      atual.DADOS_INSUFICIENTES += Math.max(orfaosLotes - lotes.filter((l) => l.amostra_orfa).length, 0)
        + Math.max(orfaosMovs - movimentos.filter((m) => m.amostra_orfa).length, 0);
      juntar(daPagina);
      // chave do filtro de produto sem produto e sem linha nenhuma não conta (não vira "órfão" de um id qualquer)
      const comConteudo = chaves.filter((c) => c.existe || c.n_lotes + c.n_movimentos > 0);
      atual.chaves += comConteudo.length;
      atual.produtos += produtos.length;
      atual.orfas += comConteudo.filter((c) => !c.existe).length;
      atual.locais += locais.length;
      atual.lotes += locais.reduce((t, r) => t + r.n_lotes, 0);
      atual.movimentos += locais.reduce((t, r) => t + r.n_movimentos, 0);
      atual.paginas += 1;
      if (truncada) atual.truncadas += 1;
      linhasPrevistas += custo;
      desde = faixa.ate;
      if (k === candidatos.length) fase = 'x';
      continue;
    }
    // fases de exclusões: blocos de no máximo `linhasPorPagina` linhas LIDAS
    const n = Math.max(Math.min(o.linhasPorPagina, o.linhasPorChamada - linhasPrevistas), 1);
    const [bloco] = /** @type {any[]} */ (await lerBlocoExclusoes(tx, cli, f, aposX, n, fase === 'n'));
    exclusoesLidas += bloco.lidas;
    linhasPrevistas += bloco.lidas;
    if (bloco.lidas === 0) unidades -= 1; // bloco vazio não gasta a vez desta chamada
    /** @type {any[]} */
    const doBloco = [];
    for (const x of lerJson(bloco.exclusoes)) {
      exclusoesDaFase.push(x);
      if (f.localId !== null && x.local_estoque_id !== f.localId) continue;
      atual.exclusoes += 1;
      registrar(doBloco, achadoExclusao(x));
    }
    juntar(doBloco);
    if (bloco.lidas < n) {
      fase = fase === 'x' && bloco.ha_sem_id ? 'n' : 'fim';
      aposX = { entidade: null, id: null };
    } else {
      aposX = { entidade: fase === 'n' ? null : bloco.ult_entidade, id: bloco.ult_id };
    }
  }

  // evidência de exclusão para os adiados: a fase inteira desta chamada, ou UMA busca com teto
  /** @type {'nao_necessaria'|'completa'|'parcial'} */
  let evidenciaExclusoes = 'nao_necessaria';
  let auditoriaLida = 0;
  if (adiados.length) {
    /** @type {any[]} */
    let exclusoes;
    if (faseXDesdeOInicio && fase === 'fim') {
      exclusoes = exclusoesDaFase;
      evidenciaExclusoes = 'completa';
    } else {
      const ids = [...new Set(adiados.map((a) => a.linha.produto_id ?? a.linha.id))];
      const [ev] = /** @type {any[]} */ (await lerEvidenciaExclusoes(tx, cli, f, ids, o.auditoriaPorChamada));
      auditoriaLida = ev.lidas;
      exclusoes = lerJson(ev.exclusoes);
      evidenciaExclusoes = ev.lidas > o.auditoriaPorChamada ? 'parcial' : 'completa';
    }
    if (evidenciaExclusoes === 'parcial') atual.evidenciaParcial += 1;
    const comoEvidencia = exclusoes.map((x) => ({ entidade: 'EstoqueLoteNota', acao: 'delete', entidade_id: x.lote_id, produto_id: x.produto_id, empresa_id: x.empresa_id,
      local_estoque_id: x.local_estoque_id, local_estoque_id_anterior: null }));
    const ix = indexarAuditoria(comoEvidencia);
    /** @type {any[]} */
    const decididos = [];
    for (const a of adiados) {
      if (a.tipo === 'produto') registrar(decididos, achadoProduto(a.linha, a.audP ?? [], [...a.aud, ...(ix.audDoProduto.get(a.linha.id) ?? [])]));
      else registrar(decididos, achadoLocal(a.linha, [...a.aud, ...(ix.audDoLocal.get(chaveLocal(a.linha.empresa_id, a.linha.produto_id, a.linha.local_estoque_id)) ?? [])]));
    }
    juntar(decididos);
  }

  // cobertura: desta chamada, cumulativa (cursor assinado) e a conclusão global
  const previo = anterior?.n ?? CONTADORES.map(() => 0);
  const cum = Object.fromEntries(CONTADORES.map((k, i) => [k, previo[i] + atual[k]]));
  const fim = fase === 'fim';
  const motivos = [];
  if (!fim) motivos.push('continua_no_cursor');
  if (anterior !== null) motivos.push('varios_snapshots');
  if (cum.truncadas > 0) motivos.push('paginas_truncadas');
  if (cum.evidenciaParcial > 0) motivos.push('evidencia_de_exclusao_parcial');
  const comprovada = motivos.length === 0;
  const totalAchados = atual.DIVERGENCIA_REAL + atual.LIMITACAO_LEGADA + atual.DADOS_INSUFICIENTES;
  const entidades = atual.produtos + atual.locais + atual.lotes + atual.movimentos + atual.exclusoes;
  const lacunas = !fim || cum.truncadas > 0 || cum.evidenciaParcial > 0;
  const iniciadaEm = anterior?.t0 ?? agora;
  const proximo = fim ? null : codificarCursor({
    v: VERSAO_CURSOR, f: fase, a: fase === 'k' ? desde : null, xe: fase === 'x' ? aposX.entidade : null, xi: fase === 'k' ? null : aposX.id,
    t0: iniciadaEm, t: agora, c: (anterior?.c ?? 0) + 1, n: CONTADORES.map((k) => cum[k]),
  }, cli, f, limite);
  return {
    truncado: totalAchados > limite,
    cobertura: {
      completa: comprovada,
      conclusao_global: comprovada ? 'COMPROVADA' : 'INCONCLUSIVA',
      conclusao_global_comprovada: comprovada,
      motivos_inconclusiva: motivos,
      fim_do_escopo: fim,
      snapshot_unico: anterior === null && fim,
      fase: FASES[fase],
      nivel_produto: 'todos_os_locais',
      produtos_no_escopo: contagem.total,
      produtos_antes_do_cursor: contagem.antes,
      produtos_varridos: atual.produtos,
      produtos_restantes: Math.max(contagem.total - contagem.antes - atual.produtos, 0),
      chaves_varridas: atual.chaves,
      chaves_orfas_varridas: atual.orfas,
      paginas: atual.paginas,
      paginas_truncadas: atual.truncadas,
      linhas_previstas: linhasPrevistas,
      exclusoes_lidas: exclusoesLidas,
      evidencia_exclusoes: evidenciaExclusoes,
      auditoria_lida: auditoriaLida,
      interrompida_por: interrompida,
      proximo_cursor: proximo,
      cumulativa: {
        chamadas: (anterior?.c ?? 0) + 1,
        iniciada_em: new Date(iniciadaEm).toISOString(),
        chaves_varridas: cum.chaves,
        produtos_varridos: cum.produtos,
        chaves_orfas_varridas: cum.orfas,
        locais: cum.locais,
        lotes: cum.lotes,
        movimentos: cum.movimentos,
        exclusoes_legadas: cum.exclusoes,
        paginas: cum.paginas,
        paginas_truncadas: cum.truncadas,
        chamadas_com_evidencia_parcial: cum.evidenciaParcial,
        por_classe: { DIVERGENCIA_REAL: cum.DIVERGENCIA_REAL, LIMITACAO_LEGADA: cum.LIMITACAO_LEGADA, DADOS_INSUFICIENTES: cum.DADOS_INSUFICIENTES },
      },
    },
    resumo: {
      situacao: comprovada ? (totalAchados ? 'COM_ACHADOS' : 'CONSISTENTE') : lacunas ? 'INCOMPLETO' : 'INCONCLUSIVO',
      produtos: atual.produtos,
      locais: atual.locais,
      lotes: atual.lotes,
      movimentos: atual.movimentos,
      exclusoes_legadas: atual.exclusoes,
      // Sobre dados parciais ou vários snapshots nada é declarado OK: só as classes encontradas (limite inferior).
      por_classe: {
        OK: comprovada ? entidades - totalAchados : null,
        DIVERGENCIA_REAL: atual.DIVERGENCIA_REAL, LIMITACAO_LEGADA: atual.LIMITACAO_LEGADA, DADOS_INSUFICIENTES: atual.DADOS_INSUFICIENTES,
      },
    },
    achados,
  };
};

// ─── serviço ────────────────────────────────────────────────────────────────
const PRAZO_ESGOTADO = 'a leitura da reconciliação não terminou no prazo; filtre por empresa/produto ou continue pelo cursor; nada foi gravado';
/** Instrução cancelada pelo `statement_timeout` da leitura (SQLSTATE 57014, embrulhado pelo Prisma como P2010). */
const instrucaoCancelada = (erro) => {
  const e = /** @type {any} */ (erro);
  return (e?.code === 'P2010' && String(e?.meta?.code) === '57014') || /57014|canceling statement due to statement timeout/.test(String(e?.message ?? ''));
};

/**
 * Reconciliação SOMENTE LEITURA do estoque físico do tenant (SPEC §5), com
 * varredura limitada, cursor autenticado e cobertura explícita (R1 + R2).
 *
 * Resposta (200): `{ escopo, gerado_em, truncado, cobertura, resumo, achados }`.
 *  - `cobertura.fim_do_escopo` — esta chamada chegou ao fim do escopo; senão
 *    `cobertura.proximo_cursor` continua de onde parou (fase em `cobertura.fase`).
 *  - `cobertura.cumulativa` — totais da varredura desde a 1ª chamada
 *    (`chamadas`, `iniciada_em`, chaves, produtos, órfãos, locais, lotes,
 *    movimentos, exclusões, páginas e páginas truncadas, `por_classe`).
 *  - `cobertura.conclusao_global` — 'COMPROVADA' só com o escopo inteiro
 *    verificado nesta chamada (um snapshot RepeatableRead), sem página
 *    truncada nem evidência parcial; senão 'INCONCLUSIVA' com
 *    `motivos_inconclusiva`. `completa` = `conclusao_global_comprovada`.
 *  - `resumo.situacao` — CONSISTENTE | COM_ACHADOS (só com conclusão
 *    comprovada) | INCOMPLETO (falta escopo, página truncada ou evidência
 *    parcial) | INCONCLUSIVO (escopo inteiro, mas em vários snapshots);
 *    `resumo.por_classe.OK` é null sempre que a conclusão não é comprovada.
 * Cursor inválido (qualquer desvio) → 400 `REQUEST_VALIDATION_FAILED`
 * `{field:'cursor', reason:'cursor_invalido'}` antes de qualquer ida ao banco;
 * prazo esgotado → 409 `CONCURRENCY_CONFLICT`, nada gravado.
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext, requestId?: string }} contexto  tenant SÓ de auth_context (R11)
 * @param {{ empresaId?: string, produtoId?: string, localId?: string, limite?: number, cursor?: string }} [filtro]  limite padrão 500, máx 2000
 * @param {Partial<typeof ORCAMENTO_PADRAO>} [orcamento] só chamadas internas/testes; o HTTP usa `ORCAMENTO_PADRAO`
 */
export const reconciliarEstoque = async (contexto, filtro = {}, orcamento = undefined) => {
  const auth = exigirAuthContext(contexto?.auth);
  const instante = agoraDoServidor();
  const f = { empresaId: texto(filtro?.empresaId), produtoId: texto(filtro?.produtoId), localId: texto(filtro?.localId) };
  const limite = normalizarLimite(filtro?.limite);
  const estado = filtro?.cursor === undefined || filtro?.cursor === null ? null : decodificarCursor(filtro.cursor, auth.clienteId, f, limite, instante.getTime());
  // Disputa de leitura, transação expirada (P2028) ou instrução cancelada pelo `statement_timeout` (57014):
  // 409 sem nada gravado e sem nenhum "OK"; a mensagem orienta a filtrar ou continuar pelo cursor (fail-closed).
  /** @type {Awaited<ReturnType<typeof lerReconciliacao>>} */
  let r;
  try {
    r = await emTransacao(LEITURA, (tx) => lerReconciliacao(tx, auth.clienteId, { ...f, limite, estado }, orcamento, instante), {}, PRAZO_ESGOTADO);
  } catch (erro) {
    if (instrucaoCancelada(erro)) throw new AppError('CONCURRENCY_CONFLICT', PRAZO_ESGOTADO, { cause: erro });
    throw erro;
  }
  return {
    escopo: { empresa_id: f.empresaId, produto_id: f.produtoId, local_estoque_id: f.localId, limite },
    gerado_em: instante.toISOString(),
    truncado: r.truncado,
    cobertura: r.cobertura,
    resumo: r.resumo,
    achados: r.achados,
  };
};
