/**
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01) — a migration CONTRACT
 * `20261110300000_patrimonio_simplifica` de ponta a ponta, contra PostgreSQL
 * real, num banco PRÓPRIO criado e apagado por este teste (o banco da suíte não
 * é tocado).
 *
 * Partida: todas as migrations do repositório menos esta CONTRACT, a `20261113700000_apontamento_atividade`,
 * D-PROD-190, que depende dela, e a `20261113800000_apontamento_atividade_item`, D-PROD-193, que depende da
 * D-PROD-190 (MIGRATIONS_PARTIDA; inclui a TipoAtividade, D-PROD-182, a CADESTACOES,
 * D-PROD-188, a CADCURVAGANHO, D-PROD-189, e as CONTRACT `20261113200000_tipo_tarefa_drop_colunas`, D-PROD-183, e
 * `20261113500000_categoria_manejo_cadcategoria`, D-PROD-187, aplicadas pelo Prisma direto, sem o runner e portanto
 * sem a barreira de MIGRATION_CONTRACT_AUTORIZADO; as guardas delas passam porque TipoTarefa e CategoriaManejo estão
 * vazias nessa hora e `semear` não cria nenhuma das duas) e sementes nas 13 tabelas do Patrimônio antigo para 2
 * clientes, com um abastecimento CANCELADO (saída + estorno + fatia) e uma compra P3 em KG com lote. A D-PROD-183 e a
 * D-PROD-187 não criam nem apagam tabela (a D-PROD-187 só renomeia CategoriaManejo para CADCATEGORIA): as contagens de
 * tabelas (88/89 na partida; 82 no formato novo, 83 com a D-PROD-190, 85 com a D-PROD-193) não mudam com elas.
 * A D-PROD-188 (CADESTACOES) e a D-PROD-189 (CADCURVAGANHO) criam 1 tabela nova cada e somam +1 migration e +1 tabela, cada uma, em todas as contagens.
 * A D-PROD-194 (CONTRACT `20261114100000_cadcurvaganho_mensal`) troca a estrutura de CADCURVAGANHO (12 GMD mensais no
 * lugar dos 3 por estação) e sobe na partida pelo Prisma direto, como a D-PROD-183 e a D-PROD-187: a guarda dela passa
 * porque CADCURVAGANHO está vazia (`semear` não cria curva). Soma +1 migration e 0 tabela: as contagens de tabelas não
 * mudam, e a impressão digital antes×depois compara a mesma estrutura (as duas pontas já têm a D-PROD-194).
 * A D-PROD-195 (CONTRACT `20261114200000_cadcategoria_curva_ganho`, curva obrigatória em CADCATEGORIA) também sobe na
 * partida pelo Prisma direto: a guarda dela só exige a CURVA PADRÃO nas fazendas COM categoria, e `semear` não cria
 * categoria. +1 migration e 0 tabela, como a D-PROD-194.
 * A D-PROD-190 referencia BemPatrimonial(cliente_id, empresa_id, id), que só existe no formato novo: fica fora da
 * partida (MIGRATIONS_DEPOIS_DO_CONTRACT) e sobe pelo runner no GREEN, depois desta CONTRACT (em produção a
 * D-PROD-162 já está concluída). A D-PROD-193 (itens do apontamento) referencia o ApontamentoAtividade e sobe logo
 * depois dele, também no GREEN. A D-PROD-200 (CONTRACT `20261114500000_atividade_cabecalho`, Atividade cabeçalho)
 * exige as 3 tabelas do apontamento antigo: fica fora da partida e sobe por último no GREEN, convertendo nada (as 3
 * nascem vazias), apagando-as e criando Atividade e AtividadeApontamento. Com ela pendente, o runner com a
 * conferência exigida e a decisão desta RECUSA (nunca duas CONTRACT de uma vez, como a D-PROD-195 no teste da
 * D-PROD-187); o GREEN aplica pelo runner no alvo local. A D-PROD-202 (EXPAND
 * `20261114600000_atividade_linhas_produto_maquina`, linhas de produto e de máquina) referencia AtividadeApontamento e
 * BemPatrimonial(cliente_id, empresa_id, id): também fica fora da partida e sobe por último no GREEN, com as 3 tabelas
 * dela (vazias, com RLS) e as 2 colunas anuláveis em BemPatrimonial e TipoPatrimonial. A D-PROD-203 (EXPAND
 * `20261114700000_cadformulacao`, Formulações, 3 tabelas novas) não existia no dia desta CONTRACT: também fica fora da
 * partida e sobe no GREEN, depois da D-PROD-202, com as 3 tabelas dela (vazias, com RLS). A D-PROD-205
 * (EXPAND `20261115100000_leitura_cocho`, 1 tabela nova) idem, depois da D-PROD-203, e a D-PROD-206 (EXPAND
 * `20261115200000_formulacao_faixa_tolerancia`, 1 coluna anulável em CADFORMULACAO) idem, depois da D-PROD-205. A D-PROD-207 (EXPAND
 * `20261115900000_atividade_mao_obra_servico`, mão de obra e serviço) referencia AtividadeApontamento: também fica
 * fora da partida e sobe no GREEN, com as 4 tabelas dela (vazias, com RLS) e nenhuma coluna em tabela antiga. A D-PROD-208
 * (CONTRACT `20261116000000_mao_obra_parceiro`, o funcionário como papel do parceiro) exige a D-PROD-207 e as tabelas
 * dela vazias: sobe por último no GREEN e tira a Funcionario: 94 tabelas no fim.
 *
 * RED (nada muda; a falha aberta é resolvida com `migrate resolve --rolled-back`):
 * CONFIRMADO, FK e visão de fora, trava concorrente em Produto, sem impressão,
 * impressão errada, papel que não é o dono, gatilho, política e publicação
 * criados à mão; e o runner com a conferência de alvo exigida sem
 * MIGRATION_CONTRACT_AUTORIZADO (recusa antes de qualquer DDL).
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`), com a impressão na URL: com a conferência de alvo e
 * MIGRATION_CONTRACT_AUTORIZADO=D-PROD-162 ele recusa (a D-PROD-200 e a D-PROD-208 pendem junto; nada muda); no alvo local, todas
 * concluídas (TOTAL_MIGRATIONS: esta CONTRACT, a D-PROD-190, a D-PROD-193, a D-PROD-200, a D-PROD-202, a D-PROD-203, a
 * D-PROD-205, a D-PROD-206, a D-PROD-207 e a D-PROD-208), 94 tabelas (+ Atividade e AtividadeApontamento, as 3 das linhas, as 3 das Formulações, a LEITURACOCHO e as 3 da mão de
 * obra e do serviço que ficam, vazias, com RLS), as 7 novas vazias com o mesmo dono/ACL das antigas,
 * RLS e políticas no padrão, 7/31/32/55 constraints e índices, impressão digital
 * das 75 que ficam idêntica, os 2 CHECKs de OperacaoFinanceiraItem com 'L',
 * estoque intacto, `migrate diff` vazio e 2ª execução sem pendências.
 *
 * As funções são as do ensaio local (`scripts/dev/ensaio-patrimonio-simplifica.mjs`).
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { encerrar } from './helpers.mjs';
import {
  CENARIOS_RED, DECISAO, MIGRATIONS_DEPOIS_DO_CONTRACT, MIGRATIONS_PARTIDA, NOME_ATIVIDADE_CABECALHO, NOME_CONTRACT, NOME_ESTOQUE_ENTRADAS, NOME_ESTOQUE_ENTRADAS_MOTIVOS, NOME_ESTOQUE_SAIDAS, NOME_APONTAMENTO_DATA_TERMINO, NOME_ESTOQUE_AJUSTES, NOME_CAMPOS_POR_TIPO, NOME_REFORMA, NOME_PRODUTO_IMPLEMENTO, NOME_INSUMO_JATO, NOME_UNIDADES_CONVERSAO, NOME_BEM_PRODUTO, NOME_UNIDADE_CONVERTIDA, NOME_SINC_INDICES, NOME_DM, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, PAPEL_OUTRO,
  TOTAL_MIGRATIONS, TABELAS_APAGADAS, TABELAS_DEPOIS_DO_CONTRACT, TABELAS_ESTOQUE, TABELAS_FINAIS_DEPOIS_DO_CONTRACT, TABELAS_NOVAS,
  aplicarMigrationsDaMain, aplicarPeloRunner, checksOperacaoItem, comBanco, comImpressao, contarTabelas, donoEAcl,
  estoqueCoerente, estruturaNovas, exigirUrlLocal, fingerprintV2, historico, impressao, itemEmLitros, migrateDiff,
  retrato, rodarCenarioRed, segurancaDe, semear, sistema,
} from '../../scripts/dev/ensaio-patrimonio-simplifica.mjs';

const BANCO = 'maike_simplifica_teste';
/** O lock_timeout da guarda é 5 s; o teto cobre a partida do Prisma CLI em máquina lenta de CI. */
const TETO_TRAVA_MS = 20_000;

let URL_T;
let db;
let superusuario;
let partida;
let fpAntes;
let donosAntes;
let segurancaAntes;

before(async () => {
  const p = getPrismaClient();
  URL_T = comBanco(exigirUrlLocal(process.env.DATABASE_URL), BANCO);
  superusuario = (await p.$queryRawUnsafe(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`))[0].rolsuper;
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO}`);
  await aplicarMigrationsDaMain(URL_T);
  db = new PrismaClient({ datasourceUrl: URL_T });
  await semear(db, { clientes: 2, bens: 1, cancelados: 1 });
  partida = await retrato(db);
  fpAntes = await fingerprintV2(db);
  donosAntes = await donoEAcl(db, TABELAS_APAGADAS);
  segurancaAntes = await segurancaDe(db, TABELAS_APAGADAS);
});

after(async () => {
  await db?.$disconnect();
  const p = getPrismaClient();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  if (superusuario) await p.$executeRawUnsafe(`DROP ROLE IF EXISTS ${PAPEL_OUTRO}`);
  await encerrar();
});

describe('D-PROD-162 — migration CONTRACT do Patrimônio simplificado (PostgreSQL real)', () => {
  test('SM-01 partida: todas as migrations menos a CONTRACT, a D-PROD-190, a D-PROD-193, a D-PROD-200, a D-PROD-202, a D-PROD-203, a D-PROD-205, a D-PROD-206, a D-PROD-207, a D-PROD-208, a D-PROD-209, a D-PROD-210, a D-PROD-211, a D-PROD-215, a D-PROD-216 e a D-PROD-217, 88 tabelas, as 13 com linhas de 2 clientes; um item P3 em L é RECUSADO pelo CHECK antigo (achado B1)', async () => {
    const h = await historico(db);
    assert.equal(h.concluidas, MIGRATIONS_PARTIDA);
    // D-PROD-297: a EXPAND do produto do implemento no bem, também: agora 30.
    // D-PROD-310: a EXPAND da unidade convertida, também: agora 31.
    // D-PROD-315: a EXPAND dos índices da sincronização, também: agora 32.
    // D-PROD-323: a EXPAND da mistura no implemento, também: agora 33.
    assert.equal(MIGRATIONS_PARTIDA, TOTAL_MIGRATIONS - 33, 'todas as pastas menos esta CONTRACT, a D-PROD-190, a D-PROD-193, a D-PROD-200, a D-PROD-202, a D-PROD-203, a D-PROD-205, a D-PROD-206, a D-PROD-207, a D-PROD-208, a D-PROD-209, a D-PROD-210, a D-PROD-211, a D-PROD-215, a D-PROD-216, a D-PROD-217, a D-PROD-219, a D-PROD-223, a D-PROD-249, a D-PROD-257, a D-PROD-259, a D-PROD-264, a D-PROD-265, a D-PROD-272, a D-PROD-274, a D-PROD-276, a D-PROD-279 e a D-PROD-283');
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    assert.equal(partida.tabelas, 88);
    // D-PROD-190/191/198: as migrations que dependem do formato novo não estão na partida (nem as tabelas delas).
    // D-PROD-203, D-PROD-205 e D-PROD-206: as Formulações, a Leitura de cocho e a faixa de tolerância (releases posteriores)
    // também ficam fora da partida e sobem no GREEN; a D-PROD-207, a D-PROD-208, a D-PROD-209, a D-PROD-210 (base do
    // consumo nas Formulações), a D-PROD-211 (o abastecimento ligado à atividade: muda a AbastecimentoBem que esta recria),
    // a EXPAND do Cadastro de Culturas (D-PROD-215, CADCULTURAS), a Área ligada à Cultura (D-PROD-216, que depende dela)
    // e, por último, a D-PROD-217 (o reforço: a FK do apontamento de AbastecimentoBem com a atividade) — a ordem de produção.
    assert.deepEqual(MIGRATIONS_DEPOIS_DO_CONTRACT, ['20261113700000_apontamento_atividade', '20261113800000_apontamento_atividade_item', NOME_ATIVIDADE_CABECALHO, '20261114600000_atividade_linhas_produto_maquina', NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, '20261115900000_atividade_mao_obra_servico', '20261116000000_mao_obra_parceiro', '20261116100000_funcionario_tipo_terceirizado', '20261116200000_formulacao_base_consumo', '20261116300000_abastecimento_atividade', '20261116500000_cadculturas', '20261117000000_area_cultura', '20261117100000_abastecimento_fk_apontamento_atividade', '20261117200000_medicao_forragem', '20261117300000_descanso_e_alturas_por_area', '20261118100000_atividade_areas', NOME_ESTOQUE_ENTRADAS, NOME_ESTOQUE_ENTRADAS_MOTIVOS, NOME_ESTOQUE_SAIDAS, NOME_APONTAMENTO_DATA_TERMINO, NOME_ESTOQUE_AJUSTES, NOME_CAMPOS_POR_TIPO, NOME_REFORMA, NOME_PRODUTO_IMPLEMENTO, NOME_INSUMO_JATO, NOME_UNIDADES_CONVERSAO, NOME_BEM_PRODUTO, NOME_UNIDADE_CONVERTIDA, NOME_SINC_INDICES, NOME_DM]);
    const depoisNaPartida = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[])`, [...MIGRATIONS_DEPOIS_DO_CONTRACT]);
    assert.equal(depoisNaPartida[0].n, 0);
    assert.deepEqual(await donoEAcl(db, TABELAS_DEPOIS_DO_CONTRACT), []);
    for (const t of TABELAS_APAGADAS) assert.ok(partida[t].n > 0, `${t} sem linhas`);
    const imp = await impressao(db);
    assert.equal(imp.linhas, TABELAS_APAGADAS.reduce((s, t) => s + partida[t].n, 0));
    assert.match(imp.impressao, /^[0-9a-f]{12}$/);
    const clientes = await db.$queryRawUnsafe(`SELECT count(DISTINCT cliente_id)::int AS n FROM "BemPatrimonial"`);
    assert.equal(clientes[0].n, 2);
    const l = await itemEmLitros(db);
    assert.equal(l.aceito, false);
    assert.match(l.erro, /OperacaoFinanceiraItem_forma_check/);
    assert.equal(await estoqueCoerente(db), true);
  });

  for (const cenario of CENARIOS_RED) {
    test(`SM-RED ${cenario.id}: recusado com a mensagem própria e NADA muda (88 tabelas, linhas idênticas, migration aberta → resolvida)`, async (t) => {
      if (cenario.papel && !superusuario) return t.skip('o papel do banco de teste não cria superusuário');
      const r = await rodarCenarioRed(cenario, { db, url: URL_T });
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, cenario.esperado);
      assert.deepEqual(r.depois, r.antes, 'nenhuma linha nem tabela mudou');
      assert.equal(r.antes.tabelas, cenario.id === 'fk_de_fora' ? 89 : 88);
      assert.equal(r.historico.contract_concluida, 0);
      assert.equal(r.historico.contract_aberta, 1, 'a linha da migration fica com finished_at NULL');
      assert.equal(r.resolvida?.status, 0, r.resolvida?.saida);
      if (cenario.trava) assert.ok(r.ms < TETO_TRAVA_MS, `o runner saiu em ${r.ms} ms (lock_timeout de 5 s; não espera a trava)`);
      assert.equal(await contarTabelas(db), 88);
      assert.equal((await historico(db)).contract_aberta, 0);
      assert.deepEqual(await retrato(db), partida, 'o cenário foi desfeito por inteiro');
      assert.ok(!r.saida.includes(URL_T), 'a URL nunca aparece na saída');
    });
  }

  test('SM-02 runner com a conferência de alvo exigida (alvo "remoto" simulado) e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED antes de qualquer DDL', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    const linhasAntes = (await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations"`))[0].n;
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-999' }]) {
      const r = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.match(r.saida, new RegExp(`${NOME_CONTRACT} \\(${DECISAO}\\)`));
      assert.ok(!r.saida.includes('20261114100000_cadcurvaganho_mensal'), 'a D-PROD-194 já está concluída na partida');
      assert.ok(r.saida.includes(`${NOME_ATIVIDADE_CABECALHO} (D-PROD-200)`), 'a D-PROD-200, que depende desta, pende junto');
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!r.saida.includes(URL_T));
    }
    assert.equal((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations"`))[0].n, linhasAntes, 'nenhuma linha nova no histórico');
    assert.deepEqual(await retrato(db), partida);
  });

  test('SM-03 GREEN pelo runner oficial (impressão na URL): com o alvo conferido e MIGRATION_CONTRACT_AUTORIZADO=D-PROD-162 recusa (a D-PROD-200 e a D-PROD-208 pendem junto; nada muda); no alvo local, todas/0 (com a D-PROD-190, a D-PROD-193, a D-PROD-200, a D-PROD-202, a D-PROD-203, a D-PROD-205, a D-PROD-207 e a D-PROD-208 depois da CONTRACT), 94 tabelas, 7 novas vazias com o mesmo dono/ACL, RLS, estrutura, impressão digital das 75 idêntica, CHECKs com L, estoque intacto e migrate diff vazio', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    // Nunca duas CONTRACT de uma vez: com esta e a D-PROD-200 pendentes, a decisão desta não basta; a recusa cita só a outra.
    const recusada = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(recusada.status, 1, recusada.saida);
    assert.match(recusada.saida, /alvo conferido nas duas conexões/);
    assert.match(recusada.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
    // D-PROD-208, D-PROD-209, D-PROD-210, D-PROD-211, D-PROD-216, D-PROD-217, D-PROD-249, D-PROD-259 e D-PROD-265: as CONTRACT posteriores também pendem e também são citadas.
    assert.ok(recusada.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_ATIVIDADE_CABECALHO} (D-PROD-200), 20261116000000_mao_obra_parceiro (D-PROD-208), 20261116100000_funcionario_tipo_terceirizado (D-PROD-209), 20261116200000_formulacao_base_consumo (D-PROD-210), 20261116300000_abastecimento_atividade (D-PROD-211), 20261117000000_area_cultura (D-PROD-216), 20261117100000_abastecimento_fk_apontamento_atividade (D-PROD-217), 20261118100000_atividade_areas (D-PROD-249), 20261119200000_estoque_entradas_motivos (D-PROD-259), 20261120200000_apontamento_data_termino (D-PROD-265), 20261125200000_produto_unidades_conversao (D-PROD-288).`), recusada.saida);
    assert.match(recusada.saida, /Nenhuma migration foi executada/);
    assert.deepEqual(await retrato(db), partida, 'nada mudou');
    assert.equal((await historico(db)).concluidas, MIGRATIONS_PARTIDA);

    // Alvo local (sem a conferência exigida): o runner aplica as pendentes pela ordem dos nomes.
    const r = await aplicarPeloRunner(comImpressao(URL_T, imp));
    assert.equal(r.status, 0, r.saida);

    const h = await historico(db);
    assert.equal(h.concluidas, TOTAL_MIGRATIONS);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    assert.equal(await contarTabelas(db), 115, 'D-PROD-323: + a AtividadeMistura, a AtividadeMisturaItem e a AtividadeMisturaMovimento; D-PROD-288: + a ProdutoUnidadeConversao; D-PROD-276: + o Planejamento e a PlanejamentoArea; D-PROD-274: + a AtividadePlantio; D-PROD-272: + as 3 do ajuste de inventário (a D-PROD-265, data de término, não cria tabela); D-PROD-264: + as 4 da saída manual do Estoque; D-PROD-259: + a MotivoEntradaEstoque; D-PROD-257: + as 3 das Entradas do Estoque; D-PROD-249: + a AtividadeArea; D-PROD-219: + a MEDICAOFORRAGEM; D-PROD-215: + a CADCULTURAS; D-PROD-208: − Funcionario (nasce com a D-PROD-207 e sai com a D-PROD-208); as 82 do formato novo (com a CADESTACOES, D-PROD-188, e a CADCURVAGANHO, D-PROD-189) + Atividade e AtividadeApontamento (D-PROD-200) + as 3 das linhas de produto e de máquina (D-PROD-202) + as 3 das Formulações (D-PROD-203) + a LEITURACOCHO (D-PROD-205) + as 4 da mão de obra e do serviço (D-PROD-207); as 3 do apontamento antigo (D-PROD-190/D-PROD-193) nascem e saem com a D-PROD-200');
    // D-PROD-190/191/198/201: subiram DEPOIS da CONTRACT (o runner aplica em ordem de nome); no fim ficam as 2 da atividade, as 3 das linhas, as 3 das Formulações (D-PROD-203), a LEITURACOCHO (D-PROD-205) e as 4 da mão de obra e do serviço (D-PROD-207), vazias, com RLS e sem FORCE.
    const ordem = await db.$queryRawUnsafe(
      `SELECT migration_name AS nome FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at, migration_name`,
      [NOME_CONTRACT, ...MIGRATIONS_DEPOIS_DO_CONTRACT]
    );
    assert.deepEqual(ordem.map((x) => x.nome), [NOME_CONTRACT, ...MIGRATIONS_DEPOIS_DO_CONTRACT]);
    assert.deepEqual((await donoEAcl(db, TABELAS_DEPOIS_DO_CONTRACT)).map((d) => [d.tabela, d.rls, d.force]), [
      // D-PROD-272: as 3 tabelas do ajuste de inventário, vazias, com RLS e sem FORCE.
      ['AjusteEstoque', true, false], ['AjusteEstoqueEvento', true, false], ['AjusteEstoqueItem', true, false],
      ['Atividade', true, false], ['AtividadeApontamento', true, false],
      ['AtividadeApontamentoMaoObra', true, false], ['AtividadeApontamentoMaquina', true, false], ['AtividadeApontamentoProduto', true, false],
      ['AtividadeApontamentoProdutoConsumoLote', true, false], ['AtividadeApontamentoServico', true, false],
      // D-PROD-249: as áreas da atividade, também vazias, com RLS e sem FORCE.
      ['AtividadeArea', true, false],
      // D-PROD-323: as 3 tabelas do Diário da máquina (mistura, itens e movimentos), vazias, com RLS e sem FORCE.
      ['AtividadeMistura', true, false], ['AtividadeMisturaItem', true, false], ['AtividadeMisturaMovimento', true, false],
      // D-PROD-274: os dados do plantio, também vazios, com RLS e sem FORCE.
      ['AtividadePlantio', true, false],
      ['CADCULTURAS', true, false], ['CADFORMULACAO', true, false], ['CADFORMULACAOINGREDIENTE', true, false], ['CADFORMULACAOREGRA', true, false],
      // D-PROD-257: as 3 tabelas das Entradas do Estoque, vazias, com RLS e sem FORCE.
      ['EntradaEstoque', true, false], ['EntradaEstoqueEvento', true, false], ['EntradaEstoqueItem', true, false],
      ['LEITURACOCHO', true, false], ['MEDICAOFORRAGEM', true, false],
      // D-PROD-259: a MotivoEntradaEstoque, vazia, com RLS e sem FORCE.
      ['MotivoEntradaEstoque', true, false],
      // D-PROD-264: as 4 tabelas da saída manual do Estoque, vazias, com RLS e sem FORCE.
      ['MotivoSaidaEstoque', true, false],
      // D-PROD-276: as 2 tabelas da reforma de pastagem, vazias, com RLS e sem FORCE.
      ['Planejamento', true, false], ['PlanejamentoArea', true, false],
      // D-PROD-288: as unidades de conversão do produto, vazias (a cópia do peso por saco não tem produto aqui), com RLS.
      ['ProdutoUnidadeConversao', true, false],
      ['SaidaEstoque', true, false], ['SaidaEstoqueEvento', true, false], ['SaidaEstoqueItem', true, false],
      ['Servico', true, false],
    ]);
    for (const t of TABELAS_FINAIS_DEPOIS_DO_CONTRACT) assert.equal((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`))[0].n, 0, `${t} nasce vazia`);

    const depois = await retrato(db);
    for (const t of TABELAS_NOVAS) assert.equal(depois[t]?.n, 0, `${t} nasce vazia`);
    for (const t of TABELAS_APAGADAS.filter((x) => !TABELAS_NOVAS.includes(x))) assert.equal(depois[t], null, `${t} foi removida`);
    for (const t of TABELAS_ESTOQUE) assert.deepEqual(depois[t], partida[t], `linhas de ${t} intactas`);
    assert.equal(await estoqueCoerente(db), true, 'estoque_atual = Σ lotes por Produto');

    // Mesmo dono e mesma ACL das 13 (os privilégios padrão do dono valem para as 7).
    const assinaturas = new Set(donosAntes.map((d) => `${d.dono}|${d.acl}`));
    assert.equal(assinaturas.size, 1, 'as 13 tinham um único dono/ACL');
    const novas = await donoEAcl(db, TABELAS_NOVAS);
    assert.deepEqual(novas.map((d) => d.tabela), [...TABELAS_NOVAS]);
    for (const d of novas) {
      assert.equal(`${d.dono}|${d.acl}`, [...assinaturas][0], d.tabela);
      assert.equal(d.rls, true, `${d.tabela} com RLS`);
      assert.equal(d.force, false, `${d.tabela} sem FORCE`);
    }
    const seg = await segurancaDe(db, TABELAS_NOVAS);
    assert.equal(seg.grants, 0, 'nenhum grant para anon/authenticated/PUBLIC');
    assert.equal(segurancaAntes.grants, 0);
    const esperadas = seg.vercel ? TABELAS_NOVAS.map((t) => ({ tabela: t, nome: 'maike_backend_all', cmd: 'ALL', papeis: 'maike_vercel' })) : [];
    assert.deepEqual(seg.politicas, esperadas);
    // O mesmo padrão das 13 antigas: com maike_vercel no cluster, uma maike_backend_all por tabela; sem ele, nenhuma.
    assert.deepEqual(segurancaAntes.politicas.map((x) => x.nome), seg.vercel ? TABELAS_APAGADAS.map(() => 'maike_backend_all') : []);

    const e = await estruturaNovas(db);
    // D-PROD-211 (aplicada depois): + 3 FKs, 3 CHECKs e 3 índices em AbastecimentoBem (o CHECK de status é recriado, não somado).
    assert.deepEqual({ pk: e.pk, fk: e.fk, check: e.check, indices: e.indices }, { pk: 7, fk: 31 + 3, check: 32 + 3, indices: 55 + 3 });
    // D-PROD-202: + BemPatrimonial.custo_uso_unitario e TipoPatrimonial.salto_maximo_medidor (anuláveis), aplicadas depois.
    // D-PROD-211: + as 7 colunas de AbastecimentoBem, aplicadas depois.
    assert.deepEqual(e.colunas, { AbastecimentoBem: 31 + 7, AbastecimentoBemConsumoLote: 10, BemPatrimonial: 55 + 4, FamiliaPatrimonial: 12, TanqueBem: 9, TanqueBemProduto: 7, TipoPatrimonial: 12 + 4 }); // D-PROD-279: + as 4 do produto do implemento no tipo; D-PROD-297: + as 4 no bem

    assert.deepEqual(await fingerprintV2(db), fpAntes, 'as 75 tabelas que ficam não mudaram (fora os 2 CHECKs alargados)');
    const k = await checksOperacaoItem(db);
    // D-PROD-288: os 2 CHECKs foram alargados de novo depois (a unidade de conversão do produto); L continua aceito.
    assert.match(k.OperacaoFinanceiraItem_unidade_check, /char_length\(btrim/);
    assert.match(k.OperacaoFinanceiraItem_forma_check, /'MERCADORIA'.*<> 'UN'.*'SERVICO'.*'UN'/);
    assert.deepEqual(await itemEmLitros(db), { aceito: true }, 'o item P3 em L agora entra (D1)');

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('SM-04 2ª execução do runner: nada pendente e nada muda', async () => {
    const antes = await retrato(db);
    const r = await aplicarPeloRunner(URL_T);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
    assert.equal((await historico(db)).concluidas, TOTAL_MIGRATIONS);
  });
});
