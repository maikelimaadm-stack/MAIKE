/**
 * R2A (D-PROD-95) — fechamento de rotas destrutivas e cancelamento transacional
 * de movimentação do mapa. PostgreSQL real, dados sintéticos.
 *
 * O "fluxo legado" abaixo reproduz o DetalhesLote: cada passo é uma chamada
 * HTTP separada (movimento + PATCH do lote), exatamente como em produção.
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

const auth = (token) => ({ authorization: `Bearer ${token}` });
const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? auth(token) : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;

/** Tenant com admin + usuário comum, empresa, setor e duas áreas. */
const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const comum = await p.usuario.create({
    data: {
      cliente_id: adm.cliente.id,
      nome: 'Comum',
      login: `comum-${randomUUID().slice(0, 8)}`,
      senha_hash: (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash,
      papel_tenant: 'usuario',
    },
  });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const tokComum = (await autenticarNoApp(app, { login: comum.login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = async (n, nome) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tokAdm, tokComum, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
};

const criarLote = async (c, { nome = 'NELORE', qtd = 500, area, extra = {} }) => {
  const r = await req('POST', '/lotes', c.tokAdm, {
    empresa_id: c.empresa.id,
    nome,
    quantidade_cabecas: qtd,
    categoria: 'BOI',
    sexo: 'Macho',
    setor_id: c.setor.id,
    area_entrada_id: area.id,
    area_atual_id: area.id,
    data_entrada: '2026-10-01',
    motivo_entrada: 'Compra',
    status: 'Ativo',
    ...extra,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const patchLote = async (c, id, patch) => {
  const r = await req('PATCH', `/lotes/${id}`, c.tokAdm, patch);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const criarMov = async (c, dados) => {
  const r = await req('POST', '/movimentacoes-mapa', c.tokAdm, { empresa_id: c.empresa.id, data_movimentacao: '2026-10-30T12:00:00.000Z', ...dados });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const lote = async (id) => prisma().lote.findUnique({ where: { id } });
const mov = async (id) => prisma().movimentacaoMapa.findUnique({ where: { id } });
const cancelar = (c, id, token = c.tokAdm, body = { operation_id: opId(), motivo: 'lançado por engano' }) =>
  req('POST', `/movimentacoes-mapa/${id}/cancelamento`, token, body);

/** Morte pelo fluxo legado do DetalhesLote: movimento primeiro, depois PATCH do lote. */
const morteLegada = async (c, l, q, tipo = 'Morte') => {
  const m = await criarMov(c, { tipo, lote: l.nome, lote_id: l.id, quantidade_animais: q, area_origem_id: l.area_atual_id });
  await patchLote(c, l.id, { quantidade_cabecas: l.quantidade_cabecas - q, ...(l.quantidade_cabecas - q === 0 ? { status: 'Inativo' } : {}) });
  return m;
};

// ─── P0 — rotas destrutivas fechadas no servidor ──────────────────────────

describe('P0 — MovimentacaoMapa e MovimentacaoPecuaria', () => {
  test('DELETE e PATCH diretos → 409 MOVIMENTO_CANCELAMENTO_OBRIGATORIO; nada muda; outro tenant → 404', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    const antes = await mov(m.id);

    for (const [metodo, corpo] of [['DELETE', undefined], ['PATCH', { quantidade_animais: 1 }], ['PATCH', { observacoes: 'só texto' }]]) {
      const r = await req(metodo, `/movimentacoes-mapa/${m.id}`, c.tokAdm, corpo);
      assert.equal(r.statusCode, 409, `${metodo} ${r.body}`);
      assert.equal(r.json().code, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO');
    }
    assert.deepEqual((await mov(m.id)).dados, antes.dados);
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);

    const outro = await cenario();
    assert.equal((await req('DELETE', `/movimentacoes-mapa/${m.id}`, outro.tokAdm)).statusCode, 404);
    assert.equal((await req('DELETE', `/movimentacoes-mapa/${m.id}`)).statusCode, 401);
  });

  test('POST e bulk recusam campos reservados de cancelamento (400) — nada gravado', async () => {
    const c = await cenario();
    for (const campo of ['situacao', 'cancelamento', 'cancelado', 'estorno']) {
      const r = await req('POST', '/movimentacoes-mapa', c.tokAdm, { empresa_id: c.empresa.id, tipo: 'Morte', [campo]: campo === 'situacao' ? 'cancelado' : {} });
      assert.equal(r.statusCode, 400, campo);
      assert.equal(r.json().code, 'CAMPO_RESERVADO_CANCELAMENTO');
    }
    assert.equal(await prisma().movimentacaoMapa.count(), 0);
  });

  test('movimentacoes-pecuaria: PATCH e DELETE bloqueados', async () => {
    const c = await cenario();
    const criado = await req('POST', '/movimentacoes-pecuaria', c.tokAdm, { empresa_id: c.empresa.id, tipo: 'Entrada', quantidade: 10 });
    assert.equal(criado.statusCode, 201);
    assert.equal((await req('PATCH', `/movimentacoes-pecuaria/${criado.json().id}`, c.tokAdm, { quantidade: 99 })).json().code, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO');
    assert.equal((await req('DELETE', `/movimentacoes-pecuaria/${criado.json().id}`, c.tokAdm)).statusCode, 409);
  });
});

describe('P0 — suplementação e estoque', () => {
  test('SuplementacaoEvento: só métricas de período; DELETE 409; reservado 400', async () => {
    const c = await cenario();
    const ev = (await req('POST', '/suplementacao-eventos', c.tokAdm, { empresa_id: c.empresa.id, quantidade_total_kg: 100, produto: 'SAL' })).json();
    const ok = await req('PATCH', `/suplementacao-eventos/${ev.id}`, c.tokAdm, { sobra_kg: 5, dias_periodo: 3, consumo_diario_grupo_kg: 31.6 });
    assert.equal(ok.statusCode, 200, ok.body);
    const reabre = await req('PATCH', `/suplementacao-eventos/${ev.id}`, c.tokAdm, { dias_periodo: null, consumo_diario_grupo_kg: null });
    assert.equal(reabre.statusCode, 200, reabre.body);
    const ruim = await req('PATCH', `/suplementacao-eventos/${ev.id}`, c.tokAdm, { quantidade_total_kg: 1 });
    assert.equal(ruim.statusCode, 409);
    assert.equal(ruim.json().code, 'REGISTRO_OPERACIONAL_IMUTAVEL');
    assert.equal((await req('PATCH', `/suplementacao-eventos/${ev.id}`, c.tokAdm, { situacao: 'cancelado' })).statusCode, 400);
    assert.equal((await req('PATCH', `/suplementacao-eventos/${ev.id}`, c.tokAdm, { sobra_kg: 'muito' })).statusCode, 400);
    assert.equal((await req('DELETE', `/suplementacao-eventos/${ev.id}`, c.tokAdm)).json().code, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO');
    const gravado = await prisma().suplementacaoEvento.findUnique({ where: { id: ev.id } });
    assert.equal(gravado.dados.quantidade_total_kg, 100);
  });

  test('SuplementacaoLote: só métricas de consumo; vínculo e DELETE bloqueados', async () => {
    const c = await cenario();
    const sl = (await req('POST', '/suplementacao-lotes', c.tokAdm, { empresa_id: c.empresa.id, lote_id: 'L1', cabecas_na_area: 10 })).json();
    assert.equal((await req('PATCH', `/suplementacao-lotes/${sl.id}`, c.tokAdm, { dias_periodo: 2, consumo_total_lote_periodo_kg: 12.5, percentual_consumo_lote: 0.4 })).statusCode, 200);
    assert.equal((await req('PATCH', `/suplementacao-lotes/${sl.id}`, c.tokAdm, { lote_id: 'L2' })).statusCode, 409);
    assert.equal((await req('PATCH', `/suplementacao-lotes/${sl.id}`, c.tokAdm, { empresa_id: 'outra' })).statusCode, 409);
    assert.equal((await req('DELETE', `/suplementacao-lotes/${sl.id}`, c.tokAdm)).statusCode, 409);
  });

  test('MovimentacaoEstoque: PATCH só o nome do local, conferido; DELETE 409', async () => {
    const c = await cenario();
    const p = prisma();
    const local = await p.localEstoque.create({ data: { cliente_id: c.cliente.id, numero_local: '1', nome: 'DEPÓSITO NOVO' } });
    const produto = await p.produto.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, numero_produto: '1', nome_produto: 'SAL' } });
    const me = await p.movimentacaoEstoque.create({
      data: {
        cliente_id: c.cliente.id, empresa_id: c.empresa.id, numero_movimentacao: '1', tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada',
        data_movimentacao: new Date(), produto_id: produto.id, quantidade: 500, unidade_medida: 'KG', local_estoque_origem: local.id, local_origem: 'DEPÓSITO VELHO',
      },
    });
    const ok = await req('PATCH', `/movimentacoes-estoque/${me.id}`, c.tokAdm, { local_origem: 'DEPÓSITO NOVO' });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().local_origem, 'DEPÓSITO NOVO');
    assert.equal((await req('PATCH', `/movimentacoes-estoque/${me.id}`, c.tokAdm, { local_origem: 'QUALQUER' })).json().code, 'NOME_LOCAL_DIVERGENTE');
    assert.equal((await req('PATCH', `/movimentacoes-estoque/${me.id}`, c.tokAdm, { local_destino: 'DEPÓSITO NOVO' })).json().code, 'NOME_LOCAL_DIVERGENTE');
    for (const corpo of [{ quantidade: 1 }, { local_estoque_origem: 'x' }, { produto_id: 'x' }, { valor_total: 0 }, { tipo_movimentacao: 'Entrada' }]) {
      const r = await req('PATCH', `/movimentacoes-estoque/${me.id}`, c.tokAdm, corpo);
      assert.ok([400, 409].includes(r.statusCode), JSON.stringify(corpo) + r.body);
    }
    assert.equal((await req('DELETE', `/movimentacoes-estoque/${me.id}`, c.tokAdm)).json().code, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO');
    const gravado = await p.movimentacaoEstoque.findUnique({ where: { id: me.id } });
    assert.equal(Number(gravado.quantidade), 500);
    const outro = await cenario();
    assert.equal((await req('PATCH', `/movimentacoes-estoque/${me.id}`, outro.tokAdm, { local_origem: 'DEPÓSITO NOVO' })).statusCode, 404);
  });
});

// ─── P1 — cancelamento transacional ───────────────────────────────────────

describe('P1 — Morte e Abate', () => {
  test('500 → morte de 50 → 450 → cancelar → 500; original preservado como cancelado; auditoria com ator', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);

    const eleg = await req('GET', `/movimentacoes-mapa/${m.id}/elegibilidade-cancelamento`, c.tokAdm);
    assert.equal(eleg.statusCode, 200);
    assert.equal(eleg.json().elegivel, true, eleg.body);
    assert.equal(eleg.json().pode_cancelar, true);

    const r = await cancelar(c, m.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
    const original = await mov(m.id);
    assert.equal(original.dados.situacao, 'cancelado');
    assert.equal(original.dados.tipo, 'Morte');
    assert.equal(original.dados.data_movimentacao, '2026-10-30T12:00:00.000Z', 'data operacional intacta');
    assert.equal(original.dados.cancelamento.motivo, 'lançado por engano');
    const audit = await prisma().auditLog.findFirst({ where: { entidade: 'MovimentacaoMapa', entidade_id: m.id, acao: 'cancelamento' } });
    assert.ok(audit?.usuario_id);
    assert.equal(audit.cliente_id, c.cliente.id);
    // historico continua lendo o original, agora cancelado
    const hist = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&area_id=${c.A.id}`, c.tokAdm);
    assert.equal(hist.json().items[0].situacao, 'cancelado');
  });

  test('Abate: Inativo com 0 volta Ativo; replay da mesma chave não dobra (500, não 550)', async () => {
    const c = await cenario();
    const l = await criarLote(c, { qtd: 50, area: c.A });
    const m = await morteLegada(c, l, 50, 'Abate');
    assert.equal((await lote(l.id)).status, 'Inativo');
    const corpo = { operation_id: opId(), motivo: 'abate duplicado' };
    const r1 = await cancelar(c, m.id, c.tokAdm, corpo);
    const r2 = await cancelar(c, m.id, c.tokAdm, corpo);
    assert.equal(r1.statusCode, 200, r1.body);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(r2.json().replay, true);
    const depois = await lote(l.id);
    assert.equal(depois.quantidade_cabecas, 50);
    assert.equal(depois.status, 'Ativo');
    assert.equal((await cancelar(c, m.id, c.tokAdm, { ...corpo, motivo: 'outro motivo' })).json().code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await cancelar(c, m.id)).json().code, 'CANCELAMENTO_JA_REALIZADO');
  });

  test('autorização: usuário comum 403, outro tenant 404, sem token 401 — nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    const r = await cancelar(c, m.id, c.tokComum);
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, 'TENANT_ADMIN_REQUIRED');
    const outro = await cenario();
    assert.equal((await cancelar(c, m.id, outro.tokAdm)).statusCode, 404);
    assert.equal((await req('GET', `/movimentacoes-mapa/${m.id}/elegibilidade-cancelamento`, outro.tokAdm)).statusCode, 404);
    assert.equal((await req('POST', `/movimentacoes-mapa/${m.id}/cancelamento`, null, { operation_id: opId(), motivo: 'x x x' })).statusCode, 401);
    assert.equal((await cancelar(c, m.id, c.tokAdm, { operation_id: opId(), motivo: 'ok ok', cliente_id: outro.cliente.id })).statusCode, 400);
    assert.equal((await cancelar(c, m.id, c.tokAdm, { operation_id: opId(), motivo: 'ok ok', quantidade_animais: 999 })).statusCode, 400);
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    assert.equal((await mov(m.id)).dados.situacao, undefined);
  });

  test('dependência posterior (pesagem depois, por id) → 409 com saldo intacto; sem prova de efeito → 409', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    await criarMov(c, { tipo: 'Pesagem', lote: l.nome, lote_id: l.id, quantidade_animais: 450, area_origem_id: c.A.id, data_movimentacao: '2026-10-31T12:00:00.000Z' });
    const r = await cancelar(c, m.id);
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);

    // Movimento gravado mas o PATCH do lote nunca aconteceu (falha no meio do fluxo legado).
    const l2 = await criarLote(c, { nome: 'ANGUS', area: c.B });
    const orfao = await criarMov(c, { tipo: 'Morte', lote: l2.nome, lote_id: l2.id, quantidade_animais: 10, area_origem_id: c.B.id });
    const r2 = await cancelar(c, orfao.id);
    assert.equal(r2.json().code, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    assert.equal((await lote(l2.id)).quantidade_cabecas, 500, 'não devolve cabeças que nunca saíram');
  });

  test('outras fontes posteriores do lote (suplementação, sanidade) também bloqueiam', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    await req('POST', '/eventos-sanitarios', c.tokAdm, { empresa_id: c.empresa.id, lote_id: l.id, data_evento: '2026-11-01' });
    const r = await cancelar(c, m.id);
    assert.equal(r.json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    assert.equal(r.json().details.dependencias[0].fonte, 'EventoSanitario');
  });

  test('vínculo só por nome (legado sem lote_id) e tipo sem suporte → 409, nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const porNome = await criarMov(c, { tipo: 'Morte', lote: l.nome, quantidade_animais: 5, area_origem_id: c.A.id });
    assert.equal((await cancelar(c, porNome.id)).json().code, 'CANCELAMENTO_VINCULO_AMBIGUO');
    const pesagem = await criarMov(c, { tipo: 'Pesagem', lote: l.nome, lote_id: l.id, quantidade_animais: 500, area_origem_id: c.A.id });
    const r = await cancelar(c, pesagem.id);
    assert.equal(r.json().code, 'CANCELAMENTO_TIPO_NAO_SUPORTADO');
    const eleg = (await req('GET', `/movimentacoes-mapa/${pesagem.id}/elegibilidade-cancelamento`, c.tokAdm)).json();
    assert.deepEqual([eleg.elegivel, eleg.codigo], [false, 'CANCELAMENTO_TIPO_NAO_SUPORTADO']);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });
});

describe('P1 — Transferência de Área', () => {
  test('total no lugar (legado): o lote volta à área de origem; cabeças iguais', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    await patchLote(c, l.id, { area_atual_id: c.B.id });
    const m = await criarMov(c, { tipo: 'Transferência de Área', lote: l.nome, lote_id: l.id, quantidade_animais: 500, area_origem_id: c.A.id, area_destino_id: c.B.id });
    const r = await cancelar(c, m.id);
    assert.equal(r.statusCode, 200, r.body);
    const depois = await lote(l.id);
    assert.equal(depois.area_atual_id, c.A.id);
    assert.equal(depois.area_atual_nome, 'PASTO A');
    assert.equal(depois.quantidade_cabecas, 500);
    assert.equal(depois.area_entrada_id, c.A.id, 'entrada histórica intacta');
  });

  test('parcial com lote derivado (novo formato): 500 → 450 + 50 → cancelar → 500 + 0 (derivado inativo, não apagado)', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const derivado = await criarLote(c, {
      qtd: 50, area: c.B,
      extra: { motivo_entrada: 'Outros', motivo_outros: 'Movimentação parcial', origem: 'MOVIMENTAÇÃO' },
    });
    await patchLote(c, l.id, { quantidade_cabecas: 450 });
    const m = await criarMov(c, {
      tipo: 'Transferência de Área', lote: l.nome, lote_id: l.id, quantidade_animais: 50, area_origem_id: c.A.id, area_destino_id: c.B.id,
      modo_transferencia: 'parcial_novo_lote', lote_destino_id: derivado.id,
    });
    const soma = async () => (await lote(l.id)).quantidade_cabecas + (await lote(derivado.id)).quantidade_cabecas;
    assert.equal(await soma(), 500);
    const r = await cancelar(c, m.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
    const d = await lote(derivado.id);
    assert.deepEqual([d.quantidade_cabecas, d.status, d.quantidade_entrada], [0, 'Inativo', 50], 'entrada histórica do derivado intacta');
    assert.equal(await soma(), 500, 'cabeças conservadas');
  });

  test('parcial unificada com destino preexistente: 500/100 → 450/150 → cancelar → 500/100', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const dest = await criarLote(c, { nome: 'NELORE', qtd: 100, area: c.B });
    await patchLote(c, dest.id, { quantidade_cabecas: 150 });
    await patchLote(c, l.id, { quantidade_cabecas: 450 });
    const m = await criarMov(c, {
      tipo: 'Transferência de Área', lote: l.nome, lote_id: l.id, quantidade_animais: 50, area_origem_id: c.A.id, area_destino_id: c.B.id,
      modo_transferencia: 'parcial_unificado', lote_destino_id: dest.id,
    });
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    assert.deepEqual([(await lote(l.id)).quantidade_cabecas, (await lote(dest.id)).quantidade_cabecas], [500, 100]);
  });

  test('parcial legado (sem lote de destino gravado) → CANCELAMENTO_VINCULO_AMBIGUO, nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const derivado = await criarLote(c, { qtd: 50, area: c.B, extra: { motivo_entrada: 'Outros', motivo_outros: 'Movimentação parcial', origem: 'MOVIMENTAÇÃO' } });
    await patchLote(c, l.id, { quantidade_cabecas: 450 });
    const m = await criarMov(c, { tipo: 'Transferência de Área', lote: l.nome, lote_id: l.id, quantidade_animais: 50, area_origem_id: c.A.id, area_destino_id: c.B.id });
    assert.equal((await cancelar(c, m.id)).json().code, 'CANCELAMENTO_VINCULO_AMBIGUO');
    assert.deepEqual([(await lote(l.id)).quantidade_cabecas, (await lote(derivado.id)).quantidade_cabecas], [450, 50]);
  });

  test('destino sem saldo para devolver → CANCELAMENTO_SALDO_INSUFICIENTE', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const dest = await criarLote(c, { qtd: 100, area: c.B });
    await patchLote(c, dest.id, { quantidade_cabecas: 150 });
    await patchLote(c, l.id, { quantidade_cabecas: 450 });
    const m = await criarMov(c, {
      tipo: 'Transferência de Área', lote: l.nome, lote_id: l.id, quantidade_animais: 50, area_origem_id: c.A.id, area_destino_id: c.B.id,
      modo_transferencia: 'parcial_unificado', lote_destino_id: dest.id,
    });
    await prisma().lote.update({ where: { id: dest.id }, data: { quantidade_cabecas: 20 } });
    assert.equal((await cancelar(c, m.id)).json().code, 'CANCELAMENTO_SALDO_INSUFICIENTE');
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
  });
});

describe('P1 — concorrência e rollback', () => {
  test('dois cancelamentos simultâneos com chaves diferentes → um 200, outro 409; saldo 500, não 550', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    const rs = await Promise.all([cancelar(c, m.id), cancelar(c, m.id), cancelar(c, m.id)]);
    const codigos = rs.map((r) => r.statusCode).sort();
    assert.deepEqual(codigos, [200, 409, 409], rs.map((r) => r.body).join(' | '));
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('mesma chave em paralelo → nenhum crédito duplicado', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    const corpo = { operation_id: opId(), motivo: 'paralelo' };
    const rs = await Promise.all([cancelar(c, m.id, c.tokAdm, corpo), cancelar(c, m.id, c.tokAdm, corpo)]);
    assert.ok(rs.every((r) => r.statusCode === 200 || r.json().code === 'IDEMPOTENCY_IN_PROGRESS'), rs.map((r) => r.body).join(' | '));
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('falha forçada depois de atualizar o lote → rollback completo; retry com a mesma chave conclui', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    const p = prisma();
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION r2a_falha() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$ LANGUAGE plpgsql`);
    await p.$executeRawUnsafe(`CREATE TRIGGER r2a_falha BEFORE UPDATE ON "MovimentacaoMapa" FOR EACH ROW WHEN (NEW.id = '${m.id}') EXECUTE FUNCTION r2a_falha()`);
    const corpo = { operation_id: opId(), motivo: 'teste de rollback' };
    try {
      const r = await cancelar(c, m.id, c.tokAdm, corpo);
      assert.equal(r.statusCode, 500);
      assert.equal((await lote(l.id)).quantidade_cabecas, 450, 'o update do lote foi desfeito');
      assert.equal((await mov(m.id)).dados.situacao, undefined);
      assert.equal(await p.operacaoIdempotente.count({ where: { operation_key: corpo.operation_id } }), 0);
    } finally {
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r2a_falha ON "MovimentacaoMapa"`);
      await p.$executeRawUnsafe(`DROP FUNCTION IF EXISTS r2a_falha()`);
    }
    const retry = await cancelar(c, m.id, c.tokAdm, corpo);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('cancelamento concorrente com PATCH do lote não gera 500 e termina em ordem serial', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morteLegada(c, l, 50);
    const [rc, rp] = await Promise.all([cancelar(c, m.id), req('PATCH', `/lotes/${l.id}`, c.tokAdm, { peso_medio_kg: 410 })]);
    assert.ok([200, 409].includes(rc.statusCode), rc.body);
    assert.equal(rp.statusCode, 200, rp.body);
    const final = await lote(l.id);
    assert.equal(Number(final.peso_medio_kg), 410);
    assert.equal(final.quantidade_cabecas, rc.statusCode === 200 ? 500 : 450);
  });

  test('tenants isolados com o mesmo nome de lote', async () => {
    const a = await cenario();
    const b = await cenario();
    const la = await criarLote(a, { area: a.A });
    const lb = await criarLote(b, { area: b.A });
    const ma = await morteLegada(a, la, 50);
    await morteLegada(b, lb, 30);
    assert.equal((await cancelar(a, ma.id)).statusCode, 200);
    assert.deepEqual([(await lote(la.id)).quantidade_cabecas, (await lote(lb.id)).quantidade_cabecas], [500, 470]);
  });
});
