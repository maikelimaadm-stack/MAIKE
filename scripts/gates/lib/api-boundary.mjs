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
export const isModuleApi = (rel) => {
  if (!rel.startsWith('src/apis/')) return false;
  const modulo = rel.slice('src/apis/'.length).split('/')[0];
  return Boolean(modulo) && !modulo.startsWith('_');
};

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
  };

  /** Registra o carregamento do SDK ou do provider por um especificador. */
  const registrarEspecificador = (spec) => {
    if (spec === SDK_PACKAGE) fato.importsSdk = true;
    if (LEGACY_CLIENT_SPECIFIERS.includes(spec)) fato.importsLegacyClient = true;
    if (targetsProviders(spec, rel)) fato.importsProviders = true;
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
