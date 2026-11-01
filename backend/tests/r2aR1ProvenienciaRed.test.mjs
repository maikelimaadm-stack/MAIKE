/**
 * R2A-R1 — prova emprestada: RED no HEAD f45c6a2d (veio 200 e saldo 500; ver
 * docs/engineering/evidencias/r2a-r1/red-prova-emprestada-antes.txt), GREEN depois.
 * Duas mortes de 50 no mesmo lote, um único PATCH (-50). Cancelar a #B (sem
 * efeito real) NÃO pode usar a auditoria da #A.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

let app;
before(async () => { app = await criarApp(); await app.ready(); });
after(async () => { await app.close(); await encerrar(); });
beforeEach(async () => { await limparBanco(); });

test('RED: morte #B sem efeito não pode ser cancelada com a auditoria da #A', async () => {
  const p = getPrismaClient();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const h = { authorization: `Bearer ${tok}` };
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'F', nome: 'F' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'S' } });
  const area = await p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: 'S', numero_area: '1', nome: 'A', tamanho_hectares: 1 } });
  const lote = (await app.inject({ method: 'POST', url: '/lotes', headers: h, payload: { empresa_id: empresa.id, nome: 'L', quantidade_cabecas: 500, setor_id: setor.id, area_entrada_id: area.id, area_atual_id: area.id, motivo_entrada: 'Compra', status: 'Ativo' } })).json();
  const mov = async () => (await app.inject({ method: 'POST', url: '/movimentacoes-mapa', headers: h, payload: { empresa_id: empresa.id, tipo: 'Morte', lote: 'L', lote_id: lote.id, quantidade_animais: 50, area_origem_id: area.id, data_movimentacao: '2026-10-30T12:00:00.000Z' } })).json();
  await mov(); // #A
  await app.inject({ method: 'PATCH', url: `/lotes/${lote.id}`, headers: h, payload: { quantidade_cabecas: 450, estado_esperado: { quantidade_cabecas: 500 } } });
  const b = await mov(); // #B — sem PATCH
  const r = await app.inject({ method: 'POST', url: `/movimentacoes-mapa/${b.id}/cancelamento`, headers: h, payload: { operation_id: `op-${randomUUID()}`, motivo: 'teste red' } });
  const depois = await p.lote.findUnique({ where: { id: lote.id } });
  assert.equal(r.statusCode, 409, `cancelamento de #B deveria ser recusado; veio ${r.statusCode} e saldo ${depois.quantidade_cabecas}`);
  assert.equal(depois.quantidade_cabecas, 450);
});
