/**
 * PR190-R3 (D-PROD-122) — fechamento do portão de release do fuso.
 *
 * G1  Alvo: em caminho NÃO local, READY exige SEMPRE as duas conexões (runtime
 *     pela precedência do env.js + MIGRATION_DATABASE_URL), o system_identifier
 *     esperado e o atestado de quem o obteve; as duas têm de ser o MESMO banco
 *     (cluster, banco lógico e histórico). Uma só URL, SID ausente, atestado
 *     ausente ou alvos divergentes → BLOCKED/TARGET_UNVERIFIED. Nunca SID/URL
 *     na saída.
 * G2  Confidencialidade: a saída padrão dos CLIs nunca traz cliente_id,
 *     empresa_id ou administrador crus (sucesso, erro, reaplicação, rollback);
 *     plano dentro do repositório recusado também via symlink (caminho real).
 * G3  Parâmetros repetidos/desconhecidos recusados sem efeito; SID ilegível
 *     (sem permissão) → TARGET_UNVERIFIED, nunca falha técnica genérica.
 *
 * Caminho "não local" contra o banco de TESTE: um nome de host que não é literal
 * local (hostname da máquina ou alias do /etc/hosts) mas chega ao mesmo
 * PostgreSQL descartável — exercita o ramo remoto sem nenhum banco remoto.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

const lib = await import('../../scripts/ops/fusoReleaseLib.mjs');

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;
let aliasRemoto = null;
before(async () => {
  process.env.NODE_ENV = 'test';
  app = await criarApp();
  await app.ready();
  // Um nome de host que NÃO é literal local (localhost/127.0.0.1/::1) mas chega
  // ao MESMO PostgreSQL de teste: o hostname da máquina (CI: IP do runner, onde a
  // porta do serviço postgres está publicada; aqui: /etc/hosts) ou aliases do
  // /etc/hosts. Escolhido por conexão real; nenhum banco remoto é contatado.
  const { PrismaClient } = await import('@prisma/client');
  for (const candidato of ['maike-alvo-teste', hostname(), 'vm', 'runsc', 'localhost.localdomain']) {
    if (!candidato || ['localhost', '127.0.0.1', '::1'].includes(candidato)) continue;
    try {
      await lookup(candidato);
      const u = new URL(process.env.DATABASE_URL);
      u.hostname = candidato;
      const cliente = new PrismaClient({ datasourceUrl: u.toString() });
      try {
        await cliente.$queryRawUnsafe('SELECT 1');
        aliasRemoto = candidato;
      } finally {
        await cliente.$disconnect();
      }
      if (aliasRemoto) break;
    } catch { /* próximo candidato */ }
  }
});
after(async () => {
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const SP = 'America/Sao_Paulo';
const REPO = join(import.meta.dirname, '..', '..');
const FRASE = 'APLICAR_FUSOS_DAS_FAZENDAS';
const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const urlLocal = () => process.env.DATABASE_URL;
/** Mesma conexão local, mas com host "não local" (ramo remoto dos scripts). */
const urlRemotaSimulada = (url = urlLocal()) => {
  assert.ok(aliasRemoto, 'nenhum nome de host não literal chega ao PostgreSQL de teste (hostname da máquina, vm, runsc)');
  const u = new URL(url);
  u.hostname = aliasRemoto;
  return u.toString();
};
const outroBancoLocal = () => {
  const u = new URL(urlLocal());
  u.pathname = '/postgres';
  return u.toString();
};
const sidLocal = async () => (await prisma().$queryRaw`SELECT system_identifier::text AS sid FROM pg_control_system()`)[0].sid;
const rodar = (script, env, argumentos = []) => spawnSync(process.execPath, [join(REPO, script), ...argumentos], {
  cwd: REPO, encoding: 'utf8', timeout: 60_000,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', ...env },
});
const preflight = (env, args = []) => {
  const r = rodar('scripts/deploy/preflight-fuso-release.mjs', env, args);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* saída não JSON */ }
  return { ...r, json };
};

/** Tenant com empresa ATIVADA e fuso configurado (dados prontos), ids sintéticos. */
const dadosProntos = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const r = await req('POST', '/empresas', tok, { apelido: 'FAZ', nome: `FAZENDA ${randomUUID().slice(0, 6)}`, tipo_pessoa: 'Jurídica', fuso_horario: SP });
  assert.equal(r.statusCode, 201, r.body);
  return { cliente: adm.cliente, admin: adm.usuario, tok, empresa: r.json() };
};
const tenantSemFuso = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const r = await req('POST', '/empresas', tok, { apelido: 'FAZ', nome: `FAZENDA ${randomUUID().slice(0, 6)}`, tipo_pessoa: 'Jurídica' });
  assert.equal(r.statusCode, 201, r.body);
  return { cliente: adm.cliente, admin: adm.usuario, tok, empresa: r.json() };
};
const planoDe = (t, itens) => ({ administradores: { [t.cliente.id]: t.admin.id }, empresas: itens.map((x) => ({ cliente_id: t.cliente.id, empresa_id: t.empresa.id, ...x })) });
const arquivoPlano = (conteudo) => {
  const dir = mkdtempSync(join(tmpdir(), 'plano-fuso-r3-'));
  const caminho = join(dir, 'plano.json');
  writeFileSync(caminho, JSON.stringify(conteudo));
  return caminho;
};
const semSegredos = (texto, t, extras = []) => {
  for (const v of [t.cliente.id, t.empresa.id, t.admin.id, ...extras].filter(Boolean)) {
    assert.ok(!texto.includes(v), `saída expôs identificador cru (${v.slice(0, 4)}…)`);
  }
};

// ═══ G1 — runtime × migration obrigatórios no ramo não local ════════════════

describe('PR190-R3 G1 — alvo de release: duas conexões, SID esperado e atestado', () => {
  test('G1-RED1: só a URL do runtime (sem MIGRATION_DATABASE_URL) + SID correto → BLOCKED/TARGET_UNVERIFIED (antes podia dar READY)', async () => {
    await dadosProntos();
    const r = preflight({ POSTGRES_PRISMA_URL: urlRemotaSimulada(), MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: await sidLocal(), RELEASE_ALVO_ATESTADO: 'teste' });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.equal(r.json?.estado, 'BLOCKED', r.stdout);
    assert.equal(r.json?.TARGET, 'TARGET_UNVERIFIED');
    assert.ok(r.json?.motivos_alvo?.includes('MIGRATION_DATABASE_URL_AUSENTE'), r.stdout);
  });

  test('G1-RED2: runtime e migration em bancos diferentes do mesmo cluster → BLOCKED (mesmo SID não basta)', async () => {
    await dadosProntos();
    const r = preflight({ POSTGRES_PRISMA_URL: urlRemotaSimulada(), MIGRATION_DATABASE_URL: urlRemotaSimulada(outroBancoLocal()), MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: await sidLocal(), RELEASE_ALVO_ATESTADO: 'teste' });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.equal(r.json?.estado, 'BLOCKED');
    assert.equal(r.json?.TARGET, 'TARGET_UNVERIFIED');
  });

  test('G1-RED3: SID ausente, inválido, divergente ou sem atestado → BLOCKED sem conectar/sem revelar', async () => {
    await dadosProntos();
    const sid = await sidLocal();
    const base = { POSTGRES_PRISMA_URL: urlRemotaSimulada(), MIGRATION_DATABASE_URL: urlRemotaSimulada() };
    for (const [env, motivo] of [
      [{ ...base, RELEASE_ALVO_ATESTADO: 'teste' }, 'SID_ESPERADO_AUSENTE'],
      [{ ...base, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: 'abc', RELEASE_ALVO_ATESTADO: 'teste' }, 'SID_ESPERADO_AUSENTE'],
      [{ ...base, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '1234567890123456789', RELEASE_ALVO_ATESTADO: 'teste' }, 'ALVOS_NAO_CONFEREM'],
      [{ ...base, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid }, 'ATESTADO_AUSENTE'],
    ]) {
      const r = preflight(env);
      assert.equal(r.status, 3, `${motivo}: ${r.stdout}${r.stderr}`);
      assert.equal(r.json?.TARGET, 'TARGET_UNVERIFIED', motivo);
      assert.ok(r.json?.motivos_alvo?.includes(motivo), `${motivo}: ${r.stdout}`);
      const saida = r.stdout + r.stderr;
      assert.ok(!saida.includes(sid) && !/vm:|127\.0\.0\.1|postgres(ql)?:\/\//.test(saida), `${motivo}: vazou SID/URL`);
    }
  });

  test('G1-RED4: alvo inalcançável → TARGET_UNVERIFIED (não "falha técnica" genérica), sem URL na saída', async () => {
    const r = preflight({ POSTGRES_PRISMA_URL: 'postgresql://u:segredo@127.0.0.9:1/x', MIGRATION_DATABASE_URL: 'postgresql://u:segredo@127.0.0.9:1/x', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '1234567890123456789', RELEASE_ALVO_ATESTADO: 'teste' });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.equal(r.json?.TARGET, 'TARGET_UNVERIFIED');
    assert.ok(!(r.stdout + r.stderr).includes('segredo'));
  });

  test('G1-GREEN: duas URLs para o MESMO banco, SID e atestado → READY_ALVO_CONFERIDO (estado distinto do local), sem SID/ids na saída', async () => {
    const t = await dadosProntos();
    const sid = await sidLocal();
    const r = preflight({ POSTGRES_PRISMA_URL: urlRemotaSimulada(), MIGRATION_DATABASE_URL: urlRemotaSimulada(), MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, RELEASE_ALVO_ATESTADO: 'SID lido pelo proprietário no SQL Editor do projeto autorizado' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([r.json.estado, r.json.TARGET, r.json.SCHEMA_READY, r.json.DATA_READY], ['READY_ALVO_CONFERIDO', 'ALVOS_CONFEREM_SID_ATESTADO', true, true]);
    assert.equal(r.json.atestado_alvo, 'informado');
    semSegredos(r.stdout + r.stderr, t, [sid]);
  });

  test('G1-LOCAL: banco local descartável → READY_LOCAL_TESTE (nunca rotulado como produção); --mostrar-ids só local', async () => {
    const t = await dadosProntos();
    const r = preflight({ DATABASE_URL: urlLocal() });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([r.json.estado, r.json.TARGET], ['READY_LOCAL_TESTE', 'LOCAL_TESTE']);
    semSegredos(r.stdout, t);
    const remotoComIds = preflight({ POSTGRES_PRISMA_URL: urlRemotaSimulada(), MIGRATION_DATABASE_URL: urlRemotaSimulada(), MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: await sidLocal(), RELEASE_ALVO_ATESTADO: 'x' }, ['--mostrar-ids']);
    assert.equal(remotoComIds.status, 2, remotoComIds.stdout + remotoComIds.stderr);
  });

  test('G1-ARGS: argumento repetido ou desconhecido → uso incorreto (2), nada lido', () => {
    assert.equal(preflight({ DATABASE_URL: urlLocal() }, ['--mostrar-ids', '--mostrar-ids']).status, 2);
    assert.equal(preflight({ DATABASE_URL: urlLocal() }, ['--qualquer']).status, 2);
  });
});

// ═══ G2 — confidencialidade dos identificadores e do plano ══════════════════

describe('PR190-R3 G2 — saídas sem identificadores crus; plano fora do repositório (caminho real)', () => {
  test('G2-RED1: simulação, aplicação e reaplicação do CLI não imprimem cliente_id/empresa_id/administrador', async () => {
    const t = await tenantSemFuso();
    const caminho = arquivoPlano(planoDe(t, [{ fuso_horario: SP }]));
    const env = { FUSO_DATABASE_URL: urlLocal() };
    const sim = rodar('scripts/ops/configurar-fuso-empresas.mjs', env, ['--plano', caminho]);
    assert.equal(sim.status, 0, sim.stderr);
    semSegredos(sim.stdout + sim.stderr, t);
    const ap = rodar('scripts/ops/configurar-fuso-empresas.mjs', env, ['--plano', caminho, '--aplicar', '--confirmar', FRASE]);
    assert.equal(ap.status, 0, ap.stderr);
    semSegredos(ap.stdout + ap.stderr, t);
    assert.match(ap.stdout, /"empresa": "h:[0-9a-f]{12}"/);
    const re = rodar('scripts/ops/configurar-fuso-empresas.mjs', env, ['--plano', caminho, '--aplicar', '--confirmar', FRASE]);
    assert.equal(re.status, 0, re.stderr);
    semSegredos(re.stdout + re.stderr, t);
    // Internamente a auditoria usa os ids reais.
    const log = await prisma().auditLog.findFirst({ where: { cliente_id: t.cliente.id, entidade_id: t.empresa.id, request_id: { startsWith: 'fuso-release:' } } });
    assert.equal(log.usuario_id, t.admin.id);
  });

  test('G2-RED2: recusa (rollback) também não imprime ids crus, nem nos detalhes do erro', async () => {
    const t = await tenantSemFuso();
    const caminho = arquivoPlano({ administradores: { [t.cliente.id]: t.admin.id }, empresas: [
      { cliente_id: t.cliente.id, empresa_id: t.empresa.id, fuso_horario: SP },
      { cliente_id: t.cliente.id, empresa_id: `inexistente-${randomUUID()}`, fuso_horario: SP },
    ] });
    const antes = await prisma().empresa.findUnique({ where: { id: t.empresa.id } });
    const r = rodar('scripts/ops/configurar-fuso-empresas.mjs', { FUSO_DATABASE_URL: urlLocal() }, ['--plano', caminho, '--aplicar', '--confirmar', FRASE]);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    semSegredos(r.stdout + r.stderr, t);
    assert.equal((await prisma().empresa.findUnique({ where: { id: t.empresa.id } })).fuso_horario, antes.fuso_horario, 'nada parcial');
    // Biblioteca: o erro serializado também sai sem ids crus.
    await assert.rejects(lib.aplicarPlanoFusos(prisma(), { administradores: { [t.cliente.id]: t.admin.id }, empresas: [{ cliente_id: t.cliente.id, empresa_id: 'nao-existe', fuso_horario: SP }] }), (e) => {
      semSegredos(JSON.stringify({ m: e.message, d: e.detalhes }), t);
      return true;
    });
  });

  test('G2-RED3: plano dentro do repositório recusado mesmo por symlink de fora (caminho real), sem ler o plano', () => {
    const raizFalsa = mkdtempSync(join(tmpdir(), 'repo-falso-'));
    mkdirSync(join(raizFalsa, 'dados'));
    const dentro = join(raizFalsa, 'dados', 'plano.json');
    writeFileSync(dentro, '{}');
    const fora = mkdtempSync(join(tmpdir(), 'fora-'));
    const atalho = join(fora, 'plano.json');
    symlinkSync(dentro, atalho);
    assert.equal(lib.planoForaDoRepositorio(dentro, raizFalsa), false);
    assert.equal(lib.planoForaDoRepositorio(atalho, raizFalsa), false, 'symlink de fora apontando para dentro do repo');
    assert.equal(lib.planoForaDoRepositorio(join(fora, 'nao-existe.json'), raizFalsa), false, 'inexistente = não comprovado');
    const outro = join(fora, 'real.json');
    writeFileSync(outro, '{}');
    assert.equal(lib.planoForaDoRepositorio(outro, raizFalsa), true);
  });

  test('G2-ARGS: CLI de configuração recusa argumento repetido (ex.: dois --plano) com código de uso', async () => {
    const t = await tenantSemFuso();
    const a = arquivoPlano(planoDe(t, [{ fuso_horario: SP }]));
    const r = rodar('scripts/ops/configurar-fuso-empresas.mjs', { FUSO_DATABASE_URL: urlLocal() }, ['--plano', a, '--plano', a]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal((await prisma().empresa.findUnique({ where: { id: t.empresa.id } })).fuso_horario, null);
  });

  test('G2-REMOTO: configuração em alvo não local exige SID, atestado e backup; com SID errado recusa sem gravar', async () => {
    const t = await tenantSemFuso();
    const caminho = arquivoPlano(planoDe(t, [{ fuso_horario: SP }]));
    const env = { FUSO_DATABASE_URL: urlRemotaSimulada() };
    const semSid = rodar('scripts/ops/configurar-fuso-empresas.mjs', env, ['--plano', caminho]);
    assert.equal(semSid.status, 3);
    const semAtestado = rodar('scripts/ops/configurar-fuso-empresas.mjs', { ...env, FUSO_EXPECTED_SYSTEM_IDENTIFIER: await sidLocal() }, ['--plano', caminho, '--aplicar', '--confirmar', FRASE, '--referencia-backup', 'pitr']);
    assert.equal(semAtestado.status, 3);
    assert.match(semAtestado.stderr, /ATESTADO_AUSENTE/);
    const sidErrado = rodar('scripts/ops/configurar-fuso-empresas.mjs', { ...env, FUSO_EXPECTED_SYSTEM_IDENTIFIER: '1234567890123456789', RELEASE_ALVO_ATESTADO: 'x' }, ['--plano', caminho, '--aplicar', '--confirmar', FRASE, '--referencia-backup', 'pitr']);
    assert.equal(sidErrado.status, 3);
    assert.match(sidErrado.stderr, /ALVO_DIVERGENTE/);
    for (const r of [semSid, semAtestado, sidErrado]) semSegredos(r.stdout + r.stderr, t, [await sidLocal()]);
    assert.equal((await prisma().empresa.findUnique({ where: { id: t.empresa.id } })).fuso_horario, null);
  });
});
