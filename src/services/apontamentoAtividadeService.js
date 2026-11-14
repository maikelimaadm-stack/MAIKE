/**
 * Service de Apontamentos de Atividade (D-PROD-190, Fatia C).
 *
 * A TAREFA (`LancamentoTarefa`) é a demanda; o APONTAMENTO é a EXECUÇÃO de um
 * Tipo de Atividade (D-PROD-182): a operação feita, com máquina, implemento,
 * operador, área, horário e produção, e os itens de custo (D-PROD-193).
 *
 * Da EMPRESA real: sem empresa nada é lido nem gravado. Edição por PATCH
 * MÍNIMO com a `versao` lida (CAS no servidor); sem DELETE físico — cancelar
 * exige motivo e também leva a `versao`. Os seletores vêm das rotas PRÓPRIAS
 * da tela; tipos (só os ativos são oferecidos) e áreas reaproveitam as leituras
 * já abertas a quem está autenticado.
 *
 * Itens (D-PROD-193, Fatia D): adicionar item, cancelar item e cancelar o
 * apontamento (que estorna os itens de Produto) levam um `operation_id`
 * guardado por (escopo, ação, empresa, alvo) até a resposta DEFINITIVA, pelo
 * MESMO mecanismo da Central e do abastecimento (`enviarComPendencia`), com
 * escopo próprio `apontamento:<cliente>:<login>`. Sem resposta (rede, prazo,
 * 5xx) = resultado incerto: repetir reaproveita a chave e o servidor devolve o
 * gravado (replay), nunca baixa nem estorna o estoque duas vezes.
 */

import {
  listApontamentosAtividadePage,
  getApontamentoAtividade,
  createApontamentoAtividade,
  updateApontamentoAtividade,
  cancelarApontamentoAtividade,
  adicionarItemApontamentoAtividade,
  cancelarItemApontamentoAtividade,
  listOpcoesApontamentoAtividade,
} from '@/apis/atividades';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { confirmar } from '@/lib/maikeConfirmar';
import { MOTIVO_MINIMO, camposAlteradosDoApontamento } from '@/lib/apontamentoAtividadeRegras';
import { enviarComPendencia, lerPendenciaLancamento, limparPendenciaLancamento } from './operacaoFinanceiraService.js';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';
import { listarAreasAtivas } from './mapaService.js';

export { listarTiposAtividade } from './tipoAtividadeCadastroService.js';

const RESOURCE = 'ApontamentoAtividade';

/** Página padrão da lista. */
export const POR_PAGINA_APONTAMENTOS = 100;

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// ─── Leitura ─────────────────────────────────────────────────────────────

/**
 * Uma página (keyset) dos apontamentos da empresa. Sem empresa: página vazia, nada é lido.
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, dataDe?: string|null, dataAte?: string|null,
 *   bemId?: string|null, tipoAtividadeId?: string|null, areaId?: string|null, status?: string|null }} [opts]
 */
export const listarApontamentosPagina = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_APONTAMENTOS;
  if (!empresaId) return paginaVazia(limit);
  return listApontamentosAtividadePage({
    empresa_id: empresaId,
    data_de: textoOuIndefinido(opts.dataDe),
    data_ate: textoOuIndefinido(opts.dataAte),
    bem_id: textoOuIndefinido(opts.bemId),
    tipo_atividade_id: textoOuIndefinido(opts.tipoAtividadeId),
    area_id: textoOuIndefinido(opts.areaId),
    status: textoOuIndefinido(opts.status),
    q: textoOuIndefinido(opts.q),
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/** @param {string|null} empresaId @param {string} id */
export const detalharApontamento = async (empresaId, id) =>
  getApontamentoAtividade(id, exigirEmpresa(empresaId, 'detalharApontamento', RESOURCE));

/**
 * Opções de um seletor da tela (bens, operadores, centros de custo e de
 * resultado ATIVOS; D-PROD-193: Produtos ATIVOS da fazenda, para o item). Sem
 * empresa: vazio, nada é lido.
 * @param {'bens'|'operadores'|'centros-custo'|'centros-resultado'|'produtos'} recurso
 * @param {string|null} empresaId
 * @param {{ q?: string, cursor?: string|null, limit?: number, natureza?: readonly string[] }} [opts]
 */
export const listarOpcoesApontamento = async (recurso, empresaId, opts = {}) => {
  if (!empresaId) return { itens: [], has_more: false, next_cursor: null };
  return listOpcoesApontamentoAtividade(recurso, {
    empresa_id: empresaId,
    q: textoOuIndefinido(opts.q),
    cursor: textoOuIndefinido(opts.cursor),
    limit: opts.limit,
    ...(recurso === 'bens' && Array.isArray(opts.natureza) && opts.natureza.length ? { natureza: [...opts.natureza] } : {}),
  });
};

/** Áreas ATIVAS da empresa (o seletor; a área gravada que ficou inativa vem do próprio registro). @param {string|null} empresaId */
export const listarAreasDoApontamento = async (empresaId) => (empresaId ? listarAreasAtivas(empresaId) : []);

// ─── Gravação ────────────────────────────────────────────────────────────

/**
 * POST: o corpo do formulário (`corpoDoFormulario`) na empresa real.
 * @param {string|null} empresaId @param {Record<string, unknown>} dados
 */
export const criarApontamento = async (empresaId, dados) =>
  createApontamentoAtividade({ ...dados, empresa_id: exigirEmpresa(empresaId, 'criarApontamento', RESOURCE) });

/**
 * PATCH mínimo: só o que mudou, com a `versao` lida. Nada mudou → nenhuma
 * requisição (`alterado: false`).
 * @param {string|null} empresaId @param {any} original @param {Record<string, any>} dados
 * @returns {Promise<{ alterado: boolean, registro: any }>}
 */
export const atualizarApontamento = async (empresaId, original, dados) => {
  const emp = exigirEmpresa(empresaId, 'atualizarApontamento', RESOURCE);
  const mudancas = camposAlteradosDoApontamento(original, dados);
  if (!Object.keys(mudancas).length) return { alterado: false, registro: original };
  const registro = await updateApontamentoAtividade(String(original.id), { ...mudancas, empresa_id: emp, versao: original.versao });
  return { alterado: true, registro };
};

// ─── Pendência de `operation_id` (D-PROD-193) ───────────────────────────

/** Ações com pendência de `operation_id`. Adicionar item é REPETÍVEL (dois itens iguais são legítimos). */
export const ACAO_ADICIONAR_ITEM = 'criar';
export const ACAO_CANCELAR = 'cancelar';
/** Alvo da pendência: os itens de UM apontamento, UM item, ou o próprio apontamento (o id). */
export const alvoDosItens = (/** @type {string} */ apontamentoId) => `itens:${apontamentoId}`;
export const alvoDoItem = (/** @type {string} */ itemId) => `item:${itemId}`;

/** Escopo da pendência: separado da Central e do abastecimento (`<cliente>:<login>` → `apontamento:<cliente>:<login>`). @param {string} escopo */
const escopoDaPendencia = (escopo) => `apontamento:${escopo || 'sem-tenant:sem-login'}`;

/**
 * Onde a chave pendente mora: no storage do navegador e, quando ele não grava
 * (cota cheia, bloqueado, ausente), em memória nesta página — a mesma salvaguarda
 * do abastecimento: "Repetir o mesmo envio" usa a MESMA chave e o estoque não é
 * baixado nem estornado duas vezes.
 * @type {Map<string, string>}
 */
const pendenciasEmMemoria = new Map();
const storageDoNavegador = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};
const armazenamentoDaPendencia = /** @type {Storage} */ (
  /** @type {unknown} */ ({
    /** @param {string} k */
    getItem: (k) => {
      if (pendenciasEmMemoria.has(k)) return pendenciasEmMemoria.get(k) ?? null;
      try {
        return storageDoNavegador()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    /** @param {string} k @param {string} v */
    setItem: (k, v) => {
      try {
        const st = storageDoNavegador();
        if (!st) throw new Error('sem storage');
        st.setItem(k, v);
        pendenciasEmMemoria.delete(k);
      } catch {
        pendenciasEmMemoria.set(k, v);
      }
    },
    /** @param {string} k */
    removeItem: (k) => {
      pendenciasEmMemoria.delete(k);
      try {
        storageDoNavegador()?.removeItem(k);
      } catch {
        /* sem storage: só a memória tinha a chave */
      }
    },
  })
);
/** @param {Storage|null|undefined} storage */
const storageDaPendencia = (storage) => (storage === undefined ? armazenamentoDaPendencia : storage);

const MENSAGEM_DESCARTE =
  'Há um envio anterior desta ação no apontamento sem resposta do servidor — ele pode ter sido gravado. Consulte o apontamento antes.\n\n' +
  'Descartar e enviar: abandona o envio anterior e envia este conteúdo.\nManter: nada é enviado agora; repita aquele envio para concluí-lo sem duplicar.';

const MENSAGEM_NOVO_ENVIO =
  'Há um item IGUAL a este sem resposta do servidor — ele pode ter sido gravado. Consulte os itens do apontamento antes.\n\n' +
  'Enviar como novo: grava OUTRO item (para Produto, outra baixa de estoque).\n' +
  'Manter: nada é enviado agora; repita aquele envio ("Repetir o mesmo envio") para concluí-lo sem duplicar.';

/** Perguntas com textos do APONTAMENTO (ignoram a mensagem genérica da Central). */
const perguntarDescarte = () =>
  confirmar({ titulo: 'Envio anterior sem resposta', descricao: MENSAGEM_DESCARTE, textoConfirmar: 'Descartar e enviar', textoCancelar: 'Manter', perigo: true });
const perguntarNovoEnvio = () =>
  confirmar({ titulo: 'Item igual sem resposta', descricao: MENSAGEM_NOVO_ENVIO, textoConfirmar: 'Enviar como novo', textoCancelar: 'Manter', perigo: true });

/**
 * @typedef {{ escopo: string, storage?: Storage|null, retentativa?: boolean,
 *   confirmarDescarte?: (m: string) => boolean | Promise<boolean>,
 *   confirmarNovoEnvio?: (m: string) => boolean | Promise<boolean> }} OpcoesDeEnvio
 */

/** Motivo de 3 a 500 caracteres; curto falha ANTES da rede. @param {unknown} motivo @param {string} operation */
const motivoValido = (motivo, operation) => {
  const limpo = typeof motivo === 'string' ? motivo.trim() : '';
  if ([...limpo].length < MOTIVO_MINIMO) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, { operation, resource: RESOURCE, details: { field: 'motivo', reason: 'min_length' } });
  }
  return limpo;
};

/**
 * Cancelamento (sem DELETE): motivo de pelo menos 3 caracteres, a `versao`
 * lida e (D-PROD-193, D-2) o `operation_id` persistente — o cancelamento
 * estorna os itens de Produto aos lotes de origem e cancela os demais. Motivo
 * curto falha ANTES da rede.
 * @param {string|null} empresaId @param {{ id: string, versao: number }} registro @param {string} motivo
 * @param {OpcoesDeEnvio} [c]
 */
export const cancelarApontamento = async (empresaId, registro, motivo, c = { escopo: '' }) => {
  const emp = exigirEmpresa(empresaId, 'cancelarApontamento', RESOURCE);
  const limpo = motivoValido(motivo, 'cancelarApontamento');
  const id = String(registro.id);
  const corpo = { empresa_id: emp, versao: registro.versao, motivo: limpo };
  return enviarComPendencia({
    escopo: escopoDaPendencia(c.escopo),
    acao: ACAO_CANCELAR,
    empresaId: emp,
    alvo: id,
    conteudo: corpo,
    enviar: (operationId) => cancelarApontamentoAtividade(id, { ...corpo, operation_id: operationId }),
    storage: storageDaPendencia(c.storage),
    retentativa: c.retentativa,
    confirmarDescarte: c.confirmarDescarte ?? perguntarDescarte,
    confirmarNovoEnvio: c.confirmarNovoEnvio ?? perguntarNovoEnvio,
  });
};

// ─── Itens (D-PROD-193) ─────────────────────────────────────────────────

/**
 * Locais com saldo do Produto NESTA fazenda (`{itens:[{local_estoque_id,
 * local_nome, disponivel, unidade, unidade_principal_estoque}]}`). Sem empresa
 * ou sem Produto: vazio, nada é lido.
 * @param {string|null} empresaId @param {string|null} produtoId
 */
export const listarLocaisDoProduto = async (empresaId, produtoId) => {
  if (!empresaId || !produtoId) return { itens: [], has_more: false, next_cursor: null };
  return listOpcoesApontamentoAtividade('locais', { empresa_id: empresaId, produto_id: produtoId });
};

/**
 * Adiciona UM item (o corpo de `corpoDoItem`) ao apontamento CONFIRMADO, com a
 * `versao` lida e o `operation_id` persistente. A resposta é o DETALHE do
 * apontamento (itens, `custo_itens`, `item_id`, `replay`).
 * @param {string|null} empresaId @param {{ id: string, versao: number }} registro
 * @param {Record<string, string>} corpoItem @param {OpcoesDeEnvio} c
 */
export const adicionarItemApontamento = async (empresaId, registro, corpoItem, c) => {
  const emp = exigirEmpresa(empresaId, 'adicionarItemApontamento', RESOURCE);
  const id = String(registro.id);
  const corpo = { ...corpoItem, empresa_id: emp, versao: registro.versao };
  return enviarComPendencia({
    escopo: escopoDaPendencia(c.escopo),
    acao: ACAO_ADICIONAR_ITEM,
    empresaId: emp,
    alvo: alvoDosItens(id),
    conteudo: corpo,
    enviar: (operationId) => adicionarItemApontamentoAtividade(id, { ...corpo, operation_id: operationId }),
    storage: storageDaPendencia(c.storage),
    retentativa: c.retentativa,
    confirmarDescarte: c.confirmarDescarte ?? perguntarDescarte,
    confirmarNovoEnvio: c.confirmarNovoEnvio ?? perguntarNovoEnvio,
  });
};

/**
 * Cancela UM item (o de Produto volta exatamente aos lotes de origem): motivo
 * de 3 a 500 caracteres, a `versao` do apontamento e o `operation_id`
 * persistente. A resposta é o DETALHE do apontamento.
 * @param {string|null} empresaId @param {{ id: string, versao: number }} registro @param {{ id: string }} item
 * @param {string} motivo @param {OpcoesDeEnvio} c
 */
export const cancelarItemApontamento = async (empresaId, registro, item, motivo, c) => {
  const emp = exigirEmpresa(empresaId, 'cancelarItemApontamento', RESOURCE);
  const limpo = motivoValido(motivo, 'cancelarItemApontamento');
  const id = String(registro.id);
  const itemId = String(item.id);
  const corpo = { empresa_id: emp, versao: registro.versao, motivo: limpo };
  return enviarComPendencia({
    escopo: escopoDaPendencia(c.escopo),
    acao: ACAO_CANCELAR,
    empresaId: emp,
    alvo: alvoDoItem(itemId),
    conteudo: corpo,
    enviar: (operationId) => cancelarItemApontamentoAtividade(id, itemId, { ...corpo, operation_id: operationId }),
    storage: storageDaPendencia(c.storage),
    retentativa: c.retentativa,
    confirmarDescarte: c.confirmarDescarte ?? perguntarDescarte,
    confirmarNovoEnvio: c.confirmarNovoEnvio ?? perguntarNovoEnvio,
  });
};

/**
 * Pendência (envio sem resposta) desta ação: `{operation_id, conteudo}` ou null.
 * @param {string} escopo @param {string} acao @param {string} empresaId @param {string} alvo @param {Storage|null} [storage]
 */
export const pendenciaDoApontamento = (escopo, acao, empresaId, alvo, storage) =>
  lerPendenciaLancamento(escopoDaPendencia(escopo), acao, empresaId, alvo, storageDaPendencia(storage));

/** @param {string} escopo @param {string} acao @param {string} empresaId @param {string} alvo @param {Storage|null} [storage] */
export const limparPendenciaDoApontamento = (escopo, acao, empresaId, alvo, storage) =>
  limparPendenciaLancamento(escopoDaPendencia(escopo), acao, empresaId, alvo, storageDaPendencia(storage));
