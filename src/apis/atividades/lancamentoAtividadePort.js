/**
 * Porta nativa do Lançamento de Atividades (D-PROD-200, Fatia 2).
 *
 * Dois níveis: a ATIVIDADE (o cabeçalho aberto, "Cigarrinha Pasto 01") e os
 * APONTAMENTOS dela (um por dia e turno; a sequência 1, 2… no mesmo dia e turno
 * são as passadas). Contrato: docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md
 * (§4 rotas, §10 formato). Só online; tenant só no JWT, empresa na query da
 * leitura e no corpo da escrita.
 *
 * Todo corpo vai por ALLOWLIST (o servidor recusa qualquer outra chave com
 * 400): nada de `cliente_id`, número, sequência, snapshots do tipo, setor,
 * centros, unidade, status, autoria nem totais. Setor vem da área; centros e
 * unidade vêm do tipo; a sequência é do servidor. No apontamento, área, setor,
 * safra, centros, unidade e máquina são do cabeçalho: o corpo não os leva.
 *
 * Decimais vão como TEXTO (o servidor não faz coerção) e datas como AAAA-MM-DD.
 * Sem DELETE: a atividade e o apontamento só se CANCELAM (com motivo e a
 * `versao` lida). Os seletores de máquina e de operador têm rotas PRÓPRIAS da
 * tela (`/atividades-opcoes/…`): quem só tem esta tela não leva 403 das telas
 * de bens ou de usuários.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'Atividade';
const RESOURCE_APONTAMENTO = 'AtividadeApontamento';
const CAMINHO = '/atividades';
const CAMINHO_OPCOES = '/atividades-opcoes';
const CAMINHO_POR_AREA = '/atividades-por-area';
/** MAIKE-ENTREGA3 (D-PROD-276) — a reforma de pastagem (o agrupador). */
const CAMINHO_PLANEJAMENTOS = '/planejamentos';

/**
 * Seletores próprios da tela (guardados por "ver" da tela). D-PROD-202 (Fatia 3): produtos (os já usados na
 * atividade primeiro), locais com saldo de um produto, implementos e o medidor de um bem (tipo, unidade, leitura
 * vigente e teto do salto). Fatia 4: serviços ativos da fazenda e os parceiros prestadores de serviço; desde a
 * D-PROD-208, a mão de obra (`mao-obra`): parceiros ativos com o papel funcionário ou prestador de serviço (terceiro).
 */
export const RECURSOS_OPCOES_ATIVIDADE = Object.freeze([
  'bens',
  'operadores',
  'produtos',
  'locais',
  'implementos',
  'medidor',
  'mao-obra',
  'servicos',
  'parceiros-servico',
]);

// ─── Atividade (cabeçalho) ───────────────────────────────────────────────

/**
 * Dados que o formulário da atividade grava. Fora daqui (e recusados pelo
 * servidor): setor (herdado da área), centros e unidade (herdados do tipo).
 */
export const CAMPOS_DA_ATIVIDADE = Object.freeze([
  'nome',
  'area_id',
  'bem_id',
  'safra_ciclo',
  'data_inicio',
  'data_prevista_fim',
  'area_planejada',
  'lancamento_tarefa_id',
  'observacao',
]);

/** POST /atividades (§10): a empresa e o tipo, mais os dados. D-PROD-249: ou `areas[]` (várias áreas) no lugar de `area_id`. */
export const CAMPOS_DE_ABERTURA = Object.freeze(['empresa_id', 'tipo_atividade_id', ...CAMPOS_DA_ATIVIDADE, 'areas']);
/** D-PROD-249 — cada item de `areas[]` da abertura (a área planejada ausente = o tamanho da área, no servidor). */
export const CAMPOS_DA_AREA_NA_ABERTURA = Object.freeze(['area_id', 'area_planejada']);
/** D-PROD-249 — POST /atividades/:id/areas (mais uma área, PLANEJADA). */
export const CAMPOS_DE_ADICAO_AREA = Object.freeze(['empresa_id', 'area_id', 'area_planejada']);
/** D-PROD-249 — PATCH /atividades/:id/areas/:areaId (a área planejada; `null` limpa). */
export const CAMPOS_DE_EDICAO_AREA = Object.freeze(['empresa_id', 'versao', 'area_planejada']);
/** D-PROD-249 — as ações da área e o corpo de cada uma (a data é opcional: padrão hoje na fazenda). */
export const ACOES_DA_AREA = Object.freeze(
  /** @type {Record<string, readonly string[]>} */ ({
    iniciar: Object.freeze(['empresa_id', 'versao', 'data_inicio']),
    // D-PROD-292: e os hectares finais de cada área ("Fez o pasto todo?").
    concluir: Object.freeze(['empresa_id', 'versao', 'data_conclusao', 'areas']),
    reabrir: Object.freeze(['empresa_id', 'versao']),
    remover: Object.freeze(['empresa_id', 'versao']),
  }),
);
/** PATCH /atividades/:id (§10): os dados de abertura menos empresa e tipo (o tipo é imutável), mais a `versao` (CAS). */
export const CAMPOS_DE_EDICAO = Object.freeze(['versao', ...CAMPOS_DA_ATIVIDADE]);
/** POST /atividades/:id/concluir. */
export const CAMPOS_DE_CONCLUSAO = Object.freeze(['empresa_id', 'versao', 'data_conclusao', 'areas']);
/** POST /atividades/:id/reabrir. */
export const CAMPOS_DE_REABERTURA = Object.freeze(['empresa_id', 'versao', 'motivo']);
/** POST /atividades/:id/cancelar (cancela também os apontamentos confirmados). */
export const CAMPOS_DE_CANCELAMENTO = Object.freeze(['empresa_id', 'versao', 'motivo']);
/**
 * D-PROD-254 — POST /atividades/registrar: registrar o trabalho de campo de UMA área e de UM tipo num envio só (o servidor
 * acha ou abre a atividade do mês e grava o registro do dia com as linhas, numa transação). D-PROD-263: ou `areas[]`
 * (várias áreas, cada uma com os hectares feitos nela) no lugar de `area_id` (e sem `area_executada_dia`). D-PROD-265:
 * `data_termino` (opcional). D-PROD-267: `concluir` e `nova_atividade` (opcionais); a atividade aberta vale em qualquer mês.
 */
export const CAMPOS_DO_REGISTRO_DE_CAMPO = Object.freeze([
  'empresa_id',
  'area_id',
  'areas',
  'tipo_atividade_id',
  'data_operacional',
  // D-PROD-265: o último dia do serviço (Nova realização), opcional; vazio não vai (`corpoSemVazios`).
  'data_termino',
  // D-PROD-267: "Como fica depois de salvar? Concluída" e a resposta ao "serviço parado" (booleanos, só quando vêm).
  'concluir',
  'nova_atividade',
  // D-PROD-274: os campos de cada tipo — o plantio (capim e opcionais), o nº do receituário (Aplicação), o local do serviço
  // sem área e a unidade da quantidade feita (Manutenção e Outros). Só quando vêm.
  'plantio',
  'numero_receituario',
  'local',
  'unidade_producao_sigla',
  // D-PROD-276: a reforma de que a realização faz parte ("Faz parte de"), só quando vem.
  'planejamento_id',
  'operation_id',
  'safra_ciclo',
  'turno',
  'operador_usuario_id',
  'area_executada_dia',
  'quantidade_produzida_dia',
  'observacao',
  'origem',
  'produtos',
  'maquinas',
  'mao_obra',
  'servicos',
]);
/** D-PROD-263 — cada item de `areas[]` do registro de campo: a área e os hectares feitos nela. */
export const CAMPOS_DA_AREA_NO_REGISTRO = Object.freeze(['area_id', 'hectares']);
/** POST /atividades/:id/duplicar: abertura nova a partir desta (corpo opcional). */
export const CAMPOS_DE_DUPLICACAO = Object.freeze(['empresa_id', 'nome', 'data_inicio', 'data_prevista_fim']);

// ─── Apontamento (filho) ─────────────────────────────────────────────────

/** Dados do apontamento do dia. A sequência é do servidor; área, centros, unidade e máquina são do cabeçalho. */
export const CAMPOS_DO_APONTAMENTO = Object.freeze([
  'data_operacional',
  'turno',
  'operador_usuario_id',
  'area_executada_dia',
  'quantidade_produzida_dia',
  'observacao',
  'origem',
  // D-PROD-249: a área da atividade em que o lançamento é feito (obrigatória com várias áreas).
  'atividade_area_id',
]);

// ─── Linhas de produto e de máquina do apontamento (D-PROD-202, Fatia 3) ─

/**
 * Linha de PRODUTO: produto, local de onde sai e a quantidade na unidade do estoque do produto. A unidade, o custo
 * (FIFO) e a dose/ha são do servidor e nunca vão.
 */
// D-PROD-293: e o número do jato (texto), também na linha avulsa.
export const CAMPOS_DA_LINHA_PRODUTO = Object.freeze(['produto_id', 'local_estoque_id', 'quantidade', 'observacao', 'jato']);
/**
 * D-PROD-274 — a linha de insumo DENTRO do lançamento (`produtos[]` do apontamento, do duplicar e do registro de campo):
 * a de sempre e o VC (%) da semente, só quando preenchido. As rotas de UMA linha continuam com `CAMPOS_DA_LINHA_PRODUTO`.
 */
// D-PROD-283: e o número do jato (texto "1".."999"), só na linha de um jato.
export const CAMPOS_DA_LINHA_PRODUTO_DO_LANCAMENTO = Object.freeze([...CAMPOS_DA_LINHA_PRODUTO, 'vc_percentual']);
/**
 * Linha de MÁQUINA: o bem, o implemento (se o tipo permitir), as leituras inicial e final — ou `sem_medidor` com o
 * uso direto (`quantidade_uso`) — e a justificativa do salto. Tipo e unidade do medidor e custo são do bem (snapshot no
 * servidor) e nunca vão.
 */
export const CAMPOS_DA_LINHA_MAQUINA = Object.freeze([
  'bem_id',
  'implemento_bem_id',
  'leitura_inicial',
  'leitura_final',
  'sem_medidor',
  'quantidade_uso',
  'justificativa_salto',
  'observacao',
]);
/**
 * Linha de MÃO DE OBRA (Fatia 4; D-PROD-208): o parceiro (funcionário ou terceiro), a medida (HORA | DIARIA | TAREFA),
 * a quantidade e o custo unitário digitado — na tarefa do funcionário e SEMPRE no terceiro (hora e diária do
 * funcionário vêm do cadastro dele, snapshot no servidor). A origem e o total são do servidor.
 */
export const CAMPOS_DA_LINHA_MAO_OBRA = Object.freeze(['parceiro_id', 'tipo_medida', 'quantidade', 'custo_unitario', 'observacao']);
/**
 * Linha de SERVIÇO (Fatia 4): o serviço, o parceiro prestador (opcional), a quantidade (na unidade do serviço), o valor
 * unitário e o documento. A unidade (snapshot) e o total são do servidor.
 */
export const CAMPOS_DA_LINHA_SERVICO = Object.freeze(['servico_id', 'fornecedor_parceiro_id', 'quantidade', 'valor_unitario', 'documento_referencia', 'observacao']);
/** Toda escrita de linha leva a empresa, a `versao` do APONTAMENTO (CAS) e o `operation_id` (idempotência). */
const ENVELOPE_DA_LINHA = Object.freeze(['empresa_id', 'versao', 'operation_id']);
/** POST …/apontamentos/:apId/produtos. */
export const CAMPOS_DE_CRIACAO_LINHA_PRODUTO = Object.freeze([...ENVELOPE_DA_LINHA, ...CAMPOS_DA_LINHA_PRODUTO]);
/** PATCH …/produtos/:linhaId (estorno exato + nova saída, no servidor). */
export const CAMPOS_DE_EDICAO_LINHA_PRODUTO = Object.freeze([...ENVELOPE_DA_LINHA, ...CAMPOS_DA_LINHA_PRODUTO]);
/** POST …/apontamentos/:apId/maquinas. */
export const CAMPOS_DE_CRIACAO_LINHA_MAQUINA = Object.freeze([...ENVELOPE_DA_LINHA, ...CAMPOS_DA_LINHA_MAQUINA]);
/** PATCH …/maquinas/:linhaId (cancela a linha e cria outra, no servidor). */
export const CAMPOS_DE_EDICAO_LINHA_MAQUINA = Object.freeze([...ENVELOPE_DA_LINHA, ...CAMPOS_DA_LINHA_MAQUINA]);
/** POST …/apontamentos/:apId/mao-obra · PATCH …/mao-obra/:linhaId (cancela a linha e cria outra, no servidor). */
export const CAMPOS_DE_CRIACAO_LINHA_MAO_OBRA = Object.freeze([...ENVELOPE_DA_LINHA, ...CAMPOS_DA_LINHA_MAO_OBRA]);
export const CAMPOS_DE_EDICAO_LINHA_MAO_OBRA = Object.freeze([...ENVELOPE_DA_LINHA, ...CAMPOS_DA_LINHA_MAO_OBRA]);
/** POST …/apontamentos/:apId/servicos · PATCH …/servicos/:linhaId (cancela a linha e cria outra, no servidor). */
export const CAMPOS_DE_CRIACAO_LINHA_SERVICO = Object.freeze([...ENVELOPE_DA_LINHA, ...CAMPOS_DA_LINHA_SERVICO]);
export const CAMPOS_DE_EDICAO_LINHA_SERVICO = Object.freeze([...ENVELOPE_DA_LINHA, ...CAMPOS_DA_LINHA_SERVICO]);
/** POST …/{produtos|maquinas|mao-obra|servicos}/:linhaId/cancelar. */
export const CAMPOS_DE_CANCELAMENTO_LINHA = Object.freeze([...ENVELOPE_DA_LINHA, 'motivo']);

/** Coleções de linhas embutidas no corpo do lançamento (e do duplicar) → a allowlist de cada item. */
const COLECOES_DE_LINHAS = Object.freeze(
  /** @type {Record<string, readonly string[]>} */ ({
    produtos: CAMPOS_DA_LINHA_PRODUTO_DO_LANCAMENTO,
    maquinas: CAMPOS_DA_LINHA_MAQUINA,
    mao_obra: CAMPOS_DA_LINHA_MAO_OBRA,
    servicos: CAMPOS_DA_LINHA_SERVICO,
  }),
);

/**
 * POST /atividades/:id/apontamentos: o dia e, desde a Fatia 3, as linhas (`produtos[]`, `maquinas[]`; Fatia 4:
 * `mao_obra[]`, `servicos[]`) com um `operation_id`.
 */
export const CAMPOS_DE_CRIACAO_APONTAMENTO = Object.freeze(['empresa_id', ...CAMPOS_DO_APONTAMENTO, 'operation_id', 'produtos', 'maquinas', 'mao_obra', 'servicos']);
/**
 * PATCH /atividades/:id/apontamentos/:apontamentoId (§10): os mesmos campos de dado, mais a `versao`. A origem é
 * gravada no lançamento e não muda na edição: o schema fechado do servidor a recusa (400), então ela não vai.
 */
export const CAMPOS_DE_EDICAO_APONTAMENTO = Object.freeze(['versao', ...CAMPOS_DO_APONTAMENTO.filter((c) => c !== 'origem')]);
/** POST …/:apontamentoId/cancelar. */
export const CAMPOS_DE_CANCELAMENTO_APONTAMENTO = Object.freeze(['empresa_id', 'versao', 'motivo']);
/**
 * POST …/:apontamentoId/duplicar ("Repetir"): o dia (padrão hoje no servidor) e, desde a Fatia 3, as linhas com um
 * `operation_id` (a tela manda o "Repetir" com linhas pela criação; a rota aceita o mesmo corpo).
 */
export const CAMPOS_DE_DUPLICACAO_APONTAMENTO = Object.freeze(['empresa_id', 'data_operacional', 'atividade_area_id', 'operation_id', 'produtos', 'maquinas', 'mao_obra', 'servicos']);

/**
 * Linhas embutidas no corpo da criação do apontamento: cada item só com as chaves da linha (sem envelope: o
 * `operation_id` e a empresa são os do apontamento), sem as vazias. Lista vazia ou ausente fica fora do corpo.
 * @param {unknown} linhas @param {readonly string[]} permitidos
 */
const linhasDeEnvio = (linhas, permitidos) => {
  if (!Array.isArray(linhas)) return undefined;
  const itens = linhas
    .filter((l) => l && typeof l === 'object' && !Array.isArray(l))
    .map((l) => corpoSemVazios(/** @type {Record<string, unknown>} */ (l), permitidos));
  return itens.length ? itens : undefined;
};

/**
 * Corpo da criação (e do duplicar) do apontamento: os campos do dia sem os vazios e, quando houver, as linhas por
 * allowlist.
 * @param {Record<string, unknown>} dados @param {readonly string[]} [permitidos]
 */
export const corpoDaCriacaoDoApontamento = (dados, permitidos = CAMPOS_DE_CRIACAO_APONTAMENTO) => {
  const d = /** @type {Record<string, unknown>} */ (dados ?? {});
  const corpo = corpoSemVazios(d, permitidos.filter((c) => !Object.prototype.hasOwnProperty.call(COLECOES_DE_LINHAS, c)));
  for (const [colecao, campos] of Object.entries(COLECOES_DE_LINHAS)) {
    if (!permitidos.includes(colecao)) continue;
    const itens = linhasDeEnvio(d[colecao], campos);
    if (itens) corpo[colecao] = itens;
  }
  return corpo;
};

// ─── Leitura ─────────────────────────────────────────────────────────────

/** Filtros da lista (query FECHADA no servidor: nada além disso vai). Datas sobre `data_inicio`. D-PROD-267: `situacao` e `tipo_fixo`. */
// D-PROD-276: `planejamento_id` (o filtro "Reforma").
// D-PROD-274: `local` (o serviço sem área no local; a prévia da Nova realização sem área).
const FILTROS_LISTA = Object.freeze(['empresa_id', 'status', 'situacao', 'tipo_fixo', 'tipo_atividade_id', 'area_id', 'planejamento_id', 'data_de', 'data_ate', 'local', 'limit', 'cursor']);
/** D-PROD-276 — a criação da reforma (o "Planejar"): os 4 campos (o nome, o número e a safra são do servidor). */
export const CAMPOS_DA_REFORMA = Object.freeze(['empresa_id', 'tipo', 'areas', 'cultura_alvo_id', 'data_inicio']);
/** D-PROD-276 — cada área da reforma: a área e os hectares dela na reforma. */
export const CAMPOS_DA_AREA_NA_REFORMA = Object.freeze(['area_id', 'hectares']);
/** D-PROD-276 — concluir a reforma (com a troca do capim, se o dono quiser) e cancelar. */
export const CAMPOS_DA_CONCLUSAO_DA_REFORMA = Object.freeze(['empresa_id', 'versao', 'data_conclusao', 'trocar_capim']);
export const CAMPOS_DO_CANCELAMENTO_DA_REFORMA = Object.freeze(['empresa_id', 'versao']);
const FILTROS_OPCOES = Object.freeze(['empresa_id', 'q', 'limit', 'cursor']);
/** Query de cada seletor da Fatia 3 (fechada no servidor). */
const FILTROS_POR_RECURSO = Object.freeze(
  /** @type {Record<string, readonly string[]>} */ ({
    produtos: Object.freeze(['empresa_id', 'atividade_id', 'q', 'limit', 'cursor']),
    locais: Object.freeze(['empresa_id', 'produto_id']),
    implementos: FILTROS_OPCOES,
    medidor: Object.freeze(['empresa_id', 'bem_id', 'data']),
  }),
);

/** @param {string} operation @param {Record<string, unknown>} [details] @param {string} [resource] */
const ctx = (operation, details, resource = RESOURCE) => ({ operation, resource, ...(details ? { details } : {}) });

/** @param {unknown} valor */
const valorDeEnvio = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/**
 * Só as chaves permitidas, na forma de envio: texto vazio vira `null` (limpa o
 * campo opcional na EDIÇÃO) e `undefined` fica ausente.
 * @param {Record<string, unknown>} dados @param {readonly string[]} permitidos
 */
export const corpoDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = valorDeEnvio(/** @type {Record<string, unknown>} */ (dados)[campo]);
    if (valor !== undefined) corpo[campo] = valor;
  }
  return corpo;
};

/**
 * Corpo de CRIAÇÃO (abrir, duplicar, ações, novo apontamento): as chaves
 * permitidas sem as vazias. O opcional não informado fica AUSENTE (o servidor
 * aplica o padrão), nunca `null`.
 * @param {Record<string, unknown>} dados @param {readonly string[]} permitidos
 */
export const corpoSemVazios = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const [campo, valor] of Object.entries(corpoDeEnvio(dados, permitidos))) {
    if (valor !== null) corpo[campo] = valor;
  }
  return corpo;
};

/**
 * Caminho com só as chaves permitidas, sem vazio.
 * @param {string} caminho @param {readonly string[]} permitidas @param {Record<string, unknown>} filtros
 */
const comFiltros = (caminho, permitidas, filtros) => {
  const params = new URLSearchParams();
  for (const chave of permitidas) {
    const valor = filtros[chave];
    if (valor === undefined || valor === null) continue;
    const texto = typeof valor === 'string' ? valor.trim() : String(valor);
    if (texto) params.set(chave, texto);
  }
  const qs = params.toString();
  return qs ? `${caminho}?${qs}` : caminho;
};

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagem = (filtros = {}) => comFiltros(CAMINHO, FILTROS_LISTA, filtros);

/** @param {string} recurso @param {Record<string, unknown>} [filtros] */
export const montarCaminhoOpcoes = (recurso, filtros = {}) => {
  const caminho = comFiltros(`${CAMINHO_OPCOES}/${encodeURIComponent(recurso)}`, FILTROS_POR_RECURSO[recurso] ?? FILTROS_OPCOES, filtros);
  if (recurso !== 'bens') return caminho;
  // Máquina da atividade: só MAQUINA, VEICULO e EQUIPAMENTO (como a tela antiga); nunca benfeitoria ou implemento.
  const params = new URLSearchParams();
  for (const natureza of NATUREZAS_MAQUINA_ATIVIDADE) params.append('natureza', natureza);
  return `${caminho}${caminho.includes('?') ? '&' : '?'}${params.toString()}`;
};

/** Naturezas de bem aceitas como máquina da atividade. */
export const NATUREZAS_MAQUINA_ATIVIDADE = Object.freeze(['MAQUINA', 'VEICULO', 'EQUIPAMENTO']);

/** @param {string} id */
const daAtividade = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;
/** @param {string} atividadeId @param {string} [apontamentoId] */
const doApontamento = (atividadeId, apontamentoId) =>
  `${daAtividade(atividadeId)}/apontamentos${apontamentoId ? `/${encodeURIComponent(apontamentoId)}` : ''}`;
/**
 * Tipo de linha (o segmento da rota) → allowlists e nome da operação.
 * @typedef {'produtos'|'maquinas'|'mao-obra'|'servicos'} TipoDeLinha
 */
const DO_TIPO_DE_LINHA = Object.freeze(
  /** @type {Record<string, { criacao: readonly string[], edicao: readonly string[], nome: string }>} */ ({
    produtos: { criacao: CAMPOS_DE_CRIACAO_LINHA_PRODUTO, edicao: CAMPOS_DE_EDICAO_LINHA_PRODUTO, nome: 'Produto' },
    maquinas: { criacao: CAMPOS_DE_CRIACAO_LINHA_MAQUINA, edicao: CAMPOS_DE_EDICAO_LINHA_MAQUINA, nome: 'Maquina' },
    'mao-obra': { criacao: CAMPOS_DE_CRIACAO_LINHA_MAO_OBRA, edicao: CAMPOS_DE_EDICAO_LINHA_MAO_OBRA, nome: 'MaoObra' },
    servicos: { criacao: CAMPOS_DE_CRIACAO_LINHA_SERVICO, edicao: CAMPOS_DE_EDICAO_LINHA_SERVICO, nome: 'Servico' },
  }),
);
/** Allowlists do tipo (o desconhecido cai na de máquina; a API confere o tipo antes). @param {string} tipo */
const doTipo = (tipo) => DO_TIPO_DE_LINHA[tipo] ?? DO_TIPO_DE_LINHA.maquinas;

/** @param {string} atividadeId @param {string} apontamentoId @param {TipoDeLinha} tipo @param {string} [linhaId] */
const daLinha = (atividadeId, apontamentoId, tipo, linhaId) =>
  `${doApontamento(atividadeId, apontamentoId)}/${tipo}${linhaId ? `/${encodeURIComponent(linhaId)}` : ''}`;
/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;

export const operacoesNativas = Object.freeze({
  // ── Atividade ──
  /** @param {Record<string, unknown>} [filtros] */
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listAtividadesPage')),

  /** Cabeçalho com os objetos (tipo, área, setor, máquina, centros, unidade, tarefa) e os totais. @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(daAtividade(id), empresaId), { autenticado: true }, ctx('getAtividade', { id })),

  /** @param {Record<string, unknown>} dados */
  create: (dados) => {
    const corpo = corpoSemVazios(dados, CAMPOS_DE_ABERTURA);
    // D-PROD-249: cada área só com as chaves dela (sem as vazias: a planejada ausente vira o tamanho no servidor).
    const areas = linhasDeEnvio(dados?.areas, CAMPOS_DA_AREA_NA_ABERTURA);
    if (areas) corpo.areas = areas;
    else delete corpo.areas;
    return nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createAtividade'));
  },

  /** @param {string} id @param {Record<string, unknown>} dados */
  update: (id, dados) =>
    nativeRequest(daAtividade(id), { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_EDICAO), autenticado: true }, ctx('updateAtividade', { id })),

  /** @param {string} id @param {Record<string, unknown>} dados */
  concluir: (id, dados) =>
    nativeRequest(
      `${daAtividade(id)}/concluir`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_CONCLUSAO), autenticado: true },
      ctx('completeAtividade', { id }),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  reabrir: (id, dados) =>
    nativeRequest(
      `${daAtividade(id)}/reabrir`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_REABERTURA), autenticado: true },
      ctx('reopenAtividade', { id }),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  cancelar: (id, dados) =>
    nativeRequest(
      `${daAtividade(id)}/cancelar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_CANCELAMENTO), autenticado: true },
      ctx('cancelAtividade', { id }),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  duplicar: (id, dados) =>
    nativeRequest(
      `${daAtividade(id)}/duplicar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_DUPLICACAO), autenticado: true },
      ctx('duplicateAtividade', { id }),
    ),

  // ── Apontamentos da atividade ──
  /** `{ items }` sem paginação (dia desc, turno, sequência). @param {string} atividadeId @param {string} empresaId */
  listApontamentos: (atividadeId, empresaId) =>
    nativeRequest(
      comEmpresa(doApontamento(atividadeId), empresaId),
      { autenticado: true },
      ctx('listAtividadeApontamentos', { atividadeId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {string} apontamentoId @param {string} empresaId */
  getApontamento: (atividadeId, apontamentoId, empresaId) =>
    nativeRequest(
      comEmpresa(doApontamento(atividadeId, apontamentoId), empresaId),
      { autenticado: true },
      ctx('getAtividadeApontamento', { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {Record<string, unknown>} dados */
  createApontamento: (atividadeId, dados) =>
    nativeRequest(
      doApontamento(atividadeId),
      { method: 'POST', body: corpoDaCriacaoDoApontamento(dados), autenticado: true },
      ctx('createAtividadeApontamento', { atividadeId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} dados */
  updateApontamento: (atividadeId, apontamentoId, dados) =>
    nativeRequest(
      doApontamento(atividadeId, apontamentoId),
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_EDICAO_APONTAMENTO), autenticado: true },
      ctx('updateAtividadeApontamento', { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} dados */
  cancelarApontamento: (atividadeId, apontamentoId, dados) =>
    nativeRequest(
      `${doApontamento(atividadeId, apontamentoId)}/cancelar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_CANCELAMENTO_APONTAMENTO), autenticado: true },
      ctx('cancelAtividadeApontamento', { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} dados */
  duplicarApontamento: (atividadeId, apontamentoId, dados) =>
    nativeRequest(
      `${doApontamento(atividadeId, apontamentoId)}/duplicar`,
      { method: 'POST', body: corpoDaCriacaoDoApontamento(dados, CAMPOS_DE_DUPLICACAO_APONTAMENTO), autenticado: true },
      ctx('duplicateAtividadeApontamento', { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  // ── Registro de campo e leituras da área (D-PROD-254) ──
  /** @param {Record<string, unknown>} dados */
  registrar: (dados) => {
    const corpo = corpoDaCriacaoDoApontamento(dados, CAMPOS_DO_REGISTRO_DE_CAMPO.filter((c) => c !== 'areas'));
    // D-PROD-263: cada área só com as chaves dela (área e hectares).
    const areas = linhasDeEnvio(/** @type {any} */ (dados)?.areas, CAMPOS_DA_AREA_NO_REGISTRO);
    if (areas) corpo.areas = areas;
    return nativeRequest(`${CAMINHO}/registrar`, { method: 'POST', body: corpo, autenticado: true }, ctx('registrarAtividadeDeCampo', {}, RESOURCE_APONTAMENTO));
  },

  /** Atividades da área e custos do mês. @param {string} areaId @param {string} empresaId */
  resumoDaArea: (areaId, empresaId) =>
    nativeRequest(comEmpresa(`${CAMINHO_POR_AREA}/${encodeURIComponent(areaId)}/resumo`, empresaId), { autenticado: true }, ctx('getAtividadesDaAreaResumo', { areaId })),

  /** Registros de campo da área (keyset). @param {string} areaId @param {Record<string, unknown>} filtros */
  registrosDaArea: (areaId, filtros) => {
    const f = /** @type {Record<string, any>} */ (filtros ?? {});
    const params = new URLSearchParams();
    for (const k of ['empresa_id', 'limit', 'cursor', 'tipo_atividade_id']) {
      if (f[k] !== undefined && f[k] !== null && String(f[k]) !== '') params.set(k, String(f[k]));
    }
    return nativeRequest(`${CAMINHO_POR_AREA}/${encodeURIComponent(areaId)}/registros?${params.toString()}`, { autenticado: true }, ctx('listAtividadesDaAreaRegistros', { areaId }));
  },

  // ── A reforma de pastagem (D-PROD-276) ──
  /** As reformas da fazenda (abertas primeiro). @param {Record<string, unknown>} filtros */
  listarReformas: (filtros) => {
    const f = /** @type {Record<string, any>} */ (filtros ?? {});
    const params = new URLSearchParams();
    for (const k of ['empresa_id', 'status', 'area_id']) {
      if (f[k] !== undefined && f[k] !== null && String(f[k]) !== '') params.set(k, String(f[k]));
    }
    return nativeRequest(`${CAMINHO_PLANEJAMENTOS}?${params.toString()}`, { autenticado: true }, ctx('listPlanejamentos'));
  },

  /** A reforma e o custo dela (total, R$/ha, por tipo e os serviços). @param {string} id @param {string} empresaId */
  obterReforma: (id, empresaId) =>
    nativeRequest(comEmpresa(`${CAMINHO_PLANEJAMENTOS}/${encodeURIComponent(id)}`, empresaId), { autenticado: true }, ctx('getPlanejamento', { id })),

  /** O "Planejar" da reforma. @param {Record<string, unknown>} dados */
  criarReforma: (dados) => {
    const corpo = corpoSemVazios(dados, CAMPOS_DA_REFORMA.filter((c) => c !== 'areas'));
    const areas = linhasDeEnvio(/** @type {any} */ (dados)?.areas, CAMPOS_DA_AREA_NA_REFORMA);
    if (areas) corpo.areas = areas;
    return nativeRequest(CAMINHO_PLANEJAMENTOS, { method: 'POST', body: corpo, autenticado: true }, ctx('createPlanejamento'));
  },

  /** @param {string} id @param {Record<string, unknown>} dados */
  concluirReforma: (id, dados) =>
    nativeRequest(
      `${CAMINHO_PLANEJAMENTOS}/${encodeURIComponent(id)}/concluir`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DA_CONCLUSAO_DA_REFORMA), autenticado: true },
      ctx('completePlanejamento', { id }),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  cancelarReforma: (id, dados) =>
    nativeRequest(
      `${CAMINHO_PLANEJAMENTOS}/${encodeURIComponent(id)}/cancelar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DO_CANCELAMENTO_DA_REFORMA), autenticado: true },
      ctx('cancelPlanejamento', { id }),
    ),

  // ── Áreas da atividade (D-PROD-249) ──
  /** @param {string} atividadeId @param {Record<string, unknown>} dados */
  adicionarArea: (atividadeId, dados) =>
    nativeRequest(`${daAtividade(atividadeId)}/areas`, { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_ADICAO_AREA), autenticado: true }, ctx('addAtividadeArea', { atividadeId })),

  /** @param {string} atividadeId @param {string} areaId @param {Record<string, unknown>} dados */
  editarArea: (atividadeId, areaId, dados) =>
    nativeRequest(
      `${daAtividade(atividadeId)}/areas/${encodeURIComponent(areaId)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_EDICAO_AREA), autenticado: true },
      ctx('updateAtividadeArea', { atividadeId, areaId }),
    ),

  /** @param {string} atividadeId @param {string} areaId @param {'iniciar'|'concluir'|'reabrir'|'remover'} acao @param {Record<string, unknown>} dados */
  acaoArea: (atividadeId, areaId, acao, dados) =>
    nativeRequest(
      `${daAtividade(atividadeId)}/areas/${encodeURIComponent(areaId)}/${acao}`,
      { method: 'POST', body: corpoSemVazios(dados, ACOES_DA_AREA[acao] ?? ACOES_DA_AREA.reabrir), autenticado: true },
      ctx('actionAtividadeArea', { atividadeId, areaId, acao }),
    ),

  // ── Totais da atividade (Fatia 3) ──
  /** Área executada / planejada, total por produto e por máquina, custo e custo/ha. @param {string} id @param {string} empresaId */
  totais: (id, empresaId) => nativeRequest(comEmpresa(`${daAtividade(id)}/totais`, empresaId), { autenticado: true }, ctx('getAtividadeTotais', { id })),

  // ── Linhas de produto e de máquina (Fatia 3), mão de obra e serviço (Fatia 4) ──
  /**
   * @param {TipoDeLinha} tipo @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} dados
   */
  criarLinha: (tipo, atividadeId, apontamentoId, dados) =>
    nativeRequest(
      daLinha(atividadeId, apontamentoId, tipo),
      { method: 'POST', body: corpoSemVazios(dados, doTipo(tipo).criacao), autenticado: true },
      ctx(`createAtividadeLinha${doTipo(tipo).nome}`, { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  /**
   * @param {TipoDeLinha} tipo @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId
   * @param {Record<string, unknown>} dados
   */
  editarLinha: (tipo, atividadeId, apontamentoId, linhaId, dados) =>
    nativeRequest(
      daLinha(atividadeId, apontamentoId, tipo, linhaId),
      { method: 'PATCH', body: corpoDeEnvio(dados, doTipo(tipo).edicao), autenticado: true },
      ctx(`updateAtividadeLinha${doTipo(tipo).nome}`, { atividadeId, apontamentoId, linhaId }, RESOURCE_APONTAMENTO),
    ),

  /**
   * @param {TipoDeLinha} tipo @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId
   * @param {Record<string, unknown>} dados
   */
  cancelarLinha: (tipo, atividadeId, apontamentoId, linhaId, dados) =>
    nativeRequest(
      `${daLinha(atividadeId, apontamentoId, tipo, linhaId)}/cancelar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_CANCELAMENTO_LINHA), autenticado: true },
      ctx(`cancelAtividadeLinha${doTipo(tipo).nome}`, { atividadeId, apontamentoId, linhaId }, RESOURCE_APONTAMENTO),
    ),

  // ── Opções da tela ──
  /** @param {string} recurso @param {Record<string, unknown>} [filtros] */
  opcoes: (recurso, filtros = {}) =>
    nativeRequest(montarCaminhoOpcoes(recurso, filtros), { autenticado: true }, ctx('listOpcoesAtividade', { recurso })),
});

// D-PROD-294: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/atividades?empresa_id={empresa}&limit=100',
  '/planejamentos?empresa_id={empresa}',
]);
