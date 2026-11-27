/**
 * D-PROD-346 — aviso de registros esperando envio com o app FECHADO (Android, APK 1.0.5 em diante).
 *
 * As filas só o app sabe enviar. O app conta o que ainda não chegou ao servidor (aguardando + precisa de atenção) e
 * passa a quantidade ao plugin nativo `AvisoDeEnvio`. Com o app fechado, o Android o acorda a cada 15 minutos, só com
 * internet, e mostra "N registros esperando envio — toque para enviar"; o toque abre o app, que envia na hora.
 *
 * No APK antigo (sem o plugin), no iPhone e na web, nada acontece: tudo continua como antes. Nunca lança.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isAppNativo } from '@/config/runtimeConfig';
import { eventosDaFilaDeEnvio, lerFilaDeEnvio } from '@/services/sincronizacaoService';

/** @type {any} */
const AvisoDeEnvio = registerPlugin('AvisoDeEnvio');

/** O APK instalado tem o plugin? */
export const avisoDeEnvioDisponivel = () => {
  try {
    return isAppNativo() && Capacitor.isPluginAvailable('AvisoDeEnvio');
  } catch {
    return false;
  }
};

/** Espera entre uma mudança na fila e o aviso ao plugin (várias mudanças seguidas viram uma só). */
const ESPERA_MS = 1500;

let ligado = false;
let ultimaInformada = -1;
let permissaoPedida = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let agendado = null;

/** Quantos registros desta sessão ainda não chegaram ao servidor. */
const contarPendentes = async () => {
  const r = await lerFilaDeEnvio();
  return Number(r?.aguardando ?? 0) + Number(r?.atencao ?? 0);
};

/** Conta e informa o plugin (só quando muda). Na primeira pendência, pede a permissão de avisos (Android 13+). */
export const informarPendentes = async () => {
  if (!avisoDeEnvioDisponivel()) return;
  try {
    const quantidade = await contarPendentes();
    if (quantidade === ultimaInformada) return;
    await AvisoDeEnvio.definirPendentes({ quantidade });
    ultimaInformada = quantidade;
    if (quantidade > 0 && !permissaoPedida) {
      permissaoPedida = true;
      await AvisoDeEnvio.pedirPermissao().catch(() => undefined);
    }
  } catch {
    // Sem o aviso, o envio continua como antes.
  }
};

const agendar = () => {
  if (agendado) clearTimeout(agendado);
  agendado = setTimeout(() => {
    agendado = null;
    void informarPendentes();
  }, ESPERA_MS);
};

/** Liga uma vez por carga do app. */
export const ligarAvisoDeEnvio = () => {
  if (ligado || typeof window === 'undefined' || !avisoDeEnvioDisponivel()) return;
  ligado = true;
  for (const evento of eventosDaFilaDeEnvio()) window.addEventListener(evento, agendar);
  agendar();
};

/** Só para testes. */
export const resetAvisoDeEnvio = () => {
  ligado = false;
  ultimaInformada = -1;
  permissaoPedida = false;
  if (agendado) clearTimeout(agendado);
  agendado = null;
};
