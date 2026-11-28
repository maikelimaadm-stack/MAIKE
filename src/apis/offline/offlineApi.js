/**
 * Dados para usar sem internet (D-PROD-294).
 *
 * Duas leituras em lote, as duas só de leitura:
 *  - `baixarEntidadesParaOffline`: todas as entidades com adaptador offline
 *    (cadastros, áreas, lotes, pontos…) vão para o cache do aparelho;
 *  - `baixarLeiturasDasTelas`: as leituras que as telas fazem ao abrir
 *    (registradas pelas portas) e as já guardadas no aparelho.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';
import { esquecerResposta, listarCaminhosGuardados } from '@/lib/offline/respostasOffline';
import { classificarFalhaDeEnvio } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { baixarEntidadesParaOffline } from '@/lib/offline/offlineEntityRuntime';
import { leiturasOfflineRegistradas } from '@/lib/offline/leiturasOffline';

/** Leituras ao mesmo tempo ao baixar (D-PROD-294: preparo mais rápido). */
const CONCORRENCIA = 8;

/**
 * D-PROD-343: tantas leituras seguidas sem resposta e a baixa das telas para (as que faltam contam como falha). No
 * Wi-Fi sem dados, cada uma esperava 20 s: centenas de caminhos levavam minutos, com o envio esperando a vez.
 */
export const PARAR_APOS_FALHAS_DE_REDE_SEGUIDAS = 6;

/** O servidor diz que o registro não existe (404 / `*_NOT_FOUND`). @param {unknown} erro */
/**
 * O servidor diz que não existe mais: o registro (código `…NOT_FOUND`) ou, D-PROD-383, a ROTA inteira (o 404 padrão do
 * Fastify, sem código: uma tela que saiu do sistema, como as das atividades). Nos dois casos a resposta guardada sai do
 * aparelho; sem isto, a baixa completa contaria a rota que saiu como "parte que não veio" para sempre.
 * @param {unknown} erro
 */
const naoExisteMais = (erro) => {
  const causa = /** @type {any} */ (erro)?.cause;
  if (/(^|_)NOT_FOUND$/.test(String(causa?.code ?? ''))) return true;
  return causa?.statusCode === 404 && causa?.error === 'Not Found' && /^Route \w+:/.test(String(causa?.message ?? ''));
};

/**
 * D-PROD-301 — todas as portas de módulo. Cada porta registra as suas leituras
 * ao carregar; sem isto, a lista dependia de quais telas já tinham sido abertas
 * (e um módulo ainda não carregado ficava de fora da baixa, em silêncio).
 */
const PORTAS = import.meta.glob('../*/*Port.js');

/** Carrega todas as portas (registram as leituras delas). Nunca lança. */
export const carregarTodasAsPortas = async () => {
  await Promise.all(Object.values(PORTAS).map((carregar) => carregar().catch(() => null)));
};

/**
 * Leituras das telas (registradas por cada porta de módulo, com a empresa) e
 * todas as já guardadas no aparelho, sem repetir. Cada uma vai ao servidor e a
 * resposta fica guardada (o `nativeRequest` guarda toda leitura). Nenhum
 * caminho é montado aqui. Sem permissão para uma tela (403) não é falha.
 *
 * D-PROD-343:
 *  - falha é também o erro do servidor (5xx) e a sessão recusada (401), não só a falta de rede: antes a parte
 *    aparecia como "baixada" sem ter vindo;
 *  - o que o servidor diz que não existe mais (404) sai do aparelho (antes o lote excluído abria sem internet);
 *  - depois de {@link PARAR_APOS_FALHAS_DE_REDE_SEGUIDAS} faltas de rede seguidas, para.
 *
 * @param {string|null} empresaId
 * @param {(p: {feitas: number, total: number}) => void} [aoAvancar]
 * @returns {Promise<{total: number, ok: number, falhas: number}>}
 */
export const baixarLeiturasDasTelas = async (empresaId, aoAvancar) => {
  await carregarTodasAsPortas();
  const tenant = getOfflineTenant();
  const guardadas = await listarCaminhosGuardados(tenant);
  const caminhos = [...new Set([...leiturasOfflineRegistradas(empresaId), ...guardadas])];
  let feitas = 0;
  let falhas = 0;
  let semRedeSeguidas = 0;
  const fila = [...caminhos];
  const trabalhar = async () => {
    while (fila.length) {
      if (semRedeSeguidas >= PARAR_APOS_FALHAS_DE_REDE_SEGUIDAS) {
        falhas += fila.length;
        feitas += fila.length;
        fila.length = 0;
        aoAvancar?.({ feitas, total: caminhos.length });
        return;
      }
      const caminho = /** @type {string} */ (fila.shift());
      try {
        await nativeRequest(caminho, { autenticado: true, somenteRede: true }, { operation: 'baixarLeituraOffline', resource: 'DadosOffline' });
        semRedeSeguidas = 0;
      } catch (erro) {
        const falha = classificarFalhaDeEnvio(erro);
        if (falha === 'rede') semRedeSeguidas += 1;
        else semRedeSeguidas = 0;
        if (naoExisteMais(erro)) await esquecerResposta(tenant, caminho);
        else if (falha !== 'recusado') falhas += 1;
      }
      feitas += 1;
      aoAvancar?.({ feitas, total: caminhos.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, caminhos.length) }, trabalhar));
  return { total: caminhos.length, ok: caminhos.length - falhas, falhas };
};

export { baixarEntidadesParaOffline };
