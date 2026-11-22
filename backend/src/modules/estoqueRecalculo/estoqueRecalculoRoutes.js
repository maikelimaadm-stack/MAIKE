/**
 * D-PROD-273 (fatia 3) — prévia SOMENTE LEITURA da exclusão com recálculo.
 *
 *  GET /estoque/movimentos/:id/exclusao/previa?empresa_id=…
 *
 * O tenant vem do `auth_context` (R11); a querystring é fechada (`cliente_id` ou qualquer chave extra → 400).
 * Guarda = a da EXCLUSÃO do movimento correspondente, escolhida pela origem do movimento lido:
 *  - saída manual → `estoque.saida`; entrada documentada → `estoque.entrada`;
 *  - transferência entre depósitos → `movimentacaoEstoque.cancelarTransferencia`;
 *  - baixa do cocho → `suplementacaoEvento.cancelar`; linha de produto da atividade → `atividadeApontamentos.cancelar`;
 *  - abastecimento → `patrimonioAbastecimentos.cancelar`; compra/venda do financeiro → `operacaoFinanceira.cancelar`.
 * Origem sem exclusão no produto → 409 `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL { reason: 'origem_nao_suportada' }`.
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import {
  ORIGEM_ABASTECIMENTO, ORIGEM_APONTAMENTO, ORIGEM_DEPOSITO, ORIGEM_ENTRADA_ESTOQUE, ORIGEM_SAIDA_ESTOQUE, ORIGEM_SISTEMA, ORIGEM_SUPLEMENTACAO,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { previaExclusao, recalculoInviavel } from './estoqueRecalculoService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const PREVIA = {
  params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } },
  querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } },
};

/** Origem do movimento → guarda da exclusão correspondente. */
const GUARDA_DA_EXCLUSAO = Object.freeze({
  [ORIGEM_SAIDA_ESTOQUE]: GUARDAS.estoque.saida,
  [ORIGEM_ENTRADA_ESTOQUE]: GUARDAS.estoque.entrada,
  [ORIGEM_DEPOSITO]: GUARDAS.movimentacaoEstoque.cancelarTransferencia,
  [ORIGEM_SUPLEMENTACAO]: GUARDAS.suplementacaoEvento.cancelar,
  [ORIGEM_APONTAMENTO]: GUARDAS.atividadeApontamentos.cancelar,
  [ORIGEM_ABASTECIMENTO]: GUARDAS.patrimonioAbastecimentos.cancelar,
  [ORIGEM_SISTEMA]: GUARDAS.operacaoFinanceira.cancelar,
});

/** @param {import('fastify').FastifyInstance} app */
export const registrarEstoqueRecalculoRoutes = async (app) => {
  app.get('/estoque/movimentos/:id/exclusao/previa', { onRequest: [app.autenticar], schema: PREVIA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{ id: string }} */ (request.params);
    return previaExclusao(request.contexto, id, /** @type {any} */ (request.query), {
      autorizar: async (origem) => {
        const guarda = Object.prototype.hasOwnProperty.call(GUARDA_DA_EXCLUSAO, origem) ? GUARDA_DA_EXCLUSAO[origem] : null;
        if (!guarda) throw recalculoInviavel('origem_nao_suportada', { movimento_id: id, origem_sistema: origem });
        await guarda(request);
      },
    });
  });
};
