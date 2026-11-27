/**
 * D-PROD-350 — sair da conta com registros feitos sem internet que ainda não chegaram ao sistema.
 *
 * Como o AgriWebb faz antes de tirar uma fazenda do celular: confere a fila NA HORA (não o número que a tela tinha);
 * com internet, tenta enviar antes de perguntar; só então avisa quantos ficaram. Os que ficam continuam guardados no
 * celular e sobem quando qualquer pessoa da mesma conta entrar com internet (o dono da fila é a conta, não a pessoa).
 */
import { enviarAgora, lerFilaDeEnvio } from '@/services/sincronizacaoService';

/** Quanto esperar o envio antes de perguntar (o sinal pode estar fraco). */
export const ESPERA_DO_ENVIO_AO_SAIR_MS = 20_000;

const contar = async () => {
  try {
    const r = await lerFilaDeEnvio();
    return Number(r?.aguardando ?? 0) + Number(r?.atencao ?? 0);
  } catch {
    return 0;
  }
};

const semInternet = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Quantos registros ficariam no celular se a pessoa saísse agora (depois de tentar enviar, com internet).
 * @param {{ esperaMs?: number }} [opcoes]
 * @returns {Promise<number>}
 */
export const pendentesAoSair = async ({ esperaMs = ESPERA_DO_ENVIO_AO_SAIR_MS } = {}) => {
  const antes = await contar();
  if (antes === 0 || semInternet()) return antes;
  await Promise.race([enviarAgora().catch(() => undefined), new Promise((r) => setTimeout(r, esperaMs))]);
  return contar();
};

/** O aviso de quando ainda há registros. @param {number} n */
export const avisoDeSairComPendencias = (n) =>
  `${n === 1 ? '1 registro feito neste celular ainda não chegou' : `${n} registros feitos neste celular ainda não chegaram`} ao sistema. ` +
  `Ele${n === 1 ? ' fica guardado' : 's ficam guardados'} aqui e ${n === 1 ? 'sobe' : 'sobem'} quando alguém desta fazenda entrar com internet. ` +
  'Se puder, conecte-se à internet e espere enviar antes de sair.';
