/**
 * PR174-R5 (D-PROD-107) — cancelamento de movimentação do mapa SÓ pelo ledger.
 *
 * Conversão dos riscos que o motor legado de cancelamento (R2A, que revertia
 * saldo em Lote) provava e que o ledger também precisa garantir: rotas
 * destrutivas fechadas, autorização, proveniência que não se forja,
 * concorrência, rollback, replay e isolamento de tenant. Cada prova confere
 * posições/partidas/movimento no banco; Lote (cadastro de entrada) nunca muda.
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

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const BOI = 'Boi 25 a 36 meses';

/** Tenant com admin + usuário comum, empresa ATIVADA (pelas entradas), duas áreas e uma entrada de 500. */
const cenario = async ({ nome = 'NELORE' } = {}) => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const comum = await p.usuario.create({
    data: {
      cliente_id: adm.cliente.id, nome: 'Comum', login: `comum-${randomUUID().slice(0, 8)}`,
      senha_hash: (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash, papel_tenant: 'usuario',
    },
  });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const tokComum = (await autenticarNoApp(app, { login: comum.login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nomeArea) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome: nomeArea, tamanho_hectares: 10 } });
  const c = { cliente: adm.cliente, tok, tokComum, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
  const r = await req('POST', '/lotes', tok, {
    empresa_id: empresa.id, nome, quantidade_cabecas: 500, categoria: BOI, sexo: 'Macho', setor_id: setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id,
    data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 400,
  });
  assert.equal(r.statusCode, 201, r.body);
  c.lote = r.json();
  const a = await req('POST', '/rebanho/ativacao', tok, { operation_id: opId(), empresa_id: empresa.id, modo: 'entradas' });
  assert.equal(a.statusCode, 201, a.body);
  c.posA = await posicao(c, c.A);
  return c;
};
const posicao = async (c, area) =>
  (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}&incluir_vazias=true`, c.tok)).json().itens.find((x) => x.lote_entrada_id === c.lote.id && x.area_atual_id === area.id);
const saldo = async (c, area) => (await posicao(c, area))?.quantidade_cabecas ?? 0;
const morte = async (c, q, token = c.tok) => {
  const r = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', token, {
    operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, lote_id: c.posA.id, quantidade_animais: q, data_movimentacao: '2026-10-30',
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().movimentacao;
};
const cancelar = (c, id, token = c.tok, body = { operation_id: opId(), motivo: 'lançado por engano' }) => req('POST', `/movimentacoes-mapa/${id}/cancelamento`, token, body);
const mov = (id) => prisma().movimentacaoMapa.findUnique({ where: { id } });
const loteFixo = async (c) => {
  const l = await prisma().lote.findUnique({ where: { id: c.lote.id } });
  return [l.quantidade_cabecas, l.status, l.area_atual_id];
};
const foto = async (c) => {
  const w = { cliente_id: c.cliente.id };
  return {
    lote: await loteFixo(c),
    posicoes: (await prisma().posicaoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.quantidade_cabecas]),
    partidasAtivas: await prisma().partidaRebanho.count({ where: { ...w, ativa: true } }),
    eventosCancelados: await prisma().eventoRebanho.count({ where: { ...w, situacao: 'cancelado' } }),
    movs: (await prisma().movimentacaoMapa.findMany({ where: w, orderBy: { id: 'asc' } })).map((m) => [m.id, m.dados.situacao ?? null]),
    ops: await prisma().operacaoIdempotente.count({ where: w }),
    audits: await prisma().auditLog.count({ where: w }),
  };
};
const exigirNadaMuda = async (c, acao, status, codigo) => {
  const antes = await foto(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await foto(c), antes, 'nada pode mudar');
  return r;
};

describe('R5 cancelamento no ledger — rotas, autorização e proveniência', () => {
  test('CL1: DELETE e PATCH diretos do movimento do ledger → 409 MOVIMENTO_CANCELAMENTO_OBRIGATORIO; nada muda; outro tenant → 404', async () => {
    const c = await cenario();
    const m = await morte(c, 50);
    for (const [metodo, corpo] of [['DELETE', undefined], ['PATCH', { quantidade_animais: 1 }], ['PATCH', { observacoes: 'só texto' }]]) {
      await exigirNadaMuda(c, () => req(metodo, `/movimentacoes-mapa/${m.id}`, c.tok, corpo), 409, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO');
    }
    assert.equal(await saldo(c, c.A), 450);
    const outro = await cenario();
    for (const [metodo, corpo] of [['DELETE', undefined], ['PATCH', { observacoes: 'x' }]]) {
      assert.equal((await req(metodo, `/movimentacoes-mapa/${m.id}`, outro.tok, corpo)).statusCode, 404);
    }
    assert.deepEqual(await loteFixo(c), [500, 'Ativo', c.A.id], 'Lote intacto');
  });

  test('CL2: autorização — comum 403, outro tenant 404 (cancelamento e elegibilidade), sem token 401, cliente_id no corpo 400, admin revogado 403 — nada muda', async () => {
    const c = await cenario();
    const m = await morte(c, 50);
    const outro = await cenario();
    await exigirNadaMuda(c, () => cancelar(c, m.id, c.tokComum), 403, 'TENANT_ADMIN_REQUIRED');
    await exigirNadaMuda(c, () => cancelar(c, m.id, outro.tok), 404);
    assert.equal((await req('GET', `/movimentacoes-mapa/${m.id}/elegibilidade-cancelamento`, outro.tok)).statusCode, 404);
    await exigirNadaMuda(c, () => req('POST', `/movimentacoes-mapa/${m.id}/cancelamento`, null, { operation_id: opId(), motivo: 'x x x' }), 401);
    await exigirNadaMuda(c, () => cancelar(c, m.id, c.tok, { operation_id: opId(), motivo: 'ok ok', cliente_id: outro.cliente.id }), 400);
    const e = (await req('GET', `/movimentacoes-mapa/${m.id}/elegibilidade-cancelamento`, c.tokComum)).json();
    assert.deepEqual([e.elegivel, e.pode_cancelar], [true, false], JSON.stringify(e));
    // Admin rebaixado depois de emitido o token: o papel é relido do banco.
    await prisma().usuario.updateMany({ where: { cliente_id: c.cliente.id, papel_tenant: 'administrador' }, data: { papel_tenant: 'usuario' } });
    await exigirNadaMuda(c, () => cancelar(c, m.id), 403, 'TENANT_ADMIN_REQUIRED');
    assert.equal(await saldo(c, c.A), 450);
    assert.equal((await mov(m.id)).dados.situacao, undefined);
  });

  test('CL3: proveniência do ledger copiada para outro movimento (forja direta no banco) não cancela nada: o evento aponta para o original', async () => {
    const c = await cenario();
    const m = await morte(c, 50);
    const original = await mov(m.id);
    const forjado = await prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { ...original.dados } } });
    const e = (await req('GET', `/movimentacoes-mapa/${forjado.id}/elegibilidade-cancelamento`, c.tok)).json();
    assert.deepEqual([e.elegivel, e.codigo], [false, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO'], JSON.stringify(e));
    await exigirNadaMuda(c, () => cancelar(c, forjado.id), 409, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    // O original segue cancelável e devolve exatamente as cabeças dele.
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    assert.equal(await saldo(c, c.A), 500);
    assert.deepEqual(await loteFixo(c), [500, 'Ativo', c.A.id]);
  });

  test('CL4: duas mortes iguais — cada cancelamento desfaz só o próprio fato (500 → 400 → 450 → 500); repetir → CANCELAMENTO_JA_REALIZADO', async () => {
    const c = await cenario();
    const m1 = await morte(c, 50);
    const m2 = await morte(c, 50);
    assert.equal(await saldo(c, c.A), 400);
    assert.equal((await cancelar(c, m2.id)).statusCode, 200);
    assert.equal(await saldo(c, c.A), 450);
    await exigirNadaMuda(c, () => cancelar(c, m2.id), 409, 'CANCELAMENTO_JA_REALIZADO');
    assert.equal((await cancelar(c, m1.id)).statusCode, 200);
    assert.equal(await saldo(c, c.A), 500);
    assert.deepEqual(await loteFixo(c), [500, 'Ativo', c.A.id]);
  });
});

describe('R5 cancelamento no ledger — concorrência, rollback e replay', () => {
  test('CL5: dois cancelamentos simultâneos com chaves diferentes (3 rodadas) → um 200, outro 409; cabeças devolvidas uma vez só (500, não 550)', async () => {
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await limparBanco();
      const c = await cenario();
      const m = await morte(c, 50);
      const rs = await Promise.all([cancelar(c, m.id), cancelar(c, m.id)]);
      assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409], rs.map((r) => r.body).join(' / '));
      assert.equal(rs.find((r) => r.statusCode === 409).json().code, 'CANCELAMENTO_JA_REALIZADO');
      assert.equal(await saldo(c, c.A), 500, `rodada ${rodada}`);
      assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id, situacao: 'cancelado', tipo: { not: 'ENTRADA' } } }), 1);
    }
  });

  test('CL6: mesma chave em paralelo (3 rodadas) → um efeito, o outro replay ou em processamento; nunca crédito duplicado', async () => {
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await limparBanco();
      const c = await cenario();
      const m = await morte(c, 50);
      const corpo = { operation_id: opId(), motivo: 'mesma chave' };
      const rs = await Promise.all([cancelar(c, m.id, c.tok, corpo), cancelar(c, m.id, c.tok, corpo)]);
      assert.ok(rs.every((r) => [200, 409].includes(r.statusCode)), rs.map((r) => r.body).join(' / '));
      assert.ok(rs.some((r) => r.statusCode === 200 && !r.json().replay));
      assert.equal(await saldo(c, c.A), 500, `rodada ${rodada}`);
      assert.equal(await prisma().operacaoIdempotente.count({ where: { cliente_id: c.cliente.id, operation_key: corpo.operation_id } }), 1);
    }
  });

  test('CL7: falha forçada no fim do cancelamento → rollback completo (partidas, evento, posição, reserva); retry da mesma chave conclui; reenvio depois do COMMIT devolve o mesmo resultado', async () => {
    const c = await cenario();
    const m = await morte(c, 50);
    const p = prisma();
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION r5_falha() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$ LANGUAGE plpgsql`);
    await p.$executeRawUnsafe(`CREATE TRIGGER r5_falha BEFORE UPDATE ON "MovimentacaoMapa" FOR EACH ROW WHEN (NEW.id = '${m.id}') EXECUTE FUNCTION r5_falha()`);
    const corpo = { operation_id: opId(), motivo: 'teste de rollback' };
    try {
      await exigirNadaMuda(c, () => cancelar(c, m.id, c.tok, corpo), 500);
      assert.equal(await p.operacaoIdempotente.count({ where: { operation_key: corpo.operation_id } }), 0);
    } finally {
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS r5_falha ON "MovimentacaoMapa"');
      await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS r5_falha()');
    }
    const primeira = await cancelar(c, m.id, c.tok, corpo);
    assert.equal(primeira.statusCode, 200, primeira.body);
    assert.equal(await saldo(c, c.A), 500);
    // "Timeout depois do COMMIT": o reenvio com a mesma chave é replay, sem segundo crédito.
    const reenvio = await exigirNadaMuda(c, () => cancelar(c, m.id, c.tok, corpo), 200);
    assert.equal(reenvio.json().replay, true);
    assert.equal(reenvio.json().movimentacao.id, m.id);
    assert.equal(await saldo(c, c.A), 500);
    // Mesma chave com outro corpo → conflito, nada muda.
    await exigirNadaMuda(c, () => cancelar(c, m.id, c.tok, { operation_id: corpo.operation_id, motivo: 'outro motivo' }), 409, 'IDEMPOTENCY_CONFLICT');
  });

  test('CL8: tenants isolados com o mesmo nome de entrada — cancelar em A não toca B', async () => {
    const a = await cenario();
    const b = await cenario();
    const ma = await morte(a, 50);
    await morte(b, 30);
    const antesB = await foto(b);
    assert.equal((await cancelar(a, ma.id)).statusCode, 200);
    assert.deepEqual([await saldo(a, a.A), await saldo(b, b.A)], [500, 470]);
    assert.deepEqual(await foto(b), antesB);
  });

  test('CL9: identificação nunca é sobrescrita — junção (com origem identificada) e o cancelamento dela não tocam identificador do cadastro nem da posição principal', async () => {
    const c = await cenario();
    const ident = (x) => [x.identificador_nome ?? null, x.identificador_sigla ?? null, x.identificador_cor ?? null];
    const r = await req('POST', '/lotes', c.tok, {
      empresa_id: c.empresa.id, nome: 'ORIGEM', quantidade_cabecas: 100, categoria: BOI, sexo: 'Macho', setor_id: c.setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id,
      data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo', identificador_nome: 'ORIGEM', identificador_sigla: 'ORG', identificador_cor: '#ff0000',
    });
    assert.equal(r.statusCode, 201, r.body);
    const origem = r.json();
    await prisma().lote.update({ where: { id: c.lote.id }, data: { identificador_nome: 'DESTINO', identificador_sigla: 'DST', identificador_cor: '#112233' } });
    const lotesAntes = await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } });
    const posOrigem = (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}`, c.tok)).json().itens.find((x) => x.lote_entrada_id === origem.id);
    const principalAntes = ident(await prisma().posicaoRebanho.findUnique({ where: { id: c.posA.id } }));
    const j = await req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, {
      operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: c.posA.id, lote_origem_ids: [posOrigem.id], data_movimentacao: '2026-10-30',
    });
    assert.equal(j.statusCode, 201, j.body);
    assert.deepEqual(ident(await prisma().posicaoRebanho.findUnique({ where: { id: c.posA.id } })), principalAntes, 'principal mantém a própria identificação');
    assert.equal((await cancelar(c, j.json().movimentacao.id)).statusCode, 200);
    assert.deepEqual(ident(await prisma().posicaoRebanho.findUnique({ where: { id: c.posA.id } })), principalAntes);
    assert.deepEqual(await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } }), lotesAntes, 'cadastro (Lote) intocado pela junção e pelo cancelamento');
  });
});
