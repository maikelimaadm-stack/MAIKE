/**
 * D-PROD-266 — exclusão definitiva de movimentação do lote (D-PROD-110) liberada
 * para quem tem permissão: administrador real OU concessão `is_admin` OU a chave
 * do Mapa Geral `excluir_movimentacoes_lote` (gravadora: só `=== true`; nasce
 * desligada). Vale para o POST e para o ensaio da elegibilidade (GET), que antes
 * qualquer autenticado disparava.
 *
 * PostgreSQL real e isolado (DATABASE_URL de teste) + HTTP autenticado.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { excluir as excluirNoServico } from '../src/modules/movimentacoesMapa/movimentacaoMapaExclusaoService.js';

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
const opId = () => `op-${randomUUID()}`;
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linhaMapa = (visualizar = true) => ({ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', ...acoes(false), visualizar });

/** Tenant com admin real, empresa, duas áreas, um lote de 10 em A, ledger ativado. */
const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const c = { adm, cliente: adm.cliente, tok, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
  c.lote = await ok(req('POST', '/lotes', tok, {
    empresa_id: empresa.id, nome: 'LOTE', quantidade_cabecas: 10, categoria: 'Boi 25 a 36 meses', sexo: 'Macho', setor_id: setor.id,
    area_entrada_id: c.A.id, area_atual_id: c.A.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400,
  }));
  await ok(req('POST', '/rebanho/ativacao', tok, { operation_id: opId(), empresa_id: empresa.id, modo: 'entradas' }));
  c.posA = await p.posicaoRebanho.findFirst({ where: { cliente_id: c.cliente.id, lote_entrada_id: c.lote.id, area_id: c.A.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return c;
};
/** Transferência certificada do ledger (1 cabeça A → B por vez, datas crescentes). */
let dia = 10;
const transferir = async (c) => {
  dia += 1;
  const r = await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, {
    operation_id: opId(), empresa_id: c.empresa.id, tipo: 'Transferência de Área', lote_id: c.posA.id, quantidade_animais: 1,
    area_destino_id: c.B.id, data_movimentacao: `2026-10-${String(dia).padStart(2, '0')}`,
  }));
  return r.movimentacao;
};

/** Conta comum (papel `usuario`) com a linha de Permissão dada; devolve token e login. */
const conta = async (c, permissao) => {
  const p = prisma();
  const hash = (await p.usuario.findUnique({ where: { id: c.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await p.usuario.create({ data: { cliente_id: c.cliente.id, nome: 'Operador', login, senha_hash: hash, papel_tenant: 'usuario' } });
  if (permissao) await p.permissao.create({ data: { cliente_id: c.cliente.id, user_email: login, user_nome: 'Operador', ...permissao } });
  const { corpo } = await autenticarNoApp(app, { login, senha: c.adm.credenciais.senha });
  assert.ok(corpo.token, 'login da conta comum');
  const usuario = await p.usuario.findFirst({ where: { cliente_id: c.cliente.id, login } });
  return { token: corpo.token, login, usuarioId: usuario.id };
};
const doMapa = (mapa, { tela = true } = {}) => ({ modulos_permitidos: ['mapa'], permissoes_telas: [linhaMapa(tela)], mapa_geral_permissoes: mapa });

const excluir = (id, token, operationId = opId()) => req('POST', `/movimentacoes-mapa/${id}/exclusao`, token, { operation_id: operationId, motivo: 'lançado errado' });
const elegibilidade = (id, token) => req('GET', `/movimentacoes-mapa/${id}/elegibilidade-exclusao`, token);
const existe = async (id) => (await prisma().movimentacaoMapa.count({ where: { id } })) === 1;
const auditorias = (c, id) => prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'MovimentacaoMapa', entidade_id: id, acao: 'exclusao_definitiva' } });

const negado = async (r) => {
  const x = await r;
  assert.equal(x.statusCode, 403, x.body);
  assert.equal(x.json().code, 'ACAO_NAO_PERMITIDA', x.body);
};

describe('D-PROD-266 — guarda da exclusão de movimentação do lote', () => {
  test('operador SEM a chave (ausente, não booleana, sem tela, sem linha) → 403 no POST e no ensaio; nada muda', async () => {
    const c = await cenario();
    const mov = await transferir(c);
    const semChave = await conta(c, doMapa({ mover_lotes: true, visualizar_historico_movimentacoes_lote: true }));
    const naoBooleana = await conta(c, doMapa({ excluir_movimentacoes_lote: 'true' }));
    const semTela = await conta(c, doMapa({ excluir_movimentacoes_lote: true }, { tela: false }));
    const semLinha = await conta(c, null);
    for (const { token } of [semChave, naoBooleana, semTela, semLinha]) {
      await negado(excluir(mov.id, token));
      await negado(elegibilidade(mov.id, token));
    }
    assert.equal(await existe(mov.id), true);
    assert.equal(await auditorias(c, mov.id), 0);
  });

  test('operador COM a chave → ensaio pode_excluir=true e POST exclui; replay idempotente; ator do auth_context', async () => {
    const c = await cenario();
    const mov = await transferir(c);
    const com = await conta(c, doMapa({ excluir_movimentacoes_lote: true }));
    const e = await ok(elegibilidade(mov.id, com.token), 200);
    assert.deepEqual([e.elegivel, e.pode_excluir, e.requer_permissao], [true, true, 'excluir_movimentacoes_lote'], JSON.stringify(e));
    const chave = opId();
    const r = await ok(excluir(mov.id, com.token, chave), 200);
    assert.deepEqual([r.excluida, r.movimentacao_id, r.replay], [true, mov.id, false], JSON.stringify(r));
    assert.equal(await existe(mov.id), false);
    assert.equal(await auditorias(c, mov.id), 1);
    // Mesma chave: mesmo corpo, sem segundo estorno.
    const replay = await ok(excluir(mov.id, com.token, chave), 200);
    assert.equal(replay.replay, true);
    assert.equal(await auditorias(c, mov.id), 1);
    // Ator: o usuário autenticado (nada vem do corpo).
    const usuario = await prisma().usuario.findFirst({ where: { cliente_id: c.cliente.id, login: com.login } });
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: c.cliente.id, entidade_id: mov.id, acao: 'exclusao_definitiva' } });
    assert.equal(audit.usuario_id, usuario.id, 'auditoria com o ator autenticado');
  });

  test('administrador real e concessão is_admin → passam', async () => {
    const c = await cenario();
    const m1 = await transferir(c);
    const m2 = await transferir(c);
    // Do mais recente para o mais antigo (dependência causal de saldo).
    const isAdmin = await conta(c, { is_admin: true });
    assert.equal((await ok(elegibilidade(m2.id, isAdmin.token), 200)).pode_excluir, true);
    await ok(excluir(m2.id, isAdmin.token), 200);
    assert.equal((await ok(elegibilidade(m1.id, c.tok), 200)).pode_excluir, true);
    await ok(excluir(m1.id, c.tok), 200);
    assert.equal(await existe(m1.id), false);
    assert.equal(await existe(m2.id), false);
  });

  test('serviço chamado SEM o preHandler: a guarda dentro da transação nega sozinha (defesa em profundidade)', async () => {
    const c = await cenario();
    const mov = await transferir(c);
    const semChave = await conta(c, doMapa({ mover_lotes: true }));
    const com = await conta(c, doMapa({ excluir_movimentacoes_lote: true }));
    const contexto = (u) => ({ requestId: `svc-${randomUUID().slice(0, 8)}`, auth: { clienteId: c.cliente.id, usuarioId: u.usuarioId, login: u.login } });
    const operacoesAntes = await prisma().operacaoIdempotente.count({ where: { cliente_id: c.cliente.id } });
    await assert.rejects(
      excluirNoServico(contexto(semChave), mov.id, { operation_id: opId(), motivo: 'lançado errado' }),
      (erro) => erro?.code === 'ACAO_NAO_PERMITIDA',
    );
    assert.equal(await existe(mov.id), true);
    assert.equal(await auditorias(c, mov.id), 0);
    assert.equal(await prisma().operacaoIdempotente.count({ where: { cliente_id: c.cliente.id } }), operacoesAntes, 'negou antes da idempotência');
    // Revogada entre a tela e a transação: o serviço relê do banco e nega.
    await prisma().permissao.updateMany({ where: { cliente_id: c.cliente.id, user_email: com.login }, data: { mapa_geral_permissoes: { excluir_movimentacoes_lote: false } } });
    await assert.rejects(
      excluirNoServico(contexto(com), mov.id, { operation_id: opId(), motivo: 'lançado errado' }),
      (erro) => erro?.code === 'ACAO_NAO_PERMITIDA',
    );
    assert.equal(await existe(mov.id), true);
  });

  test('chave revogada no banco → 403 na próxima chamada (relido a cada pedido); outro tenant com a chave → 404', async () => {
    const c = await cenario();
    const mov = await transferir(c);
    const com = await conta(c, doMapa({ excluir_movimentacoes_lote: true }));
    assert.equal((await ok(elegibilidade(mov.id, com.token), 200)).pode_excluir, true);
    await prisma().permissao.updateMany({ where: { cliente_id: c.cliente.id, user_email: com.login }, data: { mapa_geral_permissoes: { excluir_movimentacoes_lote: false } } });
    await negado(excluir(mov.id, com.token));
    await negado(elegibilidade(mov.id, com.token));
    const outro = await cenario();
    const deFora = await conta(outro, doMapa({ excluir_movimentacoes_lote: true }));
    const r = await excluir(mov.id, deFora.token);
    assert.equal(r.statusCode, 404, r.body);
    assert.equal((await elegibilidade(mov.id, deFora.token)).statusCode, 404);
    assert.equal(await existe(mov.id), true);
  });
});
