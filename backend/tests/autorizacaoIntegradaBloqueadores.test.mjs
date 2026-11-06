/**
 * Missão integrada (D-PROD-136) — bloqueadores do diagnóstico, PostgreSQL real.
 *
 *  F1  escrita ANINHADA do Prisma promovia operador a administrador real
 *      (`cliente.update.usuarios.updateMany` num PATCH de cocho).
 *  F2  `catalogoCategoriaVisual: { update }` alterava o catálogo GLOBAL.
 *  F3  `cliente: { connect | update }` movia registro para outro tenant e
 *      desativava a própria fazenda.
 *  F5  concessão is_admin (não admin real) reescrevia saldo/custo do lote de
 *      nota, cujo POST e estorno são só do admin real.
 *  F7  Mapa Cadastro gravava `local_estoque_nome` arbitrário no lote de nota.
 *
 * Prova por persistência (banco), não só por status. A matriz do fim deriva as
 * relações do próprio schema Prisma: relação nova entra no teste sozinha.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { relacoesDoModelo } from '../src/shared/prisma/colunasGravaveis.js';

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
const linha = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), visualizar: true, ...a });

/** Conta com permissão explícita (sem a concessão is_admin padrão dos helpers). */
const contaCom = async (permissao, opcoes = {}) => {
  const c = await criarTenant({ semPermissao: true, ...opcoes });
  if (permissao) {
    await prisma().permissao.create({ data: { cliente_id: c.cliente.id, user_email: c.credenciais.login, user_nome: 'Op', ...permissao } });
  }
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  assert.ok(corpo.token, 'login');
  return { ...c, token: corpo.token };
};
const isAdminConcessao = () => contaCom({ is_admin: true });
const adminReal = () => contaCom({ is_admin: false }, { papelTenant: 'administrador' });

const recusado400 = (r, rotulo) => {
  assert.equal(r.statusCode, 400, `${rotulo}: ${r.body}`);
  assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED', `${rotulo}: ${r.body}`);
};

describe('F1 — escrita aninhada não promove a administrador real', () => {
  test('só Mapa Cadastro editar: PATCH cocho com cliente.update.usuarios.updateMany → 400; papel inalterado; Permissões continua 403', async () => {
    const A = await contaCom({ modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-cadastro', { editar: true })] });
    const ponto = await prisma().pontoSuplementacao.create({ data: { cliente_id: A.cliente.id, empresa_id: 'e1', numero_ponto: '1', nome_ponto: 'COCHO 1' } });
    const r = await req('PATCH', `/pontos-suplementacao/${ponto.id}`, A.token, {
      cliente: { update: { usuarios: { updateMany: { where: { login: A.credenciais.login }, data: { papel_tenant: 'administrador' } } } } },
    });
    recusado400(r, 'PATCH aninhado');
    const papel = (await prisma().usuario.findUnique({ where: { id: A.usuario.id } })).papel_tenant;
    assert.equal(papel, 'usuario', 'papel_tenant intacto');
    const perm = await req('POST', '/permissoes', A.token, { user_email: 'novo@x', user_nome: 'Novo', is_admin: true });
    assert.equal(perm.statusCode, 403, perm.body);
    assert.equal(perm.json().code, 'TENANT_ADMIN_REQUIRED');
    assert.equal((await prisma().pontoSuplementacao.findUnique({ where: { id: ponto.id } })).updatedAt.getTime(), ponto.updatedAt.getTime(), 'cocho não foi tocado');
  });

  test('controle: o mesmo operador renomeia o cocho com campos escalares (e ecos do servidor ignorados) → 200', async () => {
    const A = await contaCom({ modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-cadastro', { editar: true })] });
    const ponto = await prisma().pontoSuplementacao.create({ data: { cliente_id: A.cliente.id, empresa_id: 'e1', numero_ponto: '1', nome_ponto: 'COCHO 1' } });
    const r = await req('PATCH', `/pontos-suplementacao/${ponto.id}`, A.token, {
      id: ponto.id, nome_ponto: 'COCHO NOVO', created_date: '2020-01-01T00:00:00.000Z', updated_date: '2020-01-01T00:00:00.000Z',
    });
    assert.equal(r.statusCode, 200, r.body);
    const depois = await prisma().pontoSuplementacao.findUnique({ where: { id: ponto.id } });
    assert.equal(depois.nome_ponto, 'COCHO NOVO');
    assert.equal(depois.createdAt.getTime(), ponto.createdAt.getTime(), 'createdAt não vem do corpo');
  });
});

describe('F2 — catálogo global não é gravável por tenant', () => {
  test('só Categorias de manejo editar: PATCH com catalogoCategoriaVisual.update → 400; catálogo intacto', async () => {
    const tipo = await prisma().catalogoTipoEntidade.create({ data: { codigo: `lote-${randomUUID().slice(0, 4)}`, nome: 'Lote' } });
    const cat = await prisma().catalogoCategoriaVisual.create({ data: { tipo_id: tipo.id, codigo: 'BOI', nome: 'Boi' } });
    const B = await contaCom({ modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-categorias-manejo', { editar: true })] });
    const cm = await prisma().categoriaManejo.create({ data: { cliente_id: B.cliente.id, empresa_id: 'e1', nome: 'Garrote' } });
    const r = await req('PATCH', `/categorias-manejo/${cm.id}`, B.token, {
      catalogoCategoriaVisual: { connect: { id: cat.id }, update: { nome: 'ALTERADO POR TENANT', ativo: false } },
    });
    recusado400(r, 'PATCH catálogo aninhado');
    const depois = await prisma().catalogoCategoriaVisual.findUnique({ where: { id: cat.id } });
    assert.equal(depois.nome, 'Boi');
    assert.equal(depois.ativo, true);
    assert.equal((await prisma().categoriaManejo.findUnique({ where: { id: cm.id } })).catalogo_categoria_visual_id, null);
  });

  test('POST com relação aninhada → 400 (não 500); nada criado', async () => {
    const B = await isAdminConcessao();
    const tipo = await prisma().catalogoTipoEntidade.create({ data: { codigo: `lote-${randomUUID().slice(0, 4)}`, nome: 'Lote' } });
    const r = await req('POST', '/categorias-manejo', B.token, {
      empresa_id: 'e1', nome: 'X', catalogoCategoriaVisual: { create: { tipo_id: tipo.id, codigo: 'NOVA', nome: 'Nova global' } },
    });
    recusado400(r, 'POST catálogo aninhado');
    assert.equal(await prisma().catalogoCategoriaVisual.count({ where: { codigo: 'NOVA' } }), 0);
    assert.equal(await prisma().categoriaManejo.count({ where: { cliente_id: B.cliente.id } }), 0);
  });
});

describe('F3 — relação `cliente` nunca vem do corpo', () => {
  test('is_admin: PATCH lote de nota com cliente.connect de OUTRO tenant → 400; registro fica no tenant', async () => {
    const C = await isAdminConcessao();
    const D = await criarTenant({ semPermissao: true });
    const nota = await prisma().estoqueLoteNota.create({ data: { cliente_id: C.cliente.id, empresa_id: 'e1', produto_id: 'p1', local_estoque_id: 'l1', custo_unitario: 1, quantidade_entrada: 10, quantidade_disponivel: 10 } });
    const r = await req('PATCH', `/estoque-lotes-nota/${nota.id}`, C.token, { cliente: { connect: { id: D.cliente.id } } });
    recusado400(r, 'PATCH cliente.connect');
    assert.equal((await prisma().estoqueLoteNota.findUnique({ where: { id: nota.id } })).cliente_id, C.cliente.id);
  });

  test('só Bebedouros editar: PATCH com cliente.update {ativo:false} → 400; fazenda ativa; login segue 200', async () => {
    const E = await contaCom({ modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-bebedouros', { editar: true })] });
    const beb = await prisma().bebedouro.create({ data: { cliente_id: E.cliente.id, empresa_id: 'e1', nome: 'B1', tipo: 'Cocho' } });
    const r = await req('PATCH', `/bebedouros/${beb.id}`, E.token, { cliente: { update: { nome: 'RENOMEADO', ativo: false } } });
    recusado400(r, 'PATCH cliente.update');
    const cli = await prisma().cliente.findUnique({ where: { id: E.cliente.id } });
    assert.equal(cli.ativo, true);
    assert.notEqual(cli.nome, 'RENOMEADO');
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: E.credenciais });
    assert.equal(login.statusCode, 200, login.body);
  });

  test('barreira global: `cliente` no corpo de QUALQUER rota (topo ou item de lista) → 400 antes da rota', async () => {
    const C = await isAdminConcessao();
    for (const [metodo, url, corpo] of [
      ['POST', '/lotes', { nome: 'L', cliente: { update: { ativo: false } } }],
      ['POST', '/setores', { nome: 'S', cliente: { connect: { id: 'x' } } }],
      ['POST', '/suplementacao-lotes/bulk', [{ empresa_id: 'e1', cliente: { update: { ativo: false } } }]],
      // schema aberto + documento JSON: antes gravava `cliente` dentro de `dados`
      ['POST', '/bebedouros-historico', { empresa_id: 'e1', tipo_registro: 'limpeza', cliente: { update: { ativo: false } } }],
      ['POST', '/pontos-suplementacao', { empresa_id: 'e1', nome_ponto: 'X', cliente: { update: { ativo: false } } }],
    ]) {
      const r = await req(metodo, url, C.token, corpo);
      recusado400(r, `${metodo} ${url}`);
    }
    assert.equal((await prisma().cliente.findUnique({ where: { id: C.cliente.id } })).ativo, true);
    assert.equal(await prisma().bebedouroHistorico.count({ where: { cliente_id: C.cliente.id } }), 0);
  });
});

describe('F5/F7 — lote de nota: saldo e custo só do admin real; nome conferido com o local', () => {
  const montar = async (conta) => {
    const local = await prisma().localEstoque.create({ data: { cliente_id: conta.cliente.id, numero_local: '1', nome: 'DEPOSITO NORTE' } });
    const nota = await prisma().estoqueLoteNota.create({
      data: { cliente_id: conta.cliente.id, empresa_id: 'e1', produto_id: 'p1', local_estoque_id: local.id, local_estoque_nome: 'DEPOSITO NORTE', custo_unitario: 1, quantidade_entrada: 10, quantidade_disponivel: 10 },
    });
    return { local, nota };
  };

  test('F5 is_admin (não admin real): PATCH quantidade/custo → 403 TENANT_ADMIN_REQUIRED; saldo intacto', async () => {
    const C = await isAdminConcessao();
    const { nota } = await montar(C);
    const r = await req('PATCH', `/estoque-lotes-nota/${nota.id}`, C.token, { quantidade_disponivel: 99999, custo_unitario: 0.01, quantidade_entrada: 99999 });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal(r.json().code, 'TENANT_ADMIN_REQUIRED');
    const d = await prisma().estoqueLoteNota.findUnique({ where: { id: nota.id } });
    assert.equal(Number(d.quantidade_disponivel), 10);
    assert.equal(Number(d.custo_unitario), 1);
  });

  test('F5 controle: admin real ajusta o saldo (estorno) → 200', async () => {
    const A = await adminReal();
    const { nota } = await montar(A);
    const r = await req('PATCH', `/estoque-lotes-nota/${nota.id}`, A.token, { quantidade_disponivel: 12, status: 'Disponivel' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(Number((await prisma().estoqueLoteNota.findUnique({ where: { id: nota.id } })).quantidade_disponivel), 12);
  });

  test('F7 Mapa Cadastro editar: nome inventado → 422 NOME_LOCAL_DIVERGENTE; nome do local (renomeado antes) → 200', async () => {
    const M = await contaCom({ modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-cadastro', { editar: true })] });
    const { local, nota } = await montar(M);
    const r1 = await req('PATCH', `/estoque-lotes-nota/${nota.id}`, M.token, { local_estoque_nome: 'NOME INVENTADO' });
    assert.equal(r1.statusCode, 422, r1.body); // contrato do código (errorCodes.js), o mesmo do MovimentacaoEstoque
    assert.equal(r1.json().code, 'NOME_LOCAL_DIVERGENTE');
    assert.equal((await prisma().estoqueLoteNota.findUnique({ where: { id: nota.id } })).local_estoque_nome, 'DEPOSITO NORTE');
    await prisma().localEstoque.update({ where: { id: local.id }, data: { nome: 'DEPOSITO SUL' } });
    const r2 = await req('PATCH', `/estoque-lotes-nota/${nota.id}`, M.token, { local_estoque_nome: 'DEPOSITO SUL' });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal((await prisma().estoqueLoteNota.findUnique({ where: { id: nota.id } })).local_estoque_nome, 'DEPOSITO SUL');
  });

  test('F5 Mapa Cadastro editar: quantidade junto com o nome → 403; nada gravado', async () => {
    const M = await contaCom({ modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-cadastro', { editar: true })] });
    const { nota } = await montar(M);
    const r = await req('PATCH', `/estoque-lotes-nota/${nota.id}`, M.token, { local_estoque_nome: 'DEPOSITO NORTE', quantidade_disponivel: 1 });
    assert.ok([403].includes(r.statusCode), r.body);
    assert.equal(Number((await prisma().estoqueLoteNota.findUnique({ where: { id: nota.id } })).quantidade_disponivel), 10);
  });
});

/**
 * Matriz: toda relação de todo model cujo service grava o corpo → 400 em POST e
 * PATCH, com acesso total (is_admin) e com admin real. O registro do PATCH não
 * muda; o POST não cria nada.
 */
describe('Matriz — relação de model nunca é gravável pelo corpo (derivada do schema Prisma)', () => {
  const ALVOS = [
    { modelo: 'PontoSuplementacao', url: '/pontos-suplementacao', criar: (c) => prisma().pontoSuplementacao.create({ data: { cliente_id: c, empresa_id: 'e1', numero_ponto: '1', nome_ponto: 'P' } }) },
    { modelo: 'Bebedouro', url: '/bebedouros', criar: (c) => prisma().bebedouro.create({ data: { cliente_id: c, empresa_id: 'e1', nome: 'B', tipo: 'Cocho' } }) },
    { modelo: 'CategoriaManejo', url: '/categorias-manejo', criar: (c) => prisma().categoriaManejo.create({ data: { cliente_id: c, empresa_id: 'e1', nome: 'C' } }) },
    { modelo: 'EstoqueLoteNota', url: '/estoque-lotes-nota', criar: (c) => prisma().estoqueLoteNota.create({ data: { cliente_id: c, empresa_id: 'e1', produto_id: 'p', local_estoque_id: 'l', custo_unitario: 1, quantidade_entrada: 1, quantidade_disponivel: 1 } }) },
    { modelo: 'Fornecedor', url: '/fornecedores', criar: (c) => prisma().fornecedor.create({ data: { cliente_id: c, empresa_id: 'e1', numero_cadastro: '1', tipo_pessoa: 'Física', nome: 'F' } }) },
    { modelo: 'Permissao', url: '/permissoes', criar: (c) => prisma().permissao.create({ data: { cliente_id: c, user_email: `x-${randomUUID().slice(0, 6)}`, user_nome: 'X' } }) },
    { modelo: 'MovimentacaoEstoque', url: '/movimentacoes-estoque', criar: null },
  ];

  for (const papel of ['is_admin', 'admin real']) {
    test(`${papel}: POST/PATCH com cada relação → 400; nada muda`, async () => {
      const conta = papel === 'is_admin' ? await isAdminConcessao() : await adminReal();
      const c = conta.cliente.id;
      for (const alvo of ALVOS) {
        const relacoes = relacoesDoModelo(alvo.modelo);
        assert.ok(relacoes.length > 0, `${alvo.modelo} tem relação`);
        const registro = alvo.criar ? await alvo.criar(c) : null;
        for (const rel of relacoes) {
          const corpo = { [rel]: { connect: { id: 'qualquer' } } };
          const contagemAntes = await prisma()[alvo.modelo[0].toLowerCase() + alvo.modelo.slice(1)].count({ where: { cliente_id: c } });
          const rPost = await req('POST', alvo.url, conta.token, { empresa_id: 'e1', ...corpo });
          assert.ok([400, 403].includes(rPost.statusCode), `POST ${alvo.url} ${rel}: ${rPost.statusCode} ${rPost.body}`);
          assert.notEqual(rPost.statusCode, 500);
          const contagemDepois = await prisma()[alvo.modelo[0].toLowerCase() + alvo.modelo.slice(1)].count({ where: { cliente_id: c } });
          assert.equal(contagemDepois, contagemAntes, `POST ${alvo.url} ${rel}: nada criado`);
          if (registro) {
            const rPatch = await req('PATCH', `${alvo.url}/${registro.id}`, conta.token, corpo);
            assert.ok([400, 403].includes(rPatch.statusCode), `PATCH ${alvo.url} ${rel}: ${rPatch.statusCode} ${rPatch.body}`);
            const depois = await prisma()[alvo.modelo[0].toLowerCase() + alvo.modelo.slice(1)].findUnique({ where: { id: registro.id } });
            assert.equal(depois.updatedAt.getTime(), registro.updatedAt.getTime(), `PATCH ${alvo.url} ${rel}: registro intacto`);
          }
        }
      }
      assert.equal((await prisma().cliente.findUnique({ where: { id: c } })).ativo, true);
    });
  }
});
