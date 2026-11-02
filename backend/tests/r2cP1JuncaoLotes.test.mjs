/**
 * R2C-P1 (D-PROD-103) — Junção de Lotes por comando atômico com cancelamento causal.
 *
 * PostgreSQL real, HTTP autenticado, dados sintéticos. Toda prova de "nada
 * gravado" conta lotes, movimentos, auditorias e reservas de idempotência.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaR2B } from '../src/modules/movimentacoesMapa/manejoRebanhoComandoService.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

before(async () => {
  process.env.NODE_ENV = 'test';
  app = await criarApp();
  await app.ready();
});
after(async () => {
  definirFalhaInjetadaR2B(0);
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  definirFalhaInjetadaR2B(0);
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const DATA = '2026-10-30T12:00:00.000Z';
const BOI = 'Boi 25 a 36 meses';

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
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const tokComum = (await autenticarNoApp(app, { login: comum.login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const setor2 = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: outraEmpresa.id, numero_setor: '2', nome: 'Setor 2' } });
  const area = async (n, nome, emp = empresa, st = setor) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: st.id, setor_nome: st.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tok, tokComum, empresa, outraEmpresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), X: await area(9, 'PASTO X', outraEmpresa, setor2) };
};

const criarLote = async (c, { nome, qtd, area, categoria = BOI, sexo = 'Macho', peso = null, ident = null, raca = null }) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, ...(sexo ? { sexo } : {}), setor_id: c.setor.id,
    area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo',
    ...(peso !== null ? { peso_medio_kg: peso } : {}),
    ...(ident ? { identificador_nome: ident, identificador_sigla: ident.slice(0, 3), identificador_cor: '#112233' } : {}),
    ...(raca ? { raca_predominante: raca } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const tres = async (c, pesos = [400, 380, 360]) => ({
  p: await criarLote(c, { nome: 'PRINCIPAL', qtd: 40, area: c.A, peso: pesos[0], ident: 'PRIN' }),
  a: await criarLote(c, { nome: 'ORIGEM A', qtd: 30, area: c.A, peso: pesos[1], ident: 'ORIA', raca: 'Nelore' }),
  b: await criarLote(c, { nome: 'ORIGEM B', qtd: 20, area: c.A, peso: pesos[2], ident: 'ORIB', raca: 'Angus' }),
});
const juntar = (c, principal, origens, extra = {}, token = c.tok) =>
  req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', token, {
    operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: principal.id, lote_origem_ids: origens.map((o) => o.id), data_movimentacao: DATA, ...extra,
  });
const ok = async (r) => {
  const x = await r;
  assert.equal(x.statusCode, 201, x.body);
  return x.json();
};
const lote = (id) => prisma().lote.findUnique({ where: { id } });
const mov = (id) => prisma().movimentacaoMapa.findUnique({ where: { id } });
const peso = (l) => (l.peso_medio_kg === null ? null : Number(l.peso_medio_kg));
const cancelar = (c, id, token = c.tok, operation_id = opId()) => req('POST', `/movimentacoes-mapa/${id}/cancelamento`, token, { operation_id, motivo: 'junção por engano' });
const cancelarOk = async (c, id) => {
  const r = await cancelar(c, id);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const totalAtivo = async (c) => (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, status: 'Ativo' } })).reduce((t, l) => t + l.quantidade_cabecas, 0);
const morte = async (c, l, q, data = DATA) => {
  const r = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, lote_id: l.id, quantidade_animais: q, data_movimentacao: data });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().movimentacao;
};
const contagem = async (c) => {
  const p = prisma();
  const lotes = await p.lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } });
  return {
    lotes: lotes.map((l) => [l.id, l.quantidade_cabecas, l.status, peso(l), l.quantidade_entrada]),
    movs: await p.movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }),
    audits: await p.auditLog.count({ where: { cliente_id: c.cliente.id } }),
    ops: await p.operacaoIdempotente.count({ where: { cliente_id: c.cliente.id } }),
  };
};
const exigirNadaGravado = async (c, acao, status, codigo) => {
  const antes = await contagem(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await contagem(c), antes, 'nada pode ser gravado');
  return r;
};
const exigirRecusaCancelamento = async (c, movId, codigos) => {
  const e = (await req('GET', `/movimentacoes-mapa/${movId}/elegibilidade-cancelamento`, c.tok)).json();
  assert.equal(e.elegivel, false, JSON.stringify(e));
  assert.ok(codigos.includes(e.codigo), `elegibilidade ${e.codigo}`);
  const antes = await contagem(c);
  const r = await cancelar(c, movId);
  assert.equal(r.statusCode, 409, r.body);
  assert.ok(codigos.includes(r.json().code), `POST ${r.json().code}`);
  assert.deepEqual(await contagem(c), antes, 'recusa não muda nada');
};

describe('R2C junção — saldo, peso, invariantes e cancelamento', () => {
  test('J1: 40+30+20 → principal 90, origens 0/Inativo, 1 movimento "Junção de Lotes" (não Entrada); entrada e identificação intactas; cancelar volta 40/30/20', async () => {
    const c = await cenario();
    const { p, a, b } = await tres(c);
    const antesP = await lote(p.id);
    const r = await ok(juntar(c, p, [a, b]));
    const m = r.movimentacao;
    assert.equal(m.tipo, 'Junção de Lotes');
    assert.notEqual(m.tipo, 'Entrada');
    assert.equal(m.motivo, undefined);
    assert.deepEqual(m.lote_ids, [p.id, a.id, b.id]);
    assert.equal(m.lote_id, p.id);
    assert.equal(m.quantidade_animais, 50);
    assert.equal(m.efeito_servidor.comando, 'manejo_mapa_juncao_lotes');
    assert.deepEqual(m.linhas.map((l) => [l.lote_id, l.quantidade, l.identificador_nome, l.raca_predominante]), [[a.id, 30, 'ORIA', 'Nelore'], [b.id, 20, 'ORIB', 'Angus']]);
    const [dp, da, db] = await Promise.all([lote(p.id), lote(a.id), lote(b.id)]);
    assert.deepEqual([dp.quantidade_cabecas, dp.status, da.quantidade_cabecas, da.status, db.quantidade_cabecas, db.status], [90, 'Ativo', 0, 'Inativo', 0, 'Inativo']);
    for (const [antes, depois] of [[antesP, dp]]) {
      assert.deepEqual(
        [depois.quantidade_entrada, depois.area_entrada_id, depois.categoria_entrada, depois.origem, depois.identificador_nome, depois.identificador_sigla, depois.identificador_cor, depois.nome, depois.raca_predominante],
        [antes.quantidade_entrada, antes.area_entrada_id, antes.categoria_entrada, antes.origem, antes.identificador_nome, antes.identificador_sigla, antes.identificador_cor, antes.nome, antes.raca_predominante]
      );
    }
    assert.deepEqual([da.quantidade_entrada, db.quantidade_entrada, da.identificador_nome], [30, 20, 'ORIA']);
    assert.equal(await totalAtivo(c), 90);
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 3, 'nenhum lote criado');
    await cancelarOk(c, m.id);
    const v = await Promise.all([lote(p.id), lote(a.id), lote(b.id)]);
    assert.deepEqual(v.map((l) => [l.quantidade_cabecas, l.status, peso(l), l.quantidade_entrada]), [[40, 'Ativo', 400, 40], [30, 'Ativo', 380, 30], [20, 'Ativo', 360, 20]]);
    assert.equal((await mov(m.id)).dados.situacao, 'cancelado');
  });

  test('J2: pesos todos conhecidos → média ponderada (4 casas); um desconhecido → principal fica sem peso (null), nunca zero; cancelar restaura exato', async () => {
    const c = await cenario();
    const { p, a, b } = await tres(c, [400, 380, 360.5]);
    const r = await ok(juntar(c, p, [a, b]));
    assert.equal(peso(await lote(p.id)), Number(((40 * 400 + 30 * 380 + 20 * 360.5) / 90).toFixed(4)));
    assert.equal(r.movimentacao.juncao.politica_peso, 'media_ponderada');
    await cancelarOk(c, r.movimentacao.id);
    assert.equal(peso(await lote(p.id)), 400);

    const d = await cenario();
    const t = await tres(d, [400, null, 360]);
    const r2 = await ok(juntar(d, t.p, [t.a, t.b]));
    assert.equal(peso(await lote(t.p.id)), null);
    assert.equal(r2.movimentacao.juncao.politica_peso, 'desconhecido_sem_media');
    await cancelarOk(d, r2.movimentacao.id);
    assert.equal(peso(await lote(t.p.id)), 400);
    // Principal sem peso: cancelamento restaura null.
    const e = await cenario();
    const t3 = await tres(e, [null, 380, 360]);
    const r3 = await ok(juntar(e, t3.p, [t3.a]));
    await cancelarOk(e, r3.movimentacao.id);
    assert.equal(peso(await lote(t3.p.id)), null);
  });

  test('J3: 1 origem e muitas origens (2 e 6 lotes) conservam o total', async () => {
    const c = await cenario();
    const p = await criarLote(c, { nome: 'P', qtd: 10, area: c.A, peso: 300 });
    const os = [];
    for (let i = 0; i < 5; i += 1) os.push(await criarLote(c, { nome: `O${i}`, qtd: i + 1, area: c.A, peso: 300 }));
    await ok(juntar(c, p, [os[0]]));
    assert.equal((await lote(p.id)).quantidade_cabecas, 11);
    await ok(juntar(c, p, os.slice(1)));
    assert.equal((await lote(p.id)).quantidade_cabecas, 25);
    assert.equal(await totalAtivo(c), 25);
  });
});

describe('R2C junção — validações no servidor (nada gravado)', () => {
  test('V1: forma — duplicado, principal entre origens, vazio, teto, campos do navegador, data impossível → 400', async () => {
    const c = await cenario();
    const { p, a } = await tres(c);
    const muitos = Array.from({ length: 21 }, (_, i) => ({ id: `x${i}` }));
    for (const [origens, extra] of [
      [[a, a], {}],
      [[p], {}],
      [[], {}],
      [muitos, {}],
      [[a], { quantidade_cabecas: 90 }],
      [[a], { peso_medio_kg: 1 }],
      [[a], { cliente_id: 'x' }],
      [[a], { efeito_servidor: {} }],
      [[a], { data_movimentacao: '2026-02-30' }],
    ]) {
      await exigirNadaGravado(c, () => juntar(c, p, origens, extra), 400);
    }
  });

  test('V2: lote zerado/inativo, excluído, de outra área → recusa estável', async () => {
    const c = await cenario();
    const { p, a, b } = await tres(c);
    await prisma().lote.update({ where: { id: a.id }, data: { status: 'Inativo', quantidade_cabecas: 0 } });
    await exigirNadaGravado(c, () => juntar(c, p, [a]), 409, 'JUNCAO_LOTE_INELEGIVEL');
    await prisma().lote.update({ where: { id: b.id }, data: { excluido_em: new Date() } });
    await exigirNadaGravado(c, () => juntar(c, p, [b]), 404, 'LOTE_NOT_FOUND');
    const fora = await criarLote(c, { nome: 'FORA', qtd: 9, area: c.B });
    await exigirNadaGravado(c, () => juntar(c, p, [fora]), 409, 'JUNCAO_LOTE_INELEGIVEL');
  });

  test('V3: categoria, sexo, categoria de manejo divergentes ou sexo indefinido → JUNCAO_CLASSIFICACAO_DIVERGENTE', async () => {
    const c = await cenario();
    const p = await criarLote(c, { nome: 'P', qtd: 10, area: c.A });
    const cat = await criarLote(c, { nome: 'GAR', qtd: 5, area: c.A, categoria: 'Garrote 13 a 24 meses' });
    const sexo = await criarLote(c, { nome: 'F', qtd: 5, area: c.A, sexo: 'Fêmea' });
    const semSexo = await criarLote(c, { nome: 'S', qtd: 5, area: c.A, sexo: null });
    const cm = await prisma().categoriaManejo.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome: 'BOI MAGRO', categoria_oficial: BOI, sexo: 'Macho' } });
    const comCm = await criarLote(c, { nome: 'CM', qtd: 5, area: c.A });
    await prisma().lote.update({ where: { id: comCm.id }, data: { categoria_manejo_id: cm.id, categoria_manejo_nome: cm.nome } });
    for (const o of [cat, sexo, semSexo, comCm]) await exigirNadaGravado(c, () => juntar(c, p, [o]), 409, 'JUNCAO_CLASSIFICACAO_DIVERGENTE');
    await exigirNadaGravado(c, () => juntar(c, semSexo, [sexo]), 409, 'JUNCAO_CLASSIFICACAO_DIVERGENTE');
  });

  test('V4: área de outra empresa, área inexistente, outro tenant, homônimos com ids diferentes', async () => {
    const c = await cenario();
    const { p, a } = await tres(c);
    await exigirNadaGravado(c, () => juntar(c, p, [a], { area_id: c.X.id }), 404, 'AREA_NOT_FOUND');
    await exigirNadaGravado(c, () => juntar(c, p, [a], { area_id: 'nao-existe' }), 404, 'AREA_NOT_FOUND');
    const outro = await cenario();
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', outro.tok, {
      operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: p.id, lote_origem_ids: [a.id], data_movimentacao: DATA,
    }), 404);
    const homonimo = await criarLote(c, { nome: 'ORIGEM A', qtd: 7, area: c.A });
    const r = await ok(juntar(c, p, [homonimo]));
    assert.deepEqual(r.movimentacao.lote_ids, [p.id, homonimo.id]);
    assert.equal((await lote(a.id)).quantidade_cabecas, 30, 'homônimo com outro id não é tocado');
  });

  test('V5: evento posterior ATIVO num participante → JUNCAO_DATA_RETROATIVA; só cancelados (> 600) não bloqueiam', async () => {
    const c = await cenario();
    const { p, a } = await tres(c);
    const m = await morte(c, a, 1, '2026-11-05T12:00:00.000Z');
    await exigirNadaGravado(c, () => juntar(c, p, [a]), 409, 'JUNCAO_DATA_RETROATIVA');
    await cancelarOk(c, m.id);
    await prisma().movimentacaoMapa.createMany({
      data: Array.from({ length: 610 }, () => ({
        cliente_id: c.cliente.id, empresa_id: c.empresa.id,
        dados: { tipo: 'Pesagem', lote_id: a.id, data_movimentacao: '2026-12-01T12:00:00.000Z', situacao: 'cancelado' },
      })),
    });
    await ok(juntar(c, p, [a]));
    // Um ativo no meio de > 600 cancelados volta a bloquear (consulta completa, sem teto).
    const d = await cenario();
    const t = await tres(d);
    await prisma().movimentacaoMapa.createMany({
      data: Array.from({ length: 610 }, (_, i) => ({
        cliente_id: d.cliente.id, empresa_id: d.empresa.id,
        dados: { tipo: 'Pesagem', lote_id: t.b.id, data_movimentacao: '2026-12-01T12:00:00.000Z', ...(i === 605 ? {} : { situacao: 'cancelado' }) },
      })),
    });
    await exigirNadaGravado(d, () => juntar(d, t.p, [t.b]), 409, 'JUNCAO_DATA_RETROATIVA');
  });

  test('V6: falha injetada em cada efeito e antes do movimento → banco inalterado (lotes, movimento, auditoria, idempotência)', async () => {
    for (const n of [1, 2, 3, 4]) {
      const c = await cenario();
      const { p, a, b } = await tres(c);
      definirFalhaInjetadaR2B(n);
      await exigirNadaGravado(c, () => juntar(c, p, [a, b]), 500);
      definirFalhaInjetadaR2B(0);
    }
  });

  test('V7: replay da mesma chave devolve o mesmo resultado; conteúdo divergente → 409; retry após commit não duplica', async () => {
    const c = await cenario();
    const { p, a, b } = await tres(c);
    const corpo = { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: p.id, lote_origem_ids: [a.id], data_movimentacao: DATA };
    const url = '/movimentacoes-mapa/comandos/juncao-lotes';
    const r1 = await ok(req('POST', url, c.tok, corpo));
    const r2 = await ok(req('POST', url, c.tok, corpo));
    assert.equal(r2.replay, true);
    assert.equal(r2.movimentacao.id, r1.movimentacao.id);
    await exigirNadaGravado(c, () => req('POST', url, c.tok, { ...corpo, lote_origem_ids: [b.id] }), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await lote(p.id)).quantidade_cabecas, 70);
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
  });
});

describe('R2C junção — cancelamento certificado', () => {
  test('K1: não-admin não cancela; dois cancelamentos: o segundo é recusado sem mutação dupla', async () => {
    const c = await cenario();
    const { p, a } = await tres(c);
    const r = await ok(juntar(c, p, [a]));
    const comum = await cancelar(c, r.movimentacao.id, c.tokComum);
    assert.equal(comum.json().code, 'TENANT_ADMIN_REQUIRED');
    await cancelarOk(c, r.movimentacao.id);
    await exigirRecusaCancelamento(c, r.movimentacao.id, ['CANCELAMENTO_JA_REALIZADO']);
    assert.deepEqual([(await lote(p.id)).quantidade_cabecas, (await lote(a.id)).quantidade_cabecas], [40, 30]);
  });

  test('K2: dependência posterior R2A (morte no principal) e R2B (pesagem) bloqueiam; ida e volta de peso por PATCH bloqueia', async () => {
    const c = await cenario();
    const { p, a } = await tres(c);
    const r = await ok(juntar(c, p, [a]));
    const m = await morte(c, p, 2, '2026-10-31T12:00:00.000Z');
    await exigirRecusaCancelamento(c, r.movimentacao.id, ['CANCELAMENTO_DEPENDENCIA_POSTERIOR']);
    await cancelarOk(c, m.id);
    const ps = await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, {
      operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-31T12:00:00.000Z',
      linhas: [{ lote_id: p.id, peso_medio_kg: 420 }],
    }));
    await exigirRecusaCancelamento(c, r.movimentacao.id, ['CANCELAMENTO_DEPENDENCIA_POSTERIOR']);
    await cancelarOk(c, ps.movimentacao.id);
    await cancelarOk(c, r.movimentacao.id);
    assert.deepEqual([(await lote(p.id)).quantidade_cabecas, (await lote(a.id)).quantidade_cabecas], [40, 30]);

    const d = await cenario();
    const t = await tres(d);
    const r2 = await ok(juntar(d, t.p, [t.a]));
    const pesoJunto = peso(await lote(t.p.id));
    assert.equal((await req('PATCH', `/lotes/${t.p.id}`, d.tok, { peso_medio_kg: 999 })).statusCode, 200);
    assert.equal((await req('PATCH', `/lotes/${t.p.id}`, d.tok, { peso_medio_kg: pesoJunto })).statusCode, 200);
    await exigirRecusaCancelamento(d, r2.movimentacao.id, ['CANCELAMENTO_ALTERACAO_POSTERIOR']);
  });

  test('K3: efeito forjado (operação de outro movimento) → CANCELAMENTO_EFEITO_NAO_COMPROVADO', async () => {
    const c = await cenario();
    const { p, a, b } = await tres(c);
    const r1 = await ok(juntar(c, p, [a]));
    const p2 = await criarLote(c, { nome: 'P2', qtd: 5, area: c.A });
    const r2 = await ok(juntar(c, p2, [b]));
    const d2 = (await mov(r2.movimentacao.id)).dados;
    await prisma().movimentacaoMapa.update({
      where: { id: r2.movimentacao.id },
      data: { dados: { ...d2, efeito_servidor: { ...d2.efeito_servidor, operation_id: r1.movimentacao.efeito_servidor.operation_id } } },
    });
    await exigirRecusaCancelamento(c, r2.movimentacao.id, ['CANCELAMENTO_EFEITO_NAO_COMPROVADO']);
  });
});

describe('R2C junção — histórico, exclusão (#167) e POST genérico', () => {
  test('H1: histórico pelo principal e por CADA absorvido acha a junção; pela área também', async () => {
    const c = await cenario();
    const { p, a, b } = await tres(c);
    const r = await ok(juntar(c, p, [a, b]));
    for (const l of [p, a, b]) {
      const h = (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${l.id}`, c.tok)).json();
      assert.deepEqual(h.items.map((m) => m.id), [r.movimentacao.id], l.nome);
      assert.equal(h.total, 1);
    }
    const area = (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&area_id=${c.A.id}`, c.tok)).json();
    assert.deepEqual(area.items.map((m) => m.id), [r.movimentacao.id]);
  });

  test('H2: #167 — participante de junção ativa não sai do Cadastro; depois do cancelamento, exclusão lógica (histórico preservado)', async () => {
    const c = await cenario();
    const { p, a } = await tres(c);
    const r = await ok(juntar(c, p, [a]));
    for (const l of [p, a]) {
      const e = (await req('GET', `/lotes/${l.id}/elegibilidade-exclusao`, c.tok)).json();
      assert.deepEqual([e.tipo, e.motivo], ['bloqueado', 'movimentacao_ativa'], JSON.stringify(e));
      assert.equal((await req('DELETE', `/lotes/${l.id}`, c.tok)).statusCode, 409);
    }
    await cancelarOk(c, r.movimentacao.id);
    for (const l of [p, a]) {
      assert.equal((await req('GET', `/lotes/${l.id}/elegibilidade-exclusao`, c.tok)).json().tipo, 'exclusao_logica');
      assert.equal((await req('DELETE', `/lotes/${l.id}`, c.tok)).statusCode, 204);
      assert.ok((await lote(l.id)).excluido_em);
    }
    const h = (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${a.id}`, c.tok)).json();
    assert.deepEqual(h.items.map((m) => [m.id, m.situacao]), [[r.movimentacao.id, 'cancelado']]);
  });

  test('G1: POST genérico de junção (tipo novo, legado Entrada+motivo, marcador) → 409; campo "juncao" → 400; Entrada legítima passa', async () => {
    const c = await cenario();
    const { p } = await tres(c);
    const base = { empresa_id: c.empresa.id, lote: p.nome, lote_id: p.id, quantidade_animais: 90, area_origem_id: c.A.id };
    for (const corpo of [
      { ...base, tipo: 'Junção de Lotes' },
      { ...base, tipo: 'Entrada', motivo: 'Junção de Lotes' },
      { ...base, tipo: 'Entrada', motivo: 'juncao de lotes' },
      { ...base, tipo: 'Entrada', observacoes: '[JUNCAO_LOTES][{"id":"x"}]' },
    ]) {
      await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa', c.tok, corpo), 409, 'JUNCAO_SOMENTE_POR_COMANDO');
    }
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa', c.tok, { ...base, tipo: 'Entrada', juncao: {} }), 400);
    const legit = await req('POST', '/movimentacoes-mapa', c.tok, { ...base, tipo: 'Entrada', motivo: 'Compra', quantidade_animais: 5 });
    assert.equal(legit.statusCode, 201, legit.body);
  });
});

describe('R2C junção — concorrência real (3 rodadas)', () => {
  for (let rodada = 1; rodada <= 3; rodada += 1) {
    test(`C1.${rodada}: duas junções com origem compartilhada → uma vale, a outra 409; nada duplicado`, async () => {
      const c = await cenario();
      const p1 = await criarLote(c, { nome: 'P1', qtd: 10, area: c.A, peso: 300 });
      const p2 = await criarLote(c, { nome: 'P2', qtd: 20, area: c.A, peso: 300 });
      const a = await criarLote(c, { nome: 'A', qtd: 30, area: c.A, peso: 300 });
      const rs = await Promise.all([juntar(c, p1, [a]), juntar(c, p2, [a])]);
      assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409], rs.map((r) => r.body).join(' | '));
      assert.equal(await totalAtivo(c), 60);
      assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
    });

    test(`C2.${rodada}: junção × morte na origem → conservação exata, sem 500`, async () => {
      const c = await cenario();
      const { p, a } = await tres(c);
      const [j, m] = await Promise.all([
        juntar(c, p, [a]),
        req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, lote_id: a.id, quantidade_animais: 3, data_movimentacao: '2026-10-29T12:00:00.000Z' }),
      ]);
      assert.ok([201, 409].includes(j.statusCode), j.body);
      assert.ok([201, 404, 409].includes(m.statusCode), m.body);
      const mortos = m.statusCode === 201 ? 3 : 0;
      assert.equal(await totalAtivo(c), 90 - mortos);
    });

    test(`C3.${rodada}: junção × transferência da origem → nunca os dois sobre a mesma cabeça`, async () => {
      const c = await cenario();
      const { p, a } = await tres(c);
      const [j, t] = await Promise.all([
        juntar(c, p, [a]),
        req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: a.id, quantidade_animais: 30, area_destino_id: c.B.id, data_movimentacao: '2026-10-29T12:00:00.000Z' }),
      ]);
      assert.ok([201, 409].includes(j.statusCode), j.body);
      assert.ok([201, 409].includes(t.statusCode), t.body);
      assert.ok(!(j.statusCode === 201 && t.statusCode === 201), 'as 30 cabeças não podem ser juntadas e transferidas');
      assert.equal(await totalAtivo(c), 90);
    });

    test(`C4.${rodada}: junção × DELETE da origem → sem exclusão órfã`, async () => {
      const c = await cenario();
      const { p, a } = await tres(c);
      const [j, d] = await Promise.all([juntar(c, p, [a]), req('DELETE', `/lotes/${a.id}`, c.tok)]);
      assert.ok([201, 404, 409].includes(j.statusCode), j.body);
      assert.ok([204, 409].includes(d.statusCode), d.body);
      assert.ok(!(j.statusCode === 201 && d.statusCode === 204), 'lote da junção não pode sumir');
      const l = await lote(a.id);
      if (j.statusCode === 201) assert.ok(l && !l.excluido_em);
    });

    test(`C5.${rodada}: cancelar junção × pesagem do principal → nunca reverte por cima`, async () => {
      const c = await cenario();
      const { p, a } = await tres(c);
      const r = await ok(juntar(c, p, [a]));
      const [canc, pes] = await Promise.all([
        cancelar(c, r.movimentacao.id),
        req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-31T12:00:00.000Z', linhas: [{ lote_id: p.id, peso_medio_kg: 450 }] }),
      ]);
      assert.ok([200, 409].includes(canc.statusCode), canc.body);
      assert.equal(pes.statusCode, 201, pes.body);
      assert.equal(peso(await lote(p.id)), 450);
      if (canc.statusCode === 200) assert.equal(pes.json().movimentacao.linhas[0].peso_anterior_kg, 400);
      else assert.equal(canc.json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    });
  }
});
