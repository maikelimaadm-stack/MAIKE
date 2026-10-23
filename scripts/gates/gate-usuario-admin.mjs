#!/usr/bin/env node
/**
 * Gate: administração de Usuario nativa (P6.0, D-PROD-34).
 *
 * Absoluto, sem baseline. Códigos:
 *   P60-UA-MODEL · P60-UA-ROUTE · P60-UA-SENHA · P60-UA-PORT · P60-UA-SESSION
 *   P60-UA-SERVICE · P60-UA-APP · P60-UA-AUDIT · P60-UA-TENANT-SOURCE
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.USUARIO_ADMIN_ROOT || process.cwd();

const SCHEMA = 'backend/prisma/schema.prisma';
const ROTAS = 'backend/src/modules/usuarios/usuarioRoutes.js';
const SERVICE = 'backend/src/modules/usuarios/usuarioService.js';
const REPO = 'backend/src/modules/usuarios/usuarioRepository.js';
const APP = 'backend/src/app.js';
const PORTA = 'src/apis/usuarios/usuarioNativePort.js';
const API = 'src/apis/usuarios/usuariosApi.js';
const SESSION_API = 'src/apis/session/sessionApi.js';
const SERVICE_FRONT = 'src/services/usuarioAdminService.js';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');

const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const verificarModel = () => {
  if (!existe(SCHEMA)) {
    registrar('P60-UA-MODEL', `${SCHEMA} não encontrado`);
    return;
  }
  let models;
  try {
    models = lerModels(ler(SCHEMA));
  } catch (erro) {
    registrar('P60-UA-MODEL', `${SCHEMA} ilegível: ${erro.message}`);
    return;
  }
  const usuario = models.find((m) => m.nome === 'Usuario');
  if (!usuario) {
    registrar('P60-UA-MODEL', 'model Usuario ausente');
    return;
  }
  const clienteId = campo(usuario, 'cliente_id');
  if (!clienteId || clienteId.opcional) {
    registrar('P60-UA-MODEL', 'Usuario.cliente_id precisa ser obrigatório');
  }
  const uniques = usuario.uniques || [];
  if (!uniques.some((u) => u.includes('cliente_id') && u.includes('login'))) {
    registrar('P60-UA-MODEL', 'Usuario precisa @@unique([cliente_id, login])');
  }
};

const verificarRotas = () => {
  if (!existe(ROTAS)) {
    registrar('P60-UA-ROUTE', `${ROTAS} não encontrado`);
    return;
  }
  const codigo = semComentarios(ler(ROTAS));
  if (/app\.delete\s*\(\s*['"]\/usuarios/.test(codigo)) {
    registrar('P60-UA-ROUTE', 'não existe rota DELETE /usuarios');
  }
  for (const rota of ["app.get('/usuarios'", 'app.get("/usuarios"', "app.post('/usuarios'", 'app.post("/usuarios"']) {
    if (!codigo.includes(rota.split('(')[0])) {
      // fallback: check methods
    }
  }
  if (!/\/usuarios['"]/.test(codigo)) {
    registrar('P60-UA-ROUTE', `${ROTAS} não declara /usuarios`);
  }
  const declaracoes = codigo.match(/app\.(get|post|patch|put|delete)\s*\(/g) || [];
  const autenticadas = codigo.match(/onRequest:\s*\[\s*app\.autenticar\s*\]/g) || [];
  if (declaracoes.length > 0 && autenticadas.length !== declaracoes.length) {
    registrar(
      'P60-UA-ROUTE',
      `${ROTAS} tem ${declaracoes.length} rota(s) e ${autenticadas.length} autenticada(s)`
    );
  }
  if (!/additionalProperties:\s*false/.test(codigo)) {
    registrar('P60-UA-ROUTE', `${ROTAS} precisa schemas com additionalProperties: false`);
  }
};

const verificarSenha = () => {
  if (!existe(REPO)) {
    registrar('P60-UA-SENHA', `${REPO} não encontrado`);
    return;
  }
  const repo = semComentarios(ler(REPO));
  if (/senha_hash:\s*true/.test(repo)) {
    registrar('P60-UA-SENHA', `${REPO} não pode selecionar senha_hash na saída pública`);
  }
  if (existe(SERVICE)) {
    const service = semComentarios(ler(SERVICE));
    const fnPublico =
      service.match(/export const comoUsuarioPublico\s*=[\s\S]*?\}\)\s*;/)?.[0] ?? '';
    if (fnPublico && /senha_hash/.test(fnPublico)) {
      registrar('P60-UA-SENHA', `${SERVICE} expõe senha_hash em comoUsuarioPublico`);
    }
  }
};

const verificarPorta = () => {
  if (!existe(PORTA)) {
    registrar('P60-UA-PORT', `${PORTA} não encontrado`);
    return;
  }
  const porta = semComentarios(ler(PORTA));
  if (!/\bnativeRequest\s*\(/.test(porta)) {
    registrar('P60-UA-PORT', `${PORTA} não usa nativeRequest`);
  }
  if (!/['"]\/usuarios['"]/.test(porta)) {
    registrar('P60-UA-PORT', `${PORTA} não declara caminho /usuarios`);
  }
  if (!existe(API)) {
    registrar('P60-UA-PORT', `${API} não encontrado`);
  }
};

const verificarSession = () => {
  if (!existe(SESSION_API)) {
    registrar('P60-UA-SESSION', `${SESSION_API} não encontrado`);
    return;
  }
  const codigo = semComentarios(ler(SESSION_API));
  if (!/export\s*\{\s*listUsuarios\s*\}\s*from\s*['"]@\/apis\/usuarios['"]/.test(codigo)) {
    registrar('P60-UA-SESSION', `${SESSION_API} precisa reexportar listUsuarios de @/apis/usuarios`);
  }
  if (/sessionProvider\.listUsuarios/.test(codigo)) {
    registrar('P60-UA-SESSION', `${SESSION_API} não pode listar usuários via Base44 User`);
  }
  if (/sessionProvider\.updateUsuario/.test(codigo)) {
    registrar('P60-UA-SESSION', `${SESSION_API} não pode atualizar usuários via Base44 User`);
  }
};

const verificarServiceFront = () => {
  if (!existe(SERVICE_FRONT)) {
    registrar('P60-UA-SERVICE', `${SERVICE_FRONT} não encontrado`);
    return;
  }
  const codigo = semComentarios(ler(SERVICE_FRONT));
  if (!/from\s*['"]@\/apis\/usuarios['"]/.test(codigo)) {
    registrar('P60-UA-SERVICE', `${SERVICE_FRONT} precisa usar @/apis/usuarios`);
  }
};

const verificarApp = () => {
  if (!existe(APP)) {
    registrar('P60-UA-APP', `${APP} não encontrado`);
    return;
  }
  const codigo = semComentarios(ler(APP));
  if (!/registrarUsuarioRoutes/.test(codigo)) {
    registrar('P60-UA-APP', `${APP} precisa registrar registrarUsuarioRoutes`);
  }
};

const verificarAuditoria = () => {
  if (!existe(SERVICE)) {
    registrar('P60-UA-AUDIT', `${SERVICE} não encontrado`);
    return;
  }
  const codigo = semComentarios(ler(SERVICE));
  const eventos = codigo.match(/registrarEvento\s*\(/g) || [];
  if (eventos.length < 2) {
    registrar('P60-UA-AUDIT', `${SERVICE} precisa auditar create e update`);
  }
  if (!/entidade:\s*['"]Usuario['"]/.test(codigo)) {
    registrar('P60-UA-AUDIT', `${SERVICE} não identifica entidade Usuario na auditoria`);
  }
};

const verificarTenantSource = () => {
  if (!existe(SERVICE)) return;
  const codigo = semComentarios(ler(SERVICE));
  if (/\b(body|query|params|headers)\s*(\.|\[\s*['"])\s*cliente_id/.test(codigo)) {
    registrar('P60-UA-TENANT-SOURCE', `${SERVICE} lê cliente_id da requisição`);
  }
  if (!/auth\.clienteId/.test(codigo)) {
    registrar('P60-UA-TENANT-SOURCE', `${SERVICE} não usa auth.clienteId`);
  }
};

const executar = () => {
  verificarModel();
  verificarRotas();
  verificarSenha();
  verificarPorta();
  verificarSession();
  verificarServiceFront();
  verificarApp();
  verificarAuditoria();
  verificarTenantSource();

  if (falhas.length === 0) {
    console.log('gate:usuario-admin — PASSOU (9 regras verificadas)');
    return 0;
  }

  console.error(`gate:usuario-admin — REPROVOU (${falhas.length} falha(s))\n`);
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
