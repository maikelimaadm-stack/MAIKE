/**
 * Envio dos registros feitos sem internet (D-PROD-295) — o que as telas usam.
 *
 * As telas não falam com o motor nem com as filas diretamente: daqui saem o
 * resumo ("N aguardando envio", "N precisam de atenção"), o "Enviar agora", o
 * "Tentar de novo" e o "Descartar".
 */

import {
  resumoDaFila,
  tentarDeNovo,
  descartarDaFila,
  dependentesNaFila,
  definirSessaoDaFila,
  EVENTO_FILA_DE_ENVIO,
} from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { sincronizarTudo, iniciarSincronizacaoAutomatica } from '@/lib/offline/sincronizacao/gatilhosDeSincronizacao';
import { contarPendenciasDaFilaDeEntidades, getOfflineSyncEventName } from '@/lib/offline/offlineEntityRuntime';

/** Eventos que avisam mudança em alguma das filas. */
export const eventosDaFilaDeEnvio = () => [EVENTO_FILA_DE_ENVIO, getOfflineSyncEventName()];

/**
 * Resumo das duas filas desta sessão.
 * @returns {Promise<{aguardando: number, atencao: number, enviando: boolean,
 *   itens: Awaited<ReturnType<typeof resumoDaFila>>['itens'], outrosAguardando: number}>}
 */
export const lerFilaDeEnvio = async () => {
  const [motor, outros] = await Promise.all([resumoDaFila(), contarPendenciasDaFilaDeEntidades()]);
  return { ...motor, aguardando: motor.aguardando + outros, outrosAguardando: outros };
};

/** "Enviar agora". */
export const enviarAgora = () => sincronizarTudo();

/** @param {string} id */
export const tentarEnviarDeNovo = (id) => tentarDeNovo(id);

/** @param {string} id */
export const descartarRegistroNaoEnviado = (id) => descartarDaFila(id);

/** Registros que citam este (vão para "precisa de atenção" se ele for excluído). @param {string} id */
export const dependentesDoRegistro = (id) => dependentesNaFila(id);

/** Há algo desta sessão que ainda não chegou ao servidor? */
export const temRegistroNaoEnviado = async () => {
  const r = await lerFilaDeEnvio();
  return r.aguardando + r.atencao > 0;
};

/**
 * Dono da fila (chamado quando a sessão muda) e disparos automáticos.
 * @param {{clienteId: string|null, usuarioId: string|null}|null} sessao
 */
export const ligarEnvioDaSessao = (sessao) => {
  definirSessaoDaFila(sessao?.clienteId ? { cliente_id: sessao.clienteId, usuario_id: sessao.usuarioId } : null);
  if (sessao?.clienteId) {
    iniciarSincronizacaoAutomatica();
    void sincronizarTudo();
  }
};
