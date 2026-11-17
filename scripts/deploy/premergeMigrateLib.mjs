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
 *     DEFAULT false, 3 FKs para tabelas antigas e 2 CHECKs; na D-PROD-209, sem DROP
 *     nenhum, só o DROP CONSTRAINT e o ADD CONSTRAINT do mesmo CHECK de Fornecedor,
 *     com TERCEIRIZADO no lugar de TAREFEIRO; na D-PROD-210, sem DROP TABLE, as 7
 *     instruções nas 3 tabelas VAZIAS das Formulações (a coluna base_consumo NOT NULL
 *     DEFAULT, o %PV padrão anulável, a coluna g_cab_dia e os CHECKs trocados); na
 *     D-PROD-211, sem DROP TABLE, as 18
 *     instruções em AbastecimentoBem — 7 ADD COLUMN, 2 delas NOT NULL DEFAULT, 2 DROP
 *     NOT NULL, o UPDATE do centro de custo vindo do bem, o CHECK de status recriado,
 *     3 CHECKs novos e 3 FKs compostas para tabelas antigas; na D-PROD-217, sem DROP
 *     TABLE e sem resto, as 3 instruções do reforço — o UNIQUE (cliente_id, empresa_id,
 *     atividade_id, id) em AtividadeApontamento e a FK do apontamento de AbastecimentoBem
 *     recriada com o mesmo nome, agora com a atividade).
 *     Formato CONVERSÃO (D-PROD-200; a entrada tem `conversao` não vazia): os dados
 *     das tabelas que saem vão para as que entram ANTES do DROP. A ordem passa a ser
 *     guarda → `alter_antigas` (na D-PROD-200, nenhuma) → RESTO pela allowlist EXPAND
 *     (as tabelas novas, criadas no próprio resto) → EXATAMENTE as instruções
 *     `conversao` pinadas, na ordem (na D-PROD-200, o INSERT … SELECT de
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
 *     Cauda SEM conversão (D-PROD-208; a entrada tem `drop_no_fim: true` e nenhuma
 *     `conversao`): guarda → `alter_antigas` → RESTO pela allowlist EXPAND → os DROP
 *     TABLE de `drop` como as ÚLTIMAS instruções. Serve à tabela que sai mas ainda é
 *     referenciada por uma FK que só cai nos `alter_antigas` (na D-PROD-208, a FK da
 *     linha de mão de obra para "Funcionario"). Mesma casagem de trás para frente.
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
  // D-PROD-198: EXPAND — peso objetivo (kg) opcional na Categoria de Manejo (uma coluna anulável em CADCATEGORIA).
  '20261114400000_cadcategoria_peso_objetivo': 'd44f80701c8936b62a8213f68fecb912a846c2a646f6cae79133964b653fb1a9',
  // D-PROD-200: CONTRACT aprovado pelo proprietário — a atividade vira cabeçalho: Atividade e AtividadeApontamento
  // novas, cada ApontamentoAtividade convertido nas duas (conversão pinada) e as 3 tabelas antigas apagadas no fim.
  '20261114500000_atividade_cabecalho': 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb',
  // D-PROD-202 (Fatia 3): EXPAND — linhas de produto e de máquina do apontamento: AtividadeApontamentoProduto,
  // AtividadeApontamentoProdutoConsumoLote e AtividadeApontamentoMaquina novas, e duas colunas anuláveis sem DEFAULT
  // (BemPatrimonial.custo_uso_unitario e TipoPatrimonial.salto_maximo_medidor). Nenhum dado migrado.
  '20261114600000_atividade_linhas_produto_maquina': 'e374c81d448711894a19825e319ed0d760128c9b77a02953647e4cf7a09a5489',
  // D-PROD-203: EXPAND — Formulações de suplemento (CADFORMULACAO, CADFORMULACAOINGREDIENTE e CADFORMULACAOREGRA), só tabelas novas.
  '20261114700000_cadformulacao': '96f3f3641815960335ddd5321896258a4114a42f62f46448ae53a35907784524',
  // D-PROD-205: EXPAND — Leitura de cocho (LEITURACOCHO), só tabela nova.
  '20261115100000_leitura_cocho': 'f31cb0b8dace187b3b7bc76d6b989c0b6f2f0cd96c623834efcd23c0a9bcd1a1',
  // D-PROD-206: EXPAND — faixa de tolerância do farol de consumo na Formulação (uma coluna anulável em CADFORMULACAO).
  '20261115200000_formulacao_faixa_tolerancia': 'bb8be379c241341e1ba45a7d7da8258aef77d5f4e089db302c8d655608d58e4c',
  // D-PROD-207 (Fatia 4): EXPAND — mão de obra e serviço de terceiro do apontamento: Funcionario, Servico,
  // AtividadeApontamentoMaoObra e AtividadeApontamentoServico novas. Nenhuma coluna em tabela antiga; nenhum dado migrado.
  '20261115900000_atividade_mao_obra_servico': '79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725',
  // D-PROD-208 (ajuste da Fatia 4): CONTRACT aprovado pelo proprietário — o funcionário vira papel do parceiro (4 colunas
  // anuláveis em Fornecedor), a linha de mão de obra aponta para o parceiro (parceiro_id e origem NOT NULL, tabela vazia)
  // e a tabela Funcionario, VAZIA, sai no fim. A guarda aborta se Funcionario ou AtividadeApontamentoMaoObra tiverem linha.
  '20261116000000_mao_obra_parceiro': '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0',
  // D-PROD-209: CONTRACT aprovado pelo proprietário — o tipo do funcionário passa a ser Mensalista, Diarista ou
  // Terceirizado: o CHECK "Fornecedor_funcionario_check" volta igual, com TERCEIRIZADO no lugar de TAREFEIRO. A guarda
  // aborta se algum parceiro tiver funcionario_tipo = TAREFEIRO. Nenhuma coluna, índice, tabela ou dado muda.
  '20261116100000_funcionario_tipo_terceirizado': '44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6',
  // D-PROD-210: CONTRACT aprovado pelo proprietário — base do consumo na Formulação (% do peso vivo ou g/cab/dia):
  // coluna NOT NULL DEFAULT 'PV', %PV padrão anulável, CHECK por base e regra em gramas; as 3 tabelas VAZIAS.
  '20261116200000_formulacao_base_consumo': 'a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171',
  // D-PROD-211: CONTRACT aprovado pelo proprietário (Fatia 5) — o abastecimento ligado à atividade: AbastecimentoBem ganha
  // origem (ESTOQUE | EXTERNO), o vínculo com o apontamento e a atividade, o snapshot do centro de custo (o das linhas
  // existentes vem do bem), da leitura anterior, do delta e do intervalo confiável; local e movimento passam a anuláveis;
  // o CHECK de status é recriado e entram 3 CHECKs, 3 FKs e 3 índices. Nenhuma tabela criada ou apagada.
  '20261116300000_abastecimento_atividade': '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436',
  // D-PROD-215: EXPAND — Cadastro de Culturas (CADCULTURAS), só tabela nova.
  '20261116500000_cadculturas': '37a71c46f138f457022fbab8316d645eb4f39a6e2a3ddfe4c8a3394e19665715',
  // D-PROD-216: CONTRACT aditiva — a Área ligada à Cultura (coluna anulável, UNIQUE em CADCULTURAS e FK composta).
  '20261117000000_area_cultura': 'e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26',
  // D-PROD-217: CONTRACT aprovado pelo proprietário ("pode fazer o reforço no banco") — o apontamento do abastecimento
  // tem de ser DA atividade gravada nele: UNIQUE (cliente_id, empresa_id, atividade_id, id) em AtividadeApontamento e a
  // FK "AbastecimentoBem_apontamento_fkey" recriada com 4 colunas. A guarda aborta se algum abastecimento apontar para
  // um apontamento de outra atividade. Nenhuma coluna, tabela ou dado muda.
  '20261117100000_abastecimento_fk_apontamento_atividade': '1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e',
  // D-PROD-219: EXPAND — Medição de Forragem (MEDICAOFORRAGEM), só tabela nova.
  '20261117200000_medicao_forragem': '66f5fb51b3d2c92419bd8d2320f33b7c632b03edf29a0b598686622e92e7b62f',
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
  // D-PROD-200: RLS/REVOKE de Atividade e AtividadeApontamento (mesmo corpo, lista nova).
  '8f0b1b5ccc478778e1f9aeb94945e9bfde631f4accb12a55abb09e944cc5b98c',
  // D-PROD-202 (Fatia 3): RLS/REVOKE das 3 tabelas das linhas de produto e de máquina (mesmo corpo, lista nova).
  '3991bb1cbddf3772bf580b1bf35de71580b77725d20e77c0d6df7d8a1f2e95d8',
  // D-PROD-203: RLS/REVOKE das 3 tabelas de Formulações (mesmo corpo, lista nova).
  'b04af24e7e13859c210fa6d93193be060fac3ea2f2fa90cc99f41d0ed028bfd6',
  // D-PROD-205: RLS/REVOKE da LEITURACOCHO (mesmo corpo, lista nova).
  '60149f94e07596da2c93471f82110e6f37b5f014bcf721c1dc366a2d4b4bcce8',
  // D-PROD-207 (Fatia 4): RLS/REVOKE das 4 tabelas de mão de obra e serviço (mesmo corpo, lista nova).
  '16d2680d97d675bf0bd429eaee3ebe4caf5813473c43b9564698aa15c28f8403',
  // D-PROD-215: RLS/REVOKE da CADCULTURAS (mesmo corpo, lista nova).
  'cd8830aa244ba849ca957e7d480606bcd38e093e95e028b3e31973611784ea7b',
  // D-PROD-219: RLS/REVOKE da MEDICAOFORRAGEM (mesmo corpo, lista nova).
  'b2d54fa5991b7a8200801a2cb5613fed353c1f1756d740268c27d3feadf92718',
]);

/**
 * D-PROD-162: migrations CONTRACT aprovadas pelo proprietário (exceção à D-PROD-72/D-PROD-107). Fechado: nova entrada
 * exige decisão. São treze, na ordem: D-PROD-162, D-PROD-183, D-PROD-187, D-PROD-194, D-PROD-195, D-PROD-197,
 * D-PROD-200 (a primeira no formato CONVERSÃO: campo `conversao`, opcional; sem ele, o formato de sempre), D-PROD-208
 * (a primeira com `drop_no_fim` sem conversão: a cauda são só os DROP, depois dos `alter_antigas` e do resto),
 * D-PROD-209 (formato de sempre: só a troca de um CHECK em tabela antiga, sem DROP TABLE e sem resto), D-PROD-210
 * (formato de sempre: a base do consumo nas 3 tabelas VAZIAS das Formulações, sem DROP TABLE e sem resto), D-PROD-211
 * (formato de sempre: colunas, NOT NULL, backfill, CHECKs e FKs pinados em tabela antiga; no resto, só índices),
 * D-PROD-216 (formato de sempre: a coluna, o UNIQUE e a FK aditivos da Área ligada à Cultura; no resto, só o índice) e
 * D-PROD-217 (formato de sempre: o UNIQUE e a FK recriada do reforço, pinados em tabelas antigas, sem DROP TABLE e sem
 * resto).
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
  // D-PROD-200: a atividade vira CABEÇALHO e o apontamento de hoje vira FILHO dela. Formato CONVERSÃO: a guarda (hash
  // pinado) confere as 3 tabelas antigas e as trava em ACCESS EXCLUSIVE antes de conferir os itens de custo e as fatias
  // FIFO vazios, os campos sem lugar no modelo novo vazios, os status e o contador; nenhuma instrução em tabela antiga
  // logo depois dela; no resto, Atividade e AtividadeApontamento pela allowlist EXPAND (CREATE TABLE, índices, CHECKs,
  // FKs e o RLS de corpo novo); depois EXATAMENTE as 3 instruções `conversao` (texto pinado: cada linha antiga vira
  // uma Atividade, com id 'atv_' || id antigo e o mesmo número, e um AtividadeApontamento filho com o mesmo id; o
  // contador passa para a entidade Atividade) e, por ÚLTIMO, EXATAMENTE os 3 DROP TABLE, filhas primeiro. A guarda só
  // cita as 3 removidas, as 2 criadas no resto e os literais abaixo. As 3 instruções aparecem em `contract[].conversoes`.
  '20261114500000_atividade_cabecalho': Object.freeze({
    decisao: 'D-PROD-200',
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
  // D-PROD-208: o funcionário deixa de ser cadastro próprio e vira PAPEL do parceiro; a linha de mão de obra aponta para o
  // parceiro (funcionário ou terceiro). CONTRACT condicionado a tabelas VAZIAS: a guarda (hash pinado) confere o estado
  // da Fatia 4 e trava Funcionario e AtividadeApontamentoMaoObra em ACCESS EXCLUSIVE antes de conferir que as duas estão
  // vazias. Depois dela, EXATAMENTE as 12 instruções abaixo, nesta ordem (texto pinado): sai o vínculo com o funcionário
  // (FK, índice e coluna), entram parceiro_id e origem NOT NULL sem DEFAULT (só porque a tabela está vazia), as 4 colunas
  // anuláveis do papel em Fornecedor, os 2 CHECKs e a FK composta pelo tenant, RESTRICT, para Fornecedor (tabela antiga).
  // No resto, só o índice não-único da FK nova (allowlist EXPAND). `drop_no_fim`: o DROP TABLE "Funcionario" é a ÚLTIMA
  // instrução (no início ele falharia: a FK da linha de mão de obra ainda o referencia). Nenhuma conversão: não há dado.
  // A guarda só cita a removida, as duas tabelas antigas tocadas e nenhum outro literal.
  '20261116000000_mao_obra_parceiro': Object.freeze({
    decisao: 'D-PROD-208',
    guarda_sha256: '9ec960b559bb4173342ed76302c828b04b207f07381f5f39b74aea606751d387',
    drop: Object.freeze(['Funcionario']),
    drop_no_fim: true,
    literais_guarda: Object.freeze(['AtividadeApontamentoMaoObra', 'Fornecedor']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "AtividadeApontamentoMaoObra" DROP CONSTRAINT "AtividadeApontamentoMaoObra_funcionario_fkey"',
      'DROP INDEX "AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx"',
      'ALTER TABLE "AtividadeApontamentoMaoObra" DROP COLUMN "funcionario_id"',
      'ALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "parceiro_id" VARCHAR(64) NOT NULL',
      'ALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "origem" VARCHAR(12) NOT NULL',
      'ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_tipo" VARCHAR(16)',
      'ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_cargo" VARCHAR(120)',
      'ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_custo_hora" DECIMAL(14,4)',
      'ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_custo_diaria" DECIMAL(14,4)',
      'ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_funcionario_check" CHECK (("funcionario_tipo" IS NULL OR "funcionario_tipo" IN (\'MENSALISTA\', \'DIARISTA\', \'TAREFEIRO\')) AND ("funcionario_custo_hora" IS NULL OR "funcionario_custo_hora" >= 0) AND ("funcionario_custo_diaria" IS NULL OR "funcionario_custo_diaria" >= 0))',
      'ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_origem_check" CHECK ("origem" IN (\'FUNCIONARIO\', \'TERCEIRO\'))',
      'ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_parceiro_fkey" FOREIGN KEY ("cliente_id", "parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
    ]),
  }),
  // D-PROD-209: o tipo do funcionário passa a ser Mensalista, Diarista ou Terceirizado. Sem DROP TABLE e sem tabela nova:
  // depois da guarda (hash pinado; confere que "Fornecedor" existe e que o CHECK ainda tem TAREFEIRO e trava "Fornecedor"
  // em ACCESS EXCLUSIVE antes de conferir que nenhum parceiro tem funcionario_tipo = TAREFEIRO), EXATAMENTE as 2
  // instruções abaixo, nesta ordem (texto pinado): sai o CHECK e volta igual, com TERCEIRIZADO no lugar de TAREFEIRO
  // (o descritor o declara em `constraints_alargadas`: mesmo nome, recriado). Resto vazio. A guarda só cita "Fornecedor"
  // e o valor que sai, 'TAREFEIRO'.
  '20261116100000_funcionario_tipo_terceirizado': Object.freeze({
    decisao: 'D-PROD-209',
    guarda_sha256: '93612d85d6cc9ec3c39b9586619deedb8db72e5198d1ab64fa3ee9d8e911cca9',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['Fornecedor', 'TAREFEIRO']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "Fornecedor" DROP CONSTRAINT "Fornecedor_funcionario_check"',
      'ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_funcionario_check" CHECK (("funcionario_tipo" IS NULL OR "funcionario_tipo" IN (\'MENSALISTA\', \'DIARISTA\', \'TERCEIRIZADO\')) AND ("funcionario_custo_hora" IS NULL OR "funcionario_custo_hora" >= 0) AND ("funcionario_custo_diaria" IS NULL OR "funcionario_custo_diaria" >= 0))',
    ]),
  }),
  // D-PROD-210: a Formulação ganha a BASE DO CONSUMO — % do peso vivo (PV) ou gramas por cabeça por dia (G_CAB_DIA), uma
  // por formulação, sem mistura. É CONTRACT porque a allowlist EXPAND recusa, em tabela antiga, coluna NOT NULL DEFAULT,
  // ALTER COLUMN, DROP CONSTRAINT e CHECK. A guarda (hash pinado) trava as 3 tabelas de Formulações e exige as 3 VAZIAS
  // (o proprietário autorizou: "os dados eram só teste"; em produção estavam com 0 linhas) — nenhum dado é migrado.
  // Depois dela, EXATAMENTE as 7 instruções abaixo, nesta ordem (texto pinado): a coluna base_consumo, o %PV padrão
  // anulável, o CHECK do %PV padrão trocado pelo CHECK por base, a coluna g_cab_dia da regra e o CHECK da forma da
  // regra recriado (consome com %PV OU com gramas, nunca os dois). Não há resto. A guarda só cita as 3 tabelas.
  '20261116200000_formulacao_base_consumo': Object.freeze({
    decisao: 'D-PROD-210',
    guarda_sha256: 'a66ff13e8427efbe7d434d286459a0354e8331b10a1c5afd9953b83464184819',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "CADFORMULACAO" ADD COLUMN "base_consumo" VARCHAR(16) NOT NULL DEFAULT \'PV\'',
      'ALTER TABLE "CADFORMULACAO" ALTER COLUMN "percentual_pv_padrao" DROP NOT NULL',
      'ALTER TABLE "CADFORMULACAO" DROP CONSTRAINT "CADFORMULACAO_percentual_pv_padrao_check"',
      'ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "CADFORMULACAO_base_consumo_check" CHECK (("base_consumo" = \'PV\' AND "percentual_pv_padrao" IS NOT NULL AND "percentual_pv_padrao" > 0 AND "percentual_pv_padrao" <= 5) OR ("base_consumo" = \'G_CAB_DIA\' AND "percentual_pv_padrao" IS NULL AND "consumo_objetivo_g_cab_dia" IS NOT NULL AND "consumo_objetivo_g_cab_dia" > 0))',
      'ALTER TABLE "CADFORMULACAOREGRA" ADD COLUMN "g_cab_dia" DECIMAL(10,2)',
      'ALTER TABLE "CADFORMULACAOREGRA" DROP CONSTRAINT "CADFORMULACAOREGRA_forma_check"',
      'ALTER TABLE "CADFORMULACAOREGRA" ADD CONSTRAINT "CADFORMULACAOREGRA_forma_check" CHECK (("consome" = false AND "percentual_pv" IS NULL AND "g_cab_dia" IS NULL) OR ("consome" = true AND "percentual_pv" IS NOT NULL AND "percentual_pv" > 0 AND "percentual_pv" <= 5 AND "g_cab_dia" IS NULL) OR ("consome" = true AND "percentual_pv" IS NULL AND "g_cab_dia" IS NOT NULL AND "g_cab_dia" > 0))',
    ]),
  }),
  // D-PROD-211 (Fatia 5): o abastecimento ligado à atividade. Sem DROP TABLE e sem tabela nova: depois da guarda (hash
  // pinado; confere que as 5 tabelas existem, que nenhuma coluna nova existe, que local e movimento ainda são NOT NULL,
  // que o CHECK de status ainda é o antigo e que os 3 CHECKs novos não existem, e trava "AbastecimentoBem" em ACCESS
  // EXCLUSIVE), EXATAMENTE as 18 instruções abaixo, nesta ordem (texto pinado): 7 ADD COLUMN (origem NOT NULL DEFAULT
  // 'ESTOQUE' e intervalo_confiavel NOT NULL DEFAULT false; as outras 5 anuláveis, sem DEFAULT), os 2 DROP NOT NULL, o
  // UPDATE que traz o centro de custo do bem para as linhas existentes, o CHECK de status recriado (o estorno exigido só
  // na origem ESTOQUE; o descritor o declara em `constraints_alargadas`), os 3 CHECKs novos (origem, apontamento ⇒
  // atividade, leitura anterior/delta/intervalo) e as 3 FKs compostas pelo tenant e pela empresa, RESTRICT. O resto são
  // os 3 CREATE INDEX não-únicos pela allowlist EXPAND, que continua recusando UNIQUE, ALTER COLUMN, DML e qualquer outra
  // coisa em AbastecimentoBem. A guarda só cita as 5 tabelas.
  '20261116300000_abastecimento_atividade': Object.freeze({
    decisao: 'D-PROD-211',
    guarda_sha256: '3f5a3a37959e571e3d2ee68cd2ec87e15138aa1b59903db0f13dbe4c90b502fa',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['AbastecimentoBem', 'Atividade', 'AtividadeApontamento', 'CentroCusto', 'BemPatrimonial']),
    alter_antigas: Object.freeze([
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
    ]),
  }),
  // D-PROD-216: a Área do mapa ligada à Cultura da mesma fazenda. A mudança é ADITIVA: nenhuma linha muda de valor,
  // nenhuma coluna existente é tocada, nenhuma tabela é criada ou apagada, nenhum DROP. Só é CONTRACT porque a allowlist
  // EXPAND recusa UNIQUE em tabela antiga e FK de tabela antiga para tabela ANTIGA (como na D-PROD-195 e na D-PROD-197).
  // Depois da guarda (hash pinado; confere que as 2 tabelas existem, que a coluna, o UNIQUE e a FK novos não existem, e
  // trava "AreaPastagem" em ACCESS EXCLUSIVE), EXATAMENTE as 3 instruções abaixo, nesta ordem (texto pinado): a coluna
  // anulável sem DEFAULT, o UNIQUE (cliente_id, empresa_id, id) que a FK composta exige em CADCULTURAS e a FK composta
  // pelo tenant e pela empresa, RESTRICT. O resto é o CREATE INDEX não-único pela allowlist EXPAND, que continua
  // recusando DML, ALTER COLUMN e qualquer outra coisa. A guarda só cita AreaPastagem e CADCULTURAS. O vínculo das áreas
  // existentes (DML) NÃO está aqui: é um passo de dados separado, com aprovação própria (runbook da D-PROD-216).
  '20261117000000_area_cultura': Object.freeze({
    decisao: 'D-PROD-216',
    guarda_sha256: 'e60b6bdc95568ba28c0406649d95cd76da6a2394dc3bdfdb1daf06a6469f3da6',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['AreaPastagem', 'CADCULTURAS']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "AreaPastagem" ADD COLUMN "cultura_id" VARCHAR(64)',
      'CREATE UNIQUE INDEX "CADCULTURAS_cliente_id_empresa_id_id_key" ON "CADCULTURAS"("cliente_id", "empresa_id", "id")',
      'ALTER TABLE "AreaPastagem" ADD CONSTRAINT "AreaPastagem_cliente_id_empresa_id_cultura_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "cultura_id") REFERENCES "CADCULTURAS"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
    ]),
  }),
  // D-PROD-217 (reforço da D-PROD-211): o apontamento do abastecimento tem de ser da atividade gravada nele. Sem DROP
  // TABLE, sem tabela nova e sem resto: depois da guarda (hash pinado; confere que as 2 tabelas existem, que a FK
  // "AbastecimentoBem_apontamento_fkey" ainda é a de 3 colunas para "AtividadeApontamento", que o CHECK
  // "AbastecimentoBem_atividade_check" existe e que o UNIQUE novo não; trava "AtividadeApontamento" e depois
  // "AbastecimentoBem" em ACCESS EXCLUSIVE e aborta se algum abastecimento apontar para um apontamento de
  // outra atividade), EXATAMENTE as 3 instruções abaixo, nesta ordem (texto pinado): o UNIQUE (cliente_id, empresa_id,
  // atividade_id, id) em "AtividadeApontamento" (o alvo que a FK composta exige; a allowlist EXPAND recusa UNIQUE em
  // tabela antiga), o DROP da FK de 3 colunas e o ADD da FK de 4 colunas com o MESMO nome (o descritor a declara em
  // `constraints_alargadas`: recriada), RESTRICT. A guarda só cita as 2 tabelas.
  '20261117100000_abastecimento_fk_apontamento_atividade': Object.freeze({
    decisao: 'D-PROD-217',
    guarda_sha256: '8982f86da78ebc1e09700c71ca5f2da2f34c9a8d5a6d45f948b9d88e779eef7c',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['AbastecimentoBem', 'AtividadeApontamento']),
    alter_antigas: Object.freeze([
      'CREATE UNIQUE INDEX "AtividadeApontamento_empresa_atividade_id_key" ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id")',
      'ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_apontamento_fkey"',
      'ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE',
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
 * D-PROD-200 — o que cada instrução pinada da conversão escreve, a partir do texto pinado (`INSERT INTO "T" …` →
 * "INSERT INTO T", `UPDATE "T" …` → "UPDATE T"). Instrução de outra forma sai com o começo do próprio texto.
 */
const conversoesDe = (conversao) =>
  conversao.map((c) => {
    const x = c.match(new RegExp(`^(INSERT INTO|UPDATE|DELETE FROM) (${ID})`));
    return x ? `${x[1]} ${q(x[2])}` : c.slice(0, 40);
  });

/**
 * D-PROD-200 — formato CONVERSÃO: casa a CAUDA do arquivo, de trás para frente, sobre as peças não vazias de
 * `instrucoes` a partir de `inicio`: por último EXATAMENTE os `DROP TABLE` de `drop`, na ordem, e logo antes deles
 * EXATAMENTE as instruções `conversao`, na ordem. De trás para frente porque o resto (antes da cauda) tem blocos DO,
 * que contêm ';'; a cauda não tem DO. Devolve o índice da primeira peça da cauda (o resto acaba nele), ou `null` se a
 * cauda não casou (a violação já foi registrada).
 */
const casarCaudaConversao = (instrucoes, inicio, k, nome, v) => {
  const drops = k.drop.map((t) => `DROP TABLE "${t}"`);
  const conversao = k.conversao ?? [];
  const esperadas = [...conversao, ...drops];
  let i = instrucoes.length;
  for (let n = esperadas.length - 1; n >= 0; n--) {
    do i--; while (i >= inicio && !norm(instrucoes[i]));
    const achado = i >= inicio ? norm(instrucoes[i]) : '';
    if (achado === esperadas[n]) continue;
    if (n >= conversao.length) {
      v(nome, 'CONTRACT_DROP_FORA_DO_CONTRATO', `posição ${n - conversao.length}: esperado ${esperadas[n]} encontrado ${achado}`);
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
 * D-PROD-200: com `conversao` não vazia, os DROP saem do início e vão para o FIM, depois da conversão pinada
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
  // D-PROD-208: `drop_no_fim` leva os DROP para a cauda mesmo sem conversão (a tabela que sai ainda é referenciada por uma
  // FK que só cai nos `alter_antigas`).
  const conversao = k.conversao?.length > 0 || k.drop_no_fim === true;
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
