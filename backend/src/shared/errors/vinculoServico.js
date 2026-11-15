/**
 * D-PROD-203 — FKs do cadastro de SERVIÇO (`Servico`) para os cadastros que ele
 * aponta: unidade de medida (por cliente) e centro de custo padrão (da mesma
 * fazenda), compostas pelo tenant e RESTRICT.
 *
 * Mesma disciplina de `vinculoTipoAtividadePadrao.js` e `vinculoAtividade.js`
 * (lição do hotfix #259): o módulo da unidade de medida NUNCA consulta `Servico`
 * para decidir se pode apagar; quem barra é a FK. Com ela violada, o PostgreSQL
 * recusa (23503) e o Prisma devolve P2003 com `meta.constraint` = nome da FK e
 * `meta.modelName` = o model da operação (`Servico` na escrita do serviço; o
 * cadastro apontado, na exclusão dele).
 *
 * Os nomes são os do migration.sql `20261114700000_atividade_mao_obra_servico`,
 * ANCORADOS dos dois lados: `AtividadeApontamentoServico_…` (linha de serviço)
 * não casa com uma FK do cadastro.
 *
 * Aqui só se RECONHECE o erro; quem traduz é o chamador.
 */

/** FK do serviço → coluna do serviço. */
export const CAMPO_DA_FK_DO_SERVICO = Object.freeze({
  Servico_cliente_id_unidade_medida_id_fkey: 'unidade_medida_id',
  Servico_centro_custo_padrao_fkey: 'centro_custo_padrao_id',
});

const NOME_DA_FK = new RegExp(
  `(?<![A-Za-z0-9_])(?:${Object.keys(CAMPO_DA_FK_DO_SERVICO).sort((a, b) => b.length - a.length).join('|')})(?![A-Za-z0-9_])`
);

/** @param {string} texto @returns {{ constraint: string, campo: string } | null} */
const fkCitada = (texto) => {
  const m = NOME_DA_FK.exec(texto);
  if (!m) return null;
  const campo = /** @type {Record<string, string>} */ (CAMPO_DA_FK_DO_SERVICO)[m[0]];
  return campo ? { constraint: m[0], campo } : null;
};

/** @param {any} e */
const textoDoP2003 = (e) => `${String(e?.meta?.constraint ?? '')} ${String(e?.meta?.field_name ?? '')} ${String(e?.message ?? '')}`;

/**
 * FK violada por uma escrita NO PRÓPRIO serviço (create/update com unidade ou
 * centro que sumiu na corrida). O serviço traduz.
 * @param {unknown} erro
 * @returns {{ constraint: string, campo: string } | null}
 */
export const fkDoServicoNaEscrita = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code !== 'P2003') return null;
  if (e?.meta?.modelName && e.meta.modelName !== 'Servico') return null;
  return fkCitada(textoDoP2003(e));
};

/**
 * A FK RESTRICT de um serviço barrou a exclusão do CADASTRO apontado (unidade de
 * medida)? `{ constraint, campo }` ou null — inclusive para a escrita no próprio
 * serviço (`meta.modelName` = Servico). Cobre o P2003 do Prisma e o 23503 do SQL
 * bruto (P2010), este só do lado do pai ("update or delete on table …").
 * @param {unknown} erro
 * @returns {{ constraint: string, campo: string } | null}
 */
export const vinculoComServico = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code === 'P2003') {
    if (e?.meta?.modelName === 'Servico') return null;
    return fkCitada(textoDoP2003(e));
  }
  if (e?.code === 'P2010' && String(e?.meta?.code ?? '') === '23503') {
    const texto = `${String(e?.meta?.message ?? '')} ${String(e?.message ?? '')}`;
    return /update or delete on table/.test(texto) ? fkCitada(texto) : null;
  }
  return null;
};
