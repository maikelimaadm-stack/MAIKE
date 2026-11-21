/**
 * D-PROD-187 — a migration CONTRACT `20261113500000_categoria_manejo_cadcategoria`
 * (remoção física das 15 colunas dormentes de CategoriaManejo e do vínculo com
 * o ícone oficial, com a FK e o índice, e o nome físico novo da tabela,
 * CADCATEGORIA) de ponta a ponta, contra PostgreSQL real, em bancos PRÓPRIOS
 * criados e apagados por este teste (o banco da suíte não é tocado).
 *
 * Partida: todas as migrations do repositório menos esta CONTRACT (CONCLUIDAS_ANTES; inclui as EXPAND da CADESTACOES, D-PROD-188, da
 * CADCURVAGANHO, D-PROD-189, e do ApontamentoAtividade, D-PROD-190, estas duas de nome POSTERIOR ao desta CONTRACT e já
 * concluídas, nesta ordem, como em produção; e as que vieram depois delas, também de nome posterior, que em produção
 * entram depois desta CONTRACT e aqui sobem antes dela, pela ordem dos nomes: a dos itens do apontamento, D-PROD-193, e a
 * CONTRACT `20261114100000_cadcurvaganho_mensal`, D-PROD-194, aplicada pelo Prisma direto, sem o runner: a guarda dela
 * passa porque CADCURVAGANHO está vazia; +1 migration, 0 tabela; em produção ela entrou depois desta). Fica FORA da
 * partida a CONTRACT da D-PROD-195 (`20261114200000_cadcategoria_curva_ganho`, NOMES_DEPOIS_DO_CONTRACT): ela exige o
 * nome novo, CADCATEGORIA, e sobe pelo runner no GREEN, logo depois desta. Também fica fora a EXPAND da D-PROD-198
 * (`20261114400000_cadcategoria_peso_objetivo`, CADCATEGORIA.peso_objetivo_kg, em NOMES_DEPOIS_DO_CONTRACT): no dia
 * desta CONTRACT ela ainda não existia, também exige o nome novo e sobe no GREEN por último. (A CONTRACT da D-PROD-197,
 * `20261114300000_tipo_atividade_defaults`, só toca TipoAtividade e sobe na partida, como a da D-PROD-194; a da
 * D-PROD-200, `20261114500000_atividade_cabecalho`, só olha as 3 tabelas do apontamento antigo, vazias aqui, troca-as
 * pelas 2 da atividade e também sobe na partida: 85 → 84 tabelas; a EXPAND da D-PROD-202,
 * `20261114600000_atividade_linhas_produto_maquina`, sobe na partida logo depois dela: + as 3 tabelas das linhas, 87;
 * a EXPAND da D-PROD-207, `20261115900000_atividade_mao_obra_servico`, sobe na partida depois delas: + as 4 tabelas
 * da mão de obra e do serviço, 91.) Para 2
 * clientes, 4 categorias de manejo: uma no formato das 4 de produção (raça,
 * categoria oficial, 12 GMDs 0.0000), uma com ganho e GMDs variados (e um
 * apóstrofo na raça), uma só com o vínculo do ícone e uma sem nada nas 16
 * colunas; uma categoria visual GLOBAL do tipo `lote`; e, para a D-PROD-195, a Empresa de cada cliente com a
 * 'CURVA PADRÃO' (a que a guarda dela exige) e uma outra curva.
 *
 * RED (nada muda; a falha aberta é resolvida com `migrate resolve --rolled-back`):
 * sem impressão, impressão errada, índice numa coluna apagada, índice a mais,
 * visão numa coluna apagada e na do ícone, política, função citando coluna,
 * função com o nome físico da tabela, gatilho em caixa mista, RETURNS TABLE,
 * CADCATEGORIA já existente, nome novo de índice ocupado, trava concorrente
 * (lock_timeout 5 s); e o runner com a conferência de alvo exigida sem
 * MIGRATION_CONTRACT_AUTORIZADO = D-PROD-187 (recusa antes de qualquer DDL).
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`): com a conferência de alvo exigida e
 * MIGRATION_CONTRACT_AUTORIZADO = D-PROD-187 ele RECUSA, porque a D-PROD-195 pende junto (nunca duas CONTRACT; nada
 * muda); no alvo local, com a impressão na URL, aplica esta, depois a D-PROD-195 e por último a EXPAND da D-PROD-198:
 * todas concluídas (CONCLUIDAS_DEPOIS; esta CONTRACT aplicada depois da CADCURVAGANHO e do ApontamentoAtividade,
 * fora da ordem dos nomes, como aconteceu em produção, e dos itens do apontamento e da CONTRACT da D-PROD-194, que
 * subiram na partida, como a D-PROD-197, a D-PROD-200, a D-PROD-202 e a D-PROD-207; a D-PROD-195, a D-PROD-198, a EXPAND das Formulações, D-PROD-203, a EXPAND da Leitura de cocho, D-PROD-205, e a EXPAND da faixa de tolerância, D-PROD-206, por último), 91 tabelas na partida e 95 no fim,
 * CategoriaManejo some, CADCATEGORIA com o mesmo OID, ACL, RLS e políticas, as 12 colunas que ficam (mais a
 * curva_ganho_id da D-PROD-195, cada categoria na CURVA PADRÃO da fazenda, e a peso_objetivo_kg da D-PROD-198, vazia),
 * linhas idênticas nelas, os 4 nomes novos,
 * FK válida, demais tabelas iguais, `migrate diff` vazio, o Prisma Client lê
 * `categoriaManejo.findMany()` e 2ª execução sem pendências. Num banco sem
 * legado, a migration aplica sem impressão; uma impressão INFORMADA errada
 * recusa mesmo assim, e a impressão do vazio informada aplica (o caminho do
 * runbook).
 *
 * As funções são as do ensaio local (`scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs`).
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { encerrar } from './helpers.mjs';
import {
  ARQUIVO_CONTRACT, CENARIOS_RED, COLUNAS, COLUNAS_ANTES, COLUNAS_DEPOIS, CONSTRAINTS_ANTES, CONSTRAINTS_DEPOIS, DECISAO,
  IMPRESSAO_ERRADA, IMPRESSAO_VAZIA, INDICES_ANTES, INDICES_DEPOIS, NOME_CONTRACT, REGEX_ROTINAS, SQL_IMPRESSAO, TABELA_ANTIGA,
  TABELA_NOVA, TRECHOS_DA_GUARDA, NOMES_POSTERIORES_JA_APLICADAS, NOMES_POSTERIORES_NA_PARTIDA, NOME_CURVA_MENSAL, CONCLUIDAS_ANTES, CONCLUIDAS_DEPOIS, TABELAS_PUBLIC,
  NOME_CURVA_NA_CATEGORIA, NOME_PESO_OBJETIVO, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, NOME_BASE, NOME_CULTURAS, NOME_AREA_CULTURA, NOME_MEDICAO_FORRAGEM, NOME_DIAS_DESCANSO, NOME_ATIVIDADE_AREAS, NOME_ESTOQUE_ENTRADAS, NOME_ESTOQUE_ENTRADAS_MOTIVOS, NOME_ESTOQUE_SAIDAS, NOME_APONTAMENTO_DATA_TERMINO, NOME_ESTOQUE_AJUSTES, NOME_CAMPOS_POR_TIPO, NOME_REFORMA, TABELAS_CRIADAS_NO_GREEN, NOMES_DEPOIS_DO_CONTRACT, curvaPadraoDe,
  aplicarMigrationsDaMain, aplicarPeloRunner, colunasDaTabela, comBanco, comImpressao, contagens, divergenciasGreen, exigirUrlLocal,
  historico, impressao, intrusos, migrateDeploy, migrateDiff, ordemDeAplicacao, resolverRevertida, retrato, rodarCenarioRed, semear, sistema, tabelaAtual,
} from '../../scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs';

const BANCO = 'maike_cadcat_teste';
const BANCO_VAZIO = 'maike_cadcat_teste_vazio';
/** Banco sem legado em que o operador informa a impressão do vazio, como manda o runbook (§4.2). */
const BANCO_VAZIO_INFORMADO = 'maike_cadcat_teste_vazio_inf';
/** O lock_timeout da guarda é 5 s; o teto cobre a partida do Prisma CLI em máquina lenta de CI. */
const TETO_TRAVA_MS = 20_000;
const normalizar = (s) => s.replace(/\s+/g, ' ');
/** Ordem de COLLATE "C" para texto ASCII: unidade a unidade, maiúscula antes de minúscula. */
const compararC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** quote_nullable do Postgres para texto sem barra invertida: NULL → NULL; senão entre aspas, com '' no lugar de '. */
const quoteNullable = (v) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

let URL_T;
let URL_V;
let URL_VI;
/** Nem a URL inteira nem o par usuário:senha podem aparecer na saída. */
const vazou = (saida, url) => {
  const u = new URL(url);
  return saida.includes(url) || (u.password !== '' && saida.includes(`${u.username}:${u.password}@`));
};
let db;
let dbVazio;
let partida;

before(async () => {
  const p = getPrismaClient();
  const base = exigirUrlLocal(process.env.DATABASE_URL);
  URL_T = comBanco(base, BANCO);
  URL_V = comBanco(base, BANCO_VAZIO);
  URL_VI = comBanco(base, BANCO_VAZIO_INFORMADO);
  for (const b of [BANCO, BANCO_VAZIO, BANCO_VAZIO_INFORMADO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO}`);
  await aplicarMigrationsDaMain(URL_T);
  db = new PrismaClient({ datasourceUrl: URL_T });
  await semear(db, { clientes: 2 });
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  await dbVazio?.$disconnect();
  const p = getPrismaClient();
  for (const b of [BANCO, BANCO_VAZIO, BANCO_VAZIO_INFORMADO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await encerrar();
});

describe('D-PROD-187 — migration CONTRACT CategoriaManejo → CADCATEGORIA sem as 16 colunas (PostgreSQL real)', () => {
  test('CD-01 partida: todas as migrations menos esta CONTRACT (a CADCURVAGANHO, o ApontamentoAtividade e os itens do apontamento, de nome posterior, já concluídos, e as CONTRACT da D-PROD-194, da D-PROD-197 e da D-PROD-200, também de nome posterior), 84 tabelas, CategoriaManejo com 28 colunas, 4 índices e 3 constraints; impressão de 12 hex igual à conta independente e à expressão da guarda', async () => {
    const h = await historico(db);
    assert.equal(h.concluidas, CONCLUIDAS_ANTES);
    // D-PROD-198: a EXPAND do peso objetivo (ALTER TABLE "CADCATEGORIA") também fica fora da partida: era 2, agora 3.
    // D-PROD-203: a EXPAND das Formulações (FK para "CADCATEGORIA") também: agora 4.
    // D-PROD-205: a EXPAND da Leitura de cocho, de nome ainda posterior, também: agora 5.
    // D-PROD-206: a EXPAND da faixa de tolerância (coluna em CADFORMULACAO), também: agora 6.
    // D-PROD-210: a CONTRACT da base do consumo (altera as 3 tabelas das Formulações), também: agora 7.
    // D-PROD-215: a EXPAND do Cadastro de Culturas (CADCULTURAS), de nome ainda posterior, também: agora 8.
    // D-PROD-216: a CONTRACT aditiva da Área ligada à Cultura (depende da CADCULTURAS), também: agora 9.
    assert.deepEqual(NOMES_DEPOIS_DO_CONTRACT, [NOME_CURVA_NA_CATEGORIA, NOME_PESO_OBJETIVO, NOME_FORMULACOES, NOME_LEITURA, NOME_FAIXA, NOME_BASE, NOME_CULTURAS, NOME_AREA_CULTURA, NOME_MEDICAO_FORRAGEM, NOME_DIAS_DESCANSO, NOME_ATIVIDADE_AREAS, NOME_ESTOQUE_ENTRADAS, NOME_ESTOQUE_ENTRADAS_MOTIVOS, NOME_ESTOQUE_SAIDAS, NOME_APONTAMENTO_DATA_TERMINO, NOME_ESTOQUE_AJUSTES, NOME_CAMPOS_POR_TIPO, NOME_REFORMA]);
    // D-PROD-219: a EXPAND da Medição de Forragem (MEDICAOFORRAGEM; depende da Área e da CADCULTURAS), também: agora 10.
    // D-PROD-223: a EXPAND da coluna CADCULTURAS.dias_descanso, também: agora 11.
    // D-PROD-249: a CONTRACT das áreas da atividade (tabela nova AtividadeArea), também: agora 12.
    // D-PROD-257: a EXPAND das Entradas do Estoque (3 tabelas novas), também: agora 13.
    // D-PROD-259: a CONTRACT dos motivos de entrada (MotivoEntradaEstoque), também: agora 14.
    // D-PROD-264: a EXPAND da saída manual do Estoque (4 tabelas novas), também: agora 15.
    // D-PROD-265: a CONTRACT aditiva da data de término do apontamento (coluna e CHECK), também: agora 16.
    // D-PROD-272: a EXPAND do ajuste de inventário (3 tabelas novas), também: agora 17.
    // D-PROD-274: a EXPAND dos campos por tipo (AtividadePlantio e 5 colunas anuláveis), também: agora 18.
    // D-PROD-275: a EXPAND da reforma (Planejamento, PlanejamentoArea e a coluna da atividade), também: agora 19.
    assert.equal(CONCLUIDAS_ANTES, CONCLUIDAS_DEPOIS - 19, 'todas as pastas menos esta CONTRACT, a D-PROD-195, a D-PROD-198, a D-PROD-203, a D-PROD-205, a D-PROD-206, a D-PROD-210, a D-PROD-215, a D-PROD-216, a D-PROD-219, a D-PROD-223, a D-PROD-249, a D-PROD-257, a D-PROD-259, a D-PROD-264, a D-PROD-265, a D-PROD-272, a D-PROD-274 e a D-PROD-275');
    assert.equal(partida.tabelas, TABELAS_PUBLIC);
    assert.equal(TABELAS_PUBLIC, 90, 'as 82 da main com a CADCURVAGANHO (D-PROD-189) + ApontamentoAtividade (D-PROD-190) + os 2 de itens do apontamento (D-PROD-193) − essas 3 + as 2 da atividade (D-PROD-200, na partida) + as 3 das linhas de produto e de máquina (D-PROD-202, na partida) + as 4 da mão de obra e do serviço (D-PROD-207, na partida); a curva mensal (D-PROD-194) e os padrões do TipoAtividade (D-PROD-197) não mudam a contagem; − a Funcionario (D-PROD-208, na partida, por último)');
    assert.ok(NOMES_POSTERIORES_NA_PARTIDA.includes('20261115900000_atividade_mao_obra_servico'), 'a EXPAND da D-PROD-207 sobe na partida, depois da D-PROD-202');
    assert.deepEqual(NOMES_POSTERIORES_NA_PARTIDA.slice(-4), ['20261116000000_mao_obra_parceiro', '20261116100000_funcionario_tipo_terceirizado', '20261116300000_abastecimento_atividade', '20261117100000_abastecimento_fk_apontamento_atividade'], 'as CONTRACT da D-PROD-208 (Funcionario e a linha de mão de obra vazias), da D-PROD-209 (só o CHECK de Fornecedor), da D-PROD-211 (o abastecimento ligado à atividade; não muda a contagem de tabelas) e da D-PROD-217 (o reforço da FK do apontamento; também não) sobem na partida, por último');
    assert.ok(NOMES_POSTERIORES_NA_PARTIDA.includes('20261114600000_atividade_linhas_produto_maquina'), 'a EXPAND da D-PROD-202 sobe na partida, depois da D-PROD-200');
    assert.ok(NOMES_POSTERIORES_NA_PARTIDA.includes('20261114500000_atividade_cabecalho'), 'a CONTRACT da D-PROD-200 sobe na partida');
    // O estado de produção: duas migrations de nome POSTERIOR a esta CONTRACT já concluídas, por último e nesta ordem, e esta pendente.
    assert.deepEqual(NOMES_POSTERIORES_JA_APLICADAS, ['20261113600000_cadcurvaganho_cadastro', '20261113700000_apontamento_atividade']);
    // D-PROD-193: a partida sobe pela ordem dos nomes; as de nome posterior que vieram depois das duas (os itens do
    // apontamento e a CONTRACT da D-PROD-194) também já estão concluídas aqui, depois delas (em produção entram depois
    // desta CONTRACT).
    assert.deepEqual(NOMES_POSTERIORES_NA_PARTIDA.slice(0, NOMES_POSTERIORES_JA_APLICADAS.length), [...NOMES_POSTERIORES_JA_APLICADAS]);
    assert.ok(NOMES_POSTERIORES_NA_PARTIDA.includes('20261113800000_apontamento_atividade_item'));
    assert.ok(NOMES_POSTERIORES_NA_PARTIDA.includes(NOME_CURVA_MENSAL), 'a CONTRACT da D-PROD-194 sobe na partida');
    for (const n of NOMES_POSTERIORES_NA_PARTIDA) assert.ok(n > NOME_CONTRACT, `${n} tem nome posterior`);
    assert.ok(!NOMES_POSTERIORES_NA_PARTIDA.includes(NOME_CURVA_NA_CATEGORIA), 'a D-PROD-195 (exige CADCATEGORIA) fica fora da partida');
    assert.ok(!NOMES_POSTERIORES_NA_PARTIDA.includes(NOME_PESO_OBJETIVO), 'a D-PROD-198 (exige CADCATEGORIA) fica fora da partida');
    assert.ok(!NOMES_POSTERIORES_NA_PARTIDA.includes(NOME_FORMULACOES), 'a D-PROD-203 (exige CADCATEGORIA) fica fora da partida');
    assert.ok(NOMES_POSTERIORES_NA_PARTIDA.includes('20261114300000_tipo_atividade_defaults'), 'a CONTRACT da D-PROD-197 (só TipoAtividade) sobe na partida');
    assert.ok(NOME_CURVA_MENSAL > NOME_CONTRACT, 'a CONTRACT da D-PROD-194 tem nome posterior');
    const ordem = await ordemDeAplicacao(db);
    // Pelo Prisma direto, em ordem de nome: as duas EXPAND de nome posterior e, depois, as demais (a CONTRACT da D-PROD-194 entre elas).
    assert.deepEqual(ordem.slice(-NOMES_POSTERIORES_NA_PARTIDA.length), [...NOMES_POSTERIORES_NA_PARTIDA]);
    assert.ok(!ordem.includes(NOME_CONTRACT));
    assert.ok(!ordem.includes(NOME_CURVA_NA_CATEGORIA));
    assert.ok(!ordem.includes(NOME_PESO_OBJETIVO));
    assert.ok(!ordem.includes(NOME_FORMULACOES));
    assert.ok(!ordem.includes(NOME_LEITURA));
    assert.ok(!ordem.includes(NOME_FAIXA));
    assert.ok(!ordem.includes(NOME_BASE));
    assert.ok(!ordem.includes(NOME_CULTURAS));
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    assert.equal(partida.tabela, TABELA_ANTIGA);
    assert.equal(partida.colunas, 28);
    assert.deepEqual(await colunasDaTabela(db), [...COLUNAS_ANTES]);
    assert.deepEqual(partida.estrutura.indices, [...INDICES_ANTES]);
    assert.deepEqual(partida.estrutura.constraints, [...CONSTRAINTS_ANTES]);
    assert.notEqual(partida.legado, null);
    assert.equal(partida.linhas.n, 8);
    assert.equal(partida.Cliente.n, 2);
    assert.equal(partida.CatalogoCategoriaVisual.n, 1);

    const imp = await impressao(db);
    assert.match(imp.impressao, /^[0-9a-f]{12}$/);
    assert.equal(imp.linhas, 6, '3 categorias com algum valor por cliente');

    // A mesma conta, feita fora do banco: cliente_id|id|16 valores com quote_nullable, ordem "C" por (cliente_id, id).
    const linhas = await db.$queryRawUnsafe(`SELECT cliente_id::text AS cliente_id, id, ${COLUNAS.map((c) => `${c}::text AS ${c}`).join(', ')} FROM "${TABELA_ANTIGA}"`);
    const texto = linhas
      .filter((l) => COLUNAS.some((c) => l[c] !== null))
      .sort((a, b) => compararC(a.cliente_id, b.cliente_id) || compararC(a.id, b.id))
      .map((l) => [l.cliente_id, l.id, ...COLUNAS.map((c) => quoteNullable(l[c]))].join('|'))
      .join('\n');
    assert.ok(texto.includes("'D''ANGUS'"), 'o apóstrofo entra dobrado, como no quote_nullable');
    assert.equal(imp.impressao, createHash('md5').update(texto).digest('hex').slice(0, 12));
    assert.equal(IMPRESSAO_VAZIA, createHash('md5').update('').digest('hex').slice(0, 12));

    // O preflight do runbook repete a expressão da guarda letra por letra (impressão e busca de rotinas).
    const guarda = normalizar(readFileSync(ARQUIVO_CONTRACT, 'utf8'));
    for (const trecho of TRECHOS_DA_GUARDA) {
      assert.ok(guarda.includes(trecho), `a guarda tem: ${trecho}`);
      assert.ok(normalizar(SQL_IMPRESSAO).includes(trecho), `o preflight tem: ${trecho}`);
    }
    assert.ok(guarda.includes(`~* '${REGEX_ROTINAS}'`), 'a busca de rotinas do preflight é a da guarda');

    const c = await contagens(db);
    assert.deepEqual(c.map((x) => x.cliente_id), ['cad-c1', 'cad-c2']);
    for (const x of c) {
      assert.deepEqual(
        { categorias: x.categorias, com_valor: x.categorias_com_valor, raca: x.raca, oficial: x.categoria_oficial, ganho: x.ganho_peso_anual_kg, marco: x.gmd_marco, janeiro: x.gmd_janeiro, icone: x.catalogo_categoria_visual_id },
        { categorias: 4, com_valor: 3, raca: 2, oficial: 1, ganho: 1, marco: 2, janeiro: 1, icone: 1 }
      );
    }
    assert.deepEqual(await intrusos(db), []);
  });

  for (const cenario of CENARIOS_RED) {
    test(`CD-RED ${cenario.id}: recusado com a mensagem própria e NADA muda (28 colunas, nome, linhas e valores idênticos, migration aberta → resolvida)`, async () => {
      const r = await rodarCenarioRed(cenario, { db, url: URL_T });
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, cenario.esperado);
      assert.equal(r.antes.colunas, 28);
      assert.equal(r.antes.tabela, TABELA_ANTIGA);
      assert.deepEqual(r.depois, r.antes, 'nenhuma coluna, nome, linha ou valor mudou');
      assert.equal(r.historico.contract_concluida, 0);
      assert.equal(r.historico.contract_aberta, 1, 'a linha da migration fica com finished_at NULL');
      assert.equal(r.resolvida?.status, 0, r.resolvida?.saida);
      if (cenario.trava) assert.ok(r.ms < TETO_TRAVA_MS, `o runner saiu em ${r.ms} ms (lock_timeout de 5 s; não espera a trava)`);
      assert.equal((await historico(db)).contract_aberta, 0);
      assert.deepEqual(await intrusos(db), [], 'o objeto do cenário foi removido');
      assert.deepEqual(await retrato(db), partida, 'o cenário foi desfeito por inteiro');
      assert.ok(!vazou(r.saida, URL_T), 'a URL nunca aparece na saída');
    });
  }

  test('CD-02 runner com a conferência de alvo exigida (alvo "remoto" simulado) e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED antes de qualquer DDL', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    const linhasAntes = (await historico(db)).total;
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-183' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-187' }]) {
      const r = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.saida.includes(`${NOME_CONTRACT} (${DECISAO})`), r.saida);
      for (const outra of ['20261110300000_patrimonio_simplifica', '20261113200000_tipo_tarefa_drop_colunas', '20261114100000_cadcurvaganho_mensal', '20261114300000_tipo_atividade_defaults']) {
        assert.ok(!r.saida.includes(outra), `${outra} já está concluída: só a D-PROD-187 e a D-PROD-195 pendem (e a EXPAND da D-PROD-198)`);
      }
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(r.saida, URL_T));
    }
    assert.equal((await historico(db)).total, linhasAntes, 'nenhuma linha nova no histórico');
    assert.deepEqual(await retrato(db), partida);
  });

  test('CD-03 GREEN pelo runner oficial: com o alvo conferido e MIGRATION_CONTRACT_AUTORIZADO=D-PROD-187 recusa (a D-PROD-195 pende junto; nada muda); no alvo local, com a impressão na URL, aplica esta, depois da CADCURVAGANHO, do ApontamentoAtividade e dos itens do apontamento, de nome posterior, e das CONTRACT da D-PROD-194 e da D-PROD-197, e a D-PROD-195 e a EXPAND da D-PROD-198 por último: todas/0, CADCATEGORIA com o mesmo OID/ACL/RLS/políticas, 12 colunas + a curva + o peso objetivo, cada categoria na CURVA PADRÃO da fazenda, linhas idênticas, nomes novos, migrate diff vazio e o Prisma Client lê', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    // Nunca duas CONTRACT de uma vez: a decisão desta não basta com a D-PROD-195 também pendente.
    const recusada = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(recusada.status, 1, recusada.saida);
    assert.match(recusada.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
    assert.ok(recusada.saida.includes(`${NOME_CURVA_NA_CATEGORIA} (D-PROD-195)`), recusada.saida);
    assert.match(recusada.saida, /Nenhuma migration foi executada/);
    assert.ok(!vazou(recusada.saida, URL_T));
    assert.deepEqual(await retrato(db), partida, 'nada mudou');

    // Alvo local (sem a conferência): o runner aplica as três pendentes, esta, depois a D-PROD-195 e a D-PROD-198 (EXPAND).
    const r = await aplicarPeloRunner(comImpressao(URL_T, imp));
    assert.equal(r.status, 0, r.saida);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.equal(h.concluidas, CONCLUIDAS_DEPOIS);
    assert.equal(CONCLUIDAS_DEPOIS, readdirSync(new URL('../prisma/migrations/', import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 'todas as pastas');
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    // Ordem real de aplicação: a CONTRACT DEPOIS das de nome posterior (as EXPAND e a CONTRACT da D-PROD-194; o runner e
    // o `prisma migrate deploy` aplicam a pendente sem exigir a ordem dos nomes) e, por último, a D-PROD-195 e a D-PROD-198.
    assert.deepEqual(
      (await ordemDeAplicacao(db)).slice(-(NOMES_POSTERIORES_NA_PARTIDA.length + 1 + NOMES_DEPOIS_DO_CONTRACT.length)),
      [...NOMES_POSTERIORES_NA_PARTIDA, NOME_CONTRACT, ...NOMES_DEPOIS_DO_CONTRACT]
    );

    assert.equal(await tabelaAtual(db), TABELA_NOVA);
    const [{ antiga }] = await db.$queryRawUnsafe(`SELECT to_regclass('public."${TABELA_ANTIGA}"') IS NULL AS antiga`);
    assert.equal(antiga, true, 'o nome antigo sumiu');
    assert.deepEqual(await colunasDaTabela(db), [...COLUNAS_DEPOIS]);
    // D-PROD-195: cada categoria ficou na CURVA PADRÃO da própria fazenda (nunca na outra curva da fazenda).
    const curvas = await db.$queryRawUnsafe(`SELECT cliente_id::text AS cliente, id, curva_ganho_id AS curva FROM public."${TABELA_NOVA}" ORDER BY id COLLATE "C"`);
    assert.equal(curvas.length, partida.linhas.n);
    for (const x of curvas) assert.equal(x.curva, curvaPadraoDe(x.cliente), x.id);
    // D-PROD-198: o peso objetivo entra vazio em todas as categorias que já existiam (EXPAND, sem DEFAULT).
    const [{ com_peso }] = await db.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE peso_objetivo_kg IS NOT NULL)::int AS com_peso FROM public."${TABELA_NOVA}"`);
    assert.equal(com_peso, 0);
    const depois = await retrato(db);
    assert.deepEqual(divergenciasGreen(partida, depois), []);
    assert.equal(depois.estrutura.oid, partida.estrutura.oid, 'a mesma tabela (RENAME, não cópia)');
    assert.deepEqual(depois.estrutura.indices, [...INDICES_DEPOIS]);
    assert.deepEqual(depois.estrutura.constraints, [...CONSTRAINTS_DEPOIS]);
    assert.equal(depois.legado, null, 'as 16 colunas sumiram');
    assert.deepEqual(depois.linhas, partida.linhas, 'as linhas nas 12 colunas que ficam não mudaram');
    assert.equal(depois.tabelas, partida.tabelas + TABELAS_CRIADAS_NO_GREEN.length, 'nenhuma tabela criada nem apagada além das 3 das Formulações (D-PROD-203) e da LEITURACOCHO (D-PROD-205), por último');
    assert.deepEqual(depois.CatalogoCategoriaVisual, partida.CatalogoCategoriaVisual, 'o catálogo global só perdeu a FK que apontava para ele');
    // Nenhuma FK de outra tabela aponta para CADCATEGORIA nem sobrou FK para o catálogo (a da D-PROD-195 sai de CADCATEGORIA).
    // A única que entra é a da regra por categoria das Formulações (D-PROD-203, aplicada depois desta), contada à parte.
    const [{ fks_entrando, fks_catalogo, fks_formulacao }] = await db.$queryRawUnsafe(`SELECT
        (SELECT count(*)::int FROM pg_constraint WHERE confrelid = 'public."${TABELA_NOVA}"'::regclass AND conrelid <> 'public."CADFORMULACAOREGRA"'::regclass) AS fks_entrando,
        (SELECT count(*)::int FROM pg_constraint WHERE confrelid = 'public."${TABELA_NOVA}"'::regclass AND conrelid = 'public."CADFORMULACAOREGRA"'::regclass) AS fks_formulacao,
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public."${TABELA_NOVA}"'::regclass AND confrelid = 'public."CatalogoCategoriaVisual"'::regclass) AS fks_catalogo`);
    assert.deepEqual({ fks_entrando, fks_catalogo, fks_formulacao }, { fks_entrando: 0, fks_catalogo: 0, fks_formulacao: 1 });

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);

    // O delegate continua `categoriaManejo` (o @@map só muda o nome físico) e devolve exatamente as 12 colunas, a curva e o peso objetivo.
    const lidas = await db.categoriaManejo.findMany({ orderBy: { id: 'asc' } });
    assert.equal(lidas.length, partida.linhas.n);
    assert.deepEqual(Object.keys(lidas[0]).sort(), [...COLUNAS_DEPOIS].sort());
    assert.equal(lidas.find((x) => x.id === 'cad-c1-cat-A').nome, 'BEZERRO MACHO');
  });

  test('CD-04 2ª execução do runner: nada pendente e nada muda', async () => {
    const antes = await retrato(db);
    const r = await aplicarPeloRunner(URL_T);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
    assert.equal((await historico(db)).concluidas, CONCLUIDAS_DEPOIS);
  });

  test('CD-05 banco sem legado: impressão INFORMADA errada recusa mesmo assim; sem impressão, o prisma migrate deploy aplica (e a D-PROD-195 depois, com a CURVA PADRÃO semeada, e a D-PROD-198)', async () => {
    const p = getPrismaClient();
    await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_VAZIO}`);
    await aplicarMigrationsDaMain(URL_V);
    dbVazio = new PrismaClient({ datasourceUrl: URL_V });
    await semear(dbVazio, { clientes: 1, apenasVazias: true });
    const partidaV = await retrato(dbVazio);
    assert.equal(partidaV.colunas, 28);
    assert.equal(partidaV.linhas.n, 1, 'uma categoria, sem nada nas 16 colunas');
    assert.deepEqual(await impressao(dbVazio), { linhas: 0, impressao: IMPRESSAO_VAZIA });

    // Com o parâmetro informado, ele tem de bater (aqui, com o md5 de vazio): o errado recusa e nada muda.
    const errada = await migrateDeploy(comImpressao(URL_V, IMPRESSAO_ERRADA));
    assert.notEqual(errada.status, 0, errada.saida);
    assert.match(errada.saida, new RegExp(`categoria_manejo_cadcategoria: os valores das colunas apagadas \\(0 categorias de manejo\\) não são os aprovados no GO \\(maike\\.categoria_manejo_legado_impressao = ${IMPRESSAO_ERRADA}\\)`));
    assert.ok(!vazou(errada.saida, URL_V));
    assert.deepEqual(await retrato(dbVazio), partidaV);
    assert.equal((await historico(dbVazio)).contract_aberta, 1);
    const resolvida = await resolverRevertida(URL_V);
    assert.equal(resolvida.status, 0, resolvida.saida);

    // Sem legado e sem o parâmetro: não há o que perder, a guarda dispensa a impressão.
    const r = await migrateDeploy(URL_V);
    assert.equal(r.status, 0, r.saida);
    const h = await historico(dbVazio);
    assert.equal(h.concluidas, CONCLUIDAS_DEPOIS);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    assert.deepEqual(await colunasDaTabela(dbVazio), [...COLUNAS_DEPOIS]);
    assert.deepEqual(divergenciasGreen(partidaV, await retrato(dbVazio)), []);
    const diff = await migrateDiff(URL_V);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('CD-06 banco sem legado com a impressão do vazio INFORMADA (o caminho do runbook §4.2): aplica', async () => {
    const p = getPrismaClient();
    await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_VAZIO_INFORMADO}`);
    await aplicarMigrationsDaMain(URL_VI);
    const dbVI = new PrismaClient({ datasourceUrl: URL_VI });
    try {
      await semear(dbVI, { clientes: 1, apenasVazias: true });
      const partidaVI = await retrato(dbVI);
      assert.deepEqual(await impressao(dbVI), { linhas: 0, impressao: IMPRESSAO_VAZIA });
      const r = await migrateDeploy(comImpressao(URL_VI, IMPRESSAO_VAZIA));
      assert.equal(r.status, 0, r.saida);
      assert.ok(!vazou(r.saida, URL_VI));
      const h = await historico(dbVI);
      assert.equal(h.concluidas, CONCLUIDAS_DEPOIS);
      assert.equal(h.contract_concluida, 1);
      assert.deepEqual(await colunasDaTabela(dbVI), [...COLUNAS_DEPOIS]);
      assert.deepEqual(divergenciasGreen(partidaVI, await retrato(dbVI)), []);
    } finally {
      await dbVI.$disconnect();
    }
  });
});
