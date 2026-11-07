/**
 * D-PROD-146 — R2 BLINDAGEM FINAL da PR #222. PostgreSQL real, HTTP autenticado,
 * prova por persistência.
 *
 *  B1: auditoria de Fornecedor/Parceiro SEM PII (sentinelas lidas no AuditLog);
 *  B2: CRUD legado `/fornecedores` — empresa validada no POST e imutável no PATCH;
 *  B4: parceiro novo exige papel; o Lote só associa fornecedor ativo, da mesma
 *      empresa e com papel fornecedor (ou legado `tipos=[]`), preservando o histórico.
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
const ok = async (r, status = 200) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const codigo = (r) => r.json().code ?? r.json().error?.code;
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });

const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';
const CNPJ_A = '11.222.333/0001-81';

/** Tenant com 2 empresas, admin real e um operador só com a tela Parceiros. */
const tenant = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}` } });
  const e2 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${c}` } });
  const hash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const login = `par-${randomUUID().slice(0, 8)}`;
  const operador = await p.usuario.create({ data: { cliente_id: c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await p.permissao.create({
    data: { cliente_id: c, user_email: login, user_nome: 'Op', modulos_permitidos: ['gestao-rural'], permissoes_telas: [{ modulo_id: 'gestao-rural', tela_id: 'ges-parceiros', ...acoes(true) }] },
  });
  return {
    cliente: adm.cliente,
    e1,
    e2,
    admId: adm.usuario.id,
    adm: (await autenticarNoApp(app, adm.credenciais)).corpo.token,
    parId: operador.id,
    par: (await autenticarNoApp(app, { login, senha: adm.credenciais.senha })).corpo.token,
  };
};

/** Fotografia de Lote/estoque/rebanho — nada disso pode mudar nesta missão. */
const fotografia = async (clienteId) => {
  const p = prisma();
  const w = { where: { cliente_id: clienteId } };
  return JSON.stringify({
    lote: (await p.lote.findMany({ ...w, orderBy: { id: 'asc' } })).map((l) => [l.id, l.fornecedor_id, l.quantidade_cabecas, l.updatedAt.toISOString()]),
    nota: await p.estoqueLoteNota.count(w),
    mov: await p.movimentacaoEstoque.count(w),
    posicao: await p.posicaoRebanho.count(w),
    evento: await p.eventoRebanho.count(w),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('B1 — auditoria do Fornecedor/Parceiro sem PII', () => {
  const SENTINELAS = Object.freeze({
    nome: 'SENTNOMEPF',
    razao_social: 'SENTRAZAO',
    rg: 'SENTRG777',
    telefone: 'SENTTEL555',
    email: 'sentmail@pii.test',
    endereco: 'SENTENDERECO',
    cep: 'SENTCEP12',
    observacoes: 'SENTOBS',
    nome_responsavel: 'SENTRESP',
    inscricao_estadual: 'SENTIE99',
    cidade: 'SENTCIDADE',
  });
  /** Valores que NUNCA podem aparecer no AuditLog (inclui CPF/CNPJ em qualquer forma). */
  const PROIBIDOS = [...Object.values(SENTINELAS), 'SENTTEL2NOVO', 'sent2@pii.test', 'SENTTEL3LEG', 'SENTOBS3LEG', '52998224725', '529.982.247-25', '982.247', '982247', '11222333000181', '11.222.333', '1980-02-03', '11144477735'];

  const auditoriaDoFornecedor = async (clienteId) =>
    prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'Fornecedor' }, orderBy: { createdAt: 'asc' } });

  test('create, update, inativação (Parceiros) e create/update/DELETE legado: nenhuma PII; ator, tenant e ação corretos', async () => {
    const t = await tenant();
    const corpoPf = { empresa_id: t.e1.id, tipo_pessoa: 'Física', cpf: CPF_A, papeis: ['fornecedor'], data_nascimento: '1980-02-03', ...SENTINELAS };
    const criado = await ok(req('POST', '/parceiros', t.par, corpoPf), 201);
    await ok(req('PATCH', `/parceiros/${criado.id}`, t.par, { empresa_id: t.e1.id, telefone: 'SENTTEL2NOVO', email: 'sent2@pii.test', cpf: CPF_B }));
    await ok(req('PATCH', `/parceiros/${criado.id}`, t.par, { empresa_id: t.e1.id, ativo: false }));

    const legado = await ok(req('POST', '/fornecedores', t.adm, { empresa_id: t.e1.id, tipo_pessoa: 'Jurídica', cnpj: CNPJ_A, tipos: ['Fornecedor'], ...SENTINELAS }), 201);
    await ok(req('PATCH', `/fornecedores/${legado.id}`, t.adm, { telefone: 'SENTTEL3LEG', observacoes: 'SENTOBS3LEG' }));
    assert.equal((await req('DELETE', `/fornecedores/${legado.id}`, t.adm)).statusCode, 204);

    const logs = await auditoriaDoFornecedor(t.cliente.id);
    assert.deepEqual(logs.map((l) => l.acao), ['create', 'update', 'update', 'create', 'update', 'delete']);
    const texto = JSON.stringify(logs.map((l) => ({ a: l.dados_anteriores, n: l.dados_novos })));
    for (const proibido of PROIBIDOS) assert.ok(!texto.includes(proibido), `AuditLog contém PII: ${proibido}`);
    for (const l of logs) assert.equal(l.cliente_id, t.cliente.id);
    assert.deepEqual(logs.slice(0, 3).map((l) => l.usuario_id), [t.parId, t.parId, t.parId]);
    assert.deepEqual(logs.slice(3).map((l) => l.usuario_id), [t.admId, t.admId, t.admId]);
    assert.deepEqual(logs.map((l) => l.entidade_id), [criado.id, criado.id, criado.id, legado.id, legado.id, legado.id]);
    // Auditabilidade preservada: número, situação, papéis e NOMES dos campos alterados.
    const [c0, u1, u2] = logs;
    assert.equal(/** @type {any} */ (c0.dados_novos).numero_cadastro, criado.numero_cadastro);
    assert.deepEqual(/** @type {any} */ (c0.dados_novos).papeis, ['fornecedor']);
    assert.deepEqual([.../** @type {any} */ (u1.dados_novos).campos_alterados].sort(), ['cpf', 'email', 'telefone'].sort());
    assert.equal(/** @type {any} */ (u2.dados_anteriores).ativo, true);
    assert.equal(/** @type {any} */ (u2.dados_novos).ativo, false);
  });

  test('tentativa malsucedida não grava auditoria de alteração', async () => {
    const t = await tenant();
    const a = await ok(req('POST', '/parceiros', t.par, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'A', cpf: CPF_A, papeis: ['fornecedor'] }), 201);
    const b = await ok(req('POST', '/parceiros', t.par, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'B', cpf: CPF_B, papeis: ['cliente'] }), 201);
    const antes = (await auditoriaDoFornecedor(t.cliente.id)).length;
    assert.equal((await req('PATCH', `/parceiros/${b.id}`, t.par, { empresa_id: t.e1.id, cpf: CPF_A, telefone: 'SENTTEL555' })).statusCode, 409);
    assert.equal((await req('PATCH', `/fornecedores/${a.id}`, t.adm, { cnpj: '11.222.333/0001-82' })).statusCode, 400);
    assert.equal((await auditoriaDoFornecedor(t.cliente.id)).length, antes, 'falha não audita');
    assert.equal((await prisma().fornecedor.findUnique({ where: { id: b.id } })).telefone, null, 'nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B2 — CRUD legado /fornecedores: empresa validada e imutável (2 tenants × 2 empresas)', () => {
  test('POST com empresa inexistente, de outro tenant ou ausente → recusado; nada gravado', async () => {
    const t = await tenant();
    const outro = await tenant();
    const antes = await prisma().fornecedor.count();
    for (const [corpo, status, cod] of [
      [{ empresa_id: 'empresa-inexistente', tipo_pessoa: 'Física', nome: 'X' }, 404, 'EMPRESA_NOT_FOUND'],
      [{ empresa_id: outro.e1.id, tipo_pessoa: 'Física', nome: 'X' }, 404, 'EMPRESA_NOT_FOUND'],
      [{ tipo_pessoa: 'Física', nome: 'X' }, 400, 'REQUEST_VALIDATION_FAILED'],
    ]) {
      const r = await req('POST', '/fornecedores', t.adm, corpo);
      assert.equal(r.statusCode, status, r.body);
      assert.equal(codigo(r), cod);
    }
    assert.equal(await prisma().fornecedor.count(), antes);
  });

  test('PATCH não move fornecedor de empresa nem troca identidade; mesmo id = no-op; referências íntegras', async () => {
    const t = await tenant();
    const outro = await tenant();
    const f = await ok(req('POST', '/fornecedores', t.adm, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'HIST', cpf: CPF_A, tipos: [] }), 201);
    const lote = await ok(req('POST', '/lotes', t.adm, { empresa_id: t.e1.id, nome: 'L1', quantidade_cabecas: 10, motivo_entrada: 'Compra', fornecedor_id: f.id, fornecedor_nome: 'HIST' }), 201);
    const foto = await fotografia(t.cliente.id);
    const gravado = await prisma().fornecedor.findUnique({ where: { id: f.id } });

    for (const corpo of [{ empresa_id: t.e2.id }, { empresa_id: outro.e1.id }, { empresa_id: 'inexistente' }, { numero_cadastro: '99999' }]) {
      const r = await req('PATCH', `/fornecedores/${f.id}`, t.adm, { ...corpo, nome: 'MUDOU' });
      assert.ok([400, 404, 409].includes(r.statusCode), `${JSON.stringify(corpo)}: ${r.statusCode} ${r.body}`);
    }
    for (const corpo of [{ cliente_id: outro.cliente.id }, { id: 'outro-id' }]) {
      assert.equal((await req('PATCH', `/fornecedores/${f.id}`, t.adm, { ...corpo, nome: 'MUDOU' })).statusCode, 400);
    }
    assert.deepEqual(await prisma().fornecedor.findUnique({ where: { id: f.id } }), gravado, 'nada alterado em falha');
    assert.equal(await fotografia(t.cliente.id), foto);

    // Mesma empresa (compatibilidade) + outro campo: aceito, empresa intacta.
    const editado = await ok(req('PATCH', `/fornecedores/${f.id}`, t.adm, { empresa_id: t.e1.id, cidade: 'CUIABA' }));
    assert.equal(editado.empresa_id, t.e1.id);
    assert.equal((await prisma().lote.findUnique({ where: { id: lote.id } })).fornecedor_id, f.id);
  });

  test('duplicata pela rota antiga e pela nova, nos dois sentidos; documento histórico repetido não quebra edição', async () => {
    const t = await tenant();
    await ok(req('POST', '/fornecedores', t.adm, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'L', cpf: CPF_A, tipos: ['Fornecedor'] }), 201);
    const r = await req('POST', '/parceiros', t.par, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'N', cpf: '52998224725', papeis: ['fornecedor'] });
    assert.equal(r.statusCode, 409, r.body);
    await ok(req('POST', '/parceiros', t.par, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'N2', cpf: CPF_B, papeis: ['cliente'] }), 201);
    assert.equal((await req('POST', '/fornecedores', t.adm, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'L2', cpf: '111.444.777-35' })).statusCode, 409);
    // Duplicata histórica (gravada direto, como dado antigo) segue editável em campo não relacionado.
    const p = prisma();
    const h1 = await p.fornecedor.create({ data: { cliente_id: t.cliente.id, empresa_id: t.e2.id, numero_cadastro: 'H1', tipo_pessoa: 'Física', nome: 'H1', cpf: '000.000.000-00', tipos: [] } });
    await p.fornecedor.create({ data: { cliente_id: t.cliente.id, empresa_id: t.e2.id, numero_cadastro: 'H2', tipo_pessoa: 'Física', nome: 'H2', cpf: '000.000.000-00', tipos: [] } });
    await ok(req('PATCH', `/fornecedores/${h1.id}`, t.adm, { cidade: 'NOVA' }));
    await ok(req('PATCH', `/parceiros/${h1.id}`, t.par, { empresa_id: t.e2.id, cidade: 'NOVA2' }));
    assert.equal((await p.fornecedor.findUnique({ where: { id: h1.id } })).cpf, '000.000.000-00', 'documento antigo não refeito');
  });

  test('quem não é admin real continua 403 no legado; outro tenant não enxerga', async () => {
    const t = await tenant();
    const outro = await tenant();
    const f = await ok(req('POST', '/fornecedores', t.adm, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'X' }), 201);
    assert.equal((await req('POST', '/fornecedores', t.par, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'Y' })).statusCode, 403);
    assert.equal((await req('PATCH', `/fornecedores/${f.id}`, t.par, { nome: 'Y' })).statusCode, 403);
    assert.equal((await req('PATCH', `/fornecedores/${f.id}`, outro.adm, { nome: 'Y' })).statusCode, 404);
    assert.equal((await prisma().fornecedor.findUnique({ where: { id: f.id } })).nome, 'X');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B4 — papéis: parceiro novo exige papel; Lote só associa fornecedor válido', () => {
  test('API de Parceiros recusa papel vazio/ausente na criação e papéis vazios na edição; legado tipos=[] editável sem migrar', async () => {
    const t = await tenant();
    for (const corpo of [{}, { papeis: [] }]) {
      const r = await req('POST', '/parceiros', t.par, { empresa_id: t.e1.id, tipo_pessoa: 'Física', nome: 'SEM PAPEL', ...corpo });
      assert.equal(r.statusCode, 400, r.body);
      assert.equal(r.json().field ?? r.json().details?.field, 'papeis');
    }
    const p = prisma();
    const legado = await p.fornecedor.create({ data: { cliente_id: t.cliente.id, empresa_id: t.e1.id, numero_cadastro: 'L1', tipo_pessoa: 'Física', nome: 'LEG', tipos: [] } });
    await ok(req('PATCH', `/parceiros/${legado.id}`, t.par, { empresa_id: t.e1.id, cidade: 'X' }));
    assert.deepEqual((await p.fornecedor.findUnique({ where: { id: legado.id } })).tipos, [], 'legado não migrado à força');
    assert.equal((await req('PATCH', `/parceiros/${legado.id}`, t.par, { empresa_id: t.e1.id, papeis: [] })).statusCode, 400);
  });

  test('Lote: novo vínculo só com fornecedor ativo, da empresa, papel fornecedor (ou legado tipos=[]); histórico preservado', async () => {
    const t = await tenant();
    const outro = await tenant();
    const p = prisma();
    const mk = (extra) => p.fornecedor.create({ data: { cliente_id: t.cliente.id, empresa_id: t.e1.id, numero_cadastro: randomUUID().slice(0, 8), tipo_pessoa: 'Jurídica', nome: 'F', tipos: ['fornecedor'], ...extra } });
    const valido = await mk({});
    const alias = await mk({ tipos: ['Fornecedor', 'Transportadora'] });
    const legado = await mk({ tipos: [] });
    const soCliente = await mk({ tipos: ['cliente'] });
    const transportador = await mk({ tipos: ['transportador', 'outros'] });
    const inativo = await mk({ ativo: false });
    const outraEmpresa = await mk({ empresa_id: t.e2.id });
    const deOutroTenant = await p.fornecedor.create({ data: { cliente_id: outro.cliente.id, empresa_id: outro.e1.id, numero_cadastro: 'OT', tipo_pessoa: 'Jurídica', nome: 'OT', tipos: ['fornecedor'] } });
    const lote = (fornecedor_id, nome = 'L') => req('POST', '/lotes', t.adm, { empresa_id: t.e1.id, nome, quantidade_cabecas: 5, motivo_entrada: 'Compra', fornecedor_id });

    for (const f of [valido, alias, legado]) assert.equal((await lote(f.id)).statusCode, 201, `oferecível: ${JSON.stringify(f.tipos)}`);
    const antes = await p.lote.count({ where: { cliente_id: t.cliente.id } });
    for (const f of [soCliente, transportador, inativo, outraEmpresa, deOutroTenant, { id: 'nao-existe' }]) {
      const r = await lote(f.id, 'RECUSADO');
      assert.equal(r.statusCode, 400, `${f.id}: ${r.body}`);
      assert.equal(r.json().field ?? r.json().details?.field, 'fornecedor_id');
    }
    assert.equal(await p.lote.count({ where: { cliente_id: t.cliente.id } }), antes, 'nada criado');

    // Lote histórico com fornecedor depois inativado: editar OUTRO campo preserva o vínculo.
    const hist = await ok(lote(valido.id, 'HIST'), 201);
    await p.fornecedor.update({ where: { id: valido.id }, data: { ativo: false, tipos: ['cliente'] } });
    const editado = await ok(req('PATCH', `/lotes/${hist.id}`, t.adm, { observacoes: 'NOTA', fornecedor_id: valido.id }));
    assert.equal(editado.fornecedor_id, valido.id, 'mesmo fornecedor (histórico) aceito sem revalidar');
    // Trocar para um inválido → recusado; trocar para válido → aceito.
    const foto = await fotografia(t.cliente.id);
    assert.equal((await req('PATCH', `/lotes/${hist.id}`, t.adm, { fornecedor_id: soCliente.id })).statusCode, 400);
    assert.equal(await fotografia(t.cliente.id), foto, 'nada alterado na recusa');
    assert.equal((await ok(req('PATCH', `/lotes/${hist.id}`, t.adm, { fornecedor_id: alias.id }))).fornecedor_id, alias.id);
    // Remover o fornecedor (null) continua permitido.
    assert.equal((await ok(req('PATCH', `/lotes/${hist.id}`, t.adm, { fornecedor_id: null }))).fornecedor_id, null);
  });
});

describe('Revisão R2 — filtro por papel casa com as grafias históricas gravadas', () => {
  test('papel=fornecedor inclui "Fornecedor", "fornecedores" e tipos=[]; papel=prestador_servico inclui "Prestador de Serviço"', async () => {
    const t = await tenant();
    const p = prisma();
    const mk = (n, tipos) => p.fornecedor.create({ data: { cliente_id: t.cliente.id, empresa_id: t.e1.id, numero_cadastro: n, tipo_pessoa: 'Jurídica', nome: n, tipos } });
    const cap = await mk('CAP', ['Fornecedor']);
    const plural = await mk('PLU', ['fornecedores']);
    const vazio = await mk('VAZ', []);
    const prest = await mk('PRE', ['Prestador de Serviço']);
    const cli = await mk('CLI', ['Cliente']);
    await mk('OUTRA', ['fornecedor']).then((f) => p.fornecedor.update({ where: { id: f.id }, data: { empresa_id: t.e2.id } }));
    const forn = await ok(req('GET', `/parceiros?empresa_id=${t.e1.id}&papel=fornecedor`, t.par));
    assert.deepEqual(forn.items.map((i) => i.id).sort(), [cap.id, plural.id, vazio.id].sort());
    assert.equal(forn.total, 3);
    for (const i of forn.items) assert.ok(i.papeis.includes('fornecedor') || i.papeis.length === 0);
    const pr = await ok(req('GET', `/parceiros?empresa_id=${t.e1.id}&papel=prestador_servico`, t.par));
    assert.deepEqual(pr.items.map((i) => i.id), [prest.id]);
    const cl = await ok(req('GET', `/parceiros?empresa_id=${t.e1.id}&papel=cliente`, t.par));
    assert.deepEqual(cl.items.map((i) => i.id), [cli.id]);
    const nenhum = await ok(req('GET', `/parceiros?empresa_id=${t.e1.id}&papel=transportador`, t.par));
    assert.equal(nenhum.total, 0);
  });
});
