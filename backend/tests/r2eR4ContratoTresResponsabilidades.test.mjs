/**
 * PR174-R4 (D-PROD-107) — contrato das TRÊS responsabilidades:
 *  Lote = só a ENTRADA (cadastro de origem; nunca saldo, nunca criado por manejo);
 *  PosicaoRebanho = estado ATUAL (área, cabeças, categoria, sexo, peso…);
 *  MovimentacaoMapa = histórico operacional de TODOS os manejos (inclusive pesagem).
 * PostgreSQL real + HTTP autenticado.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaLedger } from '../src/modules/rebanhoLedger/rebanhoLedgerService.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;
before(async () => {
  process.env.NODE_ENV = 'test';
  app = await criarApp();
  await app.ready();
});
after(async () => {
  definirFalhaInjetadaLedger(null);
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  definirFalhaInjetadaLedger(null);
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
  return { cliente: adm.cliente, tok, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
};
const entrada = async (c, { nome = 'LOTE', qtd = 40, area = c.A, data = '2026-10-25', categoria = BOI, sexo = 'Macho', peso = 400 } = {}) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
/** Empresa reconstruída pelas entradas (linha do tempo completa desde cada entrada). */
const ativar = async (c) => {
  const r = await req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const posicoes = async (c) => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}&incluir_vazias=true`, c.tok)).json().itens;
const pos = async (c, filtro) => (await posicoes(c)).find(filtro);
const daEntrada = (lote, area) => (p) => p.lote_entrada_id === lote.id && p.area_atual_id === area.id;
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const verificar = async (c) => {
  const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
  assert.equal(v.integro, true, JSON.stringify(v));
  return v;
};
const loteFixo = async (c) => (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.quantidade_entrada, l.status, l.area_atual_id, l.categoria, l.origem]);
const contagem = async (c) => {
  const p = prisma();
  const w = { cliente_id: c.cliente.id };
  return {
    lotes: await loteFixo(c),
    posicoes: (await p.posicaoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.quantidade_cabecas, x.peso_medio_kg === null ? null : Number(x.peso_medio_kg), JSON.stringify(x.linhagem)]),
    eventos: await p.eventoRebanho.count({ where: w }),
    partidas: await p.partidaRebanho.count({ where: w }),
    pesos: await p.pesoRebanho.count({ where: w }),
    movs: await p.movimentacaoMapa.count({ where: w }),
    audits: await p.auditLog.count({ where: w }),
    ops: await p.operacaoIdempotente.count({ where: w }),
  };
};
const exigirNadaGravado = async (c, acao, status, codigo) => {
  const antes = await contagem(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await contagem(c), antes, 'nada pode ser gravado');
  return r;
};
const cancelar = (c, movId, operation_id = opId()) => req('POST', `/movimentacoes-mapa/${movId}/cancelamento`, c.tok, { operation_id, motivo: 'teste do ledger' });
const rebanho = (c, tipo, linhas, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas, ...extra });
const transferir = (c, itens, destino, dia) =>
  req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: destino.id, data_movimentacao: `2026-11-${dia}`, itens });




const VACA = 'Vaca + 36 meses';
const CODIGO = 'LOTE_CADASTRO_SOMENTE_ENTRADAS';
const juntar = (c, principal, origens, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: principal.id, lote_origem_ids: origens.map((o) => o.id), data_movimentacao: '2026-11-02', ...extra });
const qtdLotes = (c) => prisma().lote.count({ where: { cliente_id: c.cliente.id } });
const manejoLote = (c, body) => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, data_movimentacao: '2026-10-28', ...body });

// ═══ Empresa LEGADA (pré-cutover): manejo nunca fabrica registro no cadastro de entradas ═══

describe('R4 L — cadastro só de entradas também na empresa legada', () => {
  test('L1: transferência PARCIAL para pasto sem lote igual → 409 (criaria lote derivado); nada gravado', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100 });
    const antes = await qtdLotes(c);
    await exigirNadaGravado(c, () => manejoLote(c, { tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: 30, area_destino_id: c.B.id, categoria_animal: BOI }), 409, CODIGO);
    assert.equal(await qtdLotes(c), antes);
  });

  test('L2: nascimento legado → 409 (criaria lote de nascidos); mudança de categoria PARCIAL → 409', async () => {
    const c = await cenario();
    await entrada(c, { nome: 'VACAS', qtd: 20, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    await entrada(c, { nome: 'BOIS', qtd: 40 });
    await exigirNadaGravado(c, () => rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Macho', quantidade: 3 }]), 409, CODIGO);
    await exigirNadaGravado(c, () => rebanho(c, 'Mudança de Categoria', [{ categoria_atual: BOI, categoria_nova: 'Touro + 36 meses', quantidade: 10 }]), 409, CODIGO);
  });

  test('L3: cadastro manual com origem de manejo (Movimentação, Mudança de Categoria) → 409; entrada genuína → 201', async () => {
    const c = await cenario();
    for (const origem of ['Movimentação', 'Mudança de Categoria', 'Reversão Movimentação']) {
      const r = await req('POST', '/lotes', c.tok, { empresa_id: c.empresa.id, nome: 'X', quantidade_cabecas: 5, categoria: BOI, sexo: 'Macho', setor_id: c.setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id, data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', origem });
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().code, CODIGO);
    }
    assert.equal(await qtdLotes(c), 0);
    await entrada(c, { qtd: 10 });
    assert.equal(await qtdLotes(c), 1);
  });

  test('L4 controles legados que NÃO fabricam cadastro seguem: transferência total, morte', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 50 });
    await ok(manejoLote(c, { tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: 50, area_destino_id: c.B.id, categoria_animal: BOI }));
    await ok(req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.B.id, data_movimentacao: '2026-10-29', linhas: [{ categoria: BOI, quantidade: 2, causa_morte: 'Doença' }] }));
    assert.equal(await qtdLotes(c), 1);
  });
});

// ═══ Empresa ATIVADA: as três responsabilidades ponta a ponta ════════════════

describe('R4 C — contrato das três responsabilidades (empresa no ledger)', () => {
  test('C1: 500 → 300 A / 200 B; morte 5 em B = 195; pesagem B; nascimento sem Lote; 02 depois 01; junção + cancelamento; Lote 500 intacto', async () => {
    const c = await cenario();
    const l = await entrada(c, { nome: 'COMPRA 500', qtd: 500, peso: 400 });
    const v = await entrada(c, { nome: 'VACAS', qtd: 20, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    const l2 = await entrada(c, { nome: 'COMPRA 2', qtd: 60, peso: 380 });
    await ativar(c);
    const entradas = await qtdLotes(c);
    const pA = await pos(c, daEntrada(l, c.A));
    // transferência do dia 02 e depois a retroativa do dia 01: 300 / 200
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '02'));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '01'));
    const pB = await pos(c, daEntrada(l, c.B));
    assert.deepEqual([(await pos(c, daEntrada(l, c.A))).quantidade_cabecas, pB.quantidade_cabecas], [300, 200]);
    // morte de 5 em B
    await ok(req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.B.id, data_movimentacao: '2026-11-03', linhas: [{ categoria: BOI, quantidade: 5, causa_morte: 'Doença' }] }));
    assert.equal((await pos(c, daEntrada(l, c.B))).quantidade_cabecas, 195);
    // pesagem de B: peso ATUAL na posição + histórico em MovimentacaoMapa
    const pes = await ok(rebanho(c, 'Pesagem', [{ lote_id: pB.id, peso_medio_kg: 431.5 }], { area_id: c.B.id, data_movimentacao: '2026-11-04' }));
    assert.equal(Number((await pos(c, daEntrada(l, c.B))).peso_medio_kg), 431.5);
    const movPes = await prisma().movimentacaoMapa.findUnique({ where: { id: pes.movimentacao.id } });
    const linha = movPes.dados.linhas[0];
    assert.deepEqual([movPes.dados.tipo, linha.posicao_id, linha.peso_anterior_kg, linha.peso_novo_kg, linha.quantidade_cabecas], ['Pesagem', pB.id, 400, 431.5, 195]);
    // nascimento: posição nova, nenhum Lote
    await ok(rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Fêmea', quantidade: 4 }], { data_movimentacao: '2026-11-05' }));
    // junção (A: COMPRA 500 + COMPRA 2) e cancelamento
    const jn = await ok(juntar(c, await pos(c, daEntrada(l, c.A)), [await pos(c, daEntrada(l2, c.A))], { data_movimentacao: '2026-11-06' }));
    await ok(cancelar(c, jn.movimentacao.id), 200);
    // Lote: só as entradas, intactas
    assert.equal(await qtdLotes(c), entradas, 'nenhum Lote criado por manejo');
    const cad = await prisma().lote.findUnique({ where: { cliente_id_id: { cliente_id: c.cliente.id, id: l.id } } });
    assert.deepEqual([cad.quantidade_cabecas, cad.quantidade_entrada, cad.area_atual_id, cad.status, Number(cad.peso_medio_kg)], [500, 500, c.A.id, 'Ativo', 400]);
    void v;
    // MovimentacaoMapa: um registro certificado por manejo, 1:1 com o evento interno
    const movs = await prisma().movimentacaoMapa.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(movs.map((m) => m.dados.tipo), ['Transferência de Área', 'Transferência de Área', 'Morte', 'Pesagem', 'Nascimento', 'Junção de Lotes']);
    const eventos = await prisma().eventoRebanho.findMany({ where: { cliente_id: c.cliente.id, NOT: { tipo: 'ENTRADA' } } });
    assert.equal(eventos.length, movs.length);
    for (const m of movs) assert.ok(eventos.some((e) => e.movimentacao_id === m.id && m.dados.efeito_servidor?.evento_id === e.id), `1:1 ${m.dados.tipo}`);
    assert.equal(movs.find((m) => m.dados.tipo === 'Junção de Lotes').dados.situacao, 'cancelado');
    await verificar(c);
  });

  test('C2: posição pública traz os atributos atuais E a proveniência da entrada (raça, sistema, data de entrada); cadastro não muda', async () => {
    const c = await cenario();
    const r = await req('POST', '/lotes', c.tok, { empresa_id: c.empresa.id, nome: 'NELORE', quantidade_cabecas: 30, categoria: BOI, sexo: 'Macho', setor_id: c.setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id, data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400, raca_predominante: 'Nelore', sistema_produtivo: 'Recria' });
    assert.equal(r.statusCode, 201, r.body);
    await ativar(c);
    const p = await pos(c, daEntrada(r.json(), c.A));
    assert.deepEqual([p.area_atual_id, p.quantidade_cabecas, p.categoria, p.sexo, Number(p.peso_medio_kg), p.nome, p.raca_predominante, p.sistema_produtivo, p.data_entrada], [c.A.id, 30, BOI, 'Macho', 400, 'NELORE', 'Nelore', 'Recria', '2026-10-25']);
  });
});
