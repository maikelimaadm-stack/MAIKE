/**
 * Barreira de alvo em duas conexões (PR145-G4-R1). Sem banco: o executor SQL
 * e a conferência são injetados. A prova contra PostgreSQL real está em
 * backend/tests/alvoMigrationDuplaConexao.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compararAlvos, lerIdentidade, assinaturaHistorico } from '../../deploy/alvoBancoLib.mjs';
import { exigirAlvoConferido, CODIGOS_DEPLOY_MIGRATION } from '../../deploy/run-migrations.mjs';

const SID = '7692130048193495360';
const HIST = assinaturaHistorico([{ migration_name: 'm1', checksum: 'c1', finished_at: '2026-10-28T00:00:00Z', rolled_back_at: null }]);
const id = (extra = {}) => ({ ok: true, sid: SID, banco: 'postgres', banco_oid: '5', tem_historico: true, historico: HIST, migrations: 1, ...extra });
const SENHA = 'SENHA_FIXTURE_NAO_PODE_APARECER';
const REMOTO = `postgresql://ops:${SENHA}@db.exemplo.invalid:5432/postgres`;

test('AB-01 mesmo banco nas duas conexões, cluster esperado → aceita', () => {
  assert.deepEqual(compararAlvos({ esperadoSid: SID, runtime: id(), migracao: id() }).falhas, []);
});

test('AB-02 clusters diferentes, outro banco lógico, histórico diferente ou cluster inesperado → recusa', () => {
  const casos = [
    [{ sid: '111111111' }, /clusters diferentes/],
    [{ banco: 'outro', banco_oid: '9' }, /current_database difere/],
    [{ banco_oid: '9' }, /OID do banco difere/],
    [{ historico: 'x' }, /histórico de migrations difere/],
    [{ tem_historico: false, historico: null }, /_prisma_migrations ausente/],
  ];
  for (const [mig, re] of casos) {
    const v = compararAlvos({ esperadoSid: SID, runtime: id(), migracao: id(mig) });
    assert.equal(v.ok, false);
    assert.match(v.falhas.join('\n'), re);
  }
  assert.match(compararAlvos({ esperadoSid: '999999999', runtime: id(), migracao: id() }).falhas.join('\n'), /difere do esperado/);
  assert.match(compararAlvos({ esperadoSid: '', runtime: id(), migracao: id() }).falhas.join('\n'), /esperado ausente/);
});

test('AB-03 conexão ausente ou sem permissão → recusa, e o erro do driver nunca vaza', async () => {
  const falha = async () => {
    throw Object.assign(new Error(`Can't reach database server at db.exemplo.invalid user ops:${SENHA}`), { code: 'P1001' });
  };
  const r = await lerIdentidade(REMOTO, falha);
  assert.deepEqual(r, { ok: false, erro: 'sem acesso (P1001)' });
  const ausente = await lerIdentidade(undefined, falha);
  assert.equal(ausente.ok, false);
  const v = compararAlvos({ esperadoSid: SID, runtime: ausente, migracao: r });
  assert.equal(v.ok, false);
  assert.equal(JSON.stringify(v).includes(SENHA) || JSON.stringify(v).includes('exemplo.invalid'), false);
});

test('AB-04 runner: alvo remoto sem identificador esperado → NÃO migra', async () => {
  const saida = [];
  let conferiu = false;
  const pode = await exigirAlvoConferido({
    env: { MIGRATION_DATABASE_URL: REMOTO },
    conferir: async () => ((conferiu = true), { ok: true, falhas: [], resumo: '' }),
    resolverRuntime: async () => REMOTO,
    log: (m) => saida.push(m),
    erro: (m) => saida.push(m),
  });
  assert.equal(pode, false);
  assert.equal(conferiu, false);
  assert.match(saida.join('\n'), new RegExp(CODIGOS_DEPLOY_MIGRATION.ALVO_NAO_CONFERIDO));
  assert.match(saida.join('\n'), /Nenhuma migration foi executada/);
  assert.equal(saida.join('\n').includes(SENHA), false);
});

test('AB-05 runner: conferência reprovada → NÃO migra; aprovada → migra; recebe o runtime resolvido', async () => {
  const saida = [];
  let recebido;
  const reprova = await exigirAlvoConferido({
    env: { MIGRATION_DATABASE_URL: REMOTO, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID },
    conferir: async (a) => ((recebido = a), { ok: false, falhas: ['runtime e migration: OID do banco difere (outro banco lógico)'], resumo: '' }),
    resolverRuntime: async () => 'postgresql://runtime@db.outro.invalid:5432/postgres',
    log: (m) => saida.push(m),
    erro: (m) => saida.push(m),
  });
  assert.equal(reprova, false);
  assert.equal(recebido.esperadoSid, SID);
  assert.equal(recebido.urlRuntime, 'postgresql://runtime@db.outro.invalid:5432/postgres');
  assert.equal(recebido.urlMigracao, REMOTO);
  assert.match(saida.join('\n'), /outro banco lógico/);
  const aprova = await exigirAlvoConferido({
    env: { MIGRATION_DATABASE_URL: REMOTO, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID },
    conferir: async () => ({ ok: true, falhas: [], resumo: 'banco=postgres' }),
    resolverRuntime: async () => REMOTO,
    log: () => {},
    erro: () => {},
  });
  assert.equal(aprova, true);
  assert.equal(saida.join('\n').includes(SENHA), false);
});

test('AB-06 runner: alvo local segue como antes (CI e dev), salvo se a conferência for exigida', async () => {
  let conferiu = 0;
  const conferir = async () => (conferiu++, { ok: false, falhas: ['x'], resumo: '' });
  const local = { MIGRATION_DATABASE_URL: 'postgresql://postgres@localhost:5432/maike_ci' };
  assert.equal(await exigirAlvoConferido({ env: local, conferir, resolverRuntime: async () => null, log: () => {}, erro: () => {} }), true);
  assert.equal(conferiu, 0);
  const forcado = { ...local, MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID };
  assert.equal(await exigirAlvoConferido({ env: forcado, conferir, resolverRuntime: async () => null, log: () => {}, erro: () => {} }), false);
  assert.equal(conferiu, 1);
});
