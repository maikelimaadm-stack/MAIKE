/**
 * R2A (D-PROD-99) — fechamento de rotas destrutivas e cancelamento transacional
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

/** Comando atômico de manejo (R2A-R1): o servidor aplica o efeito e grava a proveniência. */
const manejo = (c, corpo, token = c.tokAdm) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-lote', token, {
    operation_id: opId(),
    empresa_id: c.empresa.id,
    data_movimentacao: '2026-10-30T12:00:00.000Z',
    ...corpo,
  });
const morte = async (c, l, q, tipo = 'Morte') => {
  const r = await manejo(c, { tipo, lote_id: l.id, quantidade_animais: q });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().movimentacao;
};
const transferir = async (c, l, q, areaDestino, loteDestinoId) => {
  const r = await manejo(c, {
    tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: q, area_destino_id: areaDestino.id,
    ...(loteDestinoId ? { lote_destino_id: loteDestinoId } : {}), categoria_animal: 'BOI',
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
/** Fluxo LEGADO (navegador): movimento por POST genérico + PATCH do lote com estado esperado. */
const morteLegada = async (c, l, q, { patch = true } = {}) => {
  const m = await criarMov(c, { tipo: 'Morte', lote: l.nome, lote_id: l.id, quantidade_animais: q, area_origem_id: l.area_atual_id });
  if (patch) {
    const atual = await lote(l.id);
    await patchLote(c, l.id, { quantidade_cabecas: atual.quantidade_cabecas - q, estado_esperado: { quantidade_cabecas: atual.quantidade_cabecas } });
  }
  return m;
};

// ─── P0 — rotas destrutivas fechadas no servidor ──────────────────────────

describe('P0 — MovimentacaoMapa e MovimentacaoPecuaria', () => {
  test('DELETE e PATCH diretos → 409 MOVIMENTO_CANCELAMENTO_OBRIGATORIO; nada muda; outro tenant → 404', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
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

describe('P1 — Morte e Abate pelo comando atômico', () => {
  test('500 → morte de 50 (comando) → 450 → cancelar → 500; original preservado; proveniência e auditoria', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    assert.equal(m.efeito_servidor.efeitos[0].lote_id, l.id);
    assert.equal(m.area_origem_id, c.A.id, 'área de origem vem do servidor');

    const eleg = await req('GET', `/movimentacoes-mapa/${m.id}/elegibilidade-cancelamento`, c.tokAdm);
    assert.equal(eleg.json().elegivel, true, eleg.body);

    const r = await cancelar(c, m.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
    const original = await mov(m.id);
    assert.equal(original.dados.situacao, 'cancelado');
    assert.equal(original.dados.data_movimentacao, '2026-10-30T12:00:00.000Z');
    assert.equal(original.dados.cancelamento.motivo, 'lançado por engano');
    const audit = await prisma().auditLog.findFirst({ where: { entidade: 'MovimentacaoMapa', entidade_id: m.id, acao: 'cancelamento' } });
    assert.ok(audit?.usuario_id);
    const hist = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&area_id=${c.A.id}`, c.tokAdm);
    assert.equal(hist.json().items[0].situacao, 'cancelado');
  });

  test('Abate: Inativo com 0 volta Ativo; replay da mesma chave não dobra', async () => {
    const c = await cenario();
    const l = await criarLote(c, { qtd: 50, area: c.A });
    const m = await morte(c, l, 50, 'Abate');
    assert.equal((await lote(l.id)).status, 'Inativo');
    const corpo = { operation_id: opId(), motivo: 'abate duplicado' };
    assert.equal((await cancelar(c, m.id, c.tokAdm, corpo)).statusCode, 200);
    const r2 = await cancelar(c, m.id, c.tokAdm, corpo);
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.json().replay, true);
    assert.deepEqual([(await lote(l.id)).quantidade_cabecas, (await lote(l.id)).status], [50, 'Ativo']);
    assert.equal((await cancelar(c, m.id, c.tokAdm, { ...corpo, motivo: 'outro motivo' })).json().code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await cancelar(c, m.id)).json().code, 'CANCELAMENTO_JA_REALIZADO');
  });

  test('comando: replay da mesma chave não baixa duas vezes; mesma chave com outro corpo → 409; saldo insuficiente → 409', async () => {
    const c = await cenario();
    const l = await criarLote(c, { qtd: 100, area: c.A });
    const corpo = { operation_id: opId(), tipo: 'Morte', lote_id: l.id, quantidade_animais: 10 };
    const r1 = await manejo(c, corpo);
    const r2 = await manejo(c, corpo);
    assert.equal(r1.statusCode, 201);
    assert.equal(r2.json().replay, true);
    assert.equal(r2.json().movimentacao.id, r1.json().movimentacao.id);
    assert.equal((await lote(l.id)).quantidade_cabecas, 90);
    assert.equal((await manejo(c, { ...corpo, quantidade_animais: 11 })).json().code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await manejo(c, { tipo: 'Morte', lote_id: l.id, quantidade_animais: 91 })).json().code, 'MANEJO_SALDO_INSUFICIENTE');
    assert.equal((await lote(l.id)).quantidade_cabecas, 90);
    const outro = await cenario();
    assert.equal((await manejo(outro, { tipo: 'Morte', lote_id: l.id, quantidade_animais: 1 }, outro.tokAdm)).statusCode, 404);
  });

  test('autorização: comum 403, outro tenant 404, sem token 401, admin revogado 403 — nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    assert.equal((await cancelar(c, m.id, c.tokComum)).json().code, 'TENANT_ADMIN_REQUIRED');
    const outro = await cenario();
    assert.equal((await cancelar(c, m.id, outro.tokAdm)).statusCode, 404);
    assert.equal((await req('POST', `/movimentacoes-mapa/${m.id}/cancelamento`, null, { operation_id: opId(), motivo: 'x x x' })).statusCode, 401);
    assert.equal((await cancelar(c, m.id, c.tokAdm, { operation_id: opId(), motivo: 'ok ok', cliente_id: outro.cliente.id })).statusCode, 400);
    // admin rebaixado depois de emitido o token: o papel é relido do banco
    await prisma().usuario.updateMany({ where: { cliente_id: c.cliente.id, papel_tenant: 'administrador' }, data: { papel_tenant: 'usuario' } });
    assert.equal((await cancelar(c, m.id)).json().code, 'TENANT_ADMIN_REQUIRED');
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    assert.equal((await mov(m.id)).dados.situacao, undefined);
  });

  test('dependências posteriores (pesagem por id, sanidade) → 409, saldo intacto', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    await criarMov(c, { tipo: 'Pesagem', lote: l.nome, lote_id: l.id, quantidade_animais: 450, area_origem_id: c.A.id, data_movimentacao: '2026-10-31T12:00:00.000Z' });
    const r = await cancelar(c, m.id);
    assert.equal(r.json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    const l2 = await criarLote(c, { nome: 'ANGUS', area: c.B });
    const m2 = await morte(c, l2, 5);
    await req('POST', '/eventos-sanitarios', c.tokAdm, { empresa_id: c.empresa.id, lote_id: l2.id, data_evento: '2026-11-01' });
    assert.equal((await cancelar(c, m2.id)).json().details.dependencias[0].fonte, 'EventoSanitario');
    assert.deepEqual([(await lote(l.id)).quantidade_cabecas, (await lote(l2.id)).quantidade_cabecas], [450, 495]);
  });

  test('tipo sem suporte e movimento sem lote_id → 409, nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const porNome = await criarMov(c, { tipo: 'Morte', lote: l.nome, quantidade_animais: 5, area_origem_id: c.A.id });
    assert.equal((await cancelar(c, porNome.id)).json().code, 'CANCELAMENTO_VINCULO_AMBIGUO');
    const entrada = await criarMov(c, { tipo: 'Entrada', lote: l.nome, lote_id: l.id, quantidade_animais: 500, area_origem_id: c.A.id });
    assert.equal((await cancelar(c, entrada.id)).json().code, 'CANCELAMENTO_TIPO_NAO_SUPORTADO');
    // R2C-P1 (D-PROD-102): junção pelo POST genérico agora é recusada (só pelo comando).
    const juncao = await req('POST', '/movimentacoes-mapa', c.tokAdm, { empresa_id: c.empresa.id, tipo: 'Junção de Lotes', lote: l.nome, lote_id: l.id, quantidade_animais: 500 });
    assert.equal(juncao.statusCode, 409, juncao.body);
    assert.equal(juncao.json().code, 'JUNCAO_SOMENTE_POR_COMANDO');
    // R2B-P1 (D-PROD-101): Pesagem passou a ser tipo certificado; a legada (sem
    // proveniência do comando do rebanho) segue recusada, como a Morte legada.
    const pesagem = await criarMov(c, { tipo: 'Pesagem', lote: l.nome, lote_id: l.id, quantidade_animais: 500, area_origem_id: c.A.id });
    assert.equal((await cancelar(c, pesagem.id)).json().code, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });
});

describe('R2A-R1 — proveniência causal (nunca prova emprestada)', () => {
  test('duas mortes de 50 / um único PATCH: #B (sem efeito) recusada; #A legado recusado; saldo e originais intactos', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const a = await morteLegada(c, l, 50); // fluxo legado com efeito real (PATCH -50)
    const b = await morteLegada(c, l, 50, { patch: false }); // falha parcial: sem efeito
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    for (const m of [b, a]) {
      const r = await cancelar(c, m.id);
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().code, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
      const eleg = (await req('GET', `/movimentacoes-mapa/${m.id}/elegibilidade-cancelamento`, c.tokAdm)).json();
      assert.deepEqual([eleg.elegivel, eleg.codigo], [false, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO']);
    }
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    assert.equal(await prisma().operacaoIdempotente.count({ where: { tipo_operacao: 'cancelamento_movimentacao_mapa' } }), 0, 'recusa não reserva chave');
  });

  test('duas mortes iguais pelo comando: cada uma cancela só o próprio efeito (500 → 400 → 450 → 500)', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m1 = await morte(c, l, 50);
    const m2 = await morte(c, l, 50);
    assert.equal((await lote(l.id)).quantidade_cabecas, 400);
    assert.equal((await cancelar(c, m1.id)).json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR', 'mais antiga espera a mais recente');
    assert.equal((await cancelar(c, m2.id)).statusCode, 200);
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    assert.equal((await cancelar(c, m1.id)).statusCode, 200);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
    assert.equal((await cancelar(c, m2.id)).json().code, 'CANCELAMENTO_JA_REALIZADO');
  });

  test('cliente não fabrica proveniência: POST/bulk com efeito_servidor, modo ou lote_destino_id → 400', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const forjado = {
      empresa_id: c.empresa.id, tipo: 'Morte', lote: l.nome, lote_id: l.id, quantidade_animais: 50, area_origem_id: c.A.id,
      efeito_servidor: { comando: 'manejo_mapa_lote', operation_id: 'op-forjada-123', efeitos: [{ lote_id: l.id, antes: { quantidade_cabecas: 500 }, depois: { quantidade_cabecas: 450 } }] },
    };
    for (const corpo of [forjado, { ...forjado, efeito_servidor: undefined, modo_transferencia: 'total_unificado' }, { ...forjado, efeito_servidor: undefined, lote_destino_id: l.id }]) {
      const r = await req('POST', '/movimentacoes-mapa', c.tokAdm, JSON.parse(JSON.stringify(corpo)));
      assert.equal(r.statusCode, 400, r.body);
      assert.equal(r.json().code, 'CAMPO_RESERVADO_CANCELAMENTO');
    }
    assert.equal((await req('POST', '/movimentacoes-mapa/bulk', c.tokAdm, [forjado])).statusCode >= 400, true);
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 0);
  });

  test('proveniência copiada para outro movimento (forja direta no banco) não vale: a operação aponta para o original', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const a = await morte(c, l, 50);
    const copia = await prisma().movimentacaoMapa.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { ...(await mov(a.id)).dados } },
    });
    assert.equal((await cancelar(c, copia.id)).json().code, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    // A cópia é um registro posterior do mesmo lote: conservadoramente, bloqueia também o original.
    assert.equal((await cancelar(c, a.id)).json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
  });
});

describe('P1 — Transferência de Área pelo comando', () => {
  const soma = async (...ids) => (await Promise.all(ids.map(lote))).reduce((t, x) => t + x.quantidade_cabecas, 0);

  test('total no lugar: área volta à origem; cabeças e entrada histórica intactas', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const { movimentacao: m } = await transferir(c, l, 500, c.B);
    assert.equal(m.modo_transferencia, 'total_no_lugar');
    assert.equal((await lote(l.id)).area_atual_id, c.B.id);
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    const d = await lote(l.id);
    assert.deepEqual([d.area_atual_id, d.area_atual_nome, d.quantidade_cabecas, d.area_entrada_id], [c.A.id, 'PASTO A', 500, c.A.id]);
  });

  test('parcial com lote novo: 500 → 450 + 50 → cancelar → 500 + 0 (derivado Inativo, entrada 50 intacta)', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const { movimentacao: m } = await transferir(c, l, 50, c.B);
    assert.equal(m.modo_transferencia, 'parcial_novo_lote');
    const derivadoId = m.lote_destino_id;
    const derivado = await lote(derivadoId);
    assert.deepEqual([derivado.quantidade_cabecas, derivado.quantidade_entrada, derivado.origem, derivado.area_atual_id], [50, 50, 'MOVIMENTAÇÃO', c.B.id]);
    assert.equal(await soma(l.id, derivadoId), 500);
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    const d = await lote(derivadoId);
    assert.deepEqual([(await lote(l.id)).quantidade_cabecas, d.quantidade_cabecas, d.status, d.quantidade_entrada], [500, 0, 'Inativo', 50]);
    assert.equal(await soma(l.id, derivadoId), 500);
  });

  test('parcial unificada com destino preexistente: 500/100 → 450/150 → 500/100', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const dest = await criarLote(c, { qtd: 100, area: c.B });
    const { movimentacao: m } = await transferir(c, l, 50, c.B, dest.id);
    assert.equal(m.modo_transferencia, 'parcial_unificado');
    assert.deepEqual([(await lote(l.id)).quantidade_cabecas, (await lote(dest.id)).quantidade_cabecas], [450, 150]);
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    assert.deepEqual([(await lote(l.id)).quantidade_cabecas, (await lote(dest.id)).quantidade_cabecas], [500, 100]);
  });

  test('total unificada: 500 + 100 → 0 Inativo / 600 → 500 Ativo / 100', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const dest = await criarLote(c, { qtd: 100, area: c.B });
    const { movimentacao: m } = await transferir(c, l, 500, c.B, dest.id);
    assert.equal(m.modo_transferencia, 'total_unificado');
    assert.deepEqual([(await lote(l.id)).status, (await lote(dest.id)).quantidade_cabecas], ['Inativo', 600]);
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    const o = await lote(l.id);
    assert.deepEqual([o.quantidade_cabecas, o.status, o.area_atual_id, (await lote(dest.id)).quantidade_cabecas], [500, 'Ativo', c.A.id, 100]);
  });

  test('destino incompatível (outro nome/categoria/área) → 409 e nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const outroNome = await criarLote(c, { nome: 'OUTRO', qtd: 10, area: c.B });
    const r = await manejo(c, { tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: 50, area_destino_id: c.B.id, lote_destino_id: outroNome.id, categoria_animal: 'BOI' });
    assert.equal(r.json().code, 'MANEJO_ESTADO_INVALIDO');
    assert.deepEqual([(await lote(l.id)).quantidade_cabecas, (await lote(outroNome.id)).quantidade_cabecas], [500, 10]);
  });

  test('legado (POST + PATCH do navegador, sem proveniência) → recusa fail-closed, nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    await patchLote(c, l.id, { area_atual_id: c.B.id, estado_esperado: { area_atual_id: c.A.id } });
    const m = await criarMov(c, { tipo: 'Transferência de Área', lote: l.nome, lote_id: l.id, quantidade_animais: 500, area_origem_id: c.A.id, area_destino_id: c.B.id });
    assert.equal((await cancelar(c, m.id)).json().code, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    assert.equal((await lote(l.id)).area_atual_id, c.B.id);
  });

  test('destino alterado por escrita direta (sem auditoria) → CANCELAMENTO_ESTADO_DIVERGENTE; nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const dest = await criarLote(c, { qtd: 100, area: c.B });
    const { movimentacao: m } = await transferir(c, l, 50, c.B, dest.id);
    // Escrita direta no banco (sem auditoria): a igualdade campo a campo com o pós-estado pega (R2A-R2).
    await prisma().lote.update({ where: { id: dest.id }, data: { quantidade_cabecas: 20 } });
    assert.equal((await cancelar(c, m.id)).json().code, 'CANCELAMENTO_ESTADO_DIVERGENTE');
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    assert.equal((await lote(dest.id)).quantidade_cabecas, 20);
  });
});

describe('R2A-R1 — concorrência de saldo (CAS) e rollback', () => {
  /** Segura a linha do lote numa transação à parte até `soltar()`: interleaving determinístico. */
  const segurarLote = async (loteId) => {
    let soltar;
    const liberado = new Promise((r) => { soltar = r; });
    let travado;
    const pronto = new Promise((r) => { travado = r; });
    const tx = prisma().$transaction(async (t) => {
      await t.$queryRaw`SELECT id FROM "Lote" WHERE id = ${loteId} FOR UPDATE`;
      travado();
      await liberado;
    }, { timeout: 20000 });
    await pronto;
    return async () => { soltar(); await tx; };
  };

  test('PATCH obsoleto depois do cancelamento (quantidade calculada antes) → 409 LOTE_ESTADO_CONFLITO; saldo 500', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    const lido = await lote(l.id); // navegador leu 450
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    const r = await req('PATCH', `/lotes/${l.id}`, c.tokAdm, { quantidade_cabecas: lido.quantidade_cabecas - 50, estado_esperado: { quantidade_cabecas: lido.quantidade_cabecas } });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'LOTE_ESTADO_CONFLITO');
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('PATCH de saldo/área/status/categoria sem estado esperado → 409; peso e nome seguem livres', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    for (const corpo of [{ quantidade_cabecas: 400 }, { status: 'Inativo' }, { area_atual_id: c.B.id }, { categoria: 'VACA' }]) {
      const r = await req('PATCH', `/lotes/${l.id}`, c.tokAdm, corpo);
      assert.equal(r.json().code, 'LOTE_ESTADO_CONFLITO', JSON.stringify(corpo));
    }
    assert.equal((await req('PATCH', `/lotes/${l.id}`, c.tokAdm, { peso_medio_kg: 410 })).statusCode, 200);
    assert.equal((await req('PATCH', `/lotes/${l.id}`, c.tokAdm, { quantidade_cabecas: 500 })).statusCode, 200, 'mesmo valor não exige estado');
    const d = await lote(l.id);
    assert.deepEqual([d.quantidade_cabecas, d.status, d.area_atual_id, d.categoria], [500, 'Ativo', c.A.id, 'BOI']);
  });

  test('estado esperado OBSOLETO em status/área/categoria → 409; estado correto → 200', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    // Outro usuário mudou cada campo antes: o PATCH que leu o valor antigo é recusado.
    const obsoletos = [
      [{ status: 'Inativo', estado_esperado: { status: 'Pendente' } }, 'status'],
      [{ area_atual_id: c.B.id, estado_esperado: { area_atual_id: c.B.id } }, 'area'],
      [{ categoria: 'VACA', estado_esperado: { categoria: 'NOVILHA' } }, 'categoria'],
    ];
    for (const [corpo, nome] of obsoletos) {
      const r = await req('PATCH', `/lotes/${l.id}`, c.tokAdm, corpo);
      assert.equal(r.statusCode, 409, nome);
      assert.equal(r.json().code, 'LOTE_ESTADO_CONFLITO', nome);
    }
    let d = await lote(l.id);
    assert.deepEqual([d.status, d.area_atual_id, d.categoria], ['Ativo', c.A.id, 'BOI']);
    const r = await req('PATCH', `/lotes/${l.id}`, c.tokAdm, {
      categoria: 'VACA', area_atual_id: c.B.id,
      estado_esperado: { categoria: 'BOI', area_atual_id: c.A.id },
    });
    assert.equal(r.statusCode, 200);
    d = await lote(l.id);
    assert.deepEqual([d.area_atual_id, d.categoria], [c.B.id, 'VACA']);
  });

  /** Linhas de auditoria do lote depois da criação: prova QUAL operação mudou QUAL valor. */
  const trilha = async (loteId) =>
    (await prisma().auditLog.findMany({ where: { entidade: 'Lote', entidade_id: loteId, acao: 'update' }, orderBy: { createdAt: 'asc' } }))
      .map((a) => `${a.dados_anteriores?.quantidade_cabecas}->${a.dados_novos?.quantidade_cabecas}${a.dados_novos?.movimentacao_cancelada_id ? ' (cancelamento)' : ''}`);

  // R2A-R2 (D-PROD-99b): a ordem é forçada pela fila da trava do PostgreSQL —
  // quem chega primeiro na espera do FOR UPDATE do lote ganha. Cada ordem tem
  // o seu desfecho exato; "um ou outro" não basta.
  test('ordem A (cancelamento pega a trava primeiro): devolve 50 (500); o PATCH 450→400 perde o CAS', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    const soltar = await segurarLote(l.id);
    const pCancel = cancelar(c, m.id);
    await new Promise((r) => setTimeout(r, 300));
    const pPatch = req('PATCH', `/lotes/${l.id}`, c.tokAdm, { quantidade_cabecas: 400, estado_esperado: { quantidade_cabecas: 450 } });
    await new Promise((r) => setTimeout(r, 300));
    await soltar();
    const [rc, rp] = await Promise.all([pCancel, pPatch]);
    assert.equal(rc.statusCode, 200, rc.body);
    assert.equal(rp.statusCode, 409, rp.body);
    assert.equal(rp.json().code, 'LOTE_ESTADO_CONFLITO');
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
    assert.equal((await mov(m.id)).dados.situacao, 'cancelado');
    assert.deepEqual(await trilha(l.id), ['500->450', '450->500 (cancelamento)']);
  });

  test('ordem B (PATCH válido pega a trava primeiro): 450→400; o cancelamento detecta a intervenção e recusa sem crédito', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    const soltar = await segurarLote(l.id);
    const pPatch = req('PATCH', `/lotes/${l.id}`, c.tokAdm, { quantidade_cabecas: 400, estado_esperado: { quantidade_cabecas: 450 } });
    await new Promise((r) => setTimeout(r, 300));
    const opKey = opId();
    const pCancel = cancelar(c, m.id, c.tokAdm, { operation_id: opKey, motivo: 'lançado por engano' });
    await new Promise((r) => setTimeout(r, 300));
    await soltar();
    const [rp, rc] = await Promise.all([pPatch, pCancel]);
    assert.equal(rp.statusCode, 200, rp.body);
    assert.equal(rc.statusCode, 409, rc.body);
    assert.equal(rc.json().code, 'CANCELAMENTO_ALTERACAO_POSTERIOR');
    assert.equal((await lote(l.id)).quantidade_cabecas, 400, 'nenhum crédito de 50');
    assert.notEqual((await mov(m.id)).dados.situacao, 'cancelado');
    assert.equal(await prisma().operacaoIdempotente.count({ where: { operation_key: opKey } }), 0);
    assert.deepEqual(await trilha(l.id), ['500->450', '450->400']);
  });

  test('destino da transferência alterado concorrentemente: o cancelamento trava os DOIS lotes em ordem de id e recusa', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500 });
    const d = await criarLote(c, { area: c.B, qtd: 100 });
    const { movimentacao: t } = await transferir(c, o, 50, c.B, d.id);
    const soltar = await segurarLote(d.id);
    const pPatch = req('PATCH', `/lotes/${d.id}`, c.tokAdm, { quantidade_cabecas: 145, estado_esperado: { quantidade_cabecas: 150 } });
    await new Promise((r) => setTimeout(r, 300));
    const pCancel = cancelar(c, t.id);
    await new Promise((r) => setTimeout(r, 300));
    await soltar();
    const [rp, rc] = await Promise.all([pPatch, pCancel]);
    assert.equal(rp.statusCode, 200);
    assert.equal(rc.statusCode, 409, rc.body);
    assert.deepEqual([(await lote(o.id)).quantidade_cabecas, (await lote(d.id)).quantidade_cabecas], [450, 145]);
  });

  test('duas transferências parciais disputando a mesma origem (100; 60 + 60) → uma passa, outra 409; total 100', async () => {
    const c = await cenario();
    const l = await criarLote(c, { qtd: 100, area: c.A });
    const soltar = await segurarLote(l.id);
    const corpo = { tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: 60, area_destino_id: c.B.id, categoria_animal: 'BOI' };
    const p1 = manejo(c, corpo);
    const p2 = manejo(c, corpo);
    await new Promise((r) => setTimeout(r, 300));
    await soltar();
    const rs = await Promise.all([p1, p2]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409], rs.map((r) => r.body).join(' | '));
    assert.ok(rs.some((r) => r.json().code === 'MANEJO_SALDO_INSUFICIENTE'));
    const todos = await prisma().lote.findMany({ where: { cliente_id: c.cliente.id } });
    assert.equal(todos.reduce((t, x) => t + x.quantidade_cabecas, 0), 100);
  });

  test('dois cancelamentos simultâneos com chaves diferentes → um 200; saldo 500, não 550', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    const rs = await Promise.all([cancelar(c, m.id), cancelar(c, m.id), cancelar(c, m.id)]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409, 409]);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('mesma chave em paralelo → nenhum crédito duplicado', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    const corpo = { operation_id: opId(), motivo: 'paralelo' };
    const rs = await Promise.all([cancelar(c, m.id, c.tokAdm, corpo), cancelar(c, m.id, c.tokAdm, corpo)]);
    assert.ok(rs.every((r) => r.statusCode === 200 || r.json().code === 'IDEMPOTENCY_IN_PROGRESS'));
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('falha forçada depois de atualizar o lote → rollback completo; retry da mesma chave conclui', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    const p = prisma();
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION r2a_falha() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$ LANGUAGE plpgsql`);
    await p.$executeRawUnsafe(`CREATE TRIGGER r2a_falha BEFORE UPDATE ON "MovimentacaoMapa" FOR EACH ROW WHEN (NEW.id = '${m.id}') EXECUTE FUNCTION r2a_falha()`);
    const corpo = { operation_id: opId(), motivo: 'teste de rollback' };
    try {
      assert.equal((await cancelar(c, m.id, c.tokAdm, corpo)).statusCode, 500);
      assert.equal((await lote(l.id)).quantidade_cabecas, 450);
      assert.equal(await p.operacaoIdempotente.count({ where: { operation_key: corpo.operation_id } }), 0);
    } finally {
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r2a_falha ON "MovimentacaoMapa"`);
      await p.$executeRawUnsafe(`DROP FUNCTION IF EXISTS r2a_falha()`);
    }
    assert.equal((await cancelar(c, m.id, c.tokAdm, corpo)).statusCode, 200);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('"timeout depois do COMMIT": o reenvio com a mesma chave devolve o mesmo resultado, sem segundo crédito', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    const corpo = { operation_id: opId(), motivo: 'resposta perdida' };
    const primeira = await cancelar(c, m.id, c.tokAdm, corpo); // a resposta "se perde" no cliente
    const reenvio = await cancelar(c, m.id, c.tokAdm, corpo);
    assert.equal(primeira.statusCode, 200);
    assert.equal(reenvio.statusCode, 200);
    assert.equal(reenvio.json().replay, true);
    assert.equal(reenvio.json().movimentacao.id, m.id);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('tenants isolados com o mesmo nome de lote', async () => {
    const a = await cenario();
    const b = await cenario();
    const la = await criarLote(a, { area: a.A });
    const lb = await criarLote(b, { area: b.A });
    const ma = await morte(a, la, 50);
    await morte(b, lb, 30);
    assert.equal((await cancelar(a, ma.id)).statusCode, 200);
    assert.deepEqual([(await lote(la.id)).quantidade_cabecas, (await lote(lb.id)).quantidade_cabecas], [500, 470]);
  });
});
