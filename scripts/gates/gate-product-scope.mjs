#!/usr/bin/env node
// Gate: escopo do produto — Pecuária Mapa Geral + Manejo.
// SSOT: config/mapa-manejo-scope.json
// Códigos: P01-SCOPE-ROUTE · P01-SCOPE-ENTITY · P01-SCOPE-FUNCTION
//          P01-SCOPE-FUNCTION-ENTITY · P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import {
  listFunctionNames,
  readFunctionFiles,
  extractFunctionEntities,
  findForbiddenEntityStrings,
  findInvokedFunctionsDetailed,
} from './lib/base44-functions.mjs';

const MANIFESTO = 'config/mapa-manejo-scope.json';
const PAGES_CONFIG = 'src/pages.config.js';
const APP = 'src/App.jsx';
const LAYOUT = 'src/Layout.jsx';
const MENU_CONFIG = 'src/lib/menuConfig.js';
const ENTITIES_DIR = 'base44/entities';
const FUNCTIONS_DIR = 'base44/functions';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push(`[${codigo}] ${mensagem}`);

if (!existsSync(MANIFESTO)) {
  console.error(`[P01-SCOPE-ROUTE] manifesto ausente: ${MANIFESTO}`);
  process.exit(1);
}

const scope = JSON.parse(readFileSync(MANIFESTO, 'utf8'));
const allowedPages = new Set(scope.allowedPages || []);
const allowedManualRoutes = new Set(scope.allowedManualRoutes || []);
const allowedEntities = new Set(scope.allowedBase44Entities || []);
const allowedFunctions = new Set(scope.allowedBase44Functions || []);
const forbiddenEntities = scope.forbiddenBase44Entities || [];
const forbidden = scope.forbiddenDomains || [];

const ler = (caminho) => existsSync(caminho) ? readFileSync(caminho, 'utf8') : null;
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 1. Raízes obrigatórias existem
for (const raiz of scope.requiredRoots || []) {
  if (!existsSync(raiz)) registrar('P01-SCOPE-ROUTE', `raiz obrigatória ausente: ${raiz}`);
}

// 2. pages.config.js só registra páginas permitidas + superfície primária correta
const pagesSrc = ler(PAGES_CONFIG);
if (!pagesSrc) {
  registrar('P01-SCOPE-ROUTE', `${PAGES_CONFIG} não encontrado`);
} else {
  const limpo = semComentarios(pagesSrc);
  const registradas = [...limpo.matchAll(/^\s*"([A-Za-z0-9_]+)":/gm)].map((m) => m[1]);
  for (const nome of registradas) {
    if (!allowedPages.has(nome)) registrar('P01-SCOPE-ROUTE', `${PAGES_CONFIG} registra página fora do escopo: ${nome}`);
  }
  for (const nome of allowedPages) {
    if (!registradas.includes(nome)) registrar('P01-SCOPE-ROUTE', `${PAGES_CONFIG} não registra página permitida: ${nome}`);
  }
  const mainPage = limpo.match(/mainPage:\s*"([A-Za-z0-9_]+)"/)?.[1];
  if (mainPage !== scope.primarySurface) {
    registrar('P01-SCOPE-ROUTE', `superfície primária é "${mainPage}", esperado "${scope.primarySurface}"`);
  }
  const importadas = [...limpo.matchAll(/from\s+'\.\/pages\/([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
  for (const nome of importadas) {
    if (!allowedPages.has(nome)) registrar('P01-SCOPE-ROUTE', `${PAGES_CONFIG} importa página fora do escopo: ${nome}`);
  }
}

// 3. App.jsx não pode ter rota manual fora da allowlist
const appSrc = ler(APP);
if (!appSrc) {
  registrar('P01-SCOPE-ROUTE', `${APP} não encontrado`);
} else {
  const limpo = semComentarios(appSrc);
  const rotas = [...limpo.matchAll(/path=\{?["'`]\/([A-Za-z0-9_]+)["'`]/g)].map((m) => m[1]);
  for (const rota of rotas) {
    if (!allowedManualRoutes.has(rota) && !allowedPages.has(rota)) {
      registrar('P01-SCOPE-ROUTE', `${APP} declara rota manual fora do escopo: /${rota}`);
    }
  }
  const importsDePagina = [...limpo.matchAll(/from\s+'\.\/pages\/([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
  for (const nome of importsDePagina) {
    if (!allowedManualRoutes.has(nome)) {
      registrar('P01-SCOPE-ROUTE', `${APP} importa página diretamente (duplica pages.config): ${nome}`);
    }
  }
}

// 4. Layout/menu só podem apontar para páginas permitidas
for (const arquivo of [LAYOUT, MENU_CONFIG]) {
  const src = ler(arquivo);
  if (!src) {
    registrar('P01-SCOPE-ROUTE', `${arquivo} não encontrado`);
    continue;
  }
  const limpo = semComentarios(src);
  const urls = [...limpo.matchAll(/url:\s*["'`]([A-Za-z0-9_]+)["'`]/g)].map((m) => m[1]);
  for (const url of urls) {
    if (!allowedPages.has(url)) registrar('P01-SCOPE-ROUTE', `${arquivo} aponta para página fora do escopo: ${url}`);
  }
  const links = [...limpo.matchAll(/createPageUrl\(\s*["'`]([A-Za-z0-9_]+)["'`]/g)].map((m) => m[1]);
  for (const alvo of links) {
    if (!allowedPages.has(alvo)) registrar('P01-SCOPE-ROUTE', `${arquivo} cria link para página fora do escopo: ${alvo}`);
  }
}

// 5. Domínio proibido citado textualmente em arquivo de registro/rota/menu
const REGISTRO = [PAGES_CONFIG, APP, LAYOUT, MENU_CONFIG];
for (const arquivo of REGISTRO) {
  const src = ler(arquivo);
  if (!src) continue;
  const limpo = semComentarios(src);
  for (const dominio of forbidden) {
    const re = new RegExp(`\\b${dominio}\\b`);
    if (re.test(limpo)) registrar('P01-SCOPE-ROUTE', `${arquivo} referencia domínio proibido: ${dominio}`);
  }
}

// 6. Schemas Base44
if (!existsSync(ENTITIES_DIR)) {
  registrar('P01-SCOPE-ENTITY', `${ENTITIES_DIR} não encontrado`);
} else {
  const schemas = readdirSync(ENTITIES_DIR).filter((f) => f.endsWith('.jsonc')).map((f) => f.replace(/\.jsonc$/, ''));
  for (const nome of schemas) {
    if (!allowedEntities.has(nome)) registrar('P01-SCOPE-ENTITY', `schema Base44 fora do escopo: ${ENTITIES_DIR}/${nome}.jsonc`);
  }
  for (const nome of allowedEntities) {
    if (!schemas.includes(nome)) registrar('P01-SCOPE-ENTITY', `schema Base44 permitido está ausente: ${nome}`);
  }
}

// 7. Functions Base44
if (existsSync(FUNCTIONS_DIR)) {
  const fns = readdirSync(FUNCTIONS_DIR).filter((f) => statSync(`${FUNCTIONS_DIR}/${f}`).isDirectory());
  for (const nome of fns) {
    if (!allowedFunctions.has(nome)) registrar('P01-SCOPE-FUNCTION', `function Base44 fora do escopo: ${FUNCTIONS_DIR}/${nome}`);
  }
  for (const nome of allowedFunctions) {
    if (!fns.includes(nome)) registrar('P01-SCOPE-FUNCTION', `function Base44 permitida está ausente: ${nome}`);
  }
} else if (allowedFunctions.size > 0) {
  registrar('P01-SCOPE-FUNCTION', `${FUNCTIONS_DIR} não encontrado, mas o manifesto exige functions`);
}

// 8. Fechamento de entidades DENTRO das functions permitidas.
//    Não basta a pasta existir: o código não pode citar schema fora do manifesto.
for (const nome of listFunctionNames(FUNCTIONS_DIR)) {
  const arquivos = readFunctionFiles(nome, FUNCTIONS_DIR).filter((a) => a.source.trim());
  if (!arquivos.length) {
    registrar('P01-SCOPE-FUNCTION', `function ${nome} não tem código legível`);
    continue;
  }

  for (const { path: caminho, source } of arquivos) {
    const { sources, targets, dynamic, unverifiable } = extractFunctionEntities(source, caminho);

    for (const entidade of sources) {
      if (!allowedEntities.has(entidade)) {
        registrar('P01-SCOPE-FUNCTION-ENTITY', `${nome}: chave-fonte de propagação fora do manifesto: ${entidade}`);
      }
    }
    for (const entidade of targets) {
      if (!allowedEntities.has(entidade)) {
        registrar('P01-SCOPE-FUNCTION-ENTITY', `${nome}: destino de propagação fora do manifesto: ${entidade}`);
      }
    }
    for (const entidade of dynamic) {
      if (!allowedEntities.has(entidade)) {
        registrar('P01-SCOPE-FUNCTION-ENTITY', `${nome}: acesso dinâmico a entidade fora do manifesto: ${entidade}`);
      }
    }

    // Nome que só existe em tempo de execução não pode ser declarado dentro do
    // escopo — o gate reprova por não conseguir provar o fechamento.
    for (const ocorrencia of unverifiable) {
      registrar('P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE', `${nome}: ${ocorrencia}`);
    }

    for (const entidade of findForbiddenEntityStrings(source, forbiddenEntities, caminho)) {
      registrar('P01-SCOPE-FUNCTION-ENTITY', `${nome}: cita entidade excluída em código executável: ${entidade}`);
    }

    const invocacoes = findInvokedFunctionsDetailed(source, caminho);
    for (const invocada of invocacoes.invoked) {
      if (!allowedFunctions.has(invocada)) {
        registrar('P01-SCOPE-FUNCTION', `${nome}: invoca function fora do manifesto: ${invocada}`);
      }
    }
    for (const ocorrencia of invocacoes.unverifiable) {
      registrar('P01-SCOPE-FUNCTION-DYNAMIC-UNVERIFIABLE', `${nome}: ${ocorrencia}`);
    }
  }
}

if (falhas.length) {
  console.error('gate:product-scope — FALHOU\n');
  falhas.forEach((f) => console.error(`  - ${f}`));
  console.error(`\n${falhas.length} violação(ões). SSOT: ${MANIFESTO}`);
  process.exit(1);
}

console.log(`gate:product-scope — PASSOU (${allowedPages.size} páginas, ${allowedEntities.size} entidades, ${allowedFunctions.size} function(s))`);
