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
import { ALLOWED_PROVIDER_ADAPTER, scanBoundary } from '../../gates/lib/api-boundary.mjs';

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
