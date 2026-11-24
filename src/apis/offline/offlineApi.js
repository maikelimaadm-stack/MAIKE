/**
 * Dados para usar sem internet (D-PROD-288).
 *
 * Duas leituras em lote, as duas só de leitura:
 *  - `baixarEntidadesParaOffline`: todas as entidades com adaptador offline
 *    (cadastros, áreas, lotes, pontos…) vão para o cache do aparelho;
 *  - `baixarLeiturasDasTelas`: as leituras que cada tela faz ao abrir
 *    (`LEITURAS_PARA_OFFLINE`) e as já guardadas no aparelho.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';
import { listarCaminhosGuardados } from '@/lib/offline/respostasOffline';
import { baixarEntidadesParaOffline } from '@/lib/offline/offlineEntityRuntime';
import { LEITURAS_PARA_OFFLINE } from '@/config/leiturasParaOffline';
import { API_ERROR_CODES } from '../_core/ApiError.js';

const CONCORRENCIA = 4;

/**
 * Leituras das telas (lista fixa, com a empresa) + todas as já guardadas no
 * aparelho, sem repetir. Cada uma vai ao servidor e a resposta fica guardada
 * (o `nativeRequest` guarda toda leitura). Sem permissão para uma tela (403)
 * não é falha: a pessoa não a usa.
 *
 * @param {string|null} empresaId
 * @param {(p: {feitas: number, total: number}) => void} [aoAvancar]
 * @returns {Promise<{total: number, ok: number, falhas: number}>}
 */
export const baixarLeiturasDasTelas = async (empresaId, aoAvancar) => {
  const empresa = empresaId ? encodeURIComponent(empresaId) : null;
  const fixas = LEITURAS_PARA_OFFLINE.filter((c) => empresa || !c.includes('{empresa}')).map((c) =>
    empresa ? c.split('{empresa}').join(empresa) : c
  );
  const guardadas = await listarCaminhosGuardados(getOfflineTenant());
  const caminhos = [...new Set([...fixas, ...guardadas])];
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
