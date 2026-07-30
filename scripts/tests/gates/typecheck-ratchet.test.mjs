/**
 * Testes da catraca de tipos.
 *
 * A primeira parte cobre o parser e o multiconjunto. A segunda executa o **gate
 * real** (`gate-typecheck-ratchet.mjs`) em projetos temporários, com `tsc` de
 * verdade — sem isso a catraca ficaria "testada" sem nunca ter rodado.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseDiagnostics,
  toFingerprintCounts,
  toFileCounts,
  normalizeMessage,
  runTypecheck,
  tscCommand,
} from '../../gates/lib/tsc-diagnostics.mjs';
import { compareMultisets, isCount } from '../../gates/lib/ratchet.mjs';
import {
  canonicalJson,
  parseJsonc,
  patternToRegExp,
  validateCoverage,
  hashConfigChain,
  buildTypeContract,
} from '../../gates/lib/type-config.mjs';
import { makeTempDir, cleanup, writeFile, runGate, REPO_ROOT } from './helpers.mjs';

const SAIDA = [
  "src/a.jsx(10,5): error TS2322: Type 'x' is not assignable to type 'y'.",
  "  Property 'children' does not exist.",
  "src/a.jsx(40,9): error TS2322: Type 'x' is not assignable to type 'y'.",
  "  Property 'children' does not exist.",
  "src/b.js(3,1): error TS2339: Property 'foo' does not exist on type 'never'.",
].join('\n');

describe('diagnósticos do TypeScript', () => {
  test('parseia diagnósticos e dobra linhas de continuação', () => {
    const d = parseDiagnostics(SAIDA);
    assert.equal(d.length, 3);
    assert.equal(d[0].file, 'src/a.jsx');
    assert.equal(d[0].code, 'TS2322');
    assert.match(d[0].message, /Property 'children' does not exist/);
  });

  test('fingerprint ignora linha e coluna', () => {
    const d = parseDiagnostics(SAIDA);
    assert.equal(d[0].fingerprint, d[1].fingerprint, 'mesmo erro em linhas diferentes = mesmo fingerprint');
    assert.notEqual(d[0].fingerprint, d[2].fingerprint);
  });

  test('preserva a multiplicidade', () => {
    const counts = toFingerprintCounts(parseDiagnostics(SAIDA));
    const [chaveRepetida] = Object.entries(counts).find(([, n]) => n === 2);
    assert.ok(chaveRepetida.startsWith('src/a.jsx|TS2322|'));
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 3);
  });

  test('conta por arquivo', () => {
    assert.deepEqual(toFileCounts(parseDiagnostics(SAIDA)), { 'src/a.jsx': 2, 'src/b.js': 1 });
  });

  test('normaliza espaço em branco na mensagem', () => {
    assert.equal(normalizeMessage('  a   b \r\n c '), 'a b c');
  });

  test('linha inesperada não vira diagnóstico', () => {
    assert.deepEqual(parseDiagnostics('Version 5.8.2\nFound 0 errors.'), []);
  });
});

describe('comparação de multiconjuntos', () => {
  test('detecta fingerprint novo', () => {
    const { novos } = compareMultisets({ a: 1 }, { a: 1, b: 1 });
    assert.deepEqual(novos, ['b (x1)']);
  });

  test('detecta multiplicidade aumentada', () => {
    const { aumentos, novos } = compareMultisets({ a: 1 }, { a: 3 });
    assert.deepEqual(novos, []);
    assert.deepEqual(aumentos, ['a: 1 -> 3']);
  });

  test('somente redução não é regressão', () => {
    const { novos, aumentos, reducoes } = compareMultisets({ a: 3, b: 1 }, { a: 1 });
    assert.deepEqual(novos, []);
    assert.deepEqual(aumentos, []);
    assert.deepEqual(reducoes.sort(), ['a: 3 -> 1', 'b: 1 -> 0']);
  });

  test('isCount rejeita valores inválidos', () => {
    assert.equal(isCount(0), true);
    assert.equal(isCount(-1), false);
    assert.equal(isCount(1.5), false);
    assert.equal(isCount('2'), false);
  });
});

describe('contrato de configuração de tipos', () => {
  test('JSONC com comentários e vírgula final é aceito', () => {
    const dados = parseJsonc('{\n // c\n "a": 1, /* b */\n "l": [1,2,],\n}');
    assert.deepEqual(dados, { a: 1, l: [1, 2] });
  });

  test('comentário dentro de string é preservado', () => {
    assert.deepEqual(parseJsonc('{"a": "http://x//y"}'), { a: 'http://x//y' });
  });

  test('canonicalização independe da ordem das chaves', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
  });

  test('hash muda quando o conteúdo muda', () => {
    const um = hashConfigChain([{ path: 'j.json', canonical: '{"a":1}' }]);
    const dois = hashConfigChain([{ path: 'j.json', canonical: '{"a":2}' }]);
    assert.notEqual(um, dois);
    assert.equal(um, hashConfigChain([{ path: 'j.json', canonical: '{"a":1}' }]));
  });

  test('glob no dialeto do TypeScript', () => {
    assert.ok(patternToRegExp('src/**/*.js').test('src/a.js'));
    assert.ok(patternToRegExp('src/**/*.js').test('src/x/y/a.js'));
    assert.ok(!patternToRegExp('src/**/*.js').test('src/a.jsx'));
    assert.ok(patternToRegExp('src/lib').test('src/lib/x/a.js'), 'diretório vira prefixo');
  });

  test('cobertura completa não tem violação', () => {
    const v = validateCoverage({
      compilerOptions: { checkJs: true },
      include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['node_modules', 'dist', 'dist-ssr', 'coverage'],
    });
    assert.deepEqual(v, []);
  });

  test('excluir diretório protegido é violação', () => {
    const v = validateCoverage({
      compilerOptions: { checkJs: true },
      include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['node_modules', 'src/lib'],
    });
    assert.ok(v.some((m) => /diretório protegido excluído: src\/lib/.test(m)), v.join(' | '));
  });
});

// ── Gate ponta a ponta ────────────────────────────────────────────────────

const GATE = 'gate-typecheck-ratchet.mjs';
const PROJETO = './jsconfig.typecheck.json';
const BASELINE_REL = 'baseline.json';

const VERSAO_TS = JSON.parse(
  readFileSync(join(REPO_ROOT, 'node_modules/typescript/package.json'), 'utf8')
).version;

const configBase = (overrides = {}) => ({
  compilerOptions: {
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    target: 'esnext',
    lib: ['esnext'],
    types: [],
    ...(overrides.compilerOptions || {}),
  },
  include:
    overrides.include === undefined
      ? ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx']
      : overrides.include,
  exclude: overrides.exclude === undefined ? ['node_modules', 'dist', 'dist-ssr', 'coverage'] : overrides.exclude,
});

/** Uma atribuição que sempre gera TS2322 com a mesma mensagem. */
const ERRO = (nome) => `/** @type {number} */\nexport const ${nome} = 'texto';\n`;
const LIMPO = (nome) => `export const ${nome} = 1;\n`;

/**
 * Projeto temporário com contrato válido e dois erros de tipo.
 * `arquivos` sobrescreve o conteúdo padrão.
 */
const makeTypeProject = ({ config, arquivos } = {}) => {
  const dir = makeTempDir('maike-types-');
  writeFile(dir, 'jsconfig.typecheck.json', config || configBase());
  const padrao = {
    'src/lib/a.js': ERRO('a'),
    'src/api/b.js': ERRO('b'),
    'src/components/ui/c.jsx': LIMPO('c'),
    'src/services/d.js': LIMPO('d'),
  };
  for (const [rel, conteudo] of Object.entries({ ...padrao, ...(arquivos || {}) })) {
    writeFile(dir, rel, conteudo);
  }
  return dir;
};

const env = (dir, extra = {}) => ({
  TYPECHECK_PROJECT: PROJETO,
  TYPECHECK_BASELINE: BASELINE_REL,
  ...extra,
});

const rodar = (dir, { args = [], extraEnv = {} } = {}) =>
  runGate(GATE, { cwd: dir, args, env: env(dir, extraEnv) });


/**
 * Cria o baseline diretamente, sem passar pelo gate.
 *
 * O gate de produção não semeia mais (P0.1-R3): `--seed` foi removido. Fixture
 * que precisa de baseline monta o arquivo por conta própria.
 */
const criarBaseline = (dir, { certifiedCeiling, patch } = {}) => {
  const run = runTypecheck({ project: PROJETO, cwd: dir });
  assert.equal(run.ok, true, `tsc falhou na fixture: ${run.detail || ''}`);

  const contrato = buildTypeContract({
    project: PROJETO,
    cwd: dir,
    command: tscCommand(PROJETO),
    typescriptVersion: VERSAO_TS,
  });
  assert.equal(contrato.ok, true, contrato.message);

  const total = run.diagnostics.length;
  const baseline = {
    version: 3,
    ...contrato.contract,
    certifiedCeiling: certifiedCeiling ?? total,
    total,
    byFile: toFileCounts(run.diagnostics),
    fingerprints: toFingerprintCounts(run.diagnostics),
    ...(patch || {}),
  };
  gravarBaseline(dir, baseline);
  return baseline;
};

const lerBaseline = (dir) => JSON.parse(readFileSync(join(dir, BASELINE_REL), 'utf8'));
const bytesBaseline = (dir) => readFileSync(join(dir, BASELINE_REL), 'utf8');
const gravarBaseline = (dir, dados) =>
  writeFileSync(join(dir, BASELINE_REL), `${JSON.stringify(dados, null, 2)}\n`);

/** Roda o gate esperando falha e prova que o baseline não foi tocado. */
const falhaSemEscrever = (dir, { args = [], extraEnv = {} } = {}) => {
  const antes = bytesBaseline(dir);
  const r = rodar(dir, { args, extraEnv });
  assert.equal(r.status, 1, `esperava exit 1:\n${r.output}`);
  assert.equal(bytesBaseline(dir), antes, 'o baseline foi alterado numa execução que deveria falhar');
  const temporarios = readdirSync(dir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(temporarios, [], 'nenhum arquivo temporário pode sobrar');
  return r;
};

describe('gate:types — baseline, teto e contrato', () => {
  test('1. baseline ausente reprova e não cria arquivo', () => {
    const d = makeTypeProject();
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-BASELINE-MISSING/);
    assert.equal(existsSync(join(d, BASELINE_REL)), false, 'o gate não pode criar baseline');
    cleanup(d);
  });

  test('2. baseline com JSON inválido reprova', () => {
    const d = makeTypeProject();
    writeFile(d, BASELINE_REL, '{ isso não é json');
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P01-TYPE-BASELINE/);
    assert.match(r.output, /não é JSON válido/);
    cleanup(d);
  });

  test('3. versão de baseline desconhecida reprova', () => {
    const d = makeTypeProject();
    const b = criarBaseline(d);
    gravarBaseline(d, { ...b, version: 99 });
    const r = falhaSemEscrever(d);
    assert.match(r.output, /versão de baseline desconhecida/);
    cleanup(d);
  });

  test('4. caminho de projeto divergente reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'jsconfig.alternativo.json', configBase());
    const r = falhaSemEscrever(d, { extraEnv: { TYPECHECK_PROJECT: './jsconfig.alternativo.json' } });
    assert.match(r.output, /P01-TYPE-CONFIG-DRIFT/);
    assert.match(r.output, /projeto divergente/);
    cleanup(d);
  });

  test('5. conteúdo da configuração alterado reprova pelo hash', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'jsconfig.typecheck.json', configBase({ compilerOptions: { strict: false } }));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P01-TYPE-CONFIG-DRIFT/);
    assert.match(r.output, /sha256/);
    cleanup(d);
  });

  test('6. checkJs:false reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'jsconfig.typecheck.json', configBase({ compilerOptions: { checkJs: false } }));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P01-TYPE-CONTRACT/);
    assert.match(r.output, /"checkJs" precisa ser true/);
    cleanup(d);
  });

  test('7. include vazio reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'jsconfig.typecheck.json', configBase({ include: [] }));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P01-TYPE-CONTRACT/);
    assert.match(r.output, /"include" ausente ou vazio/);
    cleanup(d);
  });

  test('8. excluir src/lib reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'jsconfig.typecheck.json', configBase({ exclude: ['node_modules', 'src/lib'] }));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P01-TYPE-CONTRACT/);
    assert.match(r.output, /diretório protegido excluído: src\/lib/);
    cleanup(d);
  });

  test('9. comando divergente reprova', () => {
    const d = makeTypeProject();
    const b = criarBaseline(d);
    gravarBaseline(d, { ...b, effectiveCommand: 'tsc --noEmit' });
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P01-TYPE-CONFIG-DRIFT/);
    assert.match(r.output, /comando divergente/);
    cleanup(d);
  });

  test('10. versão do TypeScript divergente reprova', () => {
    const d = makeTypeProject();
    const b = criarBaseline(d);
    gravarBaseline(d, { ...b, typescriptVersion: '0.0.0-inexistente' });
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P01-TYPE-VERSION-DRIFT/);
    cleanup(d);
  });

  test('11. fingerprint novo reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'src/services/d.js', "/** @type {string} */\nexport const d = 42;\n");
    const r = falhaSemEscrever(d);
    assert.match(r.output, /P01-TYPE-REGRESSION/);
    assert.match(r.output, /diagnóstico novo/);
    cleanup(d);
  });

  test('12. multiplicidade aumentada reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'src/lib/a.js', ERRO('a') + ERRO('a2'));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /multiplicidade aumentou/);
    cleanup(d);
  });

  test('13. arquivo que piora é reportado', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'src/components/ui/c.jsx', LIMPO('c') + ERRO('c2'));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /arquivo piorou: src\/components\/ui\/c\.jsx: 0 -> 1/);
    cleanup(d);
  });

  test('14. somente redução passa', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'src/api/b.js', LIMPO('b'));
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /Progresso: 1 diagnóstico/);
    cleanup(d);
  });

  test('15. execução normal nunca escreve', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    const antes = bytesBaseline(d);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.equal(bytesBaseline(d), antes);
    assert.deepEqual(readdirSync(d).filter((f) => f.includes('.tmp')), []);
    cleanup(d);
  });

  test('16. --update com redução baixa total e teto', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    assert.equal(lerBaseline(d).total, 2);
    assert.equal(lerBaseline(d).certifiedCeiling, 2);
    writeFile(d, 'src/api/b.js', LIMPO('b'));
    const r = rodar(d, { args: ['--update'] });
    assert.equal(r.status, 0, r.output);
    assert.equal(lerBaseline(d).total, 1);
    assert.equal(lerBaseline(d).certifiedCeiling, 1, 'o teto acompanha a redução');
    cleanup(d);
  });

  test('17. --update com regressão não escreve', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'src/services/d.js', ERRO('d'));
    const r = falhaSemEscrever(d, { args: ['--update'] });
    assert.match(r.output, /P01-TYPE-REGRESSION/);
    assert.equal(lerBaseline(d).total, 2);
    cleanup(d);
  });

  test('18. --update sem redução não escreve', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    const r = falhaSemEscrever(d, { args: ['--update'] });
    assert.match(r.output, /--update exige pelo menos um diagnóstico removido/);
    cleanup(d);
  });

  test('19. --seed foi removido e reprova explicitamente', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    const r = falhaSemEscrever(d, { args: ['--seed'] });
    assert.match(r.output, /P01-TYPE-SEED-FORBIDDEN/);
    assert.match(r.output, /--seed não existe mais/);
    cleanup(d);
  });

  test('20. --seed com baseline ausente também reprova e não cria', () => {
    const d = makeTypeProject();
    const r = rodar(d, { args: ['--seed'] });
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-SEED-FORBIDDEN/);
    assert.equal(existsSync(join(d, BASELINE_REL)), false);
    cleanup(d);
  });

  test('21. runner sem diagnóstico parseável reprova como runner', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    const runner = writeFile(
      d,
      'runner-quebrado.mjs',
      `if (process.argv.includes('--version')) { console.log('Version ${VERSAO_TS}'); process.exit(0); }\n` +
        `process.stderr.write('falha interna do compilador\\n');\nprocess.exit(1);\n`
    );
    const r = falhaSemEscrever(d, { extraEnv: { TSC_BIN: runner } });
    assert.match(r.output, /P01-TYPE-RUNNER/);
    assert.match(r.output, /falha interna do compilador/);
    cleanup(d);
  });

  test('22. projeto sem nenhum erro passa', () => {
    const d = makeTypeProject({
      arquivos: { 'src/lib/a.js': LIMPO('a'), 'src/api/b.js': LIMPO('b') },
    });
    criarBaseline(d);
    assert.equal(lerBaseline(d).total, 0);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /dívida quitada/);
    cleanup(d);
  });

  test('23. deslocar o código não cria diagnóstico novo', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'src/lib/a.js', `${'\n'.repeat(40)}// deslocado\n${ERRO('a')}`);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  // ── certifiedCeiling ────────────────────────────────────────────────────

  test('24. certifiedCeiling ausente reprova', () => {
    const d = makeTypeProject();
    const b = criarBaseline(d);
    delete b.certifiedCeiling;
    gravarBaseline(d, b);
    const r = falhaSemEscrever(d);
    assert.match(r.output, /"certifiedCeiling" ausente ou inválido/);
    cleanup(d);
  });

  for (const [rotulo, valor] of [
    ['negativo', -1],
    ['fracionário', 1.5],
    ['string', '2'],
    ['nulo', null],
  ]) {
    test(`25. certifiedCeiling ${rotulo} reprova`, () => {
      const d = makeTypeProject();
      const b = criarBaseline(d);
      gravarBaseline(d, { ...b, certifiedCeiling: valor });
      const r = falhaSemEscrever(d);
      assert.match(r.output, /"certifiedCeiling" ausente ou inválido/);
      cleanup(d);
    });
  }

  test('26. baseline.total acima do teto reprova', () => {
    const d = makeTypeProject();
    const b = criarBaseline(d);
    gravarBaseline(d, { ...b, certifiedCeiling: b.total - 1 });
    const r = falhaSemEscrever(d);
    assert.match(r.output, /excede "certifiedCeiling"/);
    cleanup(d);
  });

  test('27. total atual acima do teto reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'src/services/d.js', ERRO('d'));
    const r = falhaSemEscrever(d);
    assert.match(r.output, /excede o teto certificado/);
    cleanup(d);
  });
});

describe('gate:types — --rebase-contract não autoriza regressão (D-PROD-17)', () => {
  /** Muda o contrato sem mexer na cobertura nem nos diagnósticos. */
  const mudarContrato = (dir) =>
    writeFile(dir, 'jsconfig.typecheck.json', configBase({ compilerOptions: { strict: false } }));

  test('1. contrato mudou + dívida igual: passa e grava os metadados', () => {
    const d = makeTypeProject();
    const shaAntes = criarBaseline(d).projectSha256;
    mudarContrato(d);
    const r = rodar(d, { args: ['--rebase-contract'] });
    assert.equal(r.status, 0, r.output);
    const depois = lerBaseline(d);
    assert.notEqual(depois.projectSha256, shaAntes);
    assert.equal(depois.total, 2);
    assert.equal(depois.certifiedCeiling, 2);
    cleanup(d);
  });

  test('2. contrato mudou + dívida menor: passa e baixa total e teto', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    mudarContrato(d);
    writeFile(d, 'src/api/b.js', LIMPO('b'));
    const r = rodar(d, { args: ['--rebase-contract'] });
    assert.equal(r.status, 0, r.output);
    assert.equal(lerBaseline(d).total, 1);
    assert.equal(lerBaseline(d).certifiedCeiling, 1);
    cleanup(d);
  });

  test('3. contrato mudou + fingerprint novo: FALHA', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    mudarContrato(d);
    writeFile(d, 'src/services/d.js', "/** @type {string} */\nexport const d = 42;\n");
    const r = falhaSemEscrever(d, { args: ['--rebase-contract'] });
    assert.match(r.output, /P01-TYPE-REGRESSION/);
    assert.match(r.output, /diagnóstico novo/);
    assert.match(r.output, /não autoriza regressão/);
    cleanup(d);
  });

  test('4. contrato mudou + multiplicidade aumentada: FALHA', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    mudarContrato(d);
    writeFile(d, 'src/lib/a.js', ERRO('a') + ERRO('a2'));
    const r = falhaSemEscrever(d, { args: ['--rebase-contract'] });
    assert.match(r.output, /multiplicidade aumentou/);
    cleanup(d);
  });

  test('5. contrato mudou + arquivo pior: FALHA', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    mudarContrato(d);
    writeFile(d, 'src/components/ui/c.jsx', LIMPO('c') + ERRO('c2'));
    const r = falhaSemEscrever(d, { args: ['--rebase-contract'] });
    assert.match(r.output, /arquivo piorou/);
    cleanup(d);
  });

  test('6. contrato mudou + total maior: FALHA', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    mudarContrato(d);
    writeFile(d, 'src/services/d.js', ERRO('d'));
    const r = falhaSemEscrever(d, { args: ['--rebase-contract'] });
    assert.match(r.output, /total aumentou: 2 -> 3/);
    cleanup(d);
  });

  test('7. versão do TypeScript mudou + diagnóstico novo: FALHA', () => {
    const d = makeTypeProject();
    const b = criarBaseline(d);
    gravarBaseline(d, { ...b, typescriptVersion: '0.0.0-anterior' });
    writeFile(d, 'src/services/d.js', "/** @type {string} */\nexport const d = 42;\n");
    const r = falhaSemEscrever(d, { args: ['--rebase-contract'] });
    assert.match(r.output, /P01-TYPE-REGRESSION/);
    assert.doesNotMatch(r.output, /REBASEADO/);
    cleanup(d);
  });

  test('8. regressão com --rebase-contract não altera o baseline', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    const antes = bytesBaseline(d);
    mudarContrato(d);
    writeFile(d, 'src/services/d.js', ERRO('d'));
    rodar(d, { args: ['--rebase-contract'] });
    assert.equal(bytesBaseline(d), antes, 'byte a byte inalterado');
    cleanup(d);
  });

  test('9. --rebase-contract sem mudança de contrato reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    const r = falhaSemEscrever(d, { args: ['--rebase-contract'] });
    assert.match(r.output, /o contrato gravado já é igual ao atual/);
    cleanup(d);
  });

  test('10. --rebase-contract com cobertura inválida reprova', () => {
    const d = makeTypeProject();
    criarBaseline(d);
    writeFile(d, 'jsconfig.typecheck.json', configBase({ exclude: ['node_modules', 'src/api'] }));
    const r = falhaSemEscrever(d, { args: ['--rebase-contract'] });
    assert.match(r.output, /P01-TYPE-CONTRACT/);
    cleanup(d);
  });

  test('11. --rebase-contract nunca aumenta o teto', () => {
    const d = makeTypeProject();
    criarBaseline(d, { certifiedCeiling: 50 });
    mudarContrato(d);
    const r = rodar(d, { args: ['--rebase-contract'] });
    assert.equal(r.status, 0, r.output);
    assert.equal(lerBaseline(d).certifiedCeiling, 2, 'o teto só pode descer');
    cleanup(d);
  });
});

describe('baseline versionado do repositório', () => {
  const oficial = JSON.parse(
    readFileSync(join(REPO_ROOT, 'scripts/gates/typecheck-baseline.json'), 'utf8')
  );

  /** Teto certificado na P0.1-R1, antes da regressão introduzida pela R2. */
  const TETO_R1 = 2803;

  /** Fingerprints que a R2 introduziu no loader do Google Maps. */
  const FINGERPRINTS_R2 = [
    "src/lib/googleMaps.js|TS2339|Property 'gm_authFailure' does not exist on type 'Window & typeof globalThis'.",
    "src/lib/googleMaps.js|TS2339|Property 'google' does not exist on type 'Window & typeof globalThis'.",
  ];

  test('schema, teto e total coerentes', () => {
    assert.equal(oficial.version, 3);
    assert.equal(oficial.projectPath, 'jsconfig.typecheck.json');
    assert.ok(Number.isInteger(oficial.certifiedCeiling) && oficial.certifiedCeiling >= 0);
    assert.ok(oficial.certifiedCeiling <= TETO_R1, `teto ${oficial.certifiedCeiling} acima do certificado na R1`);
    assert.ok(oficial.total <= oficial.certifiedCeiling);
    assert.equal(
      Object.values(oficial.fingerprints).reduce((a, b) => a + b, 0),
      oficial.total
    );
  });

  test('a cobertura obrigatória continua declarada', () => {
    assert.equal(oficial.coverageContract.checkJs, true);
    assert.ok(existsSync(join(REPO_ROOT, 'jsconfig.typecheck.json')));
    for (const dir of ['src/components/ui', 'src/api', 'src/lib', 'src/services']) {
      assert.ok(oficial.coverageContract.protectedDirs.includes(dir));
    }
  });

  test('os diagnósticos introduzidos pela R2 no loader não estão no baseline', () => {
    for (const fp of FINGERPRINTS_R2) {
      assert.equal(oficial.fingerprints[fp], undefined, `fingerprint da R2 ainda presente: ${fp}`);
    }
    assert.ok(
      (oficial.byFile['src/lib/googleMaps.js'] ?? 0) <= 1,
      'src/lib/googleMaps.js precisa ter no máximo 1 diagnóstico'
    );
  });

  test('o conjunto atual é subconjunto do certificado na P0.1-R1', () => {
    // O snapshot certificado é versionado como fixture, não lido do histórico
    // Git: `actions/checkout` usa `fetch-depth: 1`, e um teste de certificação
    // não pode depender da profundidade do clone nem de acesso à rede.
    // Cópia verbatim de 9713c3a:scripts/gates/typecheck-baseline.json —
    // conferível com `git show 9713c3a:scripts/gates/typecheck-baseline.json |
    // diff - scripts/gates/typecheck-baseline.r1-certified.json`.
    const r1 = JSON.parse(
      readFileSync(join(REPO_ROOT, 'scripts/gates/typecheck-baseline.r1-certified.json'), 'utf8')
    );
    assert.equal(r1.version, 1, 'o snapshot da R1 é schema 1');
    assert.equal(r1.total, TETO_R1);

    const novos = Object.keys(oficial.fingerprints).filter((fp) => !(fp in r1.fingerprints));
    assert.deepEqual(novos, [], 'nenhum fingerprint pode ser novo em relação à R1');

    const aumentos = Object.entries(oficial.fingerprints)
      .filter(([fp, n]) => n > (r1.fingerprints[fp] ?? 0))
      .map(([fp, n]) => `${fp}: ${r1.fingerprints[fp]} -> ${n}`);
    assert.deepEqual(aumentos, []);
    assert.ok(oficial.total <= r1.total, `total ${oficial.total} acima do certificado ${r1.total}`);
  });
});
