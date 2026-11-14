/**
 * PR174-R6/R7 (D-PROD-107) — prova EXPAND da release e conferência do alvo.
 *
 * R7: a classificação é uma ALLOWLIST FECHADA. Padrão = RECUSAR.
 *  1. Manifesto pinado: só as migrations listadas em MIGRATIONS_APROVADAS, com o
 *     SHA-256 exato do arquivo (o mesmo checksum que o Prisma grava em
 *     `_prisma_migrations`). Arquivo novo fora da lista ou byte diferente → recusa.
 *     A pinagem só PRENDE o conteúdo auditado; a segurança vem da conferência
 *     estrutural abaixo, que roda sempre (trocar o manifesto não "aprova" nada).
 *  2. Conferência estrutural, instrução por instrução, aceitando SOMENTE:
 *     - CREATE TABLE "<nova>" (…)
 *     - CREATE INDEX "<n>" ON "<qualquer>"(…)          (não-único)
 *     - CREATE UNIQUE INDEX "<n>" ON "<nova>"(…)
 *     - ALTER TABLE "<nova>" ADD CONSTRAINT … FOREIGN KEY|CHECK …
 *     - ALTER TABLE "<nova>" DROP CONSTRAINT "<n>"
 *     - ALTER TABLE "<nova>" ADD COLUMN …
 *     - ALTER TABLE "<antiga>" ADD COLUMN "<c>" <tipo>  (anulável, sem DEFAULT volátil)
 *     - ALTER TABLE "<antiga>" ADD CONSTRAINT … FOREIGN KEY ("cliente_id", "<coluna nova>") REFERENCES "<nova>"…
 *     - DO $$ … $$ cujo corpo normalizado tem hash na lista DO_RLS_APROVADOS e
 *       só cita tabelas novas (RLS/policies das tabelas novas).
 *     Qualquer outra coisa (CREATE OR REPLACE FUNCTION/VIEW, TRIGGER, GRANT,
 *     REVOKE, COPY, INSERT, SELECT, UPDATE, DELETE, TRUNCATE, DROP, RENAME,
 *     ALTER COLUMN, CHECK/UNIQUE em tabela antiga, DO desconhecido) → violação.
 *  3. Modo CONTRACT (D-PROD-162; exceção FECHADA aprovada pelo proprietário à
 *     D-PROD-72 item 3 e à D-PROD-107 R7): só para o NOME de migration listado
 *     em MIGRATIONS_CONTRACT_APROVADAS (que também está no manifesto). Recorte
 *     prévio, com conteúdo pinado: a PRIMEIRA instrução é a guarda `DO $$ … $$`
 *     com hash pinado (e só cita as tabelas removidas, as criadas no resto e os
 *     literais listados); depois EXATAMENTE os DROP TABLE da lista, na ordem;
 *     depois EXATAMENTE as instruções `alter_antigas` (texto pinado), na ordem
 *     (alargamento de CHECK na D-PROD-162; DROP COLUMN na D-PROD-183, sem DROP TABLE;
 *     na D-PROD-187, DROP CONSTRAINT e DROP INDEX do vínculo com o ícone, DROP
 *     COLUMN e os RENAME da tabela CategoriaManejo → CADCATEGORIA e dos seus
 *     índices/constraints — todos pinados letra por letra: RENAME continua
 *     PROIBIDO no caminho EXPAND, só existe como texto pinado de uma entrada;
 *     na D-PROD-194, só o DROP TABLE da tabela VAZIA que o resto recria; na D-PROD-195,
 *     coluna nova NOT NULL com a ligação dos registros existentes, UNIQUE em tabela
 *     antiga e FK composta entre duas tabelas antigas, todos pinados letra por letra; na
 *     D-PROD-197, sem DROP nenhum, as 18 instruções ADITIVAS em TipoAtividade que a
 *     allowlist EXPAND recusa em tabela antiga — 13 ADD COLUMN, 8 delas NOT NULL
 *     DEFAULT false, 3 FKs para tabelas antigas e 2 CHECKs).
 *     Formato CONVERSÃO (D-PROD-199; a entrada tem `conversao` não vazia): os dados
 *     das tabelas que saem vão para as que entram ANTES do DROP. A ordem passa a ser
 *     guarda → `alter_antigas` (na D-PROD-199, nenhuma) → RESTO pela allowlist EXPAND
 *     (as tabelas novas, criadas no próprio resto) → EXATAMENTE as instruções
 *     `conversao` pinadas, na ordem (na D-PROD-199, o INSERT … SELECT de
 *     ApontamentoAtividade para Atividade, o de ApontamentoAtividade para
 *     AtividadeApontamento e o UPDATE que passa o contador de EntidadeCodigoSequencia
 *     para a entidade Atividade) → EXATAMENTE os DROP TABLE de `drop`, na ordem
 *     (filhas primeiro), como as ÚLTIMAS instruções do arquivo. A cauda (conversão +
 *     DROP) é casada de trás para frente sobre as últimas peças não vazias, porque o
 *     resto tem blocos DO com ';'. DML ou DROP no resto, conversão faltando, trocada
 *     de ordem ou alterada, DROP antes da conversão ou qualquer instrução depois dos
 *     DROP → recusa (SQL_NAO_RECONHECIDO no resto; CONTRACT_CONVERSAO_FORA_DO_CONTRATO
 *     ou CONTRACT_DROP_FORA_DO_CONTRATO na cauda). DML continua PROIBIDO no caminho
 *     EXPAND: só existe como texto pinado da cauda de uma entrada. As entradas sem
 *     `conversao` (as seis anteriores) seguem o formato de sempre, igual.
 *     O RESTO do arquivo passa pela allowlist EXPAND acima, tratando como novas
 *     só as tabelas criadas no próprio resto. A allowlist EXPAND não afrouxa:
 *     o mesmo SQL com outro nome é recusado. A release com CONTRACT tem de ser
 *     isolada e autorizada pela decisão exata (`--contract D-PROD-162`), e o
 *     runner oficial (`run-migrations.mjs`) recusa aplicar um CONTRACT pendente
 *     no alvo remoto sem `MIGRATION_CONTRACT_AUTORIZADO` igual à decisão.
 *  4. Conferência do alvo (somente leitura): `_prisma_migrations` × arquivos
 *     locais — extra, checksum divergente, parcial ou pendência fora do
 *     manifesto → PREMERGE_MIGRATIONS_NAO_COMPROVADAS.
 */
import { createHash } from 'node:crypto';

export const MIGRATIONS_APROVADAS = Object.freeze({
  '20261102200000_rebanho_ledger_posicoes': 'df9d713887e68fad75231b23ef4e9d6f0e4750cd67be19036d6a4bfc57c47919',
  '20261103100000_rebanho_ledger_r1_manejos': 'fcab7bd9737408c4f2783161b1a95515b590e91924e4c91c3b1a9f68dc72feb1',
  // D-PROD-122 (S1/H1): Empresa.fuso_horario anulável, sem DEFAULT.
  '20261104200000_empresa_fuso_horario': 'bb2c1cb63cbc1324b6ab9c7d9141f51dfd2418374c8badb9cfe82fe3d4f29017',
  // D-PROD-143 (S04-P1): Cliente/Usuario.sessao_epoca INTEGER anuláveis, sem DEFAULT.
  '20261106200000_s04_p1_sessao_epoca': '52cb8de740a20cf020f82115422425063e09d0d1dc5da5e5b7dc416346a2646c',
  // D-PROD-144 (S04-P2): Usuario.troca_senha_pendente BOOLEAN anulável, sem DEFAULT.
  '20261107200000_s04_p2_troca_senha_inicial': '1236460b8daf00784a4a44b80f611701749a29f0f5e2294844d297ee594d87fb',
  // D-PROD-146 (Gestão P1): CentroCusto, CentroResultado e CentroCustoResultado — só tabelas novas.
  '20261107300000_gestao_p1_centros_custo_resultado': 'e29855b2367e0a6c684c058578cd0783831e6380b16ef5202801dd7a7f1cecf5',
  // D-PROD-153 (Gestão P2): NaturezaFinanceira — só tabela nova.
  '20261108100000_gestao_p2_naturezas_financeiras': 'db299e1d3543769ed46f07ee174521d3ea75b2990b94181012eecdafb9462f04',
  // D-PROD-155 (Gestão P3-01): Central Única de Lançamentos — só as 8 tabelas novas.
  '20261109100000_gestao_p3_01_central_lancamentos': 'bb89f4e090b94a8510971996668f552abdfa98f54248bf6e32ffbb4a451dc18a',
  // D-PROD-156 (Gestão P3-02): OperacaoFinanceira.rateio_escopo anulável, sem DEFAULT + tabela nova OperacaoFinanceiraItemRateio.
  '20261109200000_gestao_p3_02_rateio_por_item': 'df4d1ab29144d551793bb2fe43616d60bed86b87f10ec044d1cae2552076f4a0',
  // D-PROD-158 (Gestão P3-03; o comentário dentro do migration.sql, já aplicado, diz D-PROD-157 e fica imutável): OperacaoFinanceira.excluido_em e .retificado_em anuláveis, sem DEFAULT + tabela nova OperacaoFinanceiraEvento.
  '20261109300000_gestao_p3_03_editar_excluir': '3f3af00edaffcce8ab0b64336029a93341bfbaba26c847e32e1d2658e4df890b',
  // D-PROD-157 (Patrimônio P1-01): cadastros de inventário (catálogos, bens, medições, tanques e o vínculo
  // combustível × produto por empresa, R2) — só as 10 tabelas novas.
  '20261110100000_patrimonio_p1_01_cadastros': 'b8818ba8f16528580b7ba6053b0c89f07f0d4fd434955f4b9c5830a62ffd64dc',
  // D-PROD-159 (Patrimônio P1-02): ConversaoCombustivelProduto, AbastecimentoBem e AbastecimentoBemConsumoLote — só tabelas novas.
  '20261110200000_patrimonio_p1_02_abastecimentos': '20f8f9609a8e09f123dac0ed7ba87747069b26ad07411e843481ffec59b15fba',
  // D-PROD-162 (Patrimônio SIMPLIFICA-01): CONTRACT aprovado pelo proprietário — apaga as 13 tabelas do Patrimônio, alarga 2 CHECKs de OperacaoFinanceiraItem (L) e cria as 7 novas.
  '20261110300000_patrimonio_simplifica': '787d6d118939c6eca4e3c3f45bf94a4f94d1f1625cbfb2ea2102b190ad944222',
  // D-PROD-182: TipoAtividade (cadastro de tipos de atividade) — só tabela nova.
  '20261113100000_tipo_atividade_cadastro': '5a0ded9c62f108c818c5796c2fe9d116faaceaf62bc4da6312562ec74d3a724e',
  // D-PROD-183: CONTRACT aprovado pelo proprietário — DROP COLUMN das 4 colunas dormentes de TipoTarefa (D-PROD-181).
  '20261113200000_tipo_tarefa_drop_colunas': '47409bb1a7d371efe89fffba753ae292aec6f95e1ba7845d35dff74371136c17',
  // D-PROD-185 (MAIKE-ESTOQUE-P1-03, M7): EXPAND só de índices não-únicos em tabelas antigas (LC-2 e keyset de movimentos).
  '20261113300000_estoque_p1_03_indices': '5d91e751e4e924f94154ddaad603203e0d21ebc0e84fd242c6a2108ea6d28565',
  // D-PROD-188: CADESTACOES (cadastro de Estações da fazenda) — só tabela nova.
  '20261113400000_cadestacoes_cadastro': '5d295863216619103ac9e645229edb9d3ffa25a06774097df3429b5358dc90f7',
  // D-PROD-187: CONTRACT aprovado pelo proprietário — DROP COLUMN das 15 colunas dormentes de CategoriaManejo (D-PROD-186)
  // e do vínculo com o ícone oficial (FK e índice), e tabela física renomeada para CADCATEGORIA.
  '20261113500000_categoria_manejo_cadcategoria': '83ca58a07439a1cf4e12671fd5f6b89bf62be2aef7ff64112cca6f1418d37e1c',
  // D-PROD-189: CADCURVAGANHO (cadastro de Curvas de Ganho de Peso) — só tabela nova.
  '20261113600000_cadcurvaganho_cadastro': '137f93f26f2f5edd3feeaeae21ff363d2746fbdb93b729efe75935c631e96ac6',
  // D-PROD-190 (Fatia C): ApontamentoAtividade (execução de uma atividade) — só tabela nova.
  '20261113700000_apontamento_atividade': 'a9735833d64b5ebd50d35b12e6eaaa20e1d70bbad6defc131db1dd50e5fab75e',
  // D-PROD-193 (Fatia D do apontamento): ApontamentoAtividadeItem e ApontamentoAtividadeItemConsumoLote — só tabelas novas.
  '20261113800000_apontamento_atividade_item': '866dc9944772afb08ee851dd653d62db73dccfa5e152f611f2205c3eb594533c',
  // D-PROD-194: CONTRACT aprovado pelo proprietário — CADCURVAGANHO VAZIA sai e volta com os 12 GMD mensais.
  '20261114100000_cadcurvaganho_mensal': 'a18b2845815a637398ccd8d1e0f9cbcbad1bab8e8b628e988d26cf09c302953c',
  // D-PROD-195: CONTRACT aprovado pelo proprietário — curva de ganho obrigatória na Categoria de Manejo, da mesma fazenda.
  '20261114200000_cadcategoria_curva_ganho': 'b509ee754722f5e9f70938f2c17ddbe253734c7c86e0aecb55498a37d44e68fb',
  // D-PROD-197: CONTRACT aprovado pelo proprietário — TipoAtividade ganha 5 padrões anuláveis, 8 flags NOT NULL
  // DEFAULT false, 3 FKs (centros e unidade) e 2 CHECKs; mudança aditiva, sem DROP.
  '20261114300000_tipo_atividade_defaults': 'b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf',
  // D-PROD-199: CONTRACT aprovado pelo proprietário — a atividade vira cabeçalho: Atividade e AtividadeApontamento
  // novas, cada ApontamentoAtividade convertido nas duas (conversão pinada) e as 3 tabelas antigas apagadas no fim.
  '20261114500000_atividade_cabecalho': 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb',
});
/** Blocos DO auditados (RLS das tabelas novas): sha256 do corpo sem comentários e com espaços normalizados. */
export const DO_RLS_APROVADOS = Object.freeze([
  'b38a85816a49d2b3335e6a1bfa1098ed86ac38cc6d7e0b0bd1db979e97f770fd',
  'e6e0a232e9b893ae8bf24387e3455f89256930eef2aed29d7ac96130f4c62ae9',
  // D-PROD-146: RLS/REVOKE das três tabelas de Gestão P1 (mesmo corpo, lista nova).
  '62795ad42ff36406e413e54a16a6ee43abe93318ee4155967f57120b031d2aa3',
  // D-PROD-153: RLS/REVOKE de NaturezaFinanceira (mesmo corpo, lista nova).
  'a532c9847a550d4b19015b8b3c2914b79fffdb6ae0e259438d5133c738e416a1',
  // D-PROD-155: RLS/REVOKE das 8 tabelas da Central Única de Lançamentos (mesmo corpo, lista nova).
  '0289125dfdf6df7bccc8ca070208a4c9d1bf948fad1b341ae4d443e9f13ab4fe',
  // D-PROD-156: RLS/REVOKE de OperacaoFinanceiraItemRateio (mesmo corpo, lista nova).
  'dc05126cd737c77090c54fc04cd6f7d2ac0b7613168f13fb944a7477ca7bd576',
  // D-PROD-158 (Gestão P3-03): RLS/REVOKE de OperacaoFinanceiraEvento (mesmo corpo, lista nova).
  '20c6f9ca6b880dc26efea49c4eaaa2bf3e9b3bc43dcdd7b6a6bcaee6ff899ec9',
  // D-PROD-157 (Patrimônio P1-01): RLS/REVOKE das 10 tabelas de Patrimônio e Frota (mesmo corpo, lista nova).
  '01dbf9ae4875444fa77082d37e1b71da655f217ecc25cc95a4d1b8a4a108a0a3',
  // D-PROD-159 (Patrimônio P1-02): RLS/REVOKE das 3 tabelas de abastecimento (mesmo corpo, lista nova).
  'ac1d201b0ef75b629d018b8c3c98354eb9453d752ab5e62ee4c3edb23c14bddd',
  // D-PROD-162: RLS/REVOKE das 7 tabelas do Patrimônio simplificado (mesmo corpo, lista nova).
  '6fc88d930cdbc5038bb4d604abefb9e04d993e6e776bb851369b697a8f966a7e',
  // D-PROD-182: RLS/REVOKE de TipoAtividade (mesmo corpo, lista nova).
  '4c0ed7d900541fbd626b844308762e316a793c07dfe3fcad65118facef8f94e5',
  // D-PROD-188: RLS/REVOKE de CADESTACOES (mesmo corpo, lista nova).
  '10d6c749779b4a22ea4d7fbbdf7455da1c618b7a4981bbcf10c14391b4056f5f',
  // D-PROD-189: RLS/REVOKE de CADCURVAGANHO (mesmo corpo, lista nova).
  'eaafebfa75191f2e77bd59d6a6ecf6af2c33ee86c536c39fe2b0e881cf1680a7',
  // D-PROD-190 (Fatia C): RLS/REVOKE de ApontamentoAtividade (mesmo corpo, lista nova).
  '5da2c547f176a4c49841f52ce19922b9f7c3150d3b1851cdc8e0554e408f1867',
  // D-PROD-193: RLS/REVOKE das 2 tabelas de itens do apontamento (mesmo corpo, lista nova).
  '7aaa176ccec3645fe0730b5aaedee8882b1a276e3912f3360c8d0d2c1b67f710',
  // D-PROD-199: RLS/REVOKE de Atividade e AtividadeApontamento (mesmo corpo, lista nova).
  '8f0b1b5ccc478778e1f9aeb94945e9bfde631f4accb12a55abb09e944cc5b98c',
]);

/**
 * D-PROD-162: migrations CONTRACT aprovadas pelo proprietário (exceção à D-PROD-72/D-PROD-107). Fechado: nova entrada
 * exige decisão. São sete, na ordem: D-PROD-162, D-PROD-183, D-PROD-187, D-PROD-194, D-PROD-195, D-PROD-197 e
 * D-PROD-199 (a primeira no formato CONVERSÃO: campo `conversao`, opcional; sem ele, o formato de sempre).
 */
export const MIGRATIONS_CONTRACT_APROVADAS = Object.freeze({
  '20261110300000_patrimonio_simplifica': Object.freeze({
    decisao: 'D-PROD-162',
    guarda_sha256: '28d6c422968d961bbecd40459a7e6a337f36b9d66c121982f9c295065c149046',
    drop: Object.freeze(['AbastecimentoBemConsumoLote', 'AbastecimentoBem', 'ConversaoCombustivelProduto', 'TipoCombustivelProduto',
      'TanqueBemCombustivel', 'TanqueBem', 'MedicaoBem', 'BemPatrimonial', 'TipoPatrimonialPerfil', 'TipoPatrimonial',
      'FamiliaPatrimonial', 'PerfilMedicao', 'TipoCombustivel']),
    literais_guarda: Object.freeze(['CONFIRMADO']),
    // Únicas instruções permitidas em tabela antiga: só ALARGAM os 2 CHECKs da P3-01 (:355, :361) para aceitar 'L' (D1).
    // Texto normalizado (espaços colapsados, sem o ';'), conferido na ordem, logo depois dos DROP.
    alter_antigas: Object.freeze([
      'ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_unidade_check"',
      'ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_unidade_check" CHECK ("unidade" IN (\'KG\', \'SACO\', \'UN\', \'L\'))',
      'ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_forma_check"',
      'ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_forma_check" CHECK (("tipo_item" = \'MERCADORIA\' AND "produto_id" IS NOT NULL AND "local_estoque_id" IS NOT NULL AND "unidade" IN (\'KG\', \'SACO\', \'L\') AND "fator_kg" IS NOT NULL AND "fator_kg" > 0 AND "quantidade_estoque" IS NOT NULL AND "quantidade_estoque" > 0) OR ("tipo_item" = \'SERVICO\' AND "produto_id" IS NULL AND "local_estoque_id" IS NULL AND "descricao" IS NOT NULL AND "unidade" = \'UN\' AND "fator_kg" IS NULL AND "quantidade_estoque" IS NULL AND "movimentacao_estoque_id" IS NULL AND "estoque_lote_nota_id" IS NULL AND "movimentacao_estorno_id" IS NULL))',
    ]),
  }),
  // D-PROD-183: remoção física das 4 colunas dormentes de TipoTarefa (saíram do cadastro na D-PROD-181).
  // Sem DROP TABLE e sem tabela nova: depois da guarda, EXATAMENTE os 4 DROP COLUMN, nesta ordem
  // (texto pinado; CASCADE, IF EXISTS, outra coluna ou outra tabela → CONTRACT_ALTER_FORA_DO_CONTRATO).
  '20261113200000_tipo_tarefa_drop_colunas': Object.freeze({
    decisao: 'D-PROD-183',
    guarda_sha256: '35e1a698b0567bf07f9e99943f7181a3a6ee8b1e03ea2ff423a939e755984878',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['TipoTarefa']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area"',
      'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_produto"',
      'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_maquina"',
      'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_implemento"',
    ]),
  }),
  // D-PROD-187: remoção física das 15 colunas dormentes de CategoriaManejo (saíram do cadastro na D-PROD-186) e do
  // vínculo com o ícone oficial (emenda do proprietário), e o nome físico novo da tabela, CADCATEGORIA (o model Prisma
  // continua CategoriaManejo, com @@map). Sem DROP TABLE e sem tabela nova: depois da guarda, EXATAMENTE as 23
  // instruções abaixo, nesta ordem (texto pinado; CASCADE, IF EXISTS, RENAME para outro nome, RENAME COLUMN, outra
  // coluna ou outra tabela → CONTRACT_ALTER_FORA_DO_CONTRATO). A guarda só cita CategoriaManejo e CADCATEGORIA.
  '20261113500000_categoria_manejo_cadcategoria': Object.freeze({
    decisao: 'D-PROD-187',
    guarda_sha256: '0efa2ef32dd4faf3d2419896521a6a62552f89c1af8d151b6cf1eb2495c3e384',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['CategoriaManejo', 'CADCATEGORIA']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "CategoriaManejo" DROP CONSTRAINT "CategoriaManejo_catalogo_categoria_visual_id_fkey"',
      'DROP INDEX "CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "raca"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "categoria_oficial"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "ganho_peso_anual_kg"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_janeiro"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_fevereiro"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_marco"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_abril"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_maio"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_junho"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_julho"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_agosto"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_setembro"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_outubro"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_novembro"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_dezembro"',
      'ALTER TABLE "CategoriaManejo" DROP COLUMN "catalogo_categoria_visual_id"',
      'ALTER TABLE "CategoriaManejo" RENAME TO "CADCATEGORIA"',
      'ALTER TABLE "CADCATEGORIA" RENAME CONSTRAINT "CategoriaManejo_pkey" TO "CADCATEGORIA_pkey"',
      'ALTER INDEX "CategoriaManejo_cliente_id_id_key" RENAME TO "CADCATEGORIA_cliente_id_id_key"',
      'ALTER INDEX "CategoriaManejo_cliente_id_empresa_id_idx" RENAME TO "CADCATEGORIA_cliente_id_empresa_id_idx"',
      'ALTER TABLE "CADCATEGORIA" RENAME CONSTRAINT "CategoriaManejo_cliente_id_fkey" TO "CADCATEGORIA_cliente_id_fkey"',
    ]),
  }),
  // D-PROD-194: a Curva de Ganho passa de 3 GMD por estação para 12 GMD mensais. A guarda só
  // aceita CADCURVAGANHO VAZIA, com as 3 colunas por estação; depois dela, EXATAMENTE o
  // DROP TABLE "CADCURVAGANHO" e, no resto, a mesma tabela recriada (allowlist EXPAND),
  // com o RLS de corpo já aprovado na D-PROD-189. Nenhuma outra tabela é tocada.
  '20261114100000_cadcurvaganho_mensal': Object.freeze({
    decisao: 'D-PROD-194',
    guarda_sha256: '3cd5adc49d6e0cab0e155b190d7c095a419b7ddbb0ef617bc5000bc9bdfb0b6d',
    drop: Object.freeze(['CADCURVAGANHO']),
    literais_guarda: Object.freeze([]),
    alter_antigas: Object.freeze([]),
  }),
  // D-PROD-195: a Categoria de Manejo ganha a curva de ganho OBRIGATÓRIA, da mesma fazenda. A guarda exige
  // exatamente uma 'CURVA PADRÃO' em cada fazenda com categoria; depois dela, EXATAMENTE as 5 instruções abaixo
  // (texto pinado: a coluna, a ligação das categorias existentes à CURVA PADRÃO da fazenda, o NOT NULL, o UNIQUE
  // (cliente_id, empresa_id, id) que a FK composta exige em CADCURVAGANHO e a FK). No resto, só o índice não-único.
  '20261114200000_cadcategoria_curva_ganho': Object.freeze({
    decisao: 'D-PROD-195',
    guarda_sha256: '292d2446635c3178f10af0d24c33df0d92513f3725efb1ed2059ccc713cb63a8',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['CADCATEGORIA', 'CADCURVAGANHO']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "CADCATEGORIA" ADD COLUMN "curva_ganho_id" VARCHAR(64)',
      'UPDATE "CADCATEGORIA" AS c SET "curva_ganho_id" = k."id" FROM "CADCURVAGANHO" AS k WHERE k."cliente_id" = c."cliente_id" AND k."empresa_id" = c."empresa_id" AND k."nome" = \'CURVA PADRÃO\'',
      'ALTER TABLE "CADCATEGORIA" ALTER COLUMN "curva_ganho_id" SET NOT NULL',
      'CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_empresa_id_id_key" ON "CADCURVAGANHO"("cliente_id", "empresa_id", "id")',
      'ALTER TABLE "CADCATEGORIA" ADD CONSTRAINT "CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "curva_ganho_id") REFERENCES "CADCURVAGANHO"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
    ]),
  }),
  // D-PROD-197: o Tipo de Atividade ganha os padrões e as flags. A mudança é ADITIVA: nenhuma linha muda de valor,
  // nenhuma coluna existente é tocada, nenhuma tabela é criada ou apagada, nenhum DROP. Só é CONTRACT porque a allowlist
  // EXPAND recusa, em tabela antiga, coluna NOT NULL DEFAULT (as 8 flags), FK para tabela ANTIGA (CentroCusto,
  // CentroResultado e UnidadeMedida) e CHECK — o mesmo caminho dos alargamentos de CHECK da D-PROD-162. Depois da
  // guarda, EXATAMENTE as 18 instruções abaixo, nesta ordem: 13 ADD COLUMN (5 anuláveis sem DEFAULT e as 8 flags), 3 FKs
  // compostas pelo tenant com RESTRICT e 2 CHECKs (texto pinado: outro tipo, NULL/DEFAULT trocado, outra coluna, outra
  // tabela ou alvo, SET NULL/CASCADE, NOT VALID, CHECK diferente, uma a mais na sequência, faltando ou fora de ordem →
  // CONTRACT_ALTER_FORA_DO_CONTRATO). O resto são os 3 CREATE INDEX não-únicos pela allowlist EXPAND, que continua
  // recusando UNIQUE, ALTER COLUMN, DML e qualquer outra coisa em TipoAtividade. A guarda só cita TipoAtividade e os
  // três alvos das FKs. As 13 colunas aparecem em `contract[].colunas_adicionadas` e as 5 constraints em
  // `constraints_adicionadas` (não em `colunas_novas_em_tabelas_antigas`, que é do caminho EXPAND e libera FK para
  // tabela nova, nem em `constraints_alargadas`: nada aqui alarga constraint existente).
  '20261114300000_tipo_atividade_defaults': Object.freeze({
    decisao: 'D-PROD-197',
    guarda_sha256: 'e15780190baf9494f20535c2e3ced21eb20ea6b8f362eeac0b2477dcf6dab3b0',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['TipoAtividade', 'CentroCusto', 'CentroResultado', 'UnidadeMedida']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "TipoAtividade" ADD COLUMN "categoria" VARCHAR(24)',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "centro_custo_padrao_id" VARCHAR(64)',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "centro_resultado_padrao_id" VARCHAR(64)',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "unidade_producao_id" VARCHAR(64)',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "coeficiente_padrao" DECIMAL(14,4)',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "exige_area" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "exige_safra" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "exige_maquina" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "permite_implemento" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "permite_produto" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "permite_servico" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "permite_mao_obra" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "TipoAtividade" ADD COLUMN "exige_producao" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_centro_custo_padrao_id_fkey" FOREIGN KEY ("cliente_id", "centro_custo_padrao_id") REFERENCES "CentroCusto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
      'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey" FOREIGN KEY ("cliente_id", "centro_resultado_padrao_id") REFERENCES "CentroResultado"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
      'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_unidade_producao_id_fkey" FOREIGN KEY ("cliente_id", "unidade_producao_id") REFERENCES "UnidadeMedida"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
      'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_categoria_check" CHECK ("categoria" IN (\'PREPARO_SOLO\', \'PLANTIO\', \'TRATO_CULTURAL\', \'APLICACAO\', \'COLHEITA\', \'PASTAGEM\', \'BENFEITORIA\', \'MANEJO_ANIMAL\', \'OUTROS\'))',
      'ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_coeficiente_padrao_check" CHECK ("coeficiente_padrao" > 0)',
    ]),
  }),
  // D-PROD-199: a atividade vira CABEÇALHO e o apontamento de hoje vira FILHO dela. Formato CONVERSÃO: a guarda (hash
  // pinado) confere as 3 tabelas antigas e as trava em ACCESS EXCLUSIVE antes de conferir os itens de custo e as fatias
  // FIFO vazios, os campos sem lugar no modelo novo vazios, os status e o contador; nenhuma instrução em tabela antiga
  // logo depois dela; no resto, Atividade e AtividadeApontamento pela allowlist EXPAND (CREATE TABLE, índices, CHECKs,
  // FKs e o RLS de corpo novo); depois EXATAMENTE as 3 instruções `conversao` (texto pinado: cada linha antiga vira
  // uma Atividade, com id 'atv_' || id antigo e o mesmo número, e um AtividadeApontamento filho com o mesmo id; o
  // contador passa para a entidade Atividade) e, por ÚLTIMO, EXATAMENTE os 3 DROP TABLE, filhas primeiro. A guarda só
  // cita as 3 removidas, as 2 criadas no resto e os literais abaixo. As 3 instruções aparecem em `contract[].conversoes`.
  '20261114500000_atividade_cabecalho': Object.freeze({
    decisao: 'D-PROD-199',
    guarda_sha256: '6d192b5423d728d425d20d4a98d28335b7617a6261ae96999162a71578856f64',
    drop: Object.freeze(['ApontamentoAtividadeItemConsumoLote', 'ApontamentoAtividadeItem', 'ApontamentoAtividade']),
    literais_guarda: Object.freeze(['CONFIRMADO', 'CANCELADO', 'EntidadeCodigoSequencia']),
    alter_antigas: Object.freeze([]),
    conversao: Object.freeze([
      [
        'INSERT INTO "Atividade" ("id", "cliente_id", "empresa_id", "numero", "nome", "tipo_atividade_id", "tipo_atividade_nome",',
        '"grupo_atividade_id", "grupo_atividade_nome", "area_id", "setor_id", "setor_nome", "bem_id", "safra_ciclo",',
        '"centro_custo_id", "centro_resultado_id", "unidade_producao_id", "unidade_producao_sigla", "data_inicio",',
        '"area_executada", "quantidade_produzida", "lancamento_tarefa_id", "status", "cancelada_em",',
        '"cancelado_por_usuario_id", "motivo_cancelamento", "criado_por_usuario_id", "versao", "createdAt", "updatedAt")',
        'SELECT \'atv_\' || a."id", a."cliente_id", a."empresa_id", a."numero",',
        'left(a."tipo_atividade_nome" || \' (apontamento nº \' || a."numero" || \')\', 120), a."tipo_atividade_id",',
        'a."tipo_atividade_nome", a."grupo_atividade_id", a."grupo_atividade_nome", a."area_id", ar."setor_id",',
        'ar."setor_nome", a."bem_id", a."safra_ciclo", a."centro_custo_id", a."centro_resultado_id", NULL,',
        'a."unidade_producao", a."data_operacional", NULL,',
        'CASE WHEN a."status" = \'CONFIRMADO\' THEN a."quantidade_produzida" END, a."lancamento_tarefa_id",',
        'CASE WHEN a."status" = \'CANCELADO\' THEN \'CANCELADA\' ELSE \'ABERTA\' END, a."cancelado_em",',
        'a."cancelado_por_usuario_id", a."motivo_cancelamento", a."criado_por_usuario_id", 1, a."createdAt", a."updatedAt"',
        'FROM "ApontamentoAtividade" AS a',
        'LEFT JOIN "AreaPastagem" AS ar ON ar."cliente_id" = a."cliente_id" AND ar."id" = a."area_id"',
      ].join(' '),
      [
        'INSERT INTO "AtividadeApontamento" ("id", "cliente_id", "empresa_id", "atividade_id", "data_operacional", "turno",',
        '"sequencia", "operador_usuario_id", "area_executada_dia", "quantidade_produzida_dia", "observacao", "origem",',
        '"status", "cancelado_em", "cancelado_por_usuario_id", "motivo_cancelamento", "criado_por_usuario_id", "versao",',
        '"createdAt", "updatedAt")',
        'SELECT a."id", a."cliente_id", a."empresa_id", \'atv_\' || a."id", a."data_operacional", NULL, 1,',
        'a."operador_usuario_id", NULL, a."quantidade_produzida", a."observacao", \'WEB\', a."status", a."cancelado_em",',
        'a."cancelado_por_usuario_id", a."motivo_cancelamento", a."criado_por_usuario_id", a."versao", a."createdAt",',
        'a."updatedAt"',
        'FROM "ApontamentoAtividade" AS a',
      ].join(' '),
      'UPDATE "EntidadeCodigoSequencia" SET "entidade" = \'Atividade\', "updatedAt" = CURRENT_TIMESTAMP WHERE "entidade" = \'ApontamentoAtividade\'',
    ]),
  }),
});

/**
 * PR174-R8: migrations HISTÓRICAS aplicadas à mão em produção, registradas em
 * `_prisma_migrations` com checksum literal 'manual' (documentado em
 * docs/engineering/MAIKE-CATALOGO-OPERACAO-SUPABASE.md, A2). Exceção FECHADA:
 * só estes nomes e só o valor exato 'manual'; qualquer outro checksum diferente
 * do arquivo continua sendo divergência.
 */
export const CHECKSUM_MANUAL_HISTORICO = Object.freeze([
  '20260908174141_p3_foundation',
  '20260909112833_p4_1_setor_native',
  '20260909201703_p4_1_r2_setor_tipo_default',
  '20261027140000_p4_marcas_native',
]);

export const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');
const semComentarios = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const q = (s) => s.replace(/"/g, '');
const ID = '"[A-Za-z_][A-Za-z0-9_]*"';

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const CITACAO_DO = /'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g;
const tabelasCriadas = (sql) => [...semComentarios(sql).matchAll(new RegExp(`CREATE TABLE (${ID})`, 'g'))].map((x) => q(x[1]));

/**
 * Laço EXPAND (allowlist fechada) sobre UM trecho de SQL, com o conjunto de
 * tabelas `novas` dado pelo chamador.
 */
const classificarExpand = (nome, sqlBruto, { novas, colunasNovasEmAntigas, doAprovados, v }) => {
  let sql = semComentarios(sqlBruto);
  sql = sql.replace(/DO\s+\$\$([\s\S]*?)\$\$\s*;?/g, (_, corpo) => {
    const corpoNorm = norm(corpo);
    if (!doAprovados.includes(sha256(corpoNorm))) v(nome, 'DO_NAO_RECONHECIDO', corpoNorm);
    const citadas = [...corpoNorm.matchAll(CITACAO_DO)].map((x) => x[1] ?? x[2]);
    for (const t of citadas) if (!novas.has(t)) v(nome, 'DO_EM_TABELA_ANTIGA', t);
    return ';';
  });
  for (const bruto of sql.split(';')) {
    const st = norm(bruto);
    if (!st) continue;
    let x;
    if ((x = st.match(new RegExp(`^CREATE TABLE (${ID}) \\(`)))) continue;
    if ((x = st.match(new RegExp(`^CREATE (UNIQUE )?INDEX ${ID} ON (${ID}) ?\\(`)))) {
      if (x[1] && !novas.has(q(x[2]))) v(nome, 'UNIQUE_EM_TABELA_ANTIGA', q(x[2]));
      continue;
    }
    if ((x = st.match(new RegExp(`^ALTER TABLE (${ID}) (.*)$`)))) {
      const tabela = q(x[1]);
      const acao = x[2];
      if (novas.has(tabela)) {
        if (new RegExp(`^(ADD CONSTRAINT ${ID} (FOREIGN KEY|CHECK) |DROP CONSTRAINT ${ID}$|ADD COLUMN ${ID} )`).test(acao)) continue;
        v(nome, 'ALTER_NAO_RECONHECIDO', `${tabela}: ${acao}`);
        continue;
      }
      const col = acao.match(new RegExp(`^ADD COLUMN (${ID}) (VARCHAR\\(\\d+\\)|TEXT|INTEGER|BOOLEAN|TIMESTAMP\\(3\\)|DECIMAL\\(\\d+,\\d+\\))$`));
      if (col) {
        colunasNovasEmAntigas.add(`${tabela}.${q(col[1])}`);
        continue;
      }
      const fk = acao.match(new RegExp(`^ADD CONSTRAINT ${ID} FOREIGN KEY \\("cliente_id", (${ID})\\) REFERENCES (${ID})\\("cliente_id", "id"\\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$`));
      if (fk && colunasNovasEmAntigas.has(`${tabela}.${q(fk[1])}`) && novas.has(q(fk[2]))) continue;
      v(nome, 'ALTER_EM_TABELA_ANTIGA', `${tabela}: ${acao}`);
      continue;
    }
    v(nome, 'SQL_NAO_RECONHECIDO', st);
  }
};

/**
 * `ADD CONSTRAINT` do texto pinado, separados pelo que fazem (`ALTER TABLE "T" ADD CONSTRAINT "C" …` → "T.C"):
 * ALARGADA é a recriada — o `DROP CONSTRAINT` do mesmo nome, na mesma tabela, vem ANTES dela (D-PROD-162: apaga o CHECK
 * e o cria mais largo); ADICIONADA é a que não existia (D-PROD-197: FKs e CHECKs novos). Até a D-PROD-194 todo `ADD
 * CONSTRAINT` pinado era alargamento; o `premerge-migrate` rotula `constraints_alargadas` como "CHECKs alargados".
 */
const constraintsPorEfeito = (alterAntigas) => {
  const apagadas = new Set();
  const alargadas = [];
  const adicionadas = [];
  for (const a of alterAntigas) {
    const apaga = a.match(new RegExp(`^ALTER TABLE (${ID}) DROP CONSTRAINT (${ID})$`));
    if (apaga) {
      apagadas.add(`${q(apaga[1])}.${q(apaga[2])}`);
      continue;
    }
    const cria = a.match(new RegExp(`^ALTER TABLE (${ID}) ADD CONSTRAINT (${ID}) `));
    if (cria) {
      const c = `${q(cria[1])}.${q(cria[2])}`;
      (apagadas.has(c) ? alargadas : adicionadas).push(c);
    }
  }
  return { alargadas, adicionadas };
};

/** D-PROD-197 — colunas acrescentadas a tabela antiga, a partir do texto pinado (`ALTER TABLE "T" ADD COLUMN "c" …`). */
const colunasAdicionadas = (alterAntigas) =>
  alterAntigas.map((a) => a.match(new RegExp(`^ALTER TABLE (${ID}) ADD COLUMN (${ID}) `))).filter(Boolean).map((x) => `${q(x[1])}.${q(x[2])}`);

/** D-PROD-183 — colunas removidas, a partir do texto pinado (`ALTER TABLE "T" DROP COLUMN "c"`). */
const colunasRemovidas = (alterAntigas) =>
  alterAntigas.map((a) => a.match(new RegExp(`^ALTER TABLE (${ID}) DROP COLUMN (${ID})$`))).filter(Boolean).map((x) => `${q(x[1])}.${q(x[2])}`);

/**
 * D-PROD-187 — constraints removidas de vez: `DROP CONSTRAINT` sem um `ADD CONSTRAINT` do mesmo nome na mesma
 * tabela depois (o alargamento da D-PROD-162 apaga e recria; não é remoção).
 */
const constraintsRemovidas = (alterAntigas) => {
  const recriadas = new Set(alterAntigas.map((a) => a.match(new RegExp(`^ALTER TABLE (${ID}) ADD CONSTRAINT (${ID}) `))).filter(Boolean).map((x) => `${q(x[1])}.${q(x[2])}`));
  return alterAntigas.map((a) => a.match(new RegExp(`^ALTER TABLE (${ID}) DROP CONSTRAINT (${ID})$`))).filter(Boolean)
    .map((x) => `${q(x[1])}.${q(x[2])}`).filter((c) => !recriadas.has(c));
};

/** D-PROD-187 — índices removidos, a partir do texto pinado (`DROP INDEX "i"`). */
const indicesRemovidos = (alterAntigas) =>
  alterAntigas.map((a) => a.match(new RegExp(`^DROP INDEX (${ID})$`))).filter(Boolean).map((x) => q(x[1]));

/** D-PROD-187 — tabelas renomeadas, a partir do texto pinado (`ALTER TABLE "A" RENAME TO "B"` → "A→B"). */
const tabelasRenomeadas = (alterAntigas) =>
  alterAntigas.map((a) => a.match(new RegExp(`^ALTER TABLE (${ID}) RENAME TO (${ID})$`))).filter(Boolean).map((x) => `${q(x[1])}→${q(x[2])}`);

/**
 * D-PROD-187 — índices e constraints renomeados, a partir do texto pinado (`ALTER TABLE "T" RENAME CONSTRAINT "a" TO
 * "b"` e `ALTER INDEX "a" RENAME TO "b"` → "a→b").
 */
const nomesRenomeados = (alterAntigas) =>
  alterAntigas
    .map((a) => a.match(new RegExp(`^ALTER TABLE ${ID} RENAME CONSTRAINT (${ID}) TO (${ID})$`)) ?? a.match(new RegExp(`^ALTER INDEX (${ID}) RENAME TO (${ID})$`)))
    .filter(Boolean).map((x) => `${q(x[1])}→${q(x[2])}`);

/**
 * D-PROD-199 — o que cada instrução pinada da conversão escreve, a partir do texto pinado (`INSERT INTO "T" …` →
 * "INSERT INTO T", `UPDATE "T" …` → "UPDATE T"). Instrução de outra forma sai com o começo do próprio texto.
 */
const conversoesDe = (conversao) =>
  conversao.map((c) => {
    const x = c.match(new RegExp(`^(INSERT INTO|UPDATE|DELETE FROM) (${ID})`));
    return x ? `${x[1]} ${q(x[2])}` : c.slice(0, 40);
  });

/**
 * D-PROD-199 — formato CONVERSÃO: casa a CAUDA do arquivo, de trás para frente, sobre as peças não vazias de
 * `instrucoes` a partir de `inicio`: por último EXATAMENTE os `DROP TABLE` de `drop`, na ordem, e logo antes deles
 * EXATAMENTE as instruções `conversao`, na ordem. De trás para frente porque o resto (antes da cauda) tem blocos DO,
 * que contêm ';'; a cauda não tem DO. Devolve o índice da primeira peça da cauda (o resto acaba nele), ou `null` se a
 * cauda não casou (a violação já foi registrada).
 */
const casarCaudaConversao = (instrucoes, inicio, k, nome, v) => {
  const drops = k.drop.map((t) => `DROP TABLE "${t}"`);
  const esperadas = [...k.conversao, ...drops];
  let i = instrucoes.length;
  for (let n = esperadas.length - 1; n >= 0; n--) {
    do i--; while (i >= inicio && !norm(instrucoes[i]));
    const achado = i >= inicio ? norm(instrucoes[i]) : '';
    if (achado === esperadas[n]) continue;
    if (n >= k.conversao.length) {
      v(nome, 'CONTRACT_DROP_FORA_DO_CONTRATO', `posição ${n - k.conversao.length}: esperado ${esperadas[n]} encontrado ${achado}`);
    } else {
      v(nome, 'CONTRACT_CONVERSAO_FORA_DO_CONTRATO', `posição ${n}: esperado ${esperadas[n].slice(0, 30)}… encontrado ${achado}`);
    }
    return null;
  }
  return i;
};

/**
 * D-PROD-162 — recorte CONTRACT de UMA migration (nome em `contratos`). Confere
 * a guarda pinada, os DROP e os alargamentos na ordem; devolve o RESTO para a
 * allowlist EXPAND, ou `null` se o recorte já falhou (não há como alinhar o resto).
 * D-PROD-199: com `conversao` não vazia, os DROP saem do início e vão para o FIM, depois da conversão pinada
 * (`casarCaudaConversao`); o resto fica entre os `alter_antigas` e a cauda.
 */
const recortarContract = (m, k, v) => {
  const limpo = semComentarios(m.sql).trim();
  const guarda = limpo.match(/^DO\s+\$\$([\s\S]*?)\$\$\s*;/);
  if (!guarda) {
    v(m.nome, 'CONTRACT_GUARDA_AUSENTE', 'a 1ª instrução tem de ser a guarda DO $$ … $$ pinada');
    return null;
  }
  const corpo = norm(guarda[1]);
  if (sha256(corpo) !== k.guarda_sha256) v(m.nome, 'CONTRACT_GUARDA_NAO_RECONHECIDA', corpo);
  const instrucoes = limpo.slice(guarda[0].length).split(';');
  const conversao = k.conversao?.length > 0;
  const dropsNoInicio = conversao ? [] : k.drop;
  for (let i = 0; i < dropsNoInicio.length; i++) {
    const esperado = `DROP TABLE "${dropsNoInicio[i]}"`;
    const achado = norm(instrucoes[i] ?? '');
    if (achado !== esperado) {
      v(m.nome, 'CONTRACT_DROP_FORA_DO_CONTRATO', `posição ${i}: esperado ${esperado} encontrado ${achado}`);
      return null;
    }
  }
  for (let j = 0; j < k.alter_antigas.length; j++) {
    const achado = norm(instrucoes[dropsNoInicio.length + j] ?? '');
    if (achado !== k.alter_antigas[j]) {
      v(m.nome, 'CONTRACT_ALTER_FORA_DO_CONTRATO', `posição ${j}: esperado ${k.alter_antigas[j].slice(0, 30)}… encontrado ${achado}`);
      return null;
    }
  }
  const inicioDoResto = dropsNoInicio.length + k.alter_antigas.length;
  const fimDoResto = conversao ? casarCaudaConversao(instrucoes, inicioDoResto, k, m.nome, v) : instrucoes.length;
  if (fimDoResto === null) return null;
  const resto = instrucoes.slice(inicioDoResto, fimDoResto).join(';');
  const permitidas = new Set([...k.drop, ...tabelasCriadas(resto), ...k.literais_guarda]);
  for (const x of corpo.matchAll(CITACAO_DO)) {
    const t = x[1] ?? x[2];
    if (!permitidas.has(t)) v(m.nome, 'DO_EM_TABELA_ANTIGA', t);
  }
  return resto;
};

/**
 * @param {Array<{nome: string, sql: string}>} migrations
 * @param {{manifesto?: Record<string,string>, doAprovados?: readonly string[], contratos?: Record<string, any>}} [opcoes]
 */
export const classificarMigrations = (migrations, { manifesto = MIGRATIONS_APROVADAS, doAprovados = DO_RLS_APROVADOS, contratos = MIGRATIONS_CONTRACT_APROVADAS } = {}) => {
  const violacoes = [];
  const contract = [];
  const v = (migration, codigo, detalhe) => violacoes.push({ migration, codigo, detalhe: String(detalhe).slice(0, 80) });
  for (const m of migrations) {
    if (!(m.nome in manifesto)) v(m.nome, 'MIGRATION_NAO_APROVADA', 'fora do manifesto da release');
    else if (sha256(m.sql) !== manifesto[m.nome]) v(m.nome, 'MIGRATION_CHECKSUM_DIVERGENTE', 'conteúdo difere do auditado');
  }
  const novas = new Set();
  for (const m of migrations) for (const t of tabelasCriadas(m.sql)) novas.add(t);
  const colunasNovasEmAntigas = new Set();
  for (const m of migrations) {
    const k = Object.hasOwn(contratos, m.nome) && Object.hasOwn(manifesto, m.nome) ? contratos[m.nome] : null;
    if (!k) {
      classificarExpand(m.nome, m.sql, { novas, colunasNovasEmAntigas, doAprovados, v });
      continue;
    }
    const constraints = constraintsPorEfeito(k.alter_antigas);
    contract.push({
      migration: m.nome, decisao: k.decisao, tabelas_removidas: [...k.drop],
      constraints_alargadas: constraints.alargadas, colunas_removidas: colunasRemovidas(k.alter_antigas),
      constraints_removidas: constraintsRemovidas(k.alter_antigas), indices_removidos: indicesRemovidos(k.alter_antigas),
      tabelas_renomeadas: tabelasRenomeadas(k.alter_antigas), nomes_renomeados: nomesRenomeados(k.alter_antigas),
      colunas_adicionadas: colunasAdicionadas(k.alter_antigas), constraints_adicionadas: constraints.adicionadas,
      conversoes: conversoesDe(k.conversao ?? []),
    });
    const resto = recortarContract(m, k, v);
    if (resto !== null) classificarExpand(m.nome, resto, { novas: new Set(tabelasCriadas(resto)), colunasNovasEmAntigas, doAprovados, v });
  }
  const ok = violacoes.length === 0;
  return {
    ok,
    expand: ok && contract.length === 0,
    modo: contract.length ? 'CONTRACT' : 'EXPAND',
    contract,
    tabelas_novas: [...novas].sort(),
    colunas_novas_em_tabelas_antigas: [...colunasNovasEmAntigas].sort(),
    violacoes,
  };
};

/**
 * D-PROD-162 — a release com CONTRACT é ISOLADA (a migration CONTRACT é a única
 * nova) e só é verificada/aplicada com a decisão exata; `--contract` numa release
 * sem CONTRACT é recusado (CONTRACT_INESPERADO). Puro.
 * @param {{nomesNovas: string[], classificacao: {contract: Array<{decisao: string}>}, autorizacao?: string|null}} e
 */
export const conferirReleaseContract = ({ nomesNovas, classificacao, autorizacao }) => {
  const [k] = classificacao.contract ?? [];
  const informada = autorizacao !== undefined && autorizacao !== null;
  if (!k) return informada ? { ok: false, codigo: 'CONTRACT_INESPERADO' } : { ok: true, codigo: null };
  if (nomesNovas.length !== 1 || classificacao.contract.length !== 1) return { ok: false, codigo: 'CONTRACT_NAO_ISOLADO' };
  if (autorizacao !== k.decisao) return { ok: false, codigo: 'CONTRACT_NAO_AUTORIZADO' };
  return { ok: true, codigo: null };
};

/**
 * D-PROD-162 — ambiente do subprocesso `npm run deploy:migrate` do premerge.
 * `MIGRATION_CONTRACT_AUTORIZADO` (lido por `run-migrations.mjs`) só vai quando a
 * release é CONTRACT e a decisão informada conferiu; nunca é herdado do ambiente.
 */
export const envDoDeployMigrate = ({ env, classificacao, autorizacao }) => {
  const saida = { ...env, MIGRATION_EXIGIR_CONFERENCIA: 'sim' };
  delete saida.MIGRATION_CONTRACT_AUTORIZADO;
  const [k] = classificacao.contract ?? [];
  if (k && classificacao.contract.length === 1 && autorizacao === k.decisao) saida.MIGRATION_CONTRACT_AUTORIZADO = k.decisao;
  return saida;
};

/**
 * D-PROD-162 — migrations CONTRACT presentes nas pastas locais e ainda NÃO
 * concluídas (concluída = `finished_at` e sem `rolled_back_at`) no histórico do
 * alvo. Usado pelo runner oficial para exigir a autorização. Puro.
 * @param {{locais: string[], linhas: Array<{migration_name: string, finished_at: any, rolled_back_at: any}>, contratos?: Record<string, {decisao: string}>}} e
 */
export const contractsPendentes = ({ locais, linhas, contratos = MIGRATIONS_CONTRACT_APROVADAS }) => {
  const concluidas = new Set(linhas.filter((l) => l.finished_at && !l.rolled_back_at).map((l) => l.migration_name));
  return Object.keys(contratos)
    .filter((nome) => locais.includes(nome) && !concluidas.has(nome))
    .map((nome) => ({ nome, decisao: contratos[nome].decisao }));
};

/**
 * Conferência do alvo, pura: histórico remoto × migrations locais × manifesto.
 * @param {{locais: Array<{nome: string, checksum: string}>, linhas: Array<{migration_name: string, checksum: string, finished_at: any, rolled_back_at: any}>, aprovadas?: Record<string,string>}} e
 */
export const conferirHistoricoRemoto = ({ locais, linhas, aprovadas = MIGRATIONS_APROVADAS }) => {
  const falhas = [];
  const porNome = new Map(locais.map((l) => [l.nome, l.checksum]));
  const aplicadas = new Set();
  for (const l of linhas) {
    if (l.rolled_back_at) continue;
    if (!l.finished_at) {
      falhas.push(`migration parcialmente aplicada: ${l.migration_name}`);
      continue;
    }
    if (!porNome.has(l.migration_name)) falhas.push(`migration no banco sem arquivo nesta release: ${l.migration_name}`);
    else if (porNome.get(l.migration_name) !== l.checksum && !(l.checksum === 'manual' && CHECKSUM_MANUAL_HISTORICO.includes(l.migration_name))) {
      falhas.push(`checksum divergente no banco: ${l.migration_name}`);
    }
    aplicadas.add(l.migration_name);
  }
  const pendentes = locais.map((l) => l.nome).filter((n) => !aplicadas.has(n));
  for (const n of pendentes) if (!(n in aprovadas)) falhas.push(`pendente fora do manifesto da release: ${n}`);
  return { ok: falhas.length === 0, codigo: falhas.length ? 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS' : null, pendentes, falhas };
};

/**
 * D-PROD-113: migrations do manifesto que FALTAM de verdade na release.
 * Uma migration aprovada que já está na main foi liberada por uma release
 * anterior (ex.: as da PR #174) e não conta como faltando; só falta a que não
 * está nem nas novas da release nem na main. Sem isto, toda release depois da
 * #174 era recusada com MANIFESTO_INCOMPLETO (e o CI da main ficava vermelho).
 * @param {Record<string, string>} manifesto
 * @param {string[]} nomesNovas
 * @param {(nome: string) => boolean} estaNaMain
 */
export const migrationsDoManifestoFaltando = (manifesto, nomesNovas, estaNaMain) =>
  Object.keys(manifesto).filter((n) => !nomesNovas.includes(n) && !estaNaMain(n));
