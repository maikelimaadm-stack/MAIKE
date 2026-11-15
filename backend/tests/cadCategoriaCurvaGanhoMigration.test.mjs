/**
 * D-PROD-195 — a migration CONTRACT `20261114200000_cadcategoria_curva_ganho`
 * (a Categoria de Manejo, CADCATEGORIA, passa a ter a Curva de Ganho,
 * CADCURVAGANHO, OBRIGATÓRIA e da MESMA fazenda) de ponta a ponta, contra
 * PostgreSQL real, num banco PRÓPRIO criado e apagado por este teste (o banco da
 * suíte não é tocado).
 *
 * Partida: todas as pastas MENOS esta CONTRACT e a EXPAND da D-PROD-198, pelo
 * Prisma a partir de uma cópia temporária: as 49 de nome anterior (inclui as CONTRACT da D-PROD-162, da
 * D-PROD-183, da D-PROD-187 e da D-PROD-194, já concluídas como em produção) e as
 * CONTRACT da D-PROD-197 (`20261114300000_tipo_atividade_defaults`, padrões e
 * flags do TipoAtividade) e da D-PROD-200 (`20261114500000_atividade_cabecalho`,
 * Atividade cabeçalho), de nome POSTERIOR, que sobem fora de ordem: a guarda da
 * D-PROD-197 só olha TipoAtividade e os alvos das FKs, a da D-PROD-200 só as 3
 * tabelas do apontamento antigo (vazias aqui: ela não converte nada, apaga as 3 e
 * cria as 2 novas), nenhuma toca CADCATEGORIA nem CADCURVAGANHO, e assim só a
 * D-PROD-195 pende no runner (em produção a ordem é a inversa: esta já está
 * aplicada e as duas entram depois). A EXPAND da D-PROD-198
 * (`20261114400000_cadcategoria_peso_objetivo`, CADCATEGORIA.peso_objetivo_kg)
 * fica FORA da partida (FORA_DA_PARTIDA): no dia desta CONTRACT ela ainda não
 * existia; sobe no GREEN, depois desta, pelo runner (EXPAND: não pede
 * autorização); 91 tabelas (com a D-PROD-202 e a D-PROD-207, abaixo); e, para 2 clientes, 4 fazendas: três com
 * categorias e com a 'CURVA PADRÃO' (uma delas inativa: a ligação não olha o
 * ativo), uma delas também com outra curva (que a ligação não pode usar), e uma
 * fazenda SEM categoria e SEM a CURVA PADRÃO (permitido: a guarda só olha as
 * fazendas com categoria).
 *
 * RED pelo runner (alvo local; nada muda e a falha aberta é resolvida com
 * `migrate resolve --rolled-back`): fazenda com categoria e sem a CURVA PADRÃO
 * (nenhuma curva com o nome exato, em caixa mista ou sem acento), migration já
 * aplicada (curva_ganho_id existente) e trava concorrente em CADCURVAGANHO
 * (lock_timeout 5 s). Toda mensagem começa com `cadcategoria_curva_ganho:`.
 *
 * Sem a decisão exata, com a conferência de alvo exigida, o runner recusa antes
 * de qualquer DDL citando a D-PROD-195.
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`) com a conferência de alvo
 * exigida e MIGRATION_CONTRACT_AUTORIZADO=D-PROD-195: esta e depois a EXPAND da
 * D-PROD-198, todas/0, cada categoria na CURVA PADRÃO da própria fazenda,
 * curva_ganho_id VARCHAR(64) NOT NULL (e, no fim, peso_objetivo_kg vazio), a mesma
 * tabela (OID) com as mesmas linhas nas colunas de antes, o índice e a FK
 * composta (ON DELETE RESTRICT) com os nomes do Prisma, o UNIQUE (cliente_id,
 * empresa_id, id) em CADCURVAGANHO, as mesmas 91 tabelas mais as 3 das Formulações (D-PROD-203) e a LEITURACOCHO (D-PROD-205), abaixo, e
 * `migrate diff` vazio.
 * Depois, a FK recusa curva de outra fazenda (e de outro cliente), a troca de
 * fazenda sem trocar a curva e a exclusão de uma curva em uso.
 *
 * As funções seguem as do teste da D-PROD-194 (`cadCurvaGanhoMensalMigration.test.mjs`).
 *
 * D-PROD-202: a EXPAND `20261114600000_atividade_linhas_produto_maquina` (as 3 tabelas das linhas de produto e de
 * máquina do apontamento e 2 colunas anuláveis em BemPatrimonial e TipoPatrimonial), de nome POSTERIOR, também sobe
 * na partida, fora de ordem, depois da D-PROD-200 (as linhas referenciam AtividadeApontamento); ela não toca
 * CADCATEGORIA nem CADCURVAGANHO e é EXPAND (não pede autorização): 87 tabelas na partida.
 *
 * D-PROD-203: a EXPAND `20261114700000_cadformulacao` (3 tabelas novas; a regra por categoria tem FK para
 * "CADCATEGORIA") também não existia no dia desta CONTRACT: fica FORA da partida e sobe no GREEN por último (pela
 * ordem dos nomes, EXPAND, sem autorização): + 3 tabelas no fim.
 *
 * D-PROD-205: a EXPAND `20261115100000_leitura_cocho` (1 tabela nova) também fica FORA da partida e sobe no GREEN
 * depois da D-PROD-203 (pela ordem dos nomes, EXPAND, sem autorização): + 1 tabela no fim.
 *
 * D-PROD-206: a EXPAND `20261115200000_formulacao_faixa_tolerancia` (1 coluna anulável em CADFORMULACAO, que só
 * existe depois da D-PROD-203) também fica FORA da partida e sobe no GREEN por último: nenhuma tabela nova.
 *
 * D-PROD-207: a EXPAND `20261115900000_atividade_mao_obra_servico` (Funcionario, Servico e as 2 linhas de mão de obra e
 * de serviço, que referenciam AtividadeApontamento; nenhuma coluna em tabela antiga), também de nome POSTERIOR, sobe
 * na partida da mesma forma que a D-PROD-202, depois dela: 91 tabelas na partida e 95 no fim (58 migrations).
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { encerrar } from './helpers.mjs';
import { motivoAlvoProtegido } from '../../scripts/auth/alvoProtegido.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const NOME_CONTRACT = '20261114200000_cadcategoria_curva_ganho';
const DECISAO = 'D-PROD-195';
const CONTRACTS_ANTERIORES = Object.freeze([
  '20261110300000_patrimonio_simplifica', '20261113200000_tipo_tarefa_drop_colunas', '20261113500000_categoria_manejo_cadcategoria', '20261114100000_cadcurvaganho_mensal',
]);
const BANCO = 'maike_ccc_curva_teste';
/** Pastas do repositório: a partida são todas menos esta CONTRACT e FORA_DA_PARTIDA; o total, depois do GREEN. */
const PASTAS = Object.freeze(readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort());
const TOTAL_MIGRATIONS = PASTAS.length;
/**
 * D-PROD-198: a EXPAND do peso objetivo (ALTER TABLE "CADCATEGORIA" ADD COLUMN "peso_objetivo_kg") não existia no dia
 * desta CONTRACT: fica fora da partida e sobe no GREEN, depois desta (a coluna dela vai para o fim, depois da curva).
 */
const NOME_PESO_OBJETIVO = '20261114400000_cadcategoria_peso_objetivo';
/** D-PROD-203: a EXPAND das Formulações, de nome posterior, também fica fora da partida (ver o cabeçalho). */
const NOME_FORMULACOES = '20261114700000_cadformulacao';
/** D-PROD-205: a EXPAND da Leitura de cocho, de nome posterior, também fica fora da partida (ver o cabeçalho). */
const NOME_LEITURA = '20261115100000_leitura_cocho';
/** D-PROD-206: a EXPAND da faixa de tolerância (coluna em CADFORMULACAO), de nome posterior, também fica fora da partida. */
const NOME_FAIXA = '20261115200000_formulacao_faixa_tolerancia';
const FORA_DA_PARTIDA = Object.freeze([NOME_PESO_OBJETIVO, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA]);
/** D-PROD-202: a EXPAND das linhas de produto e de máquina, de nome posterior, sobe na partida (ver o cabeçalho). */
const NOME_LINHAS = '20261114600000_atividade_linhas_produto_maquina';
/** D-PROD-207: a EXPAND da mão de obra e do serviço, de nome posterior, também sobe na partida (ver o cabeçalho). */
const NOME_MAO_OBRA = '20261115900000_atividade_mao_obra_servico';
/** D-PROD-197/D-PROD-200: as CONTRACT de nome POSTERIOR a esta sobem na partida (ver o cabeçalho). */
const CONTRACTS_POSTERIORES = Object.freeze(PASTAS.filter((n) => n > NOME_CONTRACT && !FORA_DA_PARTIDA.includes(n) && n !== NOME_LINHAS && n !== NOME_MAO_OBRA));
const MIGRATIONS_PARTIDA = PASTAS.filter((n) => n !== NOME_CONTRACT && !FORA_DA_PARTIDA.includes(n)).length;
/** O lock_timeout da guarda é 5 s; o teto cobre a partida do Prisma CLI em máquina lenta de CI. */
const TETO_TRAVA_MS = 20_000;

/** Colunas de CADCATEGORIA na ordem física (attnum), antes e depois (a nova vai para o fim). */
const COLUNAS_ANTES = Object.freeze(['id', 'cliente_id', 'empresa_id', 'nome', 'sigla', 'especie', 'sexo', 'idade_minima_meses', 'idade_maxima_meses', 'ativo', 'createdAt', 'updatedAt']);
const COLUNAS_DEPOIS = Object.freeze([...COLUNAS_ANTES, 'curva_ganho_id']);
/** Depois de TODAS as migrations do GREEN: + a peso_objetivo_kg da D-PROD-198, no fim (attnum). */
const COLUNAS_TODAS = Object.freeze([...COLUNAS_DEPOIS, 'peso_objetivo_kg']);
/** Índices (relações) e constraints (nome:tipo, sem NOT NULL) em ordem COLLATE "C". */
const INDICES_CATEGORIA_ANTES = Object.freeze(['CADCATEGORIA_cliente_id_empresa_id_idx', 'CADCATEGORIA_cliente_id_id_key', 'CADCATEGORIA_pkey']);
const INDICES_CATEGORIA_DEPOIS = Object.freeze(['CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_idx', ...INDICES_CATEGORIA_ANTES]);
const FK = 'CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey';
const CONSTRAINTS_CATEGORIA_ANTES = Object.freeze(['CADCATEGORIA_cliente_id_fkey:f', 'CADCATEGORIA_pkey:p']);
const CONSTRAINTS_CATEGORIA_DEPOIS = Object.freeze([`${FK}:f`, ...CONSTRAINTS_CATEGORIA_ANTES]);
const INDICES_CURVA_ANTES = Object.freeze(['CADCURVAGANHO_cliente_id_empresa_id_ativo_idx', 'CADCURVAGANHO_cliente_id_empresa_id_nome_key', 'CADCURVAGANHO_cliente_id_id_key', 'CADCURVAGANHO_pkey']);
const INDICES_CURVA_DEPOIS = Object.freeze([
  'CADCURVAGANHO_cliente_id_empresa_id_ativo_idx', 'CADCURVAGANHO_cliente_id_empresa_id_id_key', 'CADCURVAGANHO_cliente_id_empresa_id_nome_key', 'CADCURVAGANHO_cliente_id_id_key', 'CADCURVAGANHO_pkey',
]);
const GMD_MENSAIS = Object.freeze(['gmd_jan', 'gmd_fev', 'gmd_mar', 'gmd_abr', 'gmd_mai', 'gmd_jun', 'gmd_jul', 'gmd_ago', 'gmd_set', 'gmd_out', 'gmd_nov', 'gmd_dez']);
const CURVA_PADRAO = 'CURVA PADRÃO';

/**
 * Sementes: clientes, fazendas (Empresa), curvas e categorias. `fazenda` é o índice em FAZENDAS. A fazenda 3 (cliente 2,
 * empresa 2) não tem categoria nem CURVA PADRÃO: a guarda não a exige.
 */
const CLIENTES = Object.freeze(['ccc-c1', 'ccc-c2']);
const FAZENDAS = Object.freeze([
  { cliente: 'ccc-c1', empresa: 'ccc-c1-emp-1', numero: 1 },
  { cliente: 'ccc-c1', empresa: 'ccc-c1-emp-2', numero: 2 },
  { cliente: 'ccc-c2', empresa: 'ccc-c2-emp-1', numero: 1 },
  { cliente: 'ccc-c2', empresa: 'ccc-c2-emp-2', numero: 2 },
]);
const CURVAS = Object.freeze([
  { id: 'ccc-k-f0-padrao', fazenda: 0, nome: CURVA_PADRAO },
  { id: 'ccc-k-f0-engorda', fazenda: 0, nome: 'CURVA ENGORDA' },
  // Inativa: a migration liga as categorias que já existem à CURVA PADRÃO da fazenda, ativa ou não.
  { id: 'ccc-k-f1-padrao', fazenda: 1, nome: CURVA_PADRAO, ativo: false },
  { id: 'ccc-k-f2-padrao', fazenda: 2, nome: CURVA_PADRAO },
  { id: 'ccc-k-f3-recria', fazenda: 3, nome: 'CURVA RECRIA' },
]);
const CATEGORIAS = Object.freeze([
  { id: 'ccc-cat-f0-a', fazenda: 0, nome: 'BEZERRO MACHO' },
  { id: 'ccc-cat-f0-b', fazenda: 0, nome: "NOVILHA D'ANGUS", ativo: false },
  { id: 'ccc-cat-f1-a', fazenda: 1, nome: 'GARROTE' },
  { id: 'ccc-cat-f2-a', fazenda: 2, nome: 'VACA' },
  { id: 'ccc-cat-f2-b', fazenda: 2, nome: 'BOI' },
]);
/** A CURVA PADRÃO de cada fazenda com categoria: o que a migration grava em cada categoria. */
const CURVA_ESPERADA = Object.freeze(Object.fromEntries(CATEGORIAS.map((c) => [c.id, CURVAS.find((k) => k.fazenda === c.fazenda && k.nome === CURVA_PADRAO).id])));

const SQL_TABELAS_PUBLIC = `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')`;
const sqlColunas = (t) => `SELECT a.attname::text AS n FROM pg_attribute a WHERE a.attrelid = 'public."${t}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;
const sqlIndices = (t) => `SELECT indexname::text AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = '${t}' ORDER BY indexname COLLATE "C"`;
const sqlConstraints = (t) => `SELECT conname::text || ':' || contype::text AS n FROM pg_constraint WHERE conrelid = 'public."${t}"'::regclass AND contype <> 'n' ORDER BY conname COLLATE "C"`;
/** md5 das linhas SÓ nas colunas de antes (texto da linha, ordenado em "C"): a CONTRACT não pode mexer nelas. */
const SQL_LINHAS_CATEGORIA = `SELECT count(*)::int AS n, md5(coalesce(string_agg(l, E'\\n' ORDER BY l COLLATE "C"), '')) AS md5
  FROM (SELECT ROW(${COLUNAS_ANTES.map((c) => `t."${c}"`).join(', ')})::text AS l FROM public."CADCATEGORIA" t) x`;
const SQL_LINHAS_CURVA = `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, E'\\n' ORDER BY x::text COLLATE "C"), '')) AS md5 FROM public."CADCURVAGANHO" x`;
const SQL_OIDS = `SELECT 'public."CADCATEGORIA"'::regclass::oid::int AS categoria, 'public."CADCURVAGANHO"'::regclass::oid::int AS curva`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-195: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
  return url;
};
/** Mesma URL, outro banco lógico. */
const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
/** Nem a URL inteira nem o par usuário:senha podem aparecer na saída. */
const vazou = (saida, url) => {
  const u = new URL(url);
  return saida.includes(url) || (u.password !== '' && saida.includes(`${u.username}:${u.password}@`));
};

/** Executa um processo sem shell e devolve status, saída e duração (assíncrono: o laço de eventos segue vivo). */
const rodar = (comando, args, { env = process.env, cwd = RAIZ } = {}) =>
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

/** Todas as pastas menos esta CONTRACT e FORA_DA_PARTIDA (as 49 anteriores e a D-PROD-197 e a D-PROD-200, posteriores), aplicadas pelo Prisma a partir de uma cópia temporária. */
const aplicarMigrationsAnteriores = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-ccc-curva-main-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of PASTAS) if (d !== NOME_CONTRACT && !FORA_DA_PARTIDA.includes(d)) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-195: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
    return r;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** O runner oficial (`npm run deploy:migrate`). `runtime` é a conexão do runtime (DATABASE_URL) quando a conferência de alvo é exigida. */
const aplicarPeloRunner = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
const resolverRevertida = (url) => prisma(['migrate', 'resolve', '--rolled-back', NOME_CONTRACT, '--schema', SCHEMA], url);
const migrateDiff = (url) => prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', SCHEMA, '--exit-code'], url);

const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
const lista = async (db, sql) => (await db.$queryRawUnsafe(sql)).map((x) => x.n);
const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
const historico = async (db) =>
  um(db, `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE migration_name IN (${CONTRACTS_ANTERIORES.map((n) => `'${n}'`).join(', ')}) AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS contracts_anteriores,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS contract_concluida,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NULL AND rolled_back_at IS NULL)::int AS contract_aberta,
                 count(*) FILTER (WHERE migration_name = '${NOME_PESO_OBJETIVO}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS peso_concluida
            FROM "_prisma_migrations"`);
/** Migrations concluídas na ordem REAL de aplicação (finished_at). */
const ordemDeAplicacao = async (db) =>
  (await db.$queryRawUnsafe(`SELECT migration_name AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
                              ORDER BY finished_at, started_at, migration_name`)).map((x) => x.n);
/** Sobras dos cenários RED (tudo o que eles criam tem "intrus" no nome). */
const intrusos = (db) => lista(db, `SELECT id AS n FROM public."CADCATEGORIA" WHERE id LIKE '%intrus%' ORDER BY 1`);

/**
 * Retrato de CADCATEGORIA e CADCURVAGANHO: tabelas de public, colunas, índices, constraints, os OIDs (um RED que
 * recriasse uma tabela mudaria o oid) e contagem/md5 das linhas (categorias só nas colunas de antes).
 */
const retrato = async (db) => ({
  tabelas: (await um(db, SQL_TABELAS_PUBLIC)).n,
  colunas: await lista(db, sqlColunas('CADCATEGORIA')),
  indices_categoria: await lista(db, sqlIndices('CADCATEGORIA')),
  constraints_categoria: await lista(db, sqlConstraints('CADCATEGORIA')),
  indices_curva: await lista(db, sqlIndices('CADCURVAGANHO')),
  constraints_curva: await lista(db, sqlConstraints('CADCURVAGANHO')),
  oids: await um(db, SQL_OIDS),
  categorias: await um(db, SQL_LINHAS_CATEGORIA),
  curvas: await um(db, SQL_LINHAS_CURVA),
});

const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const inserir = (db, tabela, linha) => {
  const cols = Object.keys(linha);
  return db.$executeRawUnsafe(`INSERT INTO public."${tabela}" (${cols.map((c) => `"${c}"`).join(', ')}, "updatedAt") VALUES (${cols.map((c) => q(linha[c])).join(', ')}, now())`);
};
const linhaCategoria = (id, fazenda, nome, extra = {}) => ({
  id, cliente_id: FAZENDAS[fazenda].cliente, empresa_id: FAZENDAS[fazenda].empresa, nome, sigla: nome.slice(0, 3), especie: 'Bovinos', ...extra,
});

/** Clientes, fazendas, curvas (12 GMD mensais) e categorias reais (as FKs valem: nada de session_replication_role). */
const semear = async (db) => {
  for (const c of CLIENTES) await inserir(db, 'Cliente', { id: c, codigo: c, nome: `Cliente de ensaio D-PROD-195 ${c}` });
  for (const f of FAZENDAS) await inserir(db, 'Empresa', { id: f.empresa, cliente_id: f.cliente, numero_empresa: f.numero, apelido: `Fazenda ${f.numero}`, nome: `Fazenda de ensaio ${f.empresa}` });
  for (const k of CURVAS) {
    const f = FAZENDAS[k.fazenda];
    await inserir(db, 'CADCURVAGANHO', { id: k.id, cliente_id: f.cliente, empresa_id: f.empresa, nome: k.nome, ...Object.fromEntries(GMD_MENSAIS.map((g, i) => [g, 0.3 + i / 100])), ativo: k.ativo ?? true });
  }
  for (const c of CATEGORIAS) await inserir(db, 'CADCATEGORIA', linhaCategoria(c.id, c.fazenda, c.nome, { ativo: c.ativo ?? true }));
};

const recusa = (trecho) => new RegExp(`cadcategoria_curva_ganho: ${trecho}`);
const recusaSemPadrao = (n) => recusa(`${n} fazendas com categoria e sem a CURVA PADRÃO e 0 com mais de uma: cadastre exatamente uma CURVA PADRÃO em cada fazenda com categoria; nada foi alterado`);
const executar = (sql) => (db) => db.$executeRawUnsafe(sql);
const renomearCurva = (id, nome) => executar(`UPDATE public."CADCURVAGANHO" SET nome = ${q(nome)} WHERE id = ${q(id)}`);

/** Cenários RED: cada um prepara um estado, tem de ser RECUSADO pela guarda com a mensagem própria e não pode mudar nada. */
const CENARIOS_RED = Object.freeze([
  // Uma categoria na fazenda que não tem a CURVA PADRÃO (só a CURVA RECRIA): ficaria sem curva.
  {
    id: 'fazenda_sem_padrao',
    esperado: recusaSemPadrao(1),
    preparar: (db) => inserir(db, 'CADCATEGORIA', linhaCategoria('ccc-cat-intrusa', 3, 'BEZERRA')),
    desfazer: executar(`DELETE FROM public."CADCATEGORIA" WHERE id = 'ccc-cat-intrusa'`),
  },
  // O nome é comparado exatamente: caixa mista ou sem acento não é a CURVA PADRÃO.
  {
    id: 'nome_em_caixa_mista',
    esperado: recusaSemPadrao(1),
    preparar: renomearCurva('ccc-k-f2-padrao', 'Curva Padrão'),
    desfazer: renomearCurva('ccc-k-f2-padrao', CURVA_PADRAO),
  },
  {
    id: 'nome_sem_acento',
    esperado: recusaSemPadrao(2),
    preparar: async (db) => {
      await renomearCurva('ccc-k-f0-padrao', 'CURVA PADRAO')(db);
      await renomearCurva('ccc-k-f1-padrao', 'CURVA PADRÃO ')(db);
    },
    desfazer: async (db) => {
      await renomearCurva('ccc-k-f0-padrao', CURVA_PADRAO)(db);
      await renomearCurva('ccc-k-f1-padrao', CURVA_PADRAO)(db);
    },
  },
  // A coluna já existe: a migration já rodou (ou o schema está fora do esperado).
  {
    id: 'ja_aplicada',
    esperado: recusa('CADCATEGORIA já tem curva_ganho_id: migration já aplicada ou schema fora do esperado; nada foi alterado'),
    preparar: executar(`ALTER TABLE public."CADCATEGORIA" ADD COLUMN curva_ganho_id VARCHAR(64)`),
    desfazer: executar(`ALTER TABLE public."CADCATEGORIA" DROP COLUMN curva_ganho_id`),
    colunasPreparadas: [...COLUNAS_ANTES, 'curva_ganho_id'],
  },
  // 55P03 no LOCK da própria guarda: a sessão concorrente segura ROW EXCLUSIVE em CADCURVAGANHO e o runner desiste em 5 s.
  {
    id: 'trava_concorrente',
    esperado: /55P03[\s\S]*canceling statement due to lock timeout[\s\S]*LOCK TABLE public\.\\?"CADCURVAGANHO\\?" IN SHARE MODE/,
    trava: true,
  },
]);

/** A sessão concorrente do cenário da trava: ROW EXCLUSIVE em CADCURVAGANHO até `soltar()`. */
const segurarTrava = async (db) => {
  let soltar;
  const ate = new Promise((r) => (soltar = r));
  let travou;
  const travado = new Promise((r) => (travou = r));
  const tx = db.$transaction(async (t) => {
    await t.$executeRawUnsafe(`LOCK TABLE public."CADCURVAGANHO" IN ROW EXCLUSIVE MODE`);
    travou();
    await ate;
  }, { timeout: 180_000, maxWait: 20_000 });
  await Promise.race([travado, tx]);
  return async () => {
    soltar();
    await tx;
  };
};

let URL_T;
let db;
let partida;

before(async () => {
  const p = getPrismaClient();
  URL_T = comBanco(exigirUrlLocal(process.env.DATABASE_URL), BANCO);
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO}`);
  await aplicarMigrationsAnteriores(URL_T);
  db = new PrismaClient({ datasourceUrl: URL_T });
  await semear(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  await getPrismaClient().$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await encerrar();
});

describe('D-PROD-195 — migration CONTRACT que torna a curva de ganho obrigatória, e da mesma fazenda, na Categoria de Manejo (PostgreSQL real)', () => {
  test('CC-01 partida: todas menos esta e a EXPAND da D-PROD-198 (as quatro CONTRACT anteriores concluídas, a D-PROD-197 e a D-PROD-200, posteriores, e as EXPAND posteriores da D-PROD-202 e da D-PROD-207; fora também as EXPAND da D-PROD-203, da D-PROD-205 e da D-PROD-206), 91 tabelas, CADCATEGORIA sem curva_ganho_id, CADCURVAGANHO sem o UNIQUE por fazenda, 5 categorias em 3 fazendas com a CURVA PADRÃO', async () => {
    assert.deepEqual(CONTRACTS_POSTERIORES, ['20261114300000_tipo_atividade_defaults', '20261114500000_atividade_cabecalho'], 'só as CONTRACT da D-PROD-197 e da D-PROD-200 têm nome posterior a esta');
    assert.equal(PASTAS.filter((n) => n < NOME_CONTRACT).length, 49);
    // D-PROD-198, D-PROD-203, D-PROD-205 e D-PROD-206: as EXPAND do peso objetivo, das Formulações, da Leitura de cocho e
    // da faixa de tolerância ficam fora da partida; as EXPAND da D-PROD-202 e da D-PROD-207 entram (58 pastas; partida 53).
    assert.deepEqual(PASTAS.filter((n) => n > NOME_CONTRACT), ['20261114300000_tipo_atividade_defaults', NOME_PESO_OBJETIVO, '20261114500000_atividade_cabecalho', NOME_LINHAS, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, NOME_MAO_OBRA]);
    assert.equal(MIGRATIONS_PARTIDA, 53);
    assert.equal(TOTAL_MIGRATIONS, 58);
    const h = await historico(db);
    assert.equal(h.concluidas, MIGRATIONS_PARTIDA);
    assert.equal(h.peso_concluida, 0, 'a D-PROD-198 ainda não existia no dia desta CONTRACT');
    assert.equal(h.abertas, 0);
    assert.equal(h.contracts_anteriores, 4);
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    assert.equal(partida.tabelas, 91, '85 até a D-PROD-197; a D-PROD-200 (na partida) troca as 3 do apontamento antigo pelas 2 da atividade; a D-PROD-202 (na partida) acrescenta as 3 das linhas; a D-PROD-207 (na partida), as 4 da mão de obra e do serviço');
    assert.deepEqual(partida.colunas, [...COLUNAS_ANTES]);
    assert.deepEqual(partida.indices_categoria, [...INDICES_CATEGORIA_ANTES]);
    assert.deepEqual(partida.constraints_categoria, [...CONSTRAINTS_CATEGORIA_ANTES]);
    assert.deepEqual(partida.indices_curva, [...INDICES_CURVA_ANTES]);
    assert.equal(partida.categorias.n, CATEGORIAS.length);
    assert.equal(partida.curvas.n, CURVAS.length);
    // As fazendas com categoria têm exatamente uma CURVA PADRÃO; a fazenda sem categoria não tem nenhuma (e não precisa).
    const porFazenda = await db.$queryRawUnsafe(`SELECT e.id AS empresa,
        (SELECT count(*)::int FROM public."CADCATEGORIA" c WHERE c.cliente_id = e.cliente_id AND c.empresa_id = e.id) AS categorias,
        (SELECT count(*)::int FROM public."CADCURVAGANHO" k WHERE k.cliente_id = e.cliente_id AND k.empresa_id = e.id AND k.nome = '${CURVA_PADRAO}') AS padroes
      FROM public."Empresa" e ORDER BY e.id COLLATE "C"`);
    assert.deepEqual(porFazenda, [
      { empresa: 'ccc-c1-emp-1', categorias: 2, padroes: 1 },
      { empresa: 'ccc-c1-emp-2', categorias: 1, padroes: 1 },
      { empresa: 'ccc-c2-emp-1', categorias: 2, padroes: 1 },
      { empresa: 'ccc-c2-emp-2', categorias: 0, padroes: 0 },
    ]);
    assert.deepEqual(await intrusos(db), []);
  });

  for (const cenario of CENARIOS_RED) {
    test(`CC-02 ${cenario.id}: a guarda recusa (cadcategoria_curva_ganho:) e NADA muda (sem a coluna, mesmas tabelas, linhas e índices, histórico da partida, migration aberta → resolvida)`, async () => {
      if (cenario.preparar) await cenario.preparar(db);
      let r;
      let antes;
      let depois;
      let hist;
      let resolvida = null;
      let soltar = null;
      try {
        antes = await retrato(db);
        if (cenario.trava) soltar = await segurarTrava(db);
        r = await aplicarPeloRunner(URL_T);
        if (soltar) await soltar();
        soltar = null;
        depois = await retrato(db);
        hist = await historico(db);
        if (hist.contract_aberta) resolvida = await resolverRevertida(URL_T);
      } finally {
        if (soltar) await soltar();
        if (cenario.desfazer) await cenario.desfazer(db);
      }
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, cenario.esperado);
      if (cenario.trava) assert.ok(r.ms < TETO_TRAVA_MS, `o runner saiu em ${r.ms} ms (lock_timeout de 5 s; não espera a trava)`);
      assert.deepEqual(antes.colunas, cenario.colunasPreparadas ?? [...COLUNAS_ANTES]);
      assert.deepEqual(depois, antes, 'nenhuma coluna, linha, índice ou constraint mudou; as tabelas são as mesmas (oid)');
      assert.equal(hist.concluidas, MIGRATIONS_PARTIDA);
      assert.equal(hist.peso_concluida, 0, 'o deploy para na primeira que falha: a D-PROD-198 nem começa');
      assert.equal(hist.contract_concluida, 0);
      assert.equal(hist.contract_aberta, 1, 'a linha da migration fica com finished_at NULL');
      assert.equal(resolvida?.status, 0, resolvida?.saida);
      const h = await historico(db);
      assert.equal(h.concluidas, MIGRATIONS_PARTIDA);
      assert.equal(h.contract_aberta, 0);
      assert.deepEqual(await intrusos(db), [], 'a categoria do cenário foi removida');
      assert.deepEqual(await retrato(db), partida, 'o cenário foi desfeito por inteiro');
      assert.ok(!vazou(r.saida, URL_T), 'a URL nunca aparece na saída');
    });
  }

  test('CC-03 runner com a conferência de alvo exigida e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando a D-PROD-195 antes de qualquer DDL', async () => {
    const sid = await sistema(db);
    const linhasAntes = (await historico(db)).total;
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-194' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-187' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-195' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-19' }]) {
      const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.saida.includes(`${NOME_CONTRACT} (${DECISAO})`), r.saida);
      for (const anterior of [...CONTRACTS_ANTERIORES, ...CONTRACTS_POSTERIORES]) assert.ok(!r.saida.includes(anterior), `${anterior} já está concluída: só a D-PROD-195 pende`);
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(r.saida, URL_T));
    }
    const h = await historico(db);
    assert.equal(h.total, linhasAntes, 'nenhuma linha nova no histórico');
    assert.equal(h.concluidas, MIGRATIONS_PARTIDA);
    assert.deepEqual(await retrato(db), partida, 'nada mudou');
  });

  test('CC-04 GREEN pelo runner oficial (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-195): esta e depois a EXPAND da D-PROD-198, todas/0, cada categoria na CURVA PADRÃO da fazenda, NOT NULL, índice e FK composta com os nomes do Prisma, UNIQUE por fazenda em CADCURVAGANHO, mesmas tabelas e linhas e migrate diff vazio', async () => {
    const sid = await sistema(db);
    const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /alvo conferido nas duas conexões/);
    assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME_CONTRACT} (${DECISAO})`), r.saida);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.equal(h.concluidas, TOTAL_MIGRATIONS);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    // As EXPAND da D-PROD-198 e da D-PROD-203 sobem junto, depois desta (pela ordem dos nomes; só esta pede a decisão).
    assert.equal(h.peso_concluida, 1);
    assert.deepEqual((await ordemDeAplicacao(db)).slice(-5), [NOME_CONTRACT, NOME_PESO_OBJETIVO, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA]);

    const depois = await retrato(db);
    // A curva_ganho_id desta CONTRACT e, no fim, a peso_objetivo_kg da D-PROD-198.
    assert.deepEqual(depois.colunas, [...COLUNAS_TODAS]);
    assert.deepEqual(depois.indices_categoria, [...INDICES_CATEGORIA_DEPOIS]);
    assert.deepEqual(depois.constraints_categoria, [...CONSTRAINTS_CATEGORIA_DEPOIS]);
    assert.deepEqual(depois.indices_curva, [...INDICES_CURVA_DEPOIS]);
    assert.deepEqual(depois.constraints_curva, partida.constraints_curva, 'o UNIQUE de CADCURVAGANHO é índice, não constraint');
    assert.deepEqual(depois.oids, partida.oids, 'as mesmas tabelas (ALTER, não cópia)');
    assert.deepEqual(depois.categorias, partida.categorias, 'as linhas nas colunas de antes não mudaram');
    assert.deepEqual(depois.curvas, partida.curvas, 'nenhuma curva mudou');
    assert.equal(depois.tabelas, partida.tabelas + 4, 'nenhuma tabela a mais nem a menos além das 3 das Formulações (D-PROD-203) e da LEITURACOCHO (D-PROD-205), por último: 91 → 95');

    // Cada categoria ficou na CURVA PADRÃO da própria fazenda (a inativa inclusive; nunca na CURVA ENGORDA).
    const ligadas = await db.$queryRawUnsafe(`SELECT id, curva_ganho_id AS curva FROM public."CADCATEGORIA" ORDER BY id COLLATE "C"`);
    assert.deepEqual(Object.fromEntries(ligadas.map((x) => [x.id, x.curva])), { ...CURVA_ESPERADA });

    // curva_ganho_id VARCHAR(64) NOT NULL, sem default.
    const [col] = await db.$queryRawUnsafe(`SELECT data_type::text AS tipo, character_maximum_length::int AS tam, is_nullable::text AS nulo, column_default AS padrao
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADCATEGORIA' AND column_name = 'curva_ganho_id'`);
    assert.deepEqual(col, { tipo: 'character varying', tam: 64, nulo: 'NO', padrao: null });

    // A FK composta: mesma fazenda (cliente_id, empresa_id), RESTRICT na exclusão, CASCADE na atualização, validada.
    const [fk] = await db.$queryRawUnsafe(`SELECT pg_get_constraintdef(oid) AS def, convalidated AS valida FROM pg_constraint WHERE conname = '${FK}'`);
    assert.equal(fk.def, 'FOREIGN KEY (cliente_id, empresa_id, curva_ganho_id) REFERENCES "CADCURVAGANHO"(cliente_id, empresa_id, id) ON UPDATE CASCADE ON DELETE RESTRICT');
    assert.equal(fk.valida, true);
    const [idx] = await db.$queryRawUnsafe(`SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'CADCURVAGANHO_cliente_id_empresa_id_id_key'`);
    assert.match(idx.def, /^CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_empresa_id_id_key" ON public\."CADCURVAGANHO" USING btree \(cliente_id, empresa_id, id\)$/);

    // O Prisma Client lê a relação nova.
    const lidas = await db.categoriaManejo.findMany({ orderBy: { id: 'asc' }, include: { curvaGanho: { select: { id: true, nome: true } } } });
    assert.equal(lidas.length, CATEGORIAS.length);
    for (const c of lidas) {
      assert.equal(c.curva_ganho_id, CURVA_ESPERADA[c.id]);
      assert.deepEqual(c.curvaGanho, { id: CURVA_ESPERADA[c.id], nome: CURVA_PADRAO });
    }

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('CC-05 depois da CONTRACT a FK composta recusa curva de outra fazenda ou de outro cliente, curva nula, troca de fazenda sem trocar a curva e exclusão de curva em uso; curva da mesma fazenda e exclusão de curva livre passam', async () => {
    const antes = await retrato(db);
    const fkViolada = new RegExp(FK);
    // Curva de outra fazenda do mesmo cliente, de outro cliente, ou inexistente: FK.
    for (const curva of ['ccc-k-f1-padrao', 'ccc-k-f2-padrao', 'ccc-k-inexistente']) {
      await assert.rejects(inserir(db, 'CADCATEGORIA', linhaCategoria('ccc-cat-intrusa-fk', 0, 'BEZERRA', { curva_ganho_id: curva })), fkViolada, curva);
    }
    // Sem curva: NOT NULL (23502; a mensagem do Prisma só traz a linha, com a curva nula na penúltima posição e o peso
    // objetivo da D-PROD-198, também nulo, no fim).
    await assert.rejects(inserir(db, 'CADCATEGORIA', linhaCategoria('ccc-cat-intrusa-nula', 0, 'BEZERRA')), /Code: `23502`[\s\S]*ccc-cat-intrusa-nula[^)]*, null, null\)/);
    // Trocar a fazenda da categoria sem trocar a curva: a curva não é da fazenda nova.
    await assert.rejects(db.$executeRawUnsafe(`UPDATE public."CADCATEGORIA" SET empresa_id = 'ccc-c1-emp-2' WHERE id = 'ccc-cat-f0-a'`), fkViolada);
    // Excluir uma curva em uso: RESTRICT.
    await assert.rejects(db.$executeRawUnsafe(`DELETE FROM public."CADCURVAGANHO" WHERE id = 'ccc-k-f0-padrao'`), fkViolada);
    assert.deepEqual(await retrato(db), antes, 'nada mudou com as recusas');

    // Controle positivo: outra curva da MESMA fazenda (e a volta), fazenda e curva trocadas juntas (e a volta).
    assert.equal(await db.$executeRawUnsafe(`UPDATE public."CADCATEGORIA" SET curva_ganho_id = 'ccc-k-f0-engorda' WHERE id = 'ccc-cat-f0-a'`), 1);
    await assert.rejects(db.$executeRawUnsafe(`DELETE FROM public."CADCURVAGANHO" WHERE id = 'ccc-k-f0-engorda'`), fkViolada, 'agora em uso');
    assert.equal(await db.$executeRawUnsafe(`UPDATE public."CADCATEGORIA" SET curva_ganho_id = 'ccc-k-f0-padrao' WHERE id = 'ccc-cat-f0-a'`), 1);
    assert.equal(await db.$executeRawUnsafe(`UPDATE public."CADCATEGORIA" SET empresa_id = 'ccc-c1-emp-2', curva_ganho_id = 'ccc-k-f1-padrao' WHERE id = 'ccc-cat-f0-a'`), 1);
    assert.equal(await db.$executeRawUnsafe(`UPDATE public."CADCATEGORIA" SET empresa_id = 'ccc-c1-emp-1', curva_ganho_id = 'ccc-k-f0-padrao' WHERE id = 'ccc-cat-f0-a'`), 1);
    // Uma curva que nenhuma categoria usa sai normalmente (e volta, para a 2ª execução comparar o mesmo retrato).
    assert.equal(await db.$executeRawUnsafe(`DELETE FROM public."CADCURVAGANHO" WHERE id = 'ccc-k-f3-recria'`), 1);
    const f3 = FAZENDAS[3];
    await inserir(db, 'CADCURVAGANHO', { id: 'ccc-k-f3-recria', cliente_id: f3.cliente, empresa_id: f3.empresa, nome: 'CURVA RECRIA', ...Object.fromEntries(GMD_MENSAIS.map((g, i) => [g, 0.3 + i / 100])) });
    const depois = await retrato(db);
    assert.equal(depois.curvas.n, antes.curvas.n);
    assert.deepEqual(depois.categorias, antes.categorias, 'as categorias voltaram como estavam');
    assert.deepEqual(await intrusos(db), []);
  });

  test('CC-06 2ª execução do runner: nada pendente e nada muda', async () => {
    const antes = await retrato(db);
    const r = await aplicarPeloRunner(URL_T);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
    assert.equal((await historico(db)).concluidas, TOTAL_MIGRATIONS);
  });
});
