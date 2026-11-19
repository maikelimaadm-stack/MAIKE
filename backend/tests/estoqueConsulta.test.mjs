/**
 * D-PROD-255 (Estoque E1 Saldo + E2 Movimentos, P1-04) — consultas somente leitura, PostgreSQL real.
 *
 * Saldo por produto × depósito derivado das camadas, kardex paginado por keyset com cursor
 * assinado, detalhe de movimento (saldo antes/depois, camadas, documento, par original ↔ estorno),
 * filtros, isolamento por tenant, permissão da tela `sup-estoque` e querystring fechada.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { codificarCursorConsulta, decodificarCursorConsulta } from '../src/modules/estoqueConsulta/estoqueConsultaCursor.js';
import { unidadeDeEstoque } from '../src/modules/estoqueConsulta/estoqueConsultaService.js';

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

const get = (url, token) => app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
const qs = (obj) => '?' + new URLSearchParams(Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null))).toString();

let seq = 0;
const produto = (c, e, nome, unidade = 'KG', extra = {}) =>
  prisma().produto.create({ data: { cliente_id: c, empresa_id: e, numero_produto: String(++seq + 1000), nome_produto: nome, unidade_principal_estoque: unidade, ...extra } });
const local = (c, nome) => prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome } });
const camada = (c, e, p, l, disponivel, custo, extra = {}) =>
  prisma().estoqueLoteNota.create({
    data: {
      cliente_id: c, empresa_id: e, produto_id: p.id, produto_nome: p.nome_produto, local_estoque_id: l.id, local_estoque_nome: l.nome,
      custo_unitario: custo, quantidade_entrada: extra.entrada ?? disponivel, quantidade_disponivel: disponivel, status: extra.status ?? 'Disponivel',
      numero_documento: extra.numero_documento ?? null, fornecedor_nome: extra.fornecedor_nome ?? null,
    },
  });
const movimento = (c, e, p, dados) =>
  prisma().movimentacaoEstoque.create({
    data: {
      cliente_id: c, empresa_id: e, numero_movimentacao: String(++seq + 9000), tipo_movimentacao: 'Entrada', origem_sistema: 'operacao_financeira',
      produto_id: p.id, produto_nome: p.nome_produto, quantidade: '10', unidade_medida: 'KG', data_movimentacao: new Date('2026-11-10T12:00:00.000Z'), ...dados,
    },
  });

/** Tenant administrador com uma fazenda, 3 produtos e 2 depósitos com camadas. */
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda ${c}` } });
  const diesel = await produto(c, e.id, 'Diesel S10', 'L', { codigo_interno: 'D10' });
  const ureia = await produto(c, e.id, 'Ureia', 'KG');
  const sal = await produto(c, e.id, 'Sal mineral', 'SACO');
  const tanque = await local(c, 'Tanque diesel sede');
  const galpao = await local(c, 'Galpão insumos');
  await camada(c, e.id, diesel, tanque, '100', '5.0000', { numero_documento: 'NF-1', fornecedor_nome: 'Posto Boa Vista' });
  await camada(c, e.id, diesel, tanque, '50', '6.0000');
  await camada(c, e.id, ureia, galpao, '200', '3.0000');
  await camada(c, e.id, ureia, tanque, '0', '3.0000', { entrada: '30', status: 'Esgotado' });
  await camada(c, e.id, sal, galpao, '10.5', '40.0000');
  await camada(c, e.id, sal, galpao, '999', '1.0000', { status: 'Estornado' });
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  return { c, e, diesel, ureia, sal, tanque, galpao, token: corpo.token, adm };
};

const contaCom = async (cen, permissoes_telas, modulos = ['suporte-mapa']) => {
  const hash = (await prisma().usuario.findUnique({ where: { id: cen.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: cen.c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: cen.c, user_email: login, user_nome: 'Op', modulos_permitidos: modulos, permissoes_telas } });
  const { corpo } = await autenticarNoApp(app, { login, senha: cen.adm.credenciais.senha });
  assert.ok(corpo.token);
  return corpo.token;
};
const linha = (tela, visualizar) => ({ modulo_id: 'suporte-mapa', tela_id: tela, visualizar, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false });

describe('D-PROD-255 — cursor assinado e unidade', () => {
  test('unidadeDeEstoque: L para L; KG para o resto (SACO guarda kg)', () => {
    assert.equal(unidadeDeEstoque('L'), 'L');
    assert.equal(unidadeDeEstoque('KG'), 'KG');
    assert.equal(unidadeDeEstoque('SACO'), 'KG');
    assert.equal(unidadeDeEstoque(null), 'KG');
  });

  test('cursor: vai e volta; amarra diferente, corpo adulterado e lixo são recusados com o mesmo 400', () => {
    const amarra = ['movimentos', 't1', 'e1', null, 10];
    const c = codificarCursorConsulta(amarra, ['2026-11-10T12:00:00.000Z', 'abc']);
    assert.deepEqual(decodificarCursorConsulta(c, amarra), ['2026-11-10T12:00:00.000Z', 'abc']);
    const recusa = (fn) => assert.throws(fn, (err) => err.code === 'REQUEST_VALIDATION_FAILED' && err.details?.field === 'cursor');
    recusa(() => decodificarCursorConsulta(c, ['movimentos', 't2', 'e1', null, 10]));
    recusa(() => decodificarCursorConsulta(c, ['movimentos', 't1', 'e1', null, 11]));
    recusa(() => decodificarCursorConsulta(`${c.slice(0, -2)}AA`, amarra));
    recusa(() => decodificarCursorConsulta('x', amarra));
    recusa(() => decodificarCursorConsulta('!!', amarra));
    recusa(() => decodificarCursorConsulta(12, amarra));
  });
});

describe('D-PROD-255 — Saldo (E1)', () => {
  test('soma as camadas disponíveis por produto × depósito; custo ponderado, valor e unidade; ignora Estornado; ordena por nome', async () => {
    const x = await cenario();
    const r = await get(`/estoque/saldo${qs({ empresa_id: x.e.id })}`, x.token);
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.total, 3);
    assert.equal(b.has_more, false);
    assert.equal(b.next_cursor, null);
    assert.deepEqual(b.items.map((i) => [i.produto_nome, i.local_estoque_nome]), [
      ['Diesel S10', 'Tanque diesel sede'],
      ['Sal mineral', 'Galpão insumos'],
      ['Ureia', 'Galpão insumos'],
    ]);
    const [diesel, sal, ureia] = b.items;
    assert.equal(diesel.quantidade, '150.0000');
    assert.equal(diesel.valor, '800.0000'); // 100×5 + 50×6
    assert.equal(diesel.custo_medio, '5.3333'); // 800 ÷ 150
    assert.equal(diesel.unidade, 'L');
    assert.equal(diesel.camadas, 2);
    assert.equal(diesel.produto_codigo, 'D10');
    assert.equal(sal.quantidade, '10.5000');
    assert.equal(sal.unidade, 'KG');
    assert.equal(sal.valor, '420.0000');
    assert.equal(ureia.quantidade, '200.0000');
    assert.equal(ureia.custo_medio, '3.0000');
    assert.equal(ureia.valor, '600.0000');
    // texto decimal, nunca número
    for (const i of b.items) for (const k of ['quantidade', 'custo_medio', 'valor']) assert.equal(typeof i[k], 'string');
  });

  test('filtros: produto, depósito, busca (produto, código, depósito) e "só com saldo"', async () => {
    const x = await cenario();
    const lista = async (extra) => (await get(`/estoque/saldo${qs({ empresa_id: x.e.id, ...extra })}`, x.token)).json().items.map((i) => `${i.produto_nome}@${i.local_estoque_nome}`);
    assert.deepEqual(await lista({ produto_id: x.ureia.id }), ['Ureia@Galpão insumos']);
    assert.deepEqual(await lista({ local_estoque_id: x.tanque.id }), ['Diesel S10@Tanque diesel sede']);
    assert.deepEqual(await lista({ q: 'sal' }), ['Sal mineral@Galpão insumos']);
    assert.deepEqual(await lista({ q: 'd10' }), ['Diesel S10@Tanque diesel sede']);
    assert.deepEqual(await lista({ q: 'galp' }), ['Sal mineral@Galpão insumos', 'Ureia@Galpão insumos']);
    assert.deepEqual(await lista({ q: '%' }), []); // curinga literal
    // com somente_com_saldo=false entra a camada esgotada (Ureia no Tanque, saldo 0)
    const todos = await lista({ somente_com_saldo: false });
    assert.equal(todos.length, 4);
    assert.ok(todos.includes('Ureia@Tanque diesel sede'));
    const zero = (await get(`/estoque/saldo${qs({ empresa_id: x.e.id, somente_com_saldo: false, produto_id: x.ureia.id, local_estoque_id: x.tanque.id })}`, x.token)).json().items[0];
    assert.equal(zero.quantidade, '0.0000');
    assert.equal(zero.custo_medio, null);
    assert.equal(zero.valor, '0.0000');
  });

  test('paginação keyset: limit 1 percorre tudo sem repetir nem pular; página nova no meio não duplica', async () => {
    const x = await cenario();
    const vistos = [];
    let cursor;
    let paginas = 0;
    for (;;) {
      const r = await get(`/estoque/saldo${qs({ empresa_id: x.e.id, limit: 1, cursor })}`, x.token);
      assert.equal(r.statusCode, 200, r.body);
      const b = r.json();
      assert.equal(b.total, 3);
      vistos.push(...b.items.map((i) => i.chave));
      paginas += 1;
      if (paginas === 1) await camada(x.c, x.e.id, x.ureia, x.galpao, '5', '3.0000'); // não muda as chaves
      if (!b.has_more) break;
      cursor = b.next_cursor;
    }
    assert.equal(paginas, 3);
    assert.equal(new Set(vistos).size, 3);
  });

  test('cursor adulterado, de outro filtro ou de outro limite → 400 cursor_invalido', async () => {
    const x = await cenario();
    const p1 = (await get(`/estoque/saldo${qs({ empresa_id: x.e.id, limit: 1 })}`, x.token)).json();
    for (const url of [
      `/estoque/saldo${qs({ empresa_id: x.e.id, limit: 1, cursor: `${p1.next_cursor.slice(0, -3)}AAA` })}`,
      `/estoque/saldo${qs({ empresa_id: x.e.id, limit: 1, q: 'a', cursor: p1.next_cursor })}`,
      `/estoque/saldo${qs({ empresa_id: x.e.id, limit: 2, cursor: p1.next_cursor })}`,
    ]) {
      const r = await get(url, x.token);
      assert.equal(r.statusCode, 400, r.body);
      assert.deepEqual([r.json().field, r.json().reason], ['cursor', 'cursor_invalido']);
    }
  });

  test('isolamento: empresa de outro tenant → 404; os dados do outro tenant não aparecem', async () => {
    const a = await cenario();
    const b = await cenario();
    const cruzada = await get(`/estoque/saldo${qs({ empresa_id: b.e.id })}`, a.token);
    assert.equal(cruzada.statusCode, 404, cruzada.body);
    const minha = (await get(`/estoque/saldo${qs({ empresa_id: a.e.id })}`, a.token)).json();
    assert.ok(minha.items.every((i) => [a.diesel.id, a.ureia.id, a.sal.id].includes(i.produto_id)));
    // produto do outro tenant como filtro: simplesmente nada
    const filtro = (await get(`/estoque/saldo${qs({ empresa_id: a.e.id, produto_id: b.diesel.id })}`, a.token)).json();
    assert.equal(filtro.total, 0);
    // cursor de um tenant não vale no outro
    const p1 = (await get(`/estoque/saldo${qs({ empresa_id: a.e.id, limit: 1 })}`, a.token)).json();
    const r = await get(`/estoque/saldo${qs({ empresa_id: b.e.id, limit: 1, cursor: p1.next_cursor })}`, b.token);
    assert.equal(r.statusCode, 400, r.body);
  });
});

describe('D-PROD-255 — Movimentos (E2, P1-04)', () => {
  test('filtros: produto, depósito (origem OU destino), origem, tipo, período, busca', async () => {
    const x = await cenario();
    await movimento(x.c, x.e.id, x.diesel, { data_movimentacao: new Date('2026-11-01T12:00:00Z'), local_estoque_destino: x.tanque.id, local_destino: x.tanque.nome, numero_documento: 'NF-77' });
    await movimento(x.c, x.e.id, x.diesel, { data_movimentacao: new Date('2026-11-05T12:00:00Z'), tipo_movimentacao: 'Saída', origem_sistema: 'abastecimento_patrimonio', local_estoque_origem: x.tanque.id, local_origem: x.tanque.nome });
    await movimento(x.c, x.e.id, x.ureia, { data_movimentacao: new Date('2026-11-05T15:00:00Z'), tipo_movimentacao: 'Saída', origem_sistema: 'deposito', local_estoque_origem: x.galpao.id, local_estoque_destino: x.tanque.id });
    await movimento(x.c, x.e.id, x.sal, { data_movimentacao: new Date('2026-11-20T12:00:00Z'), local_estoque_destino: x.galpao.id, motivo_movimentacao: 'Compra de sal' });
    const ids = async (extra) => {
      const r = await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, ...extra })}`, x.token);
      assert.equal(r.statusCode, 200, r.body);
      return r.json().items.map((i) => `${i.produto_nome}|${i.data}`);
    };
    assert.equal((await ids({})).length, 4);
    assert.deepEqual(await ids({ produto_id: x.ureia.id }), ['Ureia|2026-11-05']);
    assert.deepEqual(await ids({ local_estoque_id: x.tanque.id }), ['Ureia|2026-11-05', 'Diesel S10|2026-11-05', 'Diesel S10|2026-11-01']);
    assert.deepEqual(await ids({ local_estoque_id: x.galpao.id }), ['Sal mineral|2026-11-20', 'Ureia|2026-11-05']);
    assert.deepEqual(await ids({ origem_sistema: 'abastecimento_patrimonio' }), ['Diesel S10|2026-11-05']);
    assert.deepEqual(await ids({ tipo_movimentacao: 'Saída' }), ['Ureia|2026-11-05', 'Diesel S10|2026-11-05']);
    assert.deepEqual(await ids({ data_de: '2026-11-05', data_ate: '2026-11-05' }), ['Ureia|2026-11-05', 'Diesel S10|2026-11-05']);
    assert.deepEqual(await ids({ data_de: '2026-11-06' }), ['Sal mineral|2026-11-20']);
    assert.deepEqual(await ids({ q: 'nf-77' }), ['Diesel S10|2026-11-01']);
    assert.deepEqual(await ids({ q: 'compra de sal' }), ['Sal mineral|2026-11-20']);
  });

  test('filtros inválidos: período invertido, data inexistente, origem desconhecida → 400; tipo fora da lista → 400', async () => {
    const x = await cenario();
    const status = async (extra) => (await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, ...extra })}`, x.token)).statusCode;
    assert.equal(await status({ data_de: '2026-11-10', data_ate: '2026-11-01' }), 400);
    assert.equal(await status({ data_de: '2026-02-30' }), 400);
    assert.equal(await status({ origem_sistema: 'Origem Inválida!' }), 400);
    assert.equal(await status({ tipo_movimentacao: 'Outro' }), 400);
  });

  test('keyset estável: mesma data empata pelo id; limit 2 percorre os 7 sem repetir nem pular, mesmo com movimento novo no meio', async () => {
    const x = await cenario();
    const mesmaData = new Date('2026-11-10T12:00:00Z');
    const criados = [];
    for (let i = 0; i < 5; i += 1) criados.push(await movimento(x.c, x.e.id, x.ureia, { data_movimentacao: mesmaData }));
    criados.push(await movimento(x.c, x.e.id, x.ureia, { data_movimentacao: new Date('2026-11-12T12:00:00Z') }));
    criados.push(await movimento(x.c, x.e.id, x.ureia, { data_movimentacao: new Date('2026-11-01T12:00:00Z') }));
    const esperado = [...criados].sort((a, b) => b.data_movimentacao - a.data_movimentacao || (a.id < b.id ? 1 : -1)).map((m) => m.id);
    const vistos = [];
    let cursor;
    let paginas = 0;
    for (;;) {
      const r = await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, limit: 2, cursor })}`, x.token);
      assert.equal(r.statusCode, 200, r.body);
      const b = r.json();
      if (paginas === 0) assert.equal(b.total, 7);
      vistos.push(...b.items.map((i) => i.id));
      paginas += 1;
      if (paginas === 1) await movimento(x.c, x.e.id, x.ureia, { data_movimentacao: new Date('2026-12-01T12:00:00Z') }); // mais novo: fica antes do cursor
      if (!b.has_more) break;
      cursor = b.next_cursor;
    }
    assert.deepEqual(vistos, esperado);
    assert.equal(paginas, 4);
  });

  test('cursor de movimentos: de outro filtro ou adulterado → 400; limit acima do teto → 400', async () => {
    const x = await cenario();
    for (let i = 0; i < 3; i += 1) await movimento(x.c, x.e.id, x.ureia, {});
    const p1 = (await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, limit: 1 })}`, x.token)).json();
    assert.ok(p1.next_cursor);
    assert.equal((await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, limit: 1, produto_id: x.ureia.id, cursor: p1.next_cursor })}`, x.token)).statusCode, 400);
    assert.equal((await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, limit: 1, cursor: `${p1.next_cursor}A` })}`, x.token)).statusCode, 400);
    assert.equal((await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, limit: 100000 })}`, x.token)).statusCode, 400);
  });

  test('resumo: campos públicos, decimais como texto, sem tenant; par estorno aparece com pai e filho', async () => {
    const x = await cenario();
    const original = await movimento(x.c, x.e.id, x.diesel, { quantidade: '20', unidade_medida: 'L', valor_unitario: '5', valor_total: '100', saldo_antes: '130', saldo_depois: '150', status: 'Estornada', local_estoque_destino: x.tanque.id, local_destino: x.tanque.nome, tipo_detalhado: 'compra_financeiro' });
    const estorno = await movimento(x.c, x.e.id, x.diesel, {
      tipo_movimentacao: 'Saída', tipo_detalhado: 'estorno_compra', quantidade: '20', unidade_medida: 'L', saldo_antes: '150', saldo_depois: '130',
      movimento_pai_id: original.id, data_movimentacao: new Date('2026-11-11T12:00:00Z'), local_estoque_origem: x.tanque.id, local_origem: x.tanque.nome,
    });
    await prisma().movimentacaoEstoque.update({ where: { cliente_id_id: { cliente_id: x.c, id: original.id } }, data: { movimento_filho_id: estorno.id } });
    const lista = (await get(`/estoque/movimentos${qs({ empresa_id: x.e.id })}`, x.token)).json().items;
    const e = lista.find((i) => i.id === estorno.id);
    const o = lista.find((i) => i.id === original.id);
    assert.equal(e.estorno, true);
    assert.equal(e.movimento_pai_id, original.id);
    assert.equal(o.estorno, false);
    assert.equal(o.movimento_filho_id, estorno.id);
    assert.equal(o.quantidade, '20.0000');
    assert.equal(o.saldo_antes, '130.0000');
    assert.equal(o.unidade, 'L');
    assert.equal(o.status, 'Estornada');
    assert.equal(o.cliente_id, undefined);
    assert.equal(o.lotes_consumidos, undefined);
    assert.equal(o.data, '2026-11-10');
  });

  test('detalhe: saldo antes/depois, custo, camadas consumidas com a nota, par original ↔ estorno; 404 de outro tenant e de outra empresa', async () => {
    const x = await cenario();
    const lote = await camada(x.c, x.e.id, x.diesel, x.tanque, '10', '5.0000', { numero_documento: 'NF-900', fornecedor_nome: 'Posto Boa Vista' });
    const saida = await movimento(x.c, x.e.id, x.diesel, {
      tipo_movimentacao: 'Saída', origem_sistema: 'abastecimento_patrimonio', tipo_detalhado: 'abastecimento', quantidade: '12', unidade_medida: 'L',
      valor_unitario: '5.1667', valor_total: '62', saldo_antes: '150', saldo_depois: '138', custo_medio_antes: '5.3333', custo_medio_depois: '5.3333',
      local_estoque_origem: x.tanque.id, local_origem: x.tanque.nome, motivo_movimentacao: 'Baixa por abastecimento', observacoes: 'Trator 01', usuario_responsavel: 'maria',
      area_vinculada_nome: 'Pasto 3', lotes_consumidos: [{ lote_id: lote.id, quantidade: '10.0000', custo_unitario: '5.0000' }, { lote_id: 'fantasma', quantidade: '2.0000', custo_unitario: '6.0000' }],
    });
    const estorno = await movimento(x.c, x.e.id, x.diesel, { tipo_detalhado: 'estorno_abastecimento', origem_sistema: 'abastecimento_patrimonio', movimento_pai_id: saida.id });
    await prisma().movimentacaoEstoque.update({ where: { cliente_id_id: { cliente_id: x.c, id: saida.id } }, data: { movimento_filho_id: estorno.id } });

    const r = await get(`/estoque/movimentos/${saida.id}${qs({ empresa_id: x.e.id })}`, x.token);
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.equal(d.numero, saida.numero_movimentacao);
    assert.equal(d.saldo_antes, '150.0000');
    assert.equal(d.saldo_depois, '138.0000');
    assert.equal(d.custo_medio_antes, '5.3333');
    assert.equal(d.valor_total, '62.0000');
    assert.equal(d.motivo, 'Baixa por abastecimento');
    assert.equal(d.observacoes, 'Trator 01');
    assert.equal(d.responsavel, 'maria');
    assert.equal(d.vinculos.area, 'Pasto 3');
    assert.equal(d.camadas_consumidas.length, 2);
    assert.deepEqual(
      [d.camadas_consumidas[0].quantidade, d.camadas_consumidas[0].custo_unitario, d.camadas_consumidas[0].numero_documento, d.camadas_consumidas[0].fornecedor_nome],
      ['10.0000', '5.0000', 'NF-900', 'Posto Boa Vista'],
    );
    assert.equal(d.camadas_consumidas[1].numero_documento, null); // camada que não existe mais: sem nota, sem quebrar
    assert.equal(d.filho.id, estorno.id);
    assert.equal(d.filho.tipo_detalhado, 'estorno_abastecimento');
    assert.equal(d.pai, null);
    assert.equal(d.cliente_id, undefined);

    const dEstorno = (await get(`/estoque/movimentos/${estorno.id}${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.equal(dEstorno.pai.id, saida.id);
    assert.equal(dEstorno.estorno, true);

    // outro tenant
    const b = await cenario();
    assert.equal((await get(`/estoque/movimentos/${saida.id}${qs({ empresa_id: b.e.id })}`, b.token)).statusCode, 404);
    assert.equal((await get(`/estoque/movimentos/${saida.id}${qs({ empresa_id: x.e.id })}`, b.token)).statusCode, 404);
    // outra empresa do mesmo tenant
    const e2 = await prisma().empresa.create({ data: { cliente_id: x.c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${x.c}` } });
    assert.equal((await get(`/estoque/movimentos/${saida.id}${qs({ empresa_id: e2.id })}`, x.token)).statusCode, 404);
    assert.equal((await get(`/estoque/movimentos/inexistente${qs({ empresa_id: x.e.id })}`, x.token)).statusCode, 404);
  });

  test('movimento sem documento de origem (suplementação) → documento null', async () => {
    const x = await cenario();
    const sem = await movimento(x.c, x.e.id, x.diesel, { origem_sistema: 'suplementacao' });
    const d = (await get(`/estoque/movimentos/${sem.id}${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.equal(d.documento, null);
  });

  test('pelo motor real: a transferência entre depósitos gera o par saída/entrada, visível no saldo e no kardex, com camadas e pai/filho', async () => {
    const x = await cenario();
    const t = await app.inject({
      method: 'POST', url: '/movimentacoes-estoque/comandos/transferencia-locais', headers: { authorization: `Bearer ${x.token}` },
      payload: { operation_id: `op-${randomUUID()}`, empresa_id: x.e.id, produto_id: x.ureia.id, local_origem_id: x.galpao.id, local_destino_id: x.tanque.id, quantidade: 50 },
    });
    assert.equal(t.statusCode, 201, t.body);
    const saldo = (await get(`/estoque/saldo${qs({ empresa_id: x.e.id, produto_id: x.ureia.id })}`, x.token)).json().items;
    assert.deepEqual(saldo.map((i) => [i.local_estoque_nome, i.quantidade]), [['Galpão insumos', '150.0000'], ['Tanque diesel sede', '50.0000']]);
    const k = (await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, produto_id: x.ureia.id })}`, x.token)).json();
    assert.equal(k.total, 2);
    const saida = k.items.find((i) => i.tipo === 'Saída');
    const entrada = k.items.find((i) => i.tipo === 'Entrada');
    assert.equal(saida.origem_sistema, 'deposito');
    assert.equal(saida.saldo_antes, '200.0000');
    assert.equal(saida.saldo_depois, '150.0000');
    assert.equal(saida.local_origem_id, x.galpao.id);
    assert.equal(entrada.local_destino_id, x.tanque.id);
    // o motor grava origem e destino nas duas pernas: o filtro por depósito acha o par inteiro
    assert.equal((await get(`/estoque/movimentos${qs({ empresa_id: x.e.id, produto_id: x.ureia.id, local_estoque_id: x.tanque.id })}`, x.token)).json().total, 2);
    const d = (await get(`/estoque/movimentos/${saida.id}${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.equal(d.camadas_consumidas.length, 1);
    assert.equal(d.camadas_consumidas[0].quantidade, '50.0000');
    assert.equal(d.camadas_consumidas[0].custo_unitario, '3.0000');
    assert.equal(d.filho?.id, entrada.id);
    assert.equal(d.filho.tipo, 'Entrada');
  });
});

describe('D-PROD-255 — opções dos filtros', () => {
  test('produtos (por empresa, busca) e depósitos (do tenant), com envelope de opções', async () => {
    const x = await cenario();
    const p = (await get(`/estoque/opcoes/produtos${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.deepEqual(p.itens.map((i) => i.nome), ['Diesel S10', 'Sal mineral', 'Ureia']);
    assert.equal(p.has_more, false);
    const busca = (await get(`/estoque/opcoes/produtos${qs({ empresa_id: x.e.id, q: 'ure' })}`, x.token)).json();
    assert.deepEqual(busca.itens.map((i) => i.nome), ['Ureia']);
    const l = (await get('/estoque/opcoes/locais', x.token)).json();
    assert.deepEqual(l.itens.map((i) => i.nome), ['Galpão insumos', 'Tanque diesel sede']);
    const outro = await cenario();
    assert.equal((await get(`/estoque/opcoes/produtos${qs({ empresa_id: outro.e.id })}`, x.token)).statusCode, 404);
    const lo = (await get('/estoque/opcoes/locais', outro.token)).json();
    assert.ok(lo.itens.every((i) => i.id !== x.tanque.id && i.id !== x.galpao.id));
  });
});

describe('D-PROD-255 — permissão da tela sup-estoque e superfície fechada', () => {
  const rotas = (x) => [
    `/estoque/saldo${qs({ empresa_id: x.e.id })}`,
    `/estoque/movimentos${qs({ empresa_id: x.e.id })}`,
    `/estoque/movimentos/qualquer${qs({ empresa_id: x.e.id })}`,
    `/estoque/opcoes/produtos${qs({ empresa_id: x.e.id })}`,
    '/estoque/opcoes/locais',
  ];

  test('sem token → 401', async () => {
    const x = await cenario();
    for (const url of rotas(x)) assert.equal((await get(url)).statusCode, 401, url);
  });

  test('conta sem linha da tela, só com outra tela do grupo ou com visualizar=false → 403 ACAO_NAO_PERMITIDA em todas', async () => {
    const x = await cenario();
    const semLinha = await contaCom(x, []);
    const outraTela = await contaCom(x, [linha('sup-locais', true), linha('sup-produtos', true)]);
    const desligada = await contaCom(x, [linha('sup-estoque', false)]);
    const semModulo = await contaCom(x, [linha('sup-estoque', true)], ['manejo']);
    for (const token of [semLinha, outraTela, desligada, semModulo]) {
      for (const url of rotas(x)) {
        const r = await get(url, token);
        assert.equal(r.statusCode, 403, `${url} ${r.body}`);
        assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA');
      }
    }
  });

  test('conta com visualizar na tela sup-estoque lê saldo, movimentos, detalhe e opções', async () => {
    const x = await cenario();
    const m = await movimento(x.c, x.e.id, x.ureia, {});
    const token = await contaCom(x, [linha('sup-estoque', true)]);
    assert.equal((await get(`/estoque/saldo${qs({ empresa_id: x.e.id })}`, token)).statusCode, 200);
    assert.equal((await get(`/estoque/movimentos${qs({ empresa_id: x.e.id })}`, token)).statusCode, 200);
    assert.equal((await get(`/estoque/movimentos/${m.id}${qs({ empresa_id: x.e.id })}`, token)).statusCode, 200);
    assert.equal((await get(`/estoque/opcoes/produtos${qs({ empresa_id: x.e.id })}`, token)).statusCode, 200);
    assert.equal((await get('/estoque/opcoes/locais', token)).statusCode, 200);
  });

  test('querystring fechada: cliente_id, chave desconhecida e empresa_id ausente → 400; o tenant nunca vem da requisição', async () => {
    const x = await cenario();
    const outro = await cenario();
    for (const url of [
      `/estoque/saldo${qs({ empresa_id: x.e.id, cliente_id: outro.c })}`,
      `/estoque/movimentos${qs({ empresa_id: x.e.id, tenant: outro.c })}`,
      '/estoque/saldo',
      '/estoque/movimentos',
      `/estoque/movimentos/abc${qs({ cliente_id: x.c })}`,
    ]) {
      const r = await get(url, x.token);
      assert.equal(r.statusCode, 400, `${url} ${r.body}`);
    }
    const r = await app.inject({ method: 'GET', url: `/estoque/saldo${qs({ empresa_id: x.e.id })}`, headers: { authorization: `Bearer ${x.token}`, 'x-cliente-id': outro.c } });
    assert.equal(r.statusCode, 200);
    assert.ok(r.json().items.every((i) => [x.diesel.id, x.ureia.id, x.sal.id].includes(i.produto_id)));
  });

  test('somente leitura: POST/PATCH/DELETE em /estoque/* não existem (404)', async () => {
    const x = await cenario();
    for (const metodo of ['POST', 'PATCH', 'DELETE', 'PUT']) {
      const r = await app.inject({ method: metodo, url: '/estoque/saldo', headers: { authorization: `Bearer ${x.token}` }, payload: metodo === 'DELETE' ? undefined : {} });
      assert.equal(r.statusCode, 404, `${metodo} ${r.body}`);
    }
  });
});
