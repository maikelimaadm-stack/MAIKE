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
  montarEnvelopeKeyset,
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

  test('cursor adulterado que o banco ou o engine recusariam devolve null; os limites válidos (anos 0000 e 9999, id cuid) passam (rodada 2, API-2)', () => {
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
    for (const json of [
      '{"t":"+010000-01-01T00:00:00.000Z","i":"a"}',
      '{"t":"-000001-01-01T00:00:00.000Z","i":"a"}',
      '{"t":"2027-01-01T00:00:00.000Z","i":"a\\u0000b"}',
      '{"t":"2027-01-01T00:00:00.000Z","i":"\\ud800"}',
      `{"t":"2027-01-01T00:00:00.000Z","i":"${'x'.repeat(65)}"}`,
      '{"t":"2027-01-01T00:00:00.000Z","i":"a b"}',
    ]) {
      assert.equal(decodificarCursor(b64(json)), null, json);
    }
    for (const t of ['0000-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z']) assert.ok(decodificarCursor(b64(JSON.stringify({ t, i: 'cmw8g1y5d00767drlmll57z4t' }))), t);
    const legitimo = codificarCursor({ createdAt: new Date('2027-06-15T15:00:00.123Z'), id: 'cmw8g1y5d00767drlmll57z4t' });
    assert.deepEqual(decodificarCursor(legitimo), { createdAt: new Date('2027-06-15T15:00:00.123Z'), id: 'cmw8g1y5d00767drlmll57z4t' });
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

  test('montarEnvelopeKeyset corta limit+1 e gera next_cursor', () => {
    const createdAt = new Date('2026-10-27T12:00:00.000Z');
    const registros = [
      { id: 'a', createdAt, nome: 'A' },
      { id: 'b', createdAt, nome: 'B' },
    ];
    const env = montarEnvelopeKeyset({
      registros,
      limit: 1,
      total: 99,
      mapItem: (r) => ({ id: r.id, nome: r.nome }),
    });
    assert.equal(env.items.length, 1);
    assert.equal(env.items[0].id, 'a');
    assert.equal(env.has_more, true);
    assert.equal(typeof env.next_cursor, 'string');
    assert.equal(env.total, 99);
    assert.equal(env.limit, 1);
  });
});
