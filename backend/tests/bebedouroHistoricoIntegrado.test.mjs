/**
 * Missão integrada (D-PROD-136), frente M4a — histórico do bebedouro, PostgreSQL real.
 *
 *  BEB-03  POST sem `bebedouro_id` (ponto BEBEDOURO sem cadastro) gravava um
 *          histórico ÓRFÃO, que nunca aparece em tela nenhuma, e devolvia 201.
 *          Contrato: `bebedouro_id` obrigatório e de um Bebedouro do MESMO
 *          tenant (do auth_context) e da MESMA empresa do documento — 400/404,
 *          nada gravado.
 *  BEB-02  DELETE apagava QUALQUER lançamento (inclusive antigos), enquanto a
 *          interface só oferece excluir o mais recente; e aceitava a ação
 *          genérica "excluir" do Mapa Geral. Contrato: só o lançamento mais
 *          recente DAQUELE bebedouro (mesma ordem da listagem: createdAt desc,
 *          id desc) e só com Bebedouros "excluir" (ou acesso total) — 409/403,
 *          nada apagado.
 *
 * Prova por persistência (linhas + AuditLog), com controles positivos do fluxo
 * legítimo da interface e paridade com a regra que o navegador usa para mostrar
 * os botões (`src/lib/bebedouroPermissions.js`).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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
const linha = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), visualizar: true, ...a });

/** Conta do tenant com a linha de Permissão dada (sem a concessão is_admin padrão). */
const contaCom = async (permissao, opcoes = {}) => {
  const c = await criarTenant({ semPermissao: true, ...opcoes });
  if (permissao) {
    await prisma().permissao.create({ data: { cliente_id: c.cliente.id, user_email: c.credenciais.login, user_nome: 'Op', ...permissao } });
  }
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  assert.ok(corpo.token, 'login');
  const empresa = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  return { ...c, token: corpo.token, empresa };
};
const adminReal = () => contaCom({ is_admin: false }, { papelTenant: 'administrador' });

const criarBebedouro = (c, dados = {}) =>
  prisma().bebedouro.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome: 'BEBEDOURO NORTE', tipo: 'Cocho', ...dados } });

/** Lançamento gravado direto no banco, com instante controlado (ordem determinística). */
const semear = (c, bebedouroId, instante, extra = {}) =>
  prisma().bebedouroHistorico.create({
    data: {
      cliente_id: c.cliente.id,
      empresa_id: c.empresa.id,
      dados: { ...(bebedouroId ? { bebedouro_id: bebedouroId } : {}), tipo_lancamento: 'Inspeção', status: 'Concluído' },
      createdAt: new Date(instante),
      ...extra,
    },
  });

const historicos = (c) => prisma().bebedouroHistorico.findMany({ where: { cliente_id: c.cliente.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const auditorias = (c, acao) => prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'BebedouroHistorico', acao } });

/** Corpo que o formulário real (FormularioLancamentoBebedouro) envia. */
const corpoDaTela = (c, bebedouroId, extra = {}) => ({
  empresa_id: c.empresa.id,
  ...(bebedouroId !== undefined ? { bebedouro_id: bebedouroId } : {}),
  bebedouro_nome: 'NOME QUE O CLIENTE MANDOU',
  data_lancamento: '2027-06-15',
  hora_lancamento: '10:00',
  tipo_lancamento: 'Inspeção',
  status: 'Concluído',
  descricao: '',
  ...extra,
});

describe('BEB-03 — POST exige bebedouro_id de um Bebedouro existente no tenant e na empresa', () => {
  test('sem bebedouro_id (ponto sem cadastro) → 400, nada gravado (antes: 201 e histórico órfão)', async () => {
    const c = await adminReal();
    const r = await req('POST', '/bebedouros-historico', c.token, corpoDaTela(c, undefined));
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(r.json().field, 'bebedouro_id');
    assert.equal((await historicos(c)).length, 0);
    assert.equal(await auditorias(c, 'create'), 0);
  });

  test('bebedouro_id vazio, só espaços ou não-texto → 400, nada gravado', async () => {
    const c = await adminReal();
    for (const valor of ['', '   ', 123, null, { id: 'x' }]) {
      const r = await req('POST', '/bebedouros-historico', c.token, corpoDaTela(c, valor));
      assert.equal(r.statusCode, 400, `${JSON.stringify(valor)}: ${r.body}`);
      assert.equal(r.json().field, 'bebedouro_id');
    }
    assert.equal((await historicos(c)).length, 0);
  });

  test('bebedouro_id inexistente, de OUTRO tenant ou de OUTRA empresa → 404 BEBEDOURO_NOT_FOUND, nada gravado', async () => {
    const c = await adminReal();
    const outro = await adminReal();
    const doOutroTenant = await criarBebedouro(outro);
    const outraEmpresa = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'F2', nome: 'Fazenda 2' } });
    const daOutraEmpresa = await criarBebedouro(c, { empresa_id: outraEmpresa.id, nome: 'DA OUTRA EMPRESA' });
    for (const [rotulo, id] of [['inexistente', 'beb-inexistente'], ['outro tenant', doOutroTenant.id], ['outra empresa', daOutraEmpresa.id]]) {
      const r = await req('POST', '/bebedouros-historico', c.token, corpoDaTela(c, id));
      assert.equal(r.statusCode, 404, `${rotulo}: ${r.body}`);
      assert.equal(r.json().code, 'BEBEDOURO_NOT_FOUND', rotulo);
    }
    assert.equal((await historicos(c)).length, 0);
    assert.equal((await historicos(outro)).length, 0);
    assert.equal(await auditorias(c, 'create'), 0);
  });

  test('controle positivo: o corpo da tela com bebedouro do tenant → 201, ligado ao bebedouro; nome vem do cadastro', async () => {
    const c = await adminReal();
    const beb = await criarBebedouro(c);
    const r = await req('POST', '/bebedouros-historico', c.token, corpoDaTela(c, beb.id));
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().bebedouro_id, beb.id);
    const [gravado] = await historicos(c);
    assert.equal(gravado.dados.bebedouro_id, beb.id);
    assert.equal(gravado.dados.bebedouro_nome, 'BEBEDOURO NORTE', 'o nome gravado é o do cadastro, não o do corpo');
    assert.equal(gravado.empresa_id, c.empresa.id);
    assert.equal(await auditorias(c, 'create'), 1);
    // A listagem que a tela usa (filtra por bebedouro_id) encontra o lançamento.
    const lista = (await req('GET', '/bebedouros-historico', c.token)).json();
    assert.deepEqual(lista.filter((h) => h.bebedouro_id === beb.id).map((h) => h.id), [gravado.id]);
  });

  test('controle positivo: cada concessão que o servidor aceita para lançar continua gravando', async () => {
    for (const [rotulo, perm] of [
      ['Bebedouros novo', { modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-bebedouros', { novo: true })] }],
      ['Bebedouros salvar', { modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-bebedouros', { salvar: true })] }],
      ['Mapa Geral salvar (contrato aceito, §9.4-2)', { modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-geral', { salvar: true })] }],
      ['acesso total (is_admin)', { is_admin: true }],
    ]) {
      const c = await contaCom(perm);
      const beb = await criarBebedouro(c);
      const r = await req('POST', '/bebedouros-historico', c.token, corpoDaTela(c, beb.id));
      assert.equal(r.statusCode, 201, `${rotulo}: ${r.body}`);
      assert.equal((await historicos(c)).length, 1, rotulo);
    }
  });
});

describe('BEB-02 — DELETE só do lançamento mais recente daquele bebedouro, com Bebedouros "excluir"', () => {
  test('três lançamentos: o antigo e o do meio → 409, nada apagado; o mais recente → 204; depois o novo mais recente → 204', async () => {
    const c = await adminReal();
    const beb = await criarBebedouro(c);
    const antigo = await semear(c, beb.id, '2027-06-01T10:00:00.000Z');
    const meio = await semear(c, beb.id, '2027-06-02T10:00:00.000Z');
    const recente = await semear(c, beb.id, '2027-06-03T10:00:00.000Z');

    for (const [rotulo, alvo] of [['antigo', antigo], ['meio', meio]]) {
      const r = await req('DELETE', `/bebedouros-historico/${alvo.id}`, c.token);
      assert.equal(r.statusCode, 409, `${rotulo}: ${r.body}`);
      assert.equal(r.json().code, 'BEBEDOUROHISTORICO_SOMENTE_ULTIMO', rotulo);
    }
    assert.deepEqual((await historicos(c)).map((h) => h.id), [antigo.id, meio.id, recente.id], 'nada apagado');
    assert.equal(await auditorias(c, 'delete'), 0, 'nenhuma auditoria de exclusão');

    const ok = await req('DELETE', `/bebedouros-historico/${recente.id}`, c.token);
    assert.equal(ok.statusCode, 204, ok.body);
    assert.deepEqual((await historicos(c)).map((h) => h.id), [antigo.id, meio.id]);
    assert.equal(await auditorias(c, 'delete'), 1);

    // Ainda há um mais recente que o antigo (o do meio): continua recusado.
    assert.equal((await req('DELETE', `/bebedouros-historico/${antigo.id}`, c.token)).statusCode, 409);
    assert.equal((await req('DELETE', `/bebedouros-historico/${meio.id}`, c.token)).statusCode, 204);
    assert.deepEqual((await historicos(c)).map((h) => h.id), [antigo.id]);
  });

  test('a ordem é a da listagem (índice 0 da tela): mesmo instante desempata por id; só o primeiro da lista é excluível', async () => {
    const c = await adminReal();
    const beb = await criarBebedouro(c);
    const mesmo = '2027-06-05T10:00:00.000Z';
    await semear(c, beb.id, mesmo, { id: 'hist-a' });
    await semear(c, beb.id, mesmo, { id: 'hist-c' });
    await semear(c, beb.id, mesmo, { id: 'hist-b' });
    const lista = (await req('GET', '/bebedouros-historico', c.token)).json().filter((h) => h.bebedouro_id === beb.id);
    assert.equal(lista[0].id, 'hist-c', 'createdAt desc, id desc');
    for (const h of lista.slice(1)) {
      assert.equal((await req('DELETE', `/bebedouros-historico/${h.id}`, c.token)).statusCode, 409, h.id);
    }
    assert.equal((await req('DELETE', `/bebedouros-historico/${lista[0].id}`, c.token)).statusCode, 204);
  });

  test('lançamento mais novo de OUTRO bebedouro não bloqueia: cada bebedouro tem a sua linha do tempo', async () => {
    const c = await adminReal();
    const b1 = await criarBebedouro(c, { nome: 'B1' });
    const b2 = await criarBebedouro(c, { nome: 'B2' });
    const doB1 = await semear(c, b1.id, '2027-06-01T10:00:00.000Z');
    await semear(c, b2.id, '2027-06-09T10:00:00.000Z');
    const r = await req('DELETE', `/bebedouros-historico/${doB1.id}`, c.token);
    assert.equal(r.statusCode, 204, r.body);
  });

  test('lançamento de OUTRO tenant não conta nem é alcançável (404)', async () => {
    const c = await adminReal();
    const outro = await adminReal();
    const beb = await criarBebedouro(c);
    const meu = await semear(c, beb.id, '2027-06-01T10:00:00.000Z');
    // Mesmo bebedouro_id (forjado) mais novo noutro tenant: não bloqueia o meu.
    await semear(outro, beb.id, '2027-06-09T10:00:00.000Z');
    const alheio = (await historicos(outro))[0];
    assert.equal((await req('DELETE', `/bebedouros-historico/${alheio.id}`, c.token)).statusCode, 404);
    assert.equal((await historicos(outro)).length, 1);
    assert.equal((await req('DELETE', `/bebedouros-historico/${meu.id}`, c.token)).statusCode, 204);
  });

  test('só Mapa Geral "excluir" (ação genérica de outra tela) → 403, nada apagado (antes: 204)', async () => {
    const c = await contaCom({ modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-geral', { excluir: true })], mapa_geral_permissoes: { mover_lotes: true } });
    const beb = await criarBebedouro(c);
    const recente = await semear(c, beb.id, '2027-06-03T10:00:00.000Z');
    const r = await req('DELETE', `/bebedouros-historico/${recente.id}`, c.token);
    assert.equal(r.statusCode, 403, r.body);
    assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA');
    assert.equal((await historicos(c)).length, 1);
    assert.equal(await auditorias(c, 'delete'), 0);
  });

  test('controle positivo: Bebedouros "excluir" (sem acesso total) apaga o mais recente → 204, auditado', async () => {
    const c = await contaCom({ modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-bebedouros', { excluir: true })] });
    const beb = await criarBebedouro(c);
    await semear(c, beb.id, '2027-06-01T10:00:00.000Z');
    const recente = await semear(c, beb.id, '2027-06-03T10:00:00.000Z');
    const r = await req('DELETE', `/bebedouros-historico/${recente.id}`, c.token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal((await historicos(c)).length, 1);
    assert.equal(await auditorias(c, 'delete'), 1);
  });

  test('lançamento órfão legado (sem bebedouro_id) não pertence a linha do tempo nenhuma: pode ser limpo', async () => {
    const c = await adminReal();
    const orfao = await semear(c, null, '2027-06-01T10:00:00.000Z');
    await semear(c, null, '2027-06-02T10:00:00.000Z');
    const r = await req('DELETE', `/bebedouros-historico/${orfao.id}`, c.token);
    assert.equal(r.statusCode, 204, r.body);
  });

  test('id inexistente → 404 BEBEDOUROHISTORICO_NOT_FOUND (antes: código fora do catálogo → 500)', async () => {
    const c = await adminReal();
    const r = await req('DELETE', '/bebedouros-historico/nao-existe', c.token);
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().code, 'BEBEDOUROHISTORICO_NOT_FOUND');
  });
});

describe('BEB-01/BEB-04 — a regra que o navegador usa para mostrar "Lançar"/"Excluir" é a do servidor', () => {
  test('matriz de concessões: 201/204 exatamente quando o helper da interface libera o botão', async () => {
    const ui = await import('../../src/lib/bebedouroPermissions.js');
    const matriz = [
      ['só ver o mapa (+mover lotes)', { modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-geral', {})], mapa_geral_permissoes: { mover_lotes: true } }],
      ['Mapa Geral salvar', { modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-geral', { salvar: true })] }],
      ['Mapa Geral excluir', { modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-geral', { excluir: true })] }],
      ['Mapa Geral novo/editar', { modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-geral', { novo: true, editar: true })] }],
      ['Bebedouros novo', { modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-bebedouros', { novo: true })] }],
      ['Bebedouros salvar', { modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-bebedouros', { salvar: true })] }],
      ['Bebedouros editar', { modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-bebedouros', { editar: true })] }],
      ['Bebedouros excluir', { modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-bebedouros', { excluir: true })] }],
      ['Bebedouros tudo, sem o módulo', { modulos_permitidos: ['mapa'], permissoes_telas: [linha('manejo', 'pec-bebedouros', acoes(true))] }],
      ['Bebedouros tudo, sem visualizar', { modulos_permitidos: ['manejo'], permissoes_telas: [{ ...linha('manejo', 'pec-bebedouros', acoes(true)), visualizar: false }] }],
      ['acesso total (is_admin)', { is_admin: true }],
    ];
    const divergencias = [];
    for (const [rotulo, perm] of matriz) {
      const c = await contaCom(perm);
      const beb = await criarBebedouro(c);
      // O que a interface recebe é a linha da própria conta (permissaoEfetiva).
      const registroUi = { user_email: c.credenciais.login, ...perm };
      const criar = await req('POST', '/bebedouros-historico', c.token, corpoDaTela(c, beb.id));
      if ((criar.statusCode === 201) !== ui.podeLancarNoBebedouro(registroUi)) divergencias.push(`${rotulo} lançar: servidor ${criar.statusCode}, UI ${ui.podeLancarNoBebedouro(registroUi)}`);
      const recente = await semear(c, beb.id, '2027-06-20T10:00:00.000Z');
      const apagar = await req('DELETE', `/bebedouros-historico/${recente.id}`, c.token);
      if ((apagar.statusCode === 204) !== ui.podeExcluirLancamentoBebedouro(registroUi)) divergencias.push(`${rotulo} excluir: servidor ${apagar.statusCode}, UI ${ui.podeExcluirLancamentoBebedouro(registroUi)}`);
      if (![201, 403].includes(criar.statusCode)) divergencias.push(`${rotulo} lançar: status inesperado ${criar.statusCode} ${criar.body}`);
      if (![204, 403].includes(apagar.statusCode)) divergencias.push(`${rotulo} excluir: status inesperado ${apagar.statusCode} ${apagar.body}`);
    }
    assert.deepEqual(divergencias, []);
  });
});
