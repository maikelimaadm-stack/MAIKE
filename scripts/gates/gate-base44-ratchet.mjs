#!/usr/bin/env node
/**
 * Gate: Base44 — catraca. O acoplamento só pode diminuir.
 *
 * Regra R5 · Constituição P4 · Do-Not-Do D7/D8 · D-PROD-04
 *
 * Contrato endurecido (P0.1-R1):
 *  - baseline ausente ou malformado → falha dura (nunca criação automática);
 *  - versão de schema obrigatória;
 *  - conjunto de eixos exato: eixo ausente ou inesperado reprova;
 *  - valores precisam ser inteiros finitos não negativos;
 *  - execução normal nunca escreve arquivo;
 *  - `--update` exige ausência de regressão, ao menos uma redução, e grava
 *    de forma atômica; não regrava quando nada mudou.
 *
 * A medição cobre `src/`, o `vite.config.js` e as functions preservadas —
 * documentação não conta como acoplamento executável.
 *
 * Códigos: P01-BASE44-BASELINE · P01-BASE44-REGRESSION · P01-BASE44-CONTRACT
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBaseline, writeJsonAtomic, isCount } from './lib/ratchet.mjs';
import { walkFiles, CODE_EXTS } from './lib/source-graph.mjs';

export const BASELINE_VERSION = 2;
const BASELINE = process.env.BASE44_BASELINE || 'scripts/gates/base44-baseline.json';
const atualizar = process.argv.includes('--update');

/** Contrato: exatamente estes eixos, nem mais nem menos. */
export const AXES = Object.freeze([
  'arquivosComSdk',
  'importsSdk',
  'entitiesRefs',
  'authRefs',
  'integrationsRefs',
  'functionsRefs',
  'vitePlugin',
  'runtimeConfigRefs',
  'schemas',
  'functionsBase44',
]);

const count = (text, re) => (text.match(re) || []).length;

/**
 * Mede o acoplamento executável com a Base44.
 * @param {string} root diretório do projeto
 */
export const measure = (root = process.cwd()) => {
  const src = join(root, 'src');
  const result = Object.fromEntries(AXES.map((a) => [a, 0]));

  for (const file of walkFiles(src).filter((f) => CODE_EXTS.some((e) => f.endsWith(e)))) {
    const text = readFileSync(file, 'utf8');
    if (/@base44\/sdk|base44Client/.test(text)) result.arquivosComSdk += 1;
    result.importsSdk += count(text, /from\s+['"]@base44\/sdk['"]/g);
    result.entitiesRefs += count(text, /base44\.entities\b/g);
    result.authRefs += count(text, /base44\.auth\b/g);
    result.integrationsRefs += count(text, /base44\.integrations\b/g);
    result.functionsRefs += count(text, /base44\.functions\b/g);
  }

  const viteConfig = join(root, 'vite.config.js');
  if (existsSync(viteConfig)) {
    result.vitePlugin = /@base44\/vite-plugin/.test(readFileSync(viteConfig, 'utf8')) ? 1 : 0;
  }

  // Acoplamento executável fora de src/: functions preservadas e config de runtime.
  const functionsDir = join(root, 'base44/functions');
  if (existsSync(functionsDir)) {
    for (const file of walkFiles(functionsDir).filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f))) {
      const text = readFileSync(file, 'utf8');
      result.runtimeConfigRefs += count(text, /@base44\/sdk|base44\.(entities|auth|integrations|functions)\b/g);
    }
  }

  const entitiesDir = join(root, 'base44/entities');
  if (existsSync(entitiesDir)) {
    result.schemas = readdirSync(entitiesDir).filter((f) => f.endsWith('.jsonc')).length;
  }
  if (existsSync(functionsDir)) {
    result.functionsBase44 = readdirSync(functionsDir).filter((f) =>
      statSync(join(functionsDir, f)).isDirectory()
    ).length;
  }

  return result;
};

const falhar = (codigo, mensagem) => {
  console.error(`gate:base44 — FALHOU\n\n  - [${codigo}] ${mensagem}\n`);
  process.exit(1);
};

const atual = measure();
console.log('gate:base44 — medição atual:', JSON.stringify(atual));

const lido = readBaseline(BASELINE, {
  expectedVersion: BASELINE_VERSION,
  code: 'P01-BASE44-BASELINE',
});
if (!lido.ok) falhar(lido.code, lido.message);

const base = lido.data;
if (!base.axes || typeof base.axes !== 'object' || Array.isArray(base.axes)) {
  falhar('P01-BASE44-BASELINE', `baseline sem objeto "axes": ${BASELINE}`);
}

// Contrato de eixos: exato.
const eixosBaseline = Object.keys(base.axes).sort();
const eixosEsperados = [...AXES].sort();
const ausentes = eixosEsperados.filter((a) => !eixosBaseline.includes(a));
const extras = eixosBaseline.filter((a) => !eixosEsperados.includes(a));

if (ausentes.length) {
  falhar('P01-BASE44-CONTRACT', `eixo(s) ausente(s) no baseline: ${ausentes.join(', ')}`);
}
if (extras.length) {
  falhar(
    'P01-BASE44-CONTRACT',
    `eixo(s) inesperado(s) no baseline: ${extras.join(', ')}. Atualize o contrato conscientemente antes de prosseguir.`
  );
}
for (const eixo of AXES) {
  if (!isCount(base.axes[eixo])) {
    falhar('P01-BASE44-CONTRACT', `eixo "${eixo}" no baseline não é inteiro não negativo: ${JSON.stringify(base.axes[eixo])}`);
  }
}

const regressoes = [];
const progresso = [];
for (const eixo of AXES) {
  const antes = base.axes[eixo];
  const agora = atual[eixo];
  if (agora > antes) regressoes.push(`${eixo}: ${antes} -> ${agora} (+${agora - antes})`);
  else if (agora < antes) progresso.push(`${eixo}: ${antes} -> ${agora} (-${antes - agora})`);
}

if (regressoes.length) {
  console.error('\ngate:base44 — FALHOU: acoplamento com Base44 AUMENTOU\n');
  regressoes.forEach((r) => console.error(`  - [P01-BASE44-REGRESSION] ${r}`));
  console.error('\nRegra R5: independência é monotônica. Ver docs/constitution/00-CONSTITUICAO.md (P4).');
  process.exit(1);
}

if (progresso.length) {
  console.log('\nProgresso:');
  progresso.forEach((p) => console.log(`  - ${p}`));
}

if (atualizar) {
  if (!progresso.length) {
    falhar('P01-BASE44-BASELINE', 'nada a gravar: --update exige pelo menos um eixo reduzido.');
  }
  writeJsonAtomic(BASELINE, { version: BASELINE_VERSION, axes: atual });
  console.log(`\nBaseline atualizado (só para baixo): ${BASELINE}`);
} else if (progresso.length) {
  console.log('\nRode com --update para gravar o novo baseline.');
}

console.log('PASSOU');
