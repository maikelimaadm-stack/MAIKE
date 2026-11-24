/**
 * D-PROD-291 — "Fez o pasto todo?" no Finalizar, contra PostgreSQL real e HTTP autenticado.
 *
 * - Dias de jato sem hectares + concluir com `areas: [{ atividade_area_id, hectares: "25" }]` → um lançamento de
 *   fechamento no dia da conclusão, sem linhas, com os 25 ha e a observação; a atividade fica CONCLUIDA.
 * - Já lançados 10 ha, informados 25 → o fechamento leva 15. Informados 10 → nenhum lançamento novo.
 * - Informado MENOR que o lançado → 400 `menor_que_lancado` e nada muda (nem a atividade).
 * - Sem `areas`, o concluir de sempre.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';

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

const montar = async () => {
  const s = await montarLinhasCusto(app);
  const registrar = async (corpo) => {
    const r = await s.H.req('POST', '/atividades/registrar', s.token, {
      empresa_id: s.e1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10', area_id: s.area1.id, operation_id: opId('dia'), ...corpo,
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const p = prisma();
  const atividadeDe = (id) => p.atividade.findUnique({ where: { id } });
  const areaDe = async (atividadeId) => (await p.atividadeArea.findMany({ where: { atividade_id: atividadeId } }))[0];
  const concluir = async (atividadeId, extra = {}) => {
    const a = await atividadeDe(atividadeId);
    return s.H.req('POST', `/atividades/${atividadeId}/concluir`, s.token, { empresa_id: s.e1.id, versao: a.versao, data_conclusao: '2027-06-12', ...extra });
  };
  return { ...s, p, registrar, atividadeDe, areaDe, concluir };
};

describe('Finalizar com "Fez o pasto todo?" (D-PROD-291)', () => {
  test('dias sem hectares + 25 ha informados: o fechamento leva os 25 ha e a atividade conclui', async () => {
    const s = await montar();
    const r = await s.registrar({});
    const atividadeId = r.registro.atividade_id;
    const area = await s.areaDe(atividadeId);
    const c = await s.concluir(atividadeId, { areas: [{ atividade_area_id: area.id, hectares: '25' }] });
    assert.equal(c.statusCode, 200, c.body);
    assert.equal((await s.atividadeDe(atividadeId)).status, 'CONCLUIDA');
    const aps = await s.p.atividadeApontamento.findMany({ where: { atividade_id: atividadeId }, orderBy: { sequencia: 'asc' } });
    const fechamento = aps.find((a) => a.observacao?.startsWith('Fechamento'));
    assert.ok(fechamento, 'há um lançamento de fechamento');
    assert.equal(Number(fechamento.area_executada_dia), 25);
    assert.equal(fechamento.status, 'CONFIRMADO');
    assert.equal(fechamento.atividade_area_id, area.id);
    assert.equal(fechamento.data_operacional.toISOString().slice(0, 10), '2027-06-12');
    assert.equal(await s.p.atividadeApontamentoProduto.count({ where: { apontamento_id: fechamento.id } }), 0);
    assert.equal(Number((await s.atividadeDe(atividadeId)).area_executada), 25, 'o total da atividade passa a ter os 25 ha');
  });

  test('já lançados 10 ha: informados 25 → fechamento de 15; informados 10 → nenhum lançamento novo', async () => {
    const s = await montar();
    const r = await s.registrar({ area_executada_dia: '10' });
    const atividadeId = r.registro.atividade_id;
    const area = await s.areaDe(atividadeId);
    const c = await s.concluir(atividadeId, { areas: [{ atividade_area_id: area.id, hectares: '25' }] });
    assert.equal(c.statusCode, 200, c.body);
    const fech = await s.p.atividadeApontamento.findFirst({ where: { atividade_id: atividadeId, observacao: { startsWith: 'Fechamento' } } });
    assert.equal(Number(fech.area_executada_dia), 15);

    const s2 = await montar();
    const r2 = await s2.registrar({ area_executada_dia: '10' });
    const a2 = r2.registro.atividade_id;
    const area2 = await s2.areaDe(a2);
    assert.equal((await s2.concluir(a2, { areas: [{ atividade_area_id: area2.id, hectares: '10' }] })).statusCode, 200);
    assert.equal(await s2.p.atividadeApontamento.count({ where: { atividade_id: a2 } }), 1, 'igual ao lançado: nada novo');
  });

  test('informado menor que o lançado → 400 menor_que_lancado e nada muda', async () => {
    const s = await montar();
    const r = await s.registrar({ area_executada_dia: '10' });
    const atividadeId = r.registro.atividade_id;
    const area = await s.areaDe(atividadeId);
    const antes = await s.atividadeDe(atividadeId);
    const c = await s.concluir(atividadeId, { areas: [{ atividade_area_id: area.id, hectares: '4' }] });
    assert.equal(c.statusCode, 400, c.body);
    assert.equal(c.json().reason, 'menor_que_lancado');
    const depois = await s.atividadeDe(atividadeId);
    assert.equal(depois.status, antes.status);
    assert.equal(depois.versao, antes.versao);
    assert.equal(await s.p.atividadeApontamento.count({ where: { atividade_id: atividadeId } }), 1);
  });

  test('hectares em número (não texto) → 400; sem areas, o concluir de sempre', async () => {
    const s = await montar();
    const r = await s.registrar({});
    const atividadeId = r.registro.atividade_id;
    const area = await s.areaDe(atividadeId);
    assert.equal((await s.concluir(atividadeId, { areas: [{ atividade_area_id: area.id, hectares: 25 }] })).statusCode, 400);
    const c = await s.concluir(atividadeId);
    assert.equal(c.statusCode, 200, c.body);
    assert.equal(await s.p.atividadeApontamento.count({ where: { atividade_id: atividadeId } }), 1);
  });
});
