#!/usr/bin/env node
/**
 * Gate: GrupoAtividade + TipoTarefa nativos (P5.0, D-PROD-45).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.TAREFA_CADASTRO_NATIVE_ROOT || process.cwd();

const SCHEMA = 'backend/prisma/schema.prisma';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const API_TAREFAS = 'src/apis/tarefas/tarefasApi.js';
const PORTA_GRUPO = 'src/apis/tarefas/grupoAtividadeNativePort.js';
const PORTA_TIPO = 'src/apis/tarefas/tipoTarefaNativePort.js';
const MIGRATIONS = 'backend/prisma/migrations';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const verificarModel = (nome, uniqueExtra) => {
  const models = lerModels(ler(SCHEMA));
  const model = models.find((m) => m.nome === nome);
  if (!model) {
    registrar('P50-TAREFA-CADASTRO-MODEL', `schema sem model ${nome}`);
    return;
  }
  if (!campo(model, 'cliente_id')) {
    registrar('P50-TAREFA-CADASTRO-MODEL', `${nome} sem cliente_id`);
  }
  const uniqueId = model.uniques.some(
    (colunas) => colunas.length === 2 && colunas[0] === 'cliente_id' && colunas[1] === 'id'
  );
  if (!uniqueId) {
    registrar('P50-TAREFA-CADASTRO-MODEL', `${nome} precisa @@unique([cliente_id, id])`);
  }
  if (uniqueExtra && !model.uniques.some((colunas) => JSON.stringify(colunas) === JSON.stringify(uniqueExtra))) {
    registrar('P50-TAREFA-CADASTRO-MODEL', `${nome} precisa unique ${JSON.stringify(uniqueExtra)}`);
  }
};

const verificarMigration = () => {
  const dir = caminho(MIGRATIONS);
  const ok =
    existsSync(dir) &&
    readdirSync(dir).some((nome) => {
      const sql = join(dir, nome, 'migration.sql');
      return (
        existsSync(sql) &&
        /CREATE TABLE "GrupoAtividade"/.test(readFileSync(sql, 'utf8')) &&
        /CREATE TABLE "TipoTarefa"/.test(readFileSync(sql, 'utf8'))
      );
    });
  if (!ok) {
    registrar('P50-TAREFA-CADASTRO-MODEL', 'migration versionada ausente para GrupoAtividade/TipoTarefa');
  }
};

const verificarSemBase44 = () => {
  const provider = semComentarios(ler(PROVIDER));
  for (const ent of ['GrupoAtividade', 'TipoTarefa']) {
    if (new RegExp(`base44\\.entities\\.${ent}\\b`).test(provider)) {
      registrar('P50-TAREFA-CADASTRO-BASE44', `${PROVIDER} ainda resolve ${ent} pela Base44`);
    }
    if (new RegExp(`comFronteira\\('${ent}'`).test(provider)) {
      registrar('P50-TAREFA-CADASTRO-BASE44', `${PROVIDER} ainda registra ${ent}`);
    }
  }
};

const verificarPortas = () => {
  for (const [rel, http] of [
    [PORTA_GRUPO, '/grupos-atividade'],
    [PORTA_TIPO, '/tipos-tarefa'],
  ]) {
    if (!existe(rel)) {
      registrar('P50-TAREFA-CADASTRO-PORT', `${rel} ausente`);
      continue;
    }
    const porta = semComentarios(ler(rel));
    if (!porta.includes(http)) {
      registrar('P50-TAREFA-CADASTRO-PORT', `${rel} não aponta para ${http}`);
    }
    if (!/tenantScoped\s*:\s*true/.test(porta)) {
      registrar('P50-TAREFA-CADASTRO-PORT', `${rel} sem tenantScoped: true`);
    }
  }

  const api = semComentarios(ler(API_TAREFAS));
  if (!/grupoAtividadePort/.test(api) || !/tipoTarefaPort/.test(api)) {
    registrar('P50-TAREFA-CADASTRO-PORT', `${API_TAREFAS} não usa as portas nativas`);
  }
  if (/tarefasProvider\.(listTipos|createTipo|listGrupos|createGrupo)/.test(api)) {
    registrar('P50-TAREFA-CADASTRO-PORT', `${API_TAREFAS} ainda delega cadastro ao tarefasProvider`);
  }
};

const verificarRotas = () => {
  for (const [rel, pathPrefix] of [
    ['backend/src/modules/gruposAtividade/grupoAtividadeRoutes.js', '/grupos-atividade'],
    ['backend/src/modules/tiposTarefa/tipoTarefaRoutes.js', '/tipos-tarefa'],
  ]) {
    if (!existe(rel)) {
      registrar('P50-TAREFA-CADASTRO-ROUTE', `${rel} ausente`);
      continue;
    }
    const rotas = semComentarios(ler(rel));
    if (!rotas.includes(pathPrefix)) {
      registrar('P50-TAREFA-CADASTRO-ROUTE', `${rel} não registra ${pathPrefix}`);
    }
    if (!/app\s*\.\s*autenticar/.test(rotas)) {
      registrar('P50-TAREFA-CADASTRO-ROUTE', `${rel} sem app.autenticar`);
    }
  }
};

if (!existe(SCHEMA)) {
  registrar('P50-TAREFA-CADASTRO-MODEL', SCHEMA);
} else {
  verificarModel('GrupoAtividade', ['cliente_id', 'nome_grupo']);
  verificarModel('TipoTarefa', ['cliente_id', 'grupo_atividade_id', 'nome_tipo']);
  verificarMigration();
}
verificarSemBase44();
verificarPortas();
verificarRotas();

if (falhas.length) {
  console.error('gate:tarefa-cadastro-native — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  process.exit(1);
}

console.log('gate:tarefa-cadastro-native — PASSOU');
