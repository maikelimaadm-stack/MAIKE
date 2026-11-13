/**
 * MAIKE-ESTOQUE-P1-03 (D-PROD-185) — prova REAL do escopo transacional do
 * `prisma migrate deploy` (versão do package-lock) e do preflight fail-closed.
 * PostgreSQL local/da CI, bancos descartáveis criados e apagados aqui; nada
 * remoto (as funções recusam alvo protegido). Funções do ensaio
 * `scripts/dev/ensaio-p1-03-transacao-migration.mjs`.
 *
 *  TX-F falha determinística no 2º CREATE INDEX (mesmo formato da migration da
 *       P1-03): o 1º índice NÃO persiste; ledger `failed` (sem finished_at, sem
 *       rolled_back_at, 0 passos); P3018 no deploy que falha, P3009 no seguinte.
 *  TX-T o 2º CREATE INDEX espera a trava da 2ª tabela: o backend do deploy SEGURA
 *       ShareLock na 1ª (concedido) e espera ShareLock na 2ª, numa transação só
 *       desde o início do script; o 1º índice não é visível; INSERT na 1ª tabela
 *       bloqueia (55P03 com lock_timeout curto do observador); SELECT segue;
 *       liberada a trava, os dois índices e o ledger concluído.
 *  TX-L o mesmo com `lock_timeout` nas `options` da URL do deploy: o deploy
 *       desiste (55P03) sem índice nenhum, ledger `failed`.
 *  PF   o preflight real (`estoque-p1-03-preflight-…sql`, READ ONLY) com as
 *       migrations REAIS: antes → SEGUIR; índice criado à mão (parcial) → PARAR;
 *       a migration REAL falhando no 2º índice (nome já ocupado) → nenhum índice,
 *       ledger falhado → PARAR; depois de `migrate resolve --rolled-back` (só no
 *       sandbox) e a causa removida → SEGUIR; aplicada → JA_APLICADA; nome ocupado
 *       por outra relação → PARAR; índice de mesmo nome com definição diferente → PARAR.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

import {
  NOME_P103, RAIZ, apagarBanco, bancoNovo, cenarioEspera, cenarioFalhaNoSegundo, deploy, exigirUrlLocal, ledger, pastaReal,
} from '../../scripts/dev/ensaio-p1-03-transacao-migration.mjs';

const PREFLIGHT = readFileSync(join(RAIZ, 'scripts', 'ops', 'sql-editor', 'estoque-p1-03-preflight-indices-somente-leitura.sql'), 'utf8');
let base;
/** @type {PrismaClient} */
let admin;
before(() => {
  base = exigirUrlLocal(process.env.DATABASE_URL);
  admin = new PrismaClient({ datasourceUrl: base, log: [] });
});
after(async () => {
  await admin.$disconnect();
});

describe('Escopo transacional do prisma migrate deploy (PG real)', () => {
  test('TX-F falha no 2º CREATE INDEX: o 1º não persiste; ledger failed; P3018', async () => {
    const r = await cenarioFalhaNoSegundo(admin, base);
    assert.notEqual(r.status, 0);
    assert.equal(r.p3018, true, 'erro de migration falhada do Prisma');
    assert.equal(r.erro_42703, true, 'a causa é o 2º índice');
    assert.deepEqual(r.indices, [], 'o 1º CREATE INDEX foi desfeito junto: uma transação só');
    assert.deepEqual(r.ledger.find((l) => l.migration_name === '0002_dois_indices'), { migration_name: '0002_dois_indices', terminou: false, revertida: false, passos: 0 });
    assert.notEqual(r.retry_status, 0, 'o deploy seguinte recusa');
    assert.equal(r.retry_p3009, true, 'retry com migration falhada pendente: P3009 (não P3018)');
  });

  test('TX-T espera da 2ª trava: ShareLock da 1ª tabela retido, 1º índice invisível, escrita na 1ª bloqueada, leitura livre', async () => {
    const r = await cenarioEspera(admin, base);
    assert.equal(r.deploy_esperou_trava, true);
    assert.deepEqual(r.travas_do_deploy, [
      { tabela: 'T1', modo: 'ShareLock', concedida: true },
      { tabela: 'T2', modo: 'ShareLock', concedida: false },
    ]);
    assert.equal(r.atividade_do_deploy.uma_transacao_desde_o_inicio_do_script, true);
    assert.deepEqual(r.indices_visiveis_durante, [], 'o 1º índice só aparece no COMMIT');
    assert.equal(r.select_t1_durante, true);
    assert.equal(r.insert_t1_durante, 'bloqueado (55P03)');
    assert.equal(r.deploy_status, 0);
    assert.deepEqual(r.indices_depois, ['T1_a_idx', 'T2_b_idx']);
    assert.equal(r.ledger.find((l) => l.migration_name === '0002_dois_indices').terminou, true);
  });

  test('TX-L lock_timeout nas options da URL do deploy: desiste com 55P03, nenhum índice, ledger failed', async () => {
    const r = await cenarioEspera(admin, base, { opcoes: '-c lock_timeout=1s', sufixo: 'l', segurarMs: 4000 });
    assert.equal(r.deploy_esperou_trava, true);
    assert.notEqual(r.deploy_status, 0);
    assert.equal(r.deploy_55P03, true);
    assert.deepEqual(r.indices_depois, []);
    assert.deepEqual(r.ledger.find((l) => l.migration_name === '0002_dois_indices'), { migration_name: '0002_dois_indices', terminou: false, revertida: false, passos: 0 });
  });
});

/** Preflight numa transação READ ONLY que nunca commita → { 'secao.item': valor }. */
const preflight = async (db) => {
  /** @type {any[]} */
  let linhas = [];
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    linhas = await tx.$queryRawUnsafe(PREFLIGHT);
    throw new Error('desfaz');
  }).catch((x) => {
    if (x?.message !== 'desfaz') throw x;
  });
  return Object.fromEntries(linhas.map((l) => [`${l.secao}.${l.item}`, l.valor]));
};
const resolveRevertida = (dir, url) =>
  new Promise((resolve) => {
    const env = { ...process.env, DATABASE_URL: url };
    const f = spawn(process.execPath, [join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'resolve', '--rolled-back', NOME_P103, '--schema', join(dir, 'schema.prisma')], { cwd: RAIZ, env });
    f.on('close', (s) => resolve(s ?? 1));
  });

describe('Preflight fail-closed com as migrations reais', () => {
  test('PF antes → SEGUIR; parcial à mão → PARAR; migration real falhada → PARAR; revertida e corrigida → SEGUIR; aplicada → JA_APLICADA', async () => {
    const nome = 'maike_p103_preflight';
    const url = await bancoNovo(admin, base, nome);
    const semP103 = pastaReal([NOME_P103]);
    const todas = pastaReal([]);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    try {
      assert.equal((await deploy(semP103, url)).status, 0, 'a main antes da P1-03 sobe');
      let v = await preflight(db);
      assert.equal(v['veredito.estado'], 'SEGUIR', JSON.stringify(v));
      assert.deepEqual([v['indice.novos_ja_existem'], v['migration.falhadas_pendentes'], v['migration.contract_d_prod_183_aplicada']], ['0', '0', 'SIM']);

      // nome de um dos índices ocupado por OUTRA relação (tabela): o CREATE INDEX falharia → PARAR antes do GO-2
      await db.$executeRawUnsafe('CREATE TABLE "MovimentacaoEstoque_keyset_empresa_idx" (x int)');
      v = await preflight(db);
      assert.deepEqual([v['indice.nomes_ocupados_qualquer_tipo'], v['veredito.estado']], ['1', 'PARAR'], 'nome ocupado por tabela');
      await db.$executeRawUnsafe('DROP TABLE "MovimentacaoEstoque_keyset_empresa_idx"');

      // parcial à mão: só o 1º índice existe, sem a migration
      await db.$executeRawUnsafe('CREATE INDEX "OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx" ON "OperacaoIdempotente"("cliente_id", "tipo_operacao", "createdAt")');
      v = await preflight(db);
      assert.equal(v['veredito.estado'], 'PARAR', 'índice parcial fora da migration');
      await db.$executeRawUnsafe('DROP INDEX "OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx"');

      // a migration REAL falha no 2º índice (o nome já está ocupado por outra relação)
      await db.$executeRawUnsafe('CREATE TABLE "MovimentacaoEstoque_keyset_empresa_idx" (x int)');
      const r = await deploy(todas, url);
      assert.notEqual(r.status, 0, 'a migration real falha');
      assert.match(r.saida, /P3018/);
      v = await preflight(db);
      assert.equal(v['indice.novos_ja_existem'], '0', 'o 1º índice (LC-2) NÃO ficou: a migration é uma transação só');
      assert.equal(v['migration.falhadas_pendentes'], '1');
      assert.equal(v['veredito.estado'], 'PARAR');
      const p103 = (await ledger(db)).find((l) => l.migration_name === NOME_P103);
      assert.deepEqual([p103.terminou, p103.revertida, p103.passos], [false, false, 0]);

      // recuperação LOCAL (no runbook ela exige GO próprio): resolve --rolled-back e causa removida → SEGUIR
      assert.equal(await resolveRevertida(todas, url), 0);
      await db.$executeRawUnsafe('DROP TABLE "MovimentacaoEstoque_keyset_empresa_idx"');
      v = await preflight(db);
      assert.deepEqual([v['migration.falhadas_pendentes'], v['migration.revertidas_historico'], v['veredito.estado']], ['0', '1', 'SEGUIR']);

      assert.equal((await deploy(todas, url)).status, 0, 'reaplicada pelo deploy real');
      v = await preflight(db);
      assert.deepEqual([v['indice.novos_ja_existem'], v['indice.definicoes_exatas_validas'], v['veredito.estado']], ['2', '2', 'JA_APLICADA']);

      // migration registrada, mas um índice com o MESMO nome e definição diferente (em outra tabela) → PARAR
      await db.$executeRawUnsafe('DROP INDEX "MovimentacaoEstoque_keyset_empresa_idx"');
      await db.$executeRawUnsafe('CREATE INDEX "MovimentacaoEstoque_keyset_empresa_idx" ON "OperacaoIdempotente"("cliente_id")');
      v = await preflight(db);
      assert.deepEqual([v['indice.novos_ja_existem'], v['indice.definicoes_exatas_validas'], v['veredito.estado']], ['2', '1', 'PARAR'], 'nome certo, definição errada');
    } finally {
      await db.$disconnect();
      rmSync(semP103, { recursive: true, force: true });
      rmSync(todas, { recursive: true, force: true });
      await apagarBanco(admin, nome);
    }
  });
});
