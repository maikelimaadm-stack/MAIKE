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
import { classificarFalhaDeEnvio } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { eIdDoAparelho, novoIdDoAparelho } from '@/lib/offline/idDoAparelho';
import { atualizarTarefa, criarTarefa, enviarAnexo } from '@/services/tarefasMapaService';

/** Campos de controle do armazenamento antigo (não vão ao servidor). */
const CONTROLE = ['_offlineId', '_action', '_offlineTimestamp', '_id_do_aparelho', '_fotos_enviadas', '_tentativas', '_ultimo_erro'];

/** D-PROD-328: depois de tantas falhas com resposta do servidor, para de tentar sozinha e pede a pessoa. */
export const TENTATIVAS_DA_TAREFA_GUARDADA = 3;

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
    // D-PROD-328: a que já falhou várias vezes espera a pessoa ("Tentar de novo" na fila única).
    if (Number(item._tentativas ?? 0) >= TENTATIVAS_DA_TAREFA_GUARDADA) {
      ficaram += 1;
      continue;
    }
    try {
      await enviarUma(item);
      enviadas += 1;
    } catch (erro) {
      ficaram += 1;
      const falha = classificarFalhaDeEnvio(erro);
      if (falha !== 'rede' && falha !== 'sessao') {
        // Relê: as fotos podem ter subido nesta tentativa (`_fotos_enviadas`).
        const atual = (await getPendingTarefas().catch(() => [])).find((t) => t._offlineId === item._offlineId) ?? item;
        await putPendingTarefa({
          ...atual,
          _tentativas: Number(atual._tentativas ?? 0) + 1,
          _ultimo_erro: { mensagem: String(/** @type {any} */ (erro)?.message || 'Não foi possível enviar.').slice(0, 300), em: new Date().toISOString() },
        }).catch(() => undefined);
      }
    }
  }
  if (enviadas > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  }
  return { enviadas, ficaram };
};

/**
 * D-PROD-328 — as tarefas do armazenamento antigo, para a fila única da janela "Sincronização".
 * @returns {Promise<Array<{ chave: string|number, titulo: string, operacao: 'create'|'update', criado_em: string|null,
 *   situacao: 'aguardando'|'atencao', tentativas: number, motivo: string|null, ultimaTentativaEm: string|null,
 *   fotos: number, dados: Record<string, unknown> }>>}
 */
export const listarTarefasGuardadasNoAparelho = async () => {
  let itens = [];
  try {
    itens = await getPendingTarefas();
  } catch {
    return [];
  }
  const lista = [];
  for (const item of itens) {
    const tentativas = Number(item._tentativas ?? 0);
    const fotos = Array.isArray(item._fotos_enviadas) ? item._fotos_enviadas.length : (await getTarefaImagesOffline(item._offlineId).catch(() => [])).length;
    lista.push({
      chave: item._offlineId,
      titulo: String(item.titulo || 'Tarefa'),
      operacao: /** @type {'create'|'update'} */ (item._action === 'update' ? 'update' : 'create'),
      criado_em: item._offlineTimestamp ?? null,
      situacao: /** @type {'aguardando'|'atencao'} */ (tentativas >= TENTATIVAS_DA_TAREFA_GUARDADA || (item._action === 'update' && !item.id) ? 'atencao' : 'aguardando'),
      tentativas,
      motivo: item._action === 'update' && !item.id ? 'Não dá para saber qual tarefa esta alteração muda.' : (item._ultimo_erro?.mensagem ?? null),
      ultimaTentativaEm: item._ultimo_erro?.em ?? null,
      fotos,
      dados: semControle(item),
    });
  }
  return lista;
};

/** D-PROD-328 — "Tentar de novo": zera as falhas e envia já. @param {string|number} chave */
export const tentarDeNovoTarefaGuardada = async (chave) => {
  const item = (await getPendingTarefas().catch(() => [])).find((t) => t._offlineId === chave);
  if (!item) return false;
  await putPendingTarefa({ ...item, _tentativas: 0 });
  await enviarTarefasGuardadasNoAparelho();
  return true;
};

/** D-PROD-328 — "Excluir": a tarefa (e as fotos dela) saem do aparelho sem ir ao sistema. @param {string|number} chave */
export const excluirTarefaGuardadaNoAparelho = async (chave) => {
  for (const img of await getTarefaImagesOffline(chave).catch(() => [])) await deleteTarefaImageOffline(img._imgId);
  await deletePendingTarefa(chave);
  return true;
};

registrarPassadaExtra(enviarTarefasGuardadasNoAparelho);
