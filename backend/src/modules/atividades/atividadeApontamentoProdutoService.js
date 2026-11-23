/**
 * D-PROD-202 (Fatia 3 do Lançamento de Atividades) — LINHA DE PRODUTO do
 * apontamento (`AtividadeApontamentoProduto`): a linha que gera custo pela
 * baixa de estoque. Contrato `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md` §2 e §4.
 *
 * Regras:
 *  - a linha só entra se o TIPO da atividade tem `permite_produto` (senão 422
 *    `ATIVIDADE_EXIGIDA_PELO_TIPO`, `field: produto_id`, `reason:
 *    permite_produto`), com o apontamento CONFIRMADO e a atividade ABERTA (409
 *    `ATIVIDADE_STATUS_INVALIDO`);
 *  - o produto é do tenant e da fazenda da atividade, ativo, com unidade de
 *    estoque aceita (L, KG ou SACO) e NÃO é combustível (aceite que vale:
 *    ativo, em tanque ativo de bem ativo — combustível vai pelo abastecimento);
 *    o local existe e está ativo (422 `ATIVIDADE_LINHA_INVALIDA`);
 *  - BAIXA pelo MESMO motor FIFO do abastecimento: `travarProdutosEstoque` →
 *    `aplicarSaida` (origem `apontamento_atividade`, `dia` = a
 *    `data_operacional` do apontamento, documento = o número da atividade);
 *    as fatias vão para `…ConsumoLote`; `numerarMovimentos` no fim da
 *    transação. Saldo insuficiente → 422 `ESTOQUE_SALDO_INSUFICIENTE` com a
 *    explicação do motor (disponível × solicitado, na unidade da linha);
 *  - `unidade` = unidade EFETIVA do estoque (L → L; KG e SACO → KG), nunca do
 *    usuário, sem conversão; `custo_unitario`/`custo_total` do custo FIFO;
 *    `dose_ha = quantidade / area_executada_dia` (4 casas), só leitura,
 *    recalculada quando a área do dia muda (`recalcularDosesDoApontamento`);
 *  - EDITAR = estorno EXATO da linha (CANCELADO, origem `EDICAO`) + nova saída
 *    numa linha NOVA, na mesma transação; CANCELAR = estorno exato (origem
 *    `LINHA`); cancelar o APONTAMENTO ou a ATIVIDADE estorna todas as linhas
 *    confirmadas num `estornarEmLote` só (`cancelarLinhasProdutoDosApontamentos`,
 *    origem `APONTAMENTO` | `ATIVIDADE`). Estorno recusado pelo motor → 409
 *    `ATIVIDADE_ESTORNO_BLOQUEADO` com a explicação dele (`details.motor`);
 *  - toda escrita de linha leva `operation_id` (recibo `executarComIdempotencia`:
 *    reenvio igual devolve a resposta gravada, `replay: true`; corpo diferente
 *    → 409 `IDEMPOTENCY_CONFLICT`), confere a `versao` do APONTAMENTO (CAS) e a
 *    incrementa uma vez;
 *  - a `ordem` da linha é máx + 1 sob a trava da atividade, nunca reaproveitada.
 *
 * Travas, na ordem canônica: recibo → Empresa FOR SHARE (`tempoDaFazenda`) →
 * Atividade FOR UPDATE (`travarAtividade`: serializa as linhas com o
 * apontamento e o cabeçalho) → LocalEstoque FOR KEY SHARE → produtos
 * (`travarProdutosEstoque`) → lotes → movimentos (motor) → sequência → auditoria → recibo.
 * Num lançamento com as duas linhas, as de MÁQUINA vêm antes (bem → produto,
 * a ordem do abastecimento).
 *
 * Tenant SÓ do auth_context (R11); a empresa vem do corpo e é conferida no
 * tenant. Linha de outro apontamento, atividade, fazenda ou tenant = 404.
 */

import { aplicarExclusaoComRecalculo, planejarExclusaoComRecalculo } from '../estoqueRecalculo/estoqueExclusaoRecalculo.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  AppError,
  atividadeApontamentoNotFound,
  atividadeEstornoBloqueado,
  atividadeExigidaPeloTipo,
  atividadeLinhaInvalida,
  atividadeLinhaNotFound,
  atividadeNotFound,
  concurrencyConflict,
} from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { MENSAGEM_CONFLITO_IDEMPOTENTE, TRANSACAO_CURTA, TRANSACAO_LONGA, emTransacao, soPeloAlvo } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  EFEITO_SAIDA,
  ORIGEM_APONTAMENTO,
  aplicarSaida,
  estornarEmLote,
  numerarMovimentos,
  numeroMovimentoProvisorio,
  travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, LIMITE_ESTOQUE, arredondar, dec, paraBanco, somar } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { unidadeEfetivaDoEstoque } from '../patrimonio/patrimonioDominio.js';
import { agoraDoServidor, diaNoFuso, fusoDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import {
  ORIGEM_CANCELAMENTO_LINHA,
  STATUS_APONTAMENTO,
  STATUS_LINHA,
  atualizarComVersao,
  auditarReenvioConflitante,
  decimalDoCorpo,
  diaDe,
  erroDoCasPerdido,
  exigirLinhaConfirmada,
  exigirLinhaGravavel,
  exigirVersao,
  idOuNulo,
  motivoDoCorpo,
  operationIdDaLinha,
  carregarAtividadeDetalhe,
  comoLinhaProdutoPublica,
  operationIdDoCorpo,
  t4,
  temCampo,
  tempoDaFazenda,
  travarAtividade,
} from './atividadeComum.js';
import {
  buscarLinhaPorOperacao,
  cancelarLinhasConfirmadas,
  inserirFatias,
  inserirLinha,
  lerLinhas,
  maiorOrdem,
  recalcularDoses,
} from './atividadeApontamentoProdutoRepository.js';
import { buscarApontamento } from './atividadeApontamentoRepository.js';
import { comoApontamentoPublico } from './atividadeApontamentoService.js';
import { exigirAreaDoApontamentoEmAndamento } from './atividadeAreaService.js';

/** Entidade da auditoria da linha. */
export const ENTIDADE_LINHA_PRODUTO = 'AtividadeApontamentoProduto';

/** Ações da auditoria da linha de produto. */
export const ACOES_AUDITORIA_LINHA_PRODUTO = Object.freeze({
  lancar: 'atividade_linha_produto.lancar',
  editar: 'atividade_linha_produto.editar',
  cancelar: 'atividade_linha_produto.cancelar',
});

/** Recibos de idempotência (≤ 64; o unique do recibo inclui o tipo). */
export const TIPOS_OPERACAO_LINHA_PRODUTO = Object.freeze({
  lancar: 'atividade_linha_produto_lancar_v1',
  editar: 'atividade_linha_produto_editar_v1',
  cancelar: 'atividade_linha_produto_cancelar_v1',
});

/** Rótulos da SAÍDA e do ESTORNO no movimento (os mesmos da D-PROD-193: a origem é a mesma). */
const TIPO_DETALHADO_SAIDA = 'apontamento_atividade';
const MOTIVO_SAIDA = 'Saída por linha de produto do lançamento de atividades';
const TIPO_DETALHADO_ESTORNO = 'estorno_apontamento_atividade';
const MOTIVO_ESTORNO = 'Estorno de linha de produto do lançamento de atividades';

/** Teto da `dose_ha` (Decimal(14, 4)): acima dele a dose fica nula (área do dia irrisória). */
const DOSE_MAXIMA = LIMITE_ESTOQUE;

/**
 * Aceite de tanque que faz do Produto COMBUSTÍVEL: o aceite que VALE (ativo,
 * num tanque ativo de um bem ativo), o MESMO critério de `aceiteQueVale`
 * (`produtos/produtoService.js`, D-PROD-162 achado D1) e da D-PROD-193 (D-8).
 * Sem filtro de empresa: o aceite em tanque de outra fazenda do tenant conta.
 * @param {string} clienteId @param {string} produtoId
 */
export const aceiteDeCombustivelQueVale = (clienteId, produtoId) => ({
  cliente_id: clienteId,
  produto_id: produtoId,
  ativo: true,
  tanque: { ativo: true, bem: { ativo: true } },
});

// ─── normalização do corpo (400 antes da transação) ─────────────────────────

/** @typedef {{ produto_id: string, local_estoque_id: string, quantidade: string, observacao: string|null, vc_percentual?: string }} DadosDaLinha */

/** MAIKE-ENTREGA2 (D-PROD-274) — o VC (%) da semente: texto decimal com até 2 casas, maior que 0 e até 100. */
const PADRAO_VC = /^\d{1,3}(\.\d{1,2})?$/;

/**
 * MAIKE-ENTREGA2 (D-PROD-274) — o VC (valor cultural, %) do rótulo do saco de semente, na linha do insumo: opcional;
 * texto ("50", "62.5"), maior que 0 e até 100, até 2 casas (400 `formato` / `fora_da_faixa`). A coluna não tem CHECK
 * (a allowlist EXPAND o recusa em tabela antiga): a API é a barreira, como na D-PROD-265.
 * @param {unknown} v @param {string} campo @returns {string}
 */
export const vcDoCorpo = (v, campo = 'vc_percentual') => {
  if (typeof v !== 'string' || !PADRAO_VC.test(v.trim())) {
    throw invalido(`${campo} deve ser o VC em %, em texto decimal com até 2 casas (ex.: "50" ou "62.5")`, { field: campo, reason: 'formato' });
  }
  const vc = dec(v.trim());
  if (!vc.gt(0) || vc.gt(100)) throw invalido(`${campo} deve ser maior que 0 e no máximo 100`, { field: campo, reason: 'fora_da_faixa' });
  return vc.toFixed(2);
};

/**
 * Id obrigatório de referência: texto não vazio; senão 400.
 * @param {unknown} v @param {string} campo @returns {string}
 */
const idObrigatorio = (v, campo) => {
  const id = idOuNulo(v, campo);
  if (!id) throw invalido(`${campo} é obrigatório`, { field: campo, reason: 'obrigatorio' });
  return id;
};

/**
 * Quantidade da linha: texto decimal (4 casas) e > 0 (422 `quantidade_nao_positiva`).
 * @param {unknown} v @param {string} [campo] @returns {string}
 */
const quantidadeDoCorpo = (v, campo = 'quantidade') => {
  const q = decimalDoCorpo(v, campo);
  if (q === null || q === undefined) throw invalido(`${campo} é obrigatória`, { field: campo, reason: 'obrigatorio' });
  if (!dec(q).gt(0)) throw atividadeLinhaInvalida('quantidade', 'quantidade_nao_positiva', { campo });
  return q;
};

/**
 * Dados de uma linha NOVA (corpo do `POST …/produtos` ou item de `produtos[]`).
 * @param {Record<string, any>} c @param {string} [prefixo]  ex.: `produtos[0].` (nas mensagens)
 * @returns {DadosDaLinha}
 */
export const normalizarDadosDaLinha = (c, prefixo = '') => ({
  produto_id: idObrigatorio(c.produto_id, `${prefixo}produto_id`),
  local_estoque_id: idObrigatorio(c.local_estoque_id, `${prefixo}local_estoque_id`),
  quantidade: quantidadeDoCorpo(c.quantidade, `${prefixo}quantidade`),
  observacao: textoDoCorpo(c.observacao, `${prefixo}observacao`) ?? null,
  // MAIKE-ENTREGA2 (D-PROD-274): o VC só existe na linha quando vem (sem ele — ou null —, a linha e o fingerprint de antes).
  ...(c.vc_percentual !== undefined && c.vc_percentual !== null ? { vc_percentual: vcDoCorpo(c.vc_percentual, `${prefixo}vc_percentual`) } : {}),
});

/** Linha gravada na forma dos dados do corpo (base da edição). @param {any} r @returns {DadosDaLinha} */
const dadosGravados = (r) => ({
  produto_id: r.produto_id,
  local_estoque_id: r.local_estoque_id,
  quantidade: /** @type {string} */ (t4(r.quantidade)),
  observacao: r.observacao ?? null,
});

// ─── regras dentro da transação ─────────────────────────────────────────────

/**
 * `permite_produto` do tipo ATUAL da atividade (as flags valem na hora da
 * escrita, como na Fatia 2); sem ela → 422 `ATIVIDADE_EXIGIDA_PELO_TIPO`.
 * @param {any} tx @param {string} clienteId @param {{ tipo_atividade_id: string }} atividade
 */
export const exigirPermiteProduto = async (tx, clienteId, atividade) => {
  const tipo = await tx.tipoAtividade.findFirst({ where: { cliente_id: clienteId, id: atividade.tipo_atividade_id }, select: { permite_produto: true } });
  if (!tipo?.permite_produto) throw atividadeExigidaPeloTipo('produto_id');
};

/**
 * Atividade travada (FOR UPDATE) e lida: o que as linhas precisam. Outra
 * empresa ou tenant → 404 `ATIVIDADE_NOT_FOUND`.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<{ id: string, empresa_id: string, numero: string, status: string, tipo_atividade_id: string, bem_id: string|null }>}
 */
const travarELerAtividade = async (tx, clienteId, empresaId, atividadeId) => {
  if (!(await travarAtividade(tx, clienteId, empresaId, atividadeId))) throw atividadeNotFound();
  const atividade = await tx.atividade.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId },
    select: { id: true, empresa_id: true, numero: true, status: true, tipo_atividade_id: true, bem_id: true },
  });
  if (!atividade) throw atividadeNotFound();
  return atividade;
};

/**
 * Apontamento desta atividade (lido SOB a trava da atividade): o essencial das linhas.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} id
 */
const lerApontamentoDaLinha = async (tx, clienteId, empresaId, atividadeId, id) => {
  const ap = await tx.atividadeApontamento.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id },
    select: { id: true, empresa_id: true, atividade_id: true, status: true, versao: true, data_operacional: true, area_executada_dia: true },
  });
  if (!ap) throw atividadeApontamentoNotFound();
  return ap;
};

/**
 * `dose_ha = quantidade / área do dia`, 4 casas (meio para cima); sem área
 * (nula ou zero), ou acima do teto da coluna, nula.
 * @param {string} quantidade @param {unknown} area
 * @returns {string|null}
 */
export const doseDe = (quantidade, area) => {
  if (area === null || area === undefined) return null;
  const a = dec(area);
  if (!a.gt(0)) return null;
  const dose = arredondar(dec(quantidade).dividedBy(a), CASAS_QUANTIDADE);
  return dose.gt(DOSE_MAXIMA) ? null : dose.toFixed(CASAS_QUANTIDADE);
};

/**
 * Saldo insuficiente do motor → o MESMO 422 `ESTOQUE_SALDO_INSUFICIENTE`, com a
 * explicação dele na frase (disponível × solicitado, na unidade da linha).
 * @param {unknown} erro @param {string} unidade
 */
const explicarSaldo = (erro, unidade) => {
  const e = /** @type {any} */ (erro);
  if (!(e instanceof AppError) || e.code !== 'ESTOQUE_SALDO_INSUFICIENTE') return erro;
  const d = e.details ?? {};
  const solicitado = d.solicitado ?? null;
  const disponivel = d.disponivel ?? d.estoque_atual ?? null;
  const onde = d.reason === 'estoque_atual_insuficiente' ? 'no estoque atual do produto' : 'nos lotes deste produto neste local';
  const frase = disponivel !== null && solicitado !== null
    ? `saldo insuficiente ${onde}: disponível ${disponivel} ${unidade}, solicitado ${solicitado} ${unidade}; nada foi gravado`
    : e.message;
  return new AppError('ESTOQUE_SALDO_INSUFICIENTE', frase, { cause: erro, details: { ...d, unidade } });
};

/**
 * Baixa de UMA linha pelo motor: local (FOR KEY SHARE) → trava dos produtos →
 * Produto lido SOB a trava (empresa, ativo, unidade, combustível) →
 * `aplicarSaida`. Devolve as colunas da linha e as fatias. O número do
 * movimento é PROVISÓRIO: quem chama numera no fim.
 * @param {any} tx @param {{auth: any}} contexto
 * @param {{ clienteId: string, empresaId: string, atividade: { id: string, numero: string },
 *   apontamento: { data_operacional: any, area_executada_dia: any }, dados: DadosDaLinha, contextoErro?: Record<string, unknown> }} a
 */
const baixarProduto = async (tx, contexto, { clienteId, empresaId, atividade, apontamento, dados, contextoErro = {} }) => {
  const [local] = /** @type {Array<{ id: string, nome: string, ativo: boolean }>} */ (
    await tx.$queryRaw`SELECT id, nome, ativo FROM "LocalEstoque" WHERE cliente_id = ${clienteId} AND id = ${dados.local_estoque_id} FOR KEY SHARE`
  );
  if (!local) throw atividadeLinhaInvalida('local_estoque_id', 'inexistente', contextoErro);
  if (!local.ativo) throw atividadeLinhaInvalida('local_estoque_id', 'inativo', contextoErro);
  await travarProdutosEstoque(tx, clienteId, empresaId, [dados.produto_id]);
  const produto = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: dados.produto_id } } });
  // Outro tenant = inexistente (o mesmo corpo). O motor só confere a empresa; ativo, unidade e combustível ficam aqui.
  if (!produto) throw atividadeLinhaInvalida('produto_id', 'inexistente', contextoErro);
  if (produto.empresa_id !== empresaId) throw atividadeLinhaInvalida('produto_id', 'outra_empresa', contextoErro);
  if (!produto.ativo) throw atividadeLinhaInvalida('produto_id', 'inativo', contextoErro);
  const unidade = unidadeEfetivaDoEstoque(produto.unidade_principal_estoque);
  if (!unidade) throw atividadeLinhaInvalida('produto_id', 'unidade_nao_aceita', { ...contextoErro, unidade: produto.unidade_principal_estoque });
  // Combustível vai pelo abastecimento. Todo escritor que faz um aceite passar a valer segura o Produto FOR KEY
  // SHARE, e aqui ele já está FOR UPDATE: a contagem é estável (desligar não trava; a recusa é a resposta segura).
  if ((await tx.tanqueBemProduto.count({ where: aceiteDeCombustivelQueVale(clienteId, produto.id) })) > 0) {
    throw atividadeLinhaInvalida('produto_id', 'combustivel_no_abastecimento', contextoErro);
  }
  const quantidade = dec(dados.quantidade);
  const dia = /** @type {string} */ (diaDe(apontamento.data_operacional));
  let saida;
  try {
    saida = await aplicarSaida(tx, contexto, {
      empresaId,
      produto,
      local: { id: local.id, nome: local.nome },
      quantidadeKg: quantidade, // na unidade EFETIVA do estoque do Produto, sem conversão
      dia, // a saída fica na data operacional do APONTAMENTO
      documento: { numero: atividade.numero, data: dia },
      origem: { sistema: ORIGEM_APONTAMENTO, operacaoId: atividade.id, tipoDetalhado: TIPO_DETALHADO_SAIDA, motivo: MOTIVO_SAIDA },
      numeroMovimento: numeroMovimentoProvisorio(),
      contextoErro: { field: 'quantidade', unidade, ...contextoErro },
    });
  } catch (erro) {
    throw explicarSaldo(erro, unidade);
  }
  if (!somar(saida.fatias.map((f) => f.quantidade)).eq(quantidade)) throw new Error('linha de produto: as fatias FIFO não somam a quantidade');
  return {
    colunas: {
      produto_id: produto.id,
      local_estoque_id: local.id,
      quantidade: dados.quantidade,
      unidade,
      dose_ha: doseDe(dados.quantidade, apontamento.area_executada_dia),
      // custo FIFO do motor (nunca preço digitado nem custo médio), nas casas do movimento
      custo_unitario: paraBanco(saida.valor_unitario, CASAS_CUSTO),
      custo_total: paraBanco(saida.valor_total, CASAS_CUSTO),
      movimentacao_estoque_id: saida.movimento.id,
    },
    fatias: saida.fatias,
    movimentoId: saida.movimento.id,
  };
};

/**
 * Grava UMA linha confirmada (baixa + linha + fatias), na transação de quem
 * chama, SOB a trava da atividade, com o tipo já conferido. Devolve o id da
 * linha e o do movimento (provisório: numerar no fim).
 * @param {any} tx @param {{auth: any}} contexto
 * @param {{ clienteId: string, empresaId: string, atividade: { id: string, numero: string },
 *   apontamento: { id: string, data_operacional: any, area_executada_dia: any }, dados: DadosDaLinha,
 *   operationId: string, contextoErro?: Record<string, unknown> }} a
 * @returns {Promise<{ id: string, movimentoId: string }>}
 */
const gravarLinha = async (tx, contexto, { clienteId, empresaId, atividade, apontamento, dados, operationId, contextoErro = {} }) => {
  const auth = exigirAuthContext(contexto?.auth);
  const baixa = await baixarProduto(tx, contexto, { clienteId, empresaId, atividade, apontamento, dados, contextoErro });
  const ordem = (await maiorOrdem(tx, clienteId, empresaId, apontamento.id)) + 1; // nunca reaproveitada
  const { id } = await inserirLinha(tx, {
    cliente_id: clienteId,
    empresa_id: empresaId,
    apontamento_id: apontamento.id,
    ordem,
    status: STATUS_LINHA.CONFIRMADO,
    ...baixa.colunas,
    operation_id: operationId,
    observacao: dados.observacao,
    // MAIKE-ENTREGA2 (D-PROD-274): o VC da semente (só na linha de lançamento que o trouxe).
    ...(dados.vc_percentual ? { vc_percentual: dados.vc_percentual } : {}),
    criado_por_usuario_id: auth.usuarioId ?? null,
  });
  await inserirFatias(
    tx,
    baixa.fatias.map((f, i) => ({
      cliente_id: clienteId,
      empresa_id: empresaId,
      linha_id: id,
      estoque_lote_nota_id: f.lote_id,
      ordem: i + 1,
      quantidade: paraBanco(f.quantidade, CASAS_QUANTIDADE),
      custo_unitario: paraBanco(f.custo_unitario, CASAS_CUSTO),
    }))
  );
  return { id, movimentoId: baixa.movimentoId };
};

// ─── estorno exato: um caminho só (editar, cancelar a linha, o apontamento, a atividade) ──

/** Recusas do motor que a tela conhece (as demais de `ESTOQUE_JA_CONSUMIDO` viram `fatias_inconsistentes`). */
const RECUSAS_DO_MOTOR = Object.freeze(['lote_indisponivel_para_devolucao', 'devolucao_excede_entrada', 'fatias_inconsistentes', 'vinculo_divergente', 'camada_divergente']);

/**
 * Erro do motor no estorno → 409 `ATIVIDADE_ESTORNO_BLOQUEADO` com a linha e a
 * explicação do motor (`details.motor`), fail-closed (molde do cancelamento do
 * abastecimento). `CONCURRENCY_CONFLICT` e o resto passam.
 * @param {unknown} erro @param {any[]} linhas  as enviadas ao motor (o `ordem` do motor é a posição 1-based)
 */
const traduzirErroDoEstorno = (erro, linhas) => {
  if (!(erro instanceof AppError)) return erro;
  const e = /** @type {any} */ (erro);
  /** A linha da recusa: pela posição do motor; sem ela, a única enviada (se só há uma). */
  const daLinha = (posicao) => {
    const l = Number.isInteger(posicao) ? linhas[posicao - 1] : linhas.length === 1 ? linhas[0] : undefined;
    return l ? { linha_id: l.id, linha_ordem: l.ordem } : {};
  };
  const motor = { code: e.code, message: e.message };
  const opcoes = { cause: erro };
  if (e.code === 'ESTOQUE_JA_CONSUMIDO') {
    const base = { ...daLinha(e.details?.item_ordem), ...(e.details?.lote_id ? { lote_id: e.details.lote_id } : {}), motor };
    if (e.details?.reason === 'original_ja_estornado' || e.details?.reason === 'original_nao_ativo') return atividadeEstornoBloqueado('movimento_estornado', base, opcoes);
    const reason = RECUSAS_DO_MOTOR.find((r) => r === e.details?.reason) ?? 'fatias_inconsistentes';
    return atividadeEstornoBloqueado(/** @type {any} */ (reason), base, opcoes);
  }
  if (e.code === 'MOVIMENTACAO_ESTOQUE_NOT_FOUND') return atividadeEstornoBloqueado('movimento_inexistente', { ...daLinha(undefined), motor }, opcoes);
  if (e.code === 'OPERACAO_VALORES_INVALIDOS') return atividadeEstornoBloqueado('estoque_excede_limite', { ...daLinha(e.details?.item_ordem), motor }, opcoes);
  if (e.code === 'PRODUTO_NOT_FOUND') return atividadeEstornoBloqueado('produto_mudou_de_fazenda', { ...daLinha(e.details?.item_ordem), motor }, opcoes);
  return erro;
};

/**
 * Estorno EXATO das linhas CONFIRMADO (lidas com as fatias), num
 * `estornarEmLote` só (efeito SAÍDA): cada fatia volta ao SEU lote, Entrada
 * `estorno_apontamento_atividade` com o MESMO valor do original e
 * `movimento_pai_id`, original 'Estornada' (CAS), `estoque_atual +`, no dia
 * `hoje` da fazenda. Antes do motor, linha a linha: Produto ainda da empresa,
 * mesma unidade efetiva, movimento original 'Ativa' e sem filho, fatias que
 * somam a quantidade. Os produtos têm de estar travados por quem chama (ou
 * são travados aqui, todos de uma vez). Números PROVISÓRIOS: quem chama numera.
 * D-PROD-273 (fatia 4): com `recalcular` (o CANCELAMENTO da linha, do apontamento ou da atividade; nunca a edição),
 * se o produto teve outro movimento no depósito depois da linha, a exclusão recalcula o custo médio de tudo que veio
 * depois (`estoqueExclusaoRecalculo`: prova antes do estorno, recálculo e dependentes depois dele, mesma transação).
 * @param {any} tx @param {{auth: any}} contexto
 * @param {{ empresaId: string, atividade: { id: string, numero: string }, linhas: any[], hoje: string, recalcular?: boolean, motivo?: string }} a
 * @returns {Promise<Map<string, string>>} id da linha → id do movimento de estorno
 */
export const estornarLinhasProduto = async (tx, contexto, { empresaId, atividade, linhas: linhasLidas, hoje, recalcular = false, motivo = MOTIVO_ESTORNO }) => {
  if (!linhasLidas.length) return new Map();
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const produtoIds = await travarProdutosEstoque(tx, cli, empresaId, linhasLidas.map((l) => l.produto_id));
  // D-PROD-273 (fatia 5, revisão): as fatias (`consumos`) relidas SOB a trava do produto — uma exclusão com recálculo do
  // mesmo produto pode tê-las reescrito depois da leitura de quem chama; estornar com as velhas devolveria às camadas erradas.
  const relidas = await tx.atividadeApontamentoProdutoConsumoLote.findMany({
    where: { cliente_id: cli, linha_id: { in: linhasLidas.map((l) => l.id) } }, orderBy: [{ linha_id: 'asc' }, { ordem: 'asc' }],
  });
  const linhas = linhasLidas.map((l) => ({ ...l, consumos: relidas.filter((c) => c.linha_id === l.id) }));
  const produtos = new Map(
    (await tx.produto.findMany({ where: { cliente_id: cli, id: { in: produtoIds } }, select: { id: true, empresa_id: true, unidade_principal_estoque: true } })).map((p) => [p.id, p])
  );
  const movimentoIds = [...new Set(linhas.map((l) => l.movimentacao_estoque_id).filter((v) => typeof v === 'string' && v))];
  // Pré-leitura SEM trava, só para responder os motivos que a tela conhece; o motor trava lotes e originais
  // (FOR UPDATE) e revalida tudo sob a trava.
  const movimentos = new Map(
    (movimentoIds.length
      ? await tx.movimentacaoEstoque.findMany({ where: { cliente_id: cli, id: { in: movimentoIds } }, select: { id: true, status: true, movimento_filho_id: true } })
      : []
    ).map((/** @type {any} */ m) => [m.id, m])
  );
  for (const linha of linhas) {
    const base = { linha_id: linha.id, linha_ordem: linha.ordem };
    const produto = produtos.get(linha.produto_id);
    if (!produto || produto.empresa_id !== empresaId) throw atividadeEstornoBloqueado('produto_mudou_de_fazenda', base);
    // Unidade EFETIVA (L → L; KG/SACO → KG): KG ↔ SACO guardam kg e não bloqueiam; a troca que envolve L, sim.
    if (unidadeEfetivaDoEstoque(produto.unidade_principal_estoque) !== linha.unidade) {
      throw atividadeEstornoBloqueado('unidade_mudou', { ...base, unidade_linha: linha.unidade, unidade_produto: produto.unidade_principal_estoque });
    }
    const original = movimentos.get(linha.movimentacao_estoque_id);
    if (!original) throw atividadeEstornoBloqueado('movimento_inexistente', base);
    if (original.status !== 'Ativa' || original.movimento_filho_id) throw atividadeEstornoBloqueado('movimento_estornado', base);
    const fatias = linha.consumos ?? [];
    if (!fatias.length || !somar(fatias.map((/** @type {any} */ f) => f.quantidade)).eq(dec(linha.quantidade))) throw atividadeEstornoBloqueado('fatias_inconsistentes', base);
  }
  const planos = recalcular
    ? await planejarExclusaoComRecalculo(tx, cli, { empresaId, movimentos: linhas.map((l) => ({ id: l.movimentacao_estoque_id, produtoId: l.produto_id, localId: l.local_estoque_id })), estornoExatoSeInviavel: true })
    : [];
  let estornos;
  try {
    estornos = await estornarEmLote(tx, contexto, {
      empresaId,
      efeito: EFEITO_SAIDA,
      dia: hoje, // dia do estorno = hoje da fazenda (nunca a data operacional)
      documento: { numero: atividade.numero, data: hoje },
      origem: { sistema: ORIGEM_APONTAMENTO, operacaoId: atividade.id, tipoDetalhadoEstorno: TIPO_DETALHADO_ESTORNO, motivoEstorno: MOTIVO_ESTORNO },
      itens: linhas.map((l, k) => ({
        produto_id: l.produto_id,
        local_estoque_id: l.local_estoque_id,
        movimentacao_estoque_id: l.movimentacao_estoque_id,
        quantidade_estoque: l.quantidade,
        ordem: k + 1,
        consumos: l.consumos.map((/** @type {any} */ f) => ({ estoque_lote_nota_id: f.estoque_lote_nota_id, quantidade: f.quantidade })),
      })),
      numeroMovimento: numeroMovimentoProvisorio,
    });
  } catch (erro) {
    throw traduzirErroDoEstorno(erro, linhas);
  }
  if (planos.length) {
    await aplicarExclusaoComRecalculo(tx, contexto, planos, {
      empresaId, origem: ORIGEM_APONTAMENTO, motivo: [...`Atividade ${atividade.numero}: ${motivo}`].slice(0, 255).join(''),
      estornos: new Map(linhas.map((l, k) => [l.movimentacao_estoque_id, estornos[k]])),
    });
  }
  return new Map(linhas.map((l, k) => [l.id, estornos[k]]));
};

/**
 * Marca as linhas estornadas como CANCELADO (CAS pelo status, uma por uma, cada
 * uma com o SEU estorno). Contagem ≠ linhas = um escritor fora do protocolo
 * (a trava da atividade serializa todos): 409, tudo desfeito.
 * @param {any} tx
 * @param {{ clienteId: string, empresaId: string, linhas: any[], estornos: Map<string, string>, motivo: string,
 *   origem: string, usuarioId: string|null, agora: Date }} a
 */
const marcarCanceladas = async (tx, { clienteId, empresaId, linhas, estornos, motivo, origem, usuarioId, agora }) => {
  const n = await cancelarLinhasConfirmadas(tx, {
    clienteId,
    empresaId,
    linhas: linhas.map((l) => ({ id: l.id, estorno: /** @type {string} */ (estornos.get(l.id)) })),
    motivo,
    origem,
    usuarioId,
    agora,
  });
  if (n !== linhas.length) {
    throw concurrencyConflict('uma linha de produto mudou durante o estorno; nada foi alterado, tente de novo com a mesma operation_id', { details: { linhas: linhas.length, canceladas: n } });
  }
};

/** Auditoria da linha: as colunas, sem texto livre. @param {any} l  forma pública */
const paraAuditoria = (l) => ({
  id: l.id,
  apontamento_id: l.apontamento_id,
  ordem: l.ordem,
  status: l.status,
  produto_id: l.produto_id,
  local_estoque_id: l.local_estoque_id,
  quantidade: l.quantidade,
  unidade: l.unidade,
  dose_ha: l.dose_ha,
  custo_unitario: l.custo_unitario,
  custo_total: l.custo_total,
  movimentacao_estoque_id: l.movimentacao_estoque_id,
  movimentacao_estorno_id: l.movimentacao_estorno_id,
  fatias: l.fatias,
  cancelamento_origem: l.cancelamento_origem,
  tem_observacao: Boolean(l.observacao),
  tem_motivo_cancelamento: Boolean(l.motivo_cancelamento),
});

// ─── para o serviço do apontamento (lançar com linhas e os cancelamentos em cascata) ──

/**
 * Cria as linhas de PRODUTO de um lançamento (`POST …/apontamentos` e
 * `…/duplicar` com `produtos[]`), na transação dele e SOB a trava da
 * atividade, com o apontamento recém-gravado: confere `permite_produto` (só
 * quando há linha), baixa cada uma pelo motor (na ordem do corpo; a chave de
 * cada linha é `<operation_id>:p<n>`), numera os movimentos no fim e devolve
 * os ids das linhas. Recusa de uma linha leva `details.colecao = 'produtos'` e
 * `details.indice` (0-based): nada é gravado.
 * @param {any} tx @param {{auth: any}} contexto
 * @param {{ apontamento: { id: string, empresa_id: string, data_operacional: any, area_executada_dia: any },
 *   atividade: { id: string, numero: string, tipo_atividade_id: string }, linhas: DadosDaLinha[], operationId: string }} a
 * @returns {Promise<string[]>}
 */
export const criarLinhasProduto = async (tx, contexto, { apontamento, atividade, linhas, operationId }) => {
  if (!linhas.length) return [];
  const clienteId = exigirAuthContext(contexto?.auth).clienteId;
  const empresaId = apontamento.empresa_id;
  await exigirPermiteProduto(tx, clienteId, atividade);
  // Todos os produtos travados de uma vez, em ordem (a mesma de qualquer outro escritor de estoque).
  await travarProdutosEstoque(tx, clienteId, empresaId, linhas.map((l) => l.produto_id));
  const ids = [];
  const movimentos = [];
  for (const [indice, dados] of linhas.entries()) {
    const r = await gravarLinha(tx, contexto, {
      clienteId,
      empresaId,
      atividade,
      apontamento,
      dados,
      operationId: operationIdDaLinha(operationId, 'produto', indice),
      contextoErro: { colecao: 'produtos', indice },
    });
    ids.push(r.id);
    movimentos.push(r.movimentoId);
  }
  await numerarMovimentos(tx, clienteId, movimentos);
  return ids;
};

/**
 * Hoje na fazenda (o dia do estorno) quando quem chama só tem o "agora".
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {Date} [agora]
 */
const hojeDaFazenda = async (tx, clienteId, empresaId, agora) => diaNoFuso(agora ?? agoraDoServidor(), await fusoDaEmpresa(tx, clienteId, empresaId));

/**
 * Cancelamento em CASCATA (cancelar o apontamento ou a atividade): estorna
 * TODAS as linhas de produto CONFIRMADO dos apontamentos num `estornarEmLote`
 * só, marca-as CANCELADO com o motivo, o instante, o usuário e a origem
 * (`APONTAMENTO` | `ATIVIDADE`) e numera os estornos. Na transação de quem
 * chama, que já travou a atividade e conferiu os status. Devolve quantas
 * linhas foram canceladas.
 * @param {any} tx @param {{auth: any}} contexto
 * @param {{ clienteId: string, empresaId: string, atividadeId: string, apontamentoIds: string[], usuarioId: string|null,
 *   motivo: string, agora: Date, hoje?: string, origem: 'APONTAMENTO'|'ATIVIDADE' }} pedido
 * @returns {Promise<number>}
 */
export const cancelarLinhasProdutoDosApontamentos = async (tx, contexto, { clienteId, empresaId, atividadeId, apontamentoIds, usuarioId, motivo, agora, hoje, origem }) => {
  if (!apontamentoIds.length) return 0;
  const linhas = await lerLinhas(tx, clienteId, empresaId, { apontamentoIds, status: STATUS_LINHA.CONFIRMADO });
  if (!linhas.length) return 0;
  const atividade = await tx.atividade.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id: atividadeId }, select: { id: true, numero: true } });
  if (!atividade) throw atividadeNotFound();
  const dia = hoje ?? (await hojeDaFazenda(tx, clienteId, empresaId, agora));
  const estornos = await estornarLinhasProduto(tx, contexto, { empresaId, atividade, linhas, hoje: dia, recalcular: true, motivo });
  await marcarCanceladas(tx, { clienteId, empresaId, linhas, estornos, motivo, origem, usuarioId, agora });
  await numerarMovimentos(tx, clienteId, [...estornos.values()]);
  return linhas.length;
};

/**
 * Linhas de produto CONFIRMADO do apontamento (a data dele não muda com elas).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} apontamentoId
 */
export { contarConfirmadas as contarLinhasProdutoConfirmadas } from './atividadeApontamentoProdutoRepository.js';

/**
 * A área do dia mudou: refaz a `dose_ha` das linhas CONFIRMADO do apontamento.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, apontamentoId: string, area: string|null }} a
 */
export const recalcularDosesDoApontamento = (tx, { clienteId, empresaId, apontamentoId, area }) => recalcularDoses(tx, clienteId, empresaId, apontamentoId, area);

// ─── escritas da linha (rotas) ──────────────────────────────────────────────

/**
 * Corpo das escritas de linha: `{ linha, apontamento, atividade }` — a linha
 * na forma pública, o apontamento relido com `produtos[]` e `maquinas[]` e a
 * atividade no formato do DETALHE —, tudo na transação da escrita. Quem chama
 * acrescenta `replay` (e, na edição, `linha_anterior_id`).
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} apontamentoId
 * @param {string} linhaId
 */
const respostaDaEscrita = async (tx, clienteId, empresaId, atividadeId, apontamentoId, linhaId) => {
  const registro = await buscarApontamento(tx, clienteId, empresaId, atividadeId, apontamentoId);
  if (!registro) throw atividadeApontamentoNotFound();
  const apontamento = comoApontamentoPublico(registro);
  const linha = apontamento.produtos.find((l) => l.id === linhaId) ?? null;
  return { linha, apontamento, atividade: await carregarAtividadeDetalhe(tx, clienteId, empresaId, atividadeId) };
};

const conflitoDeChave = (/** @type {string} */ operationId) => () =>
  new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', { details: { operation_id: operationId } });

/**
 * A unique (cliente_id, apontamento_id, ordem) é a rede da trava da atividade (a ordem nasce sob o FOR UPDATE
 * dela). Só pelo alvo: sem ele, o caminho genérico responde o mesmo 409 transitório (D-PROD-253).
 */
const ORDEM_DA_LINHA = soPeloAlvo(
  () => concurrencyConflict('outra linha entrou neste apontamento ao mesmo tempo; nada foi gravado, tente de novo com a mesma operation_id'),
  'a ordem da linha de produto nasce sob a trava da atividade (FOR UPDATE) e o erro é o mesmo 409 transitório do caminho genérico'
);

/**
 * Redes de unique das escritas de linha. A `operation_id` é conferida no início de cada escrita (a linha JÁ
 * gravada é conflito mesmo sem o recibo) e, sem o alvo do P2002 (produção: papel não dono + RLS), de novo depois do
 * rollback (D-PROD-253).
 * @param {string} clienteId @param {string} operationId
 * @returns {Record<string, import('../../shared/prisma/transacaoConcorrente.js').UniqueDeNegocio>}
 */
const unicosDaLinha = (clienteId, operationId) => ({
  operation_id: { erro: conflitoDeChave(operationId), conferir: (tx) => buscarLinhaPorOperacao(tx, clienteId, operationId) },
  ordem: ORDEM_DA_LINHA,
});

/**
 * Abertura comum das escritas de linha (sob o recibo): empresa no tenant →
 * Empresa FOR SHARE (fuso: "hoje" do estorno) → Atividade FOR UPDATE →
 * apontamento → status (atividade ABERTA, apontamento CONFIRMADO) → `versao`.
 * @param {any} tx @param {string} clienteId
 * @param {{ empresaDoCorpo: unknown, atividadeId: string, apontamentoId: string, versao: unknown, acao: 'lancar_linha'|'editar_linha'|'cancelar_linha' }} a
 */
const abrirEscritaDeLinha = async (tx, clienteId, { empresaDoCorpo, atividadeId, apontamentoId, versao, acao }) => {
  const empresaId = await exigirEmpresaDoTenant(tx, clienteId, empresaDoCorpo);
  const tempo = await tempoDaFazenda(tx, clienteId, empresaId); // Empresa FOR SHARE
  const atividade = await travarELerAtividade(tx, clienteId, empresaId, atividadeId); // Atividade FOR UPDATE
  const apontamento = await lerApontamentoDaLinha(tx, clienteId, empresaId, atividadeId, apontamentoId);
  exigirLinhaGravavel(atividade, apontamento, acao);
  // D-PROD-249: a linha NOVA só entra em lançamento de área EM_ANDAMENTO.
  if (acao === 'lancar_linha') await exigirAreaDoApontamentoEmAndamento(tx, clienteId, empresaId, atividadeId, apontamentoId);
  exigirVersao(apontamento, versao, 'apontamento');
  return { empresaId, tempo, atividade, apontamento };
};

/**
 * Toda escrita de linha incrementa a `versao` do apontamento UMA vez (o
 * agregado tem um token só: um PATCH ou cancelamento com a versão velha perde o CAS).
 * @param {any} tx @param {{ clienteId: string, empresaId: string, atividadeId: string, apontamentoId: string, versao: number, acao: string }} a
 */
const incrementarVersaoDoApontamento = async (tx, { clienteId, empresaId, atividadeId, apontamentoId, versao, acao }) => {
  const alvo = { clienteId, empresaId, id: apontamentoId, versao, statusEsperado: STATUS_APONTAMENTO.CONFIRMADO, onde: { atividade_id: atividadeId } };
  const alterados = await atualizarComVersao(tx.atividadeApontamento, { ...alvo, dados: {} });
  if (alterados !== 1) throw await erroDoCasPerdido(tx.atividadeApontamento, { ...alvo, acao, entidade: 'apontamento' });
};

/**
 * Linha CONFIRMADA deste apontamento (com as fatias); senão 404
 * `ATIVIDADE_LINHA_NOT_FOUND` ou 409 `ATIVIDADE_STATUS_INVALIDO`.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} apontamentoId @param {string} linhaId
 * @param {'editar_linha'|'cancelar_linha'} acao
 */
const lerLinhaConfirmada = async (tx, clienteId, empresaId, apontamentoId, linhaId, acao) => {
  const [linha] = await lerLinhas(tx, clienteId, empresaId, { apontamentoIds: [apontamentoId], id: linhaId });
  if (!linha) throw atividadeLinhaNotFound('produto');
  exigirLinhaConfirmada(linha, acao, 'linha_produto');
  return linha;
};

/**
 * Roda a escrita sob o recibo de idempotência; reenvio conflitante auditado à parte.
 * @param {any} contexto @param {{ operationId: string, tipoOperacao: string, fingerprint: string,
 *   executar: (tx: any) => Promise<{ httpStatus: number, body: Record<string, unknown> }>, transacao?: any }} a
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
const comRecibo = async (contexto, { operationId, tipoOperacao, fingerprint, executar, transacao = TRANSACAO_CURTA }) => {
  const clienteId = exigirAuthContext(contexto?.auth).clienteId;
  try {
    const r = await emTransacao(
      transacao,
      (tx) => executarComIdempotencia(tx, { clienteId, operationKey: operationId, tipoOperacao, fingerprint, executar: () => executar(tx) }),
      unicosDaLinha(clienteId, operationId),
      MENSAGEM_CONFLITO_IDEMPOTENTE
    );
    return { status: r.replay ? 200 : r.httpStatus, body: { ...r.body, replay: r.replay } };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'IDEMPOTENCY_CONFLICT') await auditarReenvioConflitante(contexto, ENTIDADE_LINHA_PRODUTO, operationId, tipoOperacao);
    throw e;
  }
};

/**
 * `POST /atividades/:id/apontamentos/:apontamentoId/produtos` — lança a linha
 * (201; reenvio igual → 200 com `replay: true`). Corpo `{ empresa_id, versao,
 * operation_id, produto_id, local_estoque_id, quantidade, observacao? }`.
 * Resposta `{ linha, apontamento, atividade, replay }`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, any>} corpo
 */
export const lancarLinhaProduto = async (contexto, atividadeId, apontamentoId, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const operationId = operationIdDoCorpo(corpo.operation_id);
  const dados = normalizarDadosDaLinha(corpo);
  const fingerprint = fingerprintDePayload({ v: 1, atividade_id: atividadeId, apontamento_id: apontamentoId, empresa_id: corpo.empresa_id, versao: corpo.versao, ...dados });
  return comRecibo(contexto, {
    operationId,
    tipoOperacao: TIPOS_OPERACAO_LINHA_PRODUTO.lancar,
    fingerprint,
    executar: async (tx) => {
      // A chave de uma linha JÁ gravada é conflito mesmo sem o recibo (apagado ou expurgado), conferida ANTES de
      // tudo: em produção o P2002 chega sem o alvo (RLS), e a unique fica como última rede (D-PROD-253).
      if (await buscarLinhaPorOperacao(tx, cli, operationId)) throw conflitoDeChave(operationId)();
      const { empresaId, atividade, apontamento } = await abrirEscritaDeLinha(tx, cli, {
        empresaDoCorpo: corpo.empresa_id, atividadeId, apontamentoId, versao: corpo.versao, acao: 'lancar_linha',
      });
      await exigirPermiteProduto(tx, cli, atividade);
      const { id, movimentoId } = await gravarLinha(tx, contexto, { clienteId: cli, empresaId, atividade, apontamento, dados, operationId });
      await incrementarVersaoDoApontamento(tx, { clienteId: cli, empresaId, atividadeId, apontamentoId, versao: apontamento.versao, acao: 'lancar_linha' });
      await numerarMovimentos(tx, cli, [movimentoId]);
      const resposta = await respostaDaEscrita(tx, cli, empresaId, atividadeId, apontamentoId, id);
      await registrarEvento(contexto, { acao: ACOES_AUDITORIA_LINHA_PRODUTO.lancar, entidade: ENTIDADE_LINHA_PRODUTO, entidadeId: id, dadosNovos: paraAuditoria(resposta.linha) }, tx);
      return { httpStatus: 201, body: resposta };
    },
  });
};

/** Campos que a edição troca (o resto vem da linha gravada). */
const CAMPOS_EDITAVEIS = Object.freeze(['produto_id', 'local_estoque_id', 'quantidade', 'observacao']);

/**
 * `PATCH …/produtos/:linhaId` — EDITAR = estorno EXATO da linha (CANCELADO,
 * origem `EDICAO`) + nova saída numa linha NOVA (os campos enviados sobre os
 * gravados), na mesma transação. 200 com `{ linha (a nova), linha_anterior_id,
 * apontamento, atividade, replay }`. Corpo `{ empresa_id, versao, operation_id,
 * produto_id?, local_estoque_id?, quantidade?, observacao? }` (ao menos um campo).
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId @param {Record<string, any>} corpo
 */
export const editarLinhaProduto = async (contexto, atividadeId, apontamentoId, linhaId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const operationId = operationIdDoCorpo(corpo.operation_id);
  /** @type {Partial<DadosDaLinha>} */
  const campos = {};
  if (temCampo(corpo, 'produto_id')) campos.produto_id = idObrigatorio(corpo.produto_id, 'produto_id');
  if (temCampo(corpo, 'local_estoque_id')) campos.local_estoque_id = idObrigatorio(corpo.local_estoque_id, 'local_estoque_id');
  if (temCampo(corpo, 'quantidade')) campos.quantidade = quantidadeDoCorpo(corpo.quantidade);
  if (temCampo(corpo, 'observacao')) campos.observacao = textoDoCorpo(corpo.observacao, 'observacao') ?? null;
  if (!CAMPOS_EDITAVEIS.some((c) => temCampo(campos, c))) throw invalido('informe ao menos um campo da linha para alterar', { field: 'corpo', reason: 'sem_alteracao' });
  const fingerprint = fingerprintDePayload({ v: 1, atividade_id: atividadeId, apontamento_id: apontamentoId, linha_id: linhaId, empresa_id: corpo.empresa_id, versao: corpo.versao, ...campos });
  return comRecibo(contexto, {
    operationId,
    tipoOperacao: TIPOS_OPERACAO_LINHA_PRODUTO.editar,
    fingerprint,
    executar: async (tx) => {
      if (await buscarLinhaPorOperacao(tx, cli, operationId)) throw conflitoDeChave(operationId)();
      const { empresaId, tempo, atividade, apontamento } = await abrirEscritaDeLinha(tx, cli, {
        empresaDoCorpo: corpo.empresa_id, atividadeId, apontamentoId, versao: corpo.versao, acao: 'editar_linha',
      });
      const anterior = await lerLinhaConfirmada(tx, cli, empresaId, apontamentoId, linhaId, 'editar_linha');
      /** @type {DadosDaLinha} */
      const dados = { ...dadosGravados(anterior), ...campos };
      await exigirPermiteProduto(tx, cli, atividade);
      // Travas da troca: o local novo (KEY SHARE) e os produtos antigo e novo de UMA vez, em ordem.
      await tx.$queryRaw`SELECT id FROM "LocalEstoque" WHERE cliente_id = ${cli} AND id = ${dados.local_estoque_id} FOR KEY SHARE`;
      await travarProdutosEstoque(tx, cli, empresaId, [anterior.produto_id, dados.produto_id]);
      const antes = comoLinhaProdutoPublica(anterior);
      const estornos = await estornarLinhasProduto(tx, contexto, { empresaId, atividade, linhas: [anterior], hoje: tempo.hoje });
      await marcarCanceladas(tx, {
        clienteId: cli, empresaId, linhas: [anterior], estornos, motivo: 'Linha editada: estorno exato e nova saída',
        origem: ORIGEM_CANCELAMENTO_LINHA.EDICAO, usuarioId: auth.usuarioId ?? null, agora: tempo.agora,
      });
      const { id, movimentoId } = await gravarLinha(tx, contexto, { clienteId: cli, empresaId, atividade, apontamento, dados, operationId });
      await incrementarVersaoDoApontamento(tx, { clienteId: cli, empresaId, atividadeId, apontamentoId, versao: apontamento.versao, acao: 'editar_linha' });
      await numerarMovimentos(tx, cli, [...estornos.values(), movimentoId]);
      const resposta = await respostaDaEscrita(tx, cli, empresaId, atividadeId, apontamentoId, id);
      const cancelada = resposta.apontamento.produtos.find((l) => l.id === linhaId);
      await registrarEvento(
        contexto,
        {
          acao: ACOES_AUDITORIA_LINHA_PRODUTO.editar,
          entidade: ENTIDADE_LINHA_PRODUTO,
          entidadeId: id,
          dadosAnteriores: paraAuditoria(antes),
          dadosNovos: { ...paraAuditoria(resposta.linha), linha_anterior: cancelada ? paraAuditoria(cancelada) : null, campos_alterados: Object.keys(campos).sort() },
        },
        tx
      );
      return { httpStatus: 200, body: { linha: resposta.linha, linha_anterior_id: linhaId, apontamento: resposta.apontamento, atividade: resposta.atividade } };
    },
  });
};

/**
 * `POST …/produtos/:linhaId/cancelar` — estorno exato (origem `LINHA`), com
 * motivo (3..500). 200 com `{ linha, apontamento, atividade, replay }`. Corpo
 * `{ empresa_id, versao, operation_id, motivo }`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId @param {Record<string, any>} corpo
 */
export const cancelarLinhaProduto = async (contexto, atividadeId, apontamentoId, linhaId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const operationId = operationIdDoCorpo(corpo.operation_id);
  const motivo = motivoDoCorpo(corpo.motivo);
  const fingerprint = fingerprintDePayload({ v: 1, atividade_id: atividadeId, apontamento_id: apontamentoId, linha_id: linhaId, empresa_id: corpo.empresa_id, versao: corpo.versao, motivo });
  return comRecibo(contexto, {
    operationId,
    // D-PROD-273 (fatia 4): o cancelamento pode recalcular o que veio depois: a transação longa (30 s), não a curta.
    transacao: TRANSACAO_LONGA,
    tipoOperacao: TIPOS_OPERACAO_LINHA_PRODUTO.cancelar,
    fingerprint,
    executar: async (tx) => {
      const { empresaId, tempo, atividade, apontamento } = await abrirEscritaDeLinha(tx, cli, {
        empresaDoCorpo: corpo.empresa_id, atividadeId, apontamentoId, versao: corpo.versao, acao: 'cancelar_linha',
      });
      const anterior = await lerLinhaConfirmada(tx, cli, empresaId, apontamentoId, linhaId, 'cancelar_linha');
      const antes = comoLinhaProdutoPublica(anterior);
      const estornos = await estornarLinhasProduto(tx, contexto, { empresaId, atividade, linhas: [anterior], hoje: tempo.hoje, recalcular: true, motivo });
      await marcarCanceladas(tx, {
        clienteId: cli, empresaId, linhas: [anterior], estornos, motivo, origem: ORIGEM_CANCELAMENTO_LINHA.LINHA, usuarioId: auth.usuarioId ?? null, agora: tempo.agora,
      });
      await incrementarVersaoDoApontamento(tx, { clienteId: cli, empresaId, atividadeId, apontamentoId, versao: apontamento.versao, acao: 'cancelar_linha' });
      await numerarMovimentos(tx, cli, [...estornos.values()]);
      const resposta = await respostaDaEscrita(tx, cli, empresaId, atividadeId, apontamentoId, linhaId);
      await registrarEvento(
        contexto,
        { acao: ACOES_AUDITORIA_LINHA_PRODUTO.cancelar, entidade: ENTIDADE_LINHA_PRODUTO, entidadeId: linhaId, dadosAnteriores: paraAuditoria(antes), dadosNovos: paraAuditoria(resposta.linha) },
        tx
      );
      return { httpStatus: 200, body: resposta };
    },
  });
};
