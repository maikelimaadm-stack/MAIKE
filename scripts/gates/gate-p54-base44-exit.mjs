#!/usr/bin/env node
/**
 * Gate: P5.4 — Empresa, estoque, suplementação, permissões (D-PROD-50+).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.cwd();
const SCHEMA = 'backend/prisma/schema.prisma';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const MIGRATIONS = 'backend/prisma/migrations';

const ENTIDADES = [
  { model: 'Empresa', codigo: 'P54-EMPRESA', caminho: '/empresas', porta: 'src/apis/empresa/empresaNativePort.js', tabela: 'Empresa' },
  { model: 'Permissao', codigo: 'P54-PERMISSAO', caminho: '/permissoes', porta: 'src/apis/permissoes/permissaoNativePort.js', tabela: 'Permissao' },
  { model: 'Fornecedor', codigo: 'P54-FORNECEDOR', caminho: '/fornecedores', porta: 'src/apis/fornecedores/fornecedorNativePort.js', tabela: 'Fornecedor' },
  { model: 'CategoriaManejo', codigo: 'P54-CAT_MANEJO', caminho: '/categorias-manejo', porta: 'src/apis/categorias-manejo/categoriaManejoNativePort.js', tabela: 'CategoriaManejo' },
  { model: 'Bebedouro', codigo: 'P54-BEBEDOURO', caminho: '/bebedouros', porta: 'src/apis/bebedouros/bebedouroNativePort.js', tabela: 'Bebedouro' },
  { model: 'PontoSuplementacao', codigo: 'P54-PONTO_SUP', caminho: '/pontos-suplementacao', porta: 'src/apis/pontos-suplementacao/pontoSuplementacaoNativePort.js', tabela: 'PontoSuplementacao' },
  { model: 'EstoqueLoteNota', codigo: 'P54-LOTE_NOTA', caminho: '/estoque-lotes-nota', porta: 'src/apis/estoque-lotes-nota/estoqueLoteNotaNativePort.js', tabela: 'EstoqueLoteNota' },
  { model: 'MovimentacaoEstoque', codigo: 'P54-MOV_ESTOQUE', caminho: '/movimentacoes-estoque', porta: 'src/apis/movimentacoes-estoque/movimentacaoEstoqueNativePort.js', tabela: 'MovimentacaoEstoque' },
];

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });
const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

let models;
try {
  models = lerModels(ler(SCHEMA));
} catch (erro) {
  registrar('P54-MODEL', `${SCHEMA} ilegível: ${erro.message}`);
  models = [];
}

for (const ent of ENTIDADES) {
  const m = models.find((item) => item.nome === ent.model);
  if (!m) {
    registrar(`${ent.codigo}-MODEL`, `schema sem model ${ent.model}`);
    continue;
  }
  if (!campo(m, 'cliente_id')) {
    registrar(`${ent.codigo}-MODEL`, `${ent.model} sem cliente_id`);
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
    registrar(`${ent.codigo}-MIGRATION`, `migration ausente para ${ent.tabela}`);
  }

  if (!existe(ent.porta)) {
    registrar(`${ent.codigo}-PORT`, `${ent.porta} não encontrado`);
  } else if (!/nativeRequest\s*\(/.test(semComentarios(ler(ent.porta)))) {
    registrar(`${ent.codigo}-PORT`, `${ent.porta} sem nativeRequest`);
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
  console.error('gate:p54-base44-exit REPROVOU\n');
  for (const f of falhas) console.error(`  [${f.codigo}] ${f.mensagem}`);
  process.exit(1);
}

console.log('gate:p54-base44-exit OK');
