#!/usr/bin/env node
/**
 * Gate: GrupoAtividade + TipoTarefa nativos (P5.0, D-PROD-45) e TipoAtividade
 * nativo (D-PROD-182: model, migration, porta e rotas).
 *
 * D-PROD-196 revê a D-PROD-182 só no ponto "TipoAtividade sem flags": o
 * TipoAtividade passa a TER as 8 flags de como a atividade funciona (`Boolean
 * @default(false)` no model, `BOOLEAN NOT NULL DEFAULT false` na migration, nas
 * rotas e na porta) e continua SEM os nomes que o TipoTarefa aposentou
 * (`pode_ter_produto`, `pode_ter_maquina`, `pode_ter_implemento`): nem no model,
 * nem em migration, nem no código da porta ou das rotas (lá eles caem no
 * `additionalProperties: false`, 400). O TipoTarefa não ganha flag nenhuma: nem
 * as 4 que saíram (D-PROD-181/183) nem as 8 do TipoAtividade.
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
const PORTA_TIPO_ATIVIDADE = 'src/apis/atividades/tipoAtividadePort.js';
const ROTAS_TIPO_ATIVIDADE = 'backend/src/modules/tiposAtividade/tipoAtividadeRoutes.js';
/** D-PROD-196 (contrato §3.5): o módulo puro com FLAGS_TIPO_ATIVIDADE, de onde as rotas tiram as 8 flags. */
const PADROES_TIPO_ATIVIDADE = 'backend/src/modules/tiposAtividade/tipoAtividadePadroes.js';
/** D-PROD-181: nomes aposentados no TipoTarefa; no TipoAtividade continuam proibidos (D-PROD-196). */
const FLAGS_APOSENTADAS = Object.freeze(['pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento']);
/** D-PROD-196: as 8 flags do TipoAtividade, nesta ordem. */
const FLAGS_TIPO_ATIVIDADE = Object.freeze([
  'exige_area', 'exige_safra', 'exige_maquina', 'permite_implemento',
  'permite_produto', 'permite_servico', 'permite_mao_obra', 'exige_producao',
]);
/** D-PROD-181/183 + D-PROD-196: nada volta ao TipoTarefa — as 4 antigas e as 8 do TipoAtividade (11 nomes). */
const FLAGS_PROIBIDAS_TIPO_TAREFA = Object.freeze([...new Set(['exige_area', ...FLAGS_APOSENTADAS, ...FLAGS_TIPO_ATIVIDADE])]);
const MIGRATIONS = 'backend/prisma/migrations';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const existe = (rel) => existsSync(caminho(rel));
const ler = (rel) => readFileSync(caminho(rel), 'utf8');
const semComentarios = (fonte) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
/** Nome citado como identificador ou string (`campo`, 'campo', "campo", `campo:`), fora de comentário. */
const cita = (codigo, nome) => new RegExp(`(^|[^A-Za-z0-9_])${nome}([^A-Za-z0-9_]|$)`).test(codigo);

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

/** Todas as migrations versionadas: nome da pasta e instruções (sem comentários, espaços normalizados). */
const lerMigrations = () => {
  const dir = caminho(MIGRATIONS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((nome) => existsSync(join(dir, nome, 'migration.sql')))
    .sort()
    .map((nome) => {
      const sql = readFileSync(join(dir, nome, 'migration.sql'), 'utf8');
      const instrucoes = sql.replace(/--[^\n]*/g, '').split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
      return { nome, sql, instrucoes };
    });
};

/**
 * TipoAtividade nas migrations: exatamente 1 CREATE TABLE versionado (D-PROD-182), com a FK composta para
 * GrupoAtividade; nenhuma instrução que crie ou altere TipoAtividade cita um nome aposentado; e as 8 flags entram
 * como `BOOLEAN NOT NULL DEFAULT false` (D-PROD-196: as linhas que já existiam leem false). Nenhuma migration
 * acrescenta flag ao TipoTarefa.
 */
const verificarMigrationsTipoAtividade = () => {
  const migrations = lerMigrations();
  const criacoes = migrations.filter((m) => /CREATE TABLE "TipoAtividade"/.test(m.sql));
  if (criacoes.length !== 1) {
    registrar('P50-TAREFA-CADASTRO-MODEL', `esperada exatamente 1 migration versionada com CREATE TABLE "TipoAtividade" (achadas ${criacoes.length})`);
  } else if (!/FOREIGN KEY \("cliente_id", "grupo_atividade_id"\) REFERENCES "GrupoAtividade"\("cliente_id", "id"\)/.test(criacoes[0].sql)) {
    registrar('P50-TAREFA-CADASTRO-MODEL', 'migration de TipoAtividade sem FK composta (cliente_id, grupo_atividade_id) → GrupoAtividade');
  }
  for (const m of migrations) {
    for (const st of m.instrucoes) {
      if (/^(CREATE|ALTER) TABLE "TipoAtividade"/.test(st)) {
        for (const flag of FLAGS_APOSENTADAS) {
          if (st.includes(`"${flag}"`)) {
            registrar('P50-TAREFA-CADASTRO-MODEL', `${m.nome} cria em TipoAtividade o nome aposentado ${flag} (D-PROD-181/D-PROD-196)`);
          }
        }
      }
      const noTipoTarefa = st.match(/^ALTER TABLE "TipoTarefa" ADD COLUMN "([A-Za-z0-9_]+)"/);
      if (noTipoTarefa && FLAGS_PROIBIDAS_TIPO_TAREFA.includes(noTipoTarefa[1])) {
        registrar('P50-TAREFA-CADASTRO-MODEL', `${m.nome} devolve ao TipoTarefa a flag ${noTipoTarefa[1]} (D-PROD-181/D-PROD-183/D-PROD-196)`);
      }
    }
  }
  for (const flag of FLAGS_TIPO_ATIVIDADE) {
    const esperado = `ALTER TABLE "TipoAtividade" ADD COLUMN "${flag}" BOOLEAN NOT NULL DEFAULT false`;
    const achadas = migrations.filter((m) => m.instrucoes.includes(esperado));
    if (achadas.length !== 1) {
      registrar('P50-TAREFA-CADASTRO-MODEL', `esperada exatamente 1 migration com ${esperado} (achadas ${achadas.length}; D-PROD-196)`);
    }
  }
};

/** D-PROD-196: no model, TipoAtividade tem as 8 flags `Boolean @default(false)` e nenhum nome aposentado. */
const verificarModelTipoAtividadeFlags = () => {
  const model = lerModels(ler(SCHEMA)).find((m) => m.nome === 'TipoAtividade');
  if (!model) return; // verificarModel já registrou a ausência
  for (const flag of FLAGS_APOSENTADAS) {
    if (campo(model, flag)) {
      registrar('P50-TAREFA-CADASTRO-MODEL', `TipoAtividade não pode ter o nome aposentado ${flag} (D-PROD-181/D-PROD-196)`);
    }
  }
  for (const flag of FLAGS_TIPO_ATIVIDADE) {
    const c = campo(model, flag);
    if (!c) {
      registrar('P50-TAREFA-CADASTRO-MODEL', `TipoAtividade sem a flag ${flag} (D-PROD-196)`);
    } else if (c.tipo !== 'Boolean' || c.opcional || c.lista || !/@default\(\s*false\s*\)/.test(c.atributos)) {
      registrar('P50-TAREFA-CADASTRO-MODEL', `TipoAtividade.${flag} tem de ser Boolean @default(false), obrigatório (D-PROD-196)`);
    }
  }
};

/** D-PROD-181/183 + D-PROD-196: o TipoTarefa não tem flag nenhuma (as 4 antigas nem as 8 do TipoAtividade). */
const verificarModelTipoTarefaSemFlags = () => {
  const model = lerModels(ler(SCHEMA)).find((m) => m.nome === 'TipoTarefa');
  if (!model) return; // verificarModel já registrou a ausência
  for (const flag of FLAGS_PROIBIDAS_TIPO_TAREFA) {
    if (campo(model, flag)) {
      registrar('P50-TAREFA-CADASTRO-MODEL', `TipoTarefa não pode ter a flag ${flag} (D-PROD-181/D-PROD-183/D-PROD-196: as flags são do TipoAtividade)`);
    }
  }
};

/**
 * D-PROD-196: a porta e as rotas do TipoAtividade levam as 8 flags e não citam nome aposentado no código (comentário
 * não conta). As rotas podem tirar as 8 de FLAGS_TIPO_ATIVIDADE do módulo puro (contrato §3.5); a porta as lista.
 */
const verificarFlagsNaPortaENasRotas = () => {
  const padroes = existe(PADROES_TIPO_ATIVIDADE) ? semComentarios(ler(PADROES_TIPO_ATIVIDADE)) : '';
  for (const [rel, codigoFalha] of [[PORTA_TIPO_ATIVIDADE, 'P50-TAREFA-CADASTRO-PORT'], [ROTAS_TIPO_ATIVIDADE, 'P50-TAREFA-CADASTRO-ROUTE']]) {
    if (!existe(rel)) continue; // verificarPortas/verificarRotas já registraram
    const codigo = semComentarios(ler(rel));
    for (const flag of FLAGS_APOSENTADAS) {
      if (cita(codigo, flag)) {
        registrar(codigoFalha, `${rel} cita o nome aposentado ${flag}: no TipoAtividade ele é recusado pelo schema (400), nunca aceito nem traduzido (D-PROD-196)`);
      }
    }
    const fonte = rel === ROTAS_TIPO_ATIVIDADE && cita(codigo, 'FLAGS_TIPO_ATIVIDADE') ? `${codigo}\n${padroes}` : codigo;
    const faltando = FLAGS_TIPO_ATIVIDADE.filter((flag) => !cita(fonte, flag));
    if (faltando.length) {
      registrar(codigoFalha, `${rel} sem as flags do TipoAtividade ${faltando.join(', ')} (D-PROD-196)`);
    }
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
    [PORTA_TIPO_ATIVIDADE, '/tipos-atividade'],
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
    [ROTAS_TIPO_ATIVIDADE, '/tipos-atividade'],
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
  verificarModelTipoTarefaSemFlags();
  verificarMigration();
  verificarModel('TipoAtividade', ['cliente_id', 'grupo_atividade_id', 'nome_tipo']);
  verificarModelTipoAtividadeFlags();
  verificarMigrationsTipoAtividade();
}
verificarSemBase44();
verificarPortas();
verificarRotas();
verificarFlagsNaPortaENasRotas();

if (falhas.length) {
  console.error('gate:tarefa-cadastro-native — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  process.exit(1);
}

console.log('gate:tarefa-cadastro-native — PASSOU');
