/**
 * Preflight de schema do deploy (PR145-R5, D-PROD-72) — SÓ LEITURA.
 *
 * Responde, antes do merge, uma pergunta que o `/health` não responde: o banco
 * deste ambiente já tem o schema que o código novo espera?
 *
 * Por que existe: o projeto Vercel publica a `main` automaticamente, com SPA e
 * API juntas. Backend novo sobre banco sem as migrations responde 500 (Prisma
 * P2022) em Usuários, Permissões e Categoria de Manejo, enquanto `/health`
 * continua `ok` — a falha só apareceria no uso. Este preflight a torna
 * detectável ANTES.
 *
 * Nunca escreve, nunca imprime URL, host, login, nome ou e-mail: só nomes de
 * migration, nomes de tabela/coluna e contagens agregadas.
 */

/** Tabelas sensíveis criadas pelas migrations do catálogo e do MAIKE Admin. */
export const TABELAS_PROTEGIDAS = Object.freeze([
  'CatalogoMeta',
  'CatalogoTipoEntidade',
  'CatalogoCategoriaVisual',
  'CatalogoAsset',
  'CatalogoIcone',
  'CatalogoRegraMisto',
  'CatalogoRegraMistoCategoria',
  'OperadorProdutoMaike',
  'AuditoriaCatalogoGlobal',
  'AdminPrincipalMaike',
  'SessaoAdminMaike',
  'CodigoRecuperacaoAdminMaike',
  'EventoSegurancaAdminMaike',
]);

/** Colunas sem as quais o backend desta PR responde 500. */
export const COLUNAS_EXIGIDAS = Object.freeze([
  ['Usuario', 'papel_tenant'],
  // D-PROD-187: CategoriaManejo é a tabela física CADCATEGORIA (@@map) e o vínculo com o ícone saiu do banco.
  // O runtime desta PR lê CADCATEGORIA; sem ela (ou com o nome antigo) a Categoria de Manejo responde 500.
  ['CADCATEGORIA', 'idade_minima_meses'],
  // D-PROD-195: a Categoria de Manejo lê e grava a curva de ganho obrigatória; sem a coluna, a categoria responde 500.
  ['CADCATEGORIA', 'curva_ganho_id'],
  // D-PROD-198: a categoria lê e grava o peso objetivo; a lista de posições projeta o peso com ele.
  ['CADCATEGORIA', 'peso_objetivo_kg'],
  // MAIKE-LOTES-R1: a listagem de lotes filtra `excluido_em IS NULL`.
  ['Lote', 'excluido_em'],
  ['Lote', 'excluido_por_usuario_id'],
  // MAIKE-SAAS-ADMIN-S04-P1: login e guarda leem as épocas de sessão.
  ['Cliente', 'sessao_epoca'],
  ['Usuario', 'sessao_epoca'],
  // MAIKE-SAAS-ADMIN-S04-P2: login e guarda leem a troca obrigatória de senha.
  ['Usuario', 'troca_senha_pendente'],
  // D-PROD-162 (Patrimônio SIMPLIFICA-01): o abastecimento em L/KG e os Produtos aceitos por tanque.
  ['AbastecimentoBem', 'quantidade'],
  ['AbastecimentoBem', 'unidade'],
  ['TanqueBemProduto', 'produto_id'],
  // D-PROD-200: o Lançamento de Atividades lê e grava a atividade (cabeçalho) e o apontamento do dia; sem as 2 tabelas
  // (a migration CONTRACT da Atividade cabeçalho ainda não aplicada), a tela nova responde 500.
  ['Atividade', 'unidade_producao_sigla'],
  ['AtividadeApontamento', 'sequencia'],
  // D-PROD-202 (Fatia 3): as linhas de produto e de máquina do apontamento, o custo de uso do bem e o teto do salto do
  // medidor; sem a migration EXPAND das linhas, o apontamento novo responde 500.
  ['AtividadeApontamentoProduto', 'movimentacao_estoque_id'],
  ['AtividadeApontamentoProdutoConsumoLote', 'estoque_lote_nota_id'],
  ['AtividadeApontamentoMaquina', 'quantidade_uso'],
  ['BemPatrimonial', 'custo_uso_unitario'],
  ['TipoPatrimonial', 'salto_maximo_medidor'],
  // D-PROD-203: o cadastro de Formulações e o lançamento de suplementação (formulação obrigatória) leem as 3 tabelas
  // novas; sem a migration `20261114700000_cadformulacao`, a tela e as opções do lançamento respondem 500.
  ['CADFORMULACAO', 'percentual_pv_padrao'],
  ['CADFORMULACAOINGREDIENTE', 'quantidade_kg'],
  ['CADFORMULACAOREGRA', 'consome'],
  // D-PROD-205: a leitura de cocho e o farol do mapa leem a tabela nova; sem a migration
  // `20261115100000_leitura_cocho`, `/leituras-cocho` responde 500.
  ['LEITURACOCHO', 'escore'],
  // D-PROD-206: a Formulação lê e grava a faixa do farol de consumo; sem a migration
  // `20261115200000_formulacao_faixa_tolerancia`, `/formulacoes` responde 500.
  ['CADFORMULACAO', 'faixa_tolerancia_percentual'],
]);

/**
 * D-PROD-162: a lista da consulta de colunas é MONTADA de COLUNAS_EXIGIDAS
 * (antes era escrita à mão e podia divergir). Identificadores fixos deste
 * arquivo, sem entrada externa.
 */
const PARES_EXIGIDOS = COLUNAS_EXIGIDAS.map(([t, c]) => `('${t}','${c}')`).join(',');

/**
 * As consultas, todas SELECT. Ficam exportadas para o runbook e para quem
 * preferir rodá-las no editor SQL do painel.
 */
export const CONSULTAS = Object.freeze({
  migrations: `SELECT migration_name, finished_at IS NOT NULL AS concluida, rolled_back_at IS NOT NULL AS revertida
                 FROM "_prisma_migrations"`,
  colunas: `SELECT table_name, column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND (table_name, column_name) IN (${PARES_EXIGIDOS})`,
  tabelas: `SELECT c.relname AS tabela, c.relrowsecurity AS rls
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])`,
  grants: `SELECT table_name AS tabela, grantee FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND grantee IN ('anon','authenticated')`,
  papeis: `SELECT count(DISTINCT u.cliente_id) FILTER (WHERE u.ativo)::int AS clientes_com_usuario_ativo,
                  count(*) FILTER (WHERE u.ativo AND u.papel_tenant = 'administrador')::int AS administradores_ativos,
                  (SELECT count(*)::int FROM (SELECT cliente_id FROM "Usuario" WHERE ativo GROUP BY cliente_id
                     HAVING count(*) FILTER (WHERE papel_tenant = 'administrador') = 0) s) AS clientes_sem_administrador
             FROM "Usuario" u`,
});

/**
 * Veredito puro (testável sem banco).
 *
 * @param {{
 *   pastas: string[],
 *   migrations: Array<{migration_name: string, concluida: boolean, revertida: boolean}>,
 *   colunas: Array<{table_name: string, column_name: string}>,
 *   tabelas: Array<{tabela: string, rls: boolean}>,
 *   grants: Array<{tabela: string, grantee: string}>,
 *   papeis: null | {clientes_com_usuario_ativo: number, administradores_ativos: number, clientes_sem_administrador: number},
 *   exigirAdminPorCliente?: boolean,
 * }} estado
 */
export const avaliarPreflight = ({ pastas, migrations, colunas, tabelas, grants, papeis, exigirAdminPorCliente = false }) => {
  const concluidas = new Set(migrations.filter((m) => m.concluida && !m.revertida).map((m) => m.migration_name));
  const falhas = [];
  const pendentes = pastas.filter((p) => !concluidas.has(p));
  const comFalha = migrations.filter((m) => !m.concluida && !m.revertida).map((m) => m.migration_name);
  const desconhecidas = [...concluidas].filter((m) => !pastas.includes(m));
  if (pendentes.length) falhas.push(`migrations pendentes (${pendentes.length}): ${pendentes.join(', ')}`);
  if (comFalha.length) falhas.push(`migrations com falha registrada: ${comFalha.join(', ')} — resolver antes de qualquer deploy`);

  const temColuna = new Set(colunas.map((c) => `${c.table_name}.${c.column_name}`));
  const colunasAusentes = COLUNAS_EXIGIDAS.map(([t, c]) => `${t}.${c}`).filter((k) => !temColuna.has(k));
  if (colunasAusentes.length) falhas.push(`colunas ausentes: ${colunasAusentes.join(', ')} (backend desta PR responde 500)`);

  const existentes = new Map(tabelas.map((t) => [t.tabela, t.rls]));
  const tabelasAusentes = TABELAS_PROTEGIDAS.filter((t) => !existentes.has(t));
  if (tabelasAusentes.length) falhas.push(`tabelas ausentes: ${tabelasAusentes.join(', ')}`);
  const semRls = TABELAS_PROTEGIDAS.filter((t) => existentes.get(t) === false);
  if (semRls.length) falhas.push(`tabelas sem RLS: ${semRls.join(', ')}`);
  if (grants.length) falhas.push(`grants para anon/authenticated: ${grants.map((g) => `${g.tabela}→${g.grantee}`).join(', ')}`);

  const avisos = [];
  if (desconhecidas.length) avisos.push(`migrations no banco que não estão nesta branch: ${desconhecidas.join(', ')}`);
  if (papeis && papeis.clientes_sem_administrador > 0) {
    const msg = `${papeis.clientes_sem_administrador} cliente(s) com usuário ativo e sem administrador da fazenda: ninguém cria contas lá até papel-tenant.mjs`;
    (exigirAdminPorCliente ? falhas : avisos).push(msg);
  }

  return {
    ok: falhas.length === 0,
    resumo: {
      migrations_no_repositorio: pastas.length,
      migrations_aplicadas: pastas.length - pendentes.length,
      pendentes,
      papeis,
    },
    falhas,
    avisos,
  };
};
