/**
 * PR190-R2 (D-PROD-122) — portão de release do fuso, em PostgreSQL LOCAL.
 *
 * Matriz:
 *  A. schema ausente (coluna/migration) + código novo → P2022 no SELECT implícito
 *     de Empresa; o preflight diz SCHEMA_READY=false (BLOCKED) — prova de que o
 *     deploy antes da migration quebra e de que o portão o detecta;
 *  B. schema pronto + empresa ATIVADA sem fuso → DATA_READY=false (BLOCKED);
 *     leitura segue, escrita nova 409 sem gravar;
 *  C. fuso configurado pelo plano one-shot (sem o runtime novo) → READY; hoje
 *     passa, amanhã 409;
 *  D. alvo errado, tenant errado, empresa ausente, IANA inválido, administrador
 *     inválido, troca sem motivo, duplicata, migration divergente, sem backup/
 *     confirmação → recusa sem nenhuma mutação;
 *  E. idempotência, concorrência e AuditLog do plano;
 *  F. os CLIs novos não falam com nada além do banco informado (sem rede) e
 *     recusam alvo remoto sem identificador ANTES de conectar.
 * Cada transação de "schema ausente" é desfeita (ROLLBACK): o banco de teste
 * termina como começou.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { comRelogioDeTeste } from '../src/modules/rebanhoLedger/rebanhoLedgerTempo.js';
import {
  aplicarPlanoFusos, diagnosticarProntidaoFuso, planejarFusos, validarBarreirasCli, FRASE_CONFIRMACAO, MIGRATION_FUSO, FusoReleaseRecusado,
} from '../../scripts/ops/fusoReleaseLib.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;
before(async () => {
  process.env.NODE_ENV = 'test';
  app = await criarApp();
  await app.ready();
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
const CUIABA = 'America/Cuiaba';
const MEIO_DIA_04 = '2026-11-04T15:00:00.000Z';
const REPO = join(import.meta.dirname, '..', '..');
const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });

/** Empresa ATIVADA no ledger e SEM fuso (como em produção antes do backfill). */
const tenantComEmpresaAtivada = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const r = await req('POST', '/empresas', tok, { apelido: 'FAZ', nome: `FAZENDA ${randomUUID().slice(0, 6)}`, tipo_pessoa: 'Jurídica' });
  assert.equal(r.statusCode, 201, r.body);
  const empresa = r.json();
  assert.equal(empresa.fuso_horario, null);
  return { cliente: adm.cliente, admin: adm.usuario, tok, empresa };
};
const plano = (t, itens) => ({ administradores: { [t.cliente.id]: t.admin.id }, empresas: itens.map((x) => ({ cliente_id: t.cliente.id, empresa_id: t.empresa.id, ...x })) });
const fotografia = async () => {
  const p = prisma();
  return {
    empresas: (await p.empresa.findMany({ orderBy: { id: 'asc' } })).map((e) => [e.id, e.fuso_horario, e.updatedAt.toISOString()]),
    audits: await p.auditLog.count(),
  };
};
const exigirRecusa = async (acao, codigo) => {
  const antes = await fotografia();
  await assert.rejects(acao, (e) => {
    assert.ok(e instanceof FusoReleaseRecusado, String(e));
    assert.equal(e.codigo, codigo, e.message);
    return true;
  });
  assert.deepEqual(await fotografia(), antes, `${codigo}: nada pode mudar`);
};
/** Executa `fn` numa transação que SEMPRE é desfeita. */
const emTransacaoDesfeita = async (fn) => {
  const SENTINELA = new Error('rollback-intencional');
  let resultado;
  await assert.rejects(prisma().$transaction(async (tx) => {
    resultado = await fn(tx);
    throw SENTINELA;
  }), (e) => e === SENTINELA);
  return resultado;
};
const sidLocal = async () => (await prisma().$queryRaw`SELECT system_identifier::text AS sid FROM pg_control_system()`)[0].sid;
const rodar = (script, env, argumentos = []) => spawnSync(process.execPath, [join(REPO, script), ...argumentos], {
  cwd: REPO, encoding: 'utf8', timeout: 60_000,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', ...env },
});
const arquivoPlano = (conteudo) => {
  const dir = mkdtempSync(join(tmpdir(), 'plano-fuso-'));
  const caminho = join(dir, 'plano.json');
  writeFileSync(caminho, JSON.stringify(conteudo));
  return caminho;
};

// ═══ A. schema ausente + código novo ═════════════════════════════════════

describe('PR190-R2 A — schema ausente com o runtime novo', () => {
  test('A1: sem a coluna, o SELECT implícito de Empresa falha (P2022) e o preflight dá SCHEMA_READY=false', async () => {
    await tenantComEmpresaAtivada();
    const r = await emTransacaoDesfeita(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "Empresa" DROP COLUMN "fuso_horario"');
      // O erro aborta a transação no PostgreSQL: isola-o num SAVEPOINT.
      await tx.$executeRawUnsafe('SAVEPOINT leitura_runtime_novo');
      const erro = await tx.empresa.findMany().then(() => null, (e) => e);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT leitura_runtime_novo');
      return { erro, diag: await diagnosticarProntidaoFuso(tx) };
    });
    assert.equal(r.erro?.code, 'P2022', `deploy antes da migration quebra a leitura de Empresa: ${r.erro?.code}`);
    assert.equal(r.diag.estado, 'BLOCKED');
    assert.equal(r.diag.SCHEMA_READY, false);
    assert.ok(r.diag.schema.motivos.includes('COLUNA_AUSENTE'), JSON.stringify(r.diag));
    assert.equal(r.diag.DATA_READY, false);
    // A transação foi desfeita: a coluna continua lá.
    assert.equal((await diagnosticarProntidaoFuso(prisma())).SCHEMA_READY, true);
  });

  test('A2: migration ausente, divergente ou revertida → BLOCKED com o motivo exato', async () => {
    for (const [sql, motivo] of [
      [`DELETE FROM "_prisma_migrations" WHERE migration_name = '${MIGRATION_FUSO}'`, 'MIGRATION_NAO_APLICADA'],
      [`UPDATE "_prisma_migrations" SET checksum = 'x' WHERE migration_name = '${MIGRATION_FUSO}'`, 'MIGRATION_CHECKSUM_DIVERGENTE'],
      [`UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE migration_name = '${MIGRATION_FUSO}'`, 'MIGRATION_REVERTIDA'],
    ]) {
      const d = await emTransacaoDesfeita(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        return diagnosticarProntidaoFuso(tx);
      });
      assert.equal(d.SCHEMA_READY, false, motivo);
      assert.ok(d.schema.motivos.includes(motivo), `${motivo}: ${JSON.stringify(d.schema)}`);
    }
  });

  test('A3: plano de fuso com schema ausente → SCHEMA_NAO_PRONTO, sem ler a coluna nem gravar', async () => {
    const t = await tenantComEmpresaAtivada();
    const codigo = await emTransacaoDesfeita(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "Empresa" DROP COLUMN "fuso_horario"');
      return planejarFusos(tx, plano(t, [{ fuso_horario: SP }])).then(() => null, (e) => e.codigo);
    });
    assert.equal(codigo, 'SCHEMA_NAO_PRONTO');
  });
});

// ═══ B. schema pronto, empresa ativada sem fuso ══════════════════════════

describe('PR190-R2 B — empresa ativada sem fuso', () => {
  test('B1: DATA_READY=false (BLOCKED) com a empresa pendente; leitura segue; escrita nova 409 sem gravar', () => comRelogioDeTeste(MEIO_DIA_04, async () => {
    const t = await tenantComEmpresaAtivada();
    const d = await diagnosticarProntidaoFuso(prisma());
    assert.equal(d.estado, 'BLOCKED');
    assert.equal(d.SCHEMA_READY, true);
    assert.equal(d.DATA_READY, false);
    assert.deepEqual(d.dados.pendentes, [{ cliente_id: t.cliente.id, empresa_id: t.empresa.id, motivo: 'FUSO_AUSENTE' }]);
    assert.equal((await req('GET', '/empresas', t.tok)).statusCode, 200);
    assert.equal((await req('GET', `/rebanho/posicoes?empresa_id=${t.empresa.id}`, t.tok)).statusCode, 200);
    const p = prisma();
    const setor = await p.setor.create({ data: { cliente_id: t.cliente.id, empresa_id: t.empresa.id, numero_setor: '1', nome: 'S' } });
    const area = await p.areaPastagem.create({ data: { cliente_id: t.cliente.id, empresa_id: t.empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: '1', nome: 'A', tamanho_hectares: 10 } });
    const antes = { lotes: await p.lote.count(), eventos: await p.eventoRebanho.count(), audits: await p.auditLog.count(), ops: await p.operacaoIdempotente.count() };
    const r = await req('POST', '/lotes', t.tok, { empresa_id: t.empresa.id, nome: 'L', quantidade_cabecas: 5, categoria: 'Boi 25 a 36 meses', sexo: 'Macho', setor_id: setor.id, area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-11-04', motivo_entrada: 'Compra', status: 'Ativo' });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'EMPRESA_FUSO_NAO_CONFIGURADO');
    assert.match(r.json().message, /Fuso horário da fazenda/);
    assert.deepEqual({ lotes: await p.lote.count(), eventos: await p.eventoRebanho.count(), audits: await p.auditLog.count(), ops: await p.operacaoIdempotente.count() }, antes);
  }));

  test('B2: empresa NÃO ativada sem fuso não bloqueia o portão (só as ativadas contam)', async () => {
    const adm = await criarTenant({ papelTenant: 'administrador' });
    await prisma().empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'L', nome: 'LEGADA' } });
    const d = await diagnosticarProntidaoFuso(prisma());
    assert.equal(d.estado, 'READY', JSON.stringify(d));
    assert.equal(d.dados.ativadas, 0);
  });
});

// ═══ C. plano one-shot → READY; operação normal ══════════════════════════

describe('PR190-R2 C — fuso configurado pelo plano, sem o runtime novo', () => {
  test('C1: aplicar o plano → READY; hoje passa e amanhã 409 nas bordas do fuso configurado', () => comRelogioDeTeste('2026-11-05T03:30:00.000Z', async () => {
    // 00:30 de 05/11 em SP | 23:30 de 04/11 em Cuiabá.
    const t = await tenantComEmpresaAtivada();
    const r = await aplicarPlanoFusos(prisma(), plano(t, [{ fuso_horario: 'america/cuiaba' }]), { referenciaBackup: 'teste-local' });
    assert.equal(r.mudancas, 1);
    assert.equal((await diagnosticarProntidaoFuso(prisma())).estado, 'READY');
    const p = prisma();
    const setor = await p.setor.create({ data: { cliente_id: t.cliente.id, empresa_id: t.empresa.id, numero_setor: '1', nome: 'S' } });
    const area = await p.areaPastagem.create({ data: { cliente_id: t.cliente.id, empresa_id: t.empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: '1', nome: 'A', tamanho_hectares: 10 } });
    const lote = (data) => req('POST', '/lotes', t.tok, { empresa_id: t.empresa.id, nome: `L${data}`, quantidade_cabecas: 5, categoria: 'Boi 25 a 36 meses', sexo: 'Macho', setor_id: setor.id, area_entrada_id: area.id, area_atual_id: area.id, data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo' });
    assert.equal((await lote('2026-11-04')).statusCode, 201, 'hoje em Cuiabá');
    const futuro = await lote('2026-11-05');
    assert.equal(futuro.statusCode, 409, futuro.body);
    assert.deepEqual(futuro.json().details, { data: '2026-11-05', hoje: '2026-11-04', fuso: CUIABA });
  }));

  test('C2: CLIs locais — preflight BLOCKED → plano simulado (nada gravado) → aplicado → preflight READY', async () => {
    const t = await tenantComEmpresaAtivada();
    const envLocal = { DATABASE_URL: process.env.DATABASE_URL };
    const pre = rodar('scripts/deploy/preflight-fuso-release.mjs', envLocal, ['--mostrar-ids']);
    assert.equal(pre.status, 3, pre.stderr + pre.stdout);
    const j = JSON.parse(pre.stdout);
    assert.deepEqual([j.estado, j.TARGET, j.SCHEMA_READY, j.DATA_READY], ['BLOCKED', 'LOCAL_TESTE', true, false]);
    assert.equal(j.empresas_sem_fuso[0].empresa_id, t.empresa.id);
    const semIds = JSON.parse(rodar('scripts/deploy/preflight-fuso-release.mjs', envLocal).stdout);
    assert.ok(!JSON.stringify(semIds).includes(t.empresa.id), 'sem --mostrar-ids, ids em hash');

    const caminho = arquivoPlano(plano(t, [{ fuso_horario: SP }]));
    const antes = await fotografia();
    const sim = rodar('scripts/ops/configurar-fuso-empresas.mjs', { FUSO_DATABASE_URL: process.env.DATABASE_URL }, ['--plano', caminho]);
    assert.equal(sim.status, 0, sim.stderr);
    assert.match(sim.stdout, /"modo": "SIMULACAO"/);
    assert.deepEqual(await fotografia(), antes, 'simulação não grava');
    const ap = rodar('scripts/ops/configurar-fuso-empresas.mjs', { FUSO_DATABASE_URL: process.env.DATABASE_URL, FUSO_EXPECTED_SYSTEM_IDENTIFIER: await sidLocal() }, ['--plano', caminho, '--aplicar', '--confirmar', FRASE_CONFIRMACAO]);
    assert.equal(ap.status, 0, ap.stderr);
    assert.match(ap.stdout, /"modo": "APLICADO"/);
    const pos = rodar('scripts/deploy/preflight-fuso-release.mjs', envLocal);
    assert.equal(pos.status, 0, pos.stdout);
    assert.equal(JSON.parse(pos.stdout).estado, 'READY_LOCAL_TESTE');
  });
});

// ═══ D. recusas sem mutação ═════════════════════════════════════════════

describe('PR190-R2 D — recusas fail-closed, sem nenhuma mutação', () => {
  test('D1: tenant errado, empresa ausente, IANA inválido, administrador inválido, duplicata, troca sem motivo', async () => {
    const a = await tenantComEmpresaAtivada();
    const b = await tenantComEmpresaAtivada();
    // Empresa de B listada sob o cliente A.
    await exigirRecusa(() => aplicarPlanoFusos(prisma(), { administradores: { [a.cliente.id]: a.admin.id }, empresas: [{ cliente_id: a.cliente.id, empresa_id: b.empresa.id, fuso_horario: SP }] }), 'EMPRESA_FORA_DO_ESCOPO');
    await exigirRecusa(() => aplicarPlanoFusos(prisma(), plano(a, [{ empresa_id: 'nao-existe', fuso_horario: SP }])), 'EMPRESA_FORA_DO_ESCOPO');
    for (const ruim of ['-03:00', 'Mars/Phobos', 'BR', '']) {
      await exigirRecusa(() => aplicarPlanoFusos(prisma(), plano(a, [{ fuso_horario: ruim }])), 'FUSO_INVALIDO');
    }
    // Administrador de OUTRO cliente assinando por A; usuário comum de A.
    await exigirRecusa(() => aplicarPlanoFusos(prisma(), { administradores: { [a.cliente.id]: b.admin.id }, empresas: [{ cliente_id: a.cliente.id, empresa_id: a.empresa.id, fuso_horario: SP }] }), 'ADMINISTRADOR_OBRIGATORIO');
    const comum = await prisma().usuario.create({ data: { cliente_id: a.cliente.id, nome: 'Comum', login: `c-${randomUUID().slice(0, 8)}`, senha_hash: 'x', papel_tenant: 'usuario' } });
    await exigirRecusa(() => aplicarPlanoFusos(prisma(), { administradores: { [a.cliente.id]: comum.id }, empresas: [{ cliente_id: a.cliente.id, empresa_id: a.empresa.id, fuso_horario: SP }] }), 'ADMINISTRADOR_OBRIGATORIO');
    await exigirRecusa(() => aplicarPlanoFusos(prisma(), plano(a, [{ fuso_horario: SP }, { fuso_horario: CUIABA }])), 'PLANO_DUPLICADO');
    await exigirRecusa(() => aplicarPlanoFusos(prisma(), { empresas: [{ cliente_id: a.cliente.id, empresa_id: a.empresa.id, fuso_horario: SP }] }), 'PLANO_INVALIDO');
    // Troca de fuso já configurado sem motivo.
    await aplicarPlanoFusos(prisma(), plano(a, [{ fuso_horario: SP }]));
    await exigirRecusa(() => aplicarPlanoFusos(prisma(), plano(a, [{ fuso_horario: CUIABA }])), 'TROCA_SEM_MOTIVO');
  });

  test('D2: um item ruim derruba o plano inteiro (nada parcial)', async () => {
    const a = await tenantComEmpresaAtivada();
    const outra = await req('POST', '/empresas', a.tok, { apelido: 'OUT', nome: `OUTRA ${randomUUID().slice(0, 6)}`, tipo_pessoa: 'Jurídica' });
    await exigirRecusa(() => aplicarPlanoFusos(prisma(), { administradores: { [a.cliente.id]: a.admin.id }, empresas: [
      { cliente_id: a.cliente.id, empresa_id: a.empresa.id, fuso_horario: SP },
      { cliente_id: a.cliente.id, empresa_id: outra.json().id, fuso_horario: SP },
      { cliente_id: a.cliente.id, empresa_id: 'nao-existe', fuso_horario: SP },
    ] }), 'EMPRESA_FORA_DO_ESCOPO');
  });

  test('D3: CLI — identificador divergente, sem frase de confirmação; barreiras de alvo remoto sem SID/backup', async () => {
    const t = await tenantComEmpresaAtivada();
    const caminho = arquivoPlano(plano(t, [{ fuso_horario: SP }]));
    const antes = await fotografia();
    const sid = rodar('scripts/ops/configurar-fuso-empresas.mjs', { FUSO_DATABASE_URL: process.env.DATABASE_URL, FUSO_EXPECTED_SYSTEM_IDENTIFIER: '123456789' }, ['--plano', caminho, '--aplicar', '--confirmar', FRASE_CONFIRMACAO]);
    assert.equal(sid.status, 3);
    assert.match(sid.stderr, /ALVO_DIVERGENTE/);
    const frase = rodar('scripts/ops/configurar-fuso-empresas.mjs', { FUSO_DATABASE_URL: process.env.DATABASE_URL }, ['--plano', caminho, '--aplicar']);
    assert.equal(frase.status, 3);
    assert.match(frase.stderr, /CONFIRMACAO_AUSENTE/);
    assert.deepEqual(await fotografia(), antes);
    assert.deepEqual(validarBarreirasCli({ local: false, esperadoSid: null, aplicar: false }), { ok: false, codigo: 'ALVO_SEM_IDENTIFICADOR', motivo: 'alvo remoto exige FUSO_EXPECTED_SYSTEM_IDENTIFIER' });
    assert.equal(validarBarreirasCli({ local: false, esperadoSid: '7000000000000000001', aplicar: true, confirmacao: FRASE_CONFIRMACAO, referenciaBackup: '' }).codigo, 'BACKUP_NAO_COMPROVADO');
    assert.equal(validarBarreirasCli({ local: false, esperadoSid: '7000000000000000001', aplicar: true, confirmacao: FRASE_CONFIRMACAO, referenciaBackup: 'pitr 2026-11-05 10:00' }).codigo, 'ATESTADO_AUSENTE', 'R3: aplicar em alvo remoto exige o atestado do SID');
    assert.equal(validarBarreirasCli({ local: false, esperadoSid: '7000000000000000001', aplicar: true, confirmacao: FRASE_CONFIRMACAO, referenciaBackup: 'pitr 2026-11-05 10:00', atestado: 'proprietário, SQL Editor' }).ok, true);
    // Alvo remoto sem identificador: recusado ANTES de conectar (host inexistente nem é contatado).
    const remoto = rodar('scripts/ops/configurar-fuso-empresas.mjs', { FUSO_DATABASE_URL: 'postgresql://u:x@db.invalido.example:5432/postgres' }, ['--plano', caminho]);
    assert.equal(remoto.status, 3);
    assert.match(remoto.stderr, /ALVO_SEM_IDENTIFICADOR/);
    assert.ok(!/invalido\.example|u:x/.test(remoto.stderr + remoto.stdout), 'nunca imprime a URL');
    const pre = rodar('scripts/deploy/preflight-fuso-release.mjs', { POSTGRES_PRISMA_URL: 'postgresql://u:x@db.invalido.example:5432/postgres' });
    assert.equal(pre.status, 3);
    assert.equal(JSON.parse(pre.stdout).TARGET, 'TARGET_UNVERIFIED');
  });
});

// ═══ E. idempotência, concorrência, auditoria ═══════════════════════════

describe('PR190-R2 E — idempotência, concorrência e AuditLog', () => {
  test('E1: reaplicar o mesmo plano não muda nada nem audita de novo; troca com motivo audita anterior/novo', async () => {
    const t = await tenantComEmpresaAtivada();
    const r1 = await aplicarPlanoFusos(prisma(), plano(t, [{ fuso_horario: SP }]), { referenciaBackup: 'bkp-1' });
    assert.equal(r1.mudancas, 1);
    const auditsDepois = await prisma().auditLog.count({ where: { cliente_id: t.cliente.id, entidade: 'Empresa', entidade_id: t.empresa.id } });
    const r2 = await aplicarPlanoFusos(prisma(), plano(t, [{ fuso_horario: SP }]));
    assert.equal(r2.mudancas, 0);
    assert.equal(r2.itens[0].acao, 'sem_mudanca');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: t.cliente.id, entidade: 'Empresa', entidade_id: t.empresa.id } }), auditsDepois);
    await aplicarPlanoFusos(prisma(), plano(t, [{ fuso_horario: CUIABA, motivo: 'fazenda fica em MT' }]), { referenciaBackup: 'bkp-2' });
    const [ultimo] = await prisma().auditLog.findMany({ where: { cliente_id: t.cliente.id, entidade: 'Empresa', entidade_id: t.empresa.id }, orderBy: { createdAt: 'desc' }, take: 1 });
    assert.equal(ultimo.usuario_id, t.admin.id);
    assert.deepEqual(ultimo.dados_anteriores, { fuso_horario: SP });
    assert.deepEqual(ultimo.dados_novos, { fuso_horario: CUIABA, motivo: 'fazenda fica em MT', operacao: 'configurar_fuso_horario_release', referencia_backup: 'bkp-2' });
    assert.match(ultimo.request_id, /^fuso-release:/);
  });

  test('E2: dois aplicadores simultâneos → um configura, o outro vê "sem mudança"; uma auditoria só', async () => {
    const t = await tenantComEmpresaAtivada();
    const rs = await Promise.all([1, 2].map(() => aplicarPlanoFusos(prisma(), plano(t, [{ fuso_horario: SP }]))));
    assert.deepEqual(rs.map((r) => r.mudancas).sort(), [0, 1]);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: t.cliente.id, entidade: 'Empresa', entidade_id: t.empresa.id, request_id: { startsWith: 'fuso-release:' } } }), 1);
    assert.equal((await prisma().empresa.findUnique({ where: { id: t.empresa.id } })).fuso_horario, SP);
  });
});

// ═══ F. nenhuma rede ═════════════════════════════════════════════════════

describe('PR190-R2 F — os scripts da release não falam com serviços externos', () => {
  test('F1: sem fetch/http/Vercel/Supabase API nos scripts novos; só a conexão de banco informada', () => {
    for (const arquivo of ['scripts/ops/fusoReleaseLib.mjs', 'scripts/ops/configurar-fuso-empresas.mjs', 'scripts/deploy/preflight-fuso-release.mjs']) {
      const fonte = readFileSync(join(REPO, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.ok(!/\bfetch\s*\(|node:https?|\baxios\b|vercel\.com|supabase\.co|api\.github/i.test(fonte), arquivo);
    }
  });
});
