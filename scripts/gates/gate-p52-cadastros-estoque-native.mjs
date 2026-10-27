#!/usr/bin/env node
/**
 * Gate: Categoria, LocalEstoque e Produto nativos (P5.2, D-PROD-48).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.cwd();
const SCHEMA = 'backend/prisma/schema.prisma';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const MIGRATIONS = 'backend/prisma/migrations';

const ENTIDADES = [
  {
    model: 'Categoria',
    codigo: 'P52-CATEGORIA',
    backend: 'backend/src/modules/categorias',
    porta: 'src/apis/categorias/categoriaNativePort.js',
    api: 'src/apis/categorias/categoriasApi.js',
    caminho: '/categorias',
    tabela: 'Categoria',
    numero: 'numero_categoria',
  },
  {
    model: 'LocalEstoque',
    codigo: 'P52-LOCAL_ESTOQUE',
    backend: 'backend/src/modules/locaisEstoque',
    porta: 'src/apis/locais-estoque/localEstoqueNativePort.js',
    api: 'src/apis/locais-estoque/locaisEstoqueApi.js',
    caminho: '/locais-estoque',
    tabela: 'LocalEstoque',
    numero: 'numero_local',
  },
  {
    model: 'Produto',
    codigo: 'P52-PRODUTO',
    backend: 'backend/src/modules/produtos',
    porta: 'src/apis/produtos/produtoNativePort.js',
    api: 'src/apis/produtos/produtosApi.js',
    caminho: '/produtos',
    tabela: 'Produto',
    numero: 'numero_produto',
  },
];

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const listarFontes = (dirRel) => {
  const base = caminho(dirRel);
  if (!existsSync(base)) return [];
  const encontrados = [];
  const andar = (atual) => {
    for (const nome of readdirSync(atual)) {
      const completo = join(atual, nome);
      if (statSync(completo).isDirectory()) {
        if (nome === 'node_modules' || nome === '.git') continue;
        andar(completo);
        continue;
      }
      if (/\.(js|jsx)$/.test(nome)) encontrados.push(relative(ROOT, completo).split('\\').join('/'));
    }
  };
  andar(base);
  return encontrados;
};

let models;
try {
  models = lerModels(ler(SCHEMA));
} catch (erro) {
  registrar('P52-MODEL', `${SCHEMA} ilegível: ${erro.message}`);
  models = [];
}

for (const ent of ENTIDADES) {
  const m = models.find((item) => item.nome === ent.model);
  if (!m) {
    registrar(`${ent.codigo}-MODEL`, `schema sem model ${ent.model}`);
    continue;
  }
  if (!campo(m, ent.numero)) {
    registrar(`${ent.codigo}-MODEL`, `${ent.model} sem ${ent.numero}`);
  }
  if (!m.uniques.some((u) => u[0] === 'cliente_id' && u[1] === 'id')) {
    registrar(`${ent.codigo}-MODEL`, `${ent.model} precisa @@unique([cliente_id, id])`);
  }

  const dirMigrations = caminho(MIGRATIONS);
  const temMigration =
    existsSync(dirMigrations) &&
    readdirSync(dirMigrations).some((nome) => {
      const sql = join(dirMigrations, nome, 'migration.sql');
      return existsSync(sql) && new RegExp(`CREATE TABLE "${ent.tabela}"`).test(readFileSync(sql, 'utf8'));
    });
  if (!temMigration) {
    registrar(`${ent.codigo}-MODEL`, `migration ausente para ${ent.tabela}`);
  }

  if (!existe(ent.porta)) {
    registrar(`${ent.codigo}-PORT`, `${ent.porta} não encontrado`);
  } else if (!/createOfflineEntityAdapter\s*\(/.test(semComentarios(ler(ent.porta)))) {
    registrar(`${ent.codigo}-PORT`, `${ent.porta} sem offline adapter`);
  }

  const servicePath = `${ent.backend}/${ent.model === 'LocalEstoque' ? 'localEstoque' : ent.model === 'Categoria' ? 'categoria' : 'produto'}Service.js`;
  if (!existe(servicePath) || !/\breservarNumero\s*\(/.test(semComentarios(ler(servicePath)))) {
    registrar(`${ent.codigo}-NUMBERING`, `${servicePath} não chama reservarNumero`);
  }

  const re = new RegExp(`['"\`]${ent.caminho.replace('/', '\\/')}['"\`]`);
  for (const rel of listarFontes('src')) {
    if (rel === ent.porta) continue;
    if (rel.startsWith('src/apis/_providers/')) continue;
    if (rel.includes('/produtos/') || rel.includes('/categorias/') || rel.includes('/locais-estoque/')) {
      if (rel.endsWith('Api.js') || rel.endsWith('NativePort.js') || rel.endsWith('/index.js')) continue;
    }
    if (re.test(semComentarios(ler(rel)))) {
      registrar(`${ent.codigo}-PORT`, `${rel} monta ${ent.caminho} fora da porta`);
      break;
    }
  }
}

if (existe(PROVIDER)) {
  const provider = semComentarios(ler(PROVIDER));
  for (const ent of ENTIDADES) {
    if (new RegExp(`base44\\.entities\\.${ent.model}\\b`).test(provider)) {
      registrar(`${ent.codigo}-BASE44`, `${PROVIDER} ainda referencia Base44.${ent.model}`);
    }
    if (new RegExp(`endpointOf\\(\\s*['"\`]${ent.model}['"\`]\\s*\\)`).test(provider)) {
      registrar(`${ent.codigo}-BASE44`, `${PROVIDER} ainda usa endpointOf('${ent.model}')`);
    }
  }
}

if (falhas.length) {
  console.error('gate:p52-cadastros-estoque-native REPROVOU\n');
  for (const f of falhas) console.error(`  [${f.codigo}] ${f.mensagem}`);
  process.exit(1);
}

console.log('gate:p52-cadastros-estoque-native OK');
