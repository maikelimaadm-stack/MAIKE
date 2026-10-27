/**
 * Unitário do cursor keyset (D-PROD-54).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  codificarCursor,
  decodificarCursor,
  normalizarLimite,
  LIMITE_MAXIMO,
  clausulaKeysetDesc,
} from '../src/shared/pagination/keysetCursor.js';

describe('keysetCursor', () => {
  test('codifica e decodifica round-trip', () => {
    const createdAt = new Date('2026-10-27T21:00:00.000Z');
    const token = codificarCursor({ createdAt, id: 'clxyz123' });
    const voltou = decodificarCursor(token);
    assert.ok(voltou);
    assert.equal(voltou.id, 'clxyz123');
    assert.equal(voltou.createdAt.toISOString(), createdAt.toISOString());
  });

  test('cursor lixo devolve null', () => {
    assert.equal(decodificarCursor(null), null);
    assert.equal(decodificarCursor('@@@'), null);
    assert.equal(decodificarCursor(''), null);
  });

  test('normalizarLimite respeita teto', () => {
    assert.equal(normalizarLimite(1000), LIMITE_MAXIMO);
    assert.equal(normalizarLimite(0), 100);
    assert.equal(normalizarLimite(50), 50);
  });

  test('clausulaKeysetDesc usa OR de desempate', () => {
    const c = clausulaKeysetDesc({ createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'a' });
    assert.ok(Array.isArray(c.OR));
    assert.equal(c.OR.length, 2);
  });
});
