/**
 * Medição da fronteira de dados (P1.1).
 *
 * A catraca `gate:base44` conta ocorrências. Esta mede **identidade de
 * arquivo**: quais caminhos ainda falam com a Base44 diretamente. Contagem
 * sozinha deixa passar troca — remover um acesso aqui e criar outro ali fecharia
 * o número e abriria caminho novo. Lista de caminhos, não.
 */

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import ts from 'typescript';

import { walkFiles, CODE_EXTS, toRelative } from './source-graph.mjs';

/** Diretório interno do provider. Só API de módulo pode importar de lá. */
export const PROVIDERS_DIR = 'src/apis/_providers/';

/** Pacote do SDK legado. */
export const SDK_PACKAGE = '@base44/sdk';

/** Eixos do baseline. Contrato exato: ausente ou inesperado reprova. */
export const AXES = Object.freeze([
  'importsLegacyClient',
  'entitiesRefs',
  'authRefs',
  'integrationsRefs',
  'functionsRefs',
  'dynamicEntityFiles',
]);

/** O único arquivo de `src/apis/` autorizado a falar com o client legado. */
export const ALLOWED_PROVIDER_ADAPTER = 'src/apis/_providers/base44Provider.js';

/** O único arquivo autorizado a importar o SDK. */
export const ALLOWED_SDK_IMPORTER = 'src/api/base44Client.js';

const LEGACY_CLIENT_SPECIFIERS = ['@/api/base44Client', '../api/base44Client', './api/base44Client'];

/**
 * Resolve um especificador de import para caminho relativo ao repositório.
 *
 * Cobre alias `@/`, caminho relativo e extensão opcional. Pacote externo
 * devolve `null` — não é caminho do projeto.
 *
 * @param {string} spec especificador literal
 * @param {string} deArquivo caminho do arquivo que importa, relativo ao repo
 * @returns {string|null}
 */
export const resolveSpecifierToRepoPath = (spec, deArquivo) => {
  if (typeof spec !== 'string' || !spec) return null;

  let alvo;
  if (spec.startsWith('@/')) alvo = `src/${spec.slice(2)}`;
  else if (spec.startsWith('./') || spec.startsWith('../')) {
    alvo = posix.normalize(posix.join(posix.dirname(deArquivo), spec));
  } else return null;

  return alvo.replace(/\.(js|jsx|ts|tsx|mjs)$/, '');
};

/** O import aponta para dentro de `src/apis/_providers/`? */
export const targetsProviders = (spec, deArquivo) => {
  const alvo = resolveSpecifierToRepoPath(spec, deArquivo);
  return Boolean(alvo && `${alvo}`.startsWith(PROVIDERS_DIR));
};

/**
 * O arquivo é uma API explícita de módulo — a única camada autorizada a
 * importar `_providers`?
 *
 * `src/apis/<modulo>/**`, com `<modulo>` sem prefixo `_`. Assim a regra escala
 * sozinha para as próximas slices: cada módulo novo já nasce autorizado, e
 * `_core/` e `_providers/` continuam de fora.
 */
export const isModuleApi = (rel) => Boolean(moduleOf(rel));

/**
 * Nome do módulo de dados a que este caminho pertence, ou `null`.
 *
 * `src/apis/empresa/empresaApi.js` → `empresa`. `src/apis/_core/ApiError.js` →
 * `null`: prefixo `_` significa interno, e interno nunca é módulo.
 *
 * @param {string} rel caminho relativo ao repositório, sem barra inicial
 * @returns {string|null}
 */
export const moduleOf = (rel) => {
  if (typeof rel !== 'string' || !rel.startsWith('src/apis/')) return null;
  const resto = rel.slice('src/apis/'.length);
  if (!resto.includes('/')) return null; // `src/apis/algo.js` não é módulo
  const modulo = resto.split('/')[0];
  return modulo && !modulo.startsWith('_') ? modulo : null;
};

/**
 * O caminho é a **superfície pública** de um módulo?
 *
 * Decisão única (R2): `src/apis/<modulo>` e `src/apis/<modulo>/index` são a
 * mesma coisa — o especificador já chega aqui sem extensão, então
 * `@/apis/empresa`, `@/apis/empresa/index` e `@/apis/empresa/index.js`
 * convergem. Qualquer outro arquivo do módulo é implementação interna.
 */
export const isModulePublicSurface = (alvo) => {
  const modulo = moduleTargetedBy(alvo);
  if (!modulo) return false;
  return alvo === `src/apis/${modulo}` || alvo === `src/apis/${modulo}/index`;
};

/**
 * Que módulo este **alvo de import** endereça?
 *
 * Diferente de {@link moduleOf}, aceita o diretório do módulo sem arquivo:
 * `src/apis/empresa` (de `@/apis/empresa`) endereça `empresa`.
 *
 * @param {string|null} alvo caminho já resolvido, sem extensão
 * @returns {string|null}
 */
export const moduleTargetedBy = (alvo) => {
  if (typeof alvo !== 'string' || !alvo.startsWith('src/apis/')) return null;
  const modulo = alvo.slice('src/apis/'.length).split('/')[0];
  return modulo && !modulo.startsWith('_') ? modulo : null;
};

/** Camadas de apresentação: nunca falam com API de dados diretamente. */
export const UI_DIRS = Object.freeze(['src/pages/', 'src/components/', 'src/hooks/']);
export const UI_FILES = Object.freeze(['src/Layout.jsx', 'src/App.jsx']);

/** O arquivo é UI — página, componente, hook ou layout raiz? */
export const isUiLayer = (rel) =>
  UI_DIRS.some((d) => rel.startsWith(d)) || UI_FILES.includes(rel);

const parse = (source, fileName) =>
  ts.createSourceFile(fileName, String(source).replace(/\r\n/g, '\n'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

const walk = (node, visit) => {
  visit(node);
  node.forEachChild((filho) => walk(filho, visit));
};

const literalString = (node) => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};

/**
 * Nomes locais introduzidos por um `import`.
 *
 * Cobre `import x from`, `import * as x from` e `import { a, b as c } from`.
 * O nome que interessa é sempre o **local** (`c`), porque é ele que pode ser
 * reexportado depois.
 *
 * @param {import('typescript').ImportDeclaration} node
 * @returns {string[]}
 */
const bindingsDoImport = (node) => {
  const clause = node.importClause;
  if (!clause) return [];
  const nomes = [];
  if (clause.name) nomes.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings) {
    if (ts.isNamespaceImport(bindings)) nomes.push(bindings.name.text);
    else if (ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) nomes.push(el.name.text);
    }
  }
  return nomes;
};

/**
 * A expressão **entrega a referência** de um binding do provider?
 *
 * Esta é a distinção que separa uso legítimo de vazamento:
 *
 * ```js
 * export const listar = () => empresaProvider.list(ordem);  // usa  → ok
 * export const obter  = () => empresaProvider;              // entrega → vaza
 * ```
 *
 * Chamar um método devolve **o resultado**; devolver o identificador devolve o
 * próprio provider, e a partir daí o consumidor faz o que quiser.
 *
 * @param {import('typescript').Node|undefined} expr
 * @param {Set<string>} bindings
 * @returns {boolean}
 */
const entregaProvider = (expr, bindings) => {
  if (!expr || bindings.size === 0) return false;

  if (ts.isParenthesizedExpression(expr) || ts.isNonNullExpression(expr) || ts.isAsExpression?.(expr)) {
    return entregaProvider(expr.expression, bindings);
  }
  if (ts.isIdentifier(expr)) return bindings.has(expr.text);

  // `export const provider = { empresaProvider }` · `{ p: empresaProvider }`
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.some((p) => {
      if (ts.isShorthandPropertyAssignment(p)) return bindings.has(p.name.text);
      if (ts.isPropertyAssignment(p)) return entregaProvider(p.initializer, bindings);
      if (ts.isSpreadAssignment(p)) return entregaProvider(p.expression, bindings);
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.some((e) => entregaProvider(e, bindings));
  }

  // `export const getProvider = () => empresaProvider` e a forma com bloco.
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    return entregaProvider(expr.body, bindings);
  }
  if (ts.isBlock(expr)) {
    return expr.statements.some(
      (s) => ts.isReturnStatement(s) && entregaProvider(s.expression, bindings)
    );
  }

  return false;
};

/** A expressão termina em `entities`/`auth`/`integrations`/`functions` de `base44`? */
const namespaceDeBase44 = (node, nome) => {
  if (!node) return false;
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
    return namespaceDeBase44(node.expression, nome);
  }
  if (!ts.isPropertyAccessExpression(node)) return false;
  return node.name.text === nome;
};

/**
 * Analisa um arquivo e devolve os fatos de fronteira.
 *
 * @param {string} source
 * @param {string} rel caminho relativo ao repositório
 */
export const analyzeFile = (source, rel) => {
  const sourceFile = parse(source, rel);

  const fato = {
    importsLegacyClient: false,
    importsSdk: false,
    entitiesRefs: 0,
    authRefs: 0,
    integrationsRefs: 0,
    functionsRefs: 0,
    /** Reexport direto do objeto do provider. */
    reexportsProvider: false,
    /** Acesso computado a `entities` com nome não literal. */
    dynamicEntityAccess: [],
    /** Entidades acessadas literalmente (`entities.X`, `entities['X']`). */
    literalEntities: new Set(),
    /** Este arquivo importa algo de `src/apis/_providers/`? */
    importsProviders: false,
    /** Nomes locais ligados a símbolos vindos de `_providers/`. */
    providerBindings: new Set(),
    /** Símbolos de `_providers/` que este arquivo exporta. Cada um é um vazamento. */
    publicProviderLeaks: [],
    /** Imports que endereçam API de módulo: `{alvo, modulo, publico}`. */
    moduleApiImports: [],
  };

  /** Registra o carregamento do SDK ou do provider por um especificador. */
  const registrarEspecificador = (spec) => {
    if (spec === SDK_PACKAGE) fato.importsSdk = true;
    if (LEGACY_CLIENT_SPECIFIERS.includes(spec)) fato.importsLegacyClient = true;
    if (targetsProviders(spec, rel)) fato.importsProviders = true;

    const alvo = resolveSpecifierToRepoPath(spec, rel);
    const modulo = moduleTargetedBy(alvo);
    if (modulo) {
      fato.moduleApiImports.push({ alvo, modulo, publico: isModulePublicSurface(alvo) });
    }
  };

  walk(sourceFile, (node) => {
    // import / export ... from '...'
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      const spec = literalString(node.moduleSpecifier);
      registrarEspecificador(spec);
      // `export { base44 } from '@/api/base44Client'` é vazamento direto.
      if (LEGACY_CLIENT_SPECIFIERS.includes(spec) && ts.isExportDeclaration(node)) {
        fato.reexportsProvider = true;
      }
      if (targetsProviders(spec, rel)) {
        // `export … from '../_providers/…'` entrega o provider ao consumidor
        // sem que ele precise citar `_providers`. É o vazamento transitivo.
        if (ts.isExportDeclaration(node)) {
          const quais = node.exportClause && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements.map((e) => e.name.text).join(', ')
            : '*';
          fato.publicProviderLeaks.push(`export ${quais} from '${spec}'`);
        } else {
          // Guarda os nomes locais para reconhecer o vazamento indireto adiante.
          for (const nome of bindingsDoImport(node)) fato.providerBindings.add(nome);
        }
      }
      return;
    }

    // import('...') — dinâmico, com ou sem await. O `await` é um nó acima; a
    // chamada é a mesma, então basta olhar a CallExpression.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      registrarEspecificador(literalString(node.arguments[0]));
      return;
    }

    // require('...') — CommonJS
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length >= 1
    ) {
      registrarEspecificador(literalString(node.arguments[0]));
      return;
    }

    // import x = require('...') — sintaxe TypeScript
    if (
      ts.isImportEqualsDeclaration?.(node) &&
      node.moduleReference &&
      ts.isExternalModuleReference?.(node.moduleReference)
    ) {
      registrarEspecificador(literalString(node.moduleReference.expression));
      return;
    }

    // export { base44 } / export { base44 as provider }
    if (ts.isExportSpecifier(node)) {
      const origem = (node.propertyName || node.name).text;
      if (origem === 'base44') fato.reexportsProvider = true;
      return;
    }

    // export default base44 · export const x = base44
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression) && node.expression.text === 'base44') {
      fato.reexportsProvider = true;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === 'base44'
    ) {
      const declaracao = node.parent?.parent;
      const exportado = declaracao?.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exportado) fato.reexportsProvider = true;
      return;
    }

    // base44.entities.X · base44.entities['X'] · base44.entities[nome]
    if (ts.isPropertyAccessExpression(node)) {
      for (const [nome, eixo] of [
        ['entities', 'entitiesRefs'],
        ['auth', 'authRefs'],
        ['integrations', 'integrationsRefs'],
        ['functions', 'functionsRefs'],
      ]) {
        if (node.name.text === nome) fato[eixo] += 1;
      }
      if (namespaceDeBase44(node.expression, 'entities') && /^[A-Z]/.test(node.name.text)) {
        fato.literalEntities.add(node.name.text);
      }
      return;
    }

    if (ts.isElementAccessExpression(node) && namespaceDeBase44(node.expression, 'entities')) {
      const nome = literalString(node.argumentExpression);
      if (nome !== null) {
        if (/^[A-Z]/.test(nome)) fato.literalEntities.add(nome);
      } else {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        fato.dynamicEntityAccess.push(`${rel}:${line + 1}:${character + 1}`);
      }
    }
  });

  // ── Segunda passada: o provider escapa por algum export? ────────────────
  // Separada da primeira porque `import` pode aparecer depois de um `export`
  // no texto; só com todos os bindings coletados a detecção é confiável.
  if (fato.providerBindings.size) {
    const temExport = (node) =>
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;

    walk(sourceFile, (node) => {
      // export { empresaProvider } · export { interno as provider }
      if (ts.isExportSpecifier(node) && !node.parent?.parent?.moduleSpecifier) {
        const origem = (node.propertyName || node.name).text;
        if (fato.providerBindings.has(origem)) {
          fato.publicProviderLeaks.push(`export { ${origem} as ${node.name.text} }`);
        }
        return;
      }

      // export default empresaProvider
      if (ts.isExportAssignment(node) && entregaProvider(node.expression, fato.providerBindings)) {
        fato.publicProviderLeaks.push('export default <provider>');
        return;
      }

      // export const provider = … · export function getProvider() { … }
      if (ts.isVariableDeclaration(node) && temExport(node.parent?.parent)) {
        if (entregaProvider(node.initializer, fato.providerBindings)) {
          fato.publicProviderLeaks.push(`export ${node.name.getText(sourceFile)} = <provider>`);
        }
        return;
      }
      if (ts.isFunctionDeclaration(node) && temExport(node) && node.body) {
        if (entregaProvider(node.body, fato.providerBindings)) {
          fato.publicProviderLeaks.push(`export function ${node.name?.text ?? '(anônima)'} → <provider>`);
        }
      }
    });
  }

  return fato;
};

/**
 * Varre `src/` e devolve o retrato completo da fronteira.
 * @param {string} root
 */
export const scanBoundary = (root = process.cwd()) => {
  const srcDir = join(root, 'src');
  const arquivos = walkFiles(srcDir).filter((f) => CODE_EXTS.some((e) => f.endsWith(e)));

  const listas = Object.fromEntries(AXES.map((a) => [a, []]));
  const sdkImporters = [];
  const providerLeaks = [];
  const dynamicEntity = [];
  const dynamicEntityNaFronteira = [];
  const layerBypasses = [];
  const publicProviderLeaks = [];
  const serviceBypasses = [];
  const moduleInternalBypasses = [];
  const entidadesRegistradas = new Set();

  for (const abs of arquivos) {
    const rel = toRelative(root, abs);
    const fato = analyzeFile(readFileSync(abs, 'utf8'), rel);

    // O adapter autorizado não é dívida: ele É a fronteira. Fica fora das
    // listas legadas para que o número signifique "quanto falta migrar".
    const ehAdapterAutorizado = rel === ALLOWED_PROVIDER_ADAPTER;

    if (fato.importsSdk) sdkImporters.push(rel);
    // Só API explícita de módulo pode importar `_providers`. Qualquer outra
    // camada — página, componente, hook, service, repository — está pulando a
    // fronteira mesmo sem tocar em `base44` (P11-R1-B1).
    if (fato.importsProviders && !isModuleApi(rel) && !rel.startsWith(PROVIDERS_DIR)) {
      layerBypasses.push(rel);
    }
    if (fato.importsLegacyClient && !ehAdapterAutorizado) listas.importsLegacyClient.push(rel);
    for (const eixo of ['entitiesRefs', 'authRefs', 'integrationsRefs', 'functionsRefs']) {
      if (fato[eixo] > 0 && !ehAdapterAutorizado) listas[eixo].push(rel);
    }
    if (fato.reexportsProvider) providerLeaks.push(rel);

    // O módulo pode **usar** `_providers` internamente, nunca republicá-lo.
    // Sem esta regra a fronteira vaza de forma transitiva: o consumidor importa
    // `@/apis/empresa` — que o gate autoriza — e recebe o provider (R2-B1).
    for (const leak of fato.publicProviderLeaks) {
      publicProviderLeaks.push(`${rel} — ${leak}`);
    }

    // UI → service → API de módulo → provider. Página, componente ou hook que
    // importe a API pula o service, e com ele a regra de negócio (R2-B2).
    const moduloDoArquivo = moduleOf(rel);
    for (const imp of fato.moduleApiImports) {
      if (imp.modulo === moduloDoArquivo) continue; // irmão dentro do módulo
      if (isUiLayer(rel)) {
        serviceBypasses.push(`${rel} → ${imp.alvo}`);
      } else if (!imp.publico) {
        moduleInternalBypasses.push(`${rel} → ${imp.alvo}`);
      }
    }
    if (fato.dynamicEntityAccess.length) {
      dynamicEntity.push(...fato.dynamicEntityAccess);
      listas.dynamicEntityFiles.push(rel);
      // Dentro da fronteira nova, acesso dinâmico é proibido sempre — não é
      // dívida herdada, é desenho errado.
      if (rel.startsWith('src/apis/')) dynamicEntityNaFronteira.push(...fato.dynamicEntityAccess);
    }

    if (rel === ALLOWED_PROVIDER_ADAPTER) {
      fato.literalEntities.forEach((e) => entidadesRegistradas.add(e));
    }
  }

  for (const eixo of AXES) listas[eixo].sort();

  return {
    listas,
    sdkImporters: sdkImporters.sort(),
    providerLeaks: providerLeaks.sort(),
    dynamicEntity: dynamicEntity.sort(),
    dynamicEntityNaFronteira: dynamicEntityNaFronteira.sort(),
    layerBypasses: layerBypasses.sort(),
    publicProviderLeaks: publicProviderLeaks.sort(),
    serviceBypasses: serviceBypasses.sort(),
    moduleInternalBypasses: moduleInternalBypasses.sort(),
    entidadesRegistradas: [...entidadesRegistradas].sort(),
  };
};

/**
 * Compara duas listas de caminhos.
 * @returns {{novos: string[], removidos: string[]}}
 */
export const diffPaths = (baseline, atual) => {
  const antes = new Set(baseline);
  const agora = new Set(atual);
  return {
    novos: atual.filter((p) => !antes.has(p)),
    removidos: baseline.filter((p) => !agora.has(p)),
  };
};
