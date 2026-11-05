/**
 * Permissões aplicadas NO SERVIDOR (tela/ação e ações do Mapa Geral).
 * PostgreSQL real descartável, HTTP autenticado, contas/tenants fictícios.
 *
 * Antes: nenhuma rota de negócio consultava `Permissao`; requisição direta de
 * um operador sem permissão gravava lote, transferência, pesagem, área…
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

const TELAS_TODAS = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (modulo, tela, acoes) => ({ modulo_id: modulo, modulo_nome: modulo, tela_id: tela, tela_nome: tela, ...TELAS_TODAS(false), ...acoes });

/** Fazenda com admin real + operador; ledger ativo; um lote com posição. */
const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const senhaHash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const login = `oper-${randomUUID().slice(0, 8)}`;
  await p.usuario.create({ data: { cliente_id: adm.cliente.id, nome: 'Operador', login, senha_hash: senhaHash, papel_tenant: 'usuario' } });
  const tokOp = (await autenticarNoApp(app, { login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const A = await area(1, 'PASTO A');
  const B = await area(2, 'PASTO B');
  const at = await req('POST', '/rebanho/ativacao', tokAdm, { operation_id: opId(), empresa_id: empresa.id, data_corte: '2026-10-01' });
  assert.equal(at.statusCode, 201, at.body);
  const c = { cliente: adm.cliente, tokAdm, tokOp, login, empresa, setor, A, B };
  c.permitir = (dados) =>
    p.permissao.upsert({
      where: { cliente_id_user_email: { cliente_id: adm.cliente.id, user_email: login } },
      create: { cliente_id: adm.cliente.id, user_email: login, user_nome: 'Operador', ...dados },
      update: dados,
    });
  c.corpoLote = (nome = 'LOTE') => ({ empresa_id: empresa.id, nome, quantidade_cabecas: 100, categoria: 'Boi 25 a 36 meses', sexo: 'Macho', setor_id: setor.id, area_entrada_id: A.id, area_atual_id: A.id, data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 300 });
  const lote = await req('POST', '/lotes', tokAdm, c.corpoLote('BASE'));
  assert.equal(lote.statusCode, 201, lote.body);
  c.lote = lote.json();
  c.posicao = await p.posicaoRebanho.findFirst({ where: { cliente_id: adm.cliente.id, lote_entrada_id: c.lote.id } });
  return c;
};

const contar = async (c) => {
  const p = prisma();
  const where = { cliente_id: c.cliente.id };
  return JSON.stringify([
    await p.lote.count({ where }),
    await p.eventoRebanho.count({ where }),
    await p.partidaRebanho.count({ where }),
    await p.movimentacaoMapa.count({ where }),
    await p.areaPastagem.count({ where }),
    await p.auditLog.count({ where }),
    (await p.lote.findMany({ where, orderBy: { id: 'asc' } })).map((l) => [l.nome, l.raca_predominante, l.updatedAt.toISOString()]),
  ]);
};
const negado = async (c, acao) => {
  const antes = await contar(c);
  const r = await acao();
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA', r.body);
  assert.equal(await contar(c), antes, 'nenhuma escrita, nenhuma auditoria');
  return r;
};

const BOI = 'Boi 25 a 36 meses';
/** Um comando de cada ação do Mapa Geral (corpos válidos no schema). */
const COMANDOS_DO_MAPA = {
  'manejo-lote transferência': (c, tok) => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', tok, { operation_id: opId(), empresa_id: c.empresa.id, tipo: 'Transferência de Área', lote_id: c.posicao.id, quantidade_animais: 2, area_destino_id: c.B.id, data_movimentacao: '2026-11-01' }),
  'manejo-lote morte': (c, tok) => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', tok, { operation_id: opId(), empresa_id: c.empresa.id, tipo: 'Morte', lote_id: c.posicao.id, quantidade_animais: 1, data_movimentacao: '2026-11-01' }),
  morte: (c, tok) => req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', tok, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-01', linhas: [{ categoria: BOI, quantidade: 1, causa_morte: 'Doença' }] }),
  abate: (c, tok) => req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', tok, { operation_id: opId(), tipo: 'Abate', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-01', linhas: [{ categoria: BOI, quantidade: 1, destino: 'Consumo Próprio' }] }),
  nascimento: (c, tok) => req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', tok, { operation_id: opId(), tipo: 'Nascimento', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-01', linhas: [{ sexo: 'Macho', categoria_mae: 'Vaca', quantidade: 2, peso_medio_kg: 35 }] }),
  pesagem: (c, tok) => req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', tok, { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-01', linhas: [{ lote_id: c.posicao.id, peso_medio_kg: 420 }] }),
  'mudança de categoria': (c, tok) => req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', tok, { operation_id: opId(), tipo: 'Mudança de Categoria', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-01', linhas: [{ categoria_atual: BOI, categoria_nova: 'Touro', quantidade: 2 }] }),
  junção: (c, tok) => req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: c.posicao.id, lote_origem_ids: [c.posicao.id], data_movimentacao: '2026-11-01' }),
  'lançamento genérico': (c, tok) => req('POST', '/movimentacoes-mapa', tok, { empresa_id: c.empresa.id, tipo: 'Pesagem', lote_id: c.lote.id }),
};

const transferir = (c, token, qtd = 10) =>
  req('POST', '/rebanho/comandos/transferencia', token, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-01T12:00:00.000Z', itens: [{ posicao_id: c.posicao.id, quantidade: qtd }] });

/** Config real do proprietário: só Mapa Geral (ver), todas as ações de lote desligadas. */
const SO_VER_MAPA = {
  modulos_permitidos: ['mapa'],
  permissoes_telas: [linha('mapa', 'pec-mapa-geral', { visualizar: true }), linha('mapa', 'pec-mapa-cadastro', {})],
  mapa_geral_permissoes: { mover_lotes: false, pesar_lotes: false, juntar_lotes: false, renomear_lotes: false, registrar_abate: false, registrar_morte: false, registrar_nascimento: false, mudar_categoria_lotes: false },
};

describe('operador sem nenhuma permissão (sem linha) — nada por requisição direta', () => {
  test('POST /lotes, PATCH, DELETE, correção da entrada, transferência, área → 403 sem escrita', async () => {
    const c = await cenario();
    await negado(c, () => req('POST', '/lotes', c.tokOp, c.corpoLote('X')));
    await negado(c, () => req('PATCH', `/lotes/${c.lote.id}`, c.tokOp, { nome: 'HACK' }));
    await negado(c, () => req('DELETE', `/lotes/${c.lote.id}`, c.tokOp));
    await negado(c, () => req('POST', `/lotes/${c.lote.id}/correcao-entrada`, c.tokOp, { operation_id: opId(), motivo: 'x', estado_esperado: { updated_date: c.lote.updated_date }, campos: { quantidade: 1 } }));
    await negado(c, () => transferir(c, c.tokOp));
    await negado(c, () => req('POST', '/areas-pastagem', c.tokOp, { empresa_id: c.empresa.id, setor_id: c.setor.id, nome: 'HACK', tamanho_hectares: 1 }));
  });
});

describe('configuração real do proprietário: só ver o Mapa Geral', () => {
  test('transferência, junção, pesagem, nascimento, morte, abate, mudança de categoria, renomear → 403 sem escrita', async () => {
    const c = await cenario();
    await c.permitir(SO_VER_MAPA);
    await negado(c, () => transferir(c, c.tokOp));
    for (const comando of Object.values(COMANDOS_DO_MAPA)) await negado(c, () => comando(c, c.tokOp));
    await negado(c, () => req('PATCH', `/lotes/${c.lote.id}`, c.tokOp, { nome: 'NOVO NOME' }));
    await negado(c, () => req('POST', '/lotes', c.tokOp, c.corpoLote('X')));
  });

  test('com "mover lotes" concedido, a transferência passa (e só ela)', async () => {
    const c = await cenario();
    await c.permitir({ ...SO_VER_MAPA, mapa_geral_permissoes: { ...SO_VER_MAPA.mapa_geral_permissoes, mover_lotes: true } });
    const r = await transferir(c, c.tokOp);
    assert.equal(r.statusCode, 201, r.body);
    await negado(c, () => COMANDOS_DO_MAPA.abate(c, c.tokOp));
    await negado(c, () => COMANDOS_DO_MAPA.pesagem(c, c.tokOp));
    await negado(c, () => COMANDOS_DO_MAPA['manejo-lote morte'](c, c.tokOp));
    assert.notEqual((await COMANDOS_DO_MAPA['manejo-lote transferência'](c, c.tokOp)).statusCode, 403);
  });

  test('"Renomear lote" no mapa: PATCH só do nome passa; qualquer outro campo do cadastro → 403', async () => {
    const c = await cenario();
    await c.permitir({ ...SO_VER_MAPA, mapa_geral_permissoes: { ...SO_VER_MAPA.mapa_geral_permissoes, renomear_lotes: true } });
    const r = await req('PATCH', `/lotes/${c.lote.id}`, c.tokOp, { nome: 'NOVO NOME' });
    assert.equal(r.statusCode, 200, r.body);
    await negado(c, () => req('PATCH', `/lotes/${c.lote.id}`, c.tokOp, { raca_predominante: 'NELORE' }));
    await negado(c, () => req('PATCH', `/lotes/${c.lote.id}`, c.tokOp, { nome: 'X', observacoes: 'Y' }));
  });
});

describe('Cadastro de Lotes: módulo, tela e ação explícitos', () => {
  const manejo = (acoes) => ({ modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-lotes', acoes)] });

  test('"novo" concedido e "excluir" negado: cria (201), não exclui (403)', async () => {
    const c = await cenario();
    await c.permitir(manejo({ visualizar: true, novo: true }));
    const r = await req('POST', '/lotes', c.tokOp, c.corpoLote('DO OPERADOR'));
    assert.equal(r.statusCode, 201, r.body);
    await negado(c, () => req('DELETE', `/lotes/${r.json().id}`, c.tokOp));
    await negado(c, () => req('PATCH', `/lotes/${r.json().id}`, c.tokOp, { raca_predominante: 'NELORE' }));
  });

  test('tela não visível, módulo não concedido ou tela ausente da linha → 403 (sem liberar por padrão)', async () => {
    const c = await cenario();
    await c.permitir(manejo({ visualizar: false, novo: true }));
    await negado(c, () => req('POST', '/lotes', c.tokOp, c.corpoLote('X')));
    await c.permitir({ modulos_permitidos: [], permissoes_telas: [linha('manejo', 'pec-lotes', { visualizar: true, novo: true })] });
    await negado(c, () => req('POST', '/lotes', c.tokOp, c.corpoLote('X')));
    await c.permitir({ modulos_permitidos: ['manejo'], permissoes_telas: [] });
    await negado(c, () => req('POST', '/lotes', c.tokOp, c.corpoLote('X')));
  });

  test('"editar" concedido: correção da entrada (R1) e PATCH de cadastro passam', async () => {
    const c = await cenario();
    await c.permitir(manejo({ visualizar: true, editar: true }));
    const novo = await req('POST', '/lotes', c.tokAdm, c.corpoLote('PARA CORRIGIR'));
    const r = await req('POST', `/lotes/${novo.json().id}/correcao-entrada`, c.tokOp, { operation_id: opId(), motivo: 'digitação', estado_esperado: { updated_date: novo.json().updated_date }, campos: { quantidade: 120 } });
    assert.equal(r.statusCode, 200, r.body);
  });

  test('revogação vale na PRÓXIMA requisição (sem cache no servidor)', async () => {
    const c = await cenario();
    await c.permitir(manejo({ visualizar: true, novo: true }));
    assert.equal((await req('POST', '/lotes', c.tokOp, c.corpoLote('A'))).statusCode, 201);
    await c.permitir(manejo({ visualizar: true, novo: false }));
    await negado(c, () => req('POST', '/lotes', c.tokOp, c.corpoLote('B')));
  });
});

describe('administrador, concessão total legada e isolamento', () => {
  test('administrador real SEM linha de permissão: tudo liberado', async () => {
    const c = await cenario();
    assert.equal((await transferir(c, c.tokAdm)).statusCode, 201);
    // Autorizado (pode haver recusa de NEGÓCIO depois, nunca 403 de permissão).
    for (const comando of Object.values(COMANDOS_DO_MAPA)) {
      const r = await comando(c, c.tokAdm);
      assert.notEqual(r.statusCode, 403, r.body);
    }
  });

  test('linha com is_admin (acesso total a telas, concessão explícita): libera telas e mapa, NÃO as telas só do administrador', async () => {
    const c = await cenario();
    await c.permitir({ is_admin: true });
    assert.equal((await req('POST', '/lotes', c.tokOp, c.corpoLote('X'))).statusCode, 201);
    assert.equal((await transferir(c, c.tokOp)).statusCode, 201);
    const perm = await prisma().permissao.findFirst({ where: { cliente_id: c.cliente.id } });
    const r = await req('PATCH', `/permissoes/${perm.id}`, c.tokOp, { is_admin: true, modulos_permitidos: ['mapa'] });
    assert.equal(r.statusCode, 403, r.body);
    assert.equal(r.json().code, 'TENANT_ADMIN_REQUIRED');
  });

  test('linha de OUTRO tenant com o mesmo login não concede nada', async () => {
    const c = await cenario();
    const outro = await criarTenant();
    await prisma().permissao.create({ data: { cliente_id: outro.cliente.id, user_email: c.login, is_admin: true } });
    await negado(c, () => req('POST', '/lotes', c.tokOp, c.corpoLote('X')));
  });
});
