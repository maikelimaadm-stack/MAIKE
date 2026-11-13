/**
 * MAIKE-ESTOQUE-P1-02 — M6 / B-03: replay idempotente DETERMINÍSTICO.
 *
 * Antes: o 201 devolvia `Decimal` (que o Fastify serializa como string) e o
 * recibo gravava o objeto cru, que voltava do banco como NÚMERO; a mesma
 * `operation_id` respondia `"12.5"` e depois `12.5`. Agora o corpo vira JSON
 * puro ANTES do recibo e o 201 devolve esse mesmo objeto (`corpoJsonPuro`).
 *
 * Prova: igualdade profunda e de TIPOS entre o primeiro envio e o replay
 * (só o marcador `replay` difere), conflito de payload sem efeito, e recibo
 * legado (gravado antes, com números) respondendo exatamente o que guardou.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, docCom, foto, loteLegado, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import { corpoJsonPuro, executarComIdempotencia } from '../src/shared/idempotency/operacaoIdempotenteService.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;

before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
});

after(async () => {
  await app.close();
  await encerrar();
});

/** Corpo sem o marcador que, por definição, difere entre 1º envio e replay. */
const semReplay = (corpo) => {
  const resto = { ...corpo };
  delete resto.replay;
  return resto;
};

/** Mapa caminho → tipo JSON de cada folha (prova "mesmos tipos", não só valores iguais por coerção). */
const tipos = (v, caminho = '$', acc = {}) => {
  if (v === null) acc[caminho] = 'null';
  else if (Array.isArray(v)) v.forEach((x, i) => tipos(x, `${caminho}[${i}]`, acc));
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) tipos(x, `${caminho}.${k}`, acc);
  else acc[caminho] = typeof v;
  return acc;
};

describe('M6 — corpoJsonPuro e executarComIdempotencia (unidade)', () => {
  test('R6-1 Decimal vira string, Date vira ISO, undefined some; o recibo guarda o MESMO objeto que o 201 devolve', async () => {
    const corpo = { valor: new Prisma.Decimal('12.5000'), quando: new Date('2027-06-10T12:00:00.000Z'), nada: undefined, lista: [new Prisma.Decimal('0.0001')] };
    assert.deepEqual(corpoJsonPuro(corpo), { valor: '12.5', quando: '2027-06-10T12:00:00.000Z', lista: ['0.0001'] });

    /** @type {any[]} */
    const gravados = [];
    const tx = {
      operacaoIdempotente: {
        findUnique: async () => null,
        createMany: async () => ({ count: 1 }),
        update: async ({ data }) => {
          gravados.push(data);
          return data;
        },
      },
    };
    const r = await executarComIdempotencia(tx, {
      clienteId: 'c', operationKey: 'k', tipoOperacao: 't', fingerprint: 'f',
      executar: async () => ({ httpStatus: 201, body: corpo }),
    });
    assert.equal(r.replay, false);
    assert.deepEqual(r.body, gravados[0].response_json, 'o 201 e o recibo são o mesmo JSON');
    assert.deepEqual(tipos(r.body), tipos(gravados[0].response_json));
    assert.equal(typeof r.body.valor, 'string');
  });
});

describe('M6 — HTTP real: 1º envio × replay da mesma operation_id', () => {
  test('R6-3 criar e confirmar compra com produtos: replay idêntico em conteúdo e TIPOS', async () => {
    await limparBanco();
    const s = await montarTenant(app);
    const e = s.e1;
    const corpo = docCom(e, s.local, [{ produto: e.milho, quantidade: '10.5', valor_unitario: '2.3333' }]);

    const chave = opId();
    const r1 = await A.req('POST', '/operacoes-financeiras', s.token, { ...corpo, operation_id: chave });
    const r2 = await A.req('POST', '/operacoes-financeiras', s.token, { ...corpo, operation_id: chave });
    assert.equal(r1.statusCode, 201, r1.body);
    assert.equal(r2.statusCode, 200, r2.body);
    const [c1, c2] = [r1.json(), r2.json()];
    assert.deepEqual([c1.replay, c2.replay], [false, true]);
    assert.deepEqual(semReplay(c2), semReplay(c1), 'criar: replay igual ao 1º envio');
    assert.deepEqual(tipos(semReplay(c2)), tipos(semReplay(c1)), 'criar: mesmos tipos em todas as folhas');

    const chaveC = opId();
    const conf = { empresa_id: e.id, operation_id: chaveC, versao: c1.versao };
    const k1 = await A.req('POST', `/operacoes-financeiras/${c1.id}/confirmar`, s.token, conf);
    const k2 = await A.req('POST', `/operacoes-financeiras/${c1.id}/confirmar`, s.token, conf);
    assert.equal(k1.statusCode, 200, k1.body);
    assert.equal(k2.statusCode, 200, k2.body);
    const [d1, d2] = [k1.json(), k2.json()];
    assert.deepEqual([d1.replay, d2.replay], [false, true]);
    assert.deepEqual(semReplay(d2), semReplay(d1), 'confirmar: replay igual ao 1º envio (itens, quantidades, ids, nulls)');
    assert.deepEqual(tipos(semReplay(d2)), tipos(semReplay(d1)), 'confirmar: mesmos tipos');
    // há Decimal no corpo (quantidade/valor do item) e ele sai como string nos DOIS envios
    const item1 = d1.itens?.[0] ?? {};
    const decimais = Object.entries(item1).filter(([, v]) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));
    assert.ok(decimais.length > 0, 'o item confirmado tem valores decimais como string');
  });

  test('R6-4 mesma operation_id com outro payload → 409 IDEMPOTENCY_CONFLICT, nada muda', async () => {
    await limparBanco();
    const s = await montarTenant(app);
    const e = s.e1;
    const chave = opId();
    const corpo = docCom(e, s.local, [{ produto: e.milho, quantidade: '4', valor_unitario: '3' }]);
    const r1 = await A.req('POST', '/operacoes-financeiras', s.token, { ...corpo, operation_id: chave });
    assert.equal(r1.statusCode, 201, r1.body);
    const antes = await foto(s.c);
    const outro = docCom(e, s.local, [{ produto: e.milho, quantidade: '5', valor_unitario: '3' }]);
    const r2 = await A.req('POST', '/operacoes-financeiras', s.token, { ...outro, operation_id: chave });
    assert.equal(r2.statusCode, 409, r2.body);
    assert.equal(r2.json().code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await foto(s.c), antes, 'nenhuma linha mudou');
  });

  test('R6-5 recibo LEGADO (gravado antes, com números) responde exatamente o que guardou', async () => {
    await limparBanco();
    const s = await montarTenant(app);
    const e = s.e1;
    const chave = opId();
    const corpo = docCom(e, s.local, [{ produto: e.milho, quantidade: '2', valor_unitario: '5' }]);
    const r1 = await A.req('POST', '/operacoes-financeiras', s.token, { ...corpo, operation_id: chave });
    assert.equal(r1.statusCode, 201, r1.body);
    // Reescreve o recibo como os gravados antes da P1-02 (Decimal como número).
    const legado = { ...semReplay(r1.json()), valor_bruto: 10, marcador_legado: 1.5 };
    await prisma().operacaoIdempotente.updateMany({
      where: { cliente_id: s.c, operation_key: chave },
      data: { response_json: legado },
    });
    const r2 = await A.req('POST', '/operacoes-financeiras', s.token, { ...corpo, operation_id: chave });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.deepEqual(semReplay(r2.json()), legado, 'o replay de recibo antigo não muda');
  });
  test('R6-6 transferência entre locais (comando da P0, onde a B-03 foi achada): replay idêntico em conteúdo e TIPOS', async () => {
    await limparBanco();
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '50', custo: '2.3333', dia: '2027-05-01' });
    await prisma().produto.update({ where: { id: e.sal.id }, data: { estoque_atual: '50' } });
    const corpo = { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: '7.5' };
    const r1 = await A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, corpo);
    const r2 = await A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, corpo);
    assert.equal(r1.statusCode, 201, r1.body);
    assert.equal(r2.statusCode, 200, r2.body);
    const [c1, c2] = [r1.json(), r2.json()];
    assert.deepEqual([c1.replay, c2.replay], [false, true]);
    assert.deepEqual(tipos(semReplay(c2)), tipos(semReplay(c1)), 'transferência: mesmos tipos (Decimal não vira número no replay)');
    assert.deepEqual(semReplay(c2), semReplay(c1), 'transferência: replay igual ao 1º envio');
  });
});
