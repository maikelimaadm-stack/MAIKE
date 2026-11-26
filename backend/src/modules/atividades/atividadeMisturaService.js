/**
 * D-PROD-323 (MAIKE-DIARIO-MAQUINA) — a MISTURA no implemento e o que se faz com ela:
 *
 *  - Passo 1 "Implemento cheio" (`criarMistura`): o implemento é enchido com os produtos (quantidade POR IMPLEMENTO
 *    CHEIO). NÃO baixa estoque: a baixa é do Passo 2.
 *  - Passo 2 "Aplicar no pasto" (`aplicarMistura`): o volume aplicado (esvaziou, ou o saldo menos a sobra) sai do estoque
 *    pela linha de produto da atividade (`criarLinhasProduto`, que chama o estoqueFisicoMotor), proporcional a cada
 *    produto: quantidade = item × volume ÷ capacidade (4 casas, meio para cima).
 *  - Sobra (`registrarSobra`): TRANSFERENCIA (outro pasto da atividade, com horímetros, sem custo), DEVOLUCAO (a sobra
 *    não aplicada volta sem movimento de estoque: nunca saiu) ou PERDA (com motivo; baixa proporcional pelo motor, na
 *    linha da atividade com observação "Perda: <motivo>").
 *  - Resumo do dia (`resumoDoDia`): por área. `custo_total` só para o administrador da fazenda; para os outros os
 *    campos de custo não existem na resposta.
 *
 * Toda escrita roda sob a trava da atividade (Atividade FOR UPDATE) e sob a `operation_id` (reenvio igual → 200 com
 * `replay: true`; reenvio diferente → 409 IDEMPOTENCY_CONFLICT). Decimais entram e saem como TEXTO.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { acessoTotal, carregarAutorizacao } from '../../shared/auth/autorizacaoTela.js';
import { AppError, atividadeApontamentoNotFound, atividadeNotFound, atividadeStatusInvalido } from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { MENSAGEM_CONFLITO_IDEMPOTENTE, TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { getPrismaClient } from '../../database/prismaClient.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { CASAS_QUANTIDADE, LIMITE_ESTOQUE, ZERO, arredondar, dec } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { unidadeEfetivaDoEstoque } from '../patrimonio/patrimonioDominio.js';
import { PADRAO_DECIMAL, exigirLinhaGravavel, operationIdDoCorpo, travarAtividade } from './atividadeComum.js';
import { aceiteDeCombustivelQueVale, criarLinhasProduto, exigirPermiteProduto } from './atividadeApontamentoProdutoService.js';
import { exigirAreaDoApontamentoEmAndamento } from './atividadeAreaService.js';

export const ENTIDADE_MISTURA = 'AtividadeMistura';
export const TIPOS_SOBRA = Object.freeze(['TRANSFERENCIA', 'DEVOLUCAO', 'PERDA']);
const UNIDADES_MISTURA = Object.freeze(['L', 'KG']);
/** O número do jato (insumo por jato, D-PROD-283) vai até 999: a mistura acima disso fica sem o número (o resumo antigo não conta). */
const MAXIMO_JATO = 999;
const MOTIVO_MIN = 3;
const MOTIVO_MAX = 500;
const PADRAO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const CASAS = CASAS_QUANTIDADE;

/** Texto com as casas da coluna (4). @param {any} d */
const texto = (d) => dec(d).toFixed(CASAS);
/** @param {string} campo @param {string} motivo @param {Record<string, unknown>} [extra] */
const recusaMistura = (campo, motivo, extra = {}) =>
  new AppError('MISTURA_INVALIDA', 'mistura recusada; nada foi gravado', { details: { field: campo, reason: motivo, ...extra } });
/** @param {string} campo @param {string} motivo */
const recusaMovimento = (campo, motivo, extra = {}) =>
  new AppError('MISTURA_MOVIMENTO_INVALIDO', 'movimento da sobra recusado; nada foi gravado', { details: { field: campo, reason: motivo, ...extra } });

/** Decimal de texto, > 0 (ou 422). @param {unknown} v @param {string} campo */
const decimalPositivo = (v, campo) => {
  if (typeof v !== 'string' || !PADRAO_DECIMAL.test(v.trim())) throw recusaMistura(campo, 'formato');
  const d = dec(v.trim());
  if (!d.gt(0) || d.gt(LIMITE_ESTOQUE)) throw recusaMistura(campo, 'nao_positiva');
  return d;
};
/** Decimal de texto, >= 0 (ou 422). @param {unknown} v @param {string} campo */
const decimalNaoNegativo = (v, campo) => {
  if (typeof v !== 'string' || !PADRAO_DECIMAL.test(v.trim())) throw recusaMovimento(campo, 'formato');
  return dec(v.trim());
};

/**
 * Quantidade do produto para o volume dado: item × volume ÷ capacidade, 4 casas, meio para cima. Por construção o
 * volume é ≤ capacidade, então a quantidade nunca passa da quantidade do implemento cheio.
 * @param {any} quantidadeDoItem @param {any} volume @param {any} capacidade
 */
export const quantidadeProporcional = (quantidadeDoItem, volume, capacidade) =>
  arredondar(dec(quantidadeDoItem).times(volume).div(capacidade), CASAS);

/** Volume que sai neste Passo 2: `esvaziou` leva tudo; senão o saldo menos a sobra (0 ≤ sobra < saldo). */
export const volumeDaAplicacao = ({ esvaziou, sobra, saldo }) => {
  if (esvaziou === true) {
    if (sobra !== undefined && sobra !== null) throw new AppError('MISTURA_SOBRA_INVALIDA', 'com esvaziou a sobra não se informa; nada foi gravado', { details: { saldo: texto(saldo), sobra } });
    return dec(saldo);
  }
  if (sobra === undefined || sobra === null) throw new AppError('MISTURA_SOBRA_INVALIDA', 'sem esvaziou, informe a sobra; nada foi gravado', { details: { saldo: texto(saldo) } });
  if (typeof sobra !== 'string' || !PADRAO_DECIMAL.test(sobra.trim())) {
    throw new AppError('MISTURA_SOBRA_INVALIDA', 'a sobra é um número em texto, com até 4 casas; nada foi gravado', { details: { sobra, reason: 'formato' } });
  }
  const s = dec(sobra.trim());
  if (s.gte(saldo)) throw new AppError('MISTURA_SOBRA_INVALIDA', 'a sobra tem de ser menor que o saldo; nada foi gravado', { details: { saldo: texto(saldo), sobra: texto(s) } });
  return dec(saldo).minus(s);
};

/** A mistura como a tela a usa (decimais em texto; itens com produto e local). @param {any} m */
export const comoMisturaPublica = (m) => ({
  id: m.id,
  numero: m.numero,
  implemento_bem_id: m.implemento_bem_id,
  area_id: m.area_id,
  capacidade: texto(m.capacidade),
  unidade: m.unidade,
  saldo: texto(m.saldo),
  status: m.status,
  itens: (m.itens ?? []).map((i) => ({
    id: i.id,
    produto_id: i.produto_id,
    produto_nome: i.produto?.nome_produto ?? null,
    produto_unidade: i.produto?.unidade_principal_estoque ?? null,
    local_estoque_id: i.local_estoque_id,
    local_nome: i.localEstoque?.nome ?? null,
    quantidade: texto(i.quantidade),
  })),
});

const INCLUIR_MISTURA = Object.freeze({
  itens: {
    orderBy: { createdAt: /** @type {const} */ ('asc') },
    include: {
      produto: { select: { nome_produto: true, unidade_principal_estoque: true } },
      localEstoque: { select: { nome: true } },
    },
  },
});

/**
 * Atividade travada (FOR UPDATE) e lida. Outra empresa ou tenant → 404.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
const travarAtividadeDaMistura = async (tx, clienteId, empresaId, atividadeId) => {
  if (!(await travarAtividade(tx, clienteId, empresaId, atividadeId))) throw atividadeNotFound();
  const atividade = await tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    select: { id: true, numero: true, status: true, tipo_atividade_id: true },
  });
  if (!atividade) throw atividadeNotFound();
  return atividade;
};

/** @param {any} atividade @param {string} acao */
const exigirAtividadeAberta = (atividade, acao) => {
  if (atividade.status !== 'ABERTA') throw atividadeStatusInvalido({ status: atividade.status, acao, entidade: 'atividade' });
};

/**
 * Apontamento desta atividade (lido sob a trava). Sem ele → 404.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} apontamentoId
 */
const lerApontamentoDaMistura = async (tx, clienteId, empresaId, atividadeId, apontamentoId) => {
  const ap = await tx.atividadeApontamento.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id: apontamentoId },
    select: { id: true, empresa_id: true, status: true, data_operacional: true, area_executada_dia: true, atividade_area_id: true },
  });
  if (!ap) throw atividadeApontamentoNotFound();
  return ap;
};

/**
 * A área (AreaPastagem.id) do lançamento: a da área da atividade gravada no apontamento; nula sem área.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string|null} atividadeAreaId
 * @returns {Promise<string|null>}
 */
const areaDoLancamento = async (tx, clienteId, empresaId, atividadeId, atividadeAreaId) => {
  if (!atividadeAreaId) return null;
  const ligacao = await tx.atividadeArea.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id: atividadeAreaId },
    select: { area_id: true },
  });
  return ligacao?.area_id ?? null;
};

/** @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} id */
const lerMistura = async (tx, clienteId, empresaId, atividadeId, id) => {
  const m = await tx.atividadeMistura.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id } });
  if (!m) throw new AppError('MISTURA_NOT_FOUND', 'mistura não encontrada nesta atividade; nada foi gravado');
  return m;
};

/** @param {any} m @param {string} acao */
const exigirAberta = (m, acao) => {
  if (m.status !== 'ABERTA' || dec(m.saldo).lte(0)) {
    throw new AppError('MISTURA_STATUS_INVALIDO', 'a mistura não está aberta ou não tem saldo; nada foi gravado', { details: { status: m.status, acao } });
  }
};

/**
 * A mistura só sai (ou perde) no lançamento da área onde ela está agora.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {any} m @param {any} ap
 */
const exigirMesmaAreaDoLancamento = async (tx, clienteId, empresaId, atividadeId, m, ap) => {
  const area = await areaDoLancamento(tx, clienteId, empresaId, atividadeId, ap.atividade_area_id);
  if (area !== m.area_id) {
    throw new AppError('MISTURA_AREA_DIFERENTE', 'o lançamento não é da área onde a mistura está agora; nada foi gravado', {
      details: { area_mistura_id: m.area_id, area_lancamento_id: area },
    });
  }
};

/** Itens da mistura com o produto conferido de novo (ativo, da fazenda, unidade aceita, sem combustível). */
const itensDaMistura = (tx, m) =>
  tx.atividadeMisturaItem.findMany({ where: { cliente_id: m.cliente_id, mistura_id: m.id }, orderBy: { createdAt: /** @type {const} */ ('asc') } });

/**
 * Confere os itens do corpo da mistura (produto da fazenda, ativo, unidade aceita, sem combustível; local ativo).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {Array<{ produto_id: string, local_estoque_id: string, quantidade: string }>} itens
 */
const conferirItensDaMistura = async (tx, clienteId, empresaId, itens) => {
  if (!Array.isArray(itens) || itens.length === 0) throw recusaMistura('itens', 'obrigatorio');
  const vistos = new Set();
  const saida = [];
  for (const [i, it] of itens.entries()) {
    const campo = `itens[${i}]`;
    if (vistos.has(it.produto_id)) throw recusaMistura(`${campo}.produto_id`, 'repetido');
    vistos.add(it.produto_id);
    const produto = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: it.produto_id } } });
    if (!produto) throw recusaMistura(`${campo}.produto_id`, 'inexistente');
    if (produto.empresa_id !== empresaId) throw recusaMistura(`${campo}.produto_id`, 'outra_empresa');
    if (!produto.ativo) throw recusaMistura(`${campo}.produto_id`, 'inativo');
    if (!unidadeEfetivaDoEstoque(produto.unidade_principal_estoque)) throw recusaMistura(`${campo}.produto_id`, 'unidade_nao_aceita');
    // Combustível vai pelo abastecimento, não pela mistura.
    if ((await tx.tanqueBemProduto.count({ where: aceiteDeCombustivelQueVale(clienteId, produto.id) })) > 0) {
      throw recusaMistura(`${campo}.produto_id`, 'combustivel_no_abastecimento');
    }
    const local = await tx.localEstoque.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: it.local_estoque_id } } });
    if (!local) throw recusaMistura(`${campo}.local_estoque_id`, 'inexistente');
    if (!local.ativo) throw recusaMistura(`${campo}.local_estoque_id`, 'inativo');
    const quantidade = decimalPositivo(it.quantidade, `${campo}.quantidade`);
    saida.push({ produto_id: produto.id, local_estoque_id: local.id, quantidade: texto(quantidade) });
  }
  return saida;
};

/**
 * Corpo público da mistura (com os itens) lido depois da escrita.
 * @param {any} tx @param {string} clienteId @param {string} id
 */
const publicarMistura = async (tx, clienteId, id) => comoMisturaPublica(await tx.atividadeMistura.findFirst({ where: { cliente_id: clienteId, id }, include: INCLUIR_MISTURA }));

/**
 * Linhas de produto do Passo 2: uma por produto, com a mistura, o volume aplicado e o número do jato (até 999).
 * @param {Array<{ produto_id: string, local_estoque_id: string, quantidade: any }>} itens
 * @param {{ capacidade: any, volume: any, misturaId: string, numero: number }} a
 */
const linhasDoPasso2 = (itens, { capacidade, volume, misturaId, numero }) =>
  itens.map((i) => ({
    produto_id: i.produto_id,
    local_estoque_id: i.local_estoque_id,
    quantidade: texto(quantidadeProporcional(i.quantidade, volume, capacidade)),
    observacao: null,
    ...(numero <= MAXIMO_JATO ? { jato: numero } : {}),
    mistura_id: misturaId,
    volume_aplicado: texto(volume),
  }));

/**
 * Sob recibo de idempotência, na transação curta; reenvio igual → replay (200), reenvio diferente → 409.
 * @param {any} contexto
 * @param {{ operationId: string, tipoOperacao: string, fingerprint: string, executar: (tx: any) => Promise<{ httpStatus: number, body: Record<string, unknown> }> }} a
 */
const comRecibo = async (contexto, { operationId, tipoOperacao, fingerprint, executar }) => {
  const clienteId = exigirAuthContext(contexto?.auth).clienteId;
  const unicos = {
    operation_id: {
      erro: () => new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', { details: { operation_id: operationId } }),
      conferir: async (tx) =>
        (await tx.atividadeMistura.findFirst({ where: { cliente_id: clienteId, operation_id: operationId }, select: { id: true } })) ??
        (await tx.atividadeMisturaMovimento.findFirst({ where: { cliente_id: clienteId, operation_id: operationId }, select: { id: true } })),
    },
  };
  const r = await emTransacao(
    TRANSACAO_CURTA,
    (tx) => executarComIdempotencia(tx, { clienteId, operationKey: operationId, tipoOperacao, fingerprint, executar: () => executar(tx) }),
    unicos,
    MENSAGEM_CONFLITO_IDEMPOTENTE
  );
  return { status: r.replay ? 200 : r.httpStatus, body: { ...r.body, replay: r.replay } };
};

/** @param {any} tx @param {any} contexto @param {any} m @param {Record<string, unknown>} dados */
const gravarMovimento = (tx, contexto, m, dados) =>
  tx.atividadeMisturaMovimento.create({
    data: {
      cliente_id: m.cliente_id,
      mistura_id: m.id,
      operation_id: dados.operation_id,
      tipo: dados.tipo,
      apontamento_id: dados.apontamento_id ?? null,
      de_area_id: dados.de_area_id ?? null,
      para_area_id: dados.para_area_id ?? null,
      volume: dados.volume,
      motivo: dados.motivo ?? null,
      horimetro_saida: dados.horimetro_saida ?? null,
      horimetro_chegada: dados.horimetro_chegada ?? null,
      criado_por_usuario_id: exigirAuthContext(contexto?.auth).usuarioId ?? null,
    },
  });

/**
 * Passo 1 — `POST /atividades/:id/misturas`. Recusa mistura ABERTA com saldo do mesmo implemento na atividade (409).
 * Não baixa estoque. Capacidade e unidade vêm do bem quando não vêm no corpo.
 * @param {any} contexto @param {string} atividadeId @param {Record<string, any>} corpo
 */
export const criarMistura = async (contexto, atividadeId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const operationId = operationIdDoCorpo(corpo.operation_id);
  const fingerprint = fingerprintDePayload({ v: 1, op: 'mistura_criar', atividade_id: atividadeId, corpo: { ...corpo, operation_id: undefined } });
  return comRecibo(contexto, {
    operationId,
    tipoOperacao: 'MISTURA_CRIAR',
    fingerprint,
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const atividade = await travarAtividadeDaMistura(tx, cli, empresaId, atividadeId);
      exigirAtividadeAberta(atividade, 'criar_mistura');
      await exigirPermiteProduto(tx, cli, atividade);

      const implemento = await tx.bemPatrimonial.findFirst({
        where: { cliente_id: cli, empresa_id: empresaId, id: corpo.implemento_bem_id },
        select: { id: true, natureza: true, usa_produto: true, capacidade: true, capacidade_unidade: true },
      });
      if (!implemento) throw recusaMistura('implemento_bem_id', 'inexistente');
      if (implemento.natureza !== 'IMPLEMENTO' || implemento.usa_produto !== true) throw recusaMistura('implemento_bem_id', 'sem_produto');

      const capacidade = corpo.capacidade !== undefined && corpo.capacidade !== null
        ? decimalPositivo(corpo.capacidade, 'capacidade')
        : implemento.capacidade !== null && dec(implemento.capacidade).gt(0) ? dec(implemento.capacidade) : null;
      if (!capacidade) throw recusaMistura('capacidade', 'ausente');
      const unidade = corpo.unidade ?? implemento.capacidade_unidade;
      if (!UNIDADES_MISTURA.includes(unidade)) throw recusaMistura('unidade', unidade ? 'invalida' : 'ausente');

      const area = await tx.atividadeArea.findFirst({
        where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, area_id: corpo.area_id },
        select: { id: true },
      });
      if (!area) throw recusaMistura('area_id', 'fora_da_atividade');

      const itens = await conferirItensDaMistura(tx, cli, empresaId, corpo.itens);

      const aberta = await tx.atividadeMistura.findFirst({
        where: { cliente_id: cli, atividade_id: atividadeId, implemento_bem_id: implemento.id, status: 'ABERTA', saldo: { gt: '0' } },
        select: { id: true, numero: true },
      });
      if (aberta) {
        throw new AppError('MISTURA_ABERTA', 'este implemento já tem mistura aberta nesta atividade; aplique ou devolva o saldo antes', {
          details: { mistura_id: aberta.id, numero: aberta.numero },
        });
      }

      const ultimo = await tx.atividadeMistura.aggregate({ where: { cliente_id: cli, atividade_id: atividadeId }, _max: { numero: true } });
      const criada = await tx.atividadeMistura.create({
        data: {
          cliente_id: cli,
          empresa_id: empresaId,
          atividade_id: atividadeId,
          implemento_bem_id: implemento.id,
          area_id: corpo.area_id,
          numero: (ultimo._max.numero ?? 0) + 1,
          capacidade: texto(capacidade),
          unidade,
          saldo: texto(capacidade),
          status: 'ABERTA',
          operation_id: operationId,
          criado_por_usuario_id: exigirAuthContext(contexto?.auth).usuarioId ?? null,
        },
      });
      await tx.atividadeMisturaItem.createMany({
        data: itens.map((i) => ({ cliente_id: cli, mistura_id: criada.id, produto_id: i.produto_id, local_estoque_id: i.local_estoque_id, quantidade: i.quantidade })),
      });
      await registrarEvento(contexto, { acao: 'CRIAR_MISTURA', entidade: ENTIDADE_MISTURA, entidadeId: criada.id, dadosNovos: { atividade_id: atividadeId, numero: criada.numero } }, tx);
      return { httpStatus: 201, body: { mistura: await publicarMistura(tx, cli, criada.id) } };
    },
  });
};

/**
 * Passo 2 — `POST /atividades/:id/apontamentos/:apontamentoId/misturas/:misturaId/aplicar`. O volume (esvaziou, ou o saldo
 * menos a sobra) sai do estoque pela linha de produto da atividade, uma por produto, proporcional ao implemento cheio.
 * @param {any} contexto @param {string} atividadeId @param {string} apontamentoId @param {string} misturaId @param {Record<string, any>} corpo
 */
export const aplicarMistura = async (contexto, atividadeId, apontamentoId, misturaId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const operationId = operationIdDoCorpo(corpo.operation_id);
  const fingerprint = fingerprintDePayload({
    v: 1, op: 'mistura_aplicar', atividade_id: atividadeId, apontamento_id: apontamentoId, mistura_id: misturaId,
    empresa_id: corpo.empresa_id, esvaziou: corpo.esvaziou, sobra: corpo.sobra ?? null,
  });
  return comRecibo(contexto, {
    operationId,
    tipoOperacao: 'MISTURA_APLICAR',
    fingerprint,
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const atividade = await travarAtividadeDaMistura(tx, cli, empresaId, atividadeId);
      const ap = await lerApontamentoDaMistura(tx, cli, empresaId, atividadeId, apontamentoId);
      exigirLinhaGravavel(atividade, ap, 'lancar_linha');
      await exigirAreaDoApontamentoEmAndamento(tx, cli, empresaId, atividadeId, apontamentoId);
      const m = await lerMistura(tx, cli, empresaId, atividadeId, misturaId);
      exigirAberta(m, 'aplicar_mistura');
      await exigirMesmaAreaDoLancamento(tx, cli, empresaId, atividadeId, m, ap);

      const saldo = dec(m.saldo);
      const capacidade = dec(m.capacidade);
      const volume = volumeDaAplicacao({ esvaziou: corpo.esvaziou, sobra: corpo.sobra ?? null, saldo });
      const itens = await itensDaMistura(tx, m);
      const linhas = linhasDoPasso2(itens, { capacidade, volume, misturaId: m.id, numero: m.numero });
      for (const [i, l] of linhas.entries()) {
        if (!dec(l.quantidade).gt(0)) throw recusaMistura(`itens[${i}].quantidade`, 'quantidade_zero_no_volume', { volume: texto(volume) });
      }

      const ids = await criarLinhasProduto(tx, contexto, {
        apontamento: { id: ap.id, empresa_id: ap.empresa_id, data_operacional: ap.data_operacional, area_executada_dia: ap.area_executada_dia },
        atividade: { id: atividade.id, numero: atividade.numero, tipo_atividade_id: atividade.tipo_atividade_id },
        linhas,
        operationId,
      });
      const novoSaldo = saldo.minus(volume);
      await tx.atividadeMistura.update({
        where: { id: m.id },
        data: { saldo: texto(novoSaldo), status: novoSaldo.lte(0) ? 'ACABOU' : 'ABERTA' },
      });
      await gravarMovimento(tx, contexto, m, { operation_id: operationId, tipo: 'APLICACAO', apontamento_id: ap.id, volume: texto(volume) });
      await registrarEvento(contexto, {
        acao: 'APLICAR_MISTURA', entidade: ENTIDADE_MISTURA, entidadeId: m.id,
        dadosNovos: { apontamento_id: ap.id, volume: texto(volume), saldo: texto(novoSaldo), linhas: ids },
      }, tx);
      return { httpStatus: 201, body: { mistura: await publicarMistura(tx, cli, m.id), volume_aplicado: texto(volume), linhas_ids: ids } };
    },
  });
};

/**
 * Sobra — `POST /atividades/:id/misturas/:misturaId/sobra`: TRANSFERENCIA, DEVOLUCAO ou PERDA.
 * @param {any} contexto @param {string} atividadeId @param {string} misturaId @param {Record<string, any>} corpo
 */
export const registrarSobra = async (contexto, atividadeId, misturaId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const operationId = operationIdDoCorpo(corpo.operation_id);
  const tipo = corpo.tipo;
  if (!TIPOS_SOBRA.includes(tipo)) throw recusaMovimento('tipo', 'invalido');
  const fingerprint = fingerprintDePayload({ v: 1, op: 'mistura_sobra', atividade_id: atividadeId, mistura_id: misturaId, corpo: { ...corpo, operation_id: undefined } });
  return comRecibo(contexto, {
    operationId,
    tipoOperacao: 'MISTURA_SOBRA',
    fingerprint,
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const atividade = await travarAtividadeDaMistura(tx, cli, empresaId, atividadeId);
      exigirAtividadeAberta(atividade, 'registrar_sobra');
      const m = await lerMistura(tx, cli, empresaId, atividadeId, misturaId);
      exigirAberta(m, `sobra_${tipo.toLowerCase()}`);
      const saldo = dec(m.saldo);
      const base = { operation_id: operationId, tipo, volume: texto(saldo) };
      let ids = [];
      let apontamentoId = null;

      if (corpo.apontamento_id) {
        const ap = await lerApontamentoDaMistura(tx, cli, empresaId, atividadeId, corpo.apontamento_id);
        apontamentoId = ap.id;
      }

      if (tipo === 'TRANSFERENCIA') {
        const paraArea = corpo.para_area_id;
        if (!paraArea) throw recusaMovimento('para_area_id', 'obrigatorio');
        if (paraArea === m.area_id) throw recusaMovimento('para_area_id', 'mesma_area');
        const ligacao = await tx.atividadeArea.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, area_id: paraArea }, select: { id: true } });
        if (!ligacao) throw recusaMovimento('para_area_id', 'fora_da_atividade');
        const saida = corpo.horimetro_saida !== undefined && corpo.horimetro_saida !== null ? decimalNaoNegativo(corpo.horimetro_saida, 'horimetro_saida') : null;
        const chegada = corpo.horimetro_chegada !== undefined && corpo.horimetro_chegada !== null ? decimalNaoNegativo(corpo.horimetro_chegada, 'horimetro_chegada') : null;
        if (saida && chegada && chegada.lt(saida)) throw recusaMovimento('horimetro_chegada', 'menor_que_saida');
        await tx.atividadeMistura.update({ where: { id: m.id }, data: { area_id: paraArea } });
        await gravarMovimento(tx, contexto, m, {
          ...base, apontamento_id: apontamentoId, de_area_id: m.area_id, para_area_id: paraArea,
          horimetro_saida: saida ? texto(saida) : null, horimetro_chegada: chegada ? texto(chegada) : null,
        });
      } else if (tipo === 'DEVOLUCAO') {
        // O não aplicado nunca saiu do depósito: devolver não mexe no estoque.
        await tx.atividadeMistura.update({ where: { id: m.id }, data: { saldo: texto(ZERO), status: 'DEVOLVIDA' } });
        await gravarMovimento(tx, contexto, m, { ...base, apontamento_id: apontamentoId, motivo: textoOpcional(corpo.motivo) });
      } else {
        // PERDA: motivo e lançamento obrigatórios; baixa proporcional ao saldo pelo motor, na linha da atividade.
        const motivo = textoOpcional(corpo.motivo);
        if (!motivo || motivo.length < MOTIVO_MIN) throw recusaMovimento('motivo', 'obrigatorio');
        if (!corpo.apontamento_id) throw recusaMovimento('apontamento_id', 'obrigatorio');
        const ap = await lerApontamentoDaMistura(tx, cli, empresaId, atividadeId, corpo.apontamento_id);
        exigirLinhaGravavel(atividade, ap, 'lancar_linha');
        await exigirAreaDoApontamentoEmAndamento(tx, cli, empresaId, atividadeId, ap.id);
        await exigirMesmaAreaDoLancamento(tx, cli, empresaId, atividadeId, m, ap);
        const itens = await itensDaMistura(tx, m);
        const capacidade = dec(m.capacidade);
        const linhas = itens.map((i) => ({
          produto_id: i.produto_id,
          local_estoque_id: i.local_estoque_id,
          quantidade: texto(quantidadeProporcional(i.quantidade, saldo, capacidade)),
          observacao: `Perda: ${motivo}`.slice(0, MOTIVO_MAX),
        }));
        ids = await criarLinhasProduto(tx, contexto, {
          apontamento: { id: ap.id, empresa_id: ap.empresa_id, data_operacional: ap.data_operacional, area_executada_dia: ap.area_executada_dia },
          atividade: { id: atividade.id, numero: atividade.numero, tipo_atividade_id: atividade.tipo_atividade_id },
          linhas,
          operationId,
        });
        await tx.atividadeMistura.update({ where: { id: m.id }, data: { saldo: texto(ZERO), status: 'PERDA' } });
        await gravarMovimento(tx, contexto, m, { ...base, apontamento_id: ap.id, motivo });
      }

      await registrarEvento(contexto, { acao: 'SOBRA_MISTURA', entidade: ENTIDADE_MISTURA, entidadeId: m.id, dadosNovos: { tipo, volume: texto(saldo), linhas: ids } }, tx);
      return { httpStatus: 200, body: { mistura: await publicarMistura(tx, cli, m.id), linhas_ids: ids } };
    },
  });
};

/** @param {unknown} v @returns {string|null} */
const textoOpcional = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Lista da atividade: a ABERTA primeiro, depois as demais pelo número (mais recente antes).
 * @param {any} contexto @param {string} atividadeId @param {{ empresa_id: string }} consulta
 */
export const listarMisturas = async (contexto, atividadeId, consulta) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const db = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(db, cli, consulta.empresa_id);
  const atividade = await db.atividade.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: atividadeId }, select: { id: true } });
  if (!atividade) throw atividadeNotFound();
  const lista = await db.atividadeMistura.findMany({
    where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId },
    include: INCLUIR_MISTURA,
    orderBy: { numero: /** @type {const} */ ('desc') },
  });
  const ordenada = [...lista.filter((m) => m.status === 'ABERTA'), ...lista.filter((m) => m.status !== 'ABERTA')];
  return { misturas: ordenada.map(comoMisturaPublica) };
};

/**
 * Resumo do dia por área. Volume aplicado e implementos cheios vêm dos movimentos de APLICACAO do dia; produtos e horas
 * das linhas confirmadas do dia; sobra é o saldo atual das misturas abertas (onde está agora). `custo_total` só para o
 * administrador da fazenda (`acessoTotal`, relido do banco).
 * @param {any} contexto @param {string} atividadeId @param {{ empresa_id: string, dia: string }} consulta
 */
export const resumoDoDia = async (contexto, atividadeId, consulta) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const db = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(db, cli, consulta.empresa_id);
  const atividade = await db.atividade.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id: atividadeId }, select: { id: true } });
  if (!atividade) throw atividadeNotFound();
  const admin = acessoTotal(await carregarAutorizacao(contexto));
  const dia = consulta.dia;
  if (!PADRAO_DIA.test(dia)) throw recusaMistura('dia', 'formato');
  const dataDia = new Date(`${dia}T00:00:00.000Z`);

  const ligacoes = await db.atividadeArea.findMany({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId }, select: { id: true, area_id: true } });
  const areaDaLigacao = new Map(ligacoes.map((l) => [l.id, l.area_id]));
  const apontamentos = await db.atividadeApontamento.findMany({
    where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, data_operacional: dataDia, status: 'CONFIRMADO' },
    select: { id: true, atividade_area_id: true },
  });
  const areaDoApontamento = new Map(apontamentos.map((a) => [a.id, a.atividade_area_id ? areaDaLigacao.get(a.atividade_area_id) ?? null : null]));
  const idsAp = apontamentos.map((a) => a.id);
  const filtroAp = { cliente_id: cli, empresa_id: empresaId, apontamento_id: { in: idsAp }, status: 'CONFIRMADO' };

  // A sobra é o saldo de HOJE (onde está agora), não do dia: lê sempre.
  const abertas = await db.atividadeMistura.findMany({
    where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, status: 'ABERTA' },
    select: { id: true, numero: true, area_id: true, unidade: true, saldo: true },
  });
  const [linhasProduto, linhasMaquina, linhasMaoObra, linhasServico, aplicacoes] = idsAp.length
    ? await Promise.all([
        db.atividadeApontamentoProduto.findMany({ where: filtroAp, select: { apontamento_id: true, produto_id: true, quantidade: true, unidade: true, custo_total: true } }),
        db.atividadeApontamentoMaquina.findMany({ where: filtroAp, select: { apontamento_id: true, quantidade_uso: true, medidor_tipo: true, custo_total: true } }),
        db.atividadeApontamentoMaoObra.findMany({ where: filtroAp, select: { apontamento_id: true, custo_total: true } }),
        db.atividadeApontamentoServico.findMany({ where: filtroAp, select: { apontamento_id: true, valor_total: true } }),
        db.atividadeMisturaMovimento.findMany({
          where: { cliente_id: cli, tipo: 'APLICACAO', apontamento_id: { in: idsAp }, mistura: { atividade_id: atividadeId } },
          select: { mistura_id: true, apontamento_id: true, volume: true },
        }),
      ])
    : [[], [], [], [], []];

  const nomesProdutos = new Map((await db.produto.findMany({ where: { cliente_id: cli, id: { in: [...new Set(linhasProduto.map((l) => l.produto_id))] } }, select: { id: true, nome_produto: true } })).map((p) => [p.id, p.nome_produto]));
  const nomesAreas = new Map((await db.areaPastagem.findMany({ where: { cliente_id: cli, id: { in: ligacoes.map((l) => l.area_id) } }, select: { id: true, nome: true } })).map((a) => [a.id, a.nome]));

  /** @type {Map<string|null, any>} */
  const porArea = new Map();
  const bloco = (area) => {
    if (!porArea.has(area)) porArea.set(area, { area_id: area, area_nome: area ? nomesAreas.get(area) ?? null : null, volume: ZERO, implementos: new Set(), produtos: new Map(), horas: ZERO, custo: ZERO, sobra: new Map(), sobra_misturas: [] });
    return porArea.get(area);
  };
  for (const a of aplicacoes) {
    const b = bloco(areaDoApontamento.get(a.apontamento_id) ?? null);
    b.volume = b.volume.plus(dec(a.volume));
    b.implementos.add(a.mistura_id);
  }
  for (const l of linhasProduto) {
    const b = bloco(areaDoApontamento.get(l.apontamento_id) ?? null);
    const chave = `${l.produto_id}|${l.unidade}`;
    const atual = b.produtos.get(chave) ?? { produto_id: l.produto_id, produto_nome: nomesProdutos.get(l.produto_id) ?? null, unidade: l.unidade, quantidade: ZERO };
    atual.quantidade = atual.quantidade.plus(dec(l.quantidade));
    b.produtos.set(chave, atual);
    b.custo = b.custo.plus(dec(l.custo_total));
  }
  for (const l of linhasMaquina) {
    const b = bloco(areaDoApontamento.get(l.apontamento_id) ?? null);
    if (l.medidor_tipo === 'HORIMETRO') b.horas = b.horas.plus(dec(l.quantidade_uso));
    b.custo = b.custo.plus(dec(l.custo_total ?? 0));
  }
  for (const l of linhasMaoObra) {
    const b = bloco(areaDoApontamento.get(l.apontamento_id) ?? null);
    b.custo = b.custo.plus(dec(l.custo_total ?? 0));
  }
  for (const l of linhasServico) {
    const b = bloco(areaDoApontamento.get(l.apontamento_id) ?? null);
    b.custo = b.custo.plus(dec(l.valor_total));
  }
  for (const m of abertas) {
    const b = bloco(m.area_id);
    b.sobra.set(m.unidade, (b.sobra.get(m.unidade) ?? ZERO).plus(dec(m.saldo)));
    b.sobra_misturas.push({ mistura_id: m.id, numero: m.numero, saldo: texto(m.saldo), unidade: m.unidade });
  }

  const areas = [...porArea.values()].map((b) => {
    const base = {
      area_id: b.area_id,
      area_nome: b.area_nome,
      volume_aplicado: texto(b.volume),
      implementos_cheios: b.implementos.size,
      produtos: [...b.produtos.values()].map((p) => ({ produto_id: p.produto_id, produto_nome: p.produto_nome, unidade: p.unidade, quantidade: texto(p.quantidade) })),
      horas_maquina: texto(b.horas),
      sobra: [...b.sobra.entries()].map(([unidade, volume]) => ({ unidade, volume: texto(volume) })),
      sobra_misturas: b.sobra_misturas,
    };
    return admin ? { ...base, custo_total: texto(b.custo) } : base;
  });
  const soma = (f) => areas.reduce((t, a) => t.plus(dec(f(a))), ZERO);
  const total = {
    volume_aplicado: texto(soma((a) => a.volume_aplicado)),
    implementos_cheios: areas.reduce((t, a) => t + a.implementos_cheios, 0),
    horas_maquina: texto(soma((a) => a.horas_maquina)),
    ...(admin ? { custo_total: texto(soma((a) => a.custo_total)) } : {}),
  };
  return { dia, custo_visivel: admin, areas, total };
};
