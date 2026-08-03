/**
 * Analisador estático das functions Base44 preservadas.
 *
 * Extrai as entidades citadas por uma function para que `gate:product-scope`
 * possa provar que ela não referencia schema fora de
 * `config/mapa-manejo-scope.json`.
 *
 * P0.1-R2: a extração é feita sobre a **AST** do TypeScript, não sobre regex de
 * texto. A versão anterior dependia de indentação (`^ {2}Nome: [`) e de aspas —
 * quatro espaços, tab ou chave entre aspas escapavam do gate. Formatação não
 * pode decidir se o escopo do produto está fechado.
 *
 * Códigos: P01-SCOPE-FUNCTION-ENTITY · P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export const FUNCTIONS_DIR = 'base44/functions';

/**
 * Remove comentários de bloco e de linha.
 * Mantido para uso textual; a análise de entidades não depende dele.
 */
export const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Lista os diretórios de function existentes.
 * @param {string} dir
 * @returns {string[]} nomes de function, ordenados
 */
export const listFunctionNames = (dir = FUNCTIONS_DIR) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
};

/**
 * Lê os arquivos de código de uma function, um a um.
 * @returns {Array<{path: string, source: string}>}
 */
export const readFunctionFiles = (name, dir = FUNCTIONS_DIR) => {
  const base = join(dir, name);
  if (!existsSync(base)) return [];
  const arquivos = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(current, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) arquivos.push({ path: p, source: readFileSync(p, 'utf8') });
    }
  };
  walk(base);
  return arquivos;
};

/** Lê e concatena todos os arquivos de código de uma function. */
export const readFunctionSource = (name, dir = FUNCTIONS_DIR) =>
  readFunctionFiles(name, dir)
    .map((a) => a.source)
    .join('\n');

// ── AST ───────────────────────────────────────────────────────────────────

const parse = (source, fileName = 'entry.ts') =>
  ts.createSourceFile(fileName, String(source).replace(/\r\n/g, '\n'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const walk = (node, visit) => {
  visit(node);
  node.forEachChild((filho) => walk(filho, visit));
};

/** Texto de um nome de propriedade, quando ele é literal. */
const literalPropertyName = (name) => {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const arg = name.expression;
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  }
  return null;
};

/** Texto de uma expressão, quando ela é string literal. */
const literalString = (node) => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
};

/** Descasca `as const`, parênteses e `Object.freeze(...)`. */
const unwrap = (node) => {
  let atual = node;
  for (let i = 0; i < 10 && atual; i += 1) {
    if (ts.isParenthesizedExpression(atual) || ts.isAsExpression(atual) || ts.isSatisfiesExpression?.(atual)) {
      atual = atual.expression;
      continue;
    }
    if (
      ts.isCallExpression(atual) &&
      ts.isPropertyAccessExpression(atual.expression) &&
      atual.expression.name.text === 'freeze' &&
      atual.arguments.length === 1
    ) {
      atual = atual.arguments[0];
      continue;
    }
    break;
  }
  return atual;
};

/** A expressão termina em `entities`? (`base44.asServiceRole.entities`, `entities`) */
const isEntitiesRef = (node) => {
  if (!node) return false;
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return isEntitiesRef(node.expression);
  if (ts.isIdentifier(node)) return node.text === 'entities';
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'entities';
  return false;
};

/** A expressão termina em `functions`? */
const isFunctionsRef = (node) => {
  if (!node) return false;
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return isFunctionsRef(node.expression);
  if (ts.isIdentifier(node)) return node.text === 'functions';
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'functions';
  return false;
};

const posicao = (sourceFile, node) => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${line + 1}:${character + 1}`;
};

/**
 * Extrai as entidades citadas por uma function.
 *
 * Cobre:
 *  - chaves de primeiro nível de `PROPAGATION_RULES`, em qualquer indentação,
 *    com ou sem aspas, com ou sem vírgula final;
 *  - destinos `entity: 'X'`;
 *  - acessos `entities.X` e `entities['X']`.
 *
 * Acesso computado com valor não literal (`entities[nome]`) é **não
 * verificável** e reprova — o gate não pode afirmar fechamento sobre um nome
 * que só existe em tempo de execução.
 *
 * @param {string} source
 * @param {string} [fileName]
 * @returns {{sources: string[], targets: string[], dynamic: string[], unverifiable: string[], all: string[]}}
 */
export const extractFunctionEntities = (source, fileName = 'entry.ts') => {
  const sourceFile = parse(source, fileName);

  const sources = new Set();
  const targets = new Set();
  const dynamic = new Set();
  const unverifiable = new Set();
  /** Intervalo textual do objeto PROPAGATION_RULES, para localizar os destinos. */
  let intervaloRegras = null;

  // 1. PROPAGATION_RULES — chaves de primeiro nível.
  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node)) return;
    if (!ts.isIdentifier(node.name) || node.name.text !== 'PROPAGATION_RULES') return;

    const inicializador = unwrap(node.initializer);
    if (inicializador) intervaloRegras = [inicializador.getStart(sourceFile), inicializador.getEnd()];
    if (!inicializador || !ts.isObjectLiteralExpression(inicializador)) {
      unverifiable.add(
        `${fileName}:${posicao(sourceFile, node)} — PROPAGATION_RULES não é um objeto literal analisável`
      );
      return;
    }

    for (const prop of inicializador.properties) {
      if (ts.isSpreadAssignment(prop)) {
        unverifiable.add(
          `${fileName}:${posicao(sourceFile, prop)} — PROPAGATION_RULES usa spread: chaves não verificáveis`
        );
        continue;
      }
      const nome = literalPropertyName(prop.name);
      if (nome === null) {
        unverifiable.add(
          `${fileName}:${posicao(sourceFile, prop)} — chave computada em PROPAGATION_RULES não é verificável`
        );
        continue;
      }
      sources.add(nome);
    }
  });

  // 2. Destinos `entity: 'X'` e 3. acessos a `entities`.
  walk(sourceFile, (node) => {
    if (ts.isPropertyAssignment(node) && literalPropertyName(node.name) === 'entity') {
      const valor = literalString(node.initializer);
      if (valor !== null) {
        targets.add(valor);
        return;
      }
      // `entity:` fora de PROPAGATION_RULES é campo de resposta, não destino de
      // propagação. Só o que está dentro das regras precisa ser literal.
      const dentroDasRegras =
        intervaloRegras &&
        node.getStart(sourceFile) >= intervaloRegras[0] &&
        node.getEnd() <= intervaloRegras[1];
      if (dentroDasRegras) {
        unverifiable.add(
          `${fileName}:${posicao(sourceFile, node)} — destino "entity" com valor não literal não é verificável`
        );
      }
      return;
    }

    if (ts.isPropertyAccessExpression(node) && isEntitiesRef(node.expression)) {
      const nome = node.name.text;
      if (/^[A-Z]/.test(nome)) dynamic.add(nome);
      return;
    }

    if (ts.isElementAccessExpression(node) && isEntitiesRef(node.expression)) {
      const nome = literalString(node.argumentExpression);
      if (nome !== null) {
        if (/^[A-Z]/.test(nome)) dynamic.add(nome);
      } else {
        unverifiable.add(
          `${fileName}:${posicao(sourceFile, node)} — acesso computado a "entities" com valor não literal`
        );
      }
    }
  });

  const all = [...new Set([...sources, ...targets, ...dynamic])].sort();
  return {
    sources: [...sources].sort(),
    targets: [...targets].sort(),
    dynamic: [...dynamic].sort(),
    unverifiable: [...unverifiable].sort(),
    all,
  };
};

/**
 * Procura nomes de entidade proibidos citados em código executável.
 * Comparação exata sobre literais e nomes de propriedade da AST — comentários
 * não contam e substring não gera falso positivo.
 *
 * @param {string} source
 * @param {string[]} forbiddenEntities
 * @param {string} [fileName]
 * @returns {string[]}
 */
export const findForbiddenEntityStrings = (source, forbiddenEntities = [], fileName = 'entry.ts') => {
  if (!forbiddenEntities.length) return [];
  const proibidas = new Set(forbiddenEntities);
  const sourceFile = parse(source, fileName);
  const encontradas = new Set();

  walk(sourceFile, (node) => {
    const texto = literalString(node);
    if (texto !== null && proibidas.has(texto)) {
      encontradas.add(texto);
      return;
    }
    if (ts.isPropertyAccessExpression(node) && proibidas.has(node.name.text)) {
      encontradas.add(node.name.text);
      return;
    }
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name) {
      const nome = literalPropertyName(node.name);
      if (nome && proibidas.has(nome)) encontradas.add(nome);
    }
  });

  return [...encontradas].sort();
};

/**
 * Procura invocações de outras functions Base44 dentro do código.
 * @param {string} source
 * @param {string} [fileName]
 * @returns {{invoked: string[], unverifiable: string[]}}
 */
export const findInvokedFunctionsDetailed = (source, fileName = 'entry.ts') => {
  const sourceFile = parse(source, fileName);
  const invoked = new Set();
  const unverifiable = new Set();

  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const alvo = node.expression;
    if (!ts.isPropertyAccessExpression(alvo)) return;

    if (alvo.name.text === 'invoke' && isFunctionsRef(alvo.expression)) {
      const nome = literalString(node.arguments[0]);
      if (nome !== null) invoked.add(nome);
      else {
        unverifiable.add(
          `${fileName}:${posicao(sourceFile, node)} — functions.invoke com nome não literal`
        );
      }
      return;
    }

    if (isFunctionsRef(alvo.expression)) invoked.add(alvo.name.text);
  });

  return { invoked: [...invoked].sort(), unverifiable: [...unverifiable].sort() };
};

/** Compatibilidade: só a lista de nomes. */
export const findInvokedFunctions = (source, fileName = 'entry.ts') =>
  findInvokedFunctionsDetailed(source, fileName).invoked;
