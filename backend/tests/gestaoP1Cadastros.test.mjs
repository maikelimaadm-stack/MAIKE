/**
 * D-PROD-145 — MAIKE Gestão P1: Parceiros (sobre Fornecedor), Centros de Custo,
 * Centros de Resultado e o vínculo N:N. PostgreSQL real, HTTP autenticado, prova
 * por persistência. Matriz T1–T7 do pedido do proprietário.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

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
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (tela, a = acoes(true)) => ({ modulo_id: 'gestao-rural', tela_id: tela, ...a });
const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';
const CNPJ_A = '11.222.333/0001-81';

const conta = async (clienteId, senhaHash, senha, permissao, extra = {}) => {
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: clienteId, nome: 'Op', login, senha_hash: senhaHash, papel_tenant: 'usuario', ...extra } });
  if (permissao) await prisma().permissao.create({ data: { cliente_id: clienteId, user_email: login, user_nome: 'Op', ...permissao } });
  return { login, token: (await autenticarNoApp(app, { login, senha })).corpo.token };
};

/** Tenant com duas empresas e contas por perfil. */
const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const senha = adm.credenciais.senha;
  const hash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const c = adm.cliente.id;
  const e1 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
  const e2 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const mk = (perm, extra) => conta(c, hash, senha, perm, extra);
  return {
    cliente: adm.cliente,
    e1, e2,
    adm: (await autenticarNoApp(app, adm.credenciais)).corpo.token,
    par: (await mk({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha('ges-parceiros')] })).token,
    parVer: (await mk({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha('ges-parceiros', { ...acoes(false), visualizar: true })] })).token,
    cc: (await mk({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha('ges-centros-custo')] })).token,
    ccVer: (await mk({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha('ges-centros-custo', { ...acoes(false), visualizar: true })] })).token,
    cr: (await mk({ modulos_permitidos: ['gestao-rural'], permissoes_telas: [linha('ges-centros-resultado')] })).token,
    lotes: (await mk({ modulos_permitidos: ['manejo'], permissoes_telas: [{ modulo_id: 'manejo', tela_id: 'pec-lotes', ...acoes(false), visualizar: true }] })).token,
    sem: (await mk({ modulos_permitidos: ['mapa'], permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', ...acoes(false), visualizar: true }] })).token,
    isAdmin: (await mk({ is_admin: true })).token,
  };
};

/** Tabelas que esta missão NÃO pode tocar (prova de ausência de efeito colateral). */
const fotografiaProibidas = async (clienteId) => {
  const p = prisma();
  const w = { where: { cliente_id: clienteId } };
  return JSON.stringify({
    lote: (await p.lote.findMany({ ...w, orderBy: { id: 'asc' } })).map((l) => [l.id, l.fornecedor_id, l.fornecedor_nome, l.updatedAt.toISOString()]),
    nota: await p.estoqueLoteNota.count(w),
    mov: await p.movimentacaoEstoque.count(w),
    produto: await p.produto.count(w),
    posicao: await p.posicaoRebanho.count(w),
    evento: await p.eventoRebanho.count(w),
    movMapa: await p.movimentacaoMapa.count(w),
  });
};

const pf = (c, extra = {}) => ({ empresa_id: c.e1.id, tipo_pessoa: 'Física', nome: 'João da Silva', cpf: CPF_A, papeis: ['fornecedor', 'transportador'], ...extra });
const ok = async (r, status = 200) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};

describe('T1 — Parceiros sobre Fornecedor', () => {
  test('PF e PJ com papéis múltiplos; mesma tabela Fornecedor (sem model Parceiro); código da sequência', async () => {
    const c = await cenario();
    assert.ok(!Prisma.dmmf.datamodel.models.some((m) => m.name === 'Parceiro'), 'não existe tabela Parceiro');
    const a = await ok(req('POST', '/parceiros', c.par, pf(c)), 201);
    assert.deepEqual(a.papeis, ['fornecedor', 'transportador']);
    assert.equal(a.cpf, '52998224725', 'CPF gravado só com dígitos');
    assert.equal(a.nome, 'JOÃO DA SILVA');
    const b = await ok(req('POST', '/parceiros', c.par, { empresa_id: c.e1.id, tipo_pessoa: 'Jurídica', nome: 'Frigorífico Boi Bom', razao_social: 'Boi Bom Ltda', cnpj: CNPJ_A, papeis: ['cliente'] }), 201);
    assert.notEqual(a.numero_cadastro, b.numero_cadastro);
    const f = await prisma().fornecedor.findUnique({ where: { id: a.id } });
    assert.deepEqual(f.tipos, ['fornecedor', 'transportador']);
    assert.equal(f.empresa_id, c.e1.id);
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: c.cliente.id, entidade: 'Fornecedor', entidade_id: a.id, acao: 'create' } });
    assert.equal(audit.dados_novos.cpf, '***.982.247-**', 'CPF mascarado na auditoria');
    assert.ok(!('rg' in audit.dados_novos) && !('data_nascimento' in audit.dados_novos), 'sem RG nem nascimento na auditoria');
  });

  test('documento: inválido → 400; duplicado na empresa (inclusive formatado) → 409; outra empresa aceita', async () => {
    const c = await cenario();
    await ok(req('POST', '/parceiros', c.par, pf(c)), 201);
    const inv = await req('POST', '/parceiros', c.par, pf(c, { cpf: '123.456.789-00' }));
    assert.equal(inv.statusCode, 400, inv.body);
    assert.equal(inv.json().code, 'PARCEIRO_DOCUMENTO_INVALIDO');
    const dup = await req('POST', '/parceiros', c.par, pf(c, { nome: 'Outro', cpf: '52998224725' }));
    assert.equal(dup.statusCode, 409, dup.body);
    assert.equal(dup.json().code, 'PARCEIRO_DOCUMENTO_DUPLICADO');
    await ok(req('POST', '/parceiros', c.par, pf(c, { empresa_id: c.e2.id })), 201);
    assert.equal(await prisma().fornecedor.count({ where: { cliente_id: c.cliente.id } }), 2);
  });

  test('corrida: dois cadastros simultâneos com o mesmo CPF → um 201 e um 409', async () => {
    const c = await cenario();
    const rs = await Promise.all([req('POST', '/parceiros', c.par, pf(c, { nome: 'A' })), req('POST', '/parceiros', c.par, pf(c, { nome: 'B' }))]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409], rs.map((r) => r.body).join(' | '));
  });

  test('edição só dos campos enviados; inativar e reativar; listagem keyset e filtros', async () => {
    const c = await cenario();
    const a = await ok(req('POST', '/parceiros', c.par, pf(c)), 201);
    await ok(req('POST', '/parceiros', c.par, pf(c, { nome: 'Maria', cpf: CPF_B, papeis: ['cliente'] })), 201);
    await ok(req('POST', '/parceiros', c.par, { empresa_id: c.e1.id, tipo_pessoa: 'Jurídica', nome: 'Transp', cnpj: CNPJ_A, papeis: ['transportador'] }), 201);
    const ed = await ok(req('PATCH', `/parceiros/${a.id}`, c.par, { empresa_id: c.e1.id, telefone: '(65) 99999-0000' }));
    assert.equal(ed.telefone, '(65) 99999-0000');
    assert.equal(ed.cpf, '52998224725');
    assert.equal((await ok(req('PATCH', `/parceiros/${a.id}`, c.par, { empresa_id: c.e1.id, ativo: false }))).ativo, false);
    const p1 = await ok(req('GET', `/parceiros?empresa_id=${c.e1.id}&limit=2`, c.par));
    assert.equal(p1.items.length, 2);
    assert.equal(p1.total, 3);
    assert.ok(p1.next_cursor);
    const p2 = await ok(req('GET', `/parceiros?empresa_id=${c.e1.id}&limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`, c.par));
    assert.equal(p2.items.length, 1);
    assert.equal(new Set([...p1.items, ...p2.items].map((x) => x.id)).size, 3);
    assert.equal((await ok(req('GET', `/parceiros?empresa_id=${c.e1.id}&ativo=false`, c.par))).total, 1);
    assert.equal((await ok(req('GET', `/parceiros?empresa_id=${c.e1.id}&papel=transportador`, c.par))).total, 2);
    assert.equal((await ok(req('GET', `/parceiros?empresa_id=${c.e1.id}&q=99822`, c.par))).total, 1, 'busca por dígitos do CPF');
    assert.equal((await ok(req('PATCH', `/parceiros/${a.id}`, c.par, { empresa_id: c.e1.id, ativo: true }))).ativo, true);
    assert.equal((await ok(req('GET', `/parceiros?empresa_id=${c.e2.id}`, c.par))).total, 0, 'filtro por empresa');
  });

  test('corpo fechado: id, cliente_id, numero_cadastro, tipos, relação, HTML e troca de empresa → 400; nada gravado', async () => {
    const c = await cenario();
    const a = await ok(req('POST', '/parceiros', c.par, pf(c)), 201);
    const antes = JSON.stringify(await prisma().fornecedor.findUnique({ where: { id: a.id } }));
    for (const corpo of [
      { empresa_id: c.e1.id, id: 'x' }, { empresa_id: c.e1.id, numero_cadastro: '999' }, { empresa_id: c.e1.id, tipos: ['x'] },
      { empresa_id: c.e1.id, cliente: { update: { ativo: false } } }, { empresa_id: c.e1.id, nome: '<script>' }, { empresa_id: c.e1.id, papeis: ['banco'] },
      { empresa_id: c.e1.id, tipo_pessoa: 'Outra' }, { empresa_id: c.e1.id, nome: 'x'.repeat(256) },
    ]) {
      const r = await req('PATCH', `/parceiros/${a.id}`, c.par, corpo);
      assert.equal(r.statusCode, 400, `${JSON.stringify(corpo).slice(0, 60)} → ${r.body}`);
    }
    // empresa_id no PATCH é escopo: a outra empresa não "move" o registro — 404
    const mover = await req('PATCH', `/parceiros/${a.id}`, c.par, { empresa_id: c.e2.id, nome: 'X' });
    assert.equal(mover.statusCode, 404, mover.body);
    assert.equal(JSON.stringify(await prisma().fornecedor.findUnique({ where: { id: a.id } })), antes);
  });
});

describe('T2 — retrocompatibilidade do Fornecedor e do Cadastro de Lotes', () => {
  test('legado tipos=[] e aliases: lido, editado sem perder valor desconhecido; Lote.fornecedor_id intacto', async () => {
    const c = await cenario();
    const p = prisma();
    const legado = await p.fornecedor.create({ data: { cliente_id: c.cliente.id, empresa_id: c.e1.id, numero_cadastro: 'L1', tipo_pessoa: 'Física', nome: 'LEGADO', cpf: '529.982.247-25', tipos: [] } });
    const comAlias = await p.fornecedor.create({ data: { cliente_id: c.cliente.id, empresa_id: c.e1.id, numero_cadastro: 'L2', tipo_pessoa: 'Jurídica', nome: 'ALIAS', tipos: ['Fornecedor', 'Transportadora', 'PARCEIRO_ESPECIAL'] } });
    const lote = await p.lote.create({ data: { cliente_id: c.cliente.id, empresa_id: c.e1.id, numero_lote: '1', nome: 'L1', quantidade_cabecas: 10, quantidade_entrada: 10, motivo_entrada: 'Compra', fornecedor_id: legado.id, fornecedor_nome: 'LEGADO' } });
    const proibidasAntes = await fotografiaProibidas(c.cliente.id);

    const lido = await ok(req('GET', `/parceiros/${comAlias.id}?empresa_id=${c.e1.id}`, c.par));
    assert.deepEqual(lido.papeis, ['fornecedor', 'transportador']);
    assert.deepEqual(lido.tipos_legados, ['PARCEIRO_ESPECIAL']);
    const editado = await ok(req('PATCH', `/parceiros/${comAlias.id}`, c.par, { empresa_id: c.e1.id, papeis: ['cliente'] }));
    assert.deepEqual(editado.papeis, ['cliente']);
    assert.deepEqual(editado.tipos_legados, ['PARCEIRO_ESPECIAL'], 'valor antigo desconhecido preservado');
    assert.deepEqual((await p.fornecedor.findUnique({ where: { id: comAlias.id } })).tipos, ['cliente', 'PARCEIRO_ESPECIAL']);

    // legado com CPF formatado: editar outro campo não regrava nem recusa o documento
    await ok(req('PATCH', `/parceiros/${legado.id}`, c.par, { empresa_id: c.e1.id, cidade: 'Cuiabá' }));
    assert.equal((await p.fornecedor.findUnique({ where: { id: legado.id } })).cpf, '529.982.247-25');
    assert.equal(await fotografiaProibidas(c.cliente.id), proibidasAntes, 'Lote, estoque, produto e rebanho intactos');
    assert.equal((await p.lote.findUnique({ where: { id: lote.id } })).fornecedor_id, legado.id);
  });

  test('GET /fornecedores (Lotes) segue com CPF mascarado e projeção restrita; legado tipos=[] aparece', async () => {
    const c = await cenario();
    const a = await ok(req('POST', '/parceiros', c.par, pf(c, { rg: '1234567', telefone: '123' })), 201);
    const legado = await prisma().fornecedor.create({ data: { cliente_id: c.cliente.id, empresa_id: c.e1.id, numero_cadastro: 'L9', tipo_pessoa: 'Física', nome: 'LEGADO', tipos: [] } });
    const lista = await ok(req('GET', `/fornecedores?empresa_id=${c.e1.id}`, c.lotes));
    const meu = lista.find((x) => x.id === a.id);
    assert.equal(meu.cpf, '***.982.247-**');
    assert.ok(!('rg' in meu) && !('telefone' in meu), 'sem PII no seletor de Lotes');
    assert.ok(lista.some((x) => x.id === legado.id), 'legado sem papel continua no seletor');
  });

  test('rotas antigas de escrita de /fornecedores não ganham acesso com a tela Parceiros; Lotes não lê /parceiros', async () => {
    const c = await cenario();
    const a = await ok(req('POST', '/parceiros', c.par, pf(c)), 201);
    for (const [m, u, b] of [['POST', '/fornecedores', { empresa_id: c.e1.id, tipo_pessoa: 'Física', nome: 'X' }], ['PATCH', `/fornecedores/${a.id}`, { nome: 'X' }], ['DELETE', `/fornecedores/${a.id}`]]) {
      const r = await req(m, u, c.par, b);
      assert.equal(r.statusCode, 403, `${m} ${u}: ${r.body}`);
    }
    assert.equal((await req('GET', `/parceiros?empresa_id=${c.e1.id}`, c.lotes)).statusCode, 403);
    assert.equal((await req('GET', `/parceiros/${a.id}?empresa_id=${c.e1.id}`, c.lotes)).statusCode, 403);
    assert.ok(await prisma().fornecedor.findUnique({ where: { id: a.id } }), 'DELETE antigo não apagou');
  });
});

describe('T3 — isolamento 2 tenants × 2 empresas', () => {
  test('leituras, buscas, edições e vínculos cruzados negados sem revelar existência', async () => {
    const a = await cenario();
    const b = await cenario();
    const parA = await ok(req('POST', '/parceiros', a.par, pf(a)), 201);
    const ccA = await ok(req('POST', '/centros-custo', a.cc, { empresa_id: a.e1.id, nome: 'Oficina' }), 201);
    const crA2 = await ok(req('POST', '/centros-resultado', a.adm, { empresa_id: a.e2.id, nome: 'Cria' }), 201);
    const crB = await ok(req('POST', '/centros-resultado', b.adm, { empresa_id: b.e1.id, nome: 'Cria' }), 201);
    const antes = JSON.stringify({ f: await prisma().fornecedor.findMany({ orderBy: { id: 'asc' } }), cc: await prisma().centroCusto.findMany({ orderBy: { id: 'asc' } }), v: await prisma().centroCustoResultado.count() });
    // outro tenant com a própria empresa: 404 do recurso; com a empresa do outro tenant: 404 da empresa
    for (const [m, u, body] of [
      ['GET', `/parceiros/${parA.id}?empresa_id=${b.e1.id}`],
      ['PATCH', `/parceiros/${parA.id}`, { empresa_id: b.e1.id, nome: 'X' }],
      ['GET', `/centros-custo/${ccA.id}?empresa_id=${b.e1.id}`],
      ['PATCH', `/centros-custo/${ccA.id}`, { empresa_id: b.e1.id, nome: 'X' }],
      ['GET', `/parceiros?empresa_id=${a.e1.id}`],
      ['GET', `/centros-custo?empresa_id=${a.e1.id}`],
      ['PUT', `/centros-custo/${ccA.id}/centros-resultado`, { empresa_id: a.e1.id, centro_resultado_ids: [] }],
    ]) {
      const r = await req(m, u, b.adm, body);
      assert.equal(r.statusCode, 404, `${m} ${u}: ${r.body}`);
    }
    // mesma empresa errada dentro do tenant: centro da E1 consultado pela E2 → 404
    assert.equal((await req('GET', `/centros-custo/${ccA.id}?empresa_id=${a.e2.id}`, a.adm)).statusCode, 404);
    // vínculo com centro de resultado de outra empresa / outro tenant → 404, nada gravado
    for (const crId of [crA2.id, crB.id, 'inexistente']) {
      const r = await req('PUT', `/centros-custo/${ccA.id}/centros-resultado`, a.cc, { empresa_id: a.e1.id, centro_resultado_ids: [crId] });
      assert.equal(r.statusCode, 404, r.body);
      assert.equal(r.json().code, 'CENTRO_RESULTADO_NOT_FOUND');
    }
    // pai de outra empresa
    const ccE2 = await ok(req('POST', '/centros-custo', a.adm, { empresa_id: a.e2.id, nome: 'Curral' }), 201);
    const r = await req('PATCH', `/centros-custo/${ccA.id}`, a.adm, { empresa_id: a.e1.id, pai_id: ccE2.id });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().reason, 'pai_fora_da_empresa');
    // empresa_id do fallback do navegador (= cliente_id) não é empresa
    assert.equal((await req('POST', '/centros-custo', a.adm, { empresa_id: a.cliente.id, nome: 'X' })).json().code, 'EMPRESA_NOT_FOUND');
    const depois = JSON.stringify({ f: await prisma().fornecedor.findMany({ orderBy: { id: 'asc' } }), cc: (await prisma().centroCusto.findMany({ orderBy: { id: 'asc' } })).filter((x) => x.id !== ccE2.id), v: await prisma().centroCustoResultado.count() });
    assert.equal(depois, antes);
  });
});

describe('T4 — permissões', () => {
  test('sem a tela: 403 em todas as rotas novas; só visualizar: lê mas não grava; telas independentes; is_admin e admin real passam', async () => {
    const c = await cenario();
    const par = await ok(req('POST', '/parceiros', c.adm, pf(c)), 201);
    const cc = await ok(req('POST', '/centros-custo', c.adm, { empresa_id: c.e1.id, nome: 'Oficina' }), 201);
    const cr = await ok(req('POST', '/centros-resultado', c.adm, { empresa_id: c.e1.id, nome: 'Cria' }), 201);
    const e = c.e1.id;
    const rotas = [
      ['GET', `/parceiros?empresa_id=${e}`], ['GET', `/parceiros/${par.id}?empresa_id=${e}`], ['POST', '/parceiros', pf(c, { cpf: CPF_B })], ['PATCH', `/parceiros/${par.id}`, { empresa_id: e, nome: 'Z' }],
      ['GET', `/centros-custo?empresa_id=${e}`], ['POST', '/centros-custo', { empresa_id: e, nome: 'N' }], ['PATCH', `/centros-custo/${cc.id}`, { empresa_id: e, ativo: false }],
      ['GET', `/centros-resultado?empresa_id=${e}`], ['POST', '/centros-resultado', { empresa_id: e, nome: 'N' }],
      ['GET', `/centros-custo/${cc.id}/centros-resultado?empresa_id=${e}`], ['PUT', `/centros-custo/${cc.id}/centros-resultado`, { empresa_id: e, centro_resultado_ids: [cr.id] }],
      ['GET', `/centros-resultado/${cr.id}/centros-custo?empresa_id=${e}`], ['GET', `/centros-custo-opcoes/centros-resultado?empresa_id=${e}`],
    ];
    for (const [m, u, b] of rotas) {
      const r = await req(m, u, c.sem, b);
      assert.equal(r.statusCode, 403, `sem tela ${m} ${u}: ${r.body}`);
      assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA');
    }
    assert.equal((await req('GET', `/parceiros?empresa_id=${e}`, c.parVer)).statusCode, 200);
    for (const [m, u, b] of [['POST', '/parceiros', pf(c, { cpf: CPF_B })], ['PATCH', `/parceiros/${par.id}`, { empresa_id: e, ativo: false }]]) {
      assert.equal((await req(m, u, c.parVer, b)).statusCode, 403, `só visualizar ${m} ${u}`);
    }
    assert.equal((await req('GET', `/centros-custo?empresa_id=${e}`, c.ccVer)).statusCode, 200);
    assert.equal((await req('PUT', `/centros-custo/${cc.id}/centros-resultado`, c.ccVer, { empresa_id: e, centro_resultado_ids: [cr.id] })).statusCode, 403, 'visualizar não vincula');
    assert.equal((await req('PATCH', `/centros-custo/${cc.id}`, c.ccVer, { empresa_id: e, ativo: false })).statusCode, 403, 'visualizar não inativa');
    assert.equal((await req('POST', '/centros-custo', c.par, { empresa_id: e, nome: 'N' })).statusCode, 403, 'Parceiros não cria centro');
    assert.equal((await req('POST', '/centros-resultado', c.cc, { empresa_id: e, nome: 'N' })).statusCode, 403, 'Centro de Custo não cria centro de resultado');
    assert.equal((await req('GET', `/centros-custo-opcoes/centros-resultado?empresa_id=${e}`, c.cc)).statusCode, 200, 'quem edita o CC vê as opções mínimas');
    assert.equal(await prisma().centroCustoResultado.count(), 0);
    for (const tok of [c.isAdmin, c.adm]) assert.equal((await req('GET', `/centros-resultado?empresa_id=${e}`, tok)).statusCode, 200);
  });

  test('conta desativada ou sem token → 401', async () => {
    const c = await cenario();
    await prisma().usuario.updateMany({ where: { cliente_id: c.cliente.id, papel_tenant: 'usuario' }, data: { ativo: false } });
    assert.equal((await req('GET', `/parceiros?empresa_id=${c.e1.id}`, c.par)).statusCode, 401);
    assert.equal((await req('GET', `/centros-custo?empresa_id=${c.e1.id}`, null)).statusCode, 401);
  });
});

describe('T5 — hierarquia', () => {
  const novo = (c, tok, nome, pai_id) => ok(req('POST', '/centros-custo', tok, { empresa_id: c.e1.id, nome, ...(pai_id ? { pai_id } : {}) }), 201);
  const patch = (c, id, corpo) => req('PATCH', `/centros-custo/${id}`, c.cc, { empresa_id: c.e1.id, ...corpo });

  test('raiz, filho e neto; ciclo, autorreferência, pai inativo e profundidade barrados; nada gravado', async () => {
    const c = await cenario();
    const r = await novo(c, c.cc, 'Pecuária');
    const f = await novo(c, c.cc, 'Cria', r.id);
    const n = await novo(c, c.cc, 'Maternidade', f.id);
    assert.equal(f.pai_nome, 'PECUÁRIA');
    const antes = JSON.stringify(await prisma().centroCusto.findMany({ orderBy: { id: 'asc' } }));
    for (const [corpo, motivo] of [[{ pai_id: n.id }, 'ciclo'], [{ pai_id: r.id, nome: 'X' }, null]]) {
      if (motivo === null) continue;
      const x = await patch(c, r.id, corpo);
      assert.equal(x.statusCode, 409, x.body);
      assert.equal(x.json().reason, motivo);
    }
    const auto = await patch(c, r.id, { pai_id: r.id });
    assert.equal(auto.json().reason, 'autorreferencia');
    const inativo = await novo(c, c.cc, 'Antigo');
    assert.equal((await patch(c, inativo.id, { ativo: false })).statusCode, 200);
    const comPaiInativo = await req('POST', '/centros-custo', c.cc, { empresa_id: c.e1.id, nome: 'Novo', pai_id: inativo.id });
    assert.equal(comPaiInativo.json().reason, 'pai_inativo');
    assert.equal(JSON.stringify((await prisma().centroCusto.findMany({ orderBy: { id: 'asc' } })).filter((x) => x.id !== inativo.id)), JSON.stringify(JSON.parse(antes)));
    // profundidade: Pecuária > Cria > Maternidade > N4 > N5; o 6º nível é recusado
    const n4 = await novo(c, c.cc, 'N4', n.id);
    const n5 = await novo(c, c.cc, 'N5', n4.id);
    const n6 = await req('POST', '/centros-custo', c.cc, { empresa_id: c.e1.id, nome: 'N6', pai_id: n5.id });
    assert.equal(n6.statusCode, 409, n6.body);
    assert.equal(n6.json().reason, 'profundidade_maxima');
    // mover subárvore que estouraria a profundidade
    const outra = await novo(c, c.cc, 'Outra');
    const mover = await patch(c, outra.id, { pai_id: n5.id });
    assert.equal(mover.json().reason, 'profundidade_maxima');
  });

  test('inativar pai com filho ativo → 409; reativar filho com pai inativo → 409; ordem certa funciona', async () => {
    const c = await cenario();
    const r = await novo(c, c.cc, 'Pecuária');
    const f = await novo(c, c.cc, 'Cria', r.id);
    const x = await patch(c, r.id, { ativo: false });
    assert.equal(x.statusCode, 409, x.body);
    assert.equal(x.json().code, 'CENTRO_COM_FILHOS_ATIVOS');
    assert.equal((await patch(c, f.id, { ativo: false })).statusCode, 200);
    assert.equal((await patch(c, r.id, { ativo: false })).statusCode, 200);
    const re = await patch(c, f.id, { ativo: true });
    assert.equal(re.statusCode, 409, re.body);
    assert.equal(re.json().reason, 'pai_inativo');
    assert.equal((await patch(c, r.id, { ativo: true })).statusCode, 200);
    assert.equal((await patch(c, f.id, { ativo: true })).statusCode, 200);
    // mover para raiz
    assert.equal((await ok(patch(c, f.id, { pai_id: null }))).pai_id, null);
  });

  test('nome duplicado na empresa → 409 (inclusive em corrida); outra empresa aceita; código pela sequência', async () => {
    const c = await cenario();
    const a = await novo(c, c.cc, 'Oficina');
    const dup = await req('POST', '/centros-custo', c.cc, { empresa_id: c.e1.id, nome: ' oficina ' });
    assert.equal(dup.statusCode, 409, dup.body);
    assert.equal(dup.json().code, 'CENTRO_NOME_CONFLITO');
    await ok(req('POST', '/centros-custo', c.adm, { empresa_id: c.e2.id, nome: 'Oficina' }), 201);
    const rs = await Promise.all([1, 2, 3].map(() => req('POST', '/centros-custo', c.cc, { empresa_id: c.e1.id, nome: 'Curral' })));
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409, 409], rs.map((r) => r.body).join(' | '));
    const b = (await prisma().centroCusto.findFirst({ where: { nome: 'CURRAL', empresa_id: c.e1.id } }));
    assert.notEqual(a.numero, b.numero);
  });

  test('corrida de ciclo: mover A sob B e B sob A ao mesmo tempo → no máximo um vence; árvore sem ciclo', async () => {
    const c = await cenario();
    const a = await novo(c, c.cc, 'A');
    const b = await novo(c, c.cc, 'B');
    const rs = await Promise.all([patch(c, a.id, { pai_id: b.id }), patch(c, b.id, { pai_id: a.id })]);
    assert.ok(rs.filter((r) => r.statusCode === 200).length <= 1, rs.map((r) => r.body).join(' | '));
    const [da, db] = await Promise.all([prisma().centroCusto.findUnique({ where: { id: a.id } }), prisma().centroCusto.findUnique({ where: { id: b.id } })]);
    assert.ok(!(da.pai_id === b.id && db.pai_id === a.id), 'sem ciclo A↔B');
  });
});

describe('T6 — vínculo N:N centro de custo × centro de resultado', () => {
  test('Oficina com Cria e Recria; Cria com Oficina e Curral; idempotente; desvincular; inativo barrado; auditado; dois lados iguais', async () => {
    const c = await cenario();
    const e = c.e1.id;
    const of = await ok(req('POST', '/centros-custo', c.cc, { empresa_id: e, nome: 'Oficina' }), 201);
    const cu = await ok(req('POST', '/centros-custo', c.cc, { empresa_id: e, nome: 'Curral' }), 201);
    const cria = await ok(req('POST', '/centros-resultado', c.cr, { empresa_id: e, nome: 'Cria' }), 201);
    const recria = await ok(req('POST', '/centros-resultado', c.cr, { empresa_id: e, nome: 'Recria' }), 201);
    const soja = await ok(req('POST', '/centros-resultado', c.cr, { empresa_id: e, nome: 'Soja' }), 201);
    const proibidasAntes = await fotografiaProibidas(c.cliente.id);
    const opcoes = await ok(req('GET', `/centros-custo-opcoes/centros-resultado?empresa_id=${e}`, c.cc));
    assert.deepEqual(Object.keys(opcoes.itens[0]).sort(), ['id', 'nome', 'numero', 'pai_id'], 'projeção mínima');
    const v1 = await ok(req('PUT', `/centros-custo/${of.id}/centros-resultado`, c.cc, { empresa_id: e, centro_resultado_ids: [cria.id, recria.id] }));
    assert.equal(v1.alterado, true);
    assert.deepEqual(v1.itens.map((x) => x.nome), ['CRIA', 'RECRIA']);
    await ok(req('PUT', `/centros-custo/${cu.id}/centros-resultado`, c.cc, { empresa_id: e, centro_resultado_ids: [cria.id] }));
    const auditAntes = await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'CentroCustoResultado' } });
    const repetido = await ok(req('PUT', `/centros-custo/${of.id}/centros-resultado`, c.cc, { empresa_id: e, centro_resultado_ids: [recria.id, cria.id] }));
    assert.equal(repetido.alterado, false, 'mesmo conjunto: nada gravado');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'CentroCustoResultado' } }), auditAntes, 'nem auditado');
    const ladoCria = await ok(req('GET', `/centros-resultado/${cria.id}/centros-custo?empresa_id=${e}`, c.cr));
    assert.deepEqual(ladoCria.itens.map((x) => x.nome), ['CURRAL', 'OFICINA']);
    // desvincular Recria
    const v2 = await ok(req('PUT', `/centros-custo/${of.id}/centros-resultado`, c.cc, { empresa_id: e, centro_resultado_ids: [cria.id] }));
    assert.deepEqual(v2.removidos, [recria.id]);
    assert.equal(await prisma().centroCustoResultado.count({ where: { centro_custo_id: of.id } }), 1);
    // inativo não recebe vínculo novo
    assert.equal((await req('PATCH', `/centros-resultado/${soja.id}`, c.cr, { empresa_id: e, ativo: false })).statusCode, 200);
    const inat = await req('PUT', `/centros-custo/${of.id}/centros-resultado`, c.cc, { empresa_id: e, centro_resultado_ids: [cria.id, soja.id] });
    assert.equal(inat.statusCode, 409, inat.body);
    assert.equal(inat.json().code, 'CENTRO_INATIVO');
    // inativar um centro de resultado vinculado mantém o par (rastreável)
    assert.equal((await req('PATCH', `/centros-resultado/${cria.id}`, c.cr, { empresa_id: e, ativo: false })).statusCode, 200);
    assert.equal(await prisma().centroCustoResultado.count({ where: { centro_resultado_id: cria.id } }), 2);
    const aud = await prisma().auditLog.findFirst({ where: { cliente_id: c.cliente.id, entidade: 'CentroCustoResultado', entidade_id: of.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(aud.dados_novos.comando, 'definir_vinculos');
    assert.ok(aud.usuario_id);
    // repetição dentro da lista → 400
    assert.equal((await req('PUT', `/centros-custo/${of.id}/centros-resultado`, c.cc, { empresa_id: e, centro_resultado_ids: [cria.id, cria.id] })).statusCode, 400);
    // a tela de Centro de Resultado não grava vínculo
    assert.equal((await req('PUT', `/centros-custo/${of.id}/centros-resultado`, c.cr, { empresa_id: e, centro_resultado_ids: [] })).statusCode, 403);
    assert.equal(await fotografiaProibidas(c.cliente.id), proibidasAntes, 'nenhum lançamento, estoque ou rebanho');
  });
});

describe('T7 — o banco garante o escopo (FKs compostas e CHECK)', () => {
  test('vínculo e pai de outra empresa recusados pelo PostgreSQL; autorreferência barrada pelo CHECK', async () => {
    const c = await cenario();
    const p = prisma();
    const cc1 = await p.centroCusto.create({ data: { cliente_id: c.cliente.id, empresa_id: c.e1.id, numero: 'x1', nome: 'A' } });
    const cr2 = await p.centroResultado.create({ data: { cliente_id: c.cliente.id, empresa_id: c.e2.id, numero: 'y1', nome: 'B' } });
    const cc2 = await p.centroCusto.create({ data: { cliente_id: c.cliente.id, empresa_id: c.e2.id, numero: 'x2', nome: 'C' } });
    await assert.rejects(p.centroCustoResultado.create({ data: { cliente_id: c.cliente.id, empresa_id: c.e1.id, centro_custo_id: cc1.id, centro_resultado_id: cr2.id } }), /Foreign key|P2003/);
    await assert.rejects(p.centroCusto.update({ where: { id: cc1.id }, data: { pai_id: cc2.id } }), /Foreign key|P2003/);
    await assert.rejects(p.$executeRaw`UPDATE "CentroCusto" SET pai_id = id WHERE id = ${cc1.id}`, /pai_diferente_check|check/i);
    await assert.rejects(p.empresa.delete({ where: { id: c.e1.id } }), /Foreign key|P2003|violates/, 'RESTRICT: empresa com centro não some em cascata');
  });
});
