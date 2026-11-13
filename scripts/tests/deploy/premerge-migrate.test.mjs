/**
 * PR174-R6/R7 — allowlist EXPAND fechada (manifesto pinado + conferência
 * estrutural), modo CONTRACT fechado (D-PROD-162 e D-PROD-183), conferência
 * do histórico do alvo, barreiras do runner pré-merge e da identidade de
 * produção do cutover. Sem banco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

import {
  classificarMigrations, conferirHistoricoRemoto, sha256, MIGRATIONS_APROVADAS, migrationsDoManifestoFaltando,
  MIGRATIONS_CONTRACT_APROVADAS, conferirReleaseContract, contractsPendentes, envDoDeployMigrate,
} from '../../deploy/premergeMigrateLib.mjs';
import { conferirBackendNovo, validarOrigemProducao } from '../../ops/cutoverRebanhoLib.mjs';

const NOMES = Object.keys(MIGRATIONS_APROVADAS);
const ler = (n) => ({ nome: n, sql: readFileSync(`backend/prisma/migrations/${n}/migration.sql`, 'utf8') });
const BASE = `CREATE TABLE "Nova" ("id" TEXT NOT NULL, "cliente_id" VARCHAR(64) NOT NULL);\n`;
/** Classifica SQL sintético com manifesto próprio (só para testar a conferência estrutural). */
const classificar = (sql, extra = {}) => classificarMigrations([{ nome: 'x', sql }], { manifesto: { x: sha256(sql) }, ...extra });

/** D-PROD-162 — a primeira migration CONTRACT aprovada (a segunda é a D-PROD-183, logo abaixo). */
const NOME_C = '20261110300000_patrimonio_simplifica';
const SQL_C = readFileSync(`backend/prisma/migrations/${NOME_C}/migration.sql`, 'utf8');
const DROP_C = ['AbastecimentoBemConsumoLote', 'AbastecimentoBem', 'ConversaoCombustivelProduto', 'TipoCombustivelProduto', 'TanqueBemCombustivel', 'TanqueBem', 'MedicaoBem', 'BemPatrimonial', 'TipoPatrimonialPerfil', 'TipoPatrimonial', 'FamiliaPatrimonial', 'PerfilMedicao', 'TipoCombustivel'];
const NOVAS_C = ['AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'BemPatrimonial', 'FamiliaPatrimonial', 'TanqueBem', 'TanqueBemProduto', 'TipoPatrimonial'];
const ALARGADAS_C = ['OperacaoFinanceiraItem.OperacaoFinanceiraItem_unidade_check', 'OperacaoFinanceiraItem.OperacaoFinanceiraItem_forma_check'];
const CONTRACT_C = { migration: NOME_C, decisao: 'D-PROD-162', tabelas_removidas: DROP_C, constraints_alargadas: ALARGADAS_C, colunas_removidas: [] };
/** D-PROD-183 — a segunda migration CONTRACT aprovada: DROP COLUMN das 4 colunas dormentes de TipoTarefa (sem DROP TABLE, sem tabela nova). */
const NOME_T = '20261113200000_tipo_tarefa_drop_colunas';
const SQL_T = readFileSync(`backend/prisma/migrations/${NOME_T}/migration.sql`, 'utf8');
const COLUNAS_T = ['exige_area', 'pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento'];
const REMOVIDAS_T = COLUNAS_T.map((c) => `TipoTarefa.${c}`);
const ALTER_T = COLUNAS_T.map((c) => `ALTER TABLE "TipoTarefa" DROP COLUMN "${c}"`);
const CONTRACT_T = { migration: NOME_T, decisao: 'D-PROD-183', tabelas_removidas: [], constraints_alargadas: [], colunas_removidas: REMOVIDAS_T };
/** Variação do arquivo CONTRACT `nome` sob o MESMO nome, com manifesto sintético: o checksum passa e só a estrutura decide. */
const classificarContractDe = (nome) => (sql, extra = {}) => classificarMigrations([{ nome, sql }], { manifesto: { [nome]: sha256(sql) }, ...extra });
const classificarContract = classificarContractDe(NOME_C);
const classificarContractT = classificarContractDe(NOME_T);
const codigos = (c) => [...new Set(c.violacoes.map((v) => v.codigo))].sort();
/** Troca um trecho que tem de aparecer EXATAMENTE uma vez (senão o teste não prova o que diz). */
const trocar = (sql, de, para) => {
  assert.equal(sql.split(de).length, 2, `trecho deveria aparecer 1 vez: ${de.slice(0, 60)}`);
  return sql.replace(de, () => para);
};

test('B1: as migrations do manifesto passam (pinadas + estrutura): só tabelas novas, LancamentoTarefa.posicao_id, Empresa.fuso_horario (D-PROD-122), as épocas de sessão (D-PROD-143) e a troca obrigatória (D-PROD-144) anuláveis; Gestão P1 (D-PROD-146), P2 (D-PROD-153) e P3-01 (D-PROD-155) só com tabelas novas; P3-02 (D-PROD-156) e P3-03 (D-PROD-158) com tabela nova; Patrimônio P1-01 (D-PROD-157) e P1-02 (D-PROD-159) só com tabelas novas; Patrimônio SIMPLIFICA-01 (D-PROD-162) pelo modo CONTRACT fechado; TipoAtividade (D-PROD-182) só com tabela nova; Tipo de Tarefa sem colunas (D-PROD-183) pelo modo CONTRACT fechado; CADESTACOES (D-PROD-188) só com tabela nova', () => {
  const c = classificarMigrations(NOMES.map(ler));
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false, 'com o CONTRACT no lote, a release não é EXPAND puro');
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, [
    'AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'BemPatrimonial', 'CADESTACOES', 'CentroCusto', 'CentroCustoResultado', 'CentroResultado',
    'ConversaoCombustivelProduto', 'EventoRebanho', 'FamiliaPatrimonial',
    'LiquidacaoFinanceira', 'LiquidacaoFinanceiraEstorno', 'MedicaoBem', 'NaturezaFinanceira', 'OperacaoFinanceira', 'OperacaoFinanceiraConsumoLote',
    'OperacaoFinanceiraEvento', 'OperacaoFinanceiraItem', 'OperacaoFinanceiraItemRateio', 'OperacaoFinanceiraRateio', 'PartidaRebanho', 'PerfilFinanceiroEmpresa', 'PerfilMedicao',
    'PesoRebanho', 'PosicaoRebanho', 'RebanhoLedgerAtivacao', 'TanqueBem', 'TanqueBemCombustivel', 'TanqueBemProduto', 'TipoAtividade', 'TipoCombustivel',
    'TipoCombustivelProduto', 'TipoPatrimonial', 'TipoPatrimonialPerfil', 'TituloFinanceiro',
  ]);
  assert.deepEqual([...c.colunas_novas_em_tabelas_antigas].sort(), ['Cliente.sessao_epoca', 'Empresa.fuso_horario', 'LancamentoTarefa.posicao_id', 'Usuario.sessao_epoca', 'Usuario.troca_senha_pendente']);
  // As duas CONTRACT, na ordem do manifesto: as colunas removidas de TipoTarefa não viram "coluna nova em tabela antiga".
  assert.deepEqual(c.contract, [CONTRACT_C, CONTRACT_T]);
});

test('B1f (D-PROD-162): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, exatamente as 7 tabelas do formato novo, nenhuma coluna em tabela antiga, as 13 removidas na ordem e os 2 CHECKs alargados', () => {
  const c = classificarMigrations([ler(NOME_C)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, NOVAS_C);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [{ migration: NOME_C, decisao: 'D-PROD-162', tabelas_removidas: DROP_C, constraints_alargadas: ALARGADAS_C, colunas_removidas: [] }]);
  // O arquivo é o ensaiado (§0 do contrato), byte a byte.
  assert.equal(sha256(SQL_C), '787d6d118939c6eca4e3c3f45bf94a4f94d1f1625cbfb2ea2102b190ad944222');
  assert.equal(MIGRATIONS_APROVADAS[NOME_C], sha256(SQL_C));
});

test('B8-0 (D-PROD-162/D-PROD-183): MIGRATIONS_CONTRACT_APROVADAS é fechado e tem EXATAMENTE as duas entradas, na ordem; o conteúdo pinado da D-PROD-162 é o ensaiado', () => {
  assert.deepEqual(Object.keys(MIGRATIONS_CONTRACT_APROVADAS), [NOME_C, NOME_T]);
  assert.equal(Object.isFrozen(MIGRATIONS_CONTRACT_APROVADAS), true);
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_C];
  assert.equal(Object.isFrozen(k), true);
  assert.equal(k.decisao, 'D-PROD-162');
  assert.equal(k.guarda_sha256, '28d6c422968d961bbecd40459a7e6a337f36b9d66c121982f9c295065c149046');
  assert.deepEqual(k.drop, DROP_C);
  assert.deepEqual(k.literais_guarda, ['CONFIRMADO']);
  assert.equal(k.alter_antigas.length, 4);
  // Hashes das 4 instruções normalizadas, conferidos à parte no contrato (§0).
  const pontas = [['87133e46', '64be'], ['9c045859', 'dc4f'], ['0cad95f9', 'c9c7'], ['63e8e499', '413c']];
  k.alter_antigas.forEach((a, i) => {
    const h = sha256(a);
    assert.ok(h.startsWith(pontas[i][0]) && h.endsWith(pontas[i][1]), `alter_antigas[${i}] = ${h}`);
    assert.ok(a.startsWith('ALTER TABLE "OperacaoFinanceiraItem" '), a);
  });
  // Quem entra em MIGRATIONS_CONTRACT_APROVADAS também precisa estar no manifesto (checksum pinado).
  for (const n of Object.keys(MIGRATIONS_CONTRACT_APROVADAS)) assert.ok(n in MIGRATIONS_APROVADAS, n);
});

test('B8a–B8d (D-PROD-162): os 13 DROP são EXATAMENTE os do contrato, na ordem — CASCADE, troca de ordem, outra tabela ou IF EXISTS → CONTRACT_DROP_FORA_DO_CONTRATO', () => {
  const casos = {
    B8a: trocar(SQL_C, 'DROP TABLE "TanqueBem";', 'DROP TABLE "TanqueBem" CASCADE;'),
    B8b: trocar(SQL_C, 'DROP TABLE "MedicaoBem";\nDROP TABLE "BemPatrimonial";', 'DROP TABLE "BemPatrimonial";\nDROP TABLE "MedicaoBem";'),
    B8c: trocar(SQL_C, 'DROP TABLE "MedicaoBem";', 'DROP TABLE "Produto";'),
    B8d: trocar(SQL_C, 'DROP TABLE "TipoCombustivel";', 'DROP TABLE IF EXISTS "TipoCombustivel";'),
    restrict: trocar(SQL_C, 'DROP TABLE "TanqueBem";', 'DROP TABLE "TanqueBem" RESTRICT;'),
    duas: trocar(SQL_C, 'DROP TABLE "MedicaoBem";\nDROP TABLE "BemPatrimonial";', 'DROP TABLE "MedicaoBem", "BemPatrimonial";'),
  };
  for (const [caso, sql] of Object.entries(casos)) {
    const c = classificarContract(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_DROP_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, /^posição \d+: esperado /, caso);
  }
  assert.match(classificarContract(casos.B8c).violacoes[0].detalhe, /posição 6: esperado DROP TABLE "MedicaoBem"/);
});

test('B8e (D-PROD-162): um DROP a mais, depois do recorte, cai no caminho EXPAND do resto → SQL_NAO_RECONHECIDO', () => {
  const c = classificarContract(`${SQL_C}\nDROP TABLE "TanqueBemProduto";\n`);
  assert.deepEqual(codigos(c), ['SQL_NAO_RECONHECIDO']);
});

test('B8f–B8h (D-PROD-162): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE', () => {
  const alterada = classificarContract(trocar(SQL_C, 'IF n_confirmados > 0 THEN', 'IF n_confirmados > 1 THEN'));
  assert.deepEqual(codigos(alterada), ['CONTRACT_GUARDA_NAO_RECONHECIDA']);
  const inicio = SQL_C.indexOf('-- 1. Guarda');
  const fim = SQL_C.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_C.slice(0, inicio) + SQL_C.slice(fim);
  assert.ok(!semGuarda.includes('n_confirmados'));
  assert.deepEqual(codigos(classificarContract(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  const antes = classificarContract(`CREATE INDEX "x_idx" ON "Produto"("id");\n${SQL_C}`);
  assert.deepEqual(codigos(antes), ['CONTRACT_GUARDA_AUSENTE']);
});

test('B8i (D-PROD-162): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado', () => {
  const c = classificarMigrations([{ nome: '20261110300001_outro_nome', sql: SQL_C }], { manifesto: { '20261110300001_outro_nome': sha256(SQL_C) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  for (const codigo of ['DO_NAO_RECONHECIDO', 'DO_EM_TABELA_ANTIGA', 'SQL_NAO_RECONHECIDO', 'ALTER_EM_TABELA_ANTIGA']) {
    assert.ok(codigos(c).includes(codigo), `${codigo} ∉ ${codigos(c)}`);
  }
  // E um contrato vazio (opção) faz o nome real seguir o EXPAND também: nada é aprovado por fora da lista fechada.
  assert.equal(classificarMigrations([ler(NOME_C)], { contratos: {} }).ok, false);
});

test('B8j (D-PROD-162): o resto continua sendo EXPAND — DELETE, TRUNCATE e coluna NOT NULL em tabela antiga recusados como sempre', () => {
  const casos = {
    'DELETE FROM "Produto";': 'SQL_NAO_RECONHECIDO',
    'TRUNCATE "Lote";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "Produto" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0;': 'ALTER_EM_TABELA_ANTIGA',
    'UPDATE "Produto" SET "estoque_atual" = 0;': 'SQL_NAO_RECONHECIDO',
    'CREATE UNIQUE INDEX "Produto_cliente_id_empresa_id_id_key" ON "Produto"("cliente_id", "empresa_id", "id");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) assert.deepEqual(codigos(classificarContract(`${SQL_C}\n${ddl}\n`)), [codigo], ddl);
});

test('B8k (D-PROD-162): 1 byte a mais no arquivo pinado → MIGRATION_CHECKSUM_DIVERGENTE', () => {
  assert.deepEqual(codigos(classificarMigrations([{ nome: NOME_C, sql: `${SQL_C}\n` }])), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B8l (D-PROD-162): guarda pinada que cita tabela antiga (contrato sintético) → DO_EM_TABELA_ANTIGA', () => {
  const corpo = " BEGIN PERFORM count(*) FROM public.\"Produto\"; RAISE NOTICE 'Produto'; END ";
  const sql = `DO $$${corpo}$$;\nDROP TABLE "Velha";\nCREATE TABLE "Nova" ("id" TEXT NOT NULL);\n`;
  const contratos = { x: { decisao: 'D-PROD-999', guarda_sha256: sha256(corpo.replace(/\s+/g, ' ').trim()), drop: ['Velha'], literais_guarda: [], alter_antigas: [] } };
  const c = classificarMigrations([{ nome: 'x', sql }], { manifesto: { x: sha256(sql) }, contratos });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Produto'));
  // Controle positivo: a mesma guarda citando só a tabela removida e a nova passa.
  const corpoOk = " BEGIN PERFORM count(*) FROM public.\"Velha\"; RAISE NOTICE 'Nova'; END ";
  const sqlOk = `DO $$${corpoOk}$$;\nDROP TABLE "Velha";\nCREATE TABLE "Nova" ("id" TEXT NOT NULL);\n`;
  const ok = classificarMigrations([{ nome: 'x', sql: sqlOk }], { manifesto: { x: sha256(sqlOk) }, contratos: { x: { ...contratos.x, guarda_sha256: sha256(corpoOk.replace(/\s+/g, ' ').trim()) } } });
  assert.deepEqual(ok.violacoes, []);
  assert.deepEqual(ok.contract, [{ migration: 'x', decisao: 'D-PROD-999', tabelas_removidas: ['Velha'], constraints_alargadas: [], colunas_removidas: [] }]);
});

test('B8m (D-PROD-162): DO de RLS que cita tabela antiga → DO_NAO_RECONHECIDO + DO_EM_TABELA_ANTIGA', () => {
  const sql = trocar(SQL_C, "ARRAY['AbastecimentoBem','AbastecimentoBemConsumoLote'", "ARRAY['Produto','AbastecimentoBem','AbastecimentoBemConsumoLote'");
  assert.deepEqual(codigos(classificarContract(sql)), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
});

test('B8n–B8r (D-PROD-162): os 4 alargamentos de OperacaoFinanceiraItem são EXATAMENTE os pinados, na ordem, logo depois dos DROP', () => {
  const ALTER1 = 'ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_unidade_check";';
  const casos = {
    B8n: trocar(SQL_C, ALTER1, 'ALTER TABLE "OperacaoFinanceira" DROP CONSTRAINT "OperacaoFinanceiraItem_unidade_check";'),
    B8o: trocar(SQL_C, "'SACO', 'UN', 'L')", "'SACO', 'UN', 'L', 'M3')"),
    B8p: trocar(SQL_C, '"fator_kg" IS NOT NULL AND "fator_kg" > 0 AND', '"fator_kg" IS NOT NULL AND "fator_kg" >= 0 AND'),
  };
  const ini = SQL_C.indexOf(ALTER1);
  const fimAlarga = SQL_C.indexOf('-- 4. Expansão');
  casos.B8q = SQL_C.slice(0, ini) + SQL_C.slice(fimAlarga);
  casos.troca = SQL_C.slice(0, ini) + SQL_C.slice(ini, fimAlarga).split('\n').filter(Boolean).reverse().join('\n') + '\n\n' + SQL_C.slice(fimAlarga);
  for (const [caso, sql] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_C, caso);
    const c = classificarContract(sql);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, /^posição \d: esperado /, caso);
  }
  assert.match(classificarContract(casos.B8q).violacoes[0].detalhe, /^posição 0: /);
  assert.match(classificarContract(casos.B8p).violacoes[0].detalhe, /^posição 3: /);
  // B8r: uma 5ª instrução na tabela antiga, depois das 4, cai no caminho EXPAND do resto.
  const quinta = trocar(SQL_C, '-- 4. Expansão', 'ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "x_check" CHECK ("quantidade" > 0);\n\n-- 4. Expansão');
  assert.deepEqual(codigos(classificarContract(quinta)), ['ALTER_EM_TABELA_ANTIGA']);
});

test('B10 (D-PROD-162): conferirReleaseContract — CONTRACT isolado e autorizado pela decisão exata; --contract sem CONTRACT é inesperado', () => {
  const comC = classificarMigrations([ler(NOME_C)]);
  const semC = classificarMigrations([ler('20261110200000_patrimonio_p1_02_abastecimentos')]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_C], classificacao: comC, autorizacao: 'D-PROD-162' }), { ok: true, codigo: null });
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_C, '20261110300001_outra'], classificacao: comC, autorizacao: 'D-PROD-162' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  for (const autorizacao of [undefined, '', 'D-PROD-999', 'd-prod-162', ' D-PROD-162']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_C], classificacao: comC, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  assert.deepEqual(conferirReleaseContract({ nomesNovas: ['20261110200000_patrimonio_p1_02_abastecimentos'], classificacao: semC, autorizacao: 'D-PROD-162' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [], classificacao: semC, autorizacao: undefined }), { ok: true, codigo: null });
});

test('B11a (D-PROD-162): contractsPendentes — CONTRACT local sem linha concluída e não revertida no alvo é pendente; concluído não é', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = ['20261110200000_patrimonio_p1_02_abastecimentos', NOME_C];
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }), [{ nome: NOME_C, decisao: 'D-PROD-162' }]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C, { finished_at: null })] }), [{ nome: NOME_C, decisao: 'D-PROD-162' }], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C, { rolled_back_at: new Date() })] }), [{ nome: NOME_C, decisao: 'D-PROD-162' }], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C, { rolled_back_at: new Date() }), linha(NOME_C)] }), []);
  assert.deepEqual(contractsPendentes({ locais: ['20261110200000_patrimonio_p1_02_abastecimentos'], linhas: [] }), [], 'sem a pasta local não há o que aplicar');
});

test('B11b (D-PROD-162): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO só vai ao subprocesso com CONTRACT e --contract conferido; nunca herdado', () => {
  const comC = classificarMigrations([ler(NOME_C)]);
  const semC = classificarMigrations([ler('20261110200000_patrimonio_p1_02_abastecimentos')]);
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: base, classificacao: comC, autorizacao: 'D-PROD-162' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-162');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(a.PATH, '/bin');
  for (const [classificacao, autorizacao] of [[semC, undefined], [semC, 'D-PROD-162'], [comC, undefined], [comC, 'D-PROD-999']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, String(autorizacao));
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
  assert.equal(base.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
});

test('B12a (D-PROD-183): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, nenhuma tabela nova, nenhuma coluna em tabela antiga, nenhuma tabela removida e as 4 colunas de TipoTarefa removidas na ordem', () => {
  const c = classificarMigrations([ler(NOME_T)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_T]);
  // O arquivo é o ensaiado (validado à mão no PG 16), byte a byte.
  assert.equal(sha256(SQL_T), '47409bb1a7d371efe89fffba753ae292aec6f95e1ba7845d35dff74371136c17');
  assert.equal(MIGRATIONS_APROVADAS[NOME_T], sha256(SQL_T));
});

test('B12b (D-PROD-183): a entrada de MIGRATIONS_CONTRACT_APROVADAS é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP TABLE, literal TipoTarefa e os 4 DROP COLUMN exatos', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_T];
  assert.ok(NOME_T in MIGRATIONS_APROVADAS, 'quem é CONTRACT também está no manifesto (checksum pinado)');
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-183');
  assert.equal(k.guarda_sha256, '35e1a698b0567bf07f9e99943f7181a3a6ee8b1e03ea2ff423a939e755984878');
  assert.deepEqual(k.drop, []);
  assert.deepEqual(k.literais_guarda, ['TipoTarefa']);
  assert.deepEqual(k.alter_antigas, [
    'ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area"',
    'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_produto"',
    'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_maquina"',
    'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_implemento"',
  ]);
  // O hash pinado é o do corpo da guarda do arquivo (sem comentários, espaços normalizados) e cada texto pinado está nele uma vez.
  const corpo = SQL_T.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1];
  assert.equal(sha256(corpo.replace(/\s+/g, ' ').trim()), k.guarda_sha256);
  for (const a of k.alter_antigas) assert.equal(SQL_T.split(`${a};`).length, 2, a);
});

test('B12c (D-PROD-183): os 4 DROP COLUMN são EXATAMENTE os do contrato, na ordem — CASCADE, RESTRICT, IF EXISTS, troca de ordem, outra coluna, outra tabela, um faltando ou os 4 numa instrução só → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const [A1, A2, A3, A4] = ALTER_T.map((a) => `${a};`);
  const casos = {
    cascade: trocar(SQL_T, A1, A1.replace(';', ' CASCADE;')),
    restrict: trocar(SQL_T, A4, A4.replace(';', ' RESTRICT;')),
    ifExists: trocar(SQL_T, A3, 'ALTER TABLE "TipoTarefa" DROP COLUMN IF EXISTS "pode_ter_maquina";'),
    ordem: trocar(SQL_T, `${A2}\n${A3}`, `${A3}\n${A2}`),
    outraColuna: trocar(SQL_T, A2, 'ALTER TABLE "TipoTarefa" DROP COLUMN "ativo";'),
    outraTabela: trocar(SQL_T, A1, 'ALTER TABLE "TipoAtividade" DROP COLUMN "exige_area";'),
    faltando: trocar(SQL_T, `${A4}\n`, ''),
    numaSo: trocar(SQL_T, `${A1}\n${A2}\n${A3}\n${A4}`, `ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area", DROP COLUMN "pode_ter_produto", DROP COLUMN "pode_ter_maquina", DROP COLUMN "pode_ter_implemento";`),
  };
  for (const [caso, sql] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_T, caso);
    const c = classificarContractT(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, /^posição \d: esperado ALTER TABLE "TipoTarefa" DROP/, caso);
  }
  assert.match(classificarContractT(casos.cascade).violacoes[0].detalhe, /^posição 0: /);
  assert.match(classificarContractT(casos.outraColuna).violacoes[0].detalhe, /^posição 1: /);
  assert.match(classificarContractT(casos.ordem).violacoes[0].detalhe, /^posição 1: /);
  assert.match(classificarContractT(casos.faltando).violacoes[0].detalhe, /^posição 3: /);
});

test('B12d (D-PROD-183): o que vem depois dos 4 DROP COLUMN cai no caminho EXPAND do resto — 5º DROP COLUMN, coluna NOT NULL, UNIQUE, DELETE e DROP TABLE recusados; tabela nova aceita como sempre', () => {
  const casos = {
    'ALTER TABLE "TipoTarefa" DROP COLUMN "descricao";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoTarefa" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT false;': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "TipoTarefa_cliente_id_nome_tipo_key" ON "TipoTarefa"("cliente_id", "nome_tipo");': 'UNIQUE_EM_TABELA_ANTIGA',
    'DELETE FROM "TipoTarefa";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "TipoTarefa";': 'SQL_NAO_RECONHECIDO',
    'UPDATE "TipoTarefa" SET "ativo" = false;': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) assert.deepEqual(codigos(classificarContractT(`${SQL_T}\n${ddl}\n`)), [codigo], ddl);
  // Controle positivo: CREATE TABLE e índice não-único depois do recorte são o EXPAND de sempre (o checksum pinado é que prende o arquivo real).
  const comNova = classificarContractT(`${SQL_T}\n${BASE}CREATE INDEX "Nova_cliente_id_idx" ON "Nova"("cliente_id");\n`);
  assert.deepEqual(comNova.violacoes, []);
  assert.deepEqual(comNova.tabelas_novas, ['Nova']);
  assert.deepEqual(comNova.contract, [CONTRACT_T]);
});

test('B12e (D-PROD-183): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE', () => {
  const alterada = classificarContractT(trocar(SQL_T, 'IF n_colunas <> 4 THEN', 'IF n_colunas <> 3 THEN'));
  assert.deepEqual(codigos(alterada), ['CONTRACT_GUARDA_NAO_RECONHECIDA']);
  // Sem exigir a impressão quando há true, a guarda perde a razão de ser: também não é reconhecida.
  const semImpressao = classificarContractT(trocar(SQL_T, 'IF (total > 0 OR esperada IS NOT NULL) AND', 'IF esperada IS NOT NULL AND'));
  assert.deepEqual(codigos(semImpressao), ['CONTRACT_GUARDA_NAO_RECONHECIDA']);
  const inicio = SQL_T.indexOf('-- 1. Guarda');
  const fim = SQL_T.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_T.slice(0, inicio) + SQL_T.slice(fim);
  assert.ok(!semGuarda.includes('n_colunas'));
  assert.deepEqual(codigos(classificarContractT(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  const antes = classificarContractT(`CREATE INDEX "x_idx" ON "TipoTarefa"("id");\n${SQL_T}`);
  assert.deepEqual(codigos(antes), ['CONTRACT_GUARDA_AUSENTE']);
});

test('B12f (D-PROD-183): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada (ou com o contrato da D-PROD-162) o nome real é recusado', () => {
  const outro = '20261113200001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_T }], { manifesto: { [outro]: sha256(SQL_T) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(codigos(c), ['ALTER_EM_TABELA_ANTIGA', 'DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  assert.equal(c.violacoes.filter((x) => x.codigo === 'ALTER_EM_TABELA_ANTIGA').length, 4, 'cada DROP COLUMN é recusado');
  // Contrato vazio, ou só a entrada da D-PROD-162: nada é aprovado por fora da lista fechada.
  assert.equal(classificarMigrations([ler(NOME_T)], { contratos: {} }).ok, false);
  assert.equal(classificarMigrations([ler(NOME_T)], { contratos: { [NOME_C]: MIGRATIONS_CONTRACT_APROVADAS[NOME_C] } }).ok, false);
  // O contrato de um nome não serve ao SQL do outro: guarda e DROP TABLE da D-PROD-162 não batem com o arquivo da D-PROD-183.
  assert.deepEqual(codigos(classificarContract(SQL_T)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
});

test('B12g (D-PROD-183): conferirReleaseContract — a D-PROD-183 sozinha só com --contract D-PROD-183 exato; junto com outra migration ou com a D-PROD-162 é CONTRACT_NAO_ISOLADO; --contract D-PROD-183 sem CONTRACT é inesperado', () => {
  const comT = classificarMigrations([ler(NOME_T)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_T], classificacao: comT, autorizacao: 'D-PROD-183' }), { ok: true, codigo: null });
  // Como no B10: sem --contract (undefined) também é não autorizado, porque a release tem CONTRACT.
  for (const autorizacao of ['D-PROD-162', '', undefined, null, 'd-prod-183', ' D-PROD-183', 'D-PROD-183 ']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_T], classificacao: comT, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  const ATIV = '20261113100000_tipo_atividade_cadastro';
  const comOutra = classificarMigrations([ler(ATIV), ler(NOME_T)]);
  assert.deepEqual(comOutra.violacoes, []);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [ATIV, NOME_T], classificacao: comOutra, autorizacao: 'D-PROD-183' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  // As DUAS CONTRACT na mesma release: nenhuma autorização isola (a variável do runner oficial tem um só valor).
  const duas = classificarMigrations([ler(NOME_C), ler(NOME_T)]);
  assert.deepEqual(duas.violacoes, []);
  assert.equal(duas.contract.length, 2);
  for (const autorizacao of ['D-PROD-162', 'D-PROD-183', undefined]) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_C, NOME_T], classificacao: duas, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, String(autorizacao));
  }
  const semC = classificarMigrations([ler(ATIV)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [ATIV], classificacao: semC, autorizacao: 'D-PROD-183' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B12h (D-PROD-183): contractsPendentes com as duas CONTRACT locais — a D-PROD-162 concluída deixa só a D-PROD-183 pendente; histórico vazio, as duas; ambas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = ['20261110200000_patrimonio_p1_02_abastecimentos', NOME_C, '20261113100000_tipo_atividade_cadastro', NOME_T];
  const PEND_C = { nome: NOME_C, decisao: 'D-PROD-162' };
  const PEND_T = { nome: NOME_T, decisao: 'D-PROD-183' };
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C)] }), [PEND_T], 'produção hoje: D-PROD-162 concluída');
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }), [PEND_C, PEND_T]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C), linha(NOME_T)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C), linha(NOME_T, { finished_at: null })] }), [PEND_T], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C), linha(NOME_T, { rolled_back_at: new Date() })] }), [PEND_T], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_T), linhas: [linha(NOME_C)] }), [], 'sem a pasta local não há o que aplicar');
});

test('B12i (D-PROD-183): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-183 só com a D-PROD-183 sozinha e --contract D-PROD-183; a decisão da D-PROD-162 ou as duas CONTRACT juntas não autorizam', () => {
  const comT = classificarMigrations([ler(NOME_T)]);
  const duas = classificarMigrations([ler(NOME_C), ler(NOME_T)]);
  // Positivo com base 'herdado': prova que a função GRAVA a decisão (não só deixa passar o valor herdado).
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comT, autorizacao: 'D-PROD-183' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-183');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
  // Negativos com base JÁ igual à decisão: prova que ela nunca é herdada.
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-183' };
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  for (const [classificacao, autorizacao] of [[comT, 'D-PROD-162'], [comT, undefined], [comT, 'd-prod-183'], [duas, 'D-PROD-162'], [duas, 'D-PROD-183']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B1b: P3-02 (D-PROD-156) classificada SOZINHA, como na release (a P3-01 já está na main): só OperacaoFinanceira.rateio_escopo anulável numa tabela antiga e a tabela nova do rateio por item', () => {
  const c = classificarMigrations([ler('20261109200000_gestao_p3_02_rateio_por_item')]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, ['OperacaoFinanceiraItemRateio']);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, ['OperacaoFinanceira.rateio_escopo']);
  // Sem a tabela da P3-01 como "nova", um CHECK na coluna nova da tabela antiga é recusado.
  const comCheck = `${ler('20261109200000_gestao_p3_02_rateio_por_item').sql}\nALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "x" CHECK ("rateio_escopo" IN ('GERAL', 'POR_ITEM'));`;
  assert.ok(classificar(comCheck).violacoes.some((v) => v.codigo === 'ALTER_EM_TABELA_ANTIGA'));
});

test('B1d: P3-03 (D-PROD-158) classificada SOZINHA, como na release (P3-01 e P3-02 já estão na main; aplicada em produção antes do Patrimônio): só OperacaoFinanceira.excluido_em/retificado_em anuláveis numa tabela antiga e a tabela nova de eventos', () => {
  const c = classificarMigrations([ler('20261109300000_gestao_p3_03_editar_excluir')]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, ['OperacaoFinanceiraEvento']);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, ['OperacaoFinanceira.excluido_em', 'OperacaoFinanceira.retificado_em']);
  // Sem a tabela da P3-01 como "nova": NOT NULL, DEFAULT ou CHECK nas colunas novas da tabela antiga são recusados.
  const base = ler('20261109300000_gestao_p3_03_editar_excluir').sql;
  const casos = [
    `${base}\nALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "x" CHECK ("excluido_em" IS NULL OR "status" = 'CANCELADO');`,
    base.replace('ADD COLUMN "excluido_em" TIMESTAMP(3);', 'ADD COLUMN "excluido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;'),
    `${base}\nUPDATE "OperacaoFinanceira" SET "retificado_em" = now();`,
  ];
  for (const sql of casos) assert.ok(classificar(sql).violacoes.length > 0, sql.slice(-120));
});

test('B1c: Patrimônio P1-01 (D-PROD-157) classificado SOZINHO, como na release (a P3-02 já está na main): expand, exatamente as 10 tabelas novas (com o vínculo combustível × produto da R2), nenhuma coluna nem constraint em tabela antiga (Produto intacto)', () => {
  const m = ler('20261110100000_patrimonio_p1_01_cadastros');
  const c = classificarMigrations([m]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, [
    'BemPatrimonial', 'FamiliaPatrimonial', 'MedicaoBem', 'PerfilMedicao', 'TanqueBem', 'TanqueBemCombustivel', 'TipoCombustivel',
    'TipoCombustivelProduto', 'TipoPatrimonial', 'TipoPatrimonialPerfil',
  ]);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  // A coerência Produto.empresa_id = vínculo.empresa_id NÃO vira unique em Produto (tabela antiga): seria recusado.
  const comUnique = `${m.sql}\nCREATE UNIQUE INDEX "Produto_cliente_id_empresa_id_id_key" ON "Produto"("cliente_id", "empresa_id", "id");`;
  assert.ok(classificar(comUnique).violacoes.some((v) => v.codigo === 'UNIQUE_EM_TABELA_ANTIGA'));
});

test('B1e: Patrimônio P1-02 (D-PROD-159) classificado SOZINHO, como na release (a P1-01 já está na main): expand, exatamente as 3 tabelas novas de abastecimento, nenhuma coluna nem constraint em tabela antiga (BemPatrimonial e MovimentacaoEstoque intactos)', () => {
  const m = ler('20261110200000_patrimonio_p1_02_abastecimentos');
  const c = classificarMigrations([m]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, ['AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'ConversaoCombustivelProduto']);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  // A leitura do medidor vive na tabela nova: aceitar 'ABASTECIMENTO' no CHECK do bem, um unique de empresa no bem
  // ou uma coluna DATE no movimento seriam DDL em tabela antiga e são recusados.
  const casos = {
    [`ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_medidor_origem_abastecimento_check" CHECK ("medidor_origem" IS NULL OR "medidor_origem" IN ('CADASTRO_INICIAL', 'AJUSTE_CADASTRO', 'ABASTECIMENTO'));`]: 'ALTER_EM_TABELA_ANTIGA',
    [`ALTER TABLE "BemPatrimonial" DROP CONSTRAINT "BemPatrimonial_medidor_origem_check";`]: 'ALTER_EM_TABELA_ANTIGA',
    [`CREATE UNIQUE INDEX "BemPatrimonial_cliente_id_empresa_id_id_key" ON "BemPatrimonial"("cliente_id", "empresa_id", "id");`]: 'UNIQUE_EM_TABELA_ANTIGA',
    [`ALTER TABLE "MovimentacaoEstoque" ADD COLUMN "abastecimento_data" DATE;`]: 'ALTER_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const r = classificar(`${m.sql}\n${ddl}\n`);
    assert.equal(r.expand, false, ddl);
    assert.deepEqual(r.violacoes.map((v) => v.codigo), [codigo], ddl);
  }
  // O bloco DO pinado não pode citar tabela antiga: incluir 'TanqueBem' na lista muda o hash e cita tabela antiga.
  const doComAntiga = m.sql.replace("ARRAY['AbastecimentoBem',", "ARRAY['TanqueBem','AbastecimentoBem',");
  assert.notEqual(doComAntiga, m.sql);
  assert.deepEqual(classificar(doComAntiga).violacoes.map((v) => v.codigo).sort(), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // 1 byte a mais no arquivo pinado → checksum divergente.
  assert.deepEqual(classificarMigrations([{ ...m, sql: `${m.sql}\n` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B2: padrão = RECUSAR — cada caso negativo é violação com código estável', () => {
  const casos = {
    'CREATE OR REPLACE FUNCTION f() RETURNS int AS $f$ SELECT 1 $f$ LANGUAGE sql;': 'SQL_NAO_RECONHECIDO',
    'CREATE OR REPLACE VIEW "v" AS SELECT 1;': 'SQL_NAO_RECONHECIDO',
    'GRANT ALL ON TABLE "Lote" TO anon;': 'SQL_NAO_RECONHECIDO',
    'REVOKE ALL ON TABLE "Usuario" FROM maike_vercel;': 'SQL_NAO_RECONHECIDO',
    'CREATE TRIGGER t AFTER INSERT ON "Lote" FOR EACH ROW EXECUTE FUNCTION f();': 'SQL_NAO_RECONHECIDO',
    'COPY "Lote" FROM \'/tmp/x\';': 'SQL_NAO_RECONHECIDO',
    'INSERT INTO "Lote" ("id") VALUES (\'x\');': 'SQL_NAO_RECONHECIDO',
    'SELECT pg_terminate_backend(1);': 'SQL_NAO_RECONHECIDO',
    "DO $$ BEGIN EXECUTE 'DELETE FROM \"Lote\"'; END $$;": 'DO_NAO_RECONHECIDO',
    'ALTER TABLE "Lote" DROP COLUMN "x";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ALTER COLUMN "a" SET NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" RENAME COLUMN "a" TO "b";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ADD COLUMN "z" INTEGER NOT NULL DEFAULT 0;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ADD CONSTRAINT "c" CHECK ("x" > 0);': 'ALTER_EM_TABELA_ANTIGA',
    'TRUNCATE "Lote";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "Lote";': 'SQL_NAO_RECONHECIDO',
    'UPDATE "Lote" SET x = 1;': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "Lote";': 'SQL_NAO_RECONHECIDO',
    'CREATE UNIQUE INDEX "u" ON "Lote"("x");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [sql, codigo] of Object.entries(casos)) {
    const c = classificar(BASE + sql);
    assert.equal(c.expand, false, sql);
    assert.ok(c.violacoes.some((v) => v.codigo === codigo), `${sql} → ${JSON.stringify(c.violacoes)}`);
  }
});

test('B3: manifesto — migration fora da lista ou com 1 byte diferente é recusada; DO de RLS só com hash auditado e tabela nova', () => {
  const [a] = NOMES.map(ler);
  assert.equal(classificarMigrations([{ ...a, sql: `${a.sql}\n` }]).violacoes[0].codigo, 'MIGRATION_CHECKSUM_DIVERGENTE');
  assert.equal(classificarMigrations([{ nome: '29990101000000_x', sql: BASE }]).violacoes[0].codigo, 'MIGRATION_NAO_APROVADA');
  const doNovo = `${BASE}DO $$ BEGIN EXECUTE 'ALTER TABLE public."Nova" ENABLE ROW LEVEL SECURITY'; END $$;`;
  assert.ok(classificar(doNovo).violacoes.some((v) => v.codigo === 'DO_NAO_RECONHECIDO'), 'DO não auditado é recusado mesmo sobre tabela nova');
});

test('B4: compatível com o backend antigo passa (tabela nova, coluna anulável + FK para tabela nova, índice não-único)', () => {
  const sql = `${BASE}ALTER TABLE "Nova" ADD CONSTRAINT "n_ok" CHECK ("id" <> '');
ALTER TABLE "Lote" ADD COLUMN "nova_id" VARCHAR(64);
ALTER TABLE "Lote" ADD CONSTRAINT "f" FOREIGN KEY ("cliente_id", "nova_id") REFERENCES "Nova"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "i" ON "Lote"("cliente_id", "nova_id");
-- DROP TABLE "Lote"; (comentário não conta)`;
  assert.deepEqual(classificar(sql).violacoes, []);
});

test('B5: histórico do alvo — extra, checksum divergente, parcial ou pendência fora do manifesto → PREMERGE_MIGRATIONS_NAO_COMPROVADAS', () => {
  const locais = [{ nome: '20250101000000_base', checksum: 'b' }, ...NOMES.map((n) => ({ nome: n, checksum: MIGRATIONS_APROVADAS[n] }))];
  const ok = (n, c = 'b') => ({ migration_name: n, checksum: c, finished_at: new Date(), rolled_back_at: null });
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: [ok('20250101000000_base')] }), { ok: true, codigo: null, pendentes: NOMES, falhas: [] });
  const casos = [
    [ok('20250101000000_base'), ok('29990101000000_extra')],
    [ok('20250101000000_base', 'outro')],
    [ok('20250101000000_base'), { migration_name: NOMES[0], checksum: MIGRATIONS_APROVADAS[NOMES[0]], finished_at: null, rolled_back_at: null }],
    [],
  ];
  for (const linhas of casos) assert.equal(conferirHistoricoRemoto({ locais, linhas }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', JSON.stringify(linhas));
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok('20250101000000_base'), ok(NOMES[0], MIGRATIONS_APROVADAS[NOMES[0]])] }).ok, true, 'aplicação parcial do manifesto ainda é retomável');
});

test('B5b: checksum histórico "manual" só é aceito para as 4 migrations documentadas; em qualquer outra é divergência', () => {
  const hist = '20260908174141_p3_foundation';
  const locais = [{ nome: hist, checksum: 'x' }, { nome: '20250101000000_base', checksum: 'b' }, ...NOMES.map((n) => ({ nome: n, checksum: MIGRATIONS_APROVADAS[n] }))];
  const ok = (n, c) => ({ migration_name: n, checksum: c, finished_at: new Date(), rolled_back_at: null });
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'manual'), ok('20250101000000_base', 'b')] }).ok, true);
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'manual'), ok('20250101000000_base', 'manual')] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'outro'), ok('20250101000000_base', 'b')] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
});

test('B6: runner — --base proibido, SHA inválido/errado → exit 3; nunca imprime URL', () => {
  const env = { ...process.env, MIGRATION_DATABASE_URL: 'postgresql://u:SEGREDO@h:5432/d', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '1' };
  const run = (...a) => spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', ...a], { encoding: 'utf8', env });
  const r1 = run('--sha', 'a'.repeat(40), '--base', 'HEAD~1');
  assert.equal(r1.status, 3);
  assert.match(r1.stderr, /BASE_FIXA/);
  assert.equal(run('--sha', 'abc', '--aplicar').status, 3);
  const r3 = run('--sha', '0'.repeat(40), '--aplicar');
  assert.equal(r3.status, 3);
  assert.match(r3.stderr, /HEAD_DIVERGENTE/);
  for (const r of [r1, r3]) assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\//);
});

test('B7: runner no HEAD atual — sem credenciais só há análise local declarada "alvo remoto NÃO verificado"', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sujo = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  const env = { ...process.env, MIGRATION_DATABASE_URL: '', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '' };
  const r = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', head], { encoding: 'utf8', env });
  if (sujo) return assert.match(r.stderr, /ARVORE_SUJA/);
  if (/MAIN_INDISPONIVEL|MAIN_DEFASADA/.test(r.stderr)) return assert.equal(r.status, 3); // CI sem remoto/defasado: fecha
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /alvo remoto NÃO verificado/);
  const a = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', head, '--aplicar'], { encoding: 'utf8', env });
  assert.equal(a.status, 3);
  assert.match(a.stderr, /ALVO_SEM_CONFIGURACAO/);
});

/**
 * Repositório git descartável que reproduz a release de UMA migration CONTRACT (`nome`): `origin` (bare) com a
 * main = todas as migrations da pasta menos `nome`, e HEAD = main + `nome`. Árvore limpa e `origin/main` = remota,
 * então o runner real chega às barreiras do CONTRACT independentemente do estado desta árvore. A OUTRA CONTRACT
 * (D-PROD-162 ou D-PROD-183) fica na main: a release continua ISOLADA (uma só migration nova) e nada do manifesto falta.
 */
const repoDaReleaseContract = (nome) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-premerge-contract-'));
  const origem = join(dir, 'origin.git');
  const trabalho = join(dir, 'trabalho');
  const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=teste@exemplo.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origem]);
  mkdirSync(trabalho);
  g(trabalho, 'init', '-q', '-b', 'main');
  const raiz = 'backend/prisma/migrations';
  for (const d of readdirSync(raiz)) if (d !== nome) cpSync(join(raiz, d), join(trabalho, raiz, d), { recursive: true });
  g(trabalho, 'add', '-A');
  g(trabalho, 'commit', '-q', '-m', 'main');
  g(trabalho, 'remote', 'add', 'origin', origem);
  g(trabalho, 'push', '-q', 'origin', 'main');
  g(trabalho, 'fetch', '-q', 'origin');
  g(trabalho, 'checkout', '-q', '-b', 'release');
  cpSync(join(raiz, nome), join(trabalho, raiz, nome), { recursive: true });
  g(trabalho, 'add', '-A');
  g(trabalho, 'commit', '-q', '-m', 'release');
  return { dir, trabalho, sha: g(trabalho, 'rev-parse', 'HEAD') };
};

const SCRIPT_PREMERGE = resolve('scripts/deploy/premerge-migrate.mjs');
const URL_FALSA = 'postgresql://u:SEGREDO@db.exemplo.invalid:5432/d';
const SEM_ALVO = { MIGRATION_DATABASE_URL: '', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '' };
const COM_ALVO = { MIGRATION_DATABASE_URL: URL_FALSA, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '7692130048193495360' };
/** Roda o runner real no repositório descartável, no SHA da release. */
const runnerDaRelease = (repo) => (env, ...a) => spawnSync(process.execPath, [SCRIPT_PREMERGE, '--sha', repo.sha, ...a], { cwd: repo.trabalho, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });
const semSegredo = (r) => assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\/|exemplo\.invalid/);
/** CONTRACT_NAO_AUTORIZADO ANTES de qualquer conexão ao alvo, sem URL na saída. */
const recusadoSemConectar = (r, decisao) => {
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /RECUSADO CONTRACT_NAO_AUTORIZADO/);
  assert.ok(r.stderr.includes(`exigem --contract ${decisao} exato`), r.stderr);
  assert.doesNotMatch(r.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS|alvo indisponível/, 'recusou ANTES de qualquer conexão');
  semSegredo(r);
};

test('B9 (D-PROD-162): runner real sobre a release do CONTRACT — análise local declara o CONTRACT; verificar/aplicar exigem --contract D-PROD-162 exato ANTES de conectar; nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_C);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    assert.match(analise.stdout, /ANÁLISE LOCAL OK \(CONTRACT D-PROD-162: 13 tabelas removidas, 2 CHECKs alargados\) — alvo remoto NÃO verificado/);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    // Isolada: a D-PROD-183 está na main desta release sintética, então a única migration nova é a D-PROD-162.
    assert.deepEqual(json.migrations_novas, [NOME_C]);
    assert.deepEqual(json.contract.map((k) => k.decisao), ['D-PROD-162']);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-162').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-162');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-999'),
      run(COM_ALVO, '--verificar-alvo', '--contract'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-183'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-162');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-162');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B13 (D-PROD-183): runner real sobre a release do DROP COLUMN de TipoTarefa — análise local declara as 4 colunas removidas; verificar/aplicar exigem --contract D-PROD-183 exato ANTES de conectar (a decisão da D-PROD-162 não serve); nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_T);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    assert.ok(analise.stdout.includes('ANÁLISE LOCAL OK (CONTRACT D-PROD-183: 4 colunas removidas (TipoTarefa.exige_area, TipoTarefa.pode_ter_produto, TipoTarefa.pode_ter_maquina, TipoTarefa.pode_ter_implemento)) — alvo remoto NÃO verificado'), analise.stdout);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    // Isolada: a D-PROD-162 está na main desta release sintética (em produção já concluída), então a única nova é a D-PROD-183.
    assert.deepEqual(json.migrations_novas, [NOME_T]);
    assert.deepEqual(json.contract, [CONTRACT_T]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-183').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-183');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-162'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-162'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-183'), run(COM_ALVO, '--verificar-alvo', '--contract'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-183');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-183');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

const SHA = 'a'.repeat(40);
const ORIGIN = 'https://maike.exemplo.com.br';
const healthOk = { status: 'ok', release: SHA, capacidades: ['rebanho-ledger-cutover-r6'], implantacao: { ambiente: 'production', repositorio: 'maikelimaadm-stack/MAIKE', dominio_producao: 'maike.exemplo.com.br' } };

test('C1: origin de produção — só o configurado; preview, host arbitrário, caminho/query, http, localhost e credenciais recusados', () => {
  assert.equal(validarOrigemProducao({ informada: ORIGIN, configurada: ORIGIN }).ok, true);
  const casos = {
    [`${ORIGIN}/`]: null,
    'https://maike-git-claude-r2e-x.vercel.app': 'URL_DE_PREVIEW',
    'https://outro.exemplo.com': 'URL_FORA_DA_PRODUCAO',
    [`${ORIGIN}/api/native`]: 'URL_COM_CAMINHO',
    [`${ORIGIN}?x=1`]: 'URL_COM_CAMINHO',
    'http://maike.exemplo.com.br': 'URL_NAO_HTTPS',
    'https://localhost': 'URL_LOCAL',
    'https://u:p@maike.exemplo.com.br': 'URL_COM_CREDENCIAIS',
  };
  for (const [u, motivo] of Object.entries(casos)) assert.equal(validarOrigemProducao({ informada: u, configurada: ORIGIN }).motivo, motivo, u);
  assert.equal(validarOrigemProducao({ informada: ORIGIN, configurada: undefined }).motivo, 'ORIGEM_PRODUCAO_NAO_CONFIGURADA');
  assert.equal(validarOrigemProducao({ informada: 'https://maike-git-x.vercel.app', configurada: 'https://maike-git-x.vercel.app' }).motivo, 'ORIGEM_PRODUCAO_INVALIDA');
});

test('C2: identidade do backend — redirect, preview, outro repositório/domínio, main obsoleta e SHA divergente recusam', () => {
  const base = { health: healthOk, releaseSha: SHA, mainRemota: SHA, hostProducao: 'maike.exemplo.com.br' };
  assert.deepEqual(conferirBackendNovo(base), { ok: true, motivo: null });
  const casos = [
    [{ redirecionou: true, httpStatus: 308 }, 'HEALTH_REDIRECIONADO'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, ambiente: 'preview' } } }, 'IMPLANTACAO_NAO_E_PRODUCAO'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, repositorio: 'outro/repo' } } }, 'REPOSITORIO_DIVERGENTE'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, dominio_producao: 'x.vercel.app' } } }, 'DOMINIO_PRODUCAO_DIVERGENTE'],
    [{ mainRemota: 'b'.repeat(40) }, 'RELEASE_NAO_E_MAIN_ATUAL'],
    [{ mainRemota: null }, 'MAIN_REMOTA_INDISPONIVEL'],
    [{ health: { ...healthOk, release: 'c'.repeat(40) } }, 'BACKEND_EM_OUTRO_SHA'],
    [{ health: { status: 'ok', processo: 'up' } }, 'BACKEND_ANTIGO_EM_PRODUCAO'],
    [{ health: { ...healthOk, status: 'degraded' } }, 'BACKEND_DEGRADADO'],
    [{ httpStatus: 503, health: null }, 'HEALTH_INDISPONIVEL'],
  ];
  for (const [mut, motivo] of casos) assert.equal(conferirBackendNovo({ ...base, ...mut }).motivo, motivo, motivo);
});

test('C3: CLI remoto + --executar com URL de preview/sem origin configurado → exit 3 ANTES de conectar ao banco; sem segredo na saída', () => {
  const comum = ['scripts/ops/cutover-rebanho.mjs', '--cliente-id', 'c', '--empresa-id', 'e', '--executar', '--estrategia', 'entradas', '--confirmar-empresa', 'F', '--usuario-admin-id', 'u', '--release-sha', SHA];
  const env = { ...process.env, CUTOVER_DATABASE_URL: 'postgresql://u:SEGREDO@banco.exemplo.invalid:5432/d', CUTOVER_EXPECTED_SYSTEM_IDENTIFIER: '1', MAIKE_PRODUCAO_ORIGIN: ORIGIN };
  const sem = spawnSync('node', comum.filter((x) => x !== '--release-sha' && x !== SHA), { encoding: 'utf8', env });
  assert.equal(sem.status, 2);
  const preview = spawnSync('node', [...comum, '--backend-url', 'https://maike-git-claude-x.vercel.app'], { encoding: 'utf8', env });
  assert.equal(preview.status, 3);
  assert.match(preview.stderr, /URL_DE_PREVIEW/);
  const semConfig = spawnSync('node', [...comum, '--backend-url', ORIGIN], { encoding: 'utf8', env: { ...env, MAIKE_PRODUCAO_ORIGIN: '' } });
  assert.equal(semConfig.status, 3);
  assert.match(semConfig.stderr, /ORIGEM_PRODUCAO_NAO_CONFIGURADA/);
  for (const r of [sem, preview, semConfig]) assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\//);
});

test('B8 (D-PROD-113): migration aprovada que já está na main não "falta"; a que não está nem na main nem na release continua recusada', () => {
  const manifesto = { m_antiga: 'h1', m_nova: 'h2', m_sumida: 'h3' };
  const naMain = (n) => n === 'm_antiga';
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, ['m_nova'], naMain), ['m_sumida']);
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, ['m_nova', 'm_sumida'], naMain), []);
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, [], () => false), ['m_antiga', 'm_nova', 'm_sumida'], 'sem main: tudo falta (fail-closed)');
  // Cada migration aprovada ou já está na main ou é nova NESTA árvore (a release a
  // traz): nada do manifesto "falta". Na main (sem migration nova) a release vazia passa.
  const naMainReal = (n) => { try { execFileSync('git', ['cat-file', '-e', `origin/main:backend/prisma/migrations/${n}/migration.sql`], { stdio: 'ignore' }); return true; } catch { return false; } };
  const temMain = (() => { try { execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  if (temMain) {
    const novasNaArvore = NOMES.filter((n) => !naMainReal(n) && existsSync(`backend/prisma/migrations/${n}/migration.sql`));
    assert.deepEqual(migrationsDoManifestoFaltando(MIGRATIONS_APROVADAS, novasNaArvore, naMainReal), []);
  }
});
