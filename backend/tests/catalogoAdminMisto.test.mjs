/**
 * PR145-R3 (D-PROD-70) — operações do MAIKE Admin no catálogo global:
 * subícone, troca de imagem com id estável, categorias, MISTO e validação.
 *
 * PostgreSQL real + Storage falso; imagens são bytes sintéticos.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { env } from '../src/config/env.js';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { caminhoObjetoCatalogo, criarArmazenamentoCatalogo } from '../src/modules/catalogoGlobal/catalogoAssetStorage.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, criarAdminComSessao } from './helpers.mjs';

const PNG = (extra = 0) =>
  Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    ),
    Buffer.alloc(extra, extra),
  ]);

const objetos = new Map();
criarArmazenamentoCatalogo({
  aoVivo: false,
  async gravar({ buffer, sha256, revisao, extensao, idObjeto }) {
    const storage_path = caminhoObjetoCatalogo({ sha256, revisao, extensao, idObjeto });
    objetos.set(storage_path, buffer);
    return { bucket: 'maike-catalogo-global', storage_path };
  },
  async remover(p) {
    objetos.delete(p);
  },
});

/** @type {import('fastify').FastifyInstance} */
let app;
let h;
const urlOriginal = env.supabaseUrl;
const chaveOriginal = env.supabaseServiceRoleKey;

before(async () => {
  env.supabaseUrl = 'https://storage.teste.local';
  env.supabaseServiceRoleKey = 'chave-falsa-de-teste';
  app = await criarApp();
  await app.ready();
});
after(async () => {
  env.supabaseUrl = urlOriginal;
  env.supabaseServiceRoleKey = chaveOriginal;
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
  objetos.clear();
  h = (await criarAdminComSessao(app)).headers;
});

const prisma = () => getPrismaClient();
const revisao = async () => (await prisma().catalogoMeta.findUnique({ where: { chave: 'global' } }))?.revisao ?? 0;
/** Toda escrita relê a revisão e manda CAS, como o app admin. */
const escrever = async (method, url, payload = {}) =>
  app.inject({ method, url, headers: h, payload: { ...payload, revisao_esperada: await revisao() } });
const ok = async (p) => {
  const r = await p;
  assert.ok(r.statusCode < 300, `${r.statusCode} ${r.body}`);
  return r.json();
};
const visao = async () => (await app.inject({ method: 'GET', url: '/admin-maike/catalogo', headers: h })).json();

const semear = async () => {
  const tipo = await ok(escrever('POST', '/catalogo-global/admin/tipos', { codigo: 'lote', nome: 'Lote' }));
  const outro = await ok(escrever('POST', '/catalogo-global/admin/tipos', { codigo: 'ponto', nome: 'Ponto' }));
  const cat = async (codigo, tipoId = tipo.id) =>
    ok(escrever('POST', '/catalogo-global/admin/categorias', { tipo_id: tipoId, codigo, nome: codigo.toUpperCase() }));
  const [bezerro, garrote, vaca] = [await cat('bezerro'), await cat('garrote'), await cat('vaca')];
  const cocho = await cat('cocho', outro.id);
  const asset = async (extra) =>
    ok(escrever('POST', '/catalogo-global/admin/assets', { mime_type: 'image/png', conteudo_base64: PNG(extra).toString('base64') }));
  const icone = async (categoria, extra, tipoId = tipo.id) => {
    const a = await asset(extra);
    const i = await ok(escrever('POST', '/catalogo-global/admin/icones', { tipo_id: tipoId, categoria_id: categoria.id, asset_principal_id: a.id }));
    await ok(escrever('POST', `/catalogo-global/admin/icones/${i.id}/publicar`));
    return i;
  };
  return { tipo, outro, bezerro, garrote, vaca, cocho, asset, icone };
};

describe('ícones: principal e subícone', () => {
  test('A-01 principal e subícone são assets distintos; trocar o principal mantém id e subícone', async () => {
    const { tipo, bezerro, asset } = await semear();
    const principal = await asset(1);
    const sub = await asset(2);
    assert.notEqual(principal.id, sub.id);
    const icone = await ok(
      escrever('POST', '/catalogo-global/admin/icones', {
        tipo_id: tipo.id,
        categoria_id: bezerro.id,
        asset_principal_id: principal.id,
        asset_subicone_id: sub.id,
        cor_fallback: '#16a34a',
      })
    );
    let v = (await visao()).icones.find((i) => i.id === icone.id);
    assert.equal(v.estado, 'rascunho');
    assert.equal(v.asset_principal.id, principal.id);
    assert.equal(v.asset_subicone.id, sub.id);
    assert.match(v.asset_principal.public_url, /^https:\/\/storage\.teste\.local\/.+\/v\d+\/[0-9a-f]{16}-/);
    assert.equal((await app.inject({ method: 'GET', url: '/admin-maike/catalogo', headers: h })).body.includes('storage_path'), false);

    await ok(escrever('POST', `/catalogo-global/admin/icones/${icone.id}/publicar`));
    const novo = await asset(3);
    await ok(escrever('PATCH', `/catalogo-global/admin/icones/${icone.id}`, { asset_principal_id: novo.id }));
    v = (await visao()).icones.find((i) => i.id === icone.id);
    assert.equal(v.id, icone.id);
    assert.equal(v.estado, 'publicado');
    assert.equal(v.asset_principal.id, novo.id);
    assert.equal(v.asset_subicone.id, sub.id, 'subícone intacto');
    assert.equal((await visao()).icones.length, 1);
    const audit = await prisma().auditoriaCatalogoGlobal.findMany({ where: { entidade_id: icone.id } });
    assert.ok(audit.every((a) => a.admin_id), 'todo evento tem o proprietário como ator');
  });

  test('A-02 asset inexistente/não publicado, imagem inválida e CAS 409', async () => {
    const { tipo, bezerro } = await semear();
    const r1 = await escrever('POST', '/catalogo-global/admin/icones', {
      tipo_id: tipo.id,
      categoria_id: bezerro.id,
      asset_principal_id: 'nao-existe',
    });
    assert.ok(r1.statusCode >= 400 && r1.statusCode < 500);
    const antes = await prisma().catalogoAsset.count();
    for (const payload of [
      { mime_type: 'image/svg+xml', conteudo_base64: Buffer.from('<svg/>').toString('base64') },
      { mime_type: 'image/png', conteudo_base64: Buffer.concat([PNG(), Buffer.alloc(600 * 1024)]).toString('base64') },
    ]) {
      const r = await escrever('POST', '/catalogo-global/admin/assets', payload);
      assert.ok(r.statusCode >= 400 && r.statusCode < 500, String(r.statusCode));
    }
    assert.equal(await prisma().catalogoAsset.count(), antes);
    const velha = await revisao();
    await ok(escrever('POST', '/catalogo-global/admin/categorias', { tipo_id: tipo.id, codigo: 'novilha', nome: 'Novilha' }));
    const conflito = await app.inject({
      method: 'PATCH',
      url: `/catalogo-global/admin/categorias/${bezerro.id}`,
      headers: h,
      payload: { nome: 'Outro', revisao_esperada: velha },
    });
    assert.equal(conflito.statusCode, 409);
    assert.equal(conflito.json().code, 'CONCURRENCY_CONFLICT');
  });

  test('A-03 categoria: editar rótulo/ordem/estado, código duplicado recusado, sem apagar', async () => {
    const { tipo, bezerro } = await semear();
    const c = await ok(escrever('PATCH', `/catalogo-global/admin/categorias/${bezerro.id}`, { nome: 'Bezerro mamando', ordem: 3, ativo: false }));
    assert.deepEqual([c.nome, c.ordem, c.ativo, c.codigo], ['Bezerro mamando', 3, false, 'bezerro']);
    const dup = await escrever('POST', '/catalogo-global/admin/categorias', { tipo_id: tipo.id, codigo: 'bezerro', nome: 'X' });
    assert.equal(dup.statusCode, 409);
    const codigoNaoEditavel = await escrever('PATCH', `/catalogo-global/admin/categorias/${bezerro.id}`, { codigo: 'outro' });
    assert.equal(codigoNaoEditavel.statusCode, 400);
    const apagar = await app.inject({ method: 'DELETE', url: `/catalogo-global/admin/categorias/${bezerro.id}`, headers: h });
    assert.equal(apagar.statusCode, 404, 'não existe rota de exclusão física');
  });

  test('A-04 desativar e republicar ícone mantém o id', async () => {
    const { bezerro, icone } = await semear();
    const i = await icone(bezerro, 4);
    await ok(escrever('POST', `/catalogo-global/admin/icones/${i.id}/desativar`));
    const t = await criarTenant();
    const jwt = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    const pub = () => app.inject({ method: 'GET', url: '/catalogo-global/icones', headers: { authorization: `Bearer ${jwt}` } });
    assert.equal((await pub()).json().length, 0);
    await ok(escrever('POST', `/catalogo-global/admin/icones/${i.id}/publicar`));
    assert.deepEqual((await pub()).json().map((x) => x.id), [i.id]);
  });
});

describe('regras MISTO (regra visual do catálogo, não sexo do lote)', () => {
  test('M-01 criar, editar, publicar e desativar com validação', async () => {
    const { tipo, bezerro, garrote, vaca, cocho, icone } = await semear();
    const iMisto = await icone(vaca, 5);
    const iRascunho = await ok(escrever('POST', '/catalogo-global/admin/icones', { tipo_id: tipo.id, categoria_id: garrote.id }));
    const regra = await ok(
      escrever('POST', '/catalogo-global/admin/regras-misto', { tipo_id: tipo.id, icone_id: iRascunho.id, categoria_ids: [garrote.id, bezerro.id], prioridade: 1 })
    );
    assert.equal(regra.especificidade, 2);

    // Publicar com ícone resultado em rascunho → recusado.
    const r1 = await escrever('POST', `/catalogo-global/admin/regras-misto/${regra.id}/publicar`);
    assert.equal(r1.statusCode, 422);
    // Tipo incompatível e categoria de outro tipo.
    const r2 = await escrever('PATCH', `/catalogo-global/admin/regras-misto/${regra.id}`, { categoria_ids: [bezerro.id, cocho.id] });
    assert.equal(r2.statusCode, 422);
    // Duplicata do mesmo conjunto → recusada.
    const r3 = await escrever('POST', '/catalogo-global/admin/regras-misto', { tipo_id: tipo.id, icone_id: iMisto.id, categoria_ids: [bezerro.id, garrote.id] });
    assert.equal(r3.statusCode, 422);
    assert.match(r3.json().message, /mesmo conjunto/);

    const editada = await ok(
      escrever('PATCH', `/catalogo-global/admin/regras-misto/${regra.id}`, { icone_id: iMisto.id, categoria_ids: [bezerro.id, garrote.id, vaca.id], prioridade: 7 })
    );
    assert.deepEqual([editada.id, editada.especificidade, editada.prioridade, editada.icone_id], [regra.id, 3, 7, iMisto.id]);
    await ok(escrever('POST', `/catalogo-global/admin/regras-misto/${regra.id}/publicar`));

    const t = await criarTenant();
    const jwt = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    const pub = async () =>
      (await app.inject({ method: 'GET', url: '/catalogo-global/regras-misto', headers: { authorization: `Bearer ${jwt}` } })).json();
    assert.deepEqual((await pub()).map((r) => r.id), [regra.id]);
    assert.deepEqual((await pub())[0].categoria_ids.sort(), [bezerro.id, garrote.id, vaca.id].sort());

    await ok(escrever('POST', `/catalogo-global/admin/regras-misto/${regra.id}/desativar`));
    assert.deepEqual(await pub(), []);
    const v = (await visao()).regras_misto.find((r) => r.id === regra.id);
    assert.deepEqual([v.estado, v.ativo], ['inativo', false]);
    // Desativada: o conjunto fica livre de novo.
    await ok(escrever('POST', '/catalogo-global/admin/regras-misto', { tipo_id: tipo.id, icone_id: iMisto.id, categoria_ids: [bezerro.id, garrote.id, vaca.id] }));
    const audit = await prisma().auditoriaCatalogoGlobal.findMany({ where: { entidade: 'CatalogoRegraMisto' } });
    assert.deepEqual([...new Set(audit.map((a) => a.acao))].sort(), ['atualizar', 'criar', 'desativar', 'publicar']);
    assert.equal(await prisma().lote.count(), 0, 'MISTO do catálogo não toca em Lote (sexo)');
  });

  test('M-02 validação aponta duplicata, empate, ícone não publicado e categoria sem ícone', async () => {
    const { tipo, bezerro, garrote, vaca, icone } = await semear();
    const iMisto = await icone(bezerro, 6);
    const ra = await ok(escrever('POST', '/catalogo-global/admin/regras-misto', { tipo_id: tipo.id, icone_id: iMisto.id, categoria_ids: [bezerro.id, garrote.id] }));
    await ok(escrever('POST', '/catalogo-global/admin/regras-misto', { tipo_id: tipo.id, icone_id: iMisto.id, categoria_ids: [garrote.id, vaca.id] }));
    // Duplicata forçada direto no banco (o serviço recusa) para provar que a validação enxerga.
    const dup = await prisma().catalogoRegraMisto.create({
      data: {
        tipo_id: tipo.id,
        icone_id: iMisto.id,
        especificidade: 2,
        estado: 'rascunho',
        categorias: { create: [{ categoria_id: bezerro.id, ordem: 0 }, { categoria_id: garrote.id, ordem: 1 }] },
      },
    });
    await ok(escrever('POST', `/catalogo-global/admin/icones/${iMisto.id}/desativar`));
    const r = (await app.inject({ method: 'GET', url: '/admin-maike/catalogo/validacao', headers: h })).json();
    const codigos = (lista) => lista.map((x) => x.codigo);
    assert.equal(r.ok, false);
    assert.ok(codigos(r.erros).includes('MISTO_DUPLICADA'));
    assert.deepEqual(r.erros.find((e) => e.codigo === 'MISTO_DUPLICADA').ids.sort(), [ra.id, dup.id].sort());
    assert.ok(codigos(r.avisos).includes('MISTO_EMPATE'));
    assert.ok(codigos(r.avisos).includes('MISTO_ICONE_NAO_PUBLICADO'));
    assert.ok(codigos(r.avisos).includes('CATEGORIA_SEM_ICONE'));
  });
});
