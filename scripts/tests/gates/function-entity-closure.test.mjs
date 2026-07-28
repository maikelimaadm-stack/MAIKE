import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractFunctionEntities,
  findForbiddenEntityStrings,
  findInvokedFunctions,
  findInvokedFunctionsDetailed,
  stripComments,
} from '../../gates/lib/base44-functions.mjs';
import { makeTempDir, cleanup, writeFile, runGate, baseManifest } from './helpers.mjs';

const GATE = 'gate-product-scope.mjs';

const FUNCTION_OK = `
const PROPAGATION_RULES = {
  Setor: [
    { entity: 'AreaPastagem', matchType: 'id', queryField: 'setor_id', fieldMap: { setor_nome: 'nome' } },
    { entity: 'Lote', matchType: 'id', queryField: 'setor_id', fieldMap: { setor_nome: 'nome' } },
  ],
};
export default PROPAGATION_RULES;
`;

const FUNCTION_COM_DESTINO_PROIBIDO = `
const PROPAGATION_RULES = {
  Setor: [
    { entity: 'ControleArea', matchType: 'id', queryField: 'setor_id', fieldMap: { setor_nome: 'nome' } },
  ],
};
`;

const FUNCTION_COM_FONTE_PROIBIDA = `
const PROPAGATION_RULES = {
  Safra: [
    { entity: 'Lote', matchType: 'id', queryField: 'safra_id', fieldMap: { safra_nome: 'nome' } },
  ],
};
`;

describe('analisador de functions Base44', () => {
  test('extrai chaves-fonte e destinos', () => {
    const e = extractFunctionEntities(FUNCTION_OK);
    assert.deepEqual(e.sources, ['Setor']);
    assert.deepEqual(e.targets, ['AreaPastagem', 'Lote']);
  });

  test('extrai acesso dinâmico a entidade literal', () => {
    const e = extractFunctionEntities("const api = base44.asServiceRole.entities.CustoSafra;");
    assert.deepEqual(e.dynamic, ['CustoSafra']);
  });

  test('extrai acesso dinâmico por colchete literal', () => {
    const e = extractFunctionEntities("const api = base44.entities['TarefaMapa'];");
    assert.deepEqual(e.dynamic, ['TarefaMapa']);
  });

  test('acesso computado por variável é reportado como não verificável', () => {
    const e = extractFunctionEntities('const api = base44.entities?.[entityName];');
    assert.deepEqual(e.dynamic, []);
    assert.equal(e.unverifiable.length, 1);
    assert.match(e.unverifiable[0], /acesso computado a "entities" com valor não literal/);
  });

  // ── Independência de formatação (P0.1-R2) ──────────────────────────────
  // A versão anterior casava `^ {2}Nome: [`. Quatro espaços, tab ou aspas
  // escapavam do gate — formatação decidia se o escopo estava fechado.

  const regras = (chave, indent) =>
    `const PROPAGATION_RULES = {\n${indent}${chave}: [\n${indent}${indent}{ entity: 'Lote' },\n${indent}],\n};\n`;

  test('chave-fonte com dois espaços', () => {
    assert.deepEqual(extractFunctionEntities(regras('Setor', '  ')).sources, ['Setor']);
  });

  test('chave-fonte com quatro espaços', () => {
    assert.deepEqual(extractFunctionEntities(regras('Setor', '    ')).sources, ['Setor']);
  });

  test('chave-fonte com tabulação', () => {
    assert.deepEqual(extractFunctionEntities(regras('Setor', '\t')).sources, ['Setor']);
  });

  test('chave-fonte sem quebra de linha', () => {
    const e = extractFunctionEntities("const PROPAGATION_RULES = { Setor: [{ entity: 'Lote' }] };");
    assert.deepEqual(e.sources, ['Setor']);
    assert.deepEqual(e.targets, ['Lote']);
  });

  test('chave-fonte entre aspas simples e duplas', () => {
    assert.deepEqual(
      extractFunctionEntities(`const PROPAGATION_RULES = {\n  'Setor': [],\n  "Lote": [],\n};`).sources,
      ['Lote', 'Setor']
    );
  });

  test('vírgula final e comentários no meio não atrapalham', () => {
    const codigo = [
      'const PROPAGATION_RULES = {',
      '  // comentário',
      '  Setor: [',
      "    { entity: 'Lote' }, /* destino */",
      '  ],',
      '};',
    ].join('\n');
    const e = extractFunctionEntities(codigo);
    assert.deepEqual(e.sources, ['Setor']);
    assert.deepEqual(e.targets, ['Lote']);
  });

  test('CRLF é tratado igual a LF', () => {
    const e = extractFunctionEntities(regras('Setor', '    ').replace(/\n/g, '\r\n'));
    assert.deepEqual(e.sources, ['Setor']);
  });

  test('destino declarado em várias linhas é extraído', () => {
    const codigo = [
      'const PROPAGATION_RULES = {',
      '  Setor: [',
      '    {',
      '      entity:',
      "        'AreaPastagem',",
      '    },',
      '  ],',
      '};',
    ].join('\n');
    assert.deepEqual(extractFunctionEntities(codigo).targets, ['AreaPastagem']);
  });

  test('objeto local indexado por variável não é acesso a entities', () => {
    const codigo = 'const registry = { Lote: base44.entities.Lote };\nconst api = registry[nome];\n';
    const e = extractFunctionEntities(codigo);
    assert.deepEqual(e.dynamic, ['Lote']);
    assert.deepEqual(e.unverifiable, []);
  });

  test('invoke com nome não literal é não verificável', () => {
    const r = findInvokedFunctionsDetailed('await base44.functions.invoke(nomeDaFunction, {});');
    assert.deepEqual(r.invoked, []);
    assert.equal(r.unverifiable.length, 1);
    assert.match(r.unverifiable[0], /functions\.invoke com nome não literal/);
  });

  test('chamada direta a function é detectada', () => {
    assert.deepEqual(findInvokedFunctions('await base44.functions.exportAllData({});'), ['exportAllData']);
  });

  test('comentários não geram falso positivo', () => {
    const codigo = "// entity: 'CustoSafra'\n/* entity: 'Safra' */\nconst x = 1;";
    assert.deepEqual(extractFunctionEntities(codigo).targets, []);
    assert.equal(stripComments(codigo).includes('CustoSafra'), false);
  });

  test('encontra entidade proibida citada como string', () => {
    assert.deepEqual(
      findForbiddenEntityStrings("const e = 'CustoSafra';", ['CustoSafra', 'Safra']),
      ['CustoSafra']
    );
  });

  test('nome que é substring de outro não gera falso positivo', () => {
    assert.deepEqual(findForbiddenEntityStrings("const e = 'CustoSafra';", ['Safra']), []);
  });

  test('encontra invocação de outra function', () => {
    assert.deepEqual(
      findInvokedFunctions('await base44.functions.invoke("exportAllData", {})'),
      ['exportAllData']
    );
  });
});

// ── Gate ponta a ponta ────────────────────────────────────────────────────
const makeProject = (functionSource, manifestOverrides = {}) => {
  const dir = makeTempDir('maike-fnscope-');
  const manifest = baseManifest(manifestOverrides);

  writeFile(dir, 'config/mapa-manejo-scope.json', manifest);
  writeFile(
    dir,
    'src/pages.config.js',
    `import MapaGeral from './pages/MapaGeral';\nexport const PAGES = {\n    "MapaGeral": MapaGeral,\n};\nexport const pagesConfig = { mainPage: "MapaGeral", Pages: PAGES };\n`
  );
  writeFile(dir, 'src/pages/MapaGeral.jsx', 'export default function MapaGeral() { return null; }\n');
  writeFile(dir, 'src/App.jsx', 'export default function App() { return null; }\n');
  writeFile(dir, 'src/Layout.jsx', 'export default function Layout() { return null; }\n');
  writeFile(dir, 'src/lib/menuConfig.js', 'export const DEFAULT_MENU = [{ id: "m", title: "Mapa", url: "MapaGeral" }];\n');

  for (const nome of manifest.allowedBase44Entities) {
    writeFile(dir, `base44/entities/${nome}.jsonc`, '{}');
  }
  writeFile(dir, 'base44/functions/syncEntityReferences/entry.ts', functionSource);
  return dir;
};

const run = (dir) => runGate(GATE, { cwd: dir });

describe('gate:product-scope — fechamento de entidades da function', () => {
  test('function dentro do manifesto passa', () => {
    const d = makeProject(FUNCTION_OK);
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('destino fora do manifesto reprova', () => {
    const d = makeProject(FUNCTION_COM_DESTINO_PROIBIDO);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-SCOPE-FUNCTION-ENTITY/);
    assert.match(r.output, /destino de propagação fora do manifesto: ControleArea/);
    cleanup(d);
  });

  test('chave-fonte fora do manifesto reprova', () => {
    const d = makeProject(FUNCTION_COM_FONTE_PROIBIDA);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /chave-fonte de propagação fora do manifesto: Safra/);
    cleanup(d);
  });

  test('entidade excluída citada como string reprova', () => {
    const d = makeProject(`${FUNCTION_OK}\nconst legado = 'CustoSafra';\n`);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /cita entidade excluída em código executável: CustoSafra/);
    cleanup(d);
  });

  test('acesso dinâmico a entidade fora do manifesto reprova', () => {
    const d = makeProject(`${FUNCTION_OK}\nconst api = base44.entities.TarefaMapa;\n`);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /acesso dinâmico a entidade fora do manifesto: TarefaMapa/);
    cleanup(d);
  });

  test('invocar function removida reprova', () => {
    const d = makeProject(`${FUNCTION_OK}\nawait base44.functions.invoke('exportAllData', {});\n`);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /invoca function fora do manifesto: exportAllData/);
    cleanup(d);
  });

  test('chamada direta a function removida reprova', () => {
    const d = makeProject(`${FUNCTION_OK}\nawait base44.functions.exportAllData({});\n`);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /invoca function fora do manifesto: exportAllData/);
    cleanup(d);
  });

  test('acesso computado por variável reprova como não verificável', () => {
    const d = makeProject(`${FUNCTION_OK}\nconst api = base44.entities?.[entityName];\n`);
    const r = run(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE/);
    cleanup(d);
  });

  test('acesso por colchete literal permitido passa', () => {
    const d = makeProject(`${FUNCTION_OK}\nconst api = base44.entities['Lote'];\n`);
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('string permitida qualquer não vira entidade', () => {
    const d = makeProject(`${FUNCTION_OK}\nconst rotulo = 'RelatorioFinanceiroMensal';\n`);
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  // Formatação não pode decidir o fechamento: os mesmos dados fora do manifesto
  // precisam reprovar com dois espaços, quatro espaços, tab e aspas.
  for (const [rotulo, codigo] of [
    ['dois espaços', "const PROPAGATION_RULES = {\n  Safra: [\n    { entity: 'Lote' },\n  ],\n};\n"],
    ['quatro espaços', "const PROPAGATION_RULES = {\n    Safra: [\n        { entity: 'Lote' },\n    ],\n};\n"],
    ['tabulação', "const PROPAGATION_RULES = {\n\tSafra: [\n\t\t{ entity: 'Lote' },\n\t],\n};\n"],
    ['aspas simples', "const PROPAGATION_RULES = {\n  'Safra': [\n    { entity: 'Lote' },\n  ],\n};\n"],
    ['aspas duplas', 'const PROPAGATION_RULES = {\n  "Safra": [\n    { entity: "Lote" },\n  ],\n};\n'],
    ['uma linha só', "const PROPAGATION_RULES = { Safra: [{ entity: 'Lote' }] };\n"],
  ]) {
    test(`chave-fonte fora do manifesto reprova — ${rotulo}`, () => {
      const d = makeProject(codigo);
      const r = run(d);
      assert.equal(r.status, 1, `formatação "${rotulo}" escapou do gate:\n${r.output}`);
      assert.match(r.output, /chave-fonte de propagação fora do manifesto: Safra/);
      cleanup(d);
    });
  }

  test('comentário citando entidade excluída não reprova', () => {
    const d = makeProject(`${FUNCTION_OK}\n// legado: entity 'CustoSafra'\n/* Safra */\n`);
    const r = run(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });
});
