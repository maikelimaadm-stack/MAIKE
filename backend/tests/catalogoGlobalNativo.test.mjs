/**
 * Catálogo global slice 1 — API, operador de produto, assets e DDL (D-PROD-57/59).
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { getPrismaClient } from '../src/database/prismaClient.js';
import {
  criarArmazenamentoCatalogo,
  exigirArmazenamentoCatalogoAoVivo,
} from '../src/modules/catalogoGlobal/catalogoAssetStorage.js';
import { validarBufferAssetCatalogo } from '../src/modules/catalogoGlobal/catalogoAssetValidation.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** @type {import('fastify').FastifyInstance} */
let app;

before(async () => {
  criarArmazenamentoCatalogo({
    aoVivo: false,
    async gravar({ sha256, revisao, extensao }) {
      return {
        bucket: 'maike-catalogo-global',
        storage_path: `v${revisao}/${sha256.slice(0, 16)}.${extensao}`,
      };
    },
    async remover() {},
  });
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

const revisaoManifesto = async (token) => {
  const r = await app.inject({
    method: 'GET',
    url: '/catalogo-global/manifest',
    headers: auth(token),
  });
  assert.equal(r.statusCode, 200);
  return r.json().revisao;
};

const tenantComToken = async () => {
  const { cliente, usuario, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, usuario, token: corpo.token, credenciais };
};

const registrarOperador = async (cliente_id, usuario_id) => {
  const prisma = getPrismaClient();
  return prisma.operadorProdutoMaike.create({
    data: { cliente_id, usuario_id, papel: 'editor', ativo: true },
  });
};

describe('catálogo global — auth', () => {
  test('CG-01 manifest sem token → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/catalogo-global/manifest' });
    assert.equal(r.statusCode, 401);
  });

  test('CG-02 escrita admin sem operador → 403', async () => {
    const { token } = await tenantComToken();
    const r = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/tipos',
      headers: auth(token),
      payload: { codigo: 'ponto', nome: 'Ponto' },
    });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, 'PRODUCT_OPERATOR_REQUIRED');
  });
});

describe('catálogo global — operador e CRUD', () => {
  test('CG-03 operador registra tipo e leitura publicada', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await registrarOperador(cliente.id, usuario.id);

    const criar = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/tipos',
      headers: auth(token),
      payload: { codigo: 'ponto', nome: 'Ponto', ordem: 1 },
    });
    assert.equal(criar.statusCode, 201);

    const tipos = await app.inject({
      method: 'GET',
      url: '/catalogo-global/tipos',
      headers: auth(token),
    });
    assert.equal(tipos.statusCode, 200);
    assert.equal(tipos.json().length, 1);
    assert.equal(tipos.json()[0].codigo, 'ponto');
  });

  test('CG-04 outro tenant autenticado também lê catálogo global', async () => {
    const a = await tenantComToken();
    await registrarOperador(a.cliente.id, a.usuario.id);
    await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/tipos',
      headers: auth(a.token),
      payload: { codigo: 'area', nome: 'Área' },
    });

    const b = await tenantComToken();
    const r = await app.inject({
      method: 'GET',
      url: '/catalogo-global/tipos',
      headers: auth(b.token),
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().some((t) => t.codigo === 'area'), true);
  });

  test('CG-05 fluxo ícone publicado com asset PNG', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await registrarOperador(cliente.id, usuario.id);

    const tipo = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/tipos',
      headers: auth(token),
      payload: { codigo: 'lote', nome: 'Lote' },
    });
    const tipoId = tipo.json().id;

    const cat = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/categorias',
      headers: auth(token),
      payload: { tipo_id: tipoId, codigo: 'm_01', nome: 'Macho' },
    });
    const categoriaId = cat.json().id;

    const asset = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/assets',
      headers: auth(token),
      payload: {
        mime_type: 'image/png',
        conteudo_base64: PNG_1X1.toString('base64'),
      },
    });
    assert.equal(asset.statusCode, 201);
    const assetId = asset.json().id;

    const icone = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/icones',
      headers: auth(token),
      payload: {
        tipo_id: tipoId,
        categoria_id: categoriaId,
        asset_principal_id: assetId,
      },
    });
    assert.equal(icone.statusCode, 201);
    const iconeId = icone.json().id;

    const pub = await app.inject({
      method: 'POST',
      url: `/catalogo-global/admin/icones/${iconeId}/publicar`,
      headers: auth(token),
      payload: {},
    });
    assert.equal(pub.statusCode, 200);

    const list = await app.inject({
      method: 'GET',
      url: '/catalogo-global/icones',
      headers: auth(token),
    });
    assert.equal(list.json().length, 1);
    assert.equal(list.json()[0].id, iconeId);
    assert.ok('asset_principal_url' in list.json()[0]);
  });
});

describe('catálogo global — validação asset', () => {
  test('CG-06 SVG reprovado', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.throws(() => validarBufferAssetCatalogo(svg, 'image/svg+xml'), (e) => e.code === 'CATALOGO_ASSET_INVALID');
  });

  test('CG-09 MIME declarado divergente reprovado', () => {
    assert.throws(
      () => validarBufferAssetCatalogo(PNG_1X1, 'image/jpeg'),
      (e) => e.code === 'CATALOGO_ASSET_INVALID'
    );
  });
});

describe('catálogo global — regra MISTO', () => {
  test('CG-07 regra com duas categorias e publicação', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await registrarOperador(cliente.id, usuario.id);

    const tipo = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/tipos',
        headers: auth(token),
        payload: { codigo: 'mapa', nome: 'Mapa' },
      })
    ).json();

    const c1 = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/categorias',
        headers: auth(token),
        payload: { tipo_id: tipo.id, codigo: 'a', nome: 'A' },
      })
    ).json();
    const c2 = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/categorias',
        headers: auth(token),
        payload: { tipo_id: tipo.id, codigo: 'b', nome: 'B' },
      })
    ).json();

    const asset = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/assets',
        headers: auth(token),
        payload: { mime_type: 'image/png', conteudo_base64: PNG_1X1.toString('base64') },
      })
    ).json();

    const icone = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/icones',
        headers: auth(token),
        payload: {
          tipo_id: tipo.id,
          categoria_id: c1.id,
          asset_principal_id: asset.id,
        },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/catalogo-global/admin/icones/${icone.id}/publicar`,
      headers: auth(token),
      payload: {},
    });

    const regra = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/regras-misto',
      headers: auth(token),
      payload: {
        tipo_id: tipo.id,
        icone_id: icone.id,
        categoria_ids: [c1.id, c2.id],
        prioridade: 10,
      },
    });
    assert.equal(regra.statusCode, 201);

    const pub = await app.inject({
      method: 'POST',
      url: `/catalogo-global/admin/regras-misto/${regra.json().id}/publicar`,
      headers: auth(token),
      payload: {},
    });
    assert.equal(pub.statusCode, 200);

    const list = await app.inject({
      method: 'GET',
      url: '/catalogo-global/regras-misto',
      headers: auth(token),
    });
    assert.equal(list.json().length, 1);
    assert.deepEqual(list.json()[0].categoria_ids.sort(), [c1.id, c2.id].sort());
  });

  test('CG-10 ícone de outro tipo na regra MISTO → 422', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await registrarOperador(cliente.id, usuario.id);

    const tipoA = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/tipos',
        headers: auth(token),
        payload: { codigo: 'ta', nome: 'TA' },
      })
    ).json();
    const tipoB = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/tipos',
        headers: auth(token),
        payload: { codigo: 'tb', nome: 'TB' },
      })
    ).json();

    const cA = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/categorias',
        headers: auth(token),
        payload: { tipo_id: tipoA.id, codigo: 'ca', nome: 'CA' },
      })
    ).json();
    const cB = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/categorias',
        headers: auth(token),
        payload: { tipo_id: tipoA.id, codigo: 'cb', nome: 'CB' },
      })
    ).json();
    const cBtipo = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/categorias',
        headers: auth(token),
        payload: { tipo_id: tipoB.id, codigo: 'cb2', nome: 'CB2' },
      })
    ).json();

    const asset = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/assets',
        headers: auth(token),
        payload: { mime_type: 'image/png', conteudo_base64: PNG_1X1.toString('base64') },
      })
    ).json();

    const icone = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/icones',
        headers: auth(token),
        payload: { tipo_id: tipoB.id, categoria_id: cBtipo.id, asset_principal_id: asset.id },
      })
    ).json();

    const regra = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/regras-misto',
      headers: auth(token),
      payload: { tipo_id: tipoA.id, icone_id: icone.id, categoria_ids: [cA.id, cB.id] },
    });
    assert.equal(regra.statusCode, 422);
  });
});

describe('catálogo global — CAS e ícone', () => {
  test('CG-11 revisão divergente → 409 CONCURRENCY_CONFLICT', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await registrarOperador(cliente.id, usuario.id);

    const criado = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/tipos',
      headers: auth(token),
      payload: { codigo: 'cas', nome: 'CAS' },
    });
    const tipoId = criado.json().id;

    const stale = await app.inject({
      method: 'PATCH',
      url: `/catalogo-global/admin/tipos/${tipoId}`,
      headers: auth(token),
      payload: { nome: 'X', revisao_esperada: 0 },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().code, 'CONCURRENCY_CONFLICT');
    assert.equal(stale.json().details?.revisao_atual, 1);
  });

  test('CG-12 PATCH ícone mantém id e valida categoria/tipo', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await registrarOperador(cliente.id, usuario.id);

    const tipo = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/tipos',
        headers: auth(token),
        payload: { codigo: 'patch', nome: 'Patch' },
      })
    ).json();
    const cat = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/categorias',
        headers: auth(token),
        payload: { tipo_id: tipo.id, codigo: 'pc', nome: 'PC' },
      })
    ).json();
    const asset = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/assets',
        headers: auth(token),
        payload: { mime_type: 'image/png', conteudo_base64: PNG_1X1.toString('base64') },
      })
    ).json();

    const icone = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/icones',
        headers: auth(token),
        payload: {
          tipo_id: tipo.id,
          categoria_id: cat.id,
          asset_principal_id: asset.id,
        },
      })
    ).json();

    const rev = await revisaoManifesto(token);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/catalogo-global/admin/icones/${icone.id}`,
      headers: auth(token),
      payload: { cor_fallback: '#ff0000', revisao_esperada: rev },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().id, icone.id);
    assert.equal(patch.json().cor_fallback, '#ff0000');
  });

  test('CG-13 categoria de outro tipo ao criar ícone → 422', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await registrarOperador(cliente.id, usuario.id);

    const t1 = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/tipos',
        headers: auth(token),
        payload: { codigo: 't1', nome: 'T1' },
      })
    ).json();
    const t2 = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/tipos',
        headers: auth(token),
        payload: { codigo: 't2', nome: 'T2' },
      })
    ).json();
    const cat2 = (
      await app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/categorias',
        headers: auth(token),
        payload: { tipo_id: t2.id, codigo: 'c2', nome: 'C2' },
      })
    ).json();

    const r = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/icones',
      headers: auth(token),
      payload: { tipo_id: t1.id, categoria_id: cat2.id },
    });
    assert.equal(r.statusCode, 422);
  });
});

describe('catálogo global — asset path e storage', () => {
  test('CG-14 storage_path versionado pela revisão do manifesto', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await registrarOperador(cliente.id, usuario.id);

    const rev = await revisaoManifesto(token);
    const asset = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/assets',
      headers: auth(token),
      payload: {
        mime_type: 'image/png',
        conteudo_base64: PNG_1X1.toString('base64'),
        revisao_esperada: rev,
      },
    });
    assert.equal(asset.statusCode, 201);
    assert.match(asset.json().storage_path, new RegExp(`^v${rev}/`));
    assert.equal(asset.json().revisao, rev);
  });

  test('CG-15 produção sem Supabase live reprova upload', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.throws(
        () => exigirArmazenamentoCatalogoAoVivo(),
        (e) => e.code === 'CATALOGO_ASSET_INVALID'
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('catálogo global — DDL / grants', () => {
  test('CG-08 tabelas globais sem cliente_id e anon não lê', () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      assert.fail('DATABASE_URL ausente');
    }
    const colunas = spawnSync(
      'psql',
      [
        databaseUrl,
        '-tAc',
        `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='CatalogoIcone' AND column_name='cliente_id'`,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(colunas.stdout.trim(), '0');

    const anon = spawnSync(
      'psql',
      [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tAc', `SET ROLE anon; SELECT 1 FROM "CatalogoIcone" LIMIT 1;`],
      { encoding: 'utf8' }
    );
    assert.notEqual(anon.status, 0, anon.stderr || anon.stdout);
  });
});
