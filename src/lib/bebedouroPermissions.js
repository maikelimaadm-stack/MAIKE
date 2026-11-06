/**
 * Quem pode lançar e excluir no histórico do bebedouro — espelho EXATO de
 * `GUARDAS.bebedouroHistorico` (backend/src/shared/auth/guardasRotas.js),
 * D-PROD-136 (BEB-01/BEB-04).
 *
 * Antes, o Mapa Geral mostrava "Lançar" e "Excluir" a qualquer operador e o
 * servidor respondia 403; na tela Bebedouros a heurística do Layout lia o texto
 * do botão ("Lançar" = novo, "Salvar lançamento" = salvar) e barrava quem o
 * servidor aceitava. Agora os dois lugares perguntam a mesma coisa que o
 * servidor pergunta. A paridade é provada contra o servidor real em
 * `backend/tests/bebedouroHistoricoIntegrado.test.mjs`.
 *
 * Recebe a permissão EFETIVA (`permissaoEfetiva`): o administrador da fazenda e
 * a concessão `is_admin` chegam com `is_admin: true` = acesso total, como no
 * servidor (`acessoTotal`). Sem registro → nada (fail-closed).
 */
import { canPerformAction } from './permissions.js';

/** @typedef {{ tela: string, modulo: string, acao: string }} ConcessaoTela */

/** POST /bebedouros-historico: Bebedouros novo OU salvar, OU Mapa Geral salvar. */
export const BEBEDOURO_HISTORICO_LANCAR = Object.freeze(/** @type {ConcessaoTela[]} */ ([
  Object.freeze({ tela: 'pec-bebedouros', modulo: 'manejo', acao: 'novo' }),
  Object.freeze({ tela: 'pec-bebedouros', modulo: 'manejo', acao: 'salvar' }),
  Object.freeze({ tela: 'pec-mapa-geral', modulo: 'mapa', acao: 'salvar' }),
]));

/** DELETE /bebedouros-historico/:id: só Bebedouros excluir (a tela dona do registro). */
export const BEBEDOURO_HISTORICO_EXCLUIR = Object.freeze(/** @type {ConcessaoTela[]} */ ([
  Object.freeze({ tela: 'pec-bebedouros', modulo: 'manejo', acao: 'excluir' }),
]));

/** @param {unknown} permissao @param {readonly ConcessaoTela[]} concessoes */
const algumaPermite = (permissao, concessoes) =>
  concessoes.some((c) => canPerformAction(permissao, c.tela, c.modulo, c.acao));

/** @param {unknown} permissao permissão efetiva da sessão */
export const podeLancarNoBebedouro = (permissao) => algumaPermite(permissao, BEBEDOURO_HISTORICO_LANCAR);

/** @param {unknown} permissao permissão efetiva da sessão */
export const podeExcluirLancamentoBebedouro = (permissao) => algumaPermite(permissao, BEBEDOURO_HISTORICO_EXCLUIR);
