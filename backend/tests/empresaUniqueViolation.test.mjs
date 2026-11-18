/**
 * Mapeamento P2002 → AppError estável (PR108), com e sem o alvo (D-PROD-252).
 *
 * Com o alvo (o runtime é dono das tabelas) o campo decide, como sempre, e as
 * conferências nem rodam. Sem o alvo (produção: papel não dono + RLS) a chave
 * é conferida depois do rollback, numa leitura nova: nome ocupado → nome;
 * número reservado ocupado → número; nada ocupado ou conferência que falha →
 * o 409 genérico de antes. A corrida real, sob o papel não dono, está em
 * `p2002SemAlvo.test.mjs` (E1).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { closePrismaClient } from '../src/database/prismaClient.js';
import { lancarSeP2002Empresa } from '../src/modules/empresas/empresaUniqueViolation.js';
import { AppError } from '../src/shared/errors/AppError.js';

after(async () => {
  await closePrismaClient();
});

const codigo = (esperado) => (erro) => erro instanceof AppError && erro.code === esperado;
/** Conferência que responde `ocupada` e conta as chamadas. */
const conferencia = (ocupada) => {
  const f = async () => {
    f.chamadas += 1;
    if (ocupada instanceof Error) throw ocupada;
    return ocupada;
  };
  f.chamadas = 0;
  return f;
};

test('P2002 em nome → EMPRESA_NAME_CONFLICT (com o alvo, as conferências nem rodam)', async () => {
  const nome = conferencia(false);
  const numero = conferencia(true);
  await assert.rejects(
    lancarSeP2002Empresa({ code: 'P2002', meta: { target: ['cliente_id', 'nome'] } }, { nome, numero }),
    codigo('EMPRESA_NAME_CONFLICT'),
  );
  assert.deepEqual([nome.chamadas, numero.chamadas], [0, 0]);
});

test('P2002 em numero_empresa → SEQUENCE_CONFLICT', async () => {
  await assert.rejects(
    lancarSeP2002Empresa({ code: 'P2002', meta: { target: ['cliente_id', 'numero_empresa'] } }),
    codigo('SEQUENCE_CONFLICT'),
  );
});

test('P2002 sem meta reconhecível → CONCURRENCY_CONFLICT (com o alvo, mesmo com o nome "ocupado")', async () => {
  const nome = conferencia(true);
  await assert.rejects(
    lancarSeP2002Empresa({ code: 'P2002', meta: { target: ['cliente_id', 'id'] } }, { nome }),
    codigo('CONCURRENCY_CONFLICT'),
  );
  assert.equal(nome.chamadas, 0);
});

test('D-PROD-252: P2002 SEM alvo → conferência do nome, depois do número; nada ocupado → CONCURRENCY_CONFLICT', async () => {
  const semAlvo = { code: 'P2002', meta: { modelName: 'Empresa', target: null } };
  await assert.rejects(lancarSeP2002Empresa(semAlvo), codigo('CONCURRENCY_CONFLICT'), 'sem conferência: o 409 genérico de antes');

  const nomeOcupado = conferencia(true);
  const numeroNaoConsultado = conferencia(true);
  await assert.rejects(lancarSeP2002Empresa(semAlvo, { nome: nomeOcupado, numero: numeroNaoConsultado }), codigo('EMPRESA_NAME_CONFLICT'));
  assert.deepEqual([nomeOcupado.chamadas, numeroNaoConsultado.chamadas], [1, 0], 'o nome decide primeiro');

  const nomeLivre = conferencia(false);
  const numeroOcupado = conferencia(true);
  await assert.rejects(lancarSeP2002Empresa(semAlvo, { nome: nomeLivre, numero: numeroOcupado }), codigo('SEQUENCE_CONFLICT'));
  assert.deepEqual([nomeLivre.chamadas, numeroOcupado.chamadas], [1, 1]);

  await assert.rejects(lancarSeP2002Empresa(semAlvo, { nome: conferencia(false), numero: conferencia(false) }), codigo('CONCURRENCY_CONFLICT'));
  await assert.rejects(lancarSeP2002Empresa(semAlvo, { nome: null, numero: null }), codigo('CONCURRENCY_CONFLICT'));
  // A conferência que falha conta como "não ocupada": o erro de antes, nunca mascarado.
  await assert.rejects(lancarSeP2002Empresa(semAlvo, { nome: conferencia(new Error('banco fora')) }), codigo('CONCURRENCY_CONFLICT'));
});

test('não-P2002 retorna false', async () => {
  assert.equal(await lancarSeP2002Empresa({ code: 'P2025' }), false);
  assert.equal(await lancarSeP2002Empresa({ code: 'P2025' }, { nome: conferencia(true) }), false);
});
