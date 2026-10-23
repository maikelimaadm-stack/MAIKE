/**
 * Provas do `gate:usuario-admin` (P6.0, D-PROD-34).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runGate } from './helpers.mjs';

const GATE = 'gate-usuario-admin.mjs';

describe('gate:usuario-admin — o projeto correto passa', () => {
  test('UA-GATE-01 repositório real passa', () => {
    const r = runGate(GATE, { env: { USUARIO_ADMIN_ROOT: process.cwd() } });
    assert.equal(r.status, 0, r.output);
  });
});

describe('gate:usuario-admin — contrato do gate', () => {
  test('UA-GATE-02 exporta executar', async () => {
    const mod = await import('../../gates/gate-usuario-admin.mjs');
    assert.equal(typeof mod.executar, 'function');
  });
});
