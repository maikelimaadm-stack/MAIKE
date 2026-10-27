#!/usr/bin/env node
/**
 * Gate: P5.5 — saída final Base44 (D-PROD-51+).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.cwd();
const SCHEMA = 'backend/prisma/schema.prisma';
const PROVIDER = 'src/apis/_providers/base44Provider.js';
const MIGRATIONS = 'backend/prisma/migrations';

const ENTIDADES = [
  { model: 'MovimentacaoMapa', codigo: 'P55-MOV_MAPA', caminho: '/movimentacoes-mapa', porta: 'src/apis/movimentacoes-mapa/movimentacaoMapaNativePort.js', tabela: 'MovimentacaoMapa' },
  { model: 'MovimentacaoPecuaria', codigo: 'P55-MOV_PEC', caminho: '/movimentacoes-pecuaria', porta: 'src/apis/movimentacoes-pecuaria/movimentacaoPecuariaNativePort.js', tabela: 'MovimentacaoPecuaria' },
  { model: 'SuplementacaoEvento', codigo: 'P55-SUP_EVT', caminho: '/suplementacao-eventos', porta: 'src/apis/suplementacao-eventos/suplementacaoEventoNativePort.js', tabela: 'SuplementacaoEvento' },
  { model: 'SuplementacaoLote', codigo: 'P55-SUP_LOTE', caminho: '/suplementacao-lotes', porta: 'src/apis/suplementacao-lotes/suplementacaoLoteNativePort.js', tabela: 'SuplementacaoLote' },
  { model: 'AplicacaoMedicamento', codigo: 'P55-APL_MED', caminho: '/aplicacoes-medicamento', porta: 'src/apis/aplicacoes-medicamento/aplicacaoMedicamentoNativePort.js', tabela: 'AplicacaoMedicamento' },
  { model: 'EventoSanitario', codigo: 'P55-EVT_SAN', caminho: '/eventos-sanitarios', porta: 'src/apis/eventos-sanitarios/eventoSanitarioNativePort.js', tabela: 'EventoSanitario' },
  { model: 'ManejoTecnicoRebanho', codigo: 'P55-MTR', caminho: '/manejos-tecnico-rebanho', porta: 'src/apis/manejos-tecnico-rebanho/manejoTecnicoRebanhoNativePort.js', tabela: 'ManejoTecnicoRebanho' },
  { model: 'BebedouroHistorico', codigo: 'P55-BEB_HIST', caminho: '/bebedouros-historico', porta: 'src/apis/bebedouros-historico/bebedouroHistoricoNativePort.js', tabela: 'BebedouroHistorico' },
  { model: 'BebedouroSanidade', codigo: 'P55-BEB_SAN', caminho: '/bebedouros-sanidade', porta: 'src/apis/bebedouros-sanidade/bebedouroSanidadeNativePort.js', tabela: 'BebedouroSanidade' },
  { model: 'BebedouroAlerta', codigo: 'P55-BEB_ALR', caminho: '/bebedouros-alertas', porta: 'src/apis/bebedouros-alertas/bebedouroAlertaNativePort.js', tabela: 'BebedouroAlerta' },
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
  registrar('P55-MODEL', `${SCHEMA} ilegível: ${erro.message}`);
  models = [];
}

for (const ent of ENTIDADES) {
  const m = models.find((item) => item.nome === ent.model);
  if (!m) registrar(`${ent.codigo}-MODEL`, `schema sem model ${ent.model}`);
  else if (!campo(m, 'cliente_id')) registrar(`${ent.codigo}-MODEL`, `${ent.model} sem cliente_id`);

  const dirMigrations = caminho(MIGRATIONS);
  const temMigration =
    existsSync(dirMigrations) &&
    readdirSync(dirMigrations).some((nome) => {
      const sql = join(dirMigrations, nome, 'migration.sql');
      return existsSync(sql) && new RegExp(`CREATE TABLE "${ent.tabela}"`).test(readFileSync(sql, 'utf8'));
    });
  if (!temMigration) registrar(`${ent.codigo}-MIGRATION`, `migration ausente para ${ent.tabela}`);

  if (!existe(ent.porta)) registrar(`${ent.codigo}-PORT`, `${ent.porta} não encontrado`);
  else if (!/nativeRequest\s*\(/.test(semComentarios(ler(ent.porta)))) {
    registrar(`${ent.codigo}-PORT`, `${ent.porta} sem nativeRequest`);
  }
}

if (existe(PROVIDER)) {
  const provider = semComentarios(ler(PROVIDER));
  if (/base44\.entities\b/.test(provider)) {
    registrar('P55-BASE44-REGISTRY', `${PROVIDER} ainda referencia base44.entities`);
  }
  if (/endpointOf\s*\(/.test(provider)) {
    registrar('P55-BASE44-REGISTRY', `${PROVIDER} ainda usa endpointOf`);
  }
}

if (existe('src/api/base44Client.js')) {
  registrar('P55-BASE44-CLIENT', 'base44Client.js ainda existe');
}

if (falhas.length) {
  console.error('gate:p55-base44-exit-final — FALHOU\n');
  for (const f of falhas) console.error(`  - [${f.codigo}] ${f.mensagem}`);
  process.exit(1);
}

console.log('gate:p55-base44-exit-final — PASSOU');
