/**
 * Testes do gate de fronteira de dados (P1.1).
 *
 * Todos executam o **gate real** como processo, em projetos temporários.
 * Toda falha esperada prova que o baseline ficou byte a byte intacto.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, REPO_ROOT } from './helpers.mjs';
import ts from 'typescript';

import { ALLOWED_PROVIDER_ADAPTER, scanBoundary, scriptKindOf, analyzeFile } from '../../gates/lib/api-boundary.mjs';

const GATE = 'gate-api-boundary.mjs';
const BASELINE_REL = 'api-boundary-baseline.json';
const SCOPE_REL = 'config/mapa-manejo-scope.json';

/** Página legada típica: importa o client e usa a entidade. */
const PAGINA_LEGADA = (entidade) => `import { base44 } from '@/api/base44Client';
export const carregar = () => base44.entities.${entidade}.list('-created_date');
`;

/** Adapter autorizado, com registry literal. */
const ADAPTER = (entidades = ['Empresa']) => `import { base44 } from '@/api/base44Client';
const ENTITY_REGISTRY = Object.freeze({
${entidades.map((e) => `  ${e}: base44.entities.${e},`).join('\n')}
});
const endpointOf = (nome) => ENTITY_REGISTRY[nome];
export const empresaProvider = Object.freeze({
  list: (ordem) => endpointOf('Empresa').list(ordem),
});
`;

/**
 * Projeto temporário com o mínimo que o gate exige.
 * @param {{legados?: Record<string,string>, adapter?: string|null, entidadesEscopo?: string[]}} [opcoes]
 */
const makeProject = ({ legados = {}, adapter = ADAPTER(), entidadesEscopo = ['Empresa', 'Lote'] } = {}) => {
  const dir = makeTempDir('maike-boundary-');
  writeFile(dir, SCOPE_REL, { allowedBase44Entities: entidadesEscopo });
  writeFile(dir, 'src/api/base44Client.js', "import { createClient } from '@base44/sdk';\nexport const base44 = createClient({});\n");
  if (adapter !== null) writeFile(dir, ALLOWED_PROVIDER_ADAPTER, adapter);
  for (const [rel, conteudo] of Object.entries(legados)) writeFile(dir, rel, conteudo);
  return dir;
};

const rodar = (dir, { args = [] } = {}) =>
  runGate(GATE, {
    cwd: dir,
    args,
    env: { API_BOUNDARY_BASELINE: BASELINE_REL, API_BOUNDARY_SCOPE: SCOPE_REL },
  });

const gravarBaseline = (dir, dados) =>
  writeFileSync(join(dir, BASELINE_REL), `${JSON.stringify(dados, null, 2)}\n`);

const lerBaseline = (dir) => JSON.parse(readFileSync(join(dir, BASELINE_REL), 'utf8'));
const bytesBaseline = (dir) => readFileSync(join(dir, BASELINE_REL), 'utf8');

/** Constrói o baseline a partir da medição real do projeto — sem passar pelo gate. */
const criarBaseline = (dir, { certifiedFromMain = '0'.repeat(40) } = {}) => {
  const atual = scanBoundary(dir);
  const baseline = {
    version: 1,
    certifiedFromMain,
    allowedProviderAdapter: ALLOWED_PROVIDER_ADAPTER,
    axes: atual.listas,
  };
  gravarBaseline(dir, baseline);
  return baseline;
};

/** Roda esperando falha e prova que o baseline não foi tocado. */
const falhaSemEscrever = (dir, { args = [] } = {}) => {
  const antes = bytesBaseline(dir);
  const r = rodar(dir, { args });
  assert.equal(r.status, 1, `esperava exit 1:\n${r.output}`);
  assert.equal(bytesBaseline(dir), antes, 'o baseline foi alterado numa execução que deveria falhar');
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.includes('.tmp')),
    [],
    'nenhum arquivo temporário pode sobrar'
  );
  return r;
};

describe('gate:api-boundary — baseline', () => {
  test('1. baseline ausente reprova e não cria arquivo', () => {
    const d = makeProject();
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P11-API-BOUNDARY-BASELINE/);
    assert.equal(existsSync(join(d, BASELINE_REL)), false, 'o gate não pode criar baseline');
    cleanup(d);
  });

  test('2. baseline com JSON inválido reprova', () => {
    const d = makeProject();
    writeFile(d, BASELINE_REL, '{ não é json');
    const r = falhaSemEscrever(d);
    assert.match(r.output, /não é JSON válido/);
    cleanup(d);
  });

  test('3. versão desconhecida reprova', () => {
    const d = makeProject();
    gravarBaseline(d, { ...criarBaseline(d), version: 99 });
    const r = falhaSemEscrever(d);
    assert.match(r.output, /versão de baseline desconhecida/);
    cleanup(d);
  });

  test('4. eixo ausente reprova', () => {
    const d = makeProject();
    const b = criarBaseline(d);
    delete b.axes.authRefs;
    gravarBaseline(d, b);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /eixo\(s\) ausente\(s\): authRefs/);
    cleanup(d);
  });

  test('5. eixo inesperado reprova', () => {
    const d = makeProject();
    const b = criarBaseline(d);
    b.axes.eixoInventado = [];
    gravarBaseline(d, b);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /eixo\(s\) inesperado\(s\): eixoInventado/);
    cleanup(d);
  });

  test('6. certifiedFromMain ausente reprova', () => {
    const d = makeProject();
    const b = criarBaseline(d);
    delete b.certifiedFromMain;
    gravarBaseline(d, b);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /"certifiedFromMain" precisa ser um SHA de 40 caracteres/);
    cleanup(d);
  });

  test('7. allowedProviderAdapter divergente reprova', () => {
    const d = makeProject();
    gravarBaseline(d, { ...criarBaseline(d), allowedProviderAdapter: 'src/outro/adapter.js' });
    const r = falhaSemEscrever(d);
    assert.match(r.output, /"allowedProviderAdapter" divergente/);
    cleanup(d);
  });

  test('8. eixo que não é lista de caminhos reprova', () => {
    const d = makeProject();
    const b = criarBaseline(d);
    b.axes.entitiesRefs = 3;
    gravarBaseline(d, b);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /não é uma lista de caminhos/);
    cleanup(d);
  });
});

describe('gate:api-boundary — monotonicidade por identidade de arquivo', () => {
  test('9. caminho legado novo reprova, mesmo com a mesma contagem', () => {
    const d = makeProject({ legados: { 'src/pages/Antiga.jsx': PAGINA_LEGADA('Lote') } });
    criarBaseline(d);
    // Troca: remove um caminho e cria outro. A contagem fecha; a identidade não.
    writeFile(d, 'src/pages/Antiga.jsx', 'export const carregar = () => [];\n');
    writeFile(d, 'src/pages/Nova.jsx', PAGINA_LEGADA('Lote'));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-REGRESSION/);
    assert.match(r.output, /caminho legado novo — src\/pages\/Nova\.jsx/);
    cleanup(d);
  });

  test('10. rename de arquivo legado reprova', () => {
    const d = makeProject({ legados: { 'src/pages/Antiga.jsx': PAGINA_LEGADA('Lote') } });
    criarBaseline(d);
    writeFile(d, 'src/pages/Renomeada.jsx', PAGINA_LEGADA('Lote'));
    writeFile(d, 'src/pages/Antiga.jsx', 'export const carregar = () => [];\n');
    const r = falhaSemEscrever(d);
    assert.match(r.output, /caminho legado novo — src\/pages\/Renomeada\.jsx/);
    cleanup(d);
  });

  test('11. arquivo removido é progresso e passa', () => {
    const d = makeProject({ legados: { 'src/pages/Antiga.jsx': PAGINA_LEGADA('Lote') } });
    criarBaseline(d);
    writeFile(d, 'src/pages/Antiga.jsx', 'export const carregar = () => [];\n');
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /caminho legado removido — src\/pages\/Antiga\.jsx/);
    cleanup(d);
  });

  test('12. estado estável passa sem escrever', () => {
    const d = makeProject({ legados: { 'src/pages/Antiga.jsx': PAGINA_LEGADA('Lote') } });
    criarBaseline(d);
    const antes = bytesBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.equal(bytesBaseline(d), antes, 'execução normal nunca escreve');
    cleanup(d);
  });

  test('13. --update sem progresso reprova e não escreve', () => {
    const d = makeProject({ legados: { 'src/pages/Antiga.jsx': PAGINA_LEGADA('Lote') } });
    criarBaseline(d);
    const r = falhaSemEscrever(d, { args: ['--update'] });
    assert.match(r.output, /--update exige pelo menos um caminho legado removido/);
    cleanup(d);
  });

  test('14. --update com subconjunto estrito grava', () => {
    const d = makeProject({
      legados: {
        'src/pages/Antiga.jsx': PAGINA_LEGADA('Lote'),
        'src/pages/Outra.jsx': PAGINA_LEGADA('Lote'),
      },
    });
    criarBaseline(d);
    assert.equal(lerBaseline(d).axes.importsLegacyClient.length, 2);
    writeFile(d, 'src/pages/Antiga.jsx', 'export const carregar = () => [];\n');
    const r = rodar(d, { args: ['--update'] });
    assert.equal(r.status, 0, r.output);
    const depois = lerBaseline(d);
    assert.deepEqual(depois.axes.importsLegacyClient, ['src/pages/Outra.jsx']);
    assert.equal(depois.certifiedFromMain, '0'.repeat(40), 'a origem certificada é preservada');
    cleanup(d);
  });

  test('15. --update com regressão simultânea reprova e não escreve', () => {
    const d = makeProject({
      legados: {
        'src/pages/Antiga.jsx': PAGINA_LEGADA('Lote'),
        'src/pages/Outra.jsx': PAGINA_LEGADA('Lote'),
      },
    });
    criarBaseline(d);
    writeFile(d, 'src/pages/Antiga.jsx', 'export const carregar = () => [];\n');
    writeFile(d, 'src/pages/Nova.jsx', PAGINA_LEGADA('Lote'));
    const r = falhaSemEscrever(d, { args: ['--update'] });
    assert.match(r.output, /P11-API-BOUNDARY-REGRESSION/);
    cleanup(d);
  });

  test('16. --seed não existe', () => {
    const d = makeProject();
    criarBaseline(d);
    const r = falhaSemEscrever(d, { args: ['--seed'] });
    assert.match(r.output, /--seed não existe/);
    cleanup(d);
  });
});

describe('gate:api-boundary — invariantes absolutas', () => {
  test('17. @base44/sdk fora do client legado reprova', () => {
    const d = makeProject({ legados: { 'src/lib/atalho.js': "import { createClient } from '@base44/sdk';\nexport const c = createClient({});\n" } });
    criarBaseline(d);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-SDK-IMPORT/);
    assert.match(r.output, /src\/lib\/atalho\.js/);
    cleanup(d);
  });

  test('18. segundo adapter em src/apis/ importando o client legado reprova', () => {
    const d = makeProject({ legados: { 'src/apis/_providers/outroProvider.js': PAGINA_LEGADA('Lote') } });
    criarBaseline(d);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-PROVIDER-LEAK/);
    assert.match(r.output, /outroProvider\.js/);
    cleanup(d);
  });

  for (const [rotulo, corpo] of [
    ['export nomeado', "import { base44 } from '@/api/base44Client';\nexport { base44 };\n"],
    ['export default', "import { base44 } from '@/api/base44Client';\nexport default base44;\n"],
    ['const exportado', "import { base44 } from '@/api/base44Client';\nexport const provider = base44;\n"],
    ['reexport direto', "export { base44 } from '@/api/base44Client';\n"],
    ['alias', "import { base44 } from '@/api/base44Client';\nexport { base44 as provider };\n"],
  ]) {
    test(`19. reexport do provider reprova — ${rotulo}`, () => {
      const d = makeProject({ adapter: corpo });
      criarBaseline(d);
      const r = falhaSemEscrever(d);
      assert.match(r.output, /P11-API-BOUNDARY-PROVIDER-LEAK/);
      assert.match(r.output, /reexportado/);
      cleanup(d);
    });
  }

  test('20. acesso dinâmico a entities dentro da fronteira reprova', () => {
    const d = makeProject({
      adapter: "import { base44 } from '@/api/base44Client';\nexport const get = (nome) => base44.entities[nome];\n",
    });
    criarBaseline(d);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-DYNAMIC-ENTITY/);
    cleanup(d);
  });

  test('21. acesso dinâmico legado novo entra como regressão de eixo', () => {
    const d = makeProject();
    criarBaseline(d);
    writeFile(d, 'src/lib/dinamico.js', "import { base44 } from '@/api/base44Client';\nexport const get = (n) => base44.entities[n];\n");
    const r = falhaSemEscrever(d);
    assert.match(r.output, /dynamicEntityFiles: caminho legado novo — src\/lib\/dinamico\.js/);
    cleanup(d);
  });

  test('22. entidade fora do manifesto de escopo reprova', () => {
    const d = makeProject({ adapter: ADAPTER(['Empresa', 'CustoSafra']), entidadesEscopo: ['Empresa'] });
    criarBaseline(d);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-SCOPE/);
    assert.match(r.output, /CustoSafra/);
    cleanup(d);
  });

  test('23. adapter autorizado ausente reprova', () => {
    const d = makeProject({ adapter: null });
    criarBaseline(d);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /adapter autorizado ausente/);
    cleanup(d);
  });

  test('24. provider explícito com registry literal passa', () => {
    const d = makeProject({ adapter: ADAPTER(['Empresa']) });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /registry do provider: Empresa/);
    cleanup(d);
  });

  test('25. página com import legado reintroduzido reprova', () => {
    const d = makeProject();
    criarBaseline(d);
    writeFile(d, 'src/pages/Empresa.jsx', PAGINA_LEGADA('Empresa'));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-REGRESSION/);
    assert.match(r.output, /src\/pages\/Empresa\.jsx/);
    cleanup(d);
  });
});

describe('gate:api-boundary — enforcement de camada (P1.1-R1)', () => {
  /** Consumidor do provider por caminho arbitrário. */
  const IMPORTA_PROVIDER = (spec = '@/apis/_providers/base44Provider') =>
    `import { empresaProvider } from '${spec}';\nexport const carregar = () => empresaProvider.list('-created_date');\n`;

  for (const [rotulo, caminho] of [
    ['L1 página', 'src/pages/Empresa.jsx'],
    ['L2 componente', 'src/components/empresa/TabelaEmpresas.jsx'],
    ['L3 service', 'src/services/empresaService.js'],
    ['L4 hook', 'src/hooks/useEmpresas.js'],
    ['L5 repository', 'src/core/repositories/empresaRepository.js'],
    ['L5b lib', 'src/lib/atalhoEmpresa.js'],
    ['L5c _core', 'src/apis/_core/atalho.js'],
  ]) {
    test(`${rotulo} importando o provider reprova`, () => {
      const d = makeProject({ legados: { [caminho]: IMPORTA_PROVIDER() } });
      criarBaseline(d);
      const r = falhaSemEscrever(d);
      assert.match(r.output, /P11-API-BOUNDARY-LAYER-BYPASS/);
      assert.ok(r.output.includes(caminho), `esperava o caminho ${caminho} na saída`);
      cleanup(d);
    });
  }

  test('L6 — a API do módulo importando o provider passa', () => {
    const d = makeProject({
      legados: { 'src/apis/empresa/empresaApi.js': IMPORTA_PROVIDER() },
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('L7 — página reexportando o provider reprova', () => {
    const d = makeProject({
      legados: { 'src/pages/Empresa.jsx': "export { empresaProvider } from '@/apis/_providers/base44Provider';\n" },
    });
    criarBaseline(d);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-LAYER-BYPASS/);
    cleanup(d);
  });

  test('L8 — import relativo do provider por página reprova', () => {
    const d = makeProject({
      legados: { 'src/apis/_core/vizinho.js': IMPORTA_PROVIDER('../_providers/base44Provider.js') },
    });
    criarBaseline(d);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-LAYER-BYPASS/);
    cleanup(d);
  });

  test('L9 — import dinâmico do provider por página reprova', () => {
    const d = makeProject({
      legados: {
        'src/pages/Empresa.jsx':
          "export const carregar = async () => (await import('@/apis/_providers/base44Provider')).empresaProvider.list();\n",
      },
    });
    criarBaseline(d);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P11-API-BOUNDARY-LAYER-BYPASS/);
    cleanup(d);
  });
});

describe('gate:api-boundary — carregamento do SDK em qualquer forma (P1.1-R1)', () => {
  for (const [rotulo, corpo] of [
    ['S1 import estático', "import { createClient } from '@base44/sdk';\nexport const c = createClient({});\n"],
    ['S2 export from', "export { createClient } from '@base44/sdk';\n"],
    ['S3 import() sem await', "export const carregar = () => import('@base44/sdk');\n"],
    ['S4 await import()', "export const carregar = async () => { const sdk = await import('@base44/sdk'); return sdk; };\n"],
    ['S5 require()', "const sdk = require('@base44/sdk');\nexport const c = sdk;\n"],
  ]) {
    test(`${rotulo} fora do client oficial reprova`, () => {
      const d = makeProject({ legados: { 'src/lib/atalho.js': corpo } });
      criarBaseline(d);
      const r = falhaSemEscrever(d);
      assert.match(r.output, /P11-API-BOUNDARY-SDK-IMPORT/);
      assert.match(r.output, /src\/lib\/atalho\.js/);
      cleanup(d);
    });
  }

  test('S6 — comentário citando o pacote não reprova', () => {
    const d = makeProject({
      legados: { 'src/lib/nota.js': "// não use @base44/sdk aqui\n/* @base44/sdk */\nexport const a = 1;\n" },
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('S7 — string comum com o nome do pacote não reprova', () => {
    const d = makeProject({
      legados: { 'src/lib/rotulo.js': "export const NOME_DO_PACOTE = '@base44/sdk';\n" },
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('S8 — o client oficial pode carregar o SDK', () => {
    const d = makeProject();
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });
});

describe('gate:api-boundary — origem certificada (P1.1-R1)', () => {
  for (const [rotulo, valor] of [
    ['SHA curto', '508cf62'],
    ['texto arbitrário', 'main-de-teste'],
    ['caractere não hexadecimal', 'z08cf62949530e8a55bd1b4c55a68dd1da2e6b64'],
    ['SHA longo demais', '508cf62949530e8a55bd1b4c55a68dd1da2e6b640'],
  ]) {
    test(`certifiedFromMain inválido reprova — ${rotulo}`, () => {
      const d = makeProject();
      const b = criarBaseline(d);
      gravarBaseline(d, { ...b, certifiedFromMain: valor });
      const r = falhaSemEscrever(d);
      assert.match(r.output, /"certifiedFromMain" precisa ser um SHA de 40 caracteres/);
      cleanup(d);
    });
  }

  test('--update preserva o certifiedFromMain', () => {
    const SHA = 'a'.repeat(40);
    const d = makeProject({
      legados: {
        'src/pages/Antiga.jsx': PAGINA_LEGADA('Lote'),
        'src/pages/Outra.jsx': PAGINA_LEGADA('Lote'),
      },
    });
    criarBaseline(d, { certifiedFromMain: SHA });
    writeFile(d, 'src/pages/Antiga.jsx', 'export const carregar = () => [];\n');

    const r = rodar(d, { args: ['--update'] });
    assert.equal(r.status, 0, r.output);
    assert.equal(lerBaseline(d).certifiedFromMain, SHA);
    cleanup(d);
  });
});

describe('gate:api-boundary — baseline versionado do repositório', () => {
  const oficial = JSON.parse(
    readFileSync(join(REPO_ROOT, 'scripts/gates/api-boundary-baseline.json'), 'utf8')
  );

  test('schema, origem e adapter coerentes', () => {
    assert.equal(oficial.version, 1);
    assert.match(oficial.certifiedFromMain, /^[0-9a-f]{40}$/);
    assert.equal(oficial.allowedProviderAdapter, ALLOWED_PROVIDER_ADAPTER);
  });

  test('o adapter autorizado não é contado como dívida', () => {
    for (const lista of Object.values(oficial.axes)) {
      assert.ok(!lista.includes(ALLOWED_PROVIDER_ADAPTER), 'o adapter não pode estar nas listas legadas');
    }
  });

  test('a página Empresa saiu de todos os eixos legados', () => {
    for (const [eixo, lista] of Object.entries(oficial.axes)) {
      assert.ok(!lista.includes('src/pages/Empresa.jsx'), `Empresa.jsx ainda aparece em ${eixo}`);
    }
  });
});

// ── R2 ────────────────────────────────────────────────────────────────────
// A R1 autorizou `src/apis/<modulo>/**` a importar `_providers`. Isso é
// necessário para a API do módulo funcionar — e abriu duas brechas: o módulo
// podia **reexportar** o provider, e a UI podia importar a API pulando o
// service. Os blocos abaixo fecham as duas.

/** API de módulo legítima: usa o provider, devolve o resultado da chamada. */
const EMPRESA_API = `import { empresaProvider } from '../_providers/base44Provider.js';
export const EMPRESA_DEFAULT_ORDER = '-created_date';
export const listEmpresas = () => empresaProvider.list(EMPRESA_DEFAULT_ORDER);
export const criar = (dados) => empresaProvider.create(dados);
`;

/** Projeto com um módulo `empresa` completo, para exercitar a superfície. */
const comModulo = (arquivos = {}) =>
  makeProject({
    legados: {
      'src/apis/empresa/empresaApi.js': EMPRESA_API,
      'src/apis/empresa/index.js': "export { listEmpresas } from './empresaApi.js';\n",
      ...arquivos,
    },
  });

/** Falha esperada com código específico, baseline intacto. */
const falhaCom = (dir, code) => {
  const r = falhaSemEscrever(dir);
  assert.match(r.output, new RegExp(code), `esperava ${code}:\n${r.output}`);
  return r;
};

describe('gate:api-boundary — R2-B1 provider não vaza pela superfície pública', () => {
  /** Cada caso é um jeito diferente de entregar a referência do provider. */
  const VAZAMENTOS = [
    ['PP1 export from direto', "export { empresaProvider } from '../_providers/base44Provider.js';\n"],
    ['PP2 export *', "export * from '../_providers/base44Provider.js';\n"],
    [
      'PP3 importa e reexporta binding',
      "import { empresaProvider } from '../_providers/base44Provider.js';\nexport { empresaProvider };\n",
    ],
    [
      'PP4 reexporta alias',
      "import { empresaProvider as interno } from '../_providers/base44Provider.js';\nexport { interno as provider };\n",
    ],
    [
      'PP5 export default',
      "import { empresaProvider } from '../_providers/base44Provider.js';\nexport default empresaProvider;\n",
    ],
    [
      'PP6 const igual ao provider',
      "import { empresaProvider } from '../_providers/base44Provider.js';\nexport const provider = empresaProvider;\n",
    ],
    [
      'PP7 objeto contendo o provider',
      "import { empresaProvider } from '../_providers/base44Provider.js';\nexport const provider = { empresaProvider };\n",
    ],
    [
      'PP8 função que devolve o provider',
      "import { empresaProvider } from '../_providers/base44Provider.js';\nexport const getProvider = () => empresaProvider;\n",
    ],
  ];

  for (const [nome, conteudo] of VAZAMENTOS) {
    test(`${nome} reprova`, () => {
      const d = comModulo({ 'src/apis/empresa/index.js': conteudo });
      criarBaseline(d);
      falhaCom(d, 'P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK');
      cleanup(d);
    });
  }

  test('PP9 usar o provider internamente e devolver o resultado passa', () => {
    const d = comModulo();
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('PP10 index reexportando somente símbolos do próprio módulo passa', () => {
    const d = comModulo({
      'src/apis/empresa/index.js':
        "export { listEmpresas, criar, EMPRESA_DEFAULT_ORDER } from './empresaApi.js';\n",
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('função que devolve o provider por bloco também reprova', () => {
    const d = comModulo({
      'src/apis/empresa/index.js':
        "import { empresaProvider } from '../_providers/base44Provider.js';\n" +
        'export function obter() { return empresaProvider; }\n',
    });
    criarBaseline(d);
    falhaCom(d, 'P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK');
    cleanup(d);
  });

  test('o vazamento é detectado mesmo com o import escrito depois do export', () => {
    const d = comModulo({
      'src/apis/empresa/index.js':
        'export { empresaProvider };\n' +
        "import { empresaProvider } from '../_providers/base44Provider.js';\n",
    });
    criarBaseline(d);
    falhaCom(d, 'P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK');
    cleanup(d);
  });
});

describe('gate:api-boundary — R2-B2 a UI passa pelo service', () => {
  const CASOS_UI = [
    ['SC1 página importa a superfície pública', 'src/pages/Empresa.jsx', "import { listEmpresas } from '@/apis/empresa';\nexport default function P() { return listEmpresas(); }\n"],
    ['SC2 página importa o index explícito', 'src/pages/Empresa.jsx', "import { listEmpresas } from '@/apis/empresa/index.js';\nexport default function P() { return listEmpresas(); }\n"],
    ['SC3 página importa a implementação interna', 'src/pages/Empresa.jsx', "import { listEmpresas } from '@/apis/empresa/empresaApi';\nexport default function P() { return listEmpresas(); }\n"],
    ['SC4 componente importa API de módulo', 'src/components/empresa/Tabela.jsx', "import { listEmpresas } from '@/apis/empresa';\nexport const T = () => listEmpresas();\n"],
    ['SC5 hook importa API de módulo', 'src/hooks/useEmpresas.js', "import { listEmpresas } from '@/apis/empresa';\nexport const useEmpresas = () => listEmpresas();\n"],
  ];

  for (const [nome, caminho, conteudo] of CASOS_UI) {
    test(`${nome} reprova`, () => {
      const d = comModulo({ [caminho]: conteudo });
      criarBaseline(d);
      falhaCom(d, 'P11-API-BOUNDARY-SERVICE-BYPASS');
      cleanup(d);
    });
  }

  test('SC6 service importando a superfície pública passa', () => {
    const d = comModulo({
      'src/services/empresaService.js': "import { listEmpresas } from '@/apis/empresa';\nexport const listar = () => listEmpresas();\n",
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('SC7 service importando o index explícito passa — mesma superfície', () => {
    const d = comModulo({
      'src/services/empresaService.js': "import { listEmpresas } from '@/apis/empresa/index.js';\nexport const listar = () => listEmpresas();\n",
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('SC8 service importando empresaApi.js reprova', () => {
    const d = comModulo({
      'src/services/empresaService.js': "import { listEmpresas } from '@/apis/empresa/empresaApi.js';\nexport const listar = () => listEmpresas();\n",
    });
    criarBaseline(d);
    falhaCom(d, 'P11-API-BOUNDARY-MODULE-INTERNAL-BYPASS');
    cleanup(d);
  });

  test('SC9 página importando _core passa — _core não é API de dados', () => {
    const d = comModulo({
      'src/apis/_core/ApiError.js': 'export const getApiErrorMessage = () => "erro";\n',
      'src/pages/Empresa.jsx': "import { getApiErrorMessage } from '@/apis/_core/ApiError';\nexport default function P() { return getApiErrorMessage(); }\n",
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('SC10 página → service → API de módulo passa', () => {
    const d = comModulo({
      'src/services/empresaService.js': "import { listEmpresas } from '@/apis/empresa';\nexport const listar = () => listEmpresas();\n",
      'src/pages/Empresa.jsx': "import * as empresaService from '@/services/empresaService';\nexport default function P() { return empresaService.listar(); }\n",
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('irmão dentro do próprio módulo pode importar implementação', () => {
    const d = comModulo({
      'src/apis/empresa/helpers.js': "import { listEmpresas } from './empresaApi.js';\nexport const l = () => listEmpresas();\n",
    });
    criarBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('a regra vale para módulo futuro sem tocar no gate', () => {
    const d = comModulo({
      'src/apis/lote/loteApi.js': "import { empresaProvider } from '../_providers/base44Provider.js';\nexport const listLotes = () => empresaProvider.list('x');\n",
      'src/apis/lote/index.js': "export { listLotes } from './loteApi.js';\n",
      'src/pages/Lotes.jsx': "import { listLotes } from '@/apis/lote';\nexport default function P() { return listLotes(); }\n",
    });
    criarBaseline(d);
    falhaCom(d, 'P11-API-BOUNDARY-SERVICE-BYPASS');
    cleanup(d);
  });

  test('import dinâmico da API por página também reprova', () => {
    const d = comModulo({
      'src/pages/Empresa.jsx': "export default async function P() { const m = await import('@/apis/empresa'); return m.listEmpresas(); }\n",
    });
    criarBaseline(d);
    falhaCom(d, 'P11-API-BOUNDARY-SERVICE-BYPASS');
    cleanup(d);
  });
});

// ── R3 ────────────────────────────────────────────────────────────────────
// A R2 provou os vazamentos por import estático. Ficaram de fora as outras
// formas de CARREGAR o provider — import(), require(), import equals — e as
// referências a MEMBRO do provider. A propriedade que a R2 declarou absoluta
// ("nenhum símbolo de _providers pode ser exportado, em forma nenhuma") só
// passa a ser verdadeira aqui.

describe('gate:api-boundary — R3 proveniência de carregamento', () => {
  const P = '../_providers/base44Provider.js';

  /** Casos que entregam capacidade: todos reprovam. */
  const VAZAMENTOS = [
    ['PD1  export de import() do provider', `export const getModule = () => import('${P}');\n`],
    ['PD2  await import() devolvendo o provider', `export const getProvider = async () => (await import('${P}')).empresaProvider;\n`],
    ['PD3  export default import()', `export default import('${P}');\n`],
    ['PD4  require() inline devolvendo o provider', `export const getProvider = () => require('${P}').empresaProvider;\n`],
    ['PD5  require() armazenado e reexportado', `const providers = require('${P}');\nexport { providers };\n`],
    ['PD6  desestruturação de require() reexportada', `const { empresaProvider } = require('${P}');\nexport { empresaProvider };\n`],
    ['PD7  namespace import devolvendo membro', `import * as providers from '${P}';\nexport const getProvider = () => providers.empresaProvider;\n`],
    ['PD8  referência crua de método', `import { empresaProvider } from '${P}';\nexport const createRaw = empresaProvider.create;\n`],
    ['PD9  objeto com referência de método', `import { empresaProvider } from '${P}';\nexport const operations = { create: empresaProvider.create };\n`],
    ['PD16 alias local do provider', `import { empresaProvider } from '${P}';\nconst raw = empresaProvider;\nexport const getProvider = () => raw;\n`],
    ['extra namespace dentro de objeto', `import * as providers from '${P}';\nexport const bag = { empresa: providers.empresaProvider };\n`],
    ['extra export default de membro do namespace', `import * as providers from '${P}';\nexport default providers.empresaProvider;\n`],
    ['extra função que devolve o método', `import { empresaProvider } from '${P}';\nexport const getCreate = () => empresaProvider.create;\n`],
    ['extra spread do provider', `import { empresaProvider } from '${P}';\nexport const tudo = { ...empresaProvider };\n`],
  ];

  for (const [nome, conteudo] of VAZAMENTOS) {
    test(`${nome} reprova`, () => {
      const d = comModulo({ 'src/apis/empresa/index.js': conteudo });
      criarBaseline(d);
      const r = falhaCom(d, 'P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK');
      assert.match(r.output, /src\/apis\/empresa\/index\.js/, `a saída precisa citar o arquivo:\n${r.output}`);
      cleanup(d);
    });
  }

  /** Casos que devolvem o RESULTADO da operação: todos passam. */
  const LEGITIMOS = [
    ['PD12 chamada estática do provider', `import { empresaProvider } from '${P}';\nexport const createEmpresa = (dados) => empresaProvider.create(dados);\n`],
    ['PD13 await import() seguido de chamada', `export const createEmpresa = async (dados) => (await import('${P}')).empresaProvider.create(dados);\n`],
    ['PD14 require() seguido de chamada', `export const createEmpresa = (dados) => require('${P}').empresaProvider.create(dados);\n`],
    ['PD15 namespace seguido de chamada', `import * as providers from '${P}';\nexport const listEmpresas = () => providers.empresaProvider.list('-created_date');\n`],
  ];

  for (const [nome, conteudo] of LEGITIMOS) {
    test(`${nome} passa`, () => {
      const d = comModulo({ 'src/apis/empresa/index.js': conteudo });
      criarBaseline(d);
      const r = rodar(d);
      assert.equal(r.status, 0, r.output);
      cleanup(d);
    });
  }
});

describe('gate:api-boundary — R3 parser por extensão', () => {
  const P = '../_providers/base44Provider.js';

  test('PD10 import equals reexportado em .ts reprova', () => {
    const d = comModulo({
      'src/apis/empresa/index.ts': `import providers = require('${P}');\nexport { providers };\n`,
    });
    criarBaseline(d);
    const r = falhaCom(d, 'P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK');
    assert.match(r.output, /index\.ts/, r.output);
    cleanup(d);
  });

  test('PD11 import equals devolvendo membro em .ts reprova', () => {
    const d = comModulo({
      'src/apis/empresa/index.ts': `import providers = require('${P}');\nexport const getProvider = () => providers.empresaProvider;\n`,
    });
    criarBaseline(d);
    falhaCom(d, 'P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK');
    cleanup(d);
  });

  test('a mesma sintaxe em .tsx também reprova', () => {
    const d = comModulo({
      'src/apis/empresa/index.tsx': `import providers = require('${P}');\nexport { providers };\n`,
    });
    criarBaseline(d);
    falhaCom(d, 'P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK');
    cleanup(d);
  });

  test('scriptKindOf mapeia cada extensão para o ScriptKind real', () => {
    const esperado = {
      'a.js': ts.ScriptKind.JS,
      'a.jsx': ts.ScriptKind.JSX,
      'a.mjs': ts.ScriptKind.JS,
      'a.cjs': ts.ScriptKind.JS,
      'a.ts': ts.ScriptKind.TS,
      'a.tsx': ts.ScriptKind.TSX,
      'a.mts': ts.ScriptKind.TS,
      'a.cts': ts.ScriptKind.TS,
    };
    for (const [arquivo, kind] of Object.entries(esperado)) {
      assert.equal(scriptKindOf(arquivo), kind, `extensão de ${arquivo}`);
    }
  });

  test('import equals também é detectado em .js — o parser do TS é tolerante', () => {
    // Medido, não suposto: `ts.createSourceFile` produz ImportEqualsDeclaration
    // mesmo sob ScriptKind.JS. Logo o que faltava para PD10/PD11 não era o
    // ScriptKind — era registrar o binding desse nó, que a R2 não fazia.
    const fato = analyzeFile("import providers = require('../_providers/base44Provider.js');\nexport { providers };\n", 'src/apis/empresa/index.js');
    assert.equal(fato.publicProviderLeaks.length, 1);
  });

  test('o ScriptKind correto importa de verdade para JSX em .tsx', () => {
    // Aqui o mapeamento por extensão deixa de ser cosmético: sob ScriptKind.TS
    // o mesmo arquivo .tsx produz erros de parse, e um arquivo que o parser não
    // entende é um arquivo cujas invariantes não são verificadas.
    const jsx = 'const f = () => <div a={1} />;\nexport const g = f;\n';
    const comTs = ts.createSourceFile('x.tsx', jsx, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const comTsx = ts.createSourceFile('x.tsx', jsx, ts.ScriptTarget.Latest, true, scriptKindOf('x.tsx'));

    assert.ok(comTs.parseDiagnostics.length > 0, 'ScriptKind.TS deveria falhar em JSX');
    assert.equal(comTsx.parseDiagnostics.length, 0, 'scriptKindOf deveria escolher TSX');
  });
});

// ── R4 ────────────────────────────────────────────────────────────────────
// A R3 classificava um binding local só quando o initializer era origem
// DIRETA. Contêiner, função e alias de qualquer um dos dois ficavam de fora do
// conjunto, então declarar primeiro e exportar depois driblava a regra que a
// forma `export const … = …` já reprovava. Separar declaração e export não pode
// mudar o resultado do gate.

describe('gate:api-boundary — R4 wrapper local exportado depois', () => {
  const P = "import { empresaProvider } from '../_providers/base44Provider.js';\n";

  /** Cadeia de N aliases em ordem INVERSA — exige uma volta por elo. */
  const cadeiaInversa = (n) =>
    Array.from({ length: n }, (_, i) => i)
      .reverse()
      .map((i) => `const a${i + 1} = ${i === 0 ? 'empresaProvider' : `a${i}`};`)
      .join('\n');

  const VAZAMENTOS = [
    ['LW1  contêiner local + export nomeado', `${P}const bag = { empresaProvider };\nexport { bag };\n`],
    ['LW2  array local + export nomeado', `${P}const bag = [empresaProvider];\nexport { bag };\n`],
    ['LW3  objeto com método + export default', `${P}const bag = { create: empresaProvider.create };\nexport default bag;\n`],
    ['LW4  spread do provider + export com alias', `${P}const bag = { ...empresaProvider };\nexport { bag as providerBag };\n`],
    ['LW5  função local + export nomeado', `${P}const getProvider = () => empresaProvider;\nexport { getProvider };\n`],
    ['LW6  função que devolve método + export default', `${P}const getCreate = () => empresaProvider.create;\nexport default getCreate;\n`],
    ['LW7  FunctionDeclaration local + export', `${P}function getProvider() {\n  return empresaProvider;\n}\nexport { getProvider };\n`],
    ['LW8  alias de contêiner', `${P}const bag = { empresaProvider };\nconst alias = bag;\nexport { alias };\n`],
    ['LW9  alias de função', `${P}const getProvider = () => empresaProvider;\nconst alias = getProvider;\nexport { alias };\n`],
    ['LW10 cadeia de 12 aliases em ordem inversa', `${P}${cadeiaInversa(12)}\nexport { a12 };\n`],
    ['LW11 ternário devolvendo o provider', `${P}export const getProvider = (c) => (c ? empresaProvider : null);\n`],
    ['LW12 return dentro de if', `${P}export function getProvider(c) {\n  if (c) return empresaProvider;\n  return null;\n}\n`],
    ['LW13 .bind() inline exportado', `${P}export const createRaw = empresaProvider.create.bind(empresaProvider);\n`],
    ['LW14 .bind() local + export depois', `${P}const createRaw = empresaProvider.create.bind(empresaProvider);\nexport { createRaw };\n`],
    ['extra curto-circuito &&', `${P}export const getProvider = (c) => c && empresaProvider;\n`],
    ['extra return dentro de switch', `${P}export function getProvider(v) {\n  switch (v) {\n    case 'p':\n      return empresaProvider;\n    default:\n      return null;\n  }\n}\n`],
    ['extra return dentro de try', `${P}export function g() {\n  try {\n    return empresaProvider;\n  } catch (e) {\n    return null;\n  }\n}\n`],
    ['extra alias de .bind()', `${P}const b = empresaProvider.create.bind(empresaProvider);\nconst c = b;\nexport { c };\n`],
  ];

  for (const [nome, conteudo] of VAZAMENTOS) {
    test(`${nome} reprova`, () => {
      const d = comModulo({ 'src/apis/empresa/index.js': conteudo });
      criarBaseline(d);
      const r = falhaCom(d, 'P11-API-BOUNDARY-PUBLIC-PROVIDER-LEAK');
      assert.match(r.output, /src\/apis\/empresa\/index\.js/, `a saída precisa citar o arquivo:\n${r.output}`);
      cleanup(d);
    });
  }

  const LEGITIMOS = [
    ['LW15 chamada da operação + export depois', `${P}const createEmpresa = (dados) => empresaProvider.create(dados);\nexport { createEmpresa };\n`],
    ['LW16 await da operação + export depois', `${P}const listEmpresas = async () => await empresaProvider.list('-created_date');\nexport { listEmpresas };\n`],
    ['LW17 .call() executa a operação', `${P}export const createEmpresa = (d) => empresaProvider.create.call(empresaProvider, d);\n`],
    ['extra .apply() executa a operação', `${P}export const criar = (d) => empresaProvider.create.apply(empresaProvider, [d]);\n`],
    ['extra função interna não devolvida', `${P}export function g() {\n  const interna = () => empresaProvider;\n  return 1;\n}\n`],
    ['extra resultado materializado em contêiner', `${P}export const carregar = async () => ({ itens: await empresaProvider.list('x') });\n`],
  ];

  for (const [nome, conteudo] of LEGITIMOS) {
    test(`${nome} passa`, () => {
      const d = comModulo({ 'src/apis/empresa/index.js': conteudo });
      criarBaseline(d);
      const r = rodar(d);
      assert.equal(r.status, 0, r.output);
      cleanup(d);
    });
  }

  test('declarar-e-exportar tem o mesmo resultado que exportar na declaração', () => {
    // A propriedade que a R4 fecha, escrita como teste: as duas formas do mesmo
    // código precisam produzir a mesma classificação.
    const pares = [
      ['const bag = { empresaProvider };\nexport { bag };\n', 'export const bag = { empresaProvider };\n'],
      ['const f = () => empresaProvider;\nexport { f };\n', 'export const f = () => empresaProvider;\n'],
      ['const c = empresaProvider.create;\nexport { c };\n', 'export const c = empresaProvider.create;\n'],
      ['const ok = (d) => empresaProvider.create(d);\nexport { ok };\n', 'export const ok = (d) => empresaProvider.create(d);\n'],
    ];
    for (const [separado, junto] of pares) {
      const a = analyzeFile(P + separado, 'src/apis/empresa/index.js').publicProviderLeaks.length > 0;
      const b = analyzeFile(P + junto, 'src/apis/empresa/index.js').publicProviderLeaks.length > 0;
      assert.equal(a, b, `separado=${a} junto=${b} para:\n${separado}`);
    }
  });

  test('o ponto fixo não tem limite silencioso — cadeia de 40 elos invertida', () => {
    const fato = analyzeFile(`${P}${cadeiaInversa(40)}\nexport { a40 };\n`, 'src/apis/empresa/index.js');
    assert.equal(fato.publicProviderLeaks.length, 1, 'cadeia longa precisa ser classificada por inteiro');
  });
});

describe('gate:api-boundary — R4 LW18 consistência do parser', () => {
  const P = "import { empresaProvider } from '../_providers/base44Provider.js';\n";

  test('scriptKindOf mapeia as oito extensões', () => {
    const esperado = {
      'a.js': ts.ScriptKind.JS,
      'a.jsx': ts.ScriptKind.JSX,
      'a.mjs': ts.ScriptKind.JS,
      'a.cjs': ts.ScriptKind.JS,
      'a.ts': ts.ScriptKind.TS,
      'a.tsx': ts.ScriptKind.TSX,
      'a.mts': ts.ScriptKind.TS,
      'a.cts': ts.ScriptKind.TS,
    };
    for (const [arquivo, kind] of Object.entries(esperado)) {
      assert.equal(scriptKindOf(arquivo), kind, `extensão de ${arquivo}`);
    }
  });

  test('a razão real do mapeamento: TS quebra JSX, TSX não', () => {
    const jsx = 'const f = () => <div a={1} />;\nexport const g = f;\n';
    const comTs = ts.createSourceFile('x.tsx', jsx, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const comTsx = ts.createSourceFile('x.tsx', jsx, ts.ScriptTarget.Latest, true, scriptKindOf('x.tsx'));
    assert.ok(comTs.parseDiagnostics.length > 0);
    assert.equal(comTsx.parseDiagnostics.length, 0);
  });

  test('o parser produz ImportEqualsDeclaration em .js e em .ts — a tolerância é real', () => {
    // Este é o comportamento que o comentário de scriptKindOf afirma. Se um dia
    // o TypeScript deixar de ser tolerante, este teste falha e o comentário
    // precisa mudar junto — em vez de virar folclore.
    const src = "import providers = require('../_providers/base44Provider.js');\nexport { providers };\n";
    for (const kind of [ts.ScriptKind.JS, ts.ScriptKind.TS]) {
      const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true, kind);
      let achou = false;
      const visitar = (n) => {
        if (ts.isImportEqualsDeclaration(n)) achou = true;
        n.forEachChild(visitar);
      };
      visitar(sf);
      assert.ok(achou, `ImportEqualsDeclaration deveria existir sob ScriptKind ${kind}`);
    }
  });

  test('o binding de ImportEquals continua detectado em .ts e .tsx', () => {
    const src = `import providers = require('../_providers/base44Provider.js');\nexport { providers };\n`;
    for (const arquivo of ['src/apis/empresa/index.ts', 'src/apis/empresa/index.tsx']) {
      assert.equal(analyzeFile(src, arquivo).publicProviderLeaks.length, 1, arquivo);
    }
  });

  test('wrapper local também é detectado em .ts', () => {
    const src = `${P}const bag = { empresaProvider };\nexport { bag };\n`;
    assert.equal(analyzeFile(src, 'src/apis/empresa/index.ts').publicProviderLeaks.length, 1);
  });
});
