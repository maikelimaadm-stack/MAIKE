/**
 * D-PROD-257 (Estoque → Entradas) — entrada manual documentada e saldo de implantação.
 * PostgreSQL real, HTTP autenticado: os três motivos, custo zero só com a declaração e o motivo,
 * implantação única, motivo imutável, permissão `entrada` (403), isolamento por tenant, exclusão com
 * estorno pelo motor e prova fail-closed, documento duplicado e a API do documento.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { ACOES_ESTOQUE_EXTRAS } from '../src/shared/auth/autorizacaoTela.js';

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
const qs = (obj) => '?' + new URLSearchParams(obj).toString();

let seq = 0;
const produto = (c, e, nome, unidade = 'KG', extra = {}) =>
  prisma().produto.create({ data: { cliente_id: c, empresa_id: e, numero_produto: String(++seq + 1000), nome_produto: nome, unidade_principal_estoque: unidade, ...extra } });
const local = (c, nome) => prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome } });

const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const ureia = await produto(c, e.id, 'Ureia', 'KG');
  const sal = await produto(c, e.id, 'Sal mineral', 'KG', { peso_por_saco_kg: '25' });
  const diesel = await produto(c, e.id, 'Diesel', 'L');
  const galpao = await local(c, 'Galpão');
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  return { c, e, ureia, sal, diesel, galpao, token: corpo.token, adm };
};

/** `reason` sobe para o topo da resposta quando vem com `field`; senão fica em `details`. */
const razao = (r) => r.json().reason ?? r.json().details?.reason;
const hoje = () => new Date().toISOString().slice(0, 10);
const corpoDe = (x, extra = {}, item = {}) => ({
  empresa_id: x.e.id,
  operation_id: `op-${randomUUID()}`,
  motivo: 'SALDO_IMPLANTACAO',
  data_entrada: hoje(),
  itens: [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '100', custo_unitario: '3.5', ...item }],
  ...extra,
});
const criar = (x, extra, item, token = x.token) => chamar('POST', '/estoque/entradas', token, corpoDe(x, extra, item));

const contaCom = async (x, permissoes_telas) => {
  const hash = (await prisma().usuario.findUnique({ where: { id: x.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: x.c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: x.c, user_email: login, user_nome: 'Op', modulos_permitidos: ['suporte-mapa'], permissoes_telas } });
  const { corpo } = await autenticarNoApp(app, { login, senha: x.adm.credenciais.senha });
  assert.ok(corpo.token);
  return corpo.token;
};
const linha = (extras = {}) => ({ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...extras });

const estoqueAtual = async (p) => Number((await prisma().produto.findUnique({ where: { id: p.id } })).estoque_atual);

describe('D-PROD-257 — criar com cada motivo (o motor grava camada, movimento e cache)', () => {
  test('SALDO_IMPLANTACAO: 201, camada com o custo, movimento entrada_saldo_implantacao numerado, cache += kg, evento e AuditLog', async () => {
    const x = await cenario();
    const r = await criar(x, { documento_numero: ' nf-77 ', observacao: 'contagem inicial' });
    assert.equal(r.statusCode, 201, r.body);
    const b = r.json();
    assert.equal(b.status, 'CONFIRMADA');
    assert.equal(b.motivo, 'SALDO_IMPLANTACAO');
    assert.equal(b.versao, 1);
    assert.equal(b.revisao, 1);
    assert.equal(b.documento_numero, 'nf-77');
    assert.equal(b.replay, false);
    assert.equal(b.itens.length, 1);
    const [i] = b.itens;
    assert.deepEqual([i.quantidade_estoque, i.custo_kg, i.valor_total, i.custo_zero, i.unidade_estoque], ['100.0000', '3.5000', '350.0000', false, 'KG']);
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { id: i.estoque_lote_nota_id } });
    assert.equal(Number(lote.quantidade_disponivel), 100);
    assert.equal(Number(lote.custo_unitario), 3.5);
    assert.equal(lote.numero_documento, 'nf-77');
    const mov = await prisma().movimentacaoEstoque.findUnique({ where: { id: i.movimentacao_estoque_id } });
    assert.deepEqual([mov.tipo_movimentacao, mov.tipo_detalhado, mov.origem_sistema, mov.status], ['Entrada', 'entrada_saldo_implantacao', 'entrada_estoque', 'Ativa']);
    assert.ok(!mov.numero_movimentacao.startsWith('p-'), 'número definitivo');
    assert.equal(await estoqueAtual(x.ureia), 100);
    assert.equal(b.eventos.length, 1);
    assert.equal(b.eventos[0].tipo, 'CONFIRMACAO');
    const audit = await prisma().auditLog.findMany({ where: { cliente_id: x.c, entidade: 'EntradaEstoque' } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].acao, 'entrada_estoque.confirmar');
  });

  test('DOACAO com custo zero declarado e DOACAO com valor de referência; OUTRA_COM_JUSTIFICATIVA com justificativa de 20+ caracteres', async () => {
    const x = await cenario();
    const d1 = await criar(x, { motivo: 'DOACAO' }, { custo_unitario: '0', custo_zero: true });
    assert.equal(d1.statusCode, 201, d1.body);
    assert.equal(d1.json().itens[0].custo_zero, true);
    const d2 = await criar(x, { motivo: 'DOACAO' }, { produto_id: x.sal.id, custo_unitario: '2', quantidade: '10' });
    assert.equal(d2.statusCode, 201, d2.body);
    const o = await criar(x, { motivo: 'OUTRA_COM_JUSTIFICATIVA', justificativa: 'Material devolvido pelo vizinho sem nota' }, { produto_id: x.diesel.id, unidade: 'L', quantidade: '50', custo_unitario: '5.8' });
    assert.equal(o.statusCode, 201, o.body);
    const mov = await prisma().movimentacaoEstoque.findUnique({ where: { id: o.json().itens[0].movimentacao_estoque_id } });
    assert.equal(mov.tipo_detalhado, 'entrada_outra_com_justificativa');
    assert.equal(mov.unidade_medida, 'L');
    const mov1 = await prisma().movimentacaoEstoque.findUnique({ where: { id: d1.json().itens[0].movimentacao_estoque_id } });
    assert.equal(mov1.tipo_detalhado, 'entrada_doacao');
    assert.equal(await estoqueAtual(x.diesel), 50);
  });

  test('OUTRA sem justificativa (ou com menos de 20 caracteres) → 422 e nada gravado', async () => {
    const x = await cenario();
    for (const justificativa of [undefined, 'curta']) {
      const r = await criar(x, { motivo: 'OUTRA_COM_JUSTIFICATIVA', justificativa });
      assert.equal(r.statusCode, 422, r.body);
      assert.equal(r.json().code, 'ENTRADA_ESTOQUE_INVALIDA');
    }
    assert.equal(await prisma().entradaEstoque.count(), 0);
    assert.equal(await estoqueAtual(x.ureia), 0);
  });

  test('motivo fora dos três fechados (COMPRA, AJUSTE_INVENTARIO, DEVOLUCAO) → 400', async () => {
    const x = await cenario();
    for (const motivo of ['COMPRA', 'AJUSTE_INVENTARIO', 'DEVOLUCAO']) {
      assert.equal((await criar(x, { motivo })).statusCode, 400);
    }
  });

  test('SACO: quantidade × peso do saco em kg e custo por kg = custo do saco ÷ peso; produto sem peso é recusado; L só para produto em L', async () => {
    const x = await cenario();
    const r = await criar(x, { motivo: 'DOACAO' }, { produto_id: x.sal.id, unidade: 'SACO', quantidade: '2', custo_unitario: '100' });
    assert.equal(r.statusCode, 201, r.body);
    const [i] = r.json().itens;
    assert.deepEqual([i.quantidade, i.fator_kg, i.quantidade_estoque, i.custo_unitario, i.custo_kg, i.valor_total], ['2.0000', '25.0000', '50.0000', '100.0000', '4.0000', '200.0000']);
    assert.equal(await estoqueAtual(x.sal), 50);
    const semPeso = await criar(x, { motivo: 'DOACAO' }, { unidade: 'SACO' });
    assert.equal(semPeso.statusCode, 422);
    assert.equal(razao(semPeso), 'peso_por_saco_ausente');
    const litros = await criar(x, { motivo: 'DOACAO' }, { unidade: 'L' });
    assert.equal(litros.statusCode, 422);
    assert.equal(razao(litros), 'unidade_incompativel');
  });

  test('replay da mesma operation_id devolve 200 com o mesmo documento, sem duplicar o estoque; corpo diferente com a mesma chave → 409', async () => {
    const x = await cenario();
    const corpo = corpoDe(x);
    const a = await chamar('POST', '/estoque/entradas', x.token, corpo);
    assert.equal(a.statusCode, 201, a.body);
    const b = await chamar('POST', '/estoque/entradas', x.token, corpo);
    assert.equal(b.statusCode, 200, b.body);
    assert.equal(b.json().id, a.json().id);
    assert.equal(b.json().replay, true);
    assert.equal(await estoqueAtual(x.ureia), 100);
    const c = await chamar('POST', '/estoque/entradas', x.token, { ...corpo, itens: [{ ...corpo.itens[0], quantidade: '5' }] });
    assert.equal(c.statusCode, 409, c.body);
  });

  test('data futura na fazenda → 422', async () => {
    const x = await cenario();
    const r = await criar(x, { data_entrada: '2099-01-01' });
    assert.equal(r.statusCode, 422);
    assert.equal(razao(r), 'data_futura');
  });
});

describe('D-PROD-257 — custo zero só com a declaração e o motivo; custo negativo recusado', () => {
  test('zero sem declarar custo_zero → 422; custo_zero com custo > 0 → 422', async () => {
    const x = await cenario();
    const a = await criar(x, { motivo: 'DOACAO' }, { custo_unitario: '0' });
    assert.equal(a.statusCode, 422, a.body);
    assert.equal(a.json().code, 'ENTRADA_ESTOQUE_CUSTO_ZERO');
    assert.equal(razao(a), 'custo_zero_nao_declarado');
    const b = await criar(x, { motivo: 'DOACAO' }, { custo_unitario: '2', custo_zero: true });
    assert.equal(b.statusCode, 422);
    assert.equal(razao(b), 'custo_zero_com_custo');
  });

  test('implantação com custo zero: recusada sem justificativa; aceita com justificativa (custo histórico desconhecido)', async () => {
    const x = await cenario();
    const sem = await criar(x, {}, { custo_unitario: '0', custo_zero: true });
    assert.equal(sem.statusCode, 422, sem.body);
    assert.equal(razao(sem), 'custo_zero_sem_justificativa');
    assert.equal(await prisma().entradaEstoque.count(), 0);
    const com = await criar(x, { justificativa: 'custo histórico desconhecido' }, { custo_unitario: '0', custo_zero: true });
    assert.equal(com.statusCode, 201, com.body);
    assert.equal(com.json().itens[0].custo_zero, true);
    assert.equal(com.json().itens[0].custo_kg, '0.0000');
  });

  test('custo negativo e quantidade como número do JSON → 400; quantidade zero → 422', async () => {
    const x = await cenario();
    assert.equal((await criar(x, {}, { custo_unitario: '-1' })).statusCode, 400);
    assert.equal((await criar(x, {}, { quantidade: 10 })).statusCode, 400);
    const zero = await criar(x, {}, { quantidade: '0' });
    assert.equal(zero.statusCode, 422);
    assert.equal(razao(zero), 'quantidade_zero');
  });
});

describe('D-PROD-257 — implantação ativa única e sem histórico', () => {
  test('segunda implantação do mesmo produto (mesmo em outro depósito) → 409 implantacao_ativa', async () => {
    const x = await cenario();
    assert.equal((await criar(x)).statusCode, 201);
    const outro = await local(x.c, 'Galpão 2');
    const r = await criar(x, {}, { local_estoque_id: outro.id });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO');
    assert.equal(razao(r), 'implantacao_ativa', r.body);
    assert.equal(await estoqueAtual(x.ureia), 100);
  });

  test('produto com histórico (camada ou movimento anterior) não tem implantação; DOACAO no mesmo produto continua valendo', async () => {
    const x = await cenario();
    await prisma().estoqueLoteNota.create({
      data: { cliente_id: x.c, empresa_id: x.e.id, produto_id: x.ureia.id, produto_nome: 'Ureia', local_estoque_id: x.galpao.id, custo_unitario: '1', quantidade_entrada: '5', quantidade_disponivel: '0', status: 'Esgotado' },
    });
    const r = await criar(x);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(razao(r), 'camadas_existentes');
    assert.equal((await criar(x, { motivo: 'DOACAO' }, { custo_unitario: '1' })).statusCode, 201);
  });

  test('implantação de produto com doação anterior (o produto já teve movimento) → 409 movimentos_existentes ou camadas_existentes', async () => {
    const x = await cenario();
    assert.equal((await criar(x, { motivo: 'DOACAO' }, { custo_unitario: '1' })).statusCode, 201);
    const r = await criar(x);
    assert.equal(r.statusCode, 409, r.body);
    assert.ok(['camadas_existentes', 'movimentos_existentes'].includes(razao(r)));
  });

  test('implantação excluída com segurança libera a reimplantação (os fatos das linhas estornadas não contam como histórico)', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    const ex = await chamar('POST', `/estoque/entradas/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: a.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    const de_novo = await criar(x, {}, { quantidade: '80' });
    assert.equal(de_novo.statusCode, 201, de_novo.body);
    assert.equal(await estoqueAtual(x.ureia), 80);
  });

  test('duas implantações do mesmo produto em paralelo: uma vence (201), a outra 409; o estoque é de uma só', async () => {
    const x = await cenario();
    const [a, b] = await Promise.all([criar(x), criar(x)]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [201, 409], `${a.body} ${b.body}`);
    assert.equal(await estoqueAtual(x.ureia), 100);
  });
});

describe('D-PROD-257 — motivo imutável, edição só de observação e justificativa', () => {
  test('PATCH com outro motivo → 422 ENTRADA_ESTOQUE_MOTIVO_IMUTAVEL; com o mesmo motivo e nova observação → 200, versão e revisão sobem, evento EDICAO/METADADOS', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    const base = { empresa_id: x.e.id, versao: a.versao, motivo_edicao: 'corrigir observação' };
    const troca = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, { ...base, motivo: 'DOACAO' });
    assert.equal(troca.statusCode, 422, troca.body);
    assert.equal(troca.json().code, 'ENTRADA_ESTOQUE_MOTIVO_IMUTAVEL');
    const ok = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, { ...base, motivo: 'SALDO_IMPLANTACAO', observacao: 'conferido no galpão' });
    assert.equal(ok.statusCode, 200, ok.body);
    const b = ok.json();
    assert.deepEqual([b.motivo, b.versao, b.revisao, b.observacao], ['SALDO_IMPLANTACAO', 2, 2, 'conferido no galpão']);
    assert.deepEqual(b.eventos.map((e) => [e.tipo, e.modo]), [['CONFIRMACAO', null], ['EDICAO', 'METADADOS']]);
    assert.equal(await estoqueAtual(x.ureia), 100, 'a edição de metadado não toca o estoque');
    const velha = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, { ...base, observacao: 'x' });
    assert.equal(velha.statusCode, 409);
    assert.equal(velha.json().code, 'ENTRADA_ESTOQUE_VERSAO_CONFLITO');
  });

  test('campo físico (data, documento, itens) na edição → 409 ENTRADA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA; nada muda', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    const r = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, { empresa_id: x.e.id, versao: 1, motivo_edicao: 'trocar quantidade', itens: [] });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ENTRADA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA');
    const d = await chamar('GET', `/estoque/entradas/${a.id}${qs({ empresa_id: x.e.id })}`, x.token);
    assert.equal(d.json().versao, 1);
  });

  test('OUTRA continua exigindo justificativa de 20+ caracteres na edição', async () => {
    const x = await cenario();
    const a = (await criar(x, { motivo: 'OUTRA_COM_JUSTIFICATIVA', justificativa: 'Material devolvido pelo vizinho sem nota' }, { custo_unitario: '1' })).json();
    const r = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, { empresa_id: x.e.id, versao: 1, motivo_edicao: 'encurtar', justificativa: 'curta' });
    assert.equal(r.statusCode, 422, r.body);
  });
});

describe('D-PROD-257 — permissão: a ação `entrada` da tela sup-estoque', () => {
  test('visualizar vê a lista e o detalhe, mas criar, editar, excluir e os seletores do formulário dão 403; com `entrada` passa', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    const soVer = await contaCom(x, [linha()]);
    assert.equal((await chamar('GET', `/estoque/entradas${qs({ empresa_id: x.e.id })}`, soVer)).statusCode, 200);
    assert.equal((await chamar('GET', `/estoque/entradas/${a.id}${qs({ empresa_id: x.e.id })}`, soVer)).statusCode, 200);
    assert.equal((await criar(x, {}, {}, soVer)).statusCode, 403);
    assert.equal((await chamar('PATCH', `/estoque/entradas/${a.id}`, soVer, { empresa_id: x.e.id, versao: 1, motivo_edicao: 'abc', observacao: 'x' })).statusCode, 403);
    assert.equal((await chamar('POST', `/estoque/entradas/${a.id}/excluir`, soVer, { empresa_id: x.e.id, versao: 1, motivo: 'abc', operation_id: `ex-${randomUUID()}` })).statusCode, 403);
    assert.equal((await chamar('GET', `/estoque/entradas/opcoes/produtos${qs({ empresa_id: x.e.id })}`, soVer)).statusCode, 403);
    assert.equal(await estoqueAtual(x.ureia), 100);
    const comEntrada = await contaCom(x, [linha({ entrada: true })]);
    assert.equal((await criar(x, { motivo: 'DOACAO' }, { custo_unitario: '1' }, comEntrada)).statusCode, 201);
    assert.equal((await chamar('GET', `/estoque/entradas/opcoes/produtos${qs({ empresa_id: x.e.id })}`, comEntrada)).statusCode, 200);
  });

  test('sem a tela (ou sem o módulo) → 403 até na lista; sem token → 401', async () => {
    const x = await cenario();
    const semTela = await contaCom(x, [{ ...linha(), tela_id: 'sup-locais-estoque' }]);
    assert.equal((await chamar('GET', `/estoque/entradas${qs({ empresa_id: x.e.id })}`, semTela)).statusCode, 403);
    assert.equal((await chamar('GET', `/estoque/entradas${qs({ empresa_id: x.e.id })}`)).statusCode, 401);
  });

  test('paridade front↔back: ACOES_ESTOQUE_EXTRAS = EXTRA_ACTION_KEYS_BY_PAGE["sup-estoque"]; `ajuste` não existe', () => {
    const front = readFileSync(new URL('../../src/lib/permissions.js', import.meta.url), 'utf8');
    const m = front.match(/"sup-estoque":\s*Object\.freeze\(\[([^\]]*)\]/);
    assert.ok(m, 'sup-estoque ausente em EXTRA_ACTION_KEYS_BY_PAGE');
    assert.deepEqual(m[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean), [...ACOES_ESTOQUE_EXTRAS]);
    assert.deepEqual([...ACOES_ESTOQUE_EXTRAS], ['entrada']);
  });
});

describe('D-PROD-257 — isolamento por tenant', () => {
  test('outro tenant não lê, não edita, não exclui nem cria na fazenda alheia (404, sem oráculo)', async () => {
    const x = await cenario();
    const y = await cenario();
    const a = (await criar(x)).json();
    const get = await chamar('GET', `/estoque/entradas/${a.id}${qs({ empresa_id: y.e.id })}`, y.token);
    assert.equal(get.statusCode, 404);
    assert.equal(get.json().code, 'ENTRADA_ESTOQUE_NOT_FOUND');
    assert.equal((await chamar('GET', `/estoque/entradas/${a.id}${qs({ empresa_id: x.e.id })}`, y.token)).statusCode, 404);
    assert.equal((await chamar('PATCH', `/estoque/entradas/${a.id}`, y.token, { empresa_id: y.e.id, versao: 1, motivo_edicao: 'abc', observacao: 'x' })).statusCode, 404);
    assert.equal((await chamar('POST', `/estoque/entradas/${a.id}/excluir`, y.token, { empresa_id: y.e.id, versao: 1, motivo: 'abc', operation_id: `ex-${randomUUID()}` })).statusCode, 404);
    const cruzada = await chamar('POST', '/estoque/entradas', y.token, corpoDe(x));
    assert.equal(cruzada.statusCode, 404, cruzada.body);
    const lista = await chamar('GET', `/estoque/entradas${qs({ empresa_id: y.e.id })}`, y.token);
    assert.equal(lista.json().items.length, 0);
    assert.equal(await estoqueAtual(x.ureia), 100);
  });

  test('cliente_id no corpo ou na querystring é 400 (o tenant vem só da sessão)', async () => {
    const x = await cenario();
    assert.equal((await chamar('POST', '/estoque/entradas', x.token, { ...corpoDe(x), cliente_id: 'outro' })).statusCode, 400);
    assert.equal((await chamar('GET', `/estoque/entradas${qs({ empresa_id: x.e.id, cliente_id: 'outro' })}`, x.token)).statusCode, 400);
  });
});

describe('D-PROD-257 — excluir: estorno integral pelo motor, com a prova de camada intocada (fail-closed)', () => {
  const excluirEntrada = (x, a, extra = {}) =>
    chamar('POST', `/estoque/entradas/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: a.versao, motivo: 'lançada por engano', operation_id: `ex-${randomUUID()}`, ...extra });

  test('exclusão: status EXCLUIDA, camada Estornado, movimento compensatório, cache volta, evento EXCLUSAO; a reconciliação continua sem divergência', async () => {
    const x = await cenario();
    const a = (await criar(x, { motivo: 'DOACAO' }, { custo_unitario: '2' })).json();
    const r = await excluirEntrada(x, a);
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.deepEqual([b.status, b.versao, b.excluida_de, b.motivo_exclusao], ['EXCLUIDA', 2, 'CONFIRMADA', 'lançada por engano']);
    assert.equal(b.itens.length, 0);
    assert.equal(b.itens_historico.length, 1);
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { id: b.itens_historico[0].estoque_lote_nota_id } });
    assert.deepEqual([lote.status, Number(lote.quantidade_disponivel)], ['Estornado', 0]);
    const est = await prisma().movimentacaoEstoque.findUnique({ where: { id: b.itens_historico[0].movimentacao_estorno_id } });
    assert.deepEqual([est.tipo_movimentacao, est.tipo_detalhado, est.origem_sistema], ['Saída', 'estorno_entrada_exclusao', 'entrada_estoque']);
    assert.ok(!est.numero_movimentacao.startsWith('p-'));
    const original = await prisma().movimentacaoEstoque.findUnique({ where: { id: b.itens_historico[0].movimentacao_estoque_id } });
    assert.deepEqual([original.status, original.movimento_filho_id], ['Estornada', est.id]);
    assert.equal(await estoqueAtual(x.ureia), 0);
    assert.deepEqual(b.eventos.map((e) => e.tipo), ['CONFIRMACAO', 'EXCLUSAO']);
    const rec = await chamar('GET', `/estoque-fisico/reconciliacao${qs({ empresa_id: x.e.id })}`, x.token);
    assert.equal(rec.statusCode, 200, rec.body);
    assert.deepEqual(rec.json().achados, [], rec.body.slice(0, 800));
  });

  test('segunda exclusão (versão nova) → 409 STATUS_INVALIDO; edição de entrada excluída → 409; replay da mesma operation_id → 200', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    const operation_id = `ex-${randomUUID()}`;
    const primeira = await excluirEntrada(x, a, { operation_id });
    assert.equal(primeira.statusCode, 200, primeira.body);
    const replay = await excluirEntrada(x, a, { operation_id });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replay, true);
    const segunda = await excluirEntrada(x, { ...a, versao: 2 });
    assert.equal(segunda.statusCode, 409, segunda.body);
    assert.equal(segunda.json().code, 'ENTRADA_ESTOQUE_STATUS_INVALIDO');
    const edit = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, { empresa_id: x.e.id, versao: 2, motivo_edicao: 'abc', observacao: 'x' });
    assert.equal(edit.statusCode, 409);
    assert.equal(await estoqueAtual(x.ureia), 0);
  });

  test('versão velha → 409 VERSAO_CONFLITO e nada muda', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    const r = await excluirEntrada(x, { ...a, versao: 7 });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'ENTRADA_ESTOQUE_VERSAO_CONFLITO');
    assert.equal(await estoqueAtual(x.ureia), 100);
  });

  test('camada já consumida (disponível < entrada) → 409 DEPENDENCIAS_FISICAS e o estoque fica como está', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    await prisma().estoqueLoteNota.update({ where: { id: a.itens[0].estoque_lote_nota_id }, data: { quantidade_disponivel: '60' } });
    const r = await excluirEntrada(x, a);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS');
    assert.equal(razao(r), 'camada_consumida');
    const d = await chamar('GET', `/estoque/entradas/${a.id}${qs({ empresa_id: x.e.id })}`, x.token);
    assert.equal(d.json().status, 'CONFIRMADA');
  });

  test('camada citada em baixa (JSON lotes_consumidos), mesmo que a baixa tenha sido estornada → 409 camada_citada_em_baixa', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    await prisma().movimentacaoEstoque.create({
      data: {
        cliente_id: x.c, empresa_id: x.e.id, numero_movimentacao: '99001', tipo_movimentacao: 'Saída', origem_sistema: 'suplementacao', produto_id: x.ureia.id, produto_nome: 'Ureia',
        quantidade: '10', unidade_medida: 'KG', data_movimentacao: new Date(), status: 'Estornada',
        lotes_consumidos: [{ lote_id: a.itens[0].estoque_lote_nota_id, quantidade: '10', custo_unitario: '3.5' }],
      },
    });
    const r = await excluirEntrada(x, a);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(razao(r), 'camada_citada_em_baixa');
  });

  test('camada com custo reavaliado (poço movimentado) → 409 custo_reavaliado', async () => {
    const x = await cenario();
    const a = (await criar(x)).json();
    await prisma().estoqueLoteNota.update({ where: { id: a.itens[0].estoque_lote_nota_id }, data: { custo_unitario: '3.9' } });
    const r = await excluirEntrada(x, a);
    assert.equal(r.statusCode, 409);
    assert.equal(razao(r), 'custo_reavaliado');
  });
});

describe('D-PROD-257 — documento e API do documento', () => {
  test('mesmo documento em outra entrada confirmada → 409 documento_duplicado (grafia normalizada); excluída libera o documento', async () => {
    const x = await cenario();
    const a = (await criar(x, { motivo: 'DOACAO', documento_numero: 'NF 123' }, { custo_unitario: '1' })).json();
    const r = await criar(x, { motivo: 'DOACAO', documento_numero: ' nf 123 ' }, { produto_id: x.sal.id, custo_unitario: '1' });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE');
    assert.equal(razao(r), 'documento_duplicado');
    const ex = await chamar('POST', `/estoque/entradas/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 1, motivo: 'trocar', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    assert.equal((await criar(x, { motivo: 'DOACAO', documento_numero: 'NF 123' }, { produto_id: x.sal.id, custo_unitario: '1' })).statusCode, 201);
  });

  test('documento já usado em lançamento financeiro CONFIRMADO → 409 documento_de_compra', async () => {
    const x = await cenario();
    const forn = await prisma().fornecedor.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero_cadastro: '9001', tipo_pessoa: 'Jurídica', nome: 'Agro Insumos', tipos: ['fornecedor'] } });
    await prisma().operacaoFinanceira.create({
      data: {
        cliente_id: x.c, empresa_id: x.e.id, numero: '1', status: 'CONFIRMADO', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'AVISTA', parceiro_id: forn.id, parceiro_nome: forn.nome,
        documento_referencia: 'NF-9', documento_chave_ativa: 'NF-9', data_emissao: new Date(), moeda: 'BRL', moeda_casas: 2, valor_bruto: '10', valor_total: '10', rateio_modo: 'VALOR', confirmado_em: new Date(),
      },
    });
    const r = await criar(x, { motivo: 'DOACAO', documento_numero: 'nf-9' }, { custo_unitario: '1' });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(razao(r), 'documento_de_compra');
  });

  test('lista: filtros por motivo, status, produto, período e busca; keyset; detalhe com linhas e histórico', async () => {
    const x = await cenario();
    const a = (await criar(x, { documento_numero: 'DOC-A' })).json();
    const b = (await criar(x, { motivo: 'DOACAO' }, { produto_id: x.sal.id, custo_unitario: '1' })).json();
    await chamar('POST', `/estoque/entradas/${b.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 1, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    const lista = async (q) => (await chamar('GET', `/estoque/entradas${qs({ empresa_id: x.e.id, ...q })}`, x.token)).json();
    assert.equal((await lista({})).total, 2);
    assert.deepEqual((await lista({ motivo: 'DOACAO' })).items.map((i) => i.id), [b.id]);
    assert.deepEqual((await lista({ status: 'CONFIRMADA' })).items.map((i) => i.id), [a.id]);
    assert.deepEqual((await lista({ produto_id: x.ureia.id })).items.map((i) => i.id), [a.id]);
    assert.deepEqual((await lista({ q: 'doc-a' })).items.map((i) => i.id), [a.id]);
    assert.equal((await lista({ data_de: '2099-01-01' })).items.length, 0);
    const p1 = await lista({ limit: '1' });
    assert.equal(p1.items.length, 1);
    assert.equal(p1.has_more, true);
    const p2 = await lista({ limit: '1', cursor: p1.next_cursor });
    assert.notEqual(p2.items[0].id, p1.items[0].id);
    const d = (await chamar('GET', `/estoque/entradas/${a.id}${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.equal(d.itens[0].produto_nome, 'Ureia');
    assert.equal(d.itens[0].local_estoque_nome, 'Galpão');
    assert.equal(d.eventos.length, 1);
  });

  test('o movimento da entrada aparece no kardex (Movimentos) com a origem e o tipo', async () => {
    const x = await cenario();
    await criar(x);
    const m = (await chamar('GET', `/estoque/movimentos${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.equal(m.items.length, 1);
    assert.equal(m.items[0].tipo_detalhado, 'entrada_saldo_implantacao');
  });

  test('seletores do formulário: só produtos e depósitos ativos, com unidade e peso do saco', async () => {
    const x = await cenario();
    await produto(x.c, x.e.id, 'Inativo', 'KG', { ativo: false });
    const p = (await chamar('GET', `/estoque/entradas/opcoes/produtos${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.deepEqual(p.itens.map((i) => i.nome), ['Diesel', 'Sal mineral', 'Ureia']);
    assert.deepEqual(p.itens.find((i) => i.nome === 'Sal mineral').peso_por_saco_kg, '25.0000');
    assert.equal(p.itens.find((i) => i.nome === 'Diesel').unidade_estoque, 'L');
    const l = (await chamar('GET', `/estoque/entradas/opcoes/locais`, x.token)).json();
    assert.deepEqual(l.itens.map((i) => i.nome), ['Galpão']);
  });
});
