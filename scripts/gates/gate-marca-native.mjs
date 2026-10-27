#!/usr/bin/env node
/**
 * Gate: Marca nativa (P4.4-Marcas, D-PROD-42).
 *
 * Absoluto, como `gate:setor-native`: sem baseline e sem escrita de arquivo.
 *
 * Códigos:
 *   P44-MARCA-MODEL · P44-MARCA-NUMBERING · P44-MARCA-DELETE
 *   P44-MARCA-BASE44 · P44-MARCA-PORT · P44-MARCA-TENANT-SOURCE
 *   P44-MARCA-OFFLINE-ID · P44-MARCA-FALLBACK · P44-MARCA-AUDIT
 *   P44-MARCA-ROUTE-AUTH · P44-MARCA-OFFLINE-TENANT
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.MARCA_NATIVE_ROOT || process.cwd();

const SCHEMA = 'backend/prisma/schema.prisma';
const BACKEND_MODULO = 'backend/src/modules/marcas';
const ROTAS = 'backend/src/modules/marcas/marcaRoutes.js';
const SERVICE_BACKEND = 'backend/src/modules/marcas/marcaService.js';
const REPOSITORIO = 'backend/src/modules/marcas/marcaRepository.js';
const PORTA = 'src/apis/marcas/marcaNativePort.js';
const API_MODULO = 'src/apis/marcas/marcasApi.js';
const SERVICE_FRONT = 'src/services/marcaService.js';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const MIGRATIONS = 'backend/prisma/migrations';

const MODEL = 'Marca';
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
    registrar('P44-MARCA-MODEL', `${SCHEMA} não encontrado`);
    return;
  }

  let models;
  try {
    models = lerModels(ler(SCHEMA));
  } catch (erro) {
    registrar('P44-MARCA-MODEL', `${SCHEMA} ilegível: ${erro.message}`);
    return;
  }

  const marca = models.find((m) => m.nome === MODEL);
  if (!marca) {
    registrar('P44-MARCA-MODEL', `o schema não declara model ${MODEL}`);
    return;
  }

  if (!campo(marca, 'numero_marca')) {
    registrar('P44-MARCA-MODEL', `${MODEL} não declara numero_marca`);
  }
  const uniquePorNumero = marca.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'numero_marca'
  );
  if (!uniquePorNumero) {
    registrar('P44-MARCA-MODEL', `${MODEL} precisa de @@unique([${TENANT}, numero_marca])`);
  }

  const uniqueReferenciavel = marca.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'id'
  );
  if (!uniqueReferenciavel) {
    registrar('P44-MARCA-MODEL', `${MODEL} precisa de @@unique([${TENANT}, id])`);
  }

  const dirMigrations = caminho(MIGRATIONS);
  const temMigration = existsSync(dirMigrations)
    ? readdirSync(dirMigrations).some((nome) => {
        const sql = join(dirMigrations, nome, 'migration.sql');
        return existsSync(sql) && /CREATE TABLE "Marca"/.test(readFileSync(sql, 'utf8'));
      })
    : false;

  if (!temMigration) {
    registrar('P44-MARCA-MODEL', 'nenhuma migration versionada cria a tabela "Marca"');
  }
};

const verificarNumeracao = () => {
  if (!existe(SERVICE_BACKEND)) {
    registrar('P44-MARCA-NUMBERING', `${SERVICE_BACKEND} não encontrado`);
    return;
  }

  const codigo = semComentarios(ler(SERVICE_BACKEND));

  if (!/\breservarNumero\s*\(/.test(codigo)) {
    registrar('P44-MARCA-NUMBERING', `${SERVICE_BACKEND} não chama reservarNumero()`);
  }
  if (!/\$transaction\s*\(/.test(codigo)) {
    registrar('P44-MARCA-NUMBERING', `${SERVICE_BACKEND} não abre $transaction na criação`);
  }

  const proibidos = [
    { padrao: /\bMAX\s*\(/i, o_que: 'MAX(' },
    { padrao: /Math\s*\.\s*max\s*\(/, o_que: 'Math.max(' },
  ];

  for (const rel of [SERVICE_BACKEND, REPOSITORIO, SERVICE_FRONT, PORTA, API_MODULO].filter(existe)) {
    const fonte = semComentarios(ler(rel));
    for (const { padrao, o_que } of proibidos) {
      if (padrao.test(fonte)) {
        registrar('P44-MARCA-NUMBERING', `${rel} usa ${o_que} no caminho de Marca`);
      }
    }
  }

  if (existe(SERVICE_FRONT) && /\bproximoNumeroDeMarca\b/.test(semComentarios(ler(SERVICE_FRONT)))) {
    registrar('P44-MARCA-NUMBERING', `${SERVICE_FRONT} reintroduziu proximoNumeroDeMarca`);
  }
};

const verificarExclusao = () => {
  if (!existe(ROTAS)) {
    registrar('P44-MARCA-DELETE', `${ROTAS} não encontrado`);
    return;
  }

  const rotas = semComentarios(ler(ROTAS));
  if (!/\.\s*delete\s*\(\s*['"`]\/marcas/.test(rotas)) {
    registrar('P44-MARCA-DELETE', `${ROTAS} precisa registrar DELETE /marcas/:id`);
  }

  if (!existe(API_MODULO) || !/\bexport const deleteMarca\b/.test(semComentarios(ler(API_MODULO)))) {
    registrar('P44-MARCA-DELETE', `${API_MODULO} precisa exportar deleteMarca`);
  }

  if (existe(PORTA)) {
    const porta = semComentarios(ler(PORTA));
    if (!/\bdelete\s*:/.test(porta)) {
      registrar('P44-MARCA-DELETE', `${PORTA} precisa declarar operação delete`);
    }
  }
};

const verificarSemBase44 = () => {
  if (!existe(PROVIDER)) {
    registrar('P44-MARCA-BASE44', `${PROVIDER} não encontrado`);
    return;
  }

  const provider = semComentarios(ler(PROVIDER));

  if (/base44\.entities\.Marca\b/.test(provider) || /endpointOf\(\s*['"`]Marca['"`]\s*\)/.test(provider)) {
    registrar('P44-MARCA-BASE44', `${PROVIDER} voltou a resolver Marca pela Base44`);
  }

  if (/\bmarcasProvider\b/.test(provider)) {
    registrar('P44-MARCA-BASE44', `${PROVIDER} reintroduziu marcasProvider`);
  }

  if (existe(PORTA) && /base44/i.test(semComentarios(ler(PORTA)))) {
    registrar('P44-MARCA-BASE44', `${PORTA} referencia a Base44`);
  }
};

const verificarPortaUnica = () => {
  if (!existe(PORTA)) {
    registrar('P44-MARCA-PORT', `${PORTA} não encontrado`);
    return;
  }

  const CAMINHO_HTTP = /['"`]\/marcas/;
  for (const rel of listarFontes('src')) {
    if (rel === PORTA) continue;
    if (CAMINHO_HTTP.test(semComentarios(ler(rel)))) {
      registrar('P44-MARCA-PORT', `${rel} monta o caminho HTTP /marcas fora da porta única`);
    }
  }

  const porta = semComentarios(ler(PORTA));
  if (!/createOfflineEntityAdapter\s*\(/.test(porta)) {
    registrar('P44-MARCA-PORT', `${PORTA} não compõe createOfflineEntityAdapter`);
  }
};

const verificarFonteDeTenant = () => {
  if (existe(PORTA) && /\bcliente_id\b/.test(semComentarios(ler(PORTA)))) {
    registrar('P44-MARCA-TENANT-SOURCE', `${PORTA} cita cliente_id no corpo`);
  }

  if (existe(ROTAS)) {
    const rotas = semComentarios(ler(ROTAS));
    if (!/additionalProperties\s*:\s*false/.test(rotas)) {
      registrar('P44-MARCA-TENANT-SOURCE', `${ROTAS} precisa de additionalProperties: false`);
    }
    if (/\bcliente_id\b/.test(rotas)) {
      registrar('P44-MARCA-TENANT-SOURCE', `${ROTAS} declara cliente_id no schema HTTP`);
    }
  }
};

const verificarIdentidadeOffline = () => {
  if (!existe(PORTA)) return;

  const porta = semComentarios(ler(PORTA));

  if (!/corpoDeEnvio\s*\(/.test(porta)) {
    registrar('P44-MARCA-OFFLINE-ID', `${PORTA} não filtra o corpo por lista de campos`);
  }

  for (const proibido of ['numero_marca', '_isOffline']) {
    if (new RegExp(`['"\`]${proibido}['"\`]`).test(porta)) {
      registrar('P44-MARCA-OFFLINE-ID', `${PORTA} lista "${proibido}" entre campos enviados`);
    }
  }
};

const verificarDonoDoOffline = () => {
  if (existe(PORTA) && !/tenantScoped\s*:\s*true/.test(semComentarios(ler(PORTA)))) {
    registrar('P44-MARCA-OFFLINE-TENANT', `${PORTA} não declara tenantScoped: true`);
  }
};

const verificarSemFallback = () => {
  for (const rel of [PORTA, API_MODULO, SERVICE_FRONT].filter(existe)) {
    const fonte = semComentarios(ler(rel));
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(fonte)) {
      registrar('P44-MARCA-FALLBACK', `${rel} tem catch silencioso`);
    }
    if (/catch[\s\S]{0,300}?(marcasProvider|base44)/i.test(fonte)) {
      registrar('P44-MARCA-FALLBACK', `${rel} cai para a Base44 em caso de erro`);
    }
  }
};

const verificarAuditoria = () => {
  if (!existe(SERVICE_BACKEND)) return;

  const codigo = semComentarios(ler(SERVICE_BACKEND));
  if (!/registrarEvento\s*\(/.test(codigo)) {
    registrar('P44-MARCA-AUDIT', `${SERVICE_BACKEND} não registra auditoria`);
  }
};

const verificarAutenticacao = () => {
  if (!existe(ROTAS)) return;

  const rotas = semComentarios(ler(ROTAS));
  const registros = [...rotas.matchAll(/app\s*\.\s*(get|post|patch|put|delete)\s*\(([\s\S]*?)\n\s*\}\s*\)\s*;/g)];

  for (const [, metodo, corpo] of registros) {
    if (!/onRequest\s*:\s*\[\s*app\s*\.\s*autenticar\s*\]/.test(corpo)) {
      registrar(
        'P44-MARCA-ROUTE-AUTH',
        `${ROTAS}: rota ${metodo.toUpperCase()} sem app.autenticar`
      );
    }
  }
};

if (!existsSync(caminho(BACKEND_MODULO))) {
  registrar('P44-MARCA-MODEL', `módulo ausente: ${BACKEND_MODULO}`);
}

verificarModel();
verificarNumeracao();
verificarExclusao();
verificarSemBase44();
verificarPortaUnica();
verificarFonteDeTenant();
verificarIdentidadeOffline();
verificarDonoDoOffline();
verificarSemFallback();
verificarAuditoria();
verificarAutenticacao();

if (falhas.length) {
  console.error('gate:marca-native — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  process.exit(1);
}

console.log('gate:marca-native — PASSOU');
