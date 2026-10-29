/**
 * Catálogo global slice 1 — API, operador de produto, assets e DDL (D-PROD-57/59).
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { getPrismaClient } from '../src/database/prismaClient.js';
import {
  caminhoObjetoCatalogo,
  criarArmazenamentoCatalogo,
  exigirArmazenamentoCatalogoAoVivo,
} from '../src/modules/catalogoGlobal/catalogoAssetStorage.js';
import { compensarObjetoAssetCatalogo } from '../src/modules/catalogoGlobal/catalogoGlobalService.js';
import { validarBufferAssetCatalogo } from '../src/modules/catalogoGlobal/catalogoAssetValidation.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Storage falso controlável: registra objetos, gravações e remoções, e aceita
 * falha injetada. Representa o bucket — o banco é PostgreSQL real.
 */
const storageFake = {
  aoVivo: false,
  /** @type {Map<string, Buffer>} */
  objetos: new Map(),
  /** @type {string[]} */
  gravados: [],
  /** @type {string[]} */
  removidos: [],
  falharGravacao: false,
  falharRemocao: false,
  reset() {
    this.objetos.clear();
    this.gravados = [];
    this.removidos = [];
    this.falharGravacao = false;
    this.falharRemocao = false;
  },
  async gravar({ buffer, sha256, revisao, extensao, idObjeto }) {
    if (this.falharGravacao) throw new Error('storage indisponível (injetado)');
    const storage_path = caminhoObjetoCatalogo({ sha256, revisao, extensao, idObjeto });
    if (this.objetos.has(storage_path)) throw new Error('objeto já existe (x-upsert: false)');
    this.objetos.set(storage_path, buffer);
    this.gravados.push(storage_path);
    return { bucket: 'maike-catalogo-global', storage_path };
  },
  async remover(storage_path) {
    if (this.falharRemocao) throw new Error('remoção falhou (injetado)');
    this.objetos.delete(storage_path);
    this.removidos.push(storage_path);
  },
};

/** @type {import('fastify').FastifyInstance} */
let app;

before(async () => {
  criarArmazenamentoCatalogo(storageFake);
  app = await criarApp();
  await app.ready();
});

after(async () => {
  await app.close();
  await encerrar();
});

beforeEach(async () => {
  await limparBanco();
  storageFake.reset();
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

/**
 * R2 — integridade transacional. Falhas injetadas por trigger no PostgreSQL
 * real (não mock de banco); o trigger é removido no `finally` de cada teste.
 */
const sql = (comando) => getPrismaClient().$executeRawUnsafe(comando);

const comTriggerDeFalha = async (tabela, { deferido = false } = {}, corpo) => {
  await sql(`CREATE OR REPLACE FUNCTION r2_falha_injetada() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falha injetada R2'; END $$`);
  await sql(
    deferido
      ? `CREATE CONSTRAINT TRIGGER r2_falha AFTER INSERT ON "${tabela}"
           DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r2_falha_injetada()`
      : `CREATE TRIGGER r2_falha BEFORE INSERT ON "${tabela}"
           FOR EACH ROW EXECUTE FUNCTION r2_falha_injetada()`
  );
  try {
    return await corpo();
  } finally {
    await sql(`DROP TRIGGER IF EXISTS r2_falha ON "${tabela}"`);
    await sql(`DROP FUNCTION IF EXISTS r2_falha_injetada()`);
  }
};

const contagens = async () => {
  const prisma = getPrismaClient();
  const meta = await prisma.catalogoMeta.findUnique({ where: { chave: 'global' } });
  return {
    assets: await prisma.catalogoAsset.count(),
    auditorias: await prisma.auditoriaCatalogoGlobal.count(),
    revisao: meta?.revisao ?? 0,
  };
};

const operadorComToken = async () => {
  const t = await tenantComToken();
  await registrarOperador(t.cliente.id, t.usuario.id);
  return t;
};

const postarAsset = (token, buffer = PNG_1X1, extra = {}) =>
  app.inject({
    method: 'POST',
    url: '/catalogo-global/admin/assets',
    headers: auth(token),
    payload: { mime_type: 'image/png', conteudo_base64: buffer.toString('base64'), ...extra },
  });

describe('catálogo global R2 — integridade transacional de assets', () => {
  test('R2-01 sucesso: objeto, asset, auditoria com request id e revisão consistentes', async () => {
    const { token } = await operadorComToken();
    const r = await postarAsset(token);
    assert.equal(r.statusCode, 201);
    const asset = r.json();

    assert.deepEqual(storageFake.gravados, [asset.storage_path]);
    assert.ok(storageFake.objetos.has(asset.storage_path));
    assert.match(asset.storage_path, new RegExp(`^v0/[0-9a-f]{16}-${asset.id}\\.png$`));
    assert.deepEqual(storageFake.removidos, []);

    const auditorias = await getPrismaClient().auditoriaCatalogoGlobal.findMany({
      where: { entidade: 'CatalogoAsset' },
    });
    assert.equal(auditorias.length, 1);
    assert.equal(auditorias[0].entidade_id, asset.id);
    assert.equal(auditorias[0].acao, 'registrar_asset');
    assert.ok(auditorias[0].request_id);
    assert.equal((await contagens()).revisao, 1);
  });

  test('R2-02 falha na auditoria: transação inteira reverte e objeto novo é compensado', async () => {
    const { token } = await operadorComToken();
    const antes = await contagens();
    const r = await comTriggerDeFalha('AuditoriaCatalogoGlobal', {}, () => postarAsset(token));

    assert.equal(r.statusCode, 500);
    assert.deepEqual(await contagens(), antes);
    assert.equal(storageFake.gravados.length, 1);
    assert.deepEqual(storageFake.removidos, storageFake.gravados);
    assert.equal(storageFake.objetos.size, 0);
  });

  test('R2-03 falha no COMMIT (trigger deferido): nada persiste e objeto é compensado', async () => {
    const { token } = await operadorComToken();
    const antes = await contagens();
    const r = await comTriggerDeFalha('AuditoriaCatalogoGlobal', { deferido: true }, () =>
      postarAsset(token)
    );

    assert.equal(r.statusCode, 500);
    assert.deepEqual(await contagens(), antes);
    assert.deepEqual(storageFake.removidos, storageFake.gravados);
    assert.equal(storageFake.objetos.size, 0);
  });

  test('R2-04 erro do Storage antes de gravar: banco intacto e nenhuma remoção', async () => {
    const { token } = await operadorComToken();
    const antes = await contagens();
    storageFake.falharGravacao = true;
    const r = await postarAsset(token);

    assert.equal(r.statusCode, 500);
    assert.deepEqual(await contagens(), antes);
    assert.deepEqual(storageFake.removidos, []);
  });

  test('R2-05 erro de banco após upload: só o objeto novo desta tentativa é removido', async () => {
    const { token } = await operadorComToken();
    const ok = await postarAsset(token);
    assert.equal(ok.statusCode, 201);
    const caminhoExistente = ok.json().storage_path;
    const antes = await contagens();

    const outro = Buffer.concat([PNG_1X1, Buffer.from([0])]);
    const r = await comTriggerDeFalha('CatalogoAsset', {}, () => postarAsset(token, outro));

    assert.equal(r.statusCode, 500);
    assert.deepEqual(await contagens(), antes);
    assert.equal(storageFake.removidos.length, 1);
    assert.notEqual(storageFake.removidos[0], caminhoExistente);
    assert.ok(storageFake.objetos.has(caminhoExistente));
  });

  test('R2-06 dedupe (sha256, revisão): sem novo registro, upload, remoção ou auditoria', async () => {
    const { token } = await operadorComToken();
    const primeiro = await postarAsset(token, PNG_1X1, { revisao_esperada: 0 });
    assert.equal(primeiro.statusCode, 201);
    await getPrismaClient().catalogoMeta.update({
      where: { chave: 'global' },
      data: { revisao: 0 },
    });
    const antes = await contagens();
    storageFake.gravados = [];

    const repetido = await postarAsset(token, PNG_1X1, { revisao_esperada: 0 });
    assert.equal(repetido.statusCode, 201);
    assert.equal(repetido.json().id, primeiro.json().id);
    assert.deepEqual(await contagens(), antes);
    assert.deepEqual(storageFake.gravados, []);
    assert.deepEqual(storageFake.removidos, []);
    assert.ok(storageFake.objetos.has(primeiro.json().storage_path));
  });

  test('R2-07 corrida com a mesma revisão esperada: um vence, o outro 409 e é compensado', async () => {
    const { token } = await operadorComToken();
    const b = Buffer.concat([PNG_1X1, Buffer.from([1])]);
    const respostas = await Promise.all([
      postarAsset(token, PNG_1X1, { revisao_esperada: 0 }),
      postarAsset(token, b, { revisao_esperada: 0 }),
    ]);
    const codigos = respostas.map((x) => x.statusCode).sort();
    assert.deepEqual(codigos, [201, 409]);

    const c = await contagens();
    assert.equal(c.assets, 1);
    assert.equal(c.auditorias, 1);
    assert.equal(c.revisao, 1);
    const vencedor = respostas.find((x) => x.statusCode === 201).json();
    assert.deepEqual([...storageFake.objetos.keys()], [vencedor.storage_path]);
  });

  test('R2-08 compensação não remove objeto referenciado nem com verificação incerta', async () => {
    const { token } = await operadorComToken();
    const ok = await postarAsset(token);
    const caminho = ok.json().storage_path;
    const avisos = [];
    const warnOriginal = console.warn;
    console.warn = (m) => avisos.push(JSON.parse(m));
    try {
      const referenciado = await compensarObjetoAssetCatalogo({
        client: getPrismaClient(),
        storage: storageFake,
        storagePath: caminho,
        requestId: 'req-r2',
      });
      assert.equal(referenciado, 'referenciado');

      const incerto = await compensarObjetoAssetCatalogo({
        client: { catalogoAsset: { findFirst: async () => { throw new Error('conexão perdida'); } } },
        storage: storageFake,
        storagePath: 'v9/orfao-incerto.png',
        requestId: 'req-r2',
      });
      assert.equal(incerto, 'mantido_incerto');

      storageFake.falharRemocao = true;
      const falha = await compensarObjetoAssetCatalogo({
        client: getPrismaClient(),
        storage: storageFake,
        storagePath: 'v9/sem-registro.png',
        requestId: 'req-r2',
      });
      assert.equal(falha, 'falha_remocao');
    } finally {
      console.warn = warnOriginal;
    }
    assert.deepEqual(storageFake.removidos, []);
    assert.ok(storageFake.objetos.has(caminho));
    assert.deepEqual(
      avisos.map((a) => [a.evento, a.desfecho, a.request_id]),
      [
        ['catalogo_asset_orfao', 'referenciado', 'req-r2'],
        ['catalogo_asset_orfao', 'mantido_incerto', 'req-r2'],
        ['catalogo_asset_orfao', 'falha_remocao', 'req-r2'],
      ]
    );
  });
});

describe('catálogo global R2 — auditoria atômica nas mutações administrativas', () => {
  test('R2-09 falha na auditoria ao criar tipo: nada persiste e revisão não avança', async () => {
    const { token } = await operadorComToken();
    const antes = await contagens();
    const r = await comTriggerDeFalha('AuditoriaCatalogoGlobal', {}, () =>
      app.inject({
        method: 'POST',
        url: '/catalogo-global/admin/tipos',
        headers: auth(token),
        payload: { codigo: 'r2', nome: 'R2', revisao_esperada: 0 },
      })
    );
    assert.equal(r.statusCode, 500);
    assert.equal(await getPrismaClient().catalogoTipoEntidade.count(), 0);
    assert.deepEqual(await contagens(), antes);

    const retry = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/tipos',
      headers: auth(token),
      payload: { codigo: 'r2', nome: 'R2', revisao_esperada: 0 },
    });
    assert.equal(retry.statusCode, 201);
    assert.equal((await contagens()).auditorias, 1);
  });

  test('R2-10 falha na auditoria ao atualizar tipo: alteração revertida; CAS segue 409', async () => {
    const { token } = await operadorComToken();
    const criado = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/tipos',
      headers: auth(token),
      payload: { codigo: 'r2b', nome: 'Original' },
    });
    const id = criado.json().id;
    const antes = await contagens();

    const r = await comTriggerDeFalha('AuditoriaCatalogoGlobal', {}, () =>
      app.inject({
        method: 'PATCH',
        url: `/catalogo-global/admin/tipos/${id}`,
        headers: auth(token),
        payload: { nome: 'Alterado', revisao_esperada: 1 },
      })
    );
    assert.equal(r.statusCode, 500);
    const tipo = await getPrismaClient().catalogoTipoEntidade.findUnique({ where: { id } });
    assert.equal(tipo.nome, 'Original');
    assert.deepEqual(await contagens(), antes);

    const stale = await app.inject({
      method: 'PATCH',
      url: `/catalogo-global/admin/tipos/${id}`,
      headers: auth(token),
      payload: { nome: 'X', revisao_esperada: 0 },
    });
    assert.equal(stale.statusCode, 409);
  });

  test('R2-11 admin do tenant (is_admin) sem operador de produto → 403 no upload', async () => {
    const { cliente, usuario, token } = await tenantComToken();
    await getPrismaClient().permissao.create({
      data: { cliente_id: cliente.id, user_email: usuario.login, is_admin: true },
    });
    const r = await postarAsset(token);
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, 'PRODUCT_OPERATOR_REQUIRED');
    assert.deepEqual(storageFake.gravados, []);
  });

  test('R2-12 upload sem JWT → 401 e nada gravado', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/catalogo-global/admin/assets',
      payload: { mime_type: 'image/png', conteudo_base64: PNG_1X1.toString('base64') },
    });
    assert.equal(r.statusCode, 401);
    assert.deepEqual(storageFake.gravados, []);
  });
});
