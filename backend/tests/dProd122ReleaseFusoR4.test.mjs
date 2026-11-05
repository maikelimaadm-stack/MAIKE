/**
 * PR190-R4 (D-PROD-122) — identidade do BANCO LÓGICO antes de configurar fusos.
 *
 * Lacuna da R3: `configurar-fuso-empresas.mjs` só comparava o system_identifier
 * (cluster). Dois bancos lógicos no MESMO cluster têm o mesmo SID: o plano podia
 * ser aplicado no banco errado. Agora, em alvo não local, as TRÊS conexões —
 * FUSO_DATABASE_URL (a que escreve), runtime (precedência do env.js) e
 * MIGRATION_DATABASE_URL — são lidas e têm de ser o MESMO banco lógico (SID =
 * esperado, current_database/OID, histórico de migrations), com atestado; e a
 * identidade é conferida DE NOVO dentro da transação de escrita (TOCTOU).
 *
 * Tudo em PostgreSQL LOCAL descartável: um segundo banco lógico é criado no
 * mesmo cluster do teste; o ramo "não local" usa um nome de host não literal que
 * chega ao mesmo servidor (ver dProd122ReleaseFusoR3).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { criarTenant, limparBanco, encerrar } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

const lib = await import('../../scripts/ops/fusoReleaseLib.mjs');
const alvoLib = await import('../../scripts/deploy/alvoBancoLib.mjs');
const { PrismaClient } = await import('@prisma/client');

const REPO = join(import.meta.dirname, '..', '..');
const FRASE = 'APLICAR_FUSOS_DAS_FAZENDAS';
const SP = 'America/Sao_Paulo';
const BANCO_OUTRO = 'maike_d122_r4_outro';
const PAPEL_LEITOR = 'maike_d122_r4_leitor';
/** Papel SEM BYPASSRLS: o RLS de public (migration p8) esconde _prisma_migrations dele. */
const PAPEL_SEM_HISTORICO = 'maike_d122_r4_sem_historico';
const prisma = () => getPrismaClient();

let aliasRemoto = null;
/** @type {any} */
let outro = null;
const comBanco = (url, banco) => {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  return u.toString();
};
const comHost = (url, host) => {
  const u = new URL(url);
  u.hostname = host;
  return u.toString();
};
const comUsuario = (url, usuario, senha) => {
  const u = new URL(url);
  u.username = usuario;
  u.password = senha;
  return u.toString();
};
const urlCi = () => process.env.DATABASE_URL;
const remoto = (url) => {
  assert.ok(aliasRemoto, 'nenhum nome de host não literal chega ao PostgreSQL de teste');
  return comHost(url, aliasRemoto);
};

before(async () => {
  for (const candidato of ['maike-alvo-teste', hostname(), 'vm', 'runsc', 'localhost.localdomain']) {
    if (!candidato || ['localhost', '127.0.0.1', '::1'].includes(candidato)) continue;
    try {
      await lookup(candidato);
      const c = new PrismaClient({ datasourceUrl: comHost(urlCi(), candidato) });
      try {
        await c.$queryRawUnsafe('SELECT 1');
        aliasRemoto = candidato;
      } finally {
        await c.$disconnect();
      }
      if (aliasRemoto) break;
    } catch { /* próximo */ }
  }
  // Segundo banco lógico no MESMO cluster (mesmo system_identifier), migrado igual.
  const p = prisma();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_OUTRO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_OUTRO}`);
  const mig = spawnSync('npm', ['run', '-s', 'deploy:migrate'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, MIGRATION_DATABASE_URL: comBanco(urlCi(), BANCO_OUTRO) }, timeout: 300_000 });
  assert.equal(mig.status, 0, `migração do banco auxiliar falhou: ${mig.stderr?.slice(-400)}`);
  outro = new PrismaClient({ datasourceUrl: comBanco(urlCi(), BANCO_OUTRO) });
  // Papel distinto que só LÊ (usuário diferente para o mesmo banco lógico).
  // O leitor tem BYPASSRLS (como o dono/serviço que lê o histórico); o outro não.
  const banco = new URL(urlCi()).pathname.slice(1);
  for (const [papel, extra] of [[PAPEL_LEITOR, 'BYPASSRLS'], [PAPEL_SEM_HISTORICO, '']]) {
    await p.$executeRawUnsafe(`DROP ROLE IF EXISTS ${papel}`).catch(() => {});
    await p.$executeRawUnsafe(`CREATE ROLE ${papel} LOGIN ${extra} PASSWORD 'leitor-r4'`);
    await p.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${banco}" TO ${papel}`);
    await p.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${papel}`);
    await p.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${papel}`);
  }
});
after(async () => {
  await outro?.$disconnect();
  const p = prisma();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_OUTRO} WITH (FORCE)`).catch(() => {});
  const banco = new URL(urlCi()).pathname.slice(1);
  for (const papel of [PAPEL_LEITOR, PAPEL_SEM_HISTORICO]) {
    await p.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${papel}`).catch(() => {});
    await p.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM ${papel}`).catch(() => {});
    await p.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${banco}" FROM ${papel}`).catch(() => {});
    await p.$executeRawUnsafe(`DROP ROLE IF EXISTS ${papel}`).catch(() => {});
  }
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
  await outro.$executeRawUnsafe('DELETE FROM "AuditLog"');
  await outro.$executeRawUnsafe('DELETE FROM "RebanhoLedgerAtivacao"');
  await outro.$executeRawUnsafe('DELETE FROM "Empresa"');
  await outro.$executeRawUnsafe('DELETE FROM "Usuario"');
  await outro.$executeRawUnsafe('DELETE FROM "Cliente"');
});

/** Tenant + admin + empresa ATIVADA sem fuso, num banco qualquer (ids sintéticos). */
const semear = async (db) => {
  const sufixo = randomUUID().slice(0, 8);
  const cliente = await db.cliente.create({ data: { codigo: `r4-${sufixo}`, nome: `Tenant ${sufixo}` } });
  const admin = await db.usuario.create({ data: { cliente_id: cliente.id, nome: 'Admin', login: `adm-${sufixo}`, senha_hash: 'x', papel_tenant: 'administrador' } });
  const empresa = await db.empresa.create({ data: { cliente_id: cliente.id, numero_empresa: 1, apelido: 'F', nome: `FAZ ${sufixo}` } });
  await db.rebanhoLedgerAtivacao.create({ data: { cliente_id: cliente.id, empresa_id: empresa.id, data_corte: new Date('2026-10-01T00:00:00Z'), modo: 'entradas', ativado_por_usuario_id: admin.id } });
  return { cliente, admin, empresa };
};
const planoDe = (t) => ({ administradores: { [t.cliente.id]: t.admin.id }, empresas: [{ cliente_id: t.cliente.id, empresa_id: t.empresa.id, fuso_horario: SP }] });
const arquivoPlano = (conteudo) => {
  const dir = mkdtempSync(join(tmpdir(), 'plano-fuso-r4-'));
  const caminho = join(dir, 'plano.json');
  writeFileSync(caminho, JSON.stringify(conteudo));
  return caminho;
};
const sid = async () => (await prisma().$queryRaw`SELECT system_identifier::text AS sid FROM pg_control_system()`)[0].sid;
const fotografia = async (db) => ({
  empresas: (await db.empresa.findMany({ orderBy: { id: 'asc' } })).map((e) => [e.id, e.fuso_horario, e.updatedAt.toISOString()]),
  audits: await db.auditLog.count(),
  migrations: alvoLib.assinaturaHistorico(await db.$queryRawUnsafe(alvoLib.CONSULTA_HISTORICO)),
});
const configurar = (env, args) => spawnSync(process.execPath, [join(REPO, 'scripts/ops/configurar-fuso-empresas.mjs'), ...args], {
  cwd: REPO, encoding: 'utf8', timeout: 60_000,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', ...env },
});
const aplicarArgs = (caminho) => ['--plano', caminho, '--aplicar', '--confirmar', FRASE, '--referencia-backup', 'backup-local-de-teste'];

// ═══ RED / GREEN principal ══════════════════════════════════════════════

describe('PR190-R4 — mesmo cluster, banco lógico diferente', () => {
  test('R4-1: URL de fuso aponta a OUTRO banco do mesmo cluster (SID igual) → recusa TARGET_UNVERIFIED, zero escrita nos dois bancos', async () => {
    await semear(prisma());
    const alheio = await semear(outro);
    const caminho = arquivoPlano(planoDe(alheio));
    const antesCi = await fotografia(prisma());
    const antesOutro = await fotografia(outro);
    const r = configurar({
      FUSO_DATABASE_URL: remoto(comBanco(urlCi(), BANCO_OUTRO)),
      POSTGRES_PRISMA_URL: remoto(urlCi()),
      MIGRATION_DATABASE_URL: remoto(urlCi()),
      FUSO_EXPECTED_SYSTEM_IDENTIFIER: await sid(),
      RELEASE_ALVO_ATESTADO: 'teste local: SID do cluster de teste',
    }, aplicarArgs(caminho));
    assert.equal(r.status, 3, `o plano NÃO pode ser aplicado no banco errado: exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /TARGET_UNVERIFIED/);
    assert.deepEqual(await fotografia(outro), antesOutro, 'banco errado intacto');
    assert.deepEqual(await fotografia(prisma()), antesCi, 'banco certo intacto');
    assert.ok(!(r.stdout + r.stderr).includes(await sid()), 'nunca imprime o SID');
  });

  test('R4-2: as três conexões no MESMO banco lógico por endereços e usuários distintos → simula e aplica (local descartável); reaplicar não audita de novo', async () => {
    const t = await semear(prisma());
    const caminho = arquivoPlano(planoDe(t));
    const env = {
      FUSO_DATABASE_URL: remoto(urlCi()),
      POSTGRES_PRISMA_URL: comUsuario(comHost(urlCi(), '127.0.0.1'), PAPEL_LEITOR, 'leitor-r4'),
      MIGRATION_DATABASE_URL: remoto(urlCi()),
      FUSO_EXPECTED_SYSTEM_IDENTIFIER: await sid(),
      RELEASE_ALVO_ATESTADO: 'teste local: SID do cluster de teste',
    };
    const sim = configurar(env, ['--plano', caminho]);
    assert.equal(sim.status, 0, sim.stdout + sim.stderr);
    assert.match(sim.stdout, /"modo": "SIMULACAO"/);
    assert.equal((await prisma().empresa.findUnique({ where: { id: t.empresa.id } })).fuso_horario, null, 'simulação não grava');
    const ap = configurar(env, aplicarArgs(caminho));
    assert.equal(ap.status, 0, ap.stdout + ap.stderr);
    assert.equal((await prisma().empresa.findUnique({ where: { id: t.empresa.id } })).fuso_horario, SP);
    const audits = await prisma().auditLog.count({ where: { cliente_id: t.cliente.id, request_id: { startsWith: 'fuso-release:' } } });
    assert.equal(audits, 1);
    const re = configurar(env, aplicarArgs(caminho));
    assert.equal(re.status, 0, re.stdout + re.stderr);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: t.cliente.id, request_id: { startsWith: 'fuso-release:' } } }), 1, 'reaplicar não audita de novo');
    for (const s of [sim, ap, re]) assert.ok(![t.cliente.id, t.empresa.id, t.admin.id].some((v) => (s.stdout + s.stderr).includes(v)), 'sem ids crus');
  });
});

// ═══ Fail-closed: o que falta ou diverge ════════════════════════════════

describe('PR190-R4 — fail-closed antes de qualquer leitura de negócio', () => {
  test('R4-3: runtime ausente, migration ausente, SID ausente, atestado ausente, credencial inválida → recusa sem escrita', async () => {
    const t = await semear(prisma());
    const caminho = arquivoPlano(planoDe(t));
    const base = {
      FUSO_DATABASE_URL: remoto(urlCi()),
      POSTGRES_PRISMA_URL: remoto(urlCi()),
      MIGRATION_DATABASE_URL: remoto(urlCi()),
      FUSO_EXPECTED_SYSTEM_IDENTIFIER: await sid(),
      RELEASE_ALVO_ATESTADO: 'teste',
    };
    const sem = (k) => Object.fromEntries(Object.entries(base).filter(([chave]) => chave !== k));
    const antes = await fotografia(prisma());
    for (const [env, esperado] of [
      [sem('POSTGRES_PRISMA_URL'), 'RUNTIME_URL_AUSENTE'],
      [sem('MIGRATION_DATABASE_URL'), 'MIGRATION_DATABASE_URL_AUSENTE'],
      [sem('FUSO_EXPECTED_SYSTEM_IDENTIFIER'), 'ALVO_SEM_IDENTIFICADOR'],
      [sem('RELEASE_ALVO_ATESTADO'), 'ATESTADO_AUSENTE'],
      [{ ...base, POSTGRES_PRISMA_URL: comUsuario(remoto(urlCi()), 'ninguem', 'errada') }, 'ALVOS_NAO_CONFEREM'],
      [{ ...base, FUSO_EXPECTED_SYSTEM_IDENTIFIER: '1234567890123456789' }, 'ALVOS_NAO_CONFEREM'],
    ]) {
      const r = configurar(env, aplicarArgs(caminho));
      assert.equal(r.status, 3, `${esperado}: exit ${r.status}\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, new RegExp(esperado), `${esperado}: ${r.stderr}`);
      assert.ok(!/postgres(ql)?:\/\/|errada|leitor-r4/.test(r.stdout + r.stderr), `${esperado}: vazou URL/credencial`);
    }
    assert.deepEqual(await fotografia(prisma()), antes);
  });

  test('R4-4: identidade SQL sem permissão (pg_control_system negado ao papel do runtime) → TARGET_UNVERIFIED sem escrita', async () => {
    const t = await semear(prisma());
    const caminho = arquivoPlano(planoDe(t));
    const p = prisma();
    const eu = (await p.$queryRaw`SELECT current_user AS u`)[0].u;
    await p.$executeRawUnsafe('REVOKE EXECUTE ON FUNCTION pg_control_system() FROM PUBLIC');
    await p.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION pg_control_system() TO "${eu}"`);
    try {
      const antes = await fotografia(p);
      const r = configurar({
        FUSO_DATABASE_URL: remoto(urlCi()),
        POSTGRES_PRISMA_URL: comUsuario(remoto(urlCi()), PAPEL_LEITOR, 'leitor-r4'),
        MIGRATION_DATABASE_URL: remoto(urlCi()),
        FUSO_EXPECTED_SYSTEM_IDENTIFIER: await sid(),
        RELEASE_ALVO_ATESTADO: 'teste',
      }, aplicarArgs(caminho));
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stderr, /TARGET_UNVERIFIED/);
      assert.deepEqual(await fotografia(p), antes);
    } finally {
      await p.$executeRawUnsafe('GRANT EXECUTE ON FUNCTION pg_control_system() TO PUBLIC');
      await p.$executeRawUnsafe(`REVOKE EXECUTE ON FUNCTION pg_control_system() FROM "${eu}"`);
    }
  });

  test('R4-4b: papel do runtime sem visibilidade do histórico (RLS de public) → histórico vazio diverge → TARGET_UNVERIFIED sem escrita', async () => {
    const t = await semear(prisma());
    const caminho = arquivoPlano(planoDe(t));
    const antes = await fotografia(prisma());
    const r = configurar({
      FUSO_DATABASE_URL: remoto(urlCi()),
      POSTGRES_PRISMA_URL: comUsuario(remoto(urlCi()), PAPEL_SEM_HISTORICO, 'leitor-r4'),
      MIGRATION_DATABASE_URL: remoto(urlCi()),
      FUSO_EXPECTED_SYSTEM_IDENTIFIER: await sid(),
      RELEASE_ALVO_ATESTADO: 'teste',
    }, aplicarArgs(caminho));
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stderr, /histórico de migrations difere/);
    assert.deepEqual(await fotografia(prisma()), antes);
  });

  test('R4-5: comparação de N identidades — histórico, banco, OID ou SID divergentes reprovam; iguais aprovam', () => {
    const base = { ok: true, sid: '7000000000000000001', banco: 'b', banco_oid: '16384', tem_historico: true, historico: 'h1', migrations: 30 };
    assert.equal(alvoLib.compararIdentidades({ esperadoSid: base.sid, identidades: [['fuso', base], ['runtime', base], ['migration', base]] }).ok, true);
    for (const [campo, valor] of [['historico', 'h2'], ['banco', 'outro'], ['banco_oid', '99999'], ['sid', '7000000000000000002']]) {
      const v = alvoLib.compararIdentidades({ esperadoSid: base.sid, identidades: [['fuso', { ...base, [campo]: valor }], ['runtime', base], ['migration', base]] });
      assert.equal(v.ok, false, campo);
      assert.ok(v.falhas.length > 0, campo);
      assert.ok(!JSON.stringify(v).includes(base.sid), `${campo}: sem SID na falha`);
    }
    assert.equal(alvoLib.compararIdentidades({ esperadoSid: base.sid, identidades: [['fuso', { ok: false, erro: 'sem acesso (42501)' }], ['runtime', base], ['migration', base]] }).ok, false);
    assert.equal(alvoLib.compararIdentidades({ esperadoSid: base.sid, identidades: [['fuso', base]] }).ok, false, 'menos de duas conexões nunca prova nada');
  });
});

// ═══ TOCTOU: a conexão que escreve é conferida DENTRO da transação ═════

describe('PR190-R4 — identidade reconferida dentro da transação de escrita', () => {
  test('R4-6: identidade aprovada de OUTRO banco → a transação recusa antes de gravar; a identidade certa grava 1 vez', async () => {
    const t = await semear(prisma());
    const executar = (url, sql) => alvoLib.executorPrisma(url, sql);
    const idOutro = await alvoLib.lerIdentidade(comBanco(urlCi(), BANCO_OUTRO), executar);
    const idCerto = await alvoLib.lerIdentidade(urlCi(), executar);
    assert.ok(idOutro.ok && idCerto.ok && idOutro.sid === idCerto.sid && idOutro.banco_oid !== idCerto.banco_oid);
    const antes = await fotografia(prisma());
    await assert.rejects(lib.aplicarPlanoFusos(prisma(), planoDe(t), { identidadeEsperada: idOutro }), (e) => e.codigo === 'TARGET_UNVERIFIED');
    assert.deepEqual(await fotografia(prisma()), antes, 'nada gravado');
    await assert.rejects(lib.planejarFusos(prisma(), planoDe(t), { identidadeEsperada: idOutro }), (e) => e.codigo === 'TARGET_UNVERIFIED');
    const r = await lib.aplicarPlanoFusos(prisma(), planoDe(t), { identidadeEsperada: idCerto });
    assert.equal(r.mudancas, 1);
    const rs = await Promise.all([1, 2].map(() => lib.aplicarPlanoFusos(prisma(), planoDe(t), { identidadeEsperada: idCerto })));
    assert.deepEqual(rs.map((x) => x.mudancas), [0, 0]);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: t.cliente.id, request_id: { startsWith: 'fuso-release:' } } }), 1);
  });

  test('R4-7: migration aplicada entre a verificação e a escrita (histórico mudou) → recusa dentro da transação', async () => {
    const t = await semear(prisma());
    const idCerto = await alvoLib.lerIdentidade(urlCi(), (url, sql) => alvoLib.executorPrisma(url, sql));
    const p = prisma();
    const nome = `20991231000000_r4_toctou_${randomUUID().slice(0, 6)}`;
    await p.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('${randomUUID()}', 'x', '${nome}', now(), now(), 1)`);
    try {
      const antes = await fotografia(p);
      await assert.rejects(lib.aplicarPlanoFusos(p, planoDe(t), { identidadeEsperada: idCerto }), (e) => e.codigo === 'TARGET_UNVERIFIED');
      assert.equal((await p.empresa.findUnique({ where: { id: t.empresa.id } })).fuso_horario, null);
      assert.equal((await fotografia(p)).audits, antes.audits);
    } finally {
      await p.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name = '${nome}'`);
    }
  });
});

// Sanidade do ambiente: o banco auxiliar é do MESMO cluster e é outro banco lógico.
test('R4-0: banco auxiliar no mesmo cluster (mesmo SID) e outro OID', async () => {
  const executar = (url, sql) => alvoLib.executorPrisma(url, sql);
  const a = await alvoLib.lerIdentidade(urlCi(), executar);
  const b = await alvoLib.lerIdentidade(comBanco(urlCi(), BANCO_OUTRO), executar);
  assert.ok(a.ok && b.ok);
  assert.equal(a.sid, b.sid);
  assert.notEqual(a.banco_oid, b.banco_oid);
  await criarTenant();
});
