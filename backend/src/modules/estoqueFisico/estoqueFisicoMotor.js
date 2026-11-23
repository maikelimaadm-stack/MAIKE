/**
 * D-PROD-155 (Gestão P3-01) — motor de estoque FÍSICO composto (KG; D-PROD-162: e L).
 *
 * Funções que RECEBEM `tx` (nunca abrem transação) e trabalham em Decimal ponta
 * a ponta. São a única porta de efeito físico do lançamento financeiro
 * confirmado/cancelado: entrada (compra), saída a custo médio ponderado (venda, D-PROD-256) e os estornos.
 *
 * Regras (§3, §8.2, §8.4 do contrato):
 *  - quantidade na unidade de estoque do Produto (KG para KG/SACO; L para L,
 *    D-PROD-162); nenhuma conversão aqui. O planejador já entrega a quantidade
 *    com 4 casas (ROUND_HALF_UP UMA vez) e o mesmo número vale para item, lote,
 *    movimento, `estoque_atual`, consumo e estorno. Os parâmetros e variáveis
 *    `quantidadeKg`/`custoUnitarioKg`/`kg` mantêm o nome (contrato da P3), mas
 *    estão na unidade de estoque do Produto; o rótulo do movimento
 *    (`unidade_medida`) vem do Produto: `'L'` para Produto em L, `'KG'` para o
 *    resto (inclusive SACO, que guarda kg);
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
 * transferência entre locais também passam por aqui (`aplicarSaida` com
 * `ORIGEM_SUPLEMENTACAO` e `aplicarTransferenciaEstoque`); não existe mais
 * FIFO próprio em Number (D-PROD-256: o valor de toda saída é o CUSTO MÉDIO do poço produto × local; a ordem FIFO das camadas é só contabilidade de lote). Toda primitiva valida TUDO antes da primeira escrita,
 * e toda recusa desfaz a transação inteira de quem chama.
 *
 * D-PROD-268 — cancelamentos do Mapa Geral: `estornarSaidaSuplementacao` (baixa do cocho) e
 * `estornarTransferenciaEstoque` (par S/R entre locais), ambos estorno EXATO pelo valor gravado e só
 * quando o movimento é o último do produto no(s) depósito(s) (`movimentoPosterior.js`).
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
import { buscarMovimentoPosterior } from './movimentoPosterior.js';

export const ENTIDADE_MOVIMENTO = 'MovimentacaoEstoque';
export const ORIGEM_SISTEMA = 'operacao_financeira';
/** D-PROD-159: origem do movimento do abastecimento de bem patrimonial (nunca lançamento financeiro). 24 chars (VarChar(32)). */
export const ORIGEM_ABASTECIMENTO = 'abastecimento_patrimonio';
/** D-PROD-161: origem da baixa de suplementação (cocho). Mesmo valor gravado antes da P0. 13 chars. */
export const ORIGEM_SUPLEMENTACAO = 'suplementacao';
/** D-PROD-161: origem da transferência entre locais (depósito). Mesmo valor gravado antes da P0. */
export const ORIGEM_DEPOSITO = 'deposito';
/**
 * D-PROD-177 (Estoque P1-02, contrato §6.2 item 1) — origem da ENTRADA DE
 * ESTOQUE documentada (entrada manual legitimada). 15 chars (VarChar(32)).
 * SEM ESCRITOR EXPOSTO até a P1-05a: nenhum chamador de produção usa esta
 * origem nesta PR; a reconciliação (`ORIGENS_PROTOCOLO`, CTE do estorno) entra
 * junto com as tabelas `EntradaEstoque*`, no mesmo slice da P1-05a.
 */
export const ORIGEM_ENTRADA_ESTOQUE = 'entrada_estoque';
/**
 * D-PROD-273: a origem da entrada documentada só é citada aqui (D-PROD-257); quem precisa reconhecê-la
 * (ex.: a guarda da prévia da exclusão) pergunta ao motor.
 * @param {unknown} sistema
 */
export const ehOrigemEntradaDocumentada = (sistema) => sistema === ORIGEM_ENTRADA_ESTOQUE;
/**
 * D-PROD-193 (Fatia D do apontamento), re-ancorada na D-PROD-202 (Fatia 3 do
 * Lançamento de Atividades) — origem da SAÍDA pela linha de PRODUTO do
 * apontamento da atividade (`AtividadeApontamentoProduto`) e do estorno dela.
 * 21 chars (VarChar(32)). Nunca a do abastecimento nem a do financeiro
 * (proveniência falsa).
 */
export const ORIGEM_APONTAMENTO = 'apontamento_atividade';
/**
 * D-PROD-264 — origem da SAÍDA MANUAL documentada (Estoque → Novo movimento → Saída) e do estorno dela
 * (exclusão). 13 chars (VarChar(32)). Só este arquivo cita o rótulo: o módulo `estoqueSaidas` usa
 * `aplicarSaidaDocumentada`/`estornarSaidaDocumentada`. As fatias ficam em `lotes_consumidos` (sem tabela de FK).
 */
export const ORIGEM_SAIDA_ESTOQUE = 'saida_estoque';
/** D-PROD-256: marca `modo_saida_fifo` (nome legado da coluna) das saídas valorizadas a custo médio; as antigas ficam 'FIFO'. */
export const MODO_CUSTO_MEDIO = 'CUSTO_MEDIO';
const ORIGENS_SISTEMA = new Set([ORIGEM_SISTEMA, ORIGEM_ABASTECIMENTO, ORIGEM_SUPLEMENTACAO, ORIGEM_DEPOSITO, ORIGEM_ENTRADA_ESTOQUE, ORIGEM_APONTAMENTO, ORIGEM_SAIDA_ESTOQUE]);
/** `exclusao_somente_em` por origem. As 2 origens da P3/P1 não mudam; as 2 da P0 mantêm os valores gravados antes da P0. */
const EXCLUSAO_SOMENTE_EM = Object.freeze({
  [ORIGEM_SISTEMA]: ORIGEM_SISTEMA,
  [ORIGEM_ABASTECIMENTO]: ORIGEM_ABASTECIMENTO,
  [ORIGEM_SUPLEMENTACAO]: 'cocho',
  [ORIGEM_DEPOSITO]: 'deposito',
  [ORIGEM_ENTRADA_ESTOQUE]: ORIGEM_ENTRADA_ESTOQUE,
  [ORIGEM_APONTAMENTO]: ORIGEM_APONTAMENTO,
  [ORIGEM_SAIDA_ESTOQUE]: ORIGEM_SAIDA_ESTOQUE,
});
/** D-PROD-177 (§6.2 item 3): `tipo_detalhado` da entrada documentada = `entrada_<motivo>`; nunca `compra_financeiro`. */
const TIPO_ENTRADA_ESTOQUE = /^entrada_[a-z0-9_]{1,40}$/;
/** Rótulos padrão da compra P3 (inalterados). */
const TIPO_COMPRA_FINANCEIRO = 'compra_financeiro';
const MOTIVO_ENTRADA_FINANCEIRO = 'Entrada por lançamento financeiro confirmado';
/** D-PROD-177 (§6.2 item 6): `tipo_detalhado` dos estornos da entrada documentada (lista fechada). */
export const ESTORNO_ENTRADA_REVISAO = 'estorno_entrada_revisao';
export const ESTORNO_ENTRADA_EXCLUSAO = 'estorno_entrada_exclusao';
const ESTORNOS_ENTRADA_ESTOQUE = Object.freeze([ESTORNO_ENTRADA_REVISAO, ESTORNO_ENTRADA_EXCLUSAO]);
/** D-PROD-177 (§6.2 item 6): efeito físico a desfazer no estorno em lote. */
export const EFEITO_ENTRADA = 'ENTRADA';
export const EFEITO_SAIDA = 'SAIDA';

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
    // D-PROD-162: o rótulo vem do Produto (quem chama passa `unidade_principal_estoque`); KG e SACO continuam 'KG'.
    unidade_medida: a.produto?.unidade_principal_estoque === 'L' ? 'L' : 'KG',
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

/** Texto obrigatório de rótulo (fail-closed): string não vazia. */
const textoInformado = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * D-PROD-177 (§6.2 itens 1–3) — `tipo_detalhado` e motivo da entrada. Sem
 * `sistema`/`tipoDetalhado`/`motivo`, devolve os rótulos de antes
 * (`compra_financeiro`, 'Entrada por lançamento financeiro confirmado').
 * Combinação proibida → erro de programação (500), antes de qualquer leitura.
 * @param {{ origem?: { sistema?: string, tipoDetalhado?: string, motivo?: string } }} a
 * @returns {{ tipoDetalhado: string, motivo: string }}
 */
const rotulosDaEntrada = (a) => {
  const sistema = origemSistemaDe(a);
  const informado = a.origem?.tipoDetalhado;
  const motivo = a.origem?.motivo;
  if (motivo !== undefined && !textoInformado(motivo)) throw new Error('aplicarEntradaEstoque: origem.motivo, quando informado, é texto não vazio');
  if (sistema === ORIGEM_ENTRADA_ESTOQUE) {
    if (typeof informado !== 'string' || !TIPO_ENTRADA_ESTOQUE.test(informado)) {
      throw new Error(`aplicarEntradaEstoque: a origem ${ORIGEM_ENTRADA_ESTOQUE} exige tipoDetalhado entrada_<motivo>`);
    }
    if (!textoInformado(motivo)) throw new Error(`aplicarEntradaEstoque: a origem ${ORIGEM_ENTRADA_ESTOQUE} exige origem.motivo`);
    return { tipoDetalhado: informado, motivo: /** @type {string} */ (motivo) };
  }
  const tipoDetalhado = informado ?? TIPO_COMPRA_FINANCEIRO;
  if (tipoDetalhado === TIPO_COMPRA_FINANCEIRO && sistema !== ORIGEM_SISTEMA) {
    throw new Error(`aplicarEntradaEstoque: tipoDetalhado ${TIPO_COMPRA_FINANCEIRO} só com a origem ${ORIGEM_SISTEMA}`);
  }
  if (typeof tipoDetalhado === 'string' && TIPO_ENTRADA_ESTOQUE.test(tipoDetalhado)) {
    throw new Error(`aplicarEntradaEstoque: tipoDetalhado entrada_<motivo> só com a origem ${ORIGEM_ENTRADA_ESTOQUE}`);
  }
  return { tipoDetalhado, motivo: motivo ?? MOTIVO_ENTRADA_FINANCEIRO };
};

/**
 * D-PROD-177 (§6.2 item 4) — procedência do LOTE informada por quem chama:
 * só as chaves de `CAMPOS_PROCEDENCIA_LOTE`, valores string|null. Ausente
 * (`undefined`/`null`) → `{}` (nada muda). Fora disso → erro de programação (500).
 * @param {unknown} procedencia
 * @returns {Record<string, string|null>}
 */
const procedenciaDaEntrada = (procedencia) => {
  if (procedencia === undefined || procedencia === null) return {};
  if (typeof procedencia !== 'object' || Array.isArray(procedencia) || Object.getPrototypeOf(procedencia) !== Object.prototype) {
    throw new Error('aplicarEntradaEstoque: procedencia deve ser um objeto simples');
  }
  /** @type {Record<string, string|null>} */
  const saida = {};
  for (const [chave, valor] of Object.entries(procedencia)) {
    if (!CAMPOS_PROCEDENCIA_LOTE.includes(chave)) throw new Error(`aplicarEntradaEstoque: campo de procedência não permitido: ${chave}`);
    if (valor !== null && typeof valor !== 'string') throw new Error(`aplicarEntradaEstoque: procedência ${chave} deve ser texto ou nulo`);
    saida[chave] = valor;
  }
  return saida;
};

/**
 * ENTRADA (compra confirmada): lote novo + movimento 'Entrada' ligado ao lote +
 * `estoque_atual += kg`. Custo de aquisição LÍQUIDO (D-PROD-155, rodada 4):
 * `valorTotal` é o valor líquido da linha (subtotal − desconto + acréscimo do
 * cabeçalho rateados) e `custoUnitarioKg` = ROUND_HALF_UP(líquido / kg, 4);
 * o resíduo de arredondamento é decidido/mostrado pelo planejador.
 * `quantidadeKg`/`custoUnitarioKg`: na unidade de estoque do Produto (kg, ou L
 * para Produto em L — D-PROD-162).
 * D-PROD-177 (Estoque P1-02, §6.2 itens 1–5) — parâmetros ADITIVOS, com os
 * padrões de antes (a compra P3 não muda byte a byte sem eles):
 *  - `origem.sistema` (padrão `ORIGEM_SISTEMA`); com `ORIGEM_ENTRADA_ESTOQUE`,
 *    `origem.tipoDetalhado` é obrigatório e casa `entrada_<motivo>` (nunca
 *    `compra_financeiro`) e `origem.motivo` é obrigatório; `compra_financeiro`
 *    só com a origem do financeiro (fail-closed: erro de programação → 500);
 *  - `origem.motivo` (padrão: 'Entrada por lançamento financeiro confirmado');
 *  - `procedencia`: chaves SÓ de `CAMPOS_PROCEDENCIA_LOTE`, valores string|null;
 *    cada chave passada sobrepõe a procedência do LOTE derivada de
 *    documento/parceiro (o movimento continua com o parceiro);
 *  - custo ou valor < 0 → 422 `OPERACAO_VALORES_INVALIDOS` (`custo_negativo` /
 *    `valor_negativo`) ANTES de qualquer leitura; zero é permitido.
 * @param {any} tx
 * @param {{auth: any, requestId?: string}} ctx
 * @param {{ empresaId: string, produto: any, local: {id: string, nome: string}, quantidadeKg: any, custoUnitarioKg: any,
 *   valorTotal: any, dia: string, documento?: {numero?: string|null, data?: string|null}, parceiro?: {id?: string|null, nome?: string|null},
 *   origem: {operacaoId: string, tipoDetalhado?: string, sistema?: string, motivo?: string}, numeroMovimento?: string|number, contextoErro?: Record<string, unknown>,
 *   procedencia?: Partial<Record<'fornecedor_id'|'fornecedor_nome'|'numero_documento', string|null>> }} a
 */
export const aplicarEntradaEstoque = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  exigirProdutoDaEmpresa(a);
  const rotulos = rotulosDaEntrada(a);
  const procedenciaInformada = procedenciaDaEntrada(a.procedencia);
  const kg = dec(a.quantidadeKg);
  const custoKg = dec(a.custoUnitarioKg);
  const valorTotal = dec(a.valorTotal);
  const extra = { produto_id: a.produto.id, ...(a.contextoErro ?? {}) };
  // D-PROD-177 (M4): custo negativo quebraria as baixas futuras (CHECK custo_unitario >= 0 nas tabelas de consumo).
  if (custoKg.lt(0)) {
    throw new AppError('OPERACAO_VALORES_INVALIDOS', 'custo unitário não pode ser negativo; nada foi gravado', {
      details: comCampo({ ...extra, reason: 'custo_negativo', field: 'custo_unitario', custo_unitario: custoKg.toFixed(CASAS_CUSTO) }),
    });
  }
  if (valorTotal.lt(0)) {
    throw new AppError('OPERACAO_VALORES_INVALIDOS', 'valor total não pode ser negativo; nada foi gravado', {
      details: comCampo({ ...extra, reason: 'valor_negativo', field: 'valor_total', valor_total: valorTotal.toFixed(CASAS_CUSTO) }),
    });
  }
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
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
      tipo_detalhado: rotulos.tipoDetalhado,
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: paraBanco(custoKg, CASAS_CUSTO),
      valor_total: paraBanco(valorTotal, CASAS_CUSTO),
      local_estoque_destino: a.local.id,
      local_destino: a.local.nome ?? null,
      fornecedor_id: a.parceiro?.id ?? null,
      fornecedor_nome: a.parceiro?.nome ?? null,
      motivo_movimentacao: rotulos.motivo,
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
    procedencia: { numero_documento: a.documento?.numero ?? null, fornecedor_id: a.parceiro?.id ?? null, fornecedor_nome: a.parceiro?.nome ?? null, ...procedenciaInformada },
    movimentoEntradaId: movimento.id,
  });
  const estoqueDepois = await incrementarEstoqueAtual(tx, cli, a.produto.id, kg);
  return { lote, movimento, estoque_atual: estoqueDepois };
};

/**
 * D-PROD-256 — simulação PURA de saída a CUSTO MÉDIO PONDERADO (prévia e
 * confirmação usam a mesma regra). O poço é o produto × local: quantidade
 * Q = Σ disponível, valor V = Σ(disponível × custo da camada). O custo médio é
 * V ÷ Q arredondado UMA vez em `CASAS_CUSTO`; a saída vale `kg × médio` e TODA
 * fatia leva esse médio. As camadas continuam sendo baixadas na ordem de
 * `ordenarFifo` só como contabilidade de lote (rastreio, `lote_id` do estorno
 * de saídas antigas): o valor da saída NÃO depende da camada consumida.
 * `custoMedioDepois` = (V − valor da saída) ÷ (Q − kg): é o custo que o
 * disponível restante precisa ter para o médio não "pular" (quem grava
 * reavalia as camadas restantes — `reavaliarCamadas`). Não grava nada.
 * @param {Array<{ id: string, quantidade_disponivel: any, custo_unitario: any, data_documento?: Date|null, createdAt: Date }>} lotes
 * @param {any} kg
 */
export const consumirCustoMedio = (lotes, kg) => {
  const pedido = dec(kg);
  const elegiveis = ordenarFifo(lotes.filter((l) => dec(l.quantidade_disponivel).gt(0)));
  const disponivel = somar(elegiveis.map((l) => l.quantidade_disponivel));
  const valorPoco = somar(elegiveis.map((l) => dec(l.quantidade_disponivel).times(dec(l.custo_unitario))));
  const custoMedioAntes = disponivel.gt(0) ? arredondar(valorPoco.dividedBy(disponivel), CASAS_CUSTO) : ZERO;
  /** @type {Array<{ lote_id: string, quantidade: any, custo_unitario: any, anterior: any }>} */
  const fatias = [];
  let restante = pedido;
  for (const l of elegiveis) {
    if (!restante.gt(0)) break;
    const disp = dec(l.quantidade_disponivel);
    const fatia = disp.lt(restante) ? disp : restante;
    fatias.push({ lote_id: l.id, quantidade: fatia, custo_unitario: custoMedioAntes, anterior: disp });
    restante = restante.minus(fatia);
  }
  const suficiente = !restante.gt(0);
  const valorTotal = arredondar(somar(fatias.map((f) => f.quantidade.times(custoMedioAntes))), CASAS_CUSTO);
  const valorUnitario = pedido.gt(0) ? custoMedioAntes : ZERO;
  const quantidadeRestante = suficiente ? disponivel.minus(pedido) : disponivel;
  const valorRestante = suficiente && valorPoco.gt(valorTotal) ? valorPoco.minus(valorTotal) : ZERO;
  const custoMedioDepois = quantidadeRestante.gt(0) ? arredondar(valorRestante.dividedBy(quantidadeRestante), CASAS_CUSTO) : custoMedioAntes;
  const consumido = new Map(fatias.map((f) => [f.lote_id, f.quantidade]));
  const camadasRestantes = elegiveis.filter((l) => dec(l.quantidade_disponivel).gt(consumido.get(l.id) ?? ZERO)).map((l) => l.id);
  return { suficiente, disponivel, fatias, valorTotal, valorUnitario, custoMedioAntes, custoMedioDepois, valorPoco, camadasRestantes };
};

/**
 * D-PROD-256 — reavalia o custo das camadas de um poço (produto × local) para o
 * médio vigente. Só toca em camada cujo custo muda (`updatedAt` honesto). O
 * `custo_unitario` da camada deixa de ser "custo de aquisição": é o valor
 * vigente do disponível dela no poço; o custo gravado no MOVIMENTO e nas fatias
 * continua o de quando ele aconteceu. Quem chama já travou o produto.
 * @param {any} tx @param {string} clienteId @param {string[]} ids @param {any} custo
 */
const reavaliarCamadas = async (tx, clienteId, ids, custo) => {
  if (!ids.length) return;
  const valor = paraBanco(custo, CASAS_CUSTO);
  await tx.estoqueLoteNota.updateMany({
    where: { cliente_id: clienteId, id: { in: ids }, custo_unitario: { not: valor } },
    data: { custo_unitario: valor },
  });
};

/** Valor e quantidade do poço (camadas Disponivel) de um produto num local, lidos sob a trava do produto. */
const lerPoco = async (tx, clienteId, empresaId, produtoId, localId) => {
  const camadas = await lotesFifo(tx, clienteId, empresaId, produtoId, localId);
  const quantidade = somar(camadas.map((l) => l.quantidade_disponivel));
  const valor = somar(camadas.map((l) => dec(l.quantidade_disponivel).times(dec(l.custo_unitario))));
  return { camadas, quantidade, valor };
};

/**
 * D-PROD-256 — poço (já alterado: camadas gravadas) volta ao médio
 * (`valor` ÷ `quantidade`), reavaliando TODA camada Disponivel do local.
 */
const reavaliarPoco = async (tx, clienteId, empresaId, produtoId, localId, valor, quantidade) => {
  if (!quantidade.gt(0)) return ZERO;
  const medio = arredondar(valor.gt(0) ? valor.dividedBy(quantidade) : ZERO, CASAS_CUSTO);
  const camadas = await lotesFifo(tx, clienteId, empresaId, produtoId, localId);
  await reavaliarCamadas(tx, clienteId, camadas.map((l) => l.id), medio);
  return medio;
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
 * SAÍDA a CUSTO MÉDIO PONDERADO (D-PROD-256; venda confirmada): baixa os lotes
 * Disponivel do produto + local + empresa, cria UM movimento 'Saída' valorizado
 * pelo médio do poço (nunca o preço de venda), reavalia o disponível restante
 * para o médio de depois e `estoque_atual -= kg`. Devolve as fatias para `OperacaoFinanceiraConsumoLote`
 * (ou, D-PROD-159, `AbastecimentoBemConsumoLote` com `origem.sistema = ORIGEM_ABASTECIMENTO`;
 * D-PROD-202, `AtividadeApontamentoProdutoConsumoLote` — a linha de produto do apontamento da atividade — com
 * `origem.sistema = ORIGEM_APONTAMENTO`).
 * `quantidadeKg`: na unidade de estoque do Produto (kg, ou L para Produto em L — D-PROD-162).
 * D-PROD-161: também é a baixa da suplementação (`origem.sistema = ORIGEM_SUPLEMENTACAO`),
 * com os opcionais aditivos `instante` (data_movimentacao; padrão meio-dia UTC
 * de `dia`), `procedencia` (fatias com a linha do lote) e `complemento`
 * (colunas extras da allowlist `COLUNAS_COMPLEMENTO`, calculadas sobre o plano).
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, produto: any, local: {id: string, nome: string}, quantidadeKg: any, dia?: string, instante?: Date,
 *   documento?: {numero?: string|null, data?: string|null}, parceiro?: {id?: string|null, nome?: string|null},
 *   origem: {operacaoId: string|null, tipoDetalhado?: string, sistema?: string, motivo?: string}, numeroMovimento?: string|number, contextoErro?: Record<string, unknown>,
 *   procedencia?: boolean, complemento?: (plano: { fatias: any[], valorTotal: any, valorUnitario: any, custoMedioAntes: any, custoMedioDepois: any }) => Record<string, unknown> }} a
 */
export const aplicarSaida = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  exigirProdutoDaEmpresa(a);
  const instante = a.instante ?? (a.dia ? instanteDoDia(a.dia) : null);
  if (!(instante instanceof Date) || Number.isNaN(instante.getTime())) throw new Error('aplicarSaida: dia ou instante obrigatório');
  const kg = dec(a.quantidadeKg);
  const extra = { produto_id: a.produto.id, local_estoque_id: a.local.id, ...(a.contextoErro ?? {}) };
  // D-PROD-159 (M5): kg <= 0 faria `decrement` negativo (= aumento) e > limite estouraria a coluna.
  if (!kg.gt(0)) throw quantidadeZero(extra);
  if (kg.gt(LIMITE_ESTOQUE)) throw excedeLimiteEstoque({ ...extra, quantidade_kg: kg.toFixed(CASAS_QUANTIDADE) });
  const lotes = await lotesFifo(tx, cli, a.empresaId, a.produto.id, a.local.id, { procedencia: Boolean(a.procedencia) });
  const fifo = consumirCustoMedio(lotes, kg);
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
  const colunasExtras = complementoDe(a.complemento, { fatias: publicas, valorTotal: fifo.valorTotal, valorUnitario: fifo.valorUnitario, custoMedioAntes: fifo.custoMedioAntes, custoMedioDepois: fifo.custoMedioDepois });
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
      modo_saida_fifo: MODO_CUSTO_MEDIO,
      lotes_consumidos: fifo.fatias.map(fatiaGravada),
      saldo_antes: paraBanco(saldoAntes, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoAntes.minus(kg), CASAS_QUANTIDADE),
    },
  });
  await consumirCamadas(tx, cli, fifo.fatias);
  await reavaliarCamadas(tx, cli, fifo.camadasRestantes, fifo.custoMedioDepois);
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
 * custo, a MESMA `data_documento` (a de origem; sem data, o dia UTC do
 * `createdAt` da origem — a idade FIFO dela, `COALESCE(data_documento,
 * createdAt)`; nunca o ano 2001 do `String(Date).slice` nem o dia escolhido em
 * `data_movimentacao`: R2, achado A-02) e a MESMA procedência
 * (nulo continua nulo). Grava o par pai/filho (Saída `transferencia_enviada`,
 * Entrada `transferencia_recebida`) e a linhagem em `lotes_consumidos[].lote_destino_id`
 * (JSON, sem FK). NÃO lê nem altera `estoque_atual`, nem o total da empresa.
 * Exige: produto travado (`travarProdutosEstoque`) e locais travados
 * (`exigirLocaisEstoque`); números PROVISÓRIOS (quem chama numera no fim).
 * @param {any} tx @param {{auth: any}} ctx
 * @param {{ empresaId: string, produto: any, origem: {id: string, nome: string}, destino: {id: string, nome: string},
 *   quantidadeKg: any, instante: Date, numeros: { saida: string, entrada: string },
 *   complemento?: (plano: { fatias: any[], valorTotal: any, valorUnitario: any, custoMedioAntes: any, custoMedioDepois: any }) => { observacoes?: string, custo_medio_antes?: string, custo_medio_depois?: string },
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
  const fifo = consumirCustoMedio(lotes, kg);
  if (!fifo.suficiente) {
    throw saldoLoteInsuficiente({ ...extra, disponivel: fifo.disponivel.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE) });
  }
  if (fifo.valorTotal.gt(LIMITE_ESTOQUE)) throw excedeLimiteEstoque({ ...extra, valor_total: fifo.valorTotal.toFixed(CASAS_CUSTO) });
  const saldoOrigem = await saldoNoLocal(tx, cli, a.empresaId, a.produto.id, a.origem.id);
  const pocoDestino = await lerPoco(tx, cli, a.empresaId, a.produto.id, a.destino.id);
  const saldoDestino = pocoDestino.quantidade;
  if (saldoDestino.plus(kg).gt(LIMITE_ESTOQUE)) {
    throw excedeLimiteEstoque({ ...extra, local_estoque_id: a.destino.id, saldo_destino: saldoDestino.toFixed(CASAS_QUANTIDADE), quantidade_kg: kg.toFixed(CASAS_QUANTIDADE) });
  }
  const porId = new Map(lotes.map((l) => [l.id, l]));
  const fatias = fifo.fatias.map((f) => ({ ...f, lote: porId.get(f.lote_id) }));
  const colunasExtras = complementoDe(a.complemento, {
    fatias: fatias.map((f) => fatiaPublica(f, true)), valorTotal: fifo.valorTotal, valorUnitario: fifo.valorUnitario,
    custoMedioAntes: fifo.custoMedioAntes, custoMedioDepois: fifo.custoMedioDepois,
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
      modo_saida_fifo: MODO_CUSTO_MEDIO,
      lotes_consumidos: fatias.map(fatiaGravada),
      is_registro_principal: true,
      numero_movimentacao_seq: 1,
      saldo_antes: paraBanco(saldoOrigem, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(saldoOrigem.minus(kg), CASAS_QUANTIDADE),
    },
  });
  await consumirCamadas(tx, cli, fatias);
  await reavaliarCamadas(tx, cli, fifo.camadasRestantes, fifo.custoMedioDepois);
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
  /** @type {string[]} */
  const destinos = [];
  for (const f of fatias) {
    const camada = await criarCamadaEntrada(tx, cli, {
      empresaId: a.empresaId,
      produto: a.produto,
      local: a.destino,
      kg: f.quantidade,
      custoKg: f.custo_unitario,
      // D-PROD-161 (R2, achado A-02): origem sem data (legado, import) → o dia UTC do createdAt dela, que é a
      // chave FIFO que ela tinha na origem; o dia da movimentação (livre no corpo, até 0001-01-01) reescrevia a
      // idade da camada no destino e o custo das baixas seguintes.
      dataDocumento: f.lote.data_documento ?? comoDia(f.lote.createdAt.toISOString().slice(0, 10)),
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
  // D-PROD-256: o destino entra pelo valor da saída (médio da origem) e o médio dele se recalcula.
  await reavaliarPoco(tx, cli, a.empresaId, a.produto.id, a.destino.id, pocoDestino.valor.plus(fifo.valorTotal), saldoDestino.plus(kg));
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

/**
 * D-PROD-177 (M5) — o movimento original só pode ser estornado se está
 * 'Ativa' e sem filho (`movimento_filho_id` nulo: só há UMA coluna de filho).
 * Com `vinculo`, também confere empresa e produto do original contra os do
 * estorno. Recusa antes de qualquer escrita, sem dados de outro tenant.
 * @param {{ status: string, movimento_filho_id: string|null, empresa_id?: string|null, produto_id?: string|null }} m
 * @param {{ item_ordem?: number }} base
 * @param {{ empresaId: string, produtoId: string }} [vinculo]
 * @throws 409 ESTOQUE_JA_CONSUMIDO { reason: 'original_ja_estornado'|'original_nao_ativo'|'vinculo_divergente' }
 */
const exigirOriginalEstornavel = (m, base, vinculo) => {
  if (m.movimento_filho_id || m.status === 'Estornada') {
    throw jaConsumido('o movimento de estoque deste item já foi estornado; estorno recusado (nada foi alterado)', { ...base, reason: 'original_ja_estornado' });
  }
  if (m.status !== 'Ativa') {
    throw jaConsumido('o movimento de estoque deste item não está ativo; estorno recusado (nada foi alterado)', { ...base, reason: 'original_nao_ativo' });
  }
  if (vinculo && (m.empresa_id !== vinculo.empresaId || m.produto_id !== vinculo.produtoId)) {
    throw jaConsumido('o movimento de estoque deste item não pertence a este produto e empresa; estorno recusado (nada foi alterado)', { ...base, reason: 'vinculo_divergente' });
  }
};

/**
 * D-PROD-177 (§6.2 item 8) — a camada a estornar (lida sob `FOR UPDATE`) tem
 * de ser da empresa, do produto e do local da linha. Os details só levam o
 * id do lote e a ordem do item (nada da camada divergente).
 * @throws 409 ESTOQUE_JA_CONSUMIDO { reason: 'camada_divergente', lote_id, item_ordem }
 */
const exigirCamadaDaLinha = (lote, linha, base) => {
  if (lote.empresa_id !== linha.empresaId || lote.produto_id !== linha.produtoId || lote.local_estoque_id !== linha.localId) {
    throw jaConsumido('o lote deste item não pertence ao produto, à empresa ou ao local da linha; estorno recusado (nada foi alterado)', { ...base, reason: 'camada_divergente' });
  }
};

/** D-PROD-177 (M5): o original mudou entre a leitura e a marcação (escritor fora do protocolo) → 409, tudo desfeito. */
const conflitoDoOriginal = (details) =>
  new AppError('CONCURRENCY_CONFLICT', 'o movimento original mudou durante o estorno; nada foi alterado, tente de novo com a mesma operation_id', {
    details: { field: 'itens', reason: 'original_alterado', ...details },
  });

const movimentoOriginal = async (tx, clienteId, id, base = {}, vinculo = undefined) => {
  const m = id ? await tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } }) : null;
  if (!m) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque do item não encontrado');
  exigirOriginalEstornavel(m, base, vinculo);
  return m;
};

/** D-PROD-177 (M5): CAS — só marca o original que continua 'Ativa' e sem filho; contagem ≠ 1 → 409. */
const marcarOriginalEstornado = async (tx, clienteId, original, estorno) => {
  const r = await tx.movimentacaoEstoque.updateMany({
    where: { cliente_id: clienteId, id: original.id, status: 'Ativa', movimento_filho_id: null },
    data: { status: 'Estornada', movimento_filho_id: estorno.id },
  });
  if (r.count !== 1) throw conflitoDoOriginal({ movimento_id: original.id });
};

/**
 * Estorno de ENTRADA (cancelamento de compra): exige o lote INTOCADO; zera o
 * lote (status 'Estornado'), cria 'Saída' `estorno_compra` ligada ao original
 * (pai/filho; original 'Estornada') e `estoque_atual -= kg`.
 * D-PROD-177 (M5, §6.2 item 8): o lote é lido `FOR UPDATE` (depois dos
 * produtos, que quem chama já travou; antes do original) e tem de ser da
 * empresa, do produto e do local do estorno (`camada_divergente`); o original
 * tem de estar 'Ativa', sem filho e ser da mesma empresa e produto; a marcação
 * dele é CAS (`status = 'Ativa' AND movimento_filho_id IS NULL`, contagem 1).
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
  const [lote] = /** @type {any[]} */ (a.item.estoque_lote_nota_id
    ? await tx.$queryRaw`SELECT id, empresa_id, produto_id, local_estoque_id, status, quantidade_entrada, quantidade_disponivel
        FROM "EstoqueLoteNota" WHERE cliente_id = ${cli} AND id = ${a.item.estoque_lote_nota_id} FOR UPDATE`
    : []);
  if (!lote) throw jaConsumido('o lote de entrada deste item não existe mais; cancelamento recusado (nada foi alterado)', { ...base, reason: 'lote_inexistente' });
  exigirCamadaDaLinha(lote, { empresaId: a.empresaId, produtoId: a.produto?.id, localId: a.local?.id }, base);
  const entrada = dec(lote.quantidade_entrada);
  const disponivel = dec(lote.quantidade_disponivel);
  if (lote.status !== 'Disponivel' || !disponivel.eq(entrada) || !entrada.eq(kg)) {
    throw jaConsumido('o estoque desta compra já foi consumido ou alterado; cancelamento recusado (nada foi alterado)', {
      ...base, reason: 'lote_consumido', entrada: entrada.toFixed(CASAS_QUANTIDADE), disponivel: disponivel.toFixed(CASAS_QUANTIDADE), status: lote.status,
    });
  }
  const original = await movimentoOriginal(tx, cli, a.item.movimentacao_estoque_id, { item_ordem: a.item.ordem }, { empresaId: a.empresaId, produtoId: a.produto.id });
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
 * D-PROD-268 — cinto opcional de `estornarSaida`: o original lido sob `FOR UPDATE` tem de ser exatamente o
 * movimento que quem chama provou (tipo, origem, rótulo, local de origem, quantidade = a do item e, se
 * informadas, as mesmas fatias que quem chama leu antes da trava). Sem `originalEsperado`, nada muda.
 * @param {any} original
 * @param {{ tipoMovimentacao?: string, origemSistema?: string, tipoDetalhado?: string, localOrigemId?: string, lotesConsumidos?: unknown }} esperado
 * @param {{ item_ordem?: number }} base
 * @param {any} kg
 * @throws 409 ESTOQUE_JA_CONSUMIDO { reason: 'vinculo_divergente' } | 409 CONCURRENCY_CONFLICT { reason: 'original_alterado' }
 */
const exigirOriginalComoEsperado = (original, esperado, base, kg) => {
  const diverge =
    (esperado.tipoMovimentacao !== undefined && original.tipo_movimentacao !== esperado.tipoMovimentacao)
    || (esperado.origemSistema !== undefined && original.origem_sistema !== esperado.origemSistema)
    || (esperado.tipoDetalhado !== undefined && original.tipo_detalhado !== esperado.tipoDetalhado)
    || (esperado.localOrigemId !== undefined && (original.local_estoque_origem !== esperado.localOrigemId || original.local_estoque_destino))
    || !dec(original.quantidade).eq(dec(kg));
  if (diverge) {
    throw jaConsumido('o movimento de estoque deste item não é o movimento esperado; estorno recusado (nada foi alterado)', { ...base, reason: 'vinculo_divergente' });
  }
  if (esperado.lotesConsumidos !== undefined && JSON.stringify(original.lotes_consumidos ?? null) !== JSON.stringify(esperado.lotesConsumidos ?? null)) {
    throw conflitoDoOriginal({ movimento_id: original.id });
  }
};

/**
 * Estorno de SAÍDA (cancelamento de abastecimento; venda nos testes): devolve
 * cada fatia ao SEU lote (recusa lote que não esteja 'Disponivel'/'Esgotado' —
 * ex.: 'Estornado' — e devolução acima da entrada), cria 'Entrada'
 * `estorno_venda` (ou o tipo da origem) ligada ao original e
 * `estoque_atual += kg`.
 * D-PROD-177 (M5, §6.2 item 8; R1 corretiva da P1-02): com os produtos já
 * travados por quem chama, trava as camadas das fatias (`FOR UPDATE`, em ordem
 * de id) e DEPOIS o original (`FOR UPDATE`) — a mesma ordem de
 * `estornarEmLote` —, e valida TUDO antes da primeira escrita: o original
 * 'Ativa', sem filho, da empresa e do produto do estorno
 * (`original_*`/`vinculo_divergente`); cada camada existente, da empresa, do
 * produto e do local do estorno (`camada_divergente`), em situação que
 * aceita devolução e sem passar da entrada (somando as fatias do mesmo lote).
 * As escritas seguem com CAS (lote e original).
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, item: any, consumos: Array<{estoque_lote_nota_id: string, quantidade: any}>, produto: any,
 *   local: {id: string, nome: string}, dia: string, documento?: any, parceiro?: any,
 *   origem: {operacaoId: string, sistema?: string, tipoDetalhadoEstorno?: string, motivoEstorno?: string},
 *   numeroMovimento?: string|number,
 *   originalEsperado?: { tipoMovimentacao?: string, origemSistema?: string, tipoDetalhado?: string, localOrigemId?: string, lotesConsumidos?: unknown } }} a
 *   `originalEsperado` (D-PROD-268, opcional): cinto `exigirOriginalComoEsperado` sobre o original travado.
 */
export const estornarSaida = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  const kg = dec(a.item.quantidade_estoque);
  const devolvido = somar(a.consumos.map((c) => c.quantidade));
  if (!devolvido.eq(kg)) {
    throw jaConsumido('as fatias FIFO gravadas não somam a quantidade do item; cancelamento recusado', { item_ordem: a.item.ordem, reason: 'fatias_inconsistentes' });
  }
  // Travas: camadas (em ordem de id) → original. Uma leitura para todas as camadas.
  const loteIds = unicosDe(a.consumos.map((c) => c.estoque_lote_nota_id)).sort();
  const lotes = new Map(/** @type {any[]} */ (loteIds.length
    ? await tx.$queryRaw`SELECT id, empresa_id, produto_id, local_estoque_id, status, quantidade_entrada, quantidade_disponivel
        FROM "EstoqueLoteNota" WHERE cliente_id = ${cli} AND id = ANY(${loteIds}::text[]) ORDER BY id FOR UPDATE`
    : []).map((l) => [l.id, l]));
  const [original] = /** @type {any[]} */ (a.item.movimentacao_estoque_id
    ? await tx.$queryRaw`SELECT id, status, movimento_filho_id, empresa_id, produto_id, valor_unitario, valor_total,
          tipo_movimentacao, origem_sistema, tipo_detalhado, local_estoque_origem, local_estoque_destino, quantidade, lotes_consumidos
        FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND id = ${a.item.movimentacao_estoque_id} FOR UPDATE`
    : []);
  if (!original) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque do item não encontrado');
  exigirOriginalEstornavel(original, { item_ordem: a.item.ordem }, { empresaId: a.empresaId, produtoId: a.produto.id });
  if (a.originalEsperado) exigirOriginalComoEsperado(original, a.originalEsperado, { item_ordem: a.item.ordem }, kg);
  // Validação de TODAS as fatias antes da primeira escrita (soma por lote).
  const linha = { empresaId: a.empresaId, produtoId: a.produto.id, localId: a.local.id };
  /** @type {Map<string, any>} */
  const devolverPorLote = new Map();
  for (const c of a.consumos) {
    const lote = lotes.get(c.estoque_lote_nota_id);
    const base = { item_ordem: a.item.ordem, lote_id: c.estoque_lote_nota_id };
    if (!lote) {
      throw jaConsumido('um lote desta venda não pode receber a devolução (lote estornado ou removido); cancelamento recusado', {
        ...base, reason: 'lote_indisponivel_para_devolucao', status: null,
      });
    }
    exigirCamadaDaLinha(lote, linha, base);
    if (!['Disponivel', 'Esgotado'].includes(lote.status)) {
      throw jaConsumido('um lote desta venda não pode receber a devolução (lote estornado ou removido); cancelamento recusado', {
        ...base, reason: 'lote_indisponivel_para_devolucao', status: lote.status,
      });
    }
    const disp = dec(lote.quantidade_disponivel);
    const total = (devolverPorLote.get(lote.id) ?? ZERO).plus(dec(c.quantidade));
    if (disp.plus(total).gt(dec(lote.quantidade_entrada))) {
      throw jaConsumido('a devolução ultrapassaria a entrada do lote; cancelamento recusado', {
        ...base, reason: 'devolucao_excede_entrada', entrada: dec(lote.quantidade_entrada).toFixed(CASAS_QUANTIDADE), disponivel: disp.toFixed(CASAS_QUANTIDADE),
      });
    }
    devolverPorLote.set(lote.id, total);
  }
  const estoqueAtual = await estoqueAtualDe(tx, cli, a.produto.id);
  if (estoqueAtual.plus(kg).gt(LIMITE_ESTOQUE)) {
    throw excedeLimiteEstoque({ colecao: 'itens', indice: a.item.ordem - 1, item_ordem: a.item.ordem, produto_id: a.produto.id });
  }
  const poco = await lerPoco(tx, cli, a.empresaId, a.produto.id, a.local.id);
  const saldoAntes = poco.quantidade;
  for (const id of [...devolverPorLote.keys()].sort()) {
    const lote = lotes.get(id);
    const disp = dec(lote.quantidade_disponivel);
    const r = await tx.estoqueLoteNota.updateMany({
      where: { cliente_id: cli, id, status: lote.status, quantidade_disponivel: paraBanco(disp, CASAS_QUANTIDADE) },
      data: { quantidade_disponivel: paraBanco(disp.plus(devolverPorLote.get(id)), CASAS_QUANTIDADE), status: 'Disponivel' },
    });
    if (r.count !== 1) throw conflitoDeEstoque({ lote_id: id });
  }
  // D-PROD-256: estorno EXATO — volta a quantidade e o VALOR gravado no movimento original (FIFO nas saídas
  // antigas, médio nas novas); o poço inteiro é reavaliado para o médio resultante (nunca um médio novo no lugar).
  await reavaliarPoco(tx, cli, a.empresaId, a.produto.id, a.local.id, poco.valor.plus(dec(original.valor_total)), poco.quantidade.plus(kg));
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
 * D-PROD-177 (§6.2 item 6) — efeito e rótulos do estorno em lote. Sem
 * `efeito`/`sistema`/`tipoDetalhadoEstorno`/`motivoEstorno`, devolve o de
 * antes (`direcao === 'PAGAR'` → compra). Combinação proibida → 500.
 * @param {{ direcao?: string, efeito?: string, origem?: { sistema?: string, tipoDetalhadoEstorno?: string, motivoEstorno?: string } }} a
 * @returns {{ compra: boolean, tipoDetalhado: string, motivo: string }}
 */
const rotulosDoEstornoEmLote = (a) => {
  if (a.efeito !== undefined && a.efeito !== EFEITO_ENTRADA && a.efeito !== EFEITO_SAIDA) {
    throw new Error(`estornarEmLote: efeito inválido: ${String(a.efeito)}`);
  }
  const daDirecao = a.direcao === 'PAGAR' ? EFEITO_ENTRADA : EFEITO_SAIDA;
  if (a.efeito !== undefined && a.direcao !== undefined && a.efeito !== daDirecao) {
    throw new Error(`estornarEmLote: efeito ${a.efeito} diverge da direção ${String(a.direcao)}`);
  }
  const compra = (a.efeito ?? daDirecao) === EFEITO_ENTRADA;
  const sistema = origemSistemaDe(a);
  const informado = a.origem?.tipoDetalhadoEstorno;
  const motivo = a.origem?.motivoEstorno;
  if (informado !== undefined && !textoInformado(informado)) throw new Error('estornarEmLote: tipoDetalhadoEstorno, quando informado, é texto não vazio');
  if (motivo !== undefined && !textoInformado(motivo)) throw new Error('estornarEmLote: motivoEstorno, quando informado, é texto não vazio');
  const deEntradaEstoque = typeof informado === 'string' && ESTORNOS_ENTRADA_ESTOQUE.includes(informado);
  if (sistema === ORIGEM_ENTRADA_ESTOQUE) {
    if (!compra) throw new Error(`estornarEmLote: a origem ${ORIGEM_ENTRADA_ESTOQUE} só estorna efeito ${EFEITO_ENTRADA}`);
    if (!deEntradaEstoque) throw new Error(`estornarEmLote: a origem ${ORIGEM_ENTRADA_ESTOQUE} exige tipoDetalhadoEstorno ${ESTORNOS_ENTRADA_ESTOQUE.join(' ou ')}`);
    if (motivo === undefined) throw new Error(`estornarEmLote: a origem ${ORIGEM_ENTRADA_ESTOQUE} exige motivoEstorno`);
  } else if (deEntradaEstoque) {
    throw new Error(`estornarEmLote: tipoDetalhadoEstorno ${String(informado)} só com a origem ${ORIGEM_ENTRADA_ESTOQUE}`);
  }
  return {
    compra,
    tipoDetalhado: informado ?? (compra ? 'estorno_compra' : 'estorno_venda'),
    motivo: motivo ?? (compra ? 'Estorno de compra por cancelamento do lançamento financeiro' : 'Estorno de venda por cancelamento do lançamento financeiro'),
  };
};

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
 *
 * D-PROD-177 (Estoque P1-02, §6.2 itens 6 e 8; M5) — parâmetros ADITIVOS:
 *  - `efeito`: `'ENTRADA'` (desfaz entrada: lote 'Estornado', 'Saída') ou
 *    `'SAIDA'` (devolve as fatias, 'Entrada'). Ausente → derivado de `direcao`
 *    (`PAGAR` → ENTRADA, senão SAIDA), como antes. Os dois informados e
 *    divergentes, ou efeito fora do domínio → erro de programação (500);
 *  - `origem.sistema` (padrão `ORIGEM_SISTEMA`), `origem.tipoDetalhadoEstorno`
 *    e `origem.motivoEstorno` (padrões: `estorno_compra`/`estorno_venda` e os
 *    textos de antes). Com `ORIGEM_ENTRADA_ESTOQUE`: efeito ENTRADA,
 *    `tipoDetalhadoEstorno` ∈ {`ESTORNO_ENTRADA_REVISAO`,
 *    `ESTORNO_ENTRADA_EXCLUSAO`} e `motivoEstorno` obrigatórios; esses dois
 *    tipos só com essa origem (senão 500);
 *  - formato do item aceito (o da linha do `OperacaoFinanceiraItem` e o da
 *    linha da entrada documentada futura): `{ produto_id, local_estoque_id,
 *    local_estoque_nome?, movimentacao_estoque_id, estoque_lote_nota_id
 *    (efeito ENTRADA), quantidade_estoque, ordem (1-based), consumos:
 *    Array<{ estoque_lote_nota_id, quantidade }> (efeito SAIDA) }`;
 *  - por item, ANTES de qualquer escrita: original 'Ativa' e sem filho
 *    (`original_ja_estornado`/`original_nao_ativo`), da empresa e do produto
 *    do item (`vinculo_divergente`); cada camada usada (o lote do item na
 *    ENTRADA, cada lote dos consumos na SAIDA), lida `FOR UPDATE`, da empresa,
 *    do produto e do local do item (`camada_divergente`) — todos 409
 *    `ESTOQUE_JA_CONSUMIDO`; o mesmo original em dois itens = `original_ja_estornado`
 *    no segundo (como o laço item a item);
 *  - a marcação dos originais é CAS (`status = 'Ativa' AND movimento_filho_id
 *    IS NULL`); contagem ≠ itens → 409 `CONCURRENCY_CONFLICT`, tudo desfeito.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, direcao?: string, efeito?: 'ENTRADA'|'SAIDA', itens: any[], dia: string, documento?: {numero?: string|null, data?: string|null},
 *   parceiro?: {id?: string|null, nome?: string|null}, origem: {operacaoId: string, sistema?: string, tipoDetalhadoEstorno?: string, motivoEstorno?: string},
 *   numeroMovimento: () => string|number }} a
 * @returns {Promise<string[]>} ids dos movimentos de estorno, na ordem de `a.itens`
 */
export const estornarEmLote = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  const { compra, tipoDetalhado, motivo } = rotulosDoEstornoEmLote(a);
  if (!a.itens.length) return [];
  const produtoIds = unicosDe(a.itens.map((i) => i.produto_id));
  const localIds = unicosDe(a.itens.map((i) => i.local_estoque_id));
  const originalIds = unicosDe(a.itens.map((i) => i.movimentacao_estoque_id));
  const loteIds = unicosDe(compra ? a.itens.map((i) => i.estoque_lote_nota_id) : a.itens.flatMap((i) => i.consumos.map((c) => c.estoque_lote_nota_id)));

  // 1. leituras
  const produtos = new Map((await tx.produto.findMany({ where: { cliente_id: cli, id: { in: produtoIds } } })).map((p) => [p.id, p]));
  const locais = new Map((await tx.localEstoque.findMany({ where: { cliente_id: cli, id: { in: localIds } }, select: { id: true, nome: true } })).map((l) => [l.id, l]));
  /** @type {Map<string, {id: string, empresa_id: string, produto_id: string, local_estoque_id: string|null, status: string, entrada: any, disp: any, custo: any}>} */
  const lotes = new Map();
  if (loteIds.length) {
    const lidos = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, empresa_id, produto_id, local_estoque_id, status, quantidade_entrada, quantidade_disponivel, custo_unitario
      FROM "EstoqueLoteNota" WHERE cliente_id = ${cli} AND id = ANY(${loteIds}::text[]) ORDER BY id FOR UPDATE`);
    for (const l of lidos) {
      lotes.set(l.id, { id: l.id, empresa_id: l.empresa_id, produto_id: l.produto_id, local_estoque_id: l.local_estoque_id, status: l.status, entrada: dec(l.quantidade_entrada), disp: dec(l.quantidade_disponivel), custo: dec(l.custo_unitario) });
    }
  }
  const inicial = new Map([...lotes.values()].map((l) => [l.id, { status: l.status, disp: l.disp }]));
  const originais = new Map(
    originalIds.length
      ? (/** @type {any[]} */ (await tx.$queryRaw`SELECT id, valor_unitario, valor_total, status, movimento_filho_id, empresa_id, produto_id FROM "MovimentacaoEstoque"
          WHERE cliente_id = ${cli} AND id = ANY(${originalIds}::text[]) ORDER BY id FOR UPDATE`)).map((m) => [m.id, m])
      : [],
  );
  const saldos = new Map();
  /** D-PROD-256: valor do poço (Σ disponível × custo da camada) por produto + local, corrido junto com `saldos`. */
  const valores = new Map();
  for (const g of /** @type {any[]} */ (await tx.$queryRaw`SELECT produto_id, local_estoque_id, SUM(quantidade_disponivel) AS qtd, SUM(quantidade_disponivel * custo_unitario) AS valor
      FROM "EstoqueLoteNota"
      WHERE cliente_id = ${cli} AND empresa_id = ${a.empresaId} AND produto_id = ANY(${produtoIds}::text[]) AND local_estoque_id = ANY(${localIds}::text[]) AND status = 'Disponivel'
      GROUP BY produto_id, local_estoque_id`)) {
    saldos.set(chaveSaldo(g.produto_id, g.local_estoque_id), g.qtd == null ? ZERO : dec(g.qtd));
    valores.set(chaveSaldo(g.produto_id, g.local_estoque_id), g.valor == null ? ZERO : dec(g.valor));
  }
  /** Poços cuja devolução (efeito SAIDA) exige reavaliar as camadas para o médio resultante. */
  const reavaliar = new Set();
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
  /** Originais já usados por um item anterior (o laço item a item veria o original 'Estornada'). */
  const estornados = new Set();
  const exigirOriginal = (item) => {
    const id = item.movimentacao_estoque_id;
    const m = id ? originais.get(id) : null;
    if (!m) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque do item não encontrado');
    const base = { item_ordem: item.ordem };
    if (estornados.has(m.id)) {
      throw jaConsumido('o movimento de estoque deste item já foi estornado; estorno recusado (nada foi alterado)', { ...base, reason: 'original_ja_estornado' });
    }
    // D-PROD-177 (M5): 'Ativa', sem filho, da empresa do estorno e do produto do item — antes de qualquer escrita.
    exigirOriginalEstornavel(m, base, { empresaId: a.empresaId, produtoId: item.produto_id });
    estornados.add(m.id);
    return m;
  };
  /** D-PROD-177 (§6.2 item 8): a camada lida sob FOR UPDATE é da empresa, do produto e do local do item. */
  const linhaDe = (item) => ({ empresaId: a.empresaId, produtoId: item.produto_id, localId: item.local_estoque_id });
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
      exigirCamadaDaLinha(l, linhaDe(item), base);
      if (l.status !== 'Disponivel' || !l.disp.eq(l.entrada) || !l.entrada.eq(kg)) {
        throw jaConsumido('o estoque desta compra já foi consumido ou alterado; cancelamento recusado (nada foi alterado)', {
          ...base, reason: 'lote_consumido', entrada: l.entrada.toFixed(CASAS_QUANTIDADE), disponivel: l.disp.toFixed(CASAS_QUANTIDADE), status: l.status,
        });
      }
      original = exigirOriginal(item);
      const atual = exigirEstoque(produto);
      if (atual.lt(kg)) {
        throw jaConsumido('o estoque atual do produto é menor que a compra a estornar; cancelamento recusado (nada foi alterado)', {
          ...base, reason: 'estoque_atual_insuficiente', estoque_atual: atual.toFixed(CASAS_QUANTIDADE), solicitado: kg.toFixed(CASAS_QUANTIDADE),
        });
      }
      saldoAntes = saldoDe(produto.id, local.id);
      valores.set(chaveSaldo(produto.id, local.id), (valores.get(chaveSaldo(produto.id, local.id)) ?? ZERO).minus(l.disp.times(l.custo)));
      mudarLote(l, 'Estornado', ZERO);
      estoque.set(produto.id, atual.minus(kg));
    } else {
      const devolvido = somar(item.consumos.map((c) => c.quantidade));
      if (!devolvido.eq(kg)) {
        throw jaConsumido('as fatias FIFO gravadas não somam a quantidade do item; cancelamento recusado', { item_ordem: item.ordem, reason: 'fatias_inconsistentes' });
      }
      original = exigirOriginal(item);
      const atual = exigirEstoque(produto);
      if (atual.plus(kg).gt(LIMITE_ESTOQUE)) {
        throw excedeLimiteEstoque({ colecao: 'itens', indice: item.ordem - 1, item_ordem: item.ordem, produto_id: produto.id });
      }
      saldoAntes = saldoDe(produto.id, local.id);
      for (const c of item.consumos) {
        const l = lotes.get(c.estoque_lote_nota_id);
        const base = { item_ordem: item.ordem, lote_id: c.estoque_lote_nota_id };
        if (!l) {
          throw jaConsumido('um lote desta venda não pode receber a devolução (lote estornado ou removido); cancelamento recusado', {
            ...base, reason: 'lote_indisponivel_para_devolucao', status: null,
          });
        }
        exigirCamadaDaLinha(l, linhaDe(item), base);
        if (!['Disponivel', 'Esgotado'].includes(l.status)) {
          throw jaConsumido('um lote desta venda não pode receber a devolução (lote estornado ou removido); cancelamento recusado', {
            ...base, reason: 'lote_indisponivel_para_devolucao', status: l.status,
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
      // D-PROD-256: devolve o VALOR gravado no original (estorno exato); o poço é reavaliado no fim.
      valores.set(chaveSaldo(produto.id, local.id), (valores.get(chaveSaldo(produto.id, local.id)) ?? ZERO).plus(dec(original.valor_total)));
      reavaliar.add(chaveSaldo(produto.id, local.id));
    }
    movimentos.push({
      ...camposComuns(auth, { empresaId: a.empresaId, produto, documento: a.documento, origem: a.origem }),
      numero_movimentacao: String(a.numeroMovimento()),
      tipo_movimentacao: compra ? 'Saída' : 'Entrada',
      tipo_detalhado: tipoDetalhado,
      data_movimentacao: instanteDoDia(a.dia),
      quantidade: paraBanco(kg, CASAS_QUANTIDADE),
      valor_unitario: original.valor_unitario,
      valor_total: original.valor_total,
      ...(compra
        ? { local_estoque_origem: local.id, local_origem: local.nome ?? null, fornecedor_id: a.parceiro?.id ?? null, fornecedor_nome: a.parceiro?.nome ?? null }
        : { local_estoque_destino: local.id, local_destino: local.nome ?? null, cliente_nome: a.parceiro?.nome ?? null }),
      motivo_movimentacao: motivo,
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
  // D-PROD-256: reavalia as camadas dos poços que receberam devolução (já com o disponível devolvido gravado).
  const pocosReav = [...reavaliar].filter((k) => (saldos.get(k) ?? ZERO).gt(0));
  if (pocosReav.length) {
    const medios = pocosReav.map((k) => arredondar((valores.get(k) ?? ZERO).gt(0) ? valores.get(k).dividedBy(saldos.get(k)) : ZERO, CASAS_CUSTO));
    await tx.$executeRaw`UPDATE "EstoqueLoteNota" AS l
      SET custo_unitario = v.medio::numeric, "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM unnest(${pocosReav.map((k) => k.split('\u0000')[0])}::text[], ${pocosReav.map((k) => k.split('\u0000')[1])}::text[], ${medios.map((m) => paraBanco(m, CASAS_CUSTO))}::text[]) AS v(produto_id, local_id, medio)
      WHERE l.cliente_id = ${cli} AND l.empresa_id = ${a.empresaId} AND l.produto_id = v.produto_id AND l.local_estoque_id = v.local_id
        AND l.status = 'Disponivel' AND l.quantidade_disponivel > 0 AND l.custo_unitario <> v.medio::numeric`;
  }
  const criados = await tx.movimentacaoEstoque.createManyAndReturn({ data: movimentos, select: { id: true, movimento_pai_id: true } });
  const estornoDe = new Map(criados.map((m) => [m.movimento_pai_id, m.id]));
  const ids = a.itens.map((item) => estornoDe.get(item.movimentacao_estoque_id));
  if (criados.length !== a.itens.length || ids.some((id) => !id)) throw new Error(`estornos incompletos: ${criados.length} de ${a.itens.length}`);
  const marcados = await tx.$executeRaw`UPDATE "MovimentacaoEstoque" AS m
    SET status = 'Estornada', movimento_filho_id = v.filho, "updatedAt" = (now() AT TIME ZONE 'UTC')
    FROM unnest(${a.itens.map((item) => item.movimentacao_estoque_id)}::text[], ${ids}::text[]) AS v(id, filho)
    WHERE m.cliente_id = ${cli} AND m.id = v.id AND m.status = 'Ativa' AND m.movimento_filho_id IS NULL`;
  // D-PROD-177 (M5): CAS — um original que deixou de estar 'Ativa'/sem filho desfaz tudo (409).
  if (marcados !== a.itens.length) throw conflitoDoOriginal({ originais: a.itens.length, marcados });
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

/**
 * D-PROD-161 (R2, achado A-03) — camadas nascidas de `raizes` por
 * TRANSFERÊNCIA do motor, de forma transitiva (a volta de uma camada
 * transferida também). A linhagem é o JSON `lotes_consumidos[].lote_id →
 * lote_destino_id` das Saídas `transferencia_enviada` (SPEC §6: sem FK); só
 * conta a camada que existe no tenant, no mesmo produto e empresa da saída e
 * ligada ao filho dela (`movimentacao_entrada_id = movimento_filho_id`): um
 * JSON forjado não alcança lote de fora. Uma leitura das saídas de
 * transferência dos produtos das raízes, que quem chama já travou (nenhuma
 * transferência desses produtos corre ao mesmo tempo).
 * @param {any} tx @param {string} cli @param {string[]} raizes
 * @returns {Promise<string[]>} ids das camadas derivadas (sem as raízes), em ordem de id
 */
const camadasDerivadasPorTransferencia = async (tx, cli, raizes) => {
  const doc = await tx.estoqueLoteNota.findMany({ where: { cliente_id: cli, id: { in: raizes } }, select: { produto_id: true, empresa_id: true } });
  const produtos = unicosDe(doc.map((l) => l.produto_id));
  const empresas = unicosDe(doc.map((l) => l.empresa_id));
  if (!produtos.length || !empresas.length) return [];
  const linhas = /** @type {Array<{ id: string }>} */ (await tx.$queryRaw`WITH RECURSIVE tr AS MATERIALIZED (
      SELECT e.elem ->> 'lote_id' AS origem, d.id AS destino
      FROM "MovimentacaoEstoque" m
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.lotes_consumidos::jsonb) = 'array' THEN m.lotes_consumidos::jsonb ELSE '[]'::jsonb END) AS e(elem)
      JOIN "EstoqueLoteNota" d ON d.cliente_id = ${cli} AND d.id = e.elem ->> 'lote_destino_id'
        AND d.produto_id = m.produto_id AND d.empresa_id = m.empresa_id AND d.movimentacao_entrada_id = m.movimento_filho_id
      WHERE m.cliente_id = ${cli} AND m.produto_id = ANY(${produtos}::text[]) AND m.empresa_id = ANY(${empresas}::text[])
        AND m.tipo_movimentacao = 'Saída' AND m.tipo_detalhado = 'transferencia_enviada' AND m.lotes_consumidos IS NOT NULL
    ), lin(id) AS (
      SELECT x FROM unnest(${raizes}::text[]) AS x
      UNION
      SELECT tr.destino FROM lin JOIN tr ON tr.origem = lin.id
    )
    SELECT id FROM lin WHERE NOT (id = ANY(${raizes}::text[])) ORDER BY id`);
  return linhas.map((l) => l.id);
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
 * D-PROD-161 (R2, achado A-03): na compra, a procedência vale também para as
 * camadas que nasceram desses lotes por TRANSFERÊNCIA do motor (que copiou a
 * procedência "exatamente"), de forma transitiva — sem isso a camada
 * transferida continuava com o fornecedor e a NF antigos, e o rateio e o
 * `[RATEIO_FIFO]` das baixas sobre ela citavam o documento errado. Mesmo
 * metadado, mesma auditoria (cada camada gravada volta na lista).
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
  const raizes = compra ? unicosDe(a.loteIds) : [];
  if (!raizes.length) return [];
  const loteIds = [...raizes, ...(await camadasDerivadasPorTransferencia(tx, cli, raizes))];
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

// ─── entrada documentada (D-PROD-257) ──────────────────────────────────────
/**
 * D-PROD-257 — as duas pontas da ENTRADA DE ESTOQUE documentada (Estoque → Entradas). O módulo
 * `estoqueEntradas` chama ESTAS funções e nunca cita a origem: o rótulo `entrada_estoque` (P7 da
 * D-PROD-177) continua só neste arquivo. Elas só fixam a origem e o efeito e delegam às primitivas
 * de sempre — nenhum cálculo de custo à parte, nenhuma escrita direta fora do motor.
 *
 * `aplicarEntradaDocumentada`: como `aplicarEntradaEstoque`, com `motivoSlug` (a-z0-9_) no lugar de
 * `origem.sistema`/`origem.tipoDetalhado` (vira `entrada_<motivoSlug>`) e `origem.motivo` obrigatório.
 * `estornarEntradaDocumentada`: como `estornarEmLote` com efeito ENTRADA, `motivoEstorno` obrigatório
 * e o tipo `estorno_entrada_exclusao`; com `revisao: true` (D-PROD-271, a edição com substituição), o tipo
 * `estorno_entrada_revisao`.
 * @param {any} tx @param {{auth: any, requestId?: string}} ctx
 * @param {{ motivoSlug: string, origem: { operacaoId: string, motivo: string } } & Record<string, any>} a
 */
export const aplicarEntradaDocumentada = (tx, ctx, a) => {
  const { motivoSlug, origem, ...resto } = a;
  return aplicarEntradaEstoque(tx, ctx, /** @type {any} */ ({
    ...resto,
    origem: { operacaoId: origem.operacaoId, sistema: ORIGEM_ENTRADA_ESTOQUE, tipoDetalhado: `entrada_${motivoSlug}`, motivo: origem.motivo },
  }));
};

/**
 * @param {any} tx @param {{auth: any}} ctx
 * @param {{ origem: { operacaoId: string, motivoEstorno: string }, revisao?: boolean } & Record<string, any>} a
 */
export const estornarEntradaDocumentada = (tx, ctx, a) => {
  const { origem, revisao, ...resto } = a;
  return estornarEmLote(tx, ctx, /** @type {any} */ ({
    ...resto,
    efeito: EFEITO_ENTRADA,
    origem: { operacaoId: origem.operacaoId, sistema: ORIGEM_ENTRADA_ESTOQUE, tipoDetalhadoEstorno: revisao === true ? ESTORNO_ENTRADA_REVISAO : ESTORNO_ENTRADA_EXCLUSAO, motivoEstorno: origem.motivoEstorno },
  }));
};

// ─── saída documentada (D-PROD-264) ────────────────────────────────────────
/** Rótulos fechados da saída manual documentada (o texto do movimento leva o nome do motivo). */
const TIPO_SAIDA_DOCUMENTADA = 'saida_manual';
const TIPO_ESTORNO_SAIDA_DOCUMENTADA = 'estorno_saida_manual';

/**
 * D-PROD-264 — as duas pontas da SAÍDA MANUAL documentada (Estoque → Novo movimento → Saída). O módulo
 * `estoqueSaidas` chama ESTAS funções e nunca cita a origem. Elas só fixam a origem e os rótulos e delegam
 * às primitivas de sempre: `aplicarSaida` (custo médio do depósito, fatias em `lotes_consumidos`) e
 * `estornarSaida` (devolve cada fatia ao seu lote e o valor exato gravado no movimento original).
 * `origem.motivo` (aplicar) e `origem.motivoEstorno` (estornar) são obrigatórios.
 * @param {any} tx @param {{auth: any}} ctx
 * @param {{ origem: { operacaoId: string, motivo: string } } & Record<string, any>} a
 */
export const aplicarSaidaDocumentada = (tx, ctx, a) => {
  const { origem, ...resto } = a;
  if (!textoInformado(origem?.motivo)) throw new Error('aplicarSaidaDocumentada: origem.motivo é obrigatório');
  return aplicarSaida(tx, ctx, /** @type {any} */ ({
    ...resto,
    origem: { operacaoId: origem.operacaoId, sistema: ORIGEM_SAIDA_ESTOQUE, tipoDetalhado: TIPO_SAIDA_DOCUMENTADA, motivo: origem.motivo },
  }));
};

/**
 * `consumos` vêm das fatias gravadas no próprio movimento original (`lotes_consumidos`).
 * @param {any} tx @param {{auth: any}} ctx
 * @param {{ origem: { operacaoId: string, motivoEstorno: string } } & Record<string, any>} a
 */
export const estornarSaidaDocumentada = (tx, ctx, a) => {
  const { origem, ...resto } = a;
  if (!textoInformado(origem?.motivoEstorno)) throw new Error('estornarSaidaDocumentada: origem.motivoEstorno é obrigatório');
  return estornarSaida(tx, ctx, /** @type {any} */ ({
    ...resto,
    origem: { operacaoId: origem.operacaoId, sistema: ORIGEM_SAIDA_ESTOQUE, tipoDetalhadoEstorno: TIPO_ESTORNO_SAIDA_DOCUMENTADA, motivoEstorno: origem.motivoEstorno },
  }));
};

// ─── estorno da suplementação do cocho (D-PROD-268) ─────────────────────────
/** Rótulos fechados da baixa de suplementação e do estorno dela. */
const TIPO_SAIDA_SUPLEMENTACAO = 'suplementacao';
export const TIPO_ESTORNO_SUPLEMENTACAO = 'estorno_suplementacao';

/**
 * D-PROD-268 — recusa do cancelamento do lançamento de cocho (o código da missão; `reason` diz qual).
 * @param {string} reason @param {Record<string, unknown>} [extra]
 */
const cochoBloqueado = (reason, extra = {}) =>
  new AppError('SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', `o lançamento de cocho não pode ser cancelado com segurança (${reason}); nada foi alterado`, {
    details: { field: 'movimentacao_estoque_id', reason, ...extra },
  });

/** Razões do estorno de saída que o cancelamento do cocho repassa com o mesmo nome. */
const RAZOES_ESTORNO_REPASSADAS = Object.freeze(['lote_indisponivel_para_devolucao', 'devolucao_excede_entrada', 'fatias_inconsistentes', 'vinculo_divergente', 'camada_divergente']);

/** Erros do `estornarSaida` → recusa do cocho (o mapeamento de `traduzirErroDoEstorno` do abastecimento). */
const traduzirEstornoDoCocho = (erro, movimentoId) => {
  const e = /** @type {any} */ (erro);
  if (!(e instanceof AppError)) return erro;
  const extra = { movimentacao_id: movimentoId, ...(e.details?.lote_id ? { lote_id: e.details.lote_id } : {}) };
  if (e.code === 'ESTOQUE_JA_CONSUMIDO') {
    if (e.details?.reason === 'original_ja_estornado' || e.details?.reason === 'original_nao_ativo') return cochoBloqueado('movimento_estornado', extra);
    return cochoBloqueado(RAZOES_ESTORNO_REPASSADAS.find((r) => r === e.details?.reason) ?? 'fatias_inconsistentes', extra);
  }
  if (e.code === 'MOVIMENTACAO_ESTOQUE_NOT_FOUND') return cochoBloqueado('saida_nao_comprovada', extra);
  if (e.code === 'OPERACAO_VALORES_INVALIDOS') return cochoBloqueado('estoque_excede_limite', extra);
  return erro;
};

/** `kg` (Decimal do banco) = `valor` (number|string|Decimal) arredondado a 4 casas; ilegível → falso. */
const mesmaQuantidade = (kg, valor) => {
  try {
    const q = new Dec(String(valor));
    return !q.isNaN() && dec(kg).eq(q.toDecimalPlaces(CASAS_QUANTIDADE, Dec.ROUND_HALF_UP));
  } catch {
    return false;
  }
};

/** Fatias gravadas legíveis (lista não vazia; cada uma com lote e quantidade > 0). */
const fatiasLegiveis = (fatias, { comDestino = false } = {}) => {
  if (!Array.isArray(fatias) || !fatias.length) return null;
  const saida = [];
  for (const f of fatias) {
    if (!f || typeof f !== 'object' || typeof f.lote_id !== 'string' || !f.lote_id) return null;
    if (comDestino && (typeof f.lote_destino_id !== 'string' || !f.lote_destino_id)) return null;
    let q;
    try {
      q = new Dec(String(f.quantidade));
    } catch {
      return null;
    }
    if (q.isNaN() || !q.gt(0)) return null;
    saida.push({ lote_id: f.lote_id, lote_destino_id: comDestino ? f.lote_destino_id : null, quantidade: q });
  }
  return saida;
};

/**
 * D-PROD-268 — ESTORNO EXATO da SAÍDA DE SUPLEMENTAÇÃO do cocho (cancelamento do lançamento). É
 * `estornarSaida` com a origem e os rótulos fixos (`ORIGEM_SUPLEMENTACAO`, Entrada `estorno_suplementacao`,
 * `motivoEstorno` obrigatório) e com os cintos do desenho, todos ANTES da primeira escrita:
 *  - (re)trava o produto (`travarProdutosEstoque` é reentrante na mesma transação);
 *  - o movimento `movimentoId` é a baixa do cocho: 'Saída' de origem `suplementacao`, `tipo_detalhado`
 *    `suplementacao`, da empresa e do produto, só com origem no `local` (e, com `vinculo`, do mesmo ponto
 *    e com a mesma quantidade); senão `saida_nao_comprovada`. Já estornado ou não ativo: `movimento_estornado`;
 *  - fatias em `lotes_consumidos` (lista não vazia, legível); senão `saida_sem_fatias` (nunca reconstrói);
 *  - regra do ÚLTIMO no depósito (D-PROD-264), descontando os pares neutros: senão
 *    `movimento_posterior_no_deposito` (`movimento_numero`);
 *  - o estorno: cada fatia volta à SUA camada por CAS ('Disponivel'), o poço é reavaliado com o valor
 *    EXATO do original (`poço.valor + M.valor_total`), nasce a Entrada `estorno_suplementacao` com
 *    `movimento_pai_id = M` e `lancamento_origem_id = origem.operacaoId`, M vira 'Estornada' com
 *    `movimento_filho_id` (CAS) e `Produto.estoque_atual += kg`.
 * Toda recusa de negócio é 409 `SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO` { field: 'movimentacao_estoque_id',
 * reason, movimentacao_id, lote_id?, movimento_numero? } (os erros de `estornarSaida` já traduzidos);
 * corrida perdida continua 409 `CONCURRENCY_CONFLICT`. Quem chama: locais FOR KEY SHARE antes
 * (`exigirLocaisEstoque`, `exigirAtivo: false`), número provisório e `numerarMovimentos` no FIM, AuditLog.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, movimentoId: string, produto: any, local: { id: string, nome?: string|null }, dia: string,
 *   origem: { operacaoId: string, motivoEstorno: string }, numeroMovimento?: string|number,
 *   vinculo?: { pontoSuplementacaoId?: string|null, quantidadeKg?: any } }} a
 * @returns {Promise<{ movimento: any, original: { id: string, numero_movimentacao: string }, quantidade: any, valor_total: any,
 *   fatias: Array<{ lote_id: string, quantidade: any }> }>}
 */
export const estornarSaidaSuplementacao = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  if (!textoInformado(a.origem?.motivoEstorno)) throw new Error('estornarSaidaSuplementacao: origem.motivoEstorno é obrigatório');
  if (typeof a.dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.dia)) throw new Error('estornarSaidaSuplementacao: dia AAAA-MM-DD obrigatório');
  exigirProdutoDaEmpresa(a);
  if (!a.local?.id) throw new Error('estornarSaidaSuplementacao: local obrigatório');
  await travarProdutosEstoque(tx, cli, a.empresaId, [a.produto.id]);
  const [m] = /** @type {any[]} */ (a.movimentoId
    ? await tx.$queryRaw`SELECT id, empresa_id, produto_id, tipo_movimentacao, origem_sistema, tipo_detalhado, status, movimento_filho_id,
          local_estoque_origem, local_estoque_destino, ponto_suplementacao_id, quantidade, valor_total, lotes_consumidos, numero_movimentacao, "createdAt"
        FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND id = ${a.movimentoId}`
    : []);
  const extra = { movimentacao_id: a.movimentoId ?? null };
  if (!m) throw cochoBloqueado('saida_nao_comprovada', extra);
  const kg = dec(m.quantidade);
  const naoComprovada =
    m.empresa_id !== a.empresaId || m.produto_id !== a.produto.id || m.tipo_movimentacao !== 'Saída' || m.origem_sistema !== ORIGEM_SUPLEMENTACAO
    || m.tipo_detalhado !== TIPO_SAIDA_SUPLEMENTACAO || m.local_estoque_origem !== a.local.id || m.local_estoque_destino
    || (a.vinculo?.pontoSuplementacaoId !== undefined && (m.ponto_suplementacao_id ?? null) !== (a.vinculo.pontoSuplementacaoId ?? null))
    || (a.vinculo?.quantidadeKg !== undefined && !mesmaQuantidade(kg, a.vinculo.quantidadeKg));
  if (naoComprovada) throw cochoBloqueado('saida_nao_comprovada', extra);
  if (m.status !== 'Ativa' || m.movimento_filho_id) throw cochoBloqueado('movimento_estornado', extra);
  const fatias = fatiasLegiveis(m.lotes_consumidos);
  if (!fatias) throw cochoBloqueado('saida_sem_fatias', extra);
  const depois = await buscarMovimentoPosterior(tx, cli, {
    empresaId: a.empresaId, produtoId: a.produto.id, locais: [a.local.id], ignorarIds: [m.id],
    desde: { createdAt: m.createdAt, numero: m.numero_movimentacao }, ignorarParesNeutros: true,
  });
  if (depois) throw cochoBloqueado('movimento_posterior_no_deposito', { ...extra, movimento_numero: depois.numero_movimentacao });
  let r;
  try {
    r = await estornarSaida(tx, ctx, {
      empresaId: a.empresaId,
      item: { ordem: 1, quantidade_estoque: kg.toFixed(CASAS_QUANTIDADE), movimentacao_estoque_id: m.id },
      consumos: fatias.map((f) => ({ estoque_lote_nota_id: f.lote_id, quantidade: f.quantidade })),
      produto: a.produto,
      local: { id: a.local.id, nome: a.local.nome ?? null },
      dia: a.dia,
      origem: { operacaoId: a.origem.operacaoId, sistema: ORIGEM_SUPLEMENTACAO, tipoDetalhadoEstorno: TIPO_ESTORNO_SUPLEMENTACAO, motivoEstorno: a.origem.motivoEstorno },
      numeroMovimento: a.numeroMovimento ?? numeroMovimentoProvisorio(),
      originalEsperado: {
        tipoMovimentacao: 'Saída', origemSistema: ORIGEM_SUPLEMENTACAO, tipoDetalhado: TIPO_SAIDA_SUPLEMENTACAO, localOrigemId: a.local.id, lotesConsumidos: m.lotes_consumidos,
      },
    });
  } catch (erro) {
    throw traduzirEstornoDoCocho(erro, m.id);
  }
  return {
    movimento: r.movimento,
    original: { id: m.id, numero_movimentacao: m.numero_movimentacao },
    quantidade: kg,
    valor_total: m.valor_total === null ? ZERO : dec(m.valor_total),
    fatias: fatias.map((f) => ({ lote_id: f.lote_id, quantidade: f.quantidade })),
  };
};

// ─── estorno da transferência entre locais (D-PROD-268) ────────────────────
export const TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA = 'estorno_transferencia_recebida';
export const TIPO_ESTORNO_TRANSFERENCIA_ENVIADA = 'estorno_transferencia_enviada';

/**
 * D-PROD-268 — recusa do cancelamento da transferência (o código da missão; `reason` diz qual).
 * @param {string} reason @param {Record<string, unknown>} [extra] @param {string} [mensagem]
 */
const transferenciaBloqueada = (reason, extra = {}, mensagem = undefined) =>
  new AppError('TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', mensagem ?? `a transferência não pode ser cancelada com segurança (${reason}); nada foi alterado`, {
    details: { field: 'movimentacao_id', reason, ...extra },
  });

const mesmoDecimal = (x, y) => x !== null && x !== undefined && y !== null && y !== undefined && dec(x).eq(dec(y));

/** Par S (Saída `transferencia_enviada`) ↔ R (Entrada `transferencia_recebida`) coerente; senão `par_incoerente`. */
const exigirParCoerente = (s, r) => {
  const ok = s && r
    && s.tipo_movimentacao === 'Saída' && s.tipo_detalhado === 'transferencia_enviada'
    && r.tipo_movimentacao === 'Entrada' && r.tipo_detalhado === 'transferencia_recebida'
    && s.movimento_filho_id === r.id && r.movimento_pai_id === s.id
    && s.origem_sistema === ORIGEM_DEPOSITO && r.origem_sistema === ORIGEM_DEPOSITO
    && s.empresa_id === r.empresa_id && s.produto_id === r.produto_id
    && typeof s.local_estoque_origem === 'string' && s.local_estoque_origem && typeof s.local_estoque_destino === 'string' && s.local_estoque_destino
    && s.local_estoque_origem !== s.local_estoque_destino
    && s.local_estoque_origem === r.local_estoque_origem && s.local_estoque_destino === r.local_estoque_destino
    && mesmoDecimal(s.quantidade, r.quantidade) && mesmoDecimal(s.valor_total, r.valor_total);
  if (!ok) throw transferenciaBloqueada('par_incoerente', { movimentacao_saida_id: s?.id ?? null, movimentacao_entrada_id: r?.id ?? null });
};

/** Fatias da S com linhagem (`lote_destino_id` distintos) somando a quantidade; senão `fatias_ausentes`. */
const fatiasDaTransferencia = (s) => {
  const fatias = fatiasLegiveis(s.lotes_consumidos, { comDestino: true });
  const ok = fatias
    && new Set(fatias.map((f) => f.lote_destino_id)).size === fatias.length
    && somar(fatias.map((f) => f.quantidade)).eq(dec(s.quantidade));
  if (!ok) throw transferenciaBloqueada('fatias_ausentes', { movimentacao_saida_id: s.id }, 'transferência antiga, sem rastreio de lotes; não pode ser cancelada; nada foi alterado');
  return /** @type {Array<{ lote_id: string, lote_destino_id: string, quantidade: any }>} */ (fatias);
};

/** S e R ainda 'Ativa' e só ligadas entre si; senão `original_ja_estornado` / `original_nao_ativo`. */
const exigirParAtivo = (s, r) => {
  if (s.status === 'Estornada' || r.status === 'Estornada' || r.movimento_filho_id) {
    throw transferenciaBloqueada('original_ja_estornado', { movimentacao_saida_id: s.id }, 'a transferência já foi cancelada; nada foi alterado');
  }
  if (s.status !== 'Ativa' || r.status !== 'Ativa') throw transferenciaBloqueada('original_nao_ativo', { movimentacao_saida_id: s.id });
};

const lerMovimento = async (tx, cli, id) => (id ? tx.movimentacaoEstoque.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } } }) : null);

/**
 * D-PROD-268 — DESCOBERTA do par da transferência (sem trava), pelo id de QUALQUER perna: a Saída
 * `transferencia_enviada` (S) ou a Entrada `transferencia_recebida` (R). Recusas, nesta ordem:
 *  - inexistente, de outro tenant ou de outra empresa → 404 `MOVIMENTACAO_ESTOQUE_NOT_FOUND` (mesmo corpo);
 *  - outro tipo (inclusive os estornos) → `nao_e_transferencia`;
 *  - pai/filho cruzados, origem `deposito`, empresa, produto, locais, quantidade e valor iguais → `par_incoerente`;
 *  - fatias com linhagem (`lotes_consumidos[].lote_destino_id` distintos, Σ = quantidade) → `fatias_ausentes`;
 *  - estado: `original_ja_estornado` / `original_nao_ativo`.
 * Todas como 409 `TRANSFERENCIA_CANCELAMENTO_BLOQUEADO` { field: 'movimentacao_id', reason }. Só leitura;
 * `estornarTransferenciaEstoque` refaz tudo sob trava. Serve também para a elegibilidade e para saber o que travar.
 * @param {any} tx @param {string} clienteId do auth_context
 * @param {{ empresaId: string, movimentoId: string }} a
 * @returns {Promise<{ saida: any, entrada: any, produtoId: string, origemId: string, destinoId: string,
 *   fatias: Array<{ lote_id: string, lote_destino_id: string, quantidade: any }> }>}
 */
export const descobrirParDeTransferencia = async (tx, clienteId, a) => {
  const m = await lerMovimento(tx, clienteId, a.movimentoId);
  if (!m || m.empresa_id !== a.empresaId) throw new AppError('MOVIMENTACAO_ESTOQUE_NOT_FOUND', 'movimento de estoque não encontrado');
  let s;
  let r;
  if (m.tipo_movimentacao === 'Saída' && m.tipo_detalhado === 'transferencia_enviada') {
    s = m;
    r = await lerMovimento(tx, clienteId, m.movimento_filho_id);
  } else if (m.tipo_movimentacao === 'Entrada' && m.tipo_detalhado === 'transferencia_recebida') {
    r = m;
    s = await lerMovimento(tx, clienteId, m.movimento_pai_id);
  } else {
    throw transferenciaBloqueada('nao_e_transferencia', {}, 'o movimento não é uma transferência entre depósitos; nada foi alterado');
  }
  exigirParCoerente(s, r);
  const fatias = fatiasDaTransferencia(s);
  exigirParAtivo(s, r);
  return { saida: s, entrada: r, produtoId: s.produto_id, origemId: s.local_estoque_origem, destinoId: s.local_estoque_destino, fatias };
};

/** Lote que já tem consumo por FK (financeiro, abastecimento, apontamento) — a tabela do apontamento pode faltar. */
const camadaComConsumoFk = async (tx, cli, ids) => {
  if (!ids.length) return null;
  const [base] = /** @type {any[]} */ (await tx.$queryRaw`SELECT lote_id FROM (
      SELECT estoque_lote_nota_id AS lote_id FROM "OperacaoFinanceiraConsumoLote" WHERE cliente_id = ${cli} AND estoque_lote_nota_id = ANY(${ids}::text[])
      UNION ALL
      SELECT estoque_lote_nota_id FROM "AbastecimentoBemConsumoLote" WHERE cliente_id = ${cli} AND estoque_lote_nota_id = ANY(${ids}::text[])
    ) u ORDER BY lote_id LIMIT 1`);
  if (base) return base.lote_id;
  const [cat] = /** @type {any[]} */ (await tx.$queryRaw`SELECT to_regclass('public."AtividadeApontamentoProdutoConsumoLote"') IS NOT NULL AS existe`);
  if (!cat?.existe) return null;
  const [apo] = /** @type {any[]} */ (await tx.$queryRaw`SELECT estoque_lote_nota_id AS lote_id FROM "AtividadeApontamentoProdutoConsumoLote"
    WHERE cliente_id = ${cli} AND estoque_lote_nota_id = ANY(${ids}::text[]) ORDER BY 1 LIMIT 1`);
  return apo ? apo.lote_id : null;
};

const medioDoPoco = (poco) => (poco.quantidade.gt(0) ? arredondar(poco.valor.dividedBy(poco.quantidade), CASAS_CUSTO) : ZERO);

/**
 * D-PROD-268 — ESTORNO EXATO da TRANSFERÊNCIA entre locais (par S → R). Desfaz as duas pernas com o
 * valor GRAVADO (D-PROD-256), sem recalcular nada do passado e sem tocar em `Produto.estoque_atual`
 * (o total da empresa não muda: I1 continua fechado). Pelo id de qualquer perna.
 *
 * Travas (ordem canônica): `LocalEstoque` FOR KEY SHARE (`exigirLocaisEstoque`) → produto
 * (`travarProdutosEstoque`, reentrante) → camadas FOR UPDATE (ordem de id) → S e R FOR UPDATE.
 * Validação COMPLETA antes da primeira escrita (cintos do desenho):
 *  - descoberta (`descobrirParDeTransferencia`) refeita sob a trava do produto e conferida com a de antes;
 *  - local de ORIGEM inativo → 422 `ESTOQUE_LOCAL_INVALIDO` { field: 'local_origem_id', reason: 'local_inativo' }
 *    (local inativo não recebe estoque; decisão 4 da D-PROD-268); o destino só perde estoque (pode estar inativo);
 *  - regra do ÚLTIMO nos DOIS depósitos, sem pares neutros (`buscarMovimentoPosterior`, ignorando S e R,
 *    desde `S.createdAt` / número de R) → `movimento_posterior` { lado: 'origem'|'destino', local_estoque_id, movimento_numero };
 *  - S e R relidos sob trava: mesmo par, mesmas fatias, ainda 'Ativa' (`original_ja_estornado`/`original_nao_ativo`);
 *  - LINHAGEM: as camadas com `movimentacao_entrada_id = R` são exatamente os `lote_destino_id`, cada uma
 *    com `quantidade_entrada` = a da fatia → senão `linhagem_divergente`;
 *  - camadas do DESTINO intocadas: da empresa, do produto e do local de destino (`camada_divergente`),
 *    'Disponivel' com disponível = entrada e sem consumo por FK (`camada_consumida`);
 *  - camadas da ORIGEM aceitam a devolução: existentes, da empresa, do produto e do local de origem
 *    (`camada_divergente`), 'Disponivel'/'Esgotado' (`lote_indisponivel_para_devolucao`), disponível + Σ ≤
 *    entrada (`devolucao_excede_entrada`);
 *  - PROVA DE SALDO: poço do destino = `R.saldo_depois` e poço da origem = `S.saldo_depois` → senão `saldo_local_divergente`;
 *  - limite: saldo da origem + kg ≤ LIMITE_ESTOQUE → senão 422 `OPERACAO_VALORES_INVALIDOS`.
 * Escritas: destino — cada camada recebida por CAS {Disponivel, disp = entrada} → {0, 'Estornado'} e o poço
 * reavaliado com `max(0, valor − S.valor_total)`; origem — cada lote por CAS {status e disp lidos} →
 * {disp + devolvido, 'Disponivel'} e o poço reavaliado com `valor + S.valor_total`; nascem E_d (Saída
 * `estorno_transferencia_recebida`, só origem = destino, fatias = camadas recebidas, pai = R) e E_o
 * (Entrada `estorno_transferencia_enviada`, só destino = origem, pai = S), com os valores de S, números
 * PROVISÓRIOS; CAS de R {Ativa, pai S, sem filho} → {Estornada, filho E_d} e de S {Ativa, filho R} →
 * {Estornada} (o filho continua R). Corrida perdida → 409 `CONCURRENCY_CONFLICT`.
 * Recusas de negócio: 409 `TRANSFERENCIA_CANCELAMENTO_BLOQUEADO` { field: 'movimentacao_id', reason, ... }.
 * Quem chama: recibo (L0) antes; `numerarMovimentos(tx, cli, [estornoDestino.id, estornoOrigem.id])` e AuditLog no FIM.
 * @param {any} tx
 * @param {{auth: any}} ctx
 * @param {{ empresaId: string, movimentoId: string, dia: string, motivo: string, operacaoId?: string|null,
 *   numeros?: { destino?: string, origem?: string } }} a
 * @returns {Promise<{ saida: any, entrada: any, estornoDestino: any, estornoOrigem: any, produto: any,
 *   origem: { id: string, nome: string }, destino: { id: string, nome: string }, quantidade: any, valor_total: any,
 *   devolvido: Array<{ lote_origem_id: string, lote_destino_id: string, quantidade: string }> }>}
 */
export const estornarTransferenciaEstoque = async (tx, ctx, a) => {
  const auth = exigirAuthContext(ctx?.auth);
  const cli = auth.clienteId;
  if (!textoInformado(a.motivo)) throw new Error('estornarTransferenciaEstoque: motivo é obrigatório');
  if (typeof a.dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.dia)) throw new Error('estornarTransferenciaEstoque: dia AAAA-MM-DD obrigatório');
  // 1. descoberta sem trava (o que travar) → locais → produto
  const antes = await descobrirParDeTransferencia(tx, cli, { empresaId: a.empresaId, movimentoId: a.movimentoId });
  const locais = await exigirLocaisEstoque(tx, cli, [
    { id: antes.origemId, field: 'local_origem_id', exigirAtivo: false },
    { id: antes.destinoId, field: 'local_destino_id', exigirAtivo: false },
  ]);
  const origem = /** @type {{ id: string, nome: string, ativo: boolean }} */ (locais.get(antes.origemId));
  const destino = /** @type {{ id: string, nome: string, ativo: boolean }} */ (locais.get(antes.destinoId));
  if (!origem.ativo) {
    throw new AppError('ESTOQUE_LOCAL_INVALIDO', 'o depósito de origem da transferência está inativo e não pode receber o estoque de volta; reative-o para cancelar; nada foi alterado', {
      details: { field: 'local_origem_id', reason: 'local_inativo' },
    });
  }
  await travarProdutosEstoque(tx, cli, a.empresaId, [antes.produtoId]);
  const produto = await tx.produto.findFirst({ where: { cliente_id: cli, empresa_id: a.empresaId, id: antes.produtoId } });
  if (!produto) throw new AppError('PRODUTO_NOT_FOUND', 'produto não encontrado nesta empresa');
  // 2. descoberta de novo, já serializada com todo escritor de estoque do produto
  const par = await descobrirParDeTransferencia(tx, cli, { empresaId: a.empresaId, movimentoId: a.movimentoId });
  if (par.saida.id !== antes.saida.id || par.entrada.id !== antes.entrada.id || par.produtoId !== antes.produtoId
    || par.origemId !== antes.origemId || par.destinoId !== antes.destinoId) {
    throw conflitoDoOriginal({ movimento_id: antes.saida.id });
  }
  const s0 = par.saida;
  const r0 = par.entrada;
  // 3. regra do último nos dois depósitos (sem pares neutros)
  const depois = await buscarMovimentoPosterior(tx, cli, {
    empresaId: a.empresaId, produtoId: produto.id, locais: [destino.id, origem.id], ignorarIds: [s0.id, r0.id],
    desde: { createdAt: s0.createdAt, numero: r0.numero_movimentacao },
  });
  if (depois) {
    const lado = depois.local_estoque_origem === destino.id || depois.local_estoque_destino === destino.id ? 'destino' : 'origem';
    throw transferenciaBloqueada('movimento_posterior', {
      lado, local_estoque_id: lado === 'destino' ? destino.id : origem.id, movimento_numero: depois.numero_movimentacao,
    }, `o produto já teve outro movimento no depósito de ${lado} (nº ${depois.numero_movimentacao}) depois desta transferência; para corrigir, lance uma transferência de volta; nada foi alterado`);
  }
  // 4. travas: camadas (ordem de id) → S e R
  const recebidas = /** @type {any[]} */ (await tx.$queryRaw`SELECT id FROM "EstoqueLoteNota" WHERE cliente_id = ${cli} AND movimentacao_entrada_id = ${r0.id}`).map((l) => l.id);
  const loteIds = unicosDe([...par.fatias.map((f) => f.lote_id), ...par.fatias.map((f) => f.lote_destino_id), ...recebidas]).sort();
  const lotes = new Map(/** @type {any[]} */ (await tx.$queryRaw`SELECT id, empresa_id, produto_id, local_estoque_id, status, quantidade_entrada, quantidade_disponivel, movimentacao_entrada_id
      FROM "EstoqueLoteNota" WHERE cliente_id = ${cli} AND id = ANY(${loteIds}::text[]) ORDER BY id FOR UPDATE`).map((l) => [l.id, l]));
  const originais = new Map(/** @type {any[]} */ (await tx.$queryRaw`SELECT * FROM "MovimentacaoEstoque"
      WHERE cliente_id = ${cli} AND id = ANY(${[s0.id, r0.id].sort()}::text[]) ORDER BY id FOR UPDATE`).map((m) => [m.id, m]));
  const s = originais.get(s0.id);
  const r = originais.get(r0.id);
  if (!s || !r) throw conflitoDoOriginal({ movimento_id: s0.id });
  exigirParCoerente(s, r);
  if (s.empresa_id !== a.empresaId || s.produto_id !== produto.id || s.local_estoque_origem !== origem.id || s.local_estoque_destino !== destino.id) {
    throw conflitoDoOriginal({ movimento_id: s.id });
  }
  if (JSON.stringify(s.lotes_consumidos ?? null) !== JSON.stringify(s0.lotes_consumidos ?? null)) throw conflitoDoOriginal({ movimento_id: s.id });
  const fatias = fatiasDaTransferencia(s);
  exigirParAtivo(s, r);
  const kg = dec(s.quantidade);
  const valorTotal = dec(s.valor_total);
  // 5. validações (nada escrito até aqui)
  const recebidasTravadas = [...lotes.values()].filter((l) => l.movimentacao_entrada_id === r.id).map((l) => l.id).sort();
  const destinosDasFatias = fatias.map((f) => f.lote_destino_id).sort();
  if (recebidasTravadas.length !== destinosDasFatias.length || recebidasTravadas.some((id, k) => id !== destinosDasFatias[k])) {
    throw transferenciaBloqueada('linhagem_divergente', { movimentacao_saida_id: s.id });
  }
  for (const f of fatias) {
    const camada = lotes.get(f.lote_destino_id);
    const base = { lote_id: f.lote_destino_id };
    if (!camada || !dec(camada.quantidade_entrada).eq(f.quantidade)) throw transferenciaBloqueada('linhagem_divergente', base);
    if (camada.empresa_id !== a.empresaId || camada.produto_id !== produto.id || camada.local_estoque_id !== destino.id) throw transferenciaBloqueada('camada_divergente', base);
    if (camada.status !== 'Disponivel' || !dec(camada.quantidade_disponivel).eq(dec(camada.quantidade_entrada))) {
      throw transferenciaBloqueada('camada_consumida', base, 'o estoque recebido nesta transferência já foi usado; não é possível cancelar; nada foi alterado');
    }
  }
  const consumida = await camadaComConsumoFk(tx, cli, destinosDasFatias);
  if (consumida) throw transferenciaBloqueada('camada_consumida', { lote_id: consumida }, 'o estoque recebido nesta transferência já foi usado; não é possível cancelar; nada foi alterado');
  /** @type {Map<string, any>} */
  const devolverPorLote = new Map();
  for (const f of fatias) {
    const lote = lotes.get(f.lote_id);
    const base = { lote_id: f.lote_id };
    if (!lote) throw transferenciaBloqueada('lote_indisponivel_para_devolucao', base);
    if (lote.empresa_id !== a.empresaId || lote.produto_id !== produto.id || lote.local_estoque_id !== origem.id) throw transferenciaBloqueada('camada_divergente', base);
    if (!['Disponivel', 'Esgotado'].includes(lote.status)) throw transferenciaBloqueada('lote_indisponivel_para_devolucao', { ...base, status: lote.status });
    const total = (devolverPorLote.get(lote.id) ?? ZERO).plus(f.quantidade);
    if (dec(lote.quantidade_disponivel).plus(total).gt(dec(lote.quantidade_entrada))) throw transferenciaBloqueada('devolucao_excede_entrada', base);
    devolverPorLote.set(lote.id, total);
  }
  const pocoD = await lerPoco(tx, cli, a.empresaId, produto.id, destino.id);
  const pocoO = await lerPoco(tx, cli, a.empresaId, produto.id, origem.id);
  if (!mesmoDecimal(pocoD.quantidade, r.saldo_depois) || !mesmoDecimal(pocoO.quantidade, s.saldo_depois)) {
    throw transferenciaBloqueada('saldo_local_divergente', {}, 'o saldo do depósito mudou fora do protocolo depois desta transferência; não é possível cancelar; nada foi alterado');
  }
  if (pocoO.quantidade.plus(kg).gt(LIMITE_ESTOQUE)) {
    throw excedeLimiteEstoque({ field: 'movimentacao_id', produto_id: produto.id, local_estoque_id: origem.id, saldo_origem: pocoO.quantidade.toFixed(CASAS_QUANTIDADE) });
  }
  // 6. escritas no destino
  for (const id of destinosDasFatias) {
    const entrada = paraBanco(dec(lotes.get(id).quantidade_entrada), CASAS_QUANTIDADE);
    const z = await tx.estoqueLoteNota.updateMany({
      where: { cliente_id: cli, id, status: 'Disponivel', quantidade_disponivel: entrada },
      data: { quantidade_disponivel: paraBanco(ZERO, CASAS_QUANTIDADE), status: 'Estornado' },
    });
    if (z.count !== 1) throw conflitoDeEstoque({ lote_id: id });
  }
  const valorD = pocoD.valor.minus(valorTotal);
  const medioDepoisD = await reavaliarPoco(tx, cli, a.empresaId, produto.id, destino.id, valorD.gt(0) ? valorD : ZERO, pocoD.quantidade.minus(kg));
  // 7. escritas na origem
  for (const id of [...devolverPorLote.keys()].sort()) {
    const lote = lotes.get(id);
    const disp = dec(lote.quantidade_disponivel);
    const u = await tx.estoqueLoteNota.updateMany({
      where: { cliente_id: cli, id, status: lote.status, quantidade_disponivel: paraBanco(disp, CASAS_QUANTIDADE) },
      data: { quantidade_disponivel: paraBanco(disp.plus(devolverPorLote.get(id)), CASAS_QUANTIDADE), status: 'Disponivel' },
    });
    if (u.count !== 1) throw conflitoDeEstoque({ lote_id: id });
  }
  const medioDepoisO = await reavaliarPoco(tx, cli, a.empresaId, produto.id, origem.id, pocoO.valor.plus(valorTotal), pocoO.quantidade.plus(kg));
  // 8. os dois movimentos de estorno (números provisórios: quem chama numera no fim)
  const motivo = `Cancelamento da transferência ${s.numero_movimentacao}: ${a.motivo.trim()}`.slice(0, 255);
  const comum = {
    ...camposComuns(auth, { empresaId: a.empresaId, produto, origem: { sistema: ORIGEM_DEPOSITO, operacaoId: a.operacaoId ?? null } }),
    data_movimentacao: instanteDoDia(a.dia),
    quantidade: paraBanco(kg, CASAS_QUANTIDADE),
    valor_unitario: s.valor_unitario,
    valor_total: s.valor_total,
    motivo_movimentacao: motivo,
    total_movimentacoes_grupo: 2,
  };
  const estornoDestino = await tx.movimentacaoEstoque.create({
    data: {
      ...comum,
      numero_movimentacao: String(a.numeros?.destino ?? numeroMovimentoProvisorio()),
      tipo_movimentacao: 'Saída',
      tipo_detalhado: TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA,
      local_estoque_origem: destino.id,
      local_origem: destino.nome ?? null,
      modo_saida_fifo: MODO_CUSTO_MEDIO,
      lotes_consumidos: fatias.map((f) => ({ lote_id: f.lote_destino_id, quantidade: f.quantidade.toFixed(CASAS_QUANTIDADE), custo_unitario: dec(s.valor_unitario ?? 0).toFixed(CASAS_CUSTO) })),
      movimento_pai_id: r.id,
      is_registro_principal: true,
      numero_movimentacao_seq: 1,
      saldo_antes: paraBanco(pocoD.quantidade, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(pocoD.quantidade.minus(kg), CASAS_QUANTIDADE),
      custo_medio_antes: paraBanco(medioDoPoco(pocoD), CASAS_CUSTO),
      custo_medio_depois: paraBanco(medioDepoisD, CASAS_CUSTO),
    },
  });
  const estornoOrigem = await tx.movimentacaoEstoque.create({
    data: {
      ...comum,
      numero_movimentacao: String(a.numeros?.origem ?? numeroMovimentoProvisorio()),
      tipo_movimentacao: 'Entrada',
      tipo_detalhado: TIPO_ESTORNO_TRANSFERENCIA_ENVIADA,
      local_estoque_destino: origem.id,
      local_destino: origem.nome ?? null,
      movimento_pai_id: s.id,
      is_registro_principal: false,
      numero_movimentacao_seq: 2,
      saldo_antes: paraBanco(pocoO.quantidade, CASAS_QUANTIDADE),
      saldo_depois: paraBanco(pocoO.quantidade.plus(kg), CASAS_QUANTIDADE),
      custo_medio_antes: paraBanco(medioDoPoco(pocoO), CASAS_CUSTO),
      custo_medio_depois: paraBanco(medioDepoisO, CASAS_CUSTO),
    },
  });
  // 9. CAS dos originais (S mantém o filho R; R ganha o filho E_d)
  const mr = await tx.movimentacaoEstoque.updateMany({
    where: { cliente_id: cli, id: r.id, status: 'Ativa', movimento_pai_id: s.id, movimento_filho_id: null },
    data: { status: 'Estornada', movimento_filho_id: estornoDestino.id },
  });
  if (mr.count !== 1) throw conflitoDoOriginal({ movimento_id: r.id });
  const ms = await tx.movimentacaoEstoque.updateMany({
    where: { cliente_id: cli, id: s.id, status: 'Ativa', movimento_filho_id: r.id },
    data: { status: 'Estornada' },
  });
  if (ms.count !== 1) throw conflitoDoOriginal({ movimento_id: s.id });
  const finais = new Map((await tx.movimentacaoEstoque.findMany({ where: { cliente_id: cli, id: { in: [s.id, r.id] } } })).map((m) => [m.id, m]));
  return {
    saida: finais.get(s.id),
    entrada: finais.get(r.id),
    estornoDestino,
    estornoOrigem,
    produto,
    origem: { id: origem.id, nome: origem.nome },
    destino: { id: destino.id, nome: destino.nome },
    quantidade: kg,
    valor_total: valorTotal,
    devolvido: fatias.map((f) => ({ lote_origem_id: f.lote_id, lote_destino_id: f.lote_destino_id, quantidade: f.quantidade.toFixed(CASAS_QUANTIDADE) })),
  };
};

/** Origens do motor que têm documento próprio (a reconciliação as inclui em `ORIGENS_PROTOCOLO`). */
export const ORIGENS_DOCUMENTADAS = Object.freeze([ORIGEM_ENTRADA_ESTOQUE, ORIGEM_SAIDA_ESTOQUE]);
