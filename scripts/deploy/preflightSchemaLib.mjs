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
  ['CategoriaManejo', 'catalogo_categoria_visual_id'],
  // MAIKE-LOTES-R1: a listagem de lotes filtra `excluido_em IS NULL`.
  ['Lote', 'excluido_em'],
]);

/**
 * As consultas, todas SELECT. Ficam exportadas para o runbook e para quem
 * preferir rodá-las no editor SQL do painel.
 */
export const CONSULTAS = Object.freeze({
  migrations: `SELECT migration_name, finished_at IS NOT NULL AS concluida, rolled_back_at IS NOT NULL AS revertida
                 FROM "_prisma_migrations"`,
  colunas: `SELECT table_name, column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND (table_name, column_name) IN (('Usuario','papel_tenant'),('CategoriaManejo','catalogo_categoria_visual_id'),('Lote','excluido_em'))`,
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
