/**
 * D-PROD-309 — sincronização incremental: GET /…/mudancas.
 *
 * MU-01 primeira sincronização (sem `desde`): tudo, em páginas estáveis (cursor), com `agora`
 * MU-02 com `desde`: só o que mudou depois (menos a margem), não o resto
 * MU-03 lote excluído logicamente e ponto apagado de vez saem em `excluidos`
 * MU-04 lançamento cancelado sai em `excluidos`
 * MU-05 outro tenant nunca aparece (nem item nem exclusão)
 * MU-06 `desde` ou `cursor` inválido: 400, nada consultado
 * MU-07 exclusões demais no período: `recarregar` (o aparelho baixa a lista toda)
 * MU-08 leituras de cocho: mesma forma da listagem
 * MU-09 (D-PROD-315) as consultas de mudanças e de exclusões usam os índices da sincronização
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { LIMITE_EXCLUIDOS } from '../src/shared/sincronizacao/mudancasIncrementais.js';

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
  app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload } : {}) });

const conta = async () => {
  const c = await criarTenant();
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  const empresa = await prisma().empresa.create({
    data: { cliente_id: c.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' },
  });
  return { ...c, token: corpo.token, empresa };
};

const criarLote = async (c, nome) => {
  const r = await req('POST', '/lotes', c.token, { empresa_id: c.empresa.id, nome, quantidade_cabecas: 10, motivo_entrada: 'Compra' });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

/** Envelhece o registro (como se tivesse mudado há uma hora). */
const envelhecer = (tabela, id) => prisma().$executeRawUnsafe(`UPDATE "${tabela}" SET "updatedAt" = now() - interval '1 hour' WHERE id = $1`, id);

describe('D-PROD-309 — GET /lotes/mudancas', () => {
  test('MU-01 sem `desde`: tudo, em páginas estáveis, com `agora`', async () => {
    const c = await conta();
    const nomes = ['A', 'B', 'C', 'D', 'E'];
    for (const n of nomes) await criarLote(c, n);
    const vistos = [];
    let cursor = null;
    let paginas = 0;
    do {
      const r = await req('GET', `/lotes/mudancas?limite=2${cursor ? `&cursor=${cursor}` : ''}`, c.token);
      assert.equal(r.statusCode, 200, r.body);
      const corpo = r.json();
      assert.ok(Date.parse(corpo.agora));
      assert.equal(corpo.recarregar, false);
      vistos.push(...corpo.itens.map((l) => l.nome));
      cursor = corpo.proximo;
      paginas += 1;
    } while (cursor);
    assert.equal(paginas, 3);
    assert.deepEqual([...vistos].sort(), nomes);
    // A forma é a mesma da listagem.
    const lista = (await req('GET', '/lotes', c.token)).json();
    const daMudanca = (await req('GET', '/lotes/mudancas', c.token)).json().itens;
    assert.deepEqual(
      daMudanca.map((l) => l.id).sort(),
      lista.map((l) => l.id).sort()
    );
    assert.deepEqual(daMudanca.find((l) => l.nome === 'A'), lista.find((l) => l.nome === 'A'));
  });

  test('MU-02 com `desde`: só o que mudou depois (menos a margem)', async () => {
    const c = await conta();
    const velho = await criarLote(c, 'VELHO');
    const mexido = await criarLote(c, 'MEXIDO');
    await envelhecer('Lote', velho.id);
    await envelhecer('Lote', mexido.id);
    const desde = new Date().toISOString();
    const r1 = (await req('GET', `/lotes/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(r1.itens, []);
    assert.deepEqual(r1.excluidos, []);
    const p = await req('PATCH', `/lotes/${mexido.id}`, c.token, { nome: 'MEXIDO 2' });
    assert.equal(p.statusCode, 200, p.body);
    const novo = await criarLote(c, 'NOVO');
    const r2 = (await req('GET', `/lotes/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(r2.itens.map((l) => l.id).sort(), [mexido.id, novo.id].sort());
    assert.equal(r2.itens.find((l) => l.id === mexido.id).nome, 'MEXIDO 2');
  });

  test('MU-03 lote excluído logicamente e ponto apagado de vez saem em `excluidos`', async () => {
    const c = await conta();
    const lote = await criarLote(c, 'SAI');
    await envelhecer('Lote', lote.id);
    const idPonto = randomUUID();
    assert.equal((await req('POST', '/pontos-suplementacao', c.token, { id: idPonto, empresa_id: c.empresa.id, nome_ponto: 'C', categoria_ponto: 'COCHO' })).statusCode, 201);
    await envelhecer('PontoSuplementacao', idPonto);
    const desde = new Date().toISOString();
    await prisma().lote.update({ where: { id: lote.id }, data: { excluido_em: new Date() } });
    const del = await req('DELETE', `/pontos-suplementacao/${idPonto}`, c.token);
    assert.ok([200, 204].includes(del.statusCode), del.body);

    const rl = (await req('GET', `/lotes/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(rl.itens, []);
    assert.deepEqual(rl.excluidos, [lote.id]);
    const rp = (await req('GET', `/pontos-suplementacao/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(rp.itens, []);
    assert.deepEqual(rp.excluidos, [idPonto]);
  });

  test('MU-04 lançamento cancelado sai em `excluidos`', async () => {
    const c = await conta();
    const ev = await prisma().suplementacaoEvento.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { ponto_suplementacao_id: 'x', quantidade_total_kg: 10 } },
    });
    await envelhecer('SuplementacaoEvento', ev.id);
    const desde = new Date().toISOString();
    await prisma().suplementacaoEvento.update({ where: { id: ev.id }, data: { dados: { ...ev.dados, situacao: 'cancelado' } } });
    const r = (await req('GET', `/suplementacao-eventos/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(r.itens, []);
    assert.deepEqual(r.excluidos, [ev.id]);
    // Sem `desde`, o cancelado também não vem como item.
    const tudo = (await req('GET', '/suplementacao-eventos/mudancas', c.token)).json();
    assert.deepEqual(tudo.itens, []);
  });

  test('MU-05 outro tenant nunca aparece', async () => {
    const a = await conta();
    const b = await conta();
    const loteA = await criarLote(a, 'DE A');
    await envelhecer('Lote', loteA.id);
    const desde = new Date().toISOString();
    await req('PATCH', `/lotes/${loteA.id}`, a.token, { nome: 'DE A 2' });
    await prisma().lote.update({ where: { id: loteA.id }, data: { excluido_em: new Date() } });
    const rb = (await req('GET', '/lotes/mudancas', b.token)).json();
    assert.deepEqual(rb.itens, []);
    const rb2 = (await req('GET', `/lotes/mudancas?desde=${encodeURIComponent(desde)}`, b.token)).json();
    assert.deepEqual(rb2.itens, []);
    assert.deepEqual(rb2.excluidos, []);
  });

  test('MU-06 `desde` ou `cursor` inválido: 400', async () => {
    const c = await conta();
    assert.equal((await req('GET', '/lotes/mudancas?desde=ontem-a-noite', c.token)).statusCode, 400);
    assert.equal((await req('GET', '/lotes/mudancas?cursor=nao-e-um-cursor', c.token)).statusCode, 400);
    assert.equal((await req('GET', '/lotes/mudancas?limite=999999', c.token)).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/lotes/mudancas' })).statusCode, 401);
  });

  test('MU-07 exclusões demais no período: `recarregar`', async () => {
    const c = await conta();
    const desde = new Date().toISOString();
    await prisma().auditLog.createMany({
      data: Array.from({ length: LIMITE_EXCLUIDOS + 1 }, (_, i) => ({
        cliente_id: c.cliente.id,
        acao: 'delete',
        entidade: 'PontoSuplementacao',
        entidade_id: `apagado-${i}`,
        request_id: `req-${i}`,
      })),
    });
    const r = (await req('GET', `/pontos-suplementacao/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.equal(r.recarregar, true);
    assert.deepEqual(r.itens, []);
  });

  test('MU-08 leituras de cocho: mesma forma da listagem; a leitura apagada sai em `excluidos`', async () => {
    const c = await conta();
    const p = await req('POST', '/pontos-suplementacao', c.token, { empresa_id: c.empresa.id, nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO' });
    assert.equal(p.statusCode, 201, p.body);
    const leitura = await prisma().leituraCocho.create({
      data: {
        cliente_id: c.cliente.id,
        empresa_id: c.empresa.id,
        ponto_suplementacao_id: p.json().id,
        data_leitura: new Date('2026-11-20T00:00:00Z'),
        escore: 'VAZIO',
        acesso: 'BOM',
        estrutura: 'BOA',
      },
    });
    const lista = (await req('GET', '/leituras-cocho', c.token)).json();
    const mud = (await req('GET', '/leituras-cocho/mudancas', c.token)).json();
    assert.equal(lista.length, 1);
    assert.deepEqual(mud.itens, lista);
    await envelhecer('LEITURACOCHO', leitura.id);
    const desde = new Date().toISOString();
    const del = await req('DELETE', `/leituras-cocho/${leitura.id}`, c.token);
    assert.ok([200, 204].includes(del.statusCode), del.body);
    const depois = (await req('GET', `/leituras-cocho/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(depois.excluidos, [leitura.id]);
  });

  test('MU-09 (D-PROD-315) as consultas de mudanças e de exclusões usam os índices da sincronização', async () => {
    const c = await conta();
    await criarLote(c, 'A');
    const planoDe = async (sql) => {
      const linhas = await prisma().$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        return tx.$queryRawUnsafe(`EXPLAIN ${sql}`, c.cliente.id);
      });
      return linhas.map((l) => l['QUERY PLAN']).join('\n');
    };
    for (const [tabela, indice] of [
      ['Lote', 'Lote_cliente_id_updatedAt_id_idx'],
      ['PontoSuplementacao', 'PontoSuplementacao_cliente_id_updatedAt_id_idx'],
      ['LEITURACOCHO', 'LEITURACOCHO_cliente_id_updatedAt_id_idx'],
      ['SuplementacaoEvento', 'SuplementacaoEvento_cliente_id_updatedAt_id_idx'],
    ]) {
      const plano = await planoDe(`SELECT id FROM "${tabela}" WHERE cliente_id = $1 AND "updatedAt" >= now() - interval '1 day' ORDER BY "updatedAt", id LIMIT 1001`);
      assert.match(plano, new RegExp(indice), `${tabela}: ${plano}`);
    }
    const auditoria = await planoDe(`SELECT entidade_id FROM "AuditLog" WHERE cliente_id = $1 AND entidade = 'Lote' AND acao = 'delete' AND "createdAt" >= now() - interval '1 day' ORDER BY "createdAt", id LIMIT 5001`);
    assert.match(auditoria, /AuditLog_cliente_id_entidade_acao_createdAt_id_idx/, auditoria);
  });
});

