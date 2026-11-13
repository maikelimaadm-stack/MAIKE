/**
 * CI em dois perfis (MAIKE-CI-INTELIGENTE-PR01).
 *
 * Prova quatro coisas:
 *   1. o classificador só devolve `docs_fast` para PR inteira de Markdown de
 *      documentação, listada de forma completa e consistente (QP-C*, QP-D*);
 *   2. o CLI de verdade, contra uma API HTTP falsa local, escreve o perfil e
 *      nunca imprime o token (QP-E*);
 *   3. o script do job `verify:all`, extraído do próprio workflow e executado
 *      no bash, só passa nas duas combinações válidas (QP-R*);
 *   4. a estrutura do workflow: um único `verify:all`, docs-fast sem
 *      PostgreSQL, full idêntico ao job anterior, sem `paths` (QP-W*); e o
 *      guarda dos documentos lidos por etapas que só rodam no full (QP-G*).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync, execFile } from 'node:child_process';
import { createServer } from 'node:http';

import { REPO_ROOT, makeTempDir, cleanup } from './helpers.mjs';
import {
  classifyChangedFiles,
  classificarArquivo,
  decideQualityProfile,
  listarArquivosDaPr,
  executarCli,
  DOCS_ACOPLADOS,
  DOCS_RAIZ,
  MAX_ARQUIVOS_LISTAVEIS,
} from '../../ci/quality-profile.mjs';

const WORKFLOW = readFileSync(join(REPO_ROOT, '.github/workflows/quality.yml'), 'utf8');
const SHA = 'a'.repeat(40);
const OUTRO_SHA = 'b'.repeat(40);
const TOKEN_FALSO = ['token', 'de', 'teste', 'nao', 'secreto'].join('-');

const arq = (filename, status = 'modified') => ({ filename, status });
/** PR contra a branch padrão (o único caso em que docs_fast é possível). */
const BASE_PADRAO = { baseRef: 'main', defaultBranch: 'main' };
const classificar = (files) => classifyChangedFiles(files, { expectedCount: files.length });

/* ------------------------------------------------------------------------ */
describe('classificador — conjunto de arquivos', () => {
  test('QP-C1 só DECISIONS.md → docs_fast', () => {
    const r = classificar([arq('docs/engineering/DECISIONS.md')]);
    assert.equal(r.mode, 'docs_fast');
    assert.equal(r.reason, 'somente_documentacao');
    assert.equal(r.files_count, 1);
  });

  test('QP-C2 constituição 00 e 07 → docs_fast', () => {
    const r = classificar([arq('docs/constitution/00-CONSTITUICAO.md'), arq('docs/constitution/07-DO-NOT-DO.md')]);
    assert.equal(r.mode, 'docs_fast');
  });

  test('QP-C3 Markdown da raiz permitido e doc novo → docs_fast', () => {
    for (const raiz of DOCS_RAIZ) {
      assert.equal(classificar([arq(raiz), arq('docs/engineering/NOVO.md', 'added')]).mode, 'docs_fast', raiz);
    }
  });

  test('QP-C4 docs + qualquer código ou configuração → full', () => {
    const naoDocs = [
      'backend/src/server.js',
      '.github/workflows/quality.yml',
      'scripts/ci/quality-profile.mjs',
      'scripts/gates/gate-governance-paths.mjs',
      'package.json',
      'package-lock.json',
      'backend/prisma/schema.prisma',
      'backend/prisma/migrations/20260101000000_x/migration.sql',
      'src/pages/MapaGeral.jsx',
      'config/mapa-manejo-scope.json',
      'vercel.json',
      '.nvmrc',
      'docs/engineering/evidencias/log.txt',
      'docs/engineering/dados.json',
      'docs/diagrama.yml',
      'src/assets/icones/README.md',
      'apps/admin/README.md',
      'LEIAME.md',
      'docs/engineering/RELATORIO.MD',
    ];
    for (const caminho of naoDocs) {
      const r = classificar([arq('docs/engineering/DECISIONS.md'), arq(caminho)]);
      assert.equal(r.mode, 'full', caminho);
      assert.match(r.reason, /arquivo_nao_documental/, caminho);
    }
  });

  test('QP-C5 README.md + código → full', () => {
    assert.equal(classificar([arq('README.md'), arq('src/main.jsx')]).mode, 'full');
  });

  test('QP-C6 removido, renomeado, copiado, alterado ou estado desconhecido → full', () => {
    for (const status of ['removed', 'renamed', 'copied', 'changed', 'unchanged', 'weird', undefined, null]) {
      const r = classificar([{ filename: 'docs/engineering/DECISIONS.md', status }]);
      assert.equal(r.mode, 'full', String(status));
      assert.match(r.reason, /^estado_/);
    }
  });

  test('QP-C7 caminho suspeito → full', () => {
    for (const caminho of ['/docs/x.md', 'docs/../src/x.md', 'docs//x.md', 'docs\\x.md', 'docs/./x.md', '', 42, null, 'docs/x.md\0']) {
      assert.equal(classificar([arq(caminho)]).mode, 'full', String(caminho));
    }
  });

  test('QP-C8 lista vazia, inválida, repetida ou com contagem divergente → full', () => {
    assert.equal(classifyChangedFiles([], { expectedCount: 0 }).reason, 'lista_vazia');
    assert.equal(classifyChangedFiles(null, { expectedCount: 0 }).reason, 'lista_invalida');
    assert.equal(classifyChangedFiles([arq('docs/a.md')], { expectedCount: 2 }).reason, 'contagem_divergente');
    assert.equal(classifyChangedFiles([arq('docs/a.md')]).reason, 'contagem_divergente');
    assert.equal(classificar([arq('docs/a.md'), arq('docs/a.md')]).reason, 'arquivo_repetido');
  });

  test('QP-C9 acima de 3.000 arquivos → full', () => {
    const muitos = Array.from({ length: MAX_ARQUIVOS_LISTAVEIS + 1 }, (_, i) => arq(`docs/d${i}.md`));
    assert.equal(classificar(muitos).reason, 'acima_do_limite_listavel');
  });

  test('QP-C10 documento lido por etapa do full → full', () => {
    for (const doc of DOCS_ACOPLADOS) {
      assert.deepEqual(classificarArquivo(arq(doc)), { docs: false, motivo: 'documento_acoplado_a_teste' });
    }
  });
});

/* ------------------------------------------------------------------------ */
describe('classificador — evento e consistência da listagem', () => {
  const listagemOk = (files) => ({ headAntes: SHA, headDepois: SHA, changedFiles: files.length, files, completa: true });

  test('QP-D1 push na main → full, mesmo só com documentação', () => {
    assert.deepEqual(decideQualityProfile({ eventName: 'push', listagem: listagemOk([arq('docs/a.md')]) }), {
      mode: 'full',
      reason: 'push_sempre_full',
      files_count: 0,
    });
  });

  test('QP-D2 evento desconhecido ou ausente → full', () => {
    for (const eventName of ['merge_group', 'workflow_dispatch', 'pull_request_target', '', undefined]) {
      assert.equal(decideQualityProfile({ eventName }).mode, 'full', String(eventName));
    }
  });

  test('QP-D3 PR consistente só com docs → docs_fast', () => {
    const r = decideQualityProfile({ eventName: 'pull_request', ...BASE_PADRAO, eventHeadSha: SHA, listagem: listagemOk([arq('docs/a.md')]) });
    assert.equal(r.mode, 'docs_fast');
  });

  test('QP-D4 HEAD divergente antes ou depois da listagem → full', () => {
    const files = [arq('docs/a.md')];
    for (const listagem of [
      { ...listagemOk(files), headAntes: OUTRO_SHA },
      { ...listagemOk(files), headDepois: OUTRO_SHA },
    ]) {
      assert.equal(decideQualityProfile({ eventName: 'pull_request', ...BASE_PADRAO, eventHeadSha: SHA, listagem }).reason, 'head_divergente');
    }
    assert.equal(
      decideQualityProfile({ eventName: 'pull_request', ...BASE_PADRAO, eventHeadSha: 'curto', listagem: listagemOk(files) }).reason,
      'head_do_evento_invalido'
    );
  });

  test('QP-D6 PR contra branch que não é a padrão → full, mesmo só com docs (troca de base não reroda a CI)', () => {
    const listagem = listagemOk([arq('docs/a.md')]);
    for (const base of [
      { baseRef: 'release', defaultBranch: 'main' },
      { baseRef: 'main', defaultBranch: undefined },
      { baseRef: undefined, defaultBranch: 'main' },
      { baseRef: 'Main', defaultBranch: 'main' },
    ]) {
      const r = decideQualityProfile({ eventName: 'pull_request', ...base, eventHeadSha: SHA, listagem });
      assert.deepEqual(r, { mode: 'full', reason: 'base_nao_padrao', files_count: 0 }, JSON.stringify(base));
    }
  });

  test('QP-D5 falha de API, paginação incompleta, contagem inválida ou acima do limite → full', () => {
    const files = [arq('docs/a.md')];
    const casos = [
      [{ erro: 'http_500' }, 'falha_http_500'],
      [{ erro: 'sem_token' }, 'falha_sem_token'],
      [{ ...listagemOk(files), completa: false }, 'paginacao_incompleta'],
      [{ ...listagemOk(files), changedFiles: -1 }, 'changed_files_invalido'],
      [{ ...listagemOk(files), changedFiles: 2 }, 'contagem_divergente'],
      [{ ...listagemOk(files), changedFiles: MAX_ARQUIVOS_LISTAVEIS + 1 }, 'acima_do_limite_listavel'],
      [undefined, 'sem_listagem'],
    ];
    for (const [listagem, motivo] of casos) {
      const r = decideQualityProfile({ eventName: 'pull_request', ...BASE_PADRAO, eventHeadSha: SHA, listagem });
      assert.equal(r.mode, 'full', motivo);
      assert.equal(r.reason, motivo);
    }
  });
});

/* ------------------------------------------------------------------------ */
/** API falsa em memória para `listarArquivosDaPr`. */
function apiFalsa({ arquivos, head = SHA, headDepois = head, changedFiles = arquivos.length, falharEm = null, paginasCurtas = false }) {
  let chamadasPr = 0;
  const urls = [];
  const fetchImpl = async (url, opcoes) => {
    urls.push(url);
    assert.equal(opcoes.headers.Authorization, `Bearer ${TOKEN_FALSO}`);
    const u = new URL(url);
    if (falharEm && u.pathname.endsWith(falharEm)) return { ok: false, status: 502, json: async () => ({}) };
    if (/\/pulls\/7$/.test(u.pathname)) {
      chamadasPr += 1;
      return { ok: true, status: 200, json: async () => ({ changed_files: changedFiles, head: { sha: chamadasPr === 1 ? head : headDepois } }) };
    }
    if (/\/pulls\/7\/files$/.test(u.pathname)) {
      const pagina = Number(u.searchParams.get('page'));
      const porPagina = Number(u.searchParams.get('per_page'));
      const lote = arquivos.slice((pagina - 1) * porPagina, pagina * porPagina);
      return { ok: true, status: 200, json: async () => (paginasCurtas ? lote.slice(0, 1) : lote) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, urls };
}

const listar = (fetchImpl, extra = {}) =>
  listarArquivosDaPr({ apiUrl: 'https://api.exemplo', repositorio: 'dono/repo', numero: 7, token: TOKEN_FALSO, fetchImpl, ...extra });

describe('consulta paginada ao GitHub', () => {
  test('QP-P1 250 arquivos em 3 páginas → lista completa e docs_fast', async () => {
    const arquivos = Array.from({ length: 250 }, (_, i) => arq(`docs/p${i}.md`));
    const { fetchImpl, urls } = apiFalsa({ arquivos });
    const listagem = await listar(fetchImpl);
    assert.equal(listagem.completa, true);
    assert.equal(listagem.files.length, 250);
    assert.equal(urls.filter((u) => u.includes('/files')).length, 3);
    assert.equal(decideQualityProfile({ eventName: 'pull_request', ...BASE_PADRAO, eventHeadSha: SHA, listagem }).mode, 'docs_fast');
  });

  test('QP-P2 exatamente 200 arquivos: a página vazia seguinte confirma o fim', async () => {
    const arquivos = Array.from({ length: 200 }, (_, i) => arq(`docs/q${i}.md`));
    const { fetchImpl, urls } = apiFalsa({ arquivos });
    const listagem = await listar(fetchImpl);
    assert.equal(listagem.completa, true);
    assert.equal(urls.filter((u) => u.includes('/files')).length, 3);
  });

  test('QP-P3 páginas que não batem com changed_files → full', async () => {
    const arquivos = Array.from({ length: 150 }, (_, i) => arq(`docs/r${i}.md`));
    const { fetchImpl } = apiFalsa({ arquivos, paginasCurtas: true });
    const listagem = await listar(fetchImpl);
    assert.equal(decideQualityProfile({ eventName: 'pull_request', ...BASE_PADRAO, eventHeadSha: SHA, listagem }).reason, 'contagem_divergente');
  });

  test('QP-P4 push no meio da consulta (HEAD muda) → full', async () => {
    const { fetchImpl } = apiFalsa({ arquivos: [arq('docs/a.md')], headDepois: OUTRO_SHA });
    const listagem = await listar(fetchImpl);
    assert.equal(decideQualityProfile({ eventName: 'pull_request', ...BASE_PADRAO, eventHeadSha: SHA, listagem }).reason, 'head_divergente');
  });

  test('QP-P5 falha HTTP na lista de arquivos → full, sem lançar', async () => {
    const { fetchImpl } = apiFalsa({ arquivos: [arq('docs/a.md')], falharEm: '/files' });
    const listagem = await listar(fetchImpl);
    assert.deepEqual(listagem, { erro: 'http_502' });
  });

  test('QP-P6 fetch que lança, sem token, repositório ou número inválido → erro, nunca exceção', async () => {
    const quebrado = async () => {
      throw new Error('rede');
    };
    assert.deepEqual(await listar(quebrado), { erro: 'consulta_falhou' });
    assert.deepEqual(await listar(quebrado, { token: '' }), { erro: 'sem_token' });
    assert.deepEqual(await listar(quebrado, { repositorio: 'dono/repo/../x' }), { erro: 'repositorio_invalido' });
    assert.deepEqual(await listar(quebrado, { numero: 0 }), { erro: 'numero_invalido' });
  });

  test('QP-P7 acima de 3.000 arquivos: nem lista, e decide full', async () => {
    const { fetchImpl, urls } = apiFalsa({ arquivos: [], changedFiles: MAX_ARQUIVOS_LISTAVEIS + 1 });
    const listagem = await listar(fetchImpl);
    assert.equal(urls.filter((u) => u.includes('/files')).length, 0);
    assert.equal(decideQualityProfile({ eventName: 'pull_request', ...BASE_PADRAO, eventHeadSha: SHA, listagem }).reason, 'acima_do_limite_listavel');
  });
});

/* ------------------------------------------------------------------------ */
/** Sobe uma API HTTP local de verdade e roda o CLI como processo separado. */
async function rodarCliComApiLocal({ arquivos, eventName = 'pull_request', semToken = false, baseRef = 'main' }) {
  const dir = makeTempDir('maike-qp-');
  let pedidos = 0;
  const servidor = createServer((req, res) => {
    pedidos += 1;
    const u = new URL(req.url, 'http://local');
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${TOKEN_FALSO}`) {
      res.statusCode = 401;
      return res.end('{}');
    }
    if (u.pathname === '/repos/dono/repo/pulls/7') return res.end(JSON.stringify({ changed_files: arquivos.length, head: { sha: SHA } }));
    if (u.pathname === '/repos/dono/repo/pulls/7/files') {
      const pagina = Number(u.searchParams.get('page'));
      return res.end(JSON.stringify(arquivos.slice((pagina - 1) * 100, pagina * 100)));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = servidor.address().port;
  try {
    const evento = join(dir, 'evento.json');
    writeFileSync(
      evento,
      JSON.stringify({
        repository: { default_branch: 'main' },
        pull_request: { number: 7, head: { sha: SHA }, base: { ref: baseRef }, title: 'docs_fast por favor', labels: [{ name: 'docs_fast' }] },
      })
    );
    const saida = join(dir, 'output.txt');
    const resumo = join(dir, 'summary.md');
    writeFileSync(saida, '');
    writeFileSync(resumo, '');
    const env = {
      PATH: process.env.PATH,
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: evento,
      GITHUB_REPOSITORY: 'dono/repo',
      GITHUB_API_URL: `http://127.0.0.1:${porta}`,
      GITHUB_OUTPUT: saida,
      GITHUB_STEP_SUMMARY: resumo,
      ...(semToken ? {} : { GITHUB_TOKEN: TOKEN_FALSO }),
    };
    const { stdout, stderr, code } = await new Promise((ok) => {
      execFile(process.execPath, [join(REPO_ROOT, 'scripts/ci/quality-profile.mjs')], { env, encoding: 'utf8' }, (erro, out, err) =>
        ok({ stdout: out, stderr: err, code: erro ? erro.code : 0 })
      );
    });
    const output = Object.fromEntries(
      readFileSync(saida, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    );
    return { output, stdout, stderr, code, pedidos, resumo: readFileSync(resumo, 'utf8') };
  } finally {
    servidor.close();
    cleanup(dir);
  }
}

describe('CLI ponta a ponta (API HTTP local, sem push)', () => {
  test('QP-E1 PR só de docs → mode=docs_fast no GITHUB_OUTPUT, token nunca impresso', async () => {
    const r = await rodarCliComApiLocal({ arquivos: [arq('docs/engineering/DECISIONS.md')] });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.output, { mode: 'docs_fast', reason: 'somente_documentacao', files_count: '1' });
    for (const texto of [r.stdout, r.stderr, r.resumo, JSON.stringify(r.output)]) assert.ok(!texto.includes(TOKEN_FALSO));
    assert.match(r.resumo, /docs_fast/);
  });

  test('QP-E2 PR com código → full, mesmo com título e rótulo "docs_fast"', async () => {
    const r = await rodarCliComApiLocal({ arquivos: [arq('docs/a.md'), arq('src/main.jsx')] });
    assert.equal(r.output.mode, 'full');
    assert.match(r.output.reason, /^arquivo_nao_documental:src\/main\.jsx$/);
  });

  test('QP-E3 sem token → full', async () => {
    const r = await rodarCliComApiLocal({ arquivos: [arq('docs/a.md')], semToken: true });
    assert.equal(r.code, 0);
    assert.deepEqual(r.output, { mode: 'full', reason: 'falha_sem_token', files_count: '0' });
  });

  test('QP-E4 push → full sem consultar a API', async () => {
    const r = await rodarCliComApiLocal({ arquivos: [arq('docs/a.md')], eventName: 'push' });
    assert.deepEqual(r.output, { mode: 'full', reason: 'push_sempre_full', files_count: '0' });
  });

  test('QP-E6 PR contra outra branch → full sem consultar a API', async () => {
    const r = await rodarCliComApiLocal({ arquivos: [arq('docs/a.md')], baseRef: 'release' });
    assert.deepEqual(r.output, { mode: 'full', reason: 'base_nao_padrao', files_count: '0' });
    assert.equal(r.pedidos, 0);
  });

  test('QP-E7 nome de arquivo com caracteres de Markdown/quebra não chega cru ao GITHUB_OUTPUT nem ao resumo', async () => {
    const r = await rodarCliComApiLocal({ arquivos: [arq('docs/a.md'), arq('src/a|b`c\nmode=docs_fast.js')] });
    assert.equal(r.output.mode, 'full');
    assert.doesNotMatch(r.output.reason, /[|`\n]/);
    assert.equal(Object.keys(r.output).length, 3);
  });

  test('QP-E5 evento ilegível → full', async () => {
    const r = await executarCli({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: '/caminho/que/nao/existe.json' }, { log: () => {} });
    assert.equal(r.mode, 'full');
    assert.equal(r.reason, 'evento_ilegivel');
  });
});

/* ------------------------------------------------------------------------ */
/** Extrai o script do job `verify:all` entre os marcadores e o executa no bash. */
const SCRIPT_REQUIRED = (() => {
  const linhas = WORKFLOW.split('\n');
  const ini = linhas.findIndex((l) => l.includes('# >>> quality-required-gate'));
  const fim = linhas.findIndex((l) => l.includes('# <<< quality-required-gate'));
  assert.ok(ini >= 0 && fim > ini, 'marcadores do script do verify:all ausentes');
  const recuo = linhas[ini].match(/^\s*/)[0].length;
  return linhas
    .slice(ini, fim + 1)
    .map((l) => l.slice(recuo))
    .join('\n');
})();

function rodarRequired({ classify, mode, docs, full, evento = 'pull_request', baseRef = 'main', padrao = 'main' }) {
  const dir = makeTempDir('maike-qp-req-');
  try {
    const resumo = join(dir, 'summary.md');
    writeFileSync(resumo, '');
    const env = { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: resumo };
    if (classify !== undefined) env.CLASSIFY_RESULT = classify;
    if (mode !== undefined) env.QUALITY_MODE = mode;
    if (docs !== undefined) env.DOCS_FAST_RESULT = docs;
    if (full !== undefined) env.FULL_RESULT = full;
    if (evento !== undefined) env.GITHUB_EVENT_NAME = evento;
    if (baseRef !== undefined) env.GITHUB_BASE_REF = baseRef;
    if (padrao !== undefined) env.QUALITY_DEFAULT_BRANCH = padrao;
    const r = spawnSync('bash', ['-c', SCRIPT_REQUIRED], { env, encoding: 'utf8' });
    return { status: r.status, saida: r.stdout + r.stderr, resumo: readFileSync(resumo, 'utf8') };
  } finally {
    cleanup(dir);
  }
}

describe('check obrigatório verify:all (script real do workflow)', () => {
  test('QP-R1 docs_fast + docs-fast success + full skipped → DOCS_FAST_PASS', () => {
    const r = rodarRequired({ classify: 'success', mode: 'docs_fast', docs: 'success', full: 'skipped' });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /DOCS_FAST_PASS/);
    assert.match(r.resumo, /A suíte completa NÃO rodou/);
  });

  test('QP-R2 full + full success + docs-fast skipped → FULL_PASS (PR ou push)', () => {
    for (const extra of [{}, { evento: 'push', baseRef: '' }]) {
      const r = rodarRequired({ classify: 'success', mode: 'full', docs: 'skipped', full: 'success', ...extra });
      assert.equal(r.status, 0, r.saida);
      assert.match(r.saida, /FULL_PASS/);
    }
  });

  test('QP-R5 docs_fast fora de pull_request contra a branch padrão reprova (defesa em profundidade)', () => {
    const ok = { classify: 'success', mode: 'docs_fast', docs: 'success', full: 'skipped' };
    for (const extra of [
      { evento: 'push' },
      { evento: 'merge_group' },
      { evento: '' },
      { baseRef: 'release' },
      { baseRef: '' },
      { padrao: '' },
    ]) {
      const r = rodarRequired({ ...ok, ...extra });
      assert.notEqual(r.status, 0, JSON.stringify(extra));
      assert.match(r.saida, /verify:all — FAIL/);
    }
  });

  test('QP-R3 toda outra combinação reprova', () => {
    const invalidas = [
      { classify: 'success', mode: 'docs_fast', docs: 'failure', full: 'skipped' },
      { classify: 'success', mode: 'full', docs: 'skipped', full: 'failure' },
      { classify: 'success', mode: 'full', docs: 'skipped', full: 'cancelled' },
      { classify: 'success', mode: 'docs_fast', docs: 'cancelled', full: 'skipped' },
      { classify: 'success', mode: 'docs_fast', docs: 'skipped', full: 'skipped' },
      { classify: 'success', mode: 'full', docs: 'skipped', full: 'skipped' },
      { classify: 'success', mode: 'docs_fast', docs: 'success', full: 'success' },
      { classify: 'success', mode: 'full', docs: 'success', full: 'success' },
      { classify: 'success', mode: 'full', docs: 'success', full: 'skipped' },
      { classify: 'success', mode: 'docs_fast', docs: 'skipped', full: 'success' },
      { classify: 'failure', mode: '', docs: 'skipped', full: 'skipped' },
      { classify: 'cancelled', mode: 'full', docs: 'skipped', full: 'success' },
      { classify: 'failure', mode: 'docs_fast', docs: 'success', full: 'skipped' },
      { classify: 'success', mode: 'outro', docs: 'skipped', full: 'skipped' },
      { classify: 'success', mode: 'FULL', docs: 'skipped', full: 'success' },
      { classify: 'success', mode: '', docs: 'skipped', full: 'skipped' },
      {},
      { classify: 'success', mode: 'full', full: 'success' },
    ];
    for (const caso of invalidas) {
      const r = rodarRequired(caso);
      assert.notEqual(r.status, 0, `deveria reprovar: ${JSON.stringify(caso)}`);
      assert.match(r.saida, /verify:all — FAIL/);
    }
  });

  test('QP-R4 o script não interpola expressões do GitHub (só lê variáveis de ambiente)', () => {
    assert.doesNotMatch(SCRIPT_REQUIRED, /\$\{\{/);
  });
});

/* ------------------------------------------------------------------------ */
/** Remove comentários de linha YAML (o `#` em texto de `echo` é irrelevante aqui). */
const semComentarios = (texto) =>
  texto
    .split('\n')
    .map((l) => (l.trimStart().startsWith('#') ? '' : l))
    .join('\n');

/** Bloco de um job de `jobs:`, da linha `  <id>:` até o próximo job ou chave de topo. */
function blocoDoJob(id) {
  const linhas = WORKFLOW.split('\n');
  const ini = linhas.indexOf(`  ${id}:`);
  assert.ok(ini >= 0, `job ${id} ausente`);
  let fim = linhas.length;
  for (let i = ini + 1; i < linhas.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(linhas[i]) || /^\S/.test(linhas[i])) {
      fim = i;
      break;
    }
  }
  return semComentarios(linhas.slice(ini, fim).join('\n'));
}

const blocoDeTopo = (chave) => {
  const linhas = WORKFLOW.split('\n');
  const ini = linhas.indexOf(`${chave}:`);
  assert.ok(ini >= 0, `chave ${chave} ausente`);
  const fim = linhas.findIndex((l, i) => i > ini && /^\S/.test(l));
  return semComentarios(linhas.slice(ini, fim === -1 ? undefined : fim).join('\n'));
};

const comandosNpm = (bloco) => [...bloco.matchAll(/^\s*run:\s*npm run ([\w:-]+)\s*$/gm)].map((m) => m[1]);

describe('estrutura do workflow quality', () => {
  test('QP-W1 há exatamente um job com o nome verify:all, e ele é o agregador', () => {
    const nomes = [...semComentarios(WORKFLOW).matchAll(/^ {4}name:\s*(.+?)\s*$/gm)].map((m) => m[1]);
    assert.deepEqual(nomes.sort(), ['classify', 'verify:all', 'verify:docs-fast', 'verify:full (${{ matrix.parte }})'].sort());
    const required = blocoDoJob('required');
    assert.match(required, /^ {4}name: verify:all$/m);
    assert.match(required, /^ {4}needs: \[classify, docs-fast, full\]$/m);
    assert.match(required, /^ {4}if: \$\{\{ always\(\) \}\}$/m);
    assert.doesNotMatch(required, /continue-on-error/);
  });

  test('QP-W2 gatilho sem paths/paths-ignore, sem pull_request_target, push só na main', () => {
    const on = blocoDeTopo('on');
    assert.match(on, /^ {2}pull_request:\s*$/m);
    assert.match(on, /^ {2}push:\s*\n {4}branches: \[main\]\s*$/m);
    assert.doesNotMatch(semComentarios(WORKFLOW), /paths(-ignore)?\s*:/);
    assert.doesNotMatch(semComentarios(WORKFLOW), /pull_request_target/);
  });

  test('QP-W3 permissões mínimas, nunca escrita; concorrência preservada', () => {
    const tudo = semComentarios(WORKFLOW);
    assert.doesNotMatch(tudo, /:\s*write\b/);
    assert.match(blocoDeTopo('permissions'), /^ {2}contents: read$/m);
    assert.match(blocoDoJob('classify'), /^ {6}contents: read\n {6}pull-requests: read$/m);
    assert.match(blocoDeTopo('concurrency'), /group: quality-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true/);
  });

  test('QP-W4 docs-fast: sem PostgreSQL, sem banco, sem suíte completa; roda os gates de documentação', () => {
    const docs = blocoDoJob('docs-fast');
    assert.match(docs, /^ {4}if: \$\{\{ needs\.classify\.outputs\.mode == 'docs_fast' \}\}$/m);
    assert.doesNotMatch(docs, /services:|postgres|DATABASE_URL|AUTH_SECRET|pg_isready|NODE_ENV\s*:|continue-on-error/i);
    assert.match(docs, /run: npm ci$/m);
    assert.deepEqual(comandosNpm(docs), [
      'gate:governance-paths',
      'gate:package-sync',
      'gate:product-scope',
      'gate:no-secrets',
      'gate:deploy-migrations',
      'test:gates',
    ]);
  });

  test('QP-W5 full preserva o ambiente do job anterior: PostgreSQL 16.13, env, alias, npm ci', () => {
    const full = blocoDoJob('full');
    assert.match(full, /^ {4}name: verify:full \(\$\{\{ matrix\.parte \}\}\)$/m);
    assert.match(full, /^ {4}if: \$\{\{ needs\.classify\.outputs\.mode == 'full' \}\}$/m);
    assert.match(full, /^ {4}timeout-minutes: 30$/m);
    assert.match(full, /services:\n {6}postgres:\n {8}image: postgres:16\.13-alpine/);
    assert.match(full, /DATABASE_URL: postgresql:\/\/maike_ci:maike_ci@localhost:5432\/maike_ci/);
    assert.match(full, /AUTH_SECRET: ci-only-ephemeral-signing-key/);
    assert.match(full, /FRONTEND_ORIGINS: http:\/\/localhost:5173/);
    assert.match(full, /pg_isready -h localhost -p 5432 -U maike_ci -d maike_ci/);
    assert.match(full, /127\.0\.0\.1 maike-alvo-teste/);
    assert.match(full, /run: npm ci$/m);
    assert.match(full, /^ {8}run: \$\{\{ matrix\.comando \}\}$/m);
    assert.doesNotMatch(full, /continue-on-error/);
  });

  test('QP-W7 a matriz do full cobre o verify:all inteiro, sem sobra nem falta', () => {
    const full = blocoDoJob('full');
    assert.match(full, /^ {6}fail-fast: false$/m);
    const partes = [...full.matchAll(/- parte: (.+)\n\s+comando: (.+)/g)].map((m) => ({ parte: m[1].trim(), comando: m[2].trim() }));
    const comandos = partes.map((p) => p.comando);

    // 1. Exatamente um job estático, que pula só o que os shards cobrem.
    const estaticos = comandos.filter((c) => c.startsWith('node scripts/gates/verify-all.mjs'));
    assert.deepEqual(estaticos, ['node scripts/gates/verify-all.mjs --pular=test:backend,test:smoke']);

    // 2. As etapas puladas existem no verify:all (senão o próprio script recusa).
    const verifyAll = readFileSync(join(REPO_ROOT, 'scripts/gates/verify-all.mjs'), 'utf8');
    for (const etapa of ['test:backend', 'test:smoke']) assert.match(verifyAll, new RegExp(`\\['${etapa}', npm\\('${etapa}'\\)\\]`));

    // 3. Shards de backend: 1/n..n/n, todos presentes, sem repetição.
    const backend = comandos.map((c) => /^TEST_BACKEND_SHARD=(\d+)\/(\d+) npm run test:backend$/.exec(c)).filter(Boolean);
    const nB = Number(backend[0][2]);
    assert.ok(backend.every((m) => Number(m[2]) === nB));
    assert.deepEqual(backend.map((m) => Number(m[1])).sort((a, b) => a - b), Array.from({ length: nB }, (_, i) => i + 1));

    // 4. Shards do Vitest: 1/m..m/m.
    const smoke = comandos.map((c) => /^npm run test:smoke -- --shard=(\d+)\/(\d+)$/.exec(c)).filter(Boolean);
    const nS = Number(smoke[0][2]);
    assert.ok(smoke.every((m) => Number(m[2]) === nS));
    assert.deepEqual(smoke.map((m) => Number(m[1])).sort((a, b) => a - b), Array.from({ length: nS }, (_, i) => i + 1));

    // 5. Nada além disso na matriz.
    assert.equal(comandos.length, 1 + nB + nS, `comando inesperado na matriz: ${comandos.join(' | ')}`);
    assert.equal(new Set(partes.map((p) => p.parte)).size, partes.length, 'nomes de parte repetidos');
  });

  test('QP-W6 classify usa o classificador do commit base, sem credencial persistida, e cai para full sem ele', () => {
    const c = blocoDoJob('classify');
    assert.match(c, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/);
    assert.match(c, /persist-credentials: false/);
    assert.match(c, /node scripts\/ci\/quality-profile\.mjs/);
    assert.match(c, /echo "mode=full"/);
    assert.match(c, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  });
});

/* ------------------------------------------------------------------------ */
/**
 * Fora da varredura: arquivos que o docs-fast executa (o que eles leem já é
 * exercitado lá) e roteiros que nenhuma etapa executa. Todo o resto do código
 * só roda no full.
 */
const EXECUTADOS_NO_DOCS_FAST = [
  'scripts/gates/gate-governance-paths.mjs',
  'scripts/gates/gate-package-sync.mjs',
  'scripts/gates/gate-product-scope.mjs',
  'scripts/gates/gate-no-hardcoded-secrets.mjs',
  'scripts/gates/gate-deploy-migrations.mjs',
  'scripts/tests/gates/',
  'scripts/tests/deploy/',
  'scripts/ci/',
  // Roteiros manuais do Playwright: nenhum script do package.json, do
  // verify:all ou do Vitest (include: tests/smoke) os executa. Só GRAVAM
  // evidências em docs/engineering/evidencias/.
  'tests/e2e/',
];

const DIRETORIOS_DE_CODIGO = ['src', 'apps', 'backend', 'tests', 'scripts', 'api'];
const IGNORADOS = new Set(['node_modules', 'dist', '.git', 'coverage']);

function arquivosDeCodigo(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const nome of readdirSync(dir)) {
    if (IGNORADOS.has(nome)) continue;
    const abs = join(dir, nome);
    if (statSync(abs).isDirectory()) arquivosDeCodigo(abs, acc);
    else if (/\.(c|m)?jsx?$|\.tsx?$/.test(nome)) acc.push(abs);
  }
  return acc;
}

const elegivelAoDocsFast = (caminho) => DOCS_RAIZ.includes(caminho) || /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(caminho);

/**
 * Normaliza um trecho de caminho achado no código: tira `${…}/`, `./` e `../`
 * do começo, e corta tudo antes de um `docs/` interno. Assim
 * `${ROOT}/docs/x.md`, `../../docs/x.md` e `../../CLAUDE.md` viram o caminho do repositório.
 */
function normalizarCaminho(bruto) {
  let c = bruto.replace(/^(?:\$\{[^}]*\}\/|\.\.?\/)+/, '');
  const i = c.search(/(?:^|\/)docs\//);
  if (i > 0) c = c.slice(i + 1);
  return c;
}

/**
 * Literais de string da linha (aspas simples, duplas ou crase) que podem ser um
 * caminho: sem espaço. Prosa de mensagem ("Ver docs/…/GATE-REGISTRY.md.") cita
 * um documento, não o lê.
 */
const literais = (linha) =>
  [...linha.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2]).filter((l) => /^\S+$/.test(l));

describe('documentos lidos por etapas que só rodam no full', () => {
  test('QP-G1 todo Markdown de documentação citado como literal fora do docs-fast está em DOCS_ACOPLADOS', () => {
    const achados = new Map();
    const diretoriosDocs = [];
    for (const raiz of DIRETORIOS_DE_CODIGO) {
      for (const abs of arquivosDeCodigo(join(REPO_ROOT, raiz))) {
        const rel = relative(REPO_ROOT, abs).split('\\').join('/');
        if (EXECUTADOS_NO_DOCS_FAST.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p))) continue;
        readFileSync(abs, 'utf8')
          .split('\n')
          .forEach((linha, i) => {
            const t = linha.trimStart();
            if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
            for (const literal of literais(linha)) {
              for (const m of literal.matchAll(/[^\s'"`,()]+\.md\b/g)) {
                const caminho = normalizarCaminho(m[0]);
                if (elegivelAoDocsFast(caminho)) achados.set(caminho, `${rel}:${i + 1}`);
              }
              // Diretório de docs (montagem dinâmica: join(ROOT, 'docs', …), readdirSync('docs/x')).
              const sem = normalizarCaminho(literal.trim());
              if (/^docs(?:\/[^\s.]*)?\/?$/.test(sem)) diretoriosDocs.push(`${rel}:${i + 1}`);
            }
          });
      }
    }
    const fora = [...achados].filter(([doc]) => !DOCS_ACOPLADOS.includes(doc));
    assert.deepEqual(fora, [], 'documento lido por etapa do full precisa entrar em DOCS_ACOPLADOS (scripts/ci/quality-profile.mjs)');
    assert.deepEqual(diretoriosDocs, [], 'leitura dinâmica de docs/ fora do docs-fast: o docs_fast não a exercitaria');
  });

  test('QP-G3 o detector reconhece as formas comuns de caminho (sem falso negativo conhecido)', () => {
    const casos = [
      ['new URL("../../docs/engineering/X.md", import.meta.url)', 'docs/engineering/X.md'],
      ['`${ROOT}/docs/engineering/X.md`', 'docs/engineering/X.md'],
      ['"./README.md"', 'README.md'],
      ['path.resolve(__dirname, "../../CLAUDE.md")', 'CLAUDE.md'],
      ["readFileSync('docs/a/b.md', 'utf8')", 'docs/a/b.md'],
    ];
    for (const [linha, esperado] of casos) {
      const achados = literais(linha).flatMap((l) => [...l.matchAll(/[^\s'"`,()]+\.md\b/g)].map((m) => normalizarCaminho(m[0])));
      assert.ok(achados.includes(esperado) && elegivelAoDocsFast(esperado), `${linha} → ${achados}`);
    }
    for (const linha of ['join(ROOT, "docs/engineering", "X.md")', "readdirSync('docs/engineering')", "join(ROOT, 'docs')"]) {
      assert.ok(
        literais(linha).some((l) => /^docs(?:\/[^\s.]*)?\/?$/.test(normalizarCaminho(l.trim()))),
        `diretório de docs não detectado: ${linha}`
      );
    }
    assert.ok(!elegivelAoDocsFast(normalizarCaminho('src/assets/icones/README.md')));
  });

  test('QP-G2 DOCS_ACOPLADOS não guarda documento que não existe mais', () => {
    for (const doc of DOCS_ACOPLADOS) assert.ok(existsSync(join(REPO_ROOT, doc)), doc);
  });
});
