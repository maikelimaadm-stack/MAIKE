import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, initGitRepo } from './helpers.mjs';

const GATE = 'gate-no-hardcoded-secrets.mjs';

/** Chaves sintéticas com formato válido, geradas em tempo de execução. */
const CHAVE_GOOGLE = 'AIza' + 'S'.repeat(4) + 'y'.repeat(31);
const PAT_GITHUB = 'ghp_' + 'a'.repeat(36);
const CHAVE_AWS = 'AKIA' + 'B'.repeat(16);
const VALOR_ATRIBUIDO = 'v4l0r' + '-r34l-de-producao';

const makeRepo = (arquivos = {}) => {
  const dir = makeTempDir('maike-secrets-');
  writeFile(dir, 'README.md', '# projeto de teste\n');
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    if (Buffer.isBuffer(conteudo)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, conteudo);
    } else {
      writeFile(dir, rel, conteudo);
    }
  }
  initGitRepo(dir);
  return dir;
};

const run = (dir) => runGate(GATE, { cwd: dir });

describe('gate:no-secrets', () => {
  test('repositório limpo passa', () => {
    const d = makeRepo({ 'src/index.js': 'export const a = 1;\n' });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('detecta chave Google em src/', () => {
    const d = makeRepo({ 'src/mapa.js': `const k = "${CHAVE_GOOGLE}";\n` });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-SECRET-HARDCODED/);
    assert.match(r.output, /src\/mapa\.js:1/);
    cleanup(d);
  });

  test('detecta segredo em scripts/ — fora de src/', () => {
    const d = makeRepo({ 'scripts/deploy.mjs': `const token = "${PAT_GITHUB}";\n` });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /scripts\/deploy\.mjs/);
    cleanup(d);
  });

  test('detecta segredo em base44/', () => {
    const d = makeRepo({ 'base44/functions/x/entry.ts': `const aws = "${CHAVE_AWS}";\n` });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /base44\/functions\/x\/entry\.ts/);
    cleanup(d);
  });

  test('detecta segredo em subdiretório profundo', () => {
    const d = makeRepo({ 'a/b/c/d/config.json': `{ "apiKey": "${CHAVE_GOOGLE}" }\n` });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /a\/b\/c\/d\/config\.json/);
    cleanup(d);
  });

  test('detecta .env versionado em subdiretório', () => {
    const d = makeRepo({ 'apps/web/.env.production': 'API=1\n' });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-SECRET-ENV-TRACKED/);
    assert.match(r.output, /apps\/web\/\.env\.production/);
    cleanup(d);
  });

  test('.env.example é permitido', () => {
    const d = makeRepo({ '.env.example': 'VITE_GOOGLE_MAPS_API_KEY=\n' });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('exemplo mascarado não é falso positivo', () => {
    const d = makeRepo({
      'docs/setup.md': 'Use `VITE_GOOGLE_MAPS_API_KEY=AIzaSUA_CHAVE_AQUI_XXXXXXXXXXXXXXXXXXXX`\n',
      'src/ok.js': 'const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;\n',
    });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('binário é ignorado mesmo contendo o padrão', () => {
    const conteudo = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]),
      Buffer.from(CHAVE_GOOGLE),
    ]);
    const d = makeRepo({ 'assets/logo.png': conteudo });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('nunca imprime o valor do segredo', () => {
    const d = makeRepo({ 'src/vaza.js': `const k = "${CHAVE_GOOGLE}";\n` });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.ok(!r.output.includes(CHAVE_GOOGLE), 'a saída não pode conter o segredo');
    assert.match(r.output, /Google API key/);
    cleanup(d);
  });

  // ── Bypass de linha mascarada (P0.1-R2) ────────────────────────────────
  // A avaliação de "mascarado" é feita sobre o VALOR capturado, nunca sobre a
  // linha. Antes bastava citar `import.meta.env` ou `EXAMPLE` na mesma linha.

  test('env com fallback literal para chave Google real reprova', () => {
    const d = makeRepo({
      'src/mapa.js': `const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "${CHAVE_GOOGLE}";\n`,
    });
    const r = run(d);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /P01-SECRET-HARDCODED/);
    assert.match(r.output, /Google API key/);
    cleanup(d);
  });

  test('env com fallback literal para PAT do GitHub reprova', () => {
    const d = makeRepo({
      'scripts/ci.mjs': `const token = process.env.GITHUB_TOKEN || "${PAT_GITHUB}";\n`,
    });
    const r = run(d);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /GitHub PAT/);
    cleanup(d);
  });

  test('placeholder e segredo real na mesma linha reprova', () => {
    const d = makeRepo({
      'src/demo.js': `const demo = "SUA_CHAVE"; const leaked = "${PAT_GITHUB}";\n`,
    });
    const r = run(d);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /GitHub PAT/);
    cleanup(d);
  });

  test('comentário EXAMPLE não isenta segredo real na mesma linha', () => {
    const d = makeRepo({
      'src/config.js': `const API_KEY = "${VALOR_ATRIBUIDO}"; // EXAMPLE\n`,
    });
    const r = run(d);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /Segredo atribuído diretamente/);
    cleanup(d);
  });

  test('placeholder puro continua permitido', () => {
    const d = makeRepo({
      '.env.example': 'VITE_GOOGLE_MAPS_API_KEY=SUA_CHAVE\n',
      'docs/guia.md': 'Defina `API_KEY="<coloque-a-sua-chave-aqui>"`.\n',
    });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('leitura de env sem fallback continua permitida', () => {
    const d = makeRepo({
      'src/ok.js':
        'const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;\nconst outro = process.env.TOKEN;\n',
    });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('segredo real dentro de .env.example reprova', () => {
    const d = makeRepo({ '.env.example': `VITE_GOOGLE_MAPS_API_KEY=${CHAVE_GOOGLE}\n` });
    const r = run(d);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /\.env\.example:1/);
    assert.ok(!r.output.includes(CHAVE_GOOGLE));
    cleanup(d);
  });

  test('template com interpolação vazia não é segredo', () => {
    const d = makeRepo({ 'src/tpl.js': 'const apiKey = `${config.googleMapsKey}`;\n' });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('nunca imprime o valor mesmo quando há env na linha', () => {
    const d = makeRepo({
      'src/misto.js': `const k = import.meta.env.K || "${CHAVE_GOOGLE}";\n`,
    });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.ok(!r.output.includes(CHAVE_GOOGLE), 'a saída não pode conter o segredo');
    cleanup(d);
  });

  /**
   * Contrato invertido na P1.4 (DBT-17).
   *
   * Até a P1.3 este teste fixava o oposto: arquivo não rastreado **não** era
   * varrido, e um `.js` novo com chave dentro passava batido até o `git add`.
   * O gate ficava verde exatamente no momento em que o segredo estava mais
   * fresco e mais perto de virar commit.
   */
  test('DBT-17a — arquivo não rastreado e não ignorado com segredo reprova', () => {
    const d = makeRepo({ 'src/ok.js': 'export const a = 1;\n' });
    // Escrito depois do `git add`: não está no índice, e nada o ignora.
    writeFile(d, 'src/naoVersionado.js', `const k = "${CHAVE_GOOGLE}";\n`);
    const r = run(d);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /P01-SECRET-HARDCODED/);
    assert.match(r.output, /naoVersionado\.js/);
    assert.ok(!r.output.includes(CHAVE_GOOGLE), 'o valor do segredo não pode aparecer na saída');
    cleanup(d);
  });

  test('DBT-17b — arquivo não rastreado e seguro passa', () => {
    const d = makeRepo({ 'src/ok.js': 'export const a = 1;\n' });
    writeFile(d, 'src/novoSeguro.js', 'export const chave = import.meta.env.VITE_ALGO;\n');
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('DBT-17c — arquivo ignorado não é varrido, mesmo com segredo', () => {
    const d = makeRepo({ 'src/ok.js': 'export const a = 1;\n', '.gitignore': '.env.local\nsegredos/\n' });
    writeFile(d, '.env.local', `GOOGLE_KEY=${CHAVE_GOOGLE}\n`);
    writeFile(d, 'segredos/chave.txt', `${CHAVE_GOOGLE}\n`);
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });
});
