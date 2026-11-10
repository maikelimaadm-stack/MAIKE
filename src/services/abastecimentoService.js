/**
 * Service de Abastecimentos (Patrimônio e Frota P1-02, D-PROD-159).
 *
 * Abastecimento CONFIRMADO de um bem da EMPRESA: litros informados, KG
 * convertido UMA vez no servidor pelo fator kg/L INFORMADO pelo responsável
 * (versionado por empresa × combustível × produto) e baixa física FIFO do
 * estoque. Nenhum lançamento financeiro é criado. Sem rascunho: a tela pede a
 * PRÉVIA (sem escrita) com o formulário e só então confirma.
 *
 * Retentativa segura (C7): confirmar e cancelar levam um `operation_id`
 * guardado por (escopo, ação, empresa, alvo) até a resposta DEFINITIVA, pelo
 * MESMO mecanismo da Central (`enviarComPendencia`, sem alterá-la), com escopo
 * próprio `abastecimento:<cliente>:<login>` e perguntas com textos de
 * abastecimento. Sem resposta (rede, prazo, 5xx) = resultado incerto: repetir
 * reaproveita a chave e o servidor devolve o gravado (replay), nunca duplica.
 *
 * Decimais (litros, leitura, fator, KG, custo) são TEXTO canônico do servidor:
 * nada aqui faz aritmética de ponto flutuante.
 */

import {
  listAbastecimentosPage,
  getAbastecimento,
  previaAbastecimento,
  confirmarAbastecimento as confirmarAbastecimentoApi,
  cancelarAbastecimento as cancelarAbastecimentoApi,
  listOpcoesAbastecimento,
  getConsumoAbastecimento,
  listConversoesCombustivelPage,
  createConversaoCombustivel,
  encerrarConversaoCombustivel,
} from '@/apis/patrimonio';
import { confirmar } from '@/lib/maikeConfirmar';
import { montarCorpoCancelamento, montarCorpoConfirmacao, montarCorpoConversao, montarCorpoPrevia } from '@/lib/abastecimentoRegras';
import { enviarComPendencia, lerPendenciaLancamento, limparPendenciaLancamento } from './operacaoFinanceiraService.js';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'AbastecimentoBem';
const RESOURCE_CONVERSAO = 'ConversaoCombustivelProduto';

/** Página padrão da lista. */
export const POR_PAGINA_ABASTECIMENTOS = 100;

export const ROTULO_STATUS_ABASTECIMENTO = Object.freeze({ CONFIRMADO: 'Confirmado', CANCELADO: 'Cancelado' });

/** Ações com pendência de `operation_id` (alvo: 'novo' ou o id do abastecimento). */
export const ACAO_CONFIRMAR = 'criar';
export const ACAO_CANCELAR = 'cancelar';
const ALVO_NOVO = 'novo';

/** Escopo da pendência: separado da Central (`<cliente>:<login>` → `abastecimento:<cliente>:<login>`). @param {string} escopo */
const escopoDaPendencia = (escopo) => `abastecimento:${escopo}`;

/**
 * Onde a chave pendente mora: no storage do navegador e, quando ele não grava
 * (cota cheia, bloqueado, ausente), em memória nesta página — assim "Repetir o
 * mesmo envio" e "Consultar" ainda usam a MESMA chave e o estoque não é baixado
 * duas vezes. A Central (C7) fica como está: só o armazenamento passado muda.
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
        const s = storageDoNavegador();
        if (!s) throw new Error('sem storage');
        s.setItem(k, v);
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
  'Há um envio anterior deste abastecimento sem resposta do servidor — ele pode ter sido gravado. Consulte a lista antes.\n\n' +
  'Descartar e enviar: abandona o envio anterior e envia este conteúdo.\nManter: nada é enviado agora; repita aquele envio para concluí-lo sem duplicar.';

const MENSAGEM_NOVO_ENVIO =
  'Há um envio IGUAL a este sem resposta do servidor — ele pode ter sido gravado. Consulte a lista antes.\n\n' +
  'Enviar como novo: grava OUTRO abastecimento (outra baixa de estoque).\n' +
  'Manter: nada é enviado agora; consulte a lista ou repita aquele envio ("Repetir o mesmo envio") para concluí-lo sem duplicar.';

/** Perguntas com textos de ABASTECIMENTO (ignoram a mensagem genérica da Central). */
const perguntarDescarte = () =>
  confirmar({ titulo: 'Envio anterior sem resposta', descricao: MENSAGEM_DESCARTE, textoConfirmar: 'Descartar e enviar', textoCancelar: 'Manter', perigo: true });
const perguntarNovoEnvio = () =>
  confirmar({ titulo: 'Envio igual sem resposta', descricao: MENSAGEM_NOVO_ENVIO, textoConfirmar: 'Enviar como novo', textoCancelar: 'Manter', perigo: true });

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// ─── Leitura ─────────────────────────────────────────────────────────────

/**
 * Uma página (keyset) dos abastecimentos da empresa. Sem empresa: página vazia, nada é lido.
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, bemId?: string|null, tanqueId?: string|null, produtoId?: string|null,
 *   status?: string|null, dataDe?: string|null, dataAte?: string|null, operationId?: string|null }} [opts]
 */
export const listarAbastecimentosPagina = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_ABASTECIMENTOS;
  if (!empresaId) return paginaVazia(limit);
  return listAbastecimentosPage({
    empresa_id: empresaId,
    bem_id: textoOuIndefinido(opts.bemId),
    tanque_id: textoOuIndefinido(opts.tanqueId),
    produto_id: textoOuIndefinido(opts.produtoId),
    status: textoOuIndefinido(opts.status),
    data_de: textoOuIndefinido(opts.dataDe),
    data_ate: textoOuIndefinido(opts.dataAte),
    operation_id: textoOuIndefinido(opts.operationId),
    q: textoOuIndefinido(opts.q),
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/** @param {string|null} empresaId @param {string} id */
export const detalharAbastecimento = async (empresaId, id) => getAbastecimento(id, exigirEmpresa(empresaId, 'detalharAbastecimento', RESOURCE));

/**
 * Opções da tela (bens, tanques do bem, tipos, produtos do tipo, produtos do
 * filtro, locais com saldo do produto). Sem empresa: vazio, nada é lido.
 * @param {string} recurso
 * @param {string|null} empresaId
 * @param {{ q?: string, cursor?: string|null, limit?: number, uso?: 'formulario'|'filtro', bemId?: string|null, tipoCombustivelId?: string|null, produtoId?: string|null }} [opts]
 */
export const listarOpcoesAbastecimento = async (recurso, empresaId, opts = {}) => {
  if (!empresaId) return recurso === 'tanques' ? { bem: null, itens: [] } : { itens: [], has_more: false, next_cursor: null };
  return listOpcoesAbastecimento(recurso, {
    empresa_id: empresaId,
    q: textoOuIndefinido(opts.q),
    cursor: textoOuIndefinido(opts.cursor),
    limit: opts.limit,
    uso: opts.uso,
    bem_id: textoOuIndefinido(opts.bemId),
    tipo_combustivel_id: textoOuIndefinido(opts.tipoCombustivelId),
    produto_id: textoOuIndefinido(opts.produtoId),
  });
};

/**
 * Produtos que o operador escolhe para o bem (A16, D-PROD-160): cada item é um
 * PRODUTO com o tipo de combustível derivado do vínculo ativo, os tanques do
 * bem que o aceitam e o fator vigente (ou `pronto:false`); `resumo` é do
 * conjunto inteiro (motivo quando não há opção). Sem empresa ou sem bem: vazio,
 * nada é lido.
 * @param {string|null} empresaId @param {string|null} bemId
 * @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 * @returns {Promise<{ bem: any, itens: any[], has_more: boolean, next_cursor: string|null, resumo: any }>}
 */
export const listarProdutosDoBem = async (empresaId, bemId, opts = {}) => {
  if (!empresaId || !bemId) return { bem: null, itens: [], has_more: false, next_cursor: null, resumo: null };
  return listOpcoesAbastecimento('produtos-do-bem', {
    empresa_id: empresaId,
    bem_id: bemId,
    q: textoOuIndefinido(opts.q),
    cursor: textoOuIndefinido(opts.cursor),
    limit: opts.limit,
  });
};

/**
 * Consumo do bem (km/L ou L/h pelo método do tanque cheio).
 * @param {string|null} empresaId @param {string} bemId @param {{ tanqueId?: string|null, limit?: number }} [opts]
 */
export const consumoDoBem = async (empresaId, bemId, opts = {}) =>
  getConsumoAbastecimento({
    empresa_id: exigirEmpresa(empresaId, 'consumoDoBem', RESOURCE),
    bem_id: bemId,
    tanque_id: textoOuIndefinido(opts.tanqueId),
    limit: opts.limit,
  });

// ─── Prévia, confirmação e cancelamento ─────────────────────────────────

/**
 * Prévia SEM escrita do formulário: `{plano, bloqueios}`.
 * @param {string|null} empresaId @param {any} form
 */
export const previaDoAbastecimento = async (empresaId, form) =>
  previaAbastecimento(montarCorpoPrevia(exigirEmpresa(empresaId, 'previaDoAbastecimento', RESOURCE), form));

/**
 * Confirma o abastecimento que a prévia mostrou (o fator visto na prévia vai no
 * corpo; mudou no servidor → 409). `operation_id` persistente por pendência.
 * @param {string|null} empresaId @param {any} form @param {any} plano
 * @param {{ escopo: string, storage?: Storage|null, retentativa?: boolean,
 *   confirmarDescarte?: (m: string) => boolean | Promise<boolean>, confirmarNovoEnvio?: (m: string) => boolean | Promise<boolean> }} c
 */
export const confirmarAbastecimento = async (empresaId, form, plano, c) => {
  const empresa = exigirEmpresa(empresaId, 'confirmarAbastecimento', RESOURCE);
  const corpo = montarCorpoConfirmacao(empresa, form, plano);
  return enviarComPendencia({
    escopo: escopoDaPendencia(c.escopo),
    acao: ACAO_CONFIRMAR,
    empresaId: empresa,
    alvo: ALVO_NOVO,
    conteudo: corpo,
    enviar: (operationId) => confirmarAbastecimentoApi({ ...corpo, operation_id: operationId }),
    storage: storageDaPendencia(c.storage),
    retentativa: c.retentativa,
    confirmarDescarte: c.confirmarDescarte ?? perguntarDescarte,
    confirmarNovoEnvio: c.confirmarNovoEnvio ?? perguntarNovoEnvio,
  });
};

/**
 * Cancela (estorno exato pelas fatias gravadas). Motivo obrigatório (3..500).
 * @param {string|null} empresaId @param {any} registro (detalhe: `id`, `versao`)
 * @param {{ motivo: string, escopo: string, storage?: Storage|null, retentativa?: boolean,
 *   confirmarDescarte?: (m: string) => boolean | Promise<boolean> }} c
 */
export const cancelarAbastecimento = async (empresaId, registro, c) => {
  const empresa = exigirEmpresa(empresaId, 'cancelarAbastecimento', RESOURCE);
  const corpo = montarCorpoCancelamento(empresa, registro, c.motivo);
  const id = String(registro?.id ?? '');
  return enviarComPendencia({
    escopo: escopoDaPendencia(c.escopo),
    acao: ACAO_CANCELAR,
    empresaId: empresa,
    alvo: id,
    conteudo: corpo,
    enviar: (operationId) => cancelarAbastecimentoApi(id, { ...corpo, operation_id: operationId }),
    storage: storageDaPendencia(c.storage),
    retentativa: c.retentativa,
    confirmarDescarte: c.confirmarDescarte ?? perguntarDescarte,
    confirmarNovoEnvio: perguntarNovoEnvio,
  });
};

/**
 * Pendência (envio sem resposta) desta ação: `{operation_id, conteudo}` ou null.
 * @param {string} escopo @param {string} acao @param {string} empresaId @param {string} alvo @param {Storage|null} [storage]
 */
export const pendenciaDoAbastecimento = (escopo, acao, empresaId, alvo, storage) =>
  lerPendenciaLancamento(escopoDaPendencia(escopo), acao, empresaId, alvo, storageDaPendencia(storage));

/** @param {string} escopo @param {string} acao @param {string} empresaId @param {string} alvo @param {Storage|null} [storage] */
export const limparPendenciaDoAbastecimento = (escopo, acao, empresaId, alvo, storage) =>
  limparPendenciaLancamento(escopoDaPendencia(escopo), acao, empresaId, alvo, storageDaPendencia(storage));

export const ALVO_NOVO_ABASTECIMENTO = ALVO_NOVO;

// ─── Fatores kg/L ───────────────────────────────────────────────────────

/**
 * @param {string|null} empresaId
 * @param {{ tipoCombustivelId?: string|null, produtoId?: string|null, situacao?: 'VIGENTES'|'TODAS', limit?: number, cursor?: string|null }} [opts]
 */
export const listarConversoesPagina = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? 50;
  if (!empresaId) return paginaVazia(limit);
  return listConversoesCombustivelPage({
    empresa_id: empresaId,
    tipo_combustivel_id: textoOuIndefinido(opts.tipoCombustivelId),
    produto_id: textoOuIndefinido(opts.produtoId),
    situacao: opts.situacao,
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/**
 * Novo fator do par (encerra a vigente lida pela tela e cria a próxima versão).
 * `kgPorLitro` é o TEXTO digitado (pt-BR, ex.: "0,84").
 * @param {string|null} empresaId
 * @param {{ tipoCombustivelId: string, produtoId: string, kgPorLitro: string, declaraEstoqueEmKg: boolean, conversaoVigenteId: string|null }} p
 */
export const configurarConversao = async (empresaId, p) => {
  const empresa = exigirEmpresa(empresaId, 'configurarConversao', RESOURCE_CONVERSAO);
  return createConversaoCombustivel(
    montarCorpoConversao(
      empresa,
      { tipo_combustivel_id: p.tipoCombustivelId, produto_id: p.produtoId, kg_por_litro: p.kgPorLitro, declara_estoque_em_kg: p.declaraEstoqueEmKg },
      p.conversaoVigenteId,
    ),
  );
};

/** Encerra o fator vigente (o par fica sem fator: abastecer passa a ser recusado). @param {string|null} empresaId @param {any} conversao */
export const encerrarConversao = async (empresaId, conversao) =>
  encerrarConversaoCombustivel(String(conversao?.id ?? ''), { empresa_id: exigirEmpresa(empresaId, 'encerrarConversao', RESOURCE_CONVERSAO), versao: conversao?.versao });
