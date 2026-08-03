import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanup, writeFile, runGate, baseManifest } from './helpers.mjs';

const GATE = 'gate-source-closure.mjs';

/** Projeto mínimo alcançável a partir das entradas reais. */
const makeProject = (extra = {}, manifestOverrides = {}) => {
  const dir = makeTempDir('maike-closure-');
  writeFile(dir, 'config/mapa-manejo-scope.json', baseManifest(manifestOverrides));
  writeFile(dir, 'src/main.jsx', "import App from './App.jsx';\nexport default App;\n");
  writeFile(dir, 'src/App.jsx', "import { pagesConfig } from './pages.config';\nexport default pagesConfig;\n");
  writeFile(
    dir,
    'src/pages.config.js',
    "import MapaGeral from './pages/MapaGeral';\nimport __Layout from './Layout.jsx';\nexport const pagesConfig = { mainPage: 'MapaGeral', Pages: { MapaGeral }, Layout: __Layout };\n"
  );
  writeFile(dir, 'src/Layout.jsx', "export default function Layout() { return null; }\n");
  writeFile(dir, 'src/pages/MapaGeral.jsx', "export default function MapaGeral() { return null; }\n");
  for (const [rel, conteudo] of Object.entries(extra)) writeFile(dir, rel, conteudo);
  return dir;
};

const run = (dir) => runGate(GATE, { cwd: dir });

describe('gate:source-closure', () => {
  test('projeto sem órfão passa', () => {
    const d = makeProject();
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('arquivo órfão simples reprova', () => {
    const d = makeProject({ 'src/lib/orfao.js': 'export const x = 1;\n' });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-SCOPE-ORPHAN/);
    assert.match(r.output, /src\/lib\/orfao\.js/);
    cleanup(d);
  });

  test('arquivo alcançável por import relativo passa', () => {
    const d = makeProject({
      'src/lib/util.js': 'export const x = 1;\n',
      'src/pages/MapaGeral.jsx': "import { x } from '../lib/util';\nexport default function MapaGeral() { return x; }\n",
    });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('arquivo alcançável por alias @/ passa', () => {
    const d = makeProject({
      'src/lib/alias.js': 'export const x = 1;\n',
      'src/pages/MapaGeral.jsx': "import { x } from '@/lib/alias';\nexport default function MapaGeral() { return x; }\n",
    });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('arquivo alcançável por export from passa', () => {
    const d = makeProject({
      'src/lib/reexport.js': 'export const y = 2;\n',
      'src/pages/MapaGeral.jsx': "export * from '../lib/reexport';\nexport default function MapaGeral() { return null; }\n",
    });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('arquivo alcançável por import dinâmico literal passa', () => {
    const d = makeProject({
      'src/lib/lazy.js': 'export const z = 3;\n',
      'src/pages/MapaGeral.jsx': "export default function MapaGeral() { return import('../lib/lazy'); }\n",
    });
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('allowlist válida libera o órfão', () => {
    const d = makeProject(
      { 'src/lib/dinamico.js': 'export const x = 1;\n' },
      {
        orphanAllowlist: [
          {
            path: 'src/lib/dinamico.js',
            justification: 'carregado por registry em runtime',
            dynamicConsumer: 'src/lib/registry.js',
            decision: 'D-PROD-06',
          },
        ],
      }
    );
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('allowlist sem justificativa reprova', () => {
    const d = makeProject(
      { 'src/lib/dinamico.js': 'export const x = 1;\n' },
      { orphanAllowlist: [{ path: 'src/lib/dinamico.js' }] }
    );
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-SCOPE-DYNAMIC-ALLOWLIST/);
    assert.match(r.output, /exige "justification"/);
    cleanup(d);
  });

  test('allowlist apontando para arquivo inexistente reprova', () => {
    const d = makeProject(
      {},
      {
        orphanAllowlist: [
          {
            path: 'src/lib/nao-existe.js',
            justification: 'x',
            dynamicConsumer: 'y',
            decision: 'D-PROD-06',
          },
        ],
      }
    );
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /aponta para arquivo inexistente/);
    cleanup(d);
  });

  test('allowlist por diretório é recusada', () => {
    const d = makeProject(
      { 'src/lib/dinamico.js': 'export const x = 1;\n' },
      {
        orphanAllowlist: [
          { path: 'src/lib/', justification: 'x', dynamicConsumer: 'y', decision: 'D-PROD-06' },
        ],
      }
    );
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /allowlist por diretório ou padrão não é aceita/);
    cleanup(d);
  });

  test('allowlist obsoleta (arquivo já alcançável) reprova', () => {
    const d = makeProject(
      {
        'src/lib/util.js': 'export const x = 1;\n',
        'src/pages/MapaGeral.jsx': "import { x } from '../lib/util';\nexport default function MapaGeral() { return x; }\n",
      },
      {
        orphanAllowlist: [
          {
            path: 'src/lib/util.js',
            justification: 'x',
            dynamicConsumer: 'y',
            decision: 'D-PROD-06',
          },
        ],
      }
    );
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /já é alcançável — remova a entrada/);
    cleanup(d);
  });

  test('página permitida ausente reprova', () => {
    const d = makeProject({}, { allowedPages: ['MapaGeral', 'PaginaFantasma'] });
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /página permitida não existe em src\/pages: PaginaFantasma/);
    cleanup(d);
  });
});
