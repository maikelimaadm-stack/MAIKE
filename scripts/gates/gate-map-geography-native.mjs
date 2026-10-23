#!/usr/bin/env node
/**
 * Gate: geografia do mapa nativa (P4.3, D-PROD-32).
 *
 * ConfiguracaoIcone, PontoReferencia, LinhaGeografica — absoluto, sem baseline.
 *
 * Códigos:
 *   P43-MAP-MODEL · P43-MAP-NUMBERING · P43-MAP-DELETE-PONTO · P43-MAP-NO-DELETE-LINHA
 *   P43-MAP-BASE44 · P43-MAP-PORT · P43-MAP-TENANT-SOURCE · P43-MAP-FALLBACK
 *   P43-MAP-AUDIT · P43-MAP-ROUTE-AUTH · P43-MAP-OFFLINE-TENANT · P43-MAP-SINGLE-OWNER
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.MAP_GEOGRAPHY_NATIVE_ROOT || process.cwd();

const SCHEMA = 'backend/prisma/schema.prisma';
const ROTAS = 'backend/src/modules/mapGeography/mapGeographyRoutes.js';
const SERVICE_PONTO = 'backend/src/modules/mapGeography/pontoReferenciaService.js';
const SERVICE_LINHA = 'backend/src/modules/mapGeography/linhaGeograficaService.js';
const PORTA = 'src/apis/mapaGeografia/mapaGeografiaNativePort.js';
const API_MODULO = 'src/apis/mapaGeografia/mapaGeografiaApi.js';
const MAPA_API = 'src/apis/mapa/mapaApi.js';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const MIGRATIONS = 'backend/prisma/migrations';

const ENTIDADES = ['ConfiguracaoIcone', 'PontoReferencia', 'LinhaGeografica'];
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

const lerModel = (codigo, nome) => {
  if (!existe(SCHEMA)) {
    registrar(codigo, `${SCHEMA} não encontrado`);
    return null;
  }
  let models;
  try {
    models = lerModels(ler(SCHEMA));
  } catch (erro) {
    registrar(codigo, `${SCHEMA} ilegível: ${erro.message}`);
    return null;
  }
  const encontrado = models.find((m) => m.nome === nome);
  if (!encontrado) registrar(codigo, `o schema não declara model ${nome}`);
  return encontrado || null;
};

const verificarModels = () => {
  for (const nome of ENTIDADES) {
    const model = lerModel('P43-MAP-MODEL', nome);
    if (!model) continue;
    if (!campo(model, TENANT)) {
      registrar('P43-MAP-MODEL', `${nome} não declara ${TENANT}`);
    }
    const uniqueRef = model.uniques.some(
      (colunas) => colunas.length === 2 && colunas[0] === TENANT && colunas[1] === 'id'
    );
    if (!uniqueRef) {
      registrar('P43-MAP-MODEL', `${nome} precisa de @@unique([${TENANT}, id])`);
    }
    if (nome === 'PontoReferencia') {
      const u = model.uniques.some(
        (c) => c.length === 2 && c[0] === TENANT && c[1] === 'numero_ponto'
      );
      if (!u) registrar('P43-MAP-MODEL', `${nome} precisa de @@unique([${TENANT}, numero_ponto])`);
    }
    if (nome === 'LinhaGeografica') {
      const u = model.uniques.some(
        (c) => c.length === 2 && c[0] === TENANT && c[1] === 'numero_linha'
      );
      if (!u) registrar('P43-MAP-MODEL', `${nome} precisa de @@unique([${TENANT}, numero_linha])`);
    }
    const empresa = campo(model, 'empresa_id');
    if (empresa && empresa.tipo !== 'String') {
      registrar('P43-MAP-MODEL', `${nome}.empresa_id deve ser String nesta fase`);
    }
  }

  for (const tabela of ENTIDADES) {
    const temMigration = existsSync(caminho(MIGRATIONS))
      ? readdirSync(caminho(MIGRATIONS)).some((nome) => {
          const sql = join(caminho(MIGRATIONS), nome, 'migration.sql');
          return existsSync(sql) && new RegExp(`CREATE TABLE "${tabela}"`).test(readFileSync(sql, 'utf8'));
        })
      : false;
    if (!temMigration) {
      registrar('P43-MAP-MODEL', `nenhuma migration versionada cria a tabela "${tabela}"`);
    }
  }
};

const verificarNumeracao = () => {
  for (const [arquivo, entidade] of [
    [SERVICE_PONTO, 'numero_ponto'],
    [SERVICE_LINHA, 'numero_linha'],
  ]) {
    if (!existe(arquivo)) {
      registrar('P43-MAP-NUMBERING', `${arquivo} não encontrado`);
      continue;
    }
    const codigo = semComentarios(ler(arquivo));
    if (!/\breservarNumero\s*\(/.test(codigo)) {
      registrar('P43-MAP-NUMBERING', `${arquivo} não chama reservarNumero()`);
    }
    if (!/\$transaction\s*\(/.test(codigo)) {
      registrar('P43-MAP-NUMBERING', `${arquivo} não abre $transaction`);
    }
    for (const fonte of [PORTA, API_MODULO, MAPA_API].filter(existe)) {
      const corpo = semComentarios(ler(fonte));
      if (new RegExp(`${entidade}\\s*[:=][^;\\n]*\\b(Math\\.max|\\.length\\s*\\+\\s*1)`).test(corpo)) {
        registrar('P43-MAP-NUMBERING', `${fonte} calcula ${entidade} no cliente`);
      }
    }
  }
};

const verificarDeletePonto = () => {
  if (!existe(ROTAS)) {
    registrar('P43-MAP-DELETE-PONTO', `${ROTAS} não encontrado`);
    return;
  }
  const codigo = semComentarios(ler(ROTAS));
  if (!/\/pontos-referencia\/:id/.test(codigo) || !/app\.delete\s*\(\s*['"]\/pontos-referencia/.test(codigo)) {
    registrar('P43-MAP-DELETE-PONTO', `${ROTAS} precisa declarar DELETE /pontos-referencia/:id`);
  }
  if (existe(PORTA)) {
    const porta = semComentarios(ler(PORTA));
    if (!/\bdelete\s*:/.test(porta) || !/deletePonto/.test(porta)) {
      registrar('P43-MAP-DELETE-PONTO', `${PORTA} precisa expor operação delete para ponto`);
    }
  }
};

const verificarSemDeleteLinha = () => {
  if (!existe(ROTAS)) return;
  const codigo = semComentarios(ler(ROTAS));
  if (/app\.delete\s*\(\s*['"]\/linhas-geograficas/.test(codigo)) {
    registrar('P43-MAP-NO-DELETE-LINHA', `${ROTAS} não deve declarar DELETE de linha (baixa lógica)`);
  }
  if (existe(PORTA)) {
    const porta = semComentarios(ler(PORTA));
    const blocoLinha = /operacoesLinha[\s\S]*?Object\.freeze/.exec(porta);
    if (blocoLinha && /\bdelete\s*:/.test(blocoLinha[0])) {
      registrar('P43-MAP-NO-DELETE-LINHA', `${PORTA} não deve declarar delete para linha`);
    }
  }
};

const verificarBase44 = () => {
  if (existe(PROVIDER)) {
    const provider = semComentarios(ler(PROVIDER));
    for (const ent of ENTIDADES) {
      if (new RegExp(`endpointOf\\(\\s*['"]${ent}['"]\\s*\\)`).test(provider)) {
        registrar('P43-MAP-BASE44', `${PROVIDER} ainda resolve endpoint de ${ent}`);
      }
      if (new RegExp(`${ent}:\\s*comFronteira\\(`).test(provider)) {
        registrar('P43-MAP-BASE44', `${PROVIDER} ainda registra ${ent} no ENTITY_REGISTRY`);
      }
    }
  }
  for (const fonte of listarFontes('src')) {
    const corpo = semComentarios(ler(fonte));
    if (/\bmapaProvider\.(listPontos|createPonto|updatePonto|deletePonto|listLinhas|createLinha|updateLinha|listIcones|createIcone|updateIcone)\b/.test(corpo)) {
      registrar('P43-MAP-BASE44', `${fonte} chama mapaProvider para geografia nativa`);
    }
  }
};

const verificarPorta = () => {
  if (!existe(PORTA)) {
    registrar('P43-MAP-PORT', `${PORTA} não encontrado`);
    return;
  }
  const porta = semComentarios(ler(PORTA));
  if (!/\bnativeRequest\s*\(/.test(porta)) {
    registrar('P43-MAP-PORT', `${PORTA} não usa nativeRequest`);
  }
  for (const caminhoHttp of [
    '/configuracao-icones',
    '/pontos-referencia',
    '/linhas-geograficas',
  ]) {
    if (!new RegExp(`['"]${caminhoHttp.replace('/', '\\/')}['"]`).test(porta)) {
      registrar('P43-MAP-PORT', `${PORTA} não declara caminho ${caminhoHttp}`);
    }
  }
};

const verificarOrigemDoTenant = () => {
  for (const arquivo of [SERVICE_PONTO, SERVICE_LINHA].filter(existe)) {
    const codigo = semComentarios(ler(arquivo));
    if (/\b(body|query|params|headers|cookies?)\s*(\.|\[\s*['"])\s*cliente_id/.test(codigo)) {
      registrar('P43-MAP-TENANT-SOURCE', `${arquivo} lê cliente_id da requisição`);
    }
    if (!/cliente_id:\s*auth\.clienteId/.test(codigo)) {
      registrar('P43-MAP-TENANT-SOURCE', `${arquivo} não grava cliente_id a partir de auth.clienteId`);
    }
  }
};

const verificarFallback = () => {
  for (const fonte of [PORTA, API_MODULO].filter(existe)) {
    const codigo = semComentarios(ler(fonte));
    if (/catch[\s\S]{0,200}?\b(mapaProvider|base44)\b/.test(codigo)) {
      registrar('P43-MAP-FALLBACK', `${fonte} cai para Base44 num catch`);
    }
  }
};

const verificarAuditoria = () => {
  for (const [arquivo, ent] of [
    ['backend/src/modules/mapGeography/configuracaoIconeService.js', 'ConfiguracaoIcone'],
    [SERVICE_PONTO, 'PontoReferencia'],
    [SERVICE_LINHA, 'LinhaGeografica'],
  ]) {
    if (!existe(arquivo)) {
      registrar('P43-MAP-AUDIT', `${arquivo} não encontrado`);
      continue;
    }
    const codigo = semComentarios(ler(arquivo));
    const eventos = codigo.match(/registrarEvento\s*\(/g) || [];
    if (eventos.length < 2) {
      registrar('P43-MAP-AUDIT', `${arquivo} precisa auditar create e update (≥2 eventos)`);
    }
    if (!new RegExp(`entidade:\\s*['"]${ent}['"]`).test(codigo)) {
      registrar('P43-MAP-AUDIT', `${arquivo} não identifica entidade ${ent} na auditoria`);
    }
  }
  if (existe(SERVICE_PONTO)) {
    const codigo = semComentarios(ler(SERVICE_PONTO));
    if (!/acao:\s*['"]delete['"]/.test(codigo)) {
      registrar('P43-MAP-AUDIT', `${SERVICE_PONTO} precisa auditar exclusão de ponto`);
    }
  }
};

const verificarRotas = () => {
  if (!existe(ROTAS)) {
    registrar('P43-MAP-ROUTE-AUTH', `${ROTAS} não encontrado`);
    return;
  }
  const codigo = semComentarios(ler(ROTAS));
  const declaracoes = codigo.match(/app\.(get|post|patch|put|delete)\s*\(/g) || [];
  const autenticadas = codigo.match(/onRequest:\s*\[\s*app\.autenticar\s*\]/g) || [];
  if (declaracoes.length === 0) {
    registrar('P43-MAP-ROUTE-AUTH', `${ROTAS} não declara rota alguma`);
  } else if (autenticadas.length !== declaracoes.length) {
    registrar(
      'P43-MAP-ROUTE-AUTH',
      `${ROTAS} tem ${declaracoes.length} rota(s) e ${autenticadas.length} autenticada(s)`
    );
  }
  const fechados = codigo.match(/additionalProperties:\s*false/g) || [];
  if (fechados.length < 6) {
    registrar('P43-MAP-ROUTE-AUTH', `${ROTAS} precisa de schemas fechados em todas as escritas`);
  }
};

const verificarOfflineTenant = () => {
  if (!existe(PORTA)) return;
  const porta = semComentarios(ler(PORTA));
  const count = (porta.match(/tenantScoped:\s*true/g) || []).length;
  if (count < 3) {
    registrar('P43-MAP-OFFLINE-TENANT', `${PORTA} precisa tenantScoped: true nas três portas`);
  }
};

const verificarDonoUnico = () => {
  if (!existe(MAPA_API)) return;
  const codigo = semComentarios(ler(MAPA_API));
  const reexporta = /export\s*\{[^}]*\blistPontos\b[^}]*\}\s*from\s*['"]@\/apis\/mapaGeografia['"]/.test(
    codigo
  );
  if (!reexporta) {
    registrar('P43-MAP-SINGLE-OWNER', `${MAPA_API} precisa reexportar geografia de @/apis/mapaGeografia`);
  }
  if (/export\s+const\s+listPontos\s*=/.test(codigo)) {
    registrar('P43-MAP-SINGLE-OWNER', `${MAPA_API} não deve manter implementação própria de listPontos`);
  }
};

const executar = () => {
  verificarModels();
  verificarNumeracao();
  verificarDeletePonto();
  verificarSemDeleteLinha();
  verificarBase44();
  verificarPorta();
  verificarOrigemDoTenant();
  verificarFallback();
  verificarAuditoria();
  verificarRotas();
  verificarOfflineTenant();
  verificarDonoUnico();

  if (falhas.length === 0) {
    console.log('gate:map-geography-native — PASSOU (12 regras verificadas)');
    return 0;
  }

  console.error(`gate:map-geography-native — REPROVOU (${falhas.length} falha(s))\n`);
  for (const { codigo, mensagem } of falhas) {
    console.error(`  [${codigo}] ${mensagem}`);
  }
  console.error('');
  return 1;
};

const ehEntradaDireta = () =>
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (ehEntradaDireta()) {
  process.exit(executar());
}

export { executar, falhas };
