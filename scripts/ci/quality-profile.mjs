#!/usr/bin/env node
/**
 * Classificador do perfil da CI `quality` (MAIKE-CI-INTELIGENTE-PR01).
 *
 * Decide se uma execução do workflow roda o perfil `docs_fast` (só gates
 * estáticos, sem PostgreSQL) ou o `full` (o `verify:all` integral, com
 * PostgreSQL efêmero, backend, Vitest e builds).
 *
 * A regra é fail-closed: `docs_fast` só sai quando TODOS os arquivos da PR
 * foram listados de forma completa e consistente e cada um deles é um Markdown
 * de documentação reconhecido. Qualquer outra situação — evento que não é
 * `pull_request`, lista vazia ou incompleta, falha de API, HEAD que mudou no
 * meio da consulta, contagem divergente, arquivo removido ou renomeado, caminho
 * desconhecido — resulta em `full`, com o motivo registrado.
 *
 * `docs_fast` também exige que a base da PR seja a branch padrão do repositório
 * (`main`). Uma PR contra outra branch roda o `full`: se a base for trocada
 * depois para a `main` (o que não dispara o workflow de novo), o check verde no
 * SHA de head continua valendo, e ele precisa ter sido o da suíte completa.
 *
 * Rótulos, título, descrição e autor da PR nunca entram na decisão.
 *
 * Uso na CI: `node scripts/ci/quality-profile.mjs`. Lê `GITHUB_EVENT_NAME`,
 * `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY`, `GITHUB_API_URL` e `GITHUB_TOKEN`
 * (somente leitura) e escreve `mode`, `reason` e `files_count` em
 * `GITHUB_OUTPUT`. O token nunca é impresso.
 *
 * Confiança: o workflow executa a versão deste arquivo que está no commit BASE
 * da PR, não a da própria PR. Assim, uma PR que altere o classificador é
 * julgada pelo classificador já aprovado, e a regra `scripts/ci/** → full`
 * vale de verdade.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MODE_DOCS_FAST = 'docs_fast';
export const MODE_FULL = 'full';

/** Limite documentado de `GET /pulls/{n}/files`: acima disso a lista é truncada. */
export const MAX_ARQUIVOS_LISTAVEIS = 3000;
export const ITENS_POR_PAGINA = 100;

/** Markdown da raiz que conta como documentação. Só estes, só `.md`. */
export const DOCS_RAIZ = Object.freeze(['README.md', 'README_AI.md', 'CLAUDE.md', 'AGENTS.md']);

/**
 * Documentos lidos por etapas que só rodam no perfil `full` (testes de
 * backend, Vitest, lint ou builds). Mudar um deles exige o `full`, porque o
 * `docs_fast` não exercita quem os lê.
 *
 * Mantida pelo teste-guarda `QP-G1` de `quality-profile.test.mjs`: ele procura
 * literais de caminho Markdown no código que não roda no `docs_fast` e reprova
 * se algum ficar fora desta lista.
 */
export const DOCS_ACOPLADOS = Object.freeze([
  // tests/smoke/maplibreR6StyleRetry.test.js (Vitest, etapa test:smoke)
  'docs/engineering/MAPLIBRE-M1-EDITOR-AREAS-REPORT.md',
  // backend/tests/tipoAtividadeDefaultsMigration.test.mjs (etapa test:backend): roda os blocos SQL do runbook como estão (D-PROD-197)
  'docs/engineering/MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md',
  // backend/tests/atividadeCabecalhoMigration.test.mjs (etapa test:backend): roda os blocos SQL do runbook como estão (D-PROD-200)
  'docs/engineering/MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md',
  // backend/tests/atividadeLinhasMigration.test.mjs (etapa test:backend): roda os blocos SQL do runbook como estão (D-PROD-202)
  'docs/engineering/MAIKE-ATIVIDADE-LINHAS-RUNBOOK-RELEASE.md',
  // backend/tests/atividadeMaoObraMigration.test.mjs (etapa test:backend): roda os blocos SQL do runbook como estão (D-PROD-207)
  'docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md',
  // backend/tests/atividadeMaoObraParceiroMigration.test.mjs (etapa test:backend): roda os blocos SQL do runbook como estão (D-PROD-208)
  'docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md',
  // backend/tests/funcionarioTipoTerceirizadoMigration.test.mjs (etapa test:backend): roda os blocos SQL do runbook como estão (D-PROD-209)
  'docs/engineering/MAIKE-FUNCIONARIO-TIPO-RUNBOOK-RELEASE.md',
  // backend/tests/abastecimentoAtividadeMigration.test.mjs (etapa test:backend): roda os blocos SQL do runbook como estão (D-PROD-211)
  'docs/engineering/MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md',
  // backend/tests/abastecimentoFkApontamentoMigration.test.mjs (etapa test:backend): roda os blocos SQL do runbook como estão (D-PROD-217)
  'docs/engineering/MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md',
]);

/** Estados do GitHub aceitos no `docs_fast`. Removido e renomeado vão para o `full`. */
const ESTADOS_DOCS = new Set(['added', 'modified']);

const DOC_EM_DOCS = /^docs\/(?:[^/]+\/)*[^/]+\.md$/;

/** Motivo seguro para `GITHUB_OUTPUT` e para a tabela do resumo (nome de arquivo vem da PR). */
export function motivoSeguro(motivo) {
  return String(motivo).replace(/[^\w./:@+-]/g, '_').slice(0, 300);
}

/** Caminho relativo, sem `..`, sem barra inicial, sem `\`, sem NUL e sem segmento vazio. */
function caminhoSeguro(caminho) {
  if (typeof caminho !== 'string' || caminho.length === 0) return false;
  if (caminho.startsWith('/') || caminho.includes('\\') || caminho.includes('\0')) return false;
  return caminho.split('/').every((segmento) => segmento !== '' && segmento !== '.' && segmento !== '..');
}

/**
 * Diz se um único arquivo alterado pode rodar no `docs_fast`.
 * @returns {{ docs: boolean, motivo: string }}
 */
export function classificarArquivo(arquivo) {
  const caminho = arquivo?.filename;
  const estado = arquivo?.status;
  if (!caminhoSeguro(caminho)) return { docs: false, motivo: 'caminho_invalido' };
  if (!ESTADOS_DOCS.has(estado)) return { docs: false, motivo: `estado_${typeof estado === 'string' ? estado : 'desconhecido'}` };
  if (DOCS_ACOPLADOS.includes(caminho)) return { docs: false, motivo: 'documento_acoplado_a_teste' };
  if (DOCS_RAIZ.includes(caminho) || DOC_EM_DOCS.test(caminho)) return { docs: true, motivo: 'documentacao' };
  return { docs: false, motivo: 'arquivo_nao_documental' };
}

/**
 * Classifica o conjunto COMPLETO de arquivos de uma PR.
 * @param {Array<{filename: string, status: string}>} files
 * @param {{ expectedCount?: number }} [opcoes] `changed_files` informado pelo GitHub
 * @returns {{ mode: string, reason: string, files_count: number }}
 */
export function classifyChangedFiles(files, { expectedCount } = {}) {
  if (!Array.isArray(files)) return { mode: MODE_FULL, reason: 'lista_invalida', files_count: 0 };
  const total = files.length;
  if (total === 0) return { mode: MODE_FULL, reason: 'lista_vazia', files_count: 0 };
  if (total > MAX_ARQUIVOS_LISTAVEIS) return { mode: MODE_FULL, reason: 'acima_do_limite_listavel', files_count: total };
  if (!Number.isInteger(expectedCount) || expectedCount !== total) {
    return { mode: MODE_FULL, reason: 'contagem_divergente', files_count: total };
  }
  const caminhos = new Set();
  for (const arquivo of files) {
    if (caminhos.has(arquivo?.filename)) return { mode: MODE_FULL, reason: 'arquivo_repetido', files_count: total };
    caminhos.add(arquivo?.filename);
    const { docs, motivo } = classificarArquivo(arquivo);
    if (!docs) return { mode: MODE_FULL, reason: `${motivo}:${String(arquivo?.filename).slice(0, 200)}`, files_count: total };
  }
  return { mode: MODE_DOCS_FAST, reason: 'somente_documentacao', files_count: total };
}

/**
 * Decisão completa a partir do evento e da listagem consultada.
 * @param {{
 *   eventName: string,
 *   eventHeadSha?: string,
 *   baseRef?: string,          // pull_request.base.ref
 *   defaultBranch?: string,    // repository.default_branch
 *   listagem?: { erro?: string, headAntes?: string, headDepois?: string,
 *                changedFiles?: number, files?: Array<object>, completa?: boolean }
 * }} entrada
 */
export function decideQualityProfile({ eventName, eventHeadSha, baseRef, defaultBranch, listagem } = {}) {
  if (eventName !== 'pull_request') {
    const motivo = eventName === 'push' ? 'push_sempre_full' : `evento_${eventName || 'desconhecido'}`;
    return { mode: MODE_FULL, reason: motivo, files_count: 0 };
  }
  if (!baseRef || !defaultBranch || baseRef !== defaultBranch) {
    return { mode: MODE_FULL, reason: 'base_nao_padrao', files_count: 0 };
  }
  if (!listagem) return { mode: MODE_FULL, reason: 'sem_listagem', files_count: 0 };
  if (listagem.erro) return { mode: MODE_FULL, reason: `falha_${listagem.erro}`, files_count: 0 };
  const sha = /^[0-9a-f]{40}$/;
  if (!sha.test(eventHeadSha || '')) return { mode: MODE_FULL, reason: 'head_do_evento_invalido', files_count: 0 };
  if (listagem.headAntes !== eventHeadSha || listagem.headDepois !== eventHeadSha) {
    return { mode: MODE_FULL, reason: 'head_divergente', files_count: 0 };
  }
  if (!Number.isInteger(listagem.changedFiles) || listagem.changedFiles < 0) {
    return { mode: MODE_FULL, reason: 'changed_files_invalido', files_count: 0 };
  }
  if (listagem.changedFiles > MAX_ARQUIVOS_LISTAVEIS) {
    return { mode: MODE_FULL, reason: 'acima_do_limite_listavel', files_count: listagem.changedFiles };
  }
  if (listagem.completa !== true) {
    return { mode: MODE_FULL, reason: 'paginacao_incompleta', files_count: listagem.files?.length ?? 0 };
  }
  return classifyChangedFiles(listagem.files, { expectedCount: listagem.changedFiles });
}

/* ------------------------------------------------------------------------ */
/* Consulta ao GitHub (somente leitura)                                       */
/* ------------------------------------------------------------------------ */

async function pedirJson(fetchImpl, url, token) {
  const resposta = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'maike-quality-profile',
    },
  });
  if (!resposta.ok) {
    const erro = new Error(`http_${resposta.status}`);
    erro.codigo = `http_${resposta.status}`;
    throw erro;
  }
  return resposta.json();
}

/**
 * Lê a PR, todas as páginas de arquivos e a PR de novo, para detectar push no meio.
 * Nunca lança: erros viram `{ erro }`.
 */
export async function listarArquivosDaPr({ apiUrl, repositorio, numero, token, fetchImpl = fetch }) {
  try {
    if (!token) return { erro: 'sem_token' };
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositorio || '')) return { erro: 'repositorio_invalido' };
    if (!Number.isInteger(numero) || numero <= 0) return { erro: 'numero_invalido' };
    const base = String(apiUrl || 'https://api.github.com').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) return { erro: 'api_url_invalida' };
    const urlPr = `${base}/repos/${repositorio}/pulls/${numero}`;

    const antes = await pedirJson(fetchImpl, urlPr, token);
    const changedFiles = antes?.changed_files;
    const headAntes = antes?.head?.sha;
    if (!Number.isInteger(changedFiles)) return { erro: 'changed_files_ausente' };
    if (changedFiles > MAX_ARQUIVOS_LISTAVEIS) {
      return { headAntes, headDepois: headAntes, changedFiles, files: [], completa: false };
    }

    const files = [];
    let completa = false;
    // Uma página a mais que o necessário: com exatamente 3.000 arquivos, a
    // página 31 vem vazia e confirma que a lista acabou.
    const maxPaginas = Math.ceil(MAX_ARQUIVOS_LISTAVEIS / ITENS_POR_PAGINA) + 1;
    for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
      const lote = await pedirJson(fetchImpl, `${urlPr}/files?per_page=${ITENS_POR_PAGINA}&page=${pagina}`, token);
      if (!Array.isArray(lote)) return { erro: 'pagina_invalida' };
      for (const item of lote) files.push({ filename: item?.filename, status: item?.status });
      if (lote.length < ITENS_POR_PAGINA) {
        completa = true;
        break;
      }
    }

    const depois = await pedirJson(fetchImpl, urlPr, token);
    return {
      headAntes,
      headDepois: depois?.head?.sha,
      changedFiles: depois?.changed_files === changedFiles ? changedFiles : -1,
      files,
      completa,
    };
  } catch (erro) {
    return { erro: erro?.codigo || 'consulta_falhou' };
  }
}

/* ------------------------------------------------------------------------ */
/* CLI do GitHub Actions                                                     */
/* ------------------------------------------------------------------------ */

function lerEvento(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

export async function executarCli(env = process.env, { fetchImpl = fetch, log = console.log } = {}) {
  const eventName = env.GITHUB_EVENT_NAME || '';
  let decisao;
  if (eventName !== 'pull_request') {
    decisao = decideQualityProfile({ eventName });
  } else {
    const evento = env.GITHUB_EVENT_PATH ? lerEvento(env.GITHUB_EVENT_PATH) : null;
    const pr = evento?.pull_request;
    if (!pr) {
      decisao = { mode: MODE_FULL, reason: 'evento_ilegivel', files_count: 0 };
    } else {
      const baseRef = pr.base?.ref;
      const defaultBranch = evento?.repository?.default_branch;
      // Base fora da branch padrão já decide `full`: nem consulta a API.
      const listagem =
        baseRef && defaultBranch && baseRef === defaultBranch
          ? await listarArquivosDaPr({
              apiUrl: env.GITHUB_API_URL,
              repositorio: env.GITHUB_REPOSITORY,
              numero: pr.number,
              token: env.GITHUB_TOKEN,
              fetchImpl,
            })
          : undefined;
      decisao = decideQualityProfile({ eventName, eventHeadSha: pr.head?.sha, baseRef, defaultBranch, listagem });
    }
  }

  const reason = motivoSeguro(decisao.reason);
  const linhas = [`mode=${decisao.mode}`, `reason=${reason}`, `files_count=${decisao.files_count}`];
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${linhas.join('\n')}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `### Perfil da CI quality\n\n| mode | reason | files_count |\n|---|---|---|\n| \`${decisao.mode}\` | \`${reason}\` | ${decisao.files_count} |\n`
    );
  }
  log(`quality-profile: mode=${decisao.mode} reason=${reason} files_count=${decisao.files_count}`);
  return { ...decisao, reason };
}

const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executadoDireto) {
  executarCli().catch(() => {
    // Falha inesperada do próprio CLI: sem saída válida, o job `verify:all` reprova.
    console.error('quality-profile: falha inesperada; nenhum perfil emitido');
    process.exit(1);
  });
}
