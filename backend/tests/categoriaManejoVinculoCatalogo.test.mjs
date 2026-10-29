/**
 * PR145-R2 (D-PROD-69) — vínculo CategoriaManejo.catalogo_categoria_visual_id
 * com a categoria visual GLOBAL do tipo `lote`.
 *
 * PostgreSQL real; o catálogo é semeado direto pelo Prisma (dados sintéticos).
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;

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
const sql = (comando) => getPrismaClient().$executeRawUnsafe(comando);

const tenantComToken = async () => {
  const { cliente, usuario, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, usuario, token: corpo.token };
};

/** Catálogo sintético: tipo `lote` com duas categorias (uma inativa) e um tipo `area`. */
const semearCatalogo = async () => {
  const prisma = getPrismaClient();
  const lote = await prisma.catalogoTipoEntidade.create({ data: { codigo: 'lote', nome: 'Lote' } });
  const area = await prisma.catalogoTipoEntidade.create({ data: { codigo: 'area', nome: 'Área' } });
  const bezerro = await prisma.catalogoCategoriaVisual.create({
    data: { tipo_id: lote.id, codigo: 'bezerro', nome: 'Bezerro' },
  });
  const garrote = await prisma.catalogoCategoriaVisual.create({
    data: { tipo_id: lote.id, codigo: 'garrote', nome: 'Garrote' },
  });
  const inativa = await prisma.catalogoCategoriaVisual.create({
    data: { tipo_id: lote.id, codigo: 'antiga', nome: 'Antiga', ativo: false },
  });
  const pasto = await prisma.catalogoCategoriaVisual.create({
    data: { tipo_id: area.id, codigo: 'pasto', nome: 'Pasto' },
  });
  return { lote, area, bezerro, garrote, inativa, pasto };
};

const BASE = { empresa_id: 'emp-1', nome: 'BEZERRO DESMAMA', sigla: 'BD', especie: 'Bovinos', ativo: true };

const criar = (token, extra = {}) =>
  app.inject({ method: 'POST', url: '/categorias-manejo', headers: auth(token), payload: { ...BASE, ...extra } });
const atualizar = (token, id, payload) =>
  app.inject({ method: 'PATCH', url: `/categorias-manejo/${id}`, headers: auth(token), payload });
const listar = async (token) =>
  (await app.inject({ method: 'GET', url: '/categorias-manejo', headers: auth(token) })).json();

const contarTudo = async () => {
  const prisma = getPrismaClient();
  return { categorias: await prisma.categoriaManejo.count(), auditoria: await prisma.auditLog.count() };
};

const esperar422 = (r, padrao) => {
  assert.equal(r.statusCode, 422, r.body);
  assert.equal(r.json().code, 'CATALOGO_GLOBAL_INVALID');
  if (padrao) assert.match(r.json().message, padrao);
};

describe('CategoriaManejo ↔ catálogo global (D-PROD-69)', () => {
  test('V-01 sem vínculo (ausente, null ou vazio) continua válido e grava null', async () => {
    await semearCatalogo();
    const { token } = await tenantComToken();
    for (const extra of [{}, { catalogo_categoria_visual_id: null }, { catalogo_categoria_visual_id: '' }]) {
      const r = await criar(token, extra);
      assert.equal(r.statusCode, 201, r.body);
      assert.equal(r.json().catalogo_categoria_visual_id, null);
    }
  });

  test('V-02 vínculo com categoria ativa do tipo lote persiste e volta na listagem', async () => {
    const { bezerro } = await semearCatalogo();
    const { token } = await tenantComToken();
    const r = await criar(token, { catalogo_categoria_visual_id: bezerro.id });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().catalogo_categoria_visual_id, bezerro.id);
    const [lida] = await listar(token);
    assert.equal(lida.catalogo_categoria_visual_id, bezerro.id);
    assert.equal(lida.cliente_id, undefined, 'tenant não exposto');
  });

  test('V-03 id global inexistente → 422 e nada gravado (nem auditoria)', async () => {
    await semearCatalogo();
    const { token } = await tenantComToken();
    const antes = await contarTudo();
    esperar422(await criar(token, { catalogo_categoria_visual_id: 'nao-existe' }), /não encontrada/);
    esperar422(await criar(token, { catalogo_categoria_visual_id: 123 }), /inválido/);
    assert.deepEqual(await contarTudo(), antes);
  });

  test('V-04 categoria de outro tipo (area) → 422', async () => {
    const { pasto } = await semearCatalogo();
    const { token } = await tenantComToken();
    esperar422(await criar(token, { catalogo_categoria_visual_id: pasto.id }), /tipo lote/);
    assert.equal(await getPrismaClient().categoriaManejo.count(), 0);
  });

  test('V-05 categoria inativa ou tipo lote inativo → 422', async () => {
    const { inativa, bezerro, lote } = await semearCatalogo();
    const { token } = await tenantComToken();
    esperar422(await criar(token, { catalogo_categoria_visual_id: inativa.id }), /inativa/);
    await getPrismaClient().catalogoTipoEntidade.update({ where: { id: lote.id }, data: { ativo: false } });
    esperar422(await criar(token, { catalogo_categoria_visual_id: bezerro.id }), /inativa/);
  });

  test('V-06 atualização: vincula, troca, remove; reenviar vínculo antigo desativado não trava a edição', async () => {
    const { bezerro, garrote, inativa } = await semearCatalogo();
    const { token } = await tenantComToken();
    const id = (await criar(token)).json().id;

    let r = await atualizar(token, id, { catalogo_categoria_visual_id: bezerro.id });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().catalogo_categoria_visual_id, bezerro.id);

    r = await atualizar(token, id, { catalogo_categoria_visual_id: garrote.id });
    assert.equal(r.json().catalogo_categoria_visual_id, garrote.id);

    // Outros campos sem mexer no vínculo: preserva.
    r = await atualizar(token, id, { nome: 'GARROTE' });
    assert.equal(r.json().catalogo_categoria_visual_id, garrote.id);

    // Categoria oficial desativada DEPOIS do vínculo: o cadastro segue editável…
    await getPrismaClient().catalogoCategoriaVisual.update({ where: { id: garrote.id }, data: { ativo: false } });
    r = await atualizar(token, id, { nome: 'GARROTE 2', catalogo_categoria_visual_id: garrote.id });
    assert.equal(r.statusCode, 200, r.body);
    // …mas não se pode TROCAR para uma inativa.
    esperar422(await atualizar(token, id, { catalogo_categoria_visual_id: inativa.id }), /inativa/);

    r = await atualizar(token, id, { catalogo_categoria_visual_id: null });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().catalogo_categoria_visual_id, null);

    const eventos = await getPrismaClient().auditLog.count({ where: { entidade: 'CategoriaManejo', entidade_id: id } });
    assert.equal(eventos, 1 + 5, 'create + 5 updates aceitos; recusas não auditam');
  });

  test('V-07 isolamento de tenant: B não vê nem altera o vínculo de A; cliente_id do corpo é ignorado', async () => {
    const { bezerro, garrote } = await semearCatalogo();
    const a = await tenantComToken();
    const b = await tenantComToken();
    const id = (await criar(a.token, { catalogo_categoria_visual_id: bezerro.id, cliente_id: b.cliente.id })).json().id;

    const gravada = await getPrismaClient().categoriaManejo.findUnique({ where: { id } });
    assert.equal(gravada.cliente_id, a.cliente.id);
    assert.deepEqual(await listar(b.token), []);

    const r = await atualizar(b.token, id, { catalogo_categoria_visual_id: garrote.id });
    assert.equal(r.statusCode, 404);
    assert.equal(
      (await getPrismaClient().categoriaManejo.findUnique({ where: { id } })).catalogo_categoria_visual_id,
      bezerro.id
    );
  });

  test('V-08 rollback: falha na auditoria desfaz o vínculo gravado', async () => {
    const { bezerro } = await semearCatalogo();
    const { token } = await tenantComToken();
    const id = (await criar(token)).json().id;
    await sql(`CREATE OR REPLACE FUNCTION v08_falha() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha injetada V-08'; END $$`);
    await sql(`CREATE TRIGGER v08_falha BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION v08_falha()`);
    try {
      const r = await atualizar(token, id, { catalogo_categoria_visual_id: bezerro.id });
      assert.ok(r.statusCode >= 500, `esperava erro, veio ${r.statusCode}`);
    } finally {
      await sql(`DROP TRIGGER IF EXISTS v08_falha ON "AuditLog"`);
      await sql(`DROP FUNCTION IF EXISTS v08_falha()`);
    }
    const gravada = await getPrismaClient().categoriaManejo.findUnique({ where: { id } });
    assert.equal(gravada.catalogo_categoria_visual_id, null);
  });

  test('V-09 corrida: desativação concorrente da categoria oficial vence o vínculo em espera (422)', async () => {
    const { bezerro } = await semearCatalogo();
    const { token } = await tenantComToken();
    const id = (await criar(token)).json().id;
    const prisma = getPrismaClient();

    /** @type {Promise<import('light-my-request').Response> | undefined} */
    let pedido;
    await prisma.$transaction(
      async (tx) => {
        // Trava a linha como faria a manutenção do catálogo…
        await tx.catalogoCategoriaVisual.update({ where: { id: bezerro.id }, data: { ativo: false } });
        // …e só confirma depois que o vínculo concorrente está esperando o lock (FOR SHARE).
        pedido = atualizar(token, id, { catalogo_categoria_visual_id: bezerro.id });
        for (let i = 0; i < 200; i += 1) {
          const [{ n }] = await prisma.$queryRaw`
            SELECT count(*)::int AS n FROM pg_stat_activity
             WHERE wait_event_type = 'Lock' AND query ILIKE '%FOR SHARE%'`;
          if (n > 0) return;
          await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error('o vínculo concorrente nunca esperou o lock');
      },
      { timeout: 10_000 }
    );
    esperar422(await pedido, /inativa/);
    assert.equal((await prisma.categoriaManejo.findUnique({ where: { id } })).catalogo_categoria_visual_id, null);
  });

  test('V-10 integridade: categoria visual vinculada não pode ser apagada (FK RESTRICT)', async () => {
    const { bezerro } = await semearCatalogo();
    const { token } = await tenantComToken();
    await criar(token, { catalogo_categoria_visual_id: bezerro.id });
    await assert.rejects(getPrismaClient().catalogoCategoriaVisual.delete({ where: { id: bezerro.id } }));
  });
});
