#!/usr/bin/env node
/**
 * Gate: índices e uniques tenant-aware.
 *
 * Absoluto: sem `--update`, sem baseline, sem correção automática, nunca
 * escreve arquivo.
 *
 * A verificação é **posicional**, não textual. `@@index([cliente_id, ativo])` e
 * `@@index([ativo, cliente_id])` têm os mesmos caracteres; só a ordem separa um
 * índice que serve de um que não serve. Um gate que procura a substring
 * `cliente_id` dentro do bloco aprova os dois — por isso o parser devolve a
 * lista ordenada de colunas e o gate olha a posição 0.
 *
 * Códigos:
 *   P3-IDX-SCHEMA-MISSING · P3-IDX-TENANT-PREFIX · P3-IDX-BUSINESS-UNIQUE
 *   P3-IDX-SEQUENCE-UNIQUE · P3-IDX-SEQUENCE-NULL-SCOPE
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { lerModels, campo } from './lib/prisma-schema.mjs';

const ROOT = process.env.INDICES_ROOT || process.cwd();
const SCHEMA = process.env.INDICES_SCHEMA || 'backend/prisma/schema.prisma';
const CONTRATO = process.env.INDICES_CONTRACT || 'config/modelobase1-pecuario.json';

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const reprovar = () => {
  console.error('gate:indices — FALHOU\n');
  falhas.forEach((f) => console.error(`  - [${f.codigo}] ${f.mensagem}`));
  console.error(`\n  ${falhas.length} violação(ões) de índice/unique.`);
  console.error('  O gate é absoluto: não existe --update, baseline nem correção automática.');
  process.exit(1);
};

const lerContrato = () => {
  const caminho = join(ROOT, CONTRATO);
  if (!existsSync(caminho)) return null;
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
};

const contrato = lerContrato();
const ROOT_MODEL = contrato?.tenancy?.rootModel || 'Cliente';
const TENANT_FIELD = contrato?.tenancy?.tenantField || 'cliente_id';
const EXCECOES = Array.isArray(contrato?.tenancy?.modelsWithoutTenantField)
  ? contrato.tenancy.modelsWithoutTenantField
  : [ROOT_MODEL];

const sequenciaDoContrato = contrato?.numbering?.sequenceModel || {};
const SEQUENCIA_MODEL = sequenciaDoContrato.name || 'EntidadeCodigoSequencia';
const SEQUENCIA_UNIQUE = Array.isArray(sequenciaDoContrato.uniqueKey)
  ? sequenciaDoContrato.uniqueKey
  : ['cliente_id', 'entidade', 'escopo_tipo', 'escopo_id'];

// ---------------------------------------------------------------------------

const caminhoSchema = join(ROOT, SCHEMA);

if (!existsSync(caminhoSchema)) {
  registrar('P3-IDX-SCHEMA-MISSING', `schema Prisma ausente: ${SCHEMA}`);
  reprovar();
}

let models;
try {
  models = lerModels(readFileSync(caminhoSchema, 'utf8'));
} catch (error) {
  registrar('P3-IDX-SCHEMA-MISSING', `não foi possível interpretar ${SCHEMA}: ${error.message}`);
  reprovar();
}

if (!models.length) {
  registrar('P3-IDX-SCHEMA-MISSING', `${SCHEMA} não declara nenhum model`);
  reprovar();
}

const ehTenantModel = (nome) => !EXCECOES.includes(nome);

// ---------------------------------------------------------------------------
// 1. Índice de model tenant-scoped começa por cliente_id
// ---------------------------------------------------------------------------

for (const model of models) {
  if (!ehTenantModel(model.nome)) continue;

  for (const colunas of model.indices) {
    if (colunas[0] !== TENANT_FIELD) {
      registrar(
        'P3-IDX-TENANT-PREFIX',
        `${model.nome}: @@index([${colunas.join(', ')}]) não começa por ${TENANT_FIELD}` +
          (colunas.includes(TENANT_FIELD)
            ? ` — o campo está na lista, mas na posição ${colunas.indexOf(TENANT_FIELD)}; ordem importa`
            : '')
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Unique de negócio tenant-scoped começa por cliente_id
// ---------------------------------------------------------------------------

for (const model of models) {
  if (!ehTenantModel(model.nome)) continue;

  for (const colunas of model.uniques) {
    if (!colunas.includes(TENANT_FIELD)) {
      registrar(
        'P3-IDX-BUSINESS-UNIQUE',
        `${model.nome}: @@unique([${colunas.join(', ')}]) não inclui ${TENANT_FIELD}`
      );
    } else if (colunas[0] !== TENANT_FIELD) {
      registrar(
        'P3-IDX-BUSINESS-UNIQUE',
        `${model.nome}: @@unique([${colunas.join(', ')}]) deve começar por ${TENANT_FIELD}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Model raiz não é forçado a prefixo de tenant
//
// Controle positivo: a raiz PODE ter @@index([nome]) sem cliente_id. Se este
// gate reprovasse isso, ele estaria exigindo tenancy da própria raiz — o erro
// que a D-PROD-22 acabou de corrigir na Constituição.
// ---------------------------------------------------------------------------

// (Sem verificação: a ausência de regra aqui é a regra. O teste P3-IDX-06
//  prova que a raiz com índice sem tenant passa.)

// ---------------------------------------------------------------------------
// 4. Unique da sequência: exatamente as quatro dimensões do contrato
// ---------------------------------------------------------------------------

const sequencia = models.find((m) => m.nome === SEQUENCIA_MODEL);

if (!sequencia) {
  registrar('P3-IDX-SEQUENCE-UNIQUE', `model ${SEQUENCIA_MODEL} não existe no schema`);
} else {
  const combina = sequencia.uniques.some(
    (colunas) =>
      colunas.length === SEQUENCIA_UNIQUE.length &&
      colunas.every((coluna, i) => coluna === SEQUENCIA_UNIQUE[i])
  );

  if (!combina) {
    const encontrados = sequencia.uniques.map((c) => `[${c.join(', ')}]`).join(' ') || '(nenhum)';
    registrar(
      'P3-IDX-SEQUENCE-UNIQUE',
      `${SEQUENCIA_MODEL}: @@unique deve ser exatamente [${SEQUENCIA_UNIQUE.join(', ')}] — encontrado ${encontrados}`
    );
  }

  // ------------------------------------------------------------------------
  // 5. escopo_id não pode ser nullable sob unique comum
  //
  // No PostgreSQL, NULL nunca é igual a NULL num índice unique: duas linhas de
  // sequência com escopo_id nulo coexistem e distribuem números em paralelo.
  // O contrato proíbe `nullable-escopo-id-in-plain-unique`.
  // ------------------------------------------------------------------------
  for (const coluna of SEQUENCIA_UNIQUE) {
    const c = campo(sequencia, coluna);
    if (!c) {
      registrar(
        'P3-IDX-SEQUENCE-UNIQUE',
        `${SEQUENCIA_MODEL} não declara o campo "${coluna}" exigido pelo unique do contrato`
      );
      continue;
    }
    if (c.opcional) {
      registrar(
        'P3-IDX-SEQUENCE-NULL-SCOPE',
        `${SEQUENCIA_MODEL}.${coluna} é opcional (${c.tipo}?) e participa de @@unique comum. ` +
          'No PostgreSQL NULL nunca é igual a NULL: duas sequências coexistiriam e distribuiriam ' +
          'números em paralelo. Use sentinela não nula ou unique parcial por escopo_tipo.'
      );
    }
  }
}

// ---------------------------------------------------------------------------

if (falhas.length) reprovar();

const totalIndices = models.reduce((soma, m) => soma + m.indices.length, 0);
const totalUniques = models.reduce((soma, m) => soma + m.uniques.length, 0);

console.log(
  `gate:indices — PASSOU (${models.length} model(s), ${totalIndices} índice(s), ` +
    `${totalUniques} unique(s); prefixo de tenant "${TENANT_FIELD}" exigido fora da raiz "${ROOT_MODEL}")`
);
