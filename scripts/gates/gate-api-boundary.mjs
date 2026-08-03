#!/usr/bin/env node
/**
 * Gate: fronteira de dados (P1.1, D-PROD-18).
 *
 * A UI acessa dados por API explícita de módulo. A Base44 continua existindo,
 * mas atrás de `src/apis/_providers/base44Provider.js` — e a migração é
 * monotônica: cada slice da P1 **remove** caminhos legados, nunca adiciona
 * (SCL-P11-01).
 *
 * O baseline guarda **listas ordenadas de caminhos**, não contagem. Contagem
 * sozinha deixaria passar troca: remover um acesso aqui e criar outro ali
 * fecharia o número e abriria caminho novo. Por isso rename também é regressão —
 * o caminho antigo sai da lista e o novo entra.
 *
 * Além do baseline, existem invariantes que valem sempre, independentes de
 * história: SDK só no client legado, provider não vaza, entidade não é dinâmica,
 * registry dentro do manifesto de escopo.
 *
 * Contrato:
 *   baseline ausente/malformado  → falha dura (não existe `--seed`)
 *   execução normal              → nunca escreve
 *   `--update`                   → só subconjunto estrito, com progresso real
 *
 * Códigos: P11-API-BOUNDARY-BASELINE · P11-API-BOUNDARY-REGRESSION
 *          P11-API-BOUNDARY-SDK-IMPORT · P11-API-BOUNDARY-PROVIDER-LEAK
 *          P11-API-BOUNDARY-DYNAMIC-ENTITY · P11-API-BOUNDARY-SCOPE
 */

import { existsSync, readFileSync } from 'node:fs';

import { readBaseline, writeJsonAtomic } from './lib/ratchet.mjs';
import {
  AXES,
  ALLOWED_PROVIDER_ADAPTER,
  ALLOWED_SDK_IMPORTER,
  scanBoundary,
  diffPaths,
} from './lib/api-boundary.mjs';

export const BASELINE_VERSION = 1;
const BASELINE = process.env.API_BOUNDARY_BASELINE || 'scripts/gates/api-boundary-baseline.json';
const MANIFESTO = process.env.API_BOUNDARY_SCOPE || 'config/mapa-manejo-scope.json';
const atualizar = process.argv.includes('--update');

const problemas = [];
const registrar = (code, message) => problemas.push({ code, message });

const encerrar = (rodape) => {
  if (!problemas.length) return;
  console.error('gate:api-boundary — FALHOU\n');
  problemas.forEach((p) => console.error(`  - [${p.code}] ${p.message}`));
  if (rodape) console.error(`\n${rodape}`);
  console.error('');
  process.exit(1);
};

if (process.argv.includes('--seed')) {
  registrar(
    'P11-API-BOUNDARY-BASELINE',
    '--seed não existe. O baseline é versionado no Git e nunca é semeado por este gate.'
  );
  encerrar();
}

// ── 1. Medir ──────────────────────────────────────────────────────────────
const atual = scanBoundary();

console.log(
  `gate:api-boundary — legado: ${atual.listas.importsLegacyClient.length} arquivo(s) importam o client, ` +
    `${atual.listas.entitiesRefs.length} usam entities`
);
console.log(`gate:api-boundary — registry do provider: ${atual.entidadesRegistradas.join(', ') || '(vazio)'}`);

// ── 2. Invariantes absolutas ──────────────────────────────────────────────
for (const arquivo of atual.sdkImporters) {
  if (arquivo !== ALLOWED_SDK_IMPORTER) {
    registrar(
      'P11-API-BOUNDARY-SDK-IMPORT',
      `@base44/sdk importado fora de ${ALLOWED_SDK_IMPORTER}: ${arquivo}`
    );
  }
}

for (const arquivo of atual.listas.importsLegacyClient) {
  if (arquivo.startsWith('src/apis/') && arquivo !== ALLOWED_PROVIDER_ADAPTER) {
    registrar(
      'P11-API-BOUNDARY-PROVIDER-LEAK',
      `arquivo em src/apis/ importa o client legado sem ser o adapter autorizado: ${arquivo}`
    );
  }
}

for (const arquivo of atual.providerLeaks) {
  registrar(
    'P11-API-BOUNDARY-PROVIDER-LEAK',
    `o objeto do provider é reexportado: ${arquivo}. A fronteira exporta funções, não o provider.`
  );
}

// Dentro de `src/apis/` o acesso dinâmico é proibido sempre: o registry precisa
// ter domínio explícito e conferível. Fora dela, os sites legados existentes
// ficam congelados no eixo `dynamicEntityFiles` — nenhum arquivo novo entra.
for (const ocorrencia of atual.dynamicEntityNaFronteira) {
  registrar(
    'P11-API-BOUNDARY-DYNAMIC-ENTITY',
    `acesso computado a "entities" com nome não literal dentro da fronteira: ${ocorrencia}`
  );
}

if (!existsSync(ALLOWED_PROVIDER_ADAPTER)) {
  registrar('P11-API-BOUNDARY-PROVIDER-LEAK', `adapter autorizado ausente: ${ALLOWED_PROVIDER_ADAPTER}`);
} else {
  let escopo;
  try {
    escopo = JSON.parse(readFileSync(MANIFESTO, 'utf8'));
  } catch (erro) {
    registrar('P11-API-BOUNDARY-SCOPE', `manifesto de escopo ilegível (${MANIFESTO}): ${erro.message}`);
  }
  const permitidas = new Set(escopo?.allowedBase44Entities || []);
  for (const entidade of atual.entidadesRegistradas) {
    if (!permitidas.has(entidade)) {
      registrar(
        'P11-API-BOUNDARY-SCOPE',
        `registry do provider contém entidade fora de allowedBase44Entities: ${entidade}`
      );
    }
  }
}

encerrar('A fronteira de dados é invariante — ver docs/engineering/GATE-REGISTRY.md.');

// ── 3. Baseline ───────────────────────────────────────────────────────────
const lido = readBaseline(BASELINE, {
  expectedVersion: BASELINE_VERSION,
  code: 'P11-API-BOUNDARY-BASELINE',
});
if (!lido.ok) {
  registrar(lido.code, lido.message);
  encerrar();
}

const base = lido.data;

if (typeof base.certifiedFromMain !== 'string' || !base.certifiedFromMain) {
  registrar('P11-API-BOUNDARY-BASELINE', 'campo "certifiedFromMain" ausente ou inválido no baseline');
}
if (base.allowedProviderAdapter !== ALLOWED_PROVIDER_ADAPTER) {
  registrar(
    'P11-API-BOUNDARY-BASELINE',
    `"allowedProviderAdapter" divergente: baseline "${base.allowedProviderAdapter}", gate "${ALLOWED_PROVIDER_ADAPTER}"`
  );
}
if (!base.axes || typeof base.axes !== 'object' || Array.isArray(base.axes)) {
  registrar('P11-API-BOUNDARY-BASELINE', 'campo "axes" ausente ou inválido no baseline');
  encerrar();
}

const eixosBaseline = Object.keys(base.axes).sort();
const ausentes = [...AXES].sort().filter((a) => !eixosBaseline.includes(a));
const extras = eixosBaseline.filter((a) => !AXES.includes(a));
if (ausentes.length) registrar('P11-API-BOUNDARY-BASELINE', `eixo(s) ausente(s): ${ausentes.join(', ')}`);
if (extras.length) registrar('P11-API-BOUNDARY-BASELINE', `eixo(s) inesperado(s): ${extras.join(', ')}`);
encerrar();

for (const eixo of AXES) {
  const lista = base.axes[eixo];
  if (!Array.isArray(lista) || lista.some((p) => typeof p !== 'string' || !p)) {
    registrar('P11-API-BOUNDARY-BASELINE', `eixo "${eixo}" não é uma lista de caminhos`);
  }
}
encerrar();

// ── 4. Comparação por identidade de arquivo ───────────────────────────────
let houveProgresso = false;
const regressoes = [];
const progresso = [];

for (const eixo of AXES) {
  const { novos, removidos } = diffPaths(base.axes[eixo], atual.listas[eixo]);
  novos.forEach((p) => regressoes.push(`${eixo}: caminho legado novo — ${p}`));
  removidos.forEach((p) => progresso.push(`${eixo}: caminho legado removido — ${p}`));
  if (removidos.length) houveProgresso = true;
}

if (regressoes.length) {
  regressoes.forEach((r) => registrar('P11-API-BOUNDARY-REGRESSION', r));
  encerrar(
    'A migração é monotônica (SCL-P11-01): cada slice remove caminhos, nunca adiciona.\n' +
      'Renomear um arquivo legado também conta como caminho novo — migre-o em vez de movê-lo.'
  );
}

if (progresso.length) {
  console.log('\nProgresso:');
  progresso.slice(0, 30).forEach((p) => console.log(`  - ${p}`));
  if (progresso.length > 30) console.log(`  … e mais ${progresso.length - 30}`);
}

// ── 5. Gravação consciente ────────────────────────────────────────────────
if (atualizar) {
  if (!houveProgresso) {
    registrar('P11-API-BOUNDARY-BASELINE', 'nada a gravar: --update exige pelo menos um caminho legado removido.');
    encerrar();
  }
  writeJsonAtomic(BASELINE, {
    version: BASELINE_VERSION,
    certifiedFromMain: base.certifiedFromMain,
    allowedProviderAdapter: ALLOWED_PROVIDER_ADAPTER,
    axes: atual.listas,
  });
  console.log(`\nBaseline de fronteira atualizado (só subconjunto): ${BASELINE}`);
} else if (progresso.length) {
  console.log('\nRode com --update para gravar o novo baseline.');
}

console.log(
  `gate:api-boundary — PASSOU (${atual.listas.importsLegacyClient.length} arquivo(s) legado(s) restante(s))`
);
