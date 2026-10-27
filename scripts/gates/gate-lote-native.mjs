#!/usr/bin/env node
/**
 * Gate: Lote nativo (P5.1, D-PROD-47).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.LOTE_NATIVE_ROOT || process.cwd();

const SCHEMA = 'backend/prisma/schema.prisma';
const BACKEND_MODULO = 'backend/src/modules/lotes';
const ROTAS = 'backend/src/modules/lotes/loteRoutes.js';
const SERVICE_BACKEND = 'backend/src/modules/lotes/loteService.js';
const REPOSITORIO = 'backend/src/modules/lotes/loteRepository.js';
const PORTA = 'src/apis/lotes/loteNativePort.js';
const API_MODULO = 'src/apis/lotes/lotesApi.js';
const SERVICE_FRONT = 'src/services/loteCadastroService.js';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const MIGRATIONS = 'backend/prisma/migrations';

const MODEL = 'Lote';
const TENANT = 'cliente_id';

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

const verificarModel = () => {
  if (!existe(SCHEMA)) {
    registrar('P51-LOTE-MODEL', `${SCHEMA} não encontrado`);
    return;
  }

  const models = lerModels(ler(SCHEMA));
  const lote = models.find((m) => m.nome === MODEL);
  if (!lote) {
    registrar('P51-LOTE-MODEL', `schema sem model ${MODEL}`);
    return;
  }

  if (!campo(lote, TENANT)) {
    registrar('P51-LOTE-MODEL', `${MODEL} sem cliente_id`);
  }

  const uniqueNumero = lote.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'numero_lote'
  );
  if (!uniqueNumero) {
    registrar('P51-LOTE-MODEL', `${MODEL} precisa @@unique([cliente_id, numero_lote])`);
  }

  const uniqueId = lote.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'id'
  );
  if (!uniqueId) {
    registrar('P51-LOTE-MODEL', `${MODEL} precisa @@unique([cliente_id, id])`);
  }

  const dirMigrations = caminho(MIGRATIONS);
  const temMigration =
    existsSync(dirMigrations) &&
    readdirSync(dirMigrations).some((nome) => {
      const sql = join(dirMigrations, nome, 'migration.sql');
      return existsSync(sql) && /CREATE TABLE "Lote"/.test(readFileSync(sql, 'utf8'));
    });

  if (!temMigration) {
    registrar('P51-LOTE-MODEL', 'migration versionada ausente para Lote');
  }
};

const verificarNumeracao = () => {
  if (!existe(SERVICE_BACKEND)) {
    registrar('P51-LOTE-NUMBERING', `${SERVICE_BACKEND} ausente`);
    return;
  }

  const codigo = semComentarios(ler(SERVICE_BACKEND));
  if (!/\breservarNumero\s*\(/.test(codigo)) {
    registrar('P51-LOTE-NUMBERING', `${SERVICE_BACKEND} não chama reservarNumero()`);
  }

  const proibidos = [
    { padrao: /\bMAX\s*\(/i, o_que: 'MAX(' },
    { padrao: /Math\s*\.\s*max\s*\(/, o_que: 'Math.max(' },
  ];

  for (const rel of [SERVICE_BACKEND, REPOSITORIO, SERVICE_FRONT, PORTA, API_MODULO].filter(existe)) {
    const fonte = semComentarios(ler(rel));
    for (const { padrao, o_que } of proibidos) {
      if (padrao.test(fonte)) {
        registrar('P51-LOTE-NUMBERING', `${rel} usa ${o_que} no caminho de Lote`);
      }
    }
  }

  if (existe(SERVICE_FRONT) && /\bproximoNumeroLote\b/.test(semComentarios(ler(SERVICE_FRONT)))) {
    registrar('P51-LOTE-NUMBERING', `${SERVICE_FRONT} ainda usa proximoNumeroLote na criação`);
  }
};

const verificarSemBase44 = () => {
  if (!existe(PROVIDER)) {
    registrar('P51-LOTE-BASE44', `${PROVIDER} ausente`);
    return;
  }

  const provider = semComentarios(ler(PROVIDER));
  if (/base44\.entities\.Lote\b/.test(provider) || /endpointOf\(\s*['"`]Lote['"`]\s*\)/.test(provider)) {
    registrar('P51-LOTE-BASE44', `${PROVIDER} ainda resolve Lote pela Base44`);
  }
  if (/comFronteira\(\s*['"`]Lote['"`]/.test(provider)) {
    registrar('P51-LOTE-BASE44', `${PROVIDER} ainda registra Lote`);
  }
};

const verificarPorta = () => {
  if (!existe(PORTA)) {
    registrar('P51-LOTE-PORT', `${PORTA} ausente`);
    return;
  }

  const CAMINHO_HTTP = /['"`]\/lotes/;
  for (const rel of listarFontes('src')) {
    if (rel === PORTA) continue;
    if (CAMINHO_HTTP.test(semComentarios(ler(rel)))) {
      registrar('P51-LOTE-PORT', `${rel} monta /lotes fora da porta única`);
    }
  }

  const porta = semComentarios(ler(PORTA));
  if (!/tenantScoped\s*:\s*true/.test(porta)) {
    registrar('P51-LOTE-PORT', `${PORTA} sem tenantScoped: true`);
  }

  const api = semComentarios(ler(API_MODULO));
  if (!/lotePort/.test(api)) {
    registrar('P51-LOTE-PORT', `${API_MODULO} não usa lotePort para CRUD`);
  }
  if (/lotesProvider\.(listLotes|createLote|updateLote|deleteLote|filterLotes)/.test(api)) {
    registrar('P51-LOTE-PORT', `${API_MODULO} ainda delega CRUD de lote ao lotesProvider`);
  }
};

const verificarRotas = () => {
  if (!existe(ROTAS)) {
    registrar('P51-LOTE-ROUTE', `${ROTAS} ausente`);
    return;
  }

  const rotas = semComentarios(ler(ROTAS));
  if (!rotas.includes('/lotes')) {
    registrar('P51-LOTE-ROUTE', `${ROTAS} não registra /lotes`);
  }
  if (!/app\s*\.\s*autenticar/.test(rotas)) {
    registrar('P51-LOTE-ROUTE', `${ROTAS} sem app.autenticar`);
  }
};

if (!existsSync(caminho(BACKEND_MODULO))) {
  registrar('P51-LOTE-MODEL', `módulo ausente: ${BACKEND_MODULO}`);
}

verificarModel();
verificarNumeracao();
verificarSemBase44();
verificarPorta();
verificarRotas();

if (falhas.length) {
  console.error('gate:lote-native — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  process.exit(1);
}

console.log('gate:lote-native — PASSOU');
