#!/usr/bin/env node
/**
 * D-PROD-183 — ensaio LOCAL automatizado da migration CONTRACT
 * `20261113200000_tipo_tarefa_drop_colunas` (remoção física das 4 colunas
 * dormentes de TipoTarefa: exige_area, pode_ter_produto, pode_ter_maquina e
 * pode_ter_implemento).
 *
 * Só banco LOCAL e descartável: a URL tem de apontar para esta máquina
 * (localhost, 127.0.0.1, ::1 ou socket); qualquer outra é recusada antes de
 * conectar. Nunca imprime URL. Nada aqui toca produção.
 *
 * O que faz, num banco próprio (`--banco`, padrão maike_ensaio_tt_drop):
 *  1. aplica todas as migrations do repositório menos a CONTRACT, pelo Prisma,
 *     a partir de uma cópia temporária das pastas; entre elas estão as EXPAND
 *     da D-PROD-188 (`20261113400000_cadestacoes_cadastro`) e da D-PROD-189
 *     (`20261113600000_cadcurvaganho_cadastro`) e a CONTRACT da D-PROD-187
 *     (`20261113500000_categoria_manejo_cadcategoria`), posterior a esta e
 *     aplicada aqui fora de ordem, pelo Prisma direto (sem a barreira do
 *     runner); a guarda dela passa porque CategoriaManejo está vazia;
 *  2. semeia, por cliente, um GrupoAtividade, 5 TipoTarefa com combinações das
 *     4 flags (inclusive um todo false e um inativo) e um LancamentoTarefa;
 *  3. tira o preflight do runbook (SQL_IMPRESSAO e SQL_CONTAGENS);
 *  4. roda os cenários RED (sem impressão, impressão errada, índice, visão,
 *     política e função citando as colunas, trava concorrente): cada um tem de
 *     recusar e não mudar nada; a falha aberta é resolvida com
 *     `migrate resolve --rolled-back`;
 *  5. o runner oficial com a conferência de alvo exigida e SEM
 *     MIGRATION_CONTRACT_AUTORIZADO tem de recusar antes de qualquer DDL;
 *  6. aplica pelo runner oficial (`npm run deploy:migrate`, conferência exigida,
 *     MIGRATION_CONTRACT_AUTORIZADO=D-PROD-183 e a impressão na URL) e confere:
 *     todas concluídas (TOTAL_MIGRATIONS), TipoTarefa com as 9 colunas que ficam, linhas idênticas
 *     nessas 9, mesmas tabelas, `migrate diff` vazio e 2ª execução sem pendência.
 *
 * As funções são exportadas e reaproveitadas por
 * `backend/tests/tipoTarefaDropColunasMigration.test.mjs` (mesma prova no CI).
 *
 *   node scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs --url postgresql://postgres@localhost:5432/postgres
 *        [--banco maike_ensaio_tt_drop] [--clientes 2] [--sem-red]
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

export const NOME_CONTRACT = '20261113200000_tipo_tarefa_drop_colunas';
export const DECISAO = 'D-PROD-183';
/**
 * Migrations do repositório (pastas com `migration.sql`). A partida é TODAS menos a CONTRACT e o
 * GREEN é TODAS: as contagens saem da pasta, não de número fixo — uma migration posterior
 * (ex.: a EXPAND de índices da P1-03, D-PROD-185) não muda o que este ensaio prova.
 */
export const TOTAL_MIGRATIONS = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
export const MIGRATIONS_PARTIDA = TOTAL_MIGRATIONS - 1;
/** Arquivo da migration (o teste confere que a guarda usa a mesma expressão do preflight). */
export const ARQUIVO_CONTRACT = join(MIGRATIONS, NOME_CONTRACT, 'migration.sql');
/** Parâmetro de sessão que leva a impressão aprovada no GO até a guarda. */
export const PARAMETRO_IMPRESSAO = 'maike.tipo_tarefa_flags_impressao';
/** As 4 colunas apagadas, na ordem da guarda e dos DROP COLUMN. */
export const COLUNAS = Object.freeze(['exige_area', 'pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento']);
/** As 9 colunas que ficam em TipoTarefa, na ordem física (attnum). */
export const COLUNAS_QUE_FICAM = Object.freeze(['id', 'cliente_id', 'nome_tipo', 'grupo_atividade_id', 'grupo_atividade_nome', 'ativo', 'descricao', 'createdAt', 'updatedAt']);
/** As 13 colunas de TipoTarefa antes da CONTRACT, na ordem física. */
export const COLUNAS_ANTES = Object.freeze([...COLUNAS_QUE_FICAM.slice(0, 7), ...COLUNAS, ...COLUNAS_QUE_FICAM.slice(7)]);
/** Impressão de um conjunto vazio (nenhum true): left(md5(''), 12). */
export const IMPRESSAO_VAZIA = 'd41d8cd98f00';
export const IMPRESSAO_ERRADA = 'abcdef123456';

/**
 * Trechos da guarda que o preflight repete LETRA POR LETRA (espaços colapsados): a linha de cada tipo com algum
 * true (cliente_id|id|4 flags, booleans como 'true'/'false'), a ordem em COLLATE "C", o filtro e a conta final.
 */
export const TRECHOS_DA_GUARDA = Object.freeze([
  `coalesce(array_agg(t.cliente_id || '|' || t.id || '|' || ${COLUNAS.map((c) => `t.${c}`).join(" || '|' || ")} ORDER BY t.cliente_id COLLATE "C", t.id COLLATE "C"), ARRAY[]::text[])`,
  `FROM public."TipoTarefa" t WHERE ${COLUNAS.map((c) => `t.${c}`).join(' OR ')}`,
  `left(md5(array_to_string(linhas, E'\\n')), 12)`,
]);

/**
 * PREFLIGHT do runbook (somente leitura): quantos tipos de tarefa têm algum true nas 4 colunas e a impressão que vai
 * no GO (`maike.tipo_tarefa_flags_impressao`). Exatamente a mesma conta da guarda da migration.
 */
export const SQL_IMPRESSAO = `WITH g AS (
  SELECT coalesce(array_agg(t.cliente_id || '|' || t.id || '|' || t.exige_area || '|' || t.pode_ter_produto || '|' || t.pode_ter_maquina || '|' || t.pode_ter_implemento
                            ORDER BY t.cliente_id COLLATE "C", t.id COLLATE "C"), ARRAY[]::text[]) AS linhas,
         count(*) AS total
    FROM public."TipoTarefa" t
   WHERE t.exige_area OR t.pode_ter_produto OR t.pode_ter_maquina OR t.pode_ter_implemento
)
SELECT total::int AS linhas, left(md5(array_to_string(linhas, E'\\n')), 12) AS impressao
  FROM g`;

/** Só para o humano ler no GO: por cliente, tipos de tarefa, quantos têm algum true e quantos true em cada coluna. */
export const SQL_CONTAGENS = `SELECT t.cliente_id::text AS cliente_id,
       count(*)::int AS tipos,
       count(*) FILTER (WHERE t.exige_area OR t.pode_ter_produto OR t.pode_ter_maquina OR t.pode_ter_implemento)::int AS tipos_com_true,
${COLUNAS.map((c) => `       count(*) FILTER (WHERE t.${c})::int AS ${c}`).join(',\n')}
  FROM public."TipoTarefa" t
 GROUP BY t.cliente_id
 ORDER BY t.cliente_id COLLATE "C"`;

/** Contagem e md5 das linhas de TipoTarefa SÓ nas 9 colunas que ficam (texto da linha, ordenado em "C"). */
const SQL_LINHAS_QUE_FICAM = `SELECT count(*)::int AS n, md5(coalesce(string_agg(l, E'\\n' ORDER BY l COLLATE "C"), '')) AS md5
  FROM (SELECT ROW(${COLUNAS_QUE_FICAM.map((c) => `t."${c}"`).join(', ')})::text AS l FROM public."TipoTarefa" t) x`;
/** md5 das 4 flags por tipo (só existe antes da CONTRACT): prova que um RED não mexeu nos valores. */
const SQL_FLAGS = `SELECT md5(coalesce(string_agg(t.id || '|' || ${COLUNAS.map((c) => `t.${c}`).join(" || '|' || ")}, E'\\n' ORDER BY t.id COLLATE "C"), '')) AS md5 FROM public."TipoTarefa" t`;
const SQL_COLUNAS = `SELECT a.attname::text AS nome FROM pg_attribute a WHERE a.attrelid = 'public."TipoTarefa"'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;
const SQL_TABELAS_PUBLIC = `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')`;
/** Sobras dos cenários RED (tudo o que eles criam tem "intrus" no nome). */
const SQL_INTRUSOS = `SELECT n FROM (
  SELECT relname::text AS n FROM pg_class WHERE relname LIKE '%intrus%'
  UNION ALL SELECT polname::text FROM pg_policy WHERE polname LIKE '%intrus%'
  UNION ALL SELECT proname::text FROM pg_proc WHERE proname LIKE '%intrus%'
) x ORDER BY 1`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
export const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`ensaio D-PROD-183: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
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

/** Todas as migrations do repositório menos a CONTRACT (MIGRATIONS_PARTIDA), aplicadas pelo Prisma a partir de uma cópia temporária. */
export const aplicarMigrationsDaMain = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-tt-drop-main-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of readdirSync(MIGRATIONS)) if (d !== NOME_CONTRACT) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`ensaio D-PROD-183: as migrations da main não subiram (exit ${r.status})`);
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
export const colunasTipoTarefa = async (db) => (await db.$queryRawUnsafe(SQL_COLUNAS)).map((c) => c.nome);
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
 * Retrato: tabelas de public, colunas de TipoTarefa, contagem e md5 das linhas de TipoTarefa SÓ nas 9 colunas que
 * ficam, md5 das 4 flags enquanto existirem (null depois da CONTRACT) e contagem/md5 de GrupoAtividade e
 * LancamentoTarefa (linha inteira, ordenada).
 */
export const retrato = async (db) => {
  const colunas = await colunasTipoTarefa(db);
  const r = {
    tabelas: await contarTabelas(db),
    colunas: colunas.length,
    TipoTarefa: await um(db, SQL_LINHAS_QUE_FICAM),
    flags: COLUNAS.every((c) => colunas.includes(c)) ? (await um(db, SQL_FLAGS)).md5 : null,
  };
  for (const t of ['GrupoAtividade', 'LancamentoTarefa']) {
    r[t] = await um(db, `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, E'\\n' ORDER BY x::text COLLATE "C"), '')) AS md5 FROM public."${t}" x`);
  }
  return r;
};

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const inserir = (db, tabela, linha) => {
  const cols = Object.keys(linha);
  return db.$executeRawUnsafe(`INSERT INTO public."${tabela}" (${cols.map((c) => `"${c}"`).join(', ')}, "updatedAt") VALUES (${cols.map((c) => q(linha[c])).join(', ')}, now())`);
};

/**
 * Os tipos semeados por cliente. Sufixos em maiúsculas e minúsculas de propósito: a ordem da impressão é COLLATE "C"
 * (maiúscula antes de minúscula), diferente da ordem de um collation de idioma.
 */
export const TIPOS_SEMENTE = Object.freeze([
  { sufixo: 'A', nome: 'Roçada', flags: { exige_area: true } },
  { sufixo: 'b', nome: 'Pulverização', flags: { exige_area: true, pode_ter_produto: true, pode_ter_maquina: true, pode_ter_implemento: true } },
  { sufixo: 'C', nome: 'Transporte de feno', flags: { pode_ter_maquina: true, pode_ter_implemento: true } },
  { sufixo: 'd', nome: 'Vistoria de cerca', flags: {} },
  { sufixo: 'E', nome: 'Adubação antiga', flags: { pode_ter_produto: true }, ativo: false, descricao: 'Tipo inativo, com descrição' },
]);

/**
 * Sementes no schema ANTIGO (todas as migrations menos a CONTRACT): por cliente, o Cliente, um GrupoAtividade, os TIPOS_SEMENTE (com as 4
 * flags gravadas) e um LancamentoTarefa apontando para o tipo com as 4 flags true. `apenasFalse` semeia só os tipos
 * sem nenhum true (o banco "sem nada a perder").
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{clientes?: number, apenasFalse?: boolean}} [opcoes]
 */
export const semear = async (db, { clientes = 2, apenasFalse = false } = {}) => {
  const ids = [];
  const tipos = TIPOS_SEMENTE.filter((t) => !apenasFalse || !Object.values(t.flags).some(Boolean));
  for (let k = 1; k <= clientes; k++) {
    const c = `tt-c${k}`;
    const grupo = `${c}-grupo-1`;
    ids.push({ cliente: c, grupo, tipos: tipos.map((t) => `${c}-tipo-${t.sufixo}`) });
    await inserir(db, 'Cliente', { id: c, codigo: c, nome: `Cliente de ensaio ${k}` });
    await inserir(db, 'GrupoAtividade', { id: grupo, cliente_id: c, nome_grupo: 'Manejo de pasto', descricao: 'Grupo de ensaio D-PROD-183' });
    for (const t of tipos) {
      await inserir(db, 'TipoTarefa', {
        id: `${c}-tipo-${t.sufixo}`, cliente_id: c, nome_tipo: t.nome, grupo_atividade_id: grupo, grupo_atividade_nome: 'Manejo de pasto',
        ativo: t.ativo ?? true, descricao: t.descricao ?? null, ...Object.fromEntries(COLUNAS.map((col) => [col, t.flags[col] === true])),
      });
    }
    const alvo = tipos.find((t) => t.sufixo === 'b') ?? tipos[0];
    await inserir(db, 'LancamentoTarefa', {
      id: `${c}-lanc-1`, cliente_id: c, empresa_id: `${c}-emp-1`, titulo: `${alvo.nome} do pasto 1`, tipo: 'Manejo',
      tipo_tarefa_id: `${c}-tipo-${alvo.sufixo}`, tipo_tarefa_nome: alvo.nome, grupo_atividade_id: grupo, grupo_atividade_nome: 'Manejo de pasto',
    });
  }
  return ids;
};

const recusaImpressao = (valor) =>
  new RegExp(`tipo_tarefa_drop_colunas: os valores true das colunas apagadas \\(\\d+ tipos de tarefa\\) não são os aprovados no GO \\(maike\\.tipo_tarefa_flags_impressao = ${valor}\\)`);
const recusaDependente = (nome) => new RegExp(`tipo_tarefa_drop_colunas: objeto depende das colunas apagadas \\([^)]*${nome}`);

/**
 * Cenários RED: cada um prepara um estado, tem de ser RECUSADO com a mensagem própria e não pode mudar nada.
 * `impressao`: 'certa' (a do banco), 'ausente' ou 'errada'. `trava`: segura ROW EXCLUSIVE em TipoTarefa numa outra
 * sessão enquanto o runner roda (a guarda espera no máximo o lock_timeout de 5 s: 55P03).
 */
export const CENARIOS_RED = Object.freeze([
  { id: 'sem_impressao', esperado: recusaImpressao('ausente'), impressao: 'ausente' },
  { id: 'impressao_errada', esperado: recusaImpressao(IMPRESSAO_ERRADA), impressao: 'errada' },
  {
    id: 'indice',
    esperado: recusaDependente('ix_intruso'),
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE INDEX ix_intruso ON "TipoTarefa" ("cliente_id", "pode_ter_maquina")`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP INDEX ix_intruso`),
  },
  {
    id: 'visao',
    esperado: recusaDependente('v_intrusa'),
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE VIEW v_intrusa AS SELECT id, cliente_id, exige_area FROM "TipoTarefa"`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP VIEW v_intrusa`),
  },
  {
    id: 'politica',
    esperado: recusaDependente('p_intrusa'),
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE POLICY p_intrusa ON "TipoTarefa" FOR SELECT USING (pode_ter_produto)`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP POLICY p_intrusa ON "TipoTarefa"`),
  },
  {
    id: 'funcao',
    esperado: /tipo_tarefa_drop_colunas: função ou procedure cita as colunas apagadas \(f_intrusa\(\)\)/,
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE FUNCTION f_intrusa() RETURNS boolean LANGUAGE plpgsql STABLE AS $f$ BEGIN RETURN EXISTS (SELECT 1 FROM public."TipoTarefa" t WHERE t.pode_ter_implemento); END $f$`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP FUNCTION f_intrusa()`),
  },
  // Gatilho em caixa mista: sem aspas, NEW.Exige_Area É a coluna exige_area; a busca ignora maiúsculas.
  {
    id: 'funcao_caixa_mista',
    esperado: /tipo_tarefa_drop_colunas: função ou procedure cita as colunas apagadas \(f_caixa_mista\(\)\)/,
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE FUNCTION f_caixa_mista() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.Exige_Area THEN NEW.descricao := 'x'; END IF; RETURN NEW; END $f$`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP FUNCTION f_caixa_mista()`),
  },
  // O nome só nos parâmetros de saída (RETURNS TABLE): o corpo não cita a coluna, proargnames cita.
  {
    id: 'funcao_retorno',
    esperado: /tipo_tarefa_drop_colunas: função ou procedure cita as colunas apagadas \(f_retorno\(\)\)/,
    impressao: 'certa',
    preparar: (db) => db.$executeRawUnsafe(`CREATE FUNCTION f_retorno() RETURNS TABLE(id text, pode_ter_maquina boolean) LANGUAGE sql STABLE AS 'SELECT id, true FROM public."TipoTarefa"'`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP FUNCTION f_retorno()`),
  },
  // 55P03 no LOCK da própria guarda (não em outro ponto): a sessão concorrente segura a tabela e o runner desiste em 5 s.
  {
    id: 'trava_concorrente',
    esperado: /55P03[\s\S]*canceling statement due to lock timeout[\s\S]*LOCK TABLE public\.\\?"TipoTarefa\\?" IN ACCESS EXCLUSIVE MODE/,
    impressao: 'certa',
    trava: true,
  },
]);

/** A sessão concorrente do cenário da trava: ROW EXCLUSIVE em TipoTarefa até `soltar()`. */
const segurarTrava = async (db) => {
  let soltar;
  const ate = new Promise((r) => (soltar = r));
  let travou;
  const travado = new Promise((r) => (travou = r));
  const tx = db.$transaction(async (t) => {
    await t.$executeRawUnsafe(`LOCK TABLE "TipoTarefa" IN ROW EXCLUSIVE MODE`);
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

/* c8 ignore start — CLI do ensaio; a prova automatizada é o teste de backend que importa as funções acima */
const ehEntradaDireta = () => process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (ehEntradaDireta()) {
  const args = process.argv.slice(2);
  const valor = (n, padrao) => {
    const i = args.indexOf(n);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao;
  };
  const base = exigirUrlLocal(valor('--url', process.env.MAIKE_ENSAIO_URL));
  const banco = valor('--banco', 'maike_ensaio_tt_drop');
  if (!/^maike_[a-z0-9_]+$/.test(banco)) throw new Error('ensaio D-PROD-183: --banco tem de ser maike_<letras/números>');
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
          // Nada mudou: as 13 colunas, as mesmas linhas e flags; a linha aberta foi resolvida; nenhuma sobra do cenário.
          const ok = r.status !== 0 && c.esperado.test(r.saida) && r.antes.colunas === 13 && JSON.stringify(r.depois) === JSON.stringify(r.antes)
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
        colunas: await colunasTipoTarefa(db),
        linhas_que_ficam_identicas: JSON.stringify(depois.TipoTarefa) === JSON.stringify(partida.TipoTarefa),
        demais_identicas: depois.tabelas === partida.tabelas && JSON.stringify([depois.GrupoAtividade, depois.LancamentoTarefa]) === JSON.stringify([partida.GrupoAtividade, partida.LancamentoTarefa]),
        migrate_diff: (await migrateDiff(url)).status,
        segunda: /No pending migrations/.test((await aplicarPeloRunner(url)).saida),
      };
      const g = relatorio.green;
      if (g.status !== 0 || !g.autorizado || g.historico.concluidas !== TOTAL_MIGRATIONS || g.historico.abertas !== 0 || JSON.stringify(g.colunas) !== JSON.stringify(COLUNAS_QUE_FICAM)
        || !g.linhas_que_ficam_identicas || !g.demais_identicas || g.migrate_diff !== 0 || !g.segunda
        || relatorio.runner_sem_autorizacao.status === 0 || !relatorio.runner_sem_autorizacao.recusou || !relatorio.runner_sem_autorizacao.nada_mudou) relatorio.ok = false;
    } finally {
      await db.$disconnect();
    }
  } finally {
    await admin.$disconnect();
  }
  console.log(JSON.stringify(relatorio, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  console.log(`ensaio D-PROD-183: ${relatorio.ok ? 'OK' : 'FALHOU'} (banco local ${banco}; nada fora desta máquina foi tocado)`);
  process.exit(relatorio.ok ? 0 : 1);
}
/* c8 ignore stop */
