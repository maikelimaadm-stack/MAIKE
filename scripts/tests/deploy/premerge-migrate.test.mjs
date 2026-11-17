/**
 * PR174-R6/R7 — allowlist EXPAND fechada (manifesto pinado + conferência
 * estrutural), modo CONTRACT fechado (D-PROD-162, D-PROD-183, D-PROD-187, D-PROD-194, D-PROD-195, D-PROD-197, D-PROD-200,
 * esta no formato CONVERSÃO, D-PROD-208, com o DROP no fim sem conversão, D-PROD-209, a troca do CHECK do tipo do funcionário, D-PROD-210, a base do consumo na Formulação, D-PROD-211, o abastecimento ligado à atividade, e D-PROD-216, o reforço da FK do apontamento do abastecimento), EXPAND das linhas de produto e de máquina (D-PROD-202), das Formulações (D-PROD-203), da Leitura de cocho (D-PROD-205), da faixa de tolerância (D-PROD-206) e da mão de obra e do serviço (D-PROD-207), conferência do histórico do alvo, barreiras do runner pré-merge e da identidade de
 * produção do cutover. Sem banco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

import {
  classificarMigrations, conferirHistoricoRemoto, sha256, MIGRATIONS_APROVADAS, migrationsDoManifestoFaltando,
  MIGRATIONS_CONTRACT_APROVADAS, conferirReleaseContract, contractsPendentes, envDoDeployMigrate, DO_RLS_APROVADOS,
} from '../../deploy/premergeMigrateLib.mjs';
import { conferirBackendNovo, validarOrigemProducao } from '../../ops/cutoverRebanhoLib.mjs';

const NOMES = Object.keys(MIGRATIONS_APROVADAS);
const ler = (n) => ({ nome: n, sql: readFileSync(`backend/prisma/migrations/${n}/migration.sql`, 'utf8') });
const BASE = `CREATE TABLE "Nova" ("id" TEXT NOT NULL, "cliente_id" VARCHAR(64) NOT NULL);\n`;
/** Classifica SQL sintético com manifesto próprio (só para testar a conferência estrutural). */
const classificar = (sql, extra = {}) => classificarMigrations([{ nome: 'x', sql }], { manifesto: { x: sha256(sql) }, ...extra });

/** D-PROD-162 — a primeira migration CONTRACT aprovada (a segunda é a D-PROD-183, a terceira a D-PROD-187, a quarta a D-PROD-194, a quinta a D-PROD-195 e a sexta a D-PROD-197, logo abaixo). */
const NOME_C = '20261110300000_patrimonio_simplifica';
const SQL_C = readFileSync(`backend/prisma/migrations/${NOME_C}/migration.sql`, 'utf8');
const DROP_C = ['AbastecimentoBemConsumoLote', 'AbastecimentoBem', 'ConversaoCombustivelProduto', 'TipoCombustivelProduto', 'TanqueBemCombustivel', 'TanqueBem', 'MedicaoBem', 'BemPatrimonial', 'TipoPatrimonialPerfil', 'TipoPatrimonial', 'FamiliaPatrimonial', 'PerfilMedicao', 'TipoCombustivel'];
const NOVAS_C = ['AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'BemPatrimonial', 'FamiliaPatrimonial', 'TanqueBem', 'TanqueBemProduto', 'TipoPatrimonial'];
const ALARGADAS_C = ['OperacaoFinanceiraItem.OperacaoFinanceiraItem_unidade_check', 'OperacaoFinanceiraItem.OperacaoFinanceiraItem_forma_check'];
/** D-PROD-187: os 4 campos descritivos novos ficam vazios nas CONTRACT que não os usam — D-PROD-162, D-PROD-183, D-PROD-194, D-PROD-195 e D-PROD-197 (o alargamento da D-PROD-162 recria as 2 constraints). */
const VAZIOS_187 = { constraints_removidas: [], indices_removidos: [], tabelas_renomeadas: [], nomes_renomeados: [] };
/**
 * D-PROD-197: os 2 campos descritivos das instruções ADITIVAS (coluna e constraint que não existiam) ficam vazios nas
 * CONTRACT que nada acrescentam a tabela antiga — D-PROD-162, D-PROD-183, D-PROD-187 e D-PROD-194; a D-PROD-195 declara
 * neles a coluna e a FK composta que acrescenta à CADCATEGORIA. Na D-PROD-162 o `ADD CONSTRAINT` vem depois do `DROP
 * CONSTRAINT` do mesmo nome: é alargamento (`constraints_alargadas`), não constraint nova.
 */
const VAZIOS_196 = { colunas_adicionadas: [], constraints_adicionadas: [] };
/** D-PROD-200: o campo descritivo do formato CONVERSÃO (`conversoes`) fica vazio nas seis CONTRACT anteriores, que não têm `conversao`. */
const VAZIOS_199 = { conversoes: [] };
const CONTRACT_C = { migration: NOME_C, decisao: 'D-PROD-162', tabelas_removidas: DROP_C, constraints_alargadas: ALARGADAS_C, colunas_removidas: [], ...VAZIOS_187, ...VAZIOS_196, ...VAZIOS_199 };
/** D-PROD-183 — a segunda migration CONTRACT aprovada: DROP COLUMN das 4 colunas dormentes de TipoTarefa (sem DROP TABLE, sem tabela nova). */
const NOME_T = '20261113200000_tipo_tarefa_drop_colunas';
const SQL_T = readFileSync(`backend/prisma/migrations/${NOME_T}/migration.sql`, 'utf8');
const COLUNAS_T = ['exige_area', 'pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento'];
const REMOVIDAS_T = COLUNAS_T.map((c) => `TipoTarefa.${c}`);
const ALTER_T = COLUNAS_T.map((c) => `ALTER TABLE "TipoTarefa" DROP COLUMN "${c}"`);
const CONTRACT_T = { migration: NOME_T, decisao: 'D-PROD-183', tabelas_removidas: [], constraints_alargadas: [], colunas_removidas: REMOVIDAS_T, ...VAZIOS_187, ...VAZIOS_196, ...VAZIOS_199 };
/**
 * D-PROD-187 — a terceira migration CONTRACT aprovada: DROP COLUMN das 15 colunas dormentes de CategoriaManejo e do
 * vínculo com o ícone oficial (com a FK e o índice), e o nome físico novo da tabela, CADCATEGORIA (sem DROP TABLE,
 * sem tabela nova). As 23 instruções pinadas, na ordem.
 */
const NOME_D = '20261113500000_categoria_manejo_cadcategoria';
const SQL_D = readFileSync(`backend/prisma/migrations/${NOME_D}/migration.sql`, 'utf8');
const MESES_D = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const COLUNAS_D = ['raca', 'categoria_oficial', 'ganho_peso_anual_kg', ...MESES_D.map((m) => `gmd_${m}`), 'catalogo_categoria_visual_id'];
const ALTER_D = [
  'ALTER TABLE "CategoriaManejo" DROP CONSTRAINT "CategoriaManejo_catalogo_categoria_visual_id_fkey"',
  'DROP INDEX "CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx"',
  ...COLUNAS_D.map((c) => `ALTER TABLE "CategoriaManejo" DROP COLUMN "${c}"`),
  'ALTER TABLE "CategoriaManejo" RENAME TO "CADCATEGORIA"',
  'ALTER TABLE "CADCATEGORIA" RENAME CONSTRAINT "CategoriaManejo_pkey" TO "CADCATEGORIA_pkey"',
  'ALTER INDEX "CategoriaManejo_cliente_id_id_key" RENAME TO "CADCATEGORIA_cliente_id_id_key"',
  'ALTER INDEX "CategoriaManejo_cliente_id_empresa_id_idx" RENAME TO "CADCATEGORIA_cliente_id_empresa_id_idx"',
  'ALTER TABLE "CADCATEGORIA" RENAME CONSTRAINT "CategoriaManejo_cliente_id_fkey" TO "CADCATEGORIA_cliente_id_fkey"',
];
const CONTRACT_D = {
  migration: NOME_D, decisao: 'D-PROD-187', tabelas_removidas: [], constraints_alargadas: [],
  colunas_removidas: COLUNAS_D.map((c) => `CategoriaManejo.${c}`),
  constraints_removidas: ['CategoriaManejo.CategoriaManejo_catalogo_categoria_visual_id_fkey'],
  indices_removidos: ['CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx'],
  tabelas_renomeadas: ['CategoriaManejo→CADCATEGORIA'],
  nomes_renomeados: [
    'CategoriaManejo_pkey→CADCATEGORIA_pkey', 'CategoriaManejo_cliente_id_id_key→CADCATEGORIA_cliente_id_id_key',
    'CategoriaManejo_cliente_id_empresa_id_idx→CADCATEGORIA_cliente_id_empresa_id_idx', 'CategoriaManejo_cliente_id_fkey→CADCATEGORIA_cliente_id_fkey',
  ],
  ...VAZIOS_196,
  ...VAZIOS_199,
};
/** D-PROD-194 — a quarta migration CONTRACT aprovada: DROP TABLE da CADCURVAGANHO VAZIA e a mesma tabela recriada com os 12 GMD mensais. */
const NOME_K = '20261114100000_cadcurvaganho_mensal';
const SQL_K = readFileSync(`backend/prisma/migrations/${NOME_K}/migration.sql`, 'utf8');
const DROP_K = 'DROP TABLE "CADCURVAGANHO";';
const CONTRACT_K = { migration: NOME_K, decisao: 'D-PROD-194', tabelas_removidas: ['CADCURVAGANHO'], constraints_alargadas: [], colunas_removidas: [], ...VAZIOS_187, ...VAZIOS_196, ...VAZIOS_199 };
/**
 * D-PROD-195 — a quinta migration CONTRACT aprovada: a Categoria de Manejo (CADCATEGORIA) ganha a curva de ganho
 * OBRIGATÓRIA, da mesma fazenda (sem DROP, sem tabela nova). As 5 instruções pinadas, na ordem. O descritor declara a
 * coluna nova e a FK composta como ADICIONADAS (`colunas_adicionadas`/`constraints_adicionadas`): nenhum `DROP
 * CONSTRAINT` do mesmo nome vem antes da FK, então nada é alargado. A ligação (UPDATE), o SET NOT NULL e o UNIQUE em
 * CADCURVAGANHO só existem como texto pinado (B18b e B18c).
 */
const NOME_G = '20261114200000_cadcategoria_curva_ganho';
/** D-PROD-198 — peso objetivo na CADCATEGORIA: EXPAND puro (uma coluna anulável em tabela antiga). */
const NOME_PO = '20261114400000_cadcategoria_peso_objetivo';
const SQL_G = readFileSync(`backend/prisma/migrations/${NOME_G}/migration.sql`, 'utf8');
const FK_G = 'CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey';
const ALTER_G = [
  'ALTER TABLE "CADCATEGORIA" ADD COLUMN "curva_ganho_id" VARCHAR(64)',
  'UPDATE "CADCATEGORIA" AS c SET "curva_ganho_id" = k."id" FROM "CADCURVAGANHO" AS k WHERE k."cliente_id" = c."cliente_id" AND k."empresa_id" = c."empresa_id" AND k."nome" = \'CURVA PADRÃO\'',
  'ALTER TABLE "CADCATEGORIA" ALTER COLUMN "curva_ganho_id" SET NOT NULL',
  'CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_empresa_id_id_key" ON "CADCURVAGANHO"("cliente_id", "empresa_id", "id")',
  `ALTER TABLE "CADCATEGORIA" ADD CONSTRAINT "${FK_G}" FOREIGN KEY ("cliente_id", "empresa_id", "curva_ganho_id") REFERENCES "CADCURVAGANHO"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE`,
];
const INDICE_G = 'CREATE INDEX "CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_idx" ON "CADCATEGORIA"("cliente_id", "empresa_id", "curva_ganho_id");';
const CONTRACT_G = {
  migration: NOME_G, decisao: 'D-PROD-195', tabelas_removidas: [], constraints_alargadas: [], colunas_removidas: [], ...VAZIOS_187,
  colunas_adicionadas: ['CADCATEGORIA.curva_ganho_id'], constraints_adicionadas: [`CADCATEGORIA.${FK_G}`], ...VAZIOS_199,
};
/**
 * D-PROD-197 — a sexta migration CONTRACT aprovada: o Tipo de Atividade ganha os padrões e as flags. ADITIVA (sem DROP
 * nenhum): depois da guarda, as 18 instruções pinadas em TipoAtividade, na ordem — 13 ADD COLUMN (5 anuláveis e as 8
 * flags NOT NULL DEFAULT false), 3 FKs compostas para tabelas antigas e 2 CHECKs — e, no resto, 3 CREATE INDEX.
 */
const NOME_P = '20261114300000_tipo_atividade_defaults';
const SQL_P = readFileSync(`backend/prisma/migrations/${NOME_P}/migration.sql`, 'utf8');
const ANULAVEIS_P = [['categoria', 'VARCHAR(24)'], ['centro_custo_padrao_id', 'VARCHAR(64)'], ['centro_resultado_padrao_id', 'VARCHAR(64)'], ['unidade_producao_id', 'VARCHAR(64)'], ['coeficiente_padrao', 'DECIMAL(14,4)']];
const FLAGS_P = ['exige_area', 'exige_safra', 'exige_maquina', 'permite_implemento', 'permite_produto', 'permite_servico', 'permite_mao_obra', 'exige_producao'];
const FKS_P = [['centro_custo_padrao_id', 'CentroCusto'], ['centro_resultado_padrao_id', 'CentroResultado'], ['unidade_producao_id', 'UnidadeMedida']];
const CATEGORIAS_P = ['PREPARO_SOLO', 'PLANTIO', 'TRATO_CULTURAL', 'APLICACAO', 'COLHEITA', 'PASTAGEM', 'BENFEITORIA', 'MANEJO_ANIMAL', 'OUTROS'];
const ALTER_P = [
  ...ANULAVEIS_P.map(([c, tipo]) => `ALTER TABLE "TipoAtividade" ADD COLUMN "${c}" ${tipo}`),
  ...FLAGS_P.map((c) => `ALTER TABLE "TipoAtividade" ADD COLUMN "${c}" BOOLEAN NOT NULL DEFAULT false`),
  ...FKS_P.map(([c, alvo]) => `ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_${c}_fkey" FOREIGN KEY ("cliente_id", "${c}") REFERENCES "${alvo}"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE`),
  `ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_categoria_check" CHECK ("categoria" IN (${CATEGORIAS_P.map((v) => `'${v}'`).join(', ')}))`,
  'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_coeficiente_padrao_check" CHECK ("coeficiente_padrao" > 0)',
];
const INDICES_P = FKS_P.map(([c]) => `CREATE INDEX "TipoAtividade_cliente_id_${c}_idx" ON "TipoAtividade"("cliente_id", "${c}")`);
const CONTRACT_P = {
  migration: NOME_P, decisao: 'D-PROD-197', tabelas_removidas: [], constraints_alargadas: [], colunas_removidas: [], ...VAZIOS_187,
  colunas_adicionadas: [...ANULAVEIS_P.map(([c]) => c), ...FLAGS_P].map((c) => `TipoAtividade.${c}`),
  constraints_adicionadas: [...FKS_P.map(([c]) => `TipoAtividade_cliente_id_${c}_fkey`), 'TipoAtividade_categoria_check', 'TipoAtividade_coeficiente_padrao_check'].map((c) => `TipoAtividade.${c}`),
  ...VAZIOS_199,
};
/**
 * D-PROD-200 — a sétima migration CONTRACT aprovada, a primeira no formato CONVERSÃO: a atividade vira cabeçalho
 * (Atividade) e o apontamento de hoje vira filho dela (AtividadeApontamento). Depois da guarda, nenhuma instrução em
 * tabela antiga; no resto, as 2 tabelas novas pela allowlist EXPAND; e, como ÚLTIMAS instruções do arquivo, EXATAMENTE
 * as 3 da conversão pinada (2 INSERT … SELECT e o UPDATE do contador) e os 3 DROP TABLE das antigas, filhas primeiro.
 */
const NOME_V = '20261114500000_atividade_cabecalho';
const SQL_V = readFileSync(`backend/prisma/migrations/${NOME_V}/migration.sql`, 'utf8');
const DROP_V = ['ApontamentoAtividadeItemConsumoLote', 'ApontamentoAtividadeItem', 'ApontamentoAtividade'];
const NOVAS_V = ['Atividade', 'AtividadeApontamento'];
const DO_V = '8f0b1b5ccc478778e1f9aeb94945e9bfde631f4accb12a55abb09e944cc5b98c';
/** As 6 instruções da cauda, como estão no arquivo (com o ';'): 3 da conversão e os 3 DROP. */
const CAUDA_V = (() => {
  const sem = SQL_V.replace(/--[^\n]*/g, '');
  return sem.slice(sem.lastIndexOf('END $$;') + 'END $$;'.length).split(';').map((s) => s.trim()).filter(Boolean).map((s) => `${s};`);
})();
const [INS_ATIV_V, INS_APONT_V, UPD_SEQ_V, ...DROPS_V] = CAUDA_V;
const CONTRACT_V = {
  migration: NOME_V, decisao: 'D-PROD-200', tabelas_removidas: DROP_V, constraints_alargadas: [], colunas_removidas: [], ...VAZIOS_187, ...VAZIOS_196,
  conversoes: ['INSERT INTO Atividade', 'INSERT INTO AtividadeApontamento', 'UPDATE EntidadeCodigoSequencia'],
};
/**
 * D-PROD-202 (Fatia 3) — as linhas de produto e de máquina do apontamento: EXPAND puro. As 3 tabelas novas, o RLS
 * pinado delas e duas colunas ANULÁVEIS, sem DEFAULT, em tabelas antigas (BemPatrimonial e TipoPatrimonial). Nenhum
 * dado migrado; AtividadeApontamento (D-PROD-200) é ANTIGA nesta release.
 */
const NOME_L = '20261114600000_atividade_linhas_produto_maquina';
const NOVAS_L = ['AtividadeApontamentoMaquina', 'AtividadeApontamentoProduto', 'AtividadeApontamentoProdutoConsumoLote'];
const COLUNAS_L = ['BemPatrimonial.custo_uso_unitario', 'TipoPatrimonial.salto_maximo_medidor'];
const DO_L = '3991bb1cbddf3772bf580b1bf35de71580b77725d20e77c0d6df7d8a1f2e95d8';
/** D-PROD-203 — Formulações de suplemento: EXPAND puro, só as 3 tabelas novas (nenhuma tabela antiga alterada). */
const NOME_F = '20261114700000_cadformulacao';
const NOVAS_F = ['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA'];
const DO_F = 'b04af24e7e13859c210fa6d93193be060fac3ea2f2fa90cc99f41d0ed028bfd6';
/** D-PROD-205 — Leitura de cocho: EXPAND puro, só a tabela nova LEITURACOCHO (nenhuma tabela antiga alterada). */
const NOME_LC = '20261115100000_leitura_cocho';
const NOVAS_LC = ['LEITURACOCHO'];
const DO_LC = '60149f94e07596da2c93471f82110e6f37b5f014bcf721c1dc366a2d4b4bcce8';
/** D-PROD-206 — Fechamento do consumo: EXPAND puro, só a coluna anulável CADFORMULACAO.faixa_tolerancia_percentual. */
const NOME_FT = '20261115200000_formulacao_faixa_tolerancia';
/**
 * D-PROD-207 (Fatia 4) — mão de obra e serviço de terceiro do apontamento: EXPAND puro. As 4 tabelas novas
 * (Funcionario, Servico e as 2 linhas) e o RLS pinado delas. Nenhuma coluna em tabela antiga, nenhum dado migrado;
 * AtividadeApontamento (D-PROD-200), Fornecedor, UnidadeMedida, CentroCusto e Usuario são ANTIGAS nesta release.
 */
const NOME_MO = '20261115900000_atividade_mao_obra_servico';
const NOVAS_MO = ['AtividadeApontamentoMaoObra', 'AtividadeApontamentoServico', 'Funcionario', 'Servico'];
const DO_MO = '16d2680d97d675bf0bd429eaee3ebe4caf5813473c43b9564698aa15c28f8403';
/**
 * D-PROD-208 — a oitava migration CONTRACT aprovada (ajuste da Fatia 4): o funcionário vira PAPEL do parceiro e a linha
 * de mão de obra aponta para o parceiro. CONTRACT condicionado a tabelas VAZIAS: depois da guarda, as 12 instruções
 * pinadas em tabela antiga, na ordem (sai a FK, o índice e a coluna funcionario_id; entram parceiro_id e origem NOT
 * NULL, as 4 colunas anuláveis do papel em Fornecedor, os 2 CHECKs e a FK para Fornecedor); no resto, só o índice
 * não-único da FK nova; e, como ÚLTIMA instrução (`drop_no_fim`, sem conversão), o DROP TABLE "Funcionario".
 */
const NOME_PP = '20261116000000_mao_obra_parceiro';
const SQL_PP = readFileSync(`backend/prisma/migrations/${NOME_PP}/migration.sql`, 'utf8');
const COLUNAS_FORNECEDOR_PP = [['funcionario_tipo', 'VARCHAR(16)'], ['funcionario_cargo', 'VARCHAR(120)'], ['funcionario_custo_hora', 'DECIMAL(14,4)'], ['funcionario_custo_diaria', 'DECIMAL(14,4)']];
const CHECK_FORNECEDOR_PP = 'ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_funcionario_check" CHECK (("funcionario_tipo" IS NULL OR "funcionario_tipo" IN (\'MENSALISTA\', \'DIARISTA\', \'TAREFEIRO\')) AND ("funcionario_custo_hora" IS NULL OR "funcionario_custo_hora" >= 0) AND ("funcionario_custo_diaria" IS NULL OR "funcionario_custo_diaria" >= 0))';
const CHECK_ORIGEM_PP = 'ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_origem_check" CHECK ("origem" IN (\'FUNCIONARIO\', \'TERCEIRO\'))';
const FK_PP = 'ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_parceiro_fkey" FOREIGN KEY ("cliente_id", "parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE';
const ALTER_PP = [
  'ALTER TABLE "AtividadeApontamentoMaoObra" DROP CONSTRAINT "AtividadeApontamentoMaoObra_funcionario_fkey"',
  'DROP INDEX "AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx"',
  'ALTER TABLE "AtividadeApontamentoMaoObra" DROP COLUMN "funcionario_id"',
  'ALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "parceiro_id" VARCHAR(64) NOT NULL',
  'ALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "origem" VARCHAR(12) NOT NULL',
  ...COLUNAS_FORNECEDOR_PP.map(([c, tipo]) => `ALTER TABLE "Fornecedor" ADD COLUMN "${c}" ${tipo}`),
  CHECK_FORNECEDOR_PP,
  CHECK_ORIGEM_PP,
  FK_PP,
];
const INDICE_PP = 'CREATE INDEX "AtividadeApontamentoMaoObra_cliente_id_parceiro_id_idx" ON "AtividadeApontamentoMaoObra"("cliente_id", "parceiro_id");';
const DROP_PP = 'DROP TABLE "Funcionario";';
const CONTRACT_PP = {
  migration: NOME_PP, decisao: 'D-PROD-208', tabelas_removidas: ['Funcionario'], constraints_alargadas: [],
  colunas_removidas: ['AtividadeApontamentoMaoObra.funcionario_id'],
  constraints_removidas: ['AtividadeApontamentoMaoObra.AtividadeApontamentoMaoObra_funcionario_fkey'],
  indices_removidos: ['AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx'],
  tabelas_renomeadas: [], nomes_renomeados: [],
  colunas_adicionadas: ['AtividadeApontamentoMaoObra.parceiro_id', 'AtividadeApontamentoMaoObra.origem', ...COLUNAS_FORNECEDOR_PP.map(([c]) => `Fornecedor.${c}`)],
  constraints_adicionadas: ['Fornecedor.Fornecedor_funcionario_check', 'AtividadeApontamentoMaoObra.AtividadeApontamentoMaoObra_origem_check', 'AtividadeApontamentoMaoObra.AtividadeApontamentoMaoObra_parceiro_fkey'],
  ...VAZIOS_199,
};
/**
 * D-PROD-209 — a nona migration CONTRACT aprovada: o tipo do funcionário passa a ser Mensalista, Diarista ou Terceirizado.
 * No formato de sempre (sem DROP TABLE, sem conversão, sem `drop_no_fim`): depois da guarda (que confere o CHECK ainda
 * com TAREFEIRO e trava Fornecedor antes de conferir que nenhum parceiro tem TAREFEIRO), EXATAMENTE as 2 instruções
 * pinadas — o DROP e o ADD do mesmo CHECK, com TERCEIRIZADO no lugar de TAREFEIRO. Resto vazio.
 */
const NOME_TT = '20261116100000_funcionario_tipo_terceirizado';
const SQL_TT = readFileSync(`backend/prisma/migrations/${NOME_TT}/migration.sql`, 'utf8');
const DROP_CHECK_TT = 'ALTER TABLE "Fornecedor" DROP CONSTRAINT "Fornecedor_funcionario_check"';
const CHECK_TT = CHECK_FORNECEDOR_PP.replace("'TAREFEIRO'", "'TERCEIRIZADO'");
const ALTER_TT = [DROP_CHECK_TT, CHECK_TT];
const CONTRACT_TT = {
  migration: NOME_TT, decisao: 'D-PROD-209', tabelas_removidas: [], constraints_alargadas: ['Fornecedor.Fornecedor_funcionario_check'],
  colunas_removidas: [], constraints_removidas: [], indices_removidos: [], tabelas_renomeadas: [], nomes_renomeados: [],
  colunas_adicionadas: [], constraints_adicionadas: [],
  ...VAZIOS_199,
};
/**
 * D-PROD-210 — a décima migration CONTRACT aprovada: a base do consumo na Formulação (% do peso vivo ou g/cab/dia).
 * Sem DROP TABLE e sem tabela nova: depois da guarda (que exige as 3 tabelas de Formulações VAZIAS), EXATAMENTE as 7
 * instruções pinadas — 2 colunas (base_consumo NOT NULL DEFAULT 'PV' e a g_cab_dia da regra), o %PV padrão anulável,
 * o CHECK do %PV padrão trocado pelo CHECK por base e o CHECK da forma da regra recriado. Não há resto.
 */
const NOME_BC = '20261116200000_formulacao_base_consumo';
const SQL_BC = readFileSync(`backend/prisma/migrations/${NOME_BC}/migration.sql`, 'utf8');
const CONTRACT_BC = {
  migration: NOME_BC, decisao: 'D-PROD-210', tabelas_removidas: [],
  constraints_alargadas: ['CADFORMULACAOREGRA.CADFORMULACAOREGRA_forma_check'], colunas_removidas: [],
  constraints_removidas: ['CADFORMULACAO.CADFORMULACAO_percentual_pv_padrao_check'], indices_removidos: [], tabelas_renomeadas: [], nomes_renomeados: [],
  colunas_adicionadas: ['CADFORMULACAO.base_consumo', 'CADFORMULACAOREGRA.g_cab_dia'],
  constraints_adicionadas: ['CADFORMULACAO.CADFORMULACAO_base_consumo_check'],
  ...VAZIOS_199,
};
/**
 * D-PROD-211 — a décima primeira migration CONTRACT aprovada: o abastecimento ligado à atividade (Fatia 5). No formato
 * de sempre (sem DROP TABLE, sem conversão, sem `drop_no_fim`): depois da guarda (que confere as 5 tabelas, as colunas novas
 * ausentes, local e movimento NOT NULL, o CHECK de status antigo e os CHECKs novos ausentes, e trava AbastecimentoBem),
 * EXATAMENTE as 18 instruções pinadas — 7 ADD COLUMN, 2 DROP NOT NULL, o UPDATE do centro de custo vindo do bem, o CHECK
 * de status recriado, 3 CHECKs novos e 3 FKs. No resto, só os 3 índices não-únicos.
 */
const NOME_AB = '20261116300000_abastecimento_atividade';
const SQL_AB = readFileSync(`backend/prisma/migrations/${NOME_AB}/migration.sql`, 'utf8');
const ALTER_AB = Object.freeze([
  'ALTER TABLE "AbastecimentoBem" ADD COLUMN "origem" VARCHAR(8) NOT NULL DEFAULT \'ESTOQUE\'',
  'ALTER TABLE "AbastecimentoBem" ADD COLUMN "atividade_id" VARCHAR(64)',
  'ALTER TABLE "AbastecimentoBem" ADD COLUMN "apontamento_id" VARCHAR(64)',
  'ALTER TABLE "AbastecimentoBem" ADD COLUMN "centro_custo_id" VARCHAR(64)',
  'ALTER TABLE "AbastecimentoBem" ADD COLUMN "medidor_leitura_anterior" DECIMAL(14,4)',
  'ALTER TABLE "AbastecimentoBem" ADD COLUMN "medidor_delta" DECIMAL(14,4)',
  'ALTER TABLE "AbastecimentoBem" ADD COLUMN "intervalo_confiavel" BOOLEAN NOT NULL DEFAULT false',
  'ALTER TABLE "AbastecimentoBem" ALTER COLUMN "local_estoque_id" DROP NOT NULL',
  'ALTER TABLE "AbastecimentoBem" ALTER COLUMN "movimentacao_estoque_id" DROP NOT NULL',
  'UPDATE "AbastecimentoBem" AS a SET "centro_custo_id" = b."centro_custo_id" FROM "BemPatrimonial" AS b WHERE b."cliente_id" = a."cliente_id" AND b."empresa_id" = a."empresa_id" AND b."id" = a."bem_id" AND b."centro_custo_id" IS NOT NULL',
  'ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_status_check"',
  'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_status_check" CHECK (("status" = \'CONFIRMADO\' AND "movimentacao_estorno_id" IS NULL AND "cancelado_em" IS NULL AND "cancelado_por_usuario_id" IS NULL AND "motivo_cancelamento" IS NULL) OR ("status" = \'CANCELADO\' AND ("origem" = \'EXTERNO\' OR "movimentacao_estorno_id" IS NOT NULL) AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND char_length(btrim("motivo_cancelamento")) >= 3))',
  'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_origem_check" CHECK (("origem" = \'ESTOQUE\' AND "local_estoque_id" IS NOT NULL AND "movimentacao_estoque_id" IS NOT NULL) OR ("origem" = \'EXTERNO\' AND "local_estoque_id" IS NULL AND "movimentacao_estoque_id" IS NULL AND "movimentacao_estorno_id" IS NULL))',
  'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_atividade_check" CHECK ("apontamento_id" IS NULL OR "atividade_id" IS NOT NULL)',
  'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_intervalo_check" CHECK ((("medidor_leitura_anterior" IS NULL AND "medidor_delta" IS NULL) OR ("medidor_leitura_anterior" IS NOT NULL AND "medidor_delta" IS NOT NULL AND "medidor_tipo" IN (\'HORIMETRO\', \'ODOMETRO\', \'CICLOS\') AND "medidor_leitura_anterior" >= 0 AND "medidor_delta" = "medidor_leitura" - "medidor_leitura_anterior")) AND ("intervalo_confiavel" = false OR ("medidor_leitura_anterior" IS NOT NULL AND "medidor_delta" IS NOT NULL AND "medidor_delta" > 0)))',
  'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_atividade_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id") REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_centro_custo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
]);
const INDICES_AB = ['atividade', 'apontamento', 'centro_custo'].map((c) => `CREATE INDEX "AbastecimentoBem_${c}_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "${c}_id")`);
const CONTRACT_AB = {
  migration: NOME_AB, decisao: 'D-PROD-211', tabelas_removidas: [], constraints_alargadas: ['AbastecimentoBem.AbastecimentoBem_status_check'],
  colunas_removidas: [], constraints_removidas: [], indices_removidos: [], tabelas_renomeadas: [], nomes_renomeados: [],
  colunas_adicionadas: ['origem', 'atividade_id', 'apontamento_id', 'centro_custo_id', 'medidor_leitura_anterior', 'medidor_delta', 'intervalo_confiavel'].map((c) => `AbastecimentoBem.${c}`),
  constraints_adicionadas: ['origem_check', 'atividade_check', 'intervalo_check', 'atividade_fkey', 'apontamento_fkey', 'centro_custo_fkey'].map((c) => `AbastecimentoBem.AbastecimentoBem_${c}`),
  ...VAZIOS_199,
};
/** D-PROD-215 — Cadastro de Culturas: EXPAND puro, só a tabela nova CADCULTURAS (nenhuma tabela antiga alterada, nenhum DML). */
const NOME_CU = '20261116500000_cadculturas';
const NOVAS_CU = ['CADCULTURAS'];
const DO_CU = 'cd8830aa244ba849ca957e7d480606bcd38e093e95e028b3e31973611784ea7b';
/**
 * D-PROD-216 — a décima segunda migration CONTRACT aprovada: o reforço da D-PROD-211 (o apontamento do abastecimento é
 * da atividade gravada nele). No formato de sempre (sem DROP TABLE, sem conversão, sem `drop_no_fim`, sem resto): depois
 * da guarda (as 2 tabelas, a FK de 3 colunas, o CHECK da atividade, o UNIQUE novo ausente; trava as 2 e confere que
 * nenhum abastecimento aponta para um apontamento de outra atividade), EXATAMENTE as 3 instruções pinadas — o UNIQUE em
 * AtividadeApontamento, o DROP e o ADD da FK do apontamento com o mesmo nome, agora com a atividade.
 */
const NOME_FA = '20261116600000_abastecimento_fk_apontamento_atividade';
const SQL_FA = readFileSync(`backend/prisma/migrations/${NOME_FA}/migration.sql`, 'utf8');
const ALTER_FA = Object.freeze([
  'CREATE UNIQUE INDEX "AtividadeApontamento_empresa_atividade_id_key" ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id")',
  'ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_apontamento_fkey"',
  'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
]);
const CONTRACT_FA = {
  migration: NOME_FA, decisao: 'D-PROD-216', tabelas_removidas: [], constraints_alargadas: ['AbastecimentoBem.AbastecimentoBem_apontamento_fkey'],
  colunas_removidas: [], constraints_removidas: [], indices_removidos: [], tabelas_renomeadas: [], nomes_renomeados: [],
  colunas_adicionadas: [], constraints_adicionadas: [],
  ...VAZIOS_199,
};
/** Variação do arquivo CONTRACT `nome` sob o MESMO nome, com manifesto sintético: o checksum passa e só a estrutura decide. */
const classificarContractDe = (nome) => (sql, extra = {}) => classificarMigrations([{ nome, sql }], { manifesto: { [nome]: sha256(sql) }, ...extra });
const classificarContract = classificarContractDe(NOME_C);
const classificarContractT = classificarContractDe(NOME_T);
const classificarContractD = classificarContractDe(NOME_D);
const classificarContractK = classificarContractDe(NOME_K);
const classificarContractG = classificarContractDe(NOME_G);
const classificarContractP = classificarContractDe(NOME_P);
const classificarContractV = classificarContractDe(NOME_V);
const classificarContractPP = classificarContractDe(NOME_PP);
const classificarContractTT = classificarContractDe(NOME_TT);
const classificarContractAB = classificarContractDe(NOME_AB);
const classificarContractFA = classificarContractDe(NOME_FA);
const codigos = (c) => [...new Set(c.violacoes.map((v) => v.codigo))].sort();
/** Troca um trecho que tem de aparecer EXATAMENTE uma vez (senão o teste não prova o que diz). */
const trocar = (sql, de, para) => {
  assert.equal(sql.split(de).length, 2, `trecho deveria aparecer 1 vez: ${de.slice(0, 60)}`);
  return sql.replace(de, () => para);
};

test('B1: as migrations do manifesto passam (pinadas + estrutura): só tabelas novas, LancamentoTarefa.posicao_id, Empresa.fuso_horario (D-PROD-122), as épocas de sessão (D-PROD-143) e a troca obrigatória (D-PROD-144) anuláveis; Gestão P1 (D-PROD-146), P2 (D-PROD-153) e P3-01 (D-PROD-155) só com tabelas novas; P3-02 (D-PROD-156) e P3-03 (D-PROD-158) com tabela nova; Patrimônio P1-01 (D-PROD-157) e P1-02 (D-PROD-159) só com tabelas novas; Patrimônio SIMPLIFICA-01 (D-PROD-162) pelo modo CONTRACT fechado; TipoAtividade (D-PROD-182) só com tabela nova; Tipo de Tarefa sem colunas (D-PROD-183) pelo modo CONTRACT fechado; CADESTACOES (D-PROD-188) e CADCURVAGANHO (D-PROD-189) só com tabela nova; CategoriaManejo → CADCATEGORIA (D-PROD-187), CADCURVAGANHO mensal (D-PROD-194) e curva de ganho obrigatória na CADCATEGORIA (D-PROD-195) pelo modo CONTRACT fechado; ApontamentoAtividade (D-PROD-190) só com tabela nova; itens do apontamento (D-PROD-193) só com as 2 tabelas novas; padrões e flags do TipoAtividade (D-PROD-197) pelo modo CONTRACT fechado; peso objetivo na CADCATEGORIA (D-PROD-198) só com a coluna anulável; Atividade cabeçalho (D-PROD-200) pelo modo CONTRACT fechado no formato conversão; linhas de produto e de máquina (D-PROD-202) só com as 3 tabelas novas e as 2 colunas anuláveis; Formulações (D-PROD-203) só com as 3 tabelas novas; Leitura de cocho (D-PROD-205) só com a tabela nova; faixa de tolerância na CADFORMULACAO (D-PROD-206) só com a coluna anulável; mão de obra e serviço (D-PROD-207) só com as 4 tabelas novas; funcionário como papel do parceiro (D-PROD-208) pelo modo CONTRACT fechado com o DROP no fim; tipo do funcionário com TERCEIRIZADO (D-PROD-209) pelo modo CONTRACT fechado; base do consumo na Formulação (D-PROD-210) pelo modo CONTRACT fechado; abastecimento ligado à atividade (D-PROD-211) pelo modo CONTRACT fechado; Cadastro de Culturas (D-PROD-215) só com a tabela nova; reforço da FK do apontamento do abastecimento (D-PROD-216) pelo modo CONTRACT fechado', () => {
  const c = classificarMigrations(NOMES.map(ler));
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false, 'com o CONTRACT no lote, a release não é EXPAND puro');
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, [
    'AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'ApontamentoAtividade', 'ApontamentoAtividadeItem', 'ApontamentoAtividadeItemConsumoLote',
    'Atividade', 'AtividadeApontamento', 'AtividadeApontamentoMaoObra', 'AtividadeApontamentoMaquina', 'AtividadeApontamentoProduto', 'AtividadeApontamentoProdutoConsumoLote',
    'AtividadeApontamentoServico', 'BemPatrimonial', 'CADCULTURAS', 'CADCURVAGANHO', 'CADESTACOES', 'CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA', 'CentroCusto', 'CentroCustoResultado', 'CentroResultado',
    'ConversaoCombustivelProduto', 'EventoRebanho', 'FamiliaPatrimonial', 'Funcionario', 'LEITURACOCHO',
    'LiquidacaoFinanceira', 'LiquidacaoFinanceiraEstorno', 'MedicaoBem', 'NaturezaFinanceira', 'OperacaoFinanceira', 'OperacaoFinanceiraConsumoLote',
    'OperacaoFinanceiraEvento', 'OperacaoFinanceiraItem', 'OperacaoFinanceiraItemRateio', 'OperacaoFinanceiraRateio', 'PartidaRebanho', 'PerfilFinanceiroEmpresa', 'PerfilMedicao',
    'PesoRebanho', 'PosicaoRebanho', 'RebanhoLedgerAtivacao', 'Servico', 'TanqueBem', 'TanqueBemCombustivel', 'TanqueBemProduto', 'TipoAtividade', 'TipoCombustivel',
    'TipoCombustivelProduto', 'TipoPatrimonial', 'TipoPatrimonialPerfil', 'TituloFinanceiro',
  ]);
  // D-PROD-202: as 2 colunas da Fatia 3 não entram aqui — no lote inteiro, BemPatrimonial e TipoPatrimonial são tabelas
  // criadas no próprio lote (D-PROD-162); classificada sozinha (B22a), a Fatia 3 as declara como colunas em tabela antiga.
  assert.deepEqual([...c.colunas_novas_em_tabelas_antigas].sort(), ['CADCATEGORIA.peso_objetivo_kg', 'Cliente.sessao_epoca', 'Empresa.fuso_horario', 'LancamentoTarefa.posicao_id', 'Usuario.sessao_epoca', 'Usuario.troca_senha_pendente']);
  // As sete CONTRACT, na ordem do manifesto: as colunas removidas não viram "coluna nova em tabela antiga", o RENAME
  // da D-PROD-187 não cria tabela nova, a CADCURVAGANHO recriada pela D-PROD-194 não aparece duas vezes em tabelas_novas,
  // as colunas que o texto pinado acrescenta — a NOT NULL da D-PROD-195 e as 13 da D-PROD-197 — ficam no descritor de
  // cada uma (colunas_adicionadas), fora da lista do caminho EXPAND acima, e a conversão da D-PROD-200 fica em `conversoes`.
  // D-PROD-208: a oitava, com o DROP de Funcionario no fim (criada no próprio lote pela D-PROD-207). D-PROD-209: a nona,
  // só com o CHECK de Fornecedor recriado (TERCEIRIZADO no lugar de TAREFEIRO). D-PROD-210: a décima, com a base do
  // consumo nas Formulações. D-PROD-211: a décima primeira, com as colunas, o backfill, os CHECKs e as FKs de
  // AbastecimentoBem. D-PROD-216: a décima segunda, por último, com o UNIQUE e a FK do apontamento recriada.
  assert.deepEqual(c.contract, [CONTRACT_C, CONTRACT_T, CONTRACT_D, CONTRACT_K, CONTRACT_G, CONTRACT_P, CONTRACT_V, CONTRACT_PP, CONTRACT_TT, CONTRACT_BC, CONTRACT_AB, CONTRACT_FA]);
  // Todas as pastas de migration desde o manifesto da PR #174 estão nele; as 27 anteriores ficam fora por construção.
  const pastas = readdirSync('backend/prisma/migrations', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.equal(pastas.length, 64);
  assert.deepEqual(pastas.filter((n) => n >= NOMES[0]).sort(), [...NOMES].sort());
});

test('B1f (D-PROD-162): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, exatamente as 7 tabelas do formato novo, nenhuma coluna em tabela antiga, as 13 removidas na ordem e os 2 CHECKs alargados', () => {
  const c = classificarMigrations([ler(NOME_C)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, NOVAS_C);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_C]);
  // O arquivo é o ensaiado (§0 do contrato), byte a byte.
  assert.equal(sha256(SQL_C), '787d6d118939c6eca4e3c3f45bf94a4f94d1f1625cbfb2ea2102b190ad944222');
  assert.equal(MIGRATIONS_APROVADAS[NOME_C], sha256(SQL_C));
});

test('B8-0 (D-PROD-162/D-PROD-183/D-PROD-187/D-PROD-194/D-PROD-195/D-PROD-197/D-PROD-200/D-PROD-208/D-PROD-209/D-PROD-210/D-PROD-211/D-PROD-216): MIGRATIONS_CONTRACT_APROVADAS é fechado e tem EXATAMENTE as doze entradas, na ordem; só a D-PROD-200 tem `conversao` e só a D-PROD-208 tem `drop_no_fim`; o conteúdo pinado da D-PROD-162 é o ensaiado', () => {
  assert.deepEqual(Object.keys(MIGRATIONS_CONTRACT_APROVADAS), [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_FA]);
  assert.deepEqual(Object.values(MIGRATIONS_CONTRACT_APROVADAS).map((k) => k.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', 'D-PROD-208', 'D-PROD-209', 'D-PROD-210', 'D-PROD-211', 'D-PROD-216']);
  // O formato CONVERSÃO é escolha da entrada: as seis anteriores, a D-PROD-208, a D-PROD-209, a D-PROD-210, a D-PROD-211
  // e a D-PROD-216 não têm o campo.
  assert.deepEqual(Object.entries(MIGRATIONS_CONTRACT_APROVADAS).filter(([, k]) => k.conversao !== undefined).map(([n]) => n), [NOME_V]);
  // D-PROD-208: a cauda sem conversão (só os DROP no fim) também é escolha da entrada.
  assert.deepEqual(Object.entries(MIGRATIONS_CONTRACT_APROVADAS).filter(([, k]) => k.drop_no_fim !== undefined).map(([n]) => n), [NOME_PP]);
  // MIGRATION_CONTRACT_AUTORIZADO tem um só valor: duas entradas com a mesma decisão seriam autorizadas juntas.
  const decisoes = Object.values(MIGRATIONS_CONTRACT_APROVADAS).map((k) => k.decisao);
  assert.equal(new Set(decisoes).size, decisoes.length, 'cada CONTRACT tem decisão própria');
  assert.equal(Object.isFrozen(MIGRATIONS_CONTRACT_APROVADAS), true);
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_C];
  assert.equal(Object.isFrozen(k), true);
  assert.equal(k.decisao, 'D-PROD-162');
  assert.equal(k.guarda_sha256, '28d6c422968d961bbecd40459a7e6a337f36b9d66c121982f9c295065c149046');
  assert.deepEqual(k.drop, DROP_C);
  assert.deepEqual(k.literais_guarda, ['CONFIRMADO']);
  assert.equal(k.alter_antigas.length, 4);
  // Hashes das 4 instruções normalizadas, conferidos à parte no contrato (§0).
  const pontas = [['87133e46', '64be'], ['9c045859', 'dc4f'], ['0cad95f9', 'c9c7'], ['63e8e499', '413c']];
  k.alter_antigas.forEach((a, i) => {
    const h = sha256(a);
    assert.ok(h.startsWith(pontas[i][0]) && h.endsWith(pontas[i][1]), `alter_antigas[${i}] = ${h}`);
    assert.ok(a.startsWith('ALTER TABLE "OperacaoFinanceiraItem" '), a);
  });
  // Quem entra em MIGRATIONS_CONTRACT_APROVADAS também precisa estar no manifesto (checksum pinado).
  for (const n of Object.keys(MIGRATIONS_CONTRACT_APROVADAS)) assert.ok(n in MIGRATIONS_APROVADAS, n);
});

test('B8a–B8d (D-PROD-162): os 13 DROP são EXATAMENTE os do contrato, na ordem — CASCADE, troca de ordem, outra tabela ou IF EXISTS → CONTRACT_DROP_FORA_DO_CONTRATO', () => {
  const casos = {
    B8a: trocar(SQL_C, 'DROP TABLE "TanqueBem";', 'DROP TABLE "TanqueBem" CASCADE;'),
    B8b: trocar(SQL_C, 'DROP TABLE "MedicaoBem";\nDROP TABLE "BemPatrimonial";', 'DROP TABLE "BemPatrimonial";\nDROP TABLE "MedicaoBem";'),
    B8c: trocar(SQL_C, 'DROP TABLE "MedicaoBem";', 'DROP TABLE "Produto";'),
    B8d: trocar(SQL_C, 'DROP TABLE "TipoCombustivel";', 'DROP TABLE IF EXISTS "TipoCombustivel";'),
    restrict: trocar(SQL_C, 'DROP TABLE "TanqueBem";', 'DROP TABLE "TanqueBem" RESTRICT;'),
    duas: trocar(SQL_C, 'DROP TABLE "MedicaoBem";\nDROP TABLE "BemPatrimonial";', 'DROP TABLE "MedicaoBem", "BemPatrimonial";'),
  };
  for (const [caso, sql] of Object.entries(casos)) {
    const c = classificarContract(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_DROP_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, /^posição \d+: esperado /, caso);
  }
  assert.match(classificarContract(casos.B8c).violacoes[0].detalhe, /posição 6: esperado DROP TABLE "MedicaoBem"/);
});

test('B8e (D-PROD-162): um DROP a mais, depois do recorte, cai no caminho EXPAND do resto → SQL_NAO_RECONHECIDO', () => {
  const c = classificarContract(`${SQL_C}\nDROP TABLE "TanqueBemProduto";\n`);
  assert.deepEqual(codigos(c), ['SQL_NAO_RECONHECIDO']);
});

test('B8f–B8h (D-PROD-162): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE', () => {
  const alterada = classificarContract(trocar(SQL_C, 'IF n_confirmados > 0 THEN', 'IF n_confirmados > 1 THEN'));
  assert.deepEqual(codigos(alterada), ['CONTRACT_GUARDA_NAO_RECONHECIDA']);
  const inicio = SQL_C.indexOf('-- 1. Guarda');
  const fim = SQL_C.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_C.slice(0, inicio) + SQL_C.slice(fim);
  assert.ok(!semGuarda.includes('n_confirmados'));
  assert.deepEqual(codigos(classificarContract(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  const antes = classificarContract(`CREATE INDEX "x_idx" ON "Produto"("id");\n${SQL_C}`);
  assert.deepEqual(codigos(antes), ['CONTRACT_GUARDA_AUSENTE']);
});

test('B8i (D-PROD-162): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado', () => {
  const c = classificarMigrations([{ nome: '20261110300001_outro_nome', sql: SQL_C }], { manifesto: { '20261110300001_outro_nome': sha256(SQL_C) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  for (const codigo of ['DO_NAO_RECONHECIDO', 'DO_EM_TABELA_ANTIGA', 'SQL_NAO_RECONHECIDO', 'ALTER_EM_TABELA_ANTIGA']) {
    assert.ok(codigos(c).includes(codigo), `${codigo} ∉ ${codigos(c)}`);
  }
  // E um contrato vazio (opção) faz o nome real seguir o EXPAND também: nada é aprovado por fora da lista fechada.
  assert.equal(classificarMigrations([ler(NOME_C)], { contratos: {} }).ok, false);
});

test('B8j (D-PROD-162): o resto continua sendo EXPAND — DELETE, TRUNCATE e coluna NOT NULL em tabela antiga recusados como sempre', () => {
  const casos = {
    'DELETE FROM "Produto";': 'SQL_NAO_RECONHECIDO',
    'TRUNCATE "Lote";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "Produto" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0;': 'ALTER_EM_TABELA_ANTIGA',
    'UPDATE "Produto" SET "estoque_atual" = 0;': 'SQL_NAO_RECONHECIDO',
    'CREATE UNIQUE INDEX "Produto_cliente_id_empresa_id_id_key" ON "Produto"("cliente_id", "empresa_id", "id");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) assert.deepEqual(codigos(classificarContract(`${SQL_C}\n${ddl}\n`)), [codigo], ddl);
});

test('B8k (D-PROD-162): 1 byte a mais no arquivo pinado → MIGRATION_CHECKSUM_DIVERGENTE', () => {
  assert.deepEqual(codigos(classificarMigrations([{ nome: NOME_C, sql: `${SQL_C}\n` }])), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B8l (D-PROD-162): guarda pinada que cita tabela antiga (contrato sintético) → DO_EM_TABELA_ANTIGA', () => {
  const corpo = " BEGIN PERFORM count(*) FROM public.\"Produto\"; RAISE NOTICE 'Produto'; END ";
  const sql = `DO $$${corpo}$$;\nDROP TABLE "Velha";\nCREATE TABLE "Nova" ("id" TEXT NOT NULL);\n`;
  const contratos = { x: { decisao: 'D-PROD-999', guarda_sha256: sha256(corpo.replace(/\s+/g, ' ').trim()), drop: ['Velha'], literais_guarda: [], alter_antigas: [] } };
  const c = classificarMigrations([{ nome: 'x', sql }], { manifesto: { x: sha256(sql) }, contratos });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Produto'));
  // Controle positivo: a mesma guarda citando só a tabela removida e a nova passa.
  const corpoOk = " BEGIN PERFORM count(*) FROM public.\"Velha\"; RAISE NOTICE 'Nova'; END ";
  const sqlOk = `DO $$${corpoOk}$$;\nDROP TABLE "Velha";\nCREATE TABLE "Nova" ("id" TEXT NOT NULL);\n`;
  const ok = classificarMigrations([{ nome: 'x', sql: sqlOk }], { manifesto: { x: sha256(sqlOk) }, contratos: { x: { ...contratos.x, guarda_sha256: sha256(corpoOk.replace(/\s+/g, ' ').trim()) } } });
  assert.deepEqual(ok.violacoes, []);
  assert.deepEqual(ok.contract, [{ migration: 'x', decisao: 'D-PROD-999', tabelas_removidas: ['Velha'], constraints_alargadas: [], colunas_removidas: [], ...VAZIOS_187, ...VAZIOS_196, ...VAZIOS_199 }]);
});

test('B8m (D-PROD-162): DO de RLS que cita tabela antiga → DO_NAO_RECONHECIDO + DO_EM_TABELA_ANTIGA', () => {
  const sql = trocar(SQL_C, "ARRAY['AbastecimentoBem','AbastecimentoBemConsumoLote'", "ARRAY['Produto','AbastecimentoBem','AbastecimentoBemConsumoLote'");
  assert.deepEqual(codigos(classificarContract(sql)), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
});

test('B8n–B8r (D-PROD-162): os 4 alargamentos de OperacaoFinanceiraItem são EXATAMENTE os pinados, na ordem, logo depois dos DROP', () => {
  const ALTER1 = 'ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_unidade_check";';
  const casos = {
    B8n: trocar(SQL_C, ALTER1, 'ALTER TABLE "OperacaoFinanceira" DROP CONSTRAINT "OperacaoFinanceiraItem_unidade_check";'),
    B8o: trocar(SQL_C, "'SACO', 'UN', 'L')", "'SACO', 'UN', 'L', 'M3')"),
    B8p: trocar(SQL_C, '"fator_kg" IS NOT NULL AND "fator_kg" > 0 AND', '"fator_kg" IS NOT NULL AND "fator_kg" >= 0 AND'),
  };
  const ini = SQL_C.indexOf(ALTER1);
  const fimAlarga = SQL_C.indexOf('-- 4. Expansão');
  casos.B8q = SQL_C.slice(0, ini) + SQL_C.slice(fimAlarga);
  casos.troca = SQL_C.slice(0, ini) + SQL_C.slice(ini, fimAlarga).split('\n').filter(Boolean).reverse().join('\n') + '\n\n' + SQL_C.slice(fimAlarga);
  for (const [caso, sql] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_C, caso);
    const c = classificarContract(sql);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, /^posição \d: esperado /, caso);
  }
  assert.match(classificarContract(casos.B8q).violacoes[0].detalhe, /^posição 0: /);
  assert.match(classificarContract(casos.B8p).violacoes[0].detalhe, /^posição 3: /);
  // B8r: uma 5ª instrução na tabela antiga, depois das 4, cai no caminho EXPAND do resto.
  const quinta = trocar(SQL_C, '-- 4. Expansão', 'ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "x_check" CHECK ("quantidade" > 0);\n\n-- 4. Expansão');
  assert.deepEqual(codigos(classificarContract(quinta)), ['ALTER_EM_TABELA_ANTIGA']);
});

test('B10 (D-PROD-162): conferirReleaseContract — CONTRACT isolado e autorizado pela decisão exata; --contract sem CONTRACT é inesperado', () => {
  const comC = classificarMigrations([ler(NOME_C)]);
  const semC = classificarMigrations([ler('20261110200000_patrimonio_p1_02_abastecimentos')]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_C], classificacao: comC, autorizacao: 'D-PROD-162' }), { ok: true, codigo: null });
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_C, '20261110300001_outra'], classificacao: comC, autorizacao: 'D-PROD-162' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  for (const autorizacao of [undefined, '', 'D-PROD-999', 'd-prod-162', ' D-PROD-162']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_C], classificacao: comC, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  assert.deepEqual(conferirReleaseContract({ nomesNovas: ['20261110200000_patrimonio_p1_02_abastecimentos'], classificacao: semC, autorizacao: 'D-PROD-162' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [], classificacao: semC, autorizacao: undefined }), { ok: true, codigo: null });
});

test('B11a (D-PROD-162): contractsPendentes — CONTRACT local sem linha concluída e não revertida no alvo é pendente; concluído não é', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = ['20261110200000_patrimonio_p1_02_abastecimentos', NOME_C];
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }), [{ nome: NOME_C, decisao: 'D-PROD-162' }]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C, { finished_at: null })] }), [{ nome: NOME_C, decisao: 'D-PROD-162' }], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C, { rolled_back_at: new Date() })] }), [{ nome: NOME_C, decisao: 'D-PROD-162' }], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C, { rolled_back_at: new Date() }), linha(NOME_C)] }), []);
  assert.deepEqual(contractsPendentes({ locais: ['20261110200000_patrimonio_p1_02_abastecimentos'], linhas: [] }), [], 'sem a pasta local não há o que aplicar');
});

test('B11b (D-PROD-162): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO só vai ao subprocesso com CONTRACT e --contract conferido; nunca herdado', () => {
  const comC = classificarMigrations([ler(NOME_C)]);
  const semC = classificarMigrations([ler('20261110200000_patrimonio_p1_02_abastecimentos')]);
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: base, classificacao: comC, autorizacao: 'D-PROD-162' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-162');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(a.PATH, '/bin');
  for (const [classificacao, autorizacao] of [[semC, undefined], [semC, 'D-PROD-162'], [comC, undefined], [comC, 'D-PROD-999']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, String(autorizacao));
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
  assert.equal(base.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
});

test('B12a (D-PROD-183): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, nenhuma tabela nova, nenhuma coluna em tabela antiga, nenhuma tabela removida e as 4 colunas de TipoTarefa removidas na ordem', () => {
  const c = classificarMigrations([ler(NOME_T)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_T]);
  // O arquivo é o ensaiado (validado à mão no PG 16), byte a byte.
  assert.equal(sha256(SQL_T), '47409bb1a7d371efe89fffba753ae292aec6f95e1ba7845d35dff74371136c17');
  assert.equal(MIGRATIONS_APROVADAS[NOME_T], sha256(SQL_T));
});

test('B12b (D-PROD-183): a entrada de MIGRATIONS_CONTRACT_APROVADAS é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP TABLE, literal TipoTarefa e os 4 DROP COLUMN exatos', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_T];
  assert.ok(NOME_T in MIGRATIONS_APROVADAS, 'quem é CONTRACT também está no manifesto (checksum pinado)');
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-183');
  assert.equal(k.guarda_sha256, '35e1a698b0567bf07f9e99943f7181a3a6ee8b1e03ea2ff423a939e755984878');
  assert.deepEqual(k.drop, []);
  assert.deepEqual(k.literais_guarda, ['TipoTarefa']);
  assert.deepEqual(k.alter_antigas, [
    'ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area"',
    'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_produto"',
    'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_maquina"',
    'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_implemento"',
  ]);
  // O hash pinado é o do corpo da guarda do arquivo (sem comentários, espaços normalizados) e cada texto pinado está nele uma vez.
  const corpo = SQL_T.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1];
  assert.equal(sha256(corpo.replace(/\s+/g, ' ').trim()), k.guarda_sha256);
  for (const a of k.alter_antigas) assert.equal(SQL_T.split(`${a};`).length, 2, a);
});

test('B12c (D-PROD-183): os 4 DROP COLUMN são EXATAMENTE os do contrato, na ordem — CASCADE, RESTRICT, IF EXISTS, troca de ordem, outra coluna, outra tabela, um faltando ou os 4 numa instrução só → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const [A1, A2, A3, A4] = ALTER_T.map((a) => `${a};`);
  const casos = {
    cascade: trocar(SQL_T, A1, A1.replace(';', ' CASCADE;')),
    restrict: trocar(SQL_T, A4, A4.replace(';', ' RESTRICT;')),
    ifExists: trocar(SQL_T, A3, 'ALTER TABLE "TipoTarefa" DROP COLUMN IF EXISTS "pode_ter_maquina";'),
    ordem: trocar(SQL_T, `${A2}\n${A3}`, `${A3}\n${A2}`),
    outraColuna: trocar(SQL_T, A2, 'ALTER TABLE "TipoTarefa" DROP COLUMN "ativo";'),
    outraTabela: trocar(SQL_T, A1, 'ALTER TABLE "TipoAtividade" DROP COLUMN "exige_area";'),
    faltando: trocar(SQL_T, `${A4}\n`, ''),
    numaSo: trocar(SQL_T, `${A1}\n${A2}\n${A3}\n${A4}`, `ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area", DROP COLUMN "pode_ter_produto", DROP COLUMN "pode_ter_maquina", DROP COLUMN "pode_ter_implemento";`),
  };
  for (const [caso, sql] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_T, caso);
    const c = classificarContractT(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, /^posição \d: esperado ALTER TABLE "TipoTarefa" DROP/, caso);
  }
  assert.match(classificarContractT(casos.cascade).violacoes[0].detalhe, /^posição 0: /);
  assert.match(classificarContractT(casos.outraColuna).violacoes[0].detalhe, /^posição 1: /);
  assert.match(classificarContractT(casos.ordem).violacoes[0].detalhe, /^posição 1: /);
  assert.match(classificarContractT(casos.faltando).violacoes[0].detalhe, /^posição 3: /);
});

test('B12d (D-PROD-183): o que vem depois dos 4 DROP COLUMN cai no caminho EXPAND do resto — 5º DROP COLUMN, coluna NOT NULL, UNIQUE, DELETE e DROP TABLE recusados; tabela nova aceita como sempre', () => {
  const casos = {
    'ALTER TABLE "TipoTarefa" DROP COLUMN "descricao";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoTarefa" ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT false;': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "TipoTarefa_cliente_id_nome_tipo_key" ON "TipoTarefa"("cliente_id", "nome_tipo");': 'UNIQUE_EM_TABELA_ANTIGA',
    'DELETE FROM "TipoTarefa";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "TipoTarefa";': 'SQL_NAO_RECONHECIDO',
    'UPDATE "TipoTarefa" SET "ativo" = false;': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) assert.deepEqual(codigos(classificarContractT(`${SQL_T}\n${ddl}\n`)), [codigo], ddl);
  // Controle positivo: CREATE TABLE e índice não-único depois do recorte são o EXPAND de sempre (o checksum pinado é que prende o arquivo real).
  const comNova = classificarContractT(`${SQL_T}\n${BASE}CREATE INDEX "Nova_cliente_id_idx" ON "Nova"("cliente_id");\n`);
  assert.deepEqual(comNova.violacoes, []);
  assert.deepEqual(comNova.tabelas_novas, ['Nova']);
  assert.deepEqual(comNova.contract, [CONTRACT_T]);
});

test('B12e (D-PROD-183): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE', () => {
  const alterada = classificarContractT(trocar(SQL_T, 'IF n_colunas <> 4 THEN', 'IF n_colunas <> 3 THEN'));
  assert.deepEqual(codigos(alterada), ['CONTRACT_GUARDA_NAO_RECONHECIDA']);
  // Sem exigir a impressão quando há true, a guarda perde a razão de ser: também não é reconhecida.
  const semImpressao = classificarContractT(trocar(SQL_T, 'IF (total > 0 OR esperada IS NOT NULL) AND', 'IF esperada IS NOT NULL AND'));
  assert.deepEqual(codigos(semImpressao), ['CONTRACT_GUARDA_NAO_RECONHECIDA']);
  const inicio = SQL_T.indexOf('-- 1. Guarda');
  const fim = SQL_T.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_T.slice(0, inicio) + SQL_T.slice(fim);
  assert.ok(!semGuarda.includes('n_colunas'));
  assert.deepEqual(codigos(classificarContractT(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  const antes = classificarContractT(`CREATE INDEX "x_idx" ON "TipoTarefa"("id");\n${SQL_T}`);
  assert.deepEqual(codigos(antes), ['CONTRACT_GUARDA_AUSENTE']);
});

test('B12f (D-PROD-183): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada (ou com o contrato da D-PROD-162) o nome real é recusado', () => {
  const outro = '20261113200001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_T }], { manifesto: { [outro]: sha256(SQL_T) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(codigos(c), ['ALTER_EM_TABELA_ANTIGA', 'DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  assert.equal(c.violacoes.filter((x) => x.codigo === 'ALTER_EM_TABELA_ANTIGA').length, 4, 'cada DROP COLUMN é recusado');
  // Contrato vazio, ou só a entrada da D-PROD-162: nada é aprovado por fora da lista fechada.
  assert.equal(classificarMigrations([ler(NOME_T)], { contratos: {} }).ok, false);
  assert.equal(classificarMigrations([ler(NOME_T)], { contratos: { [NOME_C]: MIGRATIONS_CONTRACT_APROVADAS[NOME_C] } }).ok, false);
  // O contrato de um nome não serve ao SQL do outro: guarda e DROP TABLE da D-PROD-162 não batem com o arquivo da D-PROD-183.
  assert.deepEqual(codigos(classificarContract(SQL_T)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
});

test('B12g (D-PROD-183): conferirReleaseContract — a D-PROD-183 sozinha só com --contract D-PROD-183 exato; junto com outra migration ou com a D-PROD-162 é CONTRACT_NAO_ISOLADO; --contract D-PROD-183 sem CONTRACT é inesperado', () => {
  const comT = classificarMigrations([ler(NOME_T)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_T], classificacao: comT, autorizacao: 'D-PROD-183' }), { ok: true, codigo: null });
  // Como no B10: sem --contract (undefined) também é não autorizado, porque a release tem CONTRACT.
  for (const autorizacao of ['D-PROD-162', '', undefined, null, 'd-prod-183', ' D-PROD-183', 'D-PROD-183 ']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_T], classificacao: comT, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  const ATIV = '20261113100000_tipo_atividade_cadastro';
  const comOutra = classificarMigrations([ler(ATIV), ler(NOME_T)]);
  assert.deepEqual(comOutra.violacoes, []);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [ATIV, NOME_T], classificacao: comOutra, autorizacao: 'D-PROD-183' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  // As DUAS CONTRACT na mesma release: nenhuma autorização isola (a variável do runner oficial tem um só valor).
  const duas = classificarMigrations([ler(NOME_C), ler(NOME_T)]);
  assert.deepEqual(duas.violacoes, []);
  assert.equal(duas.contract.length, 2);
  for (const autorizacao of ['D-PROD-162', 'D-PROD-183', undefined]) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_C, NOME_T], classificacao: duas, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, String(autorizacao));
  }
  const semC = classificarMigrations([ler(ATIV)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [ATIV], classificacao: semC, autorizacao: 'D-PROD-183' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B12h (D-PROD-183): contractsPendentes com as duas CONTRACT locais — a D-PROD-162 concluída deixa só a D-PROD-183 pendente; histórico vazio, as duas; ambas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = ['20261110200000_patrimonio_p1_02_abastecimentos', NOME_C, '20261113100000_tipo_atividade_cadastro', NOME_T];
  const PEND_C = { nome: NOME_C, decisao: 'D-PROD-162' };
  const PEND_T = { nome: NOME_T, decisao: 'D-PROD-183' };
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C)] }), [PEND_T], 'produção hoje: D-PROD-162 concluída');
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }), [PEND_C, PEND_T]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C), linha(NOME_T)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C), linha(NOME_T, { finished_at: null })] }), [PEND_T], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C), linha(NOME_T, { rolled_back_at: new Date() })] }), [PEND_T], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_T), linhas: [linha(NOME_C)] }), [], 'sem a pasta local não há o que aplicar');
});

test('B12i (D-PROD-183): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-183 só com a D-PROD-183 sozinha e --contract D-PROD-183; a decisão da D-PROD-162 ou as duas CONTRACT juntas não autorizam', () => {
  const comT = classificarMigrations([ler(NOME_T)]);
  const duas = classificarMigrations([ler(NOME_C), ler(NOME_T)]);
  // Positivo com base 'herdado': prova que a função GRAVA a decisão (não só deixa passar o valor herdado).
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comT, autorizacao: 'D-PROD-183' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-183');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
  // Negativos com base JÁ igual à decisão: prova que ela nunca é herdada.
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-183' };
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  for (const [classificacao, autorizacao] of [[comT, 'D-PROD-162'], [comT, undefined], [comT, 'd-prod-183'], [duas, 'D-PROD-162'], [duas, 'D-PROD-183']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B1b: P3-02 (D-PROD-156) classificada SOZINHA, como na release (a P3-01 já está na main): só OperacaoFinanceira.rateio_escopo anulável numa tabela antiga e a tabela nova do rateio por item', () => {
  const c = classificarMigrations([ler('20261109200000_gestao_p3_02_rateio_por_item')]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, ['OperacaoFinanceiraItemRateio']);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, ['OperacaoFinanceira.rateio_escopo']);
  // Sem a tabela da P3-01 como "nova", um CHECK na coluna nova da tabela antiga é recusado.
  const comCheck = `${ler('20261109200000_gestao_p3_02_rateio_por_item').sql}\nALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "x" CHECK ("rateio_escopo" IN ('GERAL', 'POR_ITEM'));`;
  assert.ok(classificar(comCheck).violacoes.some((v) => v.codigo === 'ALTER_EM_TABELA_ANTIGA'));
});

test('B1d: P3-03 (D-PROD-158) classificada SOZINHA, como na release (P3-01 e P3-02 já estão na main; aplicada em produção antes do Patrimônio): só OperacaoFinanceira.excluido_em/retificado_em anuláveis numa tabela antiga e a tabela nova de eventos', () => {
  const c = classificarMigrations([ler('20261109300000_gestao_p3_03_editar_excluir')]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, ['OperacaoFinanceiraEvento']);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, ['OperacaoFinanceira.excluido_em', 'OperacaoFinanceira.retificado_em']);
  // Sem a tabela da P3-01 como "nova": NOT NULL, DEFAULT ou CHECK nas colunas novas da tabela antiga são recusados.
  const base = ler('20261109300000_gestao_p3_03_editar_excluir').sql;
  const casos = [
    `${base}\nALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "x" CHECK ("excluido_em" IS NULL OR "status" = 'CANCELADO');`,
    base.replace('ADD COLUMN "excluido_em" TIMESTAMP(3);', 'ADD COLUMN "excluido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;'),
    `${base}\nUPDATE "OperacaoFinanceira" SET "retificado_em" = now();`,
  ];
  for (const sql of casos) assert.ok(classificar(sql).violacoes.length > 0, sql.slice(-120));
});

test('B1c: Patrimônio P1-01 (D-PROD-157) classificado SOZINHO, como na release (a P3-02 já está na main): expand, exatamente as 10 tabelas novas (com o vínculo combustível × produto da R2), nenhuma coluna nem constraint em tabela antiga (Produto intacto)', () => {
  const m = ler('20261110100000_patrimonio_p1_01_cadastros');
  const c = classificarMigrations([m]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, [
    'BemPatrimonial', 'FamiliaPatrimonial', 'MedicaoBem', 'PerfilMedicao', 'TanqueBem', 'TanqueBemCombustivel', 'TipoCombustivel',
    'TipoCombustivelProduto', 'TipoPatrimonial', 'TipoPatrimonialPerfil',
  ]);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  // A coerência Produto.empresa_id = vínculo.empresa_id NÃO vira unique em Produto (tabela antiga): seria recusado.
  const comUnique = `${m.sql}\nCREATE UNIQUE INDEX "Produto_cliente_id_empresa_id_id_key" ON "Produto"("cliente_id", "empresa_id", "id");`;
  assert.ok(classificar(comUnique).violacoes.some((v) => v.codigo === 'UNIQUE_EM_TABELA_ANTIGA'));
});

test('B1e: Patrimônio P1-02 (D-PROD-159) classificado SOZINHO, como na release (a P1-01 já está na main): expand, exatamente as 3 tabelas novas de abastecimento, nenhuma coluna nem constraint em tabela antiga (BemPatrimonial e MovimentacaoEstoque intactos)', () => {
  const m = ler('20261110200000_patrimonio_p1_02_abastecimentos');
  const c = classificarMigrations([m]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, ['AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'ConversaoCombustivelProduto']);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  // A leitura do medidor vive na tabela nova: aceitar 'ABASTECIMENTO' no CHECK do bem, um unique de empresa no bem
  // ou uma coluna DATE no movimento seriam DDL em tabela antiga e são recusados.
  const casos = {
    [`ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_medidor_origem_abastecimento_check" CHECK ("medidor_origem" IS NULL OR "medidor_origem" IN ('CADASTRO_INICIAL', 'AJUSTE_CADASTRO', 'ABASTECIMENTO'));`]: 'ALTER_EM_TABELA_ANTIGA',
    [`ALTER TABLE "BemPatrimonial" DROP CONSTRAINT "BemPatrimonial_medidor_origem_check";`]: 'ALTER_EM_TABELA_ANTIGA',
    [`CREATE UNIQUE INDEX "BemPatrimonial_cliente_id_empresa_id_id_key" ON "BemPatrimonial"("cliente_id", "empresa_id", "id");`]: 'UNIQUE_EM_TABELA_ANTIGA',
    [`ALTER TABLE "MovimentacaoEstoque" ADD COLUMN "abastecimento_data" DATE;`]: 'ALTER_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const r = classificar(`${m.sql}\n${ddl}\n`);
    assert.equal(r.expand, false, ddl);
    assert.deepEqual(r.violacoes.map((v) => v.codigo), [codigo], ddl);
  }
  // O bloco DO pinado não pode citar tabela antiga: incluir 'TanqueBem' na lista muda o hash e cita tabela antiga.
  const doComAntiga = m.sql.replace("ARRAY['AbastecimentoBem',", "ARRAY['TanqueBem','AbastecimentoBem',");
  assert.notEqual(doComAntiga, m.sql);
  assert.deepEqual(classificar(doComAntiga).violacoes.map((v) => v.codigo).sort(), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // 1 byte a mais no arquivo pinado → checksum divergente.
  assert.deepEqual(classificarMigrations([{ ...m, sql: `${m.sql}\n` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B2: padrão = RECUSAR — cada caso negativo é violação com código estável', () => {
  const casos = {
    'CREATE OR REPLACE FUNCTION f() RETURNS int AS $f$ SELECT 1 $f$ LANGUAGE sql;': 'SQL_NAO_RECONHECIDO',
    'CREATE OR REPLACE VIEW "v" AS SELECT 1;': 'SQL_NAO_RECONHECIDO',
    'GRANT ALL ON TABLE "Lote" TO anon;': 'SQL_NAO_RECONHECIDO',
    'REVOKE ALL ON TABLE "Usuario" FROM maike_vercel;': 'SQL_NAO_RECONHECIDO',
    'CREATE TRIGGER t AFTER INSERT ON "Lote" FOR EACH ROW EXECUTE FUNCTION f();': 'SQL_NAO_RECONHECIDO',
    'COPY "Lote" FROM \'/tmp/x\';': 'SQL_NAO_RECONHECIDO',
    'INSERT INTO "Lote" ("id") VALUES (\'x\');': 'SQL_NAO_RECONHECIDO',
    'SELECT pg_terminate_backend(1);': 'SQL_NAO_RECONHECIDO',
    "DO $$ BEGIN EXECUTE 'DELETE FROM \"Lote\"'; END $$;": 'DO_NAO_RECONHECIDO',
    'ALTER TABLE "Lote" DROP COLUMN "x";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ALTER COLUMN "a" SET NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" RENAME COLUMN "a" TO "b";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ADD COLUMN "z" INTEGER NOT NULL DEFAULT 0;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ADD CONSTRAINT "c" CHECK ("x" > 0);': 'ALTER_EM_TABELA_ANTIGA',
    'TRUNCATE "Lote";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "Lote";': 'SQL_NAO_RECONHECIDO',
    'UPDATE "Lote" SET x = 1;': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "Lote";': 'SQL_NAO_RECONHECIDO',
    'CREATE UNIQUE INDEX "u" ON "Lote"("x");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [sql, codigo] of Object.entries(casos)) {
    const c = classificar(BASE + sql);
    assert.equal(c.expand, false, sql);
    assert.ok(c.violacoes.some((v) => v.codigo === codigo), `${sql} → ${JSON.stringify(c.violacoes)}`);
  }
});

test('B3: manifesto — migration fora da lista ou com 1 byte diferente é recusada; DO de RLS só com hash auditado e tabela nova', () => {
  const [a] = NOMES.map(ler);
  assert.equal(classificarMigrations([{ ...a, sql: `${a.sql}\n` }]).violacoes[0].codigo, 'MIGRATION_CHECKSUM_DIVERGENTE');
  assert.equal(classificarMigrations([{ nome: '29990101000000_x', sql: BASE }]).violacoes[0].codigo, 'MIGRATION_NAO_APROVADA');
  const doNovo = `${BASE}DO $$ BEGIN EXECUTE 'ALTER TABLE public."Nova" ENABLE ROW LEVEL SECURITY'; END $$;`;
  assert.ok(classificar(doNovo).violacoes.some((v) => v.codigo === 'DO_NAO_RECONHECIDO'), 'DO não auditado é recusado mesmo sobre tabela nova');
});

test('B4: compatível com o backend antigo passa (tabela nova, coluna anulável + FK para tabela nova, índice não-único)', () => {
  const sql = `${BASE}ALTER TABLE "Nova" ADD CONSTRAINT "n_ok" CHECK ("id" <> '');
ALTER TABLE "Lote" ADD COLUMN "nova_id" VARCHAR(64);
ALTER TABLE "Lote" ADD CONSTRAINT "f" FOREIGN KEY ("cliente_id", "nova_id") REFERENCES "Nova"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "i" ON "Lote"("cliente_id", "nova_id");
-- DROP TABLE "Lote"; (comentário não conta)`;
  assert.deepEqual(classificar(sql).violacoes, []);
});

test('B5: histórico do alvo — extra, checksum divergente, parcial ou pendência fora do manifesto → PREMERGE_MIGRATIONS_NAO_COMPROVADAS', () => {
  const locais = [{ nome: '20250101000000_base', checksum: 'b' }, ...NOMES.map((n) => ({ nome: n, checksum: MIGRATIONS_APROVADAS[n] }))];
  const ok = (n, c = 'b') => ({ migration_name: n, checksum: c, finished_at: new Date(), rolled_back_at: null });
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: [ok('20250101000000_base')] }), { ok: true, codigo: null, pendentes: NOMES, falhas: [] });
  const casos = [
    [ok('20250101000000_base'), ok('29990101000000_extra')],
    [ok('20250101000000_base', 'outro')],
    [ok('20250101000000_base'), { migration_name: NOMES[0], checksum: MIGRATIONS_APROVADAS[NOMES[0]], finished_at: null, rolled_back_at: null }],
    [],
  ];
  for (const linhas of casos) assert.equal(conferirHistoricoRemoto({ locais, linhas }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', JSON.stringify(linhas));
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok('20250101000000_base'), ok(NOMES[0], MIGRATIONS_APROVADAS[NOMES[0]])] }).ok, true, 'aplicação parcial do manifesto ainda é retomável');
});

test('B5b: checksum histórico "manual" só é aceito para as 4 migrations documentadas; em qualquer outra é divergência', () => {
  const hist = '20260908174141_p3_foundation';
  const locais = [{ nome: hist, checksum: 'x' }, { nome: '20250101000000_base', checksum: 'b' }, ...NOMES.map((n) => ({ nome: n, checksum: MIGRATIONS_APROVADAS[n] }))];
  const ok = (n, c) => ({ migration_name: n, checksum: c, finished_at: new Date(), rolled_back_at: null });
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'manual'), ok('20250101000000_base', 'b')] }).ok, true);
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'manual'), ok('20250101000000_base', 'manual')] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'outro'), ok('20250101000000_base', 'b')] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
});

test('B6: runner — --base proibido, SHA inválido/errado → exit 3; nunca imprime URL', () => {
  const env = { ...process.env, MIGRATION_DATABASE_URL: 'postgresql://u:SEGREDO@h:5432/d', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '1' };
  const run = (...a) => spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', ...a], { encoding: 'utf8', env });
  const r1 = run('--sha', 'a'.repeat(40), '--base', 'HEAD~1');
  assert.equal(r1.status, 3);
  assert.match(r1.stderr, /BASE_FIXA/);
  assert.equal(run('--sha', 'abc', '--aplicar').status, 3);
  const r3 = run('--sha', '0'.repeat(40), '--aplicar');
  assert.equal(r3.status, 3);
  assert.match(r3.stderr, /HEAD_DIVERGENTE/);
  for (const r of [r1, r3]) assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\//);
});

test('B7: runner no HEAD atual — sem credenciais só há análise local declarada "alvo remoto NÃO verificado"', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sujo = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  const env = { ...process.env, MIGRATION_DATABASE_URL: '', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '' };
  const r = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', head], { encoding: 'utf8', env });
  if (sujo) return assert.match(r.stderr, /ARVORE_SUJA/);
  if (/MAIN_INDISPONIVEL|MAIN_DEFASADA/.test(r.stderr)) return assert.equal(r.status, 3); // CI sem remoto/defasado: fecha
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /alvo remoto NÃO verificado/);
  const a = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', head, '--aplicar'], { encoding: 'utf8', env });
  assert.equal(a.status, 3);
  assert.match(a.stderr, /ALVO_SEM_CONFIGURACAO/);
});

/**
 * Repositório git descartável que reproduz a release de UMA migration CONTRACT (`nome`): `origin` (bare) com a
 * main = todas as migrations da pasta menos `nome`, e HEAD = main + `nome`. Árvore limpa e `origin/main` = remota,
 * então o runner real chega às barreiras do CONTRACT independentemente do estado desta árvore. As OUTRAS CONTRACT
 * (D-PROD-162, D-PROD-183, D-PROD-187, D-PROD-194, D-PROD-195 ou D-PROD-197) ficam na main: a release continua ISOLADA (uma só migration nova) e nada do manifesto falta.
 */
const repoDaReleaseContract = (nome) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-premerge-contract-'));
  const origem = join(dir, 'origin.git');
  const trabalho = join(dir, 'trabalho');
  const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=teste', '-c', 'user.email=teste@exemplo.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origem]);
  mkdirSync(trabalho);
  g(trabalho, 'init', '-q', '-b', 'main');
  const raiz = 'backend/prisma/migrations';
  for (const d of readdirSync(raiz)) if (d !== nome) cpSync(join(raiz, d), join(trabalho, raiz, d), { recursive: true });
  g(trabalho, 'add', '-A');
  g(trabalho, 'commit', '-q', '-m', 'main');
  g(trabalho, 'remote', 'add', 'origin', origem);
  g(trabalho, 'push', '-q', 'origin', 'main');
  g(trabalho, 'fetch', '-q', 'origin');
  g(trabalho, 'checkout', '-q', '-b', 'release');
  cpSync(join(raiz, nome), join(trabalho, raiz, nome), { recursive: true });
  g(trabalho, 'add', '-A');
  g(trabalho, 'commit', '-q', '-m', 'release');
  return { dir, trabalho, sha: g(trabalho, 'rev-parse', 'HEAD') };
};

const SCRIPT_PREMERGE = resolve('scripts/deploy/premerge-migrate.mjs');
const URL_FALSA = 'postgresql://u:SEGREDO@db.exemplo.invalid:5432/d';
const SEM_ALVO = { MIGRATION_DATABASE_URL: '', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '' };
const COM_ALVO = { MIGRATION_DATABASE_URL: URL_FALSA, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '7692130048193495360' };
/** Roda o runner real no repositório descartável, no SHA da release. */
const runnerDaRelease = (repo) => (env, ...a) => spawnSync(process.execPath, [SCRIPT_PREMERGE, '--sha', repo.sha, ...a], { cwd: repo.trabalho, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });
const semSegredo = (r) => assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\/|exemplo\.invalid/);
/** CONTRACT_NAO_AUTORIZADO ANTES de qualquer conexão ao alvo, sem URL na saída. */
const recusadoSemConectar = (r, decisao) => {
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /RECUSADO CONTRACT_NAO_AUTORIZADO/);
  assert.ok(r.stderr.includes(`exigem --contract ${decisao} exato`), r.stderr);
  assert.doesNotMatch(r.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS|alvo indisponível/, 'recusou ANTES de qualquer conexão');
  semSegredo(r);
};

test('B9 (D-PROD-162): runner real sobre a release do CONTRACT — análise local declara o CONTRACT; verificar/aplicar exigem --contract D-PROD-162 exato ANTES de conectar; nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_C);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    assert.match(analise.stdout, /ANÁLISE LOCAL OK \(CONTRACT D-PROD-162: 13 tabelas removidas, 2 CHECKs alargados\) — alvo remoto NÃO verificado/);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    // Isolada: a D-PROD-183, a D-PROD-187, a D-PROD-194, a D-PROD-195, a D-PROD-197 e a D-PROD-200 estão na main desta release sintética, então a única migration nova é a D-PROD-162.
    assert.deepEqual(json.migrations_novas, [NOME_C]);
    assert.deepEqual(json.contract.map((k) => k.decisao), ['D-PROD-162']);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-162').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-162');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-999'),
      run(COM_ALVO, '--verificar-alvo', '--contract'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-183'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-187'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-194'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-195'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-197'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-200'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-162');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-162');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B13 (D-PROD-183): runner real sobre a release do DROP COLUMN de TipoTarefa — análise local declara as 4 colunas removidas; verificar/aplicar exigem --contract D-PROD-183 exato ANTES de conectar (a decisão da D-PROD-162 não serve); nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_T);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    assert.ok(analise.stdout.includes('ANÁLISE LOCAL OK (CONTRACT D-PROD-183: 4 colunas removidas (TipoTarefa.exige_area, TipoTarefa.pode_ter_produto, TipoTarefa.pode_ter_maquina, TipoTarefa.pode_ter_implemento)) — alvo remoto NÃO verificado'), analise.stdout);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    // Isolada: a D-PROD-162, a D-PROD-187, a D-PROD-194, a D-PROD-195, a D-PROD-197 e a D-PROD-200 estão na main desta release sintética, então a única nova é a D-PROD-183.
    assert.deepEqual(json.migrations_novas, [NOME_T]);
    assert.deepEqual(json.contract, [CONTRACT_T]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-183').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-183');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-162'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-162'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-183'), run(COM_ALVO, '--verificar-alvo', '--contract'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-200'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-183');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-183');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

/** D-PROD-190 (Fatia C) — ApontamentoAtividade: EXPAND puro, só a tabela nova (nenhuma tabela antiga alterada). */
const NOME_A = '20261113700000_apontamento_atividade';

test('B14a (D-PROD-190): ApontamentoAtividade classificado SOZINHO, como na release (a D-PROD-183 já está na main): EXPAND puro, só a tabela nova, nenhuma coluna nem constraint em tabela antiga, DO de RLS pinado citando só a tabela nova; --contract é inesperado', () => {
  const m = ler(NOME_A);
  const c = classificarMigrations([m]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(c.tabelas_novas, ['ApontamentoAtividade']);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  // Release EXPAND: sem --contract passa; qualquer --contract (inclusive o número desta decisão) é inesperado.
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_A], classificacao: c, autorizacao: undefined }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-190', 'D-PROD-183', '']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_A], classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_INESPERADO' }, autorizacao);
  }
  assert.equal(envDoDeployMigrate({ env: { PATH: '/bin' }, classificacao: c, autorizacao: 'D-PROD-190' }).MIGRATION_CONTRACT_AUTORIZADO, undefined);
  // Área e lançamento de tarefa só têm unique (cliente_id, id): a empresa deles é conferida no SERVIÇO, porque um
  // unique por empresa nas tabelas antigas seria DDL fora do EXPAND (recusado); idem CHECK/coluna NOT NULL em tabela antiga.
  const casos = {
    'CREATE UNIQUE INDEX "AreaPastagem_cliente_id_empresa_id_id_key" ON "AreaPastagem"("cliente_id", "empresa_id", "id");': 'UNIQUE_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "LancamentoTarefa_cliente_id_empresa_id_id_key" ON "LancamentoTarefa"("cliente_id", "empresa_id", "id");': 'UNIQUE_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "x" CHECK ("ativo" IS NOT NULL);': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "BemPatrimonial" ADD COLUMN "ultimo_apontamento_id" VARCHAR(64) NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'DELETE FROM "TipoAtividade";': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const r = classificar(`${m.sql}\n${ddl}\n`);
    assert.equal(r.expand, false, ddl);
    assert.deepEqual(r.violacoes.map((v) => v.codigo), [codigo], ddl);
  }
  // Na tabela nova, um CHECK continua aceito (o classificador permitiria endurecer o domínio depois, com novo pin).
  assert.deepEqual(classificar(`${m.sql}\nALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_status_check" CHECK ("status" IN ('CONFIRMADO', 'CANCELADO'));\n`).violacoes, []);
  // O bloco DO pinado não pode citar tabela antiga: incluir 'TipoAtividade' na lista muda o hash e cita tabela antiga.
  const doComAntiga = trocar(m.sql, "ARRAY['ApontamentoAtividade']", "ARRAY['TipoAtividade','ApontamentoAtividade']");
  assert.deepEqual(codigos(classificar(doComAntiga)), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // 1 byte a mais no arquivo pinado → checksum divergente; sem a entrada no manifesto → não aprovada.
  assert.deepEqual(classificarMigrations([{ ...m, sql: `${m.sql}\n` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
  const semEntrada = Object.fromEntries(Object.entries(MIGRATIONS_APROVADAS).filter(([n]) => n !== NOME_A));
  assert.deepEqual(classificarMigrations([m], { manifesto: semEntrada }).violacoes.map((v) => v.codigo), ['MIGRATION_NAO_APROVADA']);
  // Sem o hash do DO na allowlist, o mesmo arquivo é recusado (o pin do DO é desta decisão, não herdado).
  const semDo = DO_RLS_APROVADOS.filter((h) => h !== '5da2c547f176a4c49841f52ce19922b9f7c3150d3b1851cdc8e0554e408f1867');
  assert.equal(semDo.length, DO_RLS_APROVADOS.length - 1);
  assert.deepEqual(codigos(classificarMigrations([m], { doAprovados: semDo })), ['DO_NAO_RECONHECIDO']);
});

test('B14b (D-PROD-190): runner real sobre a release do ApontamentoAtividade — análise local EXPAND sem rótulo CONTRACT; --contract é CONTRACT_INESPERADO; verificar o alvo não pede --contract e segue para a conexão; nunca imprime URL', () => {
  // O mesmo repositório descartável dos CONTRACT serve para uma release EXPAND: main = pasta sem NOME_A, HEAD = main + NOME_A.
  const repo = repoDaReleaseContract(NOME_A);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    assert.ok(analise.stdout.includes('premerge-migrate: ANÁLISE LOCAL OK — alvo remoto NÃO verificado'), analise.stdout);
    assert.doesNotMatch(analise.stdout, /CONTRACT D-PROD/);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'EXPAND');
    assert.equal(json.expand, true);
    assert.deepEqual(json.migrations_novas, [NOME_A]);
    assert.deepEqual(json.contract, []);
    assert.deepEqual(json.tabelas_novas, ['ApontamentoAtividade']);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    for (const r of [run(SEM_ALVO, '--contract', 'D-PROD-190'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-183')]) {
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, /RECUSADO CONTRACT_INESPERADO/);
      semSegredo(r);
    }
    const semConfig = run(SEM_ALVO, '--aplicar');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    // Sem CONTRACT a barreira de autorização não existe: o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const verificar = run(COM_ALVO, '--verificar-alvo');
    assert.equal(verificar.status, 3);
    assert.doesNotMatch(verificar.stderr, /CONTRACT_/);
    assert.match(verificar.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(verificar);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B15a (D-PROD-187): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, nenhuma tabela nova nem coluna em tabela antiga, e o descritor com as 16 colunas, a FK e o índice do ícone, a tabela renomeada e os 4 nomes novos', () => {
  const c = classificarMigrations([ler(NOME_D)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, [], 'o RENAME não conta como tabela nova');
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_D]);
  // O arquivo é o ensaiado (PG 16, ensaio e teste da migration), byte a byte.
  assert.equal(sha256(SQL_D), '83ca58a07439a1cf4e12671fd5f6b89bf62be2aef7ff64112cca6f1418d37e1c');
  assert.equal(MIGRATIONS_APROVADAS[NOME_D], sha256(SQL_D));
});

test('B15b (D-PROD-187): a entrada de MIGRATIONS_CONTRACT_APROVADAS é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP TABLE, literais CategoriaManejo e CADCATEGORIA e as 23 instruções exatas', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_D];
  assert.ok(NOME_D in MIGRATIONS_APROVADAS, 'quem é CONTRACT também está no manifesto (checksum pinado)');
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-187');
  assert.equal(k.guarda_sha256, '0efa2ef32dd4faf3d2419896521a6a62552f89c1af8d151b6cf1eb2495c3e384');
  assert.deepEqual(k.drop, []);
  assert.deepEqual(k.literais_guarda, ['CategoriaManejo', 'CADCATEGORIA']);
  assert.equal(k.alter_antigas.length, 23);
  assert.deepEqual(k.alter_antigas, ALTER_D);
  // O hash pinado é o do corpo da guarda do arquivo (sem comentários, espaços normalizados) e cada texto pinado está nele uma vez.
  const corpo = SQL_D.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1];
  assert.equal(sha256(corpo.replace(/\s+/g, ' ').trim()), k.guarda_sha256);
  for (const a of k.alter_antigas) assert.equal(SQL_D.split(`${a};`).length, 2, a);
  // O número da decisão fica fora do migration.sql (renumerar nunca muda o checksum aplicado).
  assert.doesNotMatch(SQL_D, /D-PROD-187/);
});

test('B15c (D-PROD-187): as 23 instruções são EXATAMENTE as do contrato, na ordem — CASCADE, IF EXISTS, CONCURRENTLY, troca de ordem, RENAME para outro nome, RENAME COLUMN no lugar do DROP, outra tabela ou uma faltando → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const [FK, IDX, RACA, OFICIAL] = ALTER_D.map((a) => `${a};`);
  const ICONE = `${ALTER_D[17]};`;
  const RENOMEIA = `${ALTER_D[18]};`;
  const ULTIMA = `${ALTER_D[22]};`;
  const casos = {
    fkCascade: [trocar(SQL_D, FK, FK.replace(';', ' CASCADE;')), 0],
    indiceIfExists: [trocar(SQL_D, IDX, 'DROP INDEX IF EXISTS "CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx";'), 1],
    indiceConcurrently: [trocar(SQL_D, IDX, 'DROP INDEX CONCURRENTLY "CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx";'), 1],
    semFk: [trocar(SQL_D, `${FK}\n`, ''), 0],
    colunaCascade: [trocar(SQL_D, RACA, RACA.replace(';', ' CASCADE;')), 2],
    ordem: [trocar(SQL_D, `${RACA}\n${OFICIAL}`, `${OFICIAL}\n${RACA}`), 2],
    renameColumn: [trocar(SQL_D, ICONE, 'ALTER TABLE "CategoriaManejo" RENAME COLUMN "catalogo_categoria_visual_id" TO "icone_antigo";'), 17],
    outraTabela: [trocar(SQL_D, OFICIAL, 'ALTER TABLE "Lote" DROP COLUMN "categoria_oficial";'), 3],
    outroNome: [trocar(SQL_D, RENOMEIA, 'ALTER TABLE "CategoriaManejo" RENAME TO "CADCATEGORIAS";'), 18],
    renameIfExists: [trocar(SQL_D, RENOMEIA, 'ALTER TABLE IF EXISTS "CategoriaManejo" RENAME TO "CADCATEGORIA";'), 18],
    faltando: [trocar(SQL_D, ULTIMA, ''), 22],
    numaSo: [trocar(SQL_D, `${RACA}\n${OFICIAL}`, 'ALTER TABLE "CategoriaManejo" DROP COLUMN "raca", DROP COLUMN "categoria_oficial";'), 2],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_D, caso);
    const c = classificarContractD(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: esperado `), `${caso}: ${c.violacoes[0].detalhe}`);
  }
});

test('B15d (D-PROD-187): o que vem depois das 23 cai no caminho EXPAND do resto — mais um RENAME (tabela, índice, coluna ou constraint), DROP INDEX, DROP COLUMN, UNIQUE, DELETE e DROP TABLE recusados; tabela nova aceita como sempre', () => {
  const casos = {
    'ALTER TABLE "CADCATEGORIA" RENAME TO "CategoriaManejo";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "CADCATEGORIA" RENAME COLUMN "nome" TO "nome_categoria";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" RENAME CONSTRAINT "Lote_pkey" TO "LOTE_pkey";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER INDEX "Lote_cliente_id_id_key" RENAME TO "x";': 'SQL_NAO_RECONHECIDO',
    'DROP INDEX "CADCATEGORIA_cliente_id_empresa_id_idx";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "CADCATEGORIA" DROP COLUMN "sigla";': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "CADCATEGORIA_cliente_id_nome_key" ON "CADCATEGORIA"("cliente_id", "nome");': 'UNIQUE_EM_TABELA_ANTIGA',
    'DELETE FROM "CADCATEGORIA";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "CatalogoCategoriaVisual";': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) assert.deepEqual(codigos(classificarContractD(`${SQL_D}\n${ddl}\n`)), [codigo], ddl);
  // O RENAME só existe como texto pinado: no caminho EXPAND (outra migration qualquer) ele é recusado.
  assert.deepEqual(codigos(classificar('ALTER TABLE "CategoriaManejo" RENAME TO "CADCATEGORIA";\n')), ['ALTER_EM_TABELA_ANTIGA']);
  assert.deepEqual(codigos(classificar('ALTER INDEX "CategoriaManejo_pkey" RENAME TO "CADCATEGORIA_pkey";\n')), ['SQL_NAO_RECONHECIDO']);
  // Controle positivo: CREATE TABLE e índice não-único depois do recorte são o EXPAND de sempre.
  const comNova = classificarContractD(`${SQL_D}\n${BASE}CREATE INDEX "Nova_cliente_id_idx" ON "Nova"("cliente_id");\n`);
  assert.deepEqual(comNova.violacoes, []);
  assert.deepEqual(comNova.tabelas_novas, ['Nova']);
  assert.deepEqual(comNova.contract, [CONTRACT_D]);
});

test('B15e (D-PROD-187): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE; citando outra tabela → DO_EM_TABELA_ANTIGA', () => {
  for (const [de, para] of [
    ['IF n_colunas <> 16 THEN', 'IF n_colunas <> 15 THEN'],
    ['IF (total > 0 OR esperada IS NOT NULL) AND', 'IF esperada IS NOT NULL AND'],
    ["AND k.conname = 'CategoriaManejo_catalogo_categoria_visual_id_fkey'));", "AND k.contype = 'f'));"],
    ['|catalogo_categoria_visual_id)\\M', ')\\M'],
  ]) {
    assert.deepEqual(codigos(classificarContractD(trocar(SQL_D, de, para))), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], de);
  }
  const inicio = SQL_D.indexOf('-- 1. Guarda');
  const fim = SQL_D.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_D.slice(0, inicio) + SQL_D.slice(fim);
  assert.ok(!semGuarda.includes('n_colunas'));
  assert.deepEqual(codigos(classificarContractD(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  const antes = classificarContractD(`CREATE INDEX "x_idx" ON "CategoriaManejo"("id");\n${SQL_D}`);
  assert.deepEqual(codigos(antes), ['CONTRACT_GUARDA_AUSENTE']);
  // Guarda (com hash repinado num contrato sintético) que cita outra tabela: os literais só deixam CategoriaManejo e CADCATEGORIA.
  const outra = trocar(SQL_D, `tabela := to_regclass('public."CategoriaManejo"');`, `tabela := to_regclass('public."Lote"');`);
  const corpo = outra.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  const contratos = { [NOME_D]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_D], guarda_sha256: sha256(corpo) } };
  const c = classificarContractD(outra, { contratos });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Lote'));
});

test('B15f (D-PROD-187): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada (ou com o contrato de outra decisão) o nome real é recusado', () => {
  const outro = '20261113400001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_D }], { manifesto: { [outro]: sha256(SQL_D) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(codigos(c), ['ALTER_EM_TABELA_ANTIGA', 'DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO', 'SQL_NAO_RECONHECIDO']);
  assert.equal(c.violacoes.filter((x) => x.codigo === 'ALTER_EM_TABELA_ANTIGA').length, 20, 'DROP CONSTRAINT, 16 DROP COLUMN, RENAME TO e 2 RENAME CONSTRAINT');
  assert.equal(c.violacoes.filter((x) => x.codigo === 'SQL_NAO_RECONHECIDO').length, 3, 'DROP INDEX e 2 ALTER INDEX … RENAME');
  assert.equal(classificarMigrations([ler(NOME_D)], { contratos: {} }).ok, false);
  assert.equal(classificarMigrations([ler(NOME_D)], { contratos: { [NOME_T]: MIGRATIONS_CONTRACT_APROVADAS[NOME_T] } }).ok, false);
  // O contrato de um nome não serve ao SQL do outro: guarda e instruções da D-PROD-183 não batem com o arquivo da D-PROD-187.
  assert.deepEqual(codigos(classificarContractT(SQL_D)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
});

test('B15g (D-PROD-187): conferirReleaseContract — a D-PROD-187 sozinha só com --contract D-PROD-187 exato; junto com outra migration ou com outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-187 sem CONTRACT é inesperado', () => {
  const comD = classificarMigrations([ler(NOME_D)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_D], classificacao: comD, autorizacao: 'D-PROD-187' }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-183', 'D-PROD-162', 'D-PROD-194', '', undefined, null, 'd-prod-187', ' D-PROD-187', 'D-PROD-187 ']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_D], classificacao: comD, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  const ATIV = '20261113100000_tipo_atividade_cadastro';
  const comOutra = classificarMigrations([ler(ATIV), ler(NOME_D)]);
  assert.deepEqual(comOutra.violacoes, []);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [ATIV, NOME_D], classificacao: comOutra, autorizacao: 'D-PROD-187' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  const duas = classificarMigrations([ler(NOME_T), ler(NOME_D)]);
  assert.deepEqual(duas.violacoes, []);
  for (const autorizacao of ['D-PROD-183', 'D-PROD-187', undefined]) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_T, NOME_D], classificacao: duas, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, String(autorizacao));
  }
  const semC = classificarMigrations([ler(ATIV)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [ATIV], classificacao: semC, autorizacao: 'D-PROD-187' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B15h (D-PROD-187): contractsPendentes com as três CONTRACT locais — produção hoje (D-PROD-162 e D-PROD-183 concluídas) deixa só a D-PROD-187 pendente; aberta ou revertida continua pendente; as três concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, '20261113100000_tipo_atividade_cadastro', NOME_T, NOME_D];
  const PEND_D = { nome: NOME_D, decisao: 'D-PROD-187' };
  const producao = [linha(NOME_C), linha(NOME_T)];
  assert.deepEqual(contractsPendentes({ locais, linhas: producao }), [PEND_D], 'produção hoje');
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187']);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_D)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_D, { finished_at: null })] }), [PEND_D], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_D, { rolled_back_at: new Date() })] }), [PEND_D], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_D), linhas: producao }), [], 'sem a pasta local não há o que aplicar');
});

test('B15i (D-PROD-187): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-187 só com a D-PROD-187 sozinha e --contract D-PROD-187; outra decisão ou duas CONTRACT juntas não autorizam', () => {
  const comD = classificarMigrations([ler(NOME_D)]);
  const duas = classificarMigrations([ler(NOME_T), ler(NOME_D)]);
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comD, autorizacao: 'D-PROD-187' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-187');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-187' };
  for (const [classificacao, autorizacao] of [[comD, 'D-PROD-183'], [comD, undefined], [comD, 'd-prod-187'], [duas, 'D-PROD-183'], [duas, 'D-PROD-187']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B15j (D-PROD-187): runner real sobre a release de CategoriaManejo → CADCATEGORIA — análise local declara colunas, FK, índice e nomes; verificar/aplicar exigem --contract D-PROD-187 exato ANTES de conectar; nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_D);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    const rotulo = 'ANÁLISE LOCAL OK (CONTRACT D-PROD-187: '
      + `1 constraints removidas (${CONTRACT_D.constraints_removidas[0]}), 1 índices removidos (${CONTRACT_D.indices_removidos[0]}), `
      + `16 colunas removidas (${CONTRACT_D.colunas_removidas.join(', ')}), tabela renomeada (CategoriaManejo→CADCATEGORIA), `
      + `4 nomes renomeados (${CONTRACT_D.nomes_renomeados.join(', ')})) — alvo remoto NÃO verificado`;
    assert.ok(analise.stdout.includes(rotulo), analise.stdout);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    // Isolada: a D-PROD-162 e a D-PROD-183 estão na main desta release sintética (em produção já concluídas), e
    // também a CADCURVAGANHO (D-PROD-189), o ApontamentoAtividade (D-PROD-190), a curva mensal (D-PROD-194), a curva na categoria (D-PROD-195), os padrões do TipoAtividade (D-PROD-197) e a Atividade cabeçalho (D-PROD-200), de nome POSTERIOR a esta: a release adiciona uma migration que ordena
    // antes da última da main, e isso não é migration da main alterada nem migration nova a mais.
    assert.ok(readdirSync(join(repo.trabalho, 'backend/prisma/migrations')).some((d) => d > NOME_D), 'a main da release tem migration de nome posterior');
    assert.deepEqual(json.migrations_novas, [NOME_D]);
    assert.deepEqual(json.contract, [CONTRACT_D]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-187').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-187');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-183'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-162'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-187'), run(COM_ALVO, '--verificar-alvo', '--contract'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-194'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-195'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-197'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-200'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-187');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-187');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B15k (D-PROD-187/D-PROD-189/D-PROD-190): ordem de produção — alvo com todas as pastas menos esta CONTRACT concluídas, inclusive a CADCURVAGANHO e o ApontamentoAtividade, de nome POSTERIOR a ela: o histórico confere, a única pendente é a D-PROD-187 e a barreira do CONTRACT a exige; nenhuma conferência depende da ordem dos nomes', () => {
  // As duas EXPAND de nome posterior que produção concluiu ANTES desta CONTRACT, na ordem real: a CADCURVAGANHO
  // (D-PROD-189, 23:18 UTC de 2026-11-13) e depois o ApontamentoAtividade (D-PROD-190, 23:23 UTC).
  const POSTERIORES = ['20261113600000_cadcurvaganho_cadastro', '20261113700000_apontamento_atividade'];
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // Produção no dia desta CONTRACT: as pastas até a última POSTERIOR. As de releases seguintes, com nome depois dela
  // (os itens do apontamento, D-PROD-193, `20261113800000_apontamento_atividade_item`, a curva mensal, D-PROD-194, ver
  // B16k, a curva na categoria, D-PROD-195, ver B18k, os padrões do TipoAtividade, D-PROD-197, ver B19k, o peso
  // objetivo, D-PROD-198, ver B20k, a Atividade cabeçalho, D-PROD-200, ver B21m, as linhas de produto e de máquina,
  // D-PROD-202, ver B22k, as Formulações, D-PROD-203, ver B23k, e a mão de obra e o serviço, D-PROD-207, ver B26k), ainda não existiam: 47 pastas. A EXPAND que a main recebeu depois dela (D-PROD-185,
  // só índices, de nome anterior) não muda o que este teste prova.
  const locais = todas.filter((l) => l.nome <= POSTERIORES.at(-1));
  assert.equal(locais.length, 47);
  for (const n of ['20261113800000_apontamento_atividade_item', NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  for (const p of POSTERIORES) assert.ok(p > NOME_D && locais.some((l) => l.nome === p), p);
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 46 sem a D-PROD-187; por último a CADCURVAGANHO e, depois dela, o ApontamentoAtividade.
  const linhas = locais.filter((l) => l.nome !== NOME_D)
    .map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 46);
  assert.equal(linhas.length, locais.length - 1);
  assert.deepEqual(linhas.slice(-2).map((l) => l.migration_name), POSTERIORES);
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_D], falhas: [] });
  // A ordem das linhas (ou das pastas) não muda nada: conferência por conjunto.
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_D, decisao: 'D-PROD-187' }]);
  // Depois da aplicação (a D-PROD-187 concluída DEPOIS da CADCURVAGANHO e do ApontamentoAtividade): 47, nada pendente, nada a autorizar.
  const depois = [...linhas, { migration_name: NOME_D, checksum: MIGRATIONS_APROVADAS[NOME_D], finished_at: new Date(t0 + 99_000), rolled_back_at: null }];
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B16a (D-PROD-194): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, só CADCURVAGANHO como tabela nova (a recriada), nenhuma coluna em tabela antiga e só CADCURVAGANHO removida', () => {
  const c = classificarMigrations([ler(NOME_K)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, ['CADCURVAGANHO']);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_K]);
  // O arquivo é o auditado, byte a byte.
  assert.equal(sha256(SQL_K), 'a18b2845815a637398ccd8d1e0f9cbcbad1bab8e8b628e988d26cf09c302953c');
  assert.equal(MIGRATIONS_APROVADAS[NOME_K], sha256(SQL_K));
  // A tabela volta com os 12 GMD mensais e sem os 3 por estação (estes só aparecem na guarda, antes do DROP).
  const resto = SQL_K.slice(SQL_K.indexOf(DROP_K));
  for (const m of ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']) assert.ok(resto.includes(`"gmd_${m}" DECIMAL(6,3) NOT NULL,`), m);
  assert.doesNotMatch(resto, /gmd_aguas|gmd_transicao|gmd_seca/);
});

test('B16b (D-PROD-194): a entrada de MIGRATIONS_CONTRACT_APROVADAS é congelada e o conteúdo pinado é o do arquivo — guarda, só o DROP TABLE "CADCURVAGANHO", nenhum literal e nenhuma instrução em tabela antiga; o RLS do resto é o corpo já aprovado na D-PROD-189', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_K];
  assert.ok(NOME_K in MIGRATIONS_APROVADAS, 'quem é CONTRACT também está no manifesto (checksum pinado)');
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-194');
  assert.equal(k.guarda_sha256, '3cd5adc49d6e0cab0e155b190d7c095a419b7ddbb0ef617bc5000bc9bdfb0b6d');
  assert.deepEqual(k.drop, ['CADCURVAGANHO']);
  assert.deepEqual(k.literais_guarda, []);
  assert.deepEqual(k.alter_antigas, []);
  // O hash pinado é o do corpo da guarda do arquivo (sem comentários, espaços normalizados); o DROP está nele uma vez.
  const corpos = [...SQL_K.replace(/--[^\n]*/g, '').matchAll(/DO\s+\$\$([\s\S]*?)\$\$\s*;/g)].map((x) => sha256(x[1].replace(/\s+/g, ' ').trim()));
  assert.equal(corpos.length, 2, 'guarda + RLS');
  assert.equal(corpos[0], k.guarda_sha256);
  assert.equal(SQL_K.split(DROP_K).length, 2);
  // O DO de RLS da tabela recriada não é corpo novo: é o mesmo hash da D-PROD-189 (já em DO_RLS_APROVADOS).
  const rls189 = readFileSync('backend/prisma/migrations/20261113600000_cadcurvaganho_cadastro/migration.sql', 'utf8').replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1];
  assert.equal(corpos[1], sha256(rls189.replace(/\s+/g, ' ').trim()));
  assert.ok(DO_RLS_APROVADOS.includes(corpos[1]));
});

test('B16c (D-PROD-194): o DROP é EXATAMENTE DROP TABLE "CADCURVAGANHO" — CASCADE, RESTRICT, IF EXISTS, outra tabela, duas numa instrução só ou ausente → CONTRACT_DROP_FORA_DO_CONTRATO', () => {
  const casos = {
    cascade: trocar(SQL_K, DROP_K, 'DROP TABLE "CADCURVAGANHO" CASCADE;'),
    restrict: trocar(SQL_K, DROP_K, 'DROP TABLE "CADCURVAGANHO" RESTRICT;'),
    ifExists: trocar(SQL_K, DROP_K, 'DROP TABLE IF EXISTS "CADCURVAGANHO";'),
    outraTabela: trocar(SQL_K, DROP_K, 'DROP TABLE "CADESTACOES";'),
    duas: trocar(SQL_K, DROP_K, 'DROP TABLE "CADCURVAGANHO", "CADESTACOES";'),
    ausente: trocar(SQL_K, DROP_K, ''),
  };
  for (const [caso, sql] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_K, caso);
    const c = classificarContractK(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_DROP_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, /^posição 0: esperado DROP TABLE "CADCURVAGANHO" encontrado /, caso);
  }
  assert.match(classificarContractK(casos.ausente).violacoes[0].detalhe, /encontrado CREATE TABLE "CADCURVA/);
});

test('B16d (D-PROD-194): depois do DROP o resto é o EXPAND da tabela recriada — segundo DROP TABLE, DROP de outra tabela, DELETE, UPDATE, TRUNCATE, ALTER e UNIQUE em tabela antiga recusados; sem o CREATE TABLE a CADCURVAGANHO volta a ser antiga', () => {
  const casos = {
    'DROP TABLE "CADCURVAGANHO";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "CADESTACOES";': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "CADCURVAGANHO";': 'SQL_NAO_RECONHECIDO',
    'UPDATE "CADESTACOES" SET "ativo" = false;': 'SQL_NAO_RECONHECIDO',
    'TRUNCATE "CADESTACOES";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "CADESTACOES" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "CADESTACOES" DROP COLUMN "nome";': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "CADESTACOES_cliente_id_nome_key" ON "CADESTACOES"("cliente_id", "nome");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) assert.deepEqual(codigos(classificarContractK(`${SQL_K}\n${ddl}\n`)), [codigo], ddl);
  // Um segundo DROP logo depois do primeiro (antes da recriação) também cai no resto, e não no recorte.
  const segundoDrop = classificarContractK(trocar(SQL_K, DROP_K, `${DROP_K}\nDROP TABLE "CADESTACOES";`));
  assert.deepEqual(codigos(segundoDrop), ['SQL_NAO_RECONHECIDO']);
  // O DO de RLS do resto não pode citar outra tabela: muda o hash e cita tabela antiga.
  const rlsComAntiga = classificarContractK(trocar(SQL_K, "ARRAY['CADCURVAGANHO']", "ARRAY['CADCURVAGANHO','CADESTACOES']"));
  assert.deepEqual(codigos(rlsComAntiga), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // Sem o CREATE TABLE no resto, a tabela removida não é "nova": índices únicos, FKs/CHECK e RLS sobre ela são recusados.
  const semCreate = classificarContractK(SQL_K.slice(0, SQL_K.indexOf('-- CreateTable')) + SQL_K.slice(SQL_K.indexOf('-- CreateIndex')));
  assert.deepEqual(codigos(semCreate), ['ALTER_EM_TABELA_ANTIGA', 'DO_EM_TABELA_ANTIGA', 'UNIQUE_EM_TABELA_ANTIGA']);
  // Controle positivo: CHECK na tabela recriada e tabela nova depois do recorte são o EXPAND de sempre.
  const ok = classificarContractK(`${SQL_K}\nALTER TABLE "CADCURVAGANHO" ADD CONSTRAINT "x_check" CHECK ("nome" <> '');\n${BASE}`);
  assert.deepEqual(ok.violacoes, []);
  assert.deepEqual(ok.tabelas_novas, ['CADCURVAGANHO', 'Nova']);
  assert.deepEqual(ok.contract, [CONTRACT_K]);
});

test('B16e (D-PROD-194): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada (vazia, FK externa, colunas, rotinas, trava) → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE', () => {
  const corte = (sql, de, ate) => {
    const i = sql.indexOf(de);
    const j = sql.indexOf(ate);
    assert.ok(i > 0 && j > i, `${de} … ${ate}`);
    return sql.slice(0, i) + sql.slice(j);
  };
  const alteradas = {
    vazia: trocar(SQL_K, 'IF curvas <> 0 THEN', 'IF curvas < 0 THEN'),
    semFkExterna: corte(SQL_K, '  SELECT string_agg(k.conname', '  SELECT string_agg(t.tgname'),
    semRotinas: corte(SQL_K, '  SELECT string_agg(p.oid::regprocedure', 'END $$;'),
    colunas: trocar(SQL_K, 'IF n_antigas <> 3 OR n_outras <> 0 THEN', 'IF n_antigas <> 3 THEN'),
    trava: trocar(SQL_K, 'LOCK TABLE public."CADCURVAGANHO" IN ACCESS EXCLUSIVE MODE;', 'LOCK TABLE public."CADCURVAGANHO" IN SHARE MODE;'),
  };
  for (const [caso, sql] of Object.entries(alteradas)) {
    assert.notEqual(sql, SQL_K, caso);
    assert.deepEqual(codigos(classificarContractK(sql)), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], caso);
  }
  const inicio = SQL_K.indexOf('-- 1. Guarda');
  const fim = SQL_K.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_K.slice(0, inicio) + SQL_K.slice(fim);
  assert.ok(!semGuarda.includes('curvas bigint'));
  assert.deepEqual(codigos(classificarContractK(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  const antes = classificarContractK(`CREATE INDEX "x_idx" ON "CADCURVAGANHO"("id");\n${SQL_K}`);
  assert.deepEqual(codigos(antes), ['CONTRACT_GUARDA_AUSENTE']);
});

test('B16f (D-PROD-194): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada (ou com os contratos da D-PROD-162/D-PROD-183/D-PROD-187) o nome real é recusado', () => {
  const outro = '20261114100001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_K }], { manifesto: { [outro]: sha256(SQL_K) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(codigos(c), ['DO_NAO_RECONHECIDO', 'SQL_NAO_RECONHECIDO']);
  assert.ok(c.violacoes.some((x) => x.codigo === 'SQL_NAO_RECONHECIDO' && x.detalhe === 'DROP TABLE "CADCURVAGANHO"'), 'o DROP TABLE é recusado');
  // Contrato vazio, ou só as entradas anteriores: nada é aprovado por fora da lista fechada.
  assert.equal(classificarMigrations([ler(NOME_K)], { contratos: {} }).ok, false);
  const antigos = { [NOME_C]: MIGRATIONS_CONTRACT_APROVADAS[NOME_C], [NOME_T]: MIGRATIONS_CONTRACT_APROVADAS[NOME_T], [NOME_D]: MIGRATIONS_CONTRACT_APROVADAS[NOME_D] };
  assert.equal(classificarMigrations([ler(NOME_K)], { contratos: antigos }).ok, false);
  // O contrato de um nome não serve ao SQL do outro: guarda, DROP e alterações das anteriores não batem com o arquivo da D-PROD-194.
  assert.deepEqual(codigos(classificarContract(SQL_K)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractT(SQL_K)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractD(SQL_K)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  // E o contrato da D-PROD-194 não serve aos arquivos das anteriores.
  assert.ok(codigos(classificarContractK(SQL_C)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  assert.ok(codigos(classificarContractK(SQL_T)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  assert.ok(codigos(classificarContractK(SQL_D)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
});

test('B16g (D-PROD-194): conferirReleaseContract — a D-PROD-194 sozinha só com --contract D-PROD-194 exato; junto com outra migration ou com outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-194 sem CONTRACT é inesperado', () => {
  const comK = classificarMigrations([ler(NOME_K)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_K], classificacao: comK, autorizacao: 'D-PROD-194' }), { ok: true, codigo: null });
  // Os números antigos (D-PROD-190, hoje da PR #269, e D-PROD-191, hoje da PR #271) não autorizam: a decisão da curva mensal é a D-PROD-194.
  for (const autorizacao of ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-189', 'D-PROD-190', 'D-PROD-191', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', '', undefined, null, 'd-prod-194', ' D-PROD-194', 'D-PROD-194 ']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_K], classificacao: comK, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  // Junto com a criação da tabela (D-PROD-189) ou com outra migration: não isolada.
  const CURVA = '20261113600000_cadcurvaganho_cadastro';
  const comOutra = classificarMigrations([ler(CURVA), ler(NOME_K)]);
  assert.deepEqual(comOutra.violacoes, []);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [CURVA, NOME_K], classificacao: comOutra, autorizacao: 'D-PROD-194' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  // Com outra CONTRACT (inclusive a Fatia D, D-PROD-187) ou várias: nenhuma autorização isola (a variável do runner oficial tem um só valor).
  for (const lote of [[NOME_C, NOME_K], [NOME_T, NOME_K], [NOME_D, NOME_K], [NOME_C, NOME_T, NOME_K], [NOME_C, NOME_T, NOME_D, NOME_K]]) {
    const c = classificarMigrations(lote.map(ler));
    assert.deepEqual(c.violacoes, []);
    assert.equal(c.contract.length, lote.length);
    for (const autorizacao of ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', undefined]) {
      assert.deepEqual(conferirReleaseContract({ nomesNovas: lote, classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, `${lote.length} CONTRACT, ${autorizacao}`);
    }
  }
  const semK = classificarMigrations([ler(CURVA)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [CURVA], classificacao: semK, autorizacao: 'D-PROD-194' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B16h (D-PROD-194): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-194 só com a D-PROD-194 sozinha e --contract D-PROD-194; outra decisão ou outra CONTRACT junto não autorizam', () => {
  const comK = classificarMigrations([ler(NOME_K)]);
  const duas = classificarMigrations([ler(NOME_T), ler(NOME_K)]);
  const tres = classificarMigrations([ler(NOME_C), ler(NOME_T), ler(NOME_K)]);
  const comFatiaD = classificarMigrations([ler(NOME_D), ler(NOME_K)]);
  const quatro = classificarMigrations([ler(NOME_C), ler(NOME_T), ler(NOME_D), ler(NOME_K)]);
  // Positivo com base 'herdado': prova que a função GRAVA a decisão (não só deixa passar o valor herdado).
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comK, autorizacao: 'D-PROD-194' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-194');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
  // Negativos com base JÁ igual à decisão: prova que ela nunca é herdada.
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-194' };
  for (const [classificacao, autorizacao] of [[comK, 'D-PROD-183'], [comK, 'D-PROD-187'], [comK, 'D-PROD-189'], [comK, 'D-PROD-190'], [comK, 'D-PROD-191'], [comK, undefined], [comK, 'd-prod-194'], [duas, 'D-PROD-194'], [tres, 'D-PROD-194'], [comFatiaD, 'D-PROD-194'], [comFatiaD, 'D-PROD-187'], [quatro, 'D-PROD-194']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B16i (D-PROD-194): contractsPendentes com as quatro CONTRACT locais — produção hoje (D-PROD-162, D-PROD-183 e D-PROD-187 concluídas) deixa só a D-PROD-194 pendente; histórico vazio, as quatro; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, '20261113100000_tipo_atividade_cadastro', NOME_T, NOME_D, '20261113600000_cadcurvaganho_cadastro', NOME_K];
  const PEND_C = { nome: NOME_C, decisao: 'D-PROD-162' };
  const PEND_T = { nome: NOME_T, decisao: 'D-PROD-183' };
  const PEND_D = { nome: NOME_D, decisao: 'D-PROD-187' };
  const PEND_K = { nome: NOME_K, decisao: 'D-PROD-194' };
  const antigas = [linha(NOME_C), linha(NOME_T), linha(NOME_D)];
  assert.deepEqual(contractsPendentes({ locais, linhas: antigas }), [PEND_K], 'produção hoje: D-PROD-162, D-PROD-183 e D-PROD-187 concluídas');
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }), [PEND_C, PEND_T, PEND_D, PEND_K]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C)] }), [PEND_T, PEND_D, PEND_K]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [linha(NOME_C), linha(NOME_T)] }), [PEND_D, PEND_K], 'antes da Fatia D: as duas últimas pendentes');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...antigas, linha(NOME_K)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...antigas, linha(NOME_K, { finished_at: null })] }), [PEND_K], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...antigas, linha(NOME_K, { rolled_back_at: new Date() })] }), [PEND_K], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_K), linhas: antigas }), [], 'sem a pasta local não há o que aplicar');
});

test('B16j (D-PROD-194): runner real sobre a release da CADCURVAGANHO mensal — análise local declara a tabela removida e recriada; verificar/aplicar exigem --contract D-PROD-194 exato ANTES de conectar (as decisões anteriores e os números antigos D-PROD-190 e D-PROD-191 não servem); nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_K);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    // O rótulo cita só a tabela removida (sem CHECK alargado, coluna, constraint, índice ou nome removido/renomeado); singular ou plural é do runner.
    assert.match(analise.stdout, /ANÁLISE LOCAL OK \(CONTRACT D-PROD-194: 1 tabelas? removidas?\) — alvo remoto NÃO verificado/);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    // Isolada: D-PROD-162, D-PROD-183 e D-PROD-187 (em produção já concluídas) e a D-PROD-195, a D-PROD-197 e a D-PROD-200 (posteriores) estão na main desta release sintética, então a única nova é a D-PROD-194.
    assert.deepEqual(json.migrations_novas, [NOME_K]);
    assert.deepEqual(json.contract, [CONTRACT_K]);
    assert.deepEqual(json.tabelas_novas, ['CADCURVAGANHO'], 'a tabela removida volta recriada');
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-194').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-194');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-189'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-183'),
      run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-162'), run(COM_ALVO, '--aplicar', '--contract', 'd-prod-194'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-187'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-190'),
      run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-191'), run(COM_ALVO, '--verificar-alvo', '--contract'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-195'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-197'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-200'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-194');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-194');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B16k (D-PROD-194/D-PROD-187/D-PROD-189/D-PROD-190/D-PROD-185/D-PROD-193): ordem de produção no dia da D-PROD-194 — alvo com as 48 da main concluídas (por último a CADCURVAGANHO por estação, o ApontamentoAtividade, a D-PROD-187, o Estoque P1-03 e os itens do apontamento): o histórico confere, a única pendente é a D-PROD-194 e a barreira do CONTRACT a exige; depois dela, 49 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const ESTACAO = '20261113600000_cadcurvaganho_cadastro';
  const APONTAMENTO = '20261113700000_apontamento_atividade';
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const ITENS = '20261113800000_apontamento_atividade_item';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // Produção no dia desta CONTRACT: a curva mensal era a pasta de nome mais recente. A curva na categoria (D-PROD-195,
  // `20261114200000_cadcategoria_curva_ganho`, ver B18k), os padrões do TipoAtividade (D-PROD-197,
  // `20261114300000_tipo_atividade_defaults`, ver B19k), o peso objetivo (D-PROD-198,
  // `20261114400000_cadcategoria_peso_objetivo`, ver B20k), a Atividade cabeçalho (D-PROD-200,
  // `20261114500000_atividade_cabecalho`, ver B21m), as linhas de produto e de máquina (D-PROD-202,
  // `20261114600000_atividade_linhas_produto_maquina`, ver B22k), as Formulações (D-PROD-203,
  // `20261114700000_cadformulacao`, ver B23k) e a mão de obra e o serviço (D-PROD-207,
  // `20261115900000_atividade_mao_obra_servico`, ver B26k) vieram depois dela, em releases seguintes: 49 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_K);
  assert.equal(locais.length, 49);
  for (const n of [NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  for (const n of [ESTACAO, APONTAMENTO, P1_03, NOME_D, ITENS]) assert.ok(locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_K), 'na época, a curva mensal era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 48 sem a D-PROD-194, na ordem em que foram concluídas — a CADCURVAGANHO por estação (23:18 UTC de
  // 2026-11-13), o ApontamentoAtividade (23:23 UTC), depois a D-PROD-187 (00:37 UTC de 2026-11-14), o Estoque P1-03
  // (01:09 UTC) e, por último, os itens do apontamento (D-PROD-193, 12:51 UTC): as três últimas fora da ordem dos nomes.
  const fora = [NOME_K, NOME_D, P1_03, ITENS];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, ITENS].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 48);
  assert.deepEqual(linhas.slice(-5).map((l) => l.migration_name), [ESTACAO, APONTAMENTO, NOME_D, P1_03, ITENS]);
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_K], falhas: [] });
  // A ordem das linhas (ou das pastas) não muda nada: conferência por conjunto.
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_K, decisao: 'D-PROD-194' }]);
  // Depois da aplicação (a D-PROD-194 concluída por último): 49, nada pendente, nada a autorizar.
  const depois = [...linhas, { migration_name: NOME_K, checksum: MIGRATIONS_APROVADAS[NOME_K], finished_at: new Date(t0 + 99_000), rolled_back_at: null }];
  assert.equal(depois.length, 49);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B18a (D-PROD-195): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, nenhuma tabela nova nem coluna no caminho EXPAND, nenhuma tabela removida e o descritor com a coluna e a FK composta ADICIONADAS (nenhuma constraint alargada)', () => {
  const c = classificarMigrations([ler(NOME_G)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  // A coluna nova nasce NOT NULL pelo texto pinado: não é "coluna anulável em tabela antiga" do EXPAND; fica no
  // descritor da CONTRACT (colunas_adicionadas).
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_G]);
  // A FK composta não existia (nenhum DROP CONSTRAINT do mesmo nome antes dela): é ADICIONADA, nunca "alargada".
  assert.deepEqual(c.contract[0].constraints_alargadas, []);
  assert.deepEqual(c.contract[0].colunas_adicionadas, ['CADCATEGORIA.curva_ganho_id']);
  assert.deepEqual(c.contract[0].constraints_adicionadas, [`CADCATEGORIA.${FK_G}`]);
  // O arquivo é o auditado, byte a byte.
  assert.equal(sha256(SQL_G), 'b509ee754722f5e9f70938f2c17ddbe253734c7c86e0aecb55498a37d44e68fb');
  assert.equal(MIGRATIONS_APROVADAS[NOME_G], sha256(SQL_G));
  // O número da decisão fica fora do migration.sql (renumerar nunca muda o checksum aplicado).
  assert.doesNotMatch(SQL_G, /D-PROD-195/);
  // O resto, depois das 5 instruções pinadas, é só o índice não-único da busca por curva.
  const semComentario = SQL_G.replace(/--[^\n]*/g, '');
  assert.ok(semComentario.trimEnd().endsWith(INDICE_G), 'o índice é a última instrução');
  assert.equal(semComentario.split(INDICE_G).length, 2);
});

test('B18b (D-PROD-195): a entrada de MIGRATIONS_CONTRACT_APROVADAS é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP, literais CADCATEGORIA e CADCURVAGANHO e as 5 instruções exatas', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_G];
  assert.ok(NOME_G in MIGRATIONS_APROVADAS, 'quem é CONTRACT também está no manifesto (checksum pinado)');
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-195');
  assert.equal(k.guarda_sha256, '292d2446635c3178f10af0d24c33df0d92513f3725efb1ed2059ccc713cb63a8');
  assert.deepEqual(k.drop, []);
  assert.deepEqual(k.literais_guarda, ['CADCATEGORIA', 'CADCURVAGANHO']);
  assert.equal(k.alter_antigas.length, 5);
  assert.deepEqual(k.alter_antigas, ALTER_G);
  // O hash pinado é o do corpo da guarda do arquivo (sem comentários, espaços normalizados); só há um bloco DO.
  const corpos = [...SQL_G.replace(/--[^\n]*/g, '').matchAll(/DO\s+\$\$([\s\S]*?)\$\$\s*;/g)].map((x) => sha256(x[1].replace(/\s+/g, ' ').trim()));
  assert.deepEqual(corpos, [k.guarda_sha256], 'só a guarda (nenhuma tabela nova, nenhum RLS)');
  // Cada texto pinado está no arquivo uma vez, numa linha só, na ordem.
  let ultimo = -1;
  for (const a of k.alter_antigas) {
    assert.equal(SQL_G.split(`${a};`).length, 2, a);
    assert.ok(SQL_G.indexOf(`${a};`) > ultimo, `fora de ordem: ${a}`);
    ultimo = SQL_G.indexOf(`${a};`);
  }
  // A guarda exige a 'CURVA PADRÃO' com o mesmo literal que o UPDATE pinado usa para ligar as categorias.
  assert.ok(SQL_G.includes("k.nome = 'CURVA PADRÃO'") && k.alter_antigas[1].endsWith(`k."nome" = 'CURVA PADRÃO'`));
  assert.match(SQL_G, /RAISE EXCEPTION 'cadcategoria_curva_ganho: /);
});

test('B18c (D-PROD-195): as 5 instruções são EXATAMENTE as do contrato, na ordem — NOT NULL direto, outro tipo, UPDATE sem o filtro da CURVA PADRÃO, troca de ordem, UNIQUE em outras colunas, FK com CASCADE/NOT VALID/sem empresa/outra tabela, uma faltando → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const [COLUNA, LIGA, NOT_NULL, UNICO, FK] = ALTER_G.map((a) => `${a};`);
  const casos = {
    colunaNotNull: [trocar(SQL_G, COLUNA, COLUNA.replace(';', ' NOT NULL;')), 0],
    colunaIfNotExists: [trocar(SQL_G, COLUNA, COLUNA.replace('ADD COLUMN', 'ADD COLUMN IF NOT EXISTS')), 0],
    colunaOutroTipo: [trocar(SQL_G, COLUNA, COLUNA.replace('VARCHAR(64)', 'TEXT')), 0],
    colunaComDefault: [trocar(SQL_G, COLUNA, COLUNA.replace(';', " DEFAULT 'x';")), 0],
    semColuna: [trocar(SQL_G, `${COLUNA}\n`, ''), 0],
    ligaSemFiltroDoNome: [trocar(SQL_G, LIGA, LIGA.replace(` AND k."nome" = 'CURVA PADRÃO'`, '')), 1],
    ligaOutroNome: [trocar(SQL_G, LIGA, LIGA.replace("'CURVA PADRÃO'", "'CURVA PADRAO'")), 1],
    ligaSemFazenda: [trocar(SQL_G, LIGA, LIGA.replace(` AND k."empresa_id" = c."empresa_id"`, '')), 1],
    semLigacao: [trocar(SQL_G, `${LIGA}\n`, ''), 1],
    ordem: [trocar(SQL_G, `${LIGA}\n${NOT_NULL}`, `${NOT_NULL}\n${LIGA}`), 1],
    semNotNull: [trocar(SQL_G, `${NOT_NULL}\n`, ''), 2],
    unicoOutrasColunas: [trocar(SQL_G, UNICO, UNICO.replace('("cliente_id", "empresa_id", "id")', '("cliente_id", "id")')), 3],
    unicoConcurrently: [trocar(SQL_G, UNICO, UNICO.replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX CONCURRENTLY')), 3],
    unicoNaCategoria: [trocar(SQL_G, UNICO, 'CREATE UNIQUE INDEX "CADCATEGORIA_cliente_id_empresa_id_id_key" ON "CADCATEGORIA"("cliente_id", "empresa_id", "id");'), 3],
    fkCascade: [trocar(SQL_G, FK, FK.replace('ON DELETE RESTRICT', 'ON DELETE CASCADE')), 4],
    fkNotValid: [trocar(SQL_G, FK, FK.replace(';', ' NOT VALID;')), 4],
    fkSemEmpresa: [trocar(SQL_G, FK, FK.replace('("cliente_id", "empresa_id", "curva_ganho_id")', '("cliente_id", "curva_ganho_id")').replace('"CADCURVAGANHO"("cliente_id", "empresa_id", "id")', '"CADCURVAGANHO"("cliente_id", "id")')), 4],
    fkOutraTabela: [trocar(SQL_G, FK, FK.replace('REFERENCES "CADCURVAGANHO"', 'REFERENCES "CADESTACOES"')), 4],
    semFk: [trocar(SQL_G, `${FK}\n`, ''), 4],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_G, caso);
    const c = classificarContractG(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: esperado `), `${caso}: ${c.violacoes[0].detalhe}`);
  }
});

test('B18d (D-PROD-195): depois das 5 o resto só aceita o índice não-único — UNIQUE, coluna, UPDATE, DELETE, DROP, outra FK ou a mesma FK de novo recusados; tabela nova aceita como sempre', () => {
  const casos = {
    'CREATE UNIQUE INDEX "CADCATEGORIA_cliente_id_empresa_id_nome_key" ON "CADCATEGORIA"("cliente_id", "empresa_id", "nome");': 'UNIQUE_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_nome_key" ON "CADCURVAGANHO"("cliente_id", "nome");': 'UNIQUE_EM_TABELA_ANTIGA',
    'ALTER TABLE "CADCATEGORIA" ADD COLUMN "x" VARCHAR(64) NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "CADCATEGORIA" ALTER COLUMN "curva_ganho_id" DROP NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "CADCATEGORIA" DROP CONSTRAINT "CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey";': 'ALTER_EM_TABELA_ANTIGA',
    [`${ALTER_G[4]};`]: 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ADD CONSTRAINT "Lote_curva_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "id") REFERENCES "CADCURVAGANHO"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;': 'ALTER_EM_TABELA_ANTIGA',
    'UPDATE "CADCATEGORIA" SET "curva_ganho_id" = \'x\';': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "CADCURVAGANHO";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "CADESTACOES";': 'SQL_NAO_RECONHECIDO',
    'DROP INDEX "CADCATEGORIA_cliente_id_empresa_id_idx";': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) assert.deepEqual(codigos(classificarContractG(`${SQL_G}\n${ddl}\n`)), [codigo], ddl);
  // As instruções pinadas só existem como texto pinado: no caminho EXPAND (outra migration qualquer) são recusadas.
  for (const [a, codigo] of [[ALTER_G[1], 'SQL_NAO_RECONHECIDO'], [ALTER_G[2], 'ALTER_EM_TABELA_ANTIGA'], [ALTER_G[3], 'UNIQUE_EM_TABELA_ANTIGA'], [ALTER_G[4], 'ALTER_EM_TABELA_ANTIGA']]) {
    assert.deepEqual(codigos(classificar(`${a};\n`)), [codigo], a);
  }
  // Controle positivo: sem o índice, ou com tabela nova e índice dela depois do recorte, é o EXPAND de sempre.
  const semIndice = classificarContractG(trocar(SQL_G, INDICE_G, ''));
  assert.deepEqual(semIndice.violacoes, []);
  const comNova = classificarContractG(`${SQL_G}\n${BASE}CREATE INDEX "Nova_cliente_id_idx" ON "Nova"("cliente_id");\n`);
  assert.deepEqual(comNova.violacoes, []);
  assert.deepEqual(comNova.tabelas_novas, ['Nova']);
  assert.deepEqual(comNova.contract, [CONTRACT_G]);
});

test('B18e (D-PROD-195): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada (aceitar duas CURVA PADRÃO, outro nome, sem trava, trava fraca, coluna já existente) → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE; citando outra tabela → DO_EM_TABELA_ANTIGA', () => {
  const alteradas = {
    aceitaDuas: trocar(SQL_G, 'IF sem_padrao <> 0 OR com_duas <> 0 THEN', 'IF sem_padrao <> 0 THEN'),
    aceitaSemPadrao: trocar(SQL_G, 'IF sem_padrao <> 0 OR com_duas <> 0 THEN', 'IF com_duas <> 0 THEN'),
    outroNome: trocar(SQL_G, "k.nome = 'CURVA PADRÃO') AS padroes", "k.nome ILIKE 'curva%') AS padroes"),
    colunaJaExistente: trocar(SQL_G, 'IF n_coluna <> 0 THEN', 'IF n_coluna > 1 THEN'),
    semAdvisory: trocar(SQL_G, '  PERFORM pg_advisory_xact_lock(72707369);\n', ''),
    travaFraca: trocar(SQL_G, 'LOCK TABLE public."CADCURVAGANHO" IN SHARE MODE;', 'LOCK TABLE public."CADCURVAGANHO" IN ACCESS SHARE MODE;'),
    semTravaCategoria: trocar(SQL_G, '  LOCK TABLE public."CADCATEGORIA" IN ACCESS EXCLUSIVE MODE;\n', ''),
    semTimeout: trocar(SQL_G, "PERFORM set_config('statement_timeout', '120s', true);", "PERFORM set_config('statement_timeout', '0', true);"),
  };
  for (const [caso, sql] of Object.entries(alteradas)) {
    assert.notEqual(sql, SQL_G, caso);
    assert.deepEqual(codigos(classificarContractG(sql)), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], caso);
  }
  const inicio = SQL_G.indexOf('-- 1. Guarda');
  const fim = SQL_G.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_G.slice(0, inicio) + SQL_G.slice(fim);
  assert.ok(!semGuarda.includes('sem_padrao'));
  assert.deepEqual(codigos(classificarContractG(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  const antes = classificarContractG(`CREATE INDEX "x_idx" ON "CADCATEGORIA"("id");\n${SQL_G}`);
  assert.deepEqual(codigos(antes), ['CONTRACT_GUARDA_AUSENTE']);
  // Guarda (com hash repinado num contrato sintético) que cita outra tabela: os literais só deixam CADCATEGORIA e CADCURVAGANHO.
  const outra = trocar(SQL_G, `curvas := to_regclass('public."CADCURVAGANHO"');`, `curvas := to_regclass('public."Lote"');`);
  const corpo = outra.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  const repinado = { [NOME_G]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_G], guarda_sha256: sha256(corpo) } };
  const c = classificarContractG(outra, { contratos: repinado });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Lote'));
  // E sem CADCURVAGANHO nos literais, a própria guarda do arquivo cita tabela antiga.
  const semLiteral = { [NOME_G]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_G], literais_guarda: ['CADCATEGORIA'] } };
  const s = classificarMigrations([ler(NOME_G)], { contratos: semLiteral });
  assert.deepEqual(codigos(s), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(s.violacoes.every((v) => v.detalhe === 'CADCURVAGANHO'));
});

test('B18f (D-PROD-195): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada (ou só com as quatro anteriores) o nome real é recusado; os contratos não se servem entre si', () => {
  const outro = '20261114200001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_G }], { manifesto: { [outro]: sha256(SQL_G) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(codigos(c), ['ALTER_EM_TABELA_ANTIGA', 'DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO', 'SQL_NAO_RECONHECIDO', 'UNIQUE_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.some((x) => x.codigo === 'SQL_NAO_RECONHECIDO' && x.detalhe.startsWith('UPDATE "CADCATEGORIA"')), 'o UPDATE é recusado');
  assert.equal(c.violacoes.filter((x) => x.codigo === 'ALTER_EM_TABELA_ANTIGA').length, 2, 'SET NOT NULL e a FK');
  // Contrato vazio, ou só as entradas anteriores: nada é aprovado por fora da lista fechada.
  assert.equal(classificarMigrations([ler(NOME_G)], { contratos: {} }).ok, false);
  const antigos = Object.fromEntries([NOME_C, NOME_T, NOME_D, NOME_K].map((n) => [n, MIGRATIONS_CONTRACT_APROVADAS[n]]));
  assert.equal(classificarMigrations([ler(NOME_G)], { contratos: antigos }).ok, false);
  // O contrato de um nome não serve ao SQL do outro.
  assert.deepEqual(codigos(classificarContract(SQL_G)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractT(SQL_G)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractD(SQL_G)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractK(SQL_G)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  for (const sql of [SQL_C, SQL_T, SQL_D, SQL_K]) assert.ok(codigos(classificarContractG(sql)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
});

test('B18g (D-PROD-195): conferirReleaseContract — a D-PROD-195 sozinha só com --contract D-PROD-195 exato; junto com outra migration ou com outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-195 sem CONTRACT é inesperado', () => {
  const comG = classificarMigrations([ler(NOME_G)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_G], classificacao: comG, autorizacao: 'D-PROD-195' }), { ok: true, codigo: null });
  // As decisões das releases seguintes (D-PROD-197, padrões do TipoAtividade, e D-PROD-200, Atividade cabeçalho) também não autorizam esta.
  for (const autorizacao of ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-189', 'D-PROD-194', 'D-PROD-197', 'D-PROD-200', '', undefined, null, 'd-prod-195', ' D-PROD-195', 'D-PROD-195 ', 'D-PROD-19']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_G], classificacao: comG, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  // Junto com a criação da curva (D-PROD-189) ou com uma EXPAND qualquer: não isolada.
  const CURVA = '20261113600000_cadcurvaganho_cadastro';
  for (const outra of [CURVA, '20261113800000_apontamento_atividade_item']) {
    const comOutra = classificarMigrations([ler(outra), ler(NOME_G)]);
    assert.deepEqual(comOutra.violacoes, []);
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [outra, NOME_G], classificacao: comOutra, autorizacao: 'D-PROD-195' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, outra);
  }
  // Com outra CONTRACT (inclusive a curva mensal, D-PROD-194, a de que esta depende, e a D-PROD-197, a seguinte) ou
  // várias: nenhuma autorização isola.
  for (const lote of [[NOME_K, NOME_G], [NOME_D, NOME_G], [NOME_C, NOME_G], [NOME_G, NOME_P], [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G]]) {
    const c = classificarMigrations(lote.map(ler));
    assert.deepEqual(c.violacoes, []);
    assert.equal(c.contract.length, lote.length);
    for (const autorizacao of ['D-PROD-162', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', undefined]) {
      assert.deepEqual(conferirReleaseContract({ nomesNovas: lote, classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, `${lote.length} CONTRACT, ${autorizacao}`);
    }
  }
  const semG = classificarMigrations([ler(CURVA)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [CURVA], classificacao: semG, autorizacao: 'D-PROD-195' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B18h (D-PROD-195): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-195 só com a D-PROD-195 sozinha e --contract D-PROD-195; outra decisão ou outra CONTRACT junto não autorizam', () => {
  const comG = classificarMigrations([ler(NOME_G)]);
  const comK = classificarMigrations([ler(NOME_K), ler(NOME_G)]);
  const cinco = classificarMigrations([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G].map(ler));
  // Positivo com base 'herdado': prova que a função GRAVA a decisão (não só deixa passar o valor herdado).
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comG, autorizacao: 'D-PROD-195' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-195');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
  // Negativos com base JÁ igual à decisão: prova que ela nunca é herdada.
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-195' };
  for (const [classificacao, autorizacao] of [[comG, 'D-PROD-194'], [comG, 'D-PROD-187'], [comG, undefined], [comG, 'd-prod-195'], [comK, 'D-PROD-195'], [comK, 'D-PROD-194'], [cinco, 'D-PROD-195']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B18i (D-PROD-195): contractsPendentes com as cinco CONTRACT locais da release da D-PROD-195 — produção no dia dela (as quatro anteriores concluídas) deixa só a D-PROD-195 pendente; histórico vazio, as cinco; aberta ou revertida continua pendente; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  // As pastas da release da D-PROD-195 (a D-PROD-197 veio depois; ver B19i).
  const locais = [NOME_C, '20261113100000_tipo_atividade_cadastro', NOME_T, NOME_D, '20261113600000_cadcurvaganho_cadastro', NOME_K, NOME_G];
  const PEND_G = { nome: NOME_G, decisao: 'D-PROD-195' };
  const antigas = [linha(NOME_C), linha(NOME_T), linha(NOME_D), linha(NOME_K)];
  assert.deepEqual(contractsPendentes({ locais, linhas: antigas }), [PEND_G], 'produção no dia da D-PROD-195: as quatro anteriores concluídas');
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195']);
  assert.deepEqual(contractsPendentes({ locais, linhas: antigas.slice(0, 3) }), [{ nome: NOME_K, decisao: 'D-PROD-194' }, PEND_G], 'antes da curva mensal: as duas últimas pendentes');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...antigas, linha(NOME_G)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...antigas, linha(NOME_G, { finished_at: null })] }), [PEND_G], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...antigas, linha(NOME_G, { rolled_back_at: new Date() })] }), [PEND_G], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_G), linhas: antigas }), [], 'sem a pasta local não há o que aplicar');
});

test('B18j (D-PROD-195): runner real sobre a release da curva na categoria — análise local declara a coluna e a FK composta ADICIONADAS (nada alargado); verificar/aplicar exigem --contract D-PROD-195 exato ANTES de conectar (as decisões anteriores e a seguinte não servem); nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_G);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    // O rótulo resume o descritor: a coluna e a FK composta são ADICIONADAS (a FK não existia; nenhum DROP CONSTRAINT do
    // mesmo nome vem antes dela). Nada aqui alarga constraint existente, remove ou renomeia: o rótulo não pode dizer
    // isso. Singular ou plural é do runner.
    const rotulo = analise.stdout.split('\n').find((l) => l.includes('ANÁLISE LOCAL OK'));
    assert.match(rotulo, new RegExp(`^premerge-migrate: ANÁLISE LOCAL OK \\(CONTRACT D-PROD-195: 1 colunas? adicionadas? \\(CADCATEGORIA\\.curva_ganho_id\\), 1 constraints? adicionadas? \\(CADCATEGORIA\\.${FK_G}\\)\\) — alvo remoto NÃO verificado`), rotulo);
    assert.doesNotMatch(rotulo, /alargad|removid|renomead|CHECK/, rotulo);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    // Isolada: as quatro anteriores (em produção já concluídas) e a D-PROD-197 e a D-PROD-200 (posteriores) estão na main
    // desta release sintética, então a única nova é a D-PROD-195.
    assert.deepEqual(json.migrations_novas, [NOME_G]);
    assert.deepEqual(json.contract, [CONTRACT_G]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-195').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-195');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-194'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-187'),
      run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-162'), run(COM_ALVO, '--aplicar', '--contract', 'd-prod-195'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-183'), run(COM_ALVO, '--verificar-alvo', '--contract'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-197'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-200'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-195');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-195');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B18k (D-PROD-195/D-PROD-194): ordem de produção no dia da D-PROD-195 — alvo com as 49 da main concluídas (por último a curva mensal, D-PROD-194): o histórico confere, a única pendente é a D-PROD-195 e a barreira do CONTRACT a exige; depois dela, 50 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const ESTACAO = '20261113600000_cadcurvaganho_cadastro';
  const APONTAMENTO = '20261113700000_apontamento_atividade';
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const ITENS = '20261113800000_apontamento_atividade_item';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // Produção no dia desta CONTRACT: a curva na categoria era a pasta de nome mais recente. Os padrões do TipoAtividade
  // (D-PROD-197, `20261114300000_tipo_atividade_defaults`, ver B19k), o peso objetivo (D-PROD-198,
  // `20261114400000_cadcategoria_peso_objetivo`, ver B20k), a Atividade cabeçalho (D-PROD-200,
  // `20261114500000_atividade_cabecalho`, ver B21m), as linhas de produto e de máquina (D-PROD-202,
  // `20261114600000_atividade_linhas_produto_maquina`, ver B22k) as Formulações (D-PROD-203, ver B23k) e a mão de obra e o serviço (D-PROD-207, ver B26k) vieram
  // depois dela: 50 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_G);
  assert.equal(locais.length, 50);
  for (const n of [NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_G), 'na época, a curva na categoria era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 49 da main, na ordem em que foram concluídas — como em B16k, e por último a curva mensal (D-PROD-194,
  // 13:29 UTC de 2026-11-14).
  const fora = [NOME_G, NOME_K, NOME_D, P1_03, ITENS];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, ITENS, NOME_K].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 49);
  assert.deepEqual(linhas.slice(-6).map((l) => l.migration_name), [ESTACAO, APONTAMENTO, NOME_D, P1_03, ITENS, NOME_K]);
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_G], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_G, decisao: 'D-PROD-195' }]);
  // Depois da aplicação (a D-PROD-195 concluída por último): 50, nada pendente, nada a autorizar.
  const depois = [...linhas, { migration_name: NOME_G, checksum: MIGRATIONS_APROVADAS[NOME_G], finished_at: new Date(t0 + 99_000), rolled_back_at: null }];
  assert.equal(depois.length, 50);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B20a (D-PROD-198): o peso objetivo classificado SOZINHO, como na release: ok, EXPAND puro, só a coluna anulável CADCATEGORIA.peso_objetivo_kg, nenhum CONTRACT', () => {
  const c = classificarMigrations([ler(NOME_PO)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, ['CADCATEGORIA.peso_objetivo_kg']);
  assert.deepEqual(c.contract, []);
  assert.equal(MIGRATIONS_APROVADAS[NOME_PO], sha256(readFileSync(`backend/prisma/migrations/${NOME_PO}/migration.sql`, 'utf8')));
  assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME_PO), false, 'EXPAND: sem entrada CONTRACT');
});

test('B20b (D-PROD-198): o mesmo ADD COLUMN com NOT NULL ou DEFAULT volátil, ou num ALTER COLUMN, é recusado (a allowlist EXPAND não afrouxou)', () => {
  for (const ruim of [
    'ALTER TABLE "CADCATEGORIA" ADD COLUMN "peso_objetivo_kg" DECIMAL(10,2) NOT NULL',
    'ALTER TABLE "CADCATEGORIA" ADD COLUMN "peso_objetivo_kg" DECIMAL(10,2) DEFAULT random()',
    'ALTER TABLE "CADCATEGORIA" ALTER COLUMN "peso_objetivo_kg" SET NOT NULL',
  ]) {
    const c = classificarMigrations([{ nome: NOME_PO, sql: `${ruim};\n` }]);
    assert.equal(c.ok, false, ruim);
    // Recusa ESTRUTURAL, além do checksum divergente: a conferência estrutural roda sempre.
    assert.ok(c.violacoes.some((v) => v.codigo === 'ALTER_EM_TABELA_ANTIGA'), `${ruim} → ${JSON.stringify(c.violacoes)}`);
  }
  // O SQL aprovado, com o mesmo texto da estrutura e sem o cabeçalho, só diverge no checksum.
  const so = classificarMigrations([{ nome: NOME_PO, sql: 'ALTER TABLE "CADCATEGORIA" ADD COLUMN "peso_objetivo_kg" DECIMAL(10,2);\n' }]);
  assert.deepEqual(so.violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B20k (D-PROD-198): ordem de produção no dia da D-PROD-198 — alvo com as 51 da main concluídas (por último os padrões do TipoAtividade, D-PROD-197): o histórico confere, a única pendente é o peso objetivo, nenhum CONTRACT a autorizar; depois dela, 52 e nada pendente', () => {
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-198 o peso objetivo era a pasta de nome mais recente; a Atividade cabeçalho (D-PROD-200,
  // `20261114500000_atividade_cabecalho`, ver B21m), as linhas de produto e de máquina (D-PROD-202,
  // `20261114600000_atividade_linhas_produto_maquina`, ver B22k) as Formulações (D-PROD-203, ver B23k) e a mão de obra e o serviço (D-PROD-207, ver B26k) vieram depois
  // dela, em releases seguintes: 52 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_PO);
  assert.equal(locais.length, 52);
  for (const n of [NOME_V, NOME_L, NOME_F, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_PO), 'na época, o peso objetivo era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const linhas = locais.filter((l) => l.nome !== NOME_PO)
    .map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 51);
  assert.ok(linhas.some((l) => l.migration_name === NOME_P), 'os padrões do TipoAtividade (D-PROD-197) já estão concluídos');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_PO], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), []);
  const depois = [...linhas, { migration_name: NOME_PO, checksum: MIGRATIONS_APROVADAS[NOME_PO], finished_at: new Date(t0 + 99_000), rolled_back_at: null }];
  assert.equal(depois.length, 52);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
});

/** D-PROD-193 (Fatia D) — itens do apontamento: EXPAND puro, só as 2 tabelas novas (ApontamentoAtividade agora é ANTIGA). */
const NOME_I = '20261113800000_apontamento_atividade_item';
const NOVAS_I = ['ApontamentoAtividadeItem', 'ApontamentoAtividadeItemConsumoLote'];
const DO_I = '7aaa176ccec3645fe0730b5aaedee8882b1a276e3912f3360c8d0d2c1b67f710';

test('B17a (D-PROD-193): itens do apontamento classificados SOZINHOS, como na release (a D-PROD-190 já está em produção): EXPAND puro, só as 2 tabelas novas, nenhuma coluna nem constraint em tabela antiga, DO de RLS pinado citando só as tabelas novas; --contract é inesperado', () => {
  const m = ler(NOME_I);
  const c = classificarMigrations([m]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(c.tabelas_novas, NOVAS_I);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  // Junto com a Fatia C (um banco que ainda não tem nenhuma das duas) continua EXPAND, sem violação.
  const cd = classificarMigrations([ler(NOME_A), m]);
  assert.deepEqual(cd.violacoes, []);
  assert.equal(cd.modo, 'EXPAND');
  assert.deepEqual(cd.tabelas_novas, ['ApontamentoAtividade', ...NOVAS_I]);
  // Release EXPAND: sem --contract passa; qualquer --contract (inclusive o número desta decisão) é inesperado.
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_I], classificacao: c, autorizacao: undefined }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-193', 'D-PROD-190', 'D-PROD-183', '']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_I], classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_INESPERADO' }, autorizacao);
  }
  assert.equal(envDoDeployMigrate({ env: { PATH: '/bin' }, classificacao: c, autorizacao: 'D-PROD-193' }).MIGRATION_CONTRACT_AUTORIZADO, undefined);
  // ApontamentoAtividade é ANTIGA nesta release: o total de custo, a chave de idempotência e qualquer CHECK/UNIQUE
  // novo ficariam nela fora do EXPAND (recusado). Por isso tudo o que é novo mora nas 2 tabelas novas.
  const casos = {
    'CREATE UNIQUE INDEX "ApontamentoAtividade_cliente_id_operation_id_key" ON "ApontamentoAtividade"("cliente_id", "operation_id");': 'UNIQUE_EM_TABELA_ANTIGA',
    'ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_status_check" CHECK ("status" IN (\'CONFIRMADO\', \'CANCELADO\'));': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "ApontamentoAtividade" ADD COLUMN "custo_itens_total" DECIMAL(18,4) NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_origem_check" CHECK ("origem_sistema" IS NOT NULL);': 'ALTER_EM_TABELA_ANTIGA',
    'DELETE FROM "ApontamentoAtividade";': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const r = classificar(`${m.sql}\n${ddl}\n`);
    assert.equal(r.expand, false, ddl);
    assert.deepEqual(r.violacoes.map((v) => v.codigo), [codigo], ddl);
  }
  // Nas tabelas novas, um CHECK a mais continua aceito (endurecer o domínio depois exige novo pin).
  assert.deepEqual(classificar(`${m.sql}\nALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_ordem_check" CHECK ("ordem" <= 200);\n`).violacoes, []);
  // O bloco DO pinado não pode citar tabela antiga: incluir 'ApontamentoAtividade' na lista muda o hash e cita tabela antiga.
  const doComAntiga = trocar(m.sql, "ARRAY['ApontamentoAtividadeItem','ApontamentoAtividadeItemConsumoLote']", "ARRAY['ApontamentoAtividade','ApontamentoAtividadeItem','ApontamentoAtividadeItemConsumoLote']");
  assert.deepEqual(codigos(classificar(doComAntiga)), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // 1 byte a mais no arquivo pinado → checksum divergente; sem a entrada no manifesto → não aprovada.
  assert.deepEqual(classificarMigrations([{ ...m, sql: `${m.sql}\n` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
  const semEntrada = Object.fromEntries(Object.entries(MIGRATIONS_APROVADAS).filter(([n]) => n !== NOME_I));
  assert.deepEqual(classificarMigrations([m], { manifesto: semEntrada }).violacoes.map((v) => v.codigo), ['MIGRATION_NAO_APROVADA']);
  // Sem o hash do DO na allowlist, o mesmo arquivo é recusado (o pin do DO é desta decisão, não herdado da Fatia C).
  const semDo = DO_RLS_APROVADOS.filter((h) => h !== DO_I);
  assert.equal(semDo.length, DO_RLS_APROVADOS.length - 1);
  assert.deepEqual(codigos(classificarMigrations([m], { doAprovados: semDo })), ['DO_NAO_RECONHECIDO']);
  // Nenhum ponto e vírgula dentro de CHECK (o classificador corta por ';'): 7 CHECKs, cada um inteiro numa instrução própria.
  const comCheck = m.sql.replace(/--[^\n]*/g, '').split(';').filter((st) => / ADD CONSTRAINT "[^"]+" CHECK \(/.test(st));
  assert.equal(comCheck.length, 7);
  for (const st of comCheck) assert.match(st.trim(), /^ALTER TABLE "ApontamentoAtividadeItem(ConsumoLote)?" ADD CONSTRAINT "[A-Za-z_]+_check" CHECK \(.*\)$/s);
});

test('B17b (D-PROD-193): runner real sobre a release dos itens do apontamento — análise local EXPAND sem rótulo CONTRACT; --contract é CONTRACT_INESPERADO; verificar o alvo não pede --contract e segue para a conexão; nunca imprime URL', () => {
  // main = pasta sem NOME_I (já com a Fatia C), HEAD = main + NOME_I.
  const repo = repoDaReleaseContract(NOME_I);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    assert.ok(analise.stdout.includes('premerge-migrate: ANÁLISE LOCAL OK — alvo remoto NÃO verificado'), analise.stdout);
    assert.doesNotMatch(analise.stdout, /CONTRACT D-PROD/);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'EXPAND');
    assert.equal(json.expand, true);
    assert.deepEqual(json.migrations_novas, [NOME_I]);
    assert.deepEqual(json.contract, []);
    assert.deepEqual(json.tabelas_novas, NOVAS_I);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    for (const r of [run(SEM_ALVO, '--contract', 'D-PROD-193'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-190')]) {
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, /RECUSADO CONTRACT_INESPERADO/);
      semSegredo(r);
    }
    const semConfig = run(SEM_ALVO, '--aplicar');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    // Sem CONTRACT a barreira de autorização não existe: o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const verificar = run(COM_ALVO, '--verificar-alvo');
    assert.equal(verificar.status, 3);
    assert.doesNotMatch(verificar.stderr, /CONTRACT_/);
    assert.match(verificar.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(verificar);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B19a (D-PROD-197): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, nenhuma tabela nova nem removida, nenhuma coluna no caminho EXPAND e o descritor com as 13 colunas e as 5 constraints ADICIONADAS (nenhuma alargada)', () => {
  const c = classificarMigrations([ler(NOME_P)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, [], 'as 13 colunas são do recorte CONTRACT, não do caminho EXPAND');
  assert.deepEqual(c.contract, [CONTRACT_P]);
  assert.equal(CONTRACT_P.colunas_adicionadas.length, 13);
  assert.equal(CONTRACT_P.constraints_adicionadas.length, 5);
  // O arquivo é o auditado, byte a byte.
  assert.equal(sha256(SQL_P), 'b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf');
  assert.equal(MIGRATIONS_APROVADAS[NOME_P], sha256(SQL_P));
});

test('B19b (D-PROD-197): a entrada de MIGRATIONS_CONTRACT_APROVADAS é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP, os 4 literais e as 18 instruções exatas (13 ADD COLUMN, 3 FKs, 2 CHECKs, nesta ordem); o resto são só os 3 CREATE INDEX', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_P];
  assert.ok(NOME_P in MIGRATIONS_APROVADAS, 'quem é CONTRACT também está no manifesto (checksum pinado)');
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-197');
  assert.equal(k.guarda_sha256, 'e15780190baf9494f20535c2e3ced21eb20ea6b8f362eeac0b2477dcf6dab3b0');
  assert.deepEqual(k.drop, []);
  assert.deepEqual(k.literais_guarda, ['TipoAtividade', 'CentroCusto', 'CentroResultado', 'UnidadeMedida']);
  assert.equal(k.alter_antigas.length, 18);
  assert.deepEqual(k.alter_antigas, ALTER_P);
  assert.ok(k.alter_antigas.slice(0, 13).every((a) => a.startsWith('ALTER TABLE "TipoAtividade" ADD COLUMN "')));
  assert.ok(k.alter_antigas.slice(13, 16).every((a) => / FOREIGN KEY \("cliente_id", "[a-z_]+"\) REFERENCES "[A-Za-z]+"\("cliente_id", "id"\) ON DELETE RESTRICT ON UPDATE CASCADE$/.test(a)));
  assert.ok(k.alter_antigas.slice(16).every((a) => / CHECK \(/.test(a)));
  assert.ok(k.alter_antigas.every((a) => !a.includes(';') && a === a.replace(/\s+/g, ' ').trim()), 'texto normalizado, sem o ";"');
  // O hash pinado é o do corpo da guarda do arquivo (sem comentários, espaços normalizados) e cada texto pinado está nele uma vez.
  const semComent = SQL_P.replace(/--[^\n]*/g, '');
  const corpos = [...semComent.matchAll(/DO\s+\$\$([\s\S]*?)\$\$\s*;/g)].map((x) => x[1]);
  assert.equal(corpos.length, 1, 'um único DO: a guarda (a migration não mexe em RLS)');
  assert.equal(sha256(corpos[0].replace(/\s+/g, ' ').trim()), k.guarda_sha256);
  for (const a of k.alter_antigas) assert.equal(SQL_P.split(`${a};`).length, 2, a);
  // O resto: exatamente os 3 CREATE INDEX não-únicos, um por FK, começando por cliente_id (R10).
  const ultima = `${ALTER_P.at(-1)};`;
  const resto = semComent.slice(semComent.indexOf(ultima) + ultima.length).split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(resto, INDICES_P);
  // A guarda só cita TipoAtividade e os 3 alvos das FKs (os literais pinados).
  const citadas = [...new Set([...corpos[0].matchAll(/'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g)].map((x) => x[1] ?? x[2]))].sort();
  assert.deepEqual(citadas, [...k.literais_guarda].sort());
  // O número da decisão fica fora do migration.sql (renumerar nunca muda o checksum aplicado) e nada além do que a
  // decisão descreve: nenhum DROP, DML, UNIQUE, ALTER COLUMN, NOT VALID, SET NULL nem exclusão em cascata.
  assert.doesNotMatch(SQL_P, /D-PROD-197/);
  assert.doesNotMatch(semComent, /\bDROP\b|DELETE FROM|\bUPDATE "|\bINSERT\b|\bTRUNCATE\b|CREATE UNIQUE|ALTER COLUMN|NOT VALID|SET NULL|ON DELETE CASCADE/);
});

test('B19c (D-PROD-197): as 18 instruções são EXATAMENTE as do contrato, na ordem — outro tipo, NOT NULL a mais ou a menos, DEFAULT trocado, nome aposentado no lugar da flag, IF NOT EXISTS, SET NULL, outro alvo, NOT VALID, CHECK alargado ou afrouxado, troca de ordem, uma faltando, uma a mais na sequência, duas numa só ou outra tabela → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const s = ALTER_P.map((a) => `${a};`);
  const casos = {
    tipo: [trocar(SQL_P, s[0], s[0].replace('VARCHAR(24)', 'VARCHAR(25)')), 0],
    notNullAMais: [trocar(SQL_P, s[1], s[1].replace('VARCHAR(64);', 'VARCHAR(64) NOT NULL;')), 1],
    decimal: [trocar(SQL_P, s[4], s[4].replace('DECIMAL(14,4)', 'DECIMAL(18,4)')), 4],
    defaultTrue: [trocar(SQL_P, s[5], s[5].replace('DEFAULT false', 'DEFAULT true')), 5],
    semNotNull: [trocar(SQL_P, s[7], s[7].replace(' NOT NULL', '')), 7],
    nomeAposentado: [trocar(SQL_P, s[9], s[9].replace('"permite_produto"', '"pode_ter_produto"')), 9],
    ifNotExists: [trocar(SQL_P, s[12], s[12].replace('ADD COLUMN', 'ADD COLUMN IF NOT EXISTS')), 12],
    setNull: [trocar(SQL_P, s[13], s[13].replace('ON DELETE RESTRICT', 'ON DELETE SET NULL')), 13],
    outroAlvo: [trocar(SQL_P, s[14], s[14].replace('REFERENCES "CentroResultado"', 'REFERENCES "CentroCusto"')), 14],
    notValid: [trocar(SQL_P, s[15], s[15].replace(' ON UPDATE CASCADE;', ' ON UPDATE CASCADE NOT VALID;')), 15],
    checkAlargado: [trocar(SQL_P, s[16], s[16].replace("'OUTROS'))", "'OUTROS', 'XYZ'))")), 16],
    coeficienteZero: [trocar(SQL_P, s[17], s[17].replace('> 0)', '>= 0)')), 17],
    ordem: [trocar(SQL_P, `${s[6]}\n${s[7]}`, `${s[7]}\n${s[6]}`), 6],
    faltando: [trocar(SQL_P, `${s[8]}\n`, ''), 8],
    aMaisNaSequencia: [trocar(SQL_P, `${s[12]}\n`, `${s[12]}\nALTER TABLE "TipoAtividade" ALTER COLUMN "exige_area" DROP DEFAULT;\n`), 13],
    numaSo: [trocar(SQL_P, `${s[10]}\n${s[11]}`, 'ALTER TABLE "TipoAtividade" ADD COLUMN "permite_servico" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "permite_mao_obra" BOOLEAN NOT NULL DEFAULT false;'), 10],
    outraTabela: [trocar(SQL_P, s[3], s[3].replace('"TipoAtividade"', '"TipoTarefa"')), 3],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_P, caso);
    const c = classificarContractP(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: esperado ALTER TABLE "TipoAtividade" `), `${caso}: ${c.violacoes[0].detalhe}`);
  }
});

test('B19d (D-PROD-197): o que vem depois das 18 cai no caminho EXPAND do resto — UNIQUE em TipoAtividade (a mais ou no lugar de um dos 3 índices), ALTER COLUMN, flag nova NOT NULL DEFAULT, FK ou CHECK a mais, DROP CONSTRAINT, DO, DML e DROP recusados; índice não-único e tabela nova aceitos como sempre', () => {
  const casos = {
    'CREATE UNIQUE INDEX "TipoAtividade_cliente_id_categoria_nome_tipo_key" ON "TipoAtividade"("cliente_id", "categoria", "nome_tipo");': 'UNIQUE_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoAtividade" ALTER COLUMN "exige_area" DROP DEFAULT;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoAtividade" ALTER COLUMN "categoria" SET NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoAtividade" ADD COLUMN "permite_maquina" BOOLEAN NOT NULL DEFAULT false;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("cliente_id", "centro_custo_padrao_id") REFERENCES "CentroCusto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "x_check" CHECK ("coeficiente_padrao" < 1000);': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoAtividade" DROP CONSTRAINT "TipoAtividade_categoria_check";': 'ALTER_EM_TABELA_ANTIGA',
    'UPDATE "TipoAtividade" SET "exige_area" = true;': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "TipoAtividade";': 'SQL_NAO_RECONHECIDO',
    'DROP INDEX "TipoAtividade_cliente_id_ativo_idx";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "TipoAtividade";': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) assert.deepEqual(codigos(classificarContractP(`${SQL_P}\n${ddl}\n`)), [codigo], ddl);
  // Um dos 3 índices do resto trocado por UNIQUE: recusado como em qualquer tabela antiga.
  const unico = classificarContractP(trocar(SQL_P, `${INDICES_P[0]};`, `${INDICES_P[0].replace('CREATE INDEX', 'CREATE UNIQUE INDEX')};`));
  assert.deepEqual(codigos(unico), ['UNIQUE_EM_TABELA_ANTIGA']);
  // Um segundo DO no resto (não é a guarda): hash desconhecido e cita tabela antiga.
  const outroDo = classificarContractP(`${SQL_P}\nDO $$ BEGIN PERFORM 1 FROM public."TipoAtividade"; END $$;\n`);
  assert.deepEqual(codigos(outroDo), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // Controle positivo: mais um índice não-único em TipoAtividade, ou tabela nova com índice, depois do recorte, são o
  // EXPAND de sempre (o checksum pinado é que prende o arquivo real).
  const ok = classificarContractP(`${SQL_P}\nCREATE INDEX "TipoAtividade_cliente_id_categoria_idx" ON "TipoAtividade"("cliente_id", "categoria");\n${BASE}CREATE INDEX "Nova_cliente_id_idx" ON "Nova"("cliente_id");\n`);
  assert.deepEqual(ok.violacoes, []);
  assert.deepEqual(ok.tabelas_novas, ['Nova']);
  assert.deepEqual(ok.contract, [CONTRACT_P]);
});

test('B19e (D-PROD-197): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada (tempo, trava, coluna, constraint, alvo, índice único) → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE; citando outra tabela → DO_EM_TABELA_ANTIGA', () => {
  for (const [de, para] of [
    ["PERFORM set_config('lock_timeout', '5s', true);", "PERFORM set_config('lock_timeout', '60s', true);"],
    ['PERFORM pg_advisory_xact_lock(72707369);', 'PERFORM pg_advisory_xact_lock(1);'],
    ['LOCK TABLE public."TipoAtividade" IN ACCESS EXCLUSIVE MODE;', 'LOCK TABLE public."TipoAtividade" IN SHARE MODE;'],
    ["'permite_mao_obra','exige_producao'];", "'permite_mao_obra'];"],
    ["'TipoAtividade_coeficiente_padrao_check'];", "'TipoAtividade_categoria_check'];"],
    ["ARRAY['CentroCusto','CentroResultado','UnidadeMedida'];", "ARRAY['CentroCusto','CentroResultado'];"],
    ['WHERE i.indrelid = alvo_oid AND i.indisunique AND', 'WHERE i.indrelid = alvo_oid AND'],
    ["= ARRAY['cliente_id','id']", "= ARRAY['id']"],
  ]) {
    assert.deepEqual(codigos(classificarContractP(trocar(SQL_P, de, para))), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], de);
  }
  const inicio = SQL_P.indexOf('-- 1. Guarda');
  const fim = SQL_P.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_P.slice(0, inicio) + SQL_P.slice(fim);
  assert.ok(!semGuarda.includes('constraints_novas constant'));
  assert.deepEqual(codigos(classificarContractP(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  const antes = classificarContractP(`CREATE INDEX "x_idx" ON "TipoAtividade"("id");\n${SQL_P}`);
  assert.deepEqual(codigos(antes), ['CONTRACT_GUARDA_AUSENTE']);
  // Guarda (com hash repinado num contrato sintético) que cita outra tabela: os literais só deixam TipoAtividade e os 3 alvos.
  for (const [de, para, tabela] of [
    ["ARRAY['CentroCusto','CentroResultado','UnidadeMedida'];", "ARRAY['CentroCusto','CentroResultado','UnidadeMedida','Produto'];", 'Produto'],
    [`tabela := to_regclass('public."TipoAtividade"');`, `tabela := to_regclass('public."TipoTarefa"');`, 'TipoTarefa'],
  ]) {
    const outra = trocar(SQL_P, de, para);
    const corpo = outra.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
    const contratos = { [NOME_P]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_P], guarda_sha256: sha256(corpo) } };
    const c = classificarContractP(outra, { contratos });
    assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA'], tabela);
    assert.ok(c.violacoes.every((v) => v.detalhe === tabela), JSON.stringify(c.violacoes));
  }
});

test('B19f (D-PROD-197): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado (as 8 flags, as 3 FKs para tabela antiga e os 2 CHECKs); sem a entrada, ou só com as cinco CONTRACT anteriores, o nome real é recusado; os contratos não se servem entre si', () => {
  const outro = '20261114300001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_P }], { manifesto: { [outro]: sha256(SQL_P) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(codigos(c), ['ALTER_EM_TABELA_ANTIGA', 'DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  assert.equal(c.violacoes.filter((x) => x.codigo === 'ALTER_EM_TABELA_ANTIGA').length, 13, 'as 8 flags NOT NULL DEFAULT, as 3 FKs para tabela antiga e os 2 CHECKs');
  // As 5 colunas anuláveis sem DEFAULT são o EXPAND de sempre; o que faz a migration ser CONTRACT é o resto.
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, ANULAVEIS_P.map(([col]) => `TipoAtividade.${col}`).sort());
  assert.equal(classificarMigrations([ler(NOME_P)], { contratos: {} }).ok, false);
  const anteriores = Object.fromEntries([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G].map((n) => [n, MIGRATIONS_CONTRACT_APROVADAS[n]]));
  assert.equal(classificarMigrations([ler(NOME_P)], { contratos: anteriores }).ok, false);
  // O contrato de um nome não serve ao SQL do outro, nos dois sentidos.
  assert.deepEqual(codigos(classificarContract(SQL_P)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractT(SQL_P)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractD(SQL_P)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractK(SQL_P)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractG(SQL_P)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  for (const sql of [SQL_C, SQL_T, SQL_D, SQL_K, SQL_G]) assert.ok(codigos(classificarContractP(sql)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
});

test('B19g (D-PROD-197): conferirReleaseContract — a D-PROD-197 sozinha só com --contract D-PROD-197 exato; junto com outra migration ou com outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-197 sem CONTRACT é inesperado', () => {
  const comP = classificarMigrations([ler(NOME_P)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_P], classificacao: comP, autorizacao: 'D-PROD-197' }), { ok: true, codigo: null });
  // A D-PROD-182 (criação da tabela), as CONTRACT anteriores (inclusive a D-PROD-195, a curva na categoria) e a seguinte
  // (D-PROD-200, Atividade cabeçalho) não autorizam esta.
  for (const autorizacao of ['D-PROD-162', 'D-PROD-182', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-200', '', undefined, null, 'd-prod-195', 'd-prod-197', 'D-PROD-196', ' D-PROD-197', 'D-PROD-197 ', 'D-PROD-19']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_P], classificacao: comP, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  // Junto com a criação da tabela (D-PROD-182) ou com outra migration: não isolada.
  const ATIV = '20261113100000_tipo_atividade_cadastro';
  const comOutra = classificarMigrations([ler(ATIV), ler(NOME_P)]);
  assert.deepEqual(comOutra.violacoes, []);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [ATIV, NOME_P], classificacao: comOutra, autorizacao: 'D-PROD-197' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  // Com outra CONTRACT (inclusive a curva na categoria, D-PROD-195, a anterior, e a curva mensal, D-PROD-194) ou várias:
  // nenhuma autorização isola.
  for (const lote of [[NOME_G, NOME_P], [NOME_K, NOME_P], [NOME_C, NOME_P], [NOME_T, NOME_D, NOME_P], [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P]]) {
    const c = classificarMigrations(lote.map(ler));
    assert.deepEqual(c.violacoes, []);
    assert.equal(c.contract.length, lote.length);
    for (const autorizacao of ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', undefined]) {
      assert.deepEqual(conferirReleaseContract({ nomesNovas: lote, classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, `${lote.length} CONTRACT, ${autorizacao}`);
    }
  }
  const semP = classificarMigrations([ler(ATIV)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [ATIV], classificacao: semP, autorizacao: 'D-PROD-197' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B19h (D-PROD-197): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-197 só com a D-PROD-197 sozinha e --contract D-PROD-197; outra decisão ou outra CONTRACT junto não autorizam; nunca herdado', () => {
  const comP = classificarMigrations([ler(NOME_P)]);
  const comK = classificarMigrations([ler(NOME_K), ler(NOME_P)]);
  const comG = classificarMigrations([ler(NOME_G), ler(NOME_P)]);
  const seis = classificarMigrations([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P].map(ler));
  // Positivo com base 'herdado': prova que a função GRAVA a decisão (não só deixa passar o valor herdado).
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comP, autorizacao: 'D-PROD-197' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-197');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
  // Negativos com base JÁ igual à decisão: prova que ela nunca é herdada.
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-197' };
  for (const [classificacao, autorizacao] of [[comP, 'D-PROD-194'], [comP, 'D-PROD-195'], [comP, 'D-PROD-182'], [comP, 'D-PROD-200'], [comP, undefined], [comP, 'd-prod-195'], [comP, 'd-prod-197'], [comP, 'D-PROD-196'], [comK, 'D-PROD-197'], [comK, 'D-PROD-194'], [comG, 'D-PROD-197'], [comG, 'D-PROD-195'], [seis, 'D-PROD-197']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B19i (D-PROD-197): contractsPendentes com as seis CONTRACT locais — produção hoje (D-PROD-162, D-PROD-183, D-PROD-187, D-PROD-194 e D-PROD-195 concluídas) deixa só a D-PROD-197 pendente; histórico vazio, as seis; aberta ou revertida continua pendente; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, '20261113100000_tipo_atividade_cadastro', NOME_T, NOME_D, NOME_K, NOME_G, NOME_P];
  const PEND_P = { nome: NOME_P, decisao: 'D-PROD-197' };
  const producao = [linha(NOME_C), linha(NOME_T), linha(NOME_D), linha(NOME_K), linha(NOME_G)];
  assert.deepEqual(contractsPendentes({ locais, linhas: producao }), [PEND_P], 'produção hoje: as cinco anteriores concluídas (a D-PROD-195 por último)');
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197']);
  assert.deepEqual(contractsPendentes({ locais, linhas: producao.slice(0, 4) }), [{ nome: NOME_G, decisao: 'D-PROD-195' }, PEND_P], 'antes da curva na categoria: as duas últimas pendentes');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_P)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_P, { finished_at: null })] }), [PEND_P], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_P, { rolled_back_at: new Date() })] }), [PEND_P], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_P), linhas: producao }), [], 'sem a pasta local não há o que aplicar');
});

test('B19j (D-PROD-197): runner real sobre a release dos padrões do TipoAtividade — análise local declara o CONTRACT D-PROD-197 sem falar em alargamento ou remoção; verificar/aplicar exigem --contract D-PROD-197 exato ANTES de conectar (as decisões anteriores, inclusive a D-PROD-195, e a D-PROD-182 não servem); nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_P);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    // O rótulo resume o descritor; as instruções aditivas (colunas/constraints adicionadas) estão no JSON. Nada aqui
    // alarga CHECK, remove ou renomeia coisa alguma: o rótulo não pode dizer isso.
    const rotulo = analise.stdout.split('\n').find((l) => l.includes('ANÁLISE LOCAL OK'));
    assert.match(rotulo, /^premerge-migrate: ANÁLISE LOCAL OK \(CONTRACT D-PROD-197: .*\) — alvo remoto NÃO verificado/);
    assert.doesNotMatch(rotulo, /alargad|removid|renomead/, rotulo);
    // O rótulo declara o que a CONTRACT aditiva faz: as 13 colunas e as 5 constraints novas, nunca um rótulo vazio.
    assert.match(rotulo, /13 colunas adicionadas \(TipoAtividade\.categoria, /, rotulo);
    assert.match(rotulo, /5 constraints adicionadas \(/, rotulo);
    assert.doesNotMatch(rotulo, /CONTRACT D-PROD-197: \)/, rotulo);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    // Isolada: as cinco CONTRACT anteriores (em produção, concluídas) e a D-PROD-200 (posterior) estão na main desta release sintética; a única nova é a D-PROD-197.
    assert.deepEqual(json.migrations_novas, [NOME_P]);
    assert.deepEqual(json.contract, [CONTRACT_P]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-197').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-197');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-194'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-182'),
      run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-183'), run(COM_ALVO, '--aplicar', '--contract', 'd-prod-195'),
      run(COM_ALVO, '--verificar-alvo', '--contract'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-195'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-197'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-200'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-197');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-197');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B19k (D-PROD-197/D-PROD-195): ordem de produção no dia da D-PROD-197 — alvo com as 50 da main concluídas (por último a curva mensal, D-PROD-194, e a curva na categoria, D-PROD-195): o histórico confere, a única pendente é a D-PROD-197 e a barreira do CONTRACT a exige; checksum diferente do arquivo é divergência; depois dela, 51 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const ITENS = '20261113800000_apontamento_atividade_item';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // Produção no dia desta CONTRACT: os padrões do TipoAtividade eram a pasta de nome mais recente. O peso objetivo
  // (D-PROD-198, `20261114400000_cadcategoria_peso_objetivo`, ver B20k), a Atividade cabeçalho (D-PROD-200,
  // `20261114500000_atividade_cabecalho`, ver B21m), as linhas de produto e de máquina (D-PROD-202,
  // `20261114600000_atividade_linhas_produto_maquina`, ver B22k) as Formulações (D-PROD-203, ver B23k) e a mão de obra e o serviço (D-PROD-207, ver B26k) vieram depois
  // dela, em releases seguintes: 51 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_P);
  assert.equal(locais.length, 51);
  for (const n of [NOME_PO, NOME_V, NOME_L, NOME_F, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_P), 'na época, os padrões do TipoAtividade eram a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 50 sem a D-PROD-197, na ordem em que foram concluídas (a D-PROD-187, o Estoque P1-03 e os itens do
  // apontamento fora da ordem dos nomes, ver B16k), depois a curva mensal (13:29 UTC de 2026-11-14) e, por último, a
  // curva na categoria (D-PROD-195, 14:51:56 UTC de 2026-11-14).
  const fora = [NOME_P, NOME_G, NOME_K, NOME_D, P1_03, ITENS];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, ITENS, NOME_K, NOME_G].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 50);
  assert.deepEqual(linhas.slice(-5).map((l) => l.migration_name), [NOME_D, P1_03, ITENS, NOME_K, NOME_G]);
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_P], falhas: [] });
  // A ordem das linhas (ou das pastas) não muda nada: conferência por conjunto.
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_P, decisao: 'D-PROD-197' }]);
  // O caminho B registra o checksum = SHA-256 do arquivo; qualquer outro valor é divergência, não "aplicada".
  const linhaP = (checksum) => ({ migration_name: NOME_P, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_K], MIGRATIONS_APROVADAS[NOME_G], 'manual', MIGRATIONS_CONTRACT_APROVADAS[NOME_P].guarda_sha256]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaP(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  // Depois da aplicação (a D-PROD-197 concluída por último): 51, nada pendente, nada a autorizar.
  const depois = [...linhas, linhaP(MIGRATIONS_APROVADAS[NOME_P])];
  assert.equal(depois.length, 51);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B21a (D-PROD-200): a migration CONTRACT classificada SOZINHA, como na release: ok, modo CONTRACT, exatamente as 2 tabelas novas, nenhuma coluna em tabela antiga e o descritor com as 3 conversões e as 3 tabelas removidas (filhas primeiro); nada alargado, acrescentado ou renomeado', () => {
  const c = classificarMigrations([ler(NOME_V)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, NOVAS_V);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_V]);
  // O arquivo é o auditado, byte a byte.
  assert.equal(sha256(SQL_V), 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb');
  assert.equal(MIGRATIONS_APROVADAS[NOME_V], sha256(SQL_V));
  // O número da decisão fica fora do migration.sql (renumerar nunca muda o checksum aplicado).
  assert.doesNotMatch(SQL_V, /D-PROD-200/);
});

test('B21b (D-PROD-200): a entrada é congelada e o conteúdo pinado é o do arquivo — guarda, os 3 DROP (filhas primeiro), os 3 literais, nenhuma instrução em tabela antiga e as 3 conversões; as 6 ÚLTIMAS instruções do arquivo são as 3 conversões e os 3 DROP, nessa ordem; a guarda trava as antigas antes de conferir; o RLS do resto é corpo novo, pinado, só das 2 novas', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_V];
  assert.ok(NOME_V in MIGRATIONS_APROVADAS, 'quem é CONTRACT também está no manifesto (checksum pinado)');
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas, k.conversao]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-200');
  assert.equal(k.guarda_sha256, '6d192b5423d728d425d20d4a98d28335b7617a6261ae96999162a71578856f64');
  assert.deepEqual(k.drop, DROP_V);
  assert.deepEqual(k.literais_guarda, ['CONFIRMADO', 'CANCELADO', 'EntidadeCodigoSequencia']);
  assert.deepEqual(k.alter_antigas, []);
  assert.equal(k.conversao.length, 3);
  assert.ok(k.conversao.every((a) => !a.includes(';') && a === a.replace(/\s+/g, ' ').trim()), 'texto normalizado, sem o ";"');
  assert.match(k.conversao[0], /^INSERT INTO "Atividade" \(/);
  assert.match(k.conversao[1], /^INSERT INTO "AtividadeApontamento" \(/);
  assert.match(k.conversao[2], /^UPDATE "EntidadeCodigoSequencia" SET "entidade" = 'Atividade', /);
  // A cauda do arquivo: as 6 últimas instruções são as 3 conversões e os 3 DROP, nessa ordem, cada uma uma vez só, e nada depois.
  assert.equal(CAUDA_V.length, 6);
  assert.deepEqual(CAUDA_V.map((s) => s.slice(0, -1).replace(/\s+/g, ' ').trim()), [...k.conversao, ...DROP_V.map((t) => `DROP TABLE "${t}"`)]);
  for (const s of CAUDA_V) assert.equal(SQL_V.split(s).length, 2, s.slice(0, 60));
  const semComent = SQL_V.replace(/--[^\n]*/g, '');
  assert.ok(semComent.trimEnd().endsWith(DROPS_V.at(-1)), 'o DROP de ApontamentoAtividade é a última instrução');
  // Os 2 blocos DO: a guarda (PRIMEIRA instrução, hash pinado) e o RLS das novas (hash novo em DO_RLS_APROVADOS).
  assert.ok(semComent.trimStart().startsWith('DO $$'), 'a guarda é a primeira instrução');
  const corpos = [...semComent.matchAll(/DO\s+\$\$([\s\S]*?)\$\$\s*;/g)].map((x) => x[1].replace(/\s+/g, ' ').trim());
  assert.equal(corpos.length, 2, 'guarda + RLS');
  assert.equal(sha256(corpos[0]), k.guarda_sha256);
  assert.equal(sha256(corpos[1]), DO_V);
  assert.ok(DO_RLS_APROVADOS.includes(DO_V));
  // A guarda só cita as 3 removidas, as 2 criadas no resto e os 3 literais; o RLS só as 2 novas.
  const citadas = (corpo) => [...new Set([...corpo.matchAll(/'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g)].map((x) => x[1] ?? x[2]))].sort();
  assert.deepEqual(citadas(corpos[0]), [...DROP_V, ...NOVAS_V, ...k.literais_guarda].sort());
  assert.deepEqual(citadas(corpos[1]), NOVAS_V);
  // A guarda trava as 3 antigas em ACCESS EXCLUSIVE ANTES de conferir o que há nelas (sem a trava, um item gravado por
  // uma transação concorrente depois da conferência seria apagado com a tabela), com lock_timeout e a trava consultiva.
  const trava = corpos[0].indexOf('LOCK TABLE public."ApontamentoAtividade", public."ApontamentoAtividadeItem", public."ApontamentoAtividadeItemConsumoLote" IN ACCESS EXCLUSIVE MODE;');
  const confere = corpos[0].indexOf('IF EXISTS (SELECT 1 FROM public."ApontamentoAtividadeItem")');
  assert.ok(trava > 0 && confere > trava, 'a trava vem antes da primeira conferência de conteúdo');
  assert.ok(corpos[0].startsWith("BEGIN PERFORM set_config('lock_timeout', '5s', true); PERFORM set_config('statement_timeout', '120s', true); PERFORM pg_advisory_xact_lock(72707369);"));
  // O resto (entre a guarda e a conversão, sem o bloco DO do RLS): só tabelas novas (CREATE TABLE, índices, CHECKs e
  // FKs); nenhuma instrução de tabela antiga.
  const comRls = semComent.slice(semComent.indexOf('END $$;') + 'END $$;'.length, semComent.indexOf(INS_ATIV_V));
  const resto = comRls.replace(/DO\s+\$\$[\s\S]*?\$\$\s*;/g, '');
  assert.equal(comRls.length - resto.length > 0 && (comRls.match(/DO\s+\$\$/g) ?? []).length, 1, 'um só bloco DO no resto: o RLS');
  const instrucoesDoResto = resto.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.equal(instrucoesDoResto.length, 2 + 15 + 14 + 21, '2 CREATE TABLE, 15 índices, 14 CHECKs e 21 FKs');
  for (const st of instrucoesDoResto) {
    assert.match(st, /^(CREATE TABLE "(Atividade|AtividadeApontamento)" \(|CREATE (UNIQUE )?INDEX "[A-Za-z_]+" ON "(Atividade|AtividadeApontamento)"\(|ALTER TABLE "(Atividade|AtividadeApontamento)" ADD CONSTRAINT "[A-Za-z_]+" (CHECK|FOREIGN KEY) )/, st.slice(0, 80));
  }
  // O unique (atividade, dia, turno, sequência) é NULLS NOT DISTINCT: turno nulo conta como valor.
  assert.ok(semComent.includes('CREATE UNIQUE INDEX "AtividadeApontamento_atividade_dia_turno_sequencia_key" ON "AtividadeApontamento"("cliente_id", "atividade_id", "data_operacional", "turno", "sequencia") NULLS NOT DISTINCT;'));
  assert.doesNotMatch(semComent, /\bTRUNCATE\b|\bDELETE FROM\b|DROP TABLE [^;]*(CASCADE|IF EXISTS)|ON DELETE (CASCADE|SET NULL)|NOT VALID/);
});

test('B21c (D-PROD-200): as 3 conversões são EXATAMENTE as do contrato, na ordem, logo antes dos DROP — alterada (id, nome, setor, quantidade do cancelado, status, JOIN interno, ON CONFLICT, filtro, turno, contador), faltando, trocada de ordem, DML a mais entre elas ou o UPDATE do contador levado para o resto → CONTRACT_CONVERSAO_FORA_DO_CONTRATO', () => {
  const ancoraResto = '-- CreateTable\nCREATE TABLE "Atividade" (';
  const casos = {
    idDaAtividade: [trocar(SQL_V, INS_ATIV_V, INS_ATIV_V.replace(`SELECT 'atv_' || a."id"`, `SELECT 'atx_' || a."id"`)), 0],
    nome: [trocar(SQL_V, INS_ATIV_V, INS_ATIV_V.replace(`' (apontamento nº '`, `' (apontamento '`)), 0],
    setorDaArea: [trocar(SQL_V, INS_ATIV_V, INS_ATIV_V.replace('ar."setor_id",\n    ar."setor_nome"', 'NULL,\n    NULL')), 0],
    quantidadeDoCancelado: [trocar(SQL_V, INS_ATIV_V, INS_ATIV_V.replace(`CASE WHEN a."status" = 'CONFIRMADO' THEN a."quantidade_produzida" END`, 'a."quantidade_produzida"')), 0],
    status: [trocar(SQL_V, INS_ATIV_V, INS_ATIV_V.replace(`ELSE 'ABERTA' END`, `ELSE 'CONCLUIDA' END`)), 0],
    joinInterno: [trocar(SQL_V, INS_ATIV_V, INS_ATIV_V.replace('LEFT JOIN "AreaPastagem"', 'JOIN "AreaPastagem"')), 0],
    onConflict: [trocar(SQL_V, INS_ATIV_V, INS_ATIV_V.replace(/;$/, ' ON CONFLICT DO NOTHING;')), 0],
    filtroNoFilho: [trocar(SQL_V, INS_APONT_V, INS_APONT_V.replace(/;$/, ` WHERE a."status" = 'CONFIRMADO';`)), 1],
    idDoFilho: [trocar(SQL_V, INS_APONT_V, INS_APONT_V.replace('SELECT a."id", a."cliente_id"', `SELECT 'apt_' || a."id", a."cliente_id"`)), 1],
    turno: [trocar(SQL_V, INS_APONT_V, INS_APONT_V.replace('a."data_operacional", NULL, 1,', `a."data_operacional", 'MANHA', 1,`)), 1],
    contadorOutraEntidade: [trocar(SQL_V, UPD_SEQ_V, UPD_SEQ_V.replace(`SET "entidade" = 'Atividade'`, `SET "entidade" = 'AtividadeApontamento'`)), 2],
    contadorSemFiltro: [trocar(SQL_V, UPD_SEQ_V, UPD_SEQ_V.replace(/\s+WHERE "entidade" = 'ApontamentoAtividade';$/, ';')), 2],
    semContador: [trocar(SQL_V, `${UPD_SEQ_V}\n`, ''), 2],
    semFilho: [trocar(SQL_V, `${INS_APONT_V}\n`, ''), 1],
    semAtividade: [trocar(SQL_V, `${INS_ATIV_V}\n`, ''), 0],
    ordem: [trocar(SQL_V, `${INS_ATIV_V}\n\n${INS_APONT_V}`, `${INS_APONT_V}\n\n${INS_ATIV_V}`), 1],
    contadorAntes: [trocar(trocar(SQL_V, `${UPD_SEQ_V}\n`, ''), INS_ATIV_V, `${UPD_SEQ_V}\n${INS_ATIV_V}`), 2],
    dmlEntre: [trocar(SQL_V, `${INS_APONT_V}\n`, `${INS_APONT_V}\nDELETE FROM "ApontamentoAtividadeItem";\n`), 1],
    // DML levado para o resto (antes das tabelas novas): a cauda fica sem ele e o recorte recusa antes do EXPAND.
    contadorNoResto: [trocar(trocar(SQL_V, `${UPD_SEQ_V}\n`, ''), ancoraResto, `${UPD_SEQ_V}\n\n${ancoraResto}`), 2],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_V, caso);
    const c = classificarContractV(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_CONVERSAO_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: esperado (INSERT INTO|UPDATE) "`), `${caso}: ${c.violacoes[0].detalhe}`);
  }
});

test('B21d (D-PROD-200): os 3 DROP são EXATAMENTE os do contrato, na ordem, e as ÚLTIMAS instruções — antes da conversão, de volta logo depois da guarda (formato antigo), fora de ordem, CASCADE, IF EXISTS, outra tabela, um faltando, dois numa só ou qualquer instrução depois deles → CONTRACT_DROP_FORA_DO_CONTRATO', () => {
  const [D1, D2, D3] = DROPS_V;
  const fimDaGuarda = 'END $$;\n\n-- CreateTable\nCREATE TABLE "Atividade" (';
  const semDrops = trocar(SQL_V, `${D1}\n\n${D2}\n\n${D3}\n`, '');
  const casos = {
    antesDaConversao: [trocar(trocar(SQL_V, `${D1}\n`, ''), INS_ATIV_V, `${D1}\n${INS_ATIV_V}`), 0],
    formatoAntigo: [trocar(semDrops, fimDaGuarda, `END $$;\n${D1}\n${D2}\n${D3}\n\n-- CreateTable\nCREATE TABLE "Atividade" (`), 2],
    ordem: [trocar(SQL_V, `${D1}\n\n${D2}\n\n${D3}`, `${D3}\n\n${D2}\n\n${D1}`), 2],
    cascade: [trocar(SQL_V, D3, D3.replace(';', ' CASCADE;')), 2],
    ifExists: [trocar(SQL_V, D2, 'DROP TABLE IF EXISTS "ApontamentoAtividadeItem";'), 1],
    outraTabela: [trocar(SQL_V, D2, 'DROP TABLE "Produto";'), 1],
    faltando: [trocar(SQL_V, `\n${D3}`, ''), 2],
    doisNumaSo: [trocar(SQL_V, `${D1}\n\n${D2}`, 'DROP TABLE "ApontamentoAtividadeItemConsumoLote", "ApontamentoAtividadeItem";'), 1],
    selectDepois: [`${SQL_V}\nSELECT 1;\n`, 2],
    semPontoEVirgula: [`${SQL_V}\nSELECT 1`, 2],
    outroDropDepois: [`${SQL_V}\nDROP TABLE "Lote";\n`, 2],
    insertDepois: [`${SQL_V}\nINSERT INTO "Atividade" ("id") VALUES ('x');\n`, 2],
    rlsDepois: [`${SQL_V}\nALTER TABLE public."Atividade" DISABLE ROW LEVEL SECURITY;\n`, 2],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_V, caso);
    const c = classificarContractV(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_DROP_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: esperado DROP TABLE "${DROP_V[posicao]}" encontrado`), `${caso}: ${c.violacoes[0].detalhe}`);
  }
  // Comentário e linha em branco depois dos DROP não são instrução (o checksum pinado é que prende o arquivo real).
  assert.deepEqual(classificarContractV(`${SQL_V}\n-- fim\n\n`).violacoes, []);
});

test('B21e (D-PROD-200): o resto (entre a guarda e a conversão) é EXPAND — DML (DELETE, UPDATE, INSERT, TRUNCATE, cópia de uma conversão), DROP, ALTER e UNIQUE em tabela antiga recusados como sempre; sem o CREATE TABLE, a tabela volta a ser antiga; CHECK, índice e UNIQUE nas 2 novas aceitos', () => {
  const ancora = '-- CONVERSÃO (pinada)';
  const noResto = (ddl) => trocar(SQL_V, ancora, `${ddl}\n\n${ancora}`);
  const casos = {
    'DELETE FROM "ApontamentoAtividadeItem";': 'SQL_NAO_RECONHECIDO',
    'UPDATE "AreaPastagem" SET "setor_nome" = \'x\';': 'SQL_NAO_RECONHECIDO',
    'INSERT INTO "Atividade" ("id") VALUES (\'x\');': 'SQL_NAO_RECONHECIDO',
    'TRUNCATE "ApontamentoAtividade";': 'SQL_NAO_RECONHECIDO',
    [UPD_SEQ_V]: 'SQL_NAO_RECONHECIDO',
    [INS_APONT_V]: 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "ApontamentoAtividadeItemConsumoLote";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "ApontamentoAtividade" RENAME TO "Atividade_antiga";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AreaPastagem" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "x_check" CHECK ("numero" <> \'\');': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "AreaPastagem_cliente_id_empresa_id_id_key" ON "AreaPastagem"("cliente_id", "empresa_id", "id");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const c = classificarContractV(noResto(ddl));
    assert.deepEqual(codigos(c), [codigo], ddl.slice(0, 60));
    assert.deepEqual(c.contract, [CONTRACT_V], 'a cauda casou: a recusa é do resto');
  }
  // As instruções da cauda só existem como texto pinado: no caminho EXPAND (outra migration qualquer) são recusadas.
  for (const s of CAUDA_V) assert.deepEqual(codigos(classificar(`${BASE}${s}\n`)), ['SQL_NAO_RECONHECIDO'], s.slice(0, 40));
  // Sem o CREATE TABLE de AtividadeApontamento no resto, ela é antiga: o RLS e a guarda passam a citar tabela antiga,
  // e os índices únicos, as FKs e os CHECKs dela são recusados.
  const semCreate = SQL_V.slice(0, SQL_V.indexOf('-- CreateTable\nCREATE TABLE "AtividadeApontamento"')) + SQL_V.slice(SQL_V.indexOf('-- CreateIndex'));
  assert.ok(!semCreate.includes('CREATE TABLE "AtividadeApontamento"'));
  assert.deepEqual(codigos(classificarContractV(semCreate)), ['ALTER_EM_TABELA_ANTIGA', 'DO_EM_TABELA_ANTIGA', 'UNIQUE_EM_TABELA_ANTIGA']);
  // Controle positivo: CHECK, índice e UNIQUE a mais nas 2 novas, no resto, são o EXPAND de sempre (o checksum pinado é que prende o arquivo real).
  const ok = classificarContractV(noResto([
    'ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_nome_check" CHECK (char_length(btrim("nome")) > 0);',
    'CREATE INDEX "Atividade_cliente_id_numero_idx" ON "Atividade"("cliente_id", "numero");',
    'CREATE UNIQUE INDEX "AtividadeApontamento_x_key" ON "AtividadeApontamento"("cliente_id", "id", "sequencia");',
  ].join('\n')));
  assert.deepEqual(ok.violacoes, []);
  assert.deepEqual(ok.tabelas_novas, NOVAS_V);
  assert.deepEqual(ok.contract, [CONTRACT_V]);
});

test('B21f (D-PROD-200): a guarda é a PRIMEIRA instrução e tem o hash pinado — sem a trava das 3 antigas, trava fraca, sem tempo limite ou trava consultiva, sem conferir as fatias, as horas, o cancelamento ou o contador → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE; citando outra tabela ou sem um literal → DO_EM_TABELA_ANTIGA', () => {
  for (const [de, para] of [
    ['  LOCK TABLE public."ApontamentoAtividade", public."ApontamentoAtividadeItem", public."ApontamentoAtividadeItemConsumoLote" IN ACCESS EXCLUSIVE MODE;\n', ''],
    ['IN ACCESS EXCLUSIVE MODE;', 'IN SHARE MODE;'],
    ['LOCK TABLE public."ApontamentoAtividade", public."ApontamentoAtividadeItem", public."ApontamentoAtividadeItemConsumoLote"', 'LOCK TABLE public."ApontamentoAtividade"'],
    ["PERFORM set_config('lock_timeout', '5s', true);", "PERFORM set_config('lock_timeout', '0', true);"],
    ["PERFORM set_config('statement_timeout', '120s', true);", "PERFORM set_config('statement_timeout', '0', true);"],
    ['PERFORM pg_advisory_xact_lock(72707369);', 'PERFORM pg_advisory_xact_lock(1);'],
    [' OR EXISTS (SELECT 1 FROM public."ApontamentoAtividadeItemConsumoLote")', ''],
    [' OR "hora_fim" IS NOT NULL', ''],
    ['\n                 OR "horas_trabalhadas" IS NOT NULL', ''],
    [`\n                OR ("status" = 'CANCELADO') <> ("cancelado_em" IS NOT NULL)) THEN`, ') THEN'],
    [`WHERE "entidade" = 'Atividade') THEN`, `WHERE "entidade" = 'atividade') THEN`],
  ]) {
    assert.deepEqual(codigos(classificarContractV(trocar(SQL_V, de, para))), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], de);
  }
  const inicio = SQL_V.indexOf('-- Guarda: falha fechada');
  const fim = SQL_V.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_V.slice(0, inicio) + SQL_V.slice(fim);
  assert.ok(!semGuarda.includes('pg_advisory_xact_lock'));
  assert.deepEqual(codigos(classificarContractV(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  assert.deepEqual(codigos(classificarContractV(`CREATE INDEX "x_idx" ON "ApontamentoAtividade"("id");\n${SQL_V}`)), ['CONTRACT_GUARDA_AUSENTE']);
  // Guarda (com hash repinado num contrato sintético) que cita outra tabela: só as 3 removidas, as 2 criadas e os 3 literais.
  const outra = trocar(SQL_V, `IF to_regclass('public."Atividade"') IS NOT NULL`, `IF to_regclass('public."Lote"') IS NOT NULL`);
  const corpo = outra.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  const c = classificarContractV(outra, { contratos: { [NOME_V]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_V], guarda_sha256: sha256(corpo) } } });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Lote'), JSON.stringify(c.violacoes));
  // E sem EntidadeCodigoSequencia nos literais, a própria guarda do arquivo cita tabela antiga.
  const semLiteral = { [NOME_V]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_V], literais_guarda: ['CONFIRMADO', 'CANCELADO'] } };
  const s = classificarMigrations([ler(NOME_V)], { contratos: semLiteral });
  assert.deepEqual(codigos(s), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(s.violacoes.every((v) => v.detalhe === 'EntidadeCodigoSequencia'));
});

test('B21g (D-PROD-200): o RLS do resto só passa com o corpo pinado e só das 2 novas — citando uma antiga, sem uma das novas ou com FORCE → DO_NAO_RECONHECIDO (e DO_EM_TABELA_ANTIGA se cita antiga); sem o hash na allowlist, o mesmo arquivo é recusado', () => {
  const lista = "ARRAY['Atividade','AtividadeApontamento']";
  assert.deepEqual(codigos(classificarContractV(trocar(SQL_V, lista, "ARRAY['Atividade','AtividadeApontamento','ApontamentoAtividade']"))), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  assert.deepEqual(codigos(classificarContractV(trocar(SQL_V, lista, "ARRAY['Atividade']"))), ['DO_NAO_RECONHECIDO']);
  assert.deepEqual(codigos(classificarContractV(trocar(SQL_V, 'ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY'))), ['DO_NAO_RECONHECIDO']);
  const semDo = DO_RLS_APROVADOS.filter((h) => h !== DO_V);
  assert.equal(semDo.length, DO_RLS_APROVADOS.length - 1);
  assert.deepEqual(codigos(classificarMigrations([ler(NOME_V)], { doAprovados: semDo })), ['DO_NAO_RECONHECIDO']);
  // 1 byte a mais no arquivo pinado → checksum divergente.
  assert.deepEqual(codigos(classificarMigrations([{ nome: NOME_V, sql: `${SQL_V}\n` }])), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B21h (D-PROD-200): o contrato é do NOME e o formato é da ENTRADA — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado (os 2 INSERT, o UPDATE e os 3 DROP); sem a entrada, ou só com as seis anteriores, o nome real é recusado; a entrada sem `conversao` (formato de sempre) recusa o arquivo, e `conversao` numa entrada antiga recusa o dela; os contratos não se servem entre si', () => {
  const outro = '20261114400001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_V }], { manifesto: { [outro]: sha256(SQL_V) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO', 'SQL_NAO_RECONHECIDO']);
  assert.deepEqual(c.violacoes.filter((x) => x.codigo === 'SQL_NAO_RECONHECIDO').map((x) => x.detalhe.split(' (')[0].split(' SET ')[0]),
    ['INSERT INTO "Atividade"', 'INSERT INTO "AtividadeApontamento"', 'UPDATE "EntidadeCodigoSequencia"', ...DROP_V.map((t) => `DROP TABLE "${t}"`)]);
  assert.equal(classificarMigrations([ler(NOME_V)], { contratos: {} }).ok, false);
  const anteriores = Object.fromEntries([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P].map((n) => [n, MIGRATIONS_CONTRACT_APROVADAS[n]]));
  assert.equal(classificarMigrations([ler(NOME_V)], { contratos: anteriores }).ok, false);
  // A mesma entrada sem `conversao` (ou com ela vazia) é o formato de sempre: DROP logo depois da guarda, e o arquivo não casa.
  const { conversao, ...semConversao } = MIGRATIONS_CONTRACT_APROVADAS[NOME_V];
  assert.equal(conversao.length, 3);
  for (const k of [semConversao, { ...semConversao, conversao: [] }]) {
    const r = classificarContractV(SQL_V, { contratos: { [NOME_V]: k } });
    assert.deepEqual(codigos(r), ['CONTRACT_DROP_FORA_DO_CONTRATO']);
    // (O detalhe é cortado em 80 caracteres: com o nome longo da tabela, o "encontrado" fica de fora.)
    assert.match(r.violacoes[0].detalhe, /^posição 0: esperado DROP TABLE "ApontamentoAtividadeItemConsumoLote"/);
  }
  // E `conversao` numa entrada do formato de sempre exige a cauda: a D-PROD-194 com uma conversão qualquer recusa o próprio arquivo.
  const comCauda = { [NOME_K]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_K], conversao: ['UPDATE "CADESTACOES" SET "ativo" = true'] } };
  assert.deepEqual(codigos(classificarContractK(SQL_K, { contratos: comCauda })), ['CONTRACT_DROP_FORA_DO_CONTRATO']);
  // O contrato de um nome não serve ao SQL do outro, nos dois sentidos.
  assert.deepEqual(codigos(classificarContract(SQL_V)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractT(SQL_V)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractD(SQL_V)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractK(SQL_V)), ['CONTRACT_DROP_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractG(SQL_V)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  assert.deepEqual(codigos(classificarContractP(SQL_V)), ['CONTRACT_ALTER_FORA_DO_CONTRATO', 'CONTRACT_GUARDA_NAO_RECONHECIDA']);
  for (const sql of [SQL_C, SQL_T, SQL_D, SQL_K, SQL_G, SQL_P]) assert.ok(codigos(classificarContractV(sql)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
});

test('B21i (D-PROD-200): conferirReleaseContract — a D-PROD-200 sozinha só com --contract D-PROD-200 exato; junto com outra migration ou com outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-200 sem CONTRACT é inesperado', () => {
  const comV = classificarMigrations([ler(NOME_V)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_V], classificacao: comV, autorizacao: 'D-PROD-200' }), { ok: true, codigo: null });
  // As decisões que criaram as tabelas antigas (D-PROD-190, D-PROD-193) e as CONTRACT anteriores (inclusive a D-PROD-197) não autorizam esta.
  for (const autorizacao of ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-190', 'D-PROD-193', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', '', undefined, null, 'd-prod-200', ' D-PROD-200', 'D-PROD-200 ', ' D-PROD-200 ', 'D-PROD-19', 'D-PROD-1980']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_V], classificacao: comV, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  // Junto com a criação das tabelas que ela apaga (D-PROD-190, D-PROD-193) ou com outra migration: não isolada.
  for (const outra of [NOME_A, NOME_I]) {
    const comOutra = classificarMigrations([ler(outra), ler(NOME_V)]);
    assert.deepEqual(comOutra.violacoes, []);
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [outra, NOME_V], classificacao: comOutra, autorizacao: 'D-PROD-200' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, outra);
  }
  // Com outra CONTRACT (inclusive a D-PROD-197, a anterior) ou várias: nenhuma autorização isola.
  for (const lote of [[NOME_P, NOME_V], [NOME_K, NOME_V], [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V]]) {
    const c = classificarMigrations(lote.map(ler));
    assert.deepEqual(c.violacoes, []);
    assert.equal(c.contract.length, lote.length);
    for (const autorizacao of ['D-PROD-162', 'D-PROD-194', 'D-PROD-197', 'D-PROD-200', undefined]) {
      assert.deepEqual(conferirReleaseContract({ nomesNovas: lote, classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, `${lote.length} CONTRACT, ${autorizacao}`);
    }
  }
  const semV = classificarMigrations([ler(NOME_I)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_I], classificacao: semV, autorizacao: 'D-PROD-200' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B21j (D-PROD-200): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-200 só com a D-PROD-200 sozinha e --contract D-PROD-200; outra decisão ou outra CONTRACT junto não autorizam; nunca herdado', () => {
  const comV = classificarMigrations([ler(NOME_V)]);
  const comP = classificarMigrations([ler(NOME_P), ler(NOME_V)]);
  const sete = classificarMigrations([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V].map(ler));
  // Positivo com base 'herdado': prova que a função GRAVA a decisão (não só deixa passar o valor herdado).
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comV, autorizacao: 'D-PROD-200' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-200');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado', 'o ambiente do runner não é mutado');
  // Negativos com base JÁ igual à decisão: prova que ela nunca é herdada.
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-200' };
  for (const [classificacao, autorizacao] of [[comV, 'D-PROD-197'], [comV, 'D-PROD-193'], [comV, undefined], [comV, 'd-prod-200'], [comV, ' D-PROD-200 '], [comP, 'D-PROD-200'], [comP, 'D-PROD-197'], [sete, 'D-PROD-200']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B21k (D-PROD-200): contractsPendentes com as sete CONTRACT locais — produção hoje (as seis anteriores concluídas, a D-PROD-197 por último) deixa só a D-PROD-200 pendente; histórico vazio, as sete; aberta ou revertida continua pendente; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, NOME_T, NOME_D, NOME_A, NOME_I, NOME_K, NOME_G, NOME_P, NOME_V];
  const PEND_V = { nome: NOME_V, decisao: 'D-PROD-200' };
  const producao = [NOME_C, NOME_T, NOME_D, NOME_A, NOME_I, NOME_K, NOME_G, NOME_P].map((n) => linha(n));
  assert.deepEqual(contractsPendentes({ locais, linhas: producao }), [PEND_V], 'produção hoje: as seis anteriores concluídas');
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200']);
  assert.deepEqual(contractsPendentes({ locais, linhas: producao.filter((l) => l.migration_name !== NOME_P) }), [{ nome: NOME_P, decisao: 'D-PROD-197' }, PEND_V], 'antes da D-PROD-197: as duas últimas pendentes');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_V)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_V, { finished_at: null })] }), [PEND_V], 'falha aberta continua pendente');
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_V, { rolled_back_at: new Date() })] }), [PEND_V], 'revertida continua pendente');
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_V), linhas: producao }), [], 'sem a pasta local não há o que aplicar');
});

test('B21l (D-PROD-200): runner real sobre a release da Atividade cabeçalho — análise local declara as 3 conversões e as 3 tabelas removidas; verificar/aplicar exigem --contract D-PROD-200 exato ANTES de conectar (as decisões anteriores, inclusive a D-PROD-197, as das tabelas antigas e as quase iguais não servem); nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_V);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    const rotulo = analise.stdout.split('\n').find((l) => l.includes('ANÁLISE LOCAL OK'));
    assert.equal(rotulo, 'premerge-migrate: ANÁLISE LOCAL OK (CONTRACT D-PROD-200: 3 conversões (INSERT INTO Atividade, INSERT INTO AtividadeApontamento, UPDATE EntidadeCodigoSequencia), 3 tabelas removidas) — alvo remoto NÃO verificado (isto não autoriza aplicar; use --verificar-alvo)');
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    // Isolada: as seis CONTRACT anteriores (em produção, concluídas) estão na main desta release sintética; a única nova é a D-PROD-200.
    assert.deepEqual(json.migrations_novas, [NOME_V]);
    assert.deepEqual(json.contract, [CONTRACT_V]);
    assert.deepEqual(json.tabelas_novas, NOVAS_V);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-200').status, 0, 'a análise local aceita a decisão certa');
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-200');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-197'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-197'),
      run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-190'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-193'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-200'), run(COM_ALVO, '--verificar-alvo', '--contract', ' D-PROD-200 '),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-1980'), run(COM_ALVO, '--verificar-alvo', '--contract'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-200');
    // Com a decisão exata a barreira passa e o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-200');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B21m (D-PROD-200/D-PROD-198/D-PROD-197): ordem de produção no dia da D-PROD-200 — alvo com as 52 da main concluídas (por último os padrões do TipoAtividade, D-PROD-197, e o peso objetivo, D-PROD-198): o histórico confere, a única pendente é a D-PROD-200 e a barreira do CONTRACT a exige; checksum diferente do arquivo é divergência; depois dela, 53 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-200 a Atividade cabeçalho era a pasta de nome mais recente; as linhas de produto e de máquina
  // (D-PROD-202, `20261114600000_atividade_linhas_produto_maquina`, ver B22k) e as Formulações (D-PROD-203,
  // `20261114700000_cadformulacao`, ver B23k) e a mão de obra e o serviço (D-PROD-207,
  // `20261115900000_atividade_mao_obra_servico`, ver B26k) vieram depois dela: 53 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_V);
  assert.equal(locais.length, 53);
  for (const n of [NOME_L, NOME_F, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_V), 'na época, a Atividade cabeçalho era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 52 sem a D-PROD-200, na ordem em que foram concluídas (como em B19k), depois os padrões do
  // TipoAtividade (D-PROD-197, 17:05:05 UTC de 2026-11-14) e, por último, o peso objetivo (D-PROD-198, EXPAND).
  const fora = [NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 52);
  assert.deepEqual(linhas.slice(-4).map((l) => l.migration_name), [NOME_K, NOME_G, NOME_P, NOME_PO]);
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_V], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_V, decisao: 'D-PROD-200' }]);
  // O caminho B registra o checksum = SHA-256 do arquivo; qualquer outro valor é divergência, não "aplicada".
  const linhaV = (checksum) => ({ migration_name: NOME_V, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_P], MIGRATIONS_APROVADAS[NOME_PO], 'manual', MIGRATIONS_CONTRACT_APROVADAS[NOME_V].guarda_sha256, DO_V]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaV(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  // Depois da aplicação (a D-PROD-200 concluída por último): 53, nada pendente, nada a autorizar.
  const depois = [...linhas, linhaV(MIGRATIONS_APROVADAS[NOME_V])];
  assert.equal(depois.length, 53);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B22a (D-PROD-202): as linhas de produto e de máquina classificadas SOZINHAS, como na release (a D-PROD-200 já está em produção): EXPAND puro, só as 3 tabelas novas e as 2 colunas anuláveis em tabela antiga, DO de RLS pinado citando só as novas; --contract é inesperado; o que tocaria AtividadeApontamento, BemPatrimonial ou TipoPatrimonial além disso é recusado', () => {
  const m = ler(NOME_L);
  const c = classificarMigrations([m]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(c.tabelas_novas, NOVAS_L);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, COLUNAS_L);
  // O arquivo é o auditado, byte a byte; EXPAND não tem entrada CONTRACT; o número da decisão fica fora do arquivo.
  assert.equal(sha256(m.sql), 'e374c81d448711894a19825e319ed0d760128c9b77a02953647e4cf7a09a5489');
  assert.equal(MIGRATIONS_APROVADAS[NOME_L], sha256(m.sql));
  assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME_L), false, 'EXPAND: sem entrada CONTRACT');
  assert.doesNotMatch(m.sql, /D-PROD-\d+/);
  assert.ok(DO_RLS_APROVADOS.includes(DO_L));
  // Release EXPAND: sem --contract passa; qualquer --contract (inclusive o número desta decisão e o da anterior) é inesperado.
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_L], classificacao: c, autorizacao: undefined }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-202', 'D-PROD-200', '']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_L], classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_INESPERADO' }, autorizacao);
  }
  assert.equal(envDoDeployMigrate({ env: { PATH: '/bin' }, classificacao: c, autorizacao: 'D-PROD-202' }).MIGRATION_CONTRACT_AUTORIZADO, undefined);
  // AtividadeApontamento, BemPatrimonial e TipoPatrimonial são ANTIGAS nesta release: as 2 colunas só passam anuláveis,
  // sem DEFAULT; qualquer CHECK, UNIQUE, NOT NULL, DEFAULT, ALTER COLUMN ou DML nelas fica fora do EXPAND.
  const casos = {
    'ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_custo_check" CHECK ("ordem" >= 1);': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AtividadeApontamento" ADD COLUMN "custo_linhas_total" DECIMAL(14,4) NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "BemPatrimonial" ADD COLUMN "custo_uso_padrao" DECIMAL(14,4) DEFAULT 0;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "BemPatrimonial" ALTER COLUMN "custo_uso_unitario" SET NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_salto_check" CHECK ("salto_maximo_medidor" > 0);': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "BemPatrimonial_cliente_id_custo_key" ON "BemPatrimonial"("cliente_id", "custo_uso_unitario");': 'UNIQUE_EM_TABELA_ANTIGA',
    'UPDATE "BemPatrimonial" SET "custo_uso_unitario" = 0;': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "AtividadeApontamento";': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const r = classificar(`${m.sql}\n${ddl}\n`);
    assert.equal(r.expand, false, ddl);
    assert.deepEqual(r.violacoes.map((v) => v.codigo), [codigo], ddl);
  }
  // As 2 colunas com NOT NULL, DEFAULT ou outro tipo fora da lista também são recusadas (a allowlist não afrouxou).
  for (const [de, para] of [
    ['ADD COLUMN     "custo_uso_unitario" DECIMAL(14,4);', 'ADD COLUMN     "custo_uso_unitario" DECIMAL(14,4) NOT NULL;'],
    ['ADD COLUMN     "salto_maximo_medidor" DECIMAL(14,4);', 'ADD COLUMN     "salto_maximo_medidor" DECIMAL(14,4) DEFAULT 1000;'],
    ['ADD COLUMN     "salto_maximo_medidor" DECIMAL(14,4);', 'ADD COLUMN     "salto_maximo_medidor" DOUBLE PRECISION;'],
  ]) assert.deepEqual(codigos(classificar(trocar(m.sql, de, para))), ['ALTER_EM_TABELA_ANTIGA'], para);
  // Nas tabelas novas, um CHECK a mais continua aceito (endurecer o domínio depois exige novo pin).
  assert.deepEqual(classificar(`${m.sql}\nALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_ordem_check" CHECK ("ordem" <= 200);\n`).violacoes, []);
  // O bloco DO pinado não pode citar tabela antiga: incluir 'AtividadeApontamento' na lista muda o hash e cita tabela antiga.
  const doComAntiga = trocar(m.sql, "ARRAY['AtividadeApontamentoProduto',", "ARRAY['AtividadeApontamento','AtividadeApontamentoProduto',");
  assert.deepEqual(codigos(classificar(doComAntiga)), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // Sem uma das 3 novas na lista, o corpo muda e o hash não confere (a lista é a auditada).
  const doSemUma = trocar(m.sql, ",'AtividadeApontamentoMaquina'];", '];');
  assert.deepEqual(codigos(classificar(doSemUma)), ['DO_NAO_RECONHECIDO']);
  // 1 byte a mais no arquivo pinado → checksum divergente; sem a entrada no manifesto → não aprovada.
  assert.deepEqual(classificarMigrations([{ ...m, sql: `${m.sql}\n` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
  const semEntrada = Object.fromEntries(Object.entries(MIGRATIONS_APROVADAS).filter(([n]) => n !== NOME_L));
  assert.deepEqual(classificarMigrations([m], { manifesto: semEntrada }).violacoes.map((v) => v.codigo), ['MIGRATION_NAO_APROVADA']);
  // Sem o hash do DO na allowlist, o mesmo arquivo é recusado (o pin do DO é desta decisão, não herdado da D-PROD-200).
  const semDo = DO_RLS_APROVADOS.filter((h) => h !== DO_L);
  assert.equal(semDo.length, DO_RLS_APROVADOS.length - 1);
  assert.deepEqual(codigos(classificarMigrations([m], { doAprovados: semDo })), ['DO_NAO_RECONHECIDO']);
  // Nenhum ponto e vírgula dentro de CHECK (o classificador corta por ';'): 9 CHECKs, cada um inteiro numa instrução própria.
  const comCheck = m.sql.replace(/--[^\n]*/g, '').split(';').filter((st) => / ADD CONSTRAINT "[^"]+" CHECK \(/.test(st));
  assert.equal(comCheck.length, 9);
  for (const st of comCheck) assert.match(st.trim(), /^ALTER TABLE "AtividadeApontamento(Produto|ProdutoConsumoLote|Maquina)" ADD CONSTRAINT "[A-Za-z_]+_check" CHECK \(.*\)$/s);
});

test('B22b (D-PROD-202): runner real sobre a release das linhas de produto e de máquina — análise local EXPAND sem rótulo CONTRACT, com as 3 tabelas e as 2 colunas; --contract é CONTRACT_INESPERADO; verificar o alvo não pede --contract e segue para a conexão; nunca imprime URL', () => {
  // main = pasta sem NOME_L (já com a D-PROD-200), HEAD = main + NOME_L.
  const repo = repoDaReleaseContract(NOME_L);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    assert.ok(analise.stdout.includes('premerge-migrate: ANÁLISE LOCAL OK — alvo remoto NÃO verificado'), analise.stdout);
    assert.doesNotMatch(analise.stdout, /CONTRACT D-PROD/);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'EXPAND');
    assert.equal(json.expand, true);
    assert.deepEqual(json.migrations_novas, [NOME_L]);
    assert.deepEqual(json.contract, []);
    assert.deepEqual(json.tabelas_novas, NOVAS_L);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, COLUNAS_L);
    assert.deepEqual(json.violacoes, []);
    for (const r of [run(SEM_ALVO, '--contract', 'D-PROD-202'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-200')]) {
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, /RECUSADO CONTRACT_INESPERADO/);
      semSegredo(r);
    }
    const semConfig = run(SEM_ALVO, '--aplicar');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    // Sem CONTRACT a barreira de autorização não existe: o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const verificar = run(COM_ALVO, '--verificar-alvo');
    assert.equal(verificar.status, 3);
    assert.doesNotMatch(verificar.stderr, /CONTRACT_/);
    assert.match(verificar.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(verificar);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B22k (D-PROD-202/D-PROD-200): ordem de produção no dia da D-PROD-202 — alvo com as 53 da main concluídas (por último a Atividade cabeçalho, D-PROD-200, 2026-11-14 20:25:14 UTC): o histórico confere, a única pendente é a D-PROD-202, nenhum CONTRACT a autorizar; checksum diferente do arquivo ou registro parcial é divergência; depois dela, 54 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-202 as linhas de produto e de máquina eram a pasta de nome mais recente; as Formulações
  // (D-PROD-203, `20261114700000_cadformulacao`, ver B23k) e a mão de obra e o serviço (D-PROD-207,
  // `20261115900000_atividade_mao_obra_servico`, ver B26k) vieram depois dela, nas releases seguintes: 54 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_L);
  assert.equal(locais.length, 54);
  for (const n of [NOME_F, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_L), 'na época, as linhas de produto e de máquina eram a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 53 sem a D-PROD-202, na ordem em que foram concluídas (como em B21m) e, por último, a Atividade
  // cabeçalho (D-PROD-200).
  const fora = [NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 53);
  assert.deepEqual(linhas.slice(-3).map((l) => l.migration_name), [NOME_P, NOME_PO, NOME_V]);
  assert.equal(linhas.find((l) => l.migration_name === NOME_V).checksum, 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_L], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [], 'EXPAND: nenhum CONTRACT a autorizar');
  // O caminho B registra o checksum = SHA-256 do arquivo; qualquer outro valor é divergência, não "aplicada".
  const linhaL = (checksum, extra = {}) => ({ migration_name: NOME_L, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_V], 'manual', DO_L]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaL(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  // Registro aberto (finished_at nulo) é aplicação parcial: recusa.
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaL(MIGRATIONS_APROVADAS[NOME_L], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  // Depois da aplicação (a D-PROD-202 concluída por último): 54, nada pendente, nada a autorizar.
  const depois = [...linhas, linhaL(MIGRATIONS_APROVADAS[NOME_L])];
  assert.equal(depois.length, 54);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B23a (D-PROD-203): as Formulações classificadas SOZINHAS, como na release: ok, EXPAND puro, exatamente as 3 tabelas novas, nenhuma coluna em tabela antiga, nenhum CONTRACT; checksum e RLS pinados', () => {
  const c = classificarMigrations([ler(NOME_F)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.tabelas_novas, NOVAS_F);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, []);
  assert.equal(MIGRATIONS_APROVADAS[NOME_F], sha256(readFileSync(`backend/prisma/migrations/${NOME_F}/migration.sql`, 'utf8')));
  assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME_F), false, 'EXPAND: sem entrada CONTRACT');
  assert.ok(DO_RLS_APROVADOS.includes(DO_F), 'o RLS das 3 novas é corpo pinado');
});

test('B23b (D-PROD-203): o mesmo arquivo com DDL em tabela antiga (coluna em Produto, CHECK na CADCATEGORIA, UNIQUE em SuplementacaoEvento, DML de semente) ou com o RLS citando tabela antiga é recusado (a allowlist EXPAND não afrouxou)', () => {
  const sql = readFileSync(`backend/prisma/migrations/${NOME_F}/migration.sql`, 'utf8');
  const comManifesto = (s) => classificarMigrations([{ nome: NOME_F, sql: s }], { manifesto: { [NOME_F]: sha256(s) } });
  for (const [ruim, codigo] of [
    ['ALTER TABLE "Produto" ADD COLUMN "formulacao_id" VARCHAR(64) NOT NULL;', 'ALTER_EM_TABELA_ANTIGA'],
    ['ALTER TABLE "CADCATEGORIA" ADD CONSTRAINT "x_check" CHECK ("nome" <> \'\');', 'ALTER_EM_TABELA_ANTIGA'],
    ['CREATE UNIQUE INDEX "x_key" ON "SuplementacaoEvento"("cliente_id", "empresa_id");', 'UNIQUE_EM_TABELA_ANTIGA'],
    ['INSERT INTO "CADFORMULACAO" ("id") VALUES (\'x\');', 'SQL_NAO_RECONHECIDO'],
    ['UPDATE "SuplementacaoEvento" SET "dados" = \'{}\';', 'SQL_NAO_RECONHECIDO'],
  ]) {
    const c = comManifesto(`${sql}\n${ruim}\n`);
    assert.equal(c.ok, false, ruim);
    assert.ok(c.violacoes.some((v) => v.codigo === codigo), `${ruim} → ${JSON.stringify(c.violacoes)}`);
  }
  const doAntiga = comManifesto(trocar(sql, "ARRAY['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA']", "ARRAY['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA', 'Produto']"));
  assert.deepEqual(codigos(doAntiga), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // Byte a byte: o mesmo SQL com um espaço a mais só diverge no checksum.
  assert.deepEqual(classificarMigrations([{ nome: NOME_F, sql: `${sql} ` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B23k (D-PROD-203/D-PROD-202): ordem de produção no dia da D-PROD-203 — alvo com as 54 da main concluídas (por último as linhas de produto e de máquina, D-PROD-202, 2026-11-14 22:57:20 UTC): o histórico confere, a única pendente é a das Formulações, nenhum CONTRACT a autorizar; checksum diferente do arquivo é divergência; depois dela, 55 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-203 as Formulações eram a pasta de nome mais recente; a Leitura de cocho (D-PROD-205,
  // `20261115100000_leitura_cocho`, ver B24k), a faixa de tolerância (D-PROD-206,
  // `20261115200000_formulacao_faixa_tolerancia`, ver B25k) e a mão de obra e o serviço (D-PROD-207,
  // `20261115900000_atividade_mao_obra_servico`, ver B26k) vieram depois dela, em releases seguintes: 55 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_F);
  assert.equal(locais.length, 55);
  for (const n of [NOME_LC, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_F), 'na época, as Formulações eram a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 53 de B22k, na ordem em que foram concluídas (por último a Atividade cabeçalho, D-PROD-200), e depois
  // as linhas de produto e de máquina (D-PROD-202), concluídas antes das Formulações.
  const fora = [NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 54);
  assert.deepEqual(linhas.slice(-2).map((l) => l.migration_name), [NOME_V, NOME_L]);
  assert.equal(linhas.at(-1).checksum, 'e374c81d448711894a19825e319ed0d760128c9b77a02953647e4cf7a09a5489');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_F], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [], 'EXPAND: nada a autorizar');
  // O caminho B registra o checksum = SHA-256 do arquivo; qualquer outro valor é divergência.
  const linhaF = (checksum, extra = {}) => ({ migration_name: NOME_F, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_L], MIGRATIONS_APROVADAS[NOME_V], 'manual', DO_F]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaF(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  // Registro aberto (finished_at nulo) é aplicação parcial: recusa.
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaF(MIGRATIONS_APROVADAS[NOME_F], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  // Depois da aplicação (as Formulações concluídas por último): 55, nada pendente, nada a autorizar.
  const depois = [...linhas, linhaF(MIGRATIONS_APROVADAS[NOME_F])];
  assert.equal(depois.length, 55);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B24a (D-PROD-205): a Leitura de cocho classificada SOZINHA, como na release: ok, EXPAND puro, exatamente a tabela nova, nenhuma coluna em tabela antiga, nenhum CONTRACT; checksum e RLS pinados', () => {
  const c = classificarMigrations([ler(NOME_LC)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.tabelas_novas, NOVAS_LC);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, []);
  assert.equal(MIGRATIONS_APROVADAS[NOME_LC], sha256(readFileSync(`backend/prisma/migrations/${NOME_LC}/migration.sql`, 'utf8')));
  assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME_LC), false, 'EXPAND: sem entrada CONTRACT');
  assert.ok(DO_RLS_APROVADOS.includes(DO_LC), 'o RLS da nova é corpo pinado');
});

test('B24b (D-PROD-205): o mesmo arquivo com DDL em tabela antiga (coluna em PontoSuplementacao, CHECK em Empresa, UNIQUE em SuplementacaoEvento, DML de semente) ou com o RLS citando tabela antiga é recusado (a allowlist EXPAND não afrouxou)', () => {
  const sql = readFileSync(`backend/prisma/migrations/${NOME_LC}/migration.sql`, 'utf8');
  const comManifesto = (s) => classificarMigrations([{ nome: NOME_LC, sql: s }], { manifesto: { [NOME_LC]: sha256(s) } });
  for (const [ruim, codigo] of [
    ['ALTER TABLE "PontoSuplementacao" ADD COLUMN "ultima_leitura" VARCHAR(16) NOT NULL;', 'ALTER_EM_TABELA_ANTIGA'],
    ['ALTER TABLE "Empresa" ADD CONSTRAINT "x_check" CHECK ("nome" <> \'\');', 'ALTER_EM_TABELA_ANTIGA'],
    ['CREATE UNIQUE INDEX "x_key" ON "SuplementacaoEvento"("cliente_id", "empresa_id");', 'UNIQUE_EM_TABELA_ANTIGA'],
    ['INSERT INTO "LEITURACOCHO" ("id") VALUES (\'x\');', 'SQL_NAO_RECONHECIDO'],
    ['UPDATE "PontoSuplementacao" SET "status" = \'Ativo\';', 'SQL_NAO_RECONHECIDO'],
  ]) {
    const c = comManifesto(`${sql}\n${ruim}\n`);
    assert.equal(c.ok, false, ruim);
    assert.ok(c.violacoes.some((v) => v.codigo === codigo), `${ruim} → ${JSON.stringify(c.violacoes)}`);
  }
  const doAntiga = comManifesto(trocar(sql, "ARRAY['LEITURACOCHO']", "ARRAY['LEITURACOCHO', 'PontoSuplementacao']"));
  assert.deepEqual(codigos(doAntiga), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // Byte a byte: o mesmo SQL com um espaço a mais só diverge no checksum.
  assert.deepEqual(classificarMigrations([{ nome: NOME_LC, sql: `${sql} ` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B24k (D-PROD-205/D-PROD-203): ordem de produção no dia da D-PROD-205 — alvo com as 55 da main concluídas (por último as Formulações, D-PROD-203, 2026-11-14 23:41:42 UTC): o histórico confere, a única pendente é a da Leitura de cocho, nenhum CONTRACT a autorizar; checksum diferente do arquivo é divergência; depois dela, 56 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-205 a Leitura de cocho era a pasta de nome mais recente; a faixa de tolerância (D-PROD-206,
  // `20261115200000_formulacao_faixa_tolerancia`, ver B25k) e a mão de obra e o serviço (D-PROD-207,
  // `20261115900000_atividade_mao_obra_servico`, ver B26k) vieram depois dela, em releases seguintes: 56 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_LC);
  assert.equal(locais.length, 56);
  for (const n of [NOME_FT, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_LC), 'na época, a Leitura de cocho era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 54 de B23k, na ordem em que foram concluídas, e depois as Formulações (D-PROD-203).
  const fora = [NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 55);
  assert.deepEqual(linhas.slice(-2).map((l) => l.migration_name), [NOME_L, NOME_F]);
  assert.equal(linhas.at(-1).checksum, '96f3f3641815960335ddd5321896258a4114a42f62f46448ae53a35907784524');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_LC], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [], 'EXPAND: nada a autorizar');
  // O caminho B registra o checksum = SHA-256 do arquivo; qualquer outro valor é divergência.
  const linhaLC = (checksum, extra = {}) => ({ migration_name: NOME_LC, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_F], MIGRATIONS_APROVADAS[NOME_L], 'manual', DO_LC]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaLC(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  // Registro aberto (finished_at nulo) é aplicação parcial: recusa.
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaLC(MIGRATIONS_APROVADAS[NOME_LC], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  // Depois da aplicação (a Leitura de cocho concluída por último): 56, nada pendente, nada a autorizar.
  const depois = [...linhas, linhaLC(MIGRATIONS_APROVADAS[NOME_LC])];
  assert.equal(depois.length, 56);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B25a (D-PROD-206): a faixa de tolerância classificada SOZINHA, como na release: ok, EXPAND puro, só a coluna anulável CADFORMULACAO.faixa_tolerancia_percentual, nenhum CONTRACT', () => {
  const c = classificarMigrations([ler(NOME_FT)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, ['CADFORMULACAO.faixa_tolerancia_percentual']);
  assert.deepEqual(c.contract, []);
  assert.equal(MIGRATIONS_APROVADAS[NOME_FT], sha256(readFileSync(`backend/prisma/migrations/${NOME_FT}/migration.sql`, 'utf8')));
  assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME_FT), false, 'EXPAND: sem entrada CONTRACT');
});

test('B25b (D-PROD-206): o mesmo ADD COLUMN com NOT NULL ou DEFAULT volátil, um CHECK ou um ALTER COLUMN na tabela antiga é recusado (a allowlist EXPAND não afrouxou)', () => {
  for (const ruim of [
    'ALTER TABLE "CADFORMULACAO" ADD COLUMN "faixa_tolerancia_percentual" DECIMAL(5,2) NOT NULL',
    'ALTER TABLE "CADFORMULACAO" ADD COLUMN "faixa_tolerancia_percentual" DECIMAL(5,2) DEFAULT random()',
    'ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "x_check" CHECK ("faixa_tolerancia_percentual" > 0)',
    'ALTER TABLE "CADFORMULACAO" ALTER COLUMN "faixa_tolerancia_percentual" SET NOT NULL',
  ]) {
    const c = classificarMigrations([{ nome: NOME_FT, sql: `${ruim};\n` }]);
    assert.equal(c.ok, false, ruim);
    assert.ok(c.violacoes.some((v) => v.codigo === 'ALTER_EM_TABELA_ANTIGA'), `${ruim} → ${JSON.stringify(c.violacoes)}`);
  }
  const so = classificarMigrations([{ nome: NOME_FT, sql: 'ALTER TABLE "CADFORMULACAO" ADD COLUMN "faixa_tolerancia_percentual" DECIMAL(5,2);\n' }]);
  assert.deepEqual(so.violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B25k (D-PROD-206/D-PROD-205): ordem de produção hoje — alvo com as 56 da main concluídas (por último a Leitura de cocho, D-PROD-205, 2026-11-15 15:20:55 UTC): o histórico confere, a única pendente é a faixa de tolerância, nenhum CONTRACT a autorizar; checksum diferente do arquivo é divergência; depois dela, 57 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-206 a faixa de tolerância era a pasta de nome mais recente; a mão de obra e o serviço (D-PROD-207,
  // `20261115900000_atividade_mao_obra_servico`, ver B26k) vieram depois dela, na release seguinte: 57 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_FT);
  assert.equal(locais.length, 57);
  for (const n of [NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_FT), 'na época, a faixa de tolerância era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 55 de B24k, na ordem em que foram concluídas, e depois a Leitura de cocho (D-PROD-205).
  const fora = [NOME_FT, NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_LC].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 56);
  assert.deepEqual(linhas.slice(-2).map((l) => l.migration_name), [NOME_F, NOME_LC]);
  assert.equal(linhas.at(-1).checksum, 'f31cb0b8dace187b3b7bc76d6b989c0b6f2f0cd96c623834efcd23c0a9bcd1a1');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_FT], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [], 'EXPAND: nada a autorizar');
  const linhaFT = (checksum, extra = {}) => ({ migration_name: NOME_FT, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_LC], MIGRATIONS_APROVADAS[NOME_PO], 'manual']) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaFT(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaFT(MIGRATIONS_APROVADAS[NOME_FT], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  const depois = [...linhas, linhaFT(MIGRATIONS_APROVADAS[NOME_FT])];
  assert.equal(depois.length, 57);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B26a (D-PROD-207): a mão de obra e o serviço classificados SOZINHOS, como na release (a D-PROD-202, a D-PROD-203, a D-PROD-205 e a D-PROD-206 já estão em produção): EXPAND puro, só as 4 tabelas novas, nenhuma coluna em tabela antiga, DO de RLS pinado citando só as novas; --contract é inesperado; o que tocaria AtividadeApontamento, Fornecedor, UnidadeMedida, CentroCusto ou Usuario é recusado', () => {
  const m = ler(NOME_MO);
  const c = classificarMigrations([m]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.deepEqual(c.tabelas_novas, NOVAS_MO);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  // O arquivo é o auditado, byte a byte; EXPAND não tem entrada CONTRACT; o número da decisão fica fora do arquivo.
  assert.equal(sha256(m.sql), '79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725');
  assert.equal(MIGRATIONS_APROVADAS[NOME_MO], sha256(m.sql));
  assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME_MO), false, 'EXPAND: sem entrada CONTRACT');
  assert.doesNotMatch(m.sql, /D-PROD-\d+/);
  assert.ok(DO_RLS_APROVADOS.includes(DO_MO));
  assert.notEqual(DO_MO, DO_L, 'lista nova, hash novo');
  assert.notEqual(DO_MO, DO_F, 'lista nova, hash novo');
  assert.notEqual(DO_MO, DO_LC, 'lista nova, hash novo');
  // Release EXPAND: sem --contract passa; qualquer --contract (inclusive o número desta decisão e o da anterior) é inesperado.
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_MO], classificacao: c, autorizacao: undefined }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-207', 'D-PROD-206', 'D-PROD-205', 'D-PROD-203', 'D-PROD-202', '']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_MO], classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_INESPERADO' }, autorizacao);
  }
  assert.equal(envDoDeployMigrate({ env: { PATH: '/bin' }, classificacao: c, autorizacao: 'D-PROD-207' }).MIGRATION_CONTRACT_AUTORIZADO, undefined);
  // As tabelas que as FKs novas referenciam são ANTIGAS nesta release: nenhuma coluna, CHECK, UNIQUE, ALTER COLUMN ou
  // DML nelas cabe no EXPAND — nem a coluna anulável que a allowlist aceitaria (esta migration não tem nenhuma).
  const casos = {
    'ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_mao_obra_check" CHECK ("sequencia" >= 1);': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AtividadeApontamento" ADD COLUMN "custo_mao_obra_total" DECIMAL(14,4) NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Fornecedor" ADD COLUMN "prestador" BOOLEAN DEFAULT false;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "UnidadeMedida" ALTER COLUMN "sigla" TYPE VARCHAR(64);': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "Fornecedor_cliente_id_empresa_id_id_key" ON "Fornecedor"("cliente_id", "empresa_id", "id");': 'UNIQUE_EM_TABELA_ANTIGA',
    'ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_funcionario_fkey" FOREIGN KEY ("cliente_id", "id") REFERENCES "Funcionario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;': 'ALTER_EM_TABELA_ANTIGA',
    'INSERT INTO "Funcionario" SELECT * FROM "Usuario";': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "AtividadeApontamento";': 'SQL_NAO_RECONHECIDO',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const r = classificar(`${m.sql}\n${ddl}\n`);
    assert.equal(r.expand, false, ddl);
    assert.deepEqual(r.violacoes.map((v) => v.codigo), [codigo], ddl);
  }
  // Nas tabelas novas, um CHECK a mais continua aceito (endurecer o domínio depois exige novo pin).
  assert.deepEqual(classificar(`${m.sql}\nALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_ordem_check" CHECK ("ordem" <= 200);\n`).violacoes, []);
  // O bloco DO pinado não pode citar tabela antiga: incluir 'AtividadeApontamento' na lista muda o hash e cita tabela antiga.
  const doComAntiga = trocar(m.sql, "ARRAY['Funcionario',", "ARRAY['AtividadeApontamento','Funcionario',");
  assert.deepEqual(codigos(classificar(doComAntiga)), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // Sem uma das 4 novas na lista, o corpo muda e o hash não confere (a lista é a auditada).
  const doSemUma = trocar(m.sql, ",'AtividadeApontamentoServico'];", '];');
  assert.deepEqual(codigos(classificar(doSemUma)), ['DO_NAO_RECONHECIDO']);
  // 1 byte a mais no arquivo pinado → checksum divergente; sem a entrada no manifesto → não aprovada.
  assert.deepEqual(classificarMigrations([{ ...m, sql: `${m.sql}\n` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
  const semEntrada = Object.fromEntries(Object.entries(MIGRATIONS_APROVADAS).filter(([n]) => n !== NOME_MO));
  assert.deepEqual(classificarMigrations([m], { manifesto: semEntrada }).violacoes.map((v) => v.codigo), ['MIGRATION_NAO_APROVADA']);
  // Sem o hash do DO na allowlist, o mesmo arquivo é recusado (o pin do DO é desta decisão, não herdado da D-PROD-202).
  const semDo = DO_RLS_APROVADOS.filter((h) => h !== DO_MO);
  assert.equal(semDo.length, DO_RLS_APROVADOS.length - 1);
  assert.deepEqual(codigos(classificarMigrations([m], { doAprovados: semDo })), ['DO_NAO_RECONHECIDO']);
  // Nenhum ponto e vírgula dentro de CHECK (o classificador corta por ';'): 8 CHECKs, cada um inteiro numa instrução própria.
  const comCheck = m.sql.replace(/--[^\n]*/g, '').split(';').filter((st) => / ADD CONSTRAINT "[^"]+" CHECK \(/.test(st));
  assert.equal(comCheck.length, 8);
  for (const st of comCheck) assert.match(st.trim(), /^ALTER TABLE "(Funcionario|Servico|AtividadeApontamentoMaoObra|AtividadeApontamentoServico)" ADD CONSTRAINT "[A-Za-z_]+_check" CHECK \(.*\)$/s);
  // Toda FK nova sai de uma tabela NOVA (o ALTER é na nova) e é RESTRICT: 17 FKs, nenhuma CASCADE nem SET NULL.
  const fks = m.sql.replace(/--[^\n]*/g, '').split(';').filter((st) => / FOREIGN KEY /.test(st)).map((st) => st.trim());
  assert.equal(fks.length, 17);
  for (const st of fks) {
    assert.match(st, /^ALTER TABLE "(Funcionario|Servico|AtividadeApontamentoMaoObra|AtividadeApontamentoServico)" ADD CONSTRAINT /, st);
    assert.match(st, /ON DELETE RESTRICT ON UPDATE CASCADE$/, st);
  }
});

test('B26b (D-PROD-207): runner real sobre a release da mão de obra e do serviço — análise local EXPAND sem rótulo CONTRACT, com as 4 tabelas e nenhuma coluna em tabela antiga; --contract é CONTRACT_INESPERADO; verificar o alvo não pede --contract e segue para a conexão; nunca imprime URL', () => {
  // main = pasta sem NOME_MO (já com a D-PROD-202, a D-PROD-203, a D-PROD-205 e a D-PROD-206), HEAD = main + NOME_MO.
  const repo = repoDaReleaseContract(NOME_MO);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    assert.ok(analise.stdout.includes('premerge-migrate: ANÁLISE LOCAL OK — alvo remoto NÃO verificado'), analise.stdout);
    assert.doesNotMatch(analise.stdout, /CONTRACT D-PROD/);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'EXPAND');
    assert.equal(json.expand, true);
    assert.deepEqual(json.migrations_novas, [NOME_MO]);
    assert.deepEqual(json.contract, []);
    assert.deepEqual(json.tabelas_novas, NOVAS_MO);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    for (const r of [run(SEM_ALVO, '--contract', 'D-PROD-207'), run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-202')]) {
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, /RECUSADO CONTRACT_INESPERADO/);
      semSegredo(r);
    }
    const semConfig = run(SEM_ALVO, '--aplicar');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    // Sem CONTRACT a barreira de autorização não existe: o runner segue para a conexão (aqui inalcançável: recusa fechada, sem URL).
    const verificar = run(COM_ALVO, '--verificar-alvo');
    assert.equal(verificar.status, 3);
    assert.doesNotMatch(verificar.stderr, /CONTRACT_/);
    assert.match(verificar.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(verificar);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B26k (D-PROD-207/D-PROD-206): ordem de produção no dia da D-PROD-207 — alvo com as 57 da main concluídas (por último a faixa de tolerância, D-PROD-206, 2026-11-15 17:27:54 UTC): o histórico confere, a única pendente é a D-PROD-207, nenhum CONTRACT a autorizar; checksum diferente do arquivo ou registro parcial é divergência; depois dela, 58 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-207 a mão de obra e o serviço eram a pasta de nome mais recente; o ajuste (D-PROD-208,
  // `20261116000000_mao_obra_parceiro`, ver B27m) veio depois dela, na release seguinte: 58 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_MO);
  assert.equal(locais.length, 58);
  for (const n of [NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_MO), 'na época, a mão de obra e o serviço eram a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 57 sem a D-PROD-207, na ordem em que foram concluídas (como em B25k): as 53 de B22k, as linhas de
  // produto e de máquina (D-PROD-202), as Formulações (D-PROD-203), a Leitura de cocho (D-PROD-205) e, por último, a
  // faixa de tolerância (D-PROD-206).
  const fora = [NOME_MO, NOME_FT, NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_LC, NOME_FT].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 57);
  assert.deepEqual(linhas.slice(-4).map((l) => l.migration_name), [NOME_L, NOME_F, NOME_LC, NOME_FT]);
  // A anterior concluída com o checksum do arquivo (o mesmo que o preflight do runbook confere).
  assert.equal(linhas.find((l) => l.migration_name === NOME_FT).checksum, 'bb8be379c241341e1ba45a7d7da8258aef77d5f4e089db302c8d655608d58e4c');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_MO], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [], 'EXPAND: nenhum CONTRACT a autorizar');
  // O caminho B registra o checksum = SHA-256 do arquivo; qualquer outro valor é divergência, não "aplicada".
  const linhaMO = (checksum, extra = {}) => ({ migration_name: NOME_MO, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_FT], MIGRATIONS_APROVADAS[NOME_LC], MIGRATIONS_APROVADAS[NOME_F], 'manual', DO_MO]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaMO(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  // Registro aberto (finished_at nulo) é aplicação parcial: recusa.
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaMO(MIGRATIONS_APROVADAS[NOME_MO], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  // Depois da aplicação (a D-PROD-207 concluída por último): 58, nada pendente, nada a autorizar.
  const depois = [...linhas, linhaMO(MIGRATIONS_APROVADAS[NOME_MO])];
  assert.equal(depois.length, 58);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B27a (D-PROD-208): o ajuste da Fatia 4 classificado SOZINHO, como na release: ok, modo CONTRACT, nenhuma tabela nova nem coluna no caminho EXPAND, Funcionario removida e o descritor com a coluna, a FK e o índice que saem, as 6 colunas e as 3 constraints que entram; nenhuma conversão', () => {
  const c = classificarMigrations([ler(NOME_PP)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_PP]);
  // O arquivo é o auditado, byte a byte; o número da decisão fica fora do migration.sql.
  assert.equal(sha256(SQL_PP), '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0');
  assert.equal(MIGRATIONS_APROVADAS[NOME_PP], sha256(SQL_PP));
  assert.doesNotMatch(SQL_PP, /D-PROD-\d+/);
  // Nenhum bloco DO além da guarda: não há tabela nova, então não há RLS novo a pinar.
  assert.equal((SQL_PP.replace(/--[^\n]*/g, '').match(/DO\s+\$\$/g) ?? []).length, 1);
});

test('B27b (D-PROD-208): a entrada é congelada e o conteúdo pinado é o do arquivo — guarda, o DROP de Funcionario no fim (drop_no_fim), os 2 literais, as 12 instruções em tabela antiga na ordem, nenhuma conversão; a guarda trava as 2 tabelas antes de conferir que estão vazias; o resto é só o índice pelo cliente; o DROP é a última instrução', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_PP];
  assert.ok(NOME_PP in MIGRATIONS_APROVADAS);
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-208');
  assert.equal(k.guarda_sha256, '9ec960b559bb4173342ed76302c828b04b207f07381f5f39b74aea606751d387');
  assert.deepEqual(k.drop, ['Funcionario']);
  assert.equal(k.drop_no_fim, true);
  assert.equal(k.conversao, undefined);
  assert.deepEqual(k.literais_guarda, ['AtividadeApontamentoMaoObra', 'Fornecedor']);
  assert.deepEqual(k.alter_antigas, ALTER_PP);
  assert.ok(k.alter_antigas.every((a) => !a.includes(';') && a === a.replace(/\s+/g, ' ').trim()), 'texto normalizado, sem o ";"');
  const semComent = SQL_PP.replace(/--[^\n]*/g, '');
  // A guarda é a PRIMEIRA instrução (único bloco DO); o DROP é a ÚLTIMA; entre os dois, as 12 pinadas e o índice.
  assert.ok(semComent.trimStart().startsWith('DO $$'));
  assert.ok(semComent.trimEnd().endsWith(DROP_PP));
  const corpo = semComent.match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  assert.equal(sha256(corpo), k.guarda_sha256);
  const depois = semComent.slice(semComent.indexOf('END $$;') + 'END $$;'.length).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(depois, [...ALTER_PP, INDICE_PP.slice(0, -1), DROP_PP.slice(0, -1)]);
  for (const st of [...ALTER_PP, INDICE_PP, DROP_PP]) assert.equal(SQL_PP.split(st.endsWith(';') ? st : `${st};`).length, 2, st.slice(0, 60));
  // A guarda só cita a removida e as 2 antigas tocadas; trava as 2 em ACCESS EXCLUSIVE ANTES de conferir as linhas.
  const citadas = [...new Set([...corpo.matchAll(/'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g)].map((x) => x[1] ?? x[2]))].sort();
  assert.deepEqual(citadas, ['AtividadeApontamentoMaoObra', 'Fornecedor', 'Funcionario']);
  assert.ok(corpo.startsWith("BEGIN PERFORM set_config('lock_timeout', '5s', true); PERFORM set_config('statement_timeout', '120s', true); PERFORM pg_advisory_xact_lock(72707369);"));
  const trava = corpo.indexOf('LOCK TABLE public."Funcionario", public."AtividadeApontamentoMaoObra" IN ACCESS EXCLUSIVE MODE;');
  const vazia1 = corpo.indexOf('IF EXISTS (SELECT 1 FROM public."Funcionario") THEN');
  const vazia2 = corpo.indexOf('IF EXISTS (SELECT 1 FROM public."AtividadeApontamentoMaoObra") THEN');
  assert.ok(trava > 0 && vazia1 > trava && vazia2 > trava, 'a trava vem antes das conferências de conteúdo');
  // Nada de CASCADE, IF EXISTS, SET NULL, NOT VALID, DEFAULT ou DML fora da guarda.
  const semGuarda = semComent.slice(semComent.indexOf('END $$;'));
  assert.doesNotMatch(semGuarda, /DROP [^;]*CASCADE|IF EXISTS|ON DELETE (CASCADE|SET NULL)|NOT VALID|\bDEFAULT\b|\bINSERT\b|\bUPDATE "|\bDELETE FROM\b|\bTRUNCATE\b/);
});

test('B27c (D-PROD-208): as 12 instruções são EXATAMENTE as do contrato, na ordem — CASCADE, IF EXISTS, DEFAULT na coluna NOT NULL, coluna anulável, outro tipo, CHECK mais largo, FK SET NULL, NOT VALID, uma faltando, trocada de ordem ou outra tabela → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const casos = {
    dropFkCascade: [trocar(SQL_PP, `"AtividadeApontamentoMaoObra_funcionario_fkey";`, `"AtividadeApontamentoMaoObra_funcionario_fkey" CASCADE;`), 0],
    dropIndexIfExists: [trocar(SQL_PP, 'DROP INDEX "AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx";', 'DROP INDEX IF EXISTS "AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx";'), 1],
    dropColunaCascade: [trocar(SQL_PP, 'DROP COLUMN "funcionario_id";', 'DROP COLUMN "funcionario_id" CASCADE;'), 2],
    parceiroComDefault: [trocar(SQL_PP, '"parceiro_id" VARCHAR(64) NOT NULL;', `"parceiro_id" VARCHAR(64) NOT NULL DEFAULT 'x';`), 3],
    parceiroAnulavel: [trocar(SQL_PP, '"parceiro_id" VARCHAR(64) NOT NULL;', '"parceiro_id" VARCHAR(64);'), 3],
    origemOutroTipo: [trocar(SQL_PP, '"origem" VARCHAR(12) NOT NULL;', '"origem" TEXT NOT NULL;'), 4],
    custoOutroTipo: [trocar(SQL_PP, '"funcionario_custo_hora" DECIMAL(14,4);', '"funcionario_custo_hora" DECIMAL(18,4);'), 7],
    checkMaisLargo: [trocar(SQL_PP, "IN ('MENSALISTA', 'DIARISTA', 'TAREFEIRO')", "IN ('MENSALISTA', 'DIARISTA', 'TAREFEIRO', 'CLT')"), 9],
    origemMaisLarga: [trocar(SQL_PP, "IN ('FUNCIONARIO', 'TERCEIRO')", "IN ('FUNCIONARIO', 'TERCEIRO', 'OUTRO')"), 10],
    fkSetNull: [trocar(SQL_PP, 'REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT', 'REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE SET NULL'), 11],
    fkSemTenant: [trocar(SQL_PP, 'FOREIGN KEY ("cliente_id", "parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id")', 'FOREIGN KEY ("parceiro_id") REFERENCES "Fornecedor"("id")'), 11],
    fkNotValid: [trocar(SQL_PP, 'ON DELETE RESTRICT ON UPDATE CASCADE;', 'ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;'), 11],
    semDropColuna: [trocar(SQL_PP, 'ALTER TABLE "AtividadeApontamentoMaoObra" DROP COLUMN "funcionario_id";\n', ''), 2],
    ordemTrocada: [trocar(SQL_PP, 'ALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "parceiro_id" VARCHAR(64) NOT NULL;\nALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "origem" VARCHAR(12) NOT NULL;',
      'ALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "origem" VARCHAR(12) NOT NULL;\nALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "parceiro_id" VARCHAR(64) NOT NULL;'), 3],
    outraTabela: [trocar(SQL_PP, 'ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_cargo" VARCHAR(120);', 'ALTER TABLE "Usuario" ADD COLUMN "funcionario_cargo" VARCHAR(120);'), 6],
    instrucaoAMais: [trocar(SQL_PP, '-- DropForeignKey\n', '-- DropForeignKey\nALTER TABLE "Fornecedor" ADD COLUMN "matricula" VARCHAR(20);\n'), 0],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_PP, caso);
    const c = classificarContractPP(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: `), `${caso}: ${c.violacoes[0].detalhe}`);
  }
  // As instruções pinadas só existem como texto de uma entrada: no caminho EXPAND (outra migration qualquer), o NOT NULL,
  // o DROP, o CHECK e a FK para tabela antiga são recusados.
  for (const a of [ALTER_PP[0], ALTER_PP[2], ALTER_PP[3], CHECK_FORNECEDOR_PP, CHECK_ORIGEM_PP, FK_PP]) {
    assert.equal(classificar(`${BASE}${a};\n`).ok, false, a.slice(0, 60));
  }
});

test('B27d (D-PROD-208): o DROP de Funcionario é a ÚLTIMA instrução, exatamente o do contrato — logo depois da guarda (formato de sempre), antes do índice, CASCADE, IF EXISTS, outra tabela, faltando ou qualquer instrução depois dele → CONTRACT_DROP_FORA_DO_CONTRATO', () => {
  const semDrop = trocar(SQL_PP, `-- DropTable (vazia, conferida pela guarda)\n${DROP_PP}\n`, '');
  const casos = {
    logoDepoisDaGuarda: trocar(semDrop, 'END $$;\n', `END $$;\n${DROP_PP}\n`),
    antesDoIndice: trocar(semDrop, `-- CreateIndex\n${INDICE_PP}`, `${DROP_PP}\n${INDICE_PP}`),
    cascade: trocar(SQL_PP, DROP_PP, 'DROP TABLE "Funcionario" CASCADE;'),
    ifExists: trocar(SQL_PP, DROP_PP, 'DROP TABLE IF EXISTS "Funcionario";'),
    outraTabela: trocar(SQL_PP, DROP_PP, 'DROP TABLE "Servico";'),
    faltando: semDrop,
    selectDepois: `${SQL_PP}\nSELECT 1;\n`,
    outroDropDepois: `${SQL_PP}\nDROP TABLE "Servico";\n`,
    insertDepois: `${SQL_PP}\nINSERT INTO "Fornecedor" ("id") VALUES ('x');\n`,
  };
  for (const [caso, sql] of Object.entries(casos)) {
    const c = classificarContractPP(sql);
    assert.equal(c.ok, false, caso);
    assert.ok(codigos(c).includes('CONTRACT_DROP_FORA_DO_CONTRATO') || codigos(c).includes('CONTRACT_ALTER_FORA_DO_CONTRATO'), `${caso}: ${JSON.stringify(c.violacoes)}`);
  }
  // Os casos de cauda (o arquivo até o índice está intacto) caem exatamente no DROP.
  for (const caso of ['cascade', 'ifExists', 'outraTabela', 'selectDepois', 'outroDropDepois', 'insertDepois', 'antesDoIndice']) {
    const c = classificarContractPP(casos[caso]);
    assert.deepEqual(codigos(c), ['CONTRACT_DROP_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, /^posição 0: esperado DROP TABLE "Funcionario" encontrado/, caso);
  }
  // Comentário e linha em branco depois do DROP não são instrução.
  assert.deepEqual(classificarContractPP(`${SQL_PP}\n-- fim\n\n`).violacoes, []);
  // Sem `drop_no_fim` (o formato de sempre) a mesma entrada exige o DROP logo depois da guarda: o arquivo real não casa.
  const { drop_no_fim: _, ...semCauda } = MIGRATIONS_CONTRACT_APROVADAS[NOME_PP];
  const r = classificarContractPP(SQL_PP, { contratos: { [NOME_PP]: semCauda } });
  assert.deepEqual(codigos(r), ['CONTRACT_DROP_FORA_DO_CONTRATO']);
  assert.match(r.violacoes[0].detalhe, /^posição 0: esperado DROP TABLE "Funcionario"/);
});

test('B27e (D-PROD-208): o resto (entre as 12 e o DROP) é EXPAND — DML, DROP, UNIQUE, CHECK, NOT NULL e FK em tabela antiga recusados como sempre; um índice não-único a mais é aceito', () => {
  const noResto = (ddl) => trocar(SQL_PP, `-- CreateIndex\n${INDICE_PP}`, `-- CreateIndex\n${INDICE_PP}\n${ddl}`);
  const casos = {
    'DELETE FROM "Funcionario";': 'SQL_NAO_RECONHECIDO',
    'UPDATE "Fornecedor" SET "funcionario_tipo" = \'DIARISTA\';': 'SQL_NAO_RECONHECIDO',
    'INSERT INTO "Fornecedor" ("id") VALUES (\'x\');': 'SQL_NAO_RECONHECIDO',
    'TRUNCATE "AtividadeApontamentoMaoObra";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "Servico";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_matricula" VARCHAR(20) NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_x_check" CHECK ("nome" <> \'\');': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AtividadeApontamentoMaoObra" ALTER COLUMN "origem" DROP NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "Fornecedor_x_key" ON "Fornecedor"("cliente_id", "funcionario_cargo");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const c = classificarContractPP(noResto(ddl));
    assert.deepEqual(codigos(c), [codigo], ddl.slice(0, 60));
    assert.deepEqual(c.contract, [CONTRACT_PP]);
  }
  const ok = classificarContractPP(noResto('CREATE INDEX "Fornecedor_cliente_id_funcionario_tipo_idx" ON "Fornecedor"("cliente_id", "funcionario_tipo");'));
  assert.deepEqual(ok.violacoes, []);
});

test('B27f (D-PROD-208): a guarda é a PRIMEIRA instrução e tem o hash pinado — sem a trava, trava fraca, trava de uma só, sem tempo limite ou trava consultiva, sem conferir uma das tabelas vazias ou o formato da Fatia 4 → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE; citando outra tabela ou sem um literal → DO_EM_TABELA_ANTIGA', () => {
  for (const [de, para] of [
    ['  LOCK TABLE public."Funcionario", public."AtividadeApontamentoMaoObra" IN ACCESS EXCLUSIVE MODE;\n', ''],
    ['IN ACCESS EXCLUSIVE MODE;', 'IN SHARE MODE;'],
    ['LOCK TABLE public."Funcionario", public."AtividadeApontamentoMaoObra"', 'LOCK TABLE public."Funcionario"'],
    ["PERFORM set_config('lock_timeout', '5s', true);", "PERFORM set_config('lock_timeout', '0', true);"],
    ["PERFORM set_config('statement_timeout', '120s', true);", "PERFORM set_config('statement_timeout', '0', true);"],
    ['PERFORM pg_advisory_xact_lock(72707369);', 'PERFORM pg_advisory_xact_lock(1);'],
    ['IF EXISTS (SELECT 1 FROM public."Funcionario") THEN', 'IF false THEN'],
    ['IF EXISTS (SELECT 1 FROM public."AtividadeApontamentoMaoObra") THEN', 'IF false THEN'],
    ["AND column_name = 'funcionario_id')", "AND column_name = 'parceiro_id')"],
    [", 'funcionario_custo_diaria')) THEN", ')) THEN'],
  ]) {
    assert.deepEqual(codigos(classificarContractPP(trocar(SQL_PP, de, para))), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], de);
  }
  const inicio = SQL_PP.indexOf('-- Guarda: falha fechada');
  const fim = SQL_PP.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_PP.slice(0, inicio) + SQL_PP.slice(fim);
  assert.ok(!semGuarda.includes('pg_advisory_xact_lock'));
  assert.deepEqual(codigos(classificarContractPP(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  assert.deepEqual(codigos(classificarContractPP(`CREATE INDEX "x_idx" ON "Fornecedor"("id");\n${SQL_PP}`)), ['CONTRACT_GUARDA_AUSENTE']);
  // Guarda (com hash repinado num contrato sintético) que cita outra tabela: só a removida e os 2 literais.
  const outra = trocar(SQL_PP, `OR to_regclass('public."Fornecedor"') IS NULL THEN`, `OR to_regclass('public."Servico"') IS NULL THEN`);
  const corpo = outra.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  const c = classificarContractPP(outra, { contratos: { [NOME_PP]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_PP], guarda_sha256: sha256(corpo) } } });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Servico'), JSON.stringify(c.violacoes));
  const semLiteral = { [NOME_PP]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_PP], literais_guarda: ['AtividadeApontamentoMaoObra'] } };
  const s = classificarMigrations([ler(NOME_PP)], { contratos: semLiteral });
  assert.deepEqual(codigos(s), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(s.violacoes.every((v) => v.detalhe === 'Fornecedor'));
  // 1 byte a mais no arquivo pinado → checksum divergente.
  assert.deepEqual(codigos(classificarMigrations([{ nome: NOME_PP, sql: `${SQL_PP}\n` }])), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B27h (D-PROD-208): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada, ou só com as sete anteriores, o nome real é recusado; os contratos não se servem entre si', () => {
  const outro = '20261116000001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_PP }], { manifesto: { [outro]: sha256(SQL_PP) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.ok(codigos(c).includes('DO_NAO_RECONHECIDO'));
  assert.ok(codigos(c).includes('ALTER_EM_TABELA_ANTIGA'));
  assert.ok(codigos(c).includes('SQL_NAO_RECONHECIDO'));
  assert.equal(classificarMigrations([ler(NOME_PP)], { contratos: {} }).ok, false);
  const anteriores = Object.fromEntries([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V].map((n) => [n, MIGRATIONS_CONTRACT_APROVADAS[n]]));
  assert.equal(classificarMigrations([ler(NOME_PP)], { contratos: anteriores }).ok, false);
  for (const cl of [classificarContract, classificarContractT, classificarContractD, classificarContractK, classificarContractG, classificarContractP, classificarContractV]) {
    assert.ok(codigos(cl(SQL_PP)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  }
  for (const sql of [SQL_C, SQL_T, SQL_D, SQL_K, SQL_G, SQL_P, SQL_V]) assert.ok(codigos(classificarContractPP(sql)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
});

test('B27i (D-PROD-208): conferirReleaseContract — a D-PROD-208 sozinha só com --contract D-PROD-208 exato; junto com outra migration ou com outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-208 sem CONTRACT é inesperado', () => {
  const comPP = classificarMigrations([ler(NOME_PP)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_PP], classificacao: comPP, autorizacao: 'D-PROD-208' }), { ok: true, codigo: null });
  // A decisão que criou a tabela (D-PROD-207) e as CONTRACT anteriores não autorizam esta.
  for (const autorizacao of ['D-PROD-162', 'D-PROD-197', 'D-PROD-200', 'D-PROD-207', '', undefined, null, 'd-prod-208', ' D-PROD-208', 'D-PROD-208 ', 'D-PROD-20', 'D-PROD-2080']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_PP], classificacao: comPP, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  // Junto com a criação da tabela que ela apaga (D-PROD-207): não isolada.
  const comMO = classificarMigrations([ler(NOME_MO), ler(NOME_PP)]);
  assert.deepEqual(comMO.violacoes, []);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_MO, NOME_PP], classificacao: comMO, autorizacao: 'D-PROD-208' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  for (const lote of [[NOME_V, NOME_PP], [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_PP]]) {
    const c = classificarMigrations(lote.map(ler));
    assert.deepEqual(c.violacoes, []);
    assert.equal(c.contract.length, lote.length);
    for (const autorizacao of ['D-PROD-200', 'D-PROD-208', undefined]) {
      assert.deepEqual(conferirReleaseContract({ nomesNovas: lote, classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, `${lote.length} CONTRACT, ${autorizacao}`);
    }
  }
  const semPP = classificarMigrations([ler(NOME_MO)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_MO], classificacao: semPP, autorizacao: 'D-PROD-208' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B27j (D-PROD-208): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-208 só com a D-PROD-208 sozinha e --contract D-PROD-208; outra decisão ou outra CONTRACT junto não autorizam; nunca herdado', () => {
  const comPP = classificarMigrations([ler(NOME_PP)]);
  const comV = classificarMigrations([ler(NOME_V), ler(NOME_PP)]);
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comPP, autorizacao: 'D-PROD-208' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-208');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado');
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-208' };
  for (const [classificacao, autorizacao] of [[comPP, 'D-PROD-207'], [comPP, 'D-PROD-200'], [comPP, undefined], [comPP, 'd-prod-208'], [comPP, ' D-PROD-208 '], [comV, 'D-PROD-208'], [comV, 'D-PROD-200']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B27k (D-PROD-208): contractsPendentes com as oito CONTRACT locais — produção hoje (as sete anteriores concluídas, a D-PROD-200 por último) deixa só a D-PROD-208 pendente; histórico vazio, as oito; aberta ou revertida continua pendente; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP];
  const PEND = { nome: NOME_PP, decisao: 'D-PROD-208' };
  const producao = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO].map((n) => linha(n));
  assert.deepEqual(contractsPendentes({ locais, linhas: producao }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', 'D-PROD-208']);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_PP)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_PP, { finished_at: null })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_PP, { rolled_back_at: new Date() })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_PP), linhas: producao }), []);
});

test('B27l (D-PROD-208): runner real sobre a release do ajuste — análise local declara a tabela, a coluna, a constraint e o índice removidos e as colunas e constraints adicionadas; verificar/aplicar exigem --contract D-PROD-208 exato ANTES de conectar; nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_PP);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    const rotulo = analise.stdout.split('\n').find((l) => l.includes('ANÁLISE LOCAL OK'));
    assert.equal(rotulo, 'premerge-migrate: ANÁLISE LOCAL OK (CONTRACT D-PROD-208: 1 tabela removida, '
      + '1 constraints removidas (AtividadeApontamentoMaoObra.AtividadeApontamentoMaoObra_funcionario_fkey), '
      + '1 índices removidos (AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx), '
      + '1 colunas removidas (AtividadeApontamentoMaoObra.funcionario_id), '
      + `6 colunas adicionadas (${CONTRACT_PP.colunas_adicionadas.join(', ')}), `
      + `3 constraints adicionadas (${CONTRACT_PP.constraints_adicionadas.join(', ')})) — alvo remoto NÃO verificado (isto não autoriza aplicar; use --verificar-alvo)`);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    assert.deepEqual(json.migrations_novas, [NOME_PP]);
    assert.deepEqual(json.contract, [CONTRACT_PP]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-208').status, 0);
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-208');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-207'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-200'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-208'), run(COM_ALVO, '--verificar-alvo', '--contract', ' D-PROD-208 '),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-2080'), run(COM_ALVO, '--verificar-alvo', '--contract'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-208');
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-208');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B27m (D-PROD-208/D-PROD-207): ordem de produção no dia da D-PROD-208 — alvo com as 58 da main concluídas (por último a mão de obra e o serviço, D-PROD-207): o histórico confere, a única pendente é a D-PROD-208 e a barreira do CONTRACT a exige; checksum diferente do arquivo ou registro parcial é divergência; depois dela, 59 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-208 o ajuste era a pasta de nome mais recente; o tipo Terceirizado (D-PROD-209,
  // `20261116100000_funcionario_tipo_terceirizado`, ver B28m) veio depois dela, na release seguinte: 59 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_PP);
  assert.equal(locais.length, 59);
  for (const n of [NOME_TT, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_PP), 'na época, o ajuste era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 58 de B26k (depois da D-PROD-207), na ordem em que foram concluídas; por último a D-PROD-207.
  const fora = [NOME_PP, NOME_MO, NOME_FT, NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_LC, NOME_FT, NOME_MO].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 58);
  assert.equal(linhas.at(-1).migration_name, NOME_MO);
  // A anterior concluída com o checksum do arquivo (o mesmo que o preflight do runbook confere).
  assert.equal(linhas.at(-1).checksum, '79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_PP], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_PP, decisao: 'D-PROD-208' }]);
  const linhaPP = (checksum, extra = {}) => ({ migration_name: NOME_PP, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_MO], 'manual', MIGRATIONS_CONTRACT_APROVADAS[NOME_PP].guarda_sha256]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaPP(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaPP(MIGRATIONS_APROVADAS[NOME_PP], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  const depois = [...linhas, linhaPP(MIGRATIONS_APROVADAS[NOME_PP])];
  assert.equal(depois.length, 59);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B28a (D-PROD-209): o tipo Terceirizado classificado SOZINHO, como na release: ok, modo CONTRACT, nenhuma tabela nova nem coluna no caminho EXPAND, só o CHECK de Fornecedor recriado; nenhuma conversão', () => {
  const c = classificarMigrations([ler(NOME_TT)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_TT]);
  // O arquivo é o auditado, byte a byte; o número da decisão fica fora do migration.sql.
  assert.equal(sha256(SQL_TT), '44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6');
  assert.equal(MIGRATIONS_APROVADAS[NOME_TT], sha256(SQL_TT));
  assert.doesNotMatch(SQL_TT, /D-PROD-\d+/);
  assert.equal((SQL_TT.replace(/--[^\n]*/g, '').match(/DO\s+\$\$/g) ?? []).length, 1);
  // O CHECK novo é o da D-PROD-208 com UMA troca: TERCEIRIZADO no lugar de TAREFEIRO (o resto não muda).
  assert.equal(CHECK_TT, CHECK_FORNECEDOR_PP.split("'TAREFEIRO'").join("'TERCEIRIZADO'"));
  assert.notEqual(CHECK_TT, CHECK_FORNECEDOR_PP);
  assert.ok(MIGRATIONS_CONTRACT_APROVADAS[NOME_PP].alter_antigas.includes(CHECK_FORNECEDOR_PP));
});

test('B28b (D-PROD-209): a entrada é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP TABLE, os 2 literais, as 2 instruções na ordem, nenhuma conversão nem drop_no_fim; a guarda trava Fornecedor antes de conferir o TAREFEIRO; resto vazio', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_TT];
  assert.ok(NOME_TT in MIGRATIONS_APROVADAS);
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-209');
  assert.equal(k.guarda_sha256, '93612d85d6cc9ec3c39b9586619deedb8db72e5198d1ab64fa3ee9d8e911cca9');
  assert.deepEqual(k.drop, []);
  assert.equal(k.drop_no_fim, undefined);
  assert.equal(k.conversao, undefined);
  assert.deepEqual(k.literais_guarda, ['Fornecedor', 'TAREFEIRO']);
  assert.deepEqual(k.alter_antigas, ALTER_TT);
  assert.ok(k.alter_antigas.every((a) => !a.includes(';') && a === a.replace(/\s+/g, ' ').trim()), 'texto normalizado, sem o ";"');
  const semComent = SQL_TT.replace(/--[^\n]*/g, '');
  assert.ok(semComent.trimStart().startsWith('DO $$'));
  const corpo = semComent.match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  assert.equal(sha256(corpo), k.guarda_sha256);
  const depois = semComent.slice(semComent.indexOf('END $$;') + 'END $$;'.length).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(depois, ALTER_TT);
  // A guarda só cita Fornecedor e o valor que sai; trava Fornecedor em ACCESS EXCLUSIVE ANTES de conferir as linhas.
  const citadas = [...new Set([...corpo.matchAll(/'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g)].map((x) => x[1] ?? x[2]))].sort();
  assert.deepEqual(citadas, ['Fornecedor', 'TAREFEIRO']);
  assert.ok(corpo.startsWith("BEGIN PERFORM set_config('lock_timeout', '5s', true); PERFORM set_config('statement_timeout', '120s', true); PERFORM pg_advisory_xact_lock(72707369);"));
  const formato = corpo.indexOf("AND conname = 'Fornecedor_funcionario_check' AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%''TAREFEIRO''%') THEN");
  const trava = corpo.indexOf('LOCK TABLE public."Fornecedor" IN ACCESS EXCLUSIVE MODE;');
  const linhas = corpo.indexOf(`IF EXISTS (SELECT 1 FROM public."Fornecedor" WHERE "funcionario_tipo" = 'TAREFEIRO') THEN`);
  assert.ok(formato > 0 && trava > formato && linhas > trava, 'o formato, depois a trava, depois a conferência de conteúdo');
  const semGuarda = semComent.slice(semComent.indexOf('END $$;'));
  assert.doesNotMatch(semGuarda, /CASCADE|IF EXISTS|NOT VALID|\bDEFAULT\b|\bINSERT\b|\bUPDATE "|\bDELETE FROM\b|\bTRUNCATE\b|DROP TABLE|DROP COLUMN|ADD COLUMN/);
});

test('B28c (D-PROD-209): as 2 instruções são EXATAMENTE as do contrato, na ordem — CHECK com TAREFEIRO de volta ou junto, outro valor, NOT VALID, IF EXISTS, CASCADE, outro nome, ordem trocada, uma faltando, outra tabela ou instrução a mais → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const casos = {
    checkAindaTarefeiro: [trocar(SQL_TT, "'DIARISTA', 'TERCEIRIZADO'))", "'DIARISTA', 'TAREFEIRO'))"), 1],
    checkComOsDois: [trocar(SQL_TT, "'DIARISTA', 'TERCEIRIZADO'))", "'DIARISTA', 'TAREFEIRO', 'TERCEIRIZADO'))"), 1],
    outroValor: [trocar(SQL_TT, "'TERCEIRIZADO'", "'TERCEIRO'"), 1],
    semCusto: [trocar(SQL_TT, ' AND ("funcionario_custo_diaria" IS NULL OR "funcionario_custo_diaria" >= 0));', ');'), 1],
    notValid: [trocar(SQL_TT, '"funcionario_custo_diaria" >= 0));', '"funcionario_custo_diaria" >= 0)) NOT VALID;'), 1],
    dropIfExists: [trocar(SQL_TT, 'DROP CONSTRAINT "Fornecedor_funcionario_check";', 'DROP CONSTRAINT IF EXISTS "Fornecedor_funcionario_check";'), 0],
    dropCascade: [trocar(SQL_TT, 'DROP CONSTRAINT "Fornecedor_funcionario_check";', 'DROP CONSTRAINT "Fornecedor_funcionario_check" CASCADE;'), 0],
    outroNome: [trocar(SQL_TT, 'ADD CONSTRAINT "Fornecedor_funcionario_check"', 'ADD CONSTRAINT "Fornecedor_funcionario_tipo_check"'), 1],
    semDrop: [trocar(SQL_TT, `${DROP_CHECK_TT};\n`, ''), 0],
    ordemTrocada: [trocar(SQL_TT, `${DROP_CHECK_TT};\n${CHECK_TT};`, `${CHECK_TT};\n${DROP_CHECK_TT};`), 0],
    outraTabela: [trocar(SQL_TT, `${DROP_CHECK_TT};`, 'ALTER TABLE "Usuario" DROP CONSTRAINT "Fornecedor_funcionario_check";'), 0],
    instrucaoAntes: [trocar(SQL_TT, '-- AlterTable (o CHECK volta igual', 'ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_matricula" VARCHAR(20);\n-- AlterTable (o CHECK volta igual'), 0],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_TT, caso);
    const c = classificarContractTT(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: `), `${caso}: ${c.violacoes[0].detalhe}`);
  }
  // As 2 instruções só existem como texto de uma entrada: no caminho EXPAND, DROP e CHECK em tabela antiga são recusados.
  for (const a of ALTER_TT) assert.equal(classificar(`${BASE}${a};\n`).ok, false, a.slice(0, 60));
});

test('B28d (D-PROD-209): depois das 2 instruções, o resto é EXPAND — DML, DROP, CHECK, NOT NULL, UNIQUE em tabela antiga recusados como sempre; um índice não-único a mais é aceito', () => {
  const noResto = (ddl) => `${SQL_TT}\n${ddl}\n`;
  const casos = {
    'UPDATE "Fornecedor" SET "funcionario_tipo" = \'TERCEIRIZADO\' WHERE "funcionario_tipo" = \'TAREFEIRO\';': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "Fornecedor";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "Servico";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_x_check" CHECK ("nome" <> \'\');': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_matricula" VARCHAR(20) NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Fornecedor" ALTER COLUMN "funcionario_tipo" SET NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "Fornecedor_x_key" ON "Fornecedor"("cliente_id", "funcionario_tipo");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const c = classificarContractTT(noResto(ddl));
    assert.deepEqual(codigos(c), [codigo], ddl.slice(0, 60));
    assert.deepEqual(c.contract, [CONTRACT_TT]);
  }
  assert.deepEqual(classificarContractTT(noResto('CREATE INDEX "Fornecedor_cliente_id_funcionario_tipo_idx" ON "Fornecedor"("cliente_id", "funcionario_tipo");')).violacoes, []);
  assert.deepEqual(classificarContractTT(`${SQL_TT}\n-- fim\n\n`).violacoes, []);
});

test('B28f (D-PROD-209): a guarda é a PRIMEIRA instrução e tem o hash pinado — sem a trava, trava fraca, sem tempo limite ou trava consultiva, sem conferir o TAREFEIRO nas linhas ou o formato do CHECK → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE; citando outra tabela ou sem um literal → DO_EM_TABELA_ANTIGA', () => {
  for (const [de, para] of [
    ['  LOCK TABLE public."Fornecedor" IN ACCESS EXCLUSIVE MODE;\n', ''],
    ['IN ACCESS EXCLUSIVE MODE;', 'IN SHARE MODE;'],
    ["PERFORM set_config('lock_timeout', '5s', true);", "PERFORM set_config('lock_timeout', '0', true);"],
    ["PERFORM set_config('statement_timeout', '120s', true);", "PERFORM set_config('statement_timeout', '0', true);"],
    ['PERFORM pg_advisory_xact_lock(72707369);', 'PERFORM pg_advisory_xact_lock(1);'],
    [`IF EXISTS (SELECT 1 FROM public."Fornecedor" WHERE "funcionario_tipo" = 'TAREFEIRO') THEN`, 'IF false THEN'],
    ["AND pg_get_constraintdef(oid) LIKE '%''TAREFEIRO''%') THEN", ') THEN'],
  ]) {
    assert.deepEqual(codigos(classificarContractTT(trocar(SQL_TT, de, para))), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], de);
  }
  const inicio = SQL_TT.indexOf('-- Guarda: falha fechada');
  const fim = SQL_TT.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_TT.slice(0, inicio) + SQL_TT.slice(fim);
  assert.ok(!semGuarda.includes('pg_advisory_xact_lock'));
  assert.deepEqual(codigos(classificarContractTT(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  assert.deepEqual(codigos(classificarContractTT(`CREATE INDEX "x_idx" ON "Fornecedor"("id");\n${SQL_TT}`)), ['CONTRACT_GUARDA_AUSENTE']);
  // Guarda (com hash repinado num contrato sintético) que cita outra tabela: só Fornecedor e 'TAREFEIRO'.
  const outra = trocar(SQL_TT, `IF to_regclass('public."Fornecedor"') IS NULL THEN`, `IF to_regclass('public."Usuario"') IS NULL THEN`);
  const corpo = outra.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  const c = classificarContractTT(outra, { contratos: { [NOME_TT]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_TT], guarda_sha256: sha256(corpo) } } });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Usuario'), JSON.stringify(c.violacoes));
  const semLiteral = { [NOME_TT]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_TT], literais_guarda: ['Fornecedor'] } };
  const s = classificarMigrations([ler(NOME_TT)], { contratos: semLiteral });
  assert.deepEqual(codigos(s), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(s.violacoes.every((v) => v.detalhe === 'TAREFEIRO'));
  // 1 byte a mais no arquivo pinado → checksum divergente.
  assert.deepEqual(codigos(classificarMigrations([{ nome: NOME_TT, sql: `${SQL_TT}\n` }])), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B28h (D-PROD-209): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada, ou só com as oito anteriores, o nome real é recusado; os contratos não se servem entre si', () => {
  const outro = '20261116100001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_TT }], { manifesto: { [outro]: sha256(SQL_TT) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  assert.ok(codigos(c).includes('DO_NAO_RECONHECIDO'));
  assert.ok(codigos(c).includes('ALTER_EM_TABELA_ANTIGA'));
  assert.equal(classificarMigrations([ler(NOME_TT)], { contratos: {} }).ok, false);
  const anteriores = Object.fromEntries([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_PP].map((n) => [n, MIGRATIONS_CONTRACT_APROVADAS[n]]));
  assert.equal(classificarMigrations([ler(NOME_TT)], { contratos: anteriores }).ok, false);
  for (const cl of [classificarContract, classificarContractT, classificarContractD, classificarContractK, classificarContractG, classificarContractP, classificarContractV, classificarContractPP]) {
    assert.ok(codigos(cl(SQL_TT)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  }
  for (const sql of [SQL_C, SQL_T, SQL_D, SQL_K, SQL_G, SQL_P, SQL_V, SQL_PP]) assert.ok(codigos(classificarContractTT(sql)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
});

test('B28i (D-PROD-209): conferirReleaseContract — a D-PROD-209 sozinha só com --contract D-PROD-209 exato; junto com a D-PROD-208 ou outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-209 sem CONTRACT é inesperado', () => {
  const comTT = classificarMigrations([ler(NOME_TT)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_TT], classificacao: comTT, autorizacao: 'D-PROD-209' }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-162', 'D-PROD-200', 'D-PROD-208', '', undefined, null, 'd-prod-209', ' D-PROD-209', 'D-PROD-209 ', 'D-PROD-20', 'D-PROD-2090']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_TT], classificacao: comTT, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  for (const lote of [[NOME_PP, NOME_TT], [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_PP, NOME_TT]]) {
    const c = classificarMigrations(lote.map(ler));
    assert.deepEqual(c.violacoes, []);
    assert.equal(c.contract.length, lote.length);
    for (const autorizacao of ['D-PROD-208', 'D-PROD-209', undefined]) {
      assert.deepEqual(conferirReleaseContract({ nomesNovas: lote, classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, `${lote.length} CONTRACT, ${autorizacao}`);
    }
  }
  const semTT = classificarMigrations([ler(NOME_MO)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_MO], classificacao: semTT, autorizacao: 'D-PROD-209' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B28j (D-PROD-209): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-209 só com a D-PROD-209 sozinha e --contract D-PROD-209; outra decisão ou outra CONTRACT junto não autorizam; nunca herdado', () => {
  const comTT = classificarMigrations([ler(NOME_TT)]);
  const comPP = classificarMigrations([ler(NOME_PP), ler(NOME_TT)]);
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comTT, autorizacao: 'D-PROD-209' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-209');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado');
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-209' };
  for (const [classificacao, autorizacao] of [[comTT, 'D-PROD-208'], [comTT, undefined], [comTT, 'd-prod-209'], [comTT, ' D-PROD-209 '], [comPP, 'D-PROD-209'], [comPP, 'D-PROD-208']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B28k (D-PROD-209): contractsPendentes com as nove CONTRACT locais — produção hoje (as oito anteriores concluídas, a D-PROD-208 por último) deixa só a D-PROD-209 pendente; histórico vazio, as nove; aberta ou revertida continua pendente; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP, NOME_TT];
  const PEND = { nome: NOME_TT, decisao: 'D-PROD-209' };
  const producao = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP].map((n) => linha(n));
  assert.deepEqual(contractsPendentes({ locais, linhas: producao }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', 'D-PROD-208', 'D-PROD-209']);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_TT)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_TT, { finished_at: null })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_TT, { rolled_back_at: new Date() })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_TT), linhas: producao }), []);
});

test('B28l (D-PROD-209): runner real sobre a release do tipo Terceirizado — análise local declara o CHECK recriado; verificar/aplicar exigem --contract D-PROD-209 exato ANTES de conectar; nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_TT);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    const rotulo = analise.stdout.split('\n').find((l) => l.includes('ANÁLISE LOCAL OK'));
    assert.equal(rotulo, 'premerge-migrate: ANÁLISE LOCAL OK (CONTRACT D-PROD-209: 1 CHECKs alargados) — alvo remoto NÃO verificado (isto não autoriza aplicar; use --verificar-alvo)');
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    assert.deepEqual(json.migrations_novas, [NOME_TT]);
    assert.deepEqual(json.contract, [CONTRACT_TT]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-209').status, 0);
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-209');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-208'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-200'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-209'), run(COM_ALVO, '--verificar-alvo', '--contract', ' D-PROD-209 '),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-2090'), run(COM_ALVO, '--verificar-alvo', '--contract'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-209');
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-209');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B28m (D-PROD-209/D-PROD-208): ordem de produção no dia da D-PROD-209 — alvo com as 59 da main concluídas (por último o ajuste da Fatia 4, D-PROD-208): o histórico confere, a única pendente é a D-PROD-209 e a barreira do CONTRACT a exige; checksum diferente do arquivo ou registro parcial é divergência; depois dela, 60 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-209 o tipo Terceirizado era a pasta de nome mais recente; a base do consumo (D-PROD-210,
  // `20261116200000_formulacao_base_consumo`, ver B29m) e o abastecimento ligado à atividade (D-PROD-211,
  // `20261116300000_abastecimento_atividade`, ver B30m) vieram depois dela, nas releases seguintes: 60 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_TT);
  assert.equal(locais.length, 60);
  for (const n of [NOME_BC, NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_TT), 'na época, o tipo Terceirizado era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 59 de B27m (depois da D-PROD-208), na ordem em que foram concluídas; por último a D-PROD-208.
  const fora = [NOME_TT, NOME_PP, NOME_MO, NOME_FT, NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_LC, NOME_FT, NOME_MO, NOME_PP].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 59);
  assert.equal(linhas.at(-1).migration_name, NOME_PP);
  // A anterior concluída com o checksum do arquivo (o mesmo que o preflight do runbook confere).
  assert.equal(linhas.at(-1).checksum, '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_TT], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_TT, decisao: 'D-PROD-209' }]);
  const linhaTT = (checksum, extra = {}) => ({ migration_name: NOME_TT, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_PP], 'manual', MIGRATIONS_CONTRACT_APROVADAS[NOME_TT].guarda_sha256]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaTT(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaTT(MIGRATIONS_APROVADAS[NOME_TT], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  const depois = [...linhas, linhaTT(MIGRATIONS_APROVADAS[NOME_TT])];
  assert.equal(depois.length, 60);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B30a (D-PROD-211): o abastecimento ligado à atividade classificado SOZINHO, como na release: ok, modo CONTRACT, nenhuma tabela nova nem coluna no caminho EXPAND; as 7 colunas, o CHECK de status recriado e as 6 constraints novas no descritor; nenhuma conversão', () => {
  const c = classificarMigrations([ler(NOME_AB)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_AB]);
  // O arquivo é o auditado, byte a byte; o número da decisão fica fora do migration.sql.
  assert.equal(sha256(SQL_AB), '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436');
  assert.equal(MIGRATIONS_APROVADAS[NOME_AB], sha256(SQL_AB));
  assert.doesNotMatch(SQL_AB, /D-PROD-\d+/);
  assert.equal((SQL_AB.replace(/--[^\n]*/g, '').match(/DO\s+\$\$/g) ?? []).length, 1);
});

test('B30b (D-PROD-211): a entrada é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP TABLE, os 5 literais, as 18 instruções na ordem, nenhuma conversão nem drop_no_fim; a guarda confere o formato e trava AbastecimentoBem; o resto são só os 3 índices', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_AB];
  assert.ok(NOME_AB in MIGRATIONS_APROVADAS);
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-211');
  assert.equal(k.guarda_sha256, '3f5a3a37959e571e3d2ee68cd2ec87e15138aa1b59903db0f13dbe4c90b502fa');
  assert.deepEqual(k.drop, []);
  assert.equal(k.drop_no_fim, undefined);
  assert.equal(k.conversao, undefined);
  assert.deepEqual(k.literais_guarda, ['AbastecimentoBem', 'Atividade', 'AtividadeApontamento', 'CentroCusto', 'BemPatrimonial']);
  assert.deepEqual(k.alter_antigas, ALTER_AB);
  assert.equal(k.alter_antigas.length, 18);
  assert.ok(k.alter_antigas.every((a) => !a.includes(';') && a === a.replace(/\s+/g, ' ').trim()), 'texto normalizado, sem o ";"');
  const semComent = SQL_AB.replace(/--[^\n]*/g, '');
  assert.ok(semComent.trimStart().startsWith('DO $$'));
  const corpo = semComent.match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  assert.equal(sha256(corpo), k.guarda_sha256);
  const depois = semComent.slice(semComent.indexOf('END $$;') + 'END $$;'.length).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(depois, [...ALTER_AB, ...INDICES_AB]);
  // A guarda só cita as 5 tabelas; confere o formato (colunas, NOT NULL, CHECKs) e só então trava AbastecimentoBem.
  const citadas = [...new Set([...corpo.matchAll(/'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g)].map((x) => x[1] ?? x[2]))].sort();
  assert.deepEqual(citadas, [...k.literais_guarda].sort());
  assert.ok(corpo.startsWith("BEGIN PERFORM set_config('lock_timeout', '5s', true); PERFORM set_config('statement_timeout', '120s', true); PERFORM pg_advisory_xact_lock(72707369);"));
  const colunas = corpo.indexOf("column_name IN ('origem', 'atividade_id', 'apontamento_id', 'centro_custo_id', 'medidor_leitura_anterior', 'medidor_delta', 'intervalo_confiavel'))");
  const notNull = corpo.indexOf("AND attname IN ('local_estoque_id', 'movimentacao_estoque_id') AND attnotnull AND NOT attisdropped) <> 2 THEN");
  const status = corpo.indexOf("AND conname = 'AbastecimentoBem_status_check' AND contype = 'c' AND pg_get_constraintdef(oid) NOT LIKE '%origem%')");
  const novos = corpo.indexOf("AND conname IN ('AbastecimentoBem_origem_check', 'AbastecimentoBem_atividade_check', 'AbastecimentoBem_intervalo_check')) THEN");
  const trava = corpo.indexOf('LOCK TABLE public."AbastecimentoBem" IN ACCESS EXCLUSIVE MODE; END');
  assert.ok(colunas > 0 && notNull > colunas && status > notNull && novos > status && trava > novos, 'o formato inteiro, depois a trava');
  const semGuarda = semComent.slice(semComent.indexOf('END $$;'));
  assert.doesNotMatch(semGuarda, /ON DELETE (CASCADE|SET NULL)|" CASCADE;|IF EXISTS|NOT VALID|\bINSERT\b|\bDELETE FROM\b|\bTRUNCATE\b|DROP TABLE|DROP COLUMN|SET NOT NULL|UNIQUE/);
  assert.equal(semGuarda.split('UPDATE "').length, 2, 'um só UPDATE: o backfill do centro de custo');
});

test('B30c (D-PROD-211): as 18 instruções são EXATAMENTE as do contrato, na ordem — DEFAULT ou tipo trocado, outra coluna, backfill sem a empresa, CHECK de status exigindo o estorno sempre, CHECK de origem frouxo, delta sem > 0, NOT VALID, IF EXISTS, SET NULL, FK sem a empresa, ordem trocada, uma faltando, outra tabela ou instrução a mais → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const casos = {
    origemSemDefault: [trocar(SQL_AB, `"origem" VARCHAR(8) NOT NULL DEFAULT 'ESTOQUE';`, '"origem" VARCHAR(8) NOT NULL;'), 0],
    origemOutroTipo: [trocar(SQL_AB, `"origem" VARCHAR(8) NOT NULL DEFAULT 'ESTOQUE';`, `"origem" VARCHAR(16) NOT NULL DEFAULT 'ESTOQUE';`), 0],
    instrucaoAntes: [trocar(SQL_AB, '-- AlterTable (origem e intervalo_confiavel', 'ALTER TABLE "AbastecimentoBem" ADD COLUMN "posto" VARCHAR(64);\n-- AlterTable (origem e intervalo_confiavel'), 0],
    outraTabela: [trocar(SQL_AB, 'ALTER TABLE "AbastecimentoBem" ADD COLUMN "atividade_id"', 'ALTER TABLE "BemPatrimonial" ADD COLUMN "atividade_id"'), 1],
    intervaloTrue: [trocar(SQL_AB, '"intervalo_confiavel" BOOLEAN NOT NULL DEFAULT false;', '"intervalo_confiavel" BOOLEAN NOT NULL DEFAULT true;'), 6],
    outraColunaAnulavel: [trocar(SQL_AB, '"local_estoque_id" DROP NOT NULL;', '"produto_id" DROP NOT NULL;'), 7],
    ordemTrocada: [trocar(SQL_AB, 'ALTER TABLE "AbastecimentoBem" ALTER COLUMN "local_estoque_id" DROP NOT NULL;\nALTER TABLE "AbastecimentoBem" ALTER COLUMN "movimentacao_estoque_id" DROP NOT NULL;', 'ALTER TABLE "AbastecimentoBem" ALTER COLUMN "movimentacao_estoque_id" DROP NOT NULL;\nALTER TABLE "AbastecimentoBem" ALTER COLUMN "local_estoque_id" DROP NOT NULL;'), 7],
    backfillSemEmpresa: [trocar(SQL_AB, 'b."empresa_id" = a."empresa_id" AND ', ''), 9],
    semBackfill: [trocar(SQL_AB, /^UPDATE "AbastecimentoBem" AS a .*;\n/m.exec(SQL_AB)[0], ''), 9],
    dropIfExists: [trocar(SQL_AB, 'DROP CONSTRAINT "AbastecimentoBem_status_check";', 'DROP CONSTRAINT IF EXISTS "AbastecimentoBem_status_check";'), 10],
    statusEstornoSempre: [trocar(SQL_AB, `("origem" = 'EXTERNO' OR "movimentacao_estorno_id" IS NOT NULL)`, '"movimentacao_estorno_id" IS NOT NULL'), 11],
    externoComLocal: [trocar(SQL_AB, `"origem" = 'EXTERNO' AND "local_estoque_id" IS NULL AND `, `"origem" = 'EXTERNO' AND `), 12],
    notValid: [trocar(SQL_AB, '"atividade_id" IS NOT NULL);', '"atividade_id" IS NOT NULL) NOT VALID;'), 13],
    deltaSemPositivo: [trocar(SQL_AB, ' AND "medidor_delta" > 0)))', ')))'), 14],
    fkSetNull: [trocar(SQL_AB, 'REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT', 'REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE SET NULL'), 15],
    fkSemEmpresa: [trocar(SQL_AB, 'FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id")', 'FOREIGN KEY ("cliente_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "id")'), 17],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_AB, caso);
    const c = classificarContractAB(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: `), `${caso}: ${c.violacoes[0].detalhe}`);
  }
  // As instruções só existem como texto de uma entrada: no caminho EXPAND, coluna NOT NULL DEFAULT, ALTER COLUMN, DML,
  // DROP/CHECK e FK para tabela antiga são recusados; só as 5 colunas anuláveis sem DEFAULT a allowlist aceitaria sozinhas.
  const anulaveis = ALTER_AB.filter((a) => /ADD COLUMN "[a-z_]+" (VARCHAR\(64\)|DECIMAL\(14,4\))$/.test(a));
  assert.equal(anulaveis.length, 5);
  for (const a of ALTER_AB) assert.equal(classificar(`${BASE}${a};\n`).ok, anulaveis.includes(a), a.slice(0, 60));
});

test('B30d (D-PROD-211): depois das 18 instruções, o resto é EXPAND — DML, DROP, CHECK, NOT NULL, UNIQUE e FK para tabela antiga recusados como sempre; um índice não-único a mais é aceito', () => {
  const noResto = (ddl) => `${SQL_AB}\n${ddl}\n`;
  const casos = {
    'UPDATE "AbastecimentoBem" SET "origem" = \'EXTERNO\';': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "AbastecimentoBem";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "AbastecimentoBemConsumoLote";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_x_check" CHECK ("origem" <> \'\');': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AbastecimentoBem" ALTER COLUMN "local_estoque_id" SET NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AbastecimentoBem" ADD COLUMN "posto" VARCHAR(64) NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_y_fkey" FOREIGN KEY ("cliente_id", "atividade_id") REFERENCES "Atividade"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "AbastecimentoBem_x_key" ON "AbastecimentoBem"("cliente_id", "apontamento_id");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const c = classificarContractAB(noResto(ddl));
    assert.deepEqual(codigos(c), [codigo], ddl.slice(0, 60));
    assert.deepEqual(c.contract, [CONTRACT_AB]);
  }
  assert.deepEqual(classificarContractAB(noResto('CREATE INDEX "AbastecimentoBem_cliente_id_origem_idx" ON "AbastecimentoBem"("cliente_id", "origem");')).violacoes, []);
  assert.deepEqual(classificarContractAB(`${SQL_AB}\n-- fim\n\n`).violacoes, []);
});

test('B30f (D-PROD-211): a guarda é a PRIMEIRA instrução e tem o hash pinado — sem a trava, trava fraca, sem tempo limite ou trava consultiva, sem conferir o CHECK de status antigo ou o NOT NULL → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE; citando outra tabela ou sem um literal → DO_EM_TABELA_ANTIGA', () => {
  for (const [de, para] of [
    ['  LOCK TABLE public."AbastecimentoBem" IN ACCESS EXCLUSIVE MODE;\n', ''],
    ['IN ACCESS EXCLUSIVE MODE;', 'IN SHARE MODE;'],
    ["PERFORM set_config('lock_timeout', '5s', true);", "PERFORM set_config('lock_timeout', '0', true);"],
    ["PERFORM set_config('statement_timeout', '120s', true);", "PERFORM set_config('statement_timeout', '0', true);"],
    ['PERFORM pg_advisory_xact_lock(72707369);', 'PERFORM pg_advisory_xact_lock(1);'],
    ["AND pg_get_constraintdef(oid) NOT LIKE '%origem%')", ')'],
    ['AND attnotnull AND NOT attisdropped) <> 2 THEN', 'AND NOT attisdropped) <> 2 THEN'],
  ]) {
    assert.deepEqual(codigos(classificarContractAB(trocar(SQL_AB, de, para))), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], de);
  }
  const inicio = SQL_AB.indexOf('-- Guarda: falha fechada');
  const fim = SQL_AB.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_AB.slice(0, inicio) + SQL_AB.slice(fim);
  assert.ok(!semGuarda.includes('pg_advisory_xact_lock'));
  assert.deepEqual(codigos(classificarContractAB(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  assert.deepEqual(codigos(classificarContractAB(`CREATE INDEX "x_idx" ON "AbastecimentoBem"("id");\n${SQL_AB}`)), ['CONTRACT_GUARDA_AUSENTE']);
  // Guarda (com hash repinado num contrato sintético) que cita outra tabela: só as 5 da entrada.
  const outra = trocar(SQL_AB, `OR to_regclass('public."BemPatrimonial"') IS NULL THEN`, `OR to_regclass('public."Usuario"') IS NULL THEN`);
  const corpo = outra.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  const c = classificarContractAB(outra, { contratos: { [NOME_AB]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_AB], guarda_sha256: sha256(corpo) } } });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Usuario'), JSON.stringify(c.violacoes));
  const semLiteral = { [NOME_AB]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_AB], literais_guarda: ['AbastecimentoBem', 'Atividade', 'AtividadeApontamento', 'CentroCusto'] } };
  const s = classificarMigrations([ler(NOME_AB)], { contratos: semLiteral });
  assert.deepEqual(codigos(s), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(s.violacoes.every((v) => v.detalhe === 'BemPatrimonial'));
  // 1 byte a mais no arquivo pinado → checksum divergente.
  assert.deepEqual(codigos(classificarMigrations([{ nome: NOME_AB, sql: `${SQL_AB}\n` }])), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B30h (D-PROD-211): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada, ou só com as dez anteriores, o nome real é recusado; os contratos não se servem entre si', () => {
  const outro = '20261116200001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_AB }], { manifesto: { [outro]: sha256(SQL_AB) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  for (const codigo of ['DO_NAO_RECONHECIDO', 'ALTER_EM_TABELA_ANTIGA', 'SQL_NAO_RECONHECIDO']) assert.ok(codigos(c).includes(codigo), codigo);
  assert.equal(classificarMigrations([ler(NOME_AB)], { contratos: {} }).ok, false);
  const anteriores = Object.fromEntries([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_PP, NOME_TT, NOME_BC].map((n) => [n, MIGRATIONS_CONTRACT_APROVADAS[n]]));
  assert.equal(classificarMigrations([ler(NOME_AB)], { contratos: anteriores }).ok, false);
  for (const cl of [classificarContract, classificarContractT, classificarContractD, classificarContractK, classificarContractG, classificarContractP, classificarContractV, classificarContractPP, classificarContractTT, classificarContractDe(NOME_BC)]) {
    assert.ok(codigos(cl(SQL_AB)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  }
  for (const sql of [SQL_C, SQL_T, SQL_D, SQL_K, SQL_G, SQL_P, SQL_V, SQL_PP, SQL_TT, SQL_BC]) assert.ok(codigos(classificarContractAB(sql)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
});

test('B30i (D-PROD-211): conferirReleaseContract — a D-PROD-211 sozinha só com --contract D-PROD-211 exato; junto com a D-PROD-210 ou outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-211 sem CONTRACT é inesperado', () => {
  const comAB = classificarMigrations([ler(NOME_AB)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_AB], classificacao: comAB, autorizacao: 'D-PROD-211' }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-162', 'D-PROD-200', 'D-PROD-209', 'D-PROD-210', '', undefined, null, 'd-prod-211', ' D-PROD-211', 'D-PROD-211 ', 'D-PROD-21', 'D-PROD-2110']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_AB], classificacao: comAB, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  for (const lote of [[NOME_BC, NOME_AB], [NOME_TT, NOME_AB], [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_PP, NOME_TT, NOME_BC, NOME_AB]]) {
    const c = classificarMigrations(lote.map(ler));
    assert.deepEqual(c.violacoes, []);
    assert.equal(c.contract.length, lote.length);
    for (const autorizacao of ['D-PROD-210', 'D-PROD-211', undefined]) {
      assert.deepEqual(conferirReleaseContract({ nomesNovas: lote, classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, `${lote.length} CONTRACT, ${autorizacao}`);
    }
  }
  const semAB = classificarMigrations([ler(NOME_MO)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_MO], classificacao: semAB, autorizacao: 'D-PROD-211' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B30j (D-PROD-211): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-211 só com a D-PROD-211 sozinha e --contract D-PROD-211; outra decisão ou outra CONTRACT junto não autorizam; nunca herdado', () => {
  const comAB = classificarMigrations([ler(NOME_AB)]);
  const comBC = classificarMigrations([ler(NOME_BC), ler(NOME_AB)]);
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comAB, autorizacao: 'D-PROD-211' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-211');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado');
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-211' };
  for (const [classificacao, autorizacao] of [[comAB, 'D-PROD-210'], [comAB, undefined], [comAB, 'd-prod-211'], [comAB, ' D-PROD-211 '], [comBC, 'D-PROD-211'], [comBC, 'D-PROD-210']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B30k (D-PROD-211): contractsPendentes com as onze CONTRACT locais — produção hoje (as dez anteriores concluídas, a D-PROD-210 por último) deixa só a D-PROD-211 pendente; histórico vazio, as onze; aberta ou revertida continua pendente; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB];
  const PEND = { nome: NOME_AB, decisao: 'D-PROD-211' };
  const producao = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP, NOME_TT, NOME_BC].map((n) => linha(n));
  assert.deepEqual(contractsPendentes({ locais, linhas: producao }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', 'D-PROD-208', 'D-PROD-209', 'D-PROD-210', 'D-PROD-211']);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_AB)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_AB, { finished_at: null })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_AB, { rolled_back_at: new Date() })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_AB), linhas: producao }), []);
});

test('B30l (D-PROD-211): runner real sobre a release do abastecimento ligado à atividade — análise local declara o CHECK recriado, as 7 colunas e as 6 constraints; verificar/aplicar exigem --contract D-PROD-211 exato ANTES de conectar; nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_AB);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    const rotulo = analise.stdout.split('\n').find((l) => l.includes('ANÁLISE LOCAL OK'));
    const partes = [
      '1 CHECKs alargados',
      `7 colunas adicionadas (${CONTRACT_AB.colunas_adicionadas.join(', ')})`,
      `6 constraints adicionadas (${CONTRACT_AB.constraints_adicionadas.join(', ')})`,
    ];
    assert.equal(rotulo, `premerge-migrate: ANÁLISE LOCAL OK (CONTRACT D-PROD-211: ${partes.join(', ')}) — alvo remoto NÃO verificado (isto não autoriza aplicar; use --verificar-alvo)`);
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    assert.deepEqual(json.migrations_novas, [NOME_AB]);
    assert.deepEqual(json.contract, [CONTRACT_AB]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-211').status, 0);
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-211');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-210'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-200'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-211'), run(COM_ALVO, '--verificar-alvo', '--contract', ' D-PROD-211 '),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-2110'), run(COM_ALVO, '--verificar-alvo', '--contract'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-211');
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-211');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B30m (D-PROD-211/D-PROD-210): ordem de produção no dia da D-PROD-211 — alvo com as 61 da main concluídas (por último a base do consumo, D-PROD-210): o histórico confere, a única pendente é a D-PROD-211 e a barreira do CONTRACT a exige; checksum diferente do arquivo ou registro parcial é divergência; depois dela, 62 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-211 o abastecimento ligado à atividade era a pasta de nome mais recente; o Cadastro de Culturas
  // (D-PROD-215, `20261116500000_cadculturas`, ver B31k) e o reforço (D-PROD-216,
  // `20261116600000_abastecimento_fk_apontamento_atividade`, ver B32m) vieram depois dele, em releases seguintes: 62 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_AB);
  assert.equal(locais.length, 62);
  for (const n of [NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_AB), 'na época, o abastecimento ligado à atividade era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 61 de B29m (depois da D-PROD-210), na ordem em que foram concluídas; por último a D-PROD-210.
  const fora = [NOME_AB, NOME_BC, NOME_TT, NOME_PP, NOME_MO, NOME_FT, NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_LC, NOME_FT, NOME_MO, NOME_PP, NOME_TT, NOME_BC].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 61);
  assert.equal(linhas.at(-1).migration_name, NOME_BC);
  // A anterior concluída com o checksum do arquivo (o mesmo que o preflight do runbook confere).
  assert.equal(linhas.at(-1).checksum, 'a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_AB], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_AB, decisao: 'D-PROD-211' }]);
  const linhaAB = (checksum, extra = {}) => ({ migration_name: NOME_AB, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_BC], 'manual', MIGRATIONS_CONTRACT_APROVADAS[NOME_AB].guarda_sha256]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaAB(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaAB(MIGRATIONS_APROVADAS[NOME_AB], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  const depois = [...linhas, linhaAB(MIGRATIONS_APROVADAS[NOME_AB])];
  assert.equal(depois.length, 62);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B31a (D-PROD-215): o Cadastro de Culturas classificado SOZINHO, como na release: ok, EXPAND puro, exatamente a tabela nova, nenhuma coluna em tabela antiga, nenhum CONTRACT; checksum e RLS pinados', () => {
  const c = classificarMigrations([ler(NOME_CU)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, true);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.tabelas_novas, NOVAS_CU);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, []);
  assert.equal(MIGRATIONS_APROVADAS[NOME_CU], sha256(readFileSync(`backend/prisma/migrations/${NOME_CU}/migration.sql`, 'utf8')));
  assert.equal(MIGRATIONS_APROVADAS[NOME_CU], '37a71c46f138f457022fbab8316d645eb4f39a6e2a3ddfe4c8a3394e19665715');
  assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME_CU), false, 'EXPAND: sem entrada CONTRACT');
  assert.ok(DO_RLS_APROVADOS.includes(DO_CU), 'o RLS da nova é corpo pinado');
  assert.equal(NOMES.at(-2), NOME_CU, 'a penúltima do manifesto (a última é o reforço, D-PROD-216, aplicado depois dela)');
});

test('B31b (D-PROD-215): o mesmo arquivo com DDL em tabela antiga (coluna da cultura em AreaPastagem, CHECK em Empresa, UNIQUE em Cliente), a lista de referência como DML de semente ou o RLS citando tabela antiga é recusado (a allowlist EXPAND não afrouxou)', () => {
  const sql = readFileSync(`backend/prisma/migrations/${NOME_CU}/migration.sql`, 'utf8');
  const comManifesto = (s) => classificarMigrations([{ nome: NOME_CU, sql: s }], { manifesto: { [NOME_CU]: sha256(s) } });
  for (const [ruim, codigo] of [
    ['ALTER TABLE "AreaPastagem" ADD COLUMN "cultura_id" VARCHAR(64) NOT NULL;', 'ALTER_EM_TABELA_ANTIGA'],
    ['ALTER TABLE "Empresa" ADD CONSTRAINT "x_check" CHECK ("nome" <> \'\');', 'ALTER_EM_TABELA_ANTIGA'],
    ['CREATE UNIQUE INDEX "x_key" ON "Cliente"("nome");', 'UNIQUE_EM_TABELA_ANTIGA'],
    ['INSERT INTO "CADCULTURAS" ("id", "codigo", "nome") VALUES (\'x\', \'001\', \'MARANDU\');', 'SQL_NAO_RECONHECIDO'],
    ['UPDATE "AreaPastagem" SET "tipo_cultura" = \'MARANDU\';', 'SQL_NAO_RECONHECIDO'],
  ]) {
    const c = comManifesto(`${sql}\n${ruim}\n`);
    assert.equal(c.ok, false, ruim);
    assert.ok(c.violacoes.some((v) => v.codigo === codigo), `${ruim} → ${JSON.stringify(c.violacoes)}`);
  }
  const doAntiga = comManifesto(trocar(sql, "ARRAY['CADCULTURAS']", "ARRAY['CADCULTURAS', 'AreaPastagem']"));
  assert.deepEqual(codigos(doAntiga), ['DO_EM_TABELA_ANTIGA', 'DO_NAO_RECONHECIDO']);
  // Byte a byte: o mesmo SQL com um espaço a mais só diverge no checksum.
  assert.deepEqual(classificarMigrations([{ nome: NOME_CU, sql: `${sql} ` }]).violacoes.map((v) => v.codigo), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B31k (D-PROD-215/D-PROD-211): ordem de produção no dia da D-PROD-215 — alvo com as 62 da main concluídas (por último o abastecimento ligado à atividade, D-PROD-211): o histórico confere, a única pendente é o Cadastro de Culturas, nenhum CONTRACT a autorizar; checksum diferente do arquivo ou registro parcial é divergência; depois dela, 63 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-215 o Cadastro de Culturas era a pasta de nome mais recente; o reforço (D-PROD-216,
  // `20261116600000_abastecimento_fk_apontamento_atividade`, ver B32m) veio depois dele, na release seguinte: 63 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_CU);
  assert.equal(locais.length, 63);
  assert.ok(todas.some((l) => l.nome === NOME_FA) && !locais.some((l) => l.nome === NOME_FA), NOME_FA);
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 62 de B30m (depois da D-PROD-211), na ordem em que foram concluídas; por último a D-PROD-211.
  const fora = [NOME_CU, NOME_AB, NOME_BC, NOME_TT, NOME_PP, NOME_MO, NOME_FT, NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_LC, NOME_FT, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 62);
  assert.equal(linhas.at(-1).migration_name, NOME_AB);
  // A anterior concluída com o checksum do arquivo (o mesmo que a guarda do caminho B confere).
  assert.equal(linhas.at(-1).checksum, MIGRATIONS_APROVADAS[NOME_AB]);
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_CU], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [], 'EXPAND: nada a autorizar');
  // O caminho B registra o checksum = SHA-256 do arquivo; qualquer outro valor é divergência.
  const linhaCU = (checksum, extra = {}) => ({ migration_name: NOME_CU, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_AB], MIGRATIONS_APROVADAS[NOME_LC], 'manual', DO_CU]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaCU(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  // Registro aberto (finished_at nulo) é aplicação parcial: recusa.
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaCU(MIGRATIONS_APROVADAS[NOME_CU], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  // Depois da aplicação (o Cadastro de Culturas concluído por último): 63, nada pendente, nada a autorizar.
  const depois = [...linhas, linhaCU(MIGRATIONS_APROVADAS[NOME_CU])];
  assert.equal(depois.length, 63);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

const SHA = 'a'.repeat(40);
const ORIGIN = 'https://maike.exemplo.com.br';
const healthOk = { status: 'ok', release: SHA, capacidades: ['rebanho-ledger-cutover-r6'], implantacao: { ambiente: 'production', repositorio: 'maikelimaadm-stack/MAIKE', dominio_producao: 'maike.exemplo.com.br' } };

test('C1: origin de produção — só o configurado; preview, host arbitrário, caminho/query, http, localhost e credenciais recusados', () => {
  assert.equal(validarOrigemProducao({ informada: ORIGIN, configurada: ORIGIN }).ok, true);
  const casos = {
    [`${ORIGIN}/`]: null,
    'https://maike-git-claude-r2e-x.vercel.app': 'URL_DE_PREVIEW',
    'https://outro.exemplo.com': 'URL_FORA_DA_PRODUCAO',
    [`${ORIGIN}/api/native`]: 'URL_COM_CAMINHO',
    [`${ORIGIN}?x=1`]: 'URL_COM_CAMINHO',
    'http://maike.exemplo.com.br': 'URL_NAO_HTTPS',
    'https://localhost': 'URL_LOCAL',
    'https://u:p@maike.exemplo.com.br': 'URL_COM_CREDENCIAIS',
  };
  for (const [u, motivo] of Object.entries(casos)) assert.equal(validarOrigemProducao({ informada: u, configurada: ORIGIN }).motivo, motivo, u);
  assert.equal(validarOrigemProducao({ informada: ORIGIN, configurada: undefined }).motivo, 'ORIGEM_PRODUCAO_NAO_CONFIGURADA');
  assert.equal(validarOrigemProducao({ informada: 'https://maike-git-x.vercel.app', configurada: 'https://maike-git-x.vercel.app' }).motivo, 'ORIGEM_PRODUCAO_INVALIDA');
});

test('C2: identidade do backend — redirect, preview, outro repositório/domínio, main obsoleta e SHA divergente recusam', () => {
  const base = { health: healthOk, releaseSha: SHA, mainRemota: SHA, hostProducao: 'maike.exemplo.com.br' };
  assert.deepEqual(conferirBackendNovo(base), { ok: true, motivo: null });
  const casos = [
    [{ redirecionou: true, httpStatus: 308 }, 'HEALTH_REDIRECIONADO'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, ambiente: 'preview' } } }, 'IMPLANTACAO_NAO_E_PRODUCAO'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, repositorio: 'outro/repo' } } }, 'REPOSITORIO_DIVERGENTE'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, dominio_producao: 'x.vercel.app' } } }, 'DOMINIO_PRODUCAO_DIVERGENTE'],
    [{ mainRemota: 'b'.repeat(40) }, 'RELEASE_NAO_E_MAIN_ATUAL'],
    [{ mainRemota: null }, 'MAIN_REMOTA_INDISPONIVEL'],
    [{ health: { ...healthOk, release: 'c'.repeat(40) } }, 'BACKEND_EM_OUTRO_SHA'],
    [{ health: { status: 'ok', processo: 'up' } }, 'BACKEND_ANTIGO_EM_PRODUCAO'],
    [{ health: { ...healthOk, status: 'degraded' } }, 'BACKEND_DEGRADADO'],
    [{ httpStatus: 503, health: null }, 'HEALTH_INDISPONIVEL'],
  ];
  for (const [mut, motivo] of casos) assert.equal(conferirBackendNovo({ ...base, ...mut }).motivo, motivo, motivo);
});

test('C3: CLI remoto + --executar com URL de preview/sem origin configurado → exit 3 ANTES de conectar ao banco; sem segredo na saída', () => {
  const comum = ['scripts/ops/cutover-rebanho.mjs', '--cliente-id', 'c', '--empresa-id', 'e', '--executar', '--estrategia', 'entradas', '--confirmar-empresa', 'F', '--usuario-admin-id', 'u', '--release-sha', SHA];
  const env = { ...process.env, CUTOVER_DATABASE_URL: 'postgresql://u:SEGREDO@banco.exemplo.invalid:5432/d', CUTOVER_EXPECTED_SYSTEM_IDENTIFIER: '1', MAIKE_PRODUCAO_ORIGIN: ORIGIN };
  const sem = spawnSync('node', comum.filter((x) => x !== '--release-sha' && x !== SHA), { encoding: 'utf8', env });
  assert.equal(sem.status, 2);
  const preview = spawnSync('node', [...comum, '--backend-url', 'https://maike-git-claude-x.vercel.app'], { encoding: 'utf8', env });
  assert.equal(preview.status, 3);
  assert.match(preview.stderr, /URL_DE_PREVIEW/);
  const semConfig = spawnSync('node', [...comum, '--backend-url', ORIGIN], { encoding: 'utf8', env: { ...env, MAIKE_PRODUCAO_ORIGIN: '' } });
  assert.equal(semConfig.status, 3);
  assert.match(semConfig.stderr, /ORIGEM_PRODUCAO_NAO_CONFIGURADA/);
  for (const r of [sem, preview, semConfig]) assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\//);
});

test('B8 (D-PROD-113): migration aprovada que já está na main não "falta"; a que não está nem na main nem na release continua recusada', () => {
  const manifesto = { m_antiga: 'h1', m_nova: 'h2', m_sumida: 'h3' };
  const naMain = (n) => n === 'm_antiga';
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, ['m_nova'], naMain), ['m_sumida']);
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, ['m_nova', 'm_sumida'], naMain), []);
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, [], () => false), ['m_antiga', 'm_nova', 'm_sumida'], 'sem main: tudo falta (fail-closed)');
  // Cada migration aprovada ou já está na main ou é nova NESTA árvore (a release a
  // traz): nada do manifesto "falta". Na main (sem migration nova) a release vazia passa.
  const naMainReal = (n) => { try { execFileSync('git', ['cat-file', '-e', `origin/main:backend/prisma/migrations/${n}/migration.sql`], { stdio: 'ignore' }); return true; } catch { return false; } };
  const temMain = (() => { try { execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  if (temMain) {
    const novasNaArvore = NOMES.filter((n) => !naMainReal(n) && existsSync(`backend/prisma/migrations/${n}/migration.sql`));
    assert.deepEqual(migrationsDoManifestoFaltando(MIGRATIONS_APROVADAS, novasNaArvore, naMainReal), []);
  }
});

test('B29a (D-PROD-210): a base do consumo classificada SOZINHA, como na release: ok, modo CONTRACT, nenhuma tabela nova nem removida, nenhuma coluna no caminho EXPAND e o descritor com as 2 colunas, o CHECK novo, o CHECK da regra alargado e o do %PV padrão removido', () => {
  const c = classificarMigrations([ler(NOME_BC)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_BC]);
  assert.equal(MIGRATIONS_APROVADAS[NOME_BC], sha256(SQL_BC));
});

test('B29b (D-PROD-210): a entrada de MIGRATIONS_CONTRACT_APROVADAS é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP, os 3 literais (as tabelas de Formulações) e as 7 instruções exatas, nesta ordem; não há resto', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_BC];
  assert.equal(Object.isFrozen(k), true);
  assert.equal(k.decisao, 'D-PROD-210');
  assert.deepEqual(k.drop, []);
  assert.deepEqual(k.literais_guarda, ['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA']);
  assert.equal(k.conversao, undefined);
  const limpo = SQL_BC.replace(/--[^\n]*/g, '').trim();
  const guarda = limpo.match(/^DO\s+\$\$([\s\S]*?)\$\$\s*;/);
  assert.ok(guarda, 'a guarda é a 1ª instrução');
  assert.equal(sha256(guarda[1].replace(/\s+/g, ' ').trim()), k.guarda_sha256);
  // A guarda exige as 3 tabelas VAZIAS (o proprietário autorizou: os dados eram só teste) e trava as 3.
  assert.match(guarda[1], /esta CONTRACT só roda com as Formulações vazias/);
  assert.match(guarda[1], /LOCK TABLE public\."CADFORMULACAO", public\."CADFORMULACAOINGREDIENTE", public\."CADFORMULACAOREGRA" IN ACCESS EXCLUSIVE MODE/);
  const resto = limpo.slice(guarda[0].length).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(resto, [...k.alter_antigas]);
  assert.equal(k.alter_antigas.length, 7);
  assert.ok(k.alter_antigas.every((a) => a.startsWith('ALTER TABLE "CADFORMULACAO" ') || a.startsWith('ALTER TABLE "CADFORMULACAOREGRA" ')));
});

test('B29c (D-PROD-210): as 7 instruções são EXATAMENTE as do contrato — DEFAULT trocado, NOT NULL a menos, SET NOT NULL, CHECK afrouxado, outra tabela, troca de ordem, uma faltando ou uma a mais → recusa; o resto não aceita DML nem DDL em tabela antiga', () => {
  const classificarBC = classificarContractDe(NOME_BC);
  assert.deepEqual(classificarBC(SQL_BC).violacoes, []);
  const variacoes = [
    trocar(SQL_BC, `ADD COLUMN "base_consumo" VARCHAR(16) NOT NULL DEFAULT 'PV';`, `ADD COLUMN "base_consumo" VARCHAR(16) NOT NULL DEFAULT 'G_CAB_DIA';`),
    trocar(SQL_BC, `ADD COLUMN "base_consumo" VARCHAR(16) NOT NULL DEFAULT 'PV';`, `ADD COLUMN "base_consumo" VARCHAR(16) DEFAULT 'PV';`),
    trocar(SQL_BC, '"percentual_pv_padrao" DROP NOT NULL;', '"percentual_pv_padrao" SET NOT NULL;'),
    trocar(SQL_BC, '"percentual_pv_padrao" <= 5) OR ("base_consumo"', '"percentual_pv_padrao" <= 50) OR ("base_consumo"'),
    trocar(SQL_BC, 'ALTER TABLE "CADFORMULACAOREGRA" ADD COLUMN "g_cab_dia" DECIMAL(10,2);', 'ALTER TABLE "CADFORMULACAOINGREDIENTE" ADD COLUMN "g_cab_dia" DECIMAL(10,2);'),
    trocar(SQL_BC, 'ALTER TABLE "CADFORMULACAOREGRA" ADD COLUMN "g_cab_dia" DECIMAL(10,2);\n', ''),
    `${SQL_BC}\nALTER TABLE "CADFORMULACAO" ADD COLUMN "x" INTEGER NOT NULL DEFAULT 0;\n`,
    `${SQL_BC}\nUPDATE "CADFORMULACAO" SET "base_consumo" = 'G_CAB_DIA';\n`,
    `${SQL_BC}\nDROP TABLE "CADFORMULACAOINGREDIENTE";\n`,
  ];
  for (const sql of variacoes) {
    const c = classificarBC(sql);
    assert.equal(c.ok, false, sql.slice(-160));
  }
});

test('B29e (D-PROD-210): a guarda é a PRIMEIRA instrução e tem o hash pinado — alterada (vazias, trava, coluna) → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente → CONTRACT_GUARDA_AUSENTE; citando outra tabela → DO_EM_TABELA_ANTIGA', () => {
  const classificarBC = classificarContractDe(NOME_BC);
  const codigos = (sql) => classificarBC(sql).violacoes.map((v) => v.codigo);
  assert.ok(codigos(trocar(SQL_BC, 'IF n <> 0 THEN', 'IF n > 1000 THEN')).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  assert.ok(codigos(trocar(SQL_BC, "PERFORM set_config('lock_timeout', '5s', true);", '')).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  assert.ok(codigos(trocar(SQL_BC, "a.attname = 'base_consumo'", "a.attname = 'outra'")).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  const semGuarda = SQL_BC.replace(/--[^\n]*/g, '').replace(/^\s*DO \$\$[\s\S]*?END \$\$;/, '');
  assert.ok(codigos(semGuarda).includes('CONTRACT_GUARDA_AUSENTE'));
  assert.ok(codigos(trocar(SQL_BC, "'CADFORMULACAOINGREDIENTE','CADFORMULACAOREGRA'];", "'CADFORMULACAOINGREDIENTE','CADFORMULACAOREGRA','Produto'];")).includes('DO_EM_TABELA_ANTIGA'));
});

test('B29f (D-PROD-210): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada, o nome real é recusado; os contratos não se servem entre si', () => {
  const outroNome = classificarMigrations([{ nome: '20261115300001_x', sql: SQL_BC }], { manifesto: { '20261115300001_x': sha256(SQL_BC) } });
  assert.equal(outroNome.ok, false);
  const semEntrada = { ...MIGRATIONS_CONTRACT_APROVADAS };
  delete semEntrada[NOME_BC];
  assert.equal(classificarMigrations([ler(NOME_BC)], { contratos: semEntrada }).ok, false);
  const comOutra = { [NOME_BC]: MIGRATIONS_CONTRACT_APROVADAS[NOME_P] };
  assert.equal(classificarMigrations([ler(NOME_BC)], { contratos: comOutra }).ok, false);
});

test('B29g (D-PROD-210): conferirReleaseContract e envDoDeployMigrate — a D-PROD-210 sozinha só com --contract D-PROD-210 exato; junto de outra migration é CONTRACT_NAO_ISOLADO; MIGRATION_CONTRACT_AUTORIZADO só com ela sozinha e a decisão exata', () => {
  const comBC = classificarMigrations([ler(NOME_BC)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_BC], classificacao: comBC, autorizacao: 'D-PROD-210' }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-203', 'D-PROD-206', 'D-PROD-200', '', undefined, null, 'd-prod-207', ' D-PROD-210']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_BC], classificacao: comBC, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  const comOutra = classificarMigrations([ler(NOME_FT), ler(NOME_BC)]);
  assert.deepEqual(comOutra.violacoes, []);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_FT, NOME_BC], classificacao: comOutra, autorizacao: 'D-PROD-210' }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' });
  assert.equal(envDoDeployMigrate({ env: {}, classificacao: comBC, autorizacao: 'D-PROD-210' }).MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-210');
  assert.equal(envDoDeployMigrate({ env: { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-210' }, classificacao: comBC, autorizacao: 'D-PROD-206' }).MIGRATION_CONTRACT_AUTORIZADO, undefined);
});

test('B29k (D-PROD-210): contractsPendentes com as dez CONTRACT locais — produção hoje (as nove anteriores concluídas, a D-PROD-209 por último) deixa só a D-PROD-210 pendente; histórico vazio, as dez; aberta ou revertida continua pendente; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP, NOME_TT, NOME_BC];
  const PEND = { nome: NOME_BC, decisao: 'D-PROD-210' };
  const producao = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP, NOME_TT].map((n) => linha(n));
  assert.deepEqual(contractsPendentes({ locais, linhas: producao }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', 'D-PROD-208', 'D-PROD-209', 'D-PROD-210']);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_BC)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_BC, { finished_at: null })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_BC, { rolled_back_at: new Date() })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_BC), linhas: producao }), []);
});

test('B29m (D-PROD-210/D-PROD-209): ordem de produção no dia da D-PROD-210 — alvo com as 60 da main concluídas (por último o tipo Terceirizado, D-PROD-209): o histórico confere, a única pendente é a D-PROD-210 e a barreira do CONTRACT a exige; checksum diferente do arquivo ou registro parcial é divergência; depois dela, 61 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const todas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(todas.length, 64);
  // No dia da D-PROD-210 a base do consumo era a pasta de nome mais recente; o abastecimento ligado à atividade
  // (D-PROD-211, `20261116300000_abastecimento_atividade`, ver B30m) veio depois dela, na release seguinte: 61 pastas.
  const locais = todas.filter((l) => l.nome <= NOME_BC);
  assert.equal(locais.length, 61);
  for (const n of [NOME_AB, NOME_CU, NOME_FA]) assert.ok(todas.some((l) => l.nome === n) && !locais.some((l) => l.nome === n), n);
  assert.ok(locais.every((l) => l.nome <= NOME_BC), 'na época, a base do consumo era a migration de nome mais recente');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 60 de B28m (depois da D-PROD-209), na ordem em que foram concluídas; por último a D-PROD-209.
  const fora = [NOME_BC, NOME_TT, NOME_PP, NOME_MO, NOME_FT, NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_LC, NOME_FT, NOME_MO, NOME_PP, NOME_TT].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 60);
  assert.equal(linhas.at(-1).migration_name, NOME_TT);
  // A anterior concluída com o checksum do arquivo (o mesmo que o preflight do runbook confere).
  assert.equal(linhas.at(-1).checksum, '44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_BC], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_BC, decisao: 'D-PROD-210' }]);
  const linhaBC = (checksum, extra = {}) => ({ migration_name: NOME_BC, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_TT], 'manual', MIGRATIONS_CONTRACT_APROVADAS[NOME_BC].guarda_sha256]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaBC(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaBC(MIGRATIONS_APROVADAS[NOME_BC], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  const depois = [...linhas, linhaBC(MIGRATIONS_APROVADAS[NOME_BC])];
  assert.equal(depois.length, 61);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});

test('B32a (D-PROD-216): o reforço da FK do apontamento classificado SOZINHO, como na release: ok, modo CONTRACT, nenhuma tabela nova nem coluna no caminho EXPAND; a FK do apontamento recriada no descritor; nenhuma conversão', () => {
  const c = classificarMigrations([ler(NOME_FA)]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.ok, true);
  assert.equal(c.expand, false);
  assert.equal(c.modo, 'CONTRACT');
  assert.deepEqual(c.tabelas_novas, []);
  assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
  assert.deepEqual(c.contract, [CONTRACT_FA]);
  // O arquivo é o auditado, byte a byte; o número da decisão fica fora do migration.sql.
  assert.equal(MIGRATIONS_APROVADAS[NOME_FA], sha256(SQL_FA));
  assert.doesNotMatch(SQL_FA, /D-PROD-\d+/);
  assert.equal((SQL_FA.replace(/--[^\n]*/g, '').match(/DO\s+\$\$/g) ?? []).length, 1);
});

test('B32b (D-PROD-216): a entrada é congelada e o conteúdo pinado é o do arquivo — guarda, nenhum DROP TABLE, os 2 literais, as 3 instruções na ordem, nenhuma conversão nem drop_no_fim nem resto; a guarda confere o formato, trava a referenciada e depois a referenciadora, e só então confere o conteúdo', () => {
  const k = MIGRATIONS_CONTRACT_APROVADAS[NOME_FA];
  assert.ok(NOME_FA in MIGRATIONS_APROVADAS);
  for (const o of [k, k.drop, k.literais_guarda, k.alter_antigas]) assert.equal(Object.isFrozen(o), true);
  assert.equal(k.decisao, 'D-PROD-216');
  assert.deepEqual(k.drop, []);
  assert.equal(k.drop_no_fim, undefined);
  assert.equal(k.conversao, undefined);
  assert.deepEqual(k.literais_guarda, ['AbastecimentoBem', 'AtividadeApontamento']);
  assert.deepEqual(k.alter_antigas, ALTER_FA);
  assert.ok(k.alter_antigas.every((a) => !a.includes(';') && a === a.replace(/\s+/g, ' ').trim()), 'texto normalizado, sem o ";"');
  const semComent = SQL_FA.replace(/--[^\n]*/g, '');
  assert.ok(semComent.trimStart().startsWith('DO $$'));
  const corpo = semComent.match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  assert.equal(sha256(corpo), k.guarda_sha256);
  const depois = semComent.slice(semComent.indexOf('END $$;') + 'END $$;'.length).split(';').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(depois, [...ALTER_FA], 'sem resto: só as 3 instruções pinadas');
  const citadas = [...new Set([...corpo.matchAll(/'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g)].map((x) => x[1] ?? x[2]))].sort();
  assert.deepEqual(citadas, [...k.literais_guarda].sort());
  assert.ok(corpo.startsWith("BEGIN PERFORM set_config('lock_timeout', '5s', true); PERFORM set_config('statement_timeout', '120s', true); PERFORM pg_advisory_xact_lock(72707369);"));
  const fk = corpo.indexOf("AND conname = 'AbastecimentoBem_apontamento_fkey' AND contype = 'f' AND confrelid = to_regclass('public.\"AtividadeApontamento\"') AND array_length(conkey, 1) = 3)");
  const check = corpo.indexOf("AND conname = 'AbastecimentoBem_atividade_check' AND contype = 'c')");
  const unico = corpo.indexOf("OR to_regclass('public.\"AtividadeApontamento_empresa_atividade_id_key\"') IS NOT NULL THEN");
  const trava1 = corpo.indexOf('LOCK TABLE public."AtividadeApontamento" IN ACCESS EXCLUSIVE MODE;');
  const trava2 = corpo.indexOf('LOCK TABLE public."AbastecimentoBem" IN ACCESS EXCLUSIVE MODE;');
  const conteudo = corpo.indexOf('WHERE a.apontamento_id IS NOT NULL AND p.atividade_id IS DISTINCT FROM a.atividade_id) THEN');
  assert.ok(fk > 0 && check > fk && unico > check && trava1 > unico && trava2 > trava1 && conteudo > trava2, 'o formato, as travas (referenciada primeiro) e só então o conteúdo');
  const semGuarda = semComent.slice(semComent.indexOf('END $$;'));
  assert.doesNotMatch(semGuarda, /ON DELETE (CASCADE|SET NULL)|" CASCADE;|IF EXISTS|NOT VALID|\bINSERT\b|\bUPDATE "|\bDELETE FROM\b|\bTRUNCATE\b|DROP TABLE|DROP COLUMN|ADD COLUMN|NOT NULL/);
});

test('B32c (D-PROD-216): as 3 instruções são EXATAMENTE as do contrato, na ordem — UNIQUE sem a atividade ou noutra tabela, FK sem a atividade, SET NULL, NOT VALID, DROP IF EXISTS, ordem trocada, uma faltando ou outra antes → CONTRACT_ALTER_FORA_DO_CONTRATO', () => {
  const casos = {
    uniqueSemAtividade: [trocar(SQL_FA, 'ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id");', 'ON "AtividadeApontamento"("cliente_id", "empresa_id", "id");'), 0],
    uniqueNaoUnico: [trocar(SQL_FA, 'CREATE UNIQUE INDEX "AtividadeApontamento_empresa_atividade_id_key"', 'CREATE INDEX "AtividadeApontamento_empresa_atividade_id_key"'), 0],
    uniqueOutraTabela: [trocar(SQL_FA, 'ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id");', 'ON "Atividade"("cliente_id", "empresa_id", "atividade_id", "id");'), 0],
    instrucaoAntes: [trocar(SQL_FA, '-- CreateIndex (o alvo', 'CREATE INDEX "x_idx" ON "AbastecimentoBem"("cliente_id");\n-- CreateIndex (o alvo'), 0],
    semUnique: [trocar(SQL_FA, /^CREATE UNIQUE INDEX .*;\n/m.exec(SQL_FA)[0], ''), 0],
    dropIfExists: [trocar(SQL_FA, 'DROP CONSTRAINT "AbastecimentoBem_apontamento_fkey";', 'DROP CONSTRAINT IF EXISTS "AbastecimentoBem_apontamento_fkey";'), 1],
    fkSemAtividade: [trocar(SQL_FA, 'FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id")', 'FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "id")'), 2],
    fkSetNull: [trocar(SQL_FA, 'ON DELETE RESTRICT ON UPDATE CASCADE;', 'ON DELETE SET NULL ON UPDATE CASCADE;'), 2],
    fkNotValid: [trocar(SQL_FA, 'ON DELETE RESTRICT ON UPDATE CASCADE;', 'ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;'), 2],
    fkOutroNome: [trocar(SQL_FA, 'ADD CONSTRAINT "AbastecimentoBem_apontamento_fkey"', 'ADD CONSTRAINT "AbastecimentoBem_apontamento_atividade_fkey"'), 2],
    semFk: [trocar(SQL_FA, /^ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT .*;\n/m.exec(SQL_FA)[0], ''), 2],
  };
  for (const [caso, [sql, posicao]] of Object.entries(casos)) {
    assert.notEqual(sql, SQL_FA, caso);
    const c = classificarContractFA(sql);
    assert.equal(c.ok, false, caso);
    assert.deepEqual(codigos(c), ['CONTRACT_ALTER_FORA_DO_CONTRATO'], `${caso}: ${JSON.stringify(c.violacoes)}`);
    assert.match(c.violacoes[0].detalhe, new RegExp(`^posição ${posicao}: `), `${caso}: ${c.violacoes[0].detalhe}`);
  }
  // As 3 instruções só existem como texto de uma entrada: no caminho EXPAND, UNIQUE em tabela antiga, DROP CONSTRAINT e
  // FK para tabela antiga são recusados.
  for (const a of ALTER_FA) assert.equal(classificar(`${BASE}${a};\n`).ok, false, a.slice(0, 60));
});

test('B32d (D-PROD-216): depois das 3 instruções, o resto é EXPAND — DML, DROP, CHECK, NOT NULL, UNIQUE e FK para tabela antiga recusados como sempre; um índice não-único a mais é aceito', () => {
  const noResto = (ddl) => `${SQL_FA}\n${ddl}\n`;
  const casos = {
    'UPDATE "AbastecimentoBem" SET "apontamento_id" = NULL;': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "AbastecimentoBem";': 'SQL_NAO_RECONHECIDO',
    'ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_atividade_fkey";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AbastecimentoBem" ALTER COLUMN "atividade_id" SET NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_x_check" CHECK ("apontamento_id" IS NULL);': 'ALTER_EM_TABELA_ANTIGA',
    'CREATE UNIQUE INDEX "AbastecimentoBem_x_key" ON "AbastecimentoBem"("cliente_id", "apontamento_id");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [ddl, codigo] of Object.entries(casos)) {
    const c = classificarContractFA(noResto(ddl));
    assert.deepEqual(codigos(c), [codigo], ddl.slice(0, 60));
    assert.deepEqual(c.contract, [CONTRACT_FA]);
  }
  assert.deepEqual(classificarContractFA(noResto('CREATE INDEX "AbastecimentoBem_x_idx" ON "AbastecimentoBem"("cliente_id", "origem");')).violacoes, []);
  assert.deepEqual(classificarContractFA(`${SQL_FA}\n-- fim\n\n`).violacoes, []);
});

test('B32f (D-PROD-216): a guarda é a PRIMEIRA instrução e tem o hash pinado — sem uma trava, trava fraca, ordem das travas trocada, sem tempo limite ou trava consultiva, sem conferir o conteúdo, a FK antiga ou o UNIQUE → CONTRACT_GUARDA_NAO_RECONHECIDA; ausente ou precedida de outra instrução → CONTRACT_GUARDA_AUSENTE; citando outra tabela ou sem um literal → DO_EM_TABELA_ANTIGA', () => {
  const travas = '  LOCK TABLE public."AtividadeApontamento" IN ACCESS EXCLUSIVE MODE;\n  LOCK TABLE public."AbastecimentoBem" IN ACCESS EXCLUSIVE MODE;\n';
  for (const [de, para] of [
    ['  LOCK TABLE public."AbastecimentoBem" IN ACCESS EXCLUSIVE MODE;\n', ''],
    ['  LOCK TABLE public."AtividadeApontamento" IN ACCESS EXCLUSIVE MODE;\n', ''],
    ['"AbastecimentoBem" IN ACCESS EXCLUSIVE MODE;', '"AbastecimentoBem" IN SHARE MODE;'],
    ['"AtividadeApontamento" IN ACCESS EXCLUSIVE MODE;', '"AtividadeApontamento" IN ROW SHARE MODE;'],
    // A trava da referenciada que o ADD FOREIGN KEY pede (SHARE ROW EXCLUSIVE) não basta: o DROP CONSTRAINT pede ACCESS
    // EXCLUSIVE nela, e subir de trava no meio da transação fecha ciclo com o app (lê o apontamento, grava o abastecimento).
    ['"AtividadeApontamento" IN ACCESS EXCLUSIVE MODE;', '"AtividadeApontamento" IN SHARE ROW EXCLUSIVE MODE;'],
    [travas, '  LOCK TABLE public."AbastecimentoBem" IN ACCESS EXCLUSIVE MODE;\n  LOCK TABLE public."AtividadeApontamento" IN ACCESS EXCLUSIVE MODE;\n'],
    ["PERFORM set_config('lock_timeout', '5s', true);", "PERFORM set_config('lock_timeout', '0', true);"],
    ["PERFORM set_config('statement_timeout', '120s', true);", "PERFORM set_config('statement_timeout', '0', true);"],
    ['PERFORM pg_advisory_xact_lock(72707369);', 'PERFORM pg_advisory_xact_lock(1);'],
    ['p.atividade_id IS DISTINCT FROM a.atividade_id', 'p.atividade_id IS NULL'],
    ['AND array_length(conkey, 1) = 3)', ')'],
    ["     OR to_regclass('public.\"AtividadeApontamento_empresa_atividade_id_key\"') IS NOT NULL THEN", '     THEN'],
  ]) {
    assert.deepEqual(codigos(classificarContractFA(trocar(SQL_FA, de, para))), ['CONTRACT_GUARDA_NAO_RECONHECIDA'], de);
  }
  const inicio = SQL_FA.indexOf('-- Guarda: falha fechada');
  const fim = SQL_FA.indexOf('END $$;', inicio) + 'END $$;'.length;
  const semGuarda = SQL_FA.slice(0, inicio) + SQL_FA.slice(fim);
  assert.ok(!semGuarda.includes('pg_advisory_xact_lock'));
  assert.deepEqual(codigos(classificarContractFA(semGuarda)), ['CONTRACT_GUARDA_AUSENTE']);
  assert.deepEqual(codigos(classificarContractFA(`CREATE INDEX "x_idx" ON "AbastecimentoBem"("id");\n${SQL_FA}`)), ['CONTRACT_GUARDA_AUSENTE']);
  // Guarda (com hash repinado num contrato sintético) que cita outra tabela: só as 2 da entrada.
  const outra = trocar(SQL_FA, `OR to_regclass('public."AtividadeApontamento"') IS NULL THEN`, `OR to_regclass('public."AtividadeApontamento"') IS NULL OR to_regclass('public."Atividade"') IS NULL THEN`);
  const corpo = outra.replace(/--[^\n]*/g, '').match(/DO\s+\$\$([\s\S]*?)\$\$\s*;/)[1].replace(/\s+/g, ' ').trim();
  const c = classificarContractFA(outra, { contratos: { [NOME_FA]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_FA], guarda_sha256: sha256(corpo) } } });
  assert.deepEqual(codigos(c), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(c.violacoes.every((v) => v.detalhe === 'Atividade'), JSON.stringify(c.violacoes));
  const semLiteral = { [NOME_FA]: { ...MIGRATIONS_CONTRACT_APROVADAS[NOME_FA], literais_guarda: ['AbastecimentoBem'] } };
  const s = classificarMigrations([ler(NOME_FA)], { contratos: semLiteral });
  assert.deepEqual(codigos(s), ['DO_EM_TABELA_ANTIGA']);
  assert.ok(s.violacoes.every((v) => v.detalhe === 'AtividadeApontamento'));
  // 1 byte a mais no arquivo pinado → checksum divergente.
  assert.deepEqual(codigos(classificarMigrations([{ nome: NOME_FA, sql: `${SQL_FA}\n` }])), ['MIGRATION_CHECKSUM_DIVERGENTE']);
});

test('B32h (D-PROD-216): o contrato é do NOME — o mesmo SQL com outro nome segue o caminho EXPAND e é recusado; sem a entrada, ou só com as onze anteriores, o nome real é recusado; os contratos não se servem entre si', () => {
  const outro = '20261116300001_outro_nome';
  const c = classificarMigrations([{ nome: outro, sql: SQL_FA }], { manifesto: { [outro]: sha256(SQL_FA) } });
  assert.equal(c.ok, false);
  assert.equal(c.modo, 'EXPAND');
  assert.deepEqual(c.contract, []);
  for (const codigo of ['DO_NAO_RECONHECIDO', 'UNIQUE_EM_TABELA_ANTIGA', 'ALTER_EM_TABELA_ANTIGA']) assert.ok(codigos(c).includes(codigo), codigo);
  assert.equal(classificarMigrations([ler(NOME_FA)], { contratos: {} }).ok, false);
  const anteriores = Object.fromEntries([NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_PP, NOME_TT, NOME_BC, NOME_AB].map((n) => [n, MIGRATIONS_CONTRACT_APROVADAS[n]]));
  assert.equal(classificarMigrations([ler(NOME_FA)], { contratos: anteriores }).ok, false);
  for (const cl of [classificarContract, classificarContractT, classificarContractD, classificarContractK, classificarContractG, classificarContractP, classificarContractV, classificarContractPP, classificarContractTT, classificarContractDe(NOME_BC), classificarContractAB]) {
    assert.ok(codigos(cl(SQL_FA)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
  }
  for (const sql of [SQL_C, SQL_T, SQL_D, SQL_K, SQL_G, SQL_P, SQL_V, SQL_PP, SQL_TT, SQL_BC, SQL_AB]) assert.ok(codigos(classificarContractFA(sql)).includes('CONTRACT_GUARDA_NAO_RECONHECIDA'));
});

test('B32i (D-PROD-216): conferirReleaseContract — a D-PROD-216 sozinha só com --contract D-PROD-216 exato; junto com a D-PROD-211 ou outra CONTRACT é CONTRACT_NAO_ISOLADO; --contract D-PROD-216 sem CONTRACT é inesperado', () => {
  const comFA = classificarMigrations([ler(NOME_FA)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_FA], classificacao: comFA, autorizacao: 'D-PROD-216' }), { ok: true, codigo: null });
  for (const autorizacao of ['D-PROD-162', 'D-PROD-200', 'D-PROD-210', 'D-PROD-211', 'D-PROD-212', '', undefined, null, 'd-prod-216', ' D-PROD-216', 'D-PROD-216 ', 'D-PROD-21', 'D-PROD-2160']) {
    assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_FA], classificacao: comFA, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' }, String(autorizacao));
  }
  for (const lote of [[NOME_AB, NOME_FA], [NOME_BC, NOME_FA], [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_FA]]) {
    const c = classificarMigrations(lote.map(ler));
    assert.deepEqual(c.violacoes, []);
    assert.equal(c.contract.length, lote.length);
    for (const autorizacao of ['D-PROD-211', 'D-PROD-216', undefined]) {
      assert.deepEqual(conferirReleaseContract({ nomesNovas: lote, classificacao: c, autorizacao }), { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' }, `${lote.length} CONTRACT, ${autorizacao}`);
    }
  }
  const semFA = classificarMigrations([ler(NOME_MO)]);
  assert.deepEqual(conferirReleaseContract({ nomesNovas: [NOME_MO], classificacao: semFA, autorizacao: 'D-PROD-216' }), { ok: false, codigo: 'CONTRACT_INESPERADO' });
});

test('B32j (D-PROD-216): envDoDeployMigrate — MIGRATION_CONTRACT_AUTORIZADO=D-PROD-216 só com a D-PROD-216 sozinha e --contract D-PROD-216; outra decisão ou outra CONTRACT junto não autorizam; nunca herdado', () => {
  const comFA = classificarMigrations([ler(NOME_FA)]);
  const comAB = classificarMigrations([ler(NOME_AB), ler(NOME_FA)]);
  const herdado = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'herdado' };
  const a = envDoDeployMigrate({ env: herdado, classificacao: comFA, autorizacao: 'D-PROD-216' });
  assert.equal(a.MIGRATION_CONTRACT_AUTORIZADO, 'D-PROD-216');
  assert.equal(a.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  assert.equal(herdado.MIGRATION_CONTRACT_AUTORIZADO, 'herdado');
  const base = { PATH: '/bin', MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-216' };
  for (const [classificacao, autorizacao] of [[comFA, 'D-PROD-211'], [comFA, undefined], [comFA, 'd-prod-216'], [comFA, ' D-PROD-216 '], [comAB, 'D-PROD-216'], [comAB, 'D-PROD-211']]) {
    const e = envDoDeployMigrate({ env: base, classificacao, autorizacao });
    assert.equal('MIGRATION_CONTRACT_AUTORIZADO' in e, false, `${classificacao.contract.length} CONTRACT, ${autorizacao}: nunca herdado`);
    assert.equal(e.MIGRATION_EXIGIR_CONFERENCIA, 'sim');
  }
});

test('B32k (D-PROD-216): contractsPendentes com as doze CONTRACT locais — produção hoje (as onze anteriores concluídas, a D-PROD-211 por último entre elas; a D-PROD-215 é EXPAND) deixa só a D-PROD-216 pendente; histórico vazio, as doze; aberta ou revertida continua pendente; todas concluídas, nenhuma', () => {
  const linha = (n, extra = {}) => ({ migration_name: n, checksum: 'c', finished_at: new Date(), rolled_back_at: null, ...extra });
  const locais = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_FA];
  const PEND = { nome: NOME_FA, decisao: 'D-PROD-216' };
  const producao = [NOME_C, NOME_T, NOME_D, NOME_K, NOME_G, NOME_P, NOME_V, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB].map((n) => linha(n));
  assert.deepEqual(contractsPendentes({ locais, linhas: producao }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [] }).map((p) => p.decisao), ['D-PROD-162', 'D-PROD-183', 'D-PROD-187', 'D-PROD-194', 'D-PROD-195', 'D-PROD-197', 'D-PROD-200', 'D-PROD-208', 'D-PROD-209', 'D-PROD-210', 'D-PROD-211', 'D-PROD-216']);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_FA)] }), []);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_FA, { finished_at: null })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais, linhas: [...producao, linha(NOME_FA, { rolled_back_at: new Date() })] }), [PEND]);
  assert.deepEqual(contractsPendentes({ locais: locais.filter((n) => n !== NOME_FA), linhas: producao }), []);
});

test('B32l (D-PROD-216): runner real sobre a release do reforço — análise local declara a FK recriada; verificar/aplicar exigem --contract D-PROD-216 exato ANTES de conectar; nunca imprime URL', () => {
  const repo = repoDaReleaseContract(NOME_FA);
  const run = runnerDaRelease(repo);
  try {
    const analise = run(SEM_ALVO);
    assert.equal(analise.status, 0, analise.stderr);
    const rotulo = analise.stdout.split('\n').find((l) => l.includes('ANÁLISE LOCAL OK'));
    // O rótulo das constraints recriadas é o de sempre ("CHECKs alargados"): aqui, a FK do apontamento, recriada com o mesmo nome.
    assert.equal(rotulo, 'premerge-migrate: ANÁLISE LOCAL OK (CONTRACT D-PROD-216: 1 CHECKs alargados) — alvo remoto NÃO verificado (isto não autoriza aplicar; use --verificar-alvo)');
    const json = JSON.parse(analise.stdout.slice(0, analise.stdout.lastIndexOf('}') + 1));
    assert.equal(json.modo, 'CONTRACT');
    assert.equal(json.expand, false);
    assert.deepEqual(json.migrations_novas, [NOME_FA]);
    assert.deepEqual(json.contract, [CONTRACT_FA]);
    assert.deepEqual(json.tabelas_novas, []);
    assert.deepEqual(json.colunas_novas_em_tabelas_antigas, []);
    assert.deepEqual(json.violacoes, []);
    assert.equal(run(SEM_ALVO, '--contract', 'D-PROD-216').status, 0);
    const semConfig = run(SEM_ALVO, '--aplicar', '--contract', 'D-PROD-216');
    assert.equal(semConfig.status, 3);
    assert.match(semConfig.stderr, /ALVO_SEM_CONFIGURACAO/);
    const recusas = [
      run(COM_ALVO, '--verificar-alvo'), run(COM_ALVO, '--aplicar'),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-211'), run(COM_ALVO, '--aplicar', '--contract', 'D-PROD-212'),
      run(COM_ALVO, '--aplicar', '--contract', 'd-prod-216'), run(COM_ALVO, '--verificar-alvo', '--contract', ' D-PROD-216 '),
      run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-2160'), run(COM_ALVO, '--verificar-alvo', '--contract'),
    ];
    for (const r of recusas) recusadoSemConectar(r, 'D-PROD-216');
    const certo = run(COM_ALVO, '--verificar-alvo', '--contract', 'D-PROD-216');
    assert.equal(certo.status, 3);
    assert.match(certo.stderr, /PREMERGE_MIGRATIONS_NAO_COMPROVADAS/);
    semSegredo(certo);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('B32m (D-PROD-216/D-PROD-215): ordem de produção hoje — alvo com as 63 da main concluídas (por último o Cadastro de Culturas, D-PROD-215, depois do abastecimento ligado à atividade, D-PROD-211): o histórico confere, a única pendente é a D-PROD-216 e a barreira do CONTRACT a exige; checksum diferente do arquivo ou registro parcial é divergência; depois dela, 64 e nada pendente; nenhuma conferência depende da ordem dos nomes', () => {
  const P1_03 = '20261113300000_estoque_p1_03_indices';
  const raiz = 'backend/prisma/migrations';
  const locais = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
  assert.equal(locais.length, 64);
  assert.ok(locais.every((l) => l.nome <= NOME_FA), 'o reforço é a migration de nome mais recente: a ordem do repositório é a de produção');
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  // Produção: as 62 de B30m (depois da D-PROD-211), na ordem em que foram concluídas, e por último a D-PROD-215 (B31k).
  const fora = [NOME_FA, NOME_CU, NOME_AB, NOME_BC, NOME_TT, NOME_PP, NOME_MO, NOME_FT, NOME_LC, NOME_F, NOME_L, NOME_V, NOME_PO, NOME_P, NOME_G, NOME_K, NOME_D, P1_03, NOME_I];
  const ordem = [...locais.filter((l) => !fora.includes(l.nome)), ...[NOME_D, P1_03, NOME_I, NOME_K, NOME_G, NOME_P, NOME_PO, NOME_V, NOME_L, NOME_F, NOME_LC, NOME_FT, NOME_MO, NOME_PP, NOME_TT, NOME_BC, NOME_AB, NOME_CU].map((n) => locais.find((l) => l.nome === n))];
  const linhas = ordem.map((l, i) => ({ migration_name: l.nome, checksum: l.checksum, finished_at: new Date(t0 + i * 1000), rolled_back_at: null }));
  assert.equal(linhas.length, 63);
  assert.deepEqual(linhas.slice(-2).map((l) => l.migration_name), [NOME_AB, NOME_CU]);
  // As duas últimas concluídas com o checksum do arquivo (os mesmos que o preflight do runbook confere).
  assert.equal(linhas.at(-2).checksum, '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436');
  assert.equal(linhas.at(-1).checksum, '37a71c46f138f457022fbab8316d645eb4f39a6e2a3ddfe4c8a3394e19665715');
  const h = conferirHistoricoRemoto({ locais, linhas });
  assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME_FA], falhas: [] });
  assert.deepEqual(conferirHistoricoRemoto({ locais: [...locais].reverse(), linhas: [...linhas].reverse() }), h);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas }), [{ nome: NOME_FA, decisao: 'D-PROD-216' }]);
  // Sem a D-PROD-215 concluída, as duas pendem (a EXPAND não pede decisão; a barreira continua só com a D-PROD-216).
  const semCU = linhas.filter((l) => l.migration_name !== NOME_CU);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: semCU }).pendentes, [NOME_CU, NOME_FA]);
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: semCU }), [{ nome: NOME_FA, decisao: 'D-PROD-216' }]);
  const linhaFA = (checksum, extra = {}) => ({ migration_name: NOME_FA, checksum, finished_at: new Date(t0 + 99_000), rolled_back_at: null, ...extra });
  for (const errado of [MIGRATIONS_APROVADAS[NOME_AB], MIGRATIONS_APROVADAS[NOME_CU], 'manual', MIGRATIONS_CONTRACT_APROVADAS[NOME_FA].guarda_sha256]) {
    assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaFA(errado)] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', errado);
  }
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [...linhas, linhaFA(MIGRATIONS_APROVADAS[NOME_FA], { finished_at: null })] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  const depois = [...linhas, linhaFA(MIGRATIONS_APROVADAS[NOME_FA])];
  assert.equal(depois.length, 64);
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: depois }), { ok: true, codigo: null, pendentes: [], falhas: [] });
  assert.deepEqual(contractsPendentes({ locais: locais.map((l) => l.nome), linhas: depois }), []);
});
