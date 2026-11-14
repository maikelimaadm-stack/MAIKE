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

import { avaliarPreflight, CONSULTAS, COLUNAS_EXIGIDAS, TABELAS_PROTEGIDAS } from '../../deploy/preflightSchemaLib.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PASTAS = ['20261028240000_p8', '20261029300000_admin', '20261029400000_papel'];
const aplicadas = (nomes) => nomes.map((migration_name) => ({ migration_name, concluida: true, revertida: false }));
const COLUNAS_OK = [
  { table_name: 'Usuario', column_name: 'papel_tenant' },
  // D-PROD-187: o nome físico novo da Categoria de Manejo.
  { table_name: 'CADCATEGORIA', column_name: 'idade_minima_meses' },
  // D-PROD-195: a curva de ganho obrigatória da categoria.
  { table_name: 'CADCATEGORIA', column_name: 'curva_ganho_id' },
  // D-PROD-198: peso objetivo da categoria.
  { table_name: 'CADCATEGORIA', column_name: 'peso_objetivo_kg' },
  { table_name: 'Lote', column_name: 'excluido_em' },
  { table_name: 'Lote', column_name: 'excluido_por_usuario_id' },
  { table_name: 'Cliente', column_name: 'sessao_epoca' },
  { table_name: 'Usuario', column_name: 'sessao_epoca' },
  { table_name: 'Usuario', column_name: 'troca_senha_pendente' },
  // D-PROD-162: o backend do Patrimônio simplificado lê estas colunas.
  { table_name: 'AbastecimentoBem', column_name: 'quantidade' },
  { table_name: 'AbastecimentoBem', column_name: 'unidade' },
  { table_name: 'TanqueBemProduto', column_name: 'produto_id' },
  // D-PROD-200: a atividade (cabeçalho) e o apontamento do dia.
  { table_name: 'Atividade', column_name: 'unidade_producao_sigla' },
  { table_name: 'AtividadeApontamento', column_name: 'sequencia' },
  // D-PROD-202: as linhas de produto e de máquina, o custo de uso do bem e o teto do salto do medidor.
  { table_name: 'AtividadeApontamentoProduto', column_name: 'movimentacao_estoque_id' },
  { table_name: 'AtividadeApontamentoProdutoConsumoLote', column_name: 'estoque_lote_nota_id' },
  { table_name: 'AtividadeApontamentoMaquina', column_name: 'quantidade_uso' },
  { table_name: 'BemPatrimonial', column_name: 'custo_uso_unitario' },
  { table_name: 'TipoPatrimonial', column_name: 'salto_maximo_medidor' },
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
  assert.match(r.falhas.join('\n'), /CADCATEGORIA\.idade_minima_meses/);
  assert.match(r.falhas.join('\n'), /CADCATEGORIA\.curva_ganho_id/);
  assert.match(r.falhas.join('\n'), /CADCATEGORIA\.peso_objetivo_kg/);
  assert.match(r.falhas.join('\n'), /Atividade\.unidade_producao_sigla/);
  assert.match(r.falhas.join('\n'), /AtividadeApontamento\.sequencia/);
  for (const k of ['AtividadeApontamentoProduto.movimentacao_estoque_id', 'AtividadeApontamentoProdutoConsumoLote.estoque_lote_nota_id', 'AtividadeApontamentoMaquina.quantidade_uso', 'BemPatrimonial.custo_uso_unitario', 'TipoPatrimonial.salto_maximo_medidor']) {
    assert.ok(r.falhas.join('\n').includes(k), k);
  }
  assert.match(r.falhas.join('\n'), /tabelas ausentes: .*AdminPrincipalMaike/);
});

test('PF-02b S04-P1: sem as colunas sessao_epoca o runtime novo não pode subir → falha nomeando cada uma', () => {
  const r = avaliarPreflight(pronto({ colunas: COLUNAS_OK.filter((c) => c.column_name !== 'sessao_epoca') }));
  assert.equal(r.ok, false);
  assert.match(r.falhas.join('\n'), /Cliente\.sessao_epoca/);
  assert.match(r.falhas.join('\n'), /Usuario\.sessao_epoca/);
});

test('PF-02c S04-P2: sem Usuario.troca_senha_pendente o runtime novo não pode subir → falha nomeando a coluna', () => {
  const r = avaliarPreflight(pronto({ colunas: COLUNAS_OK.filter((c) => c.column_name !== 'troca_senha_pendente') }));
  assert.equal(r.ok, false);
  assert.match(r.falhas.join('\n'), /Usuario\.troca_senha_pendente/);
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

test('B12 (D-PROD-162): a consulta de colunas é MONTADA de COLUNAS_EXIGIDAS — todo par exigido aparece nela; as colunas do Patrimônio simplificado são exigidas', () => {
  for (const [t, c] of COLUNAS_EXIGIDAS) assert.ok(CONSULTAS.colunas.includes(`('${t}','${c}')`), `${t}.${c} fora da consulta`);
  const pares = [...CONSULTAS.colunas.matchAll(/\('([A-Za-z_]+)','([A-Za-z_]+)'\)/g)].map((x) => `${x[1]}.${x[2]}`);
  assert.deepEqual(pares, COLUNAS_EXIGIDAS.map(([t, c]) => `${t}.${c}`), 'nada a mais nem a menos na consulta');
  for (const k of ['AbastecimentoBem.quantidade', 'AbastecimentoBem.unidade', 'TanqueBemProduto.produto_id']) {
    assert.ok(pares.includes(k), k);
    const r = avaliarPreflight(pronto({ colunas: COLUNAS_OK.filter((c) => `${c.table_name}.${c.column_name}` !== k) }));
    assert.equal(r.ok, false, k);
    assert.match(r.falhas.join('\n'), new RegExp(k.replace('.', '\\.')));
  }
  assert.equal(avaliarPreflight(pronto()).ok, true);
});
