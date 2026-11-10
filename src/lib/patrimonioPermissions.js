/**
 * Patrimônio e Frota (D-PROD-157, simplificado pela D-PROD-161) — espelho EXATO
 * dos guardas do servidor (`GUARDAS.patrimonio*` em
 * backend/src/shared/auth/guardasRotas.js; ids das telas em `TELAS.PATRIMONIO_*`
 * de backend/src/shared/auth/autorizacaoTela.js):
 *  - ver      = visualizar da tela;
 *  - criar    = novo OU salvar;
 *  - editar   = editar OU salvar;
 *  - inativar = ação extra `inativar` (inativar E reativar; sem atalho por
 *               editar/salvar — guarda `edicaoPatrimonio` do servidor).
 *
 * D-PROD-161: só DUAS telas (Bens Patrimoniais e Abastecimentos). Famílias e
 * tipos vivem dentro do cadastro de Bens e seguem as ações da tela de Bens
 * (`acoesDeCatalogoNoBem`). As linhas antigas gravadas em `permissoes_telas`
 * (`pat-familias-patrimoniais`, `pat-tipos-patrimoniais`, `pat-perfis-medicao`,
 * `pat-combustiveis` e a ação `configurar_conversao` de Abastecimentos) ficam
 * INERTES: nada aqui as lê.
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
});

/** Ação extra da tela de Bens (`ACOES_PATRIMONIO_EXTRAS` no servidor). */
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
 * D-PROD-161 — famílias, tipos e os "Produtos aceitos" do tanque DENTRO do
 * cadastro de Bens. Espelho de `GUARDAS.patrimonioFamilias`/`patrimonioTipos`
 * e de `GUARDAS.patrimonioBens.opcoesProdutos`, todos sobre a tela de Bens:
 *  - criarCatalogo    = "+ Nova família"/"+ Novo tipo": Bens novo|salvar|editar
 *                       (`BENS_CRIAR_OU_EDITAR`: quem cadastra OU edita bem);
 *  - editarCatalogo   = renomear/descrever: Bens editar|salvar (`edicaoPatrimonio`);
 *  - inativarCatalogo = inativar/reativar família ou tipo: Bens `inativar`;
 *  - produtosDoTanque = listar os Produtos que um tanque pode aceitar: Bens novo|salvar|editar.
 * Ver famílias e tipos = ver Bens (`acoesDaTelaPatrimonio(…, BENS).ver`).
 * @param {unknown} permissao
 * @returns {{ criarCatalogo: boolean, editarCatalogo: boolean, inativarCatalogo: boolean, produtosDoTanque: boolean }}
 */
export const acoesDeCatalogoNoBem = (permissao) => {
  const pode = (/** @type {string} */ acao) => canPerformAction(permissao, TELAS_PATRIMONIO.BENS, MODULO_PATRIMONIO, acao);
  const criaOuEdita = pode('novo') || pode('salvar') || pode('editar');
  return {
    criarCatalogo: criaOuEdita,
    editarCatalogo: pode('editar') || pode('salvar'),
    inativarCatalogo: pode(ACAO_INATIVAR),
    produtosDoTanque: criaOuEdita,
  };
};

/**
 * D-PROD-159 (Patrimônio P1-02) — ação EXTRA da tela Abastecimentos
 * (`ACOES_ABASTECIMENTO_EXTRAS` no servidor): cancelar/estornar o abastecimento
 * confirmado. D-PROD-161: o fator kg/L (`configurar_conversao`) saiu; gravado
 * numa linha antiga, fica inerte.
 */
export const ACAO_CANCELAR_ABASTECIMENTO = 'cancelar';
/** Ações extras da tela Abastecimentos (`ACOES_ABASTECIMENTO_EXTRAS` no servidor). */
export const ACOES_EXTRAS_ABASTECIMENTO = Object.freeze([ACAO_CANCELAR_ABASTECIMENTO]);

/**
 * Espelho de `GUARDAS.patrimonioAbastecimentos`: ver = visualizar; criar (prévia
 * e confirmação) = novo OU salvar; cancelar = ação extra própria. Sem linha da
 * tela → tudo negado (fail-closed).
 * @param {unknown} permissao
 * @returns {{ ver: boolean, criar: boolean, cancelar: boolean }}
 */
export const acoesDaTelaAbastecimento = (permissao) => {
  const pode = (/** @type {string} */ acao) => canPerformAction(permissao, TELAS_PATRIMONIO.ABASTECIMENTOS, MODULO_PATRIMONIO, acao);
  return {
    ver: pode('visualizar'),
    criar: pode('novo') || pode('salvar'),
    cancelar: pode(ACAO_CANCELAR_ABASTECIMENTO),
  };
};
