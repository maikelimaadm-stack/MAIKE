/**
 * Provas do preflight de schema (PR145-R5, D-PROD-72).
 *
 * Nenhum caso toca banco: o veredito é uma função pura sobre o que as consultas
 * devolvem. A execução real contra o banco local no estado de produção está em
 * `docs/engineering/evidencias/catalogo-icones-lotes-01/rollout-r5/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { avaliarPreflight, CONSULTAS, TABELAS_PROTEGIDAS } from '../../deploy/preflightSchemaLib.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PASTAS = ['20261028240000_p8', '20261029300000_admin', '20261029400000_papel'];
const aplicadas = (nomes) => nomes.map((migration_name) => ({ migration_name, concluida: true, revertida: false }));
const COLUNAS_OK = [
  { table_name: 'Usuario', column_name: 'papel_tenant' },
  { table_name: 'CategoriaManejo', column_name: 'catalogo_categoria_visual_id' },
  { table_name: 'Lote', column_name: 'excluido_em' },
  { table_name: 'Lote', column_name: 'excluido_por_usuario_id' },
];
const TABELAS_OK = TABELAS_PROTEGIDAS.map((tabela) => ({ tabela, rls: true }));
const PAPEIS_OK = { clientes_com_usuario_ativo: 1, administradores_ativos: 1, clientes_sem_administrador: 0 };
const pronto = (extra = {}) => ({
  pastas: PASTAS,
  migrations: aplicadas(PASTAS),
  colunas: COLUNAS_OK,
  tabelas: TABELAS_OK,
  grants: [],
  papeis: PAPEIS_OK,
  ...extra,
});

test('PF-01 schema completo, RLS e sem grants → ok', () => {
  const r = avaliarPreflight(pronto());
  assert.equal(r.ok, true);
  assert.deepEqual(r.falhas, []);
  assert.equal(r.resumo.migrations_aplicadas, 3);
});

test('PF-02 banco no estado atual de produção (sem as migrations da PR) → falha e lista o que falta', () => {
  const r = avaliarPreflight(pronto({ migrations: aplicadas(['20261028240000_p8']), colunas: [], tabelas: [], papeis: null }));
  assert.equal(r.ok, false);
  assert.match(r.falhas.join('\n'), /migrations pendentes \(2\): 20261029300000_admin, 20261029400000_papel/);
  assert.match(r.falhas.join('\n'), /Usuario\.papel_tenant/);
  assert.match(r.falhas.join('\n'), /CategoriaManejo\.catalogo_categoria_visual_id/);
  assert.match(r.falhas.join('\n'), /tabelas ausentes: .*AdminPrincipalMaike/);
});

test('PF-03 migration com falha registrada (iniciada e não concluída) → falha', () => {
  const migrations = [...aplicadas(PASTAS.slice(0, 2)), { migration_name: PASTAS[2], concluida: false, revertida: false }];
  const r = avaliarPreflight(pronto({ migrations }));
  assert.equal(r.ok, false);
  assert.match(r.falhas.join('\n'), /com falha registrada: 20261029400000_papel/);
});

test('PF-04 tabela protegida sem RLS ou com grant para anon/authenticated → falha', () => {
  const tabelas = TABELAS_OK.map((t) => (t.tabela === 'SessaoAdminMaike' ? { ...t, rls: false } : t));
  const r = avaliarPreflight(pronto({ tabelas, grants: [{ tabela: 'AdminPrincipalMaike', grantee: 'anon' }] }));
  assert.equal(r.ok, false);
  assert.match(r.falhas.join('\n'), /sem RLS: SessaoAdminMaike/);
  assert.match(r.falhas.join('\n'), /AdminPrincipalMaike→anon/);
});

test('PF-05 cliente sem administrador: aviso por padrão, falha com --exigir-admin-por-cliente', () => {
  const papeis = { clientes_com_usuario_ativo: 1, administradores_ativos: 0, clientes_sem_administrador: 1 };
  const aviso = avaliarPreflight(pronto({ papeis }));
  assert.equal(aviso.ok, true);
  assert.match(aviso.avisos.join('\n'), /1 cliente\(s\) com usuário ativo e sem administrador/);
  const exigido = avaliarPreflight(pronto({ papeis, exigirAdminPorCliente: true }));
  assert.equal(exigido.ok, false);
});

test('PF-06 só leitura e sem dado pessoal: todas as consultas são SELECT; a CLI não imprime URL nem identificação', () => {
  for (const sql of Object.values(CONSULTAS)) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|GRANT|REVOKE|CREATE|TRUNCATE)\b/i);
    assert.doesNotMatch(sql, /\b(login|nome|email|user_email|senha)\b/i);
  }
  const cli = readFileSync(join(raiz, 'scripts', 'deploy', 'preflight-schema.mjs'), 'utf8');
  assert.doesNotMatch(cli, /console\.(log|error)\([^)]*(databaseUrl|DATABASE_URL\b[^ ])/);
  assert.doesNotMatch(cli, /\$executeRaw|\.create\(|\.update\(|\.delete\(/);
});

test('PR167-R1: falta qualquer coluna da exclusão lógica do Lote → reprovado, nomeando a coluna', () => {
  for (const ausente of ['excluido_em', 'excluido_por_usuario_id']) {
    const r = avaliarPreflight(pronto({ colunas: COLUNAS_OK.filter((c) => !(c.table_name === 'Lote' && c.column_name === ausente)) }));
    assert.equal(r.ok, false, ausente);
    assert.match(r.falhas.join('\n'), new RegExp(`Lote\\.${ausente}`));
  }
});
