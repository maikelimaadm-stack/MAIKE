/**
 * Service da Central Única de Lançamentos (D-PROD-154).
 *
 * Documento gerencial `OperacaoFinanceira`: rascunho completo (POST/PUT),
 * prévia, confirmação (títulos + efeitos de estoque), cancelamento, liquidação
 * MANUAL (sem conciliação bancária) e estorno de liquidação. Online só.
 *
 * Retentativa segura (§8.7): toda ação que cria fato — criar rascunho,
 * confirmar, cancelar, liquidar, estornar — leva um `operation_id` guardado
 * por (escopo, ação, empresa, alvo) até a resposta DEFINITIVA do servidor.
 * Sem resposta (rede, prazo, 5xx), a próxima tentativa reaproveita o MESMO id:
 * o servidor devolve o resultado gravado (replay) em vez de gravar de novo.
 * Mesmo padrão de `manejoRebanhoService.enviarManejoRebanho`.
 */

import {
  getPerfilFinanceiroEmpresa,
  putPerfilFinanceiroEmpresa,
  listOperacoesFinanceirasPage,
  getOperacaoFinanceira,
  createOperacaoFinanceira,
  replaceOperacaoFinanceira,
  deleteOperacaoFinanceira,
  previaOperacaoFinanceira,
  confirmarOperacaoFinanceira,
  cancelarOperacaoFinanceira,
  registrarLiquidacaoTitulo,
  estornarLiquidacaoFinanceira,
  listOpcoesOperacaoFinanceira,
} from '@/apis/operacoes-financeiras';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';
import { confirmar } from '@/lib/maikeConfirmar';
import { LOCALES_FINANCEIROS } from '@/lib/dinheiroDecimal';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'OperacaoFinanceira';

export const DIRECOES = Object.freeze(['PAGAR', 'RECEBER']);
export const CONDICOES = Object.freeze(['AVISTA', 'PRAZO', 'PARCELADO']);
export const ROTULO_DIRECAO = Object.freeze({ PAGAR: 'A pagar', RECEBER: 'A receber' });
export const ROTULO_CONTEUDO = Object.freeze({ COM_PRODUTOS: 'Com produtos', SEM_PRODUTOS: 'Sem produtos' });
export const ROTULO_CONDICAO = Object.freeze({ AVISTA: 'À vista', PRAZO: 'A prazo', PARCELADO: 'Parcelado' });
export const ROTULO_STATUS = Object.freeze({ RASCUNHO: 'Rascunho', CONFIRMADO: 'Confirmado', CANCELADO: 'Cancelado' });
export const ROTULO_STATUS_TITULO = Object.freeze({
  PREVISTO: 'Previsto',
  ABERTO: 'Aberto',
  PARCIAL: 'Parcial',
  QUITADO: 'Quitado',
  CANCELADO: 'Cancelado',
});
export const ROTULO_METODO = Object.freeze({ DINHEIRO: 'Dinheiro', TRANSFERENCIA: 'Transferência', CARTAO: 'Cartão', PIX: 'Pix', OUTRO: 'Outro' });

/** Catálogo de reserva (o servidor manda o seu em `catalogo`; este só cobre resposta antiga). */
export const CATALOGO_PADRAO = Object.freeze({
  moedas: Object.freeze([
    { codigo: 'BRL', casas: 2 }, { codigo: 'USD', casas: 2 }, { codigo: 'EUR', casas: 2 }, { codigo: 'ARS', casas: 2 },
    { codigo: 'UYU', casas: 2 }, { codigo: 'PYG', casas: 0 }, { codigo: 'JPY', casas: 0 }, { codigo: 'KWD', casas: 3 },
  ]),
  paises: Object.freeze(['BR', 'AR', 'PY', 'UY', 'US', 'PT', 'ES', 'JP', 'KW']),
  locales: LOCALES_FINANCEIROS,
});
export const ROTULO_PAIS = Object.freeze({
  BR: 'Brasil', AR: 'Argentina', PY: 'Paraguai', UY: 'Uruguai', US: 'Estados Unidos', PT: 'Portugal', ES: 'Espanha', JP: 'Japão', KW: 'Kuwait',
});
export const ROTULO_LOCALE = Object.freeze({
  'pt-BR': 'Português (Brasil)', 'pt-PT': 'Português (Portugal)', 'es-AR': 'Espanhol (Argentina)', 'es-PY': 'Espanhol (Paraguai)',
  'es-UY': 'Espanhol (Uruguai)', 'es-ES': 'Espanhol (Espanha)', 'en-US': 'Inglês (Estados Unidos)', 'ja-JP': 'Japonês (Japão)',
});
/** Padrões EXPLICADOS do onboarding (§7): Brasil, Real, português do Brasil. */
export const PERFIL_PADRAO = Object.freeze({ pais: 'BR', moeda: 'BRL', locale: 'pt-BR' });

const METODOS_BASE = Object.freeze(['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'OUTRO']);

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Métodos de liquidação permitidos pelo perfil. O servidor manda
 * `metodos_permitidos`; sem ele, a regra do catálogo: PIX só BR + BRL (§8.6).
 * @param {any} perfil
 * @returns {string[]}
 */
export const metodosPermitidosDoPerfil = (perfil) => {
  if (!ehObjeto(perfil)) return [];
  if (Array.isArray(perfil.metodos_permitidos)) return perfil.metodos_permitidos.filter((m) => typeof m === 'string' && m in ROTULO_METODO);
  return perfil.pais === 'BR' && perfil.moeda === 'BRL' ? ['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'PIX', 'OUTRO'] : [...METODOS_BASE];
};

/**
 * Perfil financeiro da empresa + fuso + catálogo, normalizados.
 * @param {string|null} empresaId
 */
export const obterPerfilFinanceiro = async (empresaId) => {
  const empresa = exigirEmpresa(empresaId, 'obterPerfilFinanceiro', RESOURCE);
  const bruto = /** @type {any} */ (await getPerfilFinanceiroEmpresa(empresa));
  const perfil = ehObjeto(bruto?.perfil) ? bruto.perfil : null;
  const catalogoBruto = ehObjeto(bruto?.catalogo) ? bruto.catalogo : {};
  const moedas = Array.isArray(catalogoBruto.moedas) && catalogoBruto.moedas.length ? catalogoBruto.moedas : CATALOGO_PADRAO.moedas;
  const paises = Array.isArray(catalogoBruto.paises) && catalogoBruto.paises.length ? catalogoBruto.paises : CATALOGO_PADRAO.paises;
  const locales = Array.isArray(catalogoBruto.locales) && catalogoBruto.locales.length ? catalogoBruto.locales : CATALOGO_PADRAO.locales;
  return {
    perfil: perfil
      ? {
          ...perfil,
          moeda_casas: Number.isInteger(perfil.moeda_casas) ? perfil.moeda_casas : (moedas.find((m) => m.codigo === perfil.moeda)?.casas ?? 2),
          locale: typeof perfil.locale === 'string' && perfil.locale ? perfil.locale : 'pt-BR',
          metodos_permitidos: metodosPermitidosDoPerfil(perfil),
        }
      : null,
    fuso_horario: typeof bruto?.fuso_horario === 'string' && bruto.fuso_horario ? bruto.fuso_horario : null,
    catalogo: { moedas, paises, locales },
  };
};

/** @param {string|null} empresaId @param {{ pais: string, moeda: string, locale: string }} dados */
export const salvarPerfilFinanceiro = async (empresaId, dados) => {
  const empresa = exigirEmpresa(empresaId, 'salvarPerfilFinanceiro', RESOURCE);
  return putPerfilFinanceiroEmpresa({ empresa_id: empresa, pais: dados.pais, moeda: dados.moeda, locale: dados.locale });
};

/**
 * Página da lista (keyset; teto 100 por página no servidor).
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, direcao?: string, status?: string }} [opts]
 */
export const listarLancamentosPagina = async (empresaId, opts = {}) => {
  if (!empresaId) return paginaVazia(opts.limit);
  return listOperacoesFinanceirasPage({
    empresa_id: empresaId,
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    direcao: opts.direcao,
    status: opts.status,
  });
};

/** @param {string|null} empresaId @param {string} id */
export const obterLancamento = async (empresaId, id) => getOperacaoFinanceira(id, exigirEmpresa(empresaId, 'obterLancamento', RESOURCE));

/** @param {string|null} empresaId @param {string} id */
export const previaLancamento = async (empresaId, id) => previaOperacaoFinanceira(id, exigirEmpresa(empresaId, 'previaLancamento', RESOURCE));

/** @param {string|null} empresaId @param {string} id @param {number} versao */
export const descartarRascunho = async (empresaId, id, versao) => deleteOperacaoFinanceira(id, exigirEmpresa(empresaId, 'descartarRascunho', RESOURCE), versao);

// ─── Pendência de operation_id por (ação, alvo) ─────────────────────────

/** Erro local: o usuário preferiu manter o envio anterior sem resposta. */
export const CODIGO_ENVIO_PENDENTE = 'LANCAMENTO_ENVIO_PENDENTE';

/**
 * Respostas do servidor que NÃO são definitivas: nada foi gravado, mas repetir
 * com o MESMO `operation_id` é seguro (§8.4) — a pendência continua.
 */
const RESPOSTAS_TRANSITORIAS = new Set(['CONCURRENCY_CONFLICT', 'IDEMPOTENCY_IN_PROGRESS', 'INTERNAL_ERROR', 'AUDIT_WRITE_FAILED']);

/** Código estável do corpo do servidor (guardado no `cause` do ApiError). @param {unknown} erro */
export const codigoDoServidor = (erro) => {
  const causa = /** @type {any} */ (erro)?.cause;
  return ehObjeto(causa) && typeof causa.code === 'string' ? causa.code : null;
};

/**
 * Sem resposta do servidor (rede, prazo, gateway) ou falha interna: o pedido
 * PODE ter sido gravado. A tela mostra "resultado incerto — consultar" e nunca
 * "sucesso".
 * @param {unknown} erro
 */
export const ehResultadoIncerto = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code === API_ERROR_CODES.PROVIDER_UNAVAILABLE) return true;
  const codigo = codigoDoServidor(erro);
  return codigo === 'INTERNAL_ERROR' || codigo === 'AUDIT_WRITE_FAILED';
};

/** Resposta definitiva do servidor (recusa com código): a pendência é liberada. @param {unknown} erro */
export const ehRecusaDefinitiva = (erro) => {
  const codigo = codigoDoServidor(erro);
  return Boolean(codigo) && !RESPOSTAS_TRANSITORIAS.has(/** @type {string} */ (codigo));
};

const PREFIXO_PENDENCIA = 'maike_lancamento_pendente';

/** @param {string} escopo @param {string} acao @param {string} empresaId @param {string} alvo */
const chavePendencia = (escopo, acao, empresaId, alvo) => `${PREFIXO_PENDENCIA}:${escopo}:${acao}:${empresaId}:${alvo}`;

const armazenamentoPadrao = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const novaChave = () =>
  `lanc-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/**
 * @param {string} escopo @param {string} acao @param {string} empresaId @param {string} alvo
 * @param {Storage|null} [storage]
 * @returns {{ operation_id: string, conteudo: string, em?: string } | null}
 */
export const lerPendenciaLancamento = (escopo, acao, empresaId, alvo, storage = armazenamentoPadrao()) => {
  try {
    const bruto = storage?.getItem(chavePendencia(escopo, acao, empresaId, alvo));
    const dados = bruto ? JSON.parse(bruto) : null;
    return dados && typeof dados.operation_id === 'string' && typeof dados.conteudo === 'string' ? dados : null;
  } catch {
    return null;
  }
};

/** @param {string} escopo @param {string} acao @param {string} empresaId @param {string} alvo @param {Storage|null} [storage] */
export const limparPendenciaLancamento = (escopo, acao, empresaId, alvo, storage = armazenamentoPadrao()) => {
  try {
    storage?.removeItem(chavePendencia(escopo, acao, empresaId, alvo));
  } catch {
    /* sem storage: nada guardado */
  }
};

const MENSAGEM_DESCARTE =
  'Há um envio anterior desta ação sem resposta do servidor — ele pode ter sido gravado. Consulte o documento antes.\n\n' +
  'Descartar e enviar: abandona o envio anterior e envia este conteúdo.\nManter: reenvie o MESMO conteúdo para concluir com segurança.';

/**
 * Envia com `operation_id` persistente por (escopo, ação, empresa, alvo).
 * @template T
 * @param {{ escopo: string, acao: string, empresaId: string, alvo: string, conteudo: Record<string, unknown>,
 *   enviar: (operationId: string) => Promise<T>, storage?: Storage|null,
 *   confirmarDescarte?: (mensagem: string) => boolean | Promise<boolean> }} p
 * @returns {Promise<T>}
 */
export const enviarComPendencia = async (p) => {
  const storage = p.storage === undefined ? armazenamentoPadrao() : p.storage;
  const confirmarDescarte =
    p.confirmarDescarte ??
    ((mensagem) => confirmar({ titulo: 'Envio anterior sem resposta', descricao: mensagem, textoConfirmar: 'Descartar e enviar', textoCancelar: 'Manter', perigo: true }));
  const conteudo = JSON.stringify(p.conteudo);
  let pendencia = lerPendenciaLancamento(p.escopo, p.acao, p.empresaId, p.alvo, storage);
  if (pendencia && pendencia.conteudo !== conteudo) {
    const descartar = await confirmarDescarte(MENSAGEM_DESCARTE);
    if (!descartar) throw Object.assign(new Error('envio anterior pendente'), { code: CODIGO_ENVIO_PENDENTE });
    pendencia = null;
  }
  const operationId = pendencia?.operation_id || novaChave();
  try {
    storage?.setItem(chavePendencia(p.escopo, p.acao, p.empresaId, p.alvo), JSON.stringify({ operation_id: operationId, conteudo, em: new Date().toISOString() }));
  } catch {
    /* sem storage: a chave vale só nesta tentativa */
  }
  try {
    const resposta = await p.enviar(operationId);
    limparPendenciaLancamento(p.escopo, p.acao, p.empresaId, p.alvo, storage);
    return resposta;
  } catch (erro) {
    if (ehRecusaDefinitiva(erro)) limparPendenciaLancamento(p.escopo, p.acao, p.empresaId, p.alvo, storage);
    throw erro;
  }
};

/**
 * Grava o rascunho: POST (novo, idempotente por operation_id) ou PUT (com
 * `versao`, compare-and-swap no servidor). O corpo é o DOC completo (§5).
 * @param {string|null} empresaId
 * @param {{ id?: string|null, versao?: number|null, doc: Record<string, unknown>, escopo: string, storage?: Storage|null }} p
 */
export const salvarRascunho = async (empresaId, p) => {
  const empresa = exigirEmpresa(empresaId, 'salvarRascunho', RESOURCE);
  const doc = { ...p.doc, empresa_id: empresa };
  if (p.id) return replaceOperacaoFinanceira(p.id, { ...doc, versao: /** @type {number} */ (p.versao) });
  return enviarComPendencia({
    escopo: p.escopo,
    acao: 'criar',
    empresaId: empresa,
    alvo: 'novo',
    conteudo: doc,
    storage: p.storage,
    enviar: (operationId) => createOperacaoFinanceira({ ...doc, operation_id: operationId }),
  });
};

/**
 * Confirma o rascunho (cria títulos e efeitos de estoque). `baixa_no_ato` só
 * para à vista e só com a permissão `liquidar`.
 * @param {string|null} empresaId
 * @param {string} id
 * @param {{ versao: number, baixa_no_ato?: { metodo: string, data: string, referencia?: string } | null, escopo: string, storage?: Storage|null }} p
 */
export const confirmarLancamento = async (empresaId, id, p) => {
  const empresa = exigirEmpresa(empresaId, 'confirmarLancamento', RESOURCE);
  /** @type {Record<string, unknown>} */
  const conteudo = { versao: p.versao };
  if (p.baixa_no_ato) conteudo.baixa_no_ato = p.baixa_no_ato;
  return enviarComPendencia({
    escopo: p.escopo,
    acao: 'confirmar',
    empresaId: empresa,
    alvo: id,
    conteudo,
    storage: p.storage,
    enviar: (operationId) => confirmarOperacaoFinanceira(id, { empresa_id: empresa, operation_id: operationId, ...conteudo }),
  });
};

/** @param {string|null} empresaId @param {string} id @param {{ motivo: string, escopo: string, storage?: Storage|null }} p */
export const cancelarLancamento = async (empresaId, id, p) => {
  const empresa = exigirEmpresa(empresaId, 'cancelarLancamento', RESOURCE);
  const conteudo = { motivo: p.motivo };
  return enviarComPendencia({
    escopo: p.escopo,
    acao: 'cancelar',
    empresaId: empresa,
    alvo: id,
    conteudo,
    storage: p.storage,
    enviar: (operationId) => cancelarOperacaoFinanceira(id, { empresa_id: empresa, operation_id: operationId, ...conteudo }),
  });
};

/**
 * Registra uma liquidação MANUAL (gerencial — não é confirmação bancária).
 * @param {string|null} empresaId
 * @param {string} tituloId
 * @param {{ valor: string, data: string, metodo: string, referencia?: string, observacao?: string, escopo: string, storage?: Storage|null }} p
 */
export const registrarLiquidacao = async (empresaId, tituloId, p) => {
  const empresa = exigirEmpresa(empresaId, 'registrarLiquidacao', RESOURCE);
  /** @type {Record<string, unknown>} */
  const conteudo = { valor: p.valor, data: p.data, metodo: p.metodo };
  if (p.referencia) conteudo.referencia = p.referencia;
  if (p.observacao) conteudo.observacao = p.observacao;
  return enviarComPendencia({
    escopo: p.escopo,
    acao: 'liquidar',
    empresaId: empresa,
    alvo: tituloId,
    conteudo,
    storage: p.storage,
    enviar: (operationId) => registrarLiquidacaoTitulo(tituloId, { empresa_id: empresa, operation_id: operationId, ...conteudo }),
  });
};

/** @param {string|null} empresaId @param {string} liquidacaoId @param {{ motivo: string, escopo: string, storage?: Storage|null }} p */
export const estornarLiquidacao = async (empresaId, liquidacaoId, p) => {
  const empresa = exigirEmpresa(empresaId, 'estornarLiquidacao', RESOURCE);
  const conteudo = { motivo: p.motivo };
  return enviarComPendencia({
    escopo: p.escopo,
    acao: 'estornar',
    empresaId: empresa,
    alvo: liquidacaoId,
    conteudo,
    storage: p.storage,
    enviar: (operationId) => estornarLiquidacaoFinanceira(liquidacaoId, { empresa_id: empresa, operation_id: operationId, ...conteudo }),
  });
};

// ─── Opções dos seletores (rotas próprias da tela, paginadas) ───────────

const POR_PAGINA_OPCOES = 50;

/**
 * @param {'parceiros'|'produtos'|'locais'|'naturezas'|'centros-custo'|'centros-resultado'} recurso
 * @param {string|null} empresaId
 * @param {{ q?: string, cursor?: string|null, limit?: number, direcao?: string, tipo?: string }} [opts]
 */
export const buscarOpcoesLancamento = async (recurso, empresaId, opts = {}) => {
  if (!empresaId) return { itens: [], has_more: false, next_cursor: null };
  /** @type {Record<string, unknown>} */
  const filtros = { q: opts.q?.trim() || undefined, cursor: opts.cursor || undefined, limit: opts.limit ?? POR_PAGINA_OPCOES };
  // Locais são do tenant (compartilhados entre empresas); o saldo é que é por empresa.
  if (recurso !== 'locais') filtros.empresa_id = empresaId;
  if (recurso === 'parceiros') filtros.direcao = opts.direcao;
  if (recurso === 'naturezas') filtros.tipo = opts.tipo;
  return listOpcoesOperacaoFinanceira(recurso, filtros);
};

/**
 * Saldo disponível (kg) do produto por local, SÓ desta empresa.
 * @param {string|null} empresaId
 * @param {string|null} produtoId
 * @returns {Promise<Array<{ local_estoque_id: string, local_nome: string, disponivel_kg: string }>>}
 */
export const listarSaldosProduto = async (empresaId, produtoId) => {
  if (!empresaId || !produtoId) return [];
  const r = await listOpcoesOperacaoFinanceira('saldos', { empresa_id: empresaId, produto_id: produtoId });
  return r.itens.map((i) => ({ ...i, disponivel_kg: i?.disponivel_kg == null ? '0' : String(i.disponivel_kg) }));
};
