/**
 * Missão integrada (D-PROD-137) — frente M3: leituras administrativas e escopo
 * de cadastros por tela cruzada. PostgreSQL real; prova por PERSISTÊNCIA.
 *
 *  GET-01  `GET /empresas` entregava CPF, RG, IE, telefone, e-mail, endereço,
 *          CEP e observações a qualquer conta do tenant.
 *  GET-02  `GET /usuarios` e `/usuarios/page` listavam todas as contas (login,
 *  USR-01  ativo, datas) a qualquer operador; `/permissoes` entregava o login
 *          (user_email) dos colegas a quem só vê o mapa.
 *  GET-05  com a concessão `is_admin` o formulário de tarefa não achava os
 *          responsáveis do tenant (a matriz alheia não vem) — o servidor passa
 *          a dizer quem é elegível (`responsavel_elegivel`).
 *  GET-04  `GET /fornecedores` entregava a PII de fornecedores a qualquer conta.
 *  F6      Mapa Cadastro editar/excluir alterava, desativava ou excluía
 *          QUALQUER LocalEstoque.
 *  F8      Cadastro de Lotes criava anexo em entidade arbitrária e excluía
 *          anexo de qualquer entidade.
 *  EMP-01  DELETE de empresa sem conferir dependentes (órfãos para sempre).
 *  TAR-01  histórico de tarefa gravava empresa_id/titulo/status do corpo.
 *
 * CONTROLE: o operador real "só pec-mapa-geral, ações gravadoras false" segue
 * recebendo 200 em tudo o que o Mapa Geral lê (o mapa não pode quebrar).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { gerarSenhaHash } from '../src/modules/auth/authService.js';
import { ACOES_GRAVADORAS_MAPA } from '../src/shared/auth/autorizacaoTela.js';

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

const SENHA = 'senha-de-teste-1';
const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (modulo, tela, a = {}) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), visualizar: true, ...a });

/** O operador REAL do campo: só a tela do Mapa Geral, nenhuma ação gravadora. */
const PERM_SO_MAPA = Object.freeze({
  modulos_permitidos: ['mapa'],
  permissoes_telas: [linha('mapa', 'pec-mapa-geral')],
  mapa_geral_permissoes: Object.fromEntries(ACOES_GRAVADORAS_MAPA.map((k) => [k, false])),
});
const so = (modulo, tela, a = {}) => ({ modulos_permitidos: [modulo], permissoes_telas: [linha(modulo, tela, a)] });

/**
 * Fazenda com o administrador REAL (sem linha de Permissão) e um gerador de
 * contas no MESMO tenant (login global único).
 */
const fazenda = async () => {
  const adm = await criarTenant({ semPermissao: true, papelTenant: 'administrador' });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  assert.ok(tokAdm, 'login do administrador');
  const clienteId = adm.cliente.id;
  /** @param {Record<string, unknown>|null} permissao @param {{ nome?: string, ativo?: boolean }} [o] */
  const conta = async (permissao, o = {}) => {
    const login = `u-${randomUUID().slice(0, 8)}`;
    const nome = o.nome ?? `Conta ${login}`;
    const usuario = await prisma().usuario.create({
      data: { cliente_id: clienteId, nome, login, senha_hash: await gerarSenhaHash(SENHA), ativo: o.ativo ?? true },
    });
    if (permissao) await prisma().permissao.create({ data: { cliente_id: clienteId, user_email: login, user_nome: nome, ...permissao } });
    const tok = o.ativo === false ? null : (await autenticarNoApp(app, { login, senha: SENHA })).corpo.token;
    if (o.ativo !== false) assert.ok(tok, `login de ${login}`);
    return { usuario, login, tok };
  };
  return { adm, tokAdm, clienteId, conta };
};

const criarEmpresaPF = async (tokAdm) => {
  const r = await req('POST', '/empresas', tokAdm, {
    apelido: 'FAZ', nome: `JOAO DA SILVA ${randomUUID().slice(0, 6)}`, tipo_pessoa: 'Física',
    cpf: '123.456.789-09', rg: '1234567', inscricao_estadual: 'IE-998877', telefone: '65999990000', email: 'joao@x.com',
    endereco: 'Rua A 1', cidade: 'Cuiabá', estado: 'MT', cep: '78000000', observacoes: 'dados bancarios', logotipo_url: 'https://cdn/x.png',
    fuso_horario: 'America/Cuiaba',
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const PII_EMPRESA = ['cpf', 'rg', 'inscricao_estadual', 'telefone', 'email', 'endereco', 'cep', 'observacoes'];
const RESUMO_EMPRESA = ['id', 'numero_empresa', 'apelido', 'nome', 'tipo_pessoa', 'cidade', 'estado', 'cnpj', 'logotipo_url', 'fuso_horario', 'created_date', 'updated_date'];

describe('GET-01 — /empresas: resumo sem PII para quem não tem a tela Empresa', () => {
  test('E-01 operador só do mapa: 200 com o resumo do seletor; nenhum dado pessoal (chave ausente, não só nula)', async () => {
    const f = await fazenda();
    const emp = await criarEmpresaPF(f.tokAdm);
    const op = await f.conta(PERM_SO_MAPA);
    const r = await req('GET', '/empresas', op.tok);
    assert.equal(r.statusCode, 200, r.body);
    const [item] = r.json();
    assert.equal(item.id, emp.id);
    assert.equal(item.nome, emp.nome);
    assert.equal(item.apelido, 'FAZ');
    assert.equal(item.numero_empresa, emp.numero_empresa);
    assert.equal(item.fuso_horario, 'America/Cuiaba');
    assert.equal(item.logotipo_url, 'https://cdn/x.png');
    assert.equal(item.cidade, 'Cuiabá');
    for (const campo of PII_EMPRESA) assert.ok(!(campo in item), `${campo} não pode sair para o operador do mapa`);
    assert.ok(Object.keys(item).every((k) => RESUMO_EMPRESA.includes(k)), `só o resumo: ${Object.keys(item)}`);
    assert.ok(!r.body.includes('123.456.789-09') && !r.body.includes('joao@x.com') && !r.body.includes('dados bancarios'));
    // conta sem linha de Permissão também só vê o resumo (Layout de todo usuário: sem 403).
    const semLinha = await f.conta(null);
    const r2 = await req('GET', '/empresas', semLinha.tok);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.ok(!r2.body.includes('123.456.789-09'));
  });

  test('E-02 adm-empresa visualizar, concessão is_admin e administrador real recebem o registro completo', async () => {
    const f = await fazenda();
    await criarEmpresaPF(f.tokAdm);
    const telaEmpresa = await f.conta(so('administracao', 'adm-empresa'));
    const total = await f.conta({ is_admin: true });
    for (const [rotulo, tok] of [['adm-empresa', telaEmpresa.tok], ['is_admin', total.tok], ['admin real', f.tokAdm]]) {
      const r = await req('GET', '/empresas', tok);
      assert.equal(r.statusCode, 200, `${rotulo}: ${r.body}`);
      const [item] = r.json();
      assert.equal(item.cpf, '123.456.789-09', rotulo);
      assert.equal(item.email, 'joao@x.com', rotulo);
      assert.equal(item.observacoes, 'dados bancarios', rotulo);
      assert.ok(!('cliente_id' in item), rotulo);
    }
  });

  test('E-03 sup-produtos visualizar: resumo + endereço (cabeçalho da Ficha do Produto), sem CPF/RG/contato', async () => {
    const f = await fazenda();
    await criarEmpresaPF(f.tokAdm);
    const prod = await f.conta(so('suporte-mapa', 'sup-produtos'));
    const r = await req('GET', '/empresas', prod.tok);
    assert.equal(r.statusCode, 200, r.body);
    const [item] = r.json();
    assert.equal(item.endereco, 'Rua A 1');
    for (const campo of PII_EMPRESA.filter((c) => c !== 'endereco')) assert.ok(!(campo in item), campo);
  });
});

describe('GET-02 / USR-01 / GET-05 — contas do tenant', () => {
  const montar = async () => {
    const f = await fazenda();
    const op = await f.conta(PERM_SO_MAPA, { nome: 'Peão do mapa' });
    const a = await f.conta({ is_admin: true }, { nome: 'Gerente A' });
    const b = await f.conta({ is_admin: true }, { nome: 'Gerente B' });
    const legado = await f.conta({ modulos_permitidos: ['gestao-tarefas'], permissoes_telas: [linha('gestao-tarefas', 'gt-lancamentos')] }, { nome: 'Tarefeiro' });
    const inativo = await f.conta({ is_admin: true }, { nome: 'Ex-funcionário', ativo: false });
    return { f, op, a, b, legado, inativo };
  };

  test('U-01 operador só do mapa: /usuarios/page 403; /usuarios só a própria conta; /permissoes só a própria linha', async () => {
    const { f, op, a, inativo } = await montar();
    for (const qs of ['', '?ativo=false&limit=100', '?q=adm']) {
      const r = await req('GET', `/usuarios/page${qs}`, op.tok);
      assert.equal(r.statusCode, 403, `page${qs}: ${r.body}`);
      assert.equal(r.json().code, 'TENANT_ADMIN_REQUIRED');
    }
    const us = await req('GET', '/usuarios', op.tok);
    assert.equal(us.statusCode, 200, us.body);
    assert.deepEqual(us.json().map((u) => u.id), [op.usuario.id], 'só a própria conta');
    for (const login of [f.adm.credenciais.login, a.login, inativo.login]) assert.ok(!us.body.includes(login), `login ${login} vazou`);
    const perms = await req('GET', '/permissoes', op.tok);
    assert.equal(perms.statusCode, 200, perms.body);
    const lista = perms.json();
    assert.equal(lista.length, 1, 'só a própria linha');
    assert.equal(lista[0].user_email, op.login);
    assert.deepEqual(lista[0].modulos_permitidos, ['mapa'], 'a própria linha segue inteira (menu/mapa)');
    assert.ok(!perms.body.includes(a.login) && !perms.body.includes('Gerente A'));
  });

  test('U-02 concessão is_admin: /usuarios/page 403; /usuarios só contas ATIVAS {id,nome,login,ativo,responsavel_elegivel}; elegibilidade calculada no servidor', async () => {
    const { f, op, a, b, legado, inativo } = await montar();
    const pg = await req('GET', '/usuarios/page', a.tok);
    assert.equal(pg.statusCode, 403, pg.body);
    const r = await req('GET', '/usuarios', a.tok);
    assert.equal(r.statusCode, 200, r.body);
    const lista = r.json();
    const porId = new Map(lista.map((u) => [u.id, u]));
    assert.ok(!porId.has(inativo.usuario.id), 'conta desativada é dado administrativo');
    for (const u of lista) assert.deepEqual(Object.keys(u).sort(), ['ativo', 'id', 'login', 'nome', 'responsavel_elegivel']);
    assert.equal(porId.get(a.usuario.id).responsavel_elegivel, true, 'a própria conta (is_admin)');
    assert.equal(porId.get(b.usuario.id).responsavel_elegivel, true, 'colega com is_admin (antes sumia do select)');
    assert.equal(porId.get(f.adm.usuario.id).responsavel_elegivel, true, 'administrador real SEM linha de Permissão');
    assert.equal(porId.get(legado.usuario.id).responsavel_elegivel, true, 'tela de tarefas concedida');
    assert.equal(porId.get(op.usuario.id).responsavel_elegivel, false, 'só o mapa: não abre tarefas');
    // A matriz alheia continua fora (PR145-R4): das outras linhas só o nome.
    const perms = (await req('GET', '/permissoes', a.tok)).json();
    const outra = perms.find((p) => p.user_email === b.login);
    assert.deepEqual(Object.keys(outra).sort(), ['id', 'user_email', 'user_nome']);
    assert.ok('is_admin' in perms.find((p) => p.user_email === a.login), 'a própria linha inteira');
  });

  test('U-03 administrador real: /usuarios/page e /usuarios completos (papel, inativos, datas) + elegibilidade', async () => {
    const { f, op, inativo } = await montar();
    const pg = await req('GET', '/usuarios/page?ativo=false&limit=100', f.tokAdm);
    assert.equal(pg.statusCode, 200, pg.body);
    assert.deepEqual(pg.json().items.map((u) => u.id), [inativo.usuario.id]);
    assert.equal(pg.json().items[0].papel_tenant, 'usuario');
    const r = await req('GET', '/usuarios', f.tokAdm);
    assert.equal(r.statusCode, 200, r.body);
    const porId = new Map(r.json().map((u) => [u.id, u]));
    assert.equal(porId.size, 6);
    assert.equal(porId.get(f.adm.usuario.id).papel_tenant, 'administrador');
    assert.ok(porId.get(inativo.usuario.id).created_date);
    assert.equal(porId.get(inativo.usuario.id).responsavel_elegivel, false, 'inativo não é responsável');
    assert.equal(porId.get(op.usuario.id).responsavel_elegivel, false);
    assert.equal(porId.get(f.adm.usuario.id).responsavel_elegivel, true);
  });
});

describe('GET-04 — /fornecedores: só quem abre o Cadastro de Lotes; PII completa só com acesso total', () => {
  const semear = async (clienteId) =>
    prisma().fornecedor.create({
      data: {
        cliente_id: clienteId, empresa_id: 'e1', numero_cadastro: '1', tipo_pessoa: 'Física', nome: 'JOSE FORNECEDOR',
        cpf: '123.456.789-09', rg: 'RG-555', data_nascimento: new Date('1970-01-02'), telefone: '65988887777', email: 'jose@f.com',
        endereco: 'Sitio Z', cep: '78111000', codigo_ibge: '5103403', nome_responsavel: 'MARIA', inscricao_estadual: 'IE-1',
        observacoes: 'conta 123', cidade: 'Cuiabá', estado: 'MT', tipos: ['Gado'],
      },
    });
  const PII = ['rg', 'data_nascimento', 'telefone', 'email', 'endereco', 'cep', 'codigo_ibge', 'nome_responsavel', 'inscricao_estadual', 'observacoes'];

  test('F-01 operador só do mapa e conta sem linha → 403 ACAO_NAO_PERMITIDA', async () => {
    const f = await fazenda();
    await semear(f.clienteId);
    for (const conta of [await f.conta(PERM_SO_MAPA), await f.conta(null)]) {
      const r = await req('GET', '/fornecedores', conta.tok);
      assert.equal(r.statusCode, 403, r.body);
      assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA');
      assert.ok(!r.body.includes('123.456.789-09'));
    }
  });

  test('F-02 pec-lotes visualizar → 200 com a projeção do seletor (CPF mascarado; sem RG, nascimento, contato, endereço)', async () => {
    const f = await fazenda();
    const forn = await semear(f.clienteId);
    const lotes = await f.conta(so('manejo', 'pec-lotes'));
    const r = await req('GET', '/fornecedores', lotes.tok);
    assert.equal(r.statusCode, 200, r.body);
    const [item] = r.json();
    assert.equal(item.id, forn.id);
    assert.equal(item.nome, 'JOSE FORNECEDOR');
    assert.equal(item.empresa_id, 'e1');
    assert.equal(item.cidade, 'Cuiabá');
    assert.equal(item.estado, 'MT');
    assert.equal(item.cpf, '***.456.789-**', 'CPF mascarado (a busca do seletor ainda casa pelos dígitos do meio)');
    for (const campo of PII) assert.ok(!(campo in item), `${campo} não sai para quem só usa o seletor`);
    assert.ok(!r.body.includes('123.456.789-09'));
  });

  test('F-03 concessão is_admin e administrador real → registro completo', async () => {
    const f = await fazenda();
    await semear(f.clienteId);
    const total = await f.conta({ is_admin: true });
    for (const tok of [total.tok, f.tokAdm]) {
      const r = await req('GET', '/fornecedores', tok);
      assert.equal(r.statusCode, 200, r.body);
      const [item] = r.json();
      assert.equal(item.cpf, '123.456.789-09');
      assert.equal(item.email, 'jose@f.com');
      assert.equal(item.rg, 'RG-555');
    }
  });
});

describe('F6 — LocalEstoque pela tela cruzada do Mapa Cadastro', () => {
  const MC = (a) => so('mapa', 'pec-mapa-cadastro', a);
  const local = (clienteId, numero, nome) => prisma().localEstoque.create({ data: { cliente_id: clienteId, numero_local: String(numero), nome } });
  const deposito = (clienteId, localId, categoria = 'DEPOSITO') =>
    prisma().pontoSuplementacao.create({ data: { cliente_id: clienteId, empresa_id: 'e1', numero_ponto: `DEP-${randomUUID().slice(0, 4)}`, nome_ponto: 'DEP 1', categoria_ponto: categoria, local_estoque_id: localId } });
  const ler = (id) => prisma().localEstoque.findUnique({ where: { id } });

  test('L-01 Mapa Cadastro editar+excluir NÃO toca local sem depósito (PATCH 403, DELETE 403; banco intacto)', async () => {
    const f = await fazenda();
    const almox = await local(f.clienteId, 1, 'ALMOXARIFADO CENTRAL');
    const galpao = await local(f.clienteId, 2, 'GALPAO 2');
    const op = await f.conta(MC({ editar: true, excluir: true }));
    for (const corpo of [{ ativo: false, capacidade: '0', descricao: 'x' }, { nome: 'RENOMEADO' }]) {
      const r = await req('PATCH', `/locais-estoque/${almox.id}`, op.tok, corpo);
      assert.equal(r.statusCode, 403, r.body);
      assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA');
    }
    const depois = await ler(almox.id);
    assert.equal(depois.ativo, true);
    assert.equal(depois.nome, 'ALMOXARIFADO CENTRAL');
    assert.equal(depois.updatedAt.getTime(), almox.updatedAt.getTime());
    const d = await req('DELETE', `/locais-estoque/${galpao.id}`, op.tok);
    assert.equal(d.statusCode, 403, d.body);
    assert.ok(await ler(galpao.id), 'GALPAO 2 continua no banco');
  });

  test('L-02 Mapa Cadastro editar no local DO DEPÓSITO: nome/descrição 200; capacidade/ativo 403; local de cocho 403', async () => {
    const f = await fazenda();
    const loc = await local(f.clienteId, 1, 'DEP 1');
    await deposito(f.clienteId, loc.id, 'deposito'); // categoria em qualquer caixa (o mapa compara normalizado)
    const doCocho = await local(f.clienteId, 2, 'LOCAL DO COCHO');
    await deposito(f.clienteId, doCocho.id, 'COCHO');
    const op = await f.conta(MC({ editar: true }));
    const ok = await req('PATCH', `/locais-estoque/${loc.id}`, op.tok, { nome: 'DEP NOVO', descricao: 'DEPÓSITO DE SUPLEMENTAÇÃO - DEP NOVO' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal((await ler(loc.id)).nome, 'DEP NOVO');
    for (const corpo of [{ capacidade: '10' }, { nome: 'X', ativo: false }]) {
      const r = await req('PATCH', `/locais-estoque/${loc.id}`, op.tok, corpo);
      assert.equal(r.statusCode, 403, `${JSON.stringify(corpo)}: ${r.body}`);
    }
    const final = await ler(loc.id);
    assert.equal(final.ativo, true);
    assert.equal(final.capacidade, null);
    assert.equal(final.nome, 'DEP NOVO');
    const r = await req('PATCH', `/locais-estoque/${doCocho.id}`, op.tok, { nome: 'Y' });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal((await ler(doCocho.id)).nome, 'LOCAL DO COCHO');
  });

  test('L-03 Mapa Cadastro excluir: DELETE do local do depósito → 403 (antes 409 deposito_do_mapa: a cascata do mapa já contava como ignorado)', async () => {
    const f = await fazenda();
    const loc = await local(f.clienteId, 1, 'DEP 1');
    await deposito(f.clienteId, loc.id);
    const op = await f.conta(MC({ excluir: true }));
    const r = await req('DELETE', `/locais-estoque/${loc.id}`, op.tok);
    assert.equal(r.statusCode, 403, r.body);
    assert.ok(await ler(loc.id));
  });

  test('L-04 controle: tela Locais editar/excluir e acesso total seguem alterando e excluindo qualquer local', async () => {
    const f = await fazenda();
    const l1 = await local(f.clienteId, 1, 'L1');
    const l2 = await local(f.clienteId, 2, 'L2');
    const l3 = await local(f.clienteId, 3, 'L3');
    const locais = await f.conta(so('suporte-mapa', 'sup-locais', { editar: true, excluir: true }));
    const p = await req('PATCH', `/locais-estoque/${l1.id}`, locais.tok, { ativo: false, capacidade: '5' });
    assert.equal(p.statusCode, 200, p.body);
    assert.equal((await ler(l1.id)).ativo, false);
    assert.equal((await req('DELETE', `/locais-estoque/${l2.id}`, locais.tok)).statusCode, 204);
    assert.equal(await ler(l2.id), null);
    const total = await f.conta({ is_admin: true });
    assert.equal((await req('DELETE', `/locais-estoque/${l3.id}`, total.tok)).statusCode, 204);
    assert.equal(await ler(l3.id), null);
  });
});

describe('F8 — anexos: com a tela de Lotes, só anexo de Lote existente no tenant', () => {
  const corpo = (entidade, entidade_id) => ({ entidade, entidade_id, nome_original: 'a.pdf', storage_key: `k-${randomUUID()}`, mime_type: 'application/pdf', tamanho_bytes: 10 });
  const anexo = (clienteId, entidade, entidade_id, criado_por) =>
    prisma().registroAnexo.create({ data: { cliente_id: clienteId, entidade, entidade_id, nome_original: 'c.pdf', storage_key: `k-${randomUUID()}`, mime_type: 'application/pdf', tamanho_bytes: 10, criado_por } });
  const lote = (clienteId) =>
    prisma().lote.create({ data: { cliente_id: clienteId, empresa_id: 'e1', numero_lote: String(Math.floor(Math.random() * 1e6)), nome: 'L1', quantidade_cabecas: 10, quantidade_entrada: 10, motivo_entrada: 'Compra' } });

  test('A-01 pec-lotes novo+excluir: entidade≠Lote 403, Lote inexistente/alheio 404, Lote do tenant 201; excluir só anexo de Lote', async () => {
    const f = await fazenda();
    const outro = await criarTenant();
    const meuLote = await lote(f.clienteId);
    const loteAlheio = await lote(outro.cliente.id);
    const op = await f.conta(so('manejo', 'pec-lotes', { novo: true, excluir: true }));
    const antes = await prisma().registroAnexo.count();
    const r1 = await req('POST', '/registros-anexo', op.tok, corpo('LancamentoTarefa', 'qualquer'));
    assert.equal(r1.statusCode, 403, r1.body);
    assert.equal(r1.json().code, 'ACAO_NAO_PERMITIDA');
    for (const id of ['nao-existe', loteAlheio.id]) {
      const r = await req('POST', '/registros-anexo', op.tok, corpo('Lote', id));
      assert.equal(r.statusCode, 404, `${id}: ${r.body}`);
      assert.equal(r.json().code, 'ATTACHMENT_OWNER_INVALID');
    }
    assert.equal(await prisma().registroAnexo.count(), antes, 'nada gravado');
    const ok = await req('POST', '/registros-anexo', op.tok, corpo('Lote', meuLote.id));
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal((await prisma().registroAnexo.findUnique({ where: { id: ok.json().id } })).entidade_id, meuLote.id);

    const daEmpresa = await anexo(f.clienteId, 'Empresa', 'emp-1', f.adm.usuario.id);
    const d1 = await req('DELETE', `/registros-anexo/${daEmpresa.id}`, op.tok);
    assert.equal(d1.statusCode, 403, d1.body);
    assert.ok(await prisma().registroAnexo.findUnique({ where: { id: daEmpresa.id } }), 'anexo de outra entidade intacto');
    const d2 = await req('DELETE', `/registros-anexo/${ok.json().id}`, op.tok);
    assert.equal(d2.statusCode, 204, d2.body);
    assert.equal(await prisma().registroAnexo.findUnique({ where: { id: ok.json().id } }), null);
  });

  test('A-02 acesso total segue podendo anexar/excluir em outras entidades', async () => {
    const f = await fazenda();
    const total = await f.conta({ is_admin: true });
    const r = await req('POST', '/registros-anexo', total.tok, corpo('LancamentoTarefa', 't-1'));
    assert.equal(r.statusCode, 201, r.body);
    const daEmpresa = await anexo(f.clienteId, 'Empresa', 'emp-1', f.adm.usuario.id);
    assert.equal((await req('DELETE', `/registros-anexo/${daEmpresa.id}`, total.tok)).statusCode, 204);
    assert.equal(await prisma().registroAnexo.findUnique({ where: { id: daEmpresa.id } }), null);
  });
});

describe('EMP-01 — DELETE /empresas/:id com dependentes → 409 EMPRESA_COM_VINCULOS, nada apagado', () => {
  const novaEmpresa = async (tok, nome = `FAZENDA ${randomUUID().slice(0, 6)}`) => {
    const r = await req('POST', '/empresas', tok, { apelido: 'F', nome, tipo_pessoa: 'Jurídica' });
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const setor = (clienteId, empresaId) =>
    prisma().setor.create({ data: { cliente_id: clienteId, empresa_id: empresaId, numero_setor: String(Math.floor(Math.random() * 1e6)), nome: `S ${randomUUID().slice(0, 4)}` } });
  const vinculosDe = (r) => Object.fromEntries((r.json().details?.vinculos ?? []).map((v) => [v.entidade, v.total]));

  test('D-01 setor, cocho e produto (sem fato do rebanho) → 409 com contagem; empresa, ativação e dependentes intactos', async () => {
    const f = await fazenda();
    const e2 = await novaEmpresa(f.tokAdm);
    await setor(f.clienteId, e2.id);
    await prisma().pontoSuplementacao.create({ data: { cliente_id: f.clienteId, empresa_id: e2.id, numero_ponto: 'C-1', nome_ponto: 'COCHO' } });
    await prisma().produto.create({ data: { cliente_id: f.clienteId, empresa_id: e2.id, numero_produto: '1', nome_produto: 'SAL' } });
    const outra = await novaEmpresa(f.tokAdm);
    const op = await f.conta(so('administracao', 'adm-empresa', { excluir: true }));
    const r = await req('DELETE', `/empresas/${e2.id}`, op.tok);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'EMPRESA_COM_VINCULOS');
    assert.deepEqual(vinculosDe(r), { Setor: 1, PontoSuplementacao: 1, Produto: 1 });
    assert.ok(await prisma().empresa.findUnique({ where: { id: e2.id } }), 'empresa intacta');
    assert.equal(await prisma().rebanhoLedgerAtivacao.count({ where: { empresa_id: e2.id } }), 1, 'ativação intacta');
    assert.equal(await prisma().setor.count({ where: { empresa_id: e2.id } }), 1);
    // A outra empresa (sem nada) sai normalmente: os vínculos são por empresa, não do tenant.
    assert.equal((await req('DELETE', `/empresas/${outra.id}`, op.tok)).statusCode, 204);
  });

  test('D-02 com posição do rebanho (FK Restrict) → 409 EMPRESA_COM_VINCULOS (antes 403 TENANT_SCOPE_VIOLATION enganoso)', async () => {
    const f = await fazenda();
    const e2 = await novaEmpresa(f.tokAdm);
    const s = await setor(f.clienteId, e2.id);
    const area = await prisma().areaPastagem.create({ data: { cliente_id: f.clienteId, empresa_id: e2.id, setor_id: s.id, setor_nome: s.nome, numero_area: '1', nome: 'PASTO', tamanho_hectares: 10 } });
    await prisma().posicaoRebanho.create({ data: { cliente_id: f.clienteId, empresa_id: e2.id, area_id: area.id, chave_identidade: `k-${randomUUID()}`, nome: 'POS' } });
    const r = await req('DELETE', `/empresas/${e2.id}`, f.tokAdm);
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'EMPRESA_COM_VINCULOS');
    const v = vinculosDe(r);
    assert.equal(v.PosicaoRebanho, 1);
    assert.equal(v.AreaPastagem, 1);
    assert.ok(await prisma().empresa.findUnique({ where: { id: e2.id } }));
  });

  test('D-03 empresa sem dependentes → 204 como antes (empresa e ativação vazia saem)', async () => {
    const f = await fazenda();
    const e2 = await novaEmpresa(f.tokAdm);
    const r = await req('DELETE', `/empresas/${e2.id}`, f.tokAdm);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(await prisma().empresa.findUnique({ where: { id: e2.id } }), null);
    assert.equal(await prisma().rebanhoLedgerAtivacao.count({ where: { empresa_id: e2.id } }), 0);
  });
});

describe('TAR-01 — histórico de tarefa: empresa, título e status vêm da tarefa relida', () => {
  test('T-01 corpo com empresa_id/titulo/status divergentes → gravado com os da tarefa', async () => {
    const f = await fazenda();
    const total = await f.conta({ is_admin: true });
    const grupo = await req('POST', '/grupos-atividade', total.tok, { nome_grupo: 'G', ativo: true });
    assert.equal(grupo.statusCode, 201, grupo.body);
    const tipo = await req('POST', '/tipos-tarefa', total.tok, { nome_tipo: 'T', grupo_atividade_id: grupo.json().id, ativo: true });
    assert.equal(tipo.statusCode, 201, tipo.body);
    const tarefa = await req('POST', '/lancamentos-tarefa', total.tok, { empresa_id: 'emp-1', titulo: 'Consertar cerca', tipo: 'Manejo', tipo_tarefa_id: tipo.json().id, data_pedido: '2026-10-27' });
    assert.equal(tarefa.statusCode, 201, tarefa.body);
    const t = tarefa.json();
    const r = await req('POST', '/historicos-lancamento-tarefa', total.tok, {
      empresa_id: 'emp-2', tarefa_id: t.id, titulo_tarefa: 'FORJADO', evento: 'Conclusão', data_evento: '2026-10-28T00:00:00Z', status: 'Concluída',
    });
    assert.equal(r.statusCode, 201, r.body);
    const gravado = await prisma().historicoLancamentoTarefa.findFirst({ where: { id: r.json().id } });
    assert.equal(gravado.empresa_id, 'emp-1', 'empresa da tarefa (o painel da tarefa acha o evento)');
    assert.equal(gravado.titulo_tarefa, 'Consertar cerca');
    assert.equal(gravado.status, t.status);
    assert.equal(gravado.tarefa_id, t.id);
  });
});

describe('CONTROLE — operador real só do mapa (gravadoras false): o Mapa Geral continua lendo tudo', () => {
  test('C-01 GETs MAPA_NECESSARIO → 200 (e com os dados semeados)', async () => {
    const f = await fazenda();
    const emp = await criarEmpresaPF(f.tokAdm);
    const E = emp.id;
    const s = await prisma().setor.create({ data: { cliente_id: f.clienteId, empresa_id: E, numero_setor: '1', nome: 'NORTE' } });
    await prisma().areaPastagem.create({ data: { cliente_id: f.clienteId, empresa_id: E, setor_id: s.id, setor_nome: s.nome, numero_area: '1', nome: 'PASTO 1', tamanho_hectares: 10 } });
    const loc = await prisma().localEstoque.create({ data: { cliente_id: f.clienteId, numero_local: '1', nome: 'DEP' } });
    await prisma().pontoSuplementacao.create({ data: { cliente_id: f.clienteId, empresa_id: E, numero_ponto: 'DEP-1', nome_ponto: 'DEP', categoria_ponto: 'DEPOSITO', local_estoque_id: loc.id } });
    await prisma().categoriaManejo.create({ data: { cliente_id: f.clienteId, empresa_id: E, nome: 'BEZERRO' } });
    await prisma().produto.create({ data: { cliente_id: f.clienteId, empresa_id: E, numero_produto: '1', nome_produto: 'SAL' } });
    await prisma().bebedouro.create({ data: { cliente_id: f.clienteId, empresa_id: E, nome: 'BEB 1', tipo: 'Bebedouro australiano' } });
    const op = await f.conta(PERM_SO_MAPA);
    const rotas = [
      '/auth/contexto', '/empresas', '/permissoes', '/usuarios', '/setores', `/areas-pastagem`, '/lotes', `/rebanho/posicoes?empresa_id=${E}`,
      '/pontos-suplementacao', '/pontos-referencia', '/linhas-geograficas', '/configuracao-icones', '/bebedouros', '/bebedouros-historico',
      '/categorias-manejo', '/produtos', '/estoque-lotes-nota', '/movimentacoes-estoque', '/movimentacoes-mapa', `/movimentacoes-mapa/historico?empresa_id=${E}`,
      '/suplementacao-eventos', '/suplementacao-lotes', '/aplicacoes-medicamento', '/eventos-sanitarios', '/manejos-tecnico-rebanho', '/movimentacoes-pecuaria',
    ];
    for (const url of rotas) {
      const r = await req('GET', url, op.tok);
      assert.equal(r.statusCode, 200, `${url}: ${r.statusCode} ${r.body.slice(0, 200)}`);
    }
    const tamanho = async (url) => {
      const corpo = (await req('GET', url, op.tok)).json();
      return Array.isArray(corpo) ? corpo.length : (corpo.items ?? corpo.itens ?? []).length;
    };
    assert.equal(await tamanho('/empresas'), 1, 'seletor de empresa do Layout');
    assert.equal(await tamanho('/setores'), 1);
    assert.equal(await tamanho('/areas-pastagem'), 1);
    assert.equal(await tamanho('/pontos-suplementacao'), 1);
    assert.equal(await tamanho('/categorias-manejo'), 1);
    assert.equal(await tamanho('/produtos'), 1);
    assert.equal(await tamanho('/bebedouros'), 1);
    assert.equal(await tamanho('/permissoes'), 1, 'a própria linha (menu e mapa)');
    // e as rotas de CADASTRO/ADMIN que o mapa não usa ficam fechadas para ele
    assert.equal((await req('GET', '/fornecedores', op.tok)).statusCode, 403);
    assert.equal((await req('GET', '/usuarios/page', op.tok)).statusCode, 403);
  });
});
