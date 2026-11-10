/**
 * D-PROD-155 (Gestão P3-01) — motor de estoque FÍSICO composto (KG).
 *
 * Funções que RECEBEM `tx` (nunca abrem transação) e trabalham em Decimal ponta
 * a ponta. São a única porta de efeito físico do lançamento financeiro
 * confirmado/cancelado: entrada (compra), saída FIFO (venda) e os estornos.
 *
 * Regras (§3, §8.2, §8.4 do contrato):
 *  - estoque interno SEMPRE em KG; o planejador já entrega `kg` com 4 casas
 *    (ROUND_HALF_UP UMA vez) e o mesmo `kg` vale para item, lote, movimento,
 *    `estoque_atual`, consumo e estorno;
 *  - `travarProdutosEstoque` antes de QUALQUER leitura de produto/lote e antes
 *    de qualquer UPDATE em movimento (evita lost update com a suplementação e o
 *    ciclo com `/referencias/sincronizar`, que faz FOR SHARE no Produto);
 *  - sequência (`reservarNumero[s]`) só DEPOIS da trava de produtos;
 *  - `estoque_atual` só por `{increment}`/`{decrement}`, conferindo o resultado;
 *  - lote baixado/devolvido por compare-and-set (CAS) sobre o valor lido sob
 *    trava: um escritor fora do protocolo vira 409, nunca saldo fantasma;
 *  - nada aqui altera `preco_custo`.
 *
 * D-PROD-161 (Estoque P0) — MOTOR FÍSICO ÚNICO: a suplementação e a
 * transferência entre locais também passam por aqui (`aplicarSaidaFifo` com
 * `ORIGEM_SUPLEMENTACAO` e `aplicarTransferenciaEstoque`); não existe mais
 * FIFO próprio em Number. Toda primitiva valida TUDO antes da primeira escrita,
 * e toda recusa desfaz a transação inteira de quem chama.
 *
 * ORDEM CANÔNICA DE TRAVAS (todos os escritores de estoque):
 *   recibo (L0) → documento (cabeçalho, Bem ou linha, se houver) → advisory de
 *   escopo (vínculo) → `LocalEstoque` FOR KEY SHARE em ordem de id
 *   (`exigirLocaisEstoque`) → produtos (advisory + FOR UPDATE crescente,
 *   `travarProdutosEstoque`) → títulos/perfil/Empresa FOR SHARE (financeiro) →
 *   lotes (FOR UPDATE crescente ou CAS) e movimentos originais → INSERTs →
 *   Produto ± → sequência NO FIM (`numerarMovimentos`) → AuditLog → recibo.
 */

import { randomUUID } from 'node:crypto';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { travarEscopo } from '../gestao/gestaoComum.js';
import { reservarNumero, reservarNumeros, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, Dec, LIMITE_ESTOQUE, ZERO, arredondar, dec, paraBanco, somar } from '../financeiro/decimalFinanceiro.js';

export const ENTIDADE_MOVIMENTO = 'MovimentacaoEstoque';
export const ORIGEM_SISTEMA = 'operacao_financeira';
/** D-PROD-159: origem do movimento do abastecimento de bem patrimonial (nunca lançamento financeiro). 24 chars (VarChar(32)). */
export const ORIGEM_ABASTECIMENTO = 'abastecimento_patrimonio';
/** D-PROD-161: origem da baixa de suplementação (cocho). Mesmo valor gravado antes da P0. 13 chars. */
export const ORIGEM_SUPLEMENTACAO = 'suplementacao';
/** D-PROD-161: origem da transferência entre locais (depósito). Mesmo valor gravado antes da P0. */
export const ORIGEM_DEPOSITO = 'deposito';
const ORIGENS_SISTEMA = new Set([ORIGEM_SISTEMA, ORIGEM_ABASTECIMENTO, ORIGEM_SUPLEMENTACAO, ORIGEM_DEPOSITO]);
/** `exclusao_somente_em` por origem. As 2 origens da P3/P1 não mudam; as 2 novas mantêm os valores gravados antes da P0. */
const EXCLUSAO_SOMENTE_EM = Object.freeze({
  [ORIGEM_SISTEMA]: ORIGEM_SISTEMA,
  [ORIGEM_ABASTECIMENTO]: ORIGEM_ABASTECIMENTO,
  [ORIGEM_SUPLEMENTACAO]: 'cocho',
  [ORIGEM_DEPOSITO]: 'deposito',
});

/** Chave da trava por produto (a mesma em TODOS os escritores de estoque). */
export const chaveTravaProduto = (clienteId, empresaId, produtoId) => `estoque:produto:${clienteId}:${empresaId}:${produtoId}`;

/**
 * Trava os produtos (advisory lock por produto em ordem crescente de id + a
 * linha do Produto `FOR UPDATE`, também em ordem). Chamar logo depois da trava
 * do cabeçalho do documento e antes de qualquer leitura de produto ou lote.
 * @param {any} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {Array<string|null|undefined>} produtoIds
 * @returns {Promise<string[]>} ids travados, em ordem
 */
export const travarProdutosEstoque = async (tx, clienteId, empresaId, produtoIds) => {
  const ids = [...new Set((produtoIds ?? []).filter((v) => typeof v === 'string' && v).map(String))].sort();
  for (const id of ids) await travarEscopo(tx, chaveTravaProduto(clienteId, empresaId, id));
  if (ids.length) {
    await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  }
  return ids;
};

/** Dia `AAAA-MM-DD` → Date do banco (@db.Date). */
const comoDia = (dia) => new Date(`${dia}T00:00:00.000Z`);
/** Instante do movimento: meio-dia UTC do dia operacional (convenção do estoque). */
const instanteDoDia = (dia) => new Date(`${dia}T12:00:00.000Z`);

/**
 * Ordem FIFO ÚNICA de todos os escritores (D-PROD-161: o FIFO paralelo da
 * suplementação/transferência foi removido): chave
 * `COALESCE(data_documento, createdAt)` crescente, desempate por id.
 * @template {{ id: string, data_documento?: Date|null, createdAt: Date }} T
 * @param {T[]} lotes
 * @returns {T[]}
 */
export const ordenarFifo = (lotes) =>
  [...lotes].sort((a, b) => {
    const ta = (a.data_documento ?? a.createdAt).getTime();
    const tb = (b.data_documento ?? b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

/**
 * O tradutor HTTP só expõe `reason` junto de `field` (ambos strings): toda
 * recusa de linha leva os dois (padrão `quantidade` do item) + colecao/indice.
 */
const comCampo = (details) => ({ field: 'quantidade', ...details });

const excedeLimiteEstoque = (details) =>
  new AppError('OPERACAO_VALORES_INVALIDOS', 'valor ou quantidade acima do limite das colunas de estoque (9.999.999.999,9999); nada foi gravado', {
    details: comCampo({ reason: 'valor_excede_limite_estoque', ...details }),
  });

const conflitoDeEstoque = (details) =>
  new AppError('CONCURRENCY_CONFLICT', 'o estoque do lote mudou durante a operação; tente de novo com a mesma operation_id', { details });

const quantidadeZero = (details) =>
  new AppError('OPERACAO_VALORES_INVALIDOS', 'quantidade em kg deve ser maior que zero', { details: comCampo({ reason: 'quantidade_estoque_zero', ...details }) });

/**
 * D-PROD-161 — guarda fail-closed de TODA primitiva, antes de qualquer leitura:
 * o produto tem de ser da empresa do efeito (quem chama já conferiu; um erro de
 * programação nunca cria lote/movimento cruzado entre fazendas).
 */
const exigirProdutoDaEmpresa = (a) => {
  if (!a.produto || a.produto.empresa_id !== a.empresaId) {
    throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado nesta empresa');
  }
};

/**
 * D-PROD-161 — kg vindo do corpo JSON (number|string|Decimal) → `Dec`
 * arredondado UMA vez em ROUND_HALF_UP(4), na fronteira. Usa `new Dec(String(v))`
 * porque `dec()` recusa float (o navegador converte SACO→KG em float).
 * ≤ 0 → 422 `quantidade_estoque_zero`; > LIMITE_ESTOQUE → 422 `valor_excede_limite_estoque`.
 * @param {unknown} valor @param {{field?: string}} [o]
 * @returns {InstanceType<typeof Dec>}
 */
export const kgDeEntrada = (valor, { field = 'quantidade' } = {}) => {
  /** @type {InstanceType<typeof Dec>|null} */
  let bruto = null;
  if (valor instanceof Dec) bruto = dec(valor);
  else if (typeof valor === 'number' || typeof valor === 'string' || (valor && typeof valor === 'object' && typeof /** @type {any} */ (valor).toFixed === 'function')) {
    try {
      bruto = new Dec(String(valor).trim());
    } catch {
      bruto = null;
    }
  }
  if (!bruto || bruto.isNaN()) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'quantidade inválida', { details: { field, reason: 'format' } });
  }
  const kg = bruto.toDecimalPlaces(CASAS_QUANTIDADE, Dec.ROUND_HALF_UP);
  if (!kg.gt(0)) throw quantidadeZero({ field });
  if (kg.gt(LIMITE_ESTOQUE)) throw excedeLimiteEstoque({ field, quantidade_kg: kg.toFixed(CASAS_QUANTIDADE) });
  return kg;
};

const localInvalido = (field, reason) =>
  new AppError(
    'ESTOQUE_LOCAL_INVALIDO',
    reason === 'local_inativo' ? 'o local de estoque de destino está inativo; nada foi gravado' : 'local de estoque não encontrado; nada foi gravado',
    { details: { field, reason } },
  );

/**
 * D-PROD-161 — valida e TRAVA os locais do comando num único
 * `SELECT … WHERE cliente_id AND id = ANY ORDER BY id FOR KEY SHARE` (não
 * disputa com a renomeação, que é NO KEY UPDATE, nem com o abastecimento;
 * segura o DELETE do local até o commit). Chamar ANTES de `travarProdutosEstoque`.
 * Local de outro tenant = inexistente (mesmo corpo de erro: sem oráculo).
 * @param {any} tx @param {string} clienteId
 * @param {Array<{ id: string, field: 'local_origem_id'|'local_destino_id', exigirAtivo: boolean }>} pedidos
 * @returns {Promise<Map<string, { id: string, nome: string, ativo: boolean }>>}
 * @throws 422 ESTOQUE_LOCAL_INVALIDO { field, reason: 'local_inexistente'|'local_inativo' }
 */
export const exigirLocaisEstoque = async (tx, clienteId, pedidos) => {
  const ids = [...new Set(pedidos.map((x) => x.id).filter((v) => typeof v === 'string' && v))].sort();
  const linhas = /** @type {any[]} */ (ids.length
    ? await tx.$queryRaw`SELECT id, nome, ativo FROM "LocalEstoque" WHERE cliente_id = ${clienteId} AND id = ANY(${ids}::text[]) ORDER BY id FOR KEY SHARE`
    : []);
  /** @type {Map<string, { id: string, nome: string, ativo: boolean }>} */
  const locais = new Map(linhas.map((l) => [l.id, { id: l.id, nome: l.nome, ativo: l.ativo }]));
  for (const pedido of pedidos) {
    const local = locais.get(pedido.id);
    if (!local) throw localInvalido(pedido.field, 'local_inexistente');
    if (pedido.exigirAtivo && !local.ativo) throw localInvalido(pedido.field, 'local_inativo');
  }
  return locais;
};

/**
 * D-PROD-161 — consumo de camadas por CAS (o laço da saída FIFO, extraído sem
 * mudança): `updateMany` onde o lote ainda está 'Disponivel' com o MESMO saldo
 * lido sob a trava do produto; um escritor fora do protocolo vira 409.
 * @param {any} tx @param {string} clienteId
 * @param {Array<{ lote_id: string, quantidade: any, anterior: any }>} fatias
 * @throws 409 CONCURRENCY_CONFLICT { lote_id } se count ≠ 1
 */
export const consumirCamadas = async (tx, clienteId, fatias) => {
  for (const f of fatias) {
    const anterior = dec(f.anterior);
    const novo = anterior.minus(dec(f.quantidade));
    const r = await tx.estoqueLoteNota.updateMany({
      where: { cliente_id: clienteId, id: f.lote_id, status: 'Disponivel', quantidade_disponivel: paraBanco(anterior, CASAS_QUANTIDADE) },
      data: { quantidade_disponivel: paraBanco(novo, CASAS_QUANTIDADE), status: novo.gt(0) ? 'Disponivel' : 'Esgotado' },
    });
    if (r.count !== 1) throw conflitoDeEstoque({ lote_id: f.lote_id });
  }
};

/**
 * D-PROD-161 — criação de camada (lote 'Disponivel' com entrada = disponível),
 * extraída de `aplicarEntradaEstoque` sem mudar o comportamento; a transferência
 * cria a camada de destino com o custo, a data e a procedência da camada de origem.
 * @param {any} tx @param {string} clienteId
 * @param {{ empresaId: string, produto: any, local: {id: string, nome?: string|null}, kg: any, custoKg: any, dataDocumento: Date,
 *   procedencia: Record<string, string|null>, movimentoEntradaId: string }} c
 */
const criarCamadaEntrada = (tx, clienteId, c) =>
  tx.estoqueLoteNota.create({
    data: {
      cliente_id: clienteId,
      empresa_id: c.empresaId,
      produto_id: c.produto.id,
      produto_nome: c.produto.nome_produto ?? null,
      local_estoque_id: c.local.id,
      local_estoque_nome: c.local.nome ?? null,
      ...c.procedencia,
      data_documento: c.dataDocumento,
      custo_unitario: paraBanco(c.custoKg, CASAS_CUSTO),
      quantidade_entrada: paraBanco(c.kg, CASAS_QUANTIDADE),
      quantidade_disponivel: paraBanco(c.kg, CASAS_QUANTIDADE),
      movimentacao_entrada_id: c.movimentoEntradaId,
      status: 'Disponivel',
    },
  });

/**
 * D-PROD-161 — colunas extras que a suplementação/transferência acrescentam ao
 * movimento. Quantidade, valores, local, tipo e `lotes_consumidos` vêm sempre do núcleo.
 */
const COLUNAS_COMPLEMENTO = new Set([
  'area_vinculada_id', 'area_vinculada_nome', 'tipo_vinculo', 'centro_custo_nome', 'deposito_id',
  'ponto_suplementacao_id', 'observacoes', 'custo_medio_antes', 'custo_medio_depois',
]);
/** Fora da allowlist → erro de programação (500), nunca coluna gravada. */
const complementoDe = (fn, plano) => {
  if (!fn) return {};
  const extra = fn(plano) ?? {};
  for (const chave of Object.keys(extra)) {
    if (!COLUNAS_COMPLEMENTO.has(chave)) throw new Error(`estoque: coluna de complemento não permitida: ${chave}`);
  }
  return extra;
};

/** Fatia pública (sem o saldo `anterior` do CAS), com a linha do lote só quando pedida. */
const fatiaPublica = (f, comLote) => ({
  lote_id: f.lote_id, quantidade: f.quantidade, custo_unitario: f.custo_unitario, ...(comLote ? { lote: f.lote } : {}),
});
const fatiaGravada = (f) => ({ lote_id: f.lote_id, quantidade: dec(f.quantidade).toFixed(CASAS_QUANTIDADE), custo_unitario: dec(f.custo_unitario).toFixed(CASAS_CUSTO) });

/** Σ dos lotes Disponivel do produto NAQUELE local e empresa (saldo por local). */
const saldoNoLocal = async (tx, clienteId, empresaId, produtoId, localId) => {
  const r = await tx.estoqueLoteNota.aggregate({
    _sum: { quantidade_disponivel: true },
    where: { cliente_id: clienteId, empresa_id: empresaId, produto_id: produtoId, local_estoque_id: localId, status: 'Disponivel' },
  });
  return r._sum.quantidade_disponivel == null ? ZERO : dec(r._sum.quantidade_disponivel);
};

/** `estoque_atual` relido (cada item repetido relê o estado sob a mesma trava). */
const estoqueAtualDe = async (tx, clienteId, produtoId) => {
  const p = await tx.produto.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id: produtoId } }, select: { estoque_atual: true } });
  if (!p) throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado neste tenant');
  return dec(p.estoque_atual);
};

const numeroDoMovimento = async (tx, clienteId, numero) =>
  numero !== undefined && numero !== null
    ? String(numero)
    : String(await reservarNumero(tx, { clienteId, entidade: ENTIDADE_MOVIMENTO, escopoTipo: ESCOPO_TENANT }));

const camposDoProduto = (produto) => ({
  produto_id: produto.id,
  produto_nome: produto.nome_produto ?? null,
  produto_codigo: produto.codigo_interno || produto.codigo_barras || '',
  produto_categoria: produto.categoria ?? null,
});

/** Origem do movimento: padrão = a do financeiro; só as origens conhecidas (fail-closed: erro de programação → 500). */
const origemSistemaDe = (a) => {
  const sistema = a.origem?.sistema ?? ORIGEM_SISTEMA;
  if (!ORIGENS_SISTEMA.has(sistema)) throw new Error(`origem de estoque desconhecida: ${String(sistema)}`);
  return sistema;
};

const camposComuns = (auth, a) => {
  const sistema = origemSistemaDe(a);
  return {
    cliente_id: auth.clienteId,
    empresa_id: a.empresaId,
    ...camposDoProduto(a.produto),
    unidade_medida: 'KG',
    numero_documento: a.documento?.numero ?? null,
    data_documento: a.documento?.data ? comoDia(a.documento.data) : null,
    lancamento_origem_id: a.origem.operacaoId,
    origem_sistema: sistema,
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: EXCLUSAO_SOMENTE_EM[/** @type {keyof typeof EXCLUSAO_SOMENTE_EM} */ (sistema)],
    is_registro_principal: true,
    numero_movimentacao_seq: 1,
    total_movimentacoes_grupo: 1,
    usuario_responsavel: auth.login || 'Sistema',
    status: 'Ativa',
  };
};

const decrementarEstoqueAtual = async (tx, clienteId, produtoId, kg, erroSeNegativo) => {
  const depois = await tx.produto.update({
    where: { cliente_id_id: { cliente_id: clienteId, id: produtoId } },
    data: { estoque_atual: { decrement: paraBanco(kg, CASAS_QUANTIDADE) } },
    select: { estoque_atual: true },
  });
  const valor = dec(depois.estoque_atual);
  if (valor.lt(0)) throw erroSeNegativo(valor);
  return valor;
};

const incrementarEstoqueAtual = async (tx, clienteId, produtoId, kg) => {
  const depois = await tx.produto.update({
    where: { cliente_id_id: { cliente_id: clienteId, id: produtoId } },
    data: { estoque_atual: { increment: paraBanco(kg, CASAS_QUANTIDADE) } },
    select: { estoque_atual: true },
  });
  return dec(depois.estoque_atual);
};

/**
 * ENTRADA (compra confirmada): lote novo + movimento 'Entrada' ligado ao lote +
 * `estoque_atual += kg`. Custo de aquisição LÍQUIDO (D-PROD-155, rodada 4):
 * `valorTotal` é o valor líquido da linha (subtotal − desconto + acréscimo do
 * cabeçalho rateados) e `custoUnitarioKg` = ROUND_HALF_UP(líquido / kg, 4);
 * o resíduo de arredondamento é decidido/mostrado pelo planejador.
 * @param {any} tx
 * @param {{auth: any, requestId?: string}} ctx
 * @param {{ empresaId: string, produto: any, local: {id: string, nome: string}, quantidadeKg: any, custoUnitarioKg: any,
 *   valorTotal: any, dia: string, documento?: {numero?: string|null, data?: string|null}, parceiro?: {id?: string|null, nome?: string|null},
 *   origem: {operacaoId: string, tipoDetalhado?: string}, numeroMovimento?: string|number, contextoErro?: Record<string, unknown> }} a
 */
export const aplicarEntradaEstoque = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  exigirProdutoDaEmpresa(a);
  const kg = dec(a.quantidadeKg);
  const custoKg = dec(a.custoUnitarioKg);
  const valorTotal = dec(a.valorTotal);
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  const extra = { produto_id: a.produto.id, ...(a.contextoErro ?? {}) };
  if (!kg.gt(0)) {
    throw new AppError('OPERACAO_VALORES_INVALIDOS', 'quantidade em kg deve ser maior que zero', { details: comCampo({ reason: 'quantidade_estoque_zero', ...extra }) });
  }
  if (kg.gt(LIMITE_ESTOQUE) || custoKg.gt(LIMITE_ESTOQUE) || valorTotal.gt(LIMITE_ESTOQUE) || estoqueAtual.plus(kg).gt(LIMITE_ESTOQUE)) {
    throw excedeLimiteEstoque({ ...extra, estoque_atual: estoqueAtual.toFixed(CASAS_QUANTIDADE), quantidade_kg: kg.toFixed(CASAS_QUANTIDADE) });
  }
  const saldoAntes = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.local.id);
  const numero = await numeroDoMovimento(tx, cli, a.numeroMovimento);
  const movimento = await tx.movimentacaoEstoque.create({
    data: {
      ...camposComuns(auth, a),
      numero_movimentacao: numero,
      tipo_movimentacao: 'Entrada',
      tipo_detalhado: a.origem.tipoDetalhado ?? 'compra_financeiro',
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: paraBanco(custoKg, CASAS_CUSTO),
      valor_total: paraBanco(valorTotal, CASAS_CUSTO),
      local_estoque_destino: a.local.id,
      local_destino: a.local.nome ?? null,
      fornecedor_id: a.parceiro?.id ?? null,
      fornecedor_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: 'Entrada por lançamento financeiro confirmado',
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.plus(kg), CASAS_QUANTIDADE),
    },
  });
  const lote = await criarCamadaEntrada(tx, cli, {
    empresaId: a.empresaId,
    produto: a.produto,
    local: a.local,
    kg,
    custoKg,
    dataDocumento: comoDia(a.dia),
    procedencia: { numero_documento: a.documento?.numero ?? null, fornecedor_id: a.parceiro?.id ?? null, fornecedor_nome: a.parceiro?.nome ?? null },
    movimentoEntradaId: movimento.id,
  });
  const estoqueDepois = await incrementarEstoqueAtual(tx, cli, a.produto.id, kg);
  return { lote, movimento, estoque_atual: estoqueDepois };
};

/**
 * Simulação FIFO pura (prévia e confirmação usam a mesma regra): consome os
 * lotes na ordem FIFO até `kg`. Não grava nada.
 * @param {Array<{ id: string, quantidade_disponivel: any, custo_unitario: any, data_documento?: Date|null, createdAt: Date }>} lotes
 * @param {any} kg
 */
export const consumirFifo = (lotes, kg) => {
  const pedido = dec(kg);
  const elegiveis = ordenarFifo(lotes.filter((l) => dec(l.quantidade_disponivel).gt(0)));
  const disponivel = somar(elegiveis.map((l) => l.quantidade_disponivel));
  /** @type {Array<{ lote_id: string, quantidade: any, custo_unitario: any, anterior: any }>} */
  const fatias = [];
  let restante = pedido;
  for (const l of elegiveis) {
    if (!restante.gt(0)) break;
    const disp = dec(l.quantidade_disponivel);
    const fatia = disp.lt(restante) ? disp : restante;
    fatias.push({ lote_id: l.id, quantidade: fatia, custo_unitario: dec(l.custo_unitario), anterior: disp });
    restante = restante.minus(fatia);
  }
  const suficiente = !restante.gt(0);
  const valorTotal = arredondar(somar(fatias.map((f) => f.quantidade.times(f.custo_unitario))), CASAS_CUSTO);
  const valorUnitario = pedido.gt(0) ? arredondar(valorTotal.dividedBy(pedido), CASAS_CUSTO) : ZERO;
  return { suficiente, disponivel, fatias, valorTotal, valorUnitario };
};

/**
 * Lotes elegíveis ao FIFO de um produto num local de uma empresa. D-PROD-161:
 * `procedencia: true` também lê nº/série do documento e fornecedor (rateio da
 * suplementação e cópia exata da camada na transferência); sem o 6º argumento,
 * nada muda para os chamadores da P3/P1.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} produtoId @param {string} localId
 * @param {{ procedencia?: boolean }} [o]
 */
export const lotesFifo = (tx, clienteId, empresaId, produtoId, localId, { procedencia = false } = {}) =>
  tx.estoqueLoteNota.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, produto_id: produtoId, local_estoque_id: localId, status: 'Disponivel', quantidade_disponivel: { gt: 0 } },
    select: {
      id: true, quantidade_disponivel: true, quantidade_entrada: true, custo_unitario: true, data_documento: true, createdAt: true,
      ...(procedencia ? { numero_documento: true, serie_documento: true, fornecedor_id: true, fornecedor_nome: true } : {}),
    },
  });

export const saldoLoteInsuficiente = (details) =>
  new AppError('ESTOQUE_SALDO_INSUFICIENTE', 'saldo insuficiente nos lotes deste produto neste local; nada foi gravado', {
    details: comCampo({ reason: 'saldo_lote_insuficiente', ...details }),
  });

export const estoqueAtualInsuficiente = (details) =>
  new AppError('ESTOQUE_SALDO_INSUFICIENTE', 'o estoque atual do produto é menor que a quantidade pedida; nada foi gravado', {
    details: comCampo({ reason: 'estoque_atual_insuficiente', ...details }),
  });

/**
 * SAÍDA FIFO (venda confirmada): baixa os lotes Disponivel do produto + local +
 * empresa, cria UM movimento 'Saída' a CUSTO FIFO (nunca o preço de venda) e
 * `estoque_atual -= kg`. Devolve as fatias para `OperacaoFinanceiraConsumoLote`
 * (ou, D-PROD-159, `AbastecimentoBemConsumoLote` com `origem.sistema = ORIGEM_ABASTECIMENTO`).
 * D-PROD-161: também é a baixa da suplementação (`origem.sistema = ORIGEM_SUPLEMENTACAO`),
 * com os opcionais aditivos `instante` (data_movimentacao; padrão meio-dia UTC
 * de `dia`), `procedencia` (fatias com a linha do lote) e `complemento`
 * (colunas extras da allowlist `COLUNAS_COMPLEMENTO`, calculadas sobre o plano).
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, produto: any, local: {id: string, nome: string}, quantidadeKg: any, dia?: string, instante?: Date,
 *   documento?: {numero?: string|null, data?: string|null}, parceiro?: {id?: string|null, nome?: string|null},
 *   origem: {operacaoId: string|null, tipoDetalhado?: string, sistema?: string, motivo?: string}, numeroMovimento?: string|number, contextoErro?: Record<string, unknown>,
 *   procedencia?: boolean, complemento?: (plano: { fatias: any[], valorTotal: any, valorUnitario: any }) => Record<string, unknown> }} a
 */
export const aplicarSaidaFifo = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  exigirProdutoDaEmpresa(a);
  const instante = a.instante ?? (a.dia ? instanteDoDia(a.dia) : null);
  if (!(instante instanceof Date) || Number.isNaN(instante.getTime())) throw new Error('aplicarSaidaFifo: dia ou instante obrigatório');
  const kg = dec(a.quantidadeKg);
  const extra = { produto_id: a.produto.id, local_estoque_id: a.local.id, ...(a.contextoErro ?? {}) };
  // D-PROD-159 (M5): kg <= 0 faria `decrement` negativo (= aumento) e > limite estouraria a coluna.
  if (!kg.gt(0)) throw quantidadeZero(extra);
  if (kg.gt(LIMITE_ESTOQUE)) throw excedeLimiteEstoque({ ...extra, quantidade_kg: kg.toFixed(CASAS_QUANTIDADE) });
  const lotes = await lotesFifo(tx, cli, a.empresaId, a.produto.id, a.local.id, { procedencia: Boolean(a.procedencia) });
  const fifo = consumirFifo(lotes, kg);
  if (!fifo.suficiente) {
    throw saldoLoteInsuficiente({ ...extra, disponivel: fifo.disponivel.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE) });
  }
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  if (estoqueAtual.lt(kg)) {
    throw estoqueAtualInsuficiente({ ...extra, estoque_atual: estoqueAtual.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE) });
  }
  if (fifo.valorTotal.gt(LIMITE_ESTOQUE)) throw excedeLimiteEstoque({ ...extra, valor_total: fifo.valorTotal.toFixed(CASAS_CUSTO) });
  const porId = new Map(lotes.map((l) => [l.id, l]));
  const fatias = fifo.fatias.map((f) => (a.procedencia ? { ...f, lote: porId.get(f.lote_id) } : f));
  const publicas = fatias.map((f) => fatiaPublica(f, Boolean(a.procedencia)));
  const colunasExtras = complementoDe(a.complemento, { fatias: publicas, valorTotal: fifo.valorTotal, valorUnitario: fifo.valorUnitario });
  const saldoAntes = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.local.id);
  const numero = await numeroDoMovimento(tx, cli, a.numeroMovimento);
  const movimento = await tx.movimentacaoEstoque.create({
    data: {
      ...camposComuns(auth, a),
      ...colunasExtras,
      numero_movimentacao: numero,
      tipo_movimentacao: 'Saída',
      tipo_detalhado: a.origem.tipoDetalhado ?? 'venda_financeiro',
      data_movimentacao: instante,
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: paraBanco(fifo.valorUnitario, CASAS_CUSTO),
      valor_total: paraBanco(fifo.valorTotal, CASAS_CUSTO),
      local_estoque_origem: a.local.id,
      local_origem: a.local.nome ?? null,
      cliente_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: a.origem.motivo ?? 'Saída por lançamento financeiro confirmado',
      modo_saida_fifo: 'FIFO',
      lotes_consumidos: fifo.fatias.map(fatiaGravada),
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.minus(kg), CASAS_QUANTIDADE),
    },
  });
  await consumirCamadas(tx, cli, fifo.fatias);
  await decrementarEstoqueAtual(tx, cli, a.produto.id, kg, (valor) =>
    estoqueAtualInsuficiente({ ...extra, estoque_atual: valor.plus(kg).toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE) })
  );
  return {
    movimento,
    fatias: publicas,
    valor_total: fifo.valorTotal,
    valor_unitario: fifo.valorUnitario,
  };
};

/**
 * D-PROD-161 — TRANSFERÊNCIA entre locais da MESMA empresa e produto. Consome
 * FIFO na origem (CAS) e cria, no destino, uma camada por fatia com o MESMO
 * custo, a MESMA `data_documento` (a de origem; sem data, o dia UTC de
 * `instante` — nunca o ano 2001 do `String(Date).slice`) e a MESMA procedência
 * (nulo continua nulo). Grava o par pai/filho (Saída `transferencia_enviada`,
 * Entrada `transferencia_recebida`) e a linhagem em `lotes_consumidos[].lote_destino_id`
 * (JSON, sem FK). NÃO lê nem altera `estoque_atual`, nem o total da empresa.
 * Exige: produto travado (`travarProdutosEstoque`) e locais travados
 * (`exigirLocaisEstoque`); números PROVISÓRIOS (quem chama numera no fim).
 * @param {any} tx @param {{auth: any}} ctx
 * @param {{ empresaId: string, produto: any, origem: {id: string, nome: string}, destino: {id: string, nome: string},
 *   quantidadeKg: any, instante: Date, numeros: { saida: string, entrada: string },
 *   complemento?: (plano: { fatias: any[], valorTotal: any, valorUnitario: any }) => { observacoes?: string, custo_medio_antes?: string, custo_medio_depois?: string },
 *   contextoErro?: Record<string, unknown> }} a
 * @returns {Promise<{ saida: any, entrada: any, valor_total: any, valor_unitario: any,
 *   fatias: Array<{ lote_id: string, lote_destino_id: string, quantidade: any, custo_unitario: any, lote: any }> }>}
 */
export const aplicarTransferenciaEstoque = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  // 1–3: tudo validado antes de qualquer leitura de lote
  if (a.origem.id === a.destino.id) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'Origem e destino devem ser distintos', { details: { field: 'local_destino_id', reason: 'invalid' } });
  }
  exigirProdutoDaEmpresa(a);
  if (!(a.instante instanceof Date) || Number.isNaN(a.instante.getTime())) throw new Error('aplicarTransferenciaEstoque: instante obrigatório');
  if (!a.numeros?.saida || !a.numeros?.entrada) throw new Error('aplicarTransferenciaEstoque: números provisórios obrigatórios');
  const kg = dec(a.quantidadeKg);
  const extra = { produto_id: a.produto.id, local_estoque_id: a.origem.id, ...(a.contextoErro ?? {}) };
  if (!kg.gt(0)) throw quantidadeZero(extra);
  if (kg.gt(LIMITE_ESTOQUE)) throw excedeLimiteEstoque({ ...extra, quantidade_kg: kg.toFixed(CASAS_QUANTIDADE) });
  // 4–5: plano FIFO na origem e limites, ainda sem escrever
  const lotes = await lotesFifo(tx, cli, a.empresaId, a.produto.id, a.origem.id, { procedencia: true });
  const fifo = consumirFifo(lotes, kg);
  if (!fifo.suficiente) {
    throw saldoLoteInsuficiente({ ...extra, disponivel: fifo.disponivel.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE) });
  }
  if (fifo.valorTotal.gt(LIMITE_ESTOQUE)) throw excedeLimiteEstoque({ ...extra, valor_total: fifo.valorTotal.toFixed(CASAS_CUSTO) });
  const saldoOrigem = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.origem.id);
  const saldoDestino = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.destino.id);
  if (saldoDestino.plus(kg).gt(LIMITE_ESTOQUE)) {
    throw excedeLimiteEstoque({ ...extra, local_estoque_id: a.destino.id, saldo_destino: saldoDestino.toFixed(CASAS_QUANTIDADE), quantidade_kg: kg.toFixed(CASAS_QUANTIDADE) });
  }
  const porId = new Map(lotes.map((l) => [l.id, l]));
  const fatias = fifo.fatias.map((f) => ({ ...f, lote: porId.get(f.lote_id) }));
  const colunasExtras = complementoDe(a.complemento, {
    fatias: fatias.map((f) => fatiaPublica(f, true)), valorTotal: fifo.valorTotal, valorUnitario: fifo.valorUnitario,
  });
  const comum = {
    ...camposComuns(auth, { ...a, origem: { sistema: ORIGEM_DEPOSITO, operacaoId: null } }),
    ...colunasExtras,
    data_movimentacao: a.instante,
    quantidade: paraBanco(kg, CASAS_QUANTIDADE),
    valor_unitario: paraBanco(fifo.valorUnitario, CASAS_CUSTO),
    valor_total: paraBanco(fifo.valorTotal, CASAS_CUSTO),
    local_estoque_origem: a.origem.id,
    local_origem: a.origem.nome ?? null,
    local_estoque_destino: a.destino.id,
    local_destino: a.destino.nome ?? null,
    motivo_movimentacao: 'Transferência entre locais de estoque',
    total_movimentacoes_grupo: 2,
  };
  // 6–7: saída + CAS na origem
  const saida = await tx.movimentacaoEstoque.create({
    data: {
      ...comum,
      numero_movimentacao: String(a.numeros.saida),
      tipo_movimentacao: 'Saída',
      tipo_detalhado: 'transferencia_enviada',
      modo_saida_fifo: 'FIFO',
      lotes_consumidos: fatias.map(fatiaGravada),
      is_registro_principal: true,
      numero_movimentacao_seq: 1,
      saldo_antes: paraBanco(saldoOrigem, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoOrigem.minus(kg), CASAS_QUANTIDADE),
    },
  });
  await consumirCamadas(tx, cli, fatias);
  // 8–9: entrada + camadas de destino (custo, data e procedência da origem)
  const entrada = await tx.movimentacaoEstoque.create({
    data: {
      ...comum,
      numero_movimentacao: String(a.numeros.entrada),
      tipo_movimentacao: 'Entrada',
      tipo_detalhado: 'transferencia_recebida',
      movimento_pai_id: saida.id,
      is_registro_principal: false,
      numero_movimentacao_seq: 2,
      saldo_antes: paraBanco(saldoDestino, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoDestino.plus(kg), CASAS_QUANTIDADE),
    },
  });
  const diaDoInstante = a.instante.toISOString().slice(0, 10);
  /** @type {string[]} */
  const destinos = [];
  for (const f of fatias) {
    const camada = await criarCamadaEntrada(tx, cli, {
      empresaId: a.empresaId,
      produto: a.produto,
      local: a.destino,
      kg: f.quantidade,
      custoKg: f.custo_unitario,
      dataDocumento: f.lote.data_documento ?? comoDia(diaDoInstante),
      procedencia: {
        numero_documento: f.lote.numero_documento ?? null,
        serie_documento: f.lote.serie_documento ?? null,
        fornecedor_id: f.lote.fornecedor_id ?? null,
        fornecedor_nome: f.lote.fornecedor_nome ?? null,
      },
      movimentoEntradaId: entrada.id,
    });
    destinos.push(camada.id);
  }
  // 10: pai → filho e linhagem (JSON, sem FK)
  const saidaFinal = await tx.movimentacaoEstoque.update({
    where: { cliente_id_id: { cliente_id: cli, id: saida.id } },
    data: { movimento_filho_id: entrada.id, lotes_consumidos: fatias.map((f, k) => ({ ...fatiaGravada(f), lote_destino_id: destinos[k] })) },
  });
  return {
    saida: saidaFinal,
    entrada,
    valor_total: fifo.valorTotal,
    valor_unitario: fifo.valorUnitario,
    fatias: fatias.map((f, k) => ({ lote_id: f.lote_id, lote_destino_id: destinos[k], quantidade: f.quantidade, custo_unitario: f.custo_unitario, lote: f.lote })),
  };
};

/** Recusa do cancelamento: a linha é o item (colecao `itens`, índice 0-based). */
const jaConsumido = (mensagem, details) =>
  new AppError('ESTOQUE_JA_CONSUMIDO', mensagem, {
    details: { field: 'itens', colecao: 'itens', ...(Number.isInteger(details?.item_ordem) ? { indice: details.item_ordem - 1 } : {}), ...details },
  });

const movimentoOriginal = async (tx, clienteId, id) => {
  const m = id ? await tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } }) : null;
  if (!m) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque do item não encontrado');
  return m;
};

const marcarOriginalEstornado = (tx, clienteId, original, estorno) =>
  tx.movimentacaoEstoque.update({
    where: { cliente_id_id: { cliente_id: clienteId, id: original.id } },
    data: { status: 'Estornada', movimento_filho_id: estorno.id },
  });

/**
 * Estorno de ENTRADA (cancelamento de compra): exige o lote INTOCADO; zera o
 * lote (status 'Estornado'), cria 'Saída' `estorno_compra` ligada ao original
 * (pai/filho; original 'Estornada') e `estoque_atual -= kg`.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, item: any, produto: any, local: {id: string, nome: string}, dia: string,
 *   documento?: any, parceiro?: any, origem: {operacaoId: string}, numeroMovimento?: string|number }} a
 */
export const estornarEntrada = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  const kg = dec(a.item.quantidade_estoque);
  const base = { item_ordem: a.item.ordem, lote_id: a.item.estoque_lote_nota_id };
  const lote = a.item.estoque_lote_nota_id
    ? await tx.estoqueLoteNota.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: a.item.estoque_lote_nota_id } } })
    : null;
  if (!lote) throw jaConsumido('o lote de entrada deste item não existe mais; cancelamento recusado (nada foi alterado)', { ...base, reason: 'lote_inexistente' });
  const entrada = dec(lote.quantidade_entrada);
  const disponivel = dec(lote.quantidade_disponivel);
  if (lote.status !== 'Disponivel' || !disponivel.eq(entrada) || !entrada.eq(kg)) {
    throw jaConsumido('o estoque desta compra já foi consumido ou alterado; cancelamento recusado (nada foi alterado)', {
      ...base, reason: 'lote_consumido', entrada: entrada.toFixed(CASAS_QUANTIDADE), disponivel: disponivel.toFixed(CASAS_QUANTIDADE), status: lote.status,
    });
  }
  const original = await movimentoOriginal(tx, cli, a.item.movimentacao_estoque_id);
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  const semEstoque = (valor) =>
    jaConsumido('o estoque atual do produto é menor que a compra a estornar; cancelamento recusado (nada foi alterado)', {
      ...base, reason: 'estoque_atual_insuficiente', estoque_atual: valor.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE),
    });
  if (estoqueAtual.lt(kg)) throw semEstoque(estoqueAtual);
  const saldoAntes = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.local.id);
  const zerado = await tx.estoqueLoteNota.updateMany({
    where: { cliente_id: cli, id: lote.id, status: 'Disponivel', quantidade_disponivel: paraBanco(entrada, CASAS_QUANTIDADE) },
    data: { quantidade_disponivel: paraBanco(ZERO, CASAS_QUANTIDADE), status: 'Estornado' },
  });
  if (zerado.count !== 1) throw jaConsumido('o lote mudou durante o cancelamento; nada foi alterado', { ...base, reason: 'lote_consumido' });
  const numero = await numeroDoMovimento(tx, cli, a.numeroMovimento);
  const estorno = await tx.movimentacaoEstoque.create({
    data: {
      ...camposComuns(auth, a),
      numero_movimentacao: numero,
      tipo_movimentacao: 'Saída',
      tipo_detalhado: 'estorno_compra',
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: original.valor_unitario,
      valor_total: original.valor_total,
      local_estoque_origem: a.local.id,
      local_origem: a.local.nome ?? null,
      fornecedor_id: a.parceiro?.id ?? null,
      fornecedor_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: 'Estorno de compra por cancelamento do lançamento financeiro',
      movimento_pai_id: original.id,
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.minus(kg), CASAS_QUANTIDADE),
    },
  });
  await marcarOriginalEstornado(tx, cli, original, estorno);
  await decrementarEstoqueAtual(tx, cli, a.produto.id, kg, (valor) => semEstoque(valor.plus(kg)));
  return { movimento: estorno };
};

/**
 * Estorno de SAÍDA (cancelamento de venda): devolve cada fatia ao SEU lote
 * (recusa lote que não esteja 'Disponivel'/'Esgotado' — ex.: 'Estornado' — e
 * devolução acima da entrada), cria 'Entrada' `estorno_venda` ligada ao
 * original e `estoque_atual += kg`.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, item: any, consumos: Array<{estoque_lote_nota_id: string, quantidade: any}>, produto: any,
 *   local: {id: string, nome: string}, dia: string, documento?: any, parceiro?: any,
 *   origem: {operacaoId: string, sistema?: string, tipoDetalhadoEstorno?: string, motivoEstorno?: string},
 *   numeroMovimento?: string|number }} a
 */
export const estornarSaida = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  const kg = dec(a.item.quantidade_estoque);
  const devolvido = somar(a.consumos.map((c) => c.quantidade));
  if (!devolvido.eq(kg)) {
    throw jaConsumido('as fatias FIFO gravadas não somam a quantidade do item; cancelamento recusado', { item_ordem: a.item.ordem, reason: 'fatias_inconsistentes' });
  }
  const original = await movimentoOriginal(tx, cli, a.item.movimentacao_estoque_id);
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  if (estoqueAtual.plus(kg).gt(LIMITE_ESTOQUE)) {
    throw excedeLimiteEstoque({ colecao: 'itens', indice: a.item.ordem - 1, item_ordem: a.item.ordem, produto_id: a.produto.id });
  }
  const saldoAntes = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.local.id);
  for (const c of a.consumos) {
    const lote = await tx.estoqueLoteNota.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: c.estoque_lote_nota_id } } });
    const base = { item_ordem: a.item.ordem, lote_id: c.estoque_lote_nota_id };
    if (!lote || !['Disponivel', 'Esgotado'].includes(lote.status)) {
      throw jaConsumido('um lote desta venda não pode receber a devolução (lote estornado ou removido); cancelamento recusado', {
        ...base, reason: 'lote_indisponivel_para_devolucao', status: lote?.status ?? null,
      });
    }
    const disp = dec(lote.quantidade_disponivel);
    const novo = disp.plus(dec(c.quantidade));
    if (novo.gt(dec(lote.quantidade_entrada))) {
      throw jaConsumido('a devolução ultrapassaria a entrada do lote; cancelamento recusado', {
        ...base, reason: 'devolucao_excede_entrada', entrada: dec(lote.quantidade_entrada).toFixed(CASAS_QUANTIDADE), disponivel: disp.toFixed(CASAS_QUANTIDADE),
      });
    }
    const r = await tx.estoqueLoteNota.updateMany({
      where: { cliente_id: cli, id: lote.id, status: lote.status, quantidade_disponivel: paraBanco(disp, CASAS_QUANTIDADE) },
      data: { quantidade_disponivel: paraBanco(novo, CASAS_QUANTIDADE), status: 'Disponivel' },
    });
    if (r.count !== 1) throw conflitoDeEstoque({ lote_id: lote.id });
  }
  const numero = await numeroDoMovimento(tx, cli, a.numeroMovimento);
  const estorno = await tx.movimentacaoEstoque.create({
    data: {
      ...camposComuns(auth, a),
      numero_movimentacao: numero,
      tipo_movimentacao: 'Entrada',
      tipo_detalhado: a.origem.tipoDetalhadoEstorno ?? 'estorno_venda',
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: original.valor_unitario,
      valor_total: original.valor_total,
      local_estoque_destino: a.local.id,
      local_destino: a.local.nome ?? null,
      cliente_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: a.origem.motivoEstorno ?? 'Estorno de venda por cancelamento do lançamento financeiro',
      movimento_pai_id: original.id,
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.plus(kg), CASAS_QUANTIDADE),
    },
  });
  await marcarOriginalEstornado(tx, cli, original, estorno);
  await incrementarEstoqueAtual(tx, cli, a.produto.id, kg);
  return { movimento: estorno };
};

// ─── estornos do cancelamento EM LOTE ──────────────────────────────────────
const chaveSaldo = (produtoId, localId) => `${produtoId}\u0000${localId}`;
const unicosDe = (lista) => [...new Set(lista.filter((v) => typeof v === 'string' && v))];

/**
 * Estornos do CANCELAMENTO em lote (rodada 2, CRITICO-2). Mesmo resultado e
 * mesmas recusas, na mesma ordem dos itens, de `estornarEntrada` (compra) e
 * `estornarSaida` (venda) item a item — lotes, movimentos (campos, saldo
 * antes/depois por item), `estoque_atual` e fatias —, com um número FIXO de
 * idas ao banco (≈ 10) em vez de 11–15 por item: com 5–10 ms por ida, o
 * cancelamento de 200 itens passava dos 25–30 s da transação.
 *
 *  1. leituras de uma vez: produtos (já travados por quem chama), locais,
 *     lotes e movimentos originais (`FOR UPDATE`, em ordem de id — o mesmo
 *     passo 4 do §8.4, depois de produtos e títulos) e o saldo por produto +
 *     local (Σ dos lotes 'Disponivel', como `saldoNoLocal`);
 *  2. simulação pura, item a item na ordem do documento, com o estado que o
 *     laço antigo veria (lote devolvido por um item é relido pelo seguinte;
 *     saldo e `estoque_atual` corridos);
 *  3. gravações em lote: lotes (UPDATE … FROM unnest com CAS sobre o valor
 *     lido sob trava), movimentos (createManyAndReturn), originais
 *     'Estornada' e `estoque_atual` (UPDATE … FROM unnest, conferido).
 * A sequência de movimentos continua com quem chama (`numerarMovimentos`, no fim).
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, direcao: string, itens: any[], dia: string, documento?: {numero?: string|null, data?: string|null},
 *   parceiro?: {id?: string|null, nome?: string|null}, origem: {operacaoId: string}, numeroMovimento: () => string|number }} a
 * @returns {Promise<string[]>} ids dos movimentos de estorno, na ordem de `a.itens`
 */
export const estornarEmLote = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  if (!a.itens.length) return [];
  const compra = a.direcao === 'PAGAR';
  const produtoIds = unicosDe(a.itens.map((i) => i.produto_id));
  const localIds = unicosDe(a.itens.map((i) => i.local_estoque_id));
  const originalIds = unicosDe(a.itens.map((i) => i.movimentacao_estoque_id));
  const loteIds = unicosDe(compra ? a.itens.map((i) => i.estoque_lote_nota_id) : a.itens.flatMap((i) => i.consumos.map((c) => c.estoque_lote_nota_id)));

  // 1. leituras
  const produtos = new Map((await tx.produto.findMany({ where: { cliente_id: cli, id: { in: produtoIds } } })).map((p) => [p.id, p]));
  const locais = new Map((await tx.localEstoque.findMany({ where: { cliente_id: cli, id: { in: localIds } }, select: { id: true, nome: true } })).map((l) => [l.id, l]));
  /** @type {Map<string, {id: string, empresa_id: string, produto_id: string, local_estoque_id: string|null, status: string, entrada: any, disp: any}>} */
  const lotes = new Map();
  if (loteIds.length) {
    const lidos = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, empresa_id, produto_id, local_estoque_id, status, quantidade_entrada, quantidade_disponivel
      FROM "EstoqueLoteNota" WHERE cliente_id = ${cli} AND id = ANY(${loteIds}::text[]) ORDER BY id FOR UPDATE`);
    for (const l of lidos) {
      lotes.set(l.id, { id: l.id, empresa_id: l.empresa_id, produto_id: l.produto_id, local_estoque_id: l.local_estoque_id, status: l.status, entrada: dec(l.quantidade_entrada), disp: dec(l.quantidade_disponivel) });
    }
  }
  const inicial = new Map([...lotes.values()].map((l) => [l.id, { status: l.status, disp: l.disp }]));
  const originais = new Map(
    originalIds.length
      ? (/** @type {any[]} */ (await tx.$queryRaw`SELECT id, valor_unitario, valor_total FROM "MovimentacaoEstoque"
          WHERE cliente_id = ${cli} AND id = ANY(${originalIds}::text[]) ORDER BY id FOR UPDATE`)).map((m) => [m.id, m])
      : [],
  );
  const saldos = new Map();
  for (const g of await tx.estoqueLoteNota.groupBy({
    by: ['produto_id', 'local_estoque_id'],
    where: { cliente_id: cli, empresa_id: a.empresaId, produto_id: { in: produtoIds }, local_estoque_id: { in: localIds }, status: 'Disponivel' },
    _sum: { quantidade_disponivel: true },
  })) {
    saldos.set(chaveSaldo(g.produto_id, g.local_estoque_id), g._sum.quantidade_disponivel == null ? ZERO : dec(g._sum.quantidade_disponivel));
  }
  const estoque = new Map([...produtos.values()].map((p) => [p.id, dec(p.estoque_atual)]));

  // 2. simulação na ordem dos itens
  const saldoDe = (produtoId, localId) => saldos.get(chaveSaldo(produtoId, localId)) ?? ZERO;
  /** Lote muda de estado; o saldo do produto + local dele (desta empresa) acompanha. */
  const mudarLote = (l, status, disp) => {
    if (l.empresa_id === a.empresaId && l.local_estoque_id) {
      const chave = chaveSaldo(l.produto_id, l.local_estoque_id);
      const antes = l.status === 'Disponivel' ? l.disp : ZERO;
      const depois = status === 'Disponivel' ? disp : ZERO;
      saldos.set(chave, (saldos.get(chave) ?? ZERO).minus(antes).plus(depois));
    }
    Object.assign(l, { status, disp, mudou: true });
  };
  const exigirOriginal = (id) => {
    const m = id ? originais.get(id) : null;
    if (!m) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque do item não encontrado');
    return m;
  };
  const exigirEstoque = (produto) => {
    if (!produto) throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado neste tenant');
    return /** @type {any} */ (estoque.get(produto.id));
  };
  /** @type {any[]} */
  const movimentos = [];
  for (const item of a.itens) {
    const kg = dec(item.quantidade_estoque);
    const produto = produtos.get(item.produto_id);
    const local = { id: item.local_estoque_id, nome: locais.get(item.local_estoque_id)?.nome ?? item.local_estoque_nome };
    let original;
    let saldoAntes;
    if (compra) {
      const base = { item_ordem: item.ordem, lote_id: item.estoque_lote_nota_id };
      const l = item.estoque_lote_nota_id ? lotes.get(item.estoque_lote_nota_id) : null;
      if (!l) throw jaConsumido('o lote de entrada deste item não existe mais; cancelamento recusado (nada foi alterado)', { ...base, reason: 'lote_inexistente' });
      if (l.status !== 'Disponivel' || !l.disp.eq(l.entrada) || !l.entrada.eq(kg)) {
        throw jaConsumido('o estoque desta compra já foi consumido ou alterado; cancelamento recusado (nada foi alterado)', {
          ...base, reason: 'lote_consumido', entrada: l.entrada.toFixed(CASAS_QUANTIDADE), disponivel: l.disp.toFixed(CASAS_QUANTIDADE), status: l.status,
        });
      }
      original = exigirOriginal(item.movimentacao_estoque_id);
      const atual = exigirEstoque(produto);
      if (atual.lt(kg)) {
        throw jaConsumido('o estoque atual do produto é menor que a compra a estornar; cancelamento recusado (nada foi alterado)', {
          ...base, reason: 'estoque_atual_insuficiente', estoque_atual: atual.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE),
        });
      }
      saldoAntes = saldoDe(produto.id, local.id);
      mudarLote(l, 'Estornado', ZERO);
      estoque.set(produto.id, atual.minus(kg));
    } else {
      const devolvido = somar(item.consumos.map((c) => c.quantidade));
      if (!devolvido.eq(kg)) {
        throw jaConsumido('as fatias FIFO gravadas não somam a quantidade do item; cancelamento recusado', { item_ordem: item.ordem, reason: 'fatias_inconsistentes' });
      }
      original = exigirOriginal(item.movimentacao_estoque_id);
      const atual = exigirEstoque(produto);
      if (atual.plus(kg).gt(LIMITE_ESTOQUE)) {
        throw excedeLimiteEstoque({ colecao: 'itens', indice: item.ordem - 1, item_ordem: item.ordem, produto_id: produto.id });
      }
      saldoAntes = saldoDe(produto.id, local.id);
      for (const c of item.consumos) {
        const l = lotes.get(c.estoque_lote_nota_id);
        const base = { item_ordem: item.ordem, lote_id: c.estoque_lote_nota_id };
        if (!l || !['Disponivel', 'Esgotado'].includes(l.status)) {
          throw jaConsumido('um lote desta venda não pode receber a devolução (lote estornado ou removido); cancelamento recusado', {
            ...base, reason: 'lote_indisponivel_para_devolucao', status: l?.status ?? null,
          });
        }
        const novo = l.disp.plus(dec(c.quantidade));
        if (novo.gt(l.entrada)) {
          throw jaConsumido('a devolução ultrapassaria a entrada do lote; cancelamento recusado', {
            ...base, reason: 'devolucao_excede_entrada', entrada: l.entrada.toFixed(CASAS_QUANTIDADE), disponivel: l.disp.toFixed(CASAS_QUANTIDADE),
          });
        }
        mudarLote(l, 'Disponivel', novo);
      }
      estoque.set(produto.id, atual.plus(kg));
    }
    movimentos.push({
      ...camposComuns(auth, { empresaId: a.empresaId, produto, documento: a.documento, origem: a.origem }),
      numero_movimentacao: String(a.numeroMovimento()),
      tipo_movimentacao: compra ? 'Saída' : 'Entrada',
      tipo_detalhado: compra ? 'estorno_compra' : 'estorno_venda',
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: original.valor_unitario,
      valor_total: original.valor_total,
      ...(compra
        ? { local_estoque_origem: local.id, local_origem: local.nome ?? null, fornecedor_id: a.parceiro?.id ?? null, fornecedor_nome: a.parceiro?.nome ?? null }
        : { local_estoque_destino: local.id, local_destino: local.nome ?? null, cliente_nome: a.parceiro?.nome ?? null }),
      motivo_movimentacao: compra ? 'Estorno de compra por cancelamento do lançamento financeiro' : 'Estorno de venda por cancelamento do lançamento financeiro',
      movimento_pai_id: original.id,
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(compra ? saldoAntes.minus(kg) : saldoAntes.plus(kg), CASAS_QUANTIDADE),
    });
  }

  // 3. gravações em lote
  const mudados = [...lotes.values()].filter((l) => /** @type {any} */ (l).mudou);
  if (mudados.length) {
    const ini = mudados.map((l) => /** @type {any} */ (inicial.get(l.id)));
    const n = await tx.$executeRaw`UPDATE "EstoqueLoteNota" AS l
      SET quantidade_disponivel = v.disp::numeric, status = v.status, "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM unnest(${mudados.map((l) => l.id)}::text[], ${ini.map((x) => x.status)}::text[], ${ini.map((x) => paraBanco(x.disp, CASAS_QUANTIDADE))}::text[],
        ${mudados.map((l) => l.status)}::text[], ${mudados.map((l) => paraBanco(l.disp, CASAS_QUANTIDADE))}::text[]) AS v(id, status_antes, disp_antes, status, disp)
      WHERE l.cliente_id = ${cli} AND l.id = v.id AND l.status = v.status_antes AND l.quantidade_disponivel = v.disp_antes::numeric`;
    if (n !== mudados.length) throw conflitoDeEstoque({ lotes: mudados.length, atualizados: n });
  }
  const criados = await tx.movimentacaoEstoque.createManyAndReturn({ data: movimentos, select: { id: true, movimento_pai_id: true } });
  const estornoDe = new Map(criados.map((m) => [m.movimento_pai_id, m.id]));
  const ids = a.itens.map((item) => estornoDe.get(item.movimentacao_estoque_id));
  if (criados.length !== a.itens.length || ids.some((id) => !id)) throw new Error(`estornos incompletos: ${criados.length} de ${a.itens.length}`);
  const marcados = await tx.$executeRaw`UPDATE "MovimentacaoEstoque" AS m
    SET status = 'Estornada', movimento_filho_id = v.filho, "updatedAt" = (now() AT TIME ZONE 'UTC')
    FROM unnest(${a.itens.map((item) => item.movimentacao_estoque_id)}::text[], ${ids}::text[]) AS v(id, filho)
    WHERE m.cliente_id = ${cli} AND m.id = v.id`;
  if (marcados !== a.itens.length) throw new Error(`originais marcados: ${marcados} de ${a.itens.length}`);
  const finais = /** @type {any[]} */ (await tx.$queryRaw`UPDATE "Produto" AS p
    SET estoque_atual = v.valor::numeric, "updatedAt" = (now() AT TIME ZONE 'UTC')
    FROM unnest(${produtoIds}::text[], ${produtoIds.map((id) => paraBanco(estoque.get(id), CASAS_QUANTIDADE))}::text[], ${produtoIds.map((id) => paraBanco(dec(produtos.get(id).estoque_atual), CASAS_QUANTIDADE))}::text[]) AS v(id, valor, antes)
    WHERE p.cliente_id = ${cli} AND p.id = v.id AND p.estoque_atual = v.antes::numeric
    RETURNING p.id`);
  if (finais.length !== produtoIds.length) throw conflitoDeEstoque({ produtos: produtoIds.length, atualizados: finais.length });
  return /** @type {string[]} */ (ids);
};

/**
 * D-PROD-159 — número PROVISÓRIO de movimento (mesmo formato do financeiro): único,
 * cabe no VarChar(32) e nunca chega ao commit — `numerarMovimentos` o troca no fim.
 */
export const numeroMovimentoProvisorio = () => `p-${randomUUID().replace(/-/g, '').slice(0, 30)}`;

/**
 * D-PROD-159 — troca os números provisórios pelos da sequência ÚNICA de movimentos do
 * tenant, reservados de uma vez no FIM da transação (depois de lotes e movimentos).
 * @param {any} tx @param {string} clienteId @param {string[]} ids movimentos, na ordem dos efeitos
 */
export const numerarMovimentos = async (tx, clienteId, ids) => {
  if (!ids.length) return;
  const numeros = (await reservarNumeros(tx, { clienteId, entidade: ENTIDADE_MOVIMENTO, escopoTipo: ESCOPO_TENANT }, ids.length)).map(String);
  const n = await tx.$executeRaw`UPDATE "MovimentacaoEstoque" AS m SET numero_movimentacao = v.numero
    FROM unnest(${ids}::text[], ${numeros}::text[]) AS v(id, numero)
    WHERE m.cliente_id = ${clienteId} AND m.id = v.id`;
  if (n !== ids.length) throw new Error(`numeração de movimentos incompleta: ${n} de ${ids.length}`);
};

/** Colunas de PROCEDÊNCIA do lote que seguem o documento (D-PROD-158, revisão DE-02/BC-01). */
export const CAMPOS_PROCEDENCIA_LOTE = Object.freeze(['fornecedor_id', 'fornecedor_nome', 'numero_documento']);

/**
 * D-PROD-158 (revisão DE-02/BC-01) — PROCEDÊNCIA dos registros físicos
 * ORIGINAIS de um documento retificado NO_LUGAR (parceiro, nº do documento ou
 * emissão trocados): o movimento original (fornecedor/cliente, nº e data do
 * documento) e, na compra, o lote (fornecedor e nº do documento) passam a dizer
 * o mesmo que o lançamento. Nunca toca em quantidade, custo, situação, local,
 * data do lote (`data_documento` do lote é o dia operacional, que não muda no
 * lugar) nem em ids: não é efeito físico. Só o lote cuja procedência muda é
 * gravado (`updatedAt` honesto). Recebe `tx` com os produtos já travados.
 * Devolve os lotes antes/depois: quem chama audita cada um, e a prova de
 * procedência aceita esse AuditLog como escritor benigno.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ direcao: string, loteIds: string[], movimentoIds: string[], documento: {numero: string|null, data: string},
 *   parceiro: {id: string|null, nome: string|null} }} a
 * @returns {Promise<Array<{ antes: any, depois: any }>>}
 */
export const atualizarProcedencia = async (tx, ctx, a) => {
  const cli = exigirAuthContext(ctx?.auth).clienteId;
  const compra = a.direcao === 'PAGAR';
  const movimentoIds = unicosDe(a.movimentoIds);
  if (movimentoIds.length) {
    const quem = compra ? { fornecedor_id: a.parceiro.id ?? null, fornecedor_nome: a.parceiro.nome ?? null } : { cliente_nome: a.parceiro.nome ?? null };
    const r = await tx.movimentacaoEstoque.updateMany({
      where: { cliente_id: cli, id: { in: movimentoIds } },
      data: { ...quem, numero_documento: a.documento.numero ?? null, data_documento: comoDia(a.documento.data) },
    });
    if (r.count !== movimentoIds.length) throw new Error(`procedência: movimentos atualizados ${r.count} de ${movimentoIds.length}`);
  }
  const loteIds = compra ? unicosDe(a.loteIds) : [];
  if (!loteIds.length) return [];
  const novo = { fornecedor_id: a.parceiro.id ?? null, fornecedor_nome: a.parceiro.nome ?? null, numero_documento: a.documento.numero ?? null };
  const select = { id: true, fornecedor_id: true, fornecedor_nome: true, numero_documento: true, updatedAt: true };
  const antes = await tx.estoqueLoteNota.findMany({ where: { cliente_id: cli, id: { in: loteIds } }, select, orderBy: { id: 'asc' } });
  if (antes.length !== loteIds.length) throw new Error(`procedência: lotes lidos ${antes.length} de ${loteIds.length}`);
  const mudam = antes.filter((l) => CAMPOS_PROCEDENCIA_LOTE.some((k) => l[k] !== novo[k]));
  if (!mudam.length) return [];
  const r = await tx.estoqueLoteNota.updateMany({ where: { cliente_id: cli, id: { in: mudam.map((l) => l.id) } }, data: novo });
  if (r.count !== mudam.length) throw new Error(`procedência: lotes atualizados ${r.count} de ${mudam.length}`);
  const depois = new Map((await tx.estoqueLoteNota.findMany({ where: { cliente_id: cli, id: { in: mudam.map((l) => l.id) } }, select })).map((l) => [l.id, l]));
  return mudam.map((l) => ({ antes: l, depois: depois.get(l.id) }));
};
