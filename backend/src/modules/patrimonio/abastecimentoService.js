/**
 * D-PROD-159 (Patrimônio P1-02), revisto pela D-PROD-162 (SIMPLIFICA-01) —
 * abastecimento de bem patrimonial com baixa FÍSICA real pelo motor de
 * estoque (FIFO), sem lançamento financeiro.
 *
 *  - D-PROD-162: a baixa é EXATAMENTE a quantidade digitada, na unidade de
 *    estoque do Produto (`L` ou `KG`), sem nenhuma conversão; o Produto tem de
 *    estar nos "Produtos aceitos" (ativos) do tanque (`TanqueBemProduto`);
 *  - D-PROD-169: Produto em qualquer unidade (L, KG ou SACO); a unidade do
 *    abastecimento é a EFETIVA do estoque (SACO guarda kg → `KG`);
 *  - prévia: mesma função de plano da confirmação, sem trava, sem escrita e
 *    sem recibo (RepeatableRead só de leitura);
 *  - confirmação: idempotente por `operation_id` (recibo v2 + unique), travas
 *    na ordem empresa → bem → local → produto → lotes → movimento → sequências,
 *    estado RELIDO sob as travas (TOCTOU) e o MESMO plano. O único escritor de
 *    `TanqueBemProduto` é o PATCH do bem, que também trava o Bem `FOR UPDATE`;
 *    a troca de unidade/fazenda do Produto trava o Produto, que a trava de
 *    estoque também toma: nenhum aceite ou unidade muda entre a leitura e o
 *    commit;
 *  - cancelamento: estorno exato fatia a fatia (`estornarSaida`), CAS por
 *    `versao`, dia do estorno = hoje da fazenda; recusa se a unidade efetiva
 *    do Produto mudou (`unidade_mudou`); nunca toca `BemPatrimonial`. D-PROD-273 (fatia 4): com outro movimento
 *    do produto no depósito depois, recalcula o custo médio do que veio depois (`estoqueExclusaoRecalculo`);
 *
 * A leitura do medidor vive no próprio abastecimento (`medidor_origem =
 * 'ABASTECIMENTO'`): o bem nunca é gravado (nem a `versao`).
 *
 * D-PROD-211 (Fatia 5 do Lançamento de Atividades, contrato
 * `MAIKE-ATIVIDADE-ABASTECIMENTO-CONTRATO.md` §2):
 *  - `origem` EXTERNO (posto de estrada): nenhum movimento de estoque, nenhum
 *    lote, sem trava de estoque nem de local; o custo é o da nota
 *    (`custo_total`), `custo_unitario = total ÷ quantidade`. Cancelar o
 *    EXTERNO só muda o status (não há o que estornar);
 *  - `apontamento_id`: a atividade é DERIVADA do apontamento; exige o
 *    apontamento CONFIRMADO e a atividade ABERTA (os mesmos erros do
 *    lançamento novo); centro de custo snapshot = o da atividade, senão o do
 *    bem; snapshot do medidor (`medidor_leitura_anterior`, `medidor_delta`,
 *    `intervalo_confiavel`) gravado na confirmação;
 *  - cascata: `cancelarAbastecimentosDosApontamentos` (cancelar o apontamento
 *    ou a atividade) usa o MESMO caminho do cancelamento direto
 *    (`cancelarAbastecimentoTravado`: estorno pelo motor no ESTOQUE, só o
 *    status no EXTERNO), com motivo derivado e um evento de auditoria por
 *    abastecimento.
 *
 * ORDEM DAS TRAVAS (a mesma dos escritores da atividade,
 * `atividadeApontamentoService.js`/`atividadeService.js`):
 *   recibo → Empresa FOR SHARE (o "hoje") → Atividade FOR UPDATE (só com
 *   `apontamento_id`; o apontamento é lido SOB esta trava — todo escritor do
 *   apontamento a toma antes) → Bem FOR UPDATE → (ESTOQUE) LocalEstoque FOR KEY
 *   SHARE → Produto (`travarProdutosEstoque`; no EXTERNO só `FOR SHARE` da
 *   linha, sem a trava de estoque) → lotes → movimento → sequências → auditoria.
 * O cancelamento direto: Empresa FOR SHARE → (ligado) Atividade FOR UPDATE, só
 * ABERTA → Bem FOR UPDATE → AbastecimentoBem FOR UPDATE → Produto → lotes → movimentos. A cascata: Empresa FOR SHARE →
 * Atividade FOR UPDATE (quem chama) → Bens FOR UPDATE (ordenados) →
 * AbastecimentoBem FOR UPDATE → Produtos (UMA rodada ordenada: combustíveis +
 * produtos das linhas de produto da cascata) → lotes → movimentos,
 * e roda ANTES do estorno das linhas de produto (que travam Produto): nenhuma
 * inversão Produto → Bem.
 */

import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../../database/prismaClient.js';
import { aplicarExclusaoComRecalculo, planejarExclusaoComRecalculo } from '../estoqueRecalculo/estoqueExclusaoRecalculo.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError, atividadeApontamentoNotFound, atividadeStatusInvalido } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { TRANSACAO_CURTA, TRANSACAO_LONGA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { STATUS_APONTAMENTO, exigirStatusDaAtividade, travarAtividade } from '../atividades/atividadeComum.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, arredondar, dec, paraBanco, somar } from '../financeiro/decimalFinanceiro.js';
import {
  ORIGEM_ABASTECIMENTO, aplicarSaida, estornarSaida, lotesFifo, numerarMovimentos, numeroMovimentoProvisorio, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { exigirEmpresaDoTenant, invalido, iso } from '../gestao/gestaoComum.js';
import { agoraDoServidor, diaNoFuso, hojeDaEmpresa, normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import { consumoDoAbastecimento } from './abastecimentoConsumo.js';
import { ehContador, leituraVigente, pisoOperacional, pontoDoCadastro, pontosIguais, pontosVizinhos } from './abastecimentoMedidor.js';
import {
  ENTIDADE, ORIGEM_ESTOQUE, ORIGEM_EXTERNO, STATUS_CANCELADO, STATUS_CONFIRMADO, TIPO_CANCELAR, TIPO_CONFIRMAR, erroDoBloqueio, fingerprintDaConfirmacao,
  fingerprintDoCancelamento, normalizarCancelamento, normalizarConfirmacao, normalizarPrevia, paraAuditoria, planejarAbastecimento,
} from './abastecimentoPlano.js';
import { atualizarComVersao, comoData, diaDe, diaDoCorpo, listarKeyset, termoDeBusca, versaoConflito } from './patrimonioComum.js';
import { UNIDADE_DO_MEDIDOR, unidadeEfetivaDoEstoque } from './patrimonioDominio.js';

/** Leitura consistente sem trava (prévia, detalhe). */
const LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

const TIPO_DETALHADO_SAIDA = 'abastecimento_patrimonio';
const MOTIVO_SAIDA = 'Saída por abastecimento de bem patrimonial';
const TIPO_DETALHADO_ESTORNO = 'estorno_abastecimento';
const MOTIVO_ESTORNO = 'Estorno de abastecimento cancelado';

// ─── erros ──────────────────────────────────────────────────────────────────

export const naoEncontrado = () => new AppError('ABASTECIMENTO_NAO_ENCONTRADO', 'abastecimento não encontrado nesta fazenda');
const bemNaoEncontrado = () =>
  new AppError('BEM_PATRIMONIAL_NAO_ENCONTRADO', 'bem patrimonial não encontrado nesta fazenda', { details: { field: 'bem_id', reason: 'bem_inexistente' } });

const MENSAGENS_BLOQUEIO_CANCELAMENTO = Object.freeze({
  produto_mudou_de_fazenda: 'o produto deste abastecimento mudou de fazenda: o estorno exato não é seguro; nada foi alterado',
  movimento_inexistente: 'o movimento de saída deste abastecimento não existe mais: o estorno exato não é seguro; nada foi alterado',
  movimento_estornado: 'o movimento de saída deste abastecimento já foi estornado; nada foi alterado',
  fatias_inconsistentes: 'as fatias FIFO gravadas não somam a quantidade do abastecimento: o estorno exato não é seguro; nada foi alterado',
  lote_indisponivel_para_devolucao: 'um lote consumido por este abastecimento não pode receber a devolução (lote estornado ou removido); nada foi alterado',
  devolucao_excede_entrada: 'a devolução ultrapassaria a entrada de um lote consumido; nada foi alterado',
  estoque_excede_limite: 'a devolução passaria do limite das colunas de estoque; nada foi alterado',
  unidade_mudou: 'a unidade de estoque do Produto mudou desde o abastecimento: o estorno exato não é seguro; nada foi alterado',
  // P1-02 R1 (M5): dado incoerente no banco; nunca é corrigido nem ignorado pelo cancelamento.
  vinculo_divergente: 'o movimento de saída deste abastecimento é de outro produto ou outra fazenda: o estorno exato não é seguro; nada foi alterado',
  camada_divergente: 'um lote consumido por este abastecimento é de outro produto, outra fazenda ou outro local: o estorno exato não é seguro; nada foi alterado',
});
/** @param {keyof typeof MENSAGENS_BLOQUEIO_CANCELAMENTO} reason @param {Record<string, unknown>} [extra] */
const cancelamentoBloqueado = (reason, extra = {}) =>
  new AppError('ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', MENSAGENS_BLOQUEIO_CANCELAMENTO[reason], { details: { field: 'abastecimento', reason, ...extra } });


/**
 * `create` do abastecimento. A FK `(cliente_id, tanque_id, produto_id)` →
 * `TanqueBemProduto` é a rede do banco: se mesmo assim falhar (23503/P2003),
 * responde 422 `ABASTECIMENTO_PRODUTO_NAO_ACEITO`, nunca 500 (§4.5).
 * @param {any} tx @param {Record<string, any>} data
 */
const criarAbastecimento = async (tx, data) => {
  try {
    return await tx.abastecimentoBem.create({ data });
  } catch (erro) {
    const e = /** @type {any} */ (erro);
    const alvo = JSON.stringify(e?.meta ?? '') + String(e?.message ?? '');
    if (e?.code === 'P2003' && /tanque_id_produto_id_fkey/.test(alvo)) {
      throw new AppError('ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'o tanque escolhido não aceita este produto: marque-o nos Produtos aceitos do tanque em Bens Patrimoniais; nada foi gravado', {
        details: { field: 'produto_id', reason: 'nao_aceito_pelo_tanque' },
      });
    }
    throw erro;
  }
};

const semFuso = (empresaId) =>
  new AppError('EMPRESA_FUSO_NAO_CONFIGURADO', 'o fuso horário da fazenda não está configurado: o administrador precisa configurá-lo em Empresa → "Fuso horário da fazenda" antes de registrar manejos e lotes. Nada foi gravado.', {
    details: { empresa_id: empresaId },
  });

// ─── formas públicas ────────────────────────────────────────────────────────

const t4 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_QUANTIDADE));
const usuarioPublico = (u) => (u ? { id: u.id, login: u.login } : null);
const MOVIMENTO = Object.freeze({
  select: {
    id: true, numero_movimentacao: true, status: true, tipo_movimentacao: true, tipo_detalhado: true, data_movimentacao: true, quantidade: true, unidade_medida: true,
    valor_unitario: true, valor_total: true,
  },
});
const movimentoPublico = (m) =>
  m
    ? {
        id: m.id,
        numero: m.numero_movimentacao,
        status: m.status,
        tipo_movimentacao: m.tipo_movimentacao,
        tipo_detalhado: m.tipo_detalhado,
        data_movimentacao: iso(m.data_movimentacao),
        quantidade: t4(m.quantidade),
        unidade: m.unidade_medida ?? null,
        valor_unitario: t4(m.valor_unitario),
        valor_total: t4(m.valor_total),
      }
    : null;

/** D-PROD-211 — o vínculo com a atividade e o centro de custo snapshot (lista e detalhe). */
const INCLUIR_VINCULO = Object.freeze({
  atividade: { select: { id: true, numero: true, nome: true } },
  apontamento: { select: { id: true, data_operacional: true, turno: true, sequencia: true } },
  centroCusto: { select: { id: true, nome: true } },
});

const INCLUIR_RESUMO = Object.freeze({
  bem: { select: { id: true, numero: true, codigo_frota: true, nome: true } },
  tanque: { select: { id: true, identificador: true } },
  localEstoque: { select: { id: true, nome: true } },
  produto: { select: { id: true, nome_produto: true, unidade_principal_estoque: true } },
  ...INCLUIR_VINCULO,
});

/** @param {any} l */
const localPublico = (l) => (l ? { id: l.id, nome: l.nome } : null);

/**
 * D-PROD-211 — campos novos da lista e do detalhe: a origem, o vínculo
 * (`atividade` `{id, numero, nome}`, `apontamento` `{id, data_operacional,
 * turno, sequencia}`), o `centro_custo` `{id, nome}` e o snapshot do medidor.
 * @param {any} r
 */
const camposDaFatia5 = (r) => ({
  origem: r.origem,
  atividade: r.atividade ? { id: r.atividade.id, numero: r.atividade.numero, nome: r.atividade.nome } : null,
  apontamento: r.apontamento
    ? { id: r.apontamento.id, data_operacional: diaDe(r.apontamento.data_operacional), turno: r.apontamento.turno ?? null, sequencia: r.apontamento.sequencia }
    : null,
  centro_custo: r.centroCusto ? { id: r.centroCusto.id, nome: r.centroCusto.nome } : null,
  medidor_leitura_anterior: t4(r.medidor_leitura_anterior),
  medidor_delta: t4(r.medidor_delta),
  intervalo_confiavel: r.intervalo_confiavel === true,
});

/** Item da lista (A1). @param {any} r */
const comoAbastecimentoResumo = (r) => ({
  id: r.id,
  numero: r.numero,
  status: r.status,
  versao: r.versao,
  data_operacional: diaDe(r.data_operacional),
  bem: { id: r.bem.id, numero: r.bem.numero, codigo_frota: r.bem.codigo_frota ?? null, nome: r.bem.nome },
  tanque: { id: r.tanque.id, identificador: r.tanque.identificador },
  produto: { id: r.produto.id, nome: r.produto.nome_produto },
  local_estoque: localPublico(r.localEstoque),
  quantidade: t4(r.quantidade),
  unidade: r.unidade,
  custo_total: t4(r.custo_total),
  tanque_cheio: r.tanque_cheio,
  medidor: { tipo: r.medidor_tipo, unidade: r.medidor_unidade ?? null, leitura: t4(r.medidor_leitura) },
  referencia_externa: r.referencia_externa ?? null,
  ...camposDaFatia5(r),
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

const INCLUIR_DETALHE = Object.freeze({
  bem: { select: { id: true, numero: true, codigo_frota: true, nome: true, medidor_tipo: true, medidor_unidade: true, medidor_leitura_atual: true, medidor_data_leitura: true } },
  tanque: { select: { id: true, identificador: true, capacidade_litros: true } },
  localEstoque: { select: { id: true, nome: true } },
  produto: { select: { id: true, nome_produto: true, unidade_principal_estoque: true } },
  movimentacao: MOVIMENTO,
  movimentacaoEstorno: MOVIMENTO,
  consumos: { orderBy: { ordem: /** @type {const} */ ('asc') }, select: { ordem: true, estoque_lote_nota_id: true, quantidade: true, custo_unitario: true, lote: { select: { data_documento: true } } } },
  criadoPor: { select: { id: true, login: true } },
  canceladoPor: { select: { id: true, login: true } },
  ...INCLUIR_VINCULO,
});

/**
 * Detalhe (A2) — também o corpo das respostas de confirmar/cancelar.
 * @param {any} db @param {string} cli @param {string} empresaId @param {string} id
 */
export const carregarDetalhe = async (db, cli, empresaId, id) => {
  const r = await db.abastecimentoBem.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, include: INCLUIR_DETALHE });
  if (!r) throw naoEncontrado();
  const consumo = await consumoDoAbastecimento(db, cli, r);
  let efeito = null;
  if (r.status === STATUS_CONFIRMADO && ehContador(r.medidor_tipo) && r.medidor_leitura !== null) {
    const cadastro = r.bem.medidor_tipo === r.medidor_tipo ? pontoDoCadastro(r.bem) : null;
    const antes = leituraVigente(cadastro, await pisoOperacional(db, cli, r.bem_id, r.medidor_tipo));
    const depois = leituraVigente(cadastro, await pisoOperacional(db, cli, r.bem_id, r.medidor_tipo, { excetoId: r.id }));
    efeito = { muda: !pontosIguais(antes, depois), leitura_operacional_antes: antes, leitura_operacional_depois: depois };
  }
  const contador = ehContador(r.medidor_tipo);
  return {
    id: r.id,
    empresa_id: r.empresa_id,
    numero: r.numero,
    status: r.status,
    versao: r.versao,
    data_operacional: diaDe(r.data_operacional),
    bem: { id: r.bem.id, numero: r.bem.numero, codigo_frota: r.bem.codigo_frota ?? null, nome: r.bem.nome },
    tanque: { id: r.tanque.id, identificador: r.tanque.identificador, capacidade_litros: t4(r.tanque.capacidade_litros) },
    produto: { id: r.produto.id, nome: r.produto.nome_produto, unidade_principal_estoque: r.produto.unidade_principal_estoque },
    local_estoque: localPublico(r.localEstoque),
    quantidade: t4(r.quantidade),
    unidade: r.unidade,
    custo_total: t4(r.custo_total),
    custo_unitario: t4(r.custo_unitario),
    tanque_cheio: r.tanque_cheio,
    medidor: {
      tipo: r.medidor_tipo,
      unidade: r.medidor_unidade ?? null,
      leitura: contador ? t4(r.medidor_leitura) : null,
      origem: contador ? r.medidor_origem ?? null : null,
    },
    observacao: r.observacao ?? null,
    referencia_externa: r.referencia_externa ?? null,
    movimentacao: movimentoPublico(r.movimentacao),
    estorno: movimentoPublico(r.movimentacaoEstorno),
    fatias: r.consumos.map((f) => ({
      ordem: f.ordem,
      lote_id: f.estoque_lote_nota_id,
      data_lote: diaDe(f.lote?.data_documento ?? null),
      quantidade: t4(f.quantidade),
      custo_unitario: t4(f.custo_unitario),
      valor: arredondar(dec(f.quantidade).times(dec(f.custo_unitario)), CASAS_CUSTO).toFixed(CASAS_CUSTO),
    })),
    cancelamento:
      r.status === STATUS_CANCELADO
        ? { cancelado_em: iso(r.cancelado_em), cancelado_por: usuarioPublico(r.canceladoPor), motivo: r.motivo_cancelamento }
        : null,
    criado_por: usuarioPublico(r.criadoPor),
    ...camposDaFatia5(r),
    consumo,
    efeito_cancelamento_medidor: efeito,
    created_date: iso(r.createdAt),
    updated_date: iso(r.updatedAt),
  };
};

// ─── estado (o MESMO na prévia e na confirmação) ────────────────────────────

/**
 * Lê tudo o que o plano precisa. Na confirmação, chamada DEPOIS das travas
 * (as leituras valem até o commit); na prévia, sem trava nenhuma.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} entrada @param {{hoje: string, fuso: string}} tempo
 */
const carregarEstado = async (tx, cli, empresaId, entrada, { hoje, fuso }) => {
  const bem = await tx.bemPatrimonial.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, id: entrada.bem_id },
    select: {
      id: true, empresa_id: true, numero: true, codigo_frota: true, nome: true, natureza: true, ativo: true, medidor_tipo: true, medidor_unidade: true, medidor_leitura_atual: true,
      medidor_data_leitura: true, centroCusto: { select: { id: true, nome: true } },
    },
  });
  if (!bem) throw bemNaoEncontrado();
  const tanque = await tx.tanqueBem.findFirst({
    where: { cliente_id: cli, id: entrada.tanque_id, bem_id: bem.id },
    select: { id: true, bem_id: true, identificador: true, capacidade_litros: true, ativo: true, produtos: { select: { produto_id: true, ativo: true } } },
  });
  // D-PROD-211: o EXTERNO não tem local nem lotes (nenhum efeito de estoque).
  const local = entrada.origem === ORIGEM_EXTERNO
    ? null
    : await tx.localEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: entrada.local_estoque_id } }, select: { id: true, nome: true, ativo: true } });
  const produto = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: entrada.produto_id } } });
  const lotes = produto && local ? await lotesFifo(tx, cli, empresaId, produto.id, local.id) : [];
  const vizinhos = ehContador(bem.medidor_tipo)
    ? await pontosVizinhos(tx, cli, bem.id, /** @type {string} */ (bem.medidor_tipo), entrada.data_operacional)
    : { anterior: null, posterior: null };
  const vinculo = await carregarVinculo(tx, cli, empresaId, entrada, bem);
  return { hoje, fuso, bem, tanque, local, produto, lotes, vinculo, medidor: { cadastro: pontoDoCadastro(bem), ...vizinhos } };
};

/**
 * D-PROD-211 — o lançamento do dia ao qual o abastecimento pertence. Sem
 * `apontamento_id`: só o centro de custo (o do bem). Com ele: o apontamento da
 * EMPRESA (de outra fazenda ou tenant → 404 `ATIVIDADE_APONTAMENTO_NOT_FOUND`,
 * sem oráculo), a atividade dele ABERTA (concluída/cancelada → 409
 * `ATIVIDADE_STATUS_INVALIDO`, o MESMO erro do lançamento novo) e o
 * apontamento CONFIRMADO (cancelado → 409 `ATIVIDADE_STATUS_INVALIDO`,
 * `entidade: 'apontamento'`). Centro de custo snapshot: o da atividade, senão
 * o do bem. Na confirmação é chamada SOB a trava da atividade.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} entrada @param {{ centroCusto?: { id: string, nome: string }|null }} bem
 */
const carregarVinculo = async (tx, cli, empresaId, entrada, bem) => {
  const centroDoBem = bem.centroCusto ?? null;
  if (!entrada.apontamento_id) return { atividade: null, apontamento: null, centro_custo: centroDoBem };
  const ap = await tx.atividadeApontamento.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, id: entrada.apontamento_id },
    select: { id: true, atividade_id: true, data_operacional: true, turno: true, sequencia: true, status: true },
  });
  if (!ap) throw atividadeApontamentoNotFound('lançamento (apontamento) não encontrado nesta fazenda; nada foi gravado', { details: { field: 'apontamento_id', reason: 'inexistente' } });
  const atividade = await tx.atividade.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, id: ap.atividade_id },
    select: { id: true, numero: true, nome: true, status: true, centroCusto: { select: { id: true, nome: true } } },
  });
  if (!atividade) throw new Error('abastecimento: atividade do apontamento ausente na fazenda');
  exigirStatusDaAtividade(atividade, 'lancar_apontamento');
  if (ap.status !== STATUS_APONTAMENTO.CONFIRMADO) throw atividadeStatusInvalido({ status: ap.status, acao: 'lancar_abastecimento', entidade: 'apontamento' });
  return {
    atividade: { id: atividade.id, numero: atividade.numero, nome: atividade.nome },
    apontamento: { id: ap.id, data_operacional: diaDe(ap.data_operacional), turno: ap.turno ?? null, sequencia: ap.sequencia },
    centro_custo: atividade.centroCusto ?? centroDoBem,
  };
};

/**
 * D-PROD-211 — a atividade do apontamento (lida SEM trava, só para saber qual
 * travar: o `atividade_id` do apontamento nunca muda). Inexistente → null (o
 * erro sai de `carregarVinculo`, já sob as travas).
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string|null} apontamentoId
 */
const atividadeDoApontamento = async (tx, cli, empresaId, apontamentoId) => {
  if (!apontamentoId) return null;
  const ap = await tx.atividadeApontamento.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: apontamentoId }, select: { atividade_id: true } });
  return ap?.atividade_id ?? null;
};

// ─── leitura ────────────────────────────────────────────────────────────────

/**
 * Lista keyset (createdAt desc, id desc) dos abastecimentos da empresa (A1).
 * @param {any} contexto @param {Record<string, any>} [query]
 */
export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const de = diaDoCorpo(query.data_de, 'data_de') ?? null;
  const ate = diaDoCorpo(query.data_ate, 'data_ate') ?? null;
  if (de && ate && de > ate) throw invalido('o período está invertido: data_de é posterior a data_ate', { field: 'data_ate', reason: 'periodo_invertido' });
  /** @type {Record<string, any>} */
  const where = { cliente_id: cli, empresa_id: empresaId };
  for (const campo of ['bem_id', 'tanque_id', 'produto_id', 'status', 'operation_id', 'origem', 'apontamento_id', 'atividade_id']) {
    if (typeof query[campo] === 'string' && query[campo]) where[campo] = query[campo];
  }
  if (de || ate) where.data_operacional = { ...(de ? { gte: comoData(de) } : {}), ...(ate ? { lte: comoData(ate) } : {}) };
  const q = termoDeBusca(query.q);
  const busca = q ? [{ numero: { contains: q } }, { referencia_externa: { contains: q, mode: 'insensitive' } }] : [];
  return listarKeyset(prisma.abastecimentoBem, { where, busca, query, include: INCLUIR_RESUMO, mapItem: comoAbastecimentoResumo });
};

/** Detalhe (A2), numa leitura consistente. @param {any} contexto @param {string} id @param {Record<string, any>} [query] */
export const detalhar = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    return carregarDetalhe(tx, cli, empresaId, id);
  });
};

// ─── prévia (A3): sem trava, sem escrita, sem recibo ────────────────────────

/** @param {any} contexto @param {Record<string, any>} corpo */
export const previa = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const entrada = normalizarPrevia(corpo);
  return emTransacao(LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
    // C5: o "hoje" sem FOR SHARE (a prévia não trava nada).
    const e = await tx.empresa.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: empresaId } }, select: { fuso_horario: true } });
    const fuso = normalizarFusoIana(e?.fuso_horario);
    if (!fuso) throw semFuso(empresaId);
    const hoje = diaNoFuso(agoraDoServidor(), fuso);
    const estado = await carregarEstado(tx, cli, empresaId, entrada, { hoje, fuso });
    return planejarAbastecimento(entrada, estado);
  });
};

// ─── confirmação (A4) ───────────────────────────────────────────────────────

/** D9: o reenvio conflitante é auditado numa transação própria, best-effort (a resposta segue 409; nada foi gravado). */
const auditarReenvioConflitante = async (contexto, operationId, tipoOperacao) => {
  try {
    await registrarEvento(contexto, { acao: 'abastecimento_bem.reenvio_conflitante', entidade: ENTIDADE, entidadeId: null, dadosNovos: { operation_id: operationId, tipo_operacao: tipoOperacao } });
  } catch {
    // best-effort documentado (D9): a auditoria do conflito não muda a resposta 409.
  }
};

const conflitoDeChave = (operationId) => () =>
  new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', { details: { operation_id: operationId } });

/**
 * @param {any} contexto @param {Record<string, any>} corpo
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export const confirmar = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const entrada = normalizarConfirmacao(corpo);
  const fingerprint = fingerprintDePayload(fingerprintDaConfirmacao(entrada));
  try {
    const r = await emTransacao(
      TRANSACAO_CURTA,
      (tx) =>
        executarComIdempotencia(tx, {
          clienteId: cli,
          operationKey: entrada.operation_id,
          tipoOperacao: TIPO_CONFIRMAR,
          fingerprint,
          executar: async () => {
            const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
            const tempo = await hojeDaEmpresa(tx, cli, empresaId); // R2 Empresa FOR SHARE
            // D-PROD-211 — R2b: Atividade FOR UPDATE ANTES do bem (a ordem dos escritores da atividade). O
            // apontamento e a atividade são lidos sob ela (`carregarVinculo`): nenhum cancelamento passa no meio.
            const atividadeId = await atividadeDoApontamento(tx, cli, empresaId, entrada.apontamento_id);
            if (atividadeId) await travarAtividade(tx, cli, empresaId, atividadeId);
            const bemTravado = /** @type {any[]} */ (
              await tx.$queryRaw`SELECT id FROM "BemPatrimonial" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${entrada.bem_id} FOR UPDATE`
            ); // R3
            if (!bemTravado.length) throw bemNaoEncontrado();
            const doEstoque = entrada.origem === ORIGEM_ESTOQUE;
            // D-PROD-162: sem R5/R6 (vínculo e tipo de combustível saíram). O aceite do tanque só
            // muda pelo PATCH do bem, que também toma o FOR UPDATE do Bem (R3) acima.
            if (doEstoque) {
              await tx.$queryRaw`SELECT id FROM "LocalEstoque" WHERE cliente_id = ${cli} AND id = ${entrada.local_estoque_id} FOR KEY SHARE`; // R7
              await travarProdutosEstoque(tx, cli, empresaId, [entrada.produto_id]); // R8
            } else {
              // D-PROD-211: EXTERNO sem trava de estoque; a linha do Produto FOR SHARE segura unidade e fazenda até o commit.
              await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${cli} AND id = ${entrada.produto_id} FOR SHARE`; // R8'
            }
            const estado = await carregarEstado(tx, cli, empresaId, entrada, tempo);
            const { plano, bloqueios } = planejarAbastecimento(entrada, estado);
            if (bloqueios.length) throw erroDoBloqueio(bloqueios[0]);
            const quantidade = dec(plano.quantidade);
            const id = randomUUID();
            const numeroEVinculo = {
              atividade_id: plano.atividade?.id ?? null,
              apontamento_id: plano.apontamento?.id ?? null,
              centro_custo_id: plano.centro_custo?.id ?? null,
              medidor_leitura_anterior: plano.medidor_leitura_anterior,
              medidor_delta: plano.medidor_delta,
              intervalo_confiavel: plano.intervalo_confiavel,
            };
            if (!doEstoque) {
              const linha = await gravarAbastecimento(tx, cli, empresaId, entrada, estado, plano, auth, {
                id, origem: ORIGEM_EXTERNO, local_estoque_id: null, movimentacao_estoque_id: null,
                custo_total: /** @type {string} */ (plano.custo_total), custo_unitario: /** @type {string} */ (plano.custo_unitario), ...numeroEVinculo,
              });
              await registrarEvento(contexto, { acao: 'abastecimento_bem.confirmar', entidade: ENTIDADE, entidadeId: id, dadosNovos: paraAuditoria(linha, []) }, tx); // R13
              return { httpStatus: 201, body: await carregarDetalhe(tx, cli, empresaId, id) };
            }
            const saida = await aplicarSaida(tx, contexto, {
              empresaId,
              produto: estado.produto,
              local: { id: estado.local.id, nome: estado.local.nome },
              quantidadeKg: quantidade, // D-PROD-162: na unidade de estoque do Produto (L ou KG), sem conversão
              dia: entrada.data_operacional,
              documento: { numero: entrada.referencia_externa, data: entrada.data_operacional },
              origem: { sistema: ORIGEM_ABASTECIMENTO, operacaoId: id, tipoDetalhado: TIPO_DETALHADO_SAIDA, motivo: MOTIVO_SAIDA },
              numeroMovimento: numeroMovimentoProvisorio(),
              contextoErro: { field: 'quantidade' },
            }); // R9 lotes (CAS) + R10 movimento
            if (!somar(saida.fatias.map((f) => f.quantidade)).eq(quantidade)) throw new Error('abastecimento: fatias FIFO não somam a quantidade abastecida');
            const linha = await gravarAbastecimento(tx, cli, empresaId, entrada, estado, plano, auth, {
              id, origem: ORIGEM_ESTOQUE, local_estoque_id: estado.local.id, movimentacao_estoque_id: saida.movimento.id,
              custo_total: paraBanco(saida.valor_total, CASAS_CUSTO), custo_unitario: paraBanco(saida.valor_unitario, CASAS_CUSTO), ...numeroEVinculo,
            }); // R12a + R11
            const fatias = saida.fatias.map((f, i) => ({
              cliente_id: cli,
              empresa_id: empresaId,
              abastecimento_id: id,
              estoque_lote_nota_id: f.lote_id,
              ordem: i + 1,
              quantidade: paraBanco(f.quantidade, CASAS_QUANTIDADE),
              custo_unitario: paraBanco(f.custo_unitario, CASAS_CUSTO),
            }));
            await tx.abastecimentoBemConsumoLote.createMany({ data: fatias });
            await numerarMovimentos(tx, cli, [saida.movimento.id]); // R12b
            await registrarEvento(
              contexto,
              { acao: 'abastecimento_bem.confirmar', entidade: ENTIDADE, entidadeId: id, dadosNovos: paraAuditoria(linha, fatias) },
              tx
            ); // R13
            // D-PROD-282 (revisão): lote vencido consumido pelo FEFO — aviso na resposta (a escolha manual fica para depois).
            return { httpStatus: 201, body: { ...(await carregarDetalhe(tx, cli, empresaId, id)), ...(saida.avisos?.length ? { avisos: saida.avisos } : {}) } };
          },
        }),
      { operation_id: conflitoDeChave(entrada.operation_id) }
    );
    return { status: r.replay ? 200 : 201, body: { ...r.body, replay: r.replay } };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'IDEMPOTENCY_CONFLICT') await auditarReenvioConflitante(contexto, entrada.operation_id, TIPO_CONFIRMAR);
    throw e;
  }
};

/**
 * Reserva o número (R12a) e grava a linha (R11) — a mesma nas duas origens;
 * `variavel` traz o que depende da origem (local, movimento, custo) e o
 * vínculo/snapshot da D-PROD-211.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} entrada @param {any} estado @param {any} plano
 * @param {{ usuarioId?: string|null }} auth @param {Record<string, any>} variavel
 */
const gravarAbastecimento = async (tx, cli, empresaId, entrada, estado, plano, auth, variavel) => {
  const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT })); // R12a
  const contador = ehContador(estado.bem.medidor_tipo);
  const tipoMedidor = estado.bem.medidor_tipo ?? 'SEM_MEDIDOR';
  return criarAbastecimento(tx, {
    cliente_id: cli,
    empresa_id: empresaId,
    numero,
    status: STATUS_CONFIRMADO,
    bem_id: estado.bem.id,
    tanque_id: estado.tanque.id,
    produto_id: estado.produto.id,
    data_operacional: comoData(entrada.data_operacional),
    quantidade: dec(plano.quantidade).toFixed(CASAS_QUANTIDADE),
    unidade: /** @type {string} */ (plano.unidade), // unidade EFETIVA do estoque do Produto (L | KG; SACO → KG, D-PROD-169)
    tanque_cheio: entrada.tanque_cheio,
    medidor_tipo: tipoMedidor,
    medidor_unidade: contador ? UNIDADE_DO_MEDIDOR[/** @type {'HORIMETRO'} */ (tipoMedidor)] : null,
    medidor_leitura: contador ? entrada.medidor_leitura : null,
    medidor_origem: contador ? 'ABASTECIMENTO' : null,
    observacao: entrada.observacao,
    referencia_externa: entrada.referencia_externa,
    operation_id: entrada.operation_id,
    criado_por_usuario_id: auth.usuarioId ?? null,
    versao: 1,
    ...variavel,
  }); // R11
};

// ─── cancelamento (A5) ──────────────────────────────────────────────────────

/** Erros do motor no estorno → recusa do cancelamento (fail-closed). */
const traduzirErroDoEstorno = (erro) => {
  const e = /** @type {any} */ (erro);
  if (!(e instanceof AppError)) return erro;
  if (e.code === 'ESTOQUE_JA_CONSUMIDO') {
    // P1-02 R1 (M5): o original revalidado sob a trava do motor.
    if (e.details?.reason === 'original_ja_estornado' || e.details?.reason === 'original_nao_ativo') return cancelamentoBloqueado('movimento_estornado');
    /** @type {Array<'lote_indisponivel_para_devolucao'|'devolucao_excede_entrada'|'fatias_inconsistentes'|'vinculo_divergente'|'camada_divergente'>} */
    const conhecidos = ['lote_indisponivel_para_devolucao', 'devolucao_excede_entrada', 'fatias_inconsistentes', 'vinculo_divergente', 'camada_divergente'];
    const reason = conhecidos.find((r) => r === e.details?.reason) ?? 'fatias_inconsistentes';
    return cancelamentoBloqueado(reason, e.details?.lote_id ? { lote_id: e.details.lote_id } : {});
  }
  if (e.code === 'MOVIMENTACAO_ESTOQUE_NOT_FOUND') return cancelamentoBloqueado('movimento_inexistente');
  if (e.code === 'OPERACAO_VALORES_INVALIDOS') return cancelamentoBloqueado('estoque_excede_limite');
  return erro;
};

/**
 * Cancela UM abastecimento já TRAVADO por quem chama (Bem FOR UPDATE →
 * AbastecimentoBem FOR UPDATE), CONFIRMADO e com a `versao` conferida: é o
 * ÚNICO caminho do cancelamento — o direto (A5) e a cascata do apontamento e da
 * atividade (D-PROD-211). ESTOQUE: Produto (`travarProdutosEstoque`) → estorno
 * exato fatia a fatia pelo motor (`estornarSaida`: lotes → movimentos), no dia
 * `hoje` da fazenda. EXTERNO: só o status (não há movimento nem lote). Depois:
 * CAS pela `versao`, numeração do estorno e o evento de auditoria
 * (`abastecimento_bem.cancelar`, com `extraAuditoria` — a cascata diz de onde veio).
 * @param {any} tx @param {any} contexto
 * @param {{ cli: string, empresaId: string, antes: any, hoje: string, motivo: string, usuarioId: string|null, extraAuditoria?: Record<string, unknown> }} pedido
 * @returns {Promise<{ leituraAntes: any, leituraDepois: any }>}
 */
const cancelarAbastecimentoTravado = async (tx, contexto, { cli, empresaId, antes, hoje, motivo, usuarioId, extraAuditoria = {} }) => {
  const id = antes.id;
  const bem = await tx.bemPatrimonial.findFirst({
    where: { cliente_id: cli, id: antes.bem_id },
    select: { id: true, medidor_tipo: true, medidor_leitura_atual: true, medidor_data_leitura: true },
  });
  const cadastro = pontoDoCadastro(bem);
  const leituraAntes = leituraVigente(cadastro, await pisoOperacional(tx, cli, antes.bem_id, bem?.medidor_tipo ?? null));
  /** @type {any[]} */
  let fatias = [];
  /** @type {string|null} */
  let estornoId = null;
  if (antes.origem !== ORIGEM_EXTERNO) {
    await travarProdutosEstoque(tx, cli, empresaId, [antes.produto_id]); // R8
    const produto = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: antes.produto_id } } });
    if (!produto || produto.empresa_id !== empresaId) throw cancelamentoBloqueado('produto_mudou_de_fazenda');
    // D-PROD-162 (achado D7): compara a unidade EFETIVA do estoque (L → L; KG/SACO → kg). KG ↔ SACO
    // guardam estoque em kg e não bloqueiam o estorno exato; só a troca que envolve L (ou para uma
    // unidade fora de L/KG/SACO) bloqueia (defensivo: a troca de unidade do Produto já é recusada com movimento).
    if (unidadeEfetivaDoEstoque(produto.unidade_principal_estoque) !== unidadeEfetivaDoEstoque(antes.unidade)) {
      throw cancelamentoBloqueado('unidade_mudou', { unidade_abastecimento: antes.unidade, unidade_produto: produto.unidade_principal_estoque });
    }
    // Pré-leitura SEM trava, só para responder os motivos que a tela já conhece. A trava do
    // original (R10) é do motor: `estornarSaida` trava as camadas (R9) e DEPOIS o original,
    // a mesma ordem do estorno em lote da Central (P1-02 R1), e revalida tudo sob a trava.
    const orig = antes.movimentacao_estoque_id
      ? await tx.movimentacaoEstoque.findUnique({
          where: { cliente_id_id: { cliente_id: cli, id: antes.movimentacao_estoque_id } },
          select: { id: true, status: true, movimento_filho_id: true },
        })
      : null;
    if (!orig) throw cancelamentoBloqueado('movimento_inexistente');
    if (orig.status !== 'Ativa' || orig.movimento_filho_id) throw cancelamentoBloqueado('movimento_estornado');
    fatias = await tx.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: cli, abastecimento_id: id }, orderBy: { ordem: 'asc' } });
    if (!fatias.length || !somar(fatias.map((f) => f.quantidade)).eq(dec(antes.quantidade))) throw cancelamentoBloqueado('fatias_inconsistentes');
    const local = antes.local_estoque_id
      ? await tx.localEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: antes.local_estoque_id } }, select: { id: true, nome: true } })
      : null;
    if (!local) throw new Error('abastecimento: local de estoque do abastecimento ausente');
    // D-PROD-273 (fatia 4): com outro movimento do produto no depósito depois do abastecimento, o cancelamento
    // recalcula o custo médio do que veio depois (prova antes do estorno; recálculo e dependentes depois dele).
    const planos = await planejarExclusaoComRecalculo(tx, cli, { empresaId, movimentos: [{ id: orig.id, produtoId: antes.produto_id, localId: local.id }], estornoExatoSeInviavel: true });
    let estorno;
    try {
      estorno = await estornarSaida(tx, contexto, {
        empresaId,
        item: { quantidade_estoque: antes.quantidade, ordem: 1, movimentacao_estoque_id: orig.id },
        consumos: fatias.map((f) => ({ estoque_lote_nota_id: f.estoque_lote_nota_id, quantidade: f.quantidade })),
        produto,
        local: { id: local.id, nome: local.nome },
        dia: hoje,
        documento: { numero: antes.referencia_externa, data: diaDe(antes.data_operacional) },
        origem: { sistema: ORIGEM_ABASTECIMENTO, operacaoId: id, tipoDetalhadoEstorno: TIPO_DETALHADO_ESTORNO, motivoEstorno: MOTIVO_ESTORNO },
        numeroMovimento: numeroMovimentoProvisorio(),
      }); // R9 lotes + R10 movimentos
    } catch (erro) {
      throw traduzirErroDoEstorno(erro);
    }
    estornoId = estorno.movimento.id;
    if (planos.length) {
      await aplicarExclusaoComRecalculo(tx, contexto, planos, {
        empresaId, origem: ORIGEM_ABASTECIMENTO, estornos: new Map([[orig.id, estornoId]]),
        motivo: [...`Cancelamento do abastecimento ${antes.numero}: ${motivo}`].slice(0, 255).join(''),
      });
    }
  }
  await atualizarComVersao(tx.abastecimentoBem, {
    clienteId: cli,
    id,
    versao: antes.versao,
    data: {
      status: STATUS_CANCELADO,
      movimentacao_estorno_id: estornoId,
      cancelado_em: new Date(),
      cancelado_por_usuario_id: usuarioId ?? null,
      motivo_cancelamento: motivo,
    },
  }); // R11
  const depois = await tx.abastecimentoBem.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id } });
  const leituraDepois = leituraVigente(cadastro, await pisoOperacional(tx, cli, antes.bem_id, bem?.medidor_tipo ?? null));
  if (estornoId) await numerarMovimentos(tx, cli, [estornoId]); // R12
  await registrarEvento(
    contexto,
    {
      acao: 'abastecimento_bem.cancelar',
      entidade: ENTIDADE,
      entidadeId: id,
      dadosAnteriores: paraAuditoria(antes, fatias),
      dadosNovos: { ...paraAuditoria(depois, fatias), leitura_operacional_antes: leituraAntes, leitura_operacional_depois: leituraDepois, ...extraAuditoria },
    },
    tx
  ); // R13
  return { leituraAntes, leituraDepois };
};

/**
 * @param {any} contexto @param {string} id @param {Record<string, any>} corpo
 */
export const cancelar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const entrada = normalizarCancelamento(id, corpo);
  const fingerprint = fingerprintDePayload(fingerprintDoCancelamento(entrada));
  try {
    const r = await emTransacao(
      // D-PROD-273 (fatia 4): o cancelamento pode recalcular o que veio depois no depósito: a transação longa da exclusão
      // da saída manual (30 s), não a curta (9 s).
      TRANSACAO_LONGA,
      (tx) =>
        executarComIdempotencia(tx, {
          clienteId: cli,
          operationKey: entrada.operation_id,
          tipoOperacao: TIPO_CANCELAR,
          fingerprint,
          executar: async () => {
            const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
            const { hoje } = await hojeDaEmpresa(tx, cli, empresaId); // R2 (dia do estorno)
            const base = await tx.abastecimentoBem.findFirst({
              where: { cliente_id: cli, empresa_id: empresaId, id }, select: { bem_id: true, produto_id: true, atividade_id: true },
            });
            if (!base) throw naoEncontrado();
            // D-PROD-211 — R2b: ligado à atividade, a Atividade FOR UPDATE vem ANTES do bem (o `atividade_id` nunca
            // muda) e só a ABERTA deixa cancelar: a CONCLUIDA tem os totais fechados (reabra antes); a CANCELADA não
            // tem abastecimento ligado CONFIRMADO (a cascata os cancelou).
            if (base.atividade_id) {
              await travarAtividade(tx, cli, empresaId, base.atividade_id);
              const atividade = await tx.atividade.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: base.atividade_id }, select: { status: true } });
              if (!atividade) throw new Error('abastecimento: atividade do abastecimento ausente na fazenda');
              exigirStatusDaAtividade(atividade, 'cancelar_abastecimento');
            }
            const bemTravado = /** @type {any[]} */ (
              await tx.$queryRaw`SELECT id FROM "BemPatrimonial" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${base.bem_id} FOR UPDATE`
            ); // R3
            if (!bemTravado.length) throw new Error('abastecimento: bem do abastecimento fora da fazenda');
            await tx.$queryRaw`SELECT id FROM "AbastecimentoBem" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`; // R4
            const antes = await tx.abastecimentoBem.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id } });
            if (!antes) throw naoEncontrado();
            if (antes.status !== STATUS_CONFIRMADO) {
              throw new AppError('ABASTECIMENTO_STATUS_INVALIDO', 'o abastecimento já foi cancelado; nada foi alterado', {
                details: { field: 'status', reason: 'status_invalido', status: antes.status, esperado: STATUS_CONFIRMADO },
              });
            }
            if (antes.versao !== entrada.versao) throw versaoConflito(antes.versao, entrada.versao);
            const { leituraAntes, leituraDepois } = await cancelarAbastecimentoTravado(tx, contexto, {
              cli, empresaId, antes, hoje, motivo: entrada.motivo, usuarioId: auth.usuarioId ?? null,
            });
            return {
              httpStatus: 200,
              body: { ...(await carregarDetalhe(tx, cli, empresaId, id)), leitura_operacional_antes: leituraAntes, leitura_operacional_depois: leituraDepois },
            };
          },
        }),
      {}
    );
    return { ...r.body, replay: r.replay };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'IDEMPOTENCY_CONFLICT') await auditarReenvioConflitante(contexto, entrada.operation_id, TIPO_CANCELAR);
    throw e;
  }
};

// ─── cascata pela atividade (D-PROD-211, §2.3) ──────────────────────────────

/** `motivo_cancelamento` é VarChar(500). */
const MOTIVO_MAXIMO = 500;

/**
 * Motivo derivado da cascata: "cancelado com o lançamento de <dia>[ <turno>]
 * nº <sequência> da atividade <número>[ (atividade cancelada)]: <motivo>",
 * cortado em 500 caracteres.
 * @param {{ apontamento: { data_operacional: Date, turno: string|null, sequencia: number }, atividade: { numero: string }, motivo: string, origem: 'APONTAMENTO'|'ATIVIDADE' }} a
 */
export const motivoDaCascata = ({ apontamento, atividade, motivo, origem }) => {
  const dia = String(diaDe(apontamento.data_operacional)).split('-').reverse().join('/');
  const turno = apontamento.turno ? ` ${String(apontamento.turno).toLowerCase()}` : '';
  const quem = origem === 'ATIVIDADE' ? ` (atividade cancelada)` : '';
  const texto = `cancelado com o lançamento de ${dia}${turno} nº ${apontamento.sequencia} da atividade ${atividade.numero}${quem}: ${motivo}`;
  return [...texto].slice(0, MOTIVO_MAXIMO).join('').trim();
};

/**
 * D-PROD-211 — cancelar o APONTAMENTO (ou a ATIVIDADE, para todos os
 * apontamentos dela) cancela os abastecimentos CONFIRMADO ligados a eles, na
 * transação de quem chama e pelo MESMO caminho do cancelamento direto
 * (`cancelarAbastecimentoTravado`: estorno exato no ESTOQUE, só o status no
 * EXTERNO), com o motivo derivado (`motivoDaCascata`) e um evento de auditoria
 * por abastecimento (`cascata: { origem, atividade_id, apontamento_id }`).
 *
 * Quem chama já tomou Empresa FOR SHARE e Atividade FOR UPDATE (nenhum
 * abastecimento novo entra no apontamento no meio). Aqui: Bens FOR UPDATE
 * (ordenados) → AbastecimentoBem FOR UPDATE (ordenados) → Produtos (UM
 * `travarProdutosEstoque` com a união ordenada dos combustíveis e dos
 * `produtosAdicionais` — os das linhas de produto que quem chama estorna em
 * seguida) → por abastecimento, lotes e movimentos do motor. Chame ANTES do
 * estorno das linhas de produto (que já travariam Produto antes do Bem).
 * @param {any} tx
 * @param {{ requestId?: string, auth: import('../../shared/auth/authContext.js').AuthContext }|undefined} contexto
 * @param {{ clienteId: string, empresaId: string, apontamentoIds: string[], usuarioId: string|null, motivo: string, hoje?: string,
 *   origem: 'APONTAMENTO'|'ATIVIDADE', produtosAdicionais?: string[] }} pedido
 * @returns {Promise<number>} quantos foram cancelados
 */
export const cancelarAbastecimentosDosApontamentos = async (tx, contexto, { clienteId, empresaId, apontamentoIds, usuarioId, motivo, hoje, origem, produtosAdicionais = [] }) => {
  if (!Array.isArray(apontamentoIds) || !apontamentoIds.length) return 0;
  const onde = { cliente_id: clienteId, empresa_id: empresaId, apontamento_id: { in: apontamentoIds }, status: STATUS_CONFIRMADO };
  const alvos = await tx.abastecimentoBem.findMany({ where: onde, select: { id: true, bem_id: true, produto_id: true, origem: true }, orderBy: { id: 'asc' } });
  if (!alvos.length) return 0;
  if (!contexto?.auth) throw new Error('cancelamento em cascata: o cancelamento dos abastecimentos precisa do contexto da requisição');
  for (const bemId of [...new Set(alvos.map((a) => a.bem_id))].sort()) {
    await tx.$queryRaw`SELECT id FROM "BemPatrimonial" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id = ${bemId} FOR UPDATE`;
  }
  const ids = alvos.map((a) => a.id);
  await tx.$queryRaw`SELECT id FROM "AbastecimentoBem" WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  // UM conjunto ordenado de Produto: os combustíveis (ESTOQUE) e os `produtosAdicionais` de quem chama (os das
  // linhas de produto que a cascata estorna depois) — uma ordem global, sem duas rodadas de travas.
  await travarProdutosEstoque(tx, clienteId, empresaId, [...alvos.filter((a) => a.origem !== ORIGEM_EXTERNO).map((a) => a.produto_id), ...produtosAdicionais]);
  const dia = hoje ?? (await hojeDaEmpresa(tx, clienteId, empresaId)).hoje;
  // Relidos sob as travas: um cancelamento direto que passou antes já os tirou do CONFIRMADO.
  const linhas = await tx.abastecimentoBem.findMany({
    where: { ...onde, id: { in: ids } },
    include: { apontamento: { select: { data_operacional: true, turno: true, sequencia: true } }, atividade: { select: { numero: true } } },
    orderBy: { id: 'asc' },
  });
  for (const antes of linhas) {
    const { apontamento, atividade, ...registro } = antes;
    await cancelarAbastecimentoTravado(tx, contexto, {
      cli: clienteId,
      empresaId,
      antes: registro,
      hoje: dia,
      motivo: motivoDaCascata({ apontamento, atividade, motivo, origem }),
      usuarioId,
      extraAuditoria: { cascata: { origem, atividade_id: registro.atividade_id, apontamento_id: registro.apontamento_id } },
    });
  }
  return linhas.length;
};
