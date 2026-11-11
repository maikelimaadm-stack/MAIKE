#!/usr/bin/env node
/**
 * Gera trechos Prisma + migration SQL + módulos backend mínimos (P5.4).
 * Uso único na missão — não entra em verify:all.
 *
 * Desde a D-PROD-161 a execução passa por `p54-guarda-estoque.mjs`: nenhum model
 * de estoque físico (EstoqueLoteNota, MovimentacaoEstoque, Produto com
 * `estoque_atual`) é derivado do legado aqui. O schema do estoque é
 * `backend/prisma/schema.prisma` com migrations versionadas. A recusa por nome vem
 * antes de ler qualquer insumo, e nada é gravado quando há recusa.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gerarSemEscritaDeEstoque } from './p54-guarda-estoque.mjs';

const ROOT = join(import.meta.dirname, '../..');

const JSON_TO_PRISMA = {
  string: 'String',
  number: 'Decimal',
  boolean: 'Boolean',
  object: 'Json',
  array: 'Json',
};

const prismaType = (prop) => {
  if (prop.enum) return 'String';
  if (prop.format === 'date') return 'DateTime';
  if (prop.format === 'date-time') return 'DateTime';
  const t = prop.type;
  if (t === 'array') {
    if (prop.items?.type === 'string') return 'String[]';
    return 'Json';
  }
  return JSON_TO_PRISMA[t] || 'Json';
};

const prismaField = (name, prop, required) => {
  const optional = !required.has(name);
  const dbType =
    prop.type === 'string' && !prop.enum
      ? name.includes('observ') || name.includes('descricao') || name.includes('chave')
        ? ' @db.VarChar(2000)'
        : name.endsWith('_id') || name === 'empresa_id'
          ? ' @db.VarChar(64)'
          : ' @db.VarChar(255)'
      : prop.type === 'number'
        ? ' @db.Decimal(14, 4)'
        : prop.format === 'date'
          ? ' @db.Date'
          : '';
  const suffix =
    prop.type === 'boolean' && prop.default !== undefined
      ? ` @default(${prop.default})`
      : prop.type === 'string' && prop.default !== undefined
        ? ` @default("${prop.default}")`
        : prop.type === 'array' && prop.default !== undefined
          ? ' @default([])'
          : '';
  return `  ${name}${optional ? '?' : ''} ${prismaType(prop)}${dbType}${suffix}`;
};

/**
 * Lista histórica da P5.4, mantida como registro. As duas últimas entradas são
 * do estoque físico, então a execução normal é recusada (D-PROD-161, fail-closed).
 */
const ENTITIES = [
  { file: 'Empresa.jsonc', model: 'Empresa', tenantOnly: true, numero: null },
  { file: 'Permissao.jsonc', model: 'Permissao', tenantOnly: true, numero: null },
  { file: 'Fornecedor.jsonc', model: 'Fornecedor', numero: 'numero_cadastro' },
  { file: 'CategoriaManejo.jsonc', model: 'CategoriaManejo', numero: null },
  { file: 'Bebedouro.jsonc', model: 'Bebedouro', numero: null },
  { file: 'PontoSuplementacao.jsonc', model: 'PontoSuplementacao', numero: 'numero_ponto' },
  { file: 'EstoqueLoteNota.jsonc', model: 'EstoqueLoteNota', numero: null },
  { file: 'MovimentacaoEstoque.jsonc', model: 'MovimentacaoEstoque', numero: 'numero_movimentacao' },
];

const SKIP_PROPS = new Set(['id', 'created_date', 'updated_date', 'created_by']);

const renderizarModel = (ent) => {
  const raw = readFileSync(join(ROOT, 'base44/entities', ent.file), 'utf8');
  const schema = JSON.parse(raw.replace(/\/\/.*$/gm, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'));
  const required = new Set(schema.required || []);
  const lines = [`model ${ent.model} {`, '  id         String   @id @default(cuid())', '  cliente_id String   @db.VarChar(64)'];

  for (const [name, prop] of Object.entries(schema.properties || {})) {
    if (SKIP_PROPS.has(name)) continue;
    lines.push(prismaField(name, prop, required));
  }

  lines.push('  createdAt DateTime @default(now())');
  lines.push('  updatedAt DateTime @updatedAt');
  lines.push('');
  lines.push('  cliente Cliente @relation(fields: [cliente_id], references: [id], onDelete: Restrict)');
  lines.push('');
  lines.push('  @@unique([cliente_id, id])');
  if (ent.numero) {
    lines.push(`  @@unique([cliente_id, ${ent.numero}])`);
  }
  if (!ent.tenantOnly) {
    lines.push('  @@index([cliente_id, empresa_id])');
  }
  lines.push('}');
  lines.push('');

  return lines.join('\n');
};

const SNIPPET = 'scripts/scaffold/p54-prisma-snippet.txt';

const renderizar = (entidades) => {
  for (const ent of entidades) ent.prismaBlock = renderizarModel(ent);
  return [{ caminho: SNIPPET, conteudo: entidades.map((e) => e.prismaBlock).join('\n\n') }];
};

if (gerarSemEscritaDeEstoque({ gerador: 'p54-generate', raiz: ROOT, entidades: ENTITIES, renderizar })) {
  const clienteRelations = ENTITIES.map((e) => `  ${e.model.charAt(0).toLowerCase() + e.model.slice(1)}s ${e.model}[]`).join('\n');

  console.log('--- Cliente relations ---');
  console.log(clienteRelations);
  console.log('--- Models ---');
  for (const ent of ENTITIES) {
    console.log('\n' + ent.prismaBlock);
  }
  console.log(`\nWrote ${SNIPPET}`);
}
