/**
 * Gestão Rural (D-PROD-146) — espelho EXATO dos guardas do servidor
 * (`GUARDAS.parceiro|centroCusto|centroResultado` em
 * backend/src/shared/auth/guardasRotas.js):
 *  - ver       = visualizar da tela;
 *  - criar     = novo OU salvar;
 *  - editar    = editar OU salvar (também inativar, reativar e vincular).
 *
 * Recebe a permissão EFETIVA (`permissaoEfetiva`): administrador da fazenda e a
 * concessão `is_admin` chegam com `is_admin: true` = tudo, como no servidor.
 * Sem registro / sem linha da tela → nada (fail-closed; não há concessão
 * automática das telas novas). Quem bloqueia de fato é o servidor (403).
 */
import { canPerformAction } from './permissions.js';

export const MODULO_GESTAO_RURAL = 'gestao-rural';

export const TELAS_GESTAO = Object.freeze({
  PARCEIROS: 'ges-parceiros',
  CENTROS_CUSTO: 'ges-centros-custo',
  CENTROS_RESULTADO: 'ges-centros-resultado',
  // D-PROD-153 — Gestão P2 (`GUARDAS.naturezaFinanceira`, mesma regra).
  NATUREZAS_FINANCEIRAS: 'ges-naturezas-financeiras',
  // D-PROD-154 — Gestão P3-01 (`GUARDAS.operacaoFinanceira`): cadastro + ações extras.
  LANCAMENTOS_FINANCEIROS: 'ges-lancamentos-financeiros',
});

/**
 * Ações extras da Central de Lançamentos → chave gravada na linha da tela.
 * `estornar` (nome curto da tela) = `estornar_liquidacao` (nome do servidor).
 */
export const ACOES_EXTRAS_LANCAMENTOS = Object.freeze({
  confirmar: 'confirmar',
  liquidar: 'liquidar',
  estornar: 'estornar_liquidacao',
  cancelar: 'cancelar',
});

/**
 * Na Central de Lançamentos também saem as ações extras (cada uma exige a SUA
 * chave — sem atalho por `salvar`/`editar`): `confirmar`, `liquidar`,
 * `estornar` (= `estornar_liquidacao`) e `cancelar`. Descartar rascunho é
 * edição (`editar|salvar`), como o DELETE do servidor.
 *
 * @param {unknown} permissao
 * @param {string} tela
 * @returns {{ ver: boolean, criar: boolean, editar: boolean, confirmar?: boolean, liquidar?: boolean, estornar?: boolean, cancelar?: boolean }}
 */
export const acoesDaTelaGestao = (permissao, tela) => {
  const pode = (/** @type {string} */ acao) => canPerformAction(permissao, tela, MODULO_GESTAO_RURAL, acao);
  const base = {
    ver: pode('visualizar'),
    criar: pode('novo') || pode('salvar'),
    editar: pode('editar') || pode('salvar'),
  };
  if (tela !== TELAS_GESTAO.LANCAMENTOS_FINANCEIROS) return base;
  return {
    ...base,
    confirmar: pode(ACOES_EXTRAS_LANCAMENTOS.confirmar),
    liquidar: pode(ACOES_EXTRAS_LANCAMENTOS.liquidar),
    estornar: pode(ACOES_EXTRAS_LANCAMENTOS.estornar),
    cancelar: pode(ACOES_EXTRAS_LANCAMENTOS.cancelar),
  };
};
