/**
 * D-PROD-272 (Estoque → Novo movimento → Ajuste) — ajuste de inventário documentado.
 *
 *  - Por linha o usuário informa o CONTADO; o servidor lê, sob a trava do produto, o saldo do depósito (Σ das
 *    camadas Disponivel) e grava a diferença: SOBRA entra pelo motor a custo médio do depósito (sem saldo, pelo
 *    custo informado na linha; sem ele, 422); FALTA sai pelo motor a custo médio; sem diferença, só o registro.
 *    O ajuste é sempre do dia de hoje da fazenda. Não cria título, conta a pagar nem receita.
 *  - Criar = confirmar numa só chamada, idempotente por `operation_id`.
 *  - Editar: só a observação, com CAS de versão.
 *  - Excluir: estorno integral pelo motor. D-PROD-273 (fatia 5): com outro movimento do produto naqueles depósitos
 *    depois do ajuste, a exclusão recalcula o custo médio de tudo que veio depois (a sobra como entrada, a falta como
 *    saída); saldo negativo em qualquer ponto → 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO`; outra contagem vigente depois →
 *    409 `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL` `ajuste_de_inventario_posterior` (escolha do proprietário, 2026-11-23).
 *
 * ORDEM DAS TRAVAS: recibo → Empresa FOR SHARE (o "hoje") → (exclusão: cabeçalho FOR UPDATE) →
 * LocalEstoque FOR KEY SHARE → Produto (`travarProdutosEstoque`) → camadas → movimentos → sequências.
 */
import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { TRANSACAO_CURTA, TRANSACAO_LONGA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, ZERO, arredondar, dec, paraBanco } from '../financeiro/decimalFinanceiro.js';
import {
  aplicarFaltaDeAjuste, aplicarSobraDeAjuste, estornarFaltaDeAjuste, estornarSobraDeAjuste, exigirLocaisEstoque, numerarMovimentos,
  numeroMovimentoProvisorio, pocoDoDeposito, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { aplicarExclusaoComRecalculo, planejarExclusaoComRecalculo } from '../estoqueRecalculo/estoqueExclusaoRecalculo.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { comoData, diaDe, diaDoCorpo, listarKeyset, termoDeBusca } from '../patrimonio/patrimonioComum.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  ENTIDADE, FALTA, SEM_DIFERENCA, SOBRA, STATUS_CONFIRMADA, STATUS_EXCLUIDA, TIPO_CRIAR, TIPO_EXCLUIR,
  contadoEmEstoque, fingerprintDaCriacao, fingerprintDaExclusao, normalizarCriacao, normalizarEdicao, normalizarExclusao,
} from './ajusteEstoqueRegras.js';

const LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

// ─── erros ──────────────────────────────────────────────────────────────────
export const naoEncontrado = () => new AppError('AJUSTE_ESTOQUE_NOT_FOUND', 'ajuste de estoque não encontrado nesta fazenda');
const statusInvalido = (status) => new AppError('AJUSTE_ESTOQUE_STATUS_INVALIDO', `o ajuste está ${status}; a ação não é possível; nada foi alterado`, { details: { status } });
const versaoConflito = () => new AppError('AJUSTE_ESTOQUE_VERSAO_CONFLITO', 'o ajuste mudou desde a leitura; recarregue e tente de novo; nada foi alterado');
const invalido422 = (field, reason, mensagem, extra = {}) => new AppError('AJUSTE_ESTOQUE_INVALIDO', `${mensagem}; nada foi gravado`, { details: { field, reason, ...extra } });
const movimentoPosterior = (extra) =>
  new AppError('AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR', 'um produto deste ajuste já teve outro movimento no depósito depois dele; a exclusão não é possível; faça uma nova contagem; nada foi alterado', {
    details: { field: 'itens', reason: 'movimento_posterior', ...extra },
  });

// ─── leitura ────────────────────────────────────────────────────────────────
const INCLUIR_ITENS = {
  orderBy: [{ ordem: /** @type {const} */ ('asc') }],
  include: { produto: { select: { nome_produto: true, codigo_interno: true, unidade_principal_estoque: true } }, local: { select: { nome: true } } },
};
const INCLUIR_CABECALHO = { centroCusto: { select: { nome: true } }, centroResultado: { select: { nome: true } } };
const d4 = (v) => dec(v).toFixed(CASAS_QUANTIDADE);
const c4 = (v) => dec(v).toFixed(CASAS_CUSTO);
const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

const comoItem = (i) => ({
  id: i.id,
  ordem: i.ordem,
  produto_id: i.produto_id,
  produto_nome: i.produto?.nome_produto ?? null,
  produto_codigo: i.produto?.codigo_interno ?? null,
  local_estoque_id: i.local_estoque_id,
  local_estoque_nome: i.local?.nome ?? null,
  unidade: i.unidade,
  quantidade_contada: d4(i.quantidade_contada),
  fator_kg: d4(i.fator_kg),
  contado_estoque: d4(i.contado_estoque),
  saldo_anterior: d4(i.saldo_anterior),
  diferenca: d4(i.diferenca),
  unidade_estoque: i.produto?.unidade_principal_estoque === 'L' ? 'L' : 'KG',
  tipo: i.tipo,
  custo_unitario: c4(i.custo_unitario),
  custo_informado: i.custo_informado,
  valor_total: c4(i.valor_total),
  movimentacao_estoque_id: i.movimentacao_estoque_id,
  movimentacao_estorno_id: i.movimentacao_estorno_id,
});

const comoResumo = (a) => {
  const itens = a.itens ?? [];
  const soma = (tipo) => c4(itens.filter((i) => i.tipo === tipo).reduce((t, i) => t.plus(dec(i.valor_total)), ZERO));
  return {
    id: a.id,
    empresa_id: a.empresa_id,
    numero: a.numero,
    status: a.status,
    versao: a.versao,
    data_ajuste: diaDe(a.data_ajuste),
    centro_custo_id: a.centro_custo_id ?? null,
    centro_custo_nome: a.centroCusto?.nome ?? null,
    centro_resultado_id: a.centro_resultado_id ?? null,
    centro_resultado_nome: a.centroResultado?.nome ?? null,
    observacao: a.observacao,
    valor_sobras: soma(SOBRA),
    valor_faltas: soma(FALTA),
    excluida_em: iso(a.excluida_em),
    criada_em: iso(a.createdAt),
    itens: itens.map(comoItem),
  };
};

export const carregarDetalhe = async (db, cli, empresaId, id) => {
  const a = await db.ajusteEstoque.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, id },
    include: { ...INCLUIR_CABECALHO, itens: INCLUIR_ITENS, eventos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  if (!a) throw naoEncontrado();
  return {
    ...comoResumo(a),
    confirmada_em: iso(a.confirmada_em),
    excluida_por_usuario_id: a.excluida_por_usuario_id,
    motivo_exclusao: a.motivo_exclusao,
    eventos: a.eventos.map((v) => ({ id: v.id, tipo: v.tipo, versao_anterior: v.versao_anterior, versao_nova: v.versao_nova, motivo: v.motivo, usuario_id: v.usuario_id, criado_em: iso(v.createdAt) })),
  };
};

/** Lista keyset dos ajustes da fazenda. @param {any} contexto @param {Record<string, any>} [query] */
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
  if (typeof query.status === 'string' && query.status) where.status = query.status;
  if (typeof query.produto_id === 'string' && query.produto_id) where.itens = { some: { produto_id: query.produto_id } };
  if (de || ate) where.data_ajuste = { ...(de ? { gte: comoData(de) } : {}), ...(ate ? { lte: comoData(ate) } : {}) };
  const q = termoDeBusca(query.q);
  const busca = q ? [{ numero: { contains: q } }, { itens: { some: { produto: { nome_produto: { contains: q, mode: 'insensitive' } } } } }] : [];
  return listarKeyset(prisma.ajusteEstoque, { where, busca, query, include: { ...INCLUIR_CABECALHO, itens: INCLUIR_ITENS }, mapItem: comoResumo });
};

/** @param {any} contexto @param {string} id @param {Record<string, any>} [query] */
export const detalhar = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    return carregarDetalhe(tx, cli, empresaId, id);
  });
};

/**
 * Saldo e custo médio do produto no depósito (para a tela mostrar e calcular a diferença). Leitura sem trava:
 * a diferença que vale é a recalculada ao gravar.
 * @param {any} contexto @param {Record<string, any>} query
 */
export const saldoDoDeposito = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const produto = await tx.produto.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: query.produto_id }, select: { id: true, unidade_principal_estoque: true } });
    if (!produto) throw invalido422('produto_id', 'produto_inexistente', 'produto não encontrado nesta fazenda');
    const local = await tx.localEstoque.findFirst({ where: { cliente_id: cli, id: query.local_estoque_id }, select: { id: true } });
    if (!local) throw invalido422('local_estoque_id', 'local_inexistente', 'depósito não encontrado');
    const poco = await pocoDoDeposito(tx, cli, empresaId, produto.id, local.id);
    return {
      produto_id: produto.id, local_estoque_id: local.id, unidade_estoque: produto.unidade_principal_estoque === 'L' ? 'L' : 'KG',
      saldo: d4(poco.quantidade), custo_medio: poco.custoMedio === null ? null : c4(poco.custoMedio),
    };
  });
};

const exigirCentros = async (tx, cli, empresaId, ajuste) => {
  for (const [campo, delegado, rotulo, prefixo] of /** @type {const} */ ([
    ['centro_custo_id', 'centroCusto', 'centro de custo', 'centro_custo'],
    ['centro_resultado_id', 'centroResultado', 'centro de resultado', 'centro_resultado'],
  ])) {
    const id = ajuste[campo];
    if (!id) continue;
    const c = await tx[delegado].findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, select: { ativo: true } });
    if (!c) throw invalido422(campo, `${prefixo}_inexistente`, `${rotulo} não encontrado nesta fazenda`);
    if (!c.ativo) throw invalido422(campo, `${prefixo}_inativo`, `o ${rotulo} está inativo`);
  }
};

const paraAuditoria = (a, itens) => ({
  id: a.id, numero: a.numero, status: a.status, versao: a.versao,
  centro_custo_id: a.centro_custo_id ?? null, centro_resultado_id: a.centro_resultado_id ?? null,
  itens: itens.map((i) => ({ id: i.id, produto_id: i.produto_id, local_estoque_id: i.local_estoque_id, tipo: i.tipo, diferenca: d4(i.diferenca), movimentacao_estoque_id: i.movimentacao_estoque_id })),
});

// ─── criar (confirmar) ──────────────────────────────────────────────────────

/** @param {any} contexto @param {Record<string, any>} corpo */
export const criar = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const ajuste = normalizarCriacao(corpo);
  const fingerprint = fingerprintDePayload(fingerprintDaCriacao(ajuste));
  const r = await emTransacao(
    TRANSACAO_LONGA,
    (tx) =>
      executarComIdempotencia(tx, {
        clienteId: cli,
        operationKey: ajuste.operation_id,
        tipoOperacao: TIPO_CRIAR,
        fingerprint,
        executar: async () => {
          const empresaId = await exigirEmpresaDoTenant(tx, cli, ajuste.empresa_id);
          const tempo = await hojeDaEmpresa(tx, cli, empresaId);
          await exigirCentros(tx, cli, empresaId, ajuste);
          const locais = await exigirLocaisEstoque(tx, cli, ajuste.itens.map((i) => ({ id: i.local_estoque_id, field: 'local_estoque_id', exigirAtivo: true })));
          const produtoIds = await travarProdutosEstoque(tx, cli, empresaId, ajuste.itens.map((i) => i.produto_id));
          const produtos = new Map((await tx.produto.findMany({ where: { cliente_id: cli, empresa_id: empresaId, id: { in: produtoIds } } })).map((p) => [p.id, p]));
          // Sob a trava do produto: o saldo de agora decide a diferença de cada linha.
          const planos = [];
          for (const [indice, item] of ajuste.itens.entries()) {
            const p = produtos.get(item.produto_id);
            if (!p) throw invalido422('produto_id', 'produto_inexistente', 'produto não encontrado nesta fazenda', { indice });
            if (!p.ativo) throw invalido422('produto_id', 'produto_inativo', 'o produto está inativo', { indice });
            const { fator, contado } = contadoEmEstoque(item, p, indice);
            const poco = await pocoDoDeposito(tx, cli, empresaId, p.id, item.local_estoque_id);
            const diferenca = contado.minus(poco.quantidade);
            let tipo = SEM_DIFERENCA;
            let custo = poco.custoMedio ?? ZERO;
            let custoInformado = false;
            if (diferenca.gt(0)) {
              tipo = SOBRA;
              if (poco.custoMedio === null) {
                if (item.custo_unitario === null) {
                  throw invalido422('custo_unitario', 'custo_obrigatorio_sem_saldo', 'o depósito não tem saldo deste produto, então não há custo médio: informe o custo da sobra', { indice });
                }
                custo = dec(item.custo_unitario);
                custoInformado = true;
              }
            } else if (diferenca.lt(0)) {
              tipo = FALTA;
            }
            planos.push({ item, p, fator, contado, saldo: poco.quantidade, diferenca, tipo, custo, custoInformado, indice });
          }

          const id = randomUUID();
          const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT }));
          const agora = new Date();
          const cabecalho = await tx.ajusteEstoque.create({
            data: {
              id, cliente_id: cli, empresa_id: empresaId, numero, status: STATUS_CONFIRMADA, versao: 1, data_ajuste: comoData(tempo.hoje),
              centro_custo_id: ajuste.centro_custo_id, centro_resultado_id: ajuste.centro_resultado_id, observacao: ajuste.observacao,
              confirmada_em: agora, confirmada_por_usuario_id: auth.usuarioId ?? null,
            },
          });
          const movimentosIds = [];
          const linhas = [];
          for (const pl of planos) {
            const local = /** @type {any} */ (locais.get(pl.item.local_estoque_id));
            const base = { empresaId, produto: pl.p, local: { id: local.id, nome: local.nome }, dia: tempo.hoje, numeroMovimento: numeroMovimentoProvisorio(), contextoErro: { field: 'itens', indice: pl.indice } };
            let loteId = null;
            let movimentoId = null;
            let custo = pl.custo;
            let valor = ZERO;
            if (pl.tipo === SOBRA) {
              valor = arredondar(pl.diferenca.times(pl.custo), CASAS_CUSTO);
              const r = await aplicarSobraDeAjuste(tx, contexto, {
                ...base, quantidadeKg: pl.diferenca, custoUnitarioKg: pl.custo, valorTotal: valor, documento: { numero, data: tempo.hoje },
                origem: { operacaoId: id, motivo: `Ajuste de inventário nº ${numero}: sobra` },
              });
              loteId = r.lote.id;
              movimentoId = r.movimento.id;
            } else if (pl.tipo === FALTA) {
              const r = await aplicarFaltaDeAjuste(tx, contexto, {
                ...base, quantidadeKg: pl.diferenca.negated(), documento: { numero, data: tempo.hoje },
                origem: { operacaoId: id, motivo: `Ajuste de inventário nº ${numero}: falta` },
              });
              movimentoId = r.movimento.id;
              custo = dec(r.valor_unitario);
              valor = dec(r.valor_total);
            }
            if (movimentoId) movimentosIds.push(movimentoId);
            linhas.push(await tx.ajusteEstoqueItem.create({
              data: {
                cliente_id: cli, empresa_id: empresaId, ajuste_id: id, ordem: pl.indice + 1, produto_id: pl.p.id, local_estoque_id: local.id,
                unidade: pl.item.unidade, quantidade_contada: pl.item.quantidade_contada, fator_kg: paraBanco(pl.fator, CASAS_QUANTIDADE),
                contado_estoque: paraBanco(pl.contado, CASAS_QUANTIDADE), saldo_anterior: paraBanco(pl.saldo, CASAS_QUANTIDADE),
                diferenca: paraBanco(pl.diferenca, CASAS_QUANTIDADE), tipo: pl.tipo, custo_unitario: paraBanco(custo, CASAS_CUSTO),
                custo_informado: pl.custoInformado, valor_total: paraBanco(valor, CASAS_CUSTO),
                estoque_lote_nota_id: loteId, movimentacao_estoque_id: movimentoId,
              },
            }));
          }
          await numerarMovimentos(tx, cli, movimentosIds);
          await tx.ajusteEstoqueEvento.create({
            data: {
              cliente_id: cli, empresa_id: empresaId, ajuste_id: id, tipo: 'CONFIRMACAO', versao_anterior: 0, versao_nova: 1,
              motivo: `Ajuste de inventário nº ${numero}`, usuario_id: auth.usuarioId ?? null,
              snapshot_novo: { cabecalho: paraAuditoria(cabecalho, linhas), observacao: ajuste.observacao },
            },
          });
          await registrarEvento(contexto, { acao: 'ajuste_estoque.confirmar', entidade: ENTIDADE, entidadeId: id, dadosNovos: paraAuditoria(cabecalho, linhas) }, tx);
          return { httpStatus: 201, body: await carregarDetalhe(tx, cli, empresaId, id) };
        },
      }),
    { operation_id: () => new AppError('AJUSTE_ESTOQUE_VERSAO_CONFLITO', 'outra operação alterou os mesmos registros; tente de novo com a mesma operation_id') },
  );
  return { status: r.replay ? 200 : 201, body: { ...r.body, replay: r.replay } };
};

// ─── editar (só a observação) ───────────────────────────────────────────────

/** @param {any} contexto @param {string} id @param {Record<string, any>} corpo */
export const editar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const e = normalizarEdicao(id, corpo);
  return emTransacao(TRANSACAO_CURTA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, e.empresa_id);
    const [atual] = /** @type {any[]} */ (await tx.$queryRaw`SELECT * FROM "AjusteEstoque" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`);
    if (!atual) throw naoEncontrado();
    if (e.campos_fisicos.length) {
      throw new AppError('AJUSTE_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA', 'só a observação se edita; para mudar a contagem ou os centros, exclua o ajuste e faça outro; nada foi alterado', { details: { campos: e.campos_fisicos } });
    }
    if (atual.status !== STATUS_CONFIRMADA) throw statusInvalido(atual.status);
    if (!Number.isInteger(e.versao) || e.versao !== atual.versao) throw versaoConflito();
    const observacao = e.observacao === undefined ? atual.observacao : e.observacao;
    if (observacao === atual.observacao) throw invalido422('observacao', 'nada_a_alterar', 'nada mudou na observação');
    await tx.ajusteEstoque.update({ where: { cliente_id_id: { cliente_id: cli, id } }, data: { observacao, versao: atual.versao + 1 } });
    await tx.ajusteEstoqueEvento.create({
      data: {
        cliente_id: cli, empresa_id: empresaId, ajuste_id: id, tipo: 'EDICAO', versao_anterior: atual.versao, versao_nova: atual.versao + 1,
        motivo: e.motivo_edicao, usuario_id: auth.usuarioId ?? null, snapshot_anterior: { observacao: atual.observacao }, snapshot_novo: { observacao },
      },
    });
    await registrarEvento(contexto, { acao: 'ajuste_estoque.editar', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: { versao: atual.versao }, dadosNovos: { versao: atual.versao + 1, motivo_informado: true } }, tx);
    return carregarDetalhe(tx, cli, empresaId, id);
  });
};

// ─── excluir (estorno integral pelo motor) ──────────────────────────────────

/** @param {any} contexto @param {string} id @param {Record<string, any>} corpo */
export const excluir = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const e = normalizarExclusao(id, corpo);
  const fingerprint = fingerprintDePayload(fingerprintDaExclusao(e));
  const r = await emTransacao(
    TRANSACAO_LONGA,
    (tx) =>
      executarComIdempotencia(tx, {
        clienteId: cli,
        operationKey: e.operation_id,
        tipoOperacao: TIPO_EXCLUIR,
        fingerprint,
        executar: async () => {
          const empresaId = await exigirEmpresaDoTenant(tx, cli, e.empresa_id);
          const tempo = await hojeDaEmpresa(tx, cli, empresaId);
          const [atual] = /** @type {any[]} */ (await tx.$queryRaw`SELECT * FROM "AjusteEstoque" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`);
          if (!atual) throw naoEncontrado();
          if (atual.status !== STATUS_CONFIRMADA) throw statusInvalido(atual.status);
          if (!Number.isInteger(e.versao) || e.versao !== atual.versao) throw versaoConflito();
          const itens = await tx.ajusteEstoqueItem.findMany({ where: { cliente_id: cli, ajuste_id: id }, orderBy: [{ ordem: 'asc' }], include: { local: { select: { nome: true } } } });
          const comMovimento = itens.filter((i) => i.movimentacao_estoque_id);
          const estornos = [];
          /** @type {any} */
          let recalculo = null;
          if (comMovimento.length) {
            await exigirLocaisEstoque(tx, cli, comMovimento.map((i) => ({ id: i.local_estoque_id, field: 'local_estoque_id', exigirAtivo: false })));
            const produtoIds = await travarProdutosEstoque(tx, cli, empresaId, comMovimento.map((i) => i.produto_id));
            // D-PROD-273 (fatia 5): com outro movimento do produto no depósito depois do ajuste, a exclusão RECALCULA o que
            // veio depois — a sobra sai como uma entrada, a falta como uma saída (prova antes de gravar; saldo negativo em
            // qualquer ponto → 409; sem estorno exato como saída). Escolha do proprietário (2026-11-23): OUTRA contagem
            // vigente depois, num depósito que a exclusão muda, recusa (409 `ajuste_de_inventario_posterior`).
            const planos = await planejarExclusaoComRecalculo(tx, cli, {
              empresaId, movimentos: comMovimento.map((i) => ({ id: /** @type {string} */ (i.movimentacao_estoque_id), produtoId: i.produto_id, localId: i.local_estoque_id })),
            });
            const peloRecalculo = new Set(planos.flatMap((p) => p.excluirIds));
            const produtos = new Map((await tx.produto.findMany({ where: { cliente_id: cli, empresa_id: empresaId, id: { in: produtoIds } } })).map((p) => [p.id, p]));
            const motivoEstorno = `Exclusão do ajuste ${atual.numero}: ${e.motivo}`.slice(0, 255);
            const sobras = comMovimento.filter((i) => i.tipo === SOBRA);
            const porItem = new Map();
            if (sobras.length) {
              const ids = await estornarSobraDeAjuste(tx, contexto, {
                empresaId,
                itens: sobras.map((i) => ({
                  produto_id: i.produto_id, local_estoque_id: i.local_estoque_id, local_estoque_nome: i.local?.nome, movimentacao_estoque_id: i.movimentacao_estoque_id,
                  estoque_lote_nota_id: i.estoque_lote_nota_id, quantidade_estoque: i.diferenca.toString(), ordem: i.ordem, consumos: [],
                })),
                dia: tempo.hoje,
                documento: { numero: atual.numero, data: tempo.hoje },
                origem: { operacaoId: id, motivoEstorno },
                numeroMovimento: numeroMovimentoProvisorio,
                camadaPeloRecalculo: sobras.map((i) => /** @type {string} */ (i.movimentacao_estoque_id)).filter((m) => peloRecalculo.has(m)),
              });
              sobras.forEach((i, k) => porItem.set(i.id, ids[k]));
            }
            const movimentos = new Map((await tx.movimentacaoEstoque.findMany({
              where: { cliente_id: cli, id: { in: comMovimento.filter((i) => i.tipo === FALTA).map((i) => /** @type {string} */ (i.movimentacao_estoque_id)) } }, select: { id: true, lotes_consumidos: true },
            })).map((m) => [m.id, m]));
            for (const item of comMovimento.filter((i) => i.tipo === FALTA)) {
              const fatias = /** @type {any} */ (movimentos.get(/** @type {string} */ (item.movimentacao_estoque_id)))?.lotes_consumidos;
              if (!Array.isArray(fatias) || !fatias.length) throw movimentoPosterior({ item_ordem: item.ordem, reason: 'fatias_ausentes' });
              const rr = await estornarFaltaDeAjuste(tx, contexto, {
                empresaId,
                item: { ordem: item.ordem, quantidade_estoque: item.diferenca.negated().toString(), movimentacao_estoque_id: item.movimentacao_estoque_id },
                consumos: fatias.map((f) => ({ estoque_lote_nota_id: f.lote_id, quantidade: f.quantidade })),
                produto: produtos.get(item.produto_id),
                local: { id: item.local_estoque_id, nome: item.local?.nome ?? null },
                dia: tempo.hoje,
                documento: { numero: atual.numero, data: tempo.hoje },
                origem: { operacaoId: id, motivoEstorno },
                numeroMovimento: numeroMovimentoProvisorio(),
              });
              porItem.set(item.id, rr.movimento.id);
            }
            for (const item of comMovimento) {
              const est = porItem.get(item.id);
              estornos.push(est);
              await tx.ajusteEstoqueItem.update({ where: { cliente_id_id: { cliente_id: cli, id: item.id } }, data: { movimentacao_estorno_id: est } });
            }
            recalculo = planos.length
              ? await aplicarExclusaoComRecalculo(tx, contexto, planos, {
                empresaId, motivo: motivoEstorno, origem: 'ajuste_estoque',
                estornos: new Map(comMovimento.map((i) => [/** @type {string} */ (i.movimentacao_estoque_id), porItem.get(i.id)])),
              })
              : null;
            await numerarMovimentos(tx, cli, estornos);
          }
          const depois = await tx.ajusteEstoque.update({
            where: { cliente_id_id: { cliente_id: cli, id } },
            data: { status: STATUS_EXCLUIDA, versao: atual.versao + 1, excluida_em: new Date(), excluida_por_usuario_id: auth.usuarioId ?? null, motivo_exclusao: e.motivo },
          });
          await tx.ajusteEstoqueEvento.create({
            data: {
              cliente_id: cli, empresa_id: empresaId, ajuste_id: id, tipo: 'EXCLUSAO', versao_anterior: atual.versao, versao_nova: atual.versao + 1,
              motivo: e.motivo, usuario_id: auth.usuarioId ?? null,
              snapshot_anterior: { status: atual.status, itens: itens.map((i) => ({ id: i.id, tipo: i.tipo, diferenca: d4(i.diferenca), movimentacao_estoque_id: i.movimentacao_estoque_id })) },
              snapshot_novo: { status: depois.status, estornos },
            },
          });
          await registrarEvento(contexto, {
            acao: 'ajuste_estoque.excluir', entidade: ENTIDADE, entidadeId: id,
            dadosAnteriores: { status: atual.status, versao: atual.versao }, dadosNovos: { status: depois.status, versao: depois.versao, motivo_informado: true, estornos, recalculo },
          }, tx);
          return { httpStatus: 200, body: { ...(await carregarDetalhe(tx, cli, empresaId, id)), recalculo } };
        },
      }),
  );
  return { status: 200, body: { ...r.body, replay: r.replay } };
};
