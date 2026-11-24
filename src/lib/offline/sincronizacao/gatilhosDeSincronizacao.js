/**
 * Quando a fila vai ao servidor (D-PROD-295).
 *
 * Sem a pessoa apertar nada:
 *   - assim que a internet volta;
 *   - quando o app abre ou volta da segunda tela (retomar no celular, aba
 *     visível no navegador);
 *   - a cada minuto, enquanto houver algo esperando;
 *   - logo depois de um registro entrar na fila.
 * E pelo botão "Enviar agora" da janela "Dados sem internet".
 *
 * Cada passada envia a fila do motor e, em seguida, a fila antiga de entidades
 * (`syncOfflineEntityQueue`), que até aqui guardava e nunca era disparada.
 * As duas nunca rodam duas passadas ao mesmo tempo.
 */

import { App } from '@capacitor/app';
import { isAppNativo } from '@/config/runtimeConfig';
import { syncOfflineEntityQueue, contarPendenciasDaFilaDeEntidades } from '@/lib/offline/offlineEntityRuntime';
import { sincronizar, resumoDaFila } from './motorDeSincronizacao.js';

const INTERVALO_MS = 60_000;

let iniciado = false;
/** @type {Promise<void>|null} */
let emCurso = null;

const estaOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * Uma passada pelas duas filas. Pedidos durante a passada recebem a mesma.
 * Nunca lança: falha de envio fica registrada no próprio item.
 */
export const sincronizarTudo = () => {
  if (!emCurso) {
    emCurso = (async () => {
      if (!estaOnline()) return;
      try {
        await sincronizar();
      } catch {
        // o item guarda o motivo; a próxima passada tenta de novo
      }
      try {
        if ((await contarPendenciasDaFilaDeEntidades()) > 0) await syncOfflineEntityQueue();
      } catch {
        // idem
      }
    })().finally(() => {
      emCurso = null;
    });
  }
  return emCurso;
};

const temAlgoEsperando = async () => {
  try {
    const r = await resumoDaFila();
    return r.aguardando > 0 || (await contarPendenciasDaFilaDeEntidades()) > 0;
  } catch {
    return false;
  }
};

/** Liga os disparos automáticos (uma vez por carga do app). */
export const iniciarSincronizacaoAutomatica = () => {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;

  window.addEventListener('online', () => {
    setTimeout(() => void sincronizarTudo(), 1000);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sincronizarTudo();
  });
  if (isAppNativo()) {
    App.addListener('resume', () => {
      void sincronizarTudo();
    }).catch(() => {});
  }
  setInterval(async () => {
    if (estaOnline() && (await temAlgoEsperando())) void sincronizarTudo();
  }, INTERVALO_MS);

  setTimeout(() => void sincronizarTudo(), 3000);
};
