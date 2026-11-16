/**
 * D-PROD-200 — a migration CONTRACT `20261114500000_atividade_cabecalho` (formato CONVERSÃO do portão: a atividade
 * vira CABEÇALHO, o apontamento de hoje vira FILHO dela e as 3 tabelas antigas saem) de ponta a ponta, contra
 * PostgreSQL real, em bancos PRÓPRIOS criados e apagados por este teste (o banco da suíte não é tocado; os nomes
 * começam pelo nome do banco da suíte).
 *
 * Partida (banco MODELO): as migrations de nome ANTERIOR a esta (52: produção depois dos padrões do Tipo de
 * Atividade, D-PROD-197, e do peso objetivo na Categoria de Manejo, a EXPAND da D-PROD-198), pelo Prisma a partir de uma cópia temporária, e os 2 apontamentos com a forma EXATA dos de
 * produção: o nº 1, CONFIRMADO, de 2026-11-14, tipo 'TESTE', com área (que tem setor), máquina (horímetro), operador,
 * centro de custo, centro de resultado, produção 1 'KM' e criado_por, sem implemento, horas, hora, safra, tarefa ou
 * observação; o nº 2, CONFIRMADO, mesma data, tipo 'TES', sem área e sem operador, com máquina, centros e produção 150
 * 'HA'; e o contador `ApontamentoAtividade` / `tenant` / próximo 3 (mais um contador de outra entidade, que não pode
 * mudar). Os bancos do teste são cópias dele (CREATE DATABASE … TEMPLATE).
 *
 * RED (cada um num banco NOVO, recusado com a mensagem própria da guarda, `guarda:`, e NADA muda — tabelas,
 * constraints, índices, linhas das antigas e do contador, histórico): item de custo, fatia FIFO, implemento, hora de
 * início, hora de fim, horas trabalhadas, status fora da lista, cancelamento incompleto (nos dois sentidos), contador
 * `Atividade` já existente, tabela nova já existente (cada uma), tabela antiga ausente, trava concorrente (55P03 pelo
 * lock_timeout de 5 s da guarda) e o item pelo runner oficial (falha aberta → `migrate resolve --rolled-back`). A
 * CORRIDA: um item gravado por uma transação concorrente enquanto a migration espera a trava da guarda é visto e
 * recusado (sem a trava, a conferência não o via e o DROP o apagava com a tabela — achado deste teste). E o runner com
 * a conferência de alvo exigida e SEM MIGRATION_CONTRACT_AUTORIZADO=D-PROD-200 exato recusa antes de qualquer DDL.
 *
 * GREEN pelo runner oficial (alvo conferido + decisão exata): todas concluídas, as 2 atividades e os 2 apontamentos
 * campo a campo, o contador renomeado (próximo 3) e o outro intacto, as 3 antigas fora, 84 tabelas, RLS nas 2 novas,
 * `migrate diff` vazio; o unique (atividade, dia, turno, sequência) NULLS NOT DISTINCT, os CHECKs, as FKs e o
 * RESTRICT; reaplicar o arquivo é recusado pela guarda sem mudar nada; 2ª execução sem pendência. Um apontamento
 * CANCELADO (de outro cliente, com o próprio contador) vira atividade CANCELADA + apontamento CANCELADO com o
 * cancelamento.
 *
 * Runbook: o preflight, o envelope do caminho B e o postcheck de `MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md`
 * (entre os marcadores `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local.
 *
 * D-PROD-202: a EXPAND `20261114600000_atividade_linhas_produto_maquina` (as linhas de produto e de máquina do
 * apontamento: 3 tabelas novas e 2 colunas anuláveis), de nome posterior, não existia no dia desta CONTRACT. Fica fora
 * da partida (que é só o que vem ANTES desta) e sobe nos GREEN que aplicam tudo o que pende no diretório real (o runner
 * oficial, depois desta e sem autorização, por ser EXPAND; no caminho B, a 2ª execução do runner). O postcheck do
 * runbook fixa o histórico de produção naquele dia (53 / 0, 84 tabelas): passa inteiro no banco do caminho B antes do
 * runner e, no banco do runner, só as duas linhas de contagem mudam.
 *
 * D-PROD-203: a EXPAND `20261114700000_cadformulacao` (Formulações: 3 tabelas novas, nada em tabela antiga), da release
 * seguinte à D-PROD-202, também tem nome posterior e também não existia no dia desta CONTRACT: fica fora da partida e
 * sobe nos mesmos GREEN, depois da D-PROD-202 (pela ordem dos nomes; EXPAND, sem autorização). No banco do runner as
 * duas linhas de contagem do postcheck ficam 55 / 0 e 90 (84 + 3 da D-PROD-202 + 3 da D-PROD-203).
 *
 * D-PROD-205: a EXPAND `20261115100000_leitura_cocho` (1 tabela nova, LEITURACOCHO), de nome ainda posterior, segue a
 * mesma regra: fora da partida, sobe nos mesmos GREEN por último. As contagens ficam 56 / 0 e 91.
 *
 * D-PROD-206: a EXPAND `20261115200000_formulacao_faixa_tolerancia` (1 coluna anulável em CADFORMULACAO) idem, por
 * último: 57 / 0 e 91.
 *
 * D-PROD-207: o mesmo vale para a EXPAND `20261115900000_atividade_mao_obra_servico` (os cadastros Funcionario e
 * Servico e as linhas de mão de obra e de serviço: 4 tabelas novas, nenhuma coluna em tabela antiga), também de nome
 * posterior: sobe depois da D-PROD-206 nos mesmos GREEN, e as duas linhas de contagem passam a 58 / 0 e 95.
 *
 * D-PROD-208: a CONTRACT `20261116000000_mao_obra_parceiro` (o funcionário como papel do parceiro; a Funcionario, vazia,
 * sai), de nome ainda posterior, também não existia no dia desta. O runner oficial nunca aplica duas CONTRACT de uma
 * vez: com o diretório real, a decisão desta não basta (a D-PROD-208 pende junto; o AC-04 prova a recusa). Por isso o
 * GREEN desta roda NO DIA DELA pelo runner do espelho (`espelhoDoRunner.mjs`, as pastas até a D-PROD-207: esta e as
 * EXPAND posteriores, 58 / 0 e 95) e, depois, a D-PROD-208 sobe pelo runner do repositório com a decisão DELA, como em
 * produção: 59 / 0 e 94, `migrate diff` vazio. Nos runners locais (sem a conferência), ela sobe junto, por último.
 *
 * D-PROD-209: a CONTRACT `20261116100000_funcionario_tipo_terceirizado` (o CHECK de Fornecedor com TERCEIRIZADO no lugar
 * de TAREFEIRO), ainda posterior, entra do mesmo jeito: a D-PROD-208 passa a subir pelo espelho até ela (no dia dela) e
 * a D-PROD-209 pelo runner do repositório com a decisão DELA: 60 / 0 e 94. Nos runners locais, as duas sobem por último.
 *
 * D-PROD-210: a CONTRACT `20261116200000_formulacao_base_consumo` (base do consumo; só as 3 tabelas das Formulações),
 * ainda posterior, entra do mesmo jeito: a D-PROD-209 passa a subir pelo espelho até ela (no dia dela).
 *
 * D-PROD-211: a CONTRACT `20261116300000_abastecimento_atividade` (colunas, CHECKs e FKs em AbastecimentoBem, para as
 * tabelas que esta cria), ainda posterior, do mesmo jeito: a D-PROD-210 passa a subir pelo espelho até ela e a
 * D-PROD-211 pelo runner do repositório com a decisão DELA: 62 / 0 e 94. Nos runners locais, as quatro sobem por último.
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

// Só o cliente Prisma da suíte (para criar e apagar os bancos próprios), sem os helpers: eles carregam o app inteiro,
// e este teste não depende de rota nem de serviço.
import { closePrismaClient, getPrismaClient } from '../src/database/prismaClient.js';
import { motivoAlvoProtegido } from '../../scripts/auth/alvoProtegido.mjs';
import { criarEspelhoDoRunner } from './espelhoDoRunner.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const NOME_CONTRACT = '20261114500000_atividade_cabecalho';
const DECISAO = 'D-PROD-200';
const ARQUIVO = join(MIGRATIONS, NOME_CONTRACT, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** As CONTRACT anteriores, concluídas na partida como em produção. */
const CONTRACTS_ANTERIORES = Object.freeze([
  '20261110300000_patrimonio_simplifica', '20261113200000_tipo_tarefa_drop_colunas',
  '20261113500000_categoria_manejo_cadcategoria', '20261114100000_cadcurvaganho_mensal',
  '20261114200000_cadcategoria_curva_ganho', '20261114300000_tipo_atividade_defaults',
]);
/** Pastas do repositório: a partida é o que vem ANTES desta (produção hoje); o GREEN, todas. */
const PASTAS = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME_CONTRACT));
/** D-PROD-198: a EXPAND do peso objetivo, a última que produção concluiu antes desta (o preflight e o envelope a conferem). */
const NOME_PESO_OBJETIVO = '20261114400000_cadcategoria_peso_objetivo';
/** D-PROD-202: a EXPAND das linhas de produto e de máquina, de nome posterior; não existia no dia desta CONTRACT (ver o cabeçalho). */
const NOME_LINHAS = '20261114600000_atividade_linhas_produto_maquina';
const NOVAS_LINHAS = Object.freeze(['AtividadeApontamentoMaquina', 'AtividadeApontamentoProduto', 'AtividadeApontamentoProdutoConsumoLote']);
/** D-PROD-203: a EXPAND das Formulações, de nome posterior à da D-PROD-202; também não existia no dia desta CONTRACT. */
const NOME_FORMULACOES = '20261114700000_cadformulacao';
const TABELAS_FORMULACOES = Object.freeze(['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA']);
/** D-PROD-205: a EXPAND da Leitura de cocho, de nome ainda posterior (ver o cabeçalho). */
const NOME_LEITURA = '20261115100000_leitura_cocho';
/** D-PROD-206: a EXPAND da faixa de tolerância (coluna em CADFORMULACAO), de nome posterior à da Leitura de cocho. */
const NOME_FAIXA = '20261115200000_formulacao_faixa_tolerancia';
/** D-PROD-207: a EXPAND da mão de obra e do serviço, a de nome mais posterior (ver o cabeçalho). */
const NOME_MAO_OBRA = '20261115900000_atividade_mao_obra_servico';
const NOVAS_MAO_OBRA = Object.freeze(['AtividadeApontamentoMaoObra', 'AtividadeApontamentoServico', 'Funcionario', 'Servico']);
/** D-PROD-208: a CONTRACT do ajuste da Fatia 4, de nome posterior à da D-PROD-207 (ver o cabeçalho); tira a Funcionario. */
const NOME_PARCEIRO = '20261116000000_mao_obra_parceiro';
/** D-PROD-209: a CONTRACT do tipo Terceirizado, ainda posterior (ver o cabeçalho); só troca o CHECK de Fornecedor. */
const NOME_TIPO = '20261116100000_funcionario_tipo_terceirizado';
/** D-PROD-210: a CONTRACT da base do consumo, ainda posterior (ver o cabeçalho); só as 3 tabelas das Formulações. */
const NOME_BASE = '20261116200000_formulacao_base_consumo';
/** D-PROD-211: a CONTRACT do abastecimento ligado à atividade, ainda posterior (ver o cabeçalho). */
const NOME_ABASTECIMENTO = '20261116300000_abastecimento_atividade';
/** As tabelas das EXPAND posteriores (D-PROD-202, D-PROD-203, D-PROD-205, D-PROD-206 e D-PROD-207; a D-PROD-206 só põe uma coluna), que só existem nos bancos em que o runner as aplicou. */
const NOVAS_POSTERIORES = Object.freeze([...NOVAS_LINHAS, ...TABELAS_FORMULACOES, 'LEITURACOCHO', ...NOVAS_MAO_OBRA]);
const TOTAL_MIGRATIONS = PASTAS.length;
/** Migrations concluídas na ordem REAL de aplicação (finished_at). */
const ordemDeAplicacao = async (db) =>
  (await db.$queryRawUnsafe(`SELECT migration_name AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
                              ORDER BY finished_at, started_at, migration_name`)).map((x) => x.n);

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const ANTIGAS = Object.freeze(['ApontamentoAtividade', 'ApontamentoAtividadeItem', 'ApontamentoAtividadeItemConsumoLote']);
const NOVAS = Object.freeze(['Atividade', 'AtividadeApontamento']);
const C1 = 'acb-c1';
const C2 = 'acb-c2';
const E1 = `${C1}-e1`;
const E2 = `${C1}-e2`;
const U1 = `${C1}-u1`;
/** Ids dos 2 apontamentos de produção (cuid, 25 caracteres): 'atv_' + id cabe nos 64 de atividade_id. */
const IDS = Object.freeze(['cmhzq1a2b0001ap0000000001', 'cmhzq1a2b0002ap0000000002']);
const CRIADO_EM = [new Date('2026-11-14T12:00:00.000Z'), new Date('2026-11-14T12:30:00.000Z')];
const ALTERADO_EM = [new Date('2026-11-14T12:05:00.000Z'), new Date('2026-11-14T13:10:00.000Z')];
const SEQ_ALTERADA_EM = new Date('2026-11-14T12:30:00.000Z');

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-200: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
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
/** O runner oficial (`npm run deploy:migrate`). `runtime` é a conexão do runtime quando a conferência de alvo é exigida. */
/** D-PROD-208: o runner oficial no espelho com as pastas até a D-PROD-207 (ver o cabeçalho); criado no `before`. */
let ESPELHO;
const runnerAteMaoObra = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-209: o runner oficial no espelho com as pastas até a D-PROD-208 (no dia dela); criado no `before`. */
let ESPELHO_208;
const runnerAteParceiro = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_208,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-210: o runner oficial no espelho com as pastas até a D-PROD-209 (no dia dela); criado no `before`. */
let ESPELHO_209;
const runnerAteTipo = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_209,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-211: o runner oficial no espelho com as pastas até a D-PROD-210 (no dia dela); criado no `before`. */
let ESPELHO_210;
const runnerAteBase = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_210,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
const aplicarPeloRunner = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
const resolverRevertida = (url) => prisma(['migrate', 'resolve', '--rolled-back', NOME_CONTRACT, '--schema', SCHEMA], url);
const migrateDiff = (url) => prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', SCHEMA, '--exit-code'], url);

/** psql sem .psqlrc, saída crua e SQLSTATE nas mensagens de erro. */
const psql = (url, args) => {
  const u = new URL(url);
  u.search = '';
  return rodar('psql', [u.toString(), '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...args], { env: ambienteBase() });
};
/** O migration.sql numa transação só (como o caminho B do runbook). */
const aplicarArquivo = (url) => psql(url, ['-1', '-f', ARQUIVO]);
/** Um texto inteiro numa só consulta (como o execute_sql do conector). */
const consulta = (url, sql) => psql(url, ['-c', sql]);
/** Linhas `item|valor|esperado|status` do preflight/postcheck do runbook. */
const quadro = (r) => Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => {
  const [item, valor, esperado, status] = l.split('|');
  return [item, { valor, esperado, status }];
}));
const comSidLocal = (sql, sid) => sql.split(SID_PRODUCAO).join(sid);
/** O envelope do caminho B do runbook com o migration.sql integral no lugar marcado. */
const envelope = () => {
  const e = blocoDoRunbook('caminho-b');
  assert.equal(e.split(MARCA_MIGRATION).length, 2, 'o envelope tem o lugar do migration.sql');
  return e.replace(MARCA_MIGRATION, () => SQL_MIGRATION);
};

/** Cópia temporária das pastas da partida (as de nome anterior a esta) aplicada pelo Prisma. */
const aplicarAnteriores = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-acb-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of ANTERIORES) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-200: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Sementes em SQL cru (o Prisma Client já é o do schema novo; a partida ainda tem as tabelas antigas). */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C1}', 'acb1', 'Cliente ACB', now())`);
  await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES
    ('${E1}', '${C1}', 1, 'F1', 'Fazenda 1', now()), ('${E2}', '${C1}', 2, 'F2', 'Fazenda 2', now())`);
  await ins(`INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, "updatedAt") VALUES ('${U1}', '${C1}', 'Operador', 'operador', 'x', now())`);
  await ins(`INSERT INTO "Setor" (id, cliente_id, empresa_id, numero_setor, nome, "updatedAt") VALUES ('${C1}-s1', '${C1}', '${E1}', '1', 'Setor Norte', now())`);
  await ins(`INSERT INTO "AreaPastagem" (id, cliente_id, empresa_id, setor_id, setor_nome, numero_area, nome, tamanho_hectares, "updatedAt")
    VALUES ('${C1}-a1', '${C1}', '${E1}', '${C1}-s1', 'Setor Norte', '1', 'Pasto 01', 12.5, now())`);
  await ins(`INSERT INTO "FamiliaPatrimonial" (id, cliente_id, codigo, nome, natureza, "updatedAt") VALUES
    ('${C1}-fm', '${C1}', 'TRATORES', 'Tratores', 'MAQUINA', now()), ('${C1}-fi', '${C1}', 'GRADES', 'Grades', 'IMPLEMENTO', now())`);
  await ins(`INSERT INTO "TipoPatrimonial" (id, cliente_id, familia_id, codigo, nome, "updatedAt") VALUES
    ('${C1}-tm', '${C1}', '${C1}-fm', 'TRATOR', 'Trator', now()), ('${C1}-ti', '${C1}', '${C1}-fi', 'GRADE', 'Grade', now())`);
  await ins(`INSERT INTO "BemPatrimonial" (id, cliente_id, empresa_id, numero, nome, natureza, familia_id, tipo_id, medidor_tipo, medidor_unidade,
      medidor_leitura_inicial, medidor_leitura_atual, medidor_data_leitura, medidor_origem, "updatedAt")
    VALUES ('${C1}-b1', '${C1}', '${E1}', '1', 'Trator 01', 'MAQUINA', '${C1}-fm', '${C1}-tm', 'HORIMETRO', 'h', 100, 100, '2026-11-01', 'CADASTRO_INICIAL', now())`);
  await ins(`INSERT INTO "BemPatrimonial" (id, cliente_id, empresa_id, numero, nome, natureza, familia_id, tipo_id, "updatedAt")
    VALUES ('${C1}-b2', '${C1}', '${E1}', '2', 'Grade 01', 'IMPLEMENTO', '${C1}-fi', '${C1}-ti', now())`);
  await ins(`INSERT INTO "CentroCusto" (id, cliente_id, empresa_id, numero, nome, "updatedAt") VALUES ('${C1}-cc', '${C1}', '${E1}', '1', 'Custeio', now())`);
  await ins(`INSERT INTO "CentroResultado" (id, cliente_id, empresa_id, numero, nome, "updatedAt") VALUES ('${C1}-cr', '${C1}', '${E1}', '1', 'Pecuária', now())`);
  await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${C1}-g1', '${C1}', 'Tratos', now())`);
  await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, "updatedAt") VALUES
    ('${C1}-t1', '${C1}', 'TESTE', '${C1}-g1', 'Tratos', now()), ('${C1}-t2', '${C1}', 'TES', '${C1}-g1', 'Tratos', now())`);
  // Os 2 apontamentos com a forma EXATA dos de produção (versão 1 e 3: o filho leva a versão, o cabeçalho começa em 1).
  await ins(`INSERT INTO "ApontamentoAtividade" (id, cliente_id, empresa_id, numero, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id,
      grupo_atividade_nome, data_operacional, bem_id, operador_usuario_id, area_id, centro_custo_id, centro_resultado_id, quantidade_produzida,
      unidade_producao, status, criado_por_usuario_id, versao, "createdAt", "updatedAt") VALUES
    ('${IDS[0]}', '${C1}', '${E1}', '1', '${C1}-t1', 'TESTE', '${C1}-g1', 'Tratos', '2026-11-14', '${C1}-b1', '${U1}', '${C1}-a1', '${C1}-cc', '${C1}-cr', 1,
      'KM', 'CONFIRMADO', '${U1}', 1, '2026-11-14 12:00:00', '2026-11-14 12:05:00'),
    ('${IDS[1]}', '${C1}', '${E1}', '2', '${C1}-t2', 'TES', '${C1}-g1', 'Tratos', '2026-11-14', '${C1}-b1', NULL, NULL, '${C1}-cc', '${C1}-cr', 150,
      'HA', 'CONFIRMADO', '${U1}', 3, '2026-11-14 12:30:00', '2026-11-14 13:10:00')`);
  await ins(`INSERT INTO "EntidadeCodigoSequencia" (id, cliente_id, entidade, escopo_tipo, escopo_id, proximo_valor, "createdAt", "updatedAt") VALUES
    ('${C1}-seq-apont', '${C1}', 'ApontamentoAtividade', 'tenant', '${C1}', 3, '2026-11-14 12:00:00', '2026-11-14 12:30:00'),
    ('${C1}-seq-lote', '${C1}', 'Lote', 'tenant', '${C1}', 7, '2026-11-01 10:00:00', '2026-11-01 10:00:00')`);
};

/** Um item SERVICO no apontamento nº 1 (o modelo novo não tem onde guardá-lo: a guarda recusa). */
const ITEM_SERVICO = (id) => `INSERT INTO "ApontamentoAtividadeItem" (id, cliente_id, empresa_id, apontamento_id, ordem, tipo, status, descricao, quantidade,
    valor_unitario, valor_total, operation_id, criado_por_usuario_id, "updatedAt")
  VALUES ('${id}', '${C1}', '${E1}', '${IDS[0]}', 1, 'SERVICO', 'CONFIRMADO', 'MÃO DE OBRA', 1, 100, 100, 'acb-servico-${id}', '${U1}', now())`;
/** Um item PRODUTO com a saída do estoque e a fatia FIFO dele. */
const semearFatia = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Produto" (id, cliente_id, empresa_id, numero_produto, nome_produto, unidade_principal_estoque, estoque_atual, "updatedAt")
    VALUES ('${C1}-p1', '${C1}', '${E1}', '1', 'HERBICIDA', 'L', 8, now())`);
  await ins(`INSERT INTO "LocalEstoque" (id, cliente_id, numero_local, nome, "updatedAt") VALUES ('${C1}-l1', '${C1}', '1', 'GALPÃO', now())`);
  await ins(`INSERT INTO "EstoqueLoteNota" (id, cliente_id, empresa_id, produto_id, local_estoque_id, custo_unitario, quantidade_entrada, quantidade_disponivel, "updatedAt")
    VALUES ('${C1}-lt1', '${C1}', '${E1}', '${C1}-p1', '${C1}-l1', 5, 10, 8, now())`);
  await ins(`INSERT INTO "MovimentacaoEstoque" (id, cliente_id, empresa_id, numero_movimentacao, tipo_movimentacao, data_movimentacao, produto_id, quantidade,
      unidade_medida, valor_unitario, valor_total, origem_sistema, exclusao_somente_em, lancamento_origem_id, "updatedAt")
    VALUES ('${C1}-mv1', '${C1}', '${E1}', '1', 'Saída', '2026-11-14 12:00:00', '${C1}-p1', 2, 'L', 5, 10, 'apontamento_atividade', 'apontamento_atividade', '${IDS[0]}', now())`);
  await ins(`INSERT INTO "ApontamentoAtividadeItem" (id, cliente_id, empresa_id, apontamento_id, ordem, tipo, status, produto_id, local_estoque_id, quantidade,
      unidade, valor_unitario, valor_total, operation_id, movimentacao_estoque_id, criado_por_usuario_id, "updatedAt")
    VALUES ('it-produto', '${C1}', '${E1}', '${IDS[0]}', 1, 'PRODUTO', 'CONFIRMADO', '${C1}-p1', '${C1}-l1', 2, 'L', 5, 10, 'acb-produto-0001', '${C1}-mv1', '${U1}', now())`);
  await ins(`INSERT INTO "ApontamentoAtividadeItemConsumoLote" (id, cliente_id, empresa_id, item_id, estoque_lote_nota_id, ordem, quantidade, custo_unitario, "updatedAt")
    VALUES ('it-fatia', '${C1}', '${E1}', 'it-produto', '${C1}-lt1', 1, 2, 5, now())`);
};

/**
 * Retrato do que a migration toca (e do que um RED não pode deixar): tabelas, constraints, índices e políticas de
 * public, o histórico (não revertido), e as linhas das 3 antigas, das 2 novas e do contador. Tabela ausente (renomeada
 * num cenário) sai como null: o retrato roda em qualquer estado.
 */
const SQL_RETRATO = `SELECT
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')) AS tabelas,
  (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace) AS constraints,
  (SELECT string_agg(indexname || ':' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public') AS indices,
  (SELECT coalesce(string_agg(c.relname || ':' || p.polname, ',' ORDER BY c.relname, p.polname), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid) AS politicas,
  (SELECT count(*)::int FROM _prisma_migrations WHERE rolled_back_at IS NULL) AS historico,
  (SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas`;
const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
const linhasDe = async (db, tabela) => {
  const { existe } = await um(db, `SELECT to_regclass('public."${tabela}"') IS NOT NULL AS existe`);
  if (!existe) return null;
  return um(db, `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t.id), '')) AS md5 FROM public."${tabela}" t`);
};
const retrato = async (db) => {
  const r = { ...(await um(db, SQL_RETRATO)) };
  for (const t of [...ANTIGAS, ...NOVAS, 'EntidadeCodigoSequencia']) r[t] = await linhasDe(db, t);
  return r;
};
const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
const historico = (db) =>
  um(db, `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS contract_concluida,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NULL AND rolled_back_at IS NULL)::int AS contract_aberta
            FROM "_prisma_migrations"`);
const tabelasDe = async (db) => (await um(db, SQL_RETRATO)).tabelas.split(',');
/** Executa um SQL que TEM de falhar com o SQLSTATE (e, se dado, citando o nome da constraint). */
const recusa = async (db, sql, sqlstate, nome) => {
  await assert.rejects(db.$executeRawUnsafe(sql), (e) => {
    const texto = `${e.message} ${JSON.stringify(e.meta ?? {})}`;
    assert.ok(texto.includes(sqlstate), `${sql}\n→ ${texto}`);
    if (nome) assert.ok(texto.includes(nome), `${sql}\n→ ${texto}`);
    return true;
  });
};

/** As 2 atividades e os 2 apontamentos, campo a campo (datas como texto; decimais como texto). */
const SQL_ATIVIDADES = `SELECT id, cliente_id, empresa_id, numero, nome, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id, grupo_atividade_nome,
    area_id, setor_id, setor_nome, bem_id, safra_ciclo, centro_custo_id, centro_resultado_id, unidade_producao_id, unidade_producao_sigla,
    to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio, data_prevista_fim, data_conclusao, area_planejada, area_executada,
    quantidade_produzida::text AS quantidade_produzida, lancamento_tarefa_id, observacao, status, concluida_em, concluida_por_usuario_id,
    cancelada_em, cancelado_por_usuario_id, motivo_cancelamento, reaberta_em, reaberta_por_usuario_id, motivo_reabertura,
    criado_por_usuario_id, versao, "createdAt", "updatedAt"
  FROM "Atividade" ORDER BY cliente_id, numero`;
const SQL_APONTAMENTOS = `SELECT id, cliente_id, empresa_id, atividade_id, to_char(data_operacional, 'YYYY-MM-DD') AS data_operacional, turno, sequencia,
    operador_usuario_id, area_executada_dia, quantidade_produzida_dia::text AS quantidade_produzida_dia, observacao, origem, status, cancelado_em,
    cancelado_por_usuario_id, motivo_cancelamento, criado_por_usuario_id, versao, "createdAt", "updatedAt"
  FROM "AtividadeApontamento" ORDER BY cliente_id, id`;
const VAZIOS_ATIVIDADE = Object.freeze({
  safra_ciclo: null, unidade_producao_id: null, data_prevista_fim: null, data_conclusao: null, area_planejada: null, area_executada: null,
  lancamento_tarefa_id: null, observacao: null, concluida_em: null, concluida_por_usuario_id: null, reaberta_em: null,
  reaberta_por_usuario_id: null, motivo_reabertura: null,
});
const ATIVIDADES_ESPERADAS = Object.freeze([
  {
    id: `atv_${IDS[0]}`, cliente_id: C1, empresa_id: E1, numero: '1', nome: 'TESTE (apontamento nº 1)', tipo_atividade_id: `${C1}-t1`,
    tipo_atividade_nome: 'TESTE', grupo_atividade_id: `${C1}-g1`, grupo_atividade_nome: 'Tratos', area_id: `${C1}-a1`, setor_id: `${C1}-s1`,
    setor_nome: 'Setor Norte', bem_id: `${C1}-b1`, centro_custo_id: `${C1}-cc`, centro_resultado_id: `${C1}-cr`, unidade_producao_sigla: 'KM',
    data_inicio: '2026-11-14', quantidade_produzida: '1.0000', status: 'ABERTA', cancelada_em: null, cancelado_por_usuario_id: null,
    motivo_cancelamento: null, criado_por_usuario_id: U1, versao: 1, createdAt: CRIADO_EM[0], updatedAt: ALTERADO_EM[0], ...VAZIOS_ATIVIDADE,
  },
  {
    id: `atv_${IDS[1]}`, cliente_id: C1, empresa_id: E1, numero: '2', nome: 'TES (apontamento nº 2)', tipo_atividade_id: `${C1}-t2`,
    tipo_atividade_nome: 'TES', grupo_atividade_id: `${C1}-g1`, grupo_atividade_nome: 'Tratos', area_id: null, setor_id: null, setor_nome: null,
    bem_id: `${C1}-b1`, centro_custo_id: `${C1}-cc`, centro_resultado_id: `${C1}-cr`, unidade_producao_sigla: 'HA', data_inicio: '2026-11-14',
    quantidade_produzida: '150.0000', status: 'ABERTA', cancelada_em: null, cancelado_por_usuario_id: null, motivo_cancelamento: null,
    criado_por_usuario_id: U1, versao: 1, createdAt: CRIADO_EM[1], updatedAt: ALTERADO_EM[1], ...VAZIOS_ATIVIDADE,
  },
]);
const APONTAMENTOS_ESPERADOS = Object.freeze([
  {
    id: IDS[0], cliente_id: C1, empresa_id: E1, atividade_id: `atv_${IDS[0]}`, data_operacional: '2026-11-14', turno: null, sequencia: 1,
    operador_usuario_id: U1, area_executada_dia: null, quantidade_produzida_dia: '1.0000', observacao: null, origem: 'WEB', status: 'CONFIRMADO',
    cancelado_em: null, cancelado_por_usuario_id: null, motivo_cancelamento: null, criado_por_usuario_id: U1, versao: 1,
    createdAt: CRIADO_EM[0], updatedAt: ALTERADO_EM[0],
  },
  {
    id: IDS[1], cliente_id: C1, empresa_id: E1, atividade_id: `atv_${IDS[1]}`, data_operacional: '2026-11-14', turno: null, sequencia: 1,
    operador_usuario_id: null, area_executada_dia: null, quantidade_produzida_dia: '150.0000', observacao: null, origem: 'WEB', status: 'CONFIRMADO',
    cancelado_em: null, cancelado_por_usuario_id: null, motivo_cancelamento: null, criado_por_usuario_id: U1, versao: 3,
    createdAt: CRIADO_EM[1], updatedAt: ALTERADO_EM[1],
  },
]);
const SQL_CONTADORES = `SELECT id, cliente_id, entidade, escopo_tipo, escopo_id, proximo_valor, "createdAt", "updatedAt" FROM "EntidadeCodigoSequencia" ORDER BY id`;

/** Uma sessão concorrente segura ACCESS SHARE em ApontamentoAtividade até `soltar()` (a guarda pede ACCESS EXCLUSIVE). */
const segurarTrava = async (db) => {
  let soltar;
  const ate = new Promise((r) => (soltar = r));
  let travou;
  const travado = new Promise((r) => (travou = r));
  const tx = db.$transaction(async (t) => {
    await t.$executeRawUnsafe('LOCK TABLE "ApontamentoAtividade" IN ACCESS SHARE MODE');
    travou();
    await ate;
  }, { timeout: 120_000, maxWait: 20_000 });
  await Promise.race([travado, tx]);
  return async () => {
    soltar();
    await tx;
  };
};
/** Espera o psql (a migration) ficar parado numa trava, até 5 s. */
const esperarMigrationNaTrava = async (vigia) => {
  for (let i = 0; i < 100; i++) {
    const { n } = await um(vigia, `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = 'psql' AND wait_event_type = 'Lock'`);
    if (n > 0) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

const guarda = (trecho) => new RegExp(`P0001: guarda: ${trecho}`);
const COM_ITEM = guarda('há itens de custo ou fatias FIFO no apontamento antigo; a conversão não os carrega');
const SEM_LUGAR = guarda('há apontamento antigo com implemento, hora ou horas trabalhadas; o modelo novo não tem onde guardar');
const STATUS = guarda('há apontamento antigo com status fora de CONFIRMADO/CANCELADO ou cancelamento incompleto');
const NOVAS_EXISTEM = guarda('as tabelas novas da atividade já existem');
const atualizar = (sets, id = IDS[1]) => (db) => db.$executeRawUnsafe(`UPDATE "ApontamentoAtividade" SET ${sets} WHERE id = '${id}'`);

/** Cenários RED: cada um, num banco novo, prepara um estado, tem de ser RECUSADO com a mensagem própria e não pode mudar nada. */
const CENARIOS_RED = Object.freeze([
  { id: 'item_de_custo', esperado: COM_ITEM, preparar: (db) => db.$executeRawUnsafe(ITEM_SERVICO('it-servico')) },
  { id: 'fatia_fifo', esperado: COM_ITEM, preparar: semearFatia },
  { id: 'implemento', esperado: SEM_LUGAR, preparar: atualizar(`implemento_bem_id = '${C1}-b2'`) },
  { id: 'hora_inicio', esperado: SEM_LUGAR, preparar: atualizar(`hora_inicio = '2026-11-14 07:00:00'`) },
  { id: 'hora_fim', esperado: SEM_LUGAR, preparar: atualizar(`hora_fim = '2026-11-14 11:00:00'`, IDS[0]) },
  { id: 'horas_trabalhadas', esperado: SEM_LUGAR, preparar: atualizar('horas_trabalhadas = 8') },
  { id: 'status_fora_da_lista', esperado: STATUS, preparar: atualizar(`status = 'RASCUNHO'`) },
  { id: 'cancelado_sem_data', esperado: STATUS, preparar: atualizar(`status = 'CANCELADO', motivo_cancelamento = 'teste'`) },
  { id: 'confirmado_com_data_de_cancelamento', esperado: STATUS, preparar: atualizar('cancelado_em = now()', IDS[0]) },
  {
    id: 'contador_atividade_existente',
    esperado: guarda('já existe contador para a entidade Atividade'),
    preparar: (db) => db.$executeRawUnsafe(`INSERT INTO "EntidadeCodigoSequencia" (id, cliente_id, entidade, escopo_tipo, escopo_id, proximo_valor, "updatedAt")
      VALUES ('${C1}-seq-intrusa', '${C1}', 'Atividade', 'tenant', '${C1}', 1, now())`),
  },
  { id: 'atividade_ja_existe', esperado: NOVAS_EXISTEM, preparar: (db) => db.$executeRawUnsafe('CREATE TABLE "Atividade" ("id" TEXT)') },
  { id: 'apontamento_novo_ja_existe', esperado: NOVAS_EXISTEM, preparar: (db) => db.$executeRawUnsafe('CREATE TABLE "AtividadeApontamento" ("id" TEXT)') },
  {
    id: 'tabela_antiga_ausente',
    esperado: guarda('as 3 tabelas antigas do apontamento de atividade têm de existir'),
    preparar: (db) => db.$executeRawUnsafe('ALTER TABLE "ApontamentoAtividadeItemConsumoLote" RENAME TO "ApontamentoAtividadeItemConsumoLote_intrusa"'),
  },
  {
    // 55P03 no LOCK da própria guarda: a sessão concorrente segura ApontamentoAtividade e a transação desiste em ~5 s.
    id: 'trava_concorrente',
    trava: true,
    esperado: /55P03: canceling statement due to lock timeout[\s\S]*LOCK TABLE public\."ApontamentoAtividade"/,
  },
  {
    // Pelo runner oficial (alvo local, sem a barreira do CONTRACT): a falha fica aberta e é resolvida como revertida.
    id: 'item_pelo_runner',
    runner: true,
    esperado: /guarda: há itens de custo ou fatias FIFO no apontamento antigo/,
    preparar: (db) => db.$executeRawUnsafe(ITEM_SERVICO('it-runner')),
  },
]);
/** O lock_timeout da guarda é 5 s; o teto cobre a partida do psql em máquina lenta de CI. */
const TETO_TRAVA_MS = 20_000;

let BASE_URL;
let PREFIXO;
let BANCO_MODELO;
let URL_T;
let URL_B;
let SID;
let db;
let partida;

/** Um banco novo, cópia do modelo (o modelo não pode ter conexão aberta). */
const clonar = async (banco) => {
  const p = getPrismaClient();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
  await p.$queryRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BANCO_MODELO}' AND pid <> pg_backend_pid()`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${banco} TEMPLATE ${BANCO_MODELO}`);
  return comBanco(BASE_URL, banco);
};
const apagar = (banco) => getPrismaClient().$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
/** Roda `fn(db, url)` num banco novo, cópia do modelo, apagado no fim. */
const emBancoNovo = async (sufixo, fn) => {
  const banco = `${PREFIXO}_acb_${sufixo}`;
  const url = await clonar(banco);
  const dbx = new PrismaClient({ datasourceUrl: url });
  try {
    return await fn(dbx, url);
  } finally {
    await dbx.$disconnect();
    await apagar(banco);
  }
};

before(async () => {
  const p = getPrismaClient();
  BASE_URL = exigirUrlLocal(process.env.DATABASE_URL);
  ESPELHO = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_MAO_OBRA }).dir;
  ESPELHO_208 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_PARCEIRO }).dir;
  ESPELHO_209 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_TIPO }).dir;
  ESPELHO_210 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_BASE }).dir;
  // Nomes próprios, derivados do banco da suíte (cada execução paralela com banco próprio fica isolada).
  PREFIXO = new URL(BASE_URL).pathname.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'maike';
  BANCO_MODELO = `${PREFIXO}_acb_modelo`;
  for (const b of [`${PREFIXO}_acb`, `${PREFIXO}_acb_b`, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(comBanco(BASE_URL, BANCO_MODELO));
  const modelo = new PrismaClient({ datasourceUrl: comBanco(BASE_URL, BANCO_MODELO) });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  URL_T = await clonar(`${PREFIXO}_acb`);
  URL_B = await clonar(`${PREFIXO}_acb_b`);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  for (const b of [`${PREFIXO}_acb`, `${PREFIXO}_acb_b`, BANCO_MODELO]) if (PREFIXO) await apagar(b);
  for (const e of [ESPELHO, ESPELHO_208, ESPELHO_209, ESPELHO_210]) if (e) rmSync(e, { recursive: true, force: true });
  await closePrismaClient();
});

describe('D-PROD-200 — migration CONTRACT da Atividade cabeçalho, com conversão (PostgreSQL real)', () => {
  test('AC-01 partida: as 52 migrations de nome anterior a esta (as 6 CONTRACT anteriores concluídas), 85 tabelas, as 3 antigas com 2 apontamentos e nenhum item ou fatia, as 2 novas ausentes, o contador ApontamentoAtividade/tenant/3; o preflight do runbook diz PRONTO e, com o system_identifier de produção, PARAR', async () => {
    const h = await historico(db);
    assert.equal(ANTERIORES.length, 52, 'produção hoje: 52 migrations, a CONTRACT anterior os padrões do Tipo de Atividade (D-PROD-197) e a última o peso objetivo (D-PROD-198)');
    assert.deepEqual(ANTERIORES.slice(-2), ['20261114300000_tipo_atividade_defaults', NOME_PESO_OBJETIVO]);
    // D-PROD-202, D-PROD-203, D-PROD-205, D-PROD-206 e D-PROD-207 (ver o cabeçalho): só as EXPAND das linhas, das
    // Formulações, da Leitura de cocho, da faixa de tolerância e da mão de obra e do serviço têm nome posterior a esta, e
    // ficam fora da partida.
    assert.deepEqual(PASTAS.filter((n) => n > NOME_CONTRACT), [NOME_LINHAS, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, NOME_MAO_OBRA, NOME_PARCEIRO, NOME_TIPO, NOME_BASE, NOME_ABASTECIMENTO], 'só as EXPAND da D-PROD-202, da D-PROD-203, da D-PROD-205, da D-PROD-206 e da D-PROD-207 e as CONTRACT da D-PROD-208, da D-PROD-209, da D-PROD-210 e da D-PROD-211 têm nome posterior a esta');
    assert.equal(h.concluidas, ANTERIORES.length);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    const { n: anteriores } = await um(db, `SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name IN (${CONTRACTS_ANTERIORES.map((n) => `'${n}'`).join(', ')}) AND finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    assert.equal(anteriores, CONTRACTS_ANTERIORES.length);
    const tabelas = partida.tabelas.split(',');
    assert.equal(tabelas.length, 85);
    for (const t of ANTIGAS) assert.ok(tabelas.includes(t), t);
    for (const t of NOVAS) assert.ok(!tabelas.includes(t), t);
    assert.deepEqual([partida.ApontamentoAtividade.n, partida.ApontamentoAtividadeItem.n, partida.ApontamentoAtividadeItemConsumoLote.n], [2, 0, 0]);
    assert.deepEqual([partida.Atividade, partida.AtividadeApontamento], [null, null]);

    const r = await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID));
    assert.equal(r.status, 0, r.stderr);
    const q = quadro(r);
    assert.equal(q['migrations concluídas / em aberto'].valor, '52 / 0');
    assert.equal(q['tabelas antigas presentes / novas já presentes'].valor, '3 / 0');
    assert.equal(q['ApontamentoAtividade: CONFIRMADO / CANCELADO (anote; o postcheck repete)'].valor, '2 / 0');
    assert.equal(q['contador ApontamentoAtividade: escopo / próximo (anote; o postcheck repete na entidade Atividade)'].valor, 'tenant / 3');
    assert.equal(q['tabelas em public'].valor, '85');
    for (const [item, v] of Object.entries(q)) if (item !== 'VEREDITO') assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    // Com o system_identifier de produção (texto do runbook intacto) o mesmo preflight manda parar.
    assert.match(quadro(await consulta(URL_T, blocoDoRunbook('preflight'))).VEREDITO.valor, /^PARAR/);
    // E o postcheck, antes de aplicar, também (as novas não existem: a consulta roda e diz PARAR).
    assert.match(quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID))).VEREDITO.valor, /^PARAR/);
    assert.deepEqual(await retrato(db), partida, 'preflight e postcheck só leem');
  });

  for (const cenario of CENARIOS_RED) {
    test(`AC-RED ${cenario.id}: num banco novo, recusado com a mensagem própria e NADA muda (tabelas, constraints, índices, linhas das antigas e do contador, histórico)`, async () => {
      await emBancoNovo('red', async (dbr, url) => {
        if (cenario.preparar) await cenario.preparar(dbr);
        const antes = await retrato(dbr);
        let r;
        let soltar = null;
        let resolvida = null;
        try {
          if (cenario.trava) soltar = await segurarTrava(dbr);
          r = cenario.runner ? await aplicarPeloRunner(url) : await aplicarArquivo(url);
        } finally {
          if (soltar) await soltar();
          if ((await historico(dbr)).contract_aberta) resolvida = await resolverRevertida(url);
        }
        assert.notEqual(r.status, 0, r.saida);
        assert.match(r.saida, cenario.esperado);
        if (cenario.trava) assert.ok(r.ms < TETO_TRAVA_MS, `desistiu em ${r.ms} ms (lock_timeout de 5 s; não espera a trava)`);
        if (cenario.runner) {
          assert.equal(resolvida?.status, 0, resolvida?.saida);
          assert.ok(!vazou(r.saida, url), 'a URL nunca aparece na saída');
        }
        const h = await historico(dbr);
        assert.equal(h.contract_concluida + h.contract_aberta, 0);
        assert.deepEqual(await retrato(dbr), antes, 'nada da migration ficou');
      });
    });
  }

  test('AC-02 corrida: um item gravado por uma transação concorrente enquanto a migration espera a trava da guarda é VISTO e recusado; o item fica (sem a trava, a conferência não o via e o DROP o apagava com a tabela)', async () => {
    await emBancoNovo('corrida', async (dbr, url) => {
      const vigia = new PrismaClient({ datasourceUrl: url });
      try {
        const antes = await retrato(dbr);
        let soltar;
        const ate = new Promise((r) => (soltar = r));
        let inseriu;
        const inserido = new Promise((r) => (inseriu = r));
        const tx = dbr.$transaction(async (t) => {
          await t.$executeRawUnsafe(ITEM_SERVICO('it-corrida'));
          inseriu();
          await ate;
        }, { timeout: 120_000, maxWait: 20_000 });
        await Promise.race([inserido, tx]);
        const migracao = aplicarArquivo(url);
        const parou = await esperarMigrationNaTrava(vigia);
        soltar();
        await tx;
        const r = await migracao;
        assert.ok(parou, 'a migration esperou a trava da transação concorrente');
        assert.notEqual(r.status, 0, r.saida);
        assert.match(r.saida, COM_ITEM);
        const depois = await retrato(dbr);
        assert.deepEqual(depois.ApontamentoAtividadeItem.n, 1, 'o item gravado pela transação concorrente continua');
        assert.deepEqual({ ...depois, ApontamentoAtividadeItem: null }, { ...antes, ApontamentoAtividadeItem: null }, 'o resto não mudou');
      } finally {
        await vigia.$disconnect();
      }
    });
  });

  test('AC-03 runner com a conferência de alvo exigida e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando só a D-PROD-200, antes de qualquer DDL', async () => {
    const linhasAntes = (await historico(db)).total;
    // D-PROD-190/D-PROD-193 criaram as tabelas que ela apaga e D-PROD-197 é a CONTRACT anterior (concluída); a decisão
    // em minúsculas, com espaços ou com um dígito a mais também não vale (comparação exata): nenhuma autoriza esta.
    for (const extra of [{}, ...['D-PROD-197', 'D-PROD-190', 'D-PROD-193', 'd-prod-200', ' D-PROD-200 ', 'D-PROD-1980'].map((d) => ({ MIGRATION_CONTRACT_AUTORIZADO: d }))]) {
      const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.saida.includes(`${NOME_CONTRACT} (${DECISAO})`), r.saida);
      for (const anterior of CONTRACTS_ANTERIORES) assert.ok(!r.saida.includes(anterior), `${anterior} já está concluída: só a D-PROD-200 pende`);
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(r.saida, URL_T));
    }
    assert.equal((await historico(db)).total, linhasAntes, 'nenhuma linha nova no histórico');
    assert.deepEqual(await retrato(db), partida);
  });

  test('AC-04 GREEN pelo runner oficial (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-200; com a D-PROD-208 pendente junto recusa, então no dia desta pelo espelho e depois a D-PROD-208 com a decisão dela): esta e depois as EXPAND da D-PROD-202, da D-PROD-203, da D-PROD-205, da D-PROD-206 e da D-PROD-207, todas/0, as 2 atividades e os 2 apontamentos campo a campo, o contador renomeado (próximo 3) e o outro intacto, as 3 antigas fora, 84 tabelas mais as 3 da D-PROD-202 e as 3 da D-PROD-203, RLS nas 2 novas e migrate diff vazio', async () => {
    const conferencia = { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID };
    // D-PROD-208 (ver o cabeçalho): com o diretório real, a CONTRACT posterior pende junto; a decisão desta não basta e
    // nada é executado.
    const linhasAntes = (await historico(db)).total;
    const junto = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(junto.status, 1, junto.saida);
    assert.ok(junto.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_PARCEIRO} (D-PROD-208), ${NOME_TIPO} (D-PROD-209), ${NOME_BASE} (D-PROD-210), ${NOME_ABASTECIMENTO} (D-PROD-211).`), junto.saida);
    assert.match(junto.saida, /Nenhuma migration foi executada/);
    assert.equal((await historico(db)).total, linhasAntes);
    // No dia desta (espelho até a D-PROD-207): esta, com a decisão, e as EXPAND posteriores.
    const r = await runnerAteMaoObra(URL_T, { runtime: URL_T, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /alvo conferido nas duas conexões/);
    assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME_CONTRACT} (${DECISAO})`), r.saida);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.equal(h.concluidas, TOTAL_MIGRATIONS - 4, 'todas menos a D-PROD-208, a D-PROD-209, a D-PROD-210 e a D-PROD-211');
    assert.equal(TOTAL_MIGRATIONS, 62);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    // As EXPAND da D-PROD-202, da D-PROD-203, da D-PROD-205, da D-PROD-206 e da D-PROD-207, pendentes também, sobem
    // junto e depois desta (pela ordem dos nomes; só esta pede a decisão).
    assert.deepEqual((await ordemDeAplicacao(db)).slice(-6), [NOME_CONTRACT, NOME_LINHAS, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, NOME_MAO_OBRA]);
    const linha = await um(db, `SELECT checksum, applied_steps_count::int AS passos FROM _prisma_migrations WHERE migration_name = '${NOME_CONTRACT}' AND rolled_back_at IS NULL`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1 });

    // Cada apontamento antigo virou uma atividade (id 'atv_' || id antigo, o mesmo número) e um apontamento filho (o mesmo id).
    assert.deepEqual(await db.$queryRawUnsafe(SQL_ATIVIDADES), ATIVIDADES_ESPERADAS.map((a) => ({ ...a })));
    assert.deepEqual(await db.$queryRawUnsafe(SQL_APONTAMENTOS), APONTAMENTOS_ESPERADOS.map((a) => ({ ...a })));
    // O contador passou para a entidade Atividade (mesma linha, mesmo próximo); o de outra entidade não mudou.
    const contadores = await db.$queryRawUnsafe(SQL_CONTADORES);
    assert.equal(contadores.length, 2);
    const [apont, lote] = contadores;
    assert.deepEqual({ ...apont, updatedAt: null }, { id: `${C1}-seq-apont`, cliente_id: C1, entidade: 'Atividade', escopo_tipo: 'tenant', escopo_id: C1, proximo_valor: 3, createdAt: new Date('2026-11-14T12:00:00.000Z'), updatedAt: null });
    assert.notDeepEqual(apont.updatedAt, SEQ_ALTERADA_EM, 'o UPDATE do contador marca updatedAt');
    assert.deepEqual(lote, { id: `${C1}-seq-lote`, cliente_id: C1, entidade: 'Lote', escopo_tipo: 'tenant', escopo_id: C1, proximo_valor: 7, createdAt: new Date('2026-11-01T10:00:00.000Z'), updatedAt: new Date('2026-11-01T10:00:00.000Z') });

    // As 3 antigas saíram e as 2 novas entraram: 85 − 3 + 2 = 84; nenhuma outra tabela mudou. A EXPAND da D-PROD-202,
    // aplicada depois, acrescenta as 3 dela (87), a da D-PROD-203, as 3 das Formulações (90), a da D-PROD-205, a
    // LEITURACOCHO (91), e a da D-PROD-207, aplicada por último, as 4 da mão de obra e do serviço: 95.
    const tabelas = await tabelasDe(db);
    assert.equal(tabelas.length, 95);
    assert.deepEqual(tabelas, [...partida.tabelas.split(',').filter((t) => !ANTIGAS.includes(t)), ...NOVAS, ...NOVAS_POSTERIORES].sort());
    for (const t of ANTIGAS) assert.equal((await um(db, `SELECT to_regclass('public."${t}"')::text AS r`)).r, null, t);
    // RLS ligado, sem FORCE, nas 2 novas (a política só existe com o papel maike_vercel, que o banco local não tem).
    const rls = await db.$queryRawUnsafe(`SELECT relname::text AS t, relrowsecurity AS rls, relforcerowsecurity AS forcar FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname IN ('Atividade', 'AtividadeApontamento') ORDER BY relname`);
    assert.deepEqual(rls, NOVAS.map((t) => ({ t, rls: true, forcar: false })));
    // As constraints e os índices das outras tabelas que não referenciavam as antigas continuam (os das antigas saíram com elas).
    const depois = await retrato(db);
    const semAntigas = (texto) => texto.split('\n').filter((l) => !/^ApontamentoAtividade/.test(l));
    // D-PROD-202: as 2 colunas anuláveis em BemPatrimonial e TipoPatrimonial não mudam constraint nem índice antigo.
    for (const c of semAntigas(partida.constraints)) assert.ok(depois.constraints.split('\n').includes(c), `continua: ${c}`);
    for (const i of semAntigas(partida.indices)) assert.ok(depois.indices.split('\n').includes(i), `continua: ${i}`);
    assert.ok(!depois.constraints.split('\n').some((c) => /^ApontamentoAtividade/.test(c)) && !depois.indices.split('\n').some((i) => /^ApontamentoAtividade/.test(i)));

    // D-PROD-208, depois, pelo runner do dia dela (espelho até ela), com a decisão DELA (a ordem de produção): só ela
    // pende; − Funcionario = 94.
    const ajuste = await runnerAteParceiro(URL_T, { runtime: URL_T, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-208' } });
    assert.equal(ajuste.status, 0, ajuste.saida);
    assert.ok(ajuste.saida.includes(`CONTRACT autorizado: ${NOME_PARCEIRO} (D-PROD-208).`), ajuste.saida);
    assert.ok(!ajuste.saida.includes(`Applying migration \`${NOME_CONTRACT}\``), ajuste.saida);
    assert.equal((await historico(db)).concluidas, TOTAL_MIGRATIONS - 3);
    assert.equal((await ordemDeAplicacao(db)).at(-1), NOME_PARCEIRO);
    assert.deepEqual(await tabelasDe(db), tabelas.filter((t) => t !== 'Funcionario'));
    // D-PROD-209, depois, pelo runner do dia dela (espelho até ela), com a decisão DELA: só ela pende; nenhuma tabela muda.
    const tipo = await runnerAteTipo(URL_T, { runtime: URL_T, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-209' } });
    assert.equal(tipo.status, 0, tipo.saida);
    assert.ok(tipo.saida.includes(`CONTRACT autorizado: ${NOME_TIPO} (D-PROD-209).`), tipo.saida);
    assert.equal((await historico(db)).concluidas, TOTAL_MIGRATIONS - 2);
    assert.equal((await ordemDeAplicacao(db)).at(-1), NOME_TIPO);
    assert.deepEqual(await tabelasDe(db), tabelas.filter((t) => t !== 'Funcionario'));
    // D-PROD-210, depois, pelo runner do dia dela (espelho até ela), com a decisão DELA: só ela pende; nenhuma tabela muda.
    const base = await runnerAteBase(URL_T, { runtime: URL_T, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-210' } });
    assert.equal(base.status, 0, base.saida);
    assert.ok(base.saida.includes(`CONTRACT autorizado: ${NOME_BASE} (D-PROD-210).`), base.saida);
    assert.equal((await historico(db)).concluidas, TOTAL_MIGRATIONS - 1);
    assert.equal((await ordemDeAplicacao(db)).at(-1), NOME_BASE);
    assert.deepEqual(await tabelasDe(db), tabelas.filter((t) => t !== 'Funcionario'));
    // D-PROD-211, por último, pelo runner do repositório, com a decisão DELA: só ela pende; nenhuma tabela muda.
    const abastecimento = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-211' } });
    assert.equal(abastecimento.status, 0, abastecimento.saida);
    assert.ok(abastecimento.saida.includes(`CONTRACT autorizado: ${NOME_ABASTECIMENTO} (D-PROD-211).`), abastecimento.saida);
    assert.equal((await historico(db)).concluidas, TOTAL_MIGRATIONS);
    assert.equal((await ordemDeAplicacao(db)).at(-1), NOME_ABASTECIMENTO);
    assert.deepEqual(await tabelasDe(db), tabelas.filter((t) => t !== 'Funcionario'));

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('AC-05 postcheck do runbook no banco aplicado pelo runner: tudo OK/CONFIRA menos as duas contagens que a D-PROD-202, a D-PROD-203, a D-PROD-205, a D-PROD-207, a D-PROD-208, a D-PROD-209, a D-PROD-210 e a D-PROD-211, posteriores, mudam (62 / 0 e 94 tabelas), os números iguais aos do preflight; o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    // O postcheck foi escrito para o dia desta (53 / 0, 84 tabelas); aqui as EXPAND da D-PROD-202, da D-PROD-203, da D-PROD-205, da D-PROD-206 e da D-PROD-207 também estão aplicadas
    // (ver o cabeçalho). O postcheck inteiro, APLICADA, é provado no banco do caminho B (TB-03) antes do runner.
    const CONTAGENS = { 'migrations concluídas / em aberto': `${TOTAL_MIGRATIONS} / 0`, 'tabelas em public': '94' };
    assert.equal(TOTAL_MIGRATIONS, 62);
    for (const [item, v] of Object.entries(pos)) {
      if (item === 'VEREDITO') continue;
      if (item in CONTAGENS) assert.deepEqual([v.valor, v.status], [CONTAGENS[item], 'PARAR'], item);
      else assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    }
    assert.match(pos.VEREDITO.valor, /^PARAR/);
    assert.equal(pos['Atividade ABERTA / CANCELADA (igual ao CONFIRMADO / CANCELADO do preflight)'].valor, '2 / 0');
    assert.equal(pos['AtividadeApontamento CONFIRMADO / CANCELADO (igual ao preflight)'].valor, '2 / 0');
    assert.equal(pos['contador Atividade: escopo / próximo (igual ao do ApontamentoAtividade no preflight)'].valor, 'tenant / 3');
    const pre = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    assert.equal(pre['20261114500000_atividade_cabecalho já registrada'].status, 'PARAR');
    assert.equal(pre['tabelas antigas presentes / novas já presentes'].status, 'PARAR');
    assert.match(pre.VEREDITO.valor, /^PARAR/);
  });

  test('AC-06 reaplicar o migration.sql (psql, uma transação) é recusado pela guarda (as antigas não existem mais) e NADA muda; a 2ª execução do runner não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, guarda('as 3 tabelas antigas do apontamento de atividade têm de existir'));
    assert.deepEqual(await retrato(db), antes);
    const segunda = await aplicarPeloRunner(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
  });

  test('AC-07 unique (cliente, atividade, dia, turno, sequência) NULLS NOT DISTINCT: duas passadas sem turno com a mesma sequência colidem (23505); outra sequência, outro turno ou outro dia passam', async () => {
    const ATV = `atv_${IDS[0]}`;
    const inserir = (id, { data = '2026-11-14', turno = null, sequencia = 1 } = {}) => db.$executeRawUnsafe(`INSERT INTO "AtividadeApontamento"
      (id, cliente_id, empresa_id, atividade_id, data_operacional, turno, sequencia, "updatedAt")
      VALUES ('${id}', '${C1}', '${E1}', '${ATV}', '${data}', ${turno === null ? 'NULL' : `'${turno}'`}, ${sequencia}, now())`);
    // O Prisma devolve só o DETAIL do 23505: a chave com as 5 colunas do unique (e o turno nulo como valor) o identifica.
    const CHAVE = 'Key (cliente_id, atividade_id, data_operacional, turno, sequencia)=';
    // O convertido já é a sequência 1 sem turno do dia 14: outra igual colide, mesmo com o turno nulo.
    await recusa(db, `INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, turno, sequencia, "updatedAt")
      VALUES ('acb-dup', '${C1}', '${E1}', '${ATV}', '2026-11-14', NULL, 1, now())`, '23505', `${CHAVE}(${C1}, ${ATV}, 2026-11-14, null, 1) already exists`);
    await inserir('acb-seq2', { sequencia: 2 });
    await recusa(db, `INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, turno, sequencia, "updatedAt")
      VALUES ('acb-seq2-dup', '${C1}', '${E1}', '${ATV}', '2026-11-14', NULL, 2, now())`, '23505', CHAVE);
    await inserir('acb-manha', { turno: 'MANHA' });
    await recusa(db, `INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, turno, sequencia, "updatedAt")
      VALUES ('acb-manha-dup', '${C1}', '${E1}', '${ATV}', '2026-11-14', 'MANHA', 1, now())`, '23505', CHAVE);
    await inserir('acb-dia15', { data: '2026-11-15' });
    const { n } = await um(db, `SELECT count(*)::int AS n FROM "AtividadeApontamento" WHERE atividade_id = '${ATV}'`);
    assert.equal(n, 4, 'o convertido e as 3 passadas aceitas');
    // O índice do banco é o NULLS NOT DISTINCT (o Prisma não vê a cláusula; o migrate diff do AC-04 continua vazio).
    const { def } = await um(db, `SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'AtividadeApontamento_atividade_dia_turno_sequencia_key'`);
    assert.equal(def, 'CREATE UNIQUE INDEX "AtividadeApontamento_atividade_dia_turno_sequencia_key" ON public."AtividadeApontamento" USING btree (cliente_id, atividade_id, data_operacional, turno, sequencia) NULLS NOT DISTINCT');
    await db.$executeRawUnsafe(`DELETE FROM "AtividadeApontamento" WHERE id IN ('acb-seq2', 'acb-manha', 'acb-dia15')`);
  });

  test('AC-08 CHECKs das novas (23514), FKs compostas pelo tenant e pela fazenda (23503) e RESTRICT: a atividade com apontamento, a máquina, a área e o usuário usados não saem', async () => {
    const ATV = `atv_${IDS[0]}`;
    const apontamento = (campos, valores) => `INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, "updatedAt", ${campos})
      VALUES ('acb-x', '${C1}', '${E1}', '${ATV}', '2026-11-20', 1, now(), ${valores})`;
    await recusa(db, apontamento('turno', `'MADRUGADA'`), '23514', 'AtividadeApontamento_turno_check');
    await recusa(db, `INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, "updatedAt")
      VALUES ('acb-x', '${C1}', '${E1}', '${ATV}', '2026-11-20', 0, now())`, '23514', 'AtividadeApontamento_sequencia_check');
    await recusa(db, apontamento('origem', `'SMS'`), '23514', 'AtividadeApontamento_origem_check');
    await recusa(db, apontamento('status', `'RASCUNHO'`), '23514', 'AtividadeApontamento_status_check');
    await recusa(db, apontamento('status', `'CANCELADO'`), '23514', 'AtividadeApontamento_cancelamento_check');
    await recusa(db, apontamento('quantidade_produzida_dia', '-1'), '23514', 'AtividadeApontamento_quantidade_produzida_dia_check');
    await recusa(db, `UPDATE "Atividade" SET status = 'CONCLUIDA' WHERE id = '${ATV}'`, '23514', 'Atividade_conclusao_check');
    await recusa(db, `UPDATE "Atividade" SET status = 'CANCELADA' WHERE id = '${ATV}'`, '23514', 'Atividade_cancelamento_check');
    await recusa(db, `UPDATE "Atividade" SET data_prevista_fim = '2026-11-13' WHERE id = '${ATV}'`, '23514', 'Atividade_datas_check');
    await recusa(db, `UPDATE "Atividade" SET area_planejada = -1 WHERE id = '${ATV}'`, '23514', 'Atividade_area_planejada_check');
    // O apontamento é da MESMA fazenda da atividade por construção: (cliente, empresa, atividade) → Atividade.
    await recusa(db, `INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, "updatedAt")
      VALUES ('acb-x', '${C1}', '${E2}', '${ATV}', '2026-11-20', 1, now())`, '23503', 'AtividadeApontamento_atividade_fkey');
    await recusa(db, `UPDATE "Atividade" SET area_id = 'nao-existe' WHERE id = '${ATV}'`, '23503', 'Atividade_cliente_id_area_id_fkey');
    await recusa(db, `UPDATE "Atividade" SET empresa_id = '${E2}' WHERE id = '${ATV}'`, '23503');
    // RESTRICT: nada do que as convertidas usam sai.
    await recusa(db, `DELETE FROM "Atividade" WHERE id = '${ATV}'`, '23503', 'AtividadeApontamento_atividade_fkey');
    await recusa(db, `DELETE FROM "BemPatrimonial" WHERE id = '${C1}-b1'`, '23503', 'Atividade_bem_fkey');
    await recusa(db, `DELETE FROM "AreaPastagem" WHERE id = '${C1}-a1'`, '23503', 'Atividade_cliente_id_area_id_fkey');
    await recusa(db, `DELETE FROM "Usuario" WHERE id = '${U1}'`, '23503');
    assert.deepEqual(await db.$queryRawUnsafe(SQL_ATIVIDADES), ATIVIDADES_ESPERADAS.map((a) => ({ ...a })), 'nada foi gravado nas recusas');
    assert.deepEqual(await db.$queryRawUnsafe(SQL_APONTAMENTOS), APONTAMENTOS_ESPERADOS.map((a) => ({ ...a })));
  });

  test('AC-09 apontamento CANCELADO, de outro cliente e com o próprio contador, pelo envelope do caminho B: vira atividade CANCELADA (sem produção) e apontamento CANCELADO, os dois com o cancelamento; cada contador vai para a entidade Atividade do próprio cliente; o postcheck confere o ramo do cancelado', async () => {
    await emBancoNovo('cancelado', async (dbc, url) => {
      const ins = (sql) => dbc.$executeRawUnsafe(sql);
      await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C2}', 'acb2', 'Cliente ACB 2', now())`);
      await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES ('${C2}-e1', '${C2}', 1, 'G1', 'Granja 1', now())`);
      await ins(`INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, "updatedAt") VALUES ('${C2}-u1', '${C2}', 'Gerente', 'gerente', 'x', now())`);
      await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${C2}-g1', '${C2}', 'Plantio', now())`);
      await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, "updatedAt") VALUES ('${C2}-t1', '${C2}', 'Plantar', '${C2}-g1', 'Plantio', now())`);
      await ins(`INSERT INTO "ApontamentoAtividade" (id, cliente_id, empresa_id, numero, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id,
          grupo_atividade_nome, data_operacional, operador_usuario_id, safra_ciclo, quantidade_produzida, unidade_producao, observacao, status,
          cancelado_por_usuario_id, cancelado_em, motivo_cancelamento, criado_por_usuario_id, versao, "createdAt", "updatedAt")
        VALUES ('acb-cancelado-0001', '${C2}', '${C2}-e1', '1', '${C2}-t1', 'Plantar', '${C2}-g1', 'Plantio', '2026-11-10', '${C2}-u1', '2026/27', 7.5, 'TON',
          'lançado por engano', 'CANCELADO', '${C2}-u1', '2026-11-11 09:00:00', 'lançado em duplicidade', '${C2}-u1', 2, '2026-11-10 18:00:00', '2026-11-11 09:00:00')`);
      await ins(`INSERT INTO "EntidadeCodigoSequencia" (id, cliente_id, entidade, escopo_tipo, escopo_id, proximo_valor, "updatedAt")
        VALUES ('${C2}-seq-apont', '${C2}', 'ApontamentoAtividade', 'tenant', '${C2}', 2, now())`);
      const pre = quadro(await consulta(url, comSidLocal(blocoDoRunbook('preflight'), SID)));
      assert.equal(pre['ApontamentoAtividade: CONFIRMADO / CANCELADO (anote; o postcheck repete)'].valor, '2 / 1');
      assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);

      // Pelo envelope do caminho B (registra a migration, como em produção).
      const r = await consulta(url, comSidLocal(envelope(), SID));
      assert.equal(r.status, 0, r.stderr);
      const atividades = await dbc.$queryRawUnsafe(SQL_ATIVIDADES);
      assert.deepEqual(atividades.slice(0, 2), ATIVIDADES_ESPERADAS.map((a) => ({ ...a })), 'as do outro cliente não mudam');
      assert.deepEqual(atividades[2], {
        ...VAZIOS_ATIVIDADE, id: 'atv_acb-cancelado-0001', cliente_id: C2, empresa_id: `${C2}-e1`, numero: '1', nome: 'Plantar (apontamento nº 1)',
        tipo_atividade_id: `${C2}-t1`, tipo_atividade_nome: 'Plantar', grupo_atividade_id: `${C2}-g1`, grupo_atividade_nome: 'Plantio', area_id: null,
        setor_id: null, setor_nome: null, bem_id: null, safra_ciclo: '2026/27', centro_custo_id: null, centro_resultado_id: null,
        unidade_producao_sigla: 'TON', data_inicio: '2026-11-10', quantidade_produzida: null, status: 'CANCELADA',
        cancelada_em: new Date('2026-11-11T09:00:00.000Z'), cancelado_por_usuario_id: `${C2}-u1`, motivo_cancelamento: 'lançado em duplicidade',
        criado_por_usuario_id: `${C2}-u1`, versao: 1, createdAt: new Date('2026-11-10T18:00:00.000Z'), updatedAt: new Date('2026-11-11T09:00:00.000Z'),
      });
      const apontamentos = await dbc.$queryRawUnsafe(SQL_APONTAMENTOS);
      assert.deepEqual(apontamentos.slice(0, 2), APONTAMENTOS_ESPERADOS.map((a) => ({ ...a })));
      assert.deepEqual(apontamentos[2], {
        id: 'acb-cancelado-0001', cliente_id: C2, empresa_id: `${C2}-e1`, atividade_id: 'atv_acb-cancelado-0001', data_operacional: '2026-11-10',
        turno: null, sequencia: 1, operador_usuario_id: `${C2}-u1`, area_executada_dia: null, quantidade_produzida_dia: '7.5000',
        observacao: 'lançado por engano', origem: 'WEB', status: 'CANCELADO', cancelado_em: new Date('2026-11-11T09:00:00.000Z'),
        cancelado_por_usuario_id: `${C2}-u1`, motivo_cancelamento: 'lançado em duplicidade', criado_por_usuario_id: `${C2}-u1`, versao: 2,
        createdAt: new Date('2026-11-10T18:00:00.000Z'), updatedAt: new Date('2026-11-11T09:00:00.000Z'),
      });
      const contadores = (await dbc.$queryRawUnsafe(SQL_CONTADORES)).map((c) => [c.cliente_id, c.entidade, c.escopo_tipo, c.escopo_id, c.proximo_valor]);
      assert.deepEqual(contadores, [[C1, 'Atividade', 'tenant', C1, 3], [C1, 'Lote', 'tenant', C1, 7], [C2, 'Atividade', 'tenant', C2, 2]]);
      const pos = quadro(await consulta(url, comSidLocal(blocoDoRunbook('postcheck'), SID)));
      for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
      assert.equal(pos['Atividade ABERTA / CANCELADA (igual ao CONFIRMADO / CANCELADO do preflight)'].valor, '2 / 1');
      assert.equal(pos['AtividadeApontamento CONFIRMADO / CANCELADO (igual ao preflight)'].valor, '2 / 1');
      assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
      // Um convertido sem o filho coerente (aqui, o filho cancelado com outro motivo) é o que o postcheck pega.
      await dbc.$executeRawUnsafe(`UPDATE "AtividadeApontamento" SET motivo_cancelamento = 'outro' WHERE id = 'acb-cancelado-0001'`);
      const errado = quadro(await consulta(url, comSidLocal(blocoDoRunbook('postcheck'), SID)));
      assert.equal(errado['convertidas sem o filho coerente (id, sequência 1, sem turno, data, status, produção, nome)'].status, 'PARAR');
      assert.match(errado.VEREDITO.valor, /^PARAR/);
      // D-PROD-202, D-PROD-203, D-PROD-205, D-PROD-206 e D-PROD-207 (ver o cabeçalho): o runner aplica as EXPAND posteriores; depois o schema bate com o schema.prisma.
      const runner = await aplicarPeloRunner(url);
      assert.equal(runner.status, 0, runner.saida);
      for (const n of [NOME_LINHAS, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, NOME_MAO_OBRA, NOME_PARCEIRO, NOME_TIPO, NOME_BASE, NOME_ABASTECIMENTO]) assert.ok(runner.saida.includes(`Applying migration \`${n}\``), runner.saida);
      const diff = await migrateDiff(url);
      assert.equal(diff.status, 0, diff.saida);
    });
  });
});

describe('D-PROD-200 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
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

  test('TB-02 histórico fora de 52/0 (uma migration revertida) ou a CONTRACT anterior (D-PROD-197) ou o peso objetivo (D-PROD-198) com checksum divergente recusa antes do DDL; restaurado, nada mudou', async () => {
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    try {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /RELEASE_BLOCKED: histórico com 51 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    }
    for (const nome of ['20261114300000_tipo_atividade_defaults', NOME_PESO_OBJETIVO]) {
      const { checksum } = await um(dbB, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${nome}'`);
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${nome}'`);
      try {
        const r = await consulta(URL_B, comSidLocal(envelope(), SID));
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /RELEASE_BLOCKED: apontamento \(D-PROD-190\), itens \(D-PROD-193\), a CONTRACT anterior \(D-PROD-197\) ou o peso objetivo \(D-PROD-198\) ausentes ou com checksum divergente/, nome);
      } finally {
        await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${checksum}' WHERE migration_name = '${nome}'`);
      }
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (52 → 53, checksum = SHA-256 do arquivo, applied_steps_count 1); mesmo schema e mesmos dados que o runner; postcheck APLICADA com os números do preflight; o runner não vê esta pendente (só aplica as EXPAND da D-PROD-202 e da D-PROD-203) e depois nada pende; migrate diff vazio', async () => {
    const pre = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
    assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    assert.match(quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID))).VEREDITO.valor, /^PARAR/, 'antes de aplicar, o postcheck manda parar');

    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.equal(r.status, 0, r.stderr);
    const h = await historico(dbB);
    assert.deepEqual([h.concluidas, h.abertas, h.contract_concluida], [ANTERIORES.length + 1, 0, 1]);
    const linha = await um(dbB, `SELECT checksum, applied_steps_count::int AS passos, logs, finished_at IS NOT NULL AS concluida FROM _prisma_migrations WHERE migration_name = '${NOME_CONTRACT}'`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1, logs: null, concluida: true });

    // Os mesmos dados convertidos e o mesmo schema que o runner deixou no outro banco.
    assert.deepEqual(await dbB.$queryRawUnsafe(SQL_ATIVIDADES), ATIVIDADES_ESPERADAS.map((a) => ({ ...a })));
    assert.deepEqual(await dbB.$queryRawUnsafe(SQL_APONTAMENTOS), APONTAMENTOS_ESPERADOS.map((a) => ({ ...a })));
    const b = await retrato(dbB);
    const t = await retrato(db);
    // As da D-PROD-202 (AtividadeApontamento{Produto,ProdutoConsumoLote,Maquina}), as 3 das Formulações (D-PROD-203) e as
    // da D-PROD-207 (AtividadeApontamento{MaoObra,Servico}, Funcionario e Servico) só existem no banco do runner, aplicadas depois.
    const dasNovas = (texto) => texto.split('\n').filter((l) => /^Atividade/.test(l) && !/^AtividadeApontamento(Produto|Maquina|MaoObra|Servico)/.test(l));
    const semLinhas = (lista) => lista.split(',').filter((x) => !NOVAS_POSTERIORES.includes(x.split(':')[0])).join(',');
    assert.deepEqual([b.tabelas, dasNovas(b.constraints), dasNovas(b.indices), b.politicas], [semLinhas(t.tabelas), dasNovas(t.constraints), dasNovas(t.indices), semLinhas(t.politicas)]);

    const pos = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
    assert.equal(pos['Atividade ABERTA / CANCELADA (igual ao CONFIRMADO / CANCELADO do preflight)'].valor, pre['ApontamentoAtividade: CONFIRMADO / CANCELADO (anote; o postcheck repete)'].valor);
    assert.equal(pos['AtividadeApontamento CONFIRMADO / CANCELADO (igual ao preflight)'].valor, pre['ApontamentoAtividade: CONFIRMADO / CANCELADO (anote; o postcheck repete)'].valor);
    assert.equal(pos['contador Atividade: escopo / próximo (igual ao do ApontamentoAtividade no preflight)'].valor, pre['contador ApontamentoAtividade: escopo / próximo (anote; o postcheck repete na entidade Atividade)'].valor);

    // O registro manual vale para o Prisma: o runner não reaplica a D-PROD-200; só aplica as de nome posterior, as EXPAND
    // da D-PROD-202, da D-PROD-203, da D-PROD-205, da D-PROD-206 e da D-PROD-207 (não existiam no dia desta CONTRACT, ver o cabeçalho), e o schema bate com o
    // schema.prisma; a 2ª execução já não vê pendência.
    const runner = await aplicarPeloRunner(URL_B);
    assert.equal(runner.status, 0, runner.saida);
    for (const n of [NOME_LINHAS, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, NOME_MAO_OBRA, NOME_PARCEIRO, NOME_TIPO, NOME_BASE, NOME_ABASTECIMENTO]) assert.ok(runner.saida.includes(`Applying migration \`${n}\``), runner.saida);
    assert.ok(!runner.saida.includes(`Applying migration \`${NOME_CONTRACT}\``), runner.saida);
    const hB = await historico(dbB);
    assert.deepEqual([hB.concluidas, hB.abertas, hB.contract_concluida], [TOTAL_MIGRATIONS, 0, 1]);
    assert.deepEqual((await ordemDeAplicacao(dbB)).slice(-10), [NOME_CONTRACT, NOME_LINHAS, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, NOME_MAO_OBRA, NOME_PARCEIRO, NOME_TIPO, NOME_BASE, NOME_ABASTECIMENTO]);
    const segunda = await aplicarPeloRunner(URL_B);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    const diff = await migrateDiff(URL_B);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('TB-04 repetir o envelope recusa (migration já registrada) e nada muda', async () => {
    const antes = await retrato(dbB);
    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /RELEASE_BLOCKED: migration já registrada/);
    assert.deepEqual(await retrato(dbB), antes);
  });
});
