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
 *  3. Conferência do alvo (somente leitura): `_prisma_migrations` × arquivos
 *     locais — extra, checksum divergente, parcial ou pendência fora do
 *     manifesto → PREMERGE_MIGRATIONS_NAO_COMPROVADAS.
 */
import { createHash } from 'node:crypto';

export const MIGRATIONS_APROVADAS = Object.freeze({
  '20261102200000_rebanho_ledger_posicoes': 'df9d713887e68fad75231b23ef4e9d6f0e4750cd67be19036d6a4bfc57c47919',
  '20261103100000_rebanho_ledger_r1_manejos': 'fcab7bd9737408c4f2783161b1a95515b590e91924e4c91c3b1a9f68dc72feb1',
});
/** Blocos DO auditados (RLS das tabelas novas): sha256 do corpo sem comentários e com espaços normalizados. */
export const DO_RLS_APROVADOS = Object.freeze([
  'b38a85816a49d2b3335e6a1bfa1098ed86ac38cc6d7e0b0bd1db979e97f770fd',
  'e6e0a232e9b893ae8bf24387e3455f89256930eef2aed29d7ac96130f4c62ae9',
]);

export const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');
const semComentarios = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const q = (s) => s.replace(/"/g, '');
const ID = '"[A-Za-z_][A-Za-z0-9_]*"';

/**
 * @param {Array<{nome: string, sql: string}>} migrations
 * @param {{manifesto?: Record<string,string>, doAprovados?: readonly string[]}} [opcoes]
 */
export const classificarMigrations = (migrations, { manifesto = MIGRATIONS_APROVADAS, doAprovados = DO_RLS_APROVADOS } = {}) => {
  const violacoes = [];
  const v = (migration, codigo, detalhe) => violacoes.push({ migration, codigo, detalhe: String(detalhe).slice(0, 80) });
  for (const m of migrations) {
    if (!(m.nome in manifesto)) v(m.nome, 'MIGRATION_NAO_APROVADA', 'fora do manifesto da release');
    else if (sha256(m.sql) !== manifesto[m.nome]) v(m.nome, 'MIGRATION_CHECKSUM_DIVERGENTE', 'conteúdo difere do auditado');
  }
  const novas = new Set();
  for (const m of migrations) for (const x of semComentarios(m.sql).matchAll(new RegExp(`CREATE TABLE (${ID})`, 'g'))) novas.add(q(x[1]));
  const colunasNovasEmAntigas = new Set();
  for (const m of migrations) {
    let sql = semComentarios(m.sql);
    sql = sql.replace(/DO\s+\$\$([\s\S]*?)\$\$\s*;?/g, (_, corpo) => {
      const norm = corpo.replace(/\s+/g, ' ').trim();
      if (!doAprovados.includes(sha256(norm))) v(m.nome, 'DO_NAO_RECONHECIDO', norm);
      const citadas = [...norm.matchAll(/'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g)].map((x) => x[1] ?? x[2]);
      for (const t of citadas) if (!novas.has(t)) v(m.nome, 'DO_EM_TABELA_ANTIGA', t);
      return ';';
    });
    for (const bruto of sql.split(';')) {
      const st = bruto.replace(/\s+/g, ' ').trim();
      if (!st) continue;
      let x;
      if ((x = st.match(new RegExp(`^CREATE TABLE (${ID}) \\(`)))) continue;
      if ((x = st.match(new RegExp(`^CREATE (UNIQUE )?INDEX ${ID} ON (${ID}) ?\\(`)))) {
        if (x[1] && !novas.has(q(x[2]))) v(m.nome, 'UNIQUE_EM_TABELA_ANTIGA', q(x[2]));
        continue;
      }
      if ((x = st.match(new RegExp(`^ALTER TABLE (${ID}) (.*)$`)))) {
        const tabela = q(x[1]);
        const acao = x[2];
        if (novas.has(tabela)) {
          if (new RegExp(`^(ADD CONSTRAINT ${ID} (FOREIGN KEY|CHECK) |DROP CONSTRAINT ${ID}$|ADD COLUMN ${ID} )`).test(acao)) continue;
          v(m.nome, 'ALTER_NAO_RECONHECIDO', `${tabela}: ${acao}`);
          continue;
        }
        const col = acao.match(new RegExp(`^ADD COLUMN (${ID}) (VARCHAR\\(\\d+\\)|TEXT|INTEGER|BOOLEAN|TIMESTAMP\\(3\\)|DECIMAL\\(\\d+,\\d+\\))$`));
        if (col) {
          colunasNovasEmAntigas.add(`${tabela}.${q(col[1])}`);
          continue;
        }
        const fk = acao.match(new RegExp(`^ADD CONSTRAINT ${ID} FOREIGN KEY \\("cliente_id", (${ID})\\) REFERENCES (${ID})\\("cliente_id", "id"\\) ON DELETE (RESTRICT|SET NULL) ON UPDATE CASCADE$`));
        if (fk && colunasNovasEmAntigas.has(`${tabela}.${q(fk[1])}`) && novas.has(q(fk[2]))) continue;
        v(m.nome, 'ALTER_EM_TABELA_ANTIGA', `${tabela}: ${acao}`);
        continue;
      }
      v(m.nome, 'SQL_NAO_RECONHECIDO', st);
    }
  }
  return { expand: violacoes.length === 0, tabelas_novas: [...novas].sort(), colunas_novas_em_tabelas_antigas: [...colunasNovasEmAntigas].sort(), violacoes };
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
    else if (porNome.get(l.migration_name) !== l.checksum) falhas.push(`checksum divergente no banco: ${l.migration_name}`);
    aplicadas.add(l.migration_name);
  }
  const pendentes = locais.map((l) => l.nome).filter((n) => !aplicadas.has(n));
  for (const n of pendentes) if (!(n in aprovadas)) falhas.push(`pendente fora do manifesto da release: ${n}`);
  return { ok: falhas.length === 0, codigo: falhas.length ? 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS' : null, pendentes, falhas };
};
