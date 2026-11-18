/**
 * Serviço do CABEÇALHO do Lançamento de Atividades (`Atividade`, D-PROD-200,
 * Fatia 2; contrato `docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md`
 * §3, §4 e §10). A atividade é a operação aberta ("Cigarrinha Pasto 01"); os
 * apontamentos do dia e do turno são filhos dela
 * (`atividadeApontamentoService.js`).
 *
 * Regras:
 *  - ABRIR: tipo existente e ativo, com o grupo ativo (senão 422
 *    `ATIVIDADE_REFERENCIA_INVALIDA` do `tipo_atividade_id`, reason
 *    `inexistente` | `inativo` | `grupo_inativo`); `nome` obrigatório (1–120,
 *    sem só espaços). HERANÇA do tipo, por `padroesParaAtividade` (D-PROD-197)
 *    e como SNAPSHOT (nunca relida): nome do tipo, grupo, centro de custo e de
 *    resultado padrão (só se da mesma fazenda e ativos; senão nulos) e a
 *    unidade de produção com a sigla. O SETOR é herdado da área. Centros,
 *    unidade e setor nunca vêm no corpo (o schema da rota recusa);
 *  - área, máquina e tarefa: do tenant e da MESMA fazenda (`inexistente` |
 *    `outra_empresa`); área e máquina ATIVAS (`inativo`); a máquina de
 *    natureza MAQUINA, VEICULO ou EQUIPAMENTO (`natureza`). Manter na edição a
 *    referência já gravada não relê nada (como no cadastro do bem): só a
 *    referência NOVA ou TROCADA é conferida;
 *  - FLAGS do tipo (`regrasDoTipo`): `exige_area` sem área, `exige_safra` sem
 *    safra e `exige_maquina` sem máquina → 422 `ATIVIDADE_EXIGIDA_PELO_TIPO`.
 *    Na edição valem de novo, sobre o estado FINAL e com as flags ATUAIS do
 *    tipo (o tipo da atividade não muda);
 *  - DATAS: `data_inicio` padrão hoje e nunca no futuro (o "hoje" é o da
 *    fazenda: fuso da Empresa + relógio do servidor; sem fuso, falha fechado
 *    `EMPRESA_FUSO_NAO_CONFIGURADO`); `data_prevista_fim ≥ data_inicio`
 *    (senão `periodo_invertido`); `area_planejada ≥ 0` (formato do decimal);
 *  - NÚMERO pela sequência do tenant, entidade `Atividade` (a migration
 *    renomeou o contador do apontamento antigo: as convertidas mantêm 1 e 2);
 *    reservado DEPOIS de todas as conferências (recusa não consome número);
 *  - EDITAR (PATCH, CAS por `versao`): só ABERTA; tipo imutável; trocar a área
 *    refaz o setor; centros e unidade nunca mudam;
 *  - CONCLUIR: só ABERTA; `data_conclusao` padrão hoje, nunca futura nem antes
 *    de `data_inicio`; com `exige_producao` no tipo, a produção SOMADA dos
 *    apontamentos CONFIRMADO tem de ser > 0 (senão 422
 *    `ATIVIDADE_EXIGIDA_PELO_TIPO` do `quantidade_produzida`);
 *  - REABRIR (permissão própria): só CONCLUIDA; motivo obrigatório; grava
 *    `reaberta_*` e limpa a conclusão (`data_conclusao`, `concluida_*`). A
 *    linha guarda só a última reabertura: o motivo de CADA uma fica na
 *    auditoria;
 *  - CANCELAR: só ABERTA (a concluída é reaberta antes); motivo obrigatório;
 *    na MESMA transação cancela os apontamentos CONFIRMADO (com o mesmo
 *    motivo, instante e usuário) e recalcula os totais — o ponto onde a Fatia
 *    3 vai estornar o estoque. Sem DELETE físico;
 *  - DUPLICAR: abertura NOVA, com as mesmas regras e os padrões RELIDOS do tipo
 *    atual (e o setor relido da área); copia nome, tipo, área, máquina, safra,
 *    área planejada, tarefa e observação; o corpo pode trocar `nome`,
 *    `data_inicio` (padrão hoje) e `data_prevista_fim`; não copia apontamentos;
 *  - status inválido para a ação → 409 `ATIVIDADE_STATUS_INVALIDO`; versão →
 *    409 `ATIVIDADE_VERSAO_CONFLITO` (`versao_atual`/`versao_informada`); um
 *    cadastro que some na corrida → 422 `ATIVIDADE_REFERENCIA_INVALIDA` do
 *    campo (FK composta, `comFkTraduzida`).
 *
 * Toda escrita roda em `emTransacao(TRANSACAO_CURTA)` e trava a linha da
 * atividade (`SELECT … FOR UPDATE`) ANTES de ler o estado anterior; ordem
 * canônica das travas: Empresa FOR SHARE (quando a escrita usa o "hoje") →
 * Atividade FOR UPDATE → apontamentos. Toda escrita devolve o DETALHE (a forma
 * pública + `totais`) e grava a auditoria na mesma transação, sem texto livre
 * (observação e motivos viram `tem_*`; o motivo da reabertura é a exceção).
 *
 * Tenant SÓ do auth_context (R11); a empresa vem do corpo (escrita) ou da
 * query (leitura) e é conferida no tenant (`exigirEmpresaDoTenant`). No PATCH
 * o contrato tira `empresa_id` do corpo: ausente, vale a fazenda da própria
 * atividade; presente, é conferida no tenant e tem de ser a da atividade.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  atividadeDataInvalida,
  atividadeExigidaPeloTipo,
  atividadeNotFound,
  atividadeReferenciaInvalida,
} from '../../shared/errors/AppError.js';
import { MENSAGEM_CONFLITO_SEM_CHAVE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { termoDeBusca } from '../patrimonio/patrimonioComum.js';
import { agoraDoServidor } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import { padroesParaAtividade, regrasDoTipo } from '../tiposAtividade/tipoAtividadePadroes.js';
import {
  ENTIDADE_ATIVIDADE,
  STATUS_ATIVIDADE,
  TRANSACAO_LEITURA,
  atualizarComVersao,
  buscarAtividade,
  carregarAtividadeDetalhe,
  comFkTraduzida,
  comoAtividadeDetalhe,
  comoAtividadePublica,
  comoData,
  decimalDoCorpo,
  diaDe,
  diaDoCorpo,
  diaDoFiltro,
  erroDoCasPerdido,
  exigirDiaNaoFuturo,
  exigirStatusDaAtividade,
  exigirVersao,
  idOuNulo,
  iso,
  lerTotaisDaAtividade,
  motivoDoCorpo,
  somarApontamentosConfirmados,
  t4,
  temCampo,
  tempoDaFazenda,
  travarAtividade,
} from './atividadeComum.js';
import { cancelarApontamentosDaAtividade, recalcularTotaisDaAtividade } from './atividadeApontamentoService.js';
import { totaisDasMaquinasDaAtividade } from './atividadeApontamentoMaquinaService.js';
import { totaisDaMaoObraDaAtividade } from './atividadeApontamentoMaoObraService.js';
import { totaisDosServicosDaAtividade } from './atividadeApontamentoServicoService.js';
import { totaisPorProduto } from './atividadeApontamentoProdutoRepository.js';
import { combustivelDaAtividade } from '../patrimonio/abastecimentoConsumo.js';
import {
  inserirAtividade,
  lerArea,
  lerBem,
  lerEmpresaDaAtividade,
  lerLancamentoTarefa,
  custosTotaisDasAtividades,
  lerTipoAtividade,
  listarAtividades,
} from './atividadeRepository.js';

/** @typedef {import('../../shared/auth/authContext.js').AuthContext} AuthContext */
/** @typedef {{ requestId: string, auth: AuthContext }} Contexto */

/** Status da atividade, na ordem do CHECK (filtro da lista). */
export const STATUS = Object.freeze([STATUS_ATIVIDADE.ABERTA, STATUS_ATIVIDADE.CONCLUIDA, STATUS_ATIVIDADE.CANCELADA]);

/** `nome` da atividade: 1–120 caracteres úteis (o schema da rota confere o tamanho bruto). */
export const NOME_MAXIMO = 120;

// ─── normalização do corpo ──────────────────────────────────────────────────

/**
 * Nome da atividade: aparado, sem caractere de controle nem marcação (400,
 * `textoDoCorpo`); vazio ou só espaços → 400 `obrigatorio`.
 * @param {unknown} v @returns {string}
 */
const nomeDoCorpo = (v) => {
  const nome = textoDoCorpo(v, 'nome');
  if (!nome) throw invalido('nome é obrigatório: dê à atividade o nome que o operador reconhece (ex.: "Cigarrinha Pasto 01")', { field: 'nome', reason: 'obrigatorio' });
  if ([...nome].length > NOME_MAXIMO) throw invalido(`nome deve ter no máximo ${NOME_MAXIMO} caracteres`, { field: 'nome', reason: 'longo' });
  return nome;
};

/** Campo do corpo → normalizador (ausente = `undefined`; null limpa um opcional). */
const NORMALIZADORES = Object.freeze({
  nome: (v) => nomeDoCorpo(v),
  area_id: (v) => idOuNulo(v, 'area_id'),
  bem_id: (v) => idOuNulo(v, 'bem_id'),
  safra_ciclo: (v) => textoDoCorpo(v, 'safra_ciclo') ?? null,
  data_inicio: (v) => diaDoCorpo(v, 'data_inicio'),
  data_prevista_fim: (v) => diaDoCorpo(v, 'data_prevista_fim'),
  area_planejada: (v) => decimalDoCorpo(v, 'area_planejada'),
  lancamento_tarefa_id: (v) => idOuNulo(v, 'lancamento_tarefa_id'),
  observacao: (v) => textoDoCorpo(v, 'observacao') ?? null,
});

/** @typedef {keyof typeof NORMALIZADORES} CampoDaAtividade */

/** Dados que o formulário grava (abrir e editar; o tipo e a empresa são à parte). */
export const CAMPOS_DA_ATIVIDADE = /** @type {readonly CampoDaAtividade[]} */ (Object.freeze(Object.keys(NORMALIZADORES)));

/** O que duplicar aceita trocar (o resto é copiado da origem). */
const CAMPOS_DA_DUPLICACAO = /** @type {readonly CampoDaAtividade[]} */ (Object.freeze(['nome', 'data_inicio', 'data_prevista_fim']));

/**
 * Só os campos PRESENTES no corpo, normalizados (ausente ≠ null: null limpa).
 * @param {Record<string, any>} corpo @param {readonly CampoDaAtividade[]} campos
 * @returns {Record<string, any>}
 */
const camposDoCorpo = (corpo, campos) => {
  /** @type {Record<string, any>} */
  const saida = {};
  for (const campo of campos) {
    if (temCampo(corpo, campo) && corpo[campo] !== undefined) saida[campo] = NORMALIZADORES[campo](corpo[campo]);
  }
  return saida;
};

/**
 * Estado GRAVADO na forma do corpo normalizado (base da edição).
 * @param {any} r
 * @returns {Record<string, any>}
 */
const estadoGravado = (r) => ({
  nome: r.nome,
  area_id: r.area_id ?? null,
  bem_id: r.bem_id ?? null,
  safra_ciclo: r.safra_ciclo ?? null,
  data_inicio: diaDe(r.data_inicio),
  data_prevista_fim: diaDe(r.data_prevista_fim),
  area_planejada: t4(r.area_planejada),
  lancamento_tarefa_id: r.lancamento_tarefa_id ?? null,
  observacao: r.observacao ?? null,
});

/**
 * Estado normalizado → colunas do banco (datas `AAAA-MM-DD` → Date à meia-noite
 * UTC; decimais já são texto com 4 casas).
 * @param {Record<string, any>} campos
 */
const paraGravacao = (campos) => {
  /** @type {Record<string, any>} */
  const dados = { ...campos };
  for (const campo of ['data_inicio', 'data_prevista_fim']) if (temCampo(dados, campo)) dados[campo] = comoData(dados[campo]);
  return dados;
};

// ─── regras ─────────────────────────────────────────────────────────────────

/** Flag do tipo → campo da atividade que ela exige (o código diz qual). */
const EXIGENCIAS_DAS_FLAGS = Object.freeze(
  /** @type {Array<['exige_area'|'exige_safra'|'exige_maquina', 'area_id'|'safra_ciclo'|'bem_id']>} */ ([
    ['exige_area', 'area_id'],
    ['exige_safra', 'safra_ciclo'],
    ['exige_maquina', 'bem_id'],
  ])
);

/**
 * Flags do tipo sobre o estado FINAL da atividade.
 * @param {Record<string, boolean>} regras  de `regrasDoTipo` @param {Record<string, any>} estado
 */
const exigirFlagsDoTipo = (regras, estado) => {
  for (const [flag, campo] of EXIGENCIAS_DAS_FLAGS) {
    if (regras[flag] && !estado[campo]) throw atividadeExigidaPeloTipo(campo);
  }
};

/**
 * `data_prevista_fim ≥ data_inicio` (iguais pode), quando as duas existem.
 * @param {string|null} inicio @param {string|null} fim
 */
const exigirPeriodo = (inicio, fim) => {
  if (inicio && fim && fim < inicio) {
    throw atividadeDataInvalida('data_prevista_fim', 'periodo_invertido', { data_inicio: inicio, data_prevista_fim: fim });
  }
};

/**
 * Tipo da ABERTURA (abrir e duplicar): existe no tenant, está ativo e o grupo
 * dele também (todo tipo tem grupo: a FK do tipo para o grupo é obrigatória).
 * @param {any} tx @param {string} clienteId @param {string} id
 */
const exigirTipoParaAbertura = async (tx, clienteId, id) => {
  const tipo = await lerTipoAtividade(tx, clienteId, id);
  if (!tipo) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inexistente');
  if (!tipo.ativo) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inativo');
  if (!tipo.grupo.ativo) throw atividadeReferenciaInvalida('tipo_atividade_id', 'grupo_inativo');
  return tipo;
};

/**
 * Área informada ou trocada: do tenant, da MESMA fazenda e ativa. Devolve o
 * setor dela (herdado pela atividade).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 */
const exigirArea = async (tx, clienteId, empresaId, id) => {
  const area = await lerArea(tx, clienteId, id);
  if (!area) throw atividadeReferenciaInvalida('area_id', 'inexistente');
  if (area.empresa_id !== empresaId) throw atividadeReferenciaInvalida('area_id', 'outra_empresa');
  if (!area.ativo) throw atividadeReferenciaInvalida('area_id', 'inativo');
  return { setor_id: area.setor_id, setor_nome: area.setor_nome };
};

/** Naturezas do bem que servem de MÁQUINA da atividade (contrato §3); implemento, benfeitoria e outro não. */
const NATUREZAS_MAQUINA = Object.freeze(['MAQUINA', 'VEICULO', 'EQUIPAMENTO']);

/**
 * Máquina informada ou trocada: do tenant, da MESMA fazenda, ativa e de
 * natureza MAQUINA, VEICULO ou EQUIPAMENTO (senão reason `natureza`).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 */
const exigirBem = async (tx, clienteId, empresaId, id) => {
  const bem = await lerBem(tx, clienteId, id);
  if (!bem) throw atividadeReferenciaInvalida('bem_id', 'inexistente');
  if (bem.empresa_id !== empresaId) throw atividadeReferenciaInvalida('bem_id', 'outra_empresa');
  if (!bem.ativo) throw atividadeReferenciaInvalida('bem_id', 'inativo');
  if (!NATUREZAS_MAQUINA.includes(bem.natureza)) throw atividadeReferenciaInvalida('bem_id', 'natureza');
};

/**
 * Tarefa de origem informada ou trocada: do tenant e da MESMA fazenda.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 */
const exigirTarefa = async (tx, clienteId, empresaId, id) => {
  const tarefa = await lerLancamentoTarefa(tx, clienteId, id);
  if (!tarefa) throw atividadeReferenciaInvalida('lancamento_tarefa_id', 'inexistente');
  if (tarefa.empresa_id !== empresaId) throw atividadeReferenciaInvalida('lancamento_tarefa_id', 'outra_empresa');
};

/**
 * Snapshots da abertura, lidos do tipo AGORA e nunca mais relidos: nome do
 * tipo, grupo, centros padrão (só da mesma fazenda e ativos) e a unidade de
 * produção ativa com a sigla.
 * @param {any} tipo  de `lerTipoAtividade` @param {string} empresaId
 */
const snapshotsDoTipo = (tipo, empresaId) => {
  const padroes = padroesParaAtividade(tipo, { empresaId });
  return {
    tipo_atividade_nome: tipo.nome_tipo,
    grupo_atividade_id: tipo.grupo.id,
    grupo_atividade_nome: tipo.grupo.nome_grupo,
    centro_custo_id: padroes.centro_custo_id,
    centro_resultado_id: padroes.centro_resultado_id,
    unidade_producao_id: padroes.unidade_producao_id,
    unidade_producao_sigla: padroes.unidade_producao_id ? tipo.unidadeProducao?.sigla ?? null : null,
  };
};

// ─── auditoria e respostas ──────────────────────────────────────────────────

/**
 * Auditoria: as colunas, sem texto livre (observação e motivos viram `tem_*`).
 * @param {any} r
 */
const paraAuditoria = (r) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  nome: r.nome,
  status: r.status,
  versao: r.versao,
  tipo_atividade_id: r.tipo_atividade_id,
  tipo_atividade_nome: r.tipo_atividade_nome,
  grupo_atividade_id: r.grupo_atividade_id,
  grupo_atividade_nome: r.grupo_atividade_nome,
  area_id: r.area_id ?? null,
  setor_id: r.setor_id ?? null,
  setor_nome: r.setor_nome ?? null,
  bem_id: r.bem_id ?? null,
  safra_ciclo: r.safra_ciclo ?? null,
  centro_custo_id: r.centro_custo_id ?? null,
  centro_resultado_id: r.centro_resultado_id ?? null,
  unidade_producao_id: r.unidade_producao_id ?? null,
  unidade_producao_sigla: r.unidade_producao_sigla ?? null,
  data_inicio: diaDe(r.data_inicio),
  data_prevista_fim: diaDe(r.data_prevista_fim),
  data_conclusao: diaDe(r.data_conclusao),
  area_planejada: t4(r.area_planejada),
  area_executada: t4(r.area_executada),
  quantidade_produzida: t4(r.quantidade_produzida),
  lancamento_tarefa_id: r.lancamento_tarefa_id ?? null,
  concluida_em: iso(r.concluida_em),
  concluida_por_usuario_id: r.concluida_por_usuario_id ?? null,
  cancelada_em: iso(r.cancelada_em),
  cancelado_por_usuario_id: r.cancelado_por_usuario_id ?? null,
  reaberta_em: iso(r.reaberta_em),
  reaberta_por_usuario_id: r.reaberta_por_usuario_id ?? null,
  tem_observacao: Boolean(r.observacao),
  tem_motivo_cancelamento: Boolean(r.motivo_cancelamento),
  tem_motivo_reabertura: Boolean(r.motivo_reabertura),
});

/**
 * Registro relido na transação da escrita (com os resumos). Sumiu → 404.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 */
const relerNa = async (tx, clienteId, empresaId, id) => {
  const r = await buscarAtividade(tx, clienteId, empresaId, id);
  if (!r) throw atividadeNotFound();
  return r;
};

/**
 * DETALHE do registro relido (a forma pública + `totais`), na transação de quem chama.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {any} registro
 */
const detalheDe = async (tx, clienteId, empresaId, registro) =>
  comoAtividadeDetalhe(registro, await lerTotaisDaAtividade(tx, clienteId, empresaId, registro.id));

/**
 * Trava a atividade (`FOR UPDATE`) e lê o estado anterior, que é conferido
 * contra a ação (status) e contra a `versao` do corpo (CAS).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} id
 * @param {'editar'|'concluir'|'reabrir'|'cancelar'} acao @param {unknown} versao
 */
const travarELer = async (tx, clienteId, empresaId, id, acao, versao) => {
  if (!(await travarAtividade(tx, clienteId, empresaId, id))) throw atividadeNotFound();
  const anterior = await relerNa(tx, clienteId, empresaId, id);
  exigirStatusDaAtividade(anterior, acao);
  exigirVersao(anterior, versao);
  return anterior;
};

/**
 * UPDATE com CAS (`versao` + status esperado); corrida perdida → o erro certo
 * (404, status ou versão). Uma FK que some na corrida → 422 do campo.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, id: string, versao: number, statusEsperado: string,
 *   acao: 'editar'|'concluir'|'reabrir'|'cancelar', dados: Record<string, unknown> }} pedido
 */
const gravarComVersao = async (tx, { clienteId, empresaId, id, versao, statusEsperado, acao, dados }) => {
  const alterados = await comFkTraduzida(() => atualizarComVersao(tx.atividade, { clienteId, empresaId, id, versao, statusEsperado, dados }));
  if (alterados !== 1) throw await erroDoCasPerdido(tx.atividade, { clienteId, empresaId, id, versao, statusEsperado, acao });
};

// ─── leitura ────────────────────────────────────────────────────────────────

/**
 * Lista keyset (`createdAt desc, id desc`) da empresa. Filtros: `status`,
 * `tipo_atividade_id`, `area_id` e o período `data_de`/`data_ate` sobre
 * `data_inicio`; `q` busca no número e no nome (literal; o nome sem
 * diferenciar maiúsculas). Cada item na forma pública (sem `totais`) e, desde
 * a D-PROD-234, com o `custo_total` da atividade (o mesmo do `custo_total` de
 * `GET /atividades/:id/totais`; nulo sem nenhum custo), lido para a PÁGINA
 * inteira numa consulta agrupada só (`custosTotaisDasAtividades`, sem N+1).
 * @param {{ auth: AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), cli, query.empresa_id);
  const de = query.data_de === undefined ? null : diaDoFiltro(query.data_de, 'data_de');
  const ate = query.data_ate === undefined ? null : diaDoFiltro(query.data_ate, 'data_ate');
  if (de && ate && de > ate) throw invalido('o período está invertido: data_de é posterior a data_ate', { field: 'data_ate', reason: 'periodo_invertido' });
  /** @type {Record<string, any>} */
  const where = { cliente_id: cli, empresa_id: empresaId };
  for (const campo of ['status', 'tipo_atividade_id', 'area_id']) {
    if (typeof query[campo] === 'string' && query[campo]) where[campo] = query[campo];
  }
  if (de || ate) where.data_inicio = { ...(de ? { gte: comoData(de) } : {}), ...(ate ? { lte: comoData(ate) } : {}) };
  const q = termoDeBusca(query.q);
  const busca = q ? [{ numero: { contains: q } }, { nome: { contains: q, mode: 'insensitive' } }] : [];
  const pagina = await listarAtividades({ where, busca, query, mapItem: comoAtividadePublica });
  const itens = /** @type {any[]} */ (pagina.items);
  if (!itens.length) return pagina;
  const custos = await custosTotaisDasAtividades(getPrismaClient(), cli, empresaId, itens.map((i) => String(i.id)));
  const custoDe = new Map(custos.map((c) => [c.atividade_id, c.custo_total === null || c.custo_total === undefined ? null : t4(c.custo_total)]));
  return { ...pagina, items: itens.map((i) => ({ ...i, custo_total: custoDe.get(i.id) ?? null })) };
};

/**
 * DETALHE: o cabeçalho com os resumos e os `totais`, numa leitura consistente
 * (RepeatableRead, sem trava). Outra fazenda ou outro tenant → 404.
 * @param {{ auth: AuthContext }} contexto @param {string} id @param {Record<string, any>} [query]
 */
export const obter = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  return emTransacao(TRANSACAO_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, query.empresa_id);
    return carregarAtividadeDetalhe(tx, auth.clienteId, empresaId, id);
  });
};

/**
 * D-PROD-202 — `GET /atividades/:id/totais` (contrato das linhas §4): o
 * totalizador do cabeçalho, numa leitura consistente (RepeatableRead, sem
 * trava). Soma só as linhas CONFIRMADO de apontamentos CONFIRMADO:
 * `{ area_executada, area_planejada, unidade_area: 'ha',
 *    produtos: [{ produto_id, nome, unidade, quantidade, custo_total }],
 *    maquinas: [{ bem_id, nome, medidor_unidade, quantidade_uso, custo_total }],
 *    mao_obra: [{ parceiro_id, nome, origem, tipo_medida, quantidade, custo_total }],
 *    servicos: [{ servico_id, nome, unidade, quantidade, custo_total }],
 *    combustivel: { quantidade_l, quantidade_kg, custo_total },
 *    consumo_por_bem: [{ bem, medidor_tipo, uso, quantidade, unidade, quantidade_l, quantidade_kg, metrica, unidade_metrica, valor, custo_total }],
 *    custo_total, custo_por_ha, custo_combustivel_por_ha,
 *    custo_por_tipo: { maquinas, produtos, mao_obra, servicos, combustivel },
 *    litros_combustivel_por_ha }`.
 * `custo_total` = Σ produtos + Σ máquinas com custo + Σ mão de obra com custo +
 * Σ serviços (D-PROD-207, Fatia 4) + combustível (D-PROD-211, Fatia 5: os
 * abastecimentos CONFIRMADO ligados à atividade); nulo sem nenhum custo;
 * `custo_por_ha` = custo_total / area_executada (4 casas), nulo sem área ou
 * sem custo; `custo_combustivel_por_ha` = custo do combustível / área, idem.
 * `consumo_por_bem` (L/h, km/L… de `abastecimentoConsumo.metricaDoMedidor`) é
 * de `combustivelDaAtividade`. D-PROD-234 (a atividade aberta no desenho do
 * protótipo, só leitura): `custo_por_tipo` = as parcelas do `custo_total`, cada
 * uma nula sem custo (`produtos` = Σ dos produtos, nula sem produto); e
 * `litros_combustivel_por_ha` = litros de combustível / área executada, nulo
 * sem área ou sem litros (o quilo não entra). Decimais como texto com 4 casas.
 * Outra fazenda ou tenant → 404.
 * @param {{ auth: AuthContext }} contexto @param {string} id @param {Record<string, any>} [query]
 */
export const obterTotais = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(TRANSACAO_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const atividade = await tx.atividade.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, select: { id: true, area_planejada: true } });
    if (!atividade) throw atividadeNotFound();
    // A área executada é a soma dos CONFIRMADO, como no cabeçalho (lida aqui, no mesmo instante das linhas).
    const { area_executada: areaExecutada } = await somarApontamentosConfirmados(tx, cli, empresaId, id);
    const produtos = (await totaisPorProduto(tx, cli, empresaId, id)).map((p) => ({
      produto_id: p.produto_id,
      nome: p.nome,
      unidade: p.unidade,
      quantidade: /** @type {string} */ (t4(p.quantidade)),
      custo_total: /** @type {string} */ (t4(p.custo_total)),
    }));
    const maquinas = await totaisDasMaquinasDaAtividade(tx, cli, empresaId, id);
    const maoObra = await totaisDaMaoObraDaAtividade(tx, cli, empresaId, id);
    const servicos = await totaisDosServicosDaAtividade(tx, cli, empresaId, id);
    const { combustivel, consumo_por_bem: consumoPorBem } = await combustivelDaAtividade(tx, cli, empresaId, id);
    const parcelas = [
      ...produtos.map((p) => p.custo_total),
      ...[maquinas.custo_total, maoObra.custo_total, servicos.custo_total, combustivel.custo_total].filter((v) => v !== null),
    ];
    const custoTotal = parcelas.length ? parcelas.reduce((t, v) => t.plus(dec(v)), dec(0)) : null;
    const custoProdutos = produtos.length ? t4(produtos.reduce((t, p) => t.plus(dec(p.custo_total)), dec(0))) : null;
    const area = areaExecutada === null ? null : dec(areaExecutada);
    const comArea = area !== null && area.gt(0);
    return {
      area_executada: areaExecutada,
      area_planejada: t4(atividade.area_planejada),
      unidade_area: 'ha',
      produtos,
      maquinas: maquinas.maquinas,
      mao_obra: maoObra.mao_obra,
      servicos: servicos.servicos,
      combustivel,
      consumo_por_bem: consumoPorBem,
      custo_total: custoTotal === null ? null : t4(custoTotal),
      custo_por_ha: custoTotal !== null && area !== null && area.gt(0) ? t4(arredondar(custoTotal.dividedBy(area), 4)) : null,
      custo_combustivel_por_ha:
        combustivel.custo_total !== null && area !== null && area.gt(0) ? t4(arredondar(dec(combustivel.custo_total).dividedBy(area), 4)) : null,
      custo_por_tipo: {
        maquinas: maquinas.custo_total,
        produtos: custoProdutos,
        mao_obra: maoObra.custo_total,
        servicos: servicos.custo_total,
        combustivel: combustivel.custo_total,
      },
      litros_combustivel_por_ha:
        combustivel.quantidade_l !== null && comArea ? t4(arredondar(dec(combustivel.quantidade_l).dividedBy(/** @type {any} */ (area)), 4)) : null,
    };
  });
};

// ─── abertura (abrir e duplicar) ────────────────────────────────────────────

/**
 * Abertura NOVA na transação de quem chama (Empresa já FOR SHARE em
 * `tempoDaFazenda`): confere o tipo, as datas, as referências e as flags,
 * herda os snapshots do tipo e o setor da área, reserva o número, grava,
 * audita e devolve o DETALHE.
 * @param {any} tx @param {Contexto} contexto
 * @param {{ clienteId: string, empresaId: string, tempo: { agora: Date, hoje: string, fuso: string },
 *   tipoAtividadeId: string, estado: Record<string, any>, acao: string, auditoriaExtra?: Record<string, unknown> }} abertura
 */
const abrirNa = async (tx, contexto, { clienteId, empresaId, tempo, tipoAtividadeId, estado, acao, auditoriaExtra = {} }) => {
  const tipo = await exigirTipoParaAbertura(tx, clienteId, tipoAtividadeId);
  const dataInicio = estado.data_inicio ?? tempo.hoje;
  exigirDiaNaoFuturo(tempo, dataInicio, 'data_inicio');
  exigirPeriodo(dataInicio, estado.data_prevista_fim ?? null);
  const setor = estado.area_id ? await exigirArea(tx, clienteId, empresaId, estado.area_id) : { setor_id: null, setor_nome: null };
  if (estado.bem_id) await exigirBem(tx, clienteId, empresaId, estado.bem_id);
  if (estado.lancamento_tarefa_id) await exigirTarefa(tx, clienteId, empresaId, estado.lancamento_tarefa_id);
  exigirFlagsDoTipo(regrasDoTipo(tipo), estado);
  const numero = String(await reservarNumero(tx, { clienteId, entidade: ENTIDADE_ATIVIDADE, escopoTipo: ESCOPO_TENANT }));
  const { id } = await comFkTraduzida(() =>
    inserirAtividade(tx, {
      ...paraGravacao({
        nome: estado.nome,
        area_id: estado.area_id ?? null,
        bem_id: estado.bem_id ?? null,
        safra_ciclo: estado.safra_ciclo ?? null,
        data_inicio: dataInicio,
        data_prevista_fim: estado.data_prevista_fim ?? null,
        area_planejada: estado.area_planejada ?? null,
        lancamento_tarefa_id: estado.lancamento_tarefa_id ?? null,
        observacao: estado.observacao ?? null,
      }),
      ...setor,
      ...snapshotsDoTipo(tipo, empresaId),
      cliente_id: clienteId,
      empresa_id: empresaId,
      tipo_atividade_id: tipo.id,
      numero,
      status: STATUS_ATIVIDADE.ABERTA,
      criado_por_usuario_id: contexto.auth.usuarioId ?? null,
      versao: 1,
    })
  );
  const registro = await relerNa(tx, clienteId, empresaId, id);
  await registrarEvento(contexto, { acao, entidade: ENTIDADE_ATIVIDADE, entidadeId: id, dadosNovos: { ...paraAuditoria(registro), ...auditoriaExtra } }, tx);
  return detalheDe(tx, clienteId, empresaId, registro);
};

/**
 * ABRIR (`POST /atividades`, 201).
 * @param {Contexto} contexto @param {Record<string, any>} corpo
 */
export const criar = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const estado = camposDoCorpo(corpo, CAMPOS_DA_ATIVIDADE);
  if (!estado.nome) throw invalido('nome é obrigatório', { field: 'nome', reason: 'obrigatorio' });
  const tipoAtividadeId = idOuNulo(corpo.tipo_atividade_id, 'tipo_atividade_id');
  if (!tipoAtividadeId) throw invalido('tipo_atividade_id é obrigatório', { field: 'tipo_atividade_id', reason: 'obrigatorio' });

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      return abrirNa(tx, contexto, { clienteId: cli, empresaId, tempo, tipoAtividadeId, estado, acao: 'atividade.abrir' });
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * DUPLICAR (`POST /atividades/:id/duplicar`, 201): abertura NOVA a partir da
 * atividade dada (de qualquer status), com as regras e os padrões de agora.
 * @param {Contexto} contexto @param {string} id @param {Record<string, any>} corpo
 */
export const duplicar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const trocas = camposDoCorpo(corpo, CAMPOS_DA_DUPLICACAO);

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      // A origem só é LIDA (nada nela muda): sem trava.
      const origem = await relerNa(tx, cli, empresaId, id);
      const estado = {
        nome: origem.nome,
        area_id: origem.area_id ?? null,
        bem_id: origem.bem_id ?? null,
        safra_ciclo: origem.safra_ciclo ?? null,
        area_planejada: t4(origem.area_planejada),
        lancamento_tarefa_id: origem.lancamento_tarefa_id ?? null,
        observacao: origem.observacao ?? null,
        data_prevista_fim: null,
        ...trocas,
      };
      return abrirNa(tx, contexto, {
        clienteId: cli,
        empresaId,
        tempo,
        tipoAtividadeId: origem.tipo_atividade_id,
        estado,
        acao: 'atividade.duplicar',
        auditoriaExtra: { duplicada_de: origem.id, duplicada_de_numero: origem.numero },
      });
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

// ─── edição ─────────────────────────────────────────────────────────────────

/**
 * A fazenda da escrita do PATCH: a do corpo (conferida no tenant) ou, sem ela,
 * a da própria atividade do tenant (404 se não existe).
 * @param {any} tx @param {string} clienteId @param {unknown} empresaDoCorpo @param {string} id
 */
const empresaDaEdicao = async (tx, clienteId, empresaDoCorpo, id) => {
  if (empresaDoCorpo !== undefined) return exigirEmpresaDoTenant(tx, clienteId, empresaDoCorpo);
  const atividade = await lerEmpresaDaAtividade(tx, clienteId, id);
  if (!atividade) throw atividadeNotFound();
  return atividade.empresa_id;
};

/**
 * EDITAR (`PATCH /atividades/:id`): só os campos enviados mudam (null limpa um
 * opcional). Só ABERTA, com a `versao` lida (CAS). Tipo, centros e unidade
 * não mudam (o schema da rota recusa); trocar a área refaz o setor; as flags
 * do tipo valem de novo sobre o estado final.
 * @param {Contexto} contexto @param {string} id @param {Record<string, any>} corpo
 */
export const atualizar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const campos = camposDoCorpo(corpo, CAMPOS_DA_ATIVIDADE);
  if (!Object.keys(campos).length) throw invalido('informe ao menos um campo para alterar', { field: 'corpo', reason: 'sem_alteracao' });
  const versao = corpo.versao;

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await empresaDaEdicao(tx, cli, corpo.empresa_id, id);
      // O "hoje" só quando a data de início vem no corpo (Empresa FOR SHARE antes da trava da atividade).
      const tempo = temCampo(campos, 'data_inicio') ? await tempoDaFazenda(tx, cli, empresaId) : null;
      const anterior = await travarELer(tx, cli, empresaId, id, 'editar', versao);
      const gravado = estadoGravado(anterior);
      const estado = { ...gravado, ...campos };
      if (tempo) exigirDiaNaoFuturo(tempo, estado.data_inicio, 'data_inicio');
      exigirPeriodo(estado.data_inicio, estado.data_prevista_fim);
      /** @param {string} campo */
      const trocou = (campo) => temCampo(campos, campo) && campos[campo] !== gravado[campo];
      /** @type {Record<string, any>} */
      const dados = paraGravacao(campos);
      if (trocou('area_id')) {
        const setor = estado.area_id ? await exigirArea(tx, cli, empresaId, estado.area_id) : { setor_id: null, setor_nome: null };
        Object.assign(dados, setor); // o setor é o da área NOVA (ou nenhum)
      }
      if (trocou('bem_id') && estado.bem_id) await exigirBem(tx, cli, empresaId, estado.bem_id);
      if (trocou('lancamento_tarefa_id') && estado.lancamento_tarefa_id) await exigirTarefa(tx, cli, empresaId, estado.lancamento_tarefa_id);
      // As flags ATUAIS do tipo (que existe: a FK RESTRICT barra a exclusão; inativo agora não importa).
      exigirFlagsDoTipo(regrasDoTipo(await lerTipoAtividade(tx, cli, anterior.tipo_atividade_id)), estado);
      await gravarComVersao(tx, { clienteId: cli, empresaId, id, versao, statusEsperado: STATUS_ATIVIDADE.ABERTA, acao: 'editar', dados });
      const registro = await relerNa(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        {
          acao: 'atividade.editar',
          entidade: ENTIDADE_ATIVIDADE,
          entidadeId: id,
          dadosAnteriores: paraAuditoria(anterior),
          dadosNovos: { ...paraAuditoria(registro), campos_alterados: Object.keys(dados).sort() },
        },
        tx
      );
      return detalheDe(tx, cli, empresaId, registro);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

// ─── conclusão, reabertura e cancelamento ───────────────────────────────────

/**
 * CONCLUIR (`POST /atividades/:id/concluir`): ABERTA → CONCLUIDA, com
 * `data_conclusao` (padrão hoje; nunca futura nem antes do início), quem e
 * quando; com `exige_producao` no tipo, a produção somada dos apontamentos
 * CONFIRMADO tem de ser > 0 (lida SOB a trava da atividade).
 * @param {Contexto} contexto @param {string} id @param {Record<string, any>} corpo
 */
export const concluir = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const dataInformada = diaDoCorpo(corpo.data_conclusao, 'data_conclusao');
  const versao = corpo.versao;

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      const anterior = await travarELer(tx, cli, empresaId, id, 'concluir', versao);
      const dia = dataInformada ?? tempo.hoje;
      exigirDiaNaoFuturo(tempo, dia, 'data_conclusao');
      const inicio = diaDe(anterior.data_inicio);
      if (inicio && dia < inicio) throw atividadeDataInvalida('data_conclusao', 'antes_do_inicio', { data: dia, data_inicio: inicio });
      const regras = regrasDoTipo(await lerTipoAtividade(tx, cli, anterior.tipo_atividade_id));
      if (regras.exige_producao) {
        const { quantidade_produzida: producao } = await somarApontamentosConfirmados(tx, cli, empresaId, id);
        if (producao === null || !dec(producao).gt(0)) throw atividadeExigidaPeloTipo('quantidade_produzida', { details: { quantidade_produzida: producao } });
      }
      await gravarComVersao(tx, {
        clienteId: cli,
        empresaId,
        id,
        versao,
        statusEsperado: STATUS_ATIVIDADE.ABERTA,
        acao: 'concluir',
        dados: {
          status: STATUS_ATIVIDADE.CONCLUIDA,
          data_conclusao: comoData(dia),
          concluida_em: tempo.agora,
          concluida_por_usuario_id: auth.usuarioId ?? null,
        },
      });
      const registro = await relerNa(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        { acao: 'atividade.concluir', entidade: ENTIDADE_ATIVIDADE, entidadeId: id, dadosAnteriores: paraAuditoria(anterior), dadosNovos: paraAuditoria(registro) },
        tx
      );
      return detalheDe(tx, cli, empresaId, registro);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * REABRIR (`POST /atividades/:id/reabrir`, permissão própria): CONCLUIDA →
 * ABERTA com motivo, quem e quando; limpa a conclusão. Cada reabertura é
 * auditada COM o motivo (a linha guarda só a última).
 * @param {Contexto} contexto @param {string} id @param {Record<string, any>} corpo
 */
export const reabrir = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const motivo = motivoDoCorpo(corpo.motivo);
  const versao = corpo.versao;

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const anterior = await travarELer(tx, cli, empresaId, id, 'reabrir', versao);
      await gravarComVersao(tx, {
        clienteId: cli,
        empresaId,
        id,
        versao,
        statusEsperado: STATUS_ATIVIDADE.CONCLUIDA,
        acao: 'reabrir',
        dados: {
          status: STATUS_ATIVIDADE.ABERTA,
          data_conclusao: null,
          concluida_em: null,
          concluida_por_usuario_id: null,
          reaberta_em: agoraDoServidor(),
          reaberta_por_usuario_id: auth.usuarioId ?? null,
          motivo_reabertura: motivo,
        },
      });
      const registro = await relerNa(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        {
          acao: 'atividade.reabrir',
          entidade: ENTIDADE_ATIVIDADE,
          entidadeId: id,
          dadosAnteriores: paraAuditoria(anterior),
          dadosNovos: { ...paraAuditoria(registro), motivo_reabertura: motivo },
        },
        tx
      );
      return detalheDe(tx, cli, empresaId, registro);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};

/**
 * CANCELAR (`POST /atividades/:id/cancelar`): ABERTA → CANCELADA com motivo,
 * quem e quando. Na MESMA transação, sob a trava da atividade, os apontamentos
 * CONFIRMADO são cancelados com o mesmo motivo, instante e usuário e os totais
 * recalculados (`atividadeApontamentoService.js`). D-PROD-202: ali também as
 * linhas de máquina são canceladas e as de produto estornadas (estoque e lotes
 * voltam exatos, no "hoje" da fazenda). D-PROD-211: os abastecimentos
 * CONFIRMADO ligados aos apontamentos também caem (estorno no ESTOQUE, só o
 * status no EXTERNO; travas Atividade → Bem → Produto). O cabeçalho é gravado por último (CAS).
 * @param {Contexto} contexto @param {string} id @param {Record<string, any>} corpo
 */
export const cancelar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const motivo = motivoDoCorpo(corpo.motivo);
  const versao = corpo.versao;

  return emTransacao(
    TRANSACAO_CURTA,
    async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const { agora, hoje } = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE (o dia do estorno das linhas de produto)
      const anterior = await travarELer(tx, cli, empresaId, id, 'cancelar', versao);
      const usuarioId = auth.usuarioId ?? null;
      // Os filhos antes do cabeçalho: o serviço do apontamento cancela com a atividade ainda ABERTA (e travada).
      // D-PROD-202: as linhas dos apontamentos caem junto (máquina cancelada; produto estornado exatamente, num
      // `estornarEmLote` só, no dia de hoje da fazenda), com o mesmo motivo e a origem ATIVIDADE.
      // D-PROD-207: as de mão de obra e de serviço também (cascata em `cancelarLinhasDosApontamentos`).
      const apontamentosCancelados = await cancelarApontamentosDaAtividade(tx, { clienteId: cli, empresaId, atividadeId: id, usuarioId, motivo, agora, hoje, contexto });
      // Idempotente: "totais = soma dos CONFIRMADO" vale mesmo sem nenhum apontamento cancelado aqui,
      // sem depender de quando o serviço do apontamento decide recalcular.
      await recalcularTotaisDaAtividade(tx, { clienteId: cli, empresaId, atividadeId: id });
      await gravarComVersao(tx, {
        clienteId: cli,
        empresaId,
        id,
        versao,
        statusEsperado: STATUS_ATIVIDADE.ABERTA,
        acao: 'cancelar',
        dados: {
          status: STATUS_ATIVIDADE.CANCELADA,
          cancelada_em: agora,
          cancelado_por_usuario_id: usuarioId,
          motivo_cancelamento: motivo,
        },
      });
      const registro = await relerNa(tx, cli, empresaId, id);
      await registrarEvento(
        contexto,
        {
          acao: 'atividade.cancelar',
          entidade: ENTIDADE_ATIVIDADE,
          entidadeId: id,
          dadosAnteriores: paraAuditoria(anterior),
          dadosNovos: { ...paraAuditoria(registro), apontamentos_cancelados: apontamentosCancelados },
        },
        tx
      );
      return detalheDe(tx, cli, empresaId, registro);
    },
    {},
    MENSAGEM_CONFLITO_SEM_CHAVE
  );
};
