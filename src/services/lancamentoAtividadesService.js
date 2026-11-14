/**
 * Service do Lançamento de Atividades (D-PROD-200, Fatia 2).
 *
 * A ATIVIDADE é o cabeçalho aberto (tipo, área, máquina, safra, datas; setor
 * herdado da área; centros e unidade herdados do tipo) e os APONTAMENTOS são os
 * dias e turnos em que ela foi executada. Contrato:
 * docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md (§3, §4, §10).
 *
 * FAZENDA: o service injeta o `empresa_id` da fazenda em que a tela está — a
 * empresa REAL selecionada (`useEmpresaRealSelecionadaId`), que a página
 * informa a cada renderização com `definirFazendaDaTela` (ela vem ANTES dos
 * componentes filhos lerem). Sem fazenda nada é gravado (`exigirEmpresa` falha
 * ANTES da rede) e as listas voltam vazias. Quem chama nunca passa a empresa.
 *
 * As respostas seguem o §10: a lista é a página keyset (`{ items,
 * next_cursor, has_more, total, limit }`); toda escrita da atividade devolve o
 * DETALHE dela; a lista de apontamentos é `{ items }`; toda escrita de
 * apontamento devolve `{ apontamento, atividade, alertas }`, com `atividade`
 * já com os totais recalculados.
 *
 * Sem DELETE físico: a atividade e o apontamento se CANCELAM com motivo (3 a
 * 500 caracteres, conferido ANTES da rede) e a `versao` lida (CAS no servidor).
 */

import {
  listAtividadesPage,
  getAtividade,
  createAtividade,
  updateAtividade,
  completeAtividade,
  reopenAtividade,
  cancelAtividade,
  duplicateAtividade,
  listAtividadeApontamentos,
  getAtividadeApontamento,
  createAtividadeApontamento,
  updateAtividadeApontamento,
  cancelAtividadeApontamento,
  duplicateAtividadeApontamento,
  listOpcoesAtividade,
} from '@/apis/atividades';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { lerMotivo } from '@/lib/lancamentoAtividadesRegras';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';
import { listarAreasAtivas } from './mapaService.js';

export { listarTiposAtividade } from './tipoAtividadeCadastroService.js';

const RESOURCE = 'Atividade';
const RESOURCE_APONTAMENTO = 'AtividadeApontamento';

/** Página padrão da lista de atividades. */
export const POR_PAGINA_ATIVIDADES = 100;

// ─── Fazenda da tela ─────────────────────────────────────────────────────

/** @type {string|null} */
let fazendaDaTela = null;

/**
 * A fazenda (empresa REAL) em que a tela de Lançamento de Atividades está. A
 * página chama a cada renderização, antes de os componentes filhos lerem ou
 * gravarem; `null` (sem fazenda) fecha toda gravação.
 * @param {string|null|undefined} empresaId
 */
export const definirFazendaDaTela = (empresaId) => {
  fazendaDaTela = typeof empresaId === 'string' && empresaId.trim() ? empresaId.trim() : null;
};

/** A fazenda que o service injeta agora (ou null). */
export const fazendaDaTelaAtual = () => fazendaDaTela;

/** @param {string} operation @param {string} [resource] */
const fazenda = (operation, resource = RESOURCE) => exigirEmpresa(fazendaDaTela, operation, resource);

// ─── Peças ───────────────────────────────────────────────────────────────

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** @param {unknown} dados @returns {Record<string, any>} */
const comoObjeto = (dados) => (dados && typeof dados === 'object' && !Array.isArray(dados) ? /** @type {Record<string, any>} */ (dados) : {});

/**
 * Motivo de 3 a 500 caracteres úteis; fora disso falha ANTES da rede, com o
 * mesmo código e `reason` do servidor.
 * @param {unknown} motivo @param {string} operation @param {string} resource
 */
const motivoValido = (motivo, operation, resource) => {
  const lido = lerMotivo(motivo);
  if (lido.ok) return lido.motivo;
  throw new ApiError(API_ERROR_CODES.ATIVIDADE_MOTIVO_INVALIDO, { operation, resource, details: { field: 'motivo', reason: lido.reason } });
};

/** Opcional só quando informado (o servidor aplica o padrão quando ausente). @param {Record<string, any>} d @param {string[]} campos */
const soOsInformados = (d, campos) => Object.fromEntries(campos.filter((c) => textoOuIndefinido(d[c]) !== undefined).map((c) => [c, String(d[c]).trim()]));

// ─── Atividade (cabeçalho) ───────────────────────────────────────────────

/**
 * Uma página (keyset) das atividades da fazenda. Filtros do contrato: `status`,
 * `tipo_atividade_id`, `area_id`, `data_de` e `data_ate` (sobre `data_inicio`).
 * Sem fazenda: página vazia, nada é lido.
 * @param {{ status?: string|null, tipo_atividade_id?: string|null, area_id?: string|null,
 *   data_de?: string|null, data_ate?: string|null, limit?: number, cursor?: string|null }} [filtros]
 */
export const listarAtividades = async (filtros = {}) => {
  const f = comoObjeto(filtros);
  const limit = Number.isInteger(f.limit) && f.limit > 0 ? f.limit : POR_PAGINA_ATIVIDADES;
  if (!fazendaDaTela) return paginaVazia(limit);
  return listAtividadesPage({
    empresa_id: fazendaDaTela,
    status: textoOuIndefinido(f.status),
    tipo_atividade_id: textoOuIndefinido(f.tipo_atividade_id),
    area_id: textoOuIndefinido(f.area_id),
    data_de: textoOuIndefinido(f.data_de),
    data_ate: textoOuIndefinido(f.data_ate),
    limit,
    cursor: textoOuIndefinido(f.cursor),
  });
};

/** Detalhe da atividade (cabeçalho, objetos e `totais`). @param {string} id */
export const obterAtividade = async (id) => getAtividade(String(id ?? ''), fazenda('obterAtividade'));

/**
 * Abrir atividade: `{ nome, tipo_atividade_id, area_id?, bem_id?, safra_ciclo?,
 * data_inicio?, data_prevista_fim?, area_planejada?, lancamento_tarefa_id?,
 * observacao? }`. Centros, unidade e setor NÃO vão (são herdados no servidor).
 * Devolve o detalhe da atividade aberta.
 * @param {Record<string, any>} dados
 */
export const criarAtividade = async (dados) => createAtividade({ ...comoObjeto(dados), empresa_id: fazenda('criarAtividade') });

/**
 * Editar o cabeçalho (só ABERTA; o tipo é imutável): os dados que mudaram e a
 * `versao` lida. Devolve o detalhe.
 * @param {string} id @param {Record<string, any>} dados
 */
export const editarAtividade = async (id, dados) => updateAtividade(String(id ?? ''), { ...comoObjeto(dados), empresa_id: fazenda('editarAtividade') });

/**
 * Concluir (só ABERTA): `{ versao, data_conclusao? }` — sem data, o servidor
 * usa hoje na fazenda. Devolve o detalhe.
 * @param {string} id @param {{ versao: number, data_conclusao?: string|null }} dados
 */
export const concluirAtividade = async (id, dados) => {
  const d = comoObjeto(dados);
  return completeAtividade(String(id ?? ''), {
    empresa_id: fazenda('concluirAtividade'),
    versao: d.versao,
    ...soOsInformados(d, ['data_conclusao']),
  });
};

/**
 * Reabrir (só CONCLUIDA; permissão própria): `{ versao, motivo }`. Devolve o detalhe.
 * @param {string} id @param {{ versao: number, motivo: string }} dados
 */
export const reabrirAtividade = async (id, dados) => {
  const d = comoObjeto(dados);
  const empresaId = fazenda('reabrirAtividade');
  return reopenAtividade(String(id ?? ''), { empresa_id: empresaId, versao: d.versao, motivo: motivoValido(d.motivo, 'reabrirAtividade', RESOURCE) });
};

/**
 * Cancelar (só ABERTA): `{ versao, motivo }`. O servidor cancela junto os
 * apontamentos confirmados (mesmo motivo, dia e usuário). Devolve o detalhe.
 * @param {string} id @param {{ versao: number, motivo: string }} dados
 */
export const cancelarAtividade = async (id, dados) => {
  const d = comoObjeto(dados);
  const empresaId = fazenda('cancelarAtividade');
  return cancelAtividade(String(id ?? ''), { empresa_id: empresaId, versao: d.versao, motivo: motivoValido(d.motivo, 'cancelarAtividade', RESOURCE) });
};

/**
 * Duplicar: abertura NOVA com as mesmas regras e os padrões relidos do tipo
 * (sem apontamentos). Opcionais: `{ nome?, data_inicio?, data_prevista_fim? }`
 * (padrões no servidor: o mesmo nome e hoje). Devolve o detalhe da NOVA.
 * @param {string} id @param {{ nome?: string, data_inicio?: string, data_prevista_fim?: string }} [dados]
 */
export const duplicarAtividade = async (id, dados = {}) =>
  duplicateAtividade(String(id ?? ''), {
    empresa_id: fazenda('duplicarAtividade'),
    ...soOsInformados(comoObjeto(dados), ['nome', 'data_inicio', 'data_prevista_fim']),
  });

// ─── Apontamentos da atividade ───────────────────────────────────────────

/**
 * Apontamentos da atividade: `{ items }` (dia desc, turno, sequência; sem
 * paginação). Sem fazenda: vazio, nada é lido.
 * @param {string} atividadeId
 * @returns {Promise<{ items: any[] }>}
 */
export const listarApontamentos = async (atividadeId) => {
  if (!fazendaDaTela) return { items: [] };
  return listAtividadeApontamentos(String(atividadeId ?? ''), fazendaDaTela);
};

/** Um apontamento da atividade. @param {string} atividadeId @param {string} apontamentoId */
export const obterApontamento = async (atividadeId, apontamentoId) =>
  getAtividadeApontamento(String(atividadeId ?? ''), String(apontamentoId ?? ''), fazenda('obterApontamento', RESOURCE_APONTAMENTO));

/**
 * Novo lançamento (só em atividade ABERTA): `{ data_operacional, turno?,
 * operador_usuario_id?, area_executada_dia?, quantidade_produzida_dia?,
 * observacao?, origem? }`. Área, setor, safra, centros, unidade e máquina são do
 * cabeçalho (não vão). Devolve `{ apontamento, atividade, alertas }`.
 * @param {string} atividadeId @param {Record<string, any>} dados
 */
export const criarApontamento = async (atividadeId, dados) =>
  createAtividadeApontamento(String(atividadeId ?? ''), { ...comoObjeto(dados), empresa_id: fazenda('criarApontamento', RESOURCE_APONTAMENTO) });

/**
 * Editar o apontamento CONFIRMADO: os mesmos campos de dado e a `versao` lida.
 * Devolve `{ apontamento, atividade, alertas }`.
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} dados
 */
export const editarApontamento = async (atividadeId, apontamentoId, dados) =>
  updateAtividadeApontamento(String(atividadeId ?? ''), String(apontamentoId ?? ''), {
    ...comoObjeto(dados),
    empresa_id: fazenda('editarApontamento', RESOURCE_APONTAMENTO),
  });

/**
 * Cancelar o apontamento CONFIRMADO: `{ versao, motivo }`. Devolve
 * `{ apontamento, atividade, alertas }`.
 * @param {string} atividadeId @param {string} apontamentoId @param {{ versao: number, motivo: string }} dados
 */
export const cancelarApontamento = async (atividadeId, apontamentoId, dados) => {
  const d = comoObjeto(dados);
  const empresaId = fazenda('cancelarApontamento', RESOURCE_APONTAMENTO);
  return cancelAtividadeApontamento(String(atividadeId ?? ''), String(apontamentoId ?? ''), {
    empresa_id: empresaId,
    versao: d.versao,
    motivo: motivoValido(d.motivo, 'cancelarApontamento', RESOURCE_APONTAMENTO),
  });
};

/**
 * "Repetir" o lançamento (turno, operador, área do dia, produção e observação),
 * com sequência nova: `{ data_operacional? }` (padrão hoje no servidor).
 * Devolve `{ apontamento, atividade, alertas }`.
 * @param {string} atividadeId @param {string} apontamentoId @param {{ data_operacional?: string }} [dados]
 */
export const duplicarApontamento = async (atividadeId, apontamentoId, dados = {}) =>
  duplicateAtividadeApontamento(String(atividadeId ?? ''), String(apontamentoId ?? ''), {
    empresa_id: fazenda('duplicarApontamento', RESOURCE_APONTAMENTO),
    ...soOsInformados(comoObjeto(dados), ['data_operacional']),
  });

// ─── Opções da tela ──────────────────────────────────────────────────────

const SEM_OPCOES = Object.freeze({ itens: [], has_more: false, next_cursor: null });

/**
 * @param {'bens'|'operadores'} recurso
 * @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 */
const opcoes = async (recurso, opts = {}) => {
  if (!fazendaDaTela) return { ...SEM_OPCOES, itens: [] };
  const o = comoObjeto(opts);
  return listOpcoesAtividade(recurso, {
    empresa_id: fazendaDaTela,
    q: textoOuIndefinido(o.q),
    cursor: textoOuIndefinido(o.cursor),
    limit: Number.isInteger(o.limit) && o.limit > 0 ? o.limit : undefined,
  });
};

/**
 * Máquinas ATIVAS da fazenda para o cabeçalho (rota própria da tela; formato
 * `{ itens, has_more, next_cursor }` do seletor paginado).
 * @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 */
export const listarOpcoesBens = (opts = {}) => opcoes('bens', opts);

/**
 * Operadores (usuários ATIVOS do cliente) para o apontamento (rota própria da tela).
 * @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 */
export const listarOpcoesOperadores = (opts = {}) => opcoes('operadores', opts);

/**
 * Áreas ATIVAS da fazenda (filtro da lista e cabeçalho; a área gravada que
 * ficou inativa vem do próprio registro). Sem fazenda: vazio.
 */
export const listarAreasDaFazenda = async () => (fazendaDaTela ? listarAreasAtivas(fazendaDaTela) : []);
