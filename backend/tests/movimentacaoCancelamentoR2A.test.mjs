/**
 * R2A (D-PROD-99) — fechamento de rotas destrutivas e cancelamento transacional
 * de movimentação do mapa. PostgreSQL real, dados sintéticos.
 *
 * PR174-R5: o cancelamento que revertia saldo em Lote não existe mais; os
 * riscos dele estão provados no ledger (r2eR5CancelamentoLedger e demais
 * suítes r2e — mapa em docs/engineering/evidencias/r2e-p1-lotes-ssot/
 * r5-cutover/cobertura-legado-para-ledger.txt). Aqui ficam as rotas
 * destrutivas fechadas e o CAS do PATCH de cadastro na empresa não migrada.
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
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
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
const lote = async (id) => prisma().lote.findUnique({ where: { id } });
// ─── P0 — rotas destrutivas fechadas no servidor ──────────────────────────

describe('P0 — MovimentacaoMapa e MovimentacaoPecuaria', () => {
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

describe('R2A-R1 — proveniência causal (nunca prova emprestada)', () => {
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

});

describe('R2A-R1 — concorrência de saldo (CAS) e rollback', () => {
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
});
