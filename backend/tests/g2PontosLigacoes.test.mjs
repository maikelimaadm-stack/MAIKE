/**
 * Frente G2 — cocho/depósito, bebedouro e ponto de referência, PostgreSQL real.
 *
 *  N1  `numero_ponto` do cocho/depósito é do servidor: sem número → sequência do
 *      tenant; número que colide (o navegador calculava e repetia) → o servidor
 *      reserva o próximo livre, em vez de 500 e de deixar o ponto órfão.
 *  H1  DELETE do cocho com leitura → recusado, nada apagado (a FK levaria as
 *      leituras em cascata); a elegibilidade diz o motivo.
 *  H2  DELETE do depósito com movimentação de estoque no local → recusado.
 *  D1  DELETE do depósito sem histórico → cochos desvinculados e o LocalEstoque
 *      INATIVADO (nunca apagado: D-PROD-137, DELETE de local só pela tela
 *      Locais), na mesma transação.
 *  L1  POST do depósito novo com `local_estoque` → o local nasce na mesma
 *      transação; se o depósito falhar, nenhum local fica órfão.
 *  B1  DELETE do bebedouro com histórico/sanidade → recusado; sem → sai.
 *  R1  DELETE do ponto de referência leva junto o bebedouro ligado (sem
 *      histórico); ATIVO com histórico, nada sai; INATIVO com histórico (o
 *      ponto deixou de ser bebedouro) não trava: fica inativo, desligado do ponto.
 *  U1  DELETE do ponto por quem só tem Mapa Cadastro "novo": só desfaz a própria
 *      criação recente e intocada (compensação do formulário); o resto é 403.
 *  R2  PATCH `{ nome }` do ponto do depósito por quem só tem Locais "editar"
 *      (rename do local propagado) → aceito; em ponto que não é do depósito → 403.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { gerarSenhaHash } from '../src/modules/auth/authService.js';

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

const conta = async (opcoes = {}, permissao = null) => {
  const c = await criarTenant({ ...(permissao ? { semPermissao: true } : {}), ...opcoes });
  if (permissao) {
    await prisma().permissao.create({ data: { cliente_id: c.cliente.id, user_email: c.credenciais.login, user_nome: 'Op', ...permissao } });
  }
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  assert.ok(corpo.token, 'login');
  const empresa = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  return { ...c, token: corpo.token, empresa };
};

const AQUI = { lat: -15.1, lng: -56.1 };
const ALI = { lat: -15.2, lng: -56.2 };

const criarSupl = (c, dados) =>
  prisma().pontoSuplementacao.create({
    data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', coordenadas: AQUI, ...dados },
  });
const criarLocal = (c, dados = {}) =>
  prisma().localEstoque.create({ data: { cliente_id: c.cliente.id, numero_local: '1', nome: 'DEP 1', ...dados } });

describe('G2 — numero_ponto do cocho/depósito no servidor', () => {
  test('N1 — sem número: sequência; número em uso: o próximo livre (sem 500)', async () => {
    const c = await conta();
    // Legado: número que a sequência vai emitir já existe (o navegador gravava max+1).
    await criarSupl(c, { numero_ponto: '1', nome_ponto: 'LEGADO' });

    const a = await req('POST', '/pontos-suplementacao', c.token, { empresa_id: c.empresa.id, nome_ponto: 'COCHO A', categoria_ponto: 'COCHO' });
    assert.equal(a.statusCode, 201, a.body);
    const b = await req('POST', '/pontos-suplementacao', c.token, { empresa_id: c.empresa.id, nome_ponto: 'COCHO B', categoria_ponto: 'COCHO', numero_ponto: '1' });
    assert.equal(b.statusCode, 201, b.body);
    const numeros = [a.json().numero_ponto, b.json().numero_ponto, '1'];
    assert.equal(new Set(numeros).size, 3, `números repetidos: ${numeros}`);
    assert.ok(a.json().numero_ponto && b.json().numero_ponto);
  });

  test('N1b — número informado e livre é mantido', async () => {
    const c = await conta();
    const r = await req('POST', '/pontos-suplementacao', c.token, { empresa_id: c.empresa.id, nome_ponto: 'X', categoria_ponto: 'COCHO', numero_ponto: 'COCHO-0007' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().numero_ponto, 'COCHO-0007');
  });
});

describe('G2 — exclusão do cocho/depósito com histórico', () => {
  test('H1 — cocho com leitura: recusado, cocho e leitura continuam; elegibilidade diz por quê', async () => {
    const c = await conta();
    const cocho = await criarSupl(c, { numero_ponto: '10' });
    await prisma().leituraCocho.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, ponto_suplementacao_id: cocho.id, data_leitura: new Date('2026-10-01'), escore: 'ADEQUADO', acesso: 'BOM', estrutura: 'BOA' },
    });

    const eleg = await req('GET', `/pontos-suplementacao/${cocho.id}/elegibilidade-exclusao`, c.token);
    assert.equal(eleg.statusCode, 200, eleg.body);
    assert.deepEqual(eleg.json(), { id: cocho.id, pode_excluir: false, motivos: ['leituras_cocho'] });

    const r = await req('DELETE', `/pontos-suplementacao/${cocho.id}`, c.token);
    assert.notEqual(r.statusCode, 204);
    assert.equal(r.json().code, 'PONTO_SUPLEMENTACAO_COM_HISTORICO');
    assert.ok(await prisma().pontoSuplementacao.findUnique({ where: { id: cocho.id } }), 'cocho continua');
    assert.equal(await prisma().leituraCocho.count({ where: { ponto_suplementacao_id: cocho.id } }), 1, 'leitura continua');
  });

  test('H1b — lançamento de suplementação (dados.ponto_suplementacao_id) também segura', async () => {
    const c = await conta();
    const cocho = await criarSupl(c, { numero_ponto: '11' });
    await prisma().suplementacaoEvento.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { ponto_suplementacao_id: cocho.id } } });
    const eleg = await req('GET', `/pontos-suplementacao/${cocho.id}/elegibilidade-exclusao`, c.token);
    assert.deepEqual(eleg.json().motivos, ['lancamentos_suplementacao']);
    assert.notEqual((await req('DELETE', `/pontos-suplementacao/${cocho.id}`, c.token)).statusCode, 204);
  });

  test('H2 — depósito com movimentação de estoque no local: recusado', async () => {
    const c = await conta();
    const local = await criarLocal(c);
    const dep = await criarSupl(c, { numero_ponto: '20', nome_ponto: 'DEP 1', categoria_ponto: 'DEPOSITO', local_estoque_id: local.id, local_estoque_nome: local.nome });
    await prisma().movimentacaoEstoque.create({
      data: {
        cliente_id: c.cliente.id, empresa_id: c.empresa.id, numero_movimentacao: 'M1', tipo_movimentacao: 'Entrada',
        data_movimentacao: new Date(), produto_id: 'p', quantidade: '10', unidade_medida: 'KG', local_estoque_destino: local.id,
      },
    });
    const r = await req('DELETE', `/pontos-suplementacao/${dep.id}`, c.token);
    assert.equal(r.json().code, 'PONTO_SUPLEMENTACAO_COM_HISTORICO');
    assert.deepEqual(r.json().details?.motivos ?? (await req('GET', `/pontos-suplementacao/${dep.id}/elegibilidade-exclusao`, c.token)).json().motivos, ['movimentacoes_estoque']);
    assert.ok(await prisma().localEstoque.findUnique({ where: { id: local.id } }));
  });
});

describe('G2 — exclusão do depósito sem histórico', () => {
  test('D1 — cochos desvinculados e local INATIVADO (não apagado) na mesma transação', async () => {
    const c = await conta();
    const local = await criarLocal(c);
    const dep = await criarSupl(c, { numero_ponto: '30', nome_ponto: 'DEP 1', categoria_ponto: 'DEPOSITO', local_estoque_id: local.id, local_estoque_nome: local.nome });
    const cocho = await criarSupl(c, { numero_ponto: '31', deposito_origem_id: dep.id, deposito_origem_nome: 'DEP 1' });

    const r = await req('DELETE', `/pontos-suplementacao/${dep.id}`, c.token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(await prisma().pontoSuplementacao.findUnique({ where: { id: dep.id } }), null);
    const c2 = await prisma().pontoSuplementacao.findUnique({ where: { id: cocho.id } });
    assert.equal(c2.deposito_origem_id, null);
    assert.equal(c2.deposito_origem_nome, null);
    const l = await prisma().localEstoque.findUnique({ where: { id: local.id } });
    assert.ok(l, 'D-PROD-137: o local não é apagado pela cascata do mapa');
    assert.equal(l.ativo, false, 'local inativado');
  });

  test('D1b — produto que cita o local pelo nome: o local é inativado, não apagado', async () => {
    const c = await conta();
    const local = await criarLocal(c);
    await prisma().produto.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, numero_produto: '1', nome_produto: 'SAL', local_estoque: 'DEP 1' } });
    const dep = await criarSupl(c, { numero_ponto: '40', nome_ponto: 'DEP 1', categoria_ponto: 'DEPOSITO', local_estoque_id: local.id });
    assert.equal((await req('DELETE', `/pontos-suplementacao/${dep.id}`, c.token)).statusCode, 204);
    const l = await prisma().localEstoque.findUnique({ where: { id: local.id } });
    assert.ok(l, 'local continua');
    assert.equal(l.ativo, false);
  });
});

describe('G2 — depósito novo com o local na mesma transação', () => {
  test('L1 — local criado e ligado; falha do depósito não deixa local órfão', async () => {
    const c = await conta();
    const r = await req('POST', '/pontos-suplementacao', c.token, {
      empresa_id: c.empresa.id, nome_ponto: 'DEP NOVO', categoria_ponto: 'DEPOSITO',
      local_estoque: { nome: 'DEP NOVO', descricao: 'DEPÓSITO DE SUPLEMENTAÇÃO - DEP NOVO' },
    });
    assert.equal(r.statusCode, 201, r.body);
    const dep = r.json();
    assert.ok(dep.local_estoque_id, 'depósito ligado ao local');
    assert.equal(dep.local_estoque_nome, 'DEP NOVO');
    const local = await prisma().localEstoque.findUnique({ where: { id: dep.local_estoque_id } });
    assert.equal(local.nome, 'DEP NOVO');
    assert.equal(local.cliente_id, c.cliente.id);
    assert.ok(local.numero_local);

    const antes = await prisma().localEstoque.count({ where: { cliente_id: c.cliente.id } });
    const falha = await req('POST', '/pontos-suplementacao', c.token, {
      empresa_id: c.empresa.id, nome_ponto: 'DEP RUIM', categoria_ponto: 'DEPOSITO', capacidade_cocho_kg: 'não é número',
      local_estoque: { nome: 'DEP RUIM' },
    });
    assert.notEqual(falha.statusCode, 201);
    assert.equal(await prisma().localEstoque.count({ where: { cliente_id: c.cliente.id } }), antes, 'nenhum local órfão');
  });

  test('L2 — local_estoque só acompanha DEPÓSITO novo: num cocho é 400 e nada é gravado', async () => {
    const c = await conta();
    const r = await req('POST', '/pontos-suplementacao', c.token, {
      empresa_id: c.empresa.id, nome_ponto: 'COCHO X', categoria_ponto: 'COCHO', local_estoque: { nome: 'X' },
    });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(await prisma().localEstoque.count({ where: { cliente_id: c.cliente.id } }), 0);
    assert.equal(await prisma().pontoSuplementacao.count({ where: { cliente_id: c.cliente.id } }), 0);
  });
});

describe('G2 — bebedouro', () => {
  const criarBeb = (c, dados = {}) =>
    prisma().bebedouro.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome: 'BEB', tipo: 'Australiano', ...dados } });

  test('B1 — com histórico ou sanidade: recusado; sem: sai', async () => {
    const c = await conta();
    const comHist = await criarBeb(c);
    await prisma().bebedouroHistorico.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { bebedouro_id: comHist.id } } });
    const comSan = await criarBeb(c);
    await prisma().bebedouroSanidade.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { bebedouro_id: comSan.id } } });
    const livre = await criarBeb(c);

    assert.deepEqual((await req('GET', `/bebedouros/${comHist.id}/elegibilidade-exclusao`, c.token)).json().motivos, ['historico']);
    assert.equal((await req('DELETE', `/bebedouros/${comHist.id}`, c.token)).json().code, 'BEBEDOURO_COM_HISTORICO');
    assert.equal((await req('DELETE', `/bebedouros/${comSan.id}`, c.token)).json().code, 'BEBEDOURO_COM_HISTORICO');
    assert.ok(await prisma().bebedouro.findUnique({ where: { id: comHist.id } }));
    assert.equal((await req('DELETE', `/bebedouros/${livre.id}`, c.token)).statusCode, 204);
  });

  test('R1 — excluir o ponto leva o bebedouro ligado; com histórico nada sai', async () => {
    const c = await conta();
    const criarPonto = async (nome) => (await req('POST', '/pontos-referencia', c.token, { empresa_id: c.empresa.id, nome, tipo: 'BEBEDOURO', coordenadas: AQUI })).json();
    const p1 = await criarPonto('BEB 1');
    const b1 = await criarBeb(c, { ponto_referencia_id: p1.id });
    const r1 = await req('DELETE', `/pontos-referencia/${p1.id}`, c.token);
    assert.equal(r1.statusCode, 200, r1.body);
    assert.equal(await prisma().bebedouro.findUnique({ where: { id: b1.id } }), null, 'bebedouro saiu junto');

    const p2 = await criarPonto('BEB 2');
    const b2 = await criarBeb(c, { ponto_referencia_id: p2.id });
    await prisma().bebedouroHistorico.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { bebedouro_id: b2.id } } });
    const r2 = await req('DELETE', `/pontos-referencia/${p2.id}`, c.token);
    assert.equal(r2.json().code, 'BEBEDOURO_COM_HISTORICO');
    assert.ok(await prisma().pontoReferencia.findUnique({ where: { id: p2.id } }), 'ponto continua');
    assert.ok(await prisma().bebedouro.findUnique({ where: { id: b2.id } }), 'bebedouro continua');
  });

  test('R1c — ponto que deixou de ser bebedouro (bebedouro inativo com histórico) pode ser excluído', async () => {
    const c = await conta();
    const p = (await req('POST', '/pontos-referencia', c.token, { empresa_id: c.empresa.id, nome: 'BEB 01', tipo: 'PORTEIRA', coordenadas: AQUI })).json();
    const b = await criarBeb(c, { ponto_referencia_id: p.id, ativo: false, status: 'Inativo', pasto_id: 'area-a' });
    await prisma().bebedouroHistorico.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { bebedouro_id: b.id } } });

    const r = await req('DELETE', `/pontos-referencia/${p.id}`, c.token);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await prisma().pontoReferencia.findUnique({ where: { id: p.id } }), null, 'ponto saiu');
    const depois = await prisma().bebedouro.findUnique({ where: { id: b.id } });
    assert.ok(depois, 'bebedouro com histórico continua');
    assert.equal(depois.ativo, false);
    assert.equal(depois.ponto_referencia_id, null, 'desligado do ponto apagado');
    assert.equal(await prisma().bebedouroHistorico.count({ where: { cliente_id: c.cliente.id } }), 1, 'histórico preservado');
  });

  test('S1 — recusas por histórico usam código próprio (409 quando o código estiver declarado)', async () => {
    const c = await conta();
    const b = await criarBeb(c);
    await prisma().bebedouroHistorico.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { bebedouro_id: b.id } } });
    const r = await req('DELETE', `/bebedouros/${b.id}`, c.token);
    assert.equal(r.json().code, 'BEBEDOURO_COM_HISTORICO');
    assert.notEqual(r.statusCode, 204);
  });

  test(
    'S1b — status 409/404 dos códigos novos',
    { todo: 'depende de declarar PONTO_SUPLEMENTACAO_COM_HISTORICO, BEBEDOURO_COM_HISTORICO e PONTO_SUPLEMENTACAO_NOT_FOUND em backend/src/shared/errors/errorCodes.js (fora da frente G2)' },
    async () => {
      const c = await conta();
      const b = await criarBeb(c);
      await prisma().bebedouroHistorico.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { bebedouro_id: b.id } } });
      assert.equal((await req('DELETE', `/bebedouros/${b.id}`, c.token)).statusCode, 409);
      const cocho = await criarSupl(c, { numero_ponto: '90' });
      await prisma().suplementacaoEvento.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { ponto_suplementacao_id: cocho.id } } });
      assert.equal((await req('DELETE', `/pontos-suplementacao/${cocho.id}`, c.token)).statusCode, 409);
      assert.equal((await req('GET', '/pontos-suplementacao/nao-existe/elegibilidade-exclusao', c.token)).statusCode, 404);
    }
  );
});

describe('G2 — desfazer a criação do ponto sem a permissão de excluir', () => {
  const linhaMapaCadastro = { modulo_id: 'mapa', tela_id: 'pec-mapa-cadastro', visualizar: true, novo: true, salvar: false, editar: false, excluir: false, importar: false, exportar: false };

  test('U1 — só a própria criação recente e intocada', async () => {
    const admin = await conta();
    const login = `novo-${Date.now()}`;
    await prisma().usuario.create({ data: { cliente_id: admin.cliente.id, nome: 'Op Novo', login, senha_hash: await gerarSenhaHash('senha-de-teste-1'), papel_tenant: 'usuario' } });
    await prisma().permissao.create({ data: { cliente_id: admin.cliente.id, user_email: login, user_nome: 'Op', modulos_permitidos: ['mapa'], permissoes_telas: [linhaMapaCadastro] } });
    const { corpo } = await autenticarNoApp(app, { login, senha: 'senha-de-teste-1' });
    assert.ok(corpo.token, 'login novo');
    const criar = async (token, nome) => {
      const r = await req('POST', '/pontos-referencia', token, { empresa_id: admin.empresa.id, nome, tipo: 'BEBEDOURO', coordenadas: AQUI });
      assert.equal(r.statusCode, 201, r.body);
      return r.json();
    };

    const meu = await criar(corpo.token, 'MEU');
    const r = await req('DELETE', `/pontos-referencia/${meu.id}`, corpo.token);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await prisma().pontoReferencia.findUnique({ where: { id: meu.id } }), null);

    const doAdmin = await criar(admin.token, 'DO ADMIN');
    assert.equal((await req('DELETE', `/pontos-referencia/${doAdmin.id}`, corpo.token)).statusCode, 403, 'ponto de outro usuário');

    const alterado = await criar(corpo.token, 'ALTERADO');
    assert.equal((await req('PATCH', `/pontos-referencia/${alterado.id}`, admin.token, { nome: 'ALTERADO 2' })).statusCode, 200);
    assert.equal((await req('DELETE', `/pontos-referencia/${alterado.id}`, corpo.token)).statusCode, 403, 'ponto já alterado');

    const antigo = await criar(corpo.token, 'ANTIGO');
    await prisma().auditLog.updateMany({
      where: { entidade: 'PontoReferencia', entidade_id: antigo.id },
      data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    assert.equal((await req('DELETE', `/pontos-referencia/${antigo.id}`, corpo.token)).statusCode, 403, 'fora da janela de 15 min');
    assert.ok(await prisma().pontoReferencia.findUnique({ where: { id: antigo.id } }));
  });
});

describe('G2 — rename do depósito por quem só tem Locais', () => {
  const linhaLocais = { modulo_id: 'suporte-mapa', tela_id: 'sup-locais', visualizar: true, novo: false, salvar: false, editar: true, excluir: false, importar: false, exportar: false };

  test('R2 — PATCH { nome } no ponto do depósito: aceito; em outro ponto: 403', async () => {
    const admin = await conta();
    const pontoDep = (await req('POST', '/pontos-referencia', admin.token, { empresa_id: admin.empresa.id, nome: 'DEP 1', tipo: 'DEPÓSITO', coordenadas: AQUI })).json();
    const outro = (await req('POST', '/pontos-referencia', admin.token, { empresa_id: admin.empresa.id, nome: 'PORTEIRA', tipo: 'PORTEIRA', coordenadas: ALI })).json();
    const local = await criarLocal(admin);
    await criarSupl(admin, { numero_ponto: '50', nome_ponto: 'DEP 1', categoria_ponto: 'DEPOSITO', local_estoque_id: local.id, coordenadas: AQUI });

    // Mesmo tenant, outro usuário só com Locais "editar".
    const login = `locais-${Date.now()}`;
    await prisma().usuario.create({ data: { cliente_id: admin.cliente.id, nome: 'Op Locais', login, senha_hash: await gerarSenhaHash('senha-de-teste-1'), papel_tenant: 'usuario' } });
    await prisma().permissao.create({ data: { cliente_id: admin.cliente.id, user_email: login, user_nome: 'Op', modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linhaLocais] } });
    const { corpo } = await autenticarNoApp(app, { login, senha: 'senha-de-teste-1' });
    assert.ok(corpo.token, 'login locais');

    const ok = await req('PATCH', `/pontos-referencia/${pontoDep.id}`, corpo.token, { nome: 'DEP CENTRAL' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().nome, 'DEP CENTRAL');

    assert.equal((await req('PATCH', `/pontos-referencia/${outro.id}`, corpo.token, { nome: 'X' })).statusCode, 403);
    assert.equal((await req('PATCH', `/pontos-referencia/${pontoDep.id}`, corpo.token, { nome: 'Y', tipo: 'PORTEIRA' })).statusCode, 403);
  });
});
