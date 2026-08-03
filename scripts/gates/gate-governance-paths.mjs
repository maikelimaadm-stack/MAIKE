#!/usr/bin/env node
// Gate: governança — documentos obrigatórios existem, links resolvem,
// não há SSOT duplicado na raiz e os gates do registro estão no package.json.
// Código: P01-GOVERNANCE-DRIFT

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const OBRIGATORIOS = [
  'README_AI.md',
  'CLAUDE.md',
  'AGENTS.md',
  'docs/constitution/00-CONSTITUICAO.md',
  'docs/constitution/07-DO-NOT-DO.md',
  'docs/constitution/08-REGRAS-DE-IA.md',
  'docs/engineering/CURRENT-STATE.md',
  'docs/engineering/DECISIONS.md',
  'docs/engineering/ROADMAP.md',
  'docs/engineering/GATE-REGISTRY.md',
  'docs/engineering/MAPA-MANEJO-SCOPE-INVENTORY.md',
  'docs/engineering/P0.1-MAPA-MANEJO-SCOPE-RESET-REPORT.md',
  'config/mapa-manejo-scope.json',
];

// SSOT que não pode existir duplicado na raiz do repositório
const SSOT_PROIBIDO_NA_RAIZ = [
  '00-CONSTITUICAO.md',
  '07-DO-NOT-DO.md',
  '08-REGRAS-DE-IA.md',
  'CURRENT-STATE.md',
  'DECISIONS.md',
  'GATE-REGISTRY.md',
  'ROADMAP.md',
  'ROADMAP-SAAS.md',
];

// Arquivos cujos links markdown precisam resolver
const COM_LINKS = [
  'README_AI.md',
  'CLAUDE.md',
  'AGENTS.md',
  'docs/constitution/00-CONSTITUICAO.md',
  'docs/constitution/07-DO-NOT-DO.md',
  'docs/constitution/08-REGRAS-DE-IA.md',
  'docs/engineering/CURRENT-STATE.md',
  'docs/engineering/DECISIONS.md',
  'docs/engineering/ROADMAP.md',
  'docs/engineering/GATE-REGISTRY.md',
];

const falhas = [];
const registrar = (msg) => falhas.push(msg);

for (const doc of OBRIGATORIOS) {
  if (!existsSync(doc)) registrar(`documento obrigatório ausente: ${doc}`);
}

for (const nome of SSOT_PROIBIDO_NA_RAIZ) {
  if (existsSync(nome)) registrar(`SSOT duplicado na raiz: ${nome} (deve viver em docs/)`);
}
if (existsSync('docs/ROADMAP-SAAS.md')) {
  registrar('roadmap antigo docs/ROADMAP-SAAS.md ainda existe (substituído por docs/engineering/ROADMAP.md)');
}

// Links markdown relativos precisam resolver
const LINK_RE = /\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;

for (const doc of COM_LINKS) {
  if (!existsSync(doc)) continue;
  const conteudo = readFileSync(doc, 'utf8');
  const base = dirname(doc);

  for (const m of conteudo.matchAll(LINK_RE)) {
    const alvo = m[1];
    if (/^(https?:|mailto:)/.test(alvo)) continue;
    const caminho = normalize(join(base, alvo));
    if (!existsSync(caminho)) registrar(`${doc} aponta para caminho inexistente: ${alvo}`);
  }

  // Referências em crase para caminhos de docs/ e config/ também precisam existir
  for (const m of conteudo.matchAll(INLINE_CODE_RE)) {
    const alvo = m[1].trim();
    if (!/^(docs|config|scripts)\/[\w./-]+\.(md|json|mjs|js)$/.test(alvo)) continue;
    if (!existsSync(alvo)) registrar(`${doc} referencia caminho inexistente: ${alvo}`);
  }
}

// Gates do package.json existem em disco; gates do GATE-REGISTRY estão no package.json
if (!existsSync('package.json')) {
  registrar('package.json não encontrado');
} else {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const scripts = pkg.scripts || {};

  for (const [nome, comando] of Object.entries(scripts)) {
    if (!nome.startsWith('gate:')) continue;
    const script = comando.match(/(scripts\/gates\/[\w.-]+\.mjs)/)?.[1];
    if (!script) {
      registrar(`script "${nome}" não aponta para scripts/gates/*.mjs`);
    } else if (!existsSync(script)) {
      registrar(`script "${nome}" aponta para arquivo inexistente: ${script}`);
    }
  }

  if (existsSync('docs/engineering/GATE-REGISTRY.md')) {
    const registro = readFileSync('docs/engineering/GATE-REGISTRY.md', 'utf8');
    const declarados = [...registro.matchAll(/`npm run (gate:[\w-]+)`/g)].map((m) => m[1]);
    for (const gate of new Set(declarados)) {
      const chave = gate.replace(/^npm run /, '');
      if (!scripts[chave]) registrar(`GATE-REGISTRY declara "${chave}" mas package.json não define`);
    }
  }
}

if (falhas.length) {
  console.error('gate:governance-paths — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [P01-GOVERNANCE-DRIFT] ${f}`));
  process.exit(1);
}

console.log('gate:governance-paths — PASSOU (documentos, links e gates coerentes)');
