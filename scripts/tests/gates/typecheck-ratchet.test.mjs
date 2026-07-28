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
} from '../../gates/lib/tsc-diagnostics.mjs';
import { compareMultisets, isCount } from '../../gates/lib/ratchet.mjs';
import {
  canonicalJson,
  parseJsonc,
  patternToRegExp,
  validateCoverage,
  hashConfigChain,
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

const semear = (dir) => {
  const r = rodar(dir, { args: ['--seed'] });
  assert.equal(r.status, 0, `seed falhou: ${r.output}`);
  return r;
};

const lerBaseline = (dir) => JSON.parse(readFileSync(join(dir, BASELINE_REL), 'utf8'));
const gravarBaseline = (dir, dados) =>
  writeFileSync(join(dir, BASELINE_REL), `${JSON.stringify(dados, null, 2)}\n`);

describe('gate:types — execução real do gate', () => {
  test('1. baseline ausente reprova', () => {
    const d = makeTypeProject();
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-BASELINE/);
    assert.match(r.output, /baseline ausente/);
    cleanup(d);
  });

  test('2. baseline com JSON inválido reprova', () => {
    const d = makeTypeProject();
    writeFile(d, BASELINE_REL, '{ isso não é json');
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-BASELINE/);
    assert.match(r.output, /não é JSON válido/);
    cleanup(d);
  });

  test('3. versão de baseline desconhecida reprova', () => {
    const d = makeTypeProject();
    semear(d);
    gravarBaseline(d, { ...lerBaseline(d), version: 99 });
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /versão de baseline desconhecida/);
    cleanup(d);
  });

  test('4. caminho de projeto divergente reprova', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'jsconfig.alternativo.json', configBase());
    const r = rodar(d, { extraEnv: { TYPECHECK_PROJECT: './jsconfig.alternativo.json' } });
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-CONFIG-DRIFT/);
    assert.match(r.output, /projeto divergente/);
    cleanup(d);
  });

  test('5. conteúdo da configuração alterado reprova pelo hash', () => {
    const d = makeTypeProject();
    semear(d);
    // Mantém include/exclude/checkJs: só o hash denuncia a alteração.
    writeFile(d, 'jsconfig.typecheck.json', configBase({ compilerOptions: { strict: false } }));
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-CONFIG-DRIFT/);
    assert.match(r.output, /sha256/);
    cleanup(d);
  });

  test('6. checkJs:false reprova', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'jsconfig.typecheck.json', configBase({ compilerOptions: { checkJs: false } }));
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-CONTRACT/);
    assert.match(r.output, /"checkJs" precisa ser true/);
    cleanup(d);
  });

  test('7. include vazio reprova', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'jsconfig.typecheck.json', configBase({ include: [] }));
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-CONTRACT/);
    assert.match(r.output, /"include" ausente ou vazio/);
    cleanup(d);
  });

  test('8. excluir src/lib reprova', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'jsconfig.typecheck.json', configBase({ exclude: ['node_modules', 'src/lib'] }));
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-CONTRACT/);
    assert.match(r.output, /diretório protegido excluído: src\/lib/);
    cleanup(d);
  });

  test('9. comando divergente reprova', () => {
    const d = makeTypeProject();
    semear(d);
    gravarBaseline(d, { ...lerBaseline(d), effectiveCommand: 'tsc --noEmit' });
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-CONFIG-DRIFT/);
    assert.match(r.output, /comando divergente/);
    cleanup(d);
  });

  test('10. versão do TypeScript divergente reprova', () => {
    const d = makeTypeProject();
    semear(d);
    gravarBaseline(d, { ...lerBaseline(d), typescriptVersion: '0.0.0-inexistente' });
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-VERSION-DRIFT/);
    cleanup(d);
  });

  test('11. fingerprint novo reprova', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'src/services/d.js', "/** @type {string} */\nexport const d = 42;\n");
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-REGRESSION/);
    assert.match(r.output, /diagnóstico novo/);
    cleanup(d);
  });

  test('12. multiplicidade aumentada reprova', () => {
    const d = makeTypeProject();
    semear(d);
    // Mesmo arquivo, mesma mensagem, duas vezes: fingerprint idêntico, x2.
    writeFile(d, 'src/lib/a.js', ERRO('a') + ERRO('a2'));
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-REGRESSION/);
    assert.match(r.output, /multiplicidade aumentou/);
    cleanup(d);
  });

  test('13. arquivo que piora é reportado', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'src/components/ui/c.jsx', LIMPO('c') + ERRO('c2'));
    const r = rodar(d);
    assert.equal(r.status, 1);
    assert.match(r.output, /arquivo piorou: src\/components\/ui\/c\.jsx: 0 -> 1/);
    cleanup(d);
  });

  test('14. somente redução passa', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'src/api/b.js', LIMPO('b'));
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /Progresso: 1 diagnóstico/);
    cleanup(d);
  });

  test('15. execução normal não escreve no baseline', () => {
    const d = makeTypeProject();
    semear(d);
    const antes = readFileSync(join(d, BASELINE_REL), 'utf8');
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.equal(readFileSync(join(d, BASELINE_REL), 'utf8'), antes);
    const temporarios = readdirSync(d).filter((f) => f.includes('.tmp'));
    assert.deepEqual(temporarios, [], 'nenhum arquivo temporário pode sobrar');
    cleanup(d);
  });

  test('16. --update com redução regrava o baseline', () => {
    const d = makeTypeProject();
    semear(d);
    assert.equal(lerBaseline(d).total, 2);
    writeFile(d, 'src/api/b.js', LIMPO('b'));
    const r = rodar(d, { args: ['--update'] });
    assert.equal(r.status, 0, r.output);
    assert.equal(lerBaseline(d).total, 1);
    cleanup(d);
  });

  test('17. --update com regressão é recusado', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'src/services/d.js', ERRO('d'));
    const r = rodar(d, { args: ['--update'] });
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-REGRESSION/);
    assert.equal(lerBaseline(d).total, 2, 'o baseline não pode ter sido regravado');
    cleanup(d);
  });

  test('18. --seed com baseline existente é recusado', () => {
    const d = makeTypeProject();
    semear(d);
    const r = rodar(d, { args: ['--seed'] });
    assert.equal(r.status, 1);
    assert.match(r.output, /--seed recusado/);
    cleanup(d);
  });

  test('19. runner sem diagnóstico parseável reprova como runner', () => {
    const d = makeTypeProject();
    semear(d);
    const runner = writeFile(
      d,
      'runner-quebrado.mjs',
      `if (process.argv.includes('--version')) { console.log('Version ${VERSAO_TS}'); process.exit(0); }\n` +
        `process.stderr.write('falha interna do compilador\\n');\nprocess.exit(1);\n`
    );
    const r = rodar(d, { extraEnv: { TSC_BIN: runner } });
    assert.equal(r.status, 1);
    assert.match(r.output, /P01-TYPE-RUNNER/);
    assert.match(r.output, /falha interna do compilador/);
    cleanup(d);
  });

  test('20. projeto sem nenhum erro passa', () => {
    const d = makeTypeProject({
      arquivos: { 'src/lib/a.js': LIMPO('a'), 'src/api/b.js': LIMPO('b') },
    });
    semear(d);
    assert.equal(lerBaseline(d).total, 0);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /dívida quitada/);
    cleanup(d);
  });

  test('21. deslocar o código não cria diagnóstico novo', () => {
    const d = makeTypeProject();
    semear(d);
    writeFile(d, 'src/lib/a.js', `${'\n'.repeat(40)}// deslocado\n${ERRO('a')}`);
    const r = rodar(d);
    assert.equal(r.status, 0, r.output);
    cleanup(d);
  });

  test('22. --rebase-contract aceita mudança consciente e valida a cobertura', () => {
    const d = makeTypeProject();
    semear(d);
    const shaAntes = lerBaseline(d).projectSha256;

    writeFile(d, 'jsconfig.typecheck.json', configBase({ compilerOptions: { strict: false } }));
    const ok = rodar(d, { args: ['--rebase-contract'] });
    assert.equal(ok.status, 0, ok.output);
    assert.notEqual(lerBaseline(d).projectSha256, shaAntes);

    // Rebasear não é porta de fuga: cobertura reduzida continua reprovando.
    writeFile(d, 'jsconfig.typecheck.json', configBase({ exclude: ['node_modules', 'src/api'] }));
    const recusado = rodar(d, { args: ['--rebase-contract'] });
    assert.equal(recusado.status, 1);
    assert.match(recusado.output, /P01-TYPE-CONTRACT/);
    cleanup(d);
  });
});

describe('contrato de tipos do próprio repositório', () => {
  test('o baseline versionado descreve a configuração real', () => {
    const baseline = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/gates/typecheck-baseline.json'), 'utf8'));
    assert.equal(baseline.projectPath, 'jsconfig.typecheck.json');
    assert.equal(baseline.coverageContract.checkJs, true);
    assert.ok(existsSync(join(REPO_ROOT, 'jsconfig.typecheck.json')));
    for (const dir of ['src/components/ui', 'src/api', 'src/lib', 'src/services']) {
      assert.ok(baseline.coverageContract.protectedDirs.includes(dir));
    }
  });
});
