/**
 * D-PROD-355 — o id gerado no aparelho também em área, ponto de referência, linha e setor (como lote e cocho,
 * D-PROD-308). Com o sinal fraco, a resposta da criação se perdia e o app mandava de novo: o servidor gravava em dobro.
 *
 * IA-01 cada um: a mesma criação repetida devolve o MESMO registro (uma linha só, mesmo número)
 * IA-02 o mesmo id em outra conta → 409 ID_DO_APARELHO_EM_USO
 * IA-03 criado e depois excluído (ponto de referência) → 409 ID_DO_APARELHO_EXCLUIDO, não recria
 * IA-04 sem id, o servidor gera como antes
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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
  app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload } : {}) });

const AQUI = { lat: -15.6, lng: -56.1 };

const conta = async () => {
  const c = await criarTenant();
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  const empresa = await prisma().empresa.create({
    data: { cliente_id: c.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' },
  });
  return { ...c, token: corpo.token, empresa };
};

describe('D-PROD-355 — id do aparelho em mais cadastros', () => {
  test('IA-01 a mesma criação repetida devolve o mesmo registro', async () => {
    const c = await conta();
    const setorId = randomUUID();
    const corpoSetor = { id: setorId, empresa_id: c.empresa.id, nome: 'RETIRO', tipo: 'Próprio' };
    const s1 = await req('POST', '/setores', c.token, corpoSetor);
    assert.equal(s1.statusCode, 201, s1.body);
    const s2 = await req('POST', '/setores', c.token, corpoSetor);
    assert.ok([200, 201].includes(s2.statusCode), s2.body);
    assert.equal(s2.json().id, setorId);
    assert.equal(s2.json().numero_setor, s1.json().numero_setor);
    assert.equal(await prisma().setor.count({ where: { cliente_id: c.cliente.id } }), 1);

    const casos = [
      ['/areas-pastagem', 'areaPastagem', { empresa_id: c.empresa.id, setor_id: setorId, nome: 'P1', tamanho_hectares: 1 }],
      ['/pontos-referencia', 'pontoReferencia', { empresa_id: c.empresa.id, nome: 'PORTEIRA', tipo: 'PORTEIRA', coordenadas: AQUI }],
      ['/linhas-geograficas', 'linhaGeografica', { empresa_id: c.empresa.id, nome: 'CERCA', tipo: 'Cerca' }],
    ];
    for (const [url, modelo, corpo] of casos) {
      const id = randomUUID();
      const r1 = await req('POST', url, c.token, { ...corpo, id });
      assert.equal(r1.statusCode, 201, `${url}: ${r1.body}`);
      assert.equal(r1.json().id, id);
      const r2 = await req('POST', url, c.token, { ...corpo, id });
      assert.ok([200, 201].includes(r2.statusCode), `${url} repetida: ${r2.body}`);
      assert.equal(r2.json().id, id);
      assert.equal(await prisma()[modelo].count({ where: { cliente_id: c.cliente.id } }), 1, `${url}: uma linha só`);
    }
  });

  test('IA-02 o mesmo id em outra conta → 409', async () => {
    const a = await conta();
    const b = await conta();
    const id = randomUUID();
    const r1 = await req('POST', '/pontos-referencia', a.token, { id, empresa_id: a.empresa.id, nome: 'DE A', tipo: 'PORTEIRA', coordenadas: AQUI });
    assert.equal(r1.statusCode, 201, r1.body);
    const r2 = await req('POST', '/pontos-referencia', b.token, { id, empresa_id: b.empresa.id, nome: 'DE B', tipo: 'PORTEIRA', coordenadas: AQUI });
    assert.equal(r2.statusCode, 409, r2.body);
    assert.equal(r2.json().code, 'ID_DO_APARELHO_EM_USO');
    assert.doesNotMatch(r2.body, /DE A/);
  });

  test('IA-03 criado e depois excluído → não recria', async () => {
    const c = await conta();
    const id = randomUUID();
    const corpo = { id, empresa_id: c.empresa.id, nome: 'PORTEIRA', tipo: 'PORTEIRA', coordenadas: AQUI };
    assert.equal((await req('POST', '/pontos-referencia', c.token, corpo)).statusCode, 201);
    const ex = await req('DELETE', `/pontos-referencia/${id}`, c.token);
    assert.ok(ex.statusCode < 300, ex.body);
    const de_novo = await req('POST', '/pontos-referencia', c.token, corpo);
    assert.equal(de_novo.statusCode, 409, de_novo.body);
    assert.equal(de_novo.json().code, 'ID_DO_APARELHO_EXCLUIDO');
  });

  test('IA-04 sem id, o servidor gera como antes', async () => {
    const c = await conta();
    const r = await req('POST', '/linhas-geograficas', c.token, { empresa_id: c.empresa.id, nome: 'ESTRADA', tipo: 'Estrada' });
    assert.equal(r.statusCode, 201, r.body);
    assert.ok(r.json().id);
  });
});
