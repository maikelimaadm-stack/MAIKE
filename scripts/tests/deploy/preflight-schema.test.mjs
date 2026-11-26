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
  // D-PROD-203: as 3 tabelas das Formulações.
  { table_name: 'CADFORMULACAO', column_name: 'percentual_pv_padrao' },
  { table_name: 'CADFORMULACAOINGREDIENTE', column_name: 'quantidade_kg' },
  { table_name: 'CADFORMULACAOREGRA', column_name: 'consome' },
  // D-PROD-205: a leitura de cocho.
  { table_name: 'LEITURACOCHO', column_name: 'escore' },
  // D-PROD-206: a faixa do farol de consumo.
  { table_name: 'CADFORMULACAO', column_name: 'faixa_tolerancia_percentual' },
  // D-PROD-207: os cadastros de Funcionário e de Serviço e as linhas de mão de obra e de serviço.
  // D-PROD-208: Funcionario saiu; o papel funcionário no parceiro e a linha de mão de obra pelo parceiro.
  { table_name: 'Servico', column_name: 'unidade_medida_id' },
  { table_name: 'AtividadeApontamentoMaoObra', column_name: 'tipo_medida' },
  { table_name: 'AtividadeApontamentoServico', column_name: 'fornecedor_parceiro_id' },
  { table_name: 'Fornecedor', column_name: 'funcionario_tipo' },
  { table_name: 'AtividadeApontamentoMaoObra', column_name: 'parceiro_id' },
  { table_name: 'AtividadeApontamentoMaoObra', column_name: 'origem' },
  // D-PROD-210: a base do consumo e os gramas da regra.
  { table_name: 'CADFORMULACAO', column_name: 'base_consumo' },
  { table_name: 'CADFORMULACAOREGRA', column_name: 'g_cab_dia' },
  // D-PROD-215: o Cadastro de Culturas (tabela nova).
  { table_name: 'CADCULTURAS', column_name: 'altura_entrada_cm' },
  // D-PROD-216: a Área ligada à Cultura.
  { table_name: 'AreaPastagem', column_name: 'cultura_id' },
  // D-PROD-219: a Medição de Forragem (tabela nova).
  { table_name: 'MEDICAOFORRAGEM', column_name: 'massa_seca_kg_ha' },
  // D-PROD-223: os dias de descanso da cultura e os parâmetros próprios do pasto.
  { table_name: 'CADCULTURAS', column_name: 'dias_descanso' },
  { table_name: 'AreaPastagem', column_name: 'altura_entrada_cm' },
  { table_name: 'AreaPastagem', column_name: 'altura_saida_cm' },
  { table_name: 'AreaPastagem', column_name: 'dias_descanso' },
  // D-PROD-249: as áreas da atividade e a área do lançamento.
  { table_name: 'AtividadeArea', column_name: 'status' },
  { table_name: 'AtividadeApontamento', column_name: 'atividade_area_id' },
  // D-PROD-272: as 3 tabelas do ajuste de inventário.
  { table_name: 'AjusteEstoque', column_name: 'numero' },
  { table_name: 'AjusteEstoqueItem', column_name: 'contado_estoque' },
  { table_name: 'AjusteEstoqueEvento', column_name: 'motivo' },
  // D-PROD-274: o plantio (tabela nova) e as 5 colunas dos campos por tipo.
  { table_name: 'AtividadePlantio', column_name: 'cultura_id' },
  { table_name: 'Atividade', column_name: 'local' },
  { table_name: 'AtividadeApontamento', column_name: 'numero_receituario' },
  { table_name: 'AtividadeApontamentoProduto', column_name: 'vc_percentual' },
  { table_name: 'Produto', column_name: 'carencia_dias' },
  { table_name: 'TipoAtividade', column_name: 'alvo' },
  // D-PROD-276: a reforma (2 tabelas novas) e a ligação da atividade a ela.
  { table_name: 'Planejamento', column_name: 'status' },
  { table_name: 'PlanejamentoArea', column_name: 'hectares' },
  { table_name: 'Atividade', column_name: 'planejamento_id' },
  // D-PROD-279: o produto do implemento (4 colunas anuláveis em TipoPatrimonial).
  { table_name: 'TipoPatrimonial', column_name: 'usa_produto' },
  { table_name: 'TipoPatrimonial', column_name: 'forma_produto' },
  { table_name: 'TipoPatrimonial', column_name: 'capacidade' },
  { table_name: 'TipoPatrimonial', column_name: 'capacidade_unidade' },
  // D-PROD-282: o controle de lote (Produto e camada).
  { table_name: 'Produto', column_name: 'controla_lote' },
  { table_name: 'Produto', column_name: 'controla_validade' },
  { table_name: 'EstoqueLoteNota', column_name: 'lote_fabricante' },
  { table_name: 'EstoqueLoteNota', column_name: 'data_validade' },
  // D-PROD-283: o número do jato na linha de insumo.
  { table_name: 'AtividadeApontamentoProduto', column_name: 'jato' },
  // D-PROD-288: as unidades de conversão do produto e o consumo da formulação.
  { table_name: 'ProdutoUnidadeConversao', column_name: 'fator' },
  { table_name: 'CADFORMULACAO', column_name: 'consumo_minimo_pv' },
  // D-PROD-297: o produto do implemento no próprio bem.
  { table_name: 'BemPatrimonial', column_name: 'usa_produto' },
  { table_name: 'BemPatrimonial', column_name: 'forma_produto' },
  { table_name: 'BemPatrimonial', column_name: 'capacidade' },
  { table_name: 'BemPatrimonial', column_name: 'capacidade_unidade' },
  // D-PROD-310: a unidade de conversão digitada no cocho, na transferência e na atividade.
  { table_name: 'MovimentacaoEstoque', column_name: 'unidade_lancamento' },
  { table_name: 'MovimentacaoEstoque', column_name: 'quantidade_lancamento' },
  { table_name: 'MovimentacaoEstoque', column_name: 'fator_lancamento' },
  { table_name: 'AtividadeApontamentoProduto', column_name: 'unidade_lancamento' },
  { table_name: 'AtividadeApontamentoProduto', column_name: 'quantidade_lancamento' },
  { table_name: 'AtividadeApontamentoProduto', column_name: 'fator_lancamento' },
  // D-PROD-319: a quantidade padrão do produto e a mistura/volume da linha de produto da atividade.
  { table_name: 'Produto', column_name: 'quantidade_padrao' },
  { table_name: 'Produto', column_name: 'quantidade_padrao_unidade' },
  { table_name: 'AtividadeApontamentoProduto', column_name: 'mistura_id' },
  { table_name: 'AtividadeApontamentoProduto', column_name: 'volume_aplicado' },
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
  assert.match(r.falhas.join('\n'), /CADFORMULACAO\.percentual_pv_padrao/);
  assert.match(r.falhas.join('\n'), /CADFORMULACAOINGREDIENTE\.quantidade_kg/);
  assert.match(r.falhas.join('\n'), /CADFORMULACAOREGRA\.consome/);
  assert.match(r.falhas.join('\n'), /LEITURACOCHO\.escore/);
  assert.match(r.falhas.join('\n'), /CADCULTURAS\.altura_entrada_cm/);
  assert.match(r.falhas.join('\n'), /AreaPastagem\.cultura_id/);
  assert.match(r.falhas.join('\n'), /MEDICAOFORRAGEM\.massa_seca_kg_ha/);
  assert.match(r.falhas.join('\n'), /CADCULTURAS\.dias_descanso/);
  assert.match(r.falhas.join('\n'), /AreaPastagem\.altura_entrada_cm/);
  assert.match(r.falhas.join('\n'), /AreaPastagem\.altura_saida_cm/);
  assert.match(r.falhas.join('\n'), /AreaPastagem\.dias_descanso/);
  assert.match(r.falhas.join('\n'), /AtividadeArea\.status/);
  assert.match(r.falhas.join('\n'), /AtividadeApontamento\.atividade_area_id/);
  for (const k of ['AjusteEstoque.numero', 'AjusteEstoqueItem.contado_estoque', 'AjusteEstoqueEvento.motivo']) {
    assert.ok(r.falhas.join('\n').includes(k), k);
  }
  for (const k of ['AtividadePlantio.cultura_id', 'Atividade.local', 'AtividadeApontamento.numero_receituario', 'AtividadeApontamentoProduto.vc_percentual', 'Produto.carencia_dias', 'TipoAtividade.alvo']) {
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
  // D-PROD-276: sem a migration da reforma, o preflight para (a lista, o registro e o resumo da área leem as colunas).
  for (const k of ['AbastecimentoBem.quantidade', 'AbastecimentoBem.unidade', 'TanqueBemProduto.produto_id', 'Planejamento.status', 'PlanejamentoArea.hectares', 'Atividade.planejamento_id', 'TipoPatrimonial.usa_produto', 'TipoPatrimonial.forma_produto', 'TipoPatrimonial.capacidade', 'TipoPatrimonial.capacidade_unidade', 'Produto.controla_lote', 'EstoqueLoteNota.data_validade', 'AtividadeApontamentoProduto.jato', 'ProdutoUnidadeConversao.fator', 'CADFORMULACAO.consumo_minimo_pv', 'BemPatrimonial.usa_produto', 'BemPatrimonial.forma_produto', 'BemPatrimonial.capacidade', 'BemPatrimonial.capacidade_unidade', 'MovimentacaoEstoque.unidade_lancamento', 'MovimentacaoEstoque.quantidade_lancamento', 'MovimentacaoEstoque.fator_lancamento', 'AtividadeApontamentoProduto.unidade_lancamento', 'AtividadeApontamentoProduto.quantidade_lancamento', 'AtividadeApontamentoProduto.fator_lancamento']) {
    assert.ok(pares.includes(k), k);
    const r = avaliarPreflight(pronto({ colunas: COLUNAS_OK.filter((c) => `${c.table_name}.${c.column_name}` !== k) }));
    assert.equal(r.ok, false, k);
    assert.match(r.falhas.join('\n'), new RegExp(k.replace('.', '\\.')));
  }
  assert.equal(avaliarPreflight(pronto()).ok, true);
});
