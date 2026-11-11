import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validarSvgEstatico, MAX_SVG_BYTES } from '../src/shared/imagens/svgEstatico.js';
import { validarBufferAssetCatalogo, limitesUploadCatalogo } from '../src/modules/catalogoGlobal/catalogoAssetValidation.js';
import { extensaoDeMime, criarArmazenamentoCatalogo } from '../src/modules/catalogoGlobal/catalogoAssetStorage.js';
import { registrarArquivoUploadRoutes } from '../src/modules/arquivos/arquivoUploadRoutes.js';
import { env } from '../src/config/env.js';

const svg = (conteudo = '<path d="M0 0L10 10" fill="#5acbe9"/>') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 750 750">${conteudo}</svg>`);

test('SVG de 1000px é aceito em vetor; MIME, dimensões e hash preservados', () => {
  const buffer = Buffer.concat([Buffer.from('\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n'), svg()]);
  const validado = validarBufferAssetCatalogo(buffer, 'image/svg+xml');
  assert.equal(validado.mime, 'image/svg+xml');
  assert.equal(validado.largura, 1000);
  assert.equal(validado.altura, 1000);
  assert.equal(validado.sha256, createHash('sha256').update(buffer).digest('hex'));
  assert.equal(validado.bytes, buffer.length);
  assert.ok(limitesUploadCatalogo().mimes.includes('image/svg+xml'));
  assert.equal(extensaoDeMime(validado.mime), 'svg');
});

test('SVG estático com gradiente, recorte e referência interna é aceito', () => {
  const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><defs><path id="boi" d="M1 1L10 10"/><linearGradient id="cor"><stop offset="0" stop-color="#fff"/></linearGradient></defs><use href="#boi" fill="url(#cor)"/></svg>');
  assert.deepEqual(validarSvgEstatico(buffer), { largura: 48, altura: 24 });
});

for (const [nome, conteudo] of [
  ['script', '<script>alert(1)</script>'],
  ['evento', '<path d="M0 0" onload="alert(1)"/>'],
  ['HTML', '<foreignObject><div>HTML</div></foreignObject>'],
  ['PNG embutido', '<image href="data:image/png;base64,abc"/>'],
  ['imagem remota', '<image href="https://example.com/a.png"/>'],
  ['referência remota', '<use href="https://example.com/a.svg#boi"/>'],
  ['referência codificada', '<use href="&#104;ttps://example.com/a.svg#boi"/>'],
  ['CSS remoto', '<path d="M0 0" style="fill:url(https://example.com/a.svg)"/>'],
  ['CSS escapado', '<path d="M0 0" style="fill:u\\72l(https://example.com/a.svg)"/>'],
  ['folha CSS', '<style>@import "https://example.com/a.css";</style>'],
  ['animação', '<animate attributeName="href" to="https://example.com/a.svg"/>'],
  ['base externa', '<g xml:base="https://example.com"><use href="#boi"/></g>'],
  ['atributo sem namespace permitido', '<path xmlns:x="urn:malicioso" x:href="#boi" d="M0 0"/>'],
]) {
  test(`SVG recusa ${nome}`, () => {
    assert.throws(() => validarBufferAssetCatalogo(svg(conteudo), 'image/svg+xml'),
      (e) => e.code === 'CATALOGO_ASSET_INVALID');
  });
}

test('recusa XML inválido, DTD, instruções externas, SVG vazio e tamanho excessivo', () => {
  for (const buffer of [
    svg().subarray(0, -8), Buffer.from('<svg/>'),
    Buffer.concat([Buffer.from('<!DOCTYPE svg [<!ENTITY x "boom">]>'), svg()]),
    Buffer.concat([Buffer.from('<?xml-stylesheet href="https://example.com/a.css"?>'), svg()]),
    svg(''), svg(`<!--${'x'.repeat(MAX_SVG_BYTES)}--><path d="M0 0"/>`),
  ]) assert.throws(() => validarSvgEstatico(buffer));
});

test('MIME declarado precisa corresponder ao SVG real', () => {
  assert.throws(() => validarBufferAssetCatalogo(svg(), 'image/png'),
    (e) => e.code === 'CATALOGO_ASSET_INVALID');
});

test('handler de upload comum preserva SVG e continua recusando scripts', async () => {
  let handler;
  await registrarArquivoUploadRoutes({ post: (_path, _options, fn) => { handler = fn; } });
  const contexto = { auth: { clienteId: 'cliente-teste', usuarioId: 'usuario-teste', login: 'teste' } };
  const original = svg();
  const resultado = await handler({ contexto, body: { mime_type: 'image/svg+xml', conteudo_base64: original.toString('base64') } }, { send: (v) => v });
  assert.equal(resultado.file_url, `data:image/svg+xml;base64,${original.toString('base64')}`);
  assert.equal(resultado.tamanho_bytes, original.length);
  await assert.rejects(() => handler({ contexto, body: { mime_type: 'image/svg+xml', conteudo_base64: svg('<script/>').toString('base64') } }, { send: (v) => v }),
    (e) => e.code === 'ATTACHMENT_INVALID');
});

test('Storage recebe extensão e Content-Type SVG, sem alterar os bytes', async () => {
  const anterior = { url: env.supabaseUrl, key: env.supabaseServiceRoleKey, fetch: globalThis.fetch };
  try {
    env.supabaseUrl = 'https://storage.example.test';
    env.supabaseServiceRoleKey = 'fixture-local-sem-validade';
    const buffer = svg();
    globalThis.fetch = async (url, opcoes) => {
      assert.match(String(url), /\.svg$/);
      assert.equal(opcoes.headers['Content-Type'], 'image/svg+xml');
      assert.equal(opcoes.body, buffer);
      return { ok: true };
    };
    await criarArmazenamentoCatalogo().gravar({ buffer, sha256: 'a'.repeat(64), revisao: 1, extensao: 'svg', idObjeto: 'teste-svg' });
  } finally {
    env.supabaseUrl = anterior.url;
    env.supabaseServiceRoleKey = anterior.key;
    globalThis.fetch = anterior.fetch;
  }
});
