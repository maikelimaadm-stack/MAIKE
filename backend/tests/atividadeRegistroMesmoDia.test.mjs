/**
 * D-PROD-280 (MAIKE-ENTREGA-A) — VÁRIOS LANÇAMENTOS NO MESMO DIA para a mesma atividade, contra PostgreSQL real e HTTP
 * autenticado (`app.inject`): de manhã na área A, à tarde em outra área, de volta à A. Cada `operation_id` novo grava um
 * apontamento novo (a `sequencia` do dia cresce); o reenvio com a MESMA chave continua sendo replay (nada duplica). E o
 * "Novo lançamento" sem hectares (em branco, informados ao finalizar) entra com `area_id` e sem `area_executada_dia`.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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
  const registrar = (corpo) =>
    s.H.req('POST', '/atividades/registrar', s.token, { empresa_id: s.e1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10', ...corpo });
  const ok = async (corpo) => {
    const r = await registrar(corpo);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  return { ...s, registrar, ok };
};

describe('vários lançamentos no mesmo dia', () => {
  test('manhã na área A, tarde na área B, volta à A: três apontamentos novos; a mesma chave é replay', async () => {
    const s = await montar();
    const p = prisma();
    const areaB = await p.areaPastagem.create({
      data: { cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `AR-${randomUUID().slice(0, 6)}`, nome: 'PASTO B', tamanho_hectares: '30' },
    });
    const op1 = opId('manha');
    const manha = await s.ok({ area_id: s.area1.id, area_executada_dia: '3', operation_id: op1 });
    const tarde = await s.ok({ area_id: areaB.id, area_executada_dia: '2', operation_id: opId('tarde') });
    const volta = await s.ok({ area_id: s.area1.id, area_executada_dia: '1', operation_id: opId('volta') });
    assert.equal(volta.registro.atividade_id, manha.registro.atividade_id, 'volta à mesma atividade da área A');
    const daA = await p.atividadeApontamento.findMany({ where: { atividade_id: manha.registro.atividade_id }, orderBy: { sequencia: 'asc' } });
    assert.equal(daA.length, 2, 'dois apontamentos no mesmo dia, na mesma área, na mesma atividade');
    assert.deepEqual(daA.map((a) => a.sequencia), [1, 2]);
    assert.ok(tarde.registro.atividade_id);
    // A mesma chave: replay, nada novo.
    const replay = await s.registrar({ area_id: s.area1.id, area_executada_dia: '3', operation_id: op1 });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().replay, true);
    assert.equal(await p.atividadeApontamento.count({ where: { atividade_id: manha.registro.atividade_id } }), 2);
  });

  test('o lançamento sem hectares (em branco) entra: area_id sem area_executada_dia', async () => {
    const s = await montar();
    const um = await s.ok({ area_id: s.area1.id, area_executada_dia: '4', operation_id: opId('com') });
    const dois = await s.ok({ area_id: s.area1.id, operation_id: opId('sem') });
    assert.equal(dois.registro.atividade_id, um.registro.atividade_id);
    const aps = await prisma().atividadeApontamento.findMany({ where: { atividade_id: um.registro.atividade_id }, orderBy: { sequencia: 'asc' } });
    assert.equal(aps.length, 2);
    assert.equal(aps[1].area_executada_dia, null);
  });
});
