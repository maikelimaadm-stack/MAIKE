/**
 * D-PROD-268 — frente DEPÓSITO: cancelamento (estorno exato) da transferência entre depósitos pelas rotas
 *   POST /movimentacoes-estoque/:id/cancelar-transferencia
 *   GET  /movimentacoes-estoque/:id/elegibilidade-cancelamento-transferencia?empresa_id=…
 * Contra PostgreSQL real e HTTP autenticado. Montagem pelas rotas de sempre (entrada documentada,
 * transferência, baixa do cocho). Depois de cada cancelamento, a reconciliação (I1–I5) fica limpa.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import {
  cancelarTransferencia as cancelarNoServico,
  TIPO_OPERACAO_CANCELAR_TRANSFERENCIA,
  ACAO_AUDITORIA_CANCELAR_TRANSFERENCIA,
} from '../src/modules/movimentacoesEstoque/transferenciaEstornoService.js';
import { TIPO_ESTORNO_TRANSFERENCIA_ENVIADA, TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

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

const chamar = (method, url, token, payload) => app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const qs = (obj) => '?' + new URLSearchParams(obj).toString();
const hoje = () => new Date().toISOString().slice(0, 10);
const opId = () => `canc-${randomUUID()}`;

const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const doMapa = (mapa) => ({ modulos_permitidos: ['mapa'], permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', ...acoes(false), visualizar: true }], mapa_geral_permissoes: mapa });

let seq = 0;
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const e2 = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 2, apelido: 'E2', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda 2 ${c}` } });
  const p = await prisma().produto.create({ data: { cliente_id: c, empresa_id: e.id, numero_produto: String(++seq + 1000), nome_produto: 'Sal mineral', unidade_principal_estoque: 'KG' } });
  const outro = await prisma().produto.create({ data: { cliente_id: c, empresa_id: e.id, numero_produto: String(++seq + 1000), nome_produto: 'Ureia', unidade_principal_estoque: 'KG' } });
  const local = (nome) => prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome } });
  const galpao = await local('Galpão');
  const barracao = await local('Barracão');
  const retiro = await local('Retiro');
  const token = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const compra = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items.find((m) => m.nome === 'Compra').id;
  return { adm, c, e, e2, p, outro, galpao, barracao, retiro, token, compra };
};

/** Conta comum (papel `usuario`) com a linha de Permissão dada. */
const conta = async (x, permissao) => {
  const hash = (await prisma().usuario.findUnique({ where: { id: x.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  const u = await prisma().usuario.create({ data: { cliente_id: x.c, nome: 'Operador', login, senha_hash: hash, papel_tenant: 'usuario' } });
  if (permissao) await prisma().permissao.create({ data: { cliente_id: x.c, user_email: login, user_nome: 'Operador', ...permissao } });
  const { corpo } = await autenticarNoApp(app, { login, senha: x.adm.credenciais.senha });
  assert.ok(corpo.token);
  return { token: corpo.token, login, usuarioId: u.id };
};

const entrar = async (x, kg, custo, deposito = x.galpao, produto = x.p) => {
  const r = await chamar('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: deposito.id, unidade: 'KG', quantidade: kg, custo_unitario: custo }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const transferir = async (x, kg, origem = x.galpao, destino = x.barracao, produto = x.p) => {
  const r = await chamar('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e.id, produto_id: produto.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade: kg,
  });
  assert.equal(r.statusCode, 201, r.body);
  return { s: r.json().movimentacao_saida, r: r.json().movimentacao_entrada };
};
const suplementar = async (x, kg, deposito) => {
  const r = await chamar('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
    operation_id: `sup-${randomUUID()}`, empresa_id: x.e.id, produto_id: x.p.id, local_origem_id: deposito.id, quantidade: kg, ponto_suplementacao_id: 'ponto-1',
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().movimentacao;
};

const cancelar = (x, id, { token = x.token, operation_id = opId(), motivo = 'transferida para o depósito errado', empresa_id = x.e.id, ...extra } = {}) =>
  chamar('POST', `/movimentacoes-estoque/${id}/cancelar-transferencia`, token, { empresa_id, motivo, operation_id, ...extra });
const elegibilidade = (x, id, { token = x.token, empresa_id = x.e.id } = {}) =>
  chamar('GET', `/movimentacoes-estoque/${id}/elegibilidade-cancelamento-transferencia${qs({ empresa_id })}`, token);

const mov = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const estoqueAtual = async (x) => (await prisma().produto.findUnique({ where: { id: x.p.id } })).estoque_atual.toString();
const camadas = async (x, deposito) =>
  (await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, produto_id: x.p.id, local_estoque_id: deposito.id }, orderBy: { createdAt: 'asc' } }))
    .map((l) => [l.id, l.quantidade_disponivel.toString(), l.status]);
/** Tudo que uma recusa não pode ter mudado (inclusive recibo e auditoria). */
const retrato = async (x) => ({
  movimentos: await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, movimento_filho_id: true, numero_movimentacao: true } }),
  lotes: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, quantidade_disponivel: true, custo_unitario: true } }),
  produtos: await prisma().produto.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true } }),
  auditoria: await prisma().auditLog.count({ where: { cliente_id: x.c } }),
  recibos: await prisma().operacaoIdempotente.count({ where: { cliente_id: x.c } }),
});
const reconciliacaoLimpa = async (x) => {
  const rec = await chamar('GET', `/estoque-fisico/reconciliacao${qs({ empresa_id: x.e.id })}`, x.token);
  assert.equal(rec.statusCode, 200, rec.body);
  assert.deepEqual(rec.json().achados, [], rec.body.slice(0, 1500));
};
const erro = (r, status, code, reason) => {
  assert.equal(r.statusCode, status, r.body);
  const j = r.json();
  assert.equal(j.code, code, r.body);
  if (reason !== undefined) assert.equal(j.reason ?? j.details?.reason, reason, r.body);
  return j;
};

describe('D-PROD-268 depósito — POST cancelar-transferencia', () => {
  test('caminho feliz pela Saída: ensaio elegível, estorno exato, números n/n+1, 3 AuditLog, recibo; replay, conflito e nova chave', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    await entrar(x, '100', '4');
    const origemAntes = await camadas(x, x.galpao);
    const { s, r } = await transferir(x, 130);
    assert.equal(await estoqueAtual(x), '200');

    const g = elegibilidade(x, s.id);
    const ge = (await g).json();
    assert.equal((await g).statusCode, 200, (await g).body);
    assert.deepEqual([ge.elegivel, ge.pode_cancelar, ge.requer_permissao, ge.codigo], [true, true, 'cancelar_lancamentos_estoque', null], JSON.stringify(ge));
    assert.deepEqual([ge.efeitos.quantidade, ge.efeitos.origem.nome, ge.efeitos.destino.nome, ge.efeitos.numero_saida], ['130.0000', 'Galpão', 'Barracão', s.numero_movimentacao]);
    const depoisDoEnsaio = await retrato(x);

    const chave = opId();
    const res = await cancelar(x, s.id, { operation_id: chave });
    assert.equal(res.statusCode, 200, res.body);
    const b = res.json();
    assert.deepEqual([b.committed, b.replay, b.operation_id], [true, false, chave]);
    assert.deepEqual([b.movimentacao_saida.id, b.movimentacao_saida.status, b.movimentacao_saida.movimento_filho_id], [s.id, 'Estornada', r.id]);
    assert.deepEqual([b.movimentacao_entrada.id, b.movimentacao_entrada.status, b.movimentacao_entrada.movimento_filho_id], [r.id, 'Estornada', b.estorno_destino.id]);
    assert.deepEqual(
      [b.estorno_destino.tipo_movimentacao, b.estorno_destino.tipo_detalhado, b.estorno_destino.movimento_pai_id, b.estorno_destino.local_estoque_origem, b.estorno_destino.local_estoque_destino],
      ['Saída', TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA, r.id, x.barracao.id, null],
    );
    assert.deepEqual(
      [b.estorno_origem.tipo_movimentacao, b.estorno_origem.tipo_detalhado, b.estorno_origem.movimento_pai_id, b.estorno_origem.local_estoque_destino, b.estorno_origem.local_estoque_origem],
      ['Entrada', TIPO_ESTORNO_TRANSFERENCIA_ENVIADA, s.id, x.galpao.id, null],
    );
    assert.equal(Number(b.estorno_origem.numero_movimentacao), Number(b.estorno_destino.numero_movimentacao) + 1);
    assert.match(b.estorno_destino.numero_movimentacao, /^[0-9]+$/);
    assert.equal(b.estorno_destino.valor_total, s.valor_total);
    assert.match(b.estorno_destino.motivo_movimentacao, new RegExp(`^Cancelamento da transferência ${s.numero_movimentacao}: transferida para o depósito errado$`));
    assert.equal(b.devolvido.length, 2);
    assert.equal('cliente_id' in b.estorno_destino, false);
    // estoque físico
    assert.deepEqual(await camadas(x, x.galpao), origemAntes);
    assert.ok((await camadas(x, x.barracao)).every(([, disp, status]) => disp === '0' && status === 'Estornado'));
    assert.equal(await estoqueAtual(x), '200');
    // auditoria e recibo
    const audit = await prisma().auditLog.findMany({ where: { cliente_id: x.c, OR: [{ entidade_id: { in: [b.estorno_destino.id, b.estorno_origem.id] } }, { acao: ACAO_AUDITORIA_CANCELAR_TRANSFERENCIA }] } });
    assert.equal(audit.length, 3);
    const evento = audit.find((a) => a.acao === ACAO_AUDITORIA_CANCELAR_TRANSFERENCIA);
    assert.deepEqual([evento.entidade, evento.entidade_id, evento.usuario_id, evento.dados_novos.motivo_informado], ['MovimentacaoEstoque', s.id, x.adm.usuario.id, true]);
    const recibo = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: x.c, operation_key: chave } });
    assert.deepEqual([recibo.tipo_operacao, recibo.status], [TIPO_OPERACAO_CANCELAR_TRANSFERENCIA, 'committed']);
    assert.equal(depoisDoEnsaio.recibos + 1, (await retrato(x)).recibos, 'o ensaio não gravou recibo');
    await reconciliacaoLimpa(x);

    // replay: mesma chave e mesmo corpo → mesmo corpo, sem efeito novo
    const antesReplay = await retrato(x);
    const rep = await cancelar(x, s.id, { operation_id: chave });
    assert.equal(rep.statusCode, 200, rep.body);
    assert.deepEqual(rep.json(), { ...b, replay: true });
    assert.deepEqual(await retrato(x), antesReplay);
    // mesma chave com outro motivo → conflito
    erro(await cancelar(x, s.id, { operation_id: chave, motivo: 'outro motivo qualquer' }), 409, 'IDEMPOTENCY_CONFLICT');
    // chave nova depois de cancelada → já estornada (pelas duas pernas)
    erro(await cancelar(x, s.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'original_ja_estornado');
    erro(await cancelar(x, r.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'original_ja_estornado');
    const g2 = (await elegibilidade(x, s.id)).json();
    assert.deepEqual([g2.elegivel, g2.codigo, g2.detalhes.reason], [false, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'original_ja_estornado']);
    assert.deepEqual(await retrato(x), antesReplay);
  });

  test('pela Entrada (R), custo exato: destino volta a 10 kg a 1,00; DELETE continua recusado', async () => {
    const x = await cenario();
    await entrar(x, '10', '10');
    await entrar(x, '10', '1', x.barracao);
    const destinoAntes = await camadas(x, x.barracao);
    const { s, r } = await transferir(x, 10);
    const res = await cancelar(x, r.id);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().movimentacao_saida.id, s.id);
    const disp = (await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, local_estoque_id: x.barracao.id, status: 'Disponivel' } }));
    assert.deepEqual(disp.map((l) => [l.quantidade_disponivel.toString(), l.custo_unitario.toString()]), [['10', '1']]);
    assert.deepEqual((await camadas(x, x.barracao)).slice(0, 1), destinoAntes);
    assert.equal((await mov(res.json().estorno_destino.id)).custo_medio_depois.toString(), '1');
    erro(await chamar('DELETE', `/movimentacoes-estoque/${s.id}`, x.token), 409, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO');
    await reconciliacaoLimpa(x);
  });

  test('regra do último nos DOIS depósitos: cocho no destino e entrada na origem recusam (ensaio e POST, nada muda); outro produto não conta; cadeia A→B→C só pelo último', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const t1 = await transferir(x, 30);
    await entrar(x, '5', '9', x.galpao, x.outro);
    await suplementar(x, 5, x.barracao);
    const ret = await retrato(x);
    const g = (await elegibilidade(x, t1.s.id)).json();
    assert.deepEqual([g.elegivel, g.codigo, g.detalhes.reason, g.detalhes.lado], [false, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior', 'destino'], JSON.stringify(g));
    assert.equal(g.efeitos.quantidade, '30.0000');
    const j = erro(await cancelar(x, t1.s.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior');
    assert.deepEqual([j.details.lado, j.details.local_estoque_id], ['destino', x.barracao.id]);
    assert.match(String(j.details.movimento_numero), /^[0-9]+$/);
    assert.deepEqual(await retrato(x), ret);

    const t2 = await transferir(x, 20);
    await entrar(x, '1', '3');
    const j2 = erro(await cancelar(x, t2.r.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior');
    assert.deepEqual([j2.details.lado, j2.details.local_estoque_id], ['origem', x.galpao.id]);

    // outro produto nos mesmos locais não bloqueia
    const y = await cenario();
    await entrar(y, '50', '2');
    await entrar(y, '50', '2', y.galpao, y.outro);
    const ty = await transferir(y, 10);
    await transferir(y, 5, y.galpao, y.barracao, y.outro);
    assert.equal((await cancelar(y, ty.s.id)).statusCode, 200);
    await reconciliacaoLimpa(y);

    // cadeia A→B→C: só o último elo; depois dele o primeiro continua bloqueado (B teve movimento)
    const z = await cenario();
    await entrar(z, '50', '2');
    const ab = await transferir(z, 20, z.galpao, z.barracao);
    const bc = await transferir(z, 10, z.barracao, z.retiro);
    erro(await cancelar(z, ab.s.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior');
    assert.equal((await cancelar(z, bc.s.id)).statusCode, 200);
    erro(await cancelar(z, ab.s.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior');
    await reconciliacaoLimpa(z);
  });

  test('locais: origem inativa → 422 local_inativo (nada muda); destino inativo aceito', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const t = await transferir(x, 30);
    await prisma().localEstoque.update({ where: { id: x.galpao.id }, data: { ativo: false } });
    const ret = await retrato(x);
    erro(await cancelar(x, t.s.id), 422, 'ESTOQUE_LOCAL_INVALIDO', 'local_inativo');
    const g = (await elegibilidade(x, t.s.id)).json();
    assert.deepEqual([g.elegivel, g.codigo, g.detalhes.reason, g.detalhes.field], [false, 'ESTOQUE_LOCAL_INVALIDO', 'local_inativo', 'local_origem_id']);
    assert.deepEqual(await retrato(x), ret);
    await prisma().localEstoque.update({ where: { id: x.galpao.id }, data: { ativo: true } });
    await prisma().localEstoque.update({ where: { id: x.barracao.id }, data: { ativo: false } });
    assert.equal((await cancelar(x, t.s.id)).statusCode, 200);
    await reconciliacaoLimpa(x);
  });

  test('identidade, tenancy e contrato: 404 iguais, empresa de outro tenant, nao_e_transferencia, campos extras e motivo vazio → 400', async () => {
    const x = await cenario();
    const outro = await cenario();
    await entrar(x, '100', '2');
    const t = await transferir(x, 30);
    const sup = await suplementar(x, 5, x.galpao);
    const ret = await retrato(x);
    const inexistente = erro(await cancelar(x, 'id-que-nao-existe'), 404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND');
    // o id de outro tenant: mesmo corpo do inexistente (sem request_id)
    await entrar(outro, '10', '2');
    const tOutro = await transferir(outro, 5);
    const deOutroTenant = erro(await cancelar(x, tOutro.s.id), 404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND');
    const semId = (j) => ({ code: j.code, message: j.message, details: j.details ?? null });
    assert.deepEqual(semId(deOutroTenant), semId(inexistente));
    erro(await elegibilidade(x, tOutro.s.id), 404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND');
    // empresa do mesmo tenant, mas não a do movimento → 404 do movimento; empresa de outro tenant → 404 da empresa
    erro(await cancelar(x, t.s.id, { empresa_id: x.e2.id }), 404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND');
    erro(await cancelar(x, t.s.id, { empresa_id: outro.e.id }), 404, 'EMPRESA_NOT_FOUND');
    erro(await elegibilidade(x, t.s.id, { empresa_id: outro.e.id }), 404, 'EMPRESA_NOT_FOUND');
    // não é transferência
    erro(await cancelar(x, sup.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'nao_e_transferencia');
    // contrato: nada de tenant, quantidade ou local no corpo; motivo vazio/curto; sem chave
    for (const extra of [{ cliente_id: outro.c }, { quantidade: 1 }, { local_origem_id: x.retiro.id }, { valor_total: 0 }]) {
      assert.equal((await cancelar(x, t.s.id, extra)).statusCode, 400);
    }
    for (const motivo of ['', '   ', ' a ', 'x'.repeat(501)]) assert.equal((await cancelar(x, t.s.id, { motivo })).statusCode, 400, `motivo ${JSON.stringify(motivo)}`);
    assert.equal((await chamar('POST', `/movimentacoes-estoque/${t.s.id}/cancelar-transferencia`, x.token, { empresa_id: x.e.id, motivo: 'motivo ok' })).statusCode, 400);
    assert.equal((await chamar('GET', `/movimentacoes-estoque/${t.s.id}/elegibilidade-cancelamento-transferencia`, x.token)).statusCode, 400);
    assert.equal((await cancelar(x, t.s.id, { token: null })).statusCode, 401);
    assert.deepEqual(await retrato(x), ret);
    // a baixa do cocho na ORIGEM depois da transferência bloqueia (regra do último no lado da origem)
    const j = erro(await cancelar(x, t.s.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior');
    assert.deepEqual([j.details.lado, j.details.local_estoque_id, j.details.movimento_numero], ['origem', x.galpao.id, sup.numero_movimentacao]);
    assert.deepEqual(await retrato(x), ret);
  });

  test('legado sem fatias recusa (fatias_ausentes), nada muda', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const t = await transferir(x, 30);
    await prisma().movimentacaoEstoque.update({ where: { id: t.s.id }, data: { lotes_consumidos: null } });
    const ret = await retrato(x);
    erro(await cancelar(x, t.s.id), 409, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'fatias_ausentes');
    const g = (await elegibilidade(x, t.r.id)).json();
    assert.deepEqual([g.elegivel, g.detalhes.reason], [false, 'fatias_ausentes']);
    assert.deepEqual(await retrato(x), ret);
  });

  test('permissão: operador sem a chave ou só com movimentar_depositos → 403 (POST e GET, nada muda); chave true e is_admin → 200; revogada no meio → 403 sem recibo', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const t1 = await transferir(x, 10);
    const semChave = await conta(x, doMapa({ movimentar_depositos: true, lancar_suplementacao: true }));
    const naoBooleana = await conta(x, doMapa({ cancelar_lancamentos_estoque: 'true' }));
    const semLinha = await conta(x, null);
    const ret = await retrato(x);
    for (const { token } of [semChave, naoBooleana, semLinha]) {
      erro(await cancelar(x, t1.s.id, { token }), 403, 'ACAO_NAO_PERMITIDA');
      erro(await elegibilidade(x, t1.s.id, { token }), 403, 'ACAO_NAO_PERMITIDA');
    }
    assert.deepEqual(await retrato(x), ret);

    const com = await conta(x, doMapa({ cancelar_lancamentos_estoque: true }));
    const g = (await elegibilidade(x, t1.s.id, { token: com.token })).json();
    assert.deepEqual([g.elegivel, g.pode_cancelar], [true, true]);
    const ok = await cancelar(x, t1.s.id, { token: com.token });
    assert.equal(ok.statusCode, 200, ok.body);
    const evento = await prisma().auditLog.findFirst({ where: { cliente_id: x.c, acao: ACAO_AUDITORIA_CANCELAR_TRANSFERENCIA, entidade_id: t1.s.id } });
    assert.equal(evento.usuario_id, com.usuarioId, 'ator do auth_context');

    const t2 = await transferir(x, 10);
    const isAdmin = await conta(x, { is_admin: true });
    assert.equal((await cancelar(x, t2.s.id, { token: isAdmin.token })).statusCode, 200);

    // revogada entre a tela e a transação: o serviço relê do banco e nega antes do recibo
    const t3 = await transferir(x, 10);
    await prisma().permissao.updateMany({ where: { cliente_id: x.c, user_email: com.login }, data: { mapa_geral_permissoes: { cancelar_lancamentos_estoque: false } } });
    const antes = await retrato(x);
    await assert.rejects(
      cancelarNoServico({ requestId: 'svc-1', auth: { clienteId: x.c, usuarioId: com.usuarioId, login: com.login } }, t3.s.id, { empresa_id: x.e.id, motivo: 'lançado errado', operation_id: opId() }),
      (e) => e?.code === 'ACAO_NAO_PERMITIDA',
    );
    assert.deepEqual(await retrato(x), antes);
    await reconciliacaoLimpa(x);
  });

  test('concorrência: dois cancelamentos com chaves diferentes → um 200 e um 409, uma devolução só', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const origemAntes = await camadas(x, x.galpao);
    const t = await transferir(x, 40);
    const [a, b] = await Promise.all([cancelar(x, t.s.id), cancelar(x, t.r.id)]);
    const status = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(status, [200, 409], `${a.body} | ${b.body}`);
    const perdedor = a.statusCode === 409 ? a : b;
    assert.ok(['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'CONCURRENCY_CONFLICT'].includes(perdedor.json().code), perdedor.body);
    assert.deepEqual(await camadas(x, x.galpao), origemAntes);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c, tipo_detalhado: TIPO_ESTORNO_TRANSFERENCIA_ENVIADA } }), 1);
    await reconciliacaoLimpa(x);
  });
});
