/**
 * Dados para usar sem internet (D-PROD-289).
 *
 * Duas leituras em lote, as duas só de leitura:
 *  - `baixarEntidadesParaOffline`: todas as entidades com adaptador offline
 *    (cadastros, áreas, lotes, pontos…) vão para o cache do aparelho;
 *  - `atualizarLeiturasGuardadas`: refaz cada leitura já guardada no
 *    aparelho (telas abertas antes com internet).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';
import { listarCaminhosGuardados } from '@/lib/offline/respostasOffline';
import { baixarEntidadesParaOffline } from '@/lib/offline/offlineEntityRuntime';
import { API_ERROR_CODES } from '../_core/ApiError.js';

const CONCORRENCIA = 4;

/**
 * Refaz, com internet, toda leitura já guardada no aparelho (as telas que a
 * pessoa abriu com internet), para elas abrirem atualizadas sem internet.
 * Os caminhos vêm do que as próprias portas pediram: nada é montado aqui.
 * Sem permissão para uma tela (403) não é falha: a pessoa não a usa.
 *
 * @param {(p: {feitas: number, total: number}) => void} [aoAvancar]
 * @returns {Promise<{total: number, ok: number, falhas: number}>}
 */
export const atualizarLeiturasGuardadas = async (aoAvancar) => {
  const caminhos = await listarCaminhosGuardados(getOfflineTenant());
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
