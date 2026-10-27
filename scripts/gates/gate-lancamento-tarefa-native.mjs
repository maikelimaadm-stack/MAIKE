#!/usr/bin/env node
/**
 * Gate: LancamentoTarefa + HistoricoLancamentoTarefa nativos (P5.3, D-PROD-49).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.LANCAMENTO_TAREFA_NATIVE_ROOT || process.cwd();

const SCHEMA = 'backend/prisma/schema.prisma';
const BACKEND_MODULO = 'backend/src/modules/lancamentosTarefa';
const ROTAS = 'backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js';
const PORTA_LANCAMENTO = 'src/apis/tarefas/lancamentoTarefaNativePort.js';
const PORTA_HISTORICO = 'src/apis/tarefas/historicoLancamentoTarefaNativePort.js';
const API_MODULO = 'src/apis/tarefas/tarefasApi.js';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const MIGRATIONS = 'backend/prisma/migrations';

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

const verificarModel = (nome) => {
  const models = lerModels(ler(SCHEMA));
  const model = models.find((m) => m.nome === nome);
  if (!model) {
    registrar('P53-LANCAMENTO-MODEL', `schema sem model ${nome}`);
    return;
  }
  if (!campo(model, 'cliente_id')) {
    registrar('P53-LANCAMENTO-MODEL', `${nome} sem cliente_id`);
  }
  const uniqueId = model.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === 'cliente_id' && colunas[1] === 'id'
  );
  if (!uniqueId) {
    registrar('P53-LANCAMENTO-MODEL', `${nome} precisa @@unique([cliente_id, id])`);
  }
};

const verificarMigration = () => {
  const dirMigrations = caminho(MIGRATIONS);
  const temMigration =
    existsSync(dirMigrations) &&
    readdirSync(dirMigrations).some((nome) => {
      const sql = join(dirMigrations, nome, 'migration.sql');
      return (
        existsSync(sql) &&
        /CREATE TABLE "LancamentoTarefa"/.test(readFileSync(sql, 'utf8')) &&
        /CREATE TABLE "HistoricoLancamentoTarefa"/.test(readFileSync(sql, 'utf8'))
      );
    });

  if (!temMigration) {
    registrar('P53-LANCAMENTO-MODEL', 'migration versionada ausente para LancamentoTarefa/Historico');
  }
};

const verificarSemBase44 = () => {
  const provider = semComentarios(ler(PROVIDER));
  for (const ent of ['LancamentoTarefa', 'HistoricoLancamentoTarefa']) {
    if (new RegExp(`base44\\.entities\\.${ent}\\b`).test(provider)) {
      registrar('P53-LANCAMENTO-BASE44', `${PROVIDER} ainda resolve ${ent} pela Base44`);
    }
    if (new RegExp(`comFronteira\\('${ent}'`).test(provider)) {
      registrar('P53-LANCAMENTO-BASE44', `${PROVIDER} ainda registra ${ent}`);
    }
    if (new RegExp(`endpointOf\\(\\s*['"\`]${ent}['"\`]\\s*\\)`).test(provider)) {
      registrar('P53-LANCAMENTO-BASE44', `${PROVIDER} ainda usa endpointOf('${ent}')`);
    }
  }
};

const verificarPortas = () => {
  for (const [rel, http, portName] of [
    [PORTA_LANCAMENTO, /['"`]\/lancamentos-tarefa/, 'lancamentoTarefaPort'],
    [PORTA_HISTORICO, /['"`]\/historicos-lancamento-tarefa/, 'historicoLancamentoTarefaPort'],
  ]) {
    if (!existe(rel)) {
      registrar('P53-LANCAMENTO-PORT', `${rel} ausente`);
      continue;
    }
    const CAMINHO_HTTP = http;
    for (const fonte of listarFontes('src')) {
      if (fonte === rel) continue;
      if (CAMINHO_HTTP.test(semComentarios(ler(fonte)))) {
        registrar('P53-LANCAMENTO-PORT', `${fonte} monta caminho HTTP fora da porta única (${rel})`);
      }
    }
    const porta = semComentarios(ler(rel));
    if (!/tenantScoped\s*:\s*true/.test(porta)) {
      registrar('P53-LANCAMENTO-PORT', `${rel} sem tenantScoped: true`);
    }
    const api = semComentarios(ler(API_MODULO));
    if (!new RegExp(portName).test(api)) {
      registrar('P53-LANCAMENTO-PORT', `${API_MODULO} não usa ${portName}`);
    }
  }
};

const verificarRotas = () => {
  if (!existe(ROTAS)) {
    registrar('P53-LANCAMENTO-ROUTE', `${ROTAS} ausente`);
    return;
  }
  const rotas = semComentarios(ler(ROTAS));
  if (!rotas.includes('/lancamentos-tarefa')) {
    registrar('P53-LANCAMENTO-ROUTE', `${ROTAS} não registra /lancamentos-tarefa`);
  }
  if (!rotas.includes('/historicos-lancamento-tarefa')) {
    registrar('P53-LANCAMENTO-ROUTE', `${ROTAS} não registra /historicos-lancamento-tarefa`);
  }
  if (!/app\s*\.\s*autenticar/.test(rotas)) {
    registrar('P53-LANCAMENTO-ROUTE', `${ROTAS} sem app.autenticar`);
  }
};

if (!existsSync(caminho(BACKEND_MODULO))) {
  registrar('P53-LANCAMENTO-MODEL', `módulo ausente: ${BACKEND_MODULO}`);
}

verificarModel('LancamentoTarefa');
verificarModel('HistoricoLancamentoTarefa');
verificarMigration();
verificarSemBase44();
verificarPortas();
verificarRotas();

if (falhas.length) {
  console.error('gate:lancamento-tarefa-native — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  process.exit(1);
}

console.log('gate:lancamento-tarefa-native — PASSOU');
