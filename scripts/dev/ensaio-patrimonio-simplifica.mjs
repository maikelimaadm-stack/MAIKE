#!/usr/bin/env node
/**
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01) — ensaio LOCAL automatizado da
 * migration CONTRACT `20261110300000_patrimonio_simplifica` (contrato §7.4).
 *
 * Só banco LOCAL e descartável: a URL tem de apontar para esta máquina
 * (localhost, 127.0.0.1, ::1 ou socket); qualquer outra é recusada antes de
 * conectar. Nunca imprime URL. Nada aqui toca produção.
 *
 * O que faz, num banco próprio (`--banco`, padrão maike_ensaio_simplifica):
 *  1. aplica as 42 migrations da main (todas menos esta CONTRACT), pelo Prisma,
 *     a partir de uma cópia temporária das pastas; entre elas estão as CONTRACT
 *     `20261113200000_tipo_tarefa_drop_colunas` (D-PROD-183) e
 *     `20261113500000_categoria_manejo_cadcategoria` (D-PROD-187), que sobem
 *     aqui pelo Prisma direto, sem o runner e portanto sem a barreira de
 *     MIGRATION_CONTRACT_AUTORIZADO; as guardas delas passam porque TipoTarefa
 *     e CategoriaManejo estão vazias nessa hora (as sementes vêm depois e não
 *     criam nenhuma das duas). Elas não criam nem apagam tabela (a D-PROD-187
 *     só renomeia): as contagens de tabelas não mudam;
 *  2. semeia as 13 tabelas do Patrimônio antigo por cliente (famílias, tipos,
 *     perfis, combustíveis, vínculos, fatores, bens, tanques, medições,
 *     abastecimentos CANCELADOS com saída + estorno + fatias), um lote e uma
 *     compra P3 em KG;
 *  3. roda os cenários RED (CONFIRMADO, FK e visão de fora, trava concorrente,
 *     sem impressão, impressão errada, papel que não é o dono, gatilho,
 *     política, publicação, runner sem MIGRATION_CONTRACT_AUTORIZADO no alvo
 *     "remoto" simulado): cada um tem de recusar e não mudar nada; a falha
 *     aberta é resolvida com `migrate resolve --rolled-back`;
 *  4. aplica pelo runner oficial (`npm run deploy:migrate`, com a conferência
 *     de alvo exigida, MIGRATION_CONTRACT_AUTORIZADO=D-PROD-162 e a impressão
 *     na URL) e confere: 43 concluídas, 80 tabelas, as 7 vazias, dono e ACL,
 *     RLS, contagens de constraints, impressão digital das 73 que ficam,
 *     CHECKs alargados, estoque intacto, `migrate diff` vazio e 2ª execução.
 *
 * As funções são exportadas e reaproveitadas por
 * `backend/tests/patrimonioSimplificaMigration.test.mjs` (mesma prova no CI).
 *
 *   node scripts/dev/ensaio-patrimonio-simplifica.mjs --url postgresql://postgres@localhost:5433/postgres?host=/tmp
 *        [--banco maike_ensaio_simplifica] [--clientes 2] [--bens 1] [--cancelados 1] [--sem-red]
 *
 * As sementes imitam as contagens do preflight por cliente com `--clientes`,
 * `--bens` (bens por cliente; cada um com 1 tanque, 1 medição e 1 combustível
 * permitido) e `--cancelados` (abastecimentos CANCELADOS por cliente, no 1º).
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { motivoAlvoProtegido } from '../auth/alvoProtegido.mjs';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

export const NOME_CONTRACT = '20261110300000_patrimonio_simplifica';
export const DECISAO = 'D-PROD-162';
/** As 13 tabelas apagadas, na ordem da guarda e dos DROP. */
export const TABELAS_APAGADAS = Object.freeze(['AbastecimentoBemConsumoLote', 'AbastecimentoBem', 'ConversaoCombustivelProduto', 'TipoCombustivelProduto', 'TanqueBemCombustivel', 'TanqueBem', 'MedicaoBem', 'BemPatrimonial', 'TipoPatrimonialPerfil', 'TipoPatrimonial', 'FamiliaPatrimonial', 'PerfilMedicao', 'TipoCombustivel']);
/** As 7 tabelas do formato novo (ordem alfabética, como no DO de RLS). */
export const TABELAS_NOVAS = Object.freeze(['AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'BemPatrimonial', 'FamiliaPatrimonial', 'TanqueBem', 'TanqueBemProduto', 'TipoPatrimonial']);
/** Tabelas antigas cujas LINHAS a migration não pode mudar. */
export const TABELAS_ESTOQUE = Object.freeze(['MovimentacaoEstoque', 'EstoqueLoteNota', 'Produto', 'OperacaoFinanceira', 'OperacaoFinanceiraItem']);

/** Impressão das contagens das 13 (a mesma conta da guarda; rascunho ensaio/impressao.sql do contrato). */
export const SQL_IMPRESSAO = `WITH c(ord, tabela, cliente_id, n) AS (
${TABELAS_APAGADAS.map((t, i) => `  ${i ? 'UNION ALL ' : ''}SELECT ${i + 1}, '${t}', cliente_id, count(*) FROM "${t}" GROUP BY cliente_id`).join('\n')}
)
SELECT coalesce(sum(n), 0)::int AS linhas,
       left(md5(coalesce(string_agg(tabela || '|' || cliente_id || '|' || n, E'\\n' ORDER BY ord, cliente_id COLLATE "C"), '')), 12) AS impressao
  FROM c`;

/** Impressão digital das tabelas que FICAM, sem os 2 CHECKs alargados de OperacaoFinanceiraItem (rascunho ensaio/fingerprint_v2.sql). */
export const SQL_FINGERPRINT_V2 = `WITH patr(t) AS (VALUES ${[...TABELAS_APAGADAS, 'TanqueBemProduto'].map((t) => `('${t}')`).join(',')}),
tab AS (
  SELECT c.oid, c.relname::text AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force, coalesce(c.relacl::text, '') AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relname NOT IN (SELECT t FROM patr)
),
linhas AS (
  SELECT 'tabela' AS cat, t || '|rls=' || rls || '|force=' || force || '|acl=' || acl AS l FROM tab
  UNION ALL
  SELECT 'coluna', t.t || '.' || a.attname::text || '|' || a.attnum || '|' || format_type(a.atttypid, a.atttypmod) || '|nn=' || a.attnotnull
         || '|def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|coll=' || coalesce(co.collname::text, '')
    FROM tab t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_collation co ON co.oid = a.attcollation AND a.attcollation <> 0
  UNION ALL
  SELECT 'constraint', t.t || '|' || k.conname::text || '|' || k.contype::text || '|' || pg_get_constraintdef(k.oid, true)
    FROM tab t JOIN pg_constraint k ON k.conrelid = t.oid
   WHERE NOT (t.t = 'OperacaoFinanceiraItem' AND k.conname IN ('OperacaoFinanceiraItem_unidade_check', 'OperacaoFinanceiraItem_forma_check'))
  UNION ALL
  SELECT 'indice', t.t || '|' || i.relname::text || '|' || pg_get_indexdef(i.oid)
    FROM tab t JOIN pg_index x ON x.indrelid = t.oid JOIN pg_class i ON i.oid = x.indexrelid
  UNION ALL
  SELECT 'politica', p.tablename::text || '|' || p.policyname::text || '|' || p.cmd || '|' || array_to_string(p.roles, ',') || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')
    FROM pg_policies p JOIN tab t ON t.t = p.tablename::text WHERE p.schemaname = 'public'
  UNION ALL
  SELECT 'gatilho', t.t || '|' || g.tgname::text || '|' || pg_get_triggerdef(g.oid)
    FROM tab t JOIN pg_trigger g ON g.tgrelid = t.oid AND NOT g.tgisinternal
  UNION ALL
  SELECT 'fk_entrando', t.t || '<-' || k.conrelid::regclass::text || '|' || k.conname::text
    FROM tab t JOIN pg_constraint k ON k.confrelid = t.oid AND k.contype = 'f'
    JOIN pg_class o ON o.oid = k.conrelid
   WHERE o.relname NOT IN (SELECT t FROM patr)
)
SELECT categoria, n::int AS n, md5 FROM (
  SELECT cat AS categoria, count(*) AS n, md5(string_agg(l, E'\\n' ORDER BY l COLLATE "C")) AS md5 FROM linhas GROUP BY cat
  UNION ALL
  SELECT 'TOTAL', count(*), md5(string_agg(cat || ':' || l, E'\\n' ORDER BY cat COLLATE "C", l COLLATE "C")) FROM linhas
) r
ORDER BY categoria COLLATE "C"`;

const SQL_TABELAS_PUBLIC = `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
export const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`ensaio D-PROD-162: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
  return url;
};

/** Mesma URL, outro banco lógico. */
export const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
/** Mesma URL, outro usuário (para o cenário do papel que não é o dono). */
export const comUsuario = (url, usuario, senha) => Object.assign(new URL(url), { username: usuario, password: senha }).toString();
/** A impressão do GO (e o lock_timeout) pelas `options` da URL, como no caminho A do runbook. */
export const comImpressao = (url, impressao, { lockTimeout = '5s' } = {}) => {
  const opcoes = `${lockTimeout ? `-c lock_timeout=${lockTimeout} ` : ''}-c maike.simplifica_impressao=${impressao}`;
  return `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(opcoes)}`;
};

/** Executa um processo sem shell e devolve status, saída e duração (assíncrono: o laço de eventos segue vivo). */
export const rodar = (comando, args, { env = process.env, cwd = RAIZ } = {}) =>
  new Promise((resolve) => {
    const inicio = Date.now();
    const filho = spawn(comando, args, { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr, saida: `${stdout}\n${stderr}`, ms: Date.now() - inicio }));
  });

/** Ambiente limpo para o runner: sem as conexões herdadas do shell do operador. */
const ambienteBase = () => {
  const env = { ...process.env };
  for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'MIGRATION_DATABASE_URL', 'MIGRATION_EXIGIR_CONFERENCIA', 'MIGRATION_EXPECTED_SYSTEM_IDENTIFIER', 'MIGRATION_CONTRACT_AUTORIZADO']) delete env[k];
  return env;
};

const prisma = (args, url) => rodar(process.execPath, [PRISMA_CLI, ...args], { env: { ...ambienteBase(), DATABASE_URL: url } });

/**
 * As 42 migrations da main (todas as pastas menos esta CONTRACT), aplicadas pelo Prisma a partir de uma cópia
 * temporária. Inclui as CONTRACT da D-PROD-183 e da D-PROD-187, sem o runner: as guardas delas passam com
 * TipoTarefa e CategoriaManejo vazias.
 */
export const aplicarMigrationsDaMain = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-simplifica-main-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of readdirSync(MIGRATIONS)) if (d !== NOME_CONTRACT) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`ensaio D-PROD-162: as migrations da main não subiram (exit ${r.status})`);
    return r;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** O runner oficial (`npm run deploy:migrate`). `runtime` é a conexão do runtime (DATABASE_URL) quando a conferência de alvo é exigida. */
export const aplicarPeloRunner = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });

export const resolverRevertida = (url) => prisma(['migrate', 'resolve', '--rolled-back', NOME_CONTRACT, '--schema', SCHEMA], url);
export const migrateDiff = (url) => prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', SCHEMA, '--exit-code'], url);

const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
export const contarTabelas = async (db) => (await um(db, SQL_TABELAS_PUBLIC)).n;
export const impressao = (db) => um(db, SQL_IMPRESSAO);
export const fingerprintV2 = (db) => db.$queryRawUnsafe(SQL_FINGERPRINT_V2);
export const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
export const historico = async (db) =>
  um(db, `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS revertidas,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS contract_concluida,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NULL AND rolled_back_at IS NULL)::int AS contract_aberta
            FROM "_prisma_migrations"`);

/** Retrato das LINHAS: contagem e md5 de cada tabela apagada e das de estoque/P3 (texto da linha inteira, ordenado). */
export const retrato = async (db) => {
  const r = { tabelas: await contarTabelas(db) };
  for (const t of [...TABELAS_APAGADAS, ...TABELAS_ESTOQUE, 'TanqueBemProduto']) {
    const existe = (await um(db, `SELECT to_regclass('public."${t}"') IS NOT NULL AS e`)).e;
    r[t] = existe ? await um(db, `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, E'\\n' ORDER BY x::text COLLATE "C"), '')) AS md5 FROM public."${t}" x`) : null;
  }
  return r;
};

/** Dono e ACL (texto) das tabelas dadas. */
export const donoEAcl = async (db, tabelas) =>
  db.$queryRawUnsafe(
    `SELECT c.relname::text AS tabela, pg_get_userbyid(c.relowner) AS dono, coalesce(c.relacl::text, '') AS acl, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) ORDER BY 1`,
    tabelas
  );

/** Contagens estruturais das 7 novas: PK, FK, CHECK, índices e colunas por tabela. */
export const estruturaNovas = async (db) => {
  const k = await db.$queryRawUnsafe(
    `SELECT k.contype::text AS tipo, count(*)::int AS n FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) GROUP BY 1`,
    TABELAS_NOVAS
  );
  const idx = await um(db, `SELECT count(*)::int AS n FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN (${TABELAS_NOVAS.map((t) => `'${t}'`).join(',')})`);
  const colunas = await db.$queryRawUnsafe(
    `SELECT table_name::text AS tabela, count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[]) GROUP BY 1 ORDER BY 1`,
    TABELAS_NOVAS
  );
  const porTipo = Object.fromEntries(k.map((x) => [x.tipo, x.n]));
  return { pk: porTipo.p ?? 0, fk: porTipo.f ?? 0, check: porTipo.c ?? 0, indices: idx.n, colunas: Object.fromEntries(colunas.map((c) => [c.tabela, c.n])) };
};

/** Políticas e grants para anon/authenticated das tabelas dadas. */
export const segurancaDe = async (db, tabelas) => ({
  politicas: await db.$queryRawUnsafe(`SELECT tablename::text AS tabela, policyname::text AS nome, cmd, array_to_string(roles, ',') AS papeis FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY 1, 2`, tabelas),
  grants: (await um(db, `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name IN (${tabelas.map((t) => `'${t}'`).join(',')}) AND grantee IN ('anon', 'authenticated', 'PUBLIC')`)).n,
  vercel: (await um(db, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') AS e`)).e,
});

/** Os 2 CHECKs de OperacaoFinanceiraItem como o banco os mostra. */
export const checksOperacaoItem = async (db) =>
  Object.fromEntries((await db.$queryRawUnsafe(`SELECT conname::text AS nome, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = '"OperacaoFinanceiraItem"'::regclass AND conname IN ('OperacaoFinanceiraItem_unidade_check', 'OperacaoFinanceiraItem_forma_check')`)).map((x) => [x.nome, x.def]));

/**
 * Item P3 MERCADORIA em 'L' numa tabela `LIKE "OperacaoFinanceiraItem" INCLUDING DEFAULTS INCLUDING CONSTRAINTS`
 * (temporária, sem FK): prova o achado B1 sem escrever na tabela real.
 */
export const itemEmLitros = async (db) => {
  try {
    await db.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TEMP TABLE ensaio_item_l (LIKE "OperacaoFinanceiraItem" INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP;
      INSERT INTO ensaio_item_l (id, cliente_id, empresa_id, operacao_id, ordem, tipo_item, produto_id, local_estoque_id, unidade, quantidade, fator_kg, quantidade_estoque, valor_unitario, valor_total, valor_liquido, "updatedAt")
      VALUES ('ensaio-item-l', 'c', 'e', 'o', 1, 'MERCADORIA', 'p', 'l', 'L', 100, 1, 100, 6, 600, 600, now());
    END $$`);
    return { aceito: true };
  } catch (e) {
    return { aceito: false, erro: String(e?.meta?.message ?? e?.message ?? e) };
  }
};

/** Verifica que o estoque_atual de cada Produto semeado = Σ disponível dos lotes dele. */
export const estoqueCoerente = async (db) =>
  (await um(db, `SELECT count(*)::int AS n FROM "Produto" p WHERE p.estoque_atual <> coalesce((SELECT sum(l.quantidade_disponivel) FROM "EstoqueLoteNota" l WHERE l.cliente_id = p.cliente_id AND l.produto_id = p.id), 0)`)).n === 0;

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const inserir = (db, tabela, linha) => {
  const cols = Object.keys(linha);
  return db.$executeRawUnsafe(`INSERT INTO public."${tabela}" (${cols.map((c) => `"${c}"`).join(', ')}, "updatedAt") VALUES (${cols.map((c) => (linha[c] && typeof linha[c] === 'object' && 'sql' in linha[c] ? linha[c].sql : q(linha[c]))).join(', ')}, now())`);
};
const sql = (s) => ({ sql: s });

/**
 * Sementes no schema ANTIGO (42 migrations): por cliente, empresa, usuário, local, Produto diesel em KG com lote
 * (entrada de 1.000 kg), catálogos do Patrimônio antigo e `bens` bens com tanque, medição e combustível; o 1º
 * cliente recebe `cancelados` abastecimentos CANCELADOS (saída + estorno + fatia, lote devolvido) e uma compra P3
 * CONFIRMADA em KG ligada à entrada e ao lote.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{clientes?: number, bens?: number, cancelados?: number}} [opcoes]
 */
export const semear = async (db, { clientes = 2, bens = 1, cancelados = 1 } = {}) => {
  const ids = [];
  for (let k = 1; k <= clientes; k++) {
    const c = `sim-c${k}`;
    const id = (s, n = 1) => `${c}-${s}-${n}`;
    ids.push({ cliente: c, empresa: id('emp'), produto: id('prod'), lote: id('lote'), local: id('local'), usuario: id('usr') });
    await inserir(db, 'Cliente', { id: c, codigo: c, nome: `Cliente de ensaio ${k}` });
    await inserir(db, 'Empresa', { id: id('emp'), cliente_id: c, apelido: `Fazenda ${k}`, nome: `Fazenda de ensaio ${k}`, numero_empresa: 1 });
    await inserir(db, 'Usuario', { id: id('usr'), cliente_id: c, nome: 'Operador de ensaio', login: `ensaio${k}`, senha_hash: 'sem-senha-ensaio' });
    await inserir(db, 'LocalEstoque', { id: id('local'), cliente_id: c, numero_local: 'LOC-001', nome: 'Tanque de diesel' });
    await inserir(db, 'Fornecedor', { id: id('forn'), cliente_id: c, empresa_id: id('emp'), numero_cadastro: 'FOR-001', tipo_pessoa: 'juridica', nome: 'Posto de ensaio' });
    const estoqueFinal = 1000;
    await inserir(db, 'Produto', { id: id('prod'), cliente_id: c, empresa_id: id('emp'), numero_produto: 'PRO-001', nome_produto: 'Diesel S10', unidade_medida: 'KG', unidade_principal_estoque: 'KG', estoque_atual: estoqueFinal });
    await inserir(db, 'MovimentacaoEstoque', { id: id('mov-ent'), cliente_id: c, empresa_id: id('emp'), numero_movimentacao: 'MOV-001', tipo_movimentacao: 'Entrada', data_movimentacao: sql("'2026-10-20'"), produto_id: id('prod'), quantidade: 1000, unidade_medida: 'KG', valor_unitario: 6, valor_total: 6000, origem_sistema: 'gestao_p3' });
    await inserir(db, 'EstoqueLoteNota', { id: id('lote'), cliente_id: c, empresa_id: id('emp'), produto_id: id('prod'), local_estoque_id: id('local'), custo_unitario: 6, quantidade_entrada: 1000, quantidade_disponivel: estoqueFinal, movimentacao_entrada_id: id('mov-ent') });
    if (k === 1) {
      await inserir(db, 'OperacaoFinanceira', { id: id('op'), cliente_id: c, empresa_id: id('emp'), numero: 'LAN-0001', status: 'CONFIRMADO', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'AVISTA', parceiro_id: id('forn'), parceiro_nome: 'Posto de ensaio', data_emissao: sql("'2026-10-20'"), data_operacional: sql("'2026-10-20'"), moeda: 'BRL', moeda_casas: 2, valor_bruto: 6000, valor_total: 6000, rateio_modo: 'VALOR', confirmado_em: sql('now()') });
      await inserir(db, 'OperacaoFinanceiraItem', { id: id('op-item'), cliente_id: c, empresa_id: id('emp'), operacao_id: id('op'), ordem: 1, tipo_item: 'MERCADORIA', produto_id: id('prod'), produto_nome: 'Diesel S10', local_estoque_id: id('local'), unidade: 'KG', quantidade: 1000, fator_kg: 1, quantidade_estoque: 1000, valor_unitario: 6, valor_total: 6000, valor_liquido: 6000, movimentacao_estoque_id: id('mov-ent'), estoque_lote_nota_id: id('lote') });
    }
    await inserir(db, 'FamiliaPatrimonial', { id: id('fam'), cliente_id: c, codigo: 'MAQUINAS', nome: 'Máquinas', natureza: 'MAQUINA' });
    await inserir(db, 'TipoPatrimonial', { id: id('tipo'), cliente_id: c, familia_id: id('fam'), codigo: 'TRATOR', nome: 'Trator' });
    await inserir(db, 'PerfilMedicao', { id: id('perfil'), cliente_id: c, codigo: 'CAP_TANQUE', nome: 'Capacidade do tanque', dimensao: 'VOLUME', finalidade: 'CAPACIDADE', unidade_canonica: 'L', unidades_permitidas: sql("ARRAY['L','m3']::text[]") });
    await inserir(db, 'TipoPatrimonialPerfil', { id: id('tipo-perfil'), cliente_id: c, tipo_id: id('tipo'), perfil_id: id('perfil'), principal: sql('true'), ordem: 0 });
    await inserir(db, 'TipoCombustivel', { id: id('comb'), cliente_id: c, codigo: 'DIESEL_S10', nome: 'Diesel S10', unidade: 'L' });
    await inserir(db, 'TipoCombustivelProduto', { id: id('vinc'), cliente_id: c, empresa_id: id('emp'), tipo_combustivel_id: id('comb'), produto_id: id('prod'), ativo: sql('true'), ativo_chave: sql('true') });
    await inserir(db, 'ConversaoCombustivelProduto', { id: id('conv'), cliente_id: c, empresa_id: id('emp'), tipo_combustivel_id: id('comb'), produto_id: id('prod'), sequencia: 1, kg_por_litro: 0.84, declara_estoque_em_kg: sql('true'), ativo: sql('true'), ativo_chave: sql('true'), criado_por_usuario_id: id('usr') });
    for (let b = 1; b <= bens; b++) {
      await inserir(db, 'BemPatrimonial', { id: id('bem', b), cliente_id: c, empresa_id: id('emp'), numero: `BEM-${String(b).padStart(4, '0')}`, nome: `Trator ${b}`, natureza: 'MAQUINA', familia_id: id('fam'), tipo_id: id('tipo'), medidor_tipo: 'SEM_MEDIDOR', responsavel_usuario_id: id('usr') });
      await inserir(db, 'MedicaoBem', { id: id('med', b), cliente_id: c, bem_id: id('bem', b), perfil_id: id('perfil'), valor_informado: 300, unidade_informada: 'L', valor_normalizado: 300, unidade_canonica: 'L', principal: sql('true') });
      await inserir(db, 'TanqueBem', { id: id('tanque', b), cliente_id: c, bem_id: id('bem', b), identificador: 'Principal', capacidade_litros: 300 });
      await inserir(db, 'TanqueBemCombustivel', { id: id('tanque-comb', b), cliente_id: c, tanque_id: id('tanque', b), combustivel_id: id('comb') });
    }
    if (k === 1) {
      for (let a = 1; a <= cancelados; a++) {
        const ab = id('abast', a);
        await inserir(db, 'MovimentacaoEstoque', { id: `${ab}-saida`, cliente_id: c, empresa_id: id('emp'), numero_movimentacao: `MOV-S${a}`, tipo_movimentacao: 'Saída', data_movimentacao: sql("'2026-11-01'"), produto_id: id('prod'), quantidade: 84, unidade_medida: 'KG', valor_unitario: 6, valor_total: 504, origem_sistema: 'abastecimento_patrimonio' });
        await inserir(db, 'MovimentacaoEstoque', { id: `${ab}-estorno`, cliente_id: c, empresa_id: id('emp'), numero_movimentacao: `MOV-E${a}`, tipo_movimentacao: 'Entrada', data_movimentacao: sql("'2026-11-02'"), produto_id: id('prod'), quantidade: 84, unidade_medida: 'KG', valor_unitario: 6, valor_total: 504, origem_sistema: 'abastecimento_patrimonio', movimento_pai_id: `${ab}-saida` });
        await inserir(db, 'AbastecimentoBem', { id: ab, cliente_id: c, empresa_id: id('emp'), numero: `ABS-${String(a).padStart(4, '0')}`, status: 'CANCELADO', bem_id: id('bem'), tanque_id: id('tanque'), tipo_combustivel_id: id('comb'), produto_id: id('prod'), local_estoque_id: id('local'), conversao_id: id('conv'), data_operacional: sql("'2026-11-01'"), quantidade_litros: 100, kg_por_litro: 0.84, quantidade_kg: 84, custo_total: 504, custo_unitario_kg: 6, medidor_tipo: 'SEM_MEDIDOR', operation_id: `op-ensaio-cancelado-${a}`, movimentacao_estoque_id: `${ab}-saida`, movimentacao_estorno_id: `${ab}-estorno`, criado_por_usuario_id: id('usr'), cancelado_por_usuario_id: id('usr'), cancelado_em: sql('now()'), motivo_cancelamento: 'Ensaio D-PROD-162' });
        await inserir(db, 'AbastecimentoBemConsumoLote', { id: `${ab}-fatia`, cliente_id: c, empresa_id: id('emp'), abastecimento_id: ab, estoque_lote_nota_id: id('lote'), ordem: 1, quantidade: 84, custo_unitario: 6 });
      }
    }
  }
  return ids;
};

/**
 * Cenários RED: cada um prepara um estado, tem de ser RECUSADO com a mensagem própria e não pode mudar nada.
 * `impressao`: 'certa' (a do banco), 'ausente' ou 'errada'. `papel`: roda com um superusuário que não é o dono.
 * `trava`: segura ROW EXCLUSIVE em Produto numa outra sessão enquanto o runner roda.
 */
export const CENARIOS_RED = Object.freeze([
  {
    id: 'confirmado',
    esperado: /D-PROD-162: há 1 abastecimento\(s\) CONFIRMADO\(s\)/,
    impressao: 'certa',
    preparar: async (db) => {
      const c = 'sim-c1';
      await inserir(db, 'MovimentacaoEstoque', { id: 'sim-confirmado-saida', cliente_id: c, empresa_id: `${c}-emp-1`, numero_movimentacao: 'MOV-C1', tipo_movimentacao: 'Saída', data_movimentacao: sql("'2026-11-03'"), produto_id: `${c}-prod-1`, quantidade: 42, unidade_medida: 'KG', origem_sistema: 'abastecimento_patrimonio' });
      await inserir(db, 'AbastecimentoBem', { id: 'sim-confirmado', cliente_id: c, empresa_id: `${c}-emp-1`, numero: 'ABS-9001', status: 'CONFIRMADO', bem_id: `${c}-bem-1`, tanque_id: `${c}-tanque-1`, tipo_combustivel_id: `${c}-comb-1`, produto_id: `${c}-prod-1`, local_estoque_id: `${c}-local-1`, conversao_id: `${c}-conv-1`, data_operacional: sql("'2026-11-03'"), quantidade_litros: 50, kg_por_litro: 0.84, quantidade_kg: 42, custo_total: 252, custo_unitario_kg: 6, medidor_tipo: 'SEM_MEDIDOR', operation_id: 'op-ensaio-confirmado-1', movimentacao_estoque_id: 'sim-confirmado-saida' });
    },
    desfazer: async (db) => {
      await db.$executeRawUnsafe(`DELETE FROM "AbastecimentoBem" WHERE id = 'sim-confirmado'`);
      await db.$executeRawUnsafe(`DELETE FROM "MovimentacaoEstoque" WHERE id = 'sim-confirmado-saida'`);
    },
  },
  {
    id: 'fk_de_fora',
    esperado: /D-PROD-162: FK de fora do Patrimônio aponta para as tabelas apagadas \(.*Intruso/,
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE TABLE "Intruso" ("id" TEXT PRIMARY KEY, "cliente_id" VARCHAR(64), "combustivel_id" VARCHAR(64), CONSTRAINT "Intruso_combustivel_fkey" FOREIGN KEY ("cliente_id", "combustivel_id") REFERENCES "TipoCombustivel"("cliente_id", "id"))`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP TABLE "Intruso"`),
  },
  {
    id: 'visao_dependente',
    esperado: /D-PROD-162: visão ou regra depende das tabelas apagadas \(v_intrusa\)/,
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE VIEW v_intrusa AS SELECT id, codigo FROM "PerfilMedicao"`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP VIEW v_intrusa`),
  },
  {
    id: 'trava_concorrente',
    esperado: /55P03|lock timeout|canceling statement due to lock timeout/i,
    impressao: 'certa',
    trava: true,
  },
  { id: 'sem_impressao', esperado: /não são as aprovadas no GO \(maike\.simplifica_impressao = ausente\)/, impressao: 'ausente' },
  { id: 'impressao_errada', esperado: /não são as aprovadas no GO \(maike\.simplifica_impressao = abcdef123456\)/, impressao: 'errada' },
  { id: 'papel_nao_dono', esperado: /o papel da conexão \(maike_simplifica_outro\) não é o dono das tabelas apagadas/, impressao: 'certa', papel: true },
  {
    id: 'gatilho',
    esperado: /objeto criado fora das migrations nas tabelas apagadas \(.*gatilho t_intruso/,
    impressao: 'certa',
    preparar: async (db) => {
      await db.$executeRawUnsafe(`CREATE FUNCTION f_intrusa() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`);
      await db.$executeRawUnsafe(`CREATE TRIGGER t_intruso BEFORE INSERT ON "TanqueBem" FOR EACH ROW EXECUTE FUNCTION f_intrusa()`);
    },
    desfazer: async (db) => {
      await db.$executeRawUnsafe(`DROP TRIGGER t_intruso ON "TanqueBem"`);
      await db.$executeRawUnsafe(`DROP FUNCTION f_intrusa()`);
    },
  },
  {
    id: 'politica',
    esperado: /objeto criado fora das migrations nas tabelas apagadas \(.*política p_intrusa/,
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE POLICY p_intrusa ON "PerfilMedicao" FOR SELECT USING (true)`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP POLICY p_intrusa ON "PerfilMedicao"`),
  },
  {
    id: 'publicacao',
    esperado: /objeto criado fora das migrations nas tabelas apagadas \(.*publicação pub_intrusa/,
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE PUBLICATION pub_intrusa FOR TABLE "BemPatrimonial"`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP PUBLICATION pub_intrusa`),
  },
]);

export const PAPEL_OUTRO = 'maike_simplifica_outro';

/** A sessão concorrente do cenário da trava: ROW EXCLUSIVE em Produto até `soltar()`. */
const segurarTrava = async (db) => {
  let soltar;
  const ate = new Promise((r) => (soltar = r));
  let travou;
  const travado = new Promise((r) => (travou = r));
  const tx = db.$transaction(async (t) => {
    await t.$executeRawUnsafe(`LOCK TABLE "Produto" IN ROW EXCLUSIVE MODE`);
    travou();
    await ate;
  }, { timeout: 180_000, maxWait: 20_000 });
  await Promise.race([travado, tx]);
  return async () => {
    soltar();
    await tx;
  };
};

/**
 * Roda UM cenário RED pelo runner oficial e devolve o que aconteceu (sem asserções: quem chama decide).
 * Depois de uma falha aberta, resolve com `migrate resolve --rolled-back` e desfaz o estado preparado.
 */
export const rodarCenarioRed = async (cenario, { db, url }) => {
  if (cenario.preparar) await cenario.preparar(db);
  let soltar = null;
  let alvo = url;
  let senha = null;
  try {
    const antes = await retrato(db);
    const imp = (await impressao(db)).impressao;
    if (cenario.papel) {
      senha = randomUUID();
      await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${PAPEL_OUTRO}`); // sobra de uma rodada interrompida
      await db.$executeRawUnsafe(`CREATE ROLE ${PAPEL_OUTRO} LOGIN SUPERUSER PASSWORD '${senha}'`);
      alvo = comUsuario(url, PAPEL_OUTRO, senha);
    }
    const urlRunner = cenario.impressao === 'ausente' ? alvo : comImpressao(alvo, cenario.impressao === 'errada' ? 'abcdef123456' : imp);
    // A sessão concorrente segura a trava durante TODA a execução do runner: só é solta depois que ele sai.
    if (cenario.trava) soltar = await segurarTrava(db);
    const r = await aplicarPeloRunner(urlRunner);
    if (soltar) await soltar();
    soltar = null;
    const depois = await retrato(db);
    const hist = await historico(db);
    let resolvida = null;
    if (hist.contract_aberta) resolvida = await resolverRevertida(url);
    return { id: cenario.id, status: r.status, ms: r.ms, saida: r.saida, antes, depois, historico: hist, resolvida };
  } finally {
    if (soltar) await soltar();
    if (cenario.papel) await db.$executeRawUnsafe(`DROP ROLE IF EXISTS ${PAPEL_OUTRO}`);
    if (cenario.desfazer) await cenario.desfazer(db);
  }
};

/* c8 ignore start — CLI do ensaio; a prova automatizada é o teste de backend que importa as funções acima */
const ehEntradaDireta = () => process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (ehEntradaDireta()) {
  const args = process.argv.slice(2);
  const valor = (n, padrao) => {
    const i = args.indexOf(n);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
  };
  const base = exigirUrlLocal(valor('--url', process.env.MAIKE_ENSAIO_URL));
  const banco = valor('--banco', 'maike_ensaio_simplifica');
  if (!/^maike_[a-z0-9_]+$/.test(banco)) throw new Error('ensaio D-PROD-162: --banco tem de ser maike_<letras/números>');
  const { PrismaClient } = await import('@prisma/client');
  const admin = new PrismaClient({ datasourceUrl: base });
  const url = comBanco(base, banco);
  const relatorio = { banco, red: [], green: null, ok: true };
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${banco}`);
    await aplicarMigrationsDaMain(url);
    const db = new PrismaClient({ datasourceUrl: url });
    try {
      await semear(db, { clientes: Number(valor('--clientes', 2)), bens: Number(valor('--bens', 1)), cancelados: Number(valor('--cancelados', 1)) });
      const fpAntes = await fingerprintV2(db);
      const donosAntes = await donoEAcl(db, TABELAS_APAGADAS);
      const retratoAntes = await retrato(db);
      const imp = await impressao(db);
      relatorio.impressao = imp;
      relatorio.item_l_antes = await itemEmLitros(db);
      if (!args.includes('--sem-red')) {
        const superusuario = (await db.$queryRawUnsafe(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`))[0].rolsuper;
        for (const c of CENARIOS_RED) {
          if (c.papel && !superusuario) {
            relatorio.red.push({ id: c.id, ok: null, pulado: 'o papel da URL não cria superusuário' });
            continue;
          }
          const r = await rodarCenarioRed(c, { db, url });
          // Nada mudou: as mesmas tabelas (86, ou 87 com a "Intruso" do cenário da FK) e as mesmas linhas.
          const ok = r.status !== 0 && c.esperado.test(r.saida) && r.antes.tabelas >= 86 && JSON.stringify(r.depois) === JSON.stringify(r.antes) && r.historico.contract_concluida === 0;
          relatorio.red.push({ id: c.id, ok, status: r.status, ms: r.ms });
          if (!ok) relatorio.ok = false;
        }
      }
      const sid = await sistema(db);
      const semAutorizacao = await aplicarPeloRunner(comImpressao(url, imp.impressao), { runtime: url, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid } });
      relatorio.runner_sem_autorizacao = { status: semAutorizacao.status, recusou: /DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED/.test(semAutorizacao.saida), tabelas: await contarTabelas(db) };
      const green = await aplicarPeloRunner(comImpressao(url, imp.impressao), { runtime: url, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      const fpDepois = await fingerprintV2(db);
      const retratoDepois = await retrato(db);
      relatorio.green = {
        status: green.status,
        historico: await historico(db),
        tabelas: await contarTabelas(db),
        estrutura: await estruturaNovas(db),
        donos_antes: [...new Set(donosAntes.map((d) => `${d.dono}|${d.acl}`))],
        donos_depois: [...new Set((await donoEAcl(db, TABELAS_NOVAS)).map((d) => `${d.dono}|${d.acl}`))],
        seguranca: await segurancaDe(db, TABELAS_NOVAS),
        fingerprint_v2_identica: JSON.stringify(fpAntes) === JSON.stringify(fpDepois),
        fingerprint_v2: fpDepois,
        checks_operacao_item: await checksOperacaoItem(db),
        item_l_depois: await itemEmLitros(db),
        estoque_identico: TABELAS_ESTOQUE.every((t) => JSON.stringify(retratoAntes[t]) === JSON.stringify(retratoDepois[t])),
        estoque_coerente: await estoqueCoerente(db),
        migrate_diff: (await migrateDiff(url)).status,
        segunda: /No pending migrations/.test((await aplicarPeloRunner(url)).saida),
      };
      const g = relatorio.green;
      if (g.status !== 0 || g.tabelas !== 80 || g.historico.contract_concluida !== 1 || !g.fingerprint_v2_identica || !g.estoque_identico || g.migrate_diff !== 0 || !g.segunda || !g.item_l_depois.aceito || relatorio.item_l_antes.aceito || !relatorio.runner_sem_autorizacao.recusou) relatorio.ok = false;
    } finally {
      await db.$disconnect();
    }
  } finally {
    await admin.$disconnect();
  }
  console.log(JSON.stringify(relatorio, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  console.log(`ensaio D-PROD-162: ${relatorio.ok ? 'OK' : 'FALHOU'} (banco local ${banco}; nada fora desta máquina foi tocado)`);
  process.exit(relatorio.ok ? 0 : 1);
}
/* c8 ignore stop */
