/**
 * PR174-R1 (D-PROD-107) — achados da auditoria independente, como testes do
 * comportamento CORRETO. RED executado no HEAD 0187cdd (evidência em
 * evidencias/r2e-p1-lotes-ssot/r1-integracao-completa/red-head-0187cdd.txt).
 * PostgreSQL real, HTTP autenticado, dados sintéticos.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, transferenciaComDerivadoLegado, baixaLegada } from './helpers.mjs';
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
const BOI = 'Boi 25 a 36 meses';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: adm.cliente.id, nome_grupo: 'Manejo' } });
  const tipo = await p.tipoTarefa.create({ data: { cliente_id: adm.cliente.id, nome_tipo: 'Vistoria', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo } });
  return { cliente: adm.cliente, tok, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), tipo };
};
const entrada = async (c, { nome = 'LOTE 001', qtd = 500, area = c.A, data = '2026-10-25' } = {}) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria: BOI, sexo: 'Macho', setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const ativar = (c, extra = {}) => req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, data_corte: '2026-11-01', ...extra });
const posicoes = async (c) => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}`, c.tok)).json().itens;

describe('PR174-R1 achados (comportamento correto)', () => {
  test('A: derivado legado (origem MOVIMENTAÇÃO) NÃO vira segunda entrada na ativação: linhagem rastreada até a entrada original', async () => {
    const c = await cenario();
    const l = await entrada(c);
    // PR174-R4: o derivado é DADO LEGADO pré-existente (o manejo não fabrica mais lote).
    const t = await transferenciaComDerivadoLegado(app, { token: c.tok, empresaId: c.empresa.id, setorId: c.setor.id, origem: l, quantidade: 100, areaDestinoId: c.B.id, data: '2026-10-28T12:00:00.000Z' });
    const derivado = { id: t.derivadoId };
    assert.equal((await ativar(c)).statusCode, 201);
    const ps = await posicoes(c);
    console.log(`  posições: ${JSON.stringify(ps.map((p) => [p.area_atual_nome, p.quantidade_cabecas, p.lote_entrada_id === l.id ? 'ENTRADA ORIGINAL' : p.lote_entrada_id === derivado.id ? 'DERIVADO COMO ENTRADA' : p.lote_entrada_id]))}`);
    assert.ok(!ps.some((p) => p.lote_entrada_id === derivado.id), 'derivado não pode ser lote_entrada_id');
    assert.equal(ps.find((p) => p.area_atual_id === c.B.id)?.lote_entrada_id, l.id, 'posição em B pertence à entrada original');
  });

  test('B: cancelamento de movimento LEGADO numa empresa ativada não pode mexer em Lote (drift) — recusa estável', async () => {
    const c = await cenario();
    const l = await entrada(c);
    // PR174-R5: movimento legado = dado pré-existente (base anterior ao cutover).
    const m = await baixaLegada({ lote: l, quantidade: 5, data: '2026-10-28T12:00:00.000Z' });
    assert.equal((await ativar(c)).statusCode, 201);
    const antes = (await prisma().lote.findUnique({ where: { id: l.id } })).quantidade_cabecas;
    const r = await req('POST', `/movimentacoes-mapa/${m.movimentacao.id}/cancelamento`, c.tok, { operation_id: opId(), motivo: 'teste drift' });
    const depois = (await prisma().lote.findUnique({ where: { id: l.id } })).quantidade_cabecas;
    const ledger = (await posicoes(c)).reduce((t, p) => t + p.quantidade_cabecas, 0);
    console.log(`  cancelamento legado: HTTP ${r.statusCode} ${r.json().code ?? ''}; Lote ${antes}→${depois}; ledger ${ledger}`);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'REBANHO_LEDGER_CANCELAMENTO_LEGADO');
    assert.equal(depois, antes);
  });

  test('E: empresa reconstruída pelas ENTRADAS (sem histórico legado): transferência com data entre a entrada e hoje é aceita', async () => {
    const c = await cenario();
    const l = await entrada(c, { data: '2026-10-25' });
    const a = await ativar(c, { modo: 'entradas', data_corte: undefined });
    console.log(`  ativação modo entradas: HTTP ${a.statusCode} ${a.json().code ?? ''}`);
    assert.equal(a.statusCode, 201, a.body);
    const pA = (await posicoes(c)).find((p) => p.lote_entrada_id === l.id);
    const t = await req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-10-26', itens: [{ posicao_id: pA.id, quantidade: 100 }] });
    assert.equal(t.statusCode, 201, t.body);
  });

  test('F: suplementação e tarefa citando o id da POSIÇÃO guardam a entrada certa (lote_id) e a posição (posicao_id)', async () => {
    const c = await cenario();
    const l = await entrada(c);
    assert.equal((await ativar(c)).statusCode, 201);
    const p = (await posicoes(c))[0];
    const s = await req('POST', '/suplementacao-lotes', c.tok, { empresa_id: c.empresa.id, lote_id: p.id, lote_nome: p.nome, data_lancamento: '2026-11-02' });
    console.log(`  suplementação: HTTP ${s.statusCode} lote_id=${s.json().lote_id === p.id ? 'ID DA POSIÇÃO' : s.json().lote_id === l.id ? 'entrada' : s.json().lote_id} posicao_id=${s.json().posicao_id ?? '-'}`);
    assert.equal(s.statusCode, 201, s.body);
    assert.deepEqual([s.json().lote_id, s.json().posicao_id], [l.id, p.id]);
    const t = await req('POST', '/lancamentos-tarefa', c.tok, { empresa_id: c.empresa.id, titulo: 'T', tipo: 'Manejo', tipo_tarefa_id: c.tipo.id, lote_id: p.id });
    console.log(`  tarefa: HTTP ${t.statusCode} ${t.json().code ?? ''}`);
    assert.equal(t.statusCode, 201, t.body);
    assert.deepEqual([t.json().lote_id, t.json().posicao_id], [l.id, p.id]);
  });

  test('D: manejos na empresa ativada funcionam pelo ledger (Morte, Pesagem) — sem OPERACAO_NAO_MIGRADA', async () => {
    const c = await cenario();
    await entrada(c);
    assert.equal((await ativar(c)).statusCode, 201);
    const p = (await posicoes(c))[0];
    const m = await req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas: [{ categoria: BOI, quantidade: 3, causa_morte: 'Doença' }] });
    const pe = await req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas: [{ lote_id: p.id, peso_medio_kg: 410 }] });
    console.log(`  morte: HTTP ${m.statusCode} ${m.json().code ?? ''}; pesagem: HTTP ${pe.statusCode} ${pe.json().code ?? ''}`);
    assert.equal(m.statusCode, 201, m.body);
    assert.equal(pe.statusCode, 201, pe.body);
  });
});
