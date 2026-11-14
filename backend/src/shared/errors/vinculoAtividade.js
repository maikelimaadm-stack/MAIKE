/**
 * D-PROD-198 — exclusão de cadastro barrada por uma ATIVIDADE (o cabeçalho) ou
 * por um APONTAMENTO de atividade. Substitui `vinculoApontamentoAtividade.js`
 * (D-PROD-190), que saiu com o apontamento de linha única.
 *
 * Mesma disciplina da lição do hotfix #259: os módulos dos cadastros apontados
 * (tipo e grupo de atividade, unidade de medida, área, setor, tarefa, bem,
 * centros, usuário, empresa) NUNCA consultam `Atividade` nem
 * `AtividadeApontamento` para decidir se podem apagar; quem barra é a FK
 * RESTRICT das tabelas novas. Com a FK violada, o PostgreSQL recusa (23503) e
 * o Prisma devolve P2003 com `meta.constraint` = nome da FK e `meta.modelName`
 * = o model da operação (o cadastro, na exclusão dele; `Atividade` ou
 * `AtividadeApontamento`, na escrita da própria tabela) — Prisma 6.19. No SQL
 * bruto (P2010), o 23503 traz o nome da FK entre aspas na mensagem.
 *
 * O reconhecimento é pelo NOME EXATO de cada constraint do migration.sql
 * `20261114400000_atividade_cabecalho`, ANCORADO dos dois lados: o nome não
 * pode vir colado a outro identificador. Sem a âncora, `Atividade_…_fkey`
 * casaria DENTRO das FKs de `TipoAtividade` e de `GrupoAtividade`; ex.:
 * `TipoAtividade_cliente_id_unidade_producao_id_fkey` (padrão do tipo, Fatia 1,
 * `vinculoTipoAtividadePadrao.js`) contém `Atividade_cliente_id_unidade_producao_id_fkey`,
 * que é uma FK real da atividade, e `TipoAtividade_cliente_id_fkey` contém
 * `Atividade_cliente_id_fkey`.
 *
 * Aqui só se RECONHECE o erro; quem traduz é o chamador (código próprio do
 * cadastro, ou `ATIVIDADE_REFERENCIA_INVALIDA` na escrita da própria tabela)
 * ou, em último caso, o `errorHandler` (409 `ATIVIDADE_VINCULADA`), nunca o
 * enganoso 403 `TENANT_SCOPE_VIOLATION` do P2003 genérico.
 */

/**
 * FK → a tabela que a declara (é ela que segura o vínculo; o nome do model é o
 * da tabela) e a coluna dela. Os nomes são os do migration.sql.
 * @type {Readonly<Record<string, Readonly<{ tabela: 'Atividade'|'AtividadeApontamento', campo: string }>>>}
 */
export const FKS_DA_ATIVIDADE = Object.freeze({
  Atividade_cliente_id_fkey: Object.freeze({ tabela: 'Atividade', campo: 'cliente_id' }),
  Atividade_cliente_id_empresa_id_fkey: Object.freeze({ tabela: 'Atividade', campo: 'empresa_id' }),
  Atividade_cliente_id_tipo_atividade_id_fkey: Object.freeze({ tabela: 'Atividade', campo: 'tipo_atividade_id' }),
  Atividade_cliente_id_grupo_atividade_id_fkey: Object.freeze({ tabela: 'Atividade', campo: 'grupo_atividade_id' }),
  Atividade_cliente_id_area_id_fkey: Object.freeze({ tabela: 'Atividade', campo: 'area_id' }),
  Atividade_cliente_id_setor_id_fkey: Object.freeze({ tabela: 'Atividade', campo: 'setor_id' }),
  Atividade_bem_fkey: Object.freeze({ tabela: 'Atividade', campo: 'bem_id' }),
  Atividade_centro_custo_fkey: Object.freeze({ tabela: 'Atividade', campo: 'centro_custo_id' }),
  Atividade_centro_resultado_fkey: Object.freeze({ tabela: 'Atividade', campo: 'centro_resultado_id' }),
  Atividade_cliente_id_unidade_producao_id_fkey: Object.freeze({ tabela: 'Atividade', campo: 'unidade_producao_id' }),
  Atividade_cliente_id_lancamento_tarefa_id_fkey: Object.freeze({ tabela: 'Atividade', campo: 'lancamento_tarefa_id' }),
  Atividade_criado_por_fkey: Object.freeze({ tabela: 'Atividade', campo: 'criado_por_usuario_id' }),
  Atividade_concluida_por_fkey: Object.freeze({ tabela: 'Atividade', campo: 'concluida_por_usuario_id' }),
  Atividade_cancelado_por_fkey: Object.freeze({ tabela: 'Atividade', campo: 'cancelado_por_usuario_id' }),
  Atividade_reaberta_por_fkey: Object.freeze({ tabela: 'Atividade', campo: 'reaberta_por_usuario_id' }),
  AtividadeApontamento_cliente_id_fkey: Object.freeze({ tabela: 'AtividadeApontamento', campo: 'cliente_id' }),
  AtividadeApontamento_cliente_id_empresa_id_fkey: Object.freeze({ tabela: 'AtividadeApontamento', campo: 'empresa_id' }),
  AtividadeApontamento_atividade_fkey: Object.freeze({ tabela: 'AtividadeApontamento', campo: 'atividade_id' }),
  AtividadeApontamento_operador_fkey: Object.freeze({ tabela: 'AtividadeApontamento', campo: 'operador_usuario_id' }),
  AtividadeApontamento_criado_por_fkey: Object.freeze({ tabela: 'AtividadeApontamento', campo: 'criado_por_usuario_id' }),
  AtividadeApontamento_cancelado_por_fkey: Object.freeze({ tabela: 'AtividadeApontamento', campo: 'cancelado_por_usuario_id' }),
});

/**
 * Um dos nomes acima, inteiro: nem precedido nem seguido de letra, dígito ou
 * `_` (os nomes só têm esses caracteres; o mais longo vem antes na alternância).
 */
const NOME_DA_FK = new RegExp(
  `(?<![A-Za-z0-9_])(?:${Object.keys(FKS_DA_ATIVIDADE).sort((a, b) => b.length - a.length).join('|')})(?![A-Za-z0-9_])`
);

/**
 * @typedef {{ constraint: string, tabela: 'Atividade'|'AtividadeApontamento', campo: string }} FkDaAtividade
 */

/** @param {string} texto @returns {FkDaAtividade | null} */
const fkCitada = (texto) => {
  const m = NOME_DA_FK.exec(texto);
  if (!m) return null;
  const fk = FKS_DA_ATIVIDADE[m[0]];
  return fk ? { constraint: m[0], tabela: fk.tabela, campo: fk.campo } : null;
};

/** @param {any} e */
const textoDoP2003 = (e) => `${String(e?.meta?.constraint ?? '')} ${String(e?.meta?.field_name ?? '')} ${String(e?.message ?? '')}`;

/** @param {any} e */
const textoDoP2010 = (e) => `${String(e?.meta?.message ?? '')} ${String(e?.message ?? '')}`;

/** 23503 do SQL bruto (`$queryRaw`/`$executeRaw`). @param {any} e */
const ehFkDoSqlBruto = (e) => e?.code === 'P2010' && String(e?.meta?.code ?? '') === '23503';

/**
 * FK da atividade ou do apontamento violada por uma escrita NA PRÓPRIA tabela
 * (create/update com um cadastro que sumiu entre a leitura e a escrita). O
 * serviço traduz para `ATIVIDADE_REFERENCIA_INVALIDA` do campo (ver
 * `comFkTraduzida` em `modules/atividades/atividadeComum.js`).
 *  - P2003: o nome da FK é de uma das duas tabelas e `meta.modelName`, quando
 *    vem, é a tabela da FK (o lado da escrita);
 *  - P2010/23503 do SQL bruto: só o lado do filho ("insert or update on table …").
 * @param {unknown} erro
 * @returns {FkDaAtividade | null}
 */
export const fkDaAtividadeNaEscrita = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code === 'P2003') {
    const fk = fkCitada(textoDoP2003(e));
    if (!fk) return null;
    const modelo = e?.meta?.modelName;
    return typeof modelo === 'string' && modelo !== '' && modelo !== fk.tabela ? null : fk;
  }
  if (ehFkDoSqlBruto(e)) {
    const texto = textoDoP2010(e);
    return /insert or update on table/.test(texto) ? fkCitada(texto) : null;
  }
  return null;
};

/**
 * A FK RESTRICT de uma atividade ou de um apontamento barrou a exclusão (ou a
 * troca de chave) do CADASTRO apontado? `{ constraint, tabela, campo }` ou null
 * — inclusive para a escrita na própria tabela (`meta.modelName` = a tabela da
 * FK), que é de `fkDaAtividadeNaEscrita`.
 *  - P2003: o nome da FK é de uma das duas tabelas e a operação foi em OUTRO model;
 *  - P2010/23503 do SQL bruto: só o lado do pai ("update or delete on table …").
 * @param {unknown} erro
 * @returns {FkDaAtividade | null}
 */
export const vinculoComAtividade = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code === 'P2003') {
    const fk = fkCitada(textoDoP2003(e));
    if (!fk) return null;
    return e?.meta?.modelName === fk.tabela ? null : fk;
  }
  if (ehFkDoSqlBruto(e)) {
    const texto = textoDoP2010(e);
    return /update or delete on table/.test(texto) ? fkCitada(texto) : null;
  }
  return null;
};
