/**
 * D-PROD-324 (Tarefas, parte 3) — fotos de tarefa tiradas SEM internet: ficam guardadas no aparelho e sobem
 * sozinhas quando a internet volta.
 *
 * A tarefa (criação ou edição) vai pela fila de cadastros como sempre, sem as fotos novas. As fotos ficam no
 * IndexedDB (`pending_tarefa_images`, com `tarefa_offline_id = "tarefa:<id da tarefa>"`; o id é o do aparelho, D-PROD-319).
 * A cada passada da sincronização com internet (`registrarPassadaExtra`), para cada tarefa com fotos guardadas:
 *  1. espera a CRIAÇÃO da tarefa chegar ao servidor (ela ainda na fila → fica para a próxima passada);
 *  2. sobe cada foto uma vez (o endereço fica gravado na própria foto antes de seguir);
 *  3. junta os endereços às fotos que a tarefa já tem e grava a tarefa (pela porta de sempre: sem resposta, a
 *     edição entra na fila);
 *  4. só então apaga as fotos guardadas.
 * Uma tarefa que deu errado não impede as outras; o que falhou fica para a próxima passada.
 */

import {
  deleteTarefaImageOffline,
  getAllPendingTarefaImages,
  getTarefaImagesOffline,
  putTarefaImageOffline,
  saveTarefaImageOffline,
} from '@/components/offline/IndexedDBManager';
import { registrarPassadaExtra } from '@/lib/offline/sincronizacao/gatilhosDeSincronizacao';
import { idsComCriacaoPendenteNaFilaDeEntidades } from '@/lib/offline/offlineEntityRuntime';
import { atualizarTarefa, enviarAnexo, listarTodasAsTarefas } from '@/services/tarefasMapaService';

const PREFIXO = 'tarefa:';
const chaveDa = (/** @type {string} */ tarefaId) => `${PREFIXO}${tarefaId}`;

/** Evento que as telas escutam para reler a contagem de fotos guardadas. */
export const EVENTO_FOTOS_DE_TAREFA = 'maike:fotos-de-tarefa';
const avisar = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO_FOTOS_DE_TAREFA));
};

/**
 * Guarda no aparelho as fotos novas de uma tarefa (sem internet).
 * @param {string} tarefaId @param {Array<{ name?: string, type?: string, arrayBuffer: () => Promise<ArrayBuffer> }>} arquivos
 */
export const guardarFotosDaTarefa = async (tarefaId, arquivos) => {
  if (!tarefaId || !Array.isArray(arquivos) || arquivos.length === 0) return 0;
  for (const arquivo of arquivos) await saveTarefaImageOffline(chaveDa(tarefaId), arquivo);
  avisar();
  return arquivos.length;
};

/**
 * As fotos guardadas da tarefa (para mostrar e abrir): `{ chave, nome, tipo, conteudo }`.
 * @param {string} tarefaId
 * @returns {Promise<Array<{ chave: number|string, nome: string, tipo: string, conteudo: ArrayBuffer }>>}
 */
export const listarFotosGuardadasDaTarefa = async (tarefaId) => {
  if (!tarefaId) return [];
  try {
    return (await getTarefaImagesOffline(chaveDa(tarefaId))).map((f) => ({
      chave: f._imgId,
      nome: f.name || 'foto',
      tipo: f.type || 'image/jpeg',
      conteudo: f.buffer,
    }));
  } catch {
    return [];
  }
};

/** Exclui do aparelho uma foto guardada (antes de ela subir). @param {number|string} chave */
export const excluirFotoGuardada = async (chave) => {
  await deleteTarefaImageOffline(chave);
  avisar();
};

/** Quantas fotos da tarefa esperam a internet. @param {string} tarefaId */
export const fotosAguardandoDaTarefa = async (tarefaId) => {
  if (!tarefaId) return 0;
  try {
    return (await getTarefaImagesOffline(chaveDa(tarefaId))).length;
  } catch {
    return 0;
  }
};

/** @param {string} tarefaId @param {any[]} fotos */
const enviarDaTarefa = async (tarefaId, fotos) => {
  /** @type {string[]} */
  const urls = [];
  for (const foto of fotos) {
    if (typeof foto.url_enviada === 'string' && foto.url_enviada) {
      urls.push(foto.url_enviada);
      continue;
    }
    const arquivo = new File([foto.buffer], foto.name || 'foto', { type: foto.type || 'application/octet-stream' });
    const { file_url } = await enviarAnexo({ file: arquivo });
    await putTarefaImageOffline({ ...foto, url_enviada: file_url });
    urls.push(file_url);
  }
  const tarefa = (await listarTodasAsTarefas()).find((t) => t?.id === tarefaId);
  const atuais = Array.isArray(tarefa?.fotos) ? tarefa.fotos : [];
  const fotosFinais = [...new Set([...atuais, ...urls])];
  await atualizarTarefa(tarefaId, {
    fotos: fotosFinais,
    historico_evento: 'Edição',
    historico_descricao: urls.length === 1 ? 'Foto tirada sem internet enviada.' : `${urls.length} fotos tiradas sem internet enviadas.`,
  });
  for (const foto of fotos) await deleteTarefaImageOffline(foto._imgId);
};

/**
 * Sobe as fotos guardadas das tarefas que já estão no servidor.
 * @returns {Promise<{ enviadas: number, esperando: number, falharam: number }>}
 */
export const enviarFotosDeTarefasGuardadas = async () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { enviadas: 0, esperando: 0, falharam: 0 };
  let todas = [];
  try {
    todas = (await getAllPendingTarefaImages()).filter((f) => String(f?.tarefa_offline_id ?? '').startsWith(PREFIXO));
  } catch {
    return { enviadas: 0, esperando: 0, falharam: 0 };
  }
  if (!todas.length) return { enviadas: 0, esperando: 0, falharam: 0 };
  /** @type {Map<string, any[]>} */
  const porTarefa = new Map();
  for (const f of todas) {
    const id = String(f.tarefa_offline_id).slice(PREFIXO.length);
    porTarefa.set(id, [...(porTarefa.get(id) ?? []), f]);
  }
  const criacoesNaFila = await idsComCriacaoPendenteNaFilaDeEntidades().catch(() => new Set());
  let enviadas = 0;
  let esperando = 0;
  let falharam = 0;
  for (const [tarefaId, fotos] of porTarefa) {
    if (criacoesNaFila.has(tarefaId)) {
      esperando += 1;
      continue;
    }
    try {
      await enviarDaTarefa(tarefaId, fotos);
      enviadas += 1;
    } catch {
      falharam += 1;
    }
  }
  if (enviadas > 0) {
    avisar();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  }
  return { enviadas, esperando, falharam };
};

registrarPassadaExtra(enviarFotosDeTarefasGuardadas);
