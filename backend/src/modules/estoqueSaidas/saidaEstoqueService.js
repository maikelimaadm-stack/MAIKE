/**
 * D-PROD-264 (Estoque → Novo movimento → Saída) — saída manual documentada.
 *
 *  - Toda mudança de estoque passa pelo MOTOR (`aplicarSaidaDocumentada` e `estornarSaidaDocumentada`):
 *    este módulo não calcula custo nem escreve em camada, movimento ou cache. O valor é o custo médio do
 *    produto no depósito (nunca digitado); saldo insuficiente é recusado pelo motor (409
 *    ESTOQUE_SALDO_INSUFICIENTE).
 *  - O motivo vem do cadastro de motivos de saída (`motivo_id`, ativo); centros (ativos, da fazenda) e
 *    observação no cabeçalho. Não cria título, conta a pagar nem receita.
 *  - Criar = confirmar numa só chamada, idempotente por `operation_id` (recibo + unique).
 *  - Editar: só a observação, com CAS de versão e evento `EDICAO`.
 *  - Excluir: exclusão lógica (`EXCLUIDA`) com estorno integral pelo motor, SÓ se o produto não teve outro
 *    movimento naquele depósito depois da saída (escolha do proprietário): o estorno devolve as fatias aos
 *    lotes e o valor exato gravado, sem recalcular nada que veio depois.
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
import { CASAS_CUSTO, CASAS_QUANTIDADE, dec, paraBanco } from '../financeiro/decimalFinanceiro.js';
import {
  aplicarSaidaDocumentada, estornarSaidaDocumentada, exigirLocaisEstoque, numerarMovimentos, numeroMovimentoProvisorio, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { movimentoPosteriorNoDeposito } from '../estoqueFisico/movimentoPosterior.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { comoData, diaDe, diaDoCorpo, listarKeyset, termoDeBusca } from '../patrimonio/patrimonioComum.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  ENTIDADE, STATUS_CONFIRMADA, STATUS_EXCLUIDA, TEXTO_SAIDA, TIPO_CRIAR, TIPO_EXCLUIR,
  fingerprintDaCriacao, fingerprintDaExclusao, normalizarCriacao, normalizarEdicao, normalizarExclusao, quantidadeDeEstoque,
} from './saidaEstoqueRegras.js';
import { exigirMotivoSaidaAtivo } from './motivoSaidaEstoqueService.js';

const LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });

// ─── erros ──────────────────────────────────────────────────────────────────
export const naoEncontrada = () => new AppError('SAIDA_ESTOQUE_NOT_FOUND', 'saída de estoque não encontrada nesta fazenda');
const statusInvalido = (status) => new AppError('SAIDA_ESTOQUE_STATUS_INVALIDO', `a saída está ${status}; a ação não é possível; nada foi alterado`, { details: { status } });
const versaoConflito = () => new AppError('SAIDA_ESTOQUE_VERSAO_CONFLITO', 'a saída mudou desde a leitura; recarregue e tente de novo; nada foi alterado');
const invalida = (field, reason, mensagem, extra = {}) => new AppError('SAIDA_ESTOQUE_INVALIDA', `${mensagem}; nada foi gravado`, { details: { field, reason, ...extra } });
const movimentoPosterior = (extra) =>
  new AppError('SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR', 'o produto já teve outro movimento neste depósito depois desta saída; a exclusão não é possível; lance uma entrada para corrigir; nada foi alterado', {
    details: { field: 'itens', reason: 'movimento_posterior', ...extra },
  });

// ─── leitura ────────────────────────────────────────────────────────────────
const INCLUIR_ITENS = {
  orderBy: [{ ordem: /** @type {const} */ ('asc') }],
  include: { produto: { select: { nome_produto: true, codigo_interno: true, unidade_principal_estoque: true } }, local: { select: { nome: true } } },
};
const INCLUIR_CABECALHO = {
  motivo: { select: { nome: true } },
  centroCusto: { select: { nome: true } },
  centroResultado: { select: { nome: true } },
};
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
  quantidade: d4(i.quantidade),
  fator_kg: d4(i.fator_kg),
  quantidade_estoque: d4(i.quantidade_estoque),
  unidade_estoque: i.produto?.unidade_principal_estoque === 'L' ? 'L' : 'KG',
  custo_unitario: c4(i.custo_unitario),
  valor_total: c4(i.valor_total),
  movimentacao_estoque_id: i.movimentacao_estoque_id,
  movimentacao_estorno_id: i.movimentacao_estorno_id,
});

const comoResumo = (s) => ({
  id: s.id,
  empresa_id: s.empresa_id,
  numero: s.numero,
  status: s.status,
  versao: s.versao,
  motivo_id: s.motivo_id,
  motivo_nome: s.motivo?.nome ?? null,
  data_saida: diaDe(s.data_saida),
  centro_custo_id: s.centro_custo_id ?? null,
  centro_custo_nome: s.centroCusto?.nome ?? null,
  centro_resultado_id: s.centro_resultado_id ?? null,
  centro_resultado_nome: s.centroResultado?.nome ?? null,
  observacao: s.observacao,
  valor_total: c4((s.itens ?? []).reduce((t, i) => t.plus(dec(i.valor_total)), dec(0))),
  excluida_em: iso(s.excluida_em),
  criada_em: iso(s.createdAt),
  itens: (s.itens ?? []).map(comoItem),
});

/** Detalhe: cabeçalho, linhas e eventos. */
export const carregarDetalhe = async (db, cli, empresaId, id) => {
  const s = await db.saidaEstoque.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, id },
    include: { ...INCLUIR_CABECALHO, itens: INCLUIR_ITENS, eventos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  if (!s) throw naoEncontrada();
  return {
    ...comoResumo(s),
    confirmada_em: iso(s.confirmada_em),
    excluida_por_usuario_id: s.excluida_por_usuario_id,
    motivo_exclusao: s.motivo_exclusao,
    eventos: s.eventos.map((v) => ({
      id: v.id, tipo: v.tipo, versao_anterior: v.versao_anterior, versao_nova: v.versao_nova, motivo: v.motivo, usuario_id: v.usuario_id, criado_em: iso(v.createdAt),
    })),
  };
};

/** Lista keyset (createdAt desc, id desc) das saídas da fazenda. @param {any} contexto @param {Record<string, any>} [query] */
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
  for (const campo of ['status', 'motivo_id']) if (typeof query[campo] === 'string' && query[campo]) where[campo] = query[campo];
  if (typeof query.produto_id === 'string' && query.produto_id) where.itens = { some: { produto_id: query.produto_id } };
  if (de || ate) where.data_saida = { ...(de ? { gte: comoData(de) } : {}), ...(ate ? { lte: comoData(ate) } : {}) };
  const q = termoDeBusca(query.q);
  const busca = q ? [{ numero: { contains: q } }, { itens: { some: { produto: { nome_produto: { contains: q, mode: 'insensitive' } } } } }] : [];
  return listarKeyset(prisma.saidaEstoque, { where, busca, query, include: { ...INCLUIR_CABECALHO, itens: INCLUIR_ITENS }, mapItem: comoResumo });
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

/** Centros do cabeçalho, lidos na transação: da fazenda e ativos. */
const exigirCentros = async (tx, cli, empresaId, saida) => {
  for (const [campo, delegado, rotulo, prefixo] of /** @type {const} */ ([
    ['centro_custo_id', 'centroCusto', 'centro de custo', 'centro_custo'],
    ['centro_resultado_id', 'centroResultado', 'centro de resultado', 'centro_resultado'],
  ])) {
    const id = saida[campo];
    if (!id) continue;
    const c = await tx[delegado].findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, select: { ativo: true } });
    if (!c) throw invalida(campo, `${prefixo}_inexistente`, `${rotulo} não encontrado nesta fazenda`);
    if (!c.ativo) throw invalida(campo, `${prefixo}_inativo`, `o ${rotulo} está inativo`);
  }
};

const paraAuditoria = (s, itens) => ({
  id: s.id, numero: s.numero, status: s.status, versao: s.versao, motivo_id: s.motivo_id,
  centro_custo_id: s.centro_custo_id ?? null, centro_resultado_id: s.centro_resultado_id ?? null,
  itens: itens.map((i) => ({ id: i.id, produto_id: i.produto_id, local_estoque_id: i.local_estoque_id, quantidade_estoque: d4(i.quantidade_estoque), movimentacao_estoque_id: i.movimentacao_estoque_id })),
});

// ─── criar (confirmar) ──────────────────────────────────────────────────────

/** @param {any} contexto @param {Record<string, any>} corpo */
export const criar = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const saida = normalizarCriacao(corpo);
  const fingerprint = fingerprintDePayload(fingerprintDaCriacao(saida));
  const r = await emTransacao(
    TRANSACAO_LONGA,
    (tx) =>
      executarComIdempotencia(tx, {
        clienteId: cli,
        operationKey: saida.operation_id,
        tipoOperacao: TIPO_CRIAR,
        fingerprint,
        executar: async () => {
          const empresaId = await exigirEmpresaDoTenant(tx, cli, saida.empresa_id);
          const tempo = await hojeDaEmpresa(tx, cli, empresaId);
          if (saida.data_saida > tempo.hoje) throw invalida('data_saida', 'data_futura', `a data da saída é posterior a hoje (${tempo.hoje}) na fazenda`, { hoje: tempo.hoje, fuso: tempo.fuso });
          const motivo = await exigirMotivoSaidaAtivo(tx, cli, saida.motivo_id);
          await exigirCentros(tx, cli, empresaId, saida);
          const locais = await exigirLocaisEstoque(tx, cli, saida.itens.map((i) => ({ id: i.local_estoque_id, field: 'local_origem_id', exigirAtivo: true })));
          const produtoIds = await travarProdutosEstoque(tx, cli, empresaId, saida.itens.map((i) => i.produto_id));
          const produtos = new Map((await tx.produto.findMany({ where: { cliente_id: cli, empresa_id: empresaId, id: { in: produtoIds } } })).map((p) => [p.id, p]));
          const quantidades = saida.itens.map((item, indice) => {
            const p = produtos.get(item.produto_id);
            if (!p) throw invalida('produto_id', 'produto_inexistente', 'produto não encontrado nesta fazenda', { indice });
            if (!p.ativo) throw invalida('produto_id', 'produto_inativo', 'o produto está inativo', { indice });
            return quantidadeDeEstoque(item, p, indice);
          });

          const id = randomUUID();
          const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT }));
          const agora = new Date();
          const cabecalho = await tx.saidaEstoque.create({
            data: {
              id, cliente_id: cli, empresa_id: empresaId, numero, status: STATUS_CONFIRMADA, versao: 1, motivo_id: motivo.id,
              data_saida: comoData(saida.data_saida), centro_custo_id: saida.centro_custo_id, centro_resultado_id: saida.centro_resultado_id,
              observacao: saida.observacao, confirmada_em: agora, confirmada_por_usuario_id: auth.usuarioId ?? null,
            },
          });
          const texto = `${TEXTO_SAIDA}: ${motivo.nome}`.slice(0, 200);
          const movimentosIds = [];
          const linhas = [];
          for (const [indice, item] of saida.itens.entries()) {
            const p = /** @type {any} */ (produtos.get(item.produto_id));
            const local = /** @type {any} */ (locais.get(item.local_estoque_id));
            const q = quantidades[indice];
            const r = await aplicarSaidaDocumentada(tx, contexto, {
              empresaId,
              produto: p,
              local: { id: local.id, nome: local.nome },
              quantidadeKg: q.quantidadeEstoque,
              dia: saida.data_saida,
              origem: { operacaoId: id, motivo: texto },
              numeroMovimento: numeroMovimentoProvisorio(),
              contextoErro: { field: 'itens', indice },
            });
            movimentosIds.push(r.movimento.id);
            linhas.push(await tx.saidaEstoqueItem.create({
              data: {
                cliente_id: cli, empresa_id: empresaId, saida_id: id, ordem: indice + 1, produto_id: p.id, local_estoque_id: local.id,
                unidade: item.unidade, quantidade: item.quantidade, fator_kg: paraBanco(q.fator, CASAS_QUANTIDADE),
                quantidade_estoque: paraBanco(q.quantidadeEstoque, CASAS_QUANTIDADE),
                custo_unitario: paraBanco(r.valor_unitario, CASAS_CUSTO), valor_total: paraBanco(r.valor_total, CASAS_CUSTO),
                movimentacao_estoque_id: r.movimento.id,
              },
            }));
          }
          await numerarMovimentos(tx, cli, movimentosIds);
          await tx.saidaEstoqueEvento.create({
            data: {
              cliente_id: cli, empresa_id: empresaId, saida_id: id, tipo: 'CONFIRMACAO', versao_anterior: 0, versao_nova: 1,
              motivo: texto, usuario_id: auth.usuarioId ?? null,
              snapshot_novo: { cabecalho: paraAuditoria(cabecalho, linhas), motivo_nome: motivo.nome, observacao: saida.observacao },
            },
          });
          await registrarEvento(contexto, { acao: 'saida_estoque.confirmar', entidade: ENTIDADE, entidadeId: id, dadosNovos: paraAuditoria(cabecalho, linhas) }, tx);
          return { httpStatus: 201, body: await carregarDetalhe(tx, cli, empresaId, id) };
        },
      }),
    { operation_id: () => new AppError('SAIDA_ESTOQUE_VERSAO_CONFLITO', 'outra operação alterou os mesmos registros; tente de novo com a mesma operation_id') },
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
    const [atual] = /** @type {any[]} */ (await tx.$queryRaw`SELECT * FROM "SaidaEstoque" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`);
    if (!atual) throw naoEncontrada();
    if (e.campos_fisicos.length) {
      throw new AppError('SAIDA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA', 'só a observação se edita; para mudar motivo, data, centros, produto, quantidade ou depósito, exclua a saída e lance outra; nada foi alterado', { details: { campos: e.campos_fisicos } });
    }
    if (atual.status !== STATUS_CONFIRMADA) throw statusInvalido(atual.status);
    if (!Number.isInteger(e.versao) || e.versao !== atual.versao) throw versaoConflito();
    const observacao = e.observacao === undefined ? atual.observacao : e.observacao;
    if (observacao === atual.observacao) throw invalida('observacao', 'nada_a_alterar', 'nada mudou na observação');
    await tx.saidaEstoque.update({ where: { cliente_id_id: { cliente_id: cli, id } }, data: { observacao, versao: atual.versao + 1 } });
    await tx.saidaEstoqueEvento.create({
      data: {
        cliente_id: cli, empresa_id: empresaId, saida_id: id, tipo: 'EDICAO', versao_anterior: atual.versao, versao_nova: atual.versao + 1,
        motivo: e.motivo_edicao, usuario_id: auth.usuarioId ?? null, snapshot_anterior: { observacao: atual.observacao }, snapshot_novo: { observacao },
      },
    });
    await registrarEvento(contexto, {
      acao: 'saida_estoque.editar', entidade: ENTIDADE, entidadeId: id,
      dadosAnteriores: { versao: atual.versao }, dadosNovos: { versao: atual.versao + 1, motivo_informado: true },
    }, tx);
    return carregarDetalhe(tx, cli, empresaId, id);
  });
};

// ─── excluir (estorno integral pelo motor) ──────────────────────────────────

/**
 * Escolha do proprietário: a saída só se exclui se o produto NÃO teve outro movimento naquele depósito
 * depois dela (`movimentoPosteriorNoDeposito`). As outras linhas da mesma saída são de outro par produto ×
 * depósito (UNIQUE), nunca casam.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any[]} itens
 */
const exigirNadaDepois = async (tx, cli, empresaId, itens) => {
  for (const item of itens) {
    const numero = await movimentoPosteriorNoDeposito(tx, cli, empresaId, { movimentoId: item.movimentacao_estoque_id, produtoId: item.produto_id, localId: item.local_estoque_id });
    if (numero) throw movimentoPosterior({ item_ordem: item.ordem, produto_id: item.produto_id, local_estoque_id: item.local_estoque_id, movimento_numero: numero });
  }
};

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
          const [atual] = /** @type {any[]} */ (await tx.$queryRaw`SELECT * FROM "SaidaEstoque" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`);
          if (!atual) throw naoEncontrada();
          if (atual.status !== STATUS_CONFIRMADA) throw statusInvalido(atual.status);
          if (!Number.isInteger(e.versao) || e.versao !== atual.versao) throw versaoConflito();
          const itens = await tx.saidaEstoqueItem.findMany({ where: { cliente_id: cli, saida_id: id }, orderBy: [{ ordem: 'asc' }], include: { local: { select: { nome: true } } } });
          if (!itens.length) throw statusInvalido('sem_linhas');
          await exigirLocaisEstoque(tx, cli, itens.map((i) => ({ id: i.local_estoque_id, field: 'local_origem_id', exigirAtivo: false })));
          const produtoIds = await travarProdutosEstoque(tx, cli, empresaId, itens.map((i) => i.produto_id));
          await exigirNadaDepois(tx, cli, empresaId, itens);
          const produtos = new Map((await tx.produto.findMany({ where: { cliente_id: cli, empresa_id: empresaId, id: { in: produtoIds } } })).map((p) => [p.id, p]));
          const movimentos = new Map((await tx.movimentacaoEstoque.findMany({
            where: { cliente_id: cli, id: { in: itens.map((i) => i.movimentacao_estoque_id) } }, select: { id: true, lotes_consumidos: true },
          })).map((m) => [m.id, m]));
          const motivoEstorno = `Exclusão da saída ${atual.numero}: ${e.motivo}`.slice(0, 255);
          const estornos = [];
          for (const item of itens) {
            const fatias = /** @type {any} */ (movimentos.get(item.movimentacao_estoque_id))?.lotes_consumidos;
            if (!Array.isArray(fatias) || !fatias.length) throw movimentoPosterior({ item_ordem: item.ordem, reason: 'fatias_ausentes' });
            const r = await estornarSaidaDocumentada(tx, contexto, {
              empresaId,
              item: { ordem: item.ordem, quantidade_estoque: item.quantidade_estoque.toString(), movimentacao_estoque_id: item.movimentacao_estoque_id },
              consumos: fatias.map((f) => ({ estoque_lote_nota_id: f.lote_id, quantidade: f.quantidade })),
              produto: produtos.get(item.produto_id),
              local: { id: item.local_estoque_id, nome: item.local?.nome ?? null },
              dia: tempo.hoje,
              origem: { operacaoId: id, motivoEstorno },
              numeroMovimento: numeroMovimentoProvisorio(),
            });
            estornos.push(r.movimento.id);
            await tx.saidaEstoqueItem.update({ where: { cliente_id_id: { cliente_id: cli, id: item.id } }, data: { movimentacao_estorno_id: r.movimento.id } });
          }
          await numerarMovimentos(tx, cli, estornos);
          const depois = await tx.saidaEstoque.update({
            where: { cliente_id_id: { cliente_id: cli, id } },
            data: { status: STATUS_EXCLUIDA, versao: atual.versao + 1, excluida_em: new Date(), excluida_por_usuario_id: auth.usuarioId ?? null, motivo_exclusao: e.motivo },
          });
          await tx.saidaEstoqueEvento.create({
            data: {
              cliente_id: cli, empresa_id: empresaId, saida_id: id, tipo: 'EXCLUSAO', versao_anterior: atual.versao, versao_nova: atual.versao + 1,
              motivo: e.motivo, usuario_id: auth.usuarioId ?? null,
              snapshot_anterior: { status: atual.status, itens: itens.map((i) => ({ id: i.id, produto_id: i.produto_id, movimentacao_estoque_id: i.movimentacao_estoque_id, quantidade_estoque: d4(i.quantidade_estoque) })) },
              snapshot_novo: { status: depois.status, estornos },
            },
          });
          await registrarEvento(contexto, {
            acao: 'saida_estoque.excluir', entidade: ENTIDADE, entidadeId: id,
            dadosAnteriores: { status: atual.status, versao: atual.versao }, dadosNovos: { status: depois.status, versao: depois.versao, motivo_informado: true, estornos },
          }, tx);
          return { httpStatus: 200, body: await carregarDetalhe(tx, cli, empresaId, id) };
        },
      }),
  );
  return { status: 200, body: { ...r.body, replay: r.replay } };
};
