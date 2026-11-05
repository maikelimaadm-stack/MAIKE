/**
 * PR #199 / R2 — fechamento de autorização (PostgreSQL descartável, HTTP real).
 *
 *  R2-ICO  `configuracao-icones` (POST/PATCH): configuração do tenant, gravada só
 *          pela tela Configurações Gerais (só administrador) → exige o
 *          ADMINISTRADOR REAL (`papel_tenant`), dentro da transação.
 *  R2-MAP  política para registro parcial legado: ação GRAVADORA do mapa ausente
 *          → negada ao operador (antes: ausente = ligada).
 *  R2-GEN  `POST /movimentacoes-mapa` genérico: allowlist tipada (antes: tipo
 *          desconhecido passava só com "salvar").
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
  const p = prisma();
  await p.pesoRebanho.deleteMany({});
  await p.lancamentoTarefa.updateMany({ where: { posicao_id: { not: null } }, data: { posicao_id: null } });
  await p.partidaRebanho.deleteMany({});
  await p.eventoRebanho.deleteMany({});
  await p.posicaoRebanho.deleteMany({});
  await p.rebanhoLedgerAtivacao.deleteMany({});
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), ...a });
const VER_MAPA = { modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-geral', { visualizar: true })] };

/** Admin real + operador do mesmo tenant; `ledger` ativa o controle do rebanho. */
const cenario = async ({ ledger = false } = {}) => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador', semPermissao: true });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const senhaHash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const login = `oper-${randomUUID().slice(0, 8)}`;
  const operador = await p.usuario.create({ data: { cliente_id: adm.cliente.id, nome: 'Operador', login, senha_hash: senhaHash, papel_tenant: 'usuario' } });
  const tokOp = (await autenticarNoApp(app, { login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const c = { cliente: adm.cliente, tokAdm, tokOp, login, operador, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
  if (ledger) {
    const at = await req('POST', '/rebanho/ativacao', tokAdm, { operation_id: opId(), empresa_id: empresa.id, data_corte: '2026-10-01' });
    assert.equal(at.statusCode, 201, at.body);
  }
  const lote = await req('POST', '/lotes', tokAdm, { empresa_id: empresa.id, nome: 'BASE', quantidade_cabecas: 100, categoria: 'Boi 25 a 36 meses', sexo: 'Macho', setor_id: setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id, data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 300 });
  assert.equal(lote.statusCode, 201, lote.body);
  c.lote = lote.json();
  if (ledger) c.posicao = await p.posicaoRebanho.findFirst({ where: { cliente_id: adm.cliente.id, lote_entrada_id: c.lote.id } });
  c.permitir = (dados) =>
    p.permissao.upsert({
      where: { cliente_id_user_email: { cliente_id: adm.cliente.id, user_email: login } },
      create: { cliente_id: adm.cliente.id, user_email: login, user_nome: 'Operador', ...dados },
      update: dados,
    });
  return c;
};

/** Tudo o que uma escrita poderia tocar no tenant. */
const fotografia = async (clienteId) => {
  const p = prisma();
  const where = { cliente_id: clienteId };
  return JSON.stringify([
    (await p.configuracaoIcone.findMany({ where, orderBy: { id: 'asc' } })).map((i) => [i.id, i.categoria, i.cor_padrao, i.updatedAt.toISOString()]),
    await p.auditLog.count({ where }),
    await p.movimentacaoMapa.count({ where }),
    await p.eventoRebanho.count({ where }),
    await p.partidaRebanho.count({ where }),
    await p.lote.count({ where }),
    await p.permissao.count({ where }),
    (await p.usuario.findMany({ where, orderBy: { id: 'asc' } })).map((u) => [u.id, u.papel_tenant, u.ativo]),
  ]);
};
const semEscrita = async (clienteId, acao, status, code) => {
  const antes = await fotografia(clienteId);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (code) assert.equal(r.json().code, code, r.body);
  assert.equal(await fotografia(clienteId), antes, 'nada gravado, nada auditado');
  return r;
};

const ICONE = { tipo_entidade: 'Ponto', categoria: 'COCHO', cor_padrao: '#10b981', ativo: true };

describe('R2-ICO — configuracao-icones exige o administrador real da fazenda', () => {
  test('operador sem linha, com "ver o mapa" e com a concessão is_admin: POST e PATCH → 403, nada gravado', async () => {
    const c = await cenario();
    const icone = await req('POST', '/configuracao-icones', c.tokAdm, ICONE);
    assert.equal(icone.statusCode, 201, icone.body);
    const id = icone.json().id;
    for (const concessao of [null, VER_MAPA, { is_admin: true }]) {
      if (concessao) await c.permitir(concessao);
      await semEscrita(c.cliente.id, () => req('POST', '/configuracao-icones', c.tokOp, { ...ICONE, categoria: 'INVASOR' }), 403, 'TENANT_ADMIN_REQUIRED');
      await semEscrita(c.cliente.id, () => req('PATCH', `/configuracao-icones/${id}`, c.tokOp, { cor_padrao: '#000000' }), 403, 'TENANT_ADMIN_REQUIRED');
    }
  });

  test('administrador real: cria e edita (contrato existente); auditoria registrada', async () => {
    const c = await cenario();
    const r = await req('POST', '/configuracao-icones', c.tokAdm, ICONE);
    assert.equal(r.statusCode, 201, r.body);
    const e = await req('PATCH', `/configuracao-icones/${r.json().id}`, c.tokAdm, { cor_padrao: '#123456' });
    assert.equal(e.statusCode, 200, e.body);
    assert.equal(e.json().cor_padrao, '#123456');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'ConfiguracaoIcone' } }), 2);
  });

  test('administrador de OUTRO tenant não edita o ícone (404, nada muda); conta desativada → 401', async () => {
    const c = await cenario();
    const id = (await req('POST', '/configuracao-icones', c.tokAdm, ICONE)).json().id;
    const outro = await criarTenant({ papelTenant: 'administrador', semPermissao: true });
    const tokOutro = (await autenticarNoApp(app, outro.credenciais)).corpo.token;
    await semEscrita(c.cliente.id, () => req('PATCH', `/configuracao-icones/${id}`, tokOutro, { cor_padrao: '#000000' }), 404);
    await prisma().usuario.update({ where: { id: c.operador.id }, data: { papel_tenant: 'administrador' } });
    await prisma().usuario.update({ where: { id: c.operador.id }, data: { ativo: false } });
    await semEscrita(c.cliente.id, () => req('POST', '/configuracao-icones', c.tokOp, ICONE), 401);
  });

  test('is_admin na linha nunca vira administrador: não edita permissões, contas nem o catálogo global', async () => {
    const c = await cenario();
    await c.permitir({ is_admin: true });
    const perm = await prisma().permissao.findFirst({ where: { cliente_id: c.cliente.id, user_email: c.login } });
    await semEscrita(c.cliente.id, () => req('PATCH', `/permissoes/${perm.id}`, c.tokOp, { modulos_permitidos: ['administracao'] }), 403, 'TENANT_ADMIN_REQUIRED');
    await semEscrita(c.cliente.id, () => req('POST', '/permissoes', c.tokOp, { user_email: 'novo', is_admin: true }), 403, 'TENANT_ADMIN_REQUIRED');
    await semEscrita(c.cliente.id, () => req('POST', '/usuarios', c.tokOp, { nome: 'X', login: `x-${randomUUID().slice(0, 6)}`, senha: 'senha-forte-123' }), 403, 'TENANT_ADMIN_REQUIRED');
    const cat = await req('POST', '/catalogo-global/admin/tipos', c.tokOp, { codigo: 'lote', nome: 'Lote' });
    assert.equal(cat.statusCode, 403, cat.body);
  });
});

describe('R2-MAP — registro parcial legado: ação gravadora ausente nega', () => {
  const transferir = (c) =>
    req('POST', '/rebanho/comandos/transferencia', c.tokOp, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-01T12:00:00.000Z', itens: [{ posicao_id: c.posicao.id, quantidade: 5 }] });

  test('tela visível sem objeto do mapa, ou com a chave omitida → 403 (antes: liberado)', async () => {
    const c = await cenario({ ledger: true });
    await c.permitir({ ...VER_MAPA, mapa_geral_permissoes: null });
    await semEscrita(c.cliente.id, () => transferir(c), 403, 'ACAO_NAO_PERMITIDA');
    await c.permitir({ ...VER_MAPA, mapa_geral_permissoes: { visualizar_lotes: true } });
    await semEscrita(c.cliente.id, () => transferir(c), 403, 'ACAO_NAO_PERMITIDA');
    await c.permitir({ ...VER_MAPA, mapa_geral_permissoes: { mover_lotes: 'true' } });
    await semEscrita(c.cliente.id, () => transferir(c), 403, 'ACAO_NAO_PERMITIDA');
  });

  test('chave gravada como true → passa; sem a tela visível, nem a chave true passa', async () => {
    const c = await cenario({ ledger: true });
    await c.permitir({ ...VER_MAPA, mapa_geral_permissoes: { mover_lotes: true } });
    assert.equal((await transferir(c)).statusCode, 201);
    await c.permitir({ modulos_permitidos: ['mapa'], permissoes_telas: [], mapa_geral_permissoes: { mover_lotes: true } });
    await semEscrita(c.cliente.id, () => transferir(c), 403, 'ACAO_NAO_PERMITIDA');
  });
});

describe('R2-GEN — POST /movimentacoes-mapa genérico: allowlist tipada', () => {
  const generico = (c, tok, corpo) => req('POST', '/movimentacoes-mapa', tok, { empresa_id: c.empresa.id, lote_id: c.lote.id, quantidade_animais: 10, data_movimentacao: '2026-11-01T12:00:00.000Z', ...corpo });
  const SALVAR_MAPA = { modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-geral', { visualizar: true, salvar: true })], mapa_geral_permissoes: {} };

  test('tipo sem contrato, alias ou disfarce com "salvar" → 403 sem escrita (antes: 201)', async () => {
    const c = await cenario();
    await c.permitir(SALVAR_MAPA);
    for (const corpo of [
      { tipo: 'Ajuste de Saldo' },
      { tipo: 'Saída', motivo: 'Morte' },
      { tipo: 'Entrada', motivo: 'Compra' },
      { tipo: 'Transferencia_de_area', area_destino_id: c.B.id },
      { tipo: 'Movimento', observacoes: 'transferência disfarçada' },
    ]) {
      await semEscrita(c.cliente.id, () => generico(c, c.tokOp, corpo), 403, 'ACAO_NAO_PERMITIDA');
    }
  });

  test('tipo conhecido por outro nome (acentos/caixa) exige a chave do tipo', async () => {
    const c = await cenario();
    await c.permitir(SALVAR_MAPA);
    for (const tipo of ['TRANSFERÊNCIA DE ÁREA', 'transferencia', ' Morte ', 'ABATE', 'pesagem']) {
      await semEscrita(c.cliente.id, () => generico(c, c.tokOp, { tipo }), 403, 'ACAO_NAO_PERMITIDA');
    }
  });

  test('registro informativo do Renomear Lote: exige "renomear_lotes" (não "salvar")', async () => {
    const c = await cenario();
    const renomeio = { tipo: 'Entrada', motivo: 'Renomear Lote', lote: 'NOVO', observacoes: 'Renomear Lote: "BASE" → "NOVO"' };
    await c.permitir(SALVAR_MAPA);
    await semEscrita(c.cliente.id, () => generico(c, c.tokOp, renomeio), 403, 'ACAO_NAO_PERMITIDA');
    await c.permitir({ ...VER_MAPA, mapa_geral_permissoes: { renomear_lotes: true } });
    const r = await generico(c, c.tokOp, renomeio);
    assert.equal(r.statusCode, 201, r.body);
  });

  test('administrador real: tipo sem contrato segue pelo legado (sem 403)', async () => {
    const c = await cenario();
    const r = await generico(c, c.tokAdm, { tipo: 'Ajuste de Saldo' });
    assert.notEqual(r.statusCode, 403, r.body);
  });
});
