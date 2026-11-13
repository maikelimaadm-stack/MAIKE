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
 *     (alargamento de CHECK na D-PROD-162; DROP COLUMN na D-PROD-183, sem DROP TABLE).
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
  '20261113200000_tipo_tarefa_drop_colunas': '9a4eb34a1ec7665b9cb49e8870876dfb3e33eb794d86ce1e21c97214e79fb89b',
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
]);

/** D-PROD-162: migrations CONTRACT aprovadas pelo proprietário (exceção à D-PROD-72/D-PROD-107). Fechado: nova entrada exige decisão. */
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
    guarda_sha256: '0bf8e022725cf95f04001854f7d00cc8200b8e9165e62fe1845fad9917f11e20',
    drop: Object.freeze([]),
    literais_guarda: Object.freeze(['TipoTarefa']),
    alter_antigas: Object.freeze([
      'ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area"',
      'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_produto"',
      'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_maquina"',
      'ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_implemento"',
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

/** Alvo das constraints alargadas, a partir do texto pinado (`ALTER TABLE "T" ADD CONSTRAINT "C" …`). */
const constraintsAlargadas = (alterAntigas) =>
  alterAntigas.map((a) => a.match(new RegExp(`^ALTER TABLE (${ID}) ADD CONSTRAINT (${ID}) `))).filter(Boolean).map((x) => `${q(x[1])}.${q(x[2])}`);

/** D-PROD-183 — colunas removidas, a partir do texto pinado (`ALTER TABLE "T" DROP COLUMN "c"`). */
const colunasRemovidas = (alterAntigas) =>
  alterAntigas.map((a) => a.match(new RegExp(`^ALTER TABLE (${ID}) DROP COLUMN (${ID})$`))).filter(Boolean).map((x) => `${q(x[1])}.${q(x[2])}`);

/**
 * D-PROD-162 — recorte CONTRACT de UMA migration (nome em `contratos`). Confere
 * a guarda pinada, os DROP e os alargamentos na ordem; devolve o RESTO para a
 * allowlist EXPAND, ou `null` se o recorte já falhou (não há como alinhar o resto).
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
  for (let i = 0; i < k.drop.length; i++) {
    const esperado = `DROP TABLE "${k.drop[i]}"`;
    const achado = norm(instrucoes[i] ?? '');
    if (achado !== esperado) {
      v(m.nome, 'CONTRACT_DROP_FORA_DO_CONTRATO', `posição ${i}: esperado ${esperado} encontrado ${achado}`);
      return null;
    }
  }
  for (let j = 0; j < k.alter_antigas.length; j++) {
    const achado = norm(instrucoes[k.drop.length + j] ?? '');
    if (achado !== k.alter_antigas[j]) {
      v(m.nome, 'CONTRACT_ALTER_FORA_DO_CONTRATO', `posição ${j}: esperado ${k.alter_antigas[j].slice(0, 30)}… encontrado ${achado}`);
      return null;
    }
  }
  const resto = instrucoes.slice(k.drop.length + k.alter_antigas.length).join(';');
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
    contract.push({
      migration: m.nome, decisao: k.decisao, tabelas_removidas: [...k.drop],
      constraints_alargadas: constraintsAlargadas(k.alter_antigas), colunas_removidas: colunasRemovidas(k.alter_antigas),
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
