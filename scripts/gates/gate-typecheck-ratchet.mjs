#!/usr/bin/env node
/**
 * Gate: catraca de dívida de tipos.
 *
 * O projeto é JavaScript com `checkJs: true` e sem contratos de tipo. Converter
 * a base inteira não é escopo do P0.1. A regra honesta é: **a dívida nunca
 * cresce**.
 *
 *   gate:types verde  = nenhuma regressão sobre a dívida legada versionada
 *   gate:types verde  ≠ "typecheck sem erros"
 *
 * A dívida bruta continua visível em `npm run typecheck:raw`.
 * P1 deve reduzi-la monotonicamente até zero.
 *
 * ── O que P0.1-R2 protegeu ────────────────────────────────────────────────
 * Contar diagnósticos só significa alguma coisa se a *configuração* também for
 * versionada. O baseline grava `projectPath`, `projectSha256`,
 * `effectiveCommand`, `typescriptVersion` e `coverageContract`.
 *
 * ── O que P0.1-R3 protegeu (D-PROD-17) ────────────────────────────────────
 * A barreira de não regressão vale em **todos os modos**, sem exceção. A versão
 * anterior condicionava a falha a `&& !rebasear`, então `--rebase-contract`
 * podia gravar um baseline com dívida MAIOR — a própria operação de rebase
 * redefinia a dívida para cima. Rebase atualiza *metadados de contrato*, nunca
 * o teto de qualidade.
 *
 * Também sumiu o `--seed`: baseline ausente é falha dura em todos os modos. Com
 * o baseline oficial já versionado, apagar o arquivo e semear de novo era uma
 * porta para redefinir a dívida.
 *
 * E entrou `certifiedCeiling`: um teto explícito que só diminui.
 *
 * Flags:
 *   --update          regrava diagnósticos após redução, sem regressão
 *   --rebase-contract regrava metadados de contrato após mudança consciente de
 *                     configuração ou de versão do TypeScript — sujeito à mesma
 *                     barreira de não regressão
 *
 * Códigos: P01-TYPE-REGRESSION · P01-TYPE-BASELINE · P01-TYPE-BASELINE-MISSING
 *          P01-TYPE-SEED-FORBIDDEN · P01-TYPE-RUNNER · P01-TYPE-CONTRACT
 *          P01-TYPE-CONFIG-DRIFT · P01-TYPE-VERSION-DRIFT
 */

import { readBaseline, writeJsonAtomic, isCount, compareMultisets } from './lib/ratchet.mjs';
import {
  runTypecheck,
  toFingerprintCounts,
  toFileCounts,
  getTypescriptVersion,
  tscCommand,
} from './lib/tsc-diagnostics.mjs';
import { buildTypeContract, diffContract } from './lib/type-config.mjs';

export const BASELINE_VERSION = 3;
const BASELINE = process.env.TYPECHECK_BASELINE || 'scripts/gates/typecheck-baseline.json';
const PROJECT = process.env.TYPECHECK_PROJECT || './jsconfig.typecheck.json';

const atualizar = process.argv.includes('--update');
const rebasearContrato = process.argv.includes('--rebase-contract');

const falhar = (codigo, mensagem, extras = []) => {
  console.error('gate:types — FALHOU\n');
  console.error(`  - [${codigo}] ${mensagem}`);
  extras.forEach((e) => console.error(`      ${e}`));
  console.error('');
  process.exit(1);
};

const falharMuitos = (problemas, rodape) => {
  console.error('gate:types — FALHOU\n');
  problemas.forEach((p) => console.error(`  - [${p.code}] ${p.message}`));
  if (rodape) console.error(`\n${rodape}`);
  console.error('');
  process.exit(1);
};

// ── 0. Portas fechadas ────────────────────────────────────────────────────
// `--seed` foi removido em P0.1-R3. Ele existia para criar o baseline uma única
// vez; depois que o baseline oficial passou a ser versionado, a única coisa que
// ele ainda permitia era apagar o arquivo e redefinir a dívida para cima.
if (process.argv.includes('--seed')) {
  falhar(
    'P01-TYPE-SEED-FORBIDDEN',
    '--seed não existe mais. O baseline é versionado no Git e nunca é semeado por este gate.',
    ['Baseline perdido? Restaure com: git checkout -- ' + BASELINE]
  );
}

// ── 1. Contrato de configuração ───────────────────────────────────────────
const versao = getTypescriptVersion();
if (!versao.ok) {
  falhar('P01-TYPE-RUNNER', 'não foi possível determinar a versão do TypeScript', [versao.detail]);
}

const contrato = buildTypeContract({
  project: PROJECT,
  command: tscCommand(PROJECT),
  typescriptVersion: versao.version,
});
if (!contrato.ok) {
  falhar('P01-TYPE-CONTRACT', contrato.message);
}

if (contrato.violations.length) {
  falharMuitos(
    contrato.violations.map((v) => ({ code: 'P01-TYPE-CONTRACT', message: v })),
    'A cobertura de tipos é parte do contrato: reduzi-la não é uma forma de passar no gate.\n' +
      'Ver docs/engineering/GATE-REGISTRY.md.'
  );
}

console.log(`gate:types — projeto: ${PROJECT} (TypeScript ${versao.version})`);
console.log(`gate:types — sha256 da configuração: ${contrato.contract.projectSha256.slice(0, 16)}…`);

// ── 2. Rodar o compilador ─────────────────────────────────────────────────
const run = runTypecheck({ project: PROJECT });
if (!run.ok) {
  falhar('P01-TYPE-RUNNER', `não foi possível obter diagnósticos do TypeScript (${run.reason})`, [run.detail]);
}

const atual = {
  total: run.diagnostics.length,
  byFile: toFileCounts(run.diagnostics),
  fingerprints: toFingerprintCounts(run.diagnostics),
};

console.log(`gate:types — diagnósticos atuais: ${atual.total} em ${Object.keys(atual.byFile).length} arquivo(s)`);

// ── 3. Ler e validar o baseline ───────────────────────────────────────────
const lido = readBaseline(BASELINE, { expectedVersion: BASELINE_VERSION, code: 'P01-TYPE-BASELINE' });
if (!lido.ok) {
  // Baseline ausente é falha dura em TODOS os modos. Não existe semeadura.
  falhar(lido.missing ? 'P01-TYPE-BASELINE-MISSING' : lido.code, lido.message);
}

const base = lido.data;

for (const campo of ['projectPath', 'projectSha256', 'effectiveCommand', 'typescriptVersion']) {
  if (typeof base[campo] !== 'string' || !base[campo]) {
    falhar('P01-TYPE-BASELINE', `campo "${campo}" ausente ou inválido no baseline`);
  }
}
if (!base.coverageContract || typeof base.coverageContract !== 'object' || Array.isArray(base.coverageContract)) {
  falhar('P01-TYPE-BASELINE', 'campo "coverageContract" ausente ou inválido no baseline');
}
if (!isCount(base.total)) {
  falhar('P01-TYPE-BASELINE', `campo "total" inválido no baseline: ${JSON.stringify(base.total)}`);
}
if (!isCount(base.certifiedCeiling)) {
  falhar(
    'P01-TYPE-BASELINE',
    `campo "certifiedCeiling" ausente ou inválido no baseline: ${JSON.stringify(base.certifiedCeiling)}`,
    ['O teto certificado é obrigatório desde o schema 3 e precisa ser inteiro não negativo.']
  );
}
if (base.total > base.certifiedCeiling) {
  falhar(
    'P01-TYPE-BASELINE',
    `baseline incoerente: "total" (${base.total}) excede "certifiedCeiling" (${base.certifiedCeiling})`
  );
}
for (const campo of ['byFile', 'fingerprints']) {
  if (!base[campo] || typeof base[campo] !== 'object' || Array.isArray(base[campo])) {
    falhar('P01-TYPE-BASELINE', `campo "${campo}" ausente ou inválido no baseline`);
  }
  for (const [chave, valor] of Object.entries(base[campo])) {
    if (!isCount(valor) || valor === 0) {
      falhar('P01-TYPE-BASELINE', `contagem inválida em ${campo}["${chave}"]: ${JSON.stringify(valor)}`);
    }
  }
}
const somaFingerprints = Object.values(base.fingerprints).reduce((a, b) => a + b, 0);
if (somaFingerprints !== base.total) {
  falhar(
    'P01-TYPE-BASELINE',
    `baseline inconsistente: soma dos fingerprints (${somaFingerprints}) difere de "total" (${base.total})`
  );
}

// ── 4. Barreira de não regressão — vale em TODOS os modos ─────────────────
// Nenhuma flag desativa esta seção. Ela roda antes de qualquer escrita, e
// qualquer item aqui encerra o processo com o baseline byte a byte intacto.
const { novos, aumentos, reducoes } = compareMultisets(base.fingerprints, atual.fingerprints);

const arquivosPiores = [];
for (const [arquivo, quantidade] of Object.entries(atual.byFile)) {
  const antes = base.byFile[arquivo] ?? 0;
  if (quantidade > antes) arquivosPiores.push(`${arquivo}: ${antes} -> ${quantidade}`);
}

const regressoes = [];
novos.slice(0, 40).forEach((n) => regressoes.push(`diagnóstico novo: ${n}`));
if (novos.length > 40) regressoes.push(`… e mais ${novos.length - 40} diagnóstico(s) novo(s)`);
aumentos.slice(0, 40).forEach((a) => regressoes.push(`multiplicidade aumentou: ${a}`));
arquivosPiores.slice(0, 40).forEach((a) => regressoes.push(`arquivo piorou: ${a}`));
if (atual.total > base.total) {
  regressoes.push(`total aumentou: ${base.total} -> ${atual.total}`);
}
if (atual.total > base.certifiedCeiling) {
  regressoes.push(`total (${atual.total}) excede o teto certificado (${base.certifiedCeiling})`);
}

if (regressoes.length) {
  console.error('gate:types — FALHOU: a dívida de tipos AUMENTOU\n');
  regressoes.forEach((r) => console.error(`  - [P01-TYPE-REGRESSION] ${r}`));
  console.error('\nA dívida legada é versionada e só pode diminuir — em todos os modos.');
  if (rebasearContrato) {
    console.error(
      'ATENÇÃO: --rebase-contract atualiza metadados de contrato, não o teto de qualidade.\n' +
        'Ele não autoriza regressão e nada foi gravado. Corrija os diagnósticos novos primeiro.'
    );
  }
  console.error('\nVer docs/engineering/GATE-REGISTRY.md.');
  process.exit(1);
}

// ── 5. Contrato gravado × contrato atual ──────────────────────────────────
const divergencias = diffContract(base, contrato.contract);
if (divergencias.length && !rebasearContrato) {
  falharMuitos(
    divergencias,
    'A configuração de tipos e a versão do compilador são parte do baseline.\n' +
      'Mudança consciente: `node scripts/gates/gate-typecheck-ratchet.mjs --rebase-contract`.\n' +
      'Nem a cobertura obrigatória nem a não regressão são rebaseáveis.'
  );
}

if (reducoes.length) {
  console.log(`\nProgresso: ${reducoes.length} diagnóstico(s) a menos que o baseline.`);
  reducoes.slice(0, 10).forEach((r) => console.log(`  - ${r}`));
  if (reducoes.length > 10) console.log(`  … e mais ${reducoes.length - 10}`);
}

// ── 6. Gravações conscientes ──────────────────────────────────────────────
// O teto nunca sobe: `min` do teto gravado com o total atual.
const novoTeto = Math.min(base.certifiedCeiling, atual.total);

const buildPayload = () => ({
  version: BASELINE_VERSION,
  ...contrato.contract,
  certifiedCeiling: novoTeto,
  total: atual.total,
  byFile: atual.byFile,
  fingerprints: atual.fingerprints,
});

if (rebasearContrato) {
  if (!divergencias.length) {
    falhar('P01-TYPE-BASELINE', '--rebase-contract recusado: o contrato gravado já é igual ao atual.');
  }
  writeJsonAtomic(BASELINE, buildPayload());
  console.log('\nContrato de tipos REBASEADO conscientemente:');
  divergencias.forEach((d) => console.log(`  - ${d.message}`));
  console.log(`  baseline: ${BASELINE} (${atual.total} diagnóstico(s), teto ${novoTeto})`);
  console.log('  A cobertura obrigatória e a não regressão foram validadas antes da gravação.');
  process.exit(0);
}

if (atualizar) {
  if (!reducoes.length) {
    falhar('P01-TYPE-BASELINE', 'nada a gravar: --update exige pelo menos um diagnóstico removido.');
  }
  writeJsonAtomic(BASELINE, buildPayload());
  console.log(`\nBaseline de tipos atualizado (só para baixo): ${BASELINE}`);
  console.log(`  total ${base.total} -> ${atual.total} · teto ${base.certifiedCeiling} -> ${novoTeto}`);
} else if (reducoes.length) {
  console.log('\nRode `node scripts/gates/gate-typecheck-ratchet.mjs --update` para gravar o novo baseline.');
}

if (atual.total === 0) {
  console.log('gate:types — PASSOU (zero diagnósticos: dívida quitada)');
} else {
  console.log(
    `gate:types — PASSOU (sem regressão sobre ${base.total} diagnóstico(s) de dívida versionada; ` +
      `atual: ${atual.total}; teto certificado: ${base.certifiedCeiling})`
  );
  console.log('           dívida bruta visível em: npm run typecheck:raw');
}
