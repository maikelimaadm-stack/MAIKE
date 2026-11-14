/**
 * Itens do Apontamento de Atividade (D-PROD-191, Fatia D) — A1 adicionar item
 * e A2 cancelar item, no apontamento CONFIRMADO.
 *
 *  - PRODUTO: baixa FÍSICA real pelo MOTOR ÚNICO de estoque (`aplicarSaidaFifo`,
 *    FIFO por lote), EXATAMENTE a quantidade digitada na unidade EFETIVA do
 *    estoque do Produto (L → L; KG e SACO → KG; sem nenhuma conversão). O custo
 *    do item é o custo FIFO do motor (nunca preço digitado nem custo médio); as
 *    fatias vão para `ApontamentoAtividadeItemConsumoLote` na ordem do motor.
 *    Movimento com a origem PRÓPRIA `apontamento_atividade` (documento = o
 *    apontamento: número e data operacional). Produto de COMBUSTÍVEL (com
 *    aceite que VALE: ativo, em tanque ativo de bem ativo, de qualquer fazenda
 *    do tenant) é recusado (D-8): combustível se lança no abastecimento;
 *  - SERVICO / OUTRO: descrição livre + quantidade + valor unitário; total =
 *    ROUND_HALF_UP(quantidade × valor unitário, 4) em Decimal no servidor; sem
 *    cadastro de serviço, sem fornecedor, sem efeito de estoque nem financeiro.
 *    Os dois só diferem no rótulo (D-6);
 *  - imutável: sem PATCH/DELETE; corrigir = cancelar (estorno exato) e lançar de
 *    novo. O item não tem centro próprio: vale o centro (snapshot) do cabeçalho;
 *  - limite de `LIMITE_ITENS` itens por apontamento, CONFIRMADO + CANCELADO (D-9);
 *  - idempotente por `operation_id` (recibo; sem ele, a chave já gravada num
 *    item, conferida antes de tudo; a unique da tabela é a última rede); CAS = a
 *    `versao` do APONTAMENTO (A1 e A2 a incrementam uma vez); toda escrita trava
 *    a linha do apontamento ANTES de ler itens, locais ou produtos (I-c), na
 *    ordem canônica do motor: recibo → empresa → Apontamento FOR UPDATE →
 *    LocalEstoque FOR KEY SHARE → produtos → lotes → movimento → sequência →
 *    AuditLog → recibo;
 *  - tenant SÓ do auth_context; a empresa vem do corpo e é conferida no tenant;
 *    item/apontamento de outra empresa ou tenant = inexistente (sem oráculo).
 *
 * O estorno (A2) usa o MESMO caminho do cancelamento do apontamento
 * (`estornarItensProduto`, em `apontamentoAtividadeService.js`).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  AppError,
  apontamentoAtividadeItemInvalido,
  apontamentoAtividadeItemNotFound,
  apontamentoAtividadeItemStatusInvalido,
  apontamentoAtividadeItensExcedidos,
  apontamentoAtividadeNotFound,
  apontamentoAtividadeStatusInvalido,
  apontamentoAtividadeVersaoConflito,
  concurrencyConflict,
} from '../../shared/errors/AppError.js';
import { executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { TRANSACAO_CURTA, emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  ORIGEM_APONTAMENTO, aplicarSaidaFifo, numerarMovimentos, numeroMovimentoProvisorio, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { CASAS_CUSTO, CASAS_PRECO, CASAS_QUANTIDADE, LIMITE_DINHEIRO, arredondar, dec, paraBanco, somar } from '../financeiro/decimalFinanceiro.js';
import { exigirEmpresaDoTenant, invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { diaDe } from '../patrimonio/patrimonioComum.js';
import { unidadeEfetivaDoEstoque } from '../patrimonio/patrimonioDominio.js';
import {
  ENTIDADE_ITEM,
  PADRAO_DECIMAL,
  STATUS_CONFIRMADO,
  TIPO_PRODUTO,
  auditarReenvioConflitante,
  cancelarItens,
  comoDetalhePublico,
  erroDoCasPerdido,
  estornarItensProduto,
  itemParaAuditoria,
  motivoDoCorpo,
  operationIdDoCorpo,
  tempoDaFazenda,
} from './apontamentoAtividadeService.js';
import {
  atualizarComVersao,
  buscarApontamentoComItens,
  buscarItemPorOperacao,
  inserirFatias,
  inserirItem,
  lerApontamentoBase,
  lerItensComFatias,
  resumoDosItens,
  travarApontamento,
} from './apontamentoAtividadeRepository.js';

/** I-a — tipos fechados (CHECK `_tipo_check`). */
export const TIPOS_ITEM = Object.freeze([TIPO_PRODUTO, 'SERVICO', 'OUTRO']);
/** D-9 — máximo de itens por apontamento (CONFIRMADO + CANCELADO; molde `MAX_ITENS` da Central). */
export const LIMITE_ITENS = 200;
/** Recibos de idempotência (≤ 64; o unique do recibo inclui o tipo). */
export const TIPO_ADICIONAR_ITEM = 'adicionar_item_apontamento_atividade_v1';
export const TIPO_CANCELAR_ITEM = 'cancelar_item_apontamento_atividade_v1';
/** Valor unitário de SERVICO/OUTRO: até 12 dígitos inteiros e 6 casas (`LIMITES.PRECO`), como TEXTO. */
export const PADRAO_VALOR_UNITARIO = /^\d{1,12}(\.\d{1,6})?$/;
/** Rótulos da SAÍDA do item PRODUTO no movimento (I-j). */
const TIPO_DETALHADO_SAIDA = 'apontamento_atividade';
const MOTIVO_SAIDA = 'Saída por item de apontamento de atividade';

const ROTULO_DO_TIPO = Object.freeze({ PRODUTO: 'de produto', SERVICO: 'de serviço', OUTRO: 'de outro custo' });
/** Campos de cada forma (I-l): os do produto e os de SERVICO/OUTRO são exclusivos entre si. */
const CAMPOS_DE_PRODUTO = Object.freeze(['produto_id', 'local_estoque_id']);
const CAMPOS_DE_SERVICO = Object.freeze(['descricao', 'valor_unitario']);

const tem = (obj, chave) => Object.prototype.hasOwnProperty.call(obj, chave) && obj[chave] !== undefined;

/**
 * D-8 — o aceite de tanque que faz do Produto COMBUSTÍVEL é o aceite que VALE:
 * ativo, num tanque ativo de um bem ativo. É o MESMO critério de `aceiteQueVale`
 * (`produtos/produtoService.js`, D-PROD-162 achado D1); manter os dois iguais.
 * Aceite desligado, ou em tanque/bem inativo, não conta: contá-lo deixaria o
 * Produto sem saída nenhuma (o item o recusaria como combustível e o
 * abastecimento também o recusa nesse tanque/bem). Sem filtro de empresa: o
 * aceite que vale em tanque de outro bem ou de outra fazenda do tenant
 * continua contando.
 * @param {string} clienteId @param {string} produtoId
 */
const aceiteDeCombustivelQueVale = (clienteId, produtoId) => ({
  cliente_id: clienteId,
  produto_id: produtoId,
  ativo: true,
  tanque: { ativo: true, bem: { ativo: true } },
});

// ─── recusas (422) ──────────────────────────────────────────────────────────

/** Frase de cada recusa do item, por coluna e `reason` (toda recusa diz que nada foi gravado). */
const MENSAGENS = Object.freeze({
  produto_id: {
    inexistente: 'o produto não foi encontrado nesta fazenda; nada foi gravado',
    outra_empresa: 'o produto é de outra fazenda: só produtos da fazenda do apontamento podem ser baixados; nada foi gravado',
    inativo: 'o produto está inativo; nada foi gravado',
    unidade_nao_aceita: 'o estoque do produto não está em L, KG nem SACO: o item não é possível; nada foi gravado',
    combustivel_no_abastecimento: 'o produto é combustível (aceito por um tanque): combustível se lança no abastecimento, não como item do apontamento; nada foi gravado',
  },
  local_estoque_id: {
    inexistente: 'o local de estoque não foi encontrado; nada foi gravado',
    inativo: 'o local de estoque está inativo; nada foi gravado',
  },
  quantidade: { quantidade_nao_positiva: 'a quantidade do item deve ser maior que zero; nada foi gravado' },
  valor_unitario: {
    total_zero: 'o total do item (quantidade × valor unitário, arredondado em 4 casas) é zero; nada foi gravado',
    valor_excede_limite: 'o total do item está acima do limite; nada foi gravado',
  },
});

/**
 * @param {keyof typeof MENSAGENS} field @param {string} reason @param {Record<string, unknown>} [extra]
 */
const itemInvalido = (field, reason, extra = {}) =>
  apontamentoAtividadeItemInvalido(field, reason, /** @type {any} */ (MENSAGENS[field])[reason], extra);

// ─── normalização do corpo (400 antes da transação) ─────────────────────────

/** @param {unknown} v @param {string} campo @param {RegExp} padrao @param {number} casas */
const decimalDoCorpo = (v, campo, padrao, casas) => {
  if (typeof v !== 'string' || !padrao.test(v)) throw invalido(`${campo} tem formato inválido`, { field: campo, reason: 'formato' });
  return dec(v).toFixed(casas);
};

/** @param {unknown} v @param {string} campo */
const idDoCorpo = (v, campo) => {
  if (typeof v !== 'string' || !v.trim()) throw invalido(`${campo} inválido`, { field: campo, reason: 'formato' });
  return v.trim();
};

/**
 * A1 — corpo → Entrada canônica (I-l): PRODUTO exige `produto_id` e
 * `local_estoque_id` e recusa `descricao`/`valor_unitario`; SERVICO/OUTRO
 * exigem `descricao` e `valor_unitario` e recusam produto e local (400
 * `campo_obrigatorio` / `campo_nao_permitido`). Decimais canônicos (quantidade
 * 4 casas, valor unitário 6), texto aparado; ausente → null.
 * @param {string} apontamentoId @param {Record<string, any>} corpo
 */
export const normalizarItem = (apontamentoId, corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  const tipo = c.tipo;
  if (!TIPOS_ITEM.includes(tipo)) throw invalido(`tipo deve ser ${TIPOS_ITEM.join(', ')}`, { field: 'tipo', reason: 'tipo_invalido' });
  const operationId = operationIdDoCorpo(c.operation_id);
  const rotulo = /** @type {any} */ (ROTULO_DO_TIPO)[tipo];
  const produto = tipo === TIPO_PRODUTO;
  for (const campo of produto ? CAMPOS_DE_PRODUTO : CAMPOS_DE_SERVICO) {
    if (!tem(c, campo)) throw invalido(`${campo} é obrigatório no item ${rotulo}`, { field: campo, reason: 'campo_obrigatorio' });
  }
  for (const campo of produto ? CAMPOS_DE_SERVICO : CAMPOS_DE_PRODUTO) {
    if (tem(c, campo)) throw invalido(`${campo} não é aceito no item ${rotulo}`, { field: campo, reason: 'campo_nao_permitido' });
  }
  if (!tem(c, 'quantidade')) throw invalido('quantidade é obrigatória', { field: 'quantidade', reason: 'campo_obrigatorio' });
  const quantidade = decimalDoCorpo(c.quantidade, 'quantidade', PADRAO_DECIMAL, CASAS_QUANTIDADE);
  /** @type {string|null} */
  let descricao = null;
  if (!produto) {
    descricao = textoDoCorpo(c.descricao, 'descricao') ?? null;
    if (!descricao) throw invalido(`descricao é obrigatória no item ${rotulo}`, { field: 'descricao', reason: 'campo_obrigatorio' });
  }
  return {
    apontamento_id: apontamentoId,
    empresa_id: c.empresa_id,
    versao: c.versao,
    operation_id: operationId,
    tipo,
    produto_id: produto ? idDoCorpo(c.produto_id, 'produto_id') : null,
    local_estoque_id: produto ? idDoCorpo(c.local_estoque_id, 'local_estoque_id') : null,
    quantidade,
    descricao,
    valor_unitario: produto ? null : decimalDoCorpo(c.valor_unitario, 'valor_unitario', PADRAO_VALOR_UNITARIO, CASAS_PRECO),
  };
};

/** A1 — fingerprint (ordem FIXA de chaves; valores normalizados; ausente → null). @param {ReturnType<typeof normalizarItem>} e */
export const fingerprintDoItem = (e) => ({
  v: 1,
  apontamento_id: e.apontamento_id,
  empresa_id: e.empresa_id,
  versao: e.versao,
  tipo: e.tipo,
  produto_id: e.produto_id,
  local_estoque_id: e.local_estoque_id,
  quantidade: e.quantidade,
  descricao: e.descricao,
  valor_unitario: e.valor_unitario,
});

/**
 * A2 — corpo do cancelamento do item: motivo 3..500 (aparado), `operation_id`.
 * @param {string} apontamentoId @param {string} itemId @param {Record<string, any>} corpo
 */
export const normalizarCancelamentoDoItem = (apontamentoId, itemId, corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  const motivo = motivoDoCorpo(c.motivo);
  return { apontamento_id: apontamentoId, item_id: itemId, empresa_id: c.empresa_id, versao: c.versao, operation_id: operationIdDoCorpo(c.operation_id), motivo };
};

/** A2 — fingerprint (ordem FIXA de chaves). @param {ReturnType<typeof normalizarCancelamentoDoItem>} e */
export const fingerprintDoCancelamentoDoItem = (e) => ({ v: 1, apontamento_id: e.apontamento_id, item_id: e.item_id, empresa_id: e.empresa_id, versao: e.versao, motivo: e.motivo });

/**
 * Regras PURAS do valor (422, antes da transação, como as regras puras do
 * apontamento): quantidade > 0; SERVICO/OUTRO com total =
 * ROUND_HALF_UP(quantidade × valor unitário, 4) > 0 e ≤ `LIMITE_DINHEIRO`.
 * @param {ReturnType<typeof normalizarItem>} e
 * @returns {string|null} total de SERVICO/OUTRO (4 casas); null no PRODUTO (o custo é do motor)
 */
const totalDoItem = (e) => {
  const quantidade = dec(e.quantidade);
  if (!quantidade.gt(0)) throw itemInvalido('quantidade', 'quantidade_nao_positiva');
  if (e.tipo === TIPO_PRODUTO) return null;
  const total = arredondar(quantidade.times(dec(/** @type {string} */ (e.valor_unitario))), CASAS_CUSTO);
  if (!total.gt(0)) throw itemInvalido('valor_unitario', 'total_zero');
  if (total.gt(LIMITE_DINHEIRO)) throw itemInvalido('valor_unitario', 'valor_excede_limite', { valor_total: total.toFixed(CASAS_CUSTO) });
  return total.toFixed(CASAS_CUSTO);
};

const conflitoDeChave = (operationId) => () =>
  new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', { details: { operation_id: operationId } });

/**
 * Apontamento travado (I-c) e conferido (I-b): existe → CONFIRMADO → `versao`.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string} id @param {number} versao
 */
const apontamentoTravado = async (tx, cli, empresaId, id, versao) => {
  if (!(await travarApontamento(tx, cli, empresaId, id))) throw apontamentoAtividadeNotFound();
  const ap = await lerApontamentoBase(tx, cli, empresaId, id);
  if (!ap) throw apontamentoAtividadeNotFound();
  if (ap.status !== STATUS_CONFIRMADO) throw apontamentoAtividadeStatusInvalido(ap.status);
  if (ap.versao !== versao) throw apontamentoAtividadeVersaoConflito(ap.versao, versao);
  return ap;
};

/**
 * A1 e A2 incrementam a `versao` do apontamento uma vez (o agregado tem um
 * token só: um PATCH ou cancelamento com a versão velha perde o CAS).
 */
const incrementarVersao = async (tx, cli, empresaId, id, versao) => {
  const alterados = await atualizarComVersao(tx, { clienteId: cli, empresaId, id, versao, statusEsperado: STATUS_CONFIRMADO, dados: {} });
  if (alterados !== 1) throw await erroDoCasPerdido(tx, cli, empresaId, id, versao);
};

// ─── A1: item PRODUTO (baixa pelo motor) ────────────────────────────────────

/**
 * Local (I-f) → trava dos produtos → Produto lido SOB a trava (I-e, D-8) →
 * `aplicarSaidaFifo` (I-h, I-i, I-j). Devolve as colunas do item e as fatias.
 * @param {any} tx @param {any} contexto @param {{ cli: string, empresaId: string, ap: any, entrada: ReturnType<typeof normalizarItem> }} a
 */
const baixarProduto = async (tx, contexto, { cli, empresaId, ap, entrada }) => {
  const [local] = /** @type {Array<{ id: string, nome: string, ativo: boolean }>} */ (
    await tx.$queryRaw`SELECT id, nome, ativo FROM "LocalEstoque" WHERE cliente_id = ${cli} AND id = ${entrada.local_estoque_id} FOR KEY SHARE`
  );
  if (!local) throw itemInvalido('local_estoque_id', 'inexistente');
  if (!local.ativo) throw itemInvalido('local_estoque_id', 'inativo');
  await travarProdutosEstoque(tx, cli, empresaId, [entrada.produto_id]);
  const produto = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: /** @type {string} */ (entrada.produto_id) } } });
  // I-e: outro tenant = inexistente (mesmo corpo). O motor só confere a empresa; ativo e unidade ficam aqui.
  if (!produto) throw itemInvalido('produto_id', 'inexistente');
  if (produto.empresa_id !== empresaId) throw itemInvalido('produto_id', 'outra_empresa');
  if (!produto.ativo) throw itemInvalido('produto_id', 'inativo');
  const unidade = unidadeEfetivaDoEstoque(produto.unidade_principal_estoque);
  if (!unidade) throw itemInvalido('produto_id', 'unidade_nao_aceita', { unidade: produto.unidade_principal_estoque });
  // D-8: combustível (aceite que VALE: ativo, em tanque ativo de bem ativo) se lança no abastecimento. Todo
  // escritor que faz um aceite passar a valer (aceite novo ou religado, tanque ou bem reativado: criação/PATCH do
  // bem, achado D1) segura o Produto FOR KEY SHARE, e aqui ele já está FOR UPDATE: a contagem é estável. Desligar
  // não trava o Produto; nessa corrida a recusa é a resposta segura (falha fechada).
  const aceitesQueValem = await tx.tanqueBemProduto.count({ where: aceiteDeCombustivelQueVale(cli, produto.id) });
  if (aceitesQueValem > 0) throw itemInvalido('produto_id', 'combustivel_no_abastecimento');
  const quantidade = dec(entrada.quantidade);
  const dia = /** @type {string} */ (diaDe(ap.data_operacional));
  const saida = await aplicarSaidaFifo(tx, contexto, {
    empresaId,
    produto,
    local: { id: local.id, nome: local.nome },
    quantidadeKg: quantidade, // na unidade EFETIVA do estoque do Produto, sem conversão
    dia, // a saída fica na data operacional do APONTAMENTO
    documento: { numero: ap.numero, data: dia },
    origem: { sistema: ORIGEM_APONTAMENTO, operacaoId: ap.id, tipoDetalhado: TIPO_DETALHADO_SAIDA, motivo: MOTIVO_SAIDA },
    numeroMovimento: numeroMovimentoProvisorio(),
    // `unidade` acompanha a recusa de saldo (a tela fala em L ou kg, a unidade do item).
    contextoErro: { field: 'quantidade', unidade },
  }); // lotes (CAS) + movimento + estoque_atual −
  if (!somar(saida.fatias.map((f) => f.quantidade)).eq(quantidade)) throw new Error('apontamento: fatias FIFO não somam a quantidade do item');
  return {
    colunas: {
      produto_id: produto.id,
      local_estoque_id: local.id,
      unidade,
      // custo FIFO do motor (nunca preço digitado nem custo médio)
      valor_unitario: paraBanco(saida.valor_unitario, CASAS_PRECO),
      valor_total: paraBanco(saida.valor_total, CASAS_CUSTO),
      movimentacao_estoque_id: saida.movimento.id,
    },
    fatias: saida.fatias,
    movimentoId: saida.movimento.id,
  };
};

// ─── A1: adicionar item ─────────────────────────────────────────────────────

/**
 * A1 — `POST /apontamentos-atividade/:id/itens`. 201 novo / 200 replay, com o
 * detalhe do apontamento + `item_id` + `replay`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} apontamentoId @param {Record<string, any>} corpo
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export const adicionarItem = async (contexto, apontamentoId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const entrada = normalizarItem(apontamentoId, corpo);
  const total = totalDoItem(entrada);
  const fingerprint = fingerprintDePayload(fingerprintDoItem(entrada));
  try {
    const r = await emTransacao(
      TRANSACAO_CURTA,
      (tx) =>
        executarComIdempotencia(tx, {
          clienteId: cli,
          operationKey: entrada.operation_id,
          tipoOperacao: TIPO_ADICIONAR_ITEM,
          fingerprint,
          executar: async () => {
            // §3.3 — a chave de um item JÁ gravado é conflito mesmo sem o recibo (apagado ou expurgado), conferida
            // ANTES de tudo, como o recibo: mesma resposta e mesma auditoria do reenvio conflitante. Em produção o
            // runtime não é dono das tabelas e elas têm RLS: o PostgreSQL omite o DETAIL da unique e o P2002 chega
            // com `meta.target` nulo, que o mapa `unicos` abaixo não reconhece (viraria CONCURRENCY_CONFLICT, e o
            // cliente repetiria a mesma chave para sempre). A unique (cliente_id, operation_id) fica como última rede.
            if (await buscarItemPorOperacao(tx, cli, entrada.operation_id)) throw conflitoDeChave(entrada.operation_id)();
            const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
            const ap = await apontamentoTravado(tx, cli, empresaId, apontamentoId, entrada.versao); // I-c, I-b
            const { total: existentes, maiorOrdem } = await resumoDosItens(tx, cli, empresaId, apontamentoId);
            if (existentes >= LIMITE_ITENS) throw apontamentoAtividadeItensExcedidos(LIMITE_ITENS); // I-m
            const produto = entrada.tipo === TIPO_PRODUTO ? await baixarProduto(tx, contexto, { cli, empresaId, ap, entrada }) : null;
            const { id: itemId } = await inserirItem(tx, {
              cliente_id: cli,
              empresa_id: empresaId,
              apontamento_id: apontamentoId,
              ordem: maiorOrdem + 1, // I-n: nunca reaproveitada
              tipo: entrada.tipo,
              status: STATUS_CONFIRMADO,
              descricao: entrada.descricao,
              produto_id: null,
              local_estoque_id: null,
              quantidade: entrada.quantidade,
              unidade: null,
              valor_unitario: entrada.valor_unitario,
              valor_total: total,
              movimentacao_estoque_id: null,
              ...(produto ? produto.colunas : {}),
              operation_id: entrada.operation_id,
              criado_por_usuario_id: auth.usuarioId ?? null,
            });
            if (produto) {
              await inserirFatias(
                tx,
                produto.fatias.map((f, i) => ({
                  cliente_id: cli,
                  empresa_id: empresaId,
                  item_id: itemId,
                  estoque_lote_nota_id: f.lote_id,
                  ordem: i + 1,
                  quantidade: paraBanco(f.quantidade, CASAS_QUANTIDADE),
                  custo_unitario: paraBanco(f.custo_unitario, CASAS_CUSTO),
                }))
              );
            }
            await incrementarVersao(tx, cli, empresaId, apontamentoId, entrada.versao);
            if (produto) await numerarMovimentos(tx, cli, [produto.movimentoId]);
            const depois = await buscarApontamentoComItens(tx, cli, empresaId, apontamentoId);
            if (!depois) throw apontamentoAtividadeNotFound();
            const item = depois.itens.find((/** @type {any} */ i) => i.id === itemId);
            await registrarEvento(
              contexto,
              { acao: 'apontamento_atividade.item_adicionar', entidade: ENTIDADE_ITEM, entidadeId: itemId, dadosNovos: itemParaAuditoria(item) },
              tx
            );
            return { httpStatus: 201, body: { ...comoDetalhePublico(depois), item_id: itemId } };
          },
        }),
      {
        // Última rede (o alvo do P2002 só existe quando o runtime é dono da tabela; ver a conferência acima).
        operation_id: conflitoDeChave(entrada.operation_id),
        // I-n: a unique (cliente_id, apontamento_id, ordem) é a rede da trava do apontamento.
        ordem: () => concurrencyConflict('outro item entrou neste apontamento ao mesmo tempo; nada foi gravado, tente de novo com a mesma operation_id'),
      }
    );
    return { status: r.replay ? 200 : 201, body: { ...r.body, replay: r.replay } };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'IDEMPOTENCY_CONFLICT') await auditarReenvioConflitante(contexto, ENTIDADE_ITEM, entrada.operation_id, TIPO_ADICIONAR_ITEM);
    throw e;
  }
};

// ─── A2: cancelar item ──────────────────────────────────────────────────────

/**
 * A2 — `POST /apontamentos-atividade/:id/itens/:itemId/cancelar`. PRODUTO:
 * estorno exato fatia a fatia pelo motor, no dia de HOJE da fazenda; SERVICO/
 * OUTRO: só a mudança de situação. O apontamento continua CONFIRMADO, com
 * `versao + 1`. 200 com o detalhe + `replay`.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} apontamentoId @param {string} itemId @param {Record<string, any>} corpo
 */
export const cancelarItem = async (contexto, apontamentoId, itemId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const entrada = normalizarCancelamentoDoItem(apontamentoId, itemId, corpo);
  const fingerprint = fingerprintDePayload(fingerprintDoCancelamentoDoItem(entrada));
  try {
    const r = await emTransacao(
      TRANSACAO_CURTA,
      (tx) =>
        executarComIdempotencia(tx, {
          clienteId: cli,
          operationKey: entrada.operation_id,
          tipoOperacao: TIPO_CANCELAR_ITEM,
          fingerprint,
          executar: async () => {
            const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
            const { hoje } = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE (dia do estorno; sem fuso, falha fechado)
            const ap = await apontamentoTravado(tx, cli, empresaId, apontamentoId, entrada.versao); // I-c, I-b
            const [antes] = await lerItensComFatias(tx, cli, empresaId, apontamentoId, { id: itemId });
            if (!antes) throw apontamentoAtividadeItemNotFound();
            if (antes.status !== STATUS_CONFIRMADO) throw apontamentoAtividadeItemStatusInvalido(antes.status);
            const estornos = await estornarItensProduto(tx, contexto, { empresaId, apontamento: ap, itens: [antes], hoje }); // I-p
            await cancelarItens(tx, {
              clienteId: cli,
              empresaId,
              apontamentoId,
              itens: [antes],
              estornos,
              motivo: entrada.motivo,
              origem: 'ITEM',
              usuarioId: auth.usuarioId ?? null,
              agora: new Date(),
            });
            await incrementarVersao(tx, cli, empresaId, apontamentoId, entrada.versao);
            await numerarMovimentos(tx, cli, [...estornos.values()]);
            const depois = await buscarApontamentoComItens(tx, cli, empresaId, apontamentoId);
            if (!depois) throw apontamentoAtividadeNotFound();
            const item = depois.itens.find((/** @type {any} */ i) => i.id === itemId);
            await registrarEvento(
              contexto,
              {
                acao: 'apontamento_atividade.item_cancelar',
                entidade: ENTIDADE_ITEM,
                entidadeId: itemId,
                dadosAnteriores: itemParaAuditoria(antes),
                dadosNovos: itemParaAuditoria(item),
              },
              tx
            );
            return { httpStatus: 200, body: comoDetalhePublico(depois) };
          },
        }),
      {}
    );
    return { ...r.body, replay: r.replay };
  } catch (e) {
    if (/** @type {any} */ (e)?.code === 'IDEMPOTENCY_CONFLICT') await auditarReenvioConflitante(contexto, ENTIDADE_ITEM, entrada.operation_id, TIPO_CANCELAR_ITEM);
    throw e;
  }
};
