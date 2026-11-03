/**
 * PR174-R6 (D-PROD-107) — classificação EXPAND das migrations de uma release.
 *
 * "EXPAND" aqui é PROVADO pelo SQL, nunca suposto: o banco migrado tem de
 * continuar servindo o backend ANTIGO (a main publicada) sem erro. Regras:
 *  - tabela CRIADA no próprio conjunto: livre (DROP de constraint/policy dela,
 *    índices, checks — ninguém em produção depende dela ainda);
 *  - tabela PRÉ-EXISTENTE: só `ADD COLUMN` anulável ou com DEFAULT,
 *    `ADD CONSTRAINT … FOREIGN KEY` (em coluna nova anulável) e `CREATE INDEX`
 *    não-único. Qualquer DROP/RENAME/ALTER COLUMN/SET NOT NULL/TYPE, CHECK,
 *    UNIQUE, TRUNCATE, DELETE ou UPDATE nela → violação;
 *  - bloco `DO $$ … $$`: só RLS/policy (ENABLE ROW LEVEL SECURITY, DROP/CREATE
 *    POLICY) e só se as tabelas citadas forem novas.
 * Sem dependência de banco: lê só os arquivos.
 */

const semComentarios = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const nomeTabela = (s) => s.replace(/"/g, '').replace(/^public\./i, '');

/** @param {Array<{nome: string, sql: string}>} migrations */
export const classificarMigrations = (migrations) => {
  const violacoes = [];
  const criadas = new Set();
  for (const m of migrations) for (const x of semComentarios(m.sql).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)/gi)) criadas.add(nomeTabela(x[1]));
  for (const m of migrations) {
    let sql = semComentarios(m.sql);
    // Blocos DO $$ … $$ (RLS): só permitidos sobre tabelas novas.
    sql = sql.replace(/DO\s+\$\$([\s\S]*?)\$\$\s*;?/gi, (_, corpo) => {
      const proibido = corpo.replace(/ENABLE\s+ROW\s+LEVEL\s+SECURITY|DROP\s+POLICY\s+IF\s+EXISTS|CREATE\s+POLICY/gi, '').match(/\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME|ALTER\s+COLUMN)\b/i);
      if (proibido) violacoes.push({ migration: m.nome, motivo: `bloco DO com ${proibido[1].toUpperCase()}` });
      const citadas = [...corpo.matchAll(/'([A-Z][A-Za-z]+)'|public\."([A-Za-z]+)"/g)].map((x) => x[1] ?? x[2]);
      for (const t of citadas) if (!criadas.has(t)) violacoes.push({ migration: m.nome, motivo: `bloco DO em tabela pré-existente "${t}"` });
      return '';
    });
    for (const bruto of sql.split(';')) {
      const st = bruto.replace(/\s+/g, ' ').trim();
      if (!st) continue;
      const alter = st.match(/^ALTER TABLE (?:ONLY )?("?[\w.]+"?) (.*)$/i);
      if (alter) {
        const tabela = nomeTabela(alter[1]);
        if (criadas.has(tabela)) continue;
        const acao = alter[2];
        const addCol = acao.match(/^ADD COLUMN (?:IF NOT EXISTS )?"?\w+"? (.*)$/i);
        if (addCol) {
          if (/NOT NULL/i.test(addCol[1]) && !/DEFAULT/i.test(addCol[1])) violacoes.push({ migration: m.nome, motivo: `ADD COLUMN NOT NULL sem DEFAULT em "${tabela}"` });
          continue;
        }
        if (/^ADD CONSTRAINT "?\w+"? FOREIGN KEY/i.test(acao)) continue;
        violacoes.push({ migration: m.nome, motivo: `ALTER TABLE em tabela pré-existente "${tabela}": ${acao.slice(0, 60)}` });
        continue;
      }
      if (/^CREATE TABLE/i.test(st)) continue;
      const idx = st.match(/^CREATE (UNIQUE )?INDEX (?:IF NOT EXISTS )?"?\w+"? ON ("?[\w.]+"?)/i);
      if (idx) {
        if (idx[1] && !criadas.has(nomeTabela(idx[2]))) violacoes.push({ migration: m.nome, motivo: `índice ÚNICO em tabela pré-existente "${nomeTabela(idx[2])}"` });
        continue;
      }
      const destrutivo = st.match(/^(DROP|TRUNCATE|DELETE|UPDATE|ALTER TYPE|RENAME)\b\s*(?:TABLE |FROM |INDEX |TYPE )?(?:IF EXISTS )?("?[\w.]+"?)?/i);
      if (destrutivo) {
        const alvo = destrutivo[2] ? nomeTabela(destrutivo[2]) : '';
        if (!criadas.has(alvo)) violacoes.push({ migration: m.nome, motivo: `${destrutivo[1].toUpperCase()} em objeto pré-existente "${alvo}"` });
        continue;
      }
      if (/^(CREATE|COMMENT|GRANT|REVOKE|SELECT|SET )/i.test(st)) continue;
      violacoes.push({ migration: m.nome, motivo: `instrução não classificada: ${st.slice(0, 60)}` });
    }
  }
  return { expand: violacoes.length === 0, tabelas_novas: [...criadas].sort(), violacoes };
};
