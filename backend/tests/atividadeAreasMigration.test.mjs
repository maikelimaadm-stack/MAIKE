/**
 * D-PROD-249 — a migration CONTRACT `20261118100000_atividade_areas` (várias áreas por atividade: a tabela nova
 * AtividadeArea, a coluna AtividadeApontamento.atividade_area_id, o backfill e a FK composta que prova que a área do
 * lançamento é DA MESMA atividade) de ponta a ponta, contra PostgreSQL real, em bancos PRÓPRIOS criados e apagados por
 * este teste (o banco da suíte não é tocado; os nomes começam pelo nome do banco da suíte).
 *
 * Partida (banco MODELO): as 67 migrations de nome ANTERIOR a esta (a partida de produção: a última é a EXPAND
 * D-PROD-223, `20261117300000_descanso_e_alturas_por_area`), pelo Prisma a partir de uma cópia temporária, e sementes em
 * SQL cru: no 1º cliente, ATV1 ABERTA com área e 2 lançamentos, ATV2 CONCLUIDA com área, sem início e com 1 lançamento
 * (o início vem do lançamento), ATV3 CANCELADA com área, ATV4 ABERTA SEM área com 1 lançamento e ATV5 ABERTA com área,
 * sem início e sem lançamento (o início vem do dia da criação); no 2º cliente, ATV6 ABERTA com área e 1 lançamento.
 *
 * RED (num banco NOVO, recusado pela guarda `guarda: …` e NADA muda): atividade concluída com área sem data de
 * conclusão; a tabela nova ou a coluna nova já presentes. E o runner com a conferência de alvo exigida e SEM
 * MIGRATION_CONTRACT_AUTORIZADO=D-PROD-249 exato recusa antes de qualquer DDL.
 *
 * Concorrência: a transação do app na ordem do lançamento (trava a atividade FOR UPDATE, depois grava o apontamento)
 * não fecha deadlock com a migration: a guarda espera a trava da atividade sem segurar o apontamento e aplica depois do
 * COMMIT do app.
 *
 * GREEN pelo runner oficial (alvo conferido + decisão exata): 68/0, 97 tabelas, o backfill exato (5 áreas: EM_ANDAMENTO
 * com o início certo, CONCLUIDA com as duas datas, a da cancelada EM_ANDAMENTO), os lançamentos das atividades com área
 * ligados à área nº 1 e o da atividade sem área nulo; o banco RECUSA (23503) a área de OUTRA atividade e (23514) o
 * status fora do ciclo; RESTRICT; `migrate diff` vazio e o postcheck do runbook APLICADA; reaplicar é recusado pela
 * guarda; 2ª execução sem pendência.
 *
 * Caminho B: o preflight, o envelope e o postcheck de `MAIKE-ATIVIDADE-AREAS-RUNBOOK-RELEASE.md` (entre os marcadores
 * `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local: o envelope com o de produção recusa;
 * histórico fora de 67/0, a D-PROD-223 com outro checksum ou a tabela já presente recusam antes do DDL; o preflight
 * PRONTO → o envelope aplica (67 → 68, checksum = SHA-256 do arquivo) → o postcheck APLICADA E CONFERIDA; repetir recusa.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

import { closePrismaClient, getPrismaClient } from '../src/database/prismaClient.js';
import { motivoAlvoProtegido } from '../../scripts/auth/alvoProtegido.mjs';
import { ateD249, espelhoDoDiaD249, schemaDoDiaD249 } from './diaDaD223.mjs';
import {
  MIGRATIONS_APROVADAS, MIGRATIONS_CONTRACT_APROVADAS, classificarMigrations, conferirHistoricoRemoto, contractsPendentes,
} from '../../scripts/deploy/premergeMigrateLib.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
// D-PROD-257: este teste é "no dia da D-PROD-249" (antes das Entradas do Estoque): o schema e o runner do repositório vêm
// do espelho até ela (`diaDaD223.mjs`), e as pastas param nela.
const SCHEMA = schemaDoDiaD249();
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const NOME = '20261118100000_atividade_areas';
const DECISAO = 'D-PROD-249';
const ARQUIVO = join(MIGRATIONS, NOME, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** D-PROD-223: a anterior, a última que produção concluiu antes desta (o preflight e o envelope conferem o checksum dela). */
const NOME_ANTERIOR = '20261117300000_descanso_e_alturas_por_area';
const CHECKSUM_ANTERIOR = 'c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e';
const PASTAS_HOJE = ateD249(readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort());
const PASTAS = Object.freeze(PASTAS_HOJE.filter((n) => n <= NOME));
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME));
const FK = 'AtividadeApontamento_atividade_area_fkey';

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-ATIVIDADE-AREAS-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const C1 = 'ara-c1';
const C2 = 'ara-c2';
const E1 = `${C1}-e1`;
const E2 = `${C2}-e1`;
const U1 = `${C1}-u1`;
const ATV = (n) => `${C1}-atv${n}`;
const ATV6 = `${C2}-atv6`;
const AP = (n) => `${C1}-ap${n}`;
const AP6 = `${C2}-ap6`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-249: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
  return url;
};
const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
const vazou = (saida, url) => {
  const u = new URL(url);
  return saida.includes(url) || (u.password !== '' && saida.includes(`${u.username}:${u.password}@`));
};

/** Executa um processo sem shell e devolve status e saída (assíncrono: o laço de eventos segue vivo). */
const rodar = (comando, args, { env = process.env, cwd = RAIZ } = {}) =>
  new Promise((resolve) => {
    const filho = spawn(comando, args, { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr, saida: `${stdout}\n${stderr}` }));
  });
const ambienteBase = () => {
  const env = { ...process.env };
  for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'MIGRATION_DATABASE_URL', 'MIGRATION_EXIGIR_CONFERENCIA', 'MIGRATION_EXPECTED_SYSTEM_IDENTIFIER', 'MIGRATION_CONTRACT_AUTORIZADO']) delete env[k];
  return env;
};
const prisma = (args, url) => rodar(process.execPath, [PRISMA_CLI, ...args], { env: { ...ambienteBase(), DATABASE_URL: url } });
const aplicarPeloRunner = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: espelhoDoDiaD249(),
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
const migrateDiff = (url) => prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', SCHEMA, '--exit-code'], url);
const psql = (url, args) => {
  const u = new URL(url);
  u.search = '';
  return rodar('psql', [u.toString(), '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...args], { env: ambienteBase() });
};
const aplicarArquivo = (url) => psql(url, ['-1', '-f', ARQUIVO]);
const consulta = (url, sql) => psql(url, ['-c', sql]);
const quadro = (r) => Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => {
  const [item, valor, esperado, status] = l.split('|');
  return [item, { valor, esperado, status }];
}));
const comSidLocal = (sql, sid) => sql.split(SID_PRODUCAO).join(sid);
const envelope = () => {
  const e = blocoDoRunbook('caminho-b');
  assert.equal(e.split(MARCA_MIGRATION).length, 2, 'o envelope tem o lugar do migration.sql');
  return e.replace(MARCA_MIGRATION, () => SQL_MIGRATION);
};

/** Cópia temporária das pastas da partida (as de nome anterior a esta) aplicada pelo Prisma. */
const aplicarAnteriores = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-ara-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of ANTERIORES) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-249: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Sementes em SQL cru (a partida da D-PROD-223). */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C1}', 'ara1', 'Cliente ARA', now()), ('${C2}', 'ara2', 'Cliente ARA 2', now())`);
  await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES
    ('${E1}', '${C1}', 1, 'F1', 'Fazenda 1', now()), ('${E2}', '${C2}', 1, 'G1', 'Granja 1', now())`);
  await ins(`INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, "updatedAt") VALUES ('${U1}', '${C1}', 'Operador', 'operador.ara', 'x', now())`);
  for (const [c, e] of [[C1, E1], [C2, E2]]) {
    await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${c}-g1', '${c}', 'Tratos', now())`);
    await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, "updatedAt") VALUES ('${c}-t1', '${c}', 'CIGARRINHA', '${c}-g1', 'Tratos', now())`);
    await ins(`INSERT INTO "Setor" (id, cliente_id, empresa_id, numero_setor, nome, "updatedAt") VALUES ('${c}-s1', '${c}', '${e}', '1', 'Retiro', now())`);
    await ins(`INSERT INTO "AreaPastagem" (id, cliente_id, empresa_id, setor_id, setor_nome, numero_area, nome, tamanho_hectares, "updatedAt") VALUES
      ('${c}-a1', '${c}', '${e}', '${c}-s1', 'Retiro', '1', 'PASTO 01', 10, now()), ('${c}-a2', '${c}', '${e}', '${c}-s1', 'Retiro', '2', 'PASTO 02', 20, now())`);
  }
  const atividade = (id, c, e, numero, { area = null, status = 'ABERTA', inicio = null, conclusao = null, planejada = null, criada = 'now()' } = {}) =>
    ins(`INSERT INTO "Atividade" (id, cliente_id, empresa_id, numero, nome, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id, grupo_atividade_nome,
        area_id, setor_id, setor_nome, data_inicio, data_conclusao, area_planejada, status, concluida_em, cancelada_em, criado_por_usuario_id, "createdAt", "updatedAt")
      VALUES ('${id}', '${c}', '${e}', '${numero}', 'Cigarrinha ${numero}', '${c}-t1', 'CIGARRINHA', '${c}-g1', 'Tratos',
        ${area ? `'${area}'` : 'NULL'}, ${area ? `'${c}-s1'` : 'NULL'}, ${area ? "'Retiro'" : 'NULL'}, ${inicio ? `'${inicio}'` : 'NULL'}, ${conclusao ? `'${conclusao}'` : 'NULL'},
        ${planejada ?? 'NULL'}, '${status}', ${status === 'CONCLUIDA' ? 'now()' : 'NULL'}, ${status === 'CANCELADA' ? 'now()' : 'NULL'}, ${c === C1 ? `'${U1}'` : 'NULL'}, ${criada}, now())`);
  await atividade(ATV(1), C1, E1, '1', { area: `${C1}-a1`, inicio: '2026-11-10', planejada: 8 });
  await atividade(ATV(2), C1, E1, '2', { area: `${C1}-a2`, status: 'CONCLUIDA', conclusao: '2026-11-14' });
  await atividade(ATV(3), C1, E1, '3', { area: `${C1}-a1`, status: 'CANCELADA', inicio: '2026-11-01' });
  await atividade(ATV(4), C1, E1, '4', { inicio: '2026-11-02' });
  await atividade(ATV(5), C1, E1, '5', { area: `${C1}-a2`, criada: "'2026-11-05 12:00:00'" });
  await atividade(ATV6, C2, E2, '1', { area: `${C2}-a1`, inicio: '2026-11-03' });
  const apontamento = (id, c, e, atv, dia, seq = 1) =>
    ins(`INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, area_executada_dia, "updatedAt")
      VALUES ('${id}', '${c}', '${e}', '${atv}', '${dia}', ${seq}, 2, now())`);
  await apontamento(AP(1), C1, E1, ATV(1), '2026-11-10');
  await apontamento(AP(2), C1, E1, ATV(1), '2026-11-12');
  await apontamento(AP(3), C1, E1, ATV(2), '2026-11-13');
  await apontamento(AP(4), C1, E1, ATV(4), '2026-11-11');
  await apontamento(AP6, C2, E2, ATV6, '2026-11-04');
};

const SQL_RETRATO = `SELECT
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')) AS tabelas,
  (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace) AS constraints,
  (SELECT string_agg(indexname || ':' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public') AS indices,
  (SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' ORDER BY table_name, ordinal_position)
     FROM information_schema.columns WHERE table_schema = 'public') AS colunas,
  (SELECT string_agg(row_to_json(a)::text, E'\\n' ORDER BY a.id) FROM "Atividade" a) AS atividades,
  (SELECT string_agg(row_to_json(p)::text, E'\\n' ORDER BY p.id) FROM "AtividadeApontamento" p) AS apontamentos,
  (SELECT count(*)::int FROM _prisma_migrations WHERE rolled_back_at IS NULL) AS historico`;
const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
const retrato = (db) => um(db, SQL_RETRATO).then((r) => ({ ...r }));
const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
const historico = (db) =>
  um(db, `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE migration_name = '${NOME}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS esta,
                 count(*) FILTER (WHERE migration_name = '${NOME}')::int AS linhas_esta
            FROM "_prisma_migrations"`);
const recusa = async (db, sql, sqlstate, nome) => {
  await assert.rejects(db.$executeRawUnsafe(sql), (e) => {
    const texto = `${e.message} ${JSON.stringify(e.meta ?? {})}`;
    assert.ok(texto.includes(sqlstate), `${sql}\n→ ${texto}`);
    if (nome) assert.ok(texto.includes(nome), `${sql}\n→ ${texto}`);
    return true;
  });
};
/** As áreas criadas, como texto comparável. */
const areas = (db) =>
  db.$queryRawUnsafe(`SELECT id, cliente_id, atividade_id, area_id, setor_id, setor_nome, area_planejada::text AS planejada, status,
      to_char(data_inicio, 'YYYY-MM-DD') AS inicio, to_char(data_conclusao, 'YYYY-MM-DD') AS conclusao, ordem, criado_por_usuario_id AS autor, versao
    FROM "AtividadeArea" ORDER BY id`);

let BASE_URL;
let PREFIXO;
let BANCO_MODELO;
let URL_T;
let URL_B;
let SID;
let db;
let partida;

const clonar = async (banco) => {
  const p = getPrismaClient();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
  await p.$queryRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BANCO_MODELO}' AND pid <> pg_backend_pid()`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${banco} TEMPLATE ${BANCO_MODELO}`);
  return comBanco(BASE_URL, banco);
};
const apagar = (banco) => getPrismaClient().$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
const emBancoNovo = async (sufixo, fn) => {
  const banco = `${PREFIXO}_ara_${sufixo}`;
  const url = await clonar(banco);
  const dbr = new PrismaClient({ datasourceUrl: url });
  try {
    await fn(dbr, url);
  } finally {
    await dbr.$disconnect();
    await apagar(banco);
  }
};

before(async () => {
  const p = getPrismaClient();
  BASE_URL = exigirUrlLocal(process.env.DATABASE_URL);
  PREFIXO = new URL(BASE_URL).pathname.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'maike';
  BANCO_MODELO = `${PREFIXO}_ara_modelo`;
  for (const b of [`${PREFIXO}_ara`, `${PREFIXO}_ara_b`, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(comBanco(BASE_URL, BANCO_MODELO));
  const modelo = new PrismaClient({ datasourceUrl: comBanco(BASE_URL, BANCO_MODELO) });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  URL_T = await clonar(`${PREFIXO}_ara`);
  URL_B = await clonar(`${PREFIXO}_ara_b`);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  for (const b of [`${PREFIXO}_ara`, `${PREFIXO}_ara_b`, BANCO_MODELO]) if (PREFIXO) await apagar(b);
  await closePrismaClient();
});

describe('D-PROD-249 — migration CONTRACT das áreas da atividade (PostgreSQL real)', () => {
  test('AR-01 partida: as 67 migrations de nome anterior a esta (a D-PROD-223 por último), 96 tabelas, sem a tabela nem a coluna; o preflight do runbook diz PRONTO e, com o system_identifier de produção, PARAR', async () => {
    assert.equal(ANTERIORES.length, 67, 'a partida de produção: 67 migrations');
    assert.equal(ANTERIORES.at(-1), NOME_ANTERIOR);
    assert.equal(PASTAS.at(-1), NOME);
    assert.equal(PASTAS.length, 68);
    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [67, 0, 0]);
    assert.equal(partida.tabelas.split(',').length, 96);
    assert.ok(!partida.tabelas.split(',').includes('AtividadeArea'));
    assert.ok(!partida.colunas.includes('AtividadeApontamento.atividade_area_id'));
    const { checksum } = await um(db, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_ANTERIOR}'`);
    assert.equal(checksum, CHECKSUM_ANTERIOR);
    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 2, diff.saida);
    assert.match(diff.stdout, /Added tables[\s\S]*AtividadeArea/);

    const q = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const [item, v] of Object.entries(q)) if (!/^(VEREDITO|travas|transações)/.test(item)) assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.equal(q['migrations concluídas / em aberto'].valor, '67 / 0');
    assert.equal(q['a anterior (D-PROD-223, descanso_e_alturas_por_area) concluída com o checksum do repositório'].valor, '1');
    assert.equal(q['atividades / com área (ganham a área nº 1) / concluídas com área / concluídas com área SEM data de conclusão'].valor, '6 / 5 / 1 / 0');
    assert.equal(q['lançamentos / que ganham a área (os das atividades com área)'].valor, '5 / 4');
    assert.equal(q['tabelas em public'].valor, '96');
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    const producao = quadro(await consulta(URL_T, blocoDoRunbook('preflight')));
    assert.equal(producao['alvo: system_identifier'].status, 'PARAR');
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    assert.match(pos.VEREDITO.valor, /^PARAR/);
    assert.deepEqual(await retrato(db), partida, 'o preflight e o postcheck só leem');
  });

  test('AR-02 o portão: o classificador diz CONTRACT D-PROD-249 (CONVERSÃO, sem DROP) sem violação, o arquivo e a guarda são os pinados; o histórico real da partida confere com só esta pendente', async () => {
    const c = classificarMigrations([{ nome: NOME, sql: SQL_MIGRATION }]);
    assert.deepEqual(c.violacoes, []);
    assert.deepEqual([c.ok, c.expand, c.modo], [true, false, 'CONTRACT']);
    assert.deepEqual(c.tabelas_novas, ['AtividadeArea']);
    assert.equal(c.contract.length, 1);
    assert.equal(c.contract[0].decisao, DECISAO);
    assert.deepEqual(c.contract[0].tabelas_removidas, []);
    assert.deepEqual(c.contract[0].colunas_adicionadas, ['AtividadeApontamento.atividade_area_id']);
    assert.deepEqual(c.contract[0].conversoes, ['INSERT INTO AtividadeArea', 'UPDATE AtividadeApontamento', `ADD CONSTRAINT AtividadeApontamento.${FK}`]);
    assert.equal(MIGRATIONS_APROVADAS[NOME], CHECKSUM);
    assert.equal(MIGRATIONS_CONTRACT_APROVADAS[NOME].decisao, DECISAO);
    assert.equal(CHECKSUM, '098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06');
    assert.doesNotMatch(SQL_MIGRATION, /D-PROD-\d+/, 'o número da decisão fica fora do arquivo');
    // Mexer em qualquer peça pinada recusa.
    const semFk = SQL_MIGRATION.replace(/\n-- AddForeignKey \(por último[\s\S]*$/, '\n');
    assert.ok(classificarMigrations([{ nome: NOME, sql: semFk }], { manifesto: { [NOME]: createHash('sha256').update(semFk).digest('hex') } }).violacoes
      .some((v) => v.codigo === 'CONTRACT_CONVERSAO_FORA_DO_CONTRATO'));

    const linhas = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    const locais = PASTAS.map((n) => ({ nome: n, checksum: createHash('sha256').update(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8')).digest('hex') }));
    assert.deepEqual(conferirHistoricoRemoto({ locais, linhas }), { ok: true, codigo: null, pendentes: [NOME], falhas: [] });
    assert.deepEqual(contractsPendentes({ locais: PASTAS, linhas }), [{ nome: NOME, decisao: DECISAO }]);
  });

  test('AR-RED-1 atividade CONCLUIDA com área e sem data de conclusão (num banco novo) → a guarda recusa e NADA muda; o preflight diz PARAR', async () => {
    await emBancoNovo('r1', async (dbr, url) => {
      await dbr.$executeRawUnsafe(`UPDATE "Atividade" SET data_conclusao = NULL WHERE id = '${ATV(2)}'`);
      const antes = await retrato(dbr);
      const r = await aplicarArquivo(url);
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, /guarda: há atividade concluída com área e sem data de conclusão/);
      assert.deepEqual(await retrato(dbr), antes, 'nada da migration ficou');
      const q = quadro(await consulta(url, comSidLocal(blocoDoRunbook('preflight'), SID)));
      assert.equal(q['atividades / com área (ganham a área nº 1) / concluídas com área / concluídas com área SEM data de conclusão'].status, 'PARAR');
      assert.match(q.VEREDITO.valor, /^PARAR/);
    });
  });

  test('AR-RED-2 a tabela nova ou a coluna nova já presentes (num banco novo) → a guarda recusa no formato e NADA muda', async () => {
    await emBancoNovo('r2', async (dbr, url) => {
      const tentar = async () => {
        const antes = await retrato(dbr);
        const r = await aplicarArquivo(url);
        assert.notEqual(r.status, 0, r.saida);
        assert.match(r.saida, /guarda: as áreas da atividade não estão no formato anterior/);
        assert.deepEqual(await retrato(dbr), antes);
      };
      await dbr.$executeRawUnsafe('ALTER TABLE "AtividadeApontamento" ADD COLUMN "atividade_area_id" VARCHAR(64)');
      await tentar();
      await dbr.$executeRawUnsafe('ALTER TABLE "AtividadeApontamento" DROP COLUMN "atividade_area_id"');
      await dbr.$executeRawUnsafe('CREATE TABLE "AtividadeArea" (id TEXT PRIMARY KEY)');
      await tentar();
    });
  });

  test('AR-RED-3 concorrência (num banco novo): a transação do app que trava a atividade e DEPOIS grava o lançamento não fecha deadlock — a migration espera o app e só então aplica (o lançamento do app ganha a área)', async () => {
    await emBancoNovo('c1', async (dbr, url) => {
      let migracao;
      await dbr.$transaction(async (tx) => {
        // 1. O app trava a atividade (FOR UPDATE: ROW SHARE em "Atividade" até o COMMIT).
        await tx.$queryRawUnsafe(`SELECT id FROM "Atividade" WHERE id = '${ATV(1)}' FOR UPDATE`);
        // 2. A migration começa e fica esperando a trava de "Atividade" (sem segurar "AtividadeApontamento").
        migracao = aplicarArquivo(url);
        let esperando = 0;
        for (let i = 0; i < 150 && esperando === 0; i += 1) {
          await new Promise((r) => setTimeout(r, 20));
          ({ n: esperando } = await um(dbr, `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND relation = '"Atividade"'::regclass`));
        }
        assert.equal(esperando, 1, 'a migration espera a trava de "Atividade" já na guarda');
        const { n: noApontamento } = await um(dbr, `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity s ON s.pid = l.pid
          WHERE l.relation = '"AtividadeApontamento"'::regclass AND s.application_name = 'psql'`);
        assert.equal(noApontamento, 0, 'enquanto espera, a migration não segura "AtividadeApontamento"');
        // 3. O app grava o lançamento e atualiza a atividade (a ordem do lançamento de verdade).
        await tx.$executeRawUnsafe(`INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, "updatedAt")
          VALUES ('${C1}-cc1', '${C1}', '${E1}', '${ATV(1)}', '2026-11-15', 1, now())`);
        await tx.$executeRawUnsafe(`UPDATE "Atividade" SET area_executada = 6 WHERE id = '${ATV(1)}'`);
      }, { timeout: 20000 });
      const r = await migracao;
      assert.equal(r.status, 0, r.saida);
      assert.doesNotMatch(r.saida, /deadlock/);
      const { area } = await um(dbr, `SELECT atividade_area_id AS area FROM "AtividadeApontamento" WHERE id = '${C1}-cc1'`);
      assert.equal(area, `ara_${ATV(1)}`, 'o lançamento gravado pelo app antes da migration ganhou a área no backfill');
    });
  });

  test('AR-03 runner com a conferência de alvo exigida e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando só a D-PROD-249, antes de qualquer DDL', async () => {
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-217' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-249' }, { MIGRATION_CONTRACT_AUTORIZADO: ' D-PROD-249 ' }]) {
      const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.saida.includes(`${NOME} (${DECISAO})`), r.saida);
      for (const outra of Object.keys(MIGRATIONS_CONTRACT_APROVADAS).filter((n) => n !== NOME)) assert.ok(!r.saida.includes(outra), `${outra} já está concluída`);
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(r.saida, URL_T));
    }
    assert.deepEqual(await retrato(db), partida);
  });

  test('AR-04 GREEN pelo runner oficial (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-249): 68/0, 97 tabelas, o backfill exato, os lançamentos ligados à área nº 1, nenhuma atividade muda; migrate diff vazio', async () => {
    const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(r.status, 0, r.saida);
    assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME} (${DECISAO})`), r.saida);
    assert.ok(!vazou(r.saida, URL_T));
    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [68, 0, 1]);
    const linha = await um(db, `SELECT checksum, applied_steps_count::int AS passos FROM _prisma_migrations WHERE migration_name = '${NOME}' AND rolled_back_at IS NULL`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1 });
    const depois = await retrato(db);
    assert.equal(depois.tabelas.split(',').length, 97);
    assert.equal(depois.atividades, partida.atividades, 'nenhuma atividade muda');
    const ar = (n, extra) => ({ id: `ara_${n}`, setor_nome: 'Retiro', ordem: 1, versao: 1, conclusao: null, planejada: null, ...extra });
    assert.deepEqual(await areas(db), [
      ar(ATV(1), { cliente_id: C1, atividade_id: ATV(1), area_id: `${C1}-a1`, setor_id: `${C1}-s1`, planejada: '8.0000', status: 'EM_ANDAMENTO', inicio: '2026-11-10', autor: U1 }),
      ar(ATV(2), { cliente_id: C1, atividade_id: ATV(2), area_id: `${C1}-a2`, setor_id: `${C1}-s1`, status: 'CONCLUIDA', inicio: '2026-11-13', conclusao: '2026-11-14', autor: U1 }),
      ar(ATV(3), { cliente_id: C1, atividade_id: ATV(3), area_id: `${C1}-a1`, setor_id: `${C1}-s1`, status: 'EM_ANDAMENTO', inicio: '2026-11-01', autor: U1 }),
      ar(ATV(5), { cliente_id: C1, atividade_id: ATV(5), area_id: `${C1}-a2`, setor_id: `${C1}-s1`, status: 'EM_ANDAMENTO', inicio: '2026-11-05', autor: U1 }),
      ar(ATV6, { cliente_id: C2, atividade_id: ATV6, area_id: `${C2}-a1`, setor_id: `${C2}-s1`, status: 'EM_ANDAMENTO', inicio: '2026-11-03', autor: null }),
    ].sort((a, b) => (a.id < b.id ? -1 : 1)));
    const ligacoes = await db.$queryRawUnsafe('SELECT id, atividade_area_id AS area FROM "AtividadeApontamento" ORDER BY id');
    assert.deepEqual(ligacoes, [
      { id: AP(1), area: `ara_${ATV(1)}` }, { id: AP(2), area: `ara_${ATV(1)}` }, { id: AP(3), area: `ara_${ATV(2)}` }, { id: AP(4), area: null }, { id: AP6, area: `ara_${ATV6}` },
    ].sort((a, b) => (a.id < b.id ? -1 : 1)));
    const { invalidas } = await um(db, `SELECT count(*)::int AS invalidas FROM pg_constraint WHERE conrelid IN ('"AtividadeArea"'::regclass, '"AtividadeApontamento"'::regclass) AND NOT convalidated`);
    assert.equal(invalidas, 0);
    // Índices novos: todos começam por cliente_id (R10).
    const indicesNovos = depois.indices.split('\n').filter((i) => !partida.indices.split('\n').includes(i));
    assert.equal(indicesNovos.length, 7);
    for (const i of indicesNovos) assert.match(i, /\(cliente_id|_pkey:/, i);
    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('AR-05 postcheck do runbook no banco aplicado pelo runner: tudo OK e VEREDITO APLICADA; o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
    assert.equal(pos['migrations concluídas / em aberto'].valor, '68 / 0');
    assert.equal(pos['áreas criadas / atividades com área (iguais)'].valor, '5 / 5');
    assert.equal(pos['áreas EM_ANDAMENTO / CONCLUIDA / PLANEJADA / atividades concluídas com área'].valor, '4 / 1 / 0 / 1');
    assert.equal(pos['lançamentos com área / das atividades com área (iguais) / com área em atividade SEM área (0)'].valor, '4 / 4 / 0');
    assert.equal(pos['tabelas em public'].valor, '97');
    const pre = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const item of ['migrations concluídas / em aberto', '20261118100000_atividade_areas já registrada', 'tabela AtividadeArea já presente (tem de ser 0)']) {
      assert.equal(pre[item].status, 'PARAR', item);
    }
  });

  test('AR-06 o banco: RECUSA (23503) a área de OUTRA atividade no lançamento, por INSERT e UPDATE; (23514) o status fora do ciclo e as datas incoerentes; RESTRICT na área com lançamento; aceita a área da própria atividade', async () => {
    await recusa(db, `UPDATE "AtividadeApontamento" SET atividade_area_id = 'ara_${ATV(5)}' WHERE id = '${AP(1)}'`, '23503', FK);
    await recusa(db, `INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, atividade_area_id, "updatedAt")
      VALUES ('x1', '${C1}', '${E1}', '${ATV(4)}', '2026-11-15', 1, 'ara_${ATV(1)}', now())`, '23503', FK);
    await recusa(db, `UPDATE "AtividadeApontamento" SET atividade_area_id = 'inexistente' WHERE id = '${AP(1)}'`, '23503', FK);
    for (const set of [
      "status = 'ABERTA'",
      "status = 'EM_ANDAMENTO', data_inicio = NULL",
      "status = 'PLANEJADA'",
      "status = 'CONCLUIDA', data_conclusao = '2026-11-09'",
      "status = 'CONCLUIDA'",
      'area_planejada = -1',
      'ordem = 0',
    ]) await recusa(db, `UPDATE "AtividadeArea" SET ${set} WHERE id = 'ara_${ATV(1)}'`, '23514');
    await recusa(db, `DELETE FROM "AtividadeArea" WHERE id = 'ara_${ATV(1)}'`, '23503', FK);
    await recusa(db, `INSERT INTO "AtividadeArea" (id, cliente_id, empresa_id, atividade_id, area_id, ordem, "updatedAt") VALUES ('dup', '${C1}', '${E1}', '${ATV(1)}', '${C1}-a1', 2, now())`, '23505');
    const antes = await retrato(db);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "AtividadeArea" (id, cliente_id, empresa_id, atividade_id, area_id, ordem, "updatedAt") VALUES ('ok2', '${C1}', '${E1}', '${ATV(1)}', '${C1}-a2', 2, now())`);
      await tx.$executeRawUnsafe(`UPDATE "AtividadeApontamento" SET atividade_area_id = 'ok2' WHERE id = '${AP(2)}'`);
      throw new Error('rollback');
    }).catch((e) => assert.equal(e.message, 'rollback'));
    assert.deepEqual(await retrato(db), antes);
  });

  test('AR-07 reaplicar o migration.sql (psql, uma transação) é recusado pela guarda e NADA muda; a 2ª execução do runner não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /guarda: as áreas da atividade não estão no formato anterior/);
    assert.deepEqual(await retrato(db), antes);
    const segunda = await aplicarPeloRunner(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
  });
});

describe('D-PROD-249 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
  let dbB;
  let partidaB;
  before(async () => {
    dbB = new PrismaClient({ datasourceUrl: URL_B });
    partidaB = await retrato(dbB);
  });
  after(async () => {
    await dbB?.$disconnect();
  });

  test('TB-01 o envelope com o system_identifier de produção (texto do runbook intacto) recusa: alvo divergente, nada aplicado', async () => {
    const r = await consulta(URL_B, envelope());
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /RELEASE_BLOCKED: alvo divergente/);
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-02 histórico fora de 67/0, a anterior (D-PROD-223) com checksum divergente ou a tabela já presente recusam antes do DDL; restaurado, nada mudou', async () => {
    const tentar = async (esperado) => {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, esperado);
    };
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 66 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    }
    await dbB.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('ara-aberta', 'x', '20261199000000_aberta', now(), 0)`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 67 concluídas e 1 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'ara-aberta'`);
    }
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${NOME_ANTERIOR}'`);
    try {
      await tentar(/RELEASE_BLOCKED: a anterior \(D-PROD-223\) ausente ou com checksum divergente/);
      const q = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
      assert.equal(q['a anterior (D-PROD-223, descanso_e_alturas_por_area) concluída com o checksum do repositório'].status, 'PARAR');
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${CHECKSUM_ANTERIOR}' WHERE migration_name = '${NOME_ANTERIOR}'`);
    }
    await dbB.$executeRawUnsafe('CREATE TABLE "AtividadeArea" (id TEXT PRIMARY KEY)');
    try {
      await tentar(/RELEASE_BLOCKED: a tabela AtividadeArea já existe/);
      const q = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
      assert.equal(q['tabela AtividadeArea já presente (tem de ser 0)'].status, 'PARAR');
    } finally {
      await dbB.$executeRawUnsafe('DROP TABLE "AtividadeArea"');
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (67 → 68, checksum = SHA-256 do arquivo, applied_steps_count 1); o mesmo resultado do runner; postcheck APLICADA E CONFERIDA; migrate diff vazio; repetir recusa', async () => {
    const pre = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
    assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.equal(r.status, 0, r.stderr);
    const h = await historico(dbB);
    assert.deepEqual([h.concluidas, h.abertas, h.esta, h.linhas_esta], [68, 0, 1, 1]);
    const linha = await um(dbB, `SELECT checksum, applied_steps_count::int AS passos, logs, finished_at IS NOT NULL AS concluida FROM _prisma_migrations WHERE migration_name = '${NOME}'`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1, logs: null, concluida: true });
    const runner = await retrato(db);
    const viaB = await retrato(dbB);
    assert.deepEqual([viaB.tabelas, viaB.constraints, viaB.indices, viaB.colunas], [runner.tabelas, runner.constraints, runner.indices, runner.colunas], 'o mesmo schema do runner');
    assert.deepEqual((await areas(dbB)).map((a) => [a.id, a.status, a.inicio, a.conclusao]), (await areas(db)).map((a) => [a.id, a.status, a.inicio, a.conclusao]));
    const pos = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
    const st = await prisma(['migrate', 'status', '--schema', SCHEMA], URL_B);
    assert.equal(st.status, 0, st.saida);
    assert.equal((await migrateDiff(URL_B)).status, 0);
    const de = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.notEqual(de.status, 0);
    assert.match(de.stderr, /RELEASE_BLOCKED: migration já registrada/);
  });
});
