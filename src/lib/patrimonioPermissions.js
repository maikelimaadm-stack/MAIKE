/**
 * Patrimônio e Frota (D-PROD-157) — espelho EXATO dos guardas do servidor
 * (`GUARDAS.patrimonio*` em backend/src/shared/auth/guardasRotas.js; ids das
 * telas em `TELAS.PATRIMONIO_*` de backend/src/shared/auth/autorizacaoTela.js):
 *  - ver      = visualizar da tela;
 *  - criar    = novo OU salvar;
 *  - editar   = editar OU salvar;
 *  - inativar = ação extra `inativar` (inativar E reativar; sem atalho por
 *               editar/salvar — guarda `edicaoPatrimonio` do servidor).
 *
 * Recebe a permissão EFETIVA: administrador da fazenda e a concessão `is_admin`
 * chegam com `is_admin: true` = tudo. Sem linha da tela → nada (fail-closed;
 * nenhuma concessão implícita a perfis antigos). Quem bloqueia é o servidor (403).
 */
import { canPerformAction } from './permissions.js';

export const MODULO_PATRIMONIO = 'patrimonio';

/** Ids das telas = ids do menu (`src/lib/menuConfig.js`) = `TELAS.PATRIMONIO_*` do servidor. */
export const TELAS_PATRIMONIO = Object.freeze({
  BENS: 'pat-bens-patrimoniais',
  ABASTECIMENTOS: 'pat-abastecimentos', // D-PROD-159 (mesma ordem do menu)
  FAMILIAS: 'pat-familias-patrimoniais',
  TIPOS: 'pat-tipos-patrimoniais',
  PERFIS_MEDICAO: 'pat-perfis-medicao',
  COMBUSTIVEIS: 'pat-combustiveis',
});

/** Ação extra das cinco telas de cadastro (`ACOES_PATRIMONIO_EXTRAS` no servidor). */
export const ACAO_INATIVAR = 'inativar';

export const ACOES_EXTRAS_PATRIMONIO = Object.freeze([ACAO_INATIVAR]);

/**
 * @param {unknown} permissao
 * @param {string} tela
 * @returns {{ ver: boolean, criar: boolean, editar: boolean, inativar: boolean }}
 */
export const acoesDaTelaPatrimonio = (permissao, tela) => {
  const pode = (/** @type {string} */ acao) => canPerformAction(permissao, tela, MODULO_PATRIMONIO, acao);
  return {
    ver: pode('visualizar'),
    criar: pode('novo') || pode('salvar'),
    editar: pode('editar') || pode('salvar'),
    inativar: pode(ACAO_INATIVAR),
  };
};

/**
 * D-PROD-159 (Patrimônio P1-02) — ações EXTRAS da tela Abastecimentos
 * (`ACOES_ABASTECIMENTO_EXTRAS` no servidor): cancelar/estornar o abastecimento
 * confirmado e configurar o fator de conversão kg/L. As cinco telas de cadastro
 * continuam só com `inativar`.
 */
export const ACAO_CANCELAR_ABASTECIMENTO = 'cancelar';
export const ACAO_CONFIGURAR_CONVERSAO = 'configurar_conversao';
/** Ações extras da tela Abastecimentos (`ACOES_ABASTECIMENTO_EXTRAS` no servidor). */
export const ACOES_EXTRAS_ABASTECIMENTO = Object.freeze([ACAO_CANCELAR_ABASTECIMENTO, ACAO_CONFIGURAR_CONVERSAO]);

/**
 * Espelho de `GUARDAS.patrimonioAbastecimentos`: ver = visualizar; criar (prévia
 * e confirmação) = novo OU salvar; cancelar e configurar o fator = ações extras
 * próprias. Sem linha da tela → tudo negado (fail-closed).
 * @param {unknown} permissao
 * @returns {{ ver: boolean, criar: boolean, cancelar: boolean, configurarConversao: boolean }}
 */
export const acoesDaTelaAbastecimento = (permissao) => {
  const pode = (/** @type {string} */ acao) => canPerformAction(permissao, TELAS_PATRIMONIO.ABASTECIMENTOS, MODULO_PATRIMONIO, acao);
  return {
    ver: pode('visualizar'),
    criar: pode('novo') || pode('salvar'),
    cancelar: pode(ACAO_CANCELAR_ABASTECIMENTO),
    configurarConversao: pode(ACAO_CONFIGURAR_CONVERSAO),
  };
};
