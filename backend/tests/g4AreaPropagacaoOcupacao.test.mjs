/**
 * G4 — propagação do nome da área/setor, ocupação derivada e renumeração.
 *
 *  - renomear AreaPastagem reescreve, na MESMA transação do PATCH, as cópias do
 *    nome casadas por id: Lote (área atual e de entrada), tarefa, cocho
 *    (escalar e lista paralela, posição a posição), bebedouro (pasto e lista),
 *    movimento de estoque e documento do mapa — só no tenant e na empresa da
 *    área; homônimo e outro tenant ficam;
 *  - mudar a área de setor leva o setor_nome das tarefas que seguiam a área;
 *  - renomear Setor reescreve área, lote, cocho, bebedouro e documentos do
 *    mapa/pecuária no próprio PATCH;
 *  - GET /areas-pastagem deriva quantidade_atual/status_ocupacao do gado que o
 *    mapa mostra (lote ativo; posição do ledger quando a empresa o ativou);
 *  - POST /areas-pastagem/renumerar troca códigos entre áreas sem colisão,
 *    recusa código de área fora da lista e alinha a sequência.
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

const conta = async () => {
  const c = await criarTenant();
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  assert.ok(corpo.token, 'login');
  return { ...c, clienteId: c.cliente.id, token: corpo.token };
};

let seq = 0;
const n = () => String((seq += 1));
const setor = (c, empresa, nome) =>
  prisma().setor.create({ data: { cliente_id: c, empresa_id: empresa, numero_setor: n(), nome, tipo: 'Próprio' } });
const area = (c, s, extra = {}) =>
  prisma().areaPastagem.create({
    data: { cliente_id: c, empresa_id: s.empresa_id, setor_id: s.id, setor_nome: s.nome, numero_area: n(), nome: `AREA ${n()}`, tamanho_hectares: 10, ...extra },
  });
const lote = (c, empresa, extra = {}) =>
  prisma().lote.create({
    data: { cliente_id: c, empresa_id: empresa, numero_lote: n(), nome: `L${n()}`, quantidade_cabecas: 10, quantidade_entrada: 10, motivo_entrada: 'Compra', ...extra },
  });
const cocho = (c, empresa, extra = {}) =>
  prisma().pontoSuplementacao.create({ data: { cliente_id: c, empresa_id: empresa, numero_ponto: n(), nome_ponto: `COCHO ${n()}`, ...extra } });
const bebedouro = (c, empresa, extra = {}) =>
  prisma().bebedouro.create({ data: { cliente_id: c, empresa_id: empresa, nome: `BEB ${n()}`, tipo: 'Cocho', ...extra } });
const tarefa = async (c, empresa, extra = {}) => {
  const g = await prisma().grupoAtividade.create({ data: { cliente_id: c, nome_grupo: `G${n()}` } });
  const t = await prisma().tipoTarefa.create({ data: { cliente_id: c, nome_tipo: `T${n()}`, grupo_atividade_id: g.id, grupo_atividade_nome: g.nome_grupo } });
  return prisma().lancamentoTarefa.create({
    data: { cliente_id: c, empresa_id: empresa, titulo: `T ${n()}`, tipo: 'x', tipo_tarefa_id: t.id, tipo_tarefa_nome: t.nome_tipo, ...extra },
  });
};

describe('G4 — renomear área propaga o nome por id, na transação do PATCH', () => {
  test('lote, tarefa, cocho (escalar e lista), bebedouro, estoque e mapa; homônimo e outro tenant intactos', async () => {
    const A = await conta();
    const B = await conta();
    const s = await setor(A.clienteId, 'e1', 'RETIRO');
    const alvo = await area(A.clienteId, s, { nome: 'PASTO 1' });
    const outra = await area(A.clienteId, s, { nome: 'PASTO 2' });
    // Homônimo de outra empresa do mesmo tenant: não é casado (só por id).
    const s2 = await setor(A.clienteId, 'e2', 'OUTRO');
    const homonima = await area(A.clienteId, s2, { nome: 'PASTO 1' });

    const l = await lote(A.clienteId, 'e1', { area_atual_id: alvo.id, area_atual_nome: 'PASTO 1', area_entrada_id: alvo.id, area_entrada_nome: 'PASTO 1' });
    const lHomonimo = await lote(A.clienteId, 'e2', { area_atual_id: homonima.id, area_atual_nome: 'PASTO 1' });
    const tar = await tarefa(A.clienteId, 'e1', { area_id: alvo.id, area_nome: 'PASTO 1' });
    const c1 = await cocho(A.clienteId, 'e1', {
      area_vinculada_id: alvo.id,
      area_vinculada_nome: 'PASTO 1',
      area_vinculada_ids: [outra.id, alvo.id],
      area_vinculada_nomes: ['PASTO 2', 'PASTO 1'],
    });
    // Lista de nomes mais curta que a de ids: completa até a posição trocada.
    const c2 = await cocho(A.clienteId, 'e1', { area_vinculada_ids: [outra.id, alvo.id], area_vinculada_nomes: [] });
    const b = await bebedouro(A.clienteId, 'e1', { pasto_id: alvo.id, pasto_nome: 'PASTO 1', area_vinculada_ids: [alvo.id], area_vinculada_nomes: ['PASTO 1'] });
    const mov = await prisma().movimentacaoMapa.create({
      data: { cliente_id: A.clienteId, empresa_id: 'e1', dados: { area_origem_id: outra.id, area_origem_nome: 'PASTO 2', area_destino_id: alvo.id, area_destino_nome: 'PASTO 1' } },
    });
    const est = await prisma().movimentacaoEstoque.create({
      data: {
        cliente_id: A.clienteId, empresa_id: 'e1', numero_movimentacao: `M${n()}`, tipo_movimentacao: 'Saída',
        data_movimentacao: new Date(), produto_id: 'p1', quantidade: 1, unidade_medida: 'kg',
        area_vinculada_id: alvo.id, area_vinculada_nome: 'PASTO 1',
      },
    });
    const estHomonimo = await prisma().movimentacaoEstoque.create({
      data: {
        cliente_id: A.clienteId, empresa_id: 'e2', numero_movimentacao: `M${n()}`, tipo_movimentacao: 'Saída',
        data_movimentacao: new Date(), produto_id: 'p1', quantidade: 1, unidade_medida: 'kg',
        area_vinculada_id: homonima.id, area_vinculada_nome: 'PASTO 1',
      },
    });
    // Outro tenant com o MESMO id na lista (id forjado): não é tocado.
    const cB = await cocho(B.clienteId, 'e1', { area_vinculada_id: alvo.id, area_vinculada_nome: 'PASTO 1', area_vinculada_ids: [alvo.id], area_vinculada_nomes: ['PASTO 1'] });

    const r = await req('PATCH', `/areas-pastagem/${alvo.id}`, A.token, { nome: 'PASTO NORTE' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nome, 'PASTO NORTE');

    const lDepois = await prisma().lote.findUnique({ where: { id: l.id } });
    assert.equal(lDepois.area_atual_nome, 'PASTO NORTE');
    assert.equal(lDepois.area_entrada_nome, 'PASTO NORTE');
    assert.equal((await prisma().lote.findUnique({ where: { id: lHomonimo.id } })).area_atual_nome, 'PASTO 1');
    assert.equal((await prisma().lancamentoTarefa.findUnique({ where: { id: tar.id } })).area_nome, 'PASTO NORTE');

    const c1Depois = await prisma().pontoSuplementacao.findUnique({ where: { id: c1.id } });
    assert.equal(c1Depois.area_vinculada_nome, 'PASTO NORTE');
    assert.deepEqual(c1Depois.area_vinculada_nomes, ['PASTO 2', 'PASTO NORTE'], 'só a posição do id muda');
    assert.deepEqual((await prisma().pontoSuplementacao.findUnique({ where: { id: c2.id } })).area_vinculada_nomes, ['', 'PASTO NORTE']);

    const bDepois = await prisma().bebedouro.findUnique({ where: { id: b.id } });
    assert.equal(bDepois.pasto_nome, 'PASTO NORTE');
    assert.deepEqual(bDepois.area_vinculada_nomes, ['PASTO NORTE']);

    const movDepois = (await prisma().movimentacaoMapa.findUnique({ where: { id: mov.id } })).dados;
    assert.equal(movDepois.area_destino_nome, 'PASTO NORTE');
    assert.equal(movDepois.area_origem_nome, 'PASTO 2');

    assert.equal((await prisma().movimentacaoEstoque.findUnique({ where: { id: est.id } })).area_vinculada_nome, 'PASTO NORTE');
    assert.equal((await prisma().movimentacaoEstoque.findUnique({ where: { id: estHomonimo.id } })).area_vinculada_nome, 'PASTO 1', 'homônimo intacto');

    const cBDepois = await prisma().pontoSuplementacao.findUnique({ where: { id: cB.id } });
    assert.equal(cBDepois.area_vinculada_nome, 'PASTO 1', 'outro tenant intacto');
    assert.deepEqual(cBDepois.area_vinculada_nomes, ['PASTO 1']);

    const eventos = await prisma().auditLog.findMany({ where: { cliente_id: A.clienteId, acao: 'propagar_referencias', entidade: 'AreaPastagem' } });
    assert.equal(eventos.length, 1, 'um evento-resumo da propagação');

    // Reenviar o mesmo nome não varre nada (sem novo evento).
    const r2 = await req('PATCH', `/areas-pastagem/${alvo.id}`, A.token, { nome: 'PASTO NORTE' });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal((await prisma().auditLog.count({ where: { cliente_id: A.clienteId, acao: 'propagar_referencias', entidade: 'AreaPastagem' } })), 1);
  });

  test('mudar a área de setor leva o setor_nome das tarefas que seguiam a área', async () => {
    const A = await conta();
    const s1 = await setor(A.clienteId, 'e1', 'RETIRO');
    const s2 = await setor(A.clienteId, 'e1', 'SEDE');
    const a = await area(A.clienteId, s1, { nome: 'PASTO 1' });
    const segue = await tarefa(A.clienteId, 'e1', { area_id: a.id, area_nome: 'PASTO 1', setor_nome: 'RETIRO' });
    const proprio = await tarefa(A.clienteId, 'e1', { area_id: a.id, area_nome: 'PASTO 1', setor_nome: 'MANUAL' });

    const r = await req('PATCH', `/areas-pastagem/${a.id}`, A.token, { setor_id: s2.id });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().setor_nome, 'SEDE');
    assert.equal((await prisma().lancamentoTarefa.findUnique({ where: { id: segue.id } })).setor_nome, 'SEDE');
    assert.equal((await prisma().lancamentoTarefa.findUnique({ where: { id: proprio.id } })).setor_nome, 'MANUAL');
  });
});

describe('G4 — renomear setor propaga no próprio PATCH', () => {
  test('área, lote, cocho, bebedouro e documentos do setor recebem o nome novo; outro setor não', async () => {
    const A = await conta();
    const s = await prisma().setor.create({ data: { cliente_id: A.clienteId, empresa_id: 'e1', numero_setor: n(), nome: 'RETIRO', tipo: 'Próprio' } });
    const outro = await setor(A.clienteId, 'e1', 'RETIRO');
    const a = await area(A.clienteId, s);
    const l = await lote(A.clienteId, 'e1', { setor_id: s.id, setor_nome: 'RETIRO' });
    const c = await cocho(A.clienteId, 'e1', { setor_id: s.id, setor_nome: 'RETIRO' });
    const b = await bebedouro(A.clienteId, 'e1', { setor_id: s.id, setor_nome: 'RETIRO' });
    const bOutro = await bebedouro(A.clienteId, 'e1', { setor_id: outro.id, setor_nome: 'RETIRO' });
    const movMapa = await prisma().movimentacaoMapa.create({
      data: {
        cliente_id: A.clienteId, empresa_id: 'e1',
        dados: { setor_id: s.id, setor_nome: 'RETIRO', setor_origem_id: outro.id, setor_origem_nome: 'RETIRO', setor_destino_id: s.id, setor_destino_nome: 'RETIRO' },
      },
    });
    const movPec = await prisma().movimentacaoPecuaria.create({
      data: { cliente_id: A.clienteId, empresa_id: 'e1', dados: { setor_id: s.id, setor_nome: 'RETIRO' } },
    });

    const r = await req('PATCH', `/setores/${s.id}`, A.token, { nome: 'RETIRO NORTE' });
    assert.equal(r.statusCode, 200, r.body);

    assert.equal((await prisma().areaPastagem.findUnique({ where: { id: a.id } })).setor_nome, 'RETIRO NORTE');
    assert.equal((await prisma().lote.findUnique({ where: { id: l.id } })).setor_nome, 'RETIRO NORTE');
    assert.equal((await prisma().pontoSuplementacao.findUnique({ where: { id: c.id } })).setor_nome, 'RETIRO NORTE');
    assert.equal((await prisma().bebedouro.findUnique({ where: { id: b.id } })).setor_nome, 'RETIRO NORTE');
    assert.equal((await prisma().bebedouro.findUnique({ where: { id: bOutro.id } })).setor_nome, 'RETIRO', 'homônimo intacto');

    const mapaDepois = (await prisma().movimentacaoMapa.findUnique({ where: { id: movMapa.id } })).dados;
    assert.equal(mapaDepois.setor_nome, 'RETIRO NORTE');
    assert.equal(mapaDepois.setor_destino_nome, 'RETIRO NORTE');
    assert.equal(mapaDepois.setor_origem_nome, 'RETIRO', 'setor de origem é outro setor');
    assert.equal((await prisma().movimentacaoPecuaria.findUnique({ where: { id: movPec.id } })).dados.setor_nome, 'RETIRO NORTE');
  });
});

describe('G4 — ocupação derivada na leitura', () => {
  test('lotes ativos somam cabeças e ocupam; sem gado é Disponível; ledger usa as posições', async () => {
    const A = await conta();
    const s = await setor(A.clienteId, 'e1', 'RETIRO');
    const comGado = await area(A.clienteId, s, { capacidade_maxima: 100 });
    const vazia = await area(A.clienteId, s, { status_ocupacao: 'Alto', quantidade_atual: 50 });
    const semCapacidade = await area(A.clienteId, s, { status_ocupacao: 'Sobrepastoreado' });
    await lote(A.clienteId, 'e1', { area_atual_id: comGado.id, quantidade_cabecas: 30, peso_medio_kg: 450 });
    await lote(A.clienteId, 'e1', { area_atual_id: comGado.id, quantidade_cabecas: 20, peso_medio_kg: 450 });
    await lote(A.clienteId, 'e1', { area_atual_id: comGado.id, quantidade_cabecas: 99, status: 'Inativo' });
    await lote(A.clienteId, 'e1', { area_atual_id: comGado.id, quantidade_cabecas: 99, excluido_em: new Date() });
    await lote(A.clienteId, 'e1', { area_atual_id: semCapacidade.id, quantidade_cabecas: 5 });

    // Empresa com ledger ativo: conta posições, não lotes.
    const empresa = await prisma().empresa.create({ data: { cliente_id: A.clienteId, numero_empresa: 1, apelido: 'L', nome: 'Ledger' } });
    const sL = await setor(A.clienteId, empresa.id, 'LEDGER');
    const aL = await area(A.clienteId, sL, { capacidade_maxima: 10 });
    await prisma().rebanhoLedgerAtivacao.create({ data: { cliente_id: A.clienteId, empresa_id: empresa.id, data_corte: new Date('2026-10-01T00:00:00Z') } });
    await lote(A.clienteId, empresa.id, { area_atual_id: aL.id, quantidade_cabecas: 500 });
    await prisma().posicaoRebanho.create({
      data: { cliente_id: A.clienteId, empresa_id: empresa.id, area_id: aL.id, chave_identidade: `k-${randomUUID()}`, nome: 'POS', quantidade_cabecas: 12, peso_medio_kg: 450 },
    });

    const r = await req('GET', '/areas-pastagem', A.token);
    assert.equal(r.statusCode, 200, r.body);
    const porId = new Map(r.json().map((a) => [a.id, a]));
    assert.deepEqual(
      { q: porId.get(comGado.id).quantidade_atual, s: porId.get(comGado.id).status_ocupacao },
      { q: 50, s: 'Médio' },
      '50 UA em 100 de capacidade = 50%'
    );
    assert.deepEqual({ q: porId.get(vazia.id).quantidade_atual, s: porId.get(vazia.id).status_ocupacao }, { q: 0, s: 'Disponível' });
    assert.deepEqual(
      { q: porId.get(semCapacidade.id).quantidade_atual, s: porId.get(semCapacidade.id).status_ocupacao },
      { q: 5, s: 'Sobrepastoreado' },
      'sem como medir, vale o gravado de área ocupada'
    );
    assert.deepEqual({ q: porId.get(aL.id).quantidade_atual, s: porId.get(aL.id).status_ocupacao }, { q: 12, s: 'Sobrepastoreado' });

    // A resposta do PATCH também vem derivada.
    const p = await req('PATCH', `/areas-pastagem/${comGado.id}`, A.token, { observacoes: 'x' });
    assert.equal(p.statusCode, 200, p.body);
    assert.equal(p.json().quantidade_atual, 50);
  });
});

describe('G4 — renumeração de áreas', () => {
  test('troca 1↔2 numa operação só, audita e alinha a sequência', async () => {
    const A = await conta();
    const s = await setor(A.clienteId, 'e1', 'RETIRO');
    const r1 = await req('POST', '/areas-pastagem', A.token, { empresa_id: 'e1', setor_id: s.id, nome: 'P1', tamanho_hectares: 1 });
    const r2 = await req('POST', '/areas-pastagem', A.token, { empresa_id: 'e1', setor_id: s.id, nome: 'P2', tamanho_hectares: 1 });
    const a1 = r1.json();
    const a2 = r2.json();
    assert.deepEqual([a1.numero_area, a2.numero_area], ['1', '2']);

    const r = await req('POST', '/areas-pastagem/renumerar', A.token, {
      itens: [
        { id: a1.id, numero_area: '2' },
        { id: a2.id, numero_area: '1' },
      ],
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().itens.map((a) => a.numero_area), ['2', '1']);

    const alto = await req('POST', '/areas-pastagem/renumerar', A.token, { itens: [{ id: a1.id, numero_area: '40' }] });
    assert.equal(alto.statusCode, 200, alto.body);
    const r3 = await req('POST', '/areas-pastagem', A.token, { empresa_id: 'e1', setor_id: s.id, nome: 'P3', tamanho_hectares: 1 });
    assert.equal(r3.statusCode, 201, r3.body);
    assert.equal(r3.json().numero_area, '41', 'a próxima criação não colide com o código reatribuído');
  });

  test('código de área fora da lista, id de outro tenant e lista repetida são recusados sem gravar', async () => {
    const A = await conta();
    const B = await conta();
    const s = await setor(A.clienteId, 'e1', 'RETIRO');
    const a1 = await area(A.clienteId, s, { numero_area: '1' });
    await area(A.clienteId, s, { numero_area: '2', nome: 'OCUPANTE' });
    const sB = await setor(B.clienteId, 'e1', 'B');
    const aB = await area(B.clienteId, sB, { numero_area: '9' });

    const ocupado = await req('POST', '/areas-pastagem/renumerar', A.token, { itens: [{ id: a1.id, numero_area: '2' }] });
    assert.equal(ocupado.statusCode, 400, ocupado.body);
    assert.match(ocupado.json().message, /OCUPANTE/);
    assert.equal((await prisma().areaPastagem.findUnique({ where: { id: a1.id } })).numero_area, '1');

    const alheia = await req('POST', '/areas-pastagem/renumerar', A.token, { itens: [{ id: aB.id, numero_area: '5' }] });
    assert.equal(alheia.statusCode, 404, alheia.body);
    assert.equal((await prisma().areaPastagem.findUnique({ where: { id: aB.id } })).numero_area, '9');

    const repetido = await req('POST', '/areas-pastagem/renumerar', A.token, { itens: [{ id: a1.id, numero_area: '7' }, { id: a1.id, numero_area: '8' }] });
    assert.equal(repetido.statusCode, 400, repetido.body);

    // O PATCH genérico continua recusando numero_area e corpo vazio.
    assert.equal((await req('PATCH', `/areas-pastagem/${a1.id}`, A.token, { numero_area: '3' })).statusCode, 400);
    assert.equal((await req('PATCH', `/areas-pastagem/${a1.id}`, A.token, {})).statusCode, 400);
  });
});
