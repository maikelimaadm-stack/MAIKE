/**
 * PR145-R3 (D-PROD-70) — CLI de bootstrap único do proprietário.
 * Roda o script real com respostas pelo stdin (modo de teste explícito).
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { limparBanco, encerrar } from './helpers.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/admin/bootstrap-admin-principal.mjs', import.meta.url));
const SENHA = 'senha-forte-do-dono-1';

const rodar = (linhas, envExtra = {}) =>
  spawnSync(process.execPath, [SCRIPT], {
    input: `${linhas.join('\n')}\n`,
    encoding: 'utf8',
    env: { ...process.env, ADMIN_BOOTSTRAP_STDIN: 'sim', NODE_ENV: 'test', ...envExtra },
  });

before(() => {});
after(async () => encerrar());
beforeEach(async () => limparBanco());

describe('bootstrap do proprietário (CLI)', () => {
  test('B-01 cria uma vez, nunca imprime a senha; segunda execução é recusada', async () => {
    const r1 = rodar(['dono.maike', SENHA, SENHA, 'CRIAR PROPRIETARIO']);
    assert.equal(r1.status, 0, r1.stderr);
    assert.match(r1.stdout, /proprietário criado: login=dono\.maike/);
    assert.equal(`${r1.stdout}${r1.stderr}`.includes(SENHA), false);
    assert.equal(`${r1.stdout}${r1.stderr}`.includes('scrypt$'), false);
    const r2 = rodar(['outro.dono', SENHA, SENHA, 'CRIAR PROPRIETARIO']);
    assert.equal(r2.status, 1);
    assert.match(r2.stderr, /já foi criado/);
    assert.equal(await getPrismaClient().adminPrincipalMaike.count(), 1);
  });

  test('B-02 senhas diferentes, sem confirmação, senha fraca ou produção: nada é criado', async () => {
    assert.match(rodar(['dono.maike', SENHA, `${SENHA}x`, 'CRIAR PROPRIETARIO']).stderr, /não conferem/);
    assert.match(rodar(['dono.maike', SENHA, SENHA, 'sim']).stderr, /confirmação/);
    assert.match(rodar(['dono.maike', 'curta', 'curta', 'CRIAR PROPRIETARIO']).stderr, /ao menos 12/);
    assert.match(rodar(['dono.maike', SENHA, SENHA, 'CRIAR PROPRIETARIO'], { NODE_ENV: 'production' }).stderr, /recusado em NODE_ENV=production/);
    const semTty = spawnSync(process.execPath, [SCRIPT], { input: '', encoding: 'utf8', env: { ...process.env, ADMIN_BOOTSTRAP_STDIN: '' } });
    assert.match(semTty.stderr, /terminal interativo/);
    assert.equal(await getPrismaClient().adminPrincipalMaike.count(), 0);
  });
});
