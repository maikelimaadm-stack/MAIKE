/**
 * D-PROD-273 (fatia 2, "o excluído some das telas") — o kardex (`GET /estoque/movimentos`) e o detalhe, contra
 * PostgreSQL real e o motor de verdade:
 *
 *  - o PAR excluído (original 'Estornada' + o estorno dele, `movimento_pai_id` = o original) some por padrão:
 *    saída manual excluída, entrada excluída, transferência excluída (as quatro pernas) e linha de produto do
 *    apontamento cancelada;
 *  - `incluir_excluidos=true` devolve tudo, cada item com `excluido` (o original e o estorno marcados);
 *  - movimento ativo nunca some; 'Estornada' sem estorno e estorno sem pai 'Estornada' aparecem normalmente;
 *  - o `total`, o keyset e o cursor continuam corretos (e o cursor é amarrado ao filtro);
 *  - o saldo exibido de um movimento ativo desconta os excluídos do mesmo produto e depósito lançados antes dele.
 * Nada é gravado pela consulta.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { estornarTransferenciaEstoque, numerarMovimentos } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';
import { http } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento, opId } from './patrimonioP1AbastecimentoCenario.mjs';

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

const chamar = (method, url, token, payload) => app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload } : {}) });
const qs = (obj) => '?' + new URLSearchParams(Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))).toString();
const hoje = () => new Date().toISOString().slice(0, 10);

let seq = 0;
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const p = await prisma().produto.create({ data: { cliente_id: c, empresa_id: e.id, numero_produto: String(++seq + 1000), nome_produto: 'Sal mineral', unidade_principal_estoque: 'KG' } });
  const ureia = await prisma().produto.create({ data: { cliente_id: c, empresa_id: e.id, numero_produto: String(++seq + 1000), nome_produto: 'Ureia', unidade_principal_estoque: 'KG' } });
  const local = (nome) => prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome } });
  const galpao = await local('Galpão');
  const barracao = await local('Barracão');
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  const token = corpo.token;
  const compra = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items.find((m) => m.nome === 'Compra').id;
  const perda = (await chamar('GET', '/estoque/motivos-saida', token)).json().items.find((m) => m.nome === 'Perda').id;
  const ctx = { auth: { clienteId: c, usuarioId: adm.usuario.id, login: adm.credenciais.login } };
  return { c, e, p, ureia, galpao, barracao, token, compra, perda, ctx };
};

const entrar = async (x, kg, custo, deposito = x.galpao, produto = x.p) => {
  const r = await chamar('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: deposito.id, unidade: 'KG', quantidade: kg, custo_unitario: custo }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const excluirEntrada = async (x, a) => {
  const r = await chamar('POST', `/estoque/entradas/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: a.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const sair = async (x, kg, produto = x.p) => {
  const r = await chamar('POST', '/estoque/saidas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: kg }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const excluirSaida = async (x, s) => {
  const r = await chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: s.versao, motivo: 'lançada por engano', operation_id: `ex-${randomUUID()}` });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const transferir = async (x, kg) => {
  const r = await chamar('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e.id, produto_id: x.p.id, local_origem_id: x.galpao.id, local_destino_id: x.barracao.id, quantidade: kg,
  });
  assert.equal(r.statusCode, 201, r.body);
  return { s: r.json().movimentacao_saida, r: r.json().movimentacao_entrada };
};
/** A exclusão da transferência pelo motor, numa transação, como o serviço do mapa. */
const excluirTransferencia = (x, movimentoId) =>
  prisma().$transaction(async (tx) => {
    const r = await estornarTransferenciaEstoque(tx, x.ctx, { empresaId: x.e.id, movimentoId, dia: hoje(), motivo: 'transferida errado' });
    await numerarMovimentos(tx, x.c, [r.estornoDestino.id, r.estornoOrigem.id]);
    return r;
  }, { timeout: 20000 });

const kardex = async (x, extra = {}, token = x.token) => {
  const r = await chamar('GET', `/estoque/movimentos${qs({ empresa_id: x.e.id, ...extra })}`, token);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const detalhe = async (x, id) => {
  const r = await chamar('GET', `/estoque/movimentos/${id}${qs({ empresa_id: x.e.id })}`, x.token);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const porId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));
const movimentosDoTenant = (x) => prisma().movimentacaoEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } });

describe('D-PROD-273 fatia 2 — o par excluído some do kardex', () => {
  test('saída manual excluída: o original e o estorno somem; com incluir_excluidos voltam marcados; a entrada ativa fica', async () => {
    const x = await cenario();
    const ent = await entrar(x, '100', '2');
    const s = await sair(x, '30');
    await excluirSaida(x, s);
    const todos = await movimentosDoTenant(x);
    assert.equal(todos.length, 3);
    const original = todos.find((m) => m.tipo_detalhado === 'saida_manual');
    const estorno = todos.find((m) => m.tipo_detalhado === 'estorno_saida_manual');
    assert.equal(original.status, 'Estornada');
    assert.equal(estorno.movimento_pai_id, original.id);

    const padrao = await kardex(x);
    assert.equal(padrao.total, 1);
    assert.deepEqual(padrao.items.map((i) => [i.id, i.excluido]), [[ent.itens[0].movimentacao_estoque_id, false]]);

    const tudo = await kardex(x, { incluir_excluidos: true });
    assert.equal(tudo.total, 3);
    const m = porId(tudo.items);
    assert.equal(m[original.id].excluido, true);
    assert.equal(m[estorno.id].excluido, true);
    assert.equal(m[estorno.id].estorno, true);
    assert.equal(m[ent.itens[0].movimentacao_estoque_id].excluido, false);
    // os excluídos mostrados ficam com o saldo gravado
    assert.deepEqual([m[original.id].saldo_antes, m[original.id].saldo_depois], ['100.0000', '70.0000']);
    assert.deepEqual([m[estorno.id].saldo_antes, m[estorno.id].saldo_depois], ['70.0000', '100.0000']);
    assert.equal((await kardex(x, { incluir_excluidos: false })).total, 1);
    // a consulta não grava nada
    assert.deepEqual(await movimentosDoTenant(x), todos);
  });

  test('transferência excluída: as quatro pernas (S, R e os dois estornos) somem, em qualquer filtro de depósito; voltam marcadas', async () => {
    const x = await cenario();
    const ent = await entrar(x, '100', '2');
    const t = await transferir(x, '40');
    const r = await excluirTransferencia(x, t.s.id);
    const pernas = [t.s.id, t.r.id, r.estornoDestino.id, r.estornoOrigem.id];
    const s = await prisma().movimentacaoEstoque.findUnique({ where: { id: t.s.id } });
    assert.equal(s.status, 'Estornada');
    assert.equal(s.movimento_filho_id, t.r.id, 'a saída guarda a entrada no filho: o estorno dela só é achado pelo pai');

    const padrao = await kardex(x);
    assert.deepEqual(padrao.items.map((i) => i.id), [ent.itens[0].movimentacao_estoque_id]);
    assert.equal(padrao.total, 1);
    assert.equal((await kardex(x, { local_estoque_id: x.barracao.id })).total, 0);
    assert.equal((await kardex(x, { origem_sistema: 'deposito' })).total, 0);

    const tudo = await kardex(x, { incluir_excluidos: true });
    assert.equal(tudo.total, 5);
    const m = porId(tudo.items);
    assert.deepEqual(pernas.map((id) => m[id].excluido), [true, true, true, true]);
    assert.equal(m[ent.itens[0].movimentacao_estoque_id].excluido, false);
    // no destino: S e R (as duas pernas gravam origem e destino) e o estorno do destino; o da origem só toca o Galpão
    assert.equal((await kardex(x, { incluir_excluidos: true, local_estoque_id: x.barracao.id })).total, 3);
    for (const id of pernas) assert.equal((await detalhe(x, id)).excluido, true);
    assert.equal((await detalhe(x, ent.itens[0].movimentacao_estoque_id)).excluido, false);
  });

  test('apontamento de atividade com a linha de produto cancelada: a baixa e o estorno somem; voltam marcados', async () => {
    const s = await montarAbastecimento(app, { lotes: false });
    const H = http(app);
    const p = prisma();
    const suf = randomUUID().slice(0, 6);
    const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
    const tipo = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: 'PULVERIZAÇÃO', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true } });
    const herbicida = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `HB-${suf}`, nome_produto: 'Herbicida glifosato (L)', unidade_principal_estoque: 'L' } });
    await s.lote(s.e1, herbicida, s.local, { quantidade: '50.0000', custo: '5.2000', dia: '2027-06-01' });
    const a = await H.ok(H.req('POST', '/atividades', s.token, { empresa_id: s.e1.id, nome: 'Cigarrinha Pasto 01', tipo_atividade_id: tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30' }), 201);
    const base = `/atividades/${a.id}/apontamentos`;
    const ap = (await H.ok(H.req('POST', base, s.token, { empresa_id: s.e1.id, data_operacional: '2027-06-10', area_executada_dia: '10' }), 201)).apontamento;
    const l = await H.ok(H.req('POST', `${base}/${ap.id}/produtos`, s.token, { empresa_id: s.e1.id, versao: ap.versao, operation_id: opId(), produto_id: herbicida.id, local_estoque_id: s.local.id, quantidade: '30' }), 201);
    const cancelada = await H.ok(H.req('POST', `${base}/${ap.id}/produtos/${l.linha.id}/cancelar`, s.token, { empresa_id: s.e1.id, versao: l.apontamento.versao, operation_id: opId(), motivo: 'lançado errado' }));
    const baixa = l.linha.movimentacao_estoque_id;
    const estorno = cancelada.linha.movimentacao_estorno_id;
    assert.equal((await p.movimentacaoEstoque.findUnique({ where: { id: estorno } })).tipo_detalhado, 'estorno_apontamento_atividade');

    const lista = (extra) => H.ok(H.req('GET', `/estoque/movimentos${qs({ empresa_id: s.e1.id, produto_id: herbicida.id, ...extra })}`, s.token));
    const padrao = await lista({});
    assert.deepEqual([padrao.total, padrao.items.length], [0, 0]);
    const tudo = await lista({ incluir_excluidos: true });
    assert.deepEqual(tudo.items.map((i) => [i.id, i.excluido]).sort(), [[baixa, true], [estorno, true]].sort());
  });

  test('só o par COMPLETO some: Estornada sem estorno, estorno sem pai e estorno de pai ativo aparecem normalmente', async () => {
    const x = await cenario();
    const cria = (dados) =>
      prisma().movimentacaoEstoque.create({
        data: {
          cliente_id: x.c, empresa_id: x.e.id, numero_movimentacao: String(++seq + 9000), tipo_movimentacao: 'Entrada', origem_sistema: 'operacao_financeira',
          produto_id: x.p.id, produto_nome: x.p.nome_produto, quantidade: '10', unidade_medida: 'KG', data_movimentacao: new Date('2026-11-10T12:00:00.000Z'),
          local_estoque_destino: x.galpao.id, ...dados,
        },
      });
    const semFilho = await cria({ status: 'Estornada', tipo_detalhado: 'compra_financeiro' });
    const orfao = await cria({ tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_compra', movimento_pai_id: 'nao-existe', local_estoque_origem: x.galpao.id });
    const paiAtivo = await cria({ tipo_detalhado: 'compra_financeiro' });
    const deAtivo = await cria({ tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_compra', movimento_pai_id: paiAtivo.id, local_estoque_origem: x.galpao.id });
    // filho que não é estorno (como a perna R da transferência): o pai 'Estornada' não vira par por isso
    const paiTransf = await cria({ tipo_movimentacao: 'Saída', status: 'Estornada', tipo_detalhado: 'transferencia_enviada', local_estoque_origem: x.galpao.id });
    const filhoTransf = await cria({ tipo_detalhado: 'transferencia_recebida', movimento_pai_id: paiTransf.id, local_estoque_destino: x.barracao.id });
    await prisma().movimentacaoEstoque.update({ where: { cliente_id_id: { cliente_id: x.c, id: paiTransf.id } }, data: { movimento_filho_id: filhoTransf.id } });
    // estorno de OUTRO produto não forma par
    const outroProduto = await cria({ tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_compra', movimento_pai_id: semFilho.id, produto_id: x.ureia.id, local_estoque_origem: x.galpao.id });
    // e o par verdadeiro, para contraste
    const original = await cria({ status: 'Estornada', tipo_detalhado: 'compra_financeiro' });
    const estorno = await cria({ tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_compra', movimento_pai_id: original.id, local_estoque_origem: x.galpao.id });
    await prisma().movimentacaoEstoque.update({ where: { cliente_id_id: { cliente_id: x.c, id: original.id } }, data: { movimento_filho_id: estorno.id } });
    const visiveis = [semFilho, orfao, paiAtivo, deAtivo, paiTransf, filhoTransf, outroProduto].map((m) => m.id).sort();

    const padrao = await kardex(x);
    assert.deepEqual(padrao.items.map((i) => i.id).sort(), visiveis);
    assert.equal(padrao.total, 7);
    assert.ok(padrao.items.every((i) => i.excluido === false));
    const tudo = porId((await kardex(x, { incluir_excluidos: true })).items);
    assert.equal(Object.keys(tudo).length, 9);
    for (const id of visiveis) assert.equal(tudo[id].excluido, false, id);
    assert.deepEqual([tudo[original.id].excluido, tudo[estorno.id].excluido], [true, true]);
  });
});

describe('D-PROD-273 fatia 2 — paginação e cursor sem os excluídos', () => {
  test('limit 2 percorre só os visíveis sem repetir nem pular; total certo nos dois modos; cursor de um modo não serve no outro', async () => {
    const x = await cenario();
    const ativos = [];
    const excluidos = [];
    for (let i = 0; i < 3; i += 1) {
      const a = await entrar(x, '10', '2');
      ativos.push(a.itens[0].movimentacao_estoque_id);
      const b = await entrar(x, '5', '3');
      await excluirEntrada(x, b);
    }
    const s = await sair(x, '4');
    await excluirSaida(x, s);
    for (const m of await movimentosDoTenant(x)) if (m.status === 'Estornada' || m.tipo_detalhado?.startsWith('estorno_')) excluidos.push(m.id);
    assert.equal(excluidos.length, 8);
    ativos.push((await entrar(x, '1', '1')).itens[0].movimentacao_estoque_id);

    const percorrer = async (extra) => {
      const vistos = [];
      let cursor;
      let total = null;
      for (let paginas = 0; paginas < 20; paginas += 1) {
        const b = await kardex(x, { limit: 2, cursor, ...extra });
        total ??= b.total;
        vistos.push(...b.items.map((i) => i.id));
        if (!b.has_more) return { vistos, total };
        cursor = b.next_cursor;
      }
      throw new Error('paginação não terminou');
    };
    const padrao = await percorrer({});
    assert.equal(padrao.total, 4);
    assert.deepEqual([...padrao.vistos].sort(), [...ativos].sort());
    assert.equal(new Set(padrao.vistos).size, padrao.vistos.length);
    const tudo = await percorrer({ incluir_excluidos: true });
    assert.equal(tudo.total, 12);
    assert.deepEqual([...tudo.vistos].sort(), [...ativos, ...excluidos].sort());
    // a mesma ordem do servidor (data desc, id desc) nos dois modos: tirar os excluídos da lista completa dá a lista padrão
    assert.deepEqual(tudo.vistos.filter((id) => !excluidos.includes(id)), padrao.vistos);

    const p1 = await kardex(x, { limit: 2 });
    const outroModo = await chamar('GET', `/estoque/movimentos${qs({ empresa_id: x.e.id, limit: 2, incluir_excluidos: true, cursor: p1.next_cursor })}`, x.token);
    assert.equal(outroModo.statusCode, 400, outroModo.body);
    assert.equal(outroModo.json().details?.reason ?? outroModo.json().reason, 'cursor_invalido');
    assert.equal((await chamar('GET', `/estoque/movimentos${qs({ empresa_id: x.e.id, incluir_excluidos: 'talvez' })}`, x.token)).statusCode, 400);
  });
});

describe('D-PROD-273 fatia 2 — saldo exibido sem os excluídos', () => {
  test('entrada lançada entre o original e o estorno: o saldo dela desconta o excluído (lista, os dois modos e o detalhe); o excluído fica com o gravado', async () => {
    const x = await cenario();
    const a = await entrar(x, '100', '2');
    const b = await entrar(x, '50', '3');
    await entrar(x, '7', '1', x.barracao); // outro depósito: não entra na conta
    await entrar(x, '9', '1', x.galpao, x.ureia); // outro produto: também não
    await excluirEntrada(x, a);
    const idA = a.itens[0].movimentacao_estoque_id;
    const idB = b.itens[0].movimentacao_estoque_id;
    const gravadoB = await prisma().movimentacaoEstoque.findUnique({ where: { id: idB } });
    assert.deepEqual([gravadoB.saldo_antes.toFixed(4), gravadoB.saldo_depois.toFixed(4)], ['100.0000', '150.0000']);

    const padrao = porId((await kardex(x, { produto_id: x.p.id })).items);
    assert.deepEqual(Object.keys(padrao).length, 2);
    assert.deepEqual([padrao[idB].saldo_antes, padrao[idB].saldo_depois], ['0.0000', '50.0000']);
    const tudo = porId((await kardex(x, { produto_id: x.p.id, incluir_excluidos: true })).items);
    assert.deepEqual([tudo[idB].saldo_antes, tudo[idB].saldo_depois], ['0.0000', '50.0000'], 'o saldo do ativo não muda ao mostrar os excluídos');
    assert.deepEqual([tudo[idA].excluido, tudo[idA].saldo_antes, tudo[idA].saldo_depois], [true, '0.0000', '100.0000']);
    const estorno = Object.values(tudo).find((i) => i.tipo_detalhado === 'estorno_entrada_exclusao');
    assert.deepEqual([estorno.excluido, estorno.saldo_antes, estorno.saldo_depois], [true, '150.0000', '50.0000']);
    const outros = Object.values(padrao).find((i) => i.local_destino_id === x.barracao.id);
    assert.deepEqual([outros.saldo_antes, outros.saldo_depois], ['0.0000', '7.0000']);
    const ureia = (await kardex(x, { produto_id: x.ureia.id })).items[0];
    assert.deepEqual([ureia.saldo_antes, ureia.saldo_depois], ['0.0000', '9.0000']);

    const d = await detalhe(x, idB);
    assert.deepEqual([d.excluido, d.saldo_antes, d.saldo_depois], [false, '0.0000', '50.0000']);
    const dA = await detalhe(x, idA);
    assert.deepEqual([dA.excluido, dA.saldo_antes, dA.saldo_depois], [true, '0.0000', '100.0000']);
    // a consulta não regrava o saldo
    assert.equal((await prisma().movimentacaoEstoque.findUnique({ where: { id: idB } })).saldo_depois.toFixed(4), '150.0000');
  });

  test('par inteiro antes do movimento soma zero: a saída depois de uma saída excluída fica com o saldo gravado', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const s1 = await sair(x, '30');
    await excluirSaida(x, s1);
    const s2 = await sair(x, '20');
    const id = s2.itens[0].movimentacao_estoque_id;
    const item = (await kardex(x)).items.find((i) => i.id === id);
    assert.deepEqual([item.saldo_antes, item.saldo_depois], ['100.0000', '80.0000']);
    assert.equal((await kardex(x)).total, 2);
  });
});
