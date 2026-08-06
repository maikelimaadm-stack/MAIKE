/**
 * Contrato de configuração da catraca de tipos.
 *
 * A catraca só é honesta se a *configuração* também for versionada. Sem isso,
 * baixar a cobertura (`checkJs: false`, `include: []`, excluir `src/lib`)
 * derrubaria os diagnósticos e o gate ficaria verde sem nada ter melhorado.
 *
 * Este módulo:
 *  - lê o projeto (JSONC, com `extends` recursivo em arquivos locais);
 *  - produz uma representação canônica e um SHA-256 estável, sem caminho absoluto;
 *  - valida mecanicamente a cobertura obrigatória.
 *
 * Códigos: P01-TYPE-CONTRACT · P01-TYPE-CONFIG-DRIFT · P01-TYPE-VERSION-DRIFT
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/** Extensões que a cobertura obrigatoriamente inclui. */
export const REQUIRED_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx'];

/** Padrões que a configuração precisa cobrir. */
export const REQUIRED_INCLUDE_PATTERNS = REQUIRED_EXTENSIONS.map((ext) => `src/**/*.${ext}`);

/** Diretórios que nunca podem sair da cobertura. */
export const PROTECTED_DIRS = ['src/components/ui', 'src/api', 'src/lib', 'src/services'];

/** Raízes de exclusão permitidas. Qualquer outra reprova. */
export const ALLOWED_EXCLUDE_ROOTS = ['node_modules', 'dist', 'dist-ssr', 'coverage'];

const toPosix = (p) => String(p).split('\\').join('/');

/** Normaliza um padrão do `include`/`exclude` para comparação. */
export const normalizePattern = (pattern) =>
  toPosix(pattern).replace(/^\.\//, '').replace(/\/+$/, '');

// ── JSONC ────────────────────────────────────────────────────────────────

/** Remove comentários preservando o conteúdo de strings. */
export const stripJsonComments = (text) => {
  let out = '';
  let inString = false;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];

    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && n === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
};

/** Remove vírgula final antes de `}` ou `]`, ignorando strings. */
const stripTrailingCommas = (text) => {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      const resto = text.slice(i + 1);
      const proximo = resto.match(/^\s*([}\]])/);
      if (proximo) continue; // descarta a vírgula
    }
    out += c;
  }
  return out;
};

export const parseJsonc = (text) => JSON.parse(stripTrailingCommas(stripJsonComments(text)));

// ── Canonicalização ──────────────────────────────────────────────────────

/** Serialização canônica: chaves de objeto ordenadas, arrays na ordem original. */
export const canonicalJson = (value) => {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

// ── Cadeia de `extends` ──────────────────────────────────────────────────

const resolveExtendsTarget = (specifier, fromFileAbs) => {
  const base = dirname(fromFileAbs);
  const candidato = isAbsolute(specifier) ? specifier : resolve(base, specifier);
  for (const tentativa of [candidato, `${candidato}.json`]) {
    if (existsSync(tentativa)) return tentativa;
  }
  return null;
};

/**
 * Lê o projeto e toda a cadeia local de `extends`.
 *
 * @param {string} projectPath caminho relativo ao `cwd` (ex.: `./jsconfig.typecheck.json`)
 * @param {string} cwd
 * @returns {{ok: true, chain: Array<{path: string, canonical: string}>, effective: object}
 *          | {ok: false, message: string}}
 */
export const resolveConfigChain = (projectPath, cwd = process.cwd()) => {
  const abs = resolve(cwd, projectPath);
  if (!existsSync(abs)) {
    return { ok: false, message: `configuração de tipos não encontrada: ${projectPath}` };
  }

  const chain = [];
  const vistos = new Set();
  const camadas = [];

  let atualAbs = abs;
  while (atualAbs) {
    if (vistos.has(atualAbs)) {
      return { ok: false, message: `ciclo de "extends" em ${toPosix(relative(cwd, atualAbs))}` };
    }
    vistos.add(atualAbs);

    let dados;
    try {
      dados = parseJsonc(readFileSync(atualAbs, 'utf8'));
    } catch (error) {
      return {
        ok: false,
        message: `configuração de tipos ilegível (${toPosix(relative(cwd, atualAbs))}): ${error.message}`,
      };
    }

    // Caminho relativo ao repositório: o hash nunca depende de onde o clone está.
    chain.push({ path: toPosix(relative(cwd, atualAbs)), canonical: canonicalJson(dados) });
    camadas.unshift(dados);

    const ext = dados.extends;
    if (!ext) break;

    const especificadores = Array.isArray(ext) ? ext : [ext];
    if (especificadores.length !== 1) {
      return {
        ok: false,
        message: '"extends" com múltiplos alvos não é suportado pelo contrato de tipos',
      };
    }

    const alvo = resolveExtendsTarget(especificadores[0], atualAbs);
    if (!alvo) {
      // `extends` de pacote: o conteúdo vive fora do repositório. Entra no hash
      // apenas como especificador, e a cobertura efetiva não pode depender dele.
      chain.push({ path: `<externo>${especificadores[0]}`, canonical: 'null' });
      break;
    }
    atualAbs = alvo;
  }

  // Merge: `compilerOptions` raso, `include`/`exclude`/`files` substituem por completo.
  const effective = { compilerOptions: {} };
  for (const camada of camadas) {
    Object.assign(effective.compilerOptions, camada.compilerOptions || {});
    for (const campo of ['include', 'exclude', 'files']) {
      if (camada[campo] !== undefined) effective[campo] = camada[campo];
    }
  }

  return { ok: true, chain, effective };
};

/** SHA-256 da cadeia canônica. Estável entre clones e sistemas de arquivos. */
export const hashConfigChain = (chain) => {
  const hash = createHash('sha256');
  for (const { path, canonical } of chain) {
    hash.update(path);
    hash.update('\u0000');
    hash.update(canonical);
    hash.update('\u0000');
  }
  return hash.digest('hex');
};

// ── Glob mínimo, no dialeto do TypeScript ────────────────────────────────

const escapeRegExp = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/**
 * Converte um padrão de `include`/`exclude` em expressão regular.
 * Um caminho sem curinga e sem extensão é tratado como diretório (`p/**\/*`).
 */
export const patternToRegExp = (pattern) => {
  let p = normalizePattern(pattern);
  const pareceArquivo = /\.[A-Za-z0-9]+$/.test(p);
  const temCuringa = /[*?]/.test(p);
  if (!pareceArquivo && !temCuringa) p = `${p}/**/*`;

  let re = '';
  for (let i = 0; i < p.length; i += 1) {
    if (p.startsWith('**/', i)) {
      re += '(?:[^/]*/)*';
      i += 2;
      continue;
    }
    if (p.startsWith('**', i)) {
      re += '.*';
      i += 1;
      continue;
    }
    const c = p[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += escapeRegExp(c);
  }
  return new RegExp(`^${re}$`);
};

const matchesAny = (patterns, caminho) =>
  (patterns || []).some((p) => patternToRegExp(p).test(caminho));

/** Caminhos de sonda usados para provar a cobertura. */
export const probesFor = (dir) =>
  REQUIRED_EXTENSIONS.flatMap((ext) => [`${dir}/sonda.${ext}`, `${dir}/nivel1/nivel2/sonda.${ext}`]);

/**
 * Valida mecanicamente o contrato de cobertura.
 * @param {object} effective configuração já resolvida
 * @returns {string[]} violações (vazio = contrato cumprido)
 */
export const validateCoverage = (effective) => {
  const violacoes = [];
  const opts = effective.compilerOptions || {};
  const include = effective.include;
  const exclude = effective.exclude || [];

  if (opts.checkJs !== true) {
    violacoes.push(`"checkJs" precisa ser true (encontrado: ${JSON.stringify(opts.checkJs)})`);
  }
  if (!Array.isArray(include) || include.length === 0) {
    violacoes.push('"include" ausente ou vazio: a cobertura precisa ser declarada explicitamente');
    return violacoes; // sem include não há o que provar
  }

  // 1. Toda extensão obrigatória, na raiz e em profundidade.
  for (const caminho of probesFor('src')) {
    if (!matchesAny(include, caminho)) {
      violacoes.push(`"include" não cobre ${caminho}`);
    } else if (matchesAny(exclude, caminho)) {
      violacoes.push(`"exclude" remove ${caminho} da cobertura`);
    }
  }

  // 2. Diretórios protegidos.
  for (const dir of PROTECTED_DIRS) {
    for (const caminho of probesFor(dir)) {
      if (!matchesAny(include, caminho)) {
        violacoes.push(`diretório protegido fora do "include": ${caminho}`);
      } else if (matchesAny(exclude, caminho)) {
        violacoes.push(`diretório protegido excluído: ${dir} (via ${caminho})`);
      }
    }
  }

  // 3. Exclusões permitidas.
  for (const bruto of exclude) {
    const p = normalizePattern(bruto);
    const raiz = p.split('/')[0];
    const permitido =
      ALLOWED_EXCLUDE_ROOTS.includes(raiz) ||
      (!p.startsWith('src/') && p !== 'src' && /(^|\/)fixtures(\/|$)/.test(p));
    if (!permitido) {
      violacoes.push(
        `exclusão não permitida: "${bruto}". Permitidas: ${ALLOWED_EXCLUDE_ROOTS.join(', ')} e fixtures fora de src/`
      );
    }
  }

  return [...new Set(violacoes)];
};

/**
 * Contrato completo, pronto para gravar no baseline e comparar.
 * @returns {{ok: true, contract: object, violations: string[]}
 *          | {ok: false, message: string}}
 */
export const buildTypeContract = ({ project, cwd = process.cwd(), command, typescriptVersion }) => {
  const chain = resolveConfigChain(project, cwd);
  if (!chain.ok) return chain;

  const opts = chain.effective.compilerOptions || {};
  return {
    ok: true,
    violations: validateCoverage(chain.effective),
    contract: {
      projectPath: normalizePattern(project),
      projectSha256: hashConfigChain(chain.chain),
      effectiveCommand: command,
      typescriptVersion,
      coverageContract: {
        checkJs: opts.checkJs === true,
        include: [...(chain.effective.include || [])].map(normalizePattern).sort(),
        exclude: [...(chain.effective.exclude || [])].map(normalizePattern).sort(),
        files: chain.effective.files ? [...chain.effective.files].map(normalizePattern).sort() : null,
        requiredPatterns: [...REQUIRED_INCLUDE_PATTERNS],
        protectedDirs: [...PROTECTED_DIRS],
        allowedExcludeRoots: [...ALLOWED_EXCLUDE_ROOTS],
        configFiles: chain.chain.map((c) => c.path),
      },
    },
  };
};

/**
 * Compara o contrato atual com o gravado no baseline.
 * @returns {Array<{code: string, message: string}>}
 */
export const diffContract = (baseline, atual) => {
  const problemas = [];
  const drift = (msg) => problemas.push({ code: 'P01-TYPE-CONFIG-DRIFT', message: msg });

  if (baseline.projectPath !== atual.projectPath) {
    drift(`projeto divergente: baseline "${baseline.projectPath}", execução "${atual.projectPath}"`);
  }
  if (baseline.effectiveCommand !== atual.effectiveCommand) {
    drift(`comando divergente: baseline "${baseline.effectiveCommand}", execução "${atual.effectiveCommand}"`);
  }
  if (baseline.projectSha256 !== atual.projectSha256) {
    drift(
      `configuração alterada: sha256 do baseline ${String(baseline.projectSha256).slice(0, 12)}…, ` +
        `atual ${String(atual.projectSha256).slice(0, 12)}…`
    );
  }
  if (canonicalJson(baseline.coverageContract) !== canonicalJson(atual.coverageContract)) {
    drift('contrato de cobertura divergente (include/exclude/checkJs/arquivos de configuração)');
  }
  if (baseline.typescriptVersion !== atual.typescriptVersion) {
    problemas.push({
      code: 'P01-TYPE-VERSION-DRIFT',
      message: `TypeScript divergente: baseline ${baseline.typescriptVersion}, execução ${atual.typescriptVersion}`,
    });
  }

  return problemas;
};
