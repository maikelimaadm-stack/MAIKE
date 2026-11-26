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
import { classificarFalhaDeEnvio } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
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

/**
 * D-PROD-330 — sobe as fotos novas na hora ou, sem rede, separa as que ficam guardadas no aparelho.
 *
 * O celular às vezes "acha" que tem internet (sinal fraco, Wi-Fi sem dados): `navigator.onLine` diz que sim e o
 * envio falha sem resposta. Antes a tarefa inteira dava erro; agora a foto que não subiu por falta de rede (e as que
 * vinham depois dela) fica guardada e sobe sozinha depois — a tarefa salva do mesmo jeito. Recusa do servidor (com
 * resposta) continua sendo erro.
 *
 * @param {Array<File|Blob>} arquivos
 * @returns {Promise<{ urls: string[], paraGuardar: Array<File|Blob> }>}
 */
export const enviarOuSepararFotos = async (arquivos) => {
  const lista = Array.isArray(arquivos) ? arquivos : [];
  if (!lista.length) return { urls: [], paraGuardar: [] };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { urls: [], paraGuardar: lista };
  /** @type {string[]} */
  const urls = [];
  for (let i = 0; i < lista.length; i += 1) {
    try {
      const { file_url } = await enviarAnexo({ file: lista[i] });
      urls.push(file_url);
    } catch (erro) {
      if (classificarFalhaDeEnvio(erro) === 'rede') return { urls, paraGuardar: lista.slice(i) };
      throw erro;
    }
  }
  return { urls, paraGuardar: [] };
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

/** D-PROD-328: depois de tantas falhas seguidas, a foto para de tentar sozinha e pede a pessoa (fila única). */
export const TENTATIVAS_DA_FOTO = 3;

/** @param {any} erro */
const mensagemDoErro = (erro) => String(erro?.message || erro || 'Não foi possível enviar a foto.').slice(0, 300);

/**
 * D-PROD-328: guarda o erro nas fotos da tarefa (contando a tentativa). Relê do aparelho: uma foto pode ter subido
 * nesta mesma tentativa (`url_enviada`) e não pode perder isso. @param {string} tarefaId @param {any} erro
 */
const registrarFalha = async (tarefaId, erro) => {
  const em = new Date().toISOString();
  for (const foto of await getTarefaImagesOffline(chaveDa(tarefaId)).catch(() => [])) {
    await putTarefaImageOffline({ ...foto, tentativas: Number(foto.tentativas ?? 0) + 1, ultimo_erro: { mensagem: mensagemDoErro(erro), em } }).catch(() => undefined);
  }
  avisar();
};

/**
 * D-PROD-328 — as fotos de tarefa guardadas no aparelho, para a fila única da janela "Sincronização".
 * `situacao`: "esperando a tarefa" (a criação dela ainda está na fila), "aguardando" ou "atencao" (falhou
 * `TENTATIVAS_DA_FOTO` vezes: só volta com "Tentar de novo").
 * @returns {Promise<Array<{ chave: number|string, tarefaId: string, nome: string, tamanho: number, criado_em: string|null,
 *   situacao: 'esperando'|'aguardando'|'atencao', tentativas: number, motivo: string|null, ultimaTentativaEm: string|null }>>}
 */
export const listarFotosAguardandoEnvio = async () => {
  let todas = [];
  try {
    todas = (await getAllPendingTarefaImages()).filter((f) => String(f?.tarefa_offline_id ?? '').startsWith(PREFIXO));
  } catch {
    return [];
  }
  const criacoesNaFila = await idsComCriacaoPendenteNaFilaDeEntidades().catch(() => new Set());
  return todas.map((f) => {
    const tarefaId = String(f.tarefa_offline_id).slice(PREFIXO.length);
    const tentativas = Number(f.tentativas ?? 0);
    return {
      chave: f._imgId,
      tarefaId,
      nome: f.name || 'foto',
      tamanho: Number(f.buffer?.byteLength ?? 0),
      criado_em: f._offlineTimestamp ?? null,
      situacao: tentativas >= TENTATIVAS_DA_FOTO ? 'atencao' : criacoesNaFila.has(tarefaId) ? 'esperando' : 'aguardando',
      tentativas,
      motivo: f.ultimo_erro?.mensagem ?? null,
      ultimaTentativaEm: f.ultimo_erro?.em ?? null,
    };
  });
};

/** D-PROD-328 — "Tentar de novo" nas fotos de uma tarefa: zera as falhas e envia já. @param {string} tarefaId */
export const tentarDeNovoFotosDaTarefa = async (tarefaId) => {
  for (const f of await getTarefaImagesOffline(chaveDa(tarefaId)).catch(() => [])) {
    await putTarefaImageOffline({ ...f, tentativas: 0 });
  }
  avisar();
  return enviarFotosDeTarefasGuardadas();
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
    // D-PROD-328: a que já falhou várias vezes espera a pessoa ("Tentar de novo" na fila única).
    if (fotos.some((f) => Number(f.tentativas ?? 0) >= TENTATIVAS_DA_FOTO)) {
      falharam += 1;
      continue;
    }
    try {
      await enviarDaTarefa(tarefaId, fotos);
      enviadas += 1;
    } catch (erro) {
      falharam += 1;
      // Sem internet (ou sessão vencida) não conta: só a falha com resposta do servidor conta tentativa.
      const falha = classificarFalhaDeEnvio(erro);
      if (falha !== 'rede' && falha !== 'sessao') await registrarFalha(tarefaId, erro);
    }
  }
  if (enviadas > 0) {
    avisar();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  }
  return { enviadas, esperando, falharam };
};

registrarPassadaExtra(enviarFotosDeTarefasGuardadas);
