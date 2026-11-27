/**
 * Service das tarefas georreferenciadas do mapa (P1.2).
 *
 * Bounded context próprio: tarefa tem ciclo de vida, histórico e anexo, e nada
 * disso pertence à geografia nem ao manejo de lote (QLT-P12-02).
 */

import {
  listLancamentos,
  createLancamento,
  updateLancamento,
  deleteLancamento,
  listHistorico,
  createHistorico,
  deleteHistorico,
  listTipos,
  listGrupos,
} from '@/apis/tarefas';
import { listPermissoes, listUsuarios } from '@/apis/session';
import { listIcones as listIconesApi } from '@/apis/mapa';
import { uploadArquivo } from '@/apis/arquivos';
import { reduzirFoto } from '@/lib/imagens/reduzirFoto';

/**
 * @param {any[]} items
 * @param {string} empresaId
 * @returns {any[]}
 */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);
/**
 * @param {any[]} items
 * @returns {any[]}
 */
const ativos = (items) => items.filter((item) => item.ativo !== false);

export const listarTarefasDaEmpresa = async (empresaId, opcoes) =>
  daEmpresa(await listLancamentos(opcoes), empresaId);

/** Ícones da empresa — configuração local, diferente do ícone global do cache. */
/** Ícones são configuração do tenant: `empresa_id` nulo vale para todas as empresas. */
export const listarIconesDaEmpresa = async (empresaId) =>
  ativos((await listIconesApi()).filter((item) => item.empresa_id == null || item.empresa_id === empresaId));
export const listarTiposAtivos = async (empresaId) => ativos(daEmpresa(await listTipos(), empresaId));
export const listarGruposAtivos = async (empresaId) => ativos(daEmpresa(await listGrupos(), empresaId));
export const listarTodosTipos = () => listTipos();
/** Ícones ativos de um tipo de entidade — configuração global. */
export const listarIconesPorTipo = async (tipoEntidade) =>
  (await listIconesApi()).filter((i) => i.ativo !== false && i.tipo_entidade === tipoEntidade);
export const listarTodosGrupos = () => listGrupos();
export const listarPermissoes = () => listPermissoes();
/** @param {unknown} [_opcoes] legado — a lista nativa ignora filtros do provider. */
export const listarUsuarios = (_opcoes) => listUsuarios();

/** D-PROD-324: todas as tarefas do tenant (a cópia do aparelho sem internet), para achar uma pelo id. */
export const listarTodasAsTarefas = async () => {
  const lista = await listLancamentos();
  return Array.isArray(lista) ? lista : [];
};
export const criarTarefa = (dados) => createLancamento(dados);
/**
 * D-PROD-335 — fotos tiradas sem internet que SUBIRAM DEPOIS (a passada as soma no servidor), por tarefa, nesta
 * abertura do app. A tela de edição manda a lista inteira de fotos que ela tinha ao abrir: se uma foto subiu enquanto
 * a tela estava aberta, a lista da tela não a tem e a edição a apagava do servidor.
 * @type {Map<string, Set<string>>}
 */
const fotosQueSubiramDepois = new Map();
/** @param {string} tarefaId @param {string[]} urls */
export const registrarFotosQueSubiram = (tarefaId, urls) => {
  if (!tarefaId || !Array.isArray(urls) || !urls.length) return;
  const atuais = fotosQueSubiramDepois.get(tarefaId) ?? new Set();
  for (const u of urls) atuais.add(u);
  fotosQueSubiramDepois.set(tarefaId, atuais);
};

/**
 * @param {string} id
 * @param {Record<string, any>} dados
 * @param {{ fotosDaTela?: unknown }} [opcoes] `fotosDaTela`: as fotos que a tela tinha ao abrir a edição. A foto que
 *   subiu depois e que a tela não tinha continua na tarefa (a que a tela tinha e a pessoa tirou, sai).
 */
export const atualizarTarefa = (id, dados, opcoes = {}) => {
  const subiram = fotosQueSubiramDepois.get(id);
  if (subiram?.size && Array.isArray(dados?.fotos)) {
    const daTela = new Set(Array.isArray(opcoes.fotosDaTela) ? opcoes.fotosDaTela : []);
    const faltando = [...subiram].filter((u) => !daTela.has(u) && !dados.fotos.includes(u));
    if (faltando.length) return updateLancamento(id, { ...dados, fotos: [...dados.fotos, ...faltando] });
  }
  return updateLancamento(id, dados);
};
export const excluirTarefa = (id) => deleteLancamento(id);

export const listarHistorico = (opcoes) => listHistorico(opcoes);
export const registrarHistorico = (dados) => createHistorico(dados);
export const excluirHistorico = (id) => deleteHistorico(id);

/**
 * Envia um anexo de tarefa.
 *
 * O formato do payload e o retorno são os mesmos de antes — esta slice move a
 * fronteira, não muda o fluxo de upload.
 *
 * @param {{ file: File|Blob }} payload
 * @returns {Promise<{ file_url: string }>}
 */
// D-PROD-327: a foto é reduzida no celular antes de subir (a da câmera passava do limite do servidor e a tarefa
// com foto não salvava). Vale para todo envio de foto de tarefa: na hora, guardada sem internet e a da fila antiga.
export const enviarAnexo = async (payload) =>
  /** @type {Promise<{ file_url: string }>} */ (uploadArquivo({ ...payload, file: await reduzirFoto(payload?.file) }));
