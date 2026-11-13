#!/usr/bin/env node
/**
 * D-PROD-187 — ensaio LOCAL automatizado da migration CONTRACT
 * `20261113400000_categoria_manejo_cadcategoria`: remoção física das 15
 * colunas dormentes de CategoriaManejo (raca, categoria_oficial,
 * ganho_peso_anual_kg e gmd_janeiro…gmd_dezembro) e do vínculo com o ícone
 * oficial (catalogo_categoria_visual_id, com a FK e o índice), e troca do nome
 * físico da tabela para CADCATEGORIA (com os nomes de pkey, unique, índice e FK
 * que o Prisma espera com `@@map("CADCATEGORIA")`).
 *
 * Só banco LOCAL e descartável: a URL tem de apontar para esta máquina
 * (localhost, 127.0.0.1, ::1 ou socket); qualquer outra é recusada antes de
 * conectar. Nunca imprime URL. Nada aqui toca produção.
 *
 * O que faz, num banco próprio (`--banco`, padrão maike_ensaio_cadcategoria):
 *  1. aplica as 42 migrations da main (todas menos esta CONTRACT), pelo Prisma,
 *     a partir de uma cópia temporária das pastas; entre elas estão as CONTRACT
 *     da D-PROD-162 e da D-PROD-183, que sobem aqui pelo Prisma direto, sem o
 *     runner e portanto sem a barreira de MIGRATION_CONTRACT_AUTORIZADO (as
 *     guardas delas passam porque o banco está vazio nessa hora);
 *  2. semeia, por cliente, 4 categorias de manejo: uma com o legado de
 *     produção (raca, categoria_oficial e os 12 GMDs 0.0000, ganho nulo), uma
 *     com ganho e GMDs variados, uma só com o vínculo do ícone e uma sem nada
 *     nas 16 colunas; e uma categoria visual GLOBAL do tipo `lote` para o
 *     vínculo;
 *  3. tira o preflight do runbook (SQL_IMPRESSAO e SQL_CONTAGENS);
 *  4. roda os cenários RED (sem impressão, impressão errada, índice extra,
 *     visão, política e função citando as colunas, função com o nome físico da
 *     tabela, função em caixa mista, RETURNS TABLE, CADCATEGORIA já existente,
 *     nome novo de índice ocupado, trava concorrente): cada um tem de recusar e
 *     não mudar nada; a falha aberta é resolvida com `migrate resolve --rolled-back`;
 *  5. o runner oficial com a conferência de alvo exigida e SEM
 *     MIGRATION_CONTRACT_AUTORIZADO tem de recusar antes de qualquer DDL;
 *  6. aplica pelo runner oficial (`npm run deploy:migrate`, conferência exigida,
 *     MIGRATION_CONTRACT_AUTORIZADO=D-PROD-187 e a impressão na URL) e confere:
 *     43 concluídas, CategoriaManejo some, CADCATEGORIA com o MESMO OID, ACL,
 *     RLS e políticas, as 12 colunas que ficam, linhas idênticas nessas 12, os 4
 *     nomes novos, FKs válidas, demais tabelas iguais, `migrate diff` vazio,
 *     PrismaClient lendo `categoriaManejo.findMany()` e 2ª execução sem pendência.
 *
 * As funções são exportadas e reaproveitadas por
 * `backend/tests/categoriaManejoCadcategoriaMigration.test.mjs` (mesma prova no CI).
 *
 *   node scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs --url postgresql://postgres@localhost:5432/postgres
 *        [--banco maike_ensaio_cadcategoria] [--clientes 2] [--sem-red]
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { motivoAlvoProtegido } from '../auth/alvoProtegido.mjs';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

export const NOME_CONTRACT = '20261113400000_categoria_manejo_cadcategoria';
export const DECISAO = 'D-PROD-187';
/** Arquivo da migration (o teste confere que a guarda usa a mesma expressão do preflight). */
export const ARQUIVO_CONTRACT = join(MIGRATIONS, NOME_CONTRACT, 'migration.sql');
/** Parâmetro de sessão que leva a impressão aprovada no GO até a guarda. */
export const PARAMETRO_IMPRESSAO = 'maike.categoria_manejo_legado_impressao';
/** Nome físico antigo e novo da tabela (o model Prisma continua CategoriaManejo). */
export const TABELA_ANTIGA = 'CategoriaManejo';
export const TABELA_NOVA = 'CADCATEGORIA';
/** As 16 colunas apagadas, na ordem da guarda, da impressão e dos DROP COLUMN. */
export const COLUNAS = Object.freeze([
  'raca', 'categoria_oficial', 'ganho_peso_anual_kg',
  'gmd_janeiro', 'gmd_fevereiro', 'gmd_marco', 'gmd_abril', 'gmd_maio', 'gmd_junho',
  'gmd_julho', 'gmd_agosto', 'gmd_setembro', 'gmd_outubro', 'gmd_novembro', 'gmd_dezembro',
  'catalogo_categoria_visual_id',
]);
/** As 12 colunas que ficam, na ordem física (attnum). */
export const COLUNAS_QUE_FICAM = Object.freeze([
  'id', 'cliente_id', 'empresa_id', 'nome', 'sigla', 'especie', 'sexo', 'idade_minima_meses', 'idade_maxima_meses', 'ativo', 'createdAt', 'updatedAt',
]);
/** As 28 colunas de CategoriaManejo antes da CONTRACT, na ordem física (o vínculo do ícone veio depois, em 20261029200000). */
export const COLUNAS_ANTES = Object.freeze([
  'id', 'cliente_id', 'empresa_id', 'nome', 'sigla', 'especie', 'sexo', 'raca', 'idade_minima_meses', 'idade_maxima_meses',
  'categoria_oficial', ...COLUNAS.slice(2, 15), 'ativo', 'createdAt', 'updatedAt', 'catalogo_categoria_visual_id',
]);
/** Índices (relações) antes e depois, em ordem COLLATE "C". */
export const INDICES_ANTES = Object.freeze([
  'CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx', 'CategoriaManejo_cliente_id_empresa_id_idx', 'CategoriaManejo_cliente_id_id_key', 'CategoriaManejo_pkey',
]);
export const INDICES_DEPOIS = Object.freeze(['CADCATEGORIA_cliente_id_empresa_id_idx', 'CADCATEGORIA_cliente_id_id_key', 'CADCATEGORIA_pkey']);
/** Constraints (fora NOT NULL) antes e depois, em ordem COLLATE "C". */
export const CONSTRAINTS_ANTES = Object.freeze(['CategoriaManejo_catalogo_categoria_visual_id_fkey', 'CategoriaManejo_cliente_id_fkey', 'CategoriaManejo_pkey']);
export const CONSTRAINTS_DEPOIS = Object.freeze(['CADCATEGORIA_cliente_id_fkey', 'CADCATEGORIA_pkey']);
/** Impressão de um conjunto vazio (nenhum valor): left(md5(''), 12). */
export const IMPRESSAO_VAZIA = 'd41d8cd98f00';
export const IMPRESSAO_ERRADA = 'abcdef123456';

const LINHA_DA_IMPRESSAO = `concat_ws('|', t.cliente_id, t.id, ${COLUNAS.map((c) => `quote_nullable(t.${c})`).join(', ')})`;
const FILTRO_DA_IMPRESSAO = `num_nonnulls(${COLUNAS.map((c) => `t.${c}`).join(', ')}) > 0`;

/**
 * Trechos da guarda que o preflight repete LETRA POR LETRA (espaços colapsados): a linha de cada categoria com algum
 * valor (cliente_id|id|16 valores com quote_nullable, NULL como `NULL`), a ordem em COLLATE "C", o filtro e a conta final.
 */
export const TRECHOS_DA_GUARDA = Object.freeze([
  `coalesce(array_agg(${LINHA_DA_IMPRESSAO} ORDER BY t.cliente_id COLLATE "C", t.id COLLATE "C"), ARRAY[]::text[])`,
  `FROM public."CategoriaManejo" t WHERE ${FILTRO_DA_IMPRESSAO}`,
  `left(md5(array_to_string(linhas, E'\\n')), 12)`,
]);

/**
 * PREFLIGHT do runbook (somente leitura): quantas categorias de manejo têm algum valor nas 16 colunas e a impressão
 * que vai no GO (`maike.categoria_manejo_legado_impressao`). Exatamente a mesma conta da guarda da migration.
 */
export const SQL_IMPRESSAO = `WITH g AS (
  SELECT coalesce(array_agg(${LINHA_DA_IMPRESSAO}
                            ORDER BY t.cliente_id COLLATE "C", t.id COLLATE "C"), ARRAY[]::text[]) AS linhas,
         count(*) AS total
    FROM public."CategoriaManejo" t
   WHERE ${FILTRO_DA_IMPRESSAO}
)
SELECT total::int AS linhas, left(md5(array_to_string(linhas, E'\\n')), 12) AS impressao
  FROM g`;

/** Só para o humano ler no GO: por cliente, categorias, quantas têm algum valor e quantos valores em cada coluna. */
export const SQL_CONTAGENS = `SELECT t.cliente_id::text AS cliente_id,
       count(*)::int AS categorias,
       count(*) FILTER (WHERE ${FILTRO_DA_IMPRESSAO})::int AS categorias_com_valor,
${COLUNAS.map((c) => `       count(t.${c})::int AS ${c}`).join(',\n')}
  FROM public."CategoriaManejo" t
 GROUP BY t.cliente_id
 ORDER BY t.cliente_id COLLATE "C"`;

/** Rotinas que a guarda recusa (a mesma busca, sem distinguir maiúsculas). Preflight do runbook (bloco C). */
export const REGEX_ROTINAS = `\\m(categoriamanejo|raca|categoria_oficial|ganho_peso_anual_kg|gmd_(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)|catalogo_categoria_visual_id)\\M`;

const SQL_TABELA_ATUAL = `SELECT CASE WHEN to_regclass('public."${TABELA_ANTIGA}"') IS NOT NULL THEN '${TABELA_ANTIGA}'
                          WHEN to_regclass('public."${TABELA_NOVA}"') IS NOT NULL THEN '${TABELA_NOVA}' END AS nome`;
/** Contagem e md5 das linhas SÓ nas 12 colunas que ficam (texto da linha, ordenado em "C"). */
const sqlLinhasQueFicam = (tabela) => `SELECT count(*)::int AS n, md5(coalesce(string_agg(l, E'\\n' ORDER BY l COLLATE "C"), '')) AS md5
  FROM (SELECT ROW(${COLUNAS_QUE_FICAM.map((c) => `t."${c}"`).join(', ')})::text AS l FROM public."${tabela}" t) x`;
/** md5 das 16 colunas por categoria (só existe antes da CONTRACT): prova que um RED não mexeu nos valores. */
const SQL_LEGADO = `SELECT md5(coalesce(string_agg(t.id || '|' || ${COLUNAS.map((c) => `coalesce(t.${c}::text, '-')`).join(" || '|' || ")}, E'\\n' ORDER BY t.id COLLATE "C"), '')) AS md5 FROM public."${TABELA_ANTIGA}" t`;
const sqlColunas = (tabela) => `SELECT a.attname::text AS nome FROM pg_attribute a WHERE a.attrelid = 'public."${tabela}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;
const sqlEstrutura = (tabela) => `SELECT c.oid::bigint AS oid, c.relacl::text AS acl, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
       (SELECT coalesce(array_agg(x.relname::text ORDER BY x.relname::text COLLATE "C"), ARRAY[]::text[]) FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid WHERE i.indrelid = c.oid) AS indices,
       (SELECT coalesce(array_agg(k.conname::text ORDER BY k.conname::text COLLATE "C"), ARRAY[]::text[]) FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype <> 'n') AS constraints,
       (SELECT bool_and(k.convalidated) FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f') AS fks_validas,
       (SELECT coalesce(array_agg(p.polname::text || ':' || p.polcmd::text || ':' || pg_get_expr(p.polqual, p.polrelid) ORDER BY p.polname::text COLLATE "C"), ARRAY[]::text[]) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
  FROM pg_class c WHERE c.oid = 'public."${tabela}"'::regclass`;
const SQL_TABELAS_PUBLIC = `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')`;
/**
 * Sobras dos cenários RED (tudo o que eles criam tem "intrus" no nome, ou ocupa um nome CADCATEGORIA* antes da
 * CONTRACT, quando nenhuma relação ou tipo pode ter esse nome).
 */
const SQL_INTRUSOS = `SELECT n FROM (
  SELECT relname::text AS n FROM pg_class WHERE relname LIKE '%intrus%' OR (relname LIKE 'CADCATEGORIA%' AND to_regclass('public."${TABELA_ANTIGA}"') IS NOT NULL)
  UNION ALL SELECT polname::text FROM pg_policy WHERE polname LIKE '%intrus%'
  UNION ALL SELECT proname::text FROM pg_proc WHERE proname LIKE '%intrus%'
) x ORDER BY 1`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
export const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`ensaio D-PROD-187: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
  return url;
};

/** Mesma URL, outro banco lógico. */
export const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
/** A impressão do GO (e o lock_timeout) pelas `options` da URL, como no runbook. */
export const comImpressao = (url, impressao, { lockTimeout = '5s' } = {}) => {
  const opcoes = `${lockTimeout ? `-c lock_timeout=${lockTimeout} ` : ''}-c ${PARAMETRO_IMPRESSAO}=${impressao}`;
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
 * temporária. Inclui as CONTRACT da D-PROD-162 e da D-PROD-183, sem o runner: as guardas delas passam com o banco vazio.
 */
export const aplicarMigrationsDaMain = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-cadcategoria-main-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of readdirSync(MIGRATIONS)) if (d !== NOME_CONTRACT) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`ensaio D-PROD-187: as migrations da main não subiram (exit ${r.status})`);
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

/** `prisma migrate deploy` direto, com o schema e as migrations do repositório (inclui a CONTRACT). */
export const migrateDeploy = (url) => prisma(['migrate', 'deploy', '--schema', SCHEMA], url);
export const resolverRevertida = (url) => prisma(['migrate', 'resolve', '--rolled-back', NOME_CONTRACT, '--schema', SCHEMA], url);
export const migrateDiff = (url) => prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', SCHEMA, '--exit-code'], url);

const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
export const contarTabelas = async (db) => (await um(db, SQL_TABELAS_PUBLIC)).n;
export const impressao = (db) => um(db, SQL_IMPRESSAO);
export const contagens = (db) => db.$queryRawUnsafe(SQL_CONTAGENS);
/** Nome físico atual da tabela (CategoriaManejo antes, CADCATEGORIA depois). */
export const tabelaAtual = async (db) => (await um(db, SQL_TABELA_ATUAL)).nome;
export const colunasDaTabela = async (db) => (await db.$queryRawUnsafe(sqlColunas(await tabelaAtual(db)))).map((c) => c.nome);
export const estrutura = async (db) => {
  const e = await um(db, sqlEstrutura(await tabelaAtual(db)));
  return { ...e, oid: Number(e.oid) };
};
export const intrusos = async (db) => (await db.$queryRawUnsafe(SQL_INTRUSOS)).map((x) => x.n);
export const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
export const historico = async (db) =>
  um(db, `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS revertidas,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS contract_concluida,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NULL AND rolled_back_at IS NULL)::int AS contract_aberta
            FROM "_prisma_migrations"`);

/**
 * Retrato: tabelas de public, nome físico, estrutura (OID, ACL, RLS, índices, constraints, políticas), colunas,
 * contagem e md5 das linhas SÓ nas 12 colunas que ficam, md5 das 16 colunas enquanto existirem (null depois da
 * CONTRACT) e contagem/md5 de Cliente e CatalogoCategoriaVisual (linha inteira, ordenada).
 */
export const retrato = async (db) => {
  const tabela = await tabelaAtual(db);
  const colunas = await colunasDaTabela(db);
  const r = {
    tabelas: await contarTabelas(db),
    tabela,
    estrutura: await estrutura(db),
    colunas: colunas.length,
    linhas: await um(db, sqlLinhasQueFicam(tabela)),
    legado: COLUNAS.every((c) => colunas.includes(c)) ? (await um(db, SQL_LEGADO)).md5 : null,
  };
  for (const t of ['Cliente', 'CatalogoCategoriaVisual']) {
    r[t] = await um(db, `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, E'\\n' ORDER BY x::text COLLATE "C"), '')) AS md5 FROM public."${t}" x`);
  }
  return r;
};

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const inserir = (db, tabela, linha) => {
  const cols = Object.keys(linha);
  return db.$executeRawUnsafe(`INSERT INTO public."${tabela}" (${cols.map((c) => `"${c}"`).join(', ')}, "updatedAt") VALUES (${cols.map((c) => q(linha[c])).join(', ')}, now())`);
};

const GMDS = COLUNAS.slice(3, 15);
const zeros = Object.fromEntries(GMDS.map((c) => [c, '0.0000']));
/** Id da categoria visual GLOBAL do tipo `lote` usada no vínculo semeado. */
export const CATEGORIA_VISUAL_ID = 'cad-cv-bezerro';

/**
 * As categorias semeadas por cliente. Sufixos em maiúsculas e minúsculas de propósito: a ordem da impressão é
 * COLLATE "C" (maiúscula antes de minúscula), diferente da ordem de um collation de idioma. `legado` são os valores
 * nas 16 colunas; `apenasVazias` semeia só a que não tem nenhum.
 */
export const CATEGORIAS_SEMENTE = Object.freeze([
  // O formato das 4 de produção: raça, categoria oficial, 12 GMDs 0.0000, ganho nulo, sem vínculo.
  { sufixo: 'A', nome: 'BEZERRO MACHO', sexo: 'Macho', idade: [9, 12], legado: { raca: 'COMPOSTO', categoria_oficial: 'Bezerro(a) 9-12 meses', ...zeros } },
  { sufixo: 'b', nome: 'NOVILHA', sexo: 'Fêmea', idade: [13, 24], legado: { raca: "D'ANGUS", ganho_peso_anual_kg: '180.5000', gmd_marco: '0.6500', gmd_dezembro: '0.4125' } },
  { sufixo: 'C', nome: 'GARROTE', sexo: 'Macho', idade: [25, 36], legado: { catalogo_categoria_visual_id: CATEGORIA_VISUAL_ID } },
  { sufixo: 'd', nome: 'VACA', sexo: 'Fêmea', idade: [37, null], legado: {}, ativo: false },
]);

/**
 * Sementes no schema ANTIGO (42 migrations): o tipo `lote` e uma categoria visual GLOBAL e, por cliente, o Cliente e
 * as CATEGORIAS_SEMENTE (com as 16 colunas gravadas). `apenasVazias` semeia só as categorias sem nenhum valor nelas
 * (o banco "sem nada a perder").
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{clientes?: number, apenasVazias?: boolean}} [opcoes]
 */
export const semear = async (db, { clientes = 2, apenasVazias = false } = {}) => {
  const ids = [];
  const categorias = CATEGORIAS_SEMENTE.filter((c) => !apenasVazias || Object.keys(c.legado).length === 0);
  await inserir(db, 'CatalogoTipoEntidade', { id: 'cad-tipo-lote', codigo: 'lote', nome: 'Lote' });
  await inserir(db, 'CatalogoCategoriaVisual', { id: CATEGORIA_VISUAL_ID, tipo_id: 'cad-tipo-lote', codigo: 'bezerro', nome: 'Bezerro' });
  for (let k = 1; k <= clientes; k++) {
    const c = `cad-c${k}`;
    ids.push({ cliente: c, categorias: categorias.map((x) => `${c}-cat-${x.sufixo}`) });
    await inserir(db, 'Cliente', { id: c, codigo: c, nome: `Cliente de ensaio ${k}` });
    for (const x of categorias) {
      await inserir(db, TABELA_ANTIGA, {
        id: `${c}-cat-${x.sufixo}`, cliente_id: c, empresa_id: `${c}-emp-1`, nome: x.nome, sigla: x.nome.slice(0, 3), especie: 'Bovinos', sexo: x.sexo,
        idade_minima_meses: x.idade[0], idade_maxima_meses: x.idade[1], ativo: x.ativo ?? true, ...x.legado,
      });
    }
  }
  return ids;
};

const recusaImpressao = (valor) =>
  new RegExp(`categoria_manejo_cadcategoria: os valores das colunas apagadas \\(\\d+ categorias de manejo\\) não são os aprovados no GO \\(maike\\.categoria_manejo_legado_impressao = ${valor}\\)`);
const recusaDependente = (nome) => new RegExp(`categoria_manejo_cadcategoria: objeto depende das colunas apagadas \\([^)]*${nome}`);
const recusaRotina = (assinatura) => new RegExp(`categoria_manejo_cadcategoria: função ou procedure cita a tabela pelo nome físico antigo ou as colunas apagadas \\(${assinatura}\\)`);
const recusaIndices = (nome) => new RegExp(`categoria_manejo_cadcategoria: os índices de CategoriaManejo \\([^)]*${nome}[^)]*\\) não são os 4 esperados`);
const executar = (sql) => (db) => db.$executeRawUnsafe(sql);

/**
 * Cenários RED: cada um prepara um estado, tem de ser RECUSADO com a mensagem própria e não pode mudar nada.
 * `impressao`: 'certa' (a do banco), 'ausente' ou 'errada'. `trava`: segura ROW EXCLUSIVE em CategoriaManejo numa outra
 * sessão enquanto o runner roda (a guarda espera no máximo o lock_timeout de 5 s: 55P03).
 */
export const CENARIOS_RED = Object.freeze([
  { id: 'sem_impressao', esperado: recusaImpressao('ausente'), impressao: 'ausente' },
  { id: 'impressao_errada', esperado: recusaImpressao(IMPRESSAO_ERRADA), impressao: 'errada' },
  // Índice numa coluna apagada: muda a lista de índices (e dependeria da coluna).
  {
    id: 'indice',
    esperado: recusaIndices('ix_intruso'),
    impressao: 'certa',
    preparar: executar(`CREATE INDEX ix_intruso ON "CategoriaManejo" ("cliente_id", "raca")`),
    desfazer: executar(`DROP INDEX ix_intruso`),
  },
  // Índice a mais numa coluna que FICA: o RENAME levaria um nome que o Prisma não conhece (migrate diff sujo).
  {
    id: 'indice_extra',
    esperado: recusaIndices('ix_intruso_nome'),
    impressao: 'certa',
    preparar: executar(`CREATE INDEX ix_intruso_nome ON "CategoriaManejo" ("cliente_id", "nome")`),
    desfazer: executar(`DROP INDEX ix_intruso_nome`),
  },
  {
    id: 'visao',
    esperado: recusaDependente('v_intrusa'),
    impressao: 'certa',
    preparar: executar(`CREATE VIEW v_intrusa AS SELECT id, cliente_id, gmd_maio FROM "CategoriaManejo"`),
    desfazer: executar(`DROP VIEW v_intrusa`),
  },
  // A exceção do ícone cobre só o índice e a FK dele: uma visão na coluna do vínculo é recusada.
  {
    id: 'visao_icone',
    esperado: recusaDependente('v_intrusa_icone'),
    impressao: 'certa',
    preparar: executar(`CREATE VIEW v_intrusa_icone AS SELECT id, catalogo_categoria_visual_id FROM "CategoriaManejo"`),
    desfazer: executar(`DROP VIEW v_intrusa_icone`),
  },
  {
    id: 'politica',
    esperado: recusaDependente('p_intrusa'),
    impressao: 'certa',
    preparar: executar(`CREATE POLICY p_intrusa ON "CategoriaManejo" FOR SELECT USING (categoria_oficial IS NOT NULL)`),
    desfazer: executar(`DROP POLICY p_intrusa ON "CategoriaManejo"`),
  },
  {
    id: 'funcao',
    esperado: recusaRotina('f_intrusa\\(\\)'),
    impressao: 'certa',
    preparar: executar(`CREATE FUNCTION f_intrusa() RETURNS boolean LANGUAGE plpgsql STABLE AS $f$ BEGIN RETURN EXISTS (SELECT 1 FROM public.cadastro_x t WHERE t.raca = 'X'); END $f$`),
    desfazer: executar(`DROP FUNCTION f_intrusa()`),
  },
  // Só o nome físico antigo da tabela, sem nenhuma coluna apagada: quebraria depois do RENAME.
  {
    id: 'funcao_nome_tabela',
    esperado: recusaRotina('f_intrusa_tabela\\(\\)'),
    impressao: 'certa',
    preparar: executar(`CREATE FUNCTION f_intrusa_tabela() RETURNS bigint LANGUAGE sql STABLE AS 'SELECT count(*) FROM public."CategoriaManejo"'`),
    desfazer: executar(`DROP FUNCTION f_intrusa_tabela()`),
  },
  // Gatilho em caixa mista: sem aspas, NEW.Ganho_Peso_Anual_Kg É a coluna ganho_peso_anual_kg; a busca ignora maiúsculas.
  {
    id: 'funcao_caixa_mista',
    esperado: recusaRotina('f_intrusa_caixa\\(\\)'),
    impressao: 'certa',
    preparar: executar(`CREATE FUNCTION f_intrusa_caixa() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.Ganho_Peso_Anual_Kg > 0 THEN NEW.nome := 'x'; END IF; RETURN NEW; END $f$`),
    desfazer: executar(`DROP FUNCTION f_intrusa_caixa()`),
  },
  // O nome só nos parâmetros de saída (RETURNS TABLE): o corpo não cita a coluna, proargnames cita.
  {
    id: 'funcao_retorno',
    esperado: recusaRotina('f_intrusa_retorno\\(\\)'),
    impressao: 'certa',
    preparar: executar(`CREATE FUNCTION f_intrusa_retorno() RETURNS TABLE(id text, gmd_julho numeric) LANGUAGE sql STABLE AS 'SELECT ''x''::text, 0::numeric'`),
    desfazer: executar(`DROP FUNCTION f_intrusa_retorno()`),
  },
  {
    id: 'cadcategoria_existe',
    esperado: /categoria_manejo_cadcategoria: o nome public\.CADCATEGORIA já está ocupado/,
    impressao: 'certa',
    preparar: executar(`CREATE TABLE "CADCATEGORIA" (x int)`),
    desfazer: executar(`DROP TABLE "CADCATEGORIA"`),
  },
  // Nome novo de índice ocupado por outra relação (uma sequência): o ALTER INDEX … RENAME TO falharia.
  {
    id: 'nome_novo_ocupado',
    esperado: /categoria_manejo_cadcategoria: nome novo de índice já ocupado \(CADCATEGORIA_cliente_id_empresa_id_idx\)/,
    impressao: 'certa',
    preparar: executar(`CREATE SEQUENCE "CADCATEGORIA_cliente_id_empresa_id_idx"`),
    desfazer: executar(`DROP SEQUENCE "CADCATEGORIA_cliente_id_empresa_id_idx"`),
  },
  // 55P03 no LOCK da própria guarda (não em outro ponto): a sessão concorrente segura a tabela e o runner desiste em 5 s.
  {
    id: 'trava_concorrente',
    esperado: /55P03[\s\S]*canceling statement due to lock timeout[\s\S]*LOCK TABLE public\.\\?"CategoriaManejo\\?" IN ACCESS EXCLUSIVE MODE/,
    impressao: 'certa',
    trava: true,
  },
]);

/** A sessão concorrente do cenário da trava: ROW EXCLUSIVE em CategoriaManejo até `soltar()`. */
const segurarTrava = async (db) => {
  let soltar;
  const ate = new Promise((r) => (soltar = r));
  let travou;
  const travado = new Promise((r) => (travou = r));
  const tx = db.$transaction(async (t) => {
    await t.$executeRawUnsafe(`LOCK TABLE "CategoriaManejo" IN ROW EXCLUSIVE MODE`);
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
 * Roda UM cenário RED pelo runner oficial (alvo local: sem a barreira do CONTRACT) e devolve o que aconteceu (sem
 * asserções: quem chama decide). Depois de uma falha aberta, resolve com `migrate resolve --rolled-back` e desfaz o
 * estado preparado.
 */
export const rodarCenarioRed = async (cenario, { db, url }) => {
  if (cenario.preparar) await cenario.preparar(db);
  let soltar = null;
  try {
    const antes = await retrato(db);
    const imp = (await impressao(db)).impressao;
    // Na trava, a URL NÃO leva lock_timeout: quem tem de desistir em 5 s é o set_config da própria guarda.
    const opcoesUrl = cenario.trava ? { lockTimeout: null } : {};
    const urlRunner = cenario.impressao === 'ausente' ? url : comImpressao(url, cenario.impressao === 'errada' ? IMPRESSAO_ERRADA : imp, opcoesUrl);
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
    if (cenario.desfazer) await cenario.desfazer(db);
  }
};

/**
 * O que a GREEN tem de mostrar, a partir do retrato da partida e do de depois (puro; o teste e o CLI usam o mesmo).
 * @returns {string[]} divergências (vazio = ok)
 */
export const divergenciasGreen = (partida, depois) => {
  const d = [];
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (depois.tabela !== TABELA_NOVA) d.push(`tabela ${depois.tabela}`);
  if (depois.estrutura.oid !== partida.estrutura.oid) d.push('OID mudou');
  if (depois.estrutura.acl !== partida.estrutura.acl) d.push('ACL mudou');
  if (depois.estrutura.rls !== partida.estrutura.rls || depois.estrutura.force_rls !== partida.estrutura.force_rls) d.push('RLS mudou');
  if (!igual(depois.estrutura.politicas, partida.estrutura.politicas)) d.push('políticas mudaram');
  if (!igual(depois.estrutura.indices, INDICES_DEPOIS)) d.push(`índices ${depois.estrutura.indices}`);
  if (!igual(depois.estrutura.constraints, CONSTRAINTS_DEPOIS)) d.push(`constraints ${depois.estrutura.constraints}`);
  if (depois.estrutura.fks_validas !== true) d.push('FK não validada');
  if (depois.colunas !== COLUNAS_QUE_FICAM.length) d.push(`${depois.colunas} colunas`);
  if (depois.legado !== null) d.push('legado ainda existe');
  if (!igual(depois.linhas, partida.linhas)) d.push('linhas nas 12 colunas mudaram');
  if (depois.tabelas !== partida.tabelas) d.push('número de tabelas mudou');
  if (!igual(depois.Cliente, partida.Cliente) || !igual(depois.CatalogoCategoriaVisual, partida.CatalogoCategoriaVisual)) d.push('outras tabelas mudaram');
  return d;
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
  const banco = valor('--banco', 'maike_ensaio_cadcategoria');
  if (!/^maike_[a-z0-9_]+$/.test(banco)) throw new Error('ensaio D-PROD-187: --banco tem de ser maike_<letras/números>');
  const { PrismaClient } = await import('@prisma/client');
  const admin = new PrismaClient({ datasourceUrl: base });
  const url = comBanco(base, banco);
  const relatorio = { banco, preflight: null, red: [], runner_sem_autorizacao: null, green: null, ok: true };
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${banco}`);
    await aplicarMigrationsDaMain(url);
    const db = new PrismaClient({ datasourceUrl: url });
    try {
      await semear(db, { clientes: Number(valor('--clientes', 2)) });
      const partida = await retrato(db);
      const imp = await impressao(db);
      relatorio.preflight = { impressao: imp, contagens: await contagens(db), colunas: partida.colunas, historico: await historico(db) };
      if (!args.includes('--sem-red')) {
        for (const c of CENARIOS_RED) {
          const r = await rodarCenarioRed(c, { db, url });
          // Nada mudou: as 28 colunas, o nome, as mesmas linhas e valores; a linha aberta foi resolvida; nenhuma sobra.
          const ok = r.status !== 0 && c.esperado.test(r.saida) && r.antes.colunas === COLUNAS_ANTES.length && JSON.stringify(r.depois) === JSON.stringify(r.antes)
            && r.historico.contract_concluida === 0 && r.historico.contract_aberta === 1 && r.resolvida?.status === 0
            && (await intrusos(db)).length === 0 && JSON.stringify(await retrato(db)) === JSON.stringify(partida) && !r.saida.includes(url);
          relatorio.red.push({ id: c.id, ok, status: r.status, ms: r.ms });
          if (!ok) relatorio.ok = false;
        }
      }
      const sid = await sistema(db);
      const conferido = { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid };
      const semAutorizacao = await aplicarPeloRunner(comImpressao(url, imp.impressao), { runtime: url, extras: conferido });
      relatorio.runner_sem_autorizacao = {
        status: semAutorizacao.status,
        recusou: /DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED/.test(semAutorizacao.saida) && semAutorizacao.saida.includes(`${NOME_CONTRACT} (${DECISAO})`),
        nada_mudou: JSON.stringify(await retrato(db)) === JSON.stringify(partida),
      };
      const green = await aplicarPeloRunner(comImpressao(url, imp.impressao), { runtime: url, extras: { ...conferido, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      const depois = await retrato(db);
      relatorio.green = {
        status: green.status,
        autorizado: green.saida.includes(`CONTRACT autorizado: ${NOME_CONTRACT} (${DECISAO})`),
        historico: await historico(db),
        colunas: await colunasDaTabela(db),
        estrutura: depois.estrutura,
        divergencias: divergenciasGreen(partida, depois),
        migrate_diff: (await migrateDiff(url)).status,
        prisma_client: (await db.categoriaManejo.findMany({ orderBy: { id: 'asc' } })).length,
        segunda: /No pending migrations/.test((await aplicarPeloRunner(url)).saida),
      };
      const g = relatorio.green;
      if (g.status !== 0 || !g.autorizado || g.historico.concluidas !== 43 || g.historico.abertas !== 0 || JSON.stringify(g.colunas) !== JSON.stringify(COLUNAS_QUE_FICAM)
        || g.divergencias.length || g.migrate_diff !== 0 || g.prisma_client !== partida.linhas.n || !g.segunda
        || relatorio.runner_sem_autorizacao.status === 0 || !relatorio.runner_sem_autorizacao.recusou || !relatorio.runner_sem_autorizacao.nada_mudou) relatorio.ok = false;
    } finally {
      await db.$disconnect();
    }
  } finally {
    await admin.$disconnect();
  }
  console.log(JSON.stringify(relatorio, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  console.log(`ensaio D-PROD-187: ${relatorio.ok ? 'OK' : 'FALHOU'} (banco local ${banco}; nada fora desta máquina foi tocado)`);
  process.exit(relatorio.ok ? 0 : 1);
}
/* c8 ignore stop */
