/**
 * Service do rastreio do trajeto no Diário da máquina (GPS fase 1).
 *
 * DEGRADAÇÃO (mesma regra do `diarioDisponivel`): o servidor de produção pode ainda não ter as rotas de trajeto. Quando a
 * recusa é "a rota não existe" (404/501 sem código de negócio, que chega como `OPERATION_FAILED`), cada função devolve
 * `{ estado: 'indisponivel' }` em vez de lançar: a tela mostra o aviso discreto e o Diário segue como hoje.
 *
 * Erros de negócio (`TRAJETO_*`, `ATIVIDADE_STATUS_INVALIDO`) e a falta de rede (`PROVIDER_UNAVAILABLE`) são LANÇADOS para
 * quem chama decidir: a falta de rede mantém o buffer para tentar de novo; a recusa de negócio aparece com a mensagem.
 */

import { abrirTrajeto as abrirNaApi, enviarPontosTrajeto, encerrarTrajeto as encerrarNaApi, listarTrajetosDoDia } from '@/apis/atividades';
import { API_ERROR_CODES, isApiError } from '@/apis/_core/ApiError';

/** @typedef {{ estado: 'ok', trajeto: any, replay: boolean } | { estado: 'indisponivel' }} RespostaAbrir */

/**
 * Código do erro (ou `null`). @param {unknown} erro @returns {string|null}
 */
export const codigoDoErroTrajeto = (erro) => (isApiError(erro) ? /** @type {any} */ (erro).code ?? null : null);

/**
 * A recusa é "rota inexistente no servidor" (404/501 sem código de negócio): o rastreio fica indisponível.
 * @param {unknown} erro
 */
export const ehRotaIndisponivel = (erro) => codigoDoErroTrajeto(erro) === API_ERROR_CODES.OPERATION_FAILED;

/** Roda a chamada; a rota indisponível vira `{estado:'indisponivel'}`; o resto é lançado. @param {() => Promise<any>} chamada */
const comDegradacao = async (chamada) => {
  try {
    const resposta = await chamada();
    return { estado: 'ok', ...resposta };
  } catch (erro) {
    if (ehRotaIndisponivel(erro)) return { estado: 'indisponivel' };
    throw erro;
  }
};

/**
 * Abre o trajeto da máquina nesta atividade. Mesma `operation_id` devolve o trajeto já aberto (replay).
 * O corpo leva só o que existe: `implemento_bem_id` e `apontamento_id` entram quando há.
 * @param {{ atividadeId: string, empresaId: string, bemId: string, dataOperacional: string, operationId: string, implementoBemId?: string|null, apontamentoId?: string|null }} p
 * @returns {Promise<{ estado: 'ok', trajeto: any, replay: boolean } | { estado: 'indisponivel' }>}
 */
export const abrirTrajeto = (p) =>
  comDegradacao(async () => {
    const corpo = {
      empresa_id: p.empresaId,
      bem_id: p.bemId,
      data_operacional: p.dataOperacional,
      operation_id: p.operationId,
      ...(p.implementoBemId ? { implemento_bem_id: p.implementoBemId } : {}),
      ...(p.apontamentoId ? { apontamento_id: p.apontamentoId } : {}),
    };
    const r = /** @type {any} */ (await abrirNaApi(String(p.atividadeId), corpo));
    return { trajeto: r?.trajeto ?? null, replay: r?.replay === true };
  });

/**
 * Envia um lote de pontos (1 a 200). Reenvio do mesmo `seq` não duplica no servidor.
 * @param {{ atividadeId: string, trajetoId: string, empresaId: string, pontos: Array<Record<string, any>> }} p
 * @returns {Promise<{ estado: 'ok', recebidos: number, novos: number } | { estado: 'indisponivel' }>}
 */
export const enviarPontos = (p) =>
  comDegradacao(async () => {
    const r = /** @type {any} */ (await enviarPontosTrajeto(String(p.atividadeId), String(p.trajetoId), { empresa_id: p.empresaId, pontos: p.pontos }));
    return { recebidos: Number(r?.recebidos) || 0, novos: Number(r?.novos) || 0 };
  });

/**
 * Encerra o trajeto (idempotente: já encerrado volta com `replay: true`).
 * @param {{ atividadeId: string, trajetoId: string, empresaId: string }} p
 * @returns {Promise<{ estado: 'ok', trajeto: any, replay: boolean } | { estado: 'indisponivel' }>}
 */
export const encerrarTrajeto = (p) =>
  comDegradacao(async () => {
    const r = /** @type {any} */ (await encerrarNaApi(String(p.atividadeId), String(p.trajetoId), { empresa_id: p.empresaId }));
    return { trajeto: r?.trajeto ?? null, replay: r?.replay === true };
  });

/**
 * Os trajetos da máquina no dia (com a linha amostrada), para o resumo e o mapa.
 * @param {{ atividadeId: string, empresaId: string, dia: string }} p
 * @returns {Promise<{ estado: 'ok', trajetos: any[] } | { estado: 'indisponivel' }>}
 */
export const listarTrajetosDoDiaDaAtividade = (p) =>
  comDegradacao(async () => {
    const r = /** @type {any} */ (await listarTrajetosDoDia(String(p.atividadeId), p.empresaId, p.dia));
    return { trajetos: Array.isArray(r?.trajetos) ? r.trajetos : [] };
  });
