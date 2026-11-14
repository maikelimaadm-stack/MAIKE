/**
 * D-PROD-198 — peso objetivo na Categoria de Manejo e peso projetado na lista de posições.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, criarCurvaGanhoDeTeste } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { comRelogioDeTeste } from '../src/modules/rebanhoLedger/rebanhoLedgerTempo.js';

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
const BOI = 'Boi 25 a 36 meses';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const A = await p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: '1', nome: 'PASTO A', tamanho_hectares: 10 } });
  const curva = await criarCurvaGanhoDeTeste(p, { clienteId: adm.cliente.id, empresaId: empresa.id, nome: 'PASTO 0,5', gmd: '0.500' });
  return { cliente: adm.cliente, tok, empresa, setor, A, curva };
};

const novaCategoria = (c, extra = {}) => req('POST', '/categorias-manejo', c.tok, {
  empresa_id: c.empresa.id, nome: 'BOI PASTO', sexo: 'Macho', idade_minima_meses: 25, idade_maxima_meses: 36, curva_ganho_id: c.curva.id, ...extra,
});

describe('D-PROD-198 — peso objetivo na Categoria de Manejo', () => {
  test('opcional; grava com 2 casas, aceita vírgula, limpa com vazio; recusa ≤ 0, > 3000 e texto', async () => {
    const c = await cenario();
    const sem = await novaCategoria(c);
    assert.equal(sem.statusCode, 201, sem.body);
    assert.equal(sem.json().peso_objetivo_kg, null);

    const com = await novaCategoria(c, { nome: 'BOI CONF', peso_objetivo_kg: '540,456' });
    assert.equal(com.statusCode, 201, com.body);
    assert.equal(com.json().peso_objetivo_kg, 540.46);

    const p = await req('PATCH', `/categorias-manejo/${com.json().id}`, c.tok, { peso_objetivo_kg: 520 });
    assert.equal(p.statusCode, 200, p.body);
    assert.equal(p.json().peso_objetivo_kg, 520);
    const limpo = await req('PATCH', `/categorias-manejo/${com.json().id}`, c.tok, { peso_objetivo_kg: '' });
    assert.equal(limpo.json().peso_objetivo_kg, null);

    for (const ruim of [0, -5, 3000.5, 'abc', true]) {
      const r = await req('PATCH', `/categorias-manejo/${com.json().id}`, c.tok, { peso_objetivo_kg: ruim });
      assert.equal(r.statusCode, 400, `${JSON.stringify(ruim)} → ${r.body}`);
      assert.equal(r.json().reason, 'peso_objetivo_invalido', r.body);
    }
    const lido = (await req('GET', `/categorias-manejo`, c.tok)).json().find((x) => x.id === com.json().id);
    assert.equal(lido.peso_objetivo_kg, null);
  });
});

describe('D-PROD-198 — peso projetado na lista de posições', () => {
  test('entrada com peso → projetado = peso + dias × GMD; objetivo e data prevista; @ = kg ÷ 30', async () => {
    const c = await cenario();
    const cat = (await novaCategoria(c, { peso_objetivo_kg: 420 })).json();
    const r = await req('POST', '/lotes', c.tok, {
      empresa_id: c.empresa.id, nome: 'LOTE 1', quantidade_cabecas: 20, categoria: BOI, sexo: 'Macho', categoria_manejo_id: cat.id,
      setor_id: c.setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id, data_entrada: '2027-06-01', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400,
    });
    assert.equal(r.statusCode, 201, r.body);
    const at = await req('POST', '/rebanho/ativacao', c.tok, { operation_id: `op-${randomUUID()}`, empresa_id: c.empresa.id, modo: 'entradas' });
    assert.equal(at.statusCode, 201, at.body);

    // Relógio de teste: hoje = 2027-06-15 (o padrão do runner) → 14 dias depois da entrada.
    const lista = await comRelogioDeTeste('2027-06-15T15:00:00.000Z', async () => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}`, c.tok)).json());
    assert.equal(lista.ativo, true);
    const pos = lista.itens.find((p) => p.categoria_manejo_id === cat.id);
    assert.ok(pos, JSON.stringify(lista.itens));
    const pr = pos.projecao_peso;
    assert.equal(pr.disponivel, true, JSON.stringify(pr));
    assert.equal(pr.dia, '2027-06-15');
    assert.equal(pr.base.dia, '2027-06-01');
    assert.equal(pr.base.peso_kg, 400);
    assert.equal(pr.base.dias, 14);
    assert.equal(pr.peso_kg, 407);
    assert.equal(pr.arroba, 13.57);
    assert.equal(pr.gmd_hoje_kg, 0.5);
    assert.equal(pr.peso_objetivo_kg, 420);
    assert.equal(pr.falta_kg, 13);
    assert.equal(pr.data_prevista_objetivo, '2027-07-11'); // 13 ÷ 0,5 = 26 dias
    assert.equal(pr.projecao_mensal[0].dia, '2027-06-30');
    assert.equal(pr.projecao_mensal[0].peso_kg, 414.5);
    assert.equal(pr.ultima_pesagem, null);
  });
});
