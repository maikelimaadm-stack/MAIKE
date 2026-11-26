/**
 * Quando a fila vai ao servidor (D-PROD-295).
 *
 * Sem a pessoa apertar nada:
 *   - assim que a internet volta;
 *   - quando o app abre ou volta da segunda tela (retomar no celular, aba
 *     visível no navegador);
 *   - a cada minuto, enquanto houver algo esperando;
 *   - logo depois de um registro entrar na fila.
 * E pelo botão "Enviar agora" da janela "Sincronização".
 *
 * Cada passada envia a fila do motor e, em seguida, a fila antiga de entidades
 * (`syncOfflineEntityQueue`), que até aqui guardava e nunca era disparada.
 * As duas nunca rodam duas passadas ao mesmo tempo.
 */

import { App } from '@capacitor/app';
import { isAppNativo } from '@/config/runtimeConfig';
import {
  syncOfflineEntityQueue,
  contarPendenciasDaFilaDeEntidades,
  idsComCriacaoPendenteNaFilaDeEntidades,
  temEntidadeSemPortaNaFila,
} from '@/lib/offline/offlineEntityRuntime';
import { naVezDaSincronia } from './vezDaSincronia.js';
import { sincronizar, resumoDaFila, definirEsperaDeFora, EVENTO_FILA_DE_ENVIO, temTipoSemRegistroNaFila } from './motorDeSincronizacao.js';

// D-PROD-308: registro do motor que cita um cadastro criado no aparelho (cocho, lote) ainda
// na fila antiga espera essa criação chegar ao servidor — senão iria antes e seria recusado.
definirEsperaDeFora(async (valores) => {
  const pendentes = await idsComCriacaoPendenteNaFilaDeEntidades();
  if (pendentes.size === 0) return false;
  for (const v of valores) if (pendentes.has(v)) return true;
  return false;
});

const INTERVALO_MS = 60_000;

/**
 * D-PROD-319: trabalhos que rodam no fim de cada passada com internet (ex.: enviar as tarefas que ficaram no
 * armazenamento antigo do aparelho). Registrados por quem os conhece; nunca derrubam a passada.
 * @type {Set<() => Promise<unknown>>}
 */
const PASSADAS_EXTRAS = new Set();
/** @param {() => Promise<unknown>} fn */
export const registrarPassadaExtra = (fn) => {
  PASSADAS_EXTRAS.add(fn);
};

let iniciado = false;
/** @type {Promise<void>|null} */
let emCurso = null;

/**
 * D-PROD-335 — quem sabe enviar cada registro precisa estar carregado ANTES da passada. Os tipos de envio do
 * cocho (lançamento, cancelamento) e do depósito (transferência e cancelamento) e as portas de cadastros como
 * Marca, Unidade, Categoria e Tipo de atividade só se registram quando o módulo deles carrega (as telas carregam
 * sob demanda, D-PROD-304). Depois de o Android fechar o app, nada disso estava carregado: a passada deixava os
 * lançamentos do cocho parados (e os cadastros travavam a fila antiga) até alguém abrir a tela de um lote.
 * Só carrega quando a fila tem algo que ninguém sabe enviar (o app continua leve na abertura).
 */
const carregarQuemEnvia = () =>
  Promise.all([
    import('@/services/suplementacaoService'),
    import('@/services/suplementacaoEstoqueService'),
    import('@/services/suplementacaoCancelamentoService'),
    import('@/apis/offline').then((m) => m.carregarTodasAsPortas()),
  ]).then(() => undefined);

export const prepararTiposDeEnvio = async () => {
  try {
    const [faltaTipo, faltaPorta] = await Promise.all([temTipoSemRegistroNaFila(), temEntidadeSemPortaNaFila()]);
    if (faltaTipo || faltaPorta) await carregarQuemEnvia();
  } catch {
    // sem carregar, o item fica na fila (como antes) e a próxima passada tenta de novo
  }
};

const estaOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * Uma passada pelas duas filas. Pedidos durante a passada recebem a mesma.
 * Nunca lança: falha de envio fica registrada no próprio item.
 */
export const sincronizarTudo = () => {
  if (!emCurso) {
    // D-PROD-307: na vez — nunca junto com uma baixa de dados (`vezDaSincronia`).
    emCurso = naVezDaSincronia(async () => {
      if (!estaOnline()) return;
      await prepararTiposDeEnvio();
      let segurados = 0;
      try {
        segurados = (await sincronizar())?.seguradosPorFora ?? 0;
      } catch {
        // o item guarda o motivo; a próxima passada tenta de novo
      }
      try {
        if ((await contarPendenciasDaFilaDeEntidades()) > 0) await syncOfflineEntityQueue();
      } catch {
        // idem
      }
      // D-PROD-308: algo do motor esperava uma criação da fila antiga (a leitura de um cocho
      // criado sem internet): com a criação enviada, ele sai nesta mesma sincronização.
      if (segurados > 0) {
        try {
          await sincronizar();
        } catch {
          // idem
        }
      }
      for (const extra of PASSADAS_EXTRAS) {
        try {
          await extra();
        } catch {
          // idem
        }
      }
    }).finally(() => {
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

  // Registro que chegou ao servidor: as telas releem o que o tipo declarou em
  // `atualiza` (o mapa escuta "atualizar-mapa").
  window.addEventListener(EVENTO_FILA_DE_ENVIO, (evento) => {
    const atualizar = /** @type {any} */ (evento)?.detail?.atualizar;
    if (Array.isArray(atualizar) && atualizar.length) {
      window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: atualizar } }));
    }
  });
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
