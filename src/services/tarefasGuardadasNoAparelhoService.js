/**
 * D-PROD-319 (Etapa 5a) — as tarefas do mapa que ficaram presas no armazenamento antigo do aparelho.
 *
 * Até aqui, a tarefa criada ou editada no mapa SEM internet ia para um armazenamento próprio
 * (`pending_tarefas`, com as fotos em `pending_tarefa_images`) que nada mais enviava ao servidor: o envio
 * saiu na redução do escopo e a tela continuava dizendo "sincronizará ao conectar". Agora a tela usa a fila
 * de cadastros, como os outros registros; este serviço manda ao servidor o que já estava guardado.
 *
 * A cada passada da sincronização com internet, para cada tarefa guardada:
 *  1. ganha um id do aparelho (gravado antes de enviar): repetir nunca cria outra tarefa;
 *  2. as fotos sobem uma vez (os endereços ficam gravados antes de continuar);
 *  3. a criação (ou a edição) vai pela porta de sempre — sem resposta, ela entra na fila com o mesmo id;
 *  4. só então sai do armazenamento antigo.
 * O servidor decide a conta (o tenant vem da sessão): tarefa de uma fazenda que não é desta conta é recusada e
 * fica guardada.
 */

import {
  deletePendingTarefa,
  deleteTarefaImageOffline,
  getPendingTarefas,
  getTarefaImagesOffline,
  putPendingTarefa,
} from '@/components/offline/IndexedDBManager';
import { registrarPassadaExtra } from '@/lib/offline/sincronizacao/gatilhosDeSincronizacao';
import { eIdDoAparelho, novoIdDoAparelho } from '@/lib/offline/idDoAparelho';
import { atualizarTarefa, criarTarefa, enviarAnexo } from '@/services/tarefasMapaService';

/** Campos de controle do armazenamento antigo (não vão ao servidor). */
const CONTROLE = ['_offlineId', '_action', '_offlineTimestamp', '_id_do_aparelho', '_fotos_enviadas'];

/** @param {Record<string, any>} item */
const semControle = (item) => Object.fromEntries(Object.entries(item).filter(([k]) => !CONTROLE.includes(k)));

/** @param {Record<string, any>} item @returns {Promise<string[]>} os endereços das fotos (enviadas agora ou antes) */
const enviarFotos = async (item) => {
  if (Array.isArray(item._fotos_enviadas)) return item._fotos_enviadas;
  const imagens = await getTarefaImagesOffline(item._offlineId);
  const urls = [];
  for (const img of imagens) {
    const arquivo = new File([img.buffer], img.name || 'foto', { type: img.type || 'application/octet-stream' });
    const { file_url } = await enviarAnexo({ file: arquivo });
    urls.push(file_url);
  }
  await putPendingTarefa({ ...item, _fotos_enviadas: urls });
  return urls;
};

/** @param {Record<string, any>} item */
const enviarUma = async (item) => {
  let atual = item;
  if (atual._action !== 'update' && !eIdDoAparelho(atual._id_do_aparelho)) {
    atual = { ...atual, _id_do_aparelho: novoIdDoAparelho() };
    await putPendingTarefa(atual);
  }
  const urls = await enviarFotos(atual);
  const dados = semControle(atual);
  const corpo = urls.length ? { ...dados, fotos: [...(Array.isArray(dados.fotos) ? dados.fotos : []), ...urls] } : dados;
  if (atual._action === 'update') {
    if (!corpo.id) return; // sem o registro a editar: nada a enviar (fica guardada)
    const { id, ...resto } = corpo;
    await atualizarTarefa(id, { ...resto, historico_evento: 'Edição', historico_descricao: 'Tarefa atualizada pelo mapa (sem internet).' });
  } else {
    await criarTarefa({
      ...corpo,
      id: atual._id_do_aparelho,
      historico_evento: 'Criação',
      historico_descricao: 'Tarefa criada pelo mapa (sem internet).',
      historico_data_evento: atual._offlineTimestamp || new Date().toISOString(),
    });
  }
  for (const img of await getTarefaImagesOffline(atual._offlineId)) await deleteTarefaImageOffline(img._imgId);
  await deletePendingTarefa(atual._offlineId);
};

/**
 * Envia as tarefas guardadas no armazenamento antigo. Uma recusada não impede as outras.
 * @returns {Promise<{ enviadas: number, ficaram: number }>}
 */
export const enviarTarefasGuardadasNoAparelho = async () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { enviadas: 0, ficaram: 0 };
  let itens = [];
  try {
    itens = await getPendingTarefas();
  } catch {
    return { enviadas: 0, ficaram: 0 };
  }
  let enviadas = 0;
  let ficaram = 0;
  for (const item of [...itens].sort((a, b) => String(a._offlineTimestamp ?? '').localeCompare(String(b._offlineTimestamp ?? '')))) {
    try {
      await enviarUma(item);
      enviadas += 1;
    } catch {
      ficaram += 1;
    }
  }
  if (enviadas > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  }
  return { enviadas, ficaram };
};

registrarPassadaExtra(enviarTarefasGuardadasNoAparelho);
