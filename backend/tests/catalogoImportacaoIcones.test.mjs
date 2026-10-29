/**
 * PR145-R2 (D-PROD-69) — importação server-side de ícones oficiais
 * (`scripts/catalogo/importarIconesLib.mjs`) pela API admin existente.
 *
 * PostgreSQL real + Storage falso em memória; imagens são bytes sintéticos.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { env } from '../src/config/env.js';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { caminhoObjetoCatalogo, criarArmazenamentoCatalogo } from '../src/modules/catalogoGlobal/catalogoAssetStorage.js';
import { aplicar, carregarManifesto, planejar } from '../../scripts/catalogo/importarIconesLib.mjs';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp, criarAdminComSessao } from './helpers.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PNG_B = Buffer.concat([PNG_1X1, Buffer.from([0, 1, 2, 3])]);

const objetos = new Map();
const storage = {
  aoVivo: false,
  async gravar({ buffer, sha256, revisao, extensao, idObjeto }) {
    const storage_path = caminhoObjetoCatalogo({ sha256, revisao, extensao, idObjeto });
    objetos.set(storage_path, buffer);
    return { bucket: 'maike-catalogo-global', storage_path };
  },
  async remover(storage_path) {
    objetos.delete(storage_path);
  },
};

/** @type {import('fastify').FastifyInstance} */
let app;
const urlOriginal = env.supabaseUrl;
const chaveOriginal = env.supabaseServiceRoleKey;

before(async () => {
  criarArmazenamentoCatalogo(storage);
  // URL pública versionada como em produção; os bytes vão para o Storage falso.
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
});

/** `headers` = sessão do proprietário (cookie+CSRF+Origin) ou só `authorization` de tenant. */
const httpCom = (headers) => async ({ method, url, payload }) => {
  const r = await app.inject({ method, url, headers, payload });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};

const operador = async () => (await criarAdminComSessao(app)).headers;

/** Leitura publicada, como um cliente a veria. */
const publicadosComoCliente = async () => {
  const { credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return (await httpCom({ authorization: `Bearer ${corpo.token}` })({ method: 'GET', url: '/catalogo-global/icones' })).body;
};

const manifestoEm = async (itens, arquivos) => {
  const dir = await mkdtemp(join(tmpdir(), 'maike-import-'));
  for (const [nome, bytes] of Object.entries(arquivos)) await writeFile(join(dir, nome), bytes);
  const caminho = join(dir, 'manifesto.json');
  await writeFile(caminho, JSON.stringify({ tipo: { codigo: 'lote', nome: 'Lote' }, itens }));
  return caminho;
};

describe('importação de ícones oficiais (D-PROD-69/70)', () => {
  test('I-01 manifesto inválido: erros locais e nenhuma escrita', async () => {
    const caminho = await manifestoEm(
      [
        { categoria: { codigo: 'bezerro', nome: 'Bezerro' }, imagem: 'icone.svg' },
        { categoria: { codigo: 'bezerro', nome: 'Repetida' }, imagem: 'grande.png' },
        { categoria: { codigo: 'Garrote!', nome: 'G' }, imagem: 'nao-existe.png' },
      ],
      { 'icone.svg': '<svg onload="x()"/>', 'grande.png': Buffer.concat([PNG_1X1, Buffer.alloc(600 * 1024)]) }
    );
    const m = await carregarManifesto(caminho);
    const texto = m.erros.join('\n');
    assert.match(texto, /formato não aceito/);
    assert.match(texto, /acima do limite/);
    assert.match(texto, /repetida/);
    assert.match(texto, /codigo inválido/);
    assert.match(texto, /não encontrado/);
    assert.equal(await getPrismaClient().catalogoAsset.count(), 0);
  });

  test('I-02 aplicar cria tipo/categoria/ícone publicado; reaplicar é idempotente; trocar imagem mantém o id', async () => {
    const http = httpCom(await operador());
    const caminho = await manifestoEm(
      [{ categoria: { codigo: 'bezerro', nome: 'Bezerro' }, imagem: 'bezerro.png', cor_fallback: '#16a34a' }],
      { 'bezerro.png': PNG_1X1 }
    );
    const m = await carregarManifesto(caminho);
    assert.deepEqual(m.erros, []);

    const plano = await planejar(m, http);
    assert.equal(plano.tipo, null);
    assert.equal(plano.passos[0].acao, 'criar_e_publicar');

    const r1 = await aplicar(m, http);
    const [item] = r1.resultado;
    assert.equal(item.acao, 'criar_e_publicar');
    const publicados = await publicadosComoCliente();
    assert.equal(publicados.length, 1);
    assert.equal(publicados[0].id, item.icone_id);
    assert.match(publicados[0].asset_principal_url, /^https:\/\/storage\.teste\.local\/storage\/v1\/object\/public\//);
    assert.ok([...objetos.values()].some((b) => b.equals(PNG_1X1)), 'bytes enviados sem transformação');

    const r2 = await aplicar(m, http);
    assert.equal(r2.resultado[0].acao, 'nada');
    assert.equal(await getPrismaClient().catalogoIcone.count(), 1);

    await writeFile(caminho.replace('manifesto.json', 'bezerro.png'), PNG_B);
    const r3 = await aplicar(await carregarManifesto(caminho), http);
    assert.equal(r3.resultado[0].acao, 'trocar_imagem');
    assert.equal(r3.resultado[0].icone_id, item.icone_id, 'id lógico estável');
    const depois = await publicadosComoCliente();
    assert.equal(depois.length, 1);
    assert.notEqual(depois[0].asset_principal_url, publicados[0].asset_principal_url, 'URL versionada nova');
    assert.ok(
      (await getPrismaClient().auditoriaCatalogoGlobal.count({ where: { entidade_id: item.icone_id } })) >= 3,
      'criar + publicar + atualizar auditados'
    );
  });

  test('I-03 admin de tenant (e operador legado) não importa: 403 e nada é gravado', async () => {
    const { cliente, usuario, credenciais } = await criarTenant();
    await getPrismaClient().permissao.create({ data: { cliente_id: cliente.id, user_email: usuario.login, is_admin: true } });
    const { corpo } = await autenticarNoApp(app, credenciais);
    const caminho = await manifestoEm([{ categoria: { codigo: 'bezerro', nome: 'Bezerro' }, imagem: 'b.png' }], {
      'b.png': PNG_1X1,
    });
    await getPrismaClient().operadorProdutoMaike.create({ data: { cliente_id: cliente.id, usuario_id: usuario.id, ativo: true } });
    await assert.rejects(
      aplicar(await carregarManifesto(caminho), httpCom({ authorization: `Bearer ${corpo.token}` })),
      /HTTP 403 ADMIN_PRINCIPAL_REQUIRED/
    );
    assert.equal(await getPrismaClient().catalogoTipoEntidade.count(), 0);
    assert.equal(objetos.size, 0);
  });

  test('I-04 execução interrompida deixa rascunho: reexecutar publica o MESMO ícone, sem duplicar', async () => {
    const http = httpCom(await operador());
    const caminho = await manifestoEm([{ categoria: { codigo: 'bezerro', nome: 'Bezerro' }, imagem: 'b.png' }], {
      'b.png': PNG_1X1,
    });
    const m = await carregarManifesto(caminho);
    // Simula queda entre "criar ícone" e "publicar".
    let publicacoes = 0;
    const quebraNaPublicacao = async (req) => {
      if (req.url.endsWith('/publicar') && publicacoes++ === 0) return { status: 503, body: { code: 'INDISPONIVEL' } };
      return http(req);
    };
    await assert.rejects(aplicar(m, quebraNaPublicacao), /HTTP 503/);
    assert.equal(await getPrismaClient().catalogoIcone.count({ where: { estado: 'rascunho' } }), 1);
    const r = await aplicar(m, http);
    assert.equal(r.resultado[0].acao, 'publicar_rascunho');
    assert.equal(await getPrismaClient().catalogoIcone.count(), 1);
    assert.equal((await publicadosComoCliente()).length, 1);
  });
});
