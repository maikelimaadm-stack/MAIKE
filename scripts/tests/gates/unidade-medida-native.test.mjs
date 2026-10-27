/**
 * Provas do gate:unidade-medida-native (P4.5, D-PROD-44).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const GATE = 'scripts/gates/gate-unidade-medida-native.mjs';

test('unidade-medida-native gate passa no repositório real', () => {
  const r = spawnSync(process.execPath, [GATE], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
