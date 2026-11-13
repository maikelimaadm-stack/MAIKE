/**
 * D-PROD-188 (R-l) — exclusão de cadastro barrada por um apontamento de atividade.
 *
 * Lição do hotfix #259: o código pode subir antes da migration da tabela nova.
 * Por isso os módulos ANTIGOS (exclusão de Tipo/Grupo de Atividade, de
 * lançamento de tarefa, de empresa…) NUNCA consultam `ApontamentoAtividade`
 * para decidir se podem apagar: quem barra é a FK RESTRICT da tabela nova. Sem
 * a tabela não há FK, e a exclusão segue como antes; com ela, o PostgreSQL
 * recusa (23503) e o Prisma devolve P2003 com `meta.constraint` = nome da FK e
 * `meta.modelName` = o model que se tentou apagar (Prisma 6.19).
 *
 * Aqui só se RECONHECE o erro; quem traduz é o chamador (código próprio do
 * cadastro) ou, em último caso, o `errorHandler` (409
 * `APONTAMENTO_ATIVIDADE_VINCULADO`), nunca o enganoso 403
 * `TENANT_SCOPE_VIOLATION` do P2003 genérico.
 */

/** FK do apontamento → coluna do apontamento que segura o vínculo. */
export const CAMPO_DA_FK_DO_APONTAMENTO = Object.freeze({
  ApontamentoAtividade_cliente_id_fkey: 'cliente_id',
  ApontamentoAtividade_cliente_id_empresa_id_fkey: 'empresa_id',
  ApontamentoAtividade_cliente_id_tipo_atividade_id_fkey: 'tipo_atividade_id',
  ApontamentoAtividade_cliente_id_grupo_atividade_id_fkey: 'grupo_atividade_id',
  ApontamentoAtividade_bem_fkey: 'bem_id',
  ApontamentoAtividade_implemento_fkey: 'implemento_bem_id',
  ApontamentoAtividade_cliente_id_area_id_fkey: 'area_id',
  ApontamentoAtividade_centro_custo_fkey: 'centro_custo_id',
  ApontamentoAtividade_centro_resultado_fkey: 'centro_resultado_id',
  ApontamentoAtividade_cliente_id_lancamento_tarefa_id_fkey: 'lancamento_tarefa_id',
  ApontamentoAtividade_operador_fkey: 'operador_usuario_id',
  ApontamentoAtividade_criado_por_fkey: 'criado_por_usuario_id',
  ApontamentoAtividade_cancelado_por_fkey: 'cancelado_por_usuario_id',
});

const NOME_DA_FK = /ApontamentoAtividade_[A-Za-z0-9_]+?_fkey/;

/** @param {string} texto @returns {{ constraint: string, campo: string } | null} */
const fkCitada = (texto) => {
  const m = NOME_DA_FK.exec(texto);
  if (!m) return null;
  const campo = /** @type {Record<string, string>} */ (CAMPO_DA_FK_DO_APONTAMENTO)[m[0]];
  return campo ? { constraint: m[0], campo } : null;
};

/**
 * FK do apontamento violada por uma escrita NO PRÓPRIO apontamento (create/update
 * com um cadastro que sumiu na corrida). O serviço do apontamento traduz.
 * @param {unknown} erro
 * @returns {{ constraint: string, campo: string } | null}
 */
export const fkDoApontamentoNaEscrita = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code !== 'P2003') return null;
  return fkCitada(`${String(e?.meta?.constraint ?? '')} ${String(e?.meta?.field_name ?? '')} ${String(e?.message ?? '')}`);
};

/**
 * A FK RESTRICT de um apontamento barrou a exclusão (ou a troca de chave) do
 * CADASTRO apontado? `{ constraint, campo }` ou null — inclusive para a escrita
 * no próprio apontamento (`meta.modelName` = ApontamentoAtividade).
 * Cobre o P2003 do Prisma e o 23503 do SQL bruto (P2010), este só do lado do
 * pai ("update or delete on table …").
 * @param {unknown} erro
 * @returns {{ constraint: string, campo: string } | null}
 */
export const vinculoComApontamentoAtividade = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code === 'P2003') {
    if (e?.meta?.modelName === 'ApontamentoAtividade') return null;
    return fkCitada(`${String(e?.meta?.constraint ?? '')} ${String(e?.meta?.field_name ?? '')} ${String(e?.message ?? '')}`);
  }
  if (e?.code === 'P2010' && String(e?.meta?.code ?? '') === '23503') {
    const texto = `${String(e?.meta?.message ?? '')} ${String(e?.message ?? '')}`;
    return /update or delete on table/.test(texto) ? fkCitada(texto) : null;
  }
  return null;
};
