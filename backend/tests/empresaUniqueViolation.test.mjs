/**
 * Mapeamento P2002 → AppError estável (PR108).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lancarSeP2002Empresa } from '../src/modules/empresas/empresaUniqueViolation.js';
import { AppError } from '../src/shared/errors/AppError.js';

test('P2002 em nome → EMPRESA_NAME_CONFLICT', () => {
  assert.throws(
    () =>
      lancarSeP2002Empresa({
        code: 'P2002',
        meta: { target: ['cliente_id', 'nome'] },
      }),
    (erro) => erro instanceof AppError && erro.code === 'EMPRESA_NAME_CONFLICT',
  );
});

test('P2002 em numero_empresa → SEQUENCE_CONFLICT', () => {
  assert.throws(
    () =>
      lancarSeP2002Empresa({
        code: 'P2002',
        meta: { target: ['cliente_id', 'numero_empresa'] },
      }),
    (erro) => erro instanceof AppError && erro.code === 'SEQUENCE_CONFLICT',
  );
});

test('P2002 sem meta reconhecível → CONCURRENCY_CONFLICT', () => {
  assert.throws(
    () => lancarSeP2002Empresa({ code: 'P2002', meta: { target: ['cliente_id', 'id'] } }),
    (erro) => erro instanceof AppError && erro.code === 'CONCURRENCY_CONFLICT',
  );
});

test('não-P2002 retorna false', () => {
  assert.equal(lancarSeP2002Empresa({ code: 'P2025' }), false);
});
