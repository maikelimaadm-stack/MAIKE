/**
 * R2A-R2 (D-PROD-99b) — estado causal completo e fail-closed no cancelamento.
 *
 * O CAS de `PATCH /lotes` (R2A-R1) impede escrita OBSOLETA, mas permite uma
 * escrita VÁLIDA (com `estado_esperado` correto) depois do movimento. Antes
 * desta correção, o cancelamento somava `antes − depois` sobre a quantidade
 * atual e devolvia animais sem prova. Aqui: PostgreSQL real, HTTP, auth.
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
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = async (n, nome, emp = empresa) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tokAdm, empresa, outraEmpresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), C: await area(3, 'PASTO C') };
};

const criarLote = async (c, { nome = 'NELORE', qtd = 500, area, categoria = 'BOI' }) => {
  const r = await req('POST', '/lotes', c.tokAdm, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo: 'Macho', setor_id: c.setor.id,
    area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo',
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const lote = (id) => prisma().lote.findUnique({ where: { id } });
const manejo = (c, corpo) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tokAdm, {
    operation_id: opId(), empresa_id: c.empresa.id, data_movimentacao: '2026-10-30T12:00:00.000Z', ...corpo,
  });
/** PR174-R5: manejo só no ledger — ativa a empresa (pelas entradas) e devolve a posição da entrada. */
const posicaoNoLedger = async (c, l) => {
  if (!c.ativo) {
    const a = await req('POST', '/rebanho/ativacao', c.tokAdm, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' });
    assert.equal(a.statusCode, 201, a.body);
    c.ativo = true;
  }
  const itens = (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}&incluir_vazias=true`, c.tokAdm)).json().itens;
  return itens.find((x) => x.lote_entrada_id === l.id);
};
describe('R2A-R2 P0-C — o comando não confia no formulário', () => {
  test('categoria_animal divergente da categoria real da posição → recusada (ledger); nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A, categoria: 'BOI' });
    const p = await posicaoNoLedger(c, l);
    const r = await manejo(c, { tipo: 'Morte', lote_id: p.id, quantidade_animais: 5, categoria_animal: 'VACA' });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'MANEJO_ESTADO_INVALIDO');
    assert.equal((await posicaoNoLedger(c, l)).quantidade_cabecas, 500);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
    assert.equal(await prisma().movimentacaoMapa.count(), 0);
  });

  test('categoria_animal ausente: o movimento grava a categoria AUTORITATIVA da posição (ledger)', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A, categoria: 'BOI' });
    const p = await posicaoNoLedger(c, l);
    const r = await manejo(c, { tipo: 'Morte', lote_id: p.id, quantidade_animais: 5 });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().movimentacao.categoria_animal, 'BOI');
    assert.equal((await lote(l.id)).quantidade_cabecas, 500, 'Lote não recebe o manejo');
  });

  for (const data of ['ontem', '2026-13-45', '2026-02-30T12:00:00.000Z', '']) {
    test(`data_movimentacao inválida (${JSON.stringify(data)}) → 400 e nada é criado`, async () => {
      const c = await cenario();
      const l = await criarLote(c, { area: c.A });
      const r = await manejo(c, { tipo: 'Morte', lote_id: l.id, quantidade_animais: 5, data_movimentacao: data });
      assert.equal(r.statusCode, 400, r.body);
      assert.equal((await lote(l.id)).quantidade_cabecas, 500);
      assert.equal(await prisma().movimentacaoMapa.count(), 0);
    });
  }

  test('área de destino de OUTRA empresa do mesmo tenant → 404 (ledger); posição intacta', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const setorAlheio = await prisma().setor.create({ data: { cliente_id: c.cliente.id, empresa_id: c.outraEmpresa.id, numero_setor: '99', nome: 'S' } });
    const alheia = await prisma().areaPastagem.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.outraEmpresa.id, setor_id: setorAlheio.id, setor_nome: 'S', numero_area: '9', nome: 'ALHEIA', tamanho_hectares: 1 },
    });
    const p = await posicaoNoLedger(c, l);
    const r = await manejo(c, { tipo: 'Transferência de Área', lote_id: p.id, quantidade_animais: 5, area_destino_id: alheia.id });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal((await posicaoNoLedger(c, l)).quantidade_cabecas, 500);
    assert.equal(await prisma().movimentacaoMapa.count(), 0);
  });

  test('POST genérico não injeta efeito_servidor, modo_transferencia, lote_destino_id nem estado de cancelamento', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    for (const campo of [
      { efeito_servidor: { comando: 'manejo_mapa_lote', operation_id: 'x', efeitos: [] } },
      { modo_transferencia: 'total_no_lugar' }, { lote_destino_id: l.id }, { situacao: 'cancelado' }, { cancelamento: {} },
    ]) {
      const r = await req('POST', '/movimentacoes-mapa', c.tokAdm, {
        empresa_id: c.empresa.id, tipo: 'Morte', lote: l.nome, lote_id: l.id, quantidade_animais: 1, data_movimentacao: '2026-10-30T12:00:00.000Z', ...campo,
      });
      assert.equal(r.statusCode, 400, `${Object.keys(campo)[0]} ${r.body}`);
    }
  });
});
