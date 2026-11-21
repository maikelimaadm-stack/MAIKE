/**
 * Área do mapa ligada à Cultura (D-PROD-216) — PostgreSQL real.
 *
 * O que este arquivo prova:
 *  - a área aceita `cultura_id` de uma cultura ATIVA do mesmo tenant e da MESMA
 *    fazenda; devolve `cultura_id` e `cultura` {id, codigo, nome, tipo};
 *  - `tipo_pastagem` é derivado do nome da cultura (o enviado é ignorado) e segue
 *    o nome quando a cultura é renomeada (evento-resumo de propagação);
 *  - cultura de outro tenant = 404 sem oráculo; de outra fazenda, inativa ou em
 *    área de Reserva/APP/Infraestrutura = 400 com field/reason;
 *  - mudar o uso para Infraestrutura desliga a cultura; `cultura_id: null` desliga;
 *  - a FK composta (cliente_id, empresa_id, cultura_id) barra no banco cultura de
 *    outra fazenda mesmo sem passar pelo serviço;
 *  - cultura ligada a área não sai: DELETE → 409 `CULTURA_EM_USO` (e a FK RESTRICT
 *    barra no banco); depois de desligar, sai.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

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

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });

/** Tenant administrador com duas fazendas, um setor na primeira e a lista de referência nas duas. */
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
  const e2 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  const token = corpo.token;
  assert.ok(token, 'login');
  const setor = await req('POST', '/setores', token, { empresa_id: e1.id, nome: 'RETIRO', tipo: 'Próprio' });
  assert.equal(setor.statusCode, 201, setor.body);
  const ref1 = await req('POST', '/culturas/comandos/lista-referencia', token, { empresa_id: e1.id });
  assert.equal(ref1.statusCode, 200, ref1.body);
  const ref2 = await req('POST', '/culturas/comandos/lista-referencia', token, { empresa_id: e2.id });
  assert.equal(ref2.statusCode, 200, ref2.body);
  const porCodigo = (lista) => Object.fromEntries(lista.map((x) => [x.codigo, x]));
  return { token, clienteId: c, e1, e2, setorId: setor.json().id, c1: porCodigo(ref1.json().culturas), c2: porCodigo(ref2.json().culturas) };
};

const area = (cen, extra = {}) => ({ empresa_id: cen.e1.id, setor_id: cen.setorId, nome: 'PIQUETE 1', tamanho_hectares: 10, ...extra });
const criarArea = (cen, extra) => req('POST', '/areas-pastagem', cen.token, area(cen, extra));
const patch = (cen, id, corpo) => req('PATCH', `/areas-pastagem/${id}`, cen.token, corpo);

describe('D-PROD-216 — Área ligada à Cultura', () => {
  test('AC-01 cria com cultura: devolve cultura_id e cultura {id,codigo,nome,tipo}; tipo_pastagem = nome da cultura (o enviado é ignorado); GET lista igual', async () => {
    const cen = await cenario();
    const marandu = cen.c1['001'];
    const r = await criarArea(cen, { cultura_id: marandu.id, tipo_cultura: 'Pastagem', tipo_pastagem: 'Brachiaria' });
    assert.equal(r.statusCode, 201, r.body);
    const a = r.json();
    assert.equal(a.cultura_id, marandu.id);
    assert.deepEqual(a.cultura, { id: marandu.id, codigo: '001', nome: 'BRACHIARIA BRIZANTHA CV. MARANDU', tipo: 'PASTAGEM', altura_entrada_cm: 35, altura_saida_cm: 20, dias_descanso: 30 }, 'D-PROD-223: com as alturas e os dias de descanso da lista de referência (D-PROD-270: Marandu 35/20, Doc 397)');
    assert.equal(a.tipo_pastagem, 'BRACHIARIA BRIZANTHA CV. MARANDU');
    const lista = await req('GET', '/areas-pastagem', cen.token);
    assert.equal(lista.statusCode, 200);
    const lida = lista.json().find((x) => x.id === a.id);
    assert.equal(lida.cultura.codigo, '001');
    assert.equal(lida.tipo_pastagem, 'BRACHIARIA BRIZANTHA CV. MARANDU');
  });

  test('AC-02 área sem cultura continua funcionando (texto antigo); cultura_id e cultura nulos', async () => {
    const cen = await cenario();
    const r = await criarArea(cen, { tipo_pastagem: 'Brachiaria' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().cultura_id, null);
    assert.equal(r.json().cultura, null);
    assert.equal(r.json().tipo_pastagem, 'Brachiaria');
  });

  test('AC-03 PATCH liga, troca e desliga; com cultura, tipo_pastagem do corpo é ignorado; null volta a aceitar o texto', async () => {
    const cen = await cenario();
    const id = (await criarArea(cen, { tipo_pastagem: 'Brachiaria' })).json().id;
    let r = await patch(cen, id, { cultura_id: cen.c1['007'].id });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().tipo_pastagem, 'PANICUM CV. MOMBAÇA');
    r = await patch(cen, id, { tipo_pastagem: 'Outro texto' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().tipo_pastagem, 'PANICUM CV. MOMBAÇA', 'a área com cultura mantém a cópia do nome');
    r = await patch(cen, id, { cultura_id: null, tipo_pastagem: 'Brachiaria' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().cultura_id, null);
    assert.equal(r.json().tipo_pastagem, 'Brachiaria');
  });

  test('AC-04 cultura de outra fazenda → 400 outra_fazenda; inativa → 400 inativa; uso sem cultura → 400 uso_sem_cultura; id inexistente → 404', async () => {
    const cen = await cenario();
    let r = await criarArea(cen, { cultura_id: cen.c2['001'].id });
    assert.equal(r.statusCode, 400, r.body);
    assert.deepEqual([r.json().field, r.json().reason], ['cultura_id', 'outra_fazenda']);
    await prisma().cultura.update({ where: { id: cen.c1['002'].id }, data: { ativo: false } });
    r = await criarArea(cen, { cultura_id: cen.c1['002'].id });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().reason, 'inativa');
    r = await criarArea(cen, { cultura_id: cen.c1['001'].id, tipo_cultura: 'Reserva' });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().reason, 'uso_sem_cultura');
    r = await criarArea(cen, { cultura_id: 'nao-existe' });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, 'CULTURA_NOT_FOUND');
    assert.equal(await prisma().areaPastagem.count(), 0, 'nada gravado');
  });

  test('AC-05 manter a mesma cultura depois de inativada não bloqueia a edição da área', async () => {
    const cen = await cenario();
    const id = (await criarArea(cen, { cultura_id: cen.c1['001'].id })).json().id;
    await prisma().cultura.update({ where: { id: cen.c1['001'].id }, data: { ativo: false } });
    const r = await patch(cen, id, { cultura_id: cen.c1['001'].id, nome: 'PIQUETE 1A' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nome, 'PIQUETE 1A');
  });

  test('AC-06 uso mudando para Infraestrutura desliga a cultura', async () => {
    const cen = await cenario();
    const id = (await criarArea(cen, { cultura_id: cen.c1['001'].id })).json().id;
    const r = await patch(cen, id, { tipo_cultura: 'Infraestrutura', tipo_pastagem: 'Curral' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().cultura_id, null);
    assert.equal(r.json().tipo_pastagem, 'Curral');
  });

  test('AC-07 cultura de outro tenant → 404 (sem oráculo), nada gravado', async () => {
    const cen = await cenario();
    const outro = await cenario();
    const r = await criarArea(cen, { cultura_id: outro.c1['001'].id });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, 'CULTURA_NOT_FOUND');
    assert.equal(await prisma().areaPastagem.count({ where: { cliente_id: cen.clienteId } }), 0);
  });

  test('AC-08 renomear a cultura reescreve o tipo_pastagem das áreas ligadas (só delas) e registra a propagação', async () => {
    const cen = await cenario();
    const ligada = (await criarArea(cen, { cultura_id: cen.c1['001'].id })).json().id;
    const solta = (await criarArea(cen, { nome: 'PIQUETE 2', tipo_pastagem: 'BRACHIARIA BRIZANTHA CV. MARANDU' })).json().id;
    const r = await req('PATCH', `/culturas/${cen.c1['001'].id}`, cen.token, { empresa_id: cen.e1.id, nome: 'marandu da baixada' });
    assert.equal(r.statusCode, 200, r.body);
    const [a, b] = await Promise.all([ligada, solta].map((id) => prisma().areaPastagem.findUnique({ where: { id } })));
    assert.equal(a.tipo_pastagem, 'MARANDU DA BAIXADA');
    assert.equal(b.tipo_pastagem, 'BRACHIARIA BRIZANTHA CV. MARANDU', 'área sem vínculo não muda');
    const ev = await prisma().auditLog.findFirst({ where: { cliente_id: cen.clienteId, acao: 'propagar_referencias', entidade: 'Cultura' } });
    assert.ok(ev, 'evento-resumo da propagação');
  });

  test('AC-09 cultura ligada a área: DELETE → 409 CULTURA_EM_USO; depois de desligar, sai (204/200)', async () => {
    const cen = await cenario();
    const id = (await criarArea(cen, { cultura_id: cen.c1['001'].id })).json().id;
    const url = `/culturas/${cen.c1['001'].id}?empresa_id=${encodeURIComponent(cen.e1.id)}`;
    let r = await req('DELETE', url, cen.token);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'CULTURA_EM_USO');
    assert.equal(r.json().details?.areas, 1);
    assert.deepEqual([r.json().field, r.json().reason], ['id', 'ligada_a_areas']);
    assert.equal((await patch(cen, id, { cultura_id: null })).statusCode, 200);
    r = await req('DELETE', url, cen.token);
    assert.ok([200, 204].includes(r.statusCode), r.body);
  });

  test('AC-10 banco: a FK composta barra cultura de outra fazenda e a exclusão de cultura em uso (RESTRICT)', async () => {
    const cen = await cenario();
    const id = (await criarArea(cen, { cultura_id: cen.c1['001'].id })).json().id;
    await assert.rejects(
      prisma().$executeRawUnsafe(`UPDATE "AreaPastagem" SET cultura_id = $1 WHERE id = $2`, cen.c2['001'].id, id),
      /foreign key|violates/i
    );
    await assert.rejects(prisma().$executeRawUnsafe(`DELETE FROM "CADCULTURAS" WHERE id = $1`, cen.c1['001'].id), /foreign key|violates/i);
  });

  test('AC-11 schema fechado: cultura_id vazio ou em branco → 400; objeto `cultura` no corpo → 400', async () => {
    const cen = await cenario();
    for (const ruim of [{ cultura_id: '' }, { cultura_id: '   ' }, { cultura: { id: 'x' } }]) {
      const r = await criarArea(cen, ruim);
      assert.equal(r.statusCode, 400, `${JSON.stringify(ruim)} → ${r.statusCode}`);
    }
  });
});

describe('D-PROD-223 — parâmetros próprios do pasto (alturas e dias de descanso na Área)', () => {
  test('AP-01 vazios por padrão (vale a cultura); POST e PATCH gravam texto pt-BR ou número; GET devolve; null volta a usar a cultura', async () => {
    const cen = await cenario();
    const nova = await criarArea(cen, { cultura_id: cen.c1['001'].id });
    assert.equal(nova.statusCode, 201, nova.body);
    assert.deepEqual([nova.json().altura_entrada_cm, nova.json().altura_saida_cm, nova.json().dias_descanso], [null, null, null]);
    const r = await criarArea(cen, { nome: 'PIQUETE FRACO', cultura_id: cen.c1['001'].id, altura_entrada_cm: '20,5', altura_saida_cm: 12, dias_descanso: '40' });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([r.json().altura_entrada_cm, r.json().altura_saida_cm, r.json().dias_descanso], [20.5, 12, 40]);
    const lida = (await req('GET', '/areas-pastagem', cen.token)).json().find((x) => x.id === r.json().id);
    assert.deepEqual([lida.altura_entrada_cm, lida.altura_saida_cm, lida.dias_descanso], [20.5, 12, 40]);
    const p = await patch(cen, r.json().id, { dias_descanso: null, altura_saida_cm: '10' });
    assert.equal(p.statusCode, 200, p.body);
    assert.deepEqual([p.json().altura_entrada_cm, p.json().altura_saida_cm, p.json().dias_descanso], [20.5, 10, null]);
  });

  test('AP-02 validação igual à da cultura: altura 0, > 1000, 2 casas, texto ou booleano → 400; dias 0, 366, decimal → 400; nada gravado', async () => {
    const cen = await cenario();
    const id = (await criarArea(cen, { cultura_id: cen.c1['001'].id })).json().id;
    const casos = [
      [{ altura_entrada_cm: 0 }, 'altura_fora_da_faixa'],
      [{ altura_entrada_cm: '1000,1' }, 'altura_fora_da_faixa'],
      [{ altura_saida_cm: '10,25' }, 'altura_casas_decimais'],
      [{ altura_entrada_cm: 'alto' }, 'altura_invalida'],
      [{ altura_entrada_cm: true }, 'altura_invalida'],
      [{ dias_descanso: 0 }, 'dias_descanso_fora_da_faixa'],
      [{ dias_descanso: 366 }, 'dias_descanso_fora_da_faixa'],
      [{ dias_descanso: '30,5' }, 'dias_descanso_invalido'],
      [{ dias_descanso: false }, 'dias_descanso_invalido'],
    ];
    for (const [corpo, motivo] of casos) {
      const r = await patch(cen, id, corpo);
      assert.equal(r.statusCode, 400, `${JSON.stringify(corpo)} → ${r.statusCode} ${r.body}`);
      assert.equal(r.json().reason, motivo, JSON.stringify(corpo));
    }
    const ruimNoPost = await criarArea(cen, { nome: 'X', dias_descanso: 400 });
    assert.equal(ruimNoPost.statusCode, 400, ruimNoPost.body);
    const area = await prisma().areaPastagem.findUnique({ where: { id } });
    assert.deepEqual([area.altura_entrada_cm, area.altura_saida_cm, area.dias_descanso], [null, null, null]);
  });

  test('AP-03 saída menor que a entrada, com as duas do pasto (a nova ou a gravada); só uma das duas pode', async () => {
    const cen = await cenario();
    const igual = await criarArea(cen, { altura_entrada_cm: 20, altura_saida_cm: 20 });
    assert.equal(igual.statusCode, 400, igual.body);
    assert.equal(igual.json().reason, 'altura_saida_maior_ou_igual');
    const id = (await criarArea(cen, { altura_entrada_cm: 20 })).json().id;
    const maior = await patch(cen, id, { altura_saida_cm: 21 });
    assert.equal(maior.statusCode, 400, maior.body);
    assert.equal(maior.json().reason, 'altura_saida_maior_ou_igual');
    assert.equal((await patch(cen, id, { altura_saida_cm: 12 })).statusCode, 200);
    const baixaEntrada = await patch(cen, id, { altura_entrada_cm: 12 });
    assert.equal(baixaEntrada.statusCode, 400, 'a entrada nova não pode ficar abaixo da saída gravada');
  });
});
