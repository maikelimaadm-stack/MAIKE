/**
 * Dados para usar sem internet (D-PROD-291).
 *
 * Duas leituras em lote, as duas só de leitura:
 *  - `baixarEntidadesParaOffline`: todas as entidades com adaptador offline
 *    (cadastros, áreas, lotes, pontos…) vão para o cache do aparelho;
 *  - `baixarLeiturasDasTelas`: as leituras que as telas fazem ao abrir
 *    (registradas pelas portas) e as já guardadas no aparelho.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';
import { listarCaminhosGuardados } from '@/lib/offline/respostasOffline';
import { baixarEntidadesParaOffline } from '@/lib/offline/offlineEntityRuntime';
import { leiturasOfflineRegistradas } from '@/lib/offline/leiturasOffline';
import { API_ERROR_CODES } from '../_core/ApiError.js';

/** Leituras ao mesmo tempo ao baixar (D-PROD-291: preparo mais rápido). */
const CONCORRENCIA = 8;

/**
 * Leituras das telas (registradas por cada porta de módulo, com a empresa) e
 * todas as já guardadas no aparelho, sem repetir. Cada uma vai ao servidor e a
 * resposta fica guardada (o `nativeRequest` guarda toda leitura). Nenhum
 * caminho é montado aqui. Sem permissão para uma tela (403) não é falha.
 *
 * @param {string|null} empresaId
 * @param {(p: {feitas: number, total: number}) => void} [aoAvancar]
 * @returns {Promise<{total: number, ok: number, falhas: number}>}
 */
export const baixarLeiturasDasTelas = async (empresaId, aoAvancar) => {
  const guardadas = await listarCaminhosGuardados(getOfflineTenant());
  const caminhos = [...new Set([...leiturasOfflineRegistradas(empresaId), ...guardadas])];
  let feitas = 0;
  let falhas = 0;
  const fila = [...caminhos];
  const trabalhar = async () => {
    while (fila.length) {
      const caminho = /** @type {string} */ (fila.shift());
      try {
        await nativeRequest(caminho, { autenticado: true, somenteRede: true }, { operation: 'baixarLeituraOffline', resource: 'DadosOffline' });
      } catch (erro) {
        if (/** @type {any} */ (erro)?.code === API_ERROR_CODES.PROVIDER_UNAVAILABLE) falhas += 1;
      }
      feitas += 1;
      aoAvancar?.({ feitas, total: caminhos.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, caminhos.length) }, trabalhar));
  return { total: caminhos.length, ok: caminhos.length - falhas, falhas };
};

export { baixarEntidadesParaOffline };
