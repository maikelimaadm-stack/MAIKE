/**
 * Provas do gate:marca-native (P4.4-Marcas).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const GATE = 'scripts/gates/gate-marca-native.mjs';

test('marca-native gate passa no repositório real', () => {
  const r = spawnSync(process.execPath, [GATE], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
