/**
 * D-PROD-205 — Leitura de cocho: o que a UI do mapa usa (a UI importa service,
 * nunca a API do módulo).
 *
 * D-PROD-296: a criação vai pelo motor de sincronização. Com internet, direto
 * ao servidor; sem internet, fica guardada no aparelho e aparece no cocho como
 * "aguardando envio" até chegar ao servidor. Excluir uma leitura que ainda não
 * subiu só a tira do aparelho (nada vai ao servidor).
 */
import { deleteLeituraCocho } from '@/apis/leituras-cocho';
import { TIPO_LEITURA_COCHO } from '@/lib/offline/sincronizacao/tiposDeEnvio';
import {
  enviarOuGuardar,
  registrosAguardandoDoTipo,
  situacaoNaFila,
  descartarDaFila,
} from '@/lib/offline/sincronizacao/motorDeSincronizacao';

const PREFIXO_AGUARDANDO = 'aguardando:';

/**
 * Como a leitura que ainda não subiu aparece nas telas (mesmo formato da
 * leitura do servidor, com a marca de "aguardando envio").
 * @param {Record<string, any>} corpo
 * @param {string} operationId
 */
export const leituraAguardandoComoRegistro = (corpo, operationId) => ({
  ...corpo,
  id: `${PREFIXO_AGUARDANDO}${operationId}`,
  registrado_por_nome: null,
  _aguardandoEnvio: true,
  _operationId: operationId,
});

/**
 * Registra a leitura. Devolve a leitura (do servidor ou a que espera envio).
 * @param {Record<string, any>} corpo
 * @param {{rotulo?: string}} [opcoes]
 * @returns {Promise<{leitura: Record<string, any>, aguardandoEnvio: boolean}>}
 */
export const registrarLeituraCocho = async (corpo, opcoes = {}) => {
  const r = await enviarOuGuardar(TIPO_LEITURA_COCHO, corpo, { empresaId: corpo?.empresa_id ?? null, rotulo: opcoes.rotulo });
  if (r.estado === 'enviado') return { leitura: /** @type {any} */ (r.resultado), aguardandoEnvio: false };
  return { leitura: leituraAguardandoComoRegistro(corpo, r.operationId), aguardandoEnvio: true };
};

/**
 * Leituras desta fazenda que ainda não chegaram ao servidor.
 * @param {string|null} empresaId
 */
export const leiturasAguardandoEnvio = async (empresaId) => {
  try {
    return (await registrosAguardandoDoTipo(TIPO_LEITURA_COCHO))
      .filter((r) => /** @type {any} */ (r.payload)?.empresa_id === empresaId)
      .map((r) => leituraAguardandoComoRegistro(/** @type {any} */ (r.payload), r.operationId));
  } catch {
    // Falha ao ler a fila nunca derruba a lista do servidor.
    return [];
  }
};

/**
 * Exclui a leitura. A que ainda não subiu sai só do aparelho; a que está
 * subindo ("confirmando envio") espera a resposta do servidor.
 * @param {{id: string, _aguardandoEnvio?: boolean, _operationId?: string}} leitura
 */
export const excluirLeituraCocho = async (leitura) => {
  if (!leitura?._aguardandoEnvio) {
    await deleteLeituraCocho(leitura.id);
    return;
  }
  const opId = String(leitura._operationId ?? '');
  const situacao = await situacaoNaFila(opId);
  if (situacao === 'confirmando') {
    throw new Error('Esta leitura está sendo enviada agora. Espere confirmar para excluir.');
  }
  if (situacao === 'enviado') {
    throw new Error('Esta leitura já chegou ao sistema. Atualize a tela e exclua de novo.');
  }
  if (situacao) await descartarDaFila(opId);
};
