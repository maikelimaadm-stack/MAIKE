/**
 * D-PROD-197 — FKs dos PADRÕES do Tipo de Atividade (centro de custo, centro
 * de resultado e unidade de produção), compostas pelo tenant e RESTRICT.
 *
 * Mesma disciplina de `vinculoAtividade.js` (D-PROD-199; antes,
 * `vinculoApontamentoAtividade.js`, D-PROD-190) — lição do hotfix #259:
 * os módulos dos cadastros apontados (unidade de medida, centros) NUNCA
 * consultam `TipoAtividade` para decidir se podem apagar; quem barra é a FK.
 * Com a FK violada, o PostgreSQL recusa (23503) e o Prisma devolve P2003 com
 * `meta.constraint` = nome da FK e `meta.modelName` = o model da escrita
 * (`TipoAtividade` na escrita do tipo; o cadastro, na exclusão dele) — Prisma
 * 6.19, conferido no banco real.
 *
 * Aqui só se RECONHECE o erro; quem traduz é o chamador (código próprio de cada
 * lado), nunca o enganoso 403 `TENANT_SCOPE_VIOLATION` do P2003 genérico.
 */

/** FK do tipo → coluna do tipo que guarda o padrão. */
export const CAMPO_DA_FK_DO_PADRAO = Object.freeze({
  TipoAtividade_cliente_id_centro_custo_padrao_id_fkey: 'centro_custo_padrao_id',
  TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey: 'centro_resultado_padrao_id',
  TipoAtividade_cliente_id_unidade_producao_id_fkey: 'unidade_producao_id',
});

const NOME_DA_FK = /TipoAtividade_cliente_id_(?:centro_custo_padrao_id|centro_resultado_padrao_id|unidade_producao_id)_fkey/;

/** @param {string} texto @returns {{ constraint: string, campo: string } | null} */
const fkCitada = (texto) => {
  const m = NOME_DA_FK.exec(texto);
  if (!m) return null;
  const campo = /** @type {Record<string, string>} */ (CAMPO_DA_FK_DO_PADRAO)[m[0]];
  return campo ? { constraint: m[0], campo } : null;
};

/** @param {any} e */
const textoDoP2003 = (e) => `${String(e?.meta?.constraint ?? '')} ${String(e?.meta?.field_name ?? '')} ${String(e?.message ?? '')}`;

/**
 * FK de padrão violada por uma escrita NO PRÓPRIO tipo (create/update com um
 * centro ou unidade que sumiu na corrida). O serviço do tipo traduz.
 * @param {unknown} erro
 * @returns {{ constraint: string, campo: string } | null}
 */
export const fkDoPadraoNaEscrita = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code !== 'P2003') return null;
  if (e?.meta?.modelName && e.meta.modelName !== 'TipoAtividade') return null;
  return fkCitada(textoDoP2003(e));
};

/**
 * A FK RESTRICT de um tipo de atividade barrou a exclusão (ou a troca de
 * chave) do CADASTRO usado como padrão? `{ constraint, campo }` ou null —
 * inclusive para a escrita no próprio tipo (`meta.modelName` = TipoAtividade).
 * Cobre o P2003 do Prisma e o 23503 do SQL bruto (P2010), este só do lado do
 * pai ("update or delete on table …").
 * @param {unknown} erro
 * @returns {{ constraint: string, campo: string } | null}
 */
export const vinculoComTipoAtividadePadrao = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code === 'P2003') {
    if (e?.meta?.modelName === 'TipoAtividade') return null;
    return fkCitada(textoDoP2003(e));
  }
  if (e?.code === 'P2010' && String(e?.meta?.code ?? '') === '23503') {
    const texto = `${String(e?.meta?.message ?? '')} ${String(e?.message ?? '')}`;
    return /update or delete on table/.test(texto) ? fkCitada(texto) : null;
  }
  return null;
};
