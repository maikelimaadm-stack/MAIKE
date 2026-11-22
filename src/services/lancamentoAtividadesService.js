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
  registerAtividadeDeCampo,
  getAtividadesDaAreaResumo,
  listAtividadesDaAreaRegistros,
  updateAtividadeApontamento,
  cancelAtividadeApontamento,
  duplicateAtividadeApontamento,
  listOpcoesAtividade,
  getAtividadeTotais,
  addAtividadeArea,
  updateAtividadeArea,
  actionAtividadeArea,
  createAtividadeLinha,
  updateAtividadeLinha,
  cancelAtividadeLinha,
  getMedidorAtividade,
} from '@/apis/atividades';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { lerMotivo } from '@/lib/lancamentoAtividadesRegras';
import { confirmar } from '@/lib/maikeConfirmar';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';
import { enviarComPendencia, lerPendenciaLancamento, limparPendenciaLancamento } from './operacaoFinanceiraService.js';
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
 * `tipo_atividade_id`, `area_id`, `data_de` e `data_ate` (sobre `data_inicio`);
 * D-PROD-273: `local` (o serviço sem área naquele local).
 * Sem fazenda: página vazia, nada é lido.
 * @param {{ status?: string|null, situacao?: string|null, tipo_fixo?: string|null, tipo_atividade_id?: string|null, area_id?: string|null,
 *   data_de?: string|null, data_ate?: string|null, local?: string|null, limit?: number, cursor?: string|null }} [filtros]
 */
export const listarAtividades = async (filtros = {}) => {
  const f = comoObjeto(filtros);
  const limit = Number.isInteger(f.limit) && f.limit > 0 ? f.limit : POR_PAGINA_ATIVIDADES;
  if (!fazendaDaTela) return paginaVazia(limit);
  return listAtividadesPage({
    empresa_id: fazendaDaTela,
    status: textoOuIndefinido(f.status),
    // D-PROD-267: a Situação (Planejada, Em andamento, Concluída, Cancelada) e o tipo fixo da operação.
    situacao: textoOuIndefinido(f.situacao),
    tipo_fixo: textoOuIndefinido(f.tipo_fixo),
    tipo_atividade_id: textoOuIndefinido(f.tipo_atividade_id),
    area_id: textoOuIndefinido(f.area_id),
    data_de: textoOuIndefinido(f.data_de),
    data_ate: textoOuIndefinido(f.data_ate),
    // D-PROD-273: o serviço sem área no local (a prévia "Entra em …" da Nova realização sem área).
    local: textoOuIndefinido(f.local),
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

// ─── Áreas da atividade (D-PROD-249) ─────────────────────────────────────

/**
 * Mais uma área na atividade (entra PLANEJADA; a área planejada vazia = o tamanho da área, no servidor). Devolve
 * `{ area, atividade }`.
 * @param {string} atividadeId @param {{ area_id: string, area_planejada?: string|null }} dados
 */
export const adicionarAreaAtividade = async (atividadeId, dados) => {
  const d = comoObjeto(dados);
  return addAtividadeArea(String(atividadeId ?? ''), {
    empresa_id: fazenda('adicionarAreaAtividade'),
    area_id: String(d.area_id ?? ''),
    ...soOsInformados(d, ['area_planejada']),
  });
};

/**
 * A área planejada de uma área da atividade (`null` limpa), com a `versao` da área. Devolve `{ area, atividade }`.
 * @param {string} atividadeId @param {{ id: string, versao: number }} area @param {string|null} areaPlanejada
 */
export const editarAreaAtividade = async (atividadeId, area, areaPlanejada) =>
  updateAtividadeArea(String(atividadeId ?? ''), String(area?.id ?? ''), {
    empresa_id: fazenda('editarAreaAtividade'),
    versao: area?.versao,
    area_planejada: typeof areaPlanejada === 'string' && areaPlanejada.trim() ? areaPlanejada.trim() : null,
  });

/**
 * Iniciar (com a data de início), concluir (com a data de conclusão), reabrir ou remover uma área da atividade, com a
 * `versao` da área. Sem data, o servidor usa hoje na fazenda. Devolve `{ area, atividade }` (remover: `{ removida, atividade }`).
 * @param {string} atividadeId @param {{ id: string, versao: number }} area @param {'iniciar'|'concluir'|'reabrir'|'remover'} acao
 * @param {{ data?: string|null }} [opcoes]
 */
export const acaoAreaAtividade = async (atividadeId, area, acao, opcoes = {}) => {
  const campoDaData = acao === 'iniciar' ? 'data_inicio' : acao === 'concluir' ? 'data_conclusao' : null;
  const data = textoOuIndefinido(comoObjeto(opcoes).data);
  return actionAtividadeArea(String(atividadeId ?? ''), String(area?.id ?? ''), acao, {
    empresa_id: fazenda('acaoAreaAtividade'),
    versao: area?.versao,
    ...(campoDaData && data ? { [campoDaData]: data } : {}),
  });
};

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

/** Coleções de linhas que o lançamento (e o "Repetir") leva no corpo. */
const COLECOES_DO_LANCAMENTO = Object.freeze(['produtos', 'maquinas', 'mao_obra', 'servicos']);

/**
 * Novo lançamento (só em atividade ABERTA): `{ data_operacional, turno?,
 * operador_usuario_id?, area_executada_dia?, quantidade_produzida_dia?,
 * observacao?, origem? }`. Área, setor, safra, centros, unidade e máquina são do
 * cabeçalho (não vão). Devolve `{ apontamento, atividade, alertas }`.
 * Fatia 3: com `produtos[]`/`maquinas[]` ("Repetir último lançamento"), vai com
 * o `operation_id` persistente (`opcoes`: escopo e retentativa). Fatia 4: o
 * mesmo com `mao_obra[]` e `servicos[]`.
 * @param {string} atividadeId @param {Record<string, any>} dados @param {OpcoesDeEnvio|null} [opcoes]
 */
export const criarApontamento = async (atividadeId, dados, opcoes = null) => {
  const d = comoObjeto(dados);
  const empresaId = fazenda('criarApontamento', RESOURCE_APONTAMENTO);
  const id = String(atividadeId ?? '');
  const comLinhas = COLECOES_DO_LANCAMENTO.some((c) => Array.isArray(d[c]) && d[c].length > 0);
  if (!comLinhas) {
    const { produtos: _p, maquinas: _m, mao_obra: _o, servicos: _s, ...doDia } = d;
    return createAtividadeApontamento(id, { ...doDia, empresa_id: empresaId });
  }
  // Com linhas (Fatia 3): tudo numa transação no servidor, com UM `operation_id` persistente até a resposta definitiva.
  const corpo = { ...d, empresa_id: empresaId };
  const o = comoObjeto(opcoes);
  return enviarComPendencia({
    escopo: escopoDaPendencia(o.escopo),
    acao: ACAO_LANCAR_LINHA,
    empresaId,
    alvo: alvoDosApontamentos(id),
    conteudo: corpo,
    enviar: (operationId) => createAtividadeApontamento(id, { ...corpo, operation_id: operationId }),
    storage: storageDaPendencia(o.storage),
    retentativa: o.retentativa === true,
    confirmarDescarte: o.confirmarDescarte ?? perguntarDescarte,
    confirmarNovoEnvio: o.confirmarNovoEnvio ?? perguntarNovoEnvio,
  });
};

/** O alvo da pendência do registro de campo (área + tipo): "Repetir o mesmo envio" reaproveita a MESMA chave. @param {string} areaId @param {string} tipoId */
export const alvoDoRegistroDeCampo = (areaId, tipoId) => `registro:${areaId}:${tipoId}`;

/**
 * D-PROD-254 — registra o trabalho de campo de UMA área e de UM tipo num envio só (`POST /atividades/registrar`). O servidor
 * acha a atividade aberta do tipo que já tem a área no mês — ou abre uma — e grava o registro do dia com as linhas, numa
 * transação; a chave (`operation_id`) é persistente até a resposta definitiva, como nas linhas. D-PROD-263: `areas[]`
 * (várias áreas, cada uma com os hectares) no lugar de `area_id`.
 * Devolve `{ apontamento, atividade, alertas, apontamentos, registro }`.
 * @param {Record<string, any>} dados `area_id` ou `areas`, `tipo_atividade_id`, `data_operacional` e os dados do dia e as linhas
 * @param {OpcoesDeEnvio|null} [opcoes]
 */
export const registrarCampo = async (dados, opcoes = null) => {
  const d = comoObjeto(dados);
  const empresaId = fazenda('registrarCampo', RESOURCE_APONTAMENTO);
  const corpo = { ...d, empresa_id: empresaId };
  const o = comoObjeto(opcoes);
  return enviarComPendencia({
    escopo: escopoDaPendencia(o.escopo),
    acao: ACAO_LANCAR_LINHA,
    empresaId,
    // D-PROD-263: com várias áreas, o alvo é o conjunto delas, na ordem enviada.
    // D-PROD-273: sem área (Manutenção e Outros), o alvo é o local.
    alvo: alvoDoRegistroDeCampo(
      Array.isArray(d.areas) ? d.areas.map((/** @type {any} */ a) => String(a?.area_id ?? '')).join('+') : d.area_id === undefined && typeof d.local === 'string' ? `local:${d.local}` : String(d.area_id ?? ''),
      String(d.tipo_atividade_id ?? ''),
    ),
    conteudo: corpo,
    enviar: (operationId) => registerAtividadeDeCampo({ ...corpo, operation_id: operationId }),
    storage: storageDaPendencia(o.storage),
    retentativa: o.retentativa === true,
    confirmarDescarte: o.confirmarDescarte ?? perguntarDescarte,
    confirmarNovoEnvio: o.confirmarNovoEnvio ?? perguntarNovoEnvio,
  });
};

/** D-PROD-254 — atividades da área e custos do mês (números do servidor). @param {string} areaId */
export const obterResumoDaArea = async (areaId) => getAtividadesDaAreaResumo(String(areaId ?? ''), fazenda('obterResumoDaArea'));

/** D-PROD-254 — os registros de campo da área (do mais novo ao mais antigo). @param {string} areaId @param {{ limit?: number, cursor?: string|null, tipo_atividade_id?: string|null }} [filtros] */
export const listarRegistrosDaArea = async (areaId, filtros = {}) => {
  const f = comoObjeto(filtros);
  return listAtividadesDaAreaRegistros(String(areaId ?? ''), {
    empresa_id: fazenda('listarRegistrosDaArea'),
    limit: Number.isInteger(f.limit) && f.limit > 0 ? f.limit : undefined,
    cursor: textoOuIndefinido(f.cursor),
    tipo_atividade_id: textoOuIndefinido(f.tipo_atividade_id),
  });
};

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

// ─── Linhas de produto e de máquina (D-PROD-202, Fatia 3), mão de obra e serviço (Fatia 4) ─

/**
 * Pendência de `operation_id` das linhas (precedente D-PROD-193): adicionar, editar e cancelar linha — e o lançamento
 * com linhas — levam um `operation_id` guardado por (escopo, ação, empresa, alvo) até a resposta DEFINITIVA, pelo
 * MESMO mecanismo da Central e do abastecimento (`enviarComPendencia`), com escopo próprio
 * `atividade:<cliente>:<login>`. Sem resposta (rede, prazo, 5xx) = resultado incerto: repetir reaproveita a chave e o
 * servidor devolve o gravado, nunca baixa nem estorna o estoque duas vezes.
 */
export const ACAO_LANCAR_LINHA = 'criar';
export const ACAO_EDITAR_LINHA = 'editar';
export const ACAO_CANCELAR_LINHA = 'cancelar';
/** O segmento da rota de cada tipo de linha. @typedef {'produtos'|'maquinas'|'mao-obra'|'servicos'} TipoDeLinha */
/** Alvo das linhas NOVAS de um apontamento (por tipo). @param {TipoDeLinha} tipo @param {string} apontamentoId */
export const alvoDasLinhas = (tipo, apontamentoId) => `${tipo}:${apontamentoId}`;
/** Alvo de UMA linha gravada. @param {TipoDeLinha} tipo @param {string} linhaId */
export const alvoDaLinha = (tipo, linhaId) => `${tipo}:linha:${linhaId}`;
/** Alvo do lançamento NOVO com linhas de uma atividade. @param {string} atividadeId */
export const alvoDosApontamentos = (atividadeId) => `apontamentos:${atividadeId}`;

/** @param {unknown} escopo */
const escopoDaPendencia = (escopo) => `atividade:${typeof escopo === 'string' && escopo ? escopo : 'sem-tenant:sem-login'}`;

/**
 * A chave pendente mora no storage do navegador e, quando ele não grava (cota, bloqueio, ausente), em memória nesta
 * página — a salvaguarda do abastecimento: "Repetir o mesmo envio" usa a MESMA chave.
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
  'Há um envio anterior desta ação no apontamento sem resposta do servidor — ele pode ter sido gravado. Consulte as linhas do apontamento antes.\n\n' +
  'Descartar e enviar: abandona o envio anterior e envia este conteúdo.\nManter: nada é enviado agora; repita aquele envio para concluí-lo sem duplicar.';
const MENSAGEM_NOVO_ENVIO =
  'Há uma linha IGUAL a esta sem resposta do servidor — ela pode ter sido gravada. Consulte as linhas do apontamento antes.\n\n' +
  'Enviar como novo: grava OUTRA linha (para produto, outra baixa de estoque).\n' +
  'Manter: nada é enviado agora; repita aquele envio ("Repetir o mesmo envio") para concluí-lo sem duplicar.';
const perguntarDescarte = () =>
  confirmar({ titulo: 'Envio anterior sem resposta', descricao: MENSAGEM_DESCARTE, textoConfirmar: 'Descartar e enviar', textoCancelar: 'Manter', perigo: true });
const perguntarNovoEnvio = () =>
  confirmar({ titulo: 'Linha igual sem resposta', descricao: MENSAGEM_NOVO_ENVIO, textoConfirmar: 'Enviar como novo', textoCancelar: 'Manter', perigo: true });

/**
 * @typedef {{ escopo: string, storage?: Storage|null, retentativa?: boolean,
 *   confirmarDescarte?: (m: string) => boolean | Promise<boolean>,
 *   confirmarNovoEnvio?: (m: string) => boolean | Promise<boolean> }} OpcoesDeEnvio
 */

/**
 * @param {{ acao: string, alvo: string, empresaId: string, corpo: Record<string, any>, opcoes: OpcoesDeEnvio,
 *   enviar: (operationId: string) => Promise<any> }} p
 */
const enviarLinha = (p) =>
  enviarComPendencia({
    escopo: escopoDaPendencia(p.opcoes?.escopo),
    acao: p.acao,
    empresaId: p.empresaId,
    alvo: p.alvo,
    conteudo: p.corpo,
    enviar: p.enviar,
    storage: storageDaPendencia(p.opcoes?.storage),
    retentativa: p.opcoes?.retentativa === true,
    confirmarDescarte: p.opcoes?.confirmarDescarte ?? perguntarDescarte,
    confirmarNovoEnvio: p.opcoes?.confirmarNovoEnvio ?? perguntarNovoEnvio,
  });

/**
 * Adiciona UMA linha (produto, máquina, mão de obra ou serviço) ao apontamento CONFIRMADO: o corpo da janela
 * (`corpoDaLinhaProduto` / `corpoDaLinhaMaquina` / `corpoDaLinhaMaoObra` / `corpoDaLinhaServico`), a `versao` do apontamento lida e o `operation_id` persistente. Devolve
 * `{ apontamento, atividade, alertas }` (o apontamento com as linhas).
 * @param {TipoDeLinha} tipo @param {string} atividadeId @param {{ id: string, versao: number }} apontamento
 * @param {Record<string, any>} corpoLinha @param {OpcoesDeEnvio} opcoes
 */
export const adicionarLinha = async (tipo, atividadeId, apontamento, corpoLinha, opcoes) => {
  const empresaId = fazenda('adicionarLinha', RESOURCE_APONTAMENTO);
  const atv = String(atividadeId ?? '');
  const apId = String(apontamento?.id ?? '');
  const corpo = { ...comoObjeto(corpoLinha), empresa_id: empresaId, versao: apontamento?.versao };
  return enviarLinha({
    acao: ACAO_LANCAR_LINHA,
    alvo: alvoDasLinhas(tipo, apId),
    empresaId,
    corpo,
    opcoes,
    enviar: (operationId) => createAtividadeLinha(tipo, atv, apId, { ...corpo, operation_id: operationId }),
  });
};

/**
 * Edita UMA linha CONFIRMADA (produto: estorno exato + nova saída; máquina, mão de obra e serviço: cancela e cria outra): só o que mudou, a
 * `versao` do apontamento e o `operation_id` persistente.
 * @param {TipoDeLinha} tipo @param {string} atividadeId @param {{ id: string, versao: number }} apontamento
 * @param {{ id: string }} linha @param {Record<string, any>} mudancas @param {OpcoesDeEnvio} opcoes
 */
export const editarLinha = async (tipo, atividadeId, apontamento, linha, mudancas, opcoes) => {
  const empresaId = fazenda('editarLinha', RESOURCE_APONTAMENTO);
  const atv = String(atividadeId ?? '');
  const apId = String(apontamento?.id ?? '');
  const linhaId = String(linha?.id ?? '');
  const corpo = { ...comoObjeto(mudancas), empresa_id: empresaId, versao: apontamento?.versao };
  return enviarLinha({
    acao: ACAO_EDITAR_LINHA,
    alvo: alvoDaLinha(tipo, linhaId),
    empresaId,
    corpo,
    opcoes,
    enviar: (operationId) => updateAtividadeLinha(tipo, atv, apId, linhaId, { ...corpo, operation_id: operationId }),
  });
};

/**
 * Cancela UMA linha CONFIRMADA (produto: estorno exato aos lotes de origem): motivo de 3 a 500 caracteres (conferido
 * ANTES da rede), a `versao` do apontamento e o `operation_id` persistente.
 * @param {TipoDeLinha} tipo @param {string} atividadeId @param {{ id: string, versao: number }} apontamento
 * @param {{ id: string }} linha @param {string} motivo @param {OpcoesDeEnvio} opcoes
 */
export const cancelarLinha = async (tipo, atividadeId, apontamento, linha, motivo, opcoes) => {
  const empresaId = fazenda('cancelarLinha', RESOURCE_APONTAMENTO);
  const limpo = motivoValido(motivo, 'cancelarLinha', RESOURCE_APONTAMENTO);
  const atv = String(atividadeId ?? '');
  const apId = String(apontamento?.id ?? '');
  const linhaId = String(linha?.id ?? '');
  const corpo = { empresa_id: empresaId, versao: apontamento?.versao, motivo: limpo };
  return enviarLinha({
    acao: ACAO_CANCELAR_LINHA,
    alvo: alvoDaLinha(tipo, linhaId),
    empresaId,
    corpo,
    opcoes,
    enviar: (operationId) => cancelAtividadeLinha(tipo, atv, apId, linhaId, { ...corpo, operation_id: operationId }),
  });
};

/**
 * Pendência (envio sem resposta) desta ação: `{ operation_id, conteudo }` ou null.
 * @param {string} escopo @param {string} acao @param {string} alvo @param {Storage|null} [storage]
 */
export const pendenciaDaLinha = (escopo, acao, alvo, storage) =>
  fazendaDaTela ? lerPendenciaLancamento(escopoDaPendencia(escopo), acao, fazendaDaTela, alvo, storageDaPendencia(storage)) : null;

/** O envio pendente apareceu gravado ("Consultar"): a pendência sai. @param {string} escopo @param {string} acao @param {string} alvo @param {Storage|null} [storage] */
export const limparPendenciaDaLinha = (escopo, acao, alvo, storage) => {
  if (fazendaDaTela) limparPendenciaLancamento(escopoDaPendencia(escopo), acao, fazendaDaTela, alvo, storageDaPendencia(storage));
};

/**
 * Totais da atividade (totalizador do cabeçalho): área executada / planejada, total por produto, uso por máquina,
 * custo acumulado e custo/ha. Só linhas confirmadas de apontamentos confirmados.
 * @param {string} atividadeId
 */
export const obterTotaisAtividade = async (atividadeId) => getAtividadeTotais(String(atividadeId ?? ''), fazenda('obterTotaisAtividade'));

/**
 * Leitura do medidor de UM bem na data do apontamento (tipo e unidade do medidor, leitura vigente, teto do salto).
 * Sem fazenda ou sem bem: `null`, nada é lido.
 * @param {string|null} bemId @param {string|null} [dia]
 */
export const obterMedidorDoBem = async (bemId, dia = null) => {
  if (!fazendaDaTela || !textoOuIndefinido(bemId)) return null;
  return getMedidorAtividade({ empresa_id: fazendaDaTela, bem_id: String(bemId).trim(), data: textoOuIndefinido(dia) });
};

// ─── Opções da tela ──────────────────────────────────────────────────────

const SEM_OPCOES = Object.freeze({ itens: [], has_more: false, next_cursor: null });

/**
 * @param {'bens'|'operadores'|'produtos'|'implementos'|'locais'|'mao-obra'|'servicos'|'parceiros-servico'} recurso
 * @param {{ q?: string, cursor?: string|null, limit?: number, atividade_id?: string|null, produto_id?: string|null }} [opts]
 */
const opcoes = async (recurso, opts = {}) => {
  if (!fazendaDaTela) return { ...SEM_OPCOES, itens: [] };
  const o = comoObjeto(opts);
  return listOpcoesAtividade(recurso, {
    empresa_id: fazendaDaTela,
    q: textoOuIndefinido(o.q),
    cursor: textoOuIndefinido(o.cursor),
    limit: Number.isInteger(o.limit) && o.limit > 0 ? o.limit : undefined,
    ...(textoOuIndefinido(o.atividade_id) ? { atividade_id: textoOuIndefinido(o.atividade_id) } : {}),
    ...(textoOuIndefinido(o.produto_id) ? { produto_id: textoOuIndefinido(o.produto_id) } : {}),
  });
};

/**
 * Produtos ATIVOS da fazenda para a linha de produto: os já usados NESTA atividade primeiro (favoritos, ordem do
 * servidor), cada um com a unidade do estoque (`unidade_principal_estoque`).
 * @param {string|null} atividadeId @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 */
export const listarOpcoesProdutos = (atividadeId, opts = {}) => opcoes('produtos', { ...comoObjeto(opts), atividade_id: atividadeId });

/**
 * Locais com saldo de UM produto nesta fazenda (`{ itens: [{ local_estoque_id, local_nome, disponivel, unidade }] }`).
 * Sem produto: vazio, nada é lido.
 * @param {string|null} produtoId
 */
export const listarLocaisDoProduto = async (produtoId) => {
  if (!textoOuIndefinido(produtoId)) return { ...SEM_OPCOES, itens: [] };
  return opcoes('locais', { produto_id: produtoId });
};

/**
 * Funcionários e terceiros para a linha de mão de obra (D-PROD-208): parceiros ATIVOS com o papel funcionário
 * (`origem: 'FUNCIONARIO'`) ou prestador de serviço (`origem: 'TERCEIRO'`) —
 * `{ id, nome, origem, funcionario_tipo, funcionario_custo_hora, funcionario_custo_diaria }`. O tipo do funcionário
 * sugere a medida e os custos de hora/diária são os do cadastro dele; o terceiro tem o custo sempre digitado.
 * @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 */
export const listarOpcoesMaoObra = (opts = {}) => opcoes('mao-obra', opts);

/**
 * Serviços ATIVOS da fazenda para a linha de serviço (`{ id, numero, nome, unidade, valor_referencia }`).
 * @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 */
export const listarOpcoesServicos = (opts = {}) => opcoes('servicos', opts);

/**
 * Parceiros ATIVOS com o papel de prestador de serviço (`{ id, nome }`) para o parceiro (opcional) da linha de serviço.
 * @param {{ q?: string, cursor?: string|null, limit?: number }} [opts]
 */
export const listarOpcoesParceirosServico = (opts = {}) => opcoes('parceiros-servico', opts);

/** Implementos ATIVOS da fazenda (natureza IMPLEMENTO) para a linha de máquina. @param {{ q?: string, cursor?: string|null, limit?: number }} [opts] */
export const listarOpcoesImplementos = (opts = {}) => opcoes('implementos', opts);

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
