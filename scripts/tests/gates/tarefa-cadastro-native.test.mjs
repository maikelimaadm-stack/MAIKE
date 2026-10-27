import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');

test('gate:tarefa-cadastro-native passa no repositório', () => {
  const r = spawnSync('node', ['scripts/gates/gate-tarefa-cadastro-native.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
