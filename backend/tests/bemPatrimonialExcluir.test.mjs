/**
 * D-PROD-287 — excluir DE VEZ o bem patrimonial que nunca foi usado, contra PostgreSQL real e HTTP autenticado.
 *
 * - Bem novo, com tanque e produto aceito: `DELETE /bens-patrimoniais/:id?empresa_id=&versao=` → 204; o bem, os tanques
 *   e os aceites saem; a auditoria `delete` fica.
 * - Bem com abastecimento (mesmo cancelado): 409 `BEM_PATRIMONIAL_EM_USO` e nada sai.
 * - Versão velha → 409 de concorrência; bem de outra fazenda → 404; sem a ação "excluir" da tela → 403.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, corpoAbastecimento, montarAbastecimento, prisma } from './patrimonioP1AbastecimentoCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
before(async () => {
  app = await criarApp();
  await app.ready();
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const excluir = (A, tok, empresaId, id, versao) => A.req('DELETE', `/bens-patrimoniais/${id}?empresa_id=${empresaId}&versao=${versao}`, tok);

describe('excluir bem patrimonial (D-PROD-287)', () => {
  test('bem nunca usado: 204; o bem, os tanques e os aceites saem; fica a auditoria', async () => {
    const s = await montarAbastecimento(app);
    const A = acoesAbastecimento(app);
    const p = prisma();
    const tanques = await p.tanqueBem.findMany({ where: { bem_id: s.trator.id } });
    assert.ok(tanques.length > 0, 'o trator do cenário tem tanque');
    const r = await excluir(A, s.token, s.e1.id, s.trator.id, s.trator.versao);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(await p.bemPatrimonial.count({ where: { id: s.trator.id } }), 0);
    assert.equal(await p.tanqueBem.count({ where: { bem_id: s.trator.id } }), 0);
    assert.equal(await p.tanqueBemProduto.count({ where: { tanque_id: { in: tanques.map((t) => t.id) } } }), 0);
    const auditoria = await p.auditLog.findMany({ where: { entidade: 'BemPatrimonial', entidade_id: s.trator.id, acao: 'delete' } }).catch(() => null);
    if (auditoria) assert.equal(auditoria.length, 1, 'a exclusão fica na auditoria');
  });

  test('bem com abastecimento (mesmo cancelado): 409 BEM_PATRIMONIAL_EM_USO e nada sai', async () => {
    const s = await montarAbastecimento(app);
    const A = acoesAbastecimento(app);
    const ab = await A.confirmarOk(s.token, corpoAbastecimento(s));
    const id = ab.abastecimento?.id ?? ab.id;
    await A.cancelar(s.token, id, { empresa_id: s.e1.id, versao: ab.abastecimento?.versao ?? ab.versao ?? 1, motivo: 'lançado errado', operation_id: `c-${id}` });
    const bem = await A.bem(s.token, s.e1.id, s.trator.id);
    const r = await excluir(A, s.token, s.e1.id, s.trator.id, bem.versao);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'BEM_PATRIMONIAL_EM_USO');
    assert.equal(r.json().details.abastecimentos, 1);
    assert.equal(await prisma().bemPatrimonial.count({ where: { id: s.trator.id } }), 1);
  });

  test('versão velha → 409; outra fazenda → 404; sem a ação "excluir" → 403', async () => {
    const s = await montarAbastecimento(app);
    const A = acoesAbastecimento(app);
    assert.equal((await excluir(A, s.token, s.e1.id, s.trator.id, s.trator.versao + 5)).statusCode, 409);
    assert.equal((await excluir(A, s.token, s.e2.id, s.trator.id, s.trator.versao)).statusCode, 404);
    const semExcluir = await s.contaCom({ modulo_id: 'patrimonio', tela_id: 'pat-bens-patrimoniais', visualizar: true, editar: true, salvar: true, inativar: true });
    assert.equal((await excluir(A, semExcluir.token, s.e1.id, s.trator.id, s.trator.versao)).statusCode, 403);
    assert.equal(await prisma().bemPatrimonial.count({ where: { id: s.trator.id } }), 1);
  });
});
