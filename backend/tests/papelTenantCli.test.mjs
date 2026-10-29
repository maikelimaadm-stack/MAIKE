/**
 * PR145-R4 (D-PROD-71) — script operacional de papel do administrador da fazenda.
 */

import { describe, test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarTenant, limparBanco, encerrar } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/auth/papel-tenant.mjs', import.meta.url));
const rodar = (argv, entrada, envExtra = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...argv], {
    input: `${entrada}\n`,
    encoding: 'utf8',
    env: { ...process.env, PAPEL_TENANT_STDIN: 'sim', NODE_ENV: 'test', ...envExtra },
  });

after(async () => encerrar());
beforeEach(async () => limparBanco());

describe('papel-tenant (caminho confiável de elevação)', () => {
  test('PT-01 promove UM usuário com confirmação, audita sem segredo e revoga', async () => {
    const t = await criarTenant();
    const outro = await criarTenant();
    const args = ['--cliente', t.cliente.codigo, '--login', t.usuario.login];
    const r = rodar([...args, '--papel', 'administrador'], 'CONFIRMAR');
    assert.equal(r.status, 0, r.stderr);
    const p = getPrismaClient();
    assert.equal((await p.usuario.findUnique({ where: { id: t.usuario.id } })).papel_tenant, 'administrador');
    assert.equal((await p.usuario.findUnique({ where: { id: outro.usuario.id } })).papel_tenant, 'usuario', 'só o alvo');
    const [a] = await p.auditLog.findMany({ where: { acao: 'papel_tenant' } });
    assert.deepEqual([a.dados_anteriores, a.dados_novos.papel_tenant, a.usuario_id], [{ papel_tenant: 'usuario' }, 'administrador', null]);
    assert.equal(`${r.stdout}${r.stderr}${JSON.stringify(a)}`.includes('senha'), false);
    assert.equal(rodar([...args, '--papel', 'usuario'], 'CONFIRMAR').status, 0);
    assert.equal((await p.usuario.findUnique({ where: { id: t.usuario.id } })).papel_tenant, 'usuario');
  });

  test('PT-02 sem confirmação, usuário inexistente/desativado, papel inválido ou produção: nada muda', async () => {
    const t = await criarTenant();
    const args = ['--cliente', t.cliente.codigo, '--login', t.usuario.login, '--papel', 'administrador'];
    assert.match(rodar(args, 'sim').stderr, /confirmação/);
    assert.match(rodar(['--cliente', t.cliente.codigo, '--login', 'nao-existe', '--papel', 'administrador'], 'CONFIRMAR').stderr, /não encontrado/);
    assert.match(rodar(['--cliente', t.cliente.codigo, '--login', t.usuario.login, '--papel', 'root'], 'CONFIRMAR').stderr, /uso:/);
    assert.match(rodar(args, 'CONFIRMAR', { NODE_ENV: 'production' }).stderr, /recusado em NODE_ENV=production/);
    await getPrismaClient().usuario.update({ where: { id: t.usuario.id }, data: { ativo: false } });
    assert.match(rodar(args, 'CONFIRMAR').stderr, /desativado/);
    assert.equal((await getPrismaClient().usuario.findUnique({ where: { id: t.usuario.id } })).papel_tenant, 'usuario');
    assert.equal(await getPrismaClient().auditLog.count({ where: { acao: 'papel_tenant' } }), 0);
  });

  test('PT-03 (R5) banco fora desta máquina sem NODE_ENV=production também exige a liberação explícita', () => {
    const remoto = { DATABASE_URL: 'postgresql://ops:fixture-nao-segredo@db.exemplo.invalid:5432/postgres' };
    const r = rodar(['--cliente', 'x', '--login', 'y', '--papel', 'administrador'], 'CONFIRMAR', remoto);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /recusado em banco fora desta máquina \(exige PAPEL_TENANT_ALLOW_PRODUCTION=sim/);
    assert.equal(`${r.stdout}${r.stderr}`.includes('exemplo.invalid'), false, 'não imprime o host');
  });
});
