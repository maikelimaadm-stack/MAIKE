/**
 * D-PROD-159 (Patrimônio P1-02) — abastecimento de bem patrimonial com baixa
 * FÍSICA real pelo motor de estoque (KG, FIFO), sem lançamento financeiro.
 *
 *  - prévia: mesma função de plano da confirmação, sem trava, sem escrita e
 *    sem recibo (RepeatableRead só de leitura);
 *  - confirmação: idempotente por `operation_id` (recibo + unique), travas na
 *    ordem R0..R13 (empresa → bem → vínculo → tipo → local → produto → lotes →
 *    movimento → sequências), estado RELIDO sob as travas (TOCTOU) e o MESMO
 *    plano; kg convertido UMA vez com o fator vigente visto na prévia
 *    (`conversao_id` + `conversao_versao`, divergência → 409);
 *  - cancelamento: estorno exato fatia a fatia (`estornarSaida`), CAS por
 *    `versao`, dia do estorno = hoje da fazenda; nunca reconverte litros nem
 *    toca `BemPatrimonial`.
 *
 * A leitura do medidor vive no próprio abastecimento (`medidor_origem =
 * 'ABASTECIMENTO'`): o bem nunca é gravado (nem a `versao`).
 */

import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, arredondar, dec, paraBanco, somar } from '../financeiro/decimalFinanceiro.js';
import {
  ORIGEM_ABASTECIMENTO, aplicarSaidaFifo, estornarSaida, lotesFifo, numerarMovimentos, numeroMovimentoProvisorio, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { exigirEmpresaDoTenant, invalido, iso, travarEscopo } from '../gestao/gestaoComum.js';
import { agoraDoServidor, diaNoFuso, hojeDaEmpresa, normalizarFusoIana } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import { consumoDoAbastecimento } from './abastecimentoConsumo.js';
import { ehContador, leituraVigente, pisoOperacional, pontoDoCadastro, pontosIguais, pontosVizinhos } from './abastecimentoMedidor.js';
import {
  CASAS_FATOR, ENTIDADE, STATUS_CANCELADO, STATUS_CONFIRMADO, TIPO_CANCELAR, TIPO_CONFIRMAR, erroDoBloqueio, fingerprintDaConfirmacao,
  fingerprintDoCancelamento, normalizarCancelamento, normalizarConfirmacao, normalizarPrevia, paraAuditoria, planejarAbastecimento,
} from './abastecimentoPlano.js';
import { chaveVinculo } from './combustivelProdutoService.js';
import { atualizarComVersao, comoData, diaDe, diaDoCorpo, listarKeyset, termoDeBusca, versaoConflito } from './patrimonioComum.js';
import { UNIDADE_DO_MEDIDOR } from './patrimonioDominio.js';

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
});
/** @param {keyof typeof MENSAGENS_BLOQUEIO_CANCELAMENTO} reason @param {Record<string, unknown>} [extra] */
const cancelamentoBloqueado = (reason, extra = {}) =>
  new AppError('ABASTECIMENTO_CANCELAMENTO_BLOQUEADO', MENSAGENS_BLOQUEIO_CANCELAMENTO[reason], { details: { field: 'abastecimento', reason, ...extra } });

const semFuso = (empresaId) =>
  new AppError('EMPRESA_FUSO_NAO_CONFIGURADO', 'o fuso horário da fazenda não está configurado: o administrador precisa configurá-lo em Empresa → "Fuso horário da fazenda" antes de registrar manejos e lotes. Nada foi gravado.', {
    details: { empresa_id: empresaId },
  });

// ─── formas públicas ────────────────────────────────────────────────────────

const t4 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_QUANTIDADE));
const t6 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_FATOR));
const usuarioPublico = (u) => (u ? { id: u.id, login: u.login } : null);
const MOVIMENTO = Object.freeze({
  select: { id: true, numero_movimentacao: true, status: true, tipo_movimentacao: true, tipo_detalhado: true, data_movimentacao: true, quantidade: true, valor_unitario: true, valor_total: true },
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
        quantidade_kg: t4(m.quantidade),
        valor_unitario: t4(m.valor_unitario),
        valor_total: t4(m.valor_total),
      }
    : null;

const INCLUIR_RESUMO = Object.freeze({
  bem: { select: { id: true, numero: true, codigo_frota: true, nome: true } },
  tanque: { select: { id: true, identificador: true } },
  localEstoque: { select: { id: true, nome: true } },
  conversao: { select: { vinculo: { select: { tipoCombustivel: { select: { id: true, nome: true } }, produto: { select: { id: true, nome_produto: true } } } } } },
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
  tipo_combustivel: { id: r.conversao.vinculo.tipoCombustivel.id, nome: r.conversao.vinculo.tipoCombustivel.nome },
  produto: { id: r.conversao.vinculo.produto.id, nome: r.conversao.vinculo.produto.nome_produto },
  local_estoque: { id: r.localEstoque.id, nome: r.localEstoque.nome },
  quantidade_litros: t4(r.quantidade_litros),
  quantidade_kg: t4(r.quantidade_kg),
  kg_por_litro: t6(r.kg_por_litro),
  custo_total: t4(r.custo_total),
  tanque_cheio: r.tanque_cheio,
  medidor: { tipo: r.medidor_tipo, unidade: r.medidor_unidade ?? null, leitura: t4(r.medidor_leitura) },
  referencia_externa: r.referencia_externa ?? null,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

const INCLUIR_DETALHE = Object.freeze({
  bem: { select: { id: true, numero: true, codigo_frota: true, nome: true, medidor_tipo: true, medidor_unidade: true, medidor_leitura_atual: true, medidor_data_leitura: true } },
  tanque: { select: { id: true, identificador: true, capacidade_litros: true } },
  localEstoque: { select: { id: true, nome: true } },
  conversao: {
    select: {
      id: true, sequencia: true, versao: true, ativo: true,
      vinculo: { select: { tipoCombustivel: { select: { id: true, codigo: true, nome: true } }, produto: { select: { id: true, nome_produto: true, unidade_principal_estoque: true } } } },
    },
  },
  movimentacao: MOVIMENTO,
  movimentacaoEstorno: MOVIMENTO,
  consumos: { orderBy: { ordem: /** @type {const} */ ('asc') }, select: { ordem: true, estoque_lote_nota_id: true, quantidade: true, custo_unitario: true, lote: { select: { data_documento: true } } } },
  criadoPor: { select: { id: true, login: true } },
  canceladoPor: { select: { id: true, login: true } },
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
    tipo_combustivel: { id: r.conversao.vinculo.tipoCombustivel.id, codigo: r.conversao.vinculo.tipoCombustivel.codigo, nome: r.conversao.vinculo.tipoCombustivel.nome },
    produto: { id: r.conversao.vinculo.produto.id, nome: r.conversao.vinculo.produto.nome_produto, unidade_principal_estoque: r.conversao.vinculo.produto.unidade_principal_estoque },
    local_estoque: { id: r.localEstoque.id, nome: r.localEstoque.nome },
    conversao: { id: r.conversao.id, sequencia: r.conversao.sequencia, versao: r.conversao.versao, vigente: r.conversao.ativo },
    quantidade_litros: t4(r.quantidade_litros),
    kg_por_litro: t6(r.kg_por_litro),
    quantidade_kg: t4(r.quantidade_kg),
    custo_total: t4(r.custo_total),
    custo_unitario_kg: t4(r.custo_unitario_kg),
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
      quantidade_kg: t4(f.quantidade),
      custo_unitario: t4(f.custo_unitario),
      valor: arredondar(dec(f.quantidade).times(dec(f.custo_unitario)), CASAS_CUSTO).toFixed(CASAS_CUSTO),
    })),
    cancelamento:
      r.status === STATUS_CANCELADO
        ? { cancelado_em: iso(r.cancelado_em), cancelado_por: usuarioPublico(r.canceladoPor), motivo: r.motivo_cancelamento }
        : null,
    criado_por: usuarioPublico(r.criadoPor),
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
    select: { id: true, empresa_id: true, numero: true, codigo_frota: true, nome: true, natureza: true, ativo: true, medidor_tipo: true, medidor_unidade: true, medidor_leitura_atual: true, medidor_data_leitura: true },
  });
  if (!bem) throw bemNaoEncontrado();
  const tanque = await tx.tanqueBem.findFirst({
    where: { cliente_id: cli, id: entrada.tanque_id, bem_id: bem.id },
    select: { id: true, bem_id: true, identificador: true, capacidade_litros: true, ativo: true, combustiveis: { select: { combustivel_id: true } } },
  });
  const tipo = await tx.tipoCombustivel.findUnique({
    where: { cliente_id_id: { cliente_id: cli, id: entrada.tipo_combustivel_id } },
    select: { id: true, codigo: true, nome: true, unidade: true, ativo: true },
  });
  const vinculo = await tx.tipoCombustivelProduto.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, tipo_combustivel_id: entrada.tipo_combustivel_id, produto_id: entrada.produto_id },
    select: { id: true, ativo: true },
  });
  const conversao = await tx.conversaoCombustivelProduto.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, tipo_combustivel_id: entrada.tipo_combustivel_id, produto_id: entrada.produto_id, ativo: true },
    select: { id: true, versao: true, sequencia: true, kg_por_litro: true },
  });
  const local = await tx.localEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: entrada.local_estoque_id } }, select: { id: true, nome: true, ativo: true } });
  const produto = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: entrada.produto_id } } });
  const lotes = produto && local ? await lotesFifo(tx, cli, empresaId, produto.id, local.id) : [];
  const vizinhos = ehContador(bem.medidor_tipo)
    ? await pontosVizinhos(tx, cli, bem.id, /** @type {string} */ (bem.medidor_tipo), entrada.data_operacional)
    : { anterior: null, posterior: null };
  return { hoje, fuso, bem, tanque, tipo, vinculo, conversao, local, produto, lotes, medidor: { cadastro: pontoDoCadastro(bem), ...vizinhos } };
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
  for (const campo of ['bem_id', 'tanque_id', 'produto_id', 'status', 'operation_id']) {
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
    return planejarAbastecimento(entrada, estado, { comando: false });
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
            const bemTravado = /** @type {any[]} */ (
              await tx.$queryRaw`SELECT id FROM "BemPatrimonial" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${entrada.bem_id} FOR UPDATE`
            ); // R3
            if (!bemTravado.length) throw bemNaoEncontrado();
            await travarEscopo(tx, chaveVinculo(cli, empresaId, entrada.produto_id)); // R5
            await tx.$queryRaw`SELECT id FROM "TipoCombustivel" WHERE cliente_id = ${cli} AND id = ${entrada.tipo_combustivel_id} FOR KEY SHARE`; // R6
            await tx.$queryRaw`SELECT id FROM "LocalEstoque" WHERE cliente_id = ${cli} AND id = ${entrada.local_estoque_id} FOR KEY SHARE`; // R7
            await travarProdutosEstoque(tx, cli, empresaId, [entrada.produto_id]); // R8
            const estado = await carregarEstado(tx, cli, empresaId, entrada, tempo);
            const { plano, bloqueios } = planejarAbastecimento(entrada, estado, { comando: true });
            if (bloqueios.length) throw erroDoBloqueio(bloqueios[0]);
            const kg = dec(/** @type {string} */ (plano.quantidade_kg));
            const id = randomUUID();
            const saida = await aplicarSaidaFifo(tx, contexto, {
              empresaId,
              produto: estado.produto,
              local: { id: estado.local.id, nome: estado.local.nome },
              quantidadeKg: kg,
              dia: entrada.data_operacional,
              documento: { numero: entrada.referencia_externa, data: entrada.data_operacional },
              origem: { sistema: ORIGEM_ABASTECIMENTO, operacaoId: id, tipoDetalhado: TIPO_DETALHADO_SAIDA, motivo: MOTIVO_SAIDA },
              numeroMovimento: numeroMovimentoProvisorio(),
              contextoErro: { field: 'quantidade_litros' },
            }); // R9 lotes (CAS) + R10 movimento
            if (!somar(saida.fatias.map((f) => f.quantidade)).eq(kg)) throw new Error('abastecimento: fatias FIFO não somam a quantidade em kg');
            const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT })); // R12a
            const contador = ehContador(estado.bem.medidor_tipo);
            const tipoMedidor = estado.bem.medidor_tipo ?? 'SEM_MEDIDOR';
            const linha = await tx.abastecimentoBem.create({
              data: {
                id,
                cliente_id: cli,
                empresa_id: empresaId,
                numero,
                status: STATUS_CONFIRMADO,
                bem_id: estado.bem.id,
                tanque_id: estado.tanque.id,
                tipo_combustivel_id: estado.tipo.id,
                produto_id: estado.produto.id,
                local_estoque_id: estado.local.id,
                conversao_id: estado.conversao.id,
                data_operacional: comoData(entrada.data_operacional),
                quantidade_litros: entrada.quantidade_litros,
                kg_por_litro: dec(estado.conversao.kg_por_litro).toFixed(CASAS_FATOR),
                quantidade_kg: kg.toFixed(CASAS_QUANTIDADE),
                custo_total: paraBanco(saida.valor_total, CASAS_CUSTO),
                custo_unitario_kg: paraBanco(saida.valor_unitario, CASAS_CUSTO),
                tanque_cheio: entrada.tanque_cheio,
                medidor_tipo: tipoMedidor,
                medidor_unidade: contador ? UNIDADE_DO_MEDIDOR[/** @type {'HORIMETRO'} */ (tipoMedidor)] : null,
                medidor_leitura: contador ? entrada.medidor_leitura : null,
                medidor_origem: contador ? 'ABASTECIMENTO' : null,
                observacao: entrada.observacao,
                referencia_externa: entrada.referencia_externa,
                operation_id: entrada.operation_id,
                movimentacao_estoque_id: saida.movimento.id,
                criado_por_usuario_id: auth.usuarioId ?? null,
                versao: 1,
              },
            }); // R11
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
            return { httpStatus: 201, body: await carregarDetalhe(tx, cli, empresaId, id) };
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

// ─── cancelamento (A5) ──────────────────────────────────────────────────────

/** Erros do motor no estorno → recusa do cancelamento (fail-closed). */
const traduzirErroDoEstorno = (erro) => {
  const e = /** @type {any} */ (erro);
  if (!(e instanceof AppError)) return erro;
  if (e.code === 'ESTOQUE_JA_CONSUMIDO') {
    /** @type {Array<'lote_indisponivel_para_devolucao'|'devolucao_excede_entrada'|'fatias_inconsistentes'>} */
    const conhecidos = ['lote_indisponivel_para_devolucao', 'devolucao_excede_entrada', 'fatias_inconsistentes'];
    const reason = conhecidos.find((r) => r === e.details?.reason) ?? 'fatias_inconsistentes';
    return cancelamentoBloqueado(reason, e.details?.lote_id ? { lote_id: e.details.lote_id } : {});
  }
  if (e.code === 'MOVIMENTACAO_ESTOQUE_NOT_FOUND') return cancelamentoBloqueado('movimento_inexistente');
  if (e.code === 'OPERACAO_VALORES_INVALIDOS') return cancelamentoBloqueado('estoque_excede_limite');
  return erro;
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
      TRANSACAO_CURTA,
      (tx) =>
        executarComIdempotencia(tx, {
          clienteId: cli,
          operationKey: entrada.operation_id,
          tipoOperacao: TIPO_CANCELAR,
          fingerprint,
          executar: async () => {
            const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
            const { hoje } = await hojeDaEmpresa(tx, cli, empresaId); // R2 (dia do estorno)
            const base = await tx.abastecimentoBem.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, select: { bem_id: true, produto_id: true } });
            if (!base) throw naoEncontrado();
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
            const bem = await tx.bemPatrimonial.findFirst({
              where: { cliente_id: cli, id: antes.bem_id },
              select: { id: true, medidor_tipo: true, medidor_leitura_atual: true, medidor_data_leitura: true },
            });
            const cadastro = pontoDoCadastro(bem);
            const leituraAntes = leituraVigente(cadastro, await pisoOperacional(tx, cli, antes.bem_id, bem?.medidor_tipo ?? null));
            await travarProdutosEstoque(tx, cli, empresaId, [antes.produto_id]); // R8
            const produto = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: antes.produto_id } } });
            if (!produto || produto.empresa_id !== empresaId || !produto.ativo) throw cancelamentoBloqueado('produto_mudou_de_fazenda');
            const [orig] = /** @type {any[]} */ (
              await tx.$queryRaw`SELECT id, status, movimento_filho_id FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND id = ${antes.movimentacao_estoque_id} FOR UPDATE`
            ); // R10
            if (!orig) throw cancelamentoBloqueado('movimento_inexistente');
            if (orig.status !== 'Ativa' || orig.movimento_filho_id) throw cancelamentoBloqueado('movimento_estornado');
            const fatias = await tx.abastecimentoBemConsumoLote.findMany({ where: { cliente_id: cli, abastecimento_id: id }, orderBy: { ordem: 'asc' } });
            if (!fatias.length || !somar(fatias.map((f) => f.quantidade)).eq(dec(antes.quantidade_kg))) throw cancelamentoBloqueado('fatias_inconsistentes');
            const local = await tx.localEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: antes.local_estoque_id } }, select: { id: true, nome: true } });
            if (!local) throw new Error('abastecimento: local de estoque do abastecimento ausente');
            let estorno;
            try {
              estorno = await estornarSaida(tx, contexto, {
                empresaId,
                item: { quantidade_estoque: antes.quantidade_kg, ordem: 1, movimentacao_estoque_id: orig.id },
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
            await atualizarComVersao(tx.abastecimentoBem, {
              clienteId: cli,
              id,
              versao: entrada.versao,
              data: {
                status: STATUS_CANCELADO,
                movimentacao_estorno_id: estorno.movimento.id,
                cancelado_em: new Date(),
                cancelado_por_usuario_id: auth.usuarioId ?? null,
                motivo_cancelamento: entrada.motivo,
              },
            }); // R11
            const depois = await tx.abastecimentoBem.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id } });
            const leituraDepois = leituraVigente(cadastro, await pisoOperacional(tx, cli, antes.bem_id, bem?.medidor_tipo ?? null));
            await numerarMovimentos(tx, cli, [estorno.movimento.id]); // R12
            await registrarEvento(
              contexto,
              {
                acao: 'abastecimento_bem.cancelar',
                entidade: ENTIDADE,
                entidadeId: id,
                dadosAnteriores: paraAuditoria(antes, fatias),
                dadosNovos: { ...paraAuditoria(depois, fatias), leitura_operacional_antes: leituraAntes, leitura_operacional_depois: leituraDepois },
              },
              tx
            ); // R13
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
