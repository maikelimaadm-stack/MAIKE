/**
 * D-PROD-155 (Gestão P3-01) — Central Única de Lançamentos GERENCIAIS.
 *
 * Um documento `OperacaoFinanceira` (PAGAR|RECEBER × COM_PRODUTOS|SEM_PRODUTOS ×
 * AVISTA|PRAZO|PARCELADO) com itens, rateio GERAL ou POR ITEM (D-PROD-156,
 * exclusivos; `rateio_escopo` NULL = GERAL), títulos e liquidações
 * MANUAIS. `QUITADO` = liquidação registrada pelo usuário, NÃO confirmação
 * bancária. Sem conciliação, OFX, DRE, plano de contas, fiscal ou câmbio.
 *
 * Regras transversais:
 *  - tenant só da sessão; `empresa_id` do corpo/query é ESCOPO, validado no
 *    banco; registro de outra empresa/tenant → 404 do recurso;
 *  - POST/PUT do rascunho executam TODA a validação estrutural (400),
 *    matemática e de referências (422) ANTES de qualquer INSERT (§8.3);
 *  - a prévia e a confirmação usam o MESMO `planejarOperacao`; a confirmação
 *    recarrega e revalida tudo sob trava e replaneja (vale a confirmação);
 *  - ordem GLOBAL de travas (§8.4): cabeçalho (FOR UPDATE/SHARE) → produtos
 *    (`travarProdutosEstoque`) → títulos (ORDER BY id FOR UPDATE) → lotes e
 *    movimentos → sequências;
 *  - comandos com efeito são idempotentes por `operation_id`
 *    (`executarComIdempotencia`); deadlock/serialização/timeout → 409
 *    `CONCURRENCY_CONFLICT`, seguro repetir com a mesma chave;
 *  - auditoria por ALLOWLIST (ids, número, situação, totais, contagens, ids de
 *    efeitos) — nunca descrição, observação, motivo, referência ou nome.
 */

import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { TELAS, exigirTela } from '../../shared/auth/autorizacaoTela.js';
import { AppError } from '../../shared/errors/AppError.js';
import { STATUS_EXCLUIDO, executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { clausulaKeysetDesc, decodificarCursor, montarEnvelopeKeyset, normalizarLimite } from '../../shared/pagination/keysetCursor.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { lerPapeis } from '../fornecedores/fornecedorDominio.js';
import { escaparCuringasLike } from '../usuarios/usuarioRepository.js';
import { exigirEmpresaDoTenant, invalido, textoDeBusca, textoDoCorpo, travarEscopo } from '../gestao/gestaoComum.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero, reservarNumeros } from '../sequencias/entidadeCodigoService.js';
import {
  ENTIDADE_MOVIMENTO, aplicarEntradaEstoque, aplicarSaidaFifo, estornarEmLote, lotesFifo, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { casasDaMoeda, metodosPermitidos, VERSAO_CONTRATO } from './financeiroCatalogo.js';
import {
  CASAS_CUSTO, CASAS_PERCENTUAL, CASAS_PRECO, CASAS_QUANTIDADE, CASAS_RESIDUO, ZERO, arredondar, casasDecimais, dec, paraBanco, texto,
} from './decimalFinanceiro.js';
import {
  ESCOPO_PADRAO, consolidarRateio, diaValido, normalizarDocumento, percentualDe, planejarOperacao, simularEfeitosEstoque, tipoNaturezaDa,
} from './operacaoFinanceiraPlano.js';

export { planejarOperacao } from './operacaoFinanceiraPlano.js';

export const ENTIDADE = 'OperacaoFinanceira';
export const TIPO_CRIAR = 'criar_operacao_financeira';
export const TIPO_CONFIRMAR = 'confirmar_operacao_financeira';
export const TIPO_CANCELAR = 'cancelar_operacao_financeira';
export const TIPO_LIQUIDAR = 'liquidar_titulo';
export const TIPO_ESTORNAR = 'estornar_liquidacao';

/** Transações (§8.4): rascunho 20 s; efeitos (confirmar/cancelar) 30 s. */
const TX_RASCUNHO = { maxWait: 10000, timeout: 20000 };
const TX_EFEITO = { maxWait: 10000, timeout: 30000 };

const USUARIO = { select: { id: true, login: true } };

// ─── erros ───────────────────────────────────────────────────────────────────
const naoEncontrado = () => new AppError('OPERACAO_FINANCEIRA_NOT_FOUND', 'lançamento não encontrado nesta empresa');
const tituloNaoEncontrado = () => new AppError('TITULO_FINANCEIRO_NOT_FOUND', 'título (parcela) não encontrado nesta empresa');
const liquidacaoNaoEncontrada = () => new AppError('LIQUIDACAO_FINANCEIRA_NOT_FOUND', 'liquidação não encontrada nesta empresa');
const statusInvalido = (status, esperado) =>
  new AppError('OPERACAO_STATUS_INVALIDO', `o lançamento está ${status}; esta ação exige ${esperado}; nada foi gravado`, { details: { status, esperado } });
const versaoConflito = (atual, informada) =>
  new AppError('OPERACAO_VERSAO_CONFLITO', 'o rascunho mudou desde a sua leitura; recarregue antes de continuar; nada foi gravado', {
    details: { versao_atual: atual, versao_informada: informada },
  });
const perfilAusente = (empresaId) =>
  new AppError('PERFIL_FINANCEIRO_NAO_CONFIGURADO', 'configure o perfil financeiro da empresa (país, moeda e idioma) antes de lançar; nada foi gravado', {
    details: { empresa_id: empresaId },
  });
const documentoDuplicado = (extra = {}) =>
  new AppError('OPERACAO_DOCUMENTO_DUPLICADO', 'já existe lançamento confirmado com este documento para o mesmo parceiro; nada foi gravado', {
    details: { field: 'documento_referencia', reason: 'documento_duplicado', ...extra },
  });
const jaEstornada = (liquidacaoId) => new AppError('LIQUIDACAO_JA_ESTORNADA', 'esta liquidação já foi estornada; nada foi gravado', { details: { liquidacao_id: liquidacaoId } });
const dataFutura = ({ hoje, fuso }, dia, field) =>
  new AppError('FINANCEIRO_DATA_FUTURA', `a data ${dia} é posterior a hoje (${hoje}) na fazenda; só fato já ocorrido entra; nada foi gravado`, {
    details: { field, reason: 'data_futura', data: dia, hoje, fuso },
  });
const valoresInvalidos = (mensagem, details) => new AppError('OPERACAO_VALORES_INVALIDOS', mensagem, { details });

// `emTransacao` (unique do banco → código de negócio; deadlock/serialização/
// timeout → CONCURRENCY_CONFLICT) vive em shared/prisma/transacaoConcorrente.js,
// compartilhado com os comandos antigos que disputam as mesmas travas.

/** Chaves ordenadas (fingerprint estável entre retentativas). */
const canonico = (v) =>
  Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico(v[k])])) : v;

// ─── datas e formatação ─────────────────────────────────────────────────────
const comoData = (dia) => new Date(`${dia}T00:00:00.000Z`);
const diaDe = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null);
const isoDe = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
const usuarioPublico = (u) => (u ? { id: u.id, login: u.login } : null);
const unicos = (lista) => [...new Set(lista.filter((v) => typeof v === 'string' && v))];

/**
 * Motivo do cancelamento/estorno: vazio ou só espaços → 400 com field E reason
 * (§6; o `textoDoCorpo` obrigatório só dá field, e o tradutor HTTP descartava).
 * @param {unknown} valor
 * @returns {string}
 */
const motivoObrigatorio = (valor) => {
  const motivo = textoDoCorpo(valor, 'motivo');
  if (!motivo) throw invalido('motivo é obrigatório', { field: 'motivo', reason: 'obrigatorio' });
  return motivo;
};

// ─── travas e leituras base ─────────────────────────────────────────────────
/**
 * Trava o cabeçalho (FOR UPDATE nos comandos de rascunho/efeito; FOR SHARE na
 * liquidação/estorno) e devolve a linha completa. Outra empresa/tenant → 404.
 */
const travarCabecalho = async (tx, clienteId, empresaId, id, modo = 'UPDATE') => {
  const linhas = /** @type {Array<{id: string, empresa_id: string}>} */ (
    modo === 'SHARE'
      ? await tx.$queryRaw`SELECT id, empresa_id FROM "OperacaoFinanceira" WHERE cliente_id = ${clienteId} AND id = ${id} FOR SHARE`
      : await tx.$queryRaw`SELECT id, empresa_id FROM "OperacaoFinanceira" WHERE cliente_id = ${clienteId} AND id = ${id} FOR UPDATE`
  );
  if (!linhas[0] || linhas[0].empresa_id !== empresaId) throw naoEncontrado();
  return tx.operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } } });
};

/** Títulos do documento travados em ordem de id (cancelar, confirmar). */
const travarTitulos = (tx, clienteId, operacaoId) =>
  tx.$queryRaw`SELECT id, numero_parcela, status, valor, valor_liquidado FROM "TituloFinanceiro"
    WHERE cliente_id = ${clienteId} AND operacao_id = ${operacaoId} ORDER BY id FOR UPDATE`;

/**
 * Número PROVISÓRIO de movimento (§8.4 item 5): único (cabe no VarChar(32) e na
 * unique `(cliente_id, numero_movimentacao)`) e nunca chega ao commit —
 * `numerarMovimentos` troca todos pelos números reservados no fim.
 */
const numeroProvisorio = () => `p-${randomUUID().replace(/-/g, '').slice(0, 30)}`;

/**
 * §8.4 item 5: a sequência ÚNICA de movimentos do tenant é reservada DEPOIS dos
 * efeitos (lotes e movimentos), no fim da transação. Os movimentos nascem com
 * número provisório e recebem aqui, na ordem dos efeitos, os números reservados
 * de uma vez. Com a reserva antes do laço, a linha da sequência ficava presa
 * durante todo ele (~6 idas ao banco por item) e todo movimento do tenant —
 * suplementação de QUALQUER produto, transferência, POST de movimento —
 * esperava a confirmação/cancelamento inteiro.
 * @param {any} tx @param {string} clienteId @param {string[]} ids movimentos, na ordem dos efeitos
 */
const numerarMovimentos = async (tx, clienteId, ids) => {
  if (!ids.length) return;
  const numeros = (await reservarNumeros(tx, { clienteId, entidade: ENTIDADE_MOVIMENTO, escopoTipo: ESCOPO_TENANT }, ids.length)).map(String);
  const n = await tx.$executeRaw`UPDATE "MovimentacaoEstoque" AS m SET numero_movimentacao = v.numero
    FROM unnest(${ids}::text[], ${numeros}::text[]) AS v(id, numero)
    WHERE m.cliente_id = ${clienteId} AND m.id = v.id`;
  if (n !== ids.length) throw new Error(`numeração de movimentos incompleta: ${n} de ${ids.length}`);
};

/** Perfil financeiro lido com FOR SHARE (a troca de moeda espera o rascunho). */
const lerPerfil = async (tx, clienteId, empresaId) => {
  const [p] = /** @type {any[]} */ (
    await tx.$queryRaw`SELECT id, empresa_id, pais, moeda, locale, versao_contrato FROM "PerfilFinanceiroEmpresa"
      WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} FOR SHARE`
  );
  if (!p) throw perfilAusente(empresaId);
  return p;
};

// ─── referências (validadas DENTRO da transação; recusa uniforme) ──────────
/** Linhas do rateio geral e de TODOS os itens (D-PROD-156): as mesmas validações de referência. */
const todasAsLinhasDeRateio = (doc) => [...doc.rateios, ...doc.itens.flatMap((i) => i.rateios ?? [])];

/** @param {any} tx @param {string} clienteId @param {string} empresaId @param {any} doc */
export const carregarReferencias = async (tx, clienteId, empresaId, doc) => {
  const linhas = todasAsLinhasDeRateio(doc);
  const natIds = unicos(linhas.map((r) => r.natureza_id));
  const ccIds = unicos(linhas.map((r) => r.centro_custo_id));
  const crIds = unicos(linhas.map((r) => r.centro_resultado_id));
  const prodIds = unicos(doc.itens.map((i) => i.produto_id));
  const locIds = unicos(doc.itens.map((i) => i.local_estoque_id));
  const w = { cliente_id: clienteId, empresa_id: empresaId };
  const parceiro = await tx.fornecedor.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id: String(doc.parceiro_id) } },
    select: { id: true, empresa_id: true, nome: true, ativo: true, tipos: true },
  });
  const naturezas = natIds.length ? await tx.naturezaFinanceira.findMany({ where: { ...w, id: { in: natIds } }, select: { id: true, nome: true, tipo: true, ativo: true } }) : [];
  const filhas = natIds.length
    ? await tx.naturezaFinanceira.findMany({ where: { ...w, pai_id: { in: natIds }, ativo: true }, select: { pai_id: true }, distinct: ['pai_id'] })
    : [];
  const ccs = ccIds.length ? await tx.centroCusto.findMany({ where: { ...w, id: { in: ccIds } }, select: { id: true, nome: true, ativo: true } }) : [];
  const crs = crIds.length ? await tx.centroResultado.findMany({ where: { ...w, id: { in: crIds } }, select: { id: true, nome: true, ativo: true } }) : [];
  const produtos = prodIds.length
    ? await tx.produto.findMany({
      where: { cliente_id: clienteId, id: { in: prodIds } },
      select: {
        id: true, empresa_id: true, nome_produto: true, ativo: true, unidade_principal_estoque: true, peso_por_saco_kg: true,
        estoque_atual: true, codigo_interno: true, codigo_barras: true, categoria: true,
      },
    })
    : [];
  const locais = locIds.length ? await tx.localEstoque.findMany({ where: { cliente_id: clienteId, id: { in: locIds } }, select: { id: true, nome: true, ativo: true } }) : [];
  return {
    parceiro,
    naturezas: new Map(naturezas.map((n) => [n.id, n])),
    sinteticas: new Set(filhas.map((f) => f.pai_id)),
    centrosCusto: new Map(ccs.map((c) => [c.id, c])),
    centrosResultado: new Map(crs.map((c) => [c.id, c])),
    produtos: new Map(produtos.map((p) => [p.id, p])),
    locais: new Map(locais.map((l) => [l.id, l])),
  };
};

/** PAGAR: fornecedor ou prestador (ou legado `tipos=[]`); RECEBER: cliente EXPLÍCITO. */
export const parceiroTemPapel = (tipos, direcao) => {
  const { papeis } = lerPapeis(tipos);
  if (direcao === 'PAGAR') return !Array.isArray(tipos) || tipos.length === 0 || papeis.includes('fornecedor') || papeis.includes('prestador_servico');
  return papeis.includes('cliente');
};

const MENSAGENS = Object.freeze({
  parceiro_nao_encontrado: 'parceiro não encontrado nesta empresa',
  parceiro_inativo: 'parceiro inativo',
  parceiro_sem_papel: 'o parceiro não tem o papel exigido (fornecedor/prestador para pagar; cliente para receber)',
  metodo_nao_permitido: 'método não permitido pelo perfil financeiro da empresa',
  produto_nao_encontrado: 'produto não encontrado nesta empresa',
  produto_inativo: 'produto inativo',
  unidade_invalida: 'unidade incompatível com o produto (SACO exige produto em SACO com peso por saco)',
  local_nao_encontrado: 'local de estoque não encontrado',
  local_inativo: 'local de estoque inativo',
  natureza_nao_encontrada: 'natureza financeira não encontrada nesta empresa',
  natureza_inativa: 'natureza financeira inativa',
  natureza_tipo_incompativel: 'natureza de tipo incompatível (pagar usa DESPESA; receber usa RECEITA)',
  natureza_sintetica: 'natureza sintética (tem filha ativa): escolha uma natureza analítica',
  centro_custo_nao_encontrado: 'centro de custo não encontrado nesta empresa',
  centro_custo_inativo: 'centro de custo inativo',
  centro_resultado_nao_encontrado: 'centro de resultado não encontrado nesta empresa',
  centro_resultado_inativo: 'centro de resultado inativo',
});

/**
 * Todas as recusas de referência do documento (a prévia mostra todas; os
 * comandos lançam a primeira). Formato de bloqueio: {code, field, reason, details}.
 */
export const problemasDeReferencia = (doc, refs, perfil) => {
  /** @type {Array<{code: string, field: string, reason: string, details: Record<string, unknown>}>} */
  const lista = [];
  const add = (field, reason, extra = {}) =>
    lista.push({ code: 'OPERACAO_REFERENCIA_INVALIDA', field, reason, details: { field, reason, ...extra } });
  const p = refs.parceiro;
  if (!p || p.empresa_id !== doc.empresa_id) add('parceiro_id', 'parceiro_nao_encontrado');
  else if (!p.ativo) add('parceiro_id', 'parceiro_inativo');
  else if (!parceiroTemPapel(p.tipos, doc.direcao)) add('parceiro_id', 'parceiro_sem_papel', { direcao: doc.direcao });
  if (doc.metodo_preferido && !metodosPermitidos(perfil).includes(doc.metodo_preferido)) {
    add('metodo_preferido', 'metodo_nao_permitido', { metodos_permitidos: [...metodosPermitidos(perfil)] });
  }
  doc.itens.forEach((it, indice) => {
    if (it.tipo_item !== 'MERCADORIA') return;
    const extra = { colecao: 'itens', indice };
    const prod = refs.produtos.get(it.produto_id);
    if (!prod || prod.empresa_id !== doc.empresa_id) add('produto_id', 'produto_nao_encontrado', extra);
    else if (!prod.ativo) add('produto_id', 'produto_inativo', extra);
    else if (it.unidade === 'SACO' && !(prod.unidade_principal_estoque === 'SACO' && prod.peso_por_saco_kg != null && dec(prod.peso_por_saco_kg).gt(0))) {
      add('unidade', 'unidade_invalida', extra);
    }
    const loc = refs.locais.get(it.local_estoque_id);
    if (!loc) add('local_estoque_id', 'local_nao_encontrado', extra);
    else if (!loc.ativo) add('local_estoque_id', 'local_inativo', extra);
  });
  const tipo = tipoNaturezaDa(doc.direcao);
  /** Mesmas recusas para a linha geral e para a linha de um item (só muda a posição em `details`). */
  const conferirLinha = (r, extra) => {
    const nat = refs.naturezas.get(r.natureza_id);
    if (!nat) add('natureza_id', 'natureza_nao_encontrada', extra);
    else if (!nat.ativo) add('natureza_id', 'natureza_inativa', extra);
    else if (nat.tipo !== tipo) add('natureza_id', 'natureza_tipo_incompativel', { ...extra, esperado: tipo });
    else if (refs.sinteticas.has(nat.id)) add('natureza_id', 'natureza_sintetica', extra);
    if (r.centro_custo_id) {
      const c = refs.centrosCusto.get(r.centro_custo_id);
      if (!c) add('centro_custo_id', 'centro_custo_nao_encontrado', extra);
      else if (!c.ativo) add('centro_custo_id', 'centro_custo_inativo', extra);
    }
    if (r.centro_resultado_id) {
      const c = refs.centrosResultado.get(r.centro_resultado_id);
      if (!c) add('centro_resultado_id', 'centro_resultado_nao_encontrado', extra);
      else if (!c.ativo) add('centro_resultado_id', 'centro_resultado_inativo', extra);
    }
  };
  doc.rateios.forEach((r, indice) => conferirLinha(r, { colecao: 'rateios', indice }));
  doc.itens.forEach((it, indice) => {
    (it.rateios ?? []).forEach((r, subindice) => conferirLinha(r, { colecao: 'itens', indice, subcolecao: 'rateios', subindice }));
  });
  return lista;
};

const exigirReferencias = (doc, refs, perfil) => {
  const [primeiro] = problemasDeReferencia(doc, refs, perfil);
  if (primeiro) throw new AppError(primeiro.code, `${MENSAGENS[/** @type {keyof typeof MENSAGENS} */ (primeiro.reason)] ?? 'referência inválida'}; nada foi gravado`, { details: primeiro.details });
};

const exigirMetodo = (perfil, metodo, field = 'metodo') => {
  if (!metodosPermitidos(perfil).includes(metodo)) {
    throw new AppError('OPERACAO_REFERENCIA_INVALIDA', `${MENSAGENS.metodo_nao_permitido}; nada foi gravado`, {
      details: { field, reason: 'metodo_nao_permitido', metodos_permitidos: [...metodosPermitidos(perfil)] },
    });
  }
};

// ─── documento ⇄ banco ──────────────────────────────────────────────────────
/** Linha de rateio gravada (geral ou por item) → linha do documento normalizado. */
const linhaDoBanco = (op, r) => ({
  ordem: r.ordem, natureza_id: r.natureza_id, centro_custo_id: r.centro_custo_id, centro_resultado_id: r.centro_resultado_id,
  valor: op.rateio_modo === 'VALOR' ? dec(r.valor) : null,
  percentual: op.rateio_modo === 'PERCENTUAL' ? dec(r.percentual) : null,
});

/**
 * Documento normalizado a partir das linhas gravadas (prévia e confirmação).
 * `rateio_escopo` NULL (documento anterior à P3-02) é GERAL; as linhas por item
 * vão para o SEU item pelo `item_id` (D-PROD-156).
 */
const documentoDoBanco = (op, itens, rateios, titulos, itemRateios = []) => ({
  empresa_id: op.empresa_id,
  direcao: op.direcao,
  conteudo: op.conteudo,
  condicao: op.condicao,
  parceiro_id: op.parceiro_id,
  data_emissao: diaDe(op.data_emissao),
  data_operacional: diaDe(op.data_operacional),
  descricao: op.descricao,
  documento_referencia: op.documento_referencia,
  metodo_preferido: op.metodo_preferido,
  valor_bruto: op.conteudo === 'SEM_PRODUTOS' ? dec(op.valor_bruto) : null,
  valor_desconto: dec(op.valor_desconto),
  valor_acrescimo: dec(op.valor_acrescimo),
  rateio_modo: op.rateio_modo,
  rateio_escopo: op.rateio_escopo ?? ESCOPO_PADRAO,
  itens: [...itens].sort((a, b) => a.ordem - b.ordem).map((i) => ({
    ordem: i.ordem, tipo_item: i.tipo_item, unidade: i.unidade, quantidade: dec(i.quantidade), valor_unitario: dec(i.valor_unitario),
    produto_id: i.produto_id, local_estoque_id: i.local_estoque_id, descricao: i.descricao,
    rateios: itemRateios.filter((r) => r.item_id === i.id).sort((a, b) => a.ordem - b.ordem).map((r) => linhaDoBanco(op, r)),
  })),
  rateios: [...rateios].sort((a, b) => a.ordem - b.ordem).map((r) => linhaDoBanco(op, r)),
  parcelas: [...titulos].sort((a, b) => a.numero_parcela - b.numero_parcela).map((t) => ({
    numero_parcela: t.numero_parcela, vencimento: diaDe(t.vencimento), valor: dec(t.valor),
  })),
});

/**
 * §8.4 no rascunho: trava os produtos dos itens (FOR KEY SHARE, ordem CRESCENTE
 * de id) ANTES da sequência de documentos do tenant (POST) e antes de apagar os
 * filhos (PUT).
 *  - a FK do item trava o Produto em KEY SHARE na ORDEM DOS ITENS, e a
 *    confirmação/comandos travam FOR UPDATE em ordem crescente: itens em ordem
 *    decrescente fechavam um ciclo (deadlock → 409). Travando antes, crescente,
 *    não há ciclo;
 *  - quem espera um produto travado por confirmar/cancelar espera AQUI, sem
 *    segurar a linha única da sequência do tenant: os outros rascunhos do
 *    tenant (até sem produtos) não entram na fila atrás dele.
 * @param {any} tx @param {string} clienteId @param {Array<{produto_id?: string|null}>} itens
 */
const travarProdutosDoRascunho = async (tx, clienteId, itens) => {
  const produtoIds = unicos(itens.map((i) => i.produto_id)).sort();
  if (produtoIds.length) {
    await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${clienteId} AND id = ANY(${produtoIds}::text[]) ORDER BY id FOR KEY SHARE`;
  }
};

/** Colunas do custo de aquisição líquido (rateio do cabeçalho por linha) para gravar. */
const colunasDoLiquido = (i) => ({
  valor_desconto_rateado: paraBanco(i.valor_desconto_rateado, 4),
  valor_acrescimo_rateado: paraBanco(i.valor_acrescimo_rateado, 4),
  valor_liquido: paraBanco(i.valor_liquido, 4),
});

/** Linha de rateio (geral ou por item) para gravar, com o retrato dos nomes. */
const linhaDeRateioParaGravar = (base, op, r, refs) => {
  const nat = refs.naturezas.get(r.natureza_id);
  return {
    ...base,
    operacao_id: op.id,
    operacao_direcao: op.direcao,
    ordem: r.ordem,
    natureza_id: r.natureza_id,
    natureza_tipo: nat?.tipo ?? tipoNaturezaDa(op.direcao),
    natureza_nome: nat?.nome ?? '',
    centro_custo_id: r.centro_custo_id ?? null,
    centro_custo_nome: r.centro_custo_id ? refs.centrosCusto.get(r.centro_custo_id)?.nome ?? null : null,
    centro_resultado_id: r.centro_resultado_id ?? null,
    centro_resultado_nome: r.centro_resultado_id ? refs.centrosResultado.get(r.centro_resultado_id)?.nome ?? null : null,
    percentual: r.percentual ? paraBanco(r.percentual, CASAS_PERCENTUAL) : null,
    valor: paraBanco(r.valor, 4),
  };
};

/**
 * Itens, rateios (geral OU por item) e títulos PREVISTO do rascunho (snapshots
 * de nomes incluídos). Produtos já travados (`travarProdutosDoRascunho`).
 * D-PROD-156: os itens voltam do INSERT com o id (`createManyAndReturn`) e a
 * linha por item vai para o item da MESMA requisição pela `ordem` do item no
 * plano — nunca por índice de outra coleção.
 */
const gravarFilhos = async (tx, clienteId, op, plano, refs) => {
  const base = { cliente_id: clienteId, empresa_id: op.empresa_id };
  /** @type {Map<number, string>} */
  const itemPorOrdem = new Map();
  if (plano.itens.length) {
    const criados = await tx.operacaoFinanceiraItem.createManyAndReturn({
      select: { id: true, ordem: true },
      data: plano.itens.map((i) => ({
        ...base,
        operacao_id: op.id,
        ordem: i.ordem,
        tipo_item: i.tipo_item,
        produto_id: i.produto_id ?? null,
        produto_nome: i.produto_id ? refs.produtos.get(i.produto_id)?.nome_produto ?? null : null,
        descricao: i.descricao ?? null,
        local_estoque_id: i.local_estoque_id ?? null,
        local_estoque_nome: i.local_estoque_id ? refs.locais.get(i.local_estoque_id)?.nome ?? null : null,
        unidade: i.unidade,
        quantidade: paraBanco(i.quantidade, CASAS_QUANTIDADE),
        fator_kg: i.fator_kg ? paraBanco(i.fator_kg, CASAS_QUANTIDADE) : null,
        quantidade_estoque: i.quantidade_estoque ? paraBanco(i.quantidade_estoque, CASAS_QUANTIDADE) : null,
        valor_unitario: paraBanco(i.valor_unitario, CASAS_PRECO),
        valor_total: paraBanco(i.valor_total, 4),
        ...colunasDoLiquido(i),
      })),
    });
    for (const c of criados) itemPorOrdem.set(c.ordem, c.id);
    if (itemPorOrdem.size !== plano.itens.length) throw new Error(`itens gravados: ${itemPorOrdem.size} de ${plano.itens.length}`);
  }
  await tx.operacaoFinanceiraRateio.createMany({ data: plano.rateios.map((r) => linhaDeRateioParaGravar(base, op, r, refs)) });
  const linhasDosItens = plano.itens.flatMap((i) =>
    i.rateios.map((r) => ({ ...linhaDeRateioParaGravar(base, op, r, refs), item_id: /** @type {string} */ (itemPorOrdem.get(i.ordem)) })));
  if (linhasDosItens.length) await tx.operacaoFinanceiraItemRateio.createMany({ data: linhasDosItens });
  await tx.tituloFinanceiro.createMany({
    data: plano.parcelas.map((p) => ({
      ...base,
      operacao_id: op.id,
      direcao: op.direcao,
      parceiro_id: op.parceiro_id,
      numero_parcela: p.numero_parcela,
      total_parcelas: p.total_parcelas,
      vencimento: comoData(p.vencimento),
      moeda: op.moeda,
      valor: paraBanco(p.valor, 4),
      valor_liquidado: '0',
      status: 'PREVISTO',
    })),
  });
};

/**
 * Apaga os filhos do rascunho (PUT recria; DELETE descarta). As linhas por
 * item (D-PROD-156) saem ANTES dos itens (FK RESTRICT): item removido no PUT
 * leva as linhas dele na mesma transação. O filtro com `empresa_id` usa o
 * índice (cliente_id, empresa_id, operacao_id) da tabela nova.
 */
const apagarFilhosDoRascunho = async (tx, clienteId, empresaId, operacaoId) => {
  const w = { cliente_id: clienteId, operacao_id: operacaoId };
  await tx.tituloFinanceiro.deleteMany({ where: w });
  await tx.operacaoFinanceiraRateio.deleteMany({ where: w });
  await tx.operacaoFinanceiraItemRateio.deleteMany({ where: { ...w, empresa_id: empresaId } });
  await tx.operacaoFinanceiraItem.deleteMany({ where: w });
};

/** Linhas por item do documento (D-PROD-156), pelo índice (cliente_id, empresa_id, operacao_id). */
const lerItemRateios = (tx, clienteId, empresaId, operacaoId) =>
  tx.operacaoFinanceiraItemRateio.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, operacao_id: operacaoId } });

/** Colunas do cabeçalho vindas do plano (POST e PUT). */
const camposDoCabecalho = (doc, plano, refs) => ({
  direcao: doc.direcao,
  conteudo: doc.conteudo,
  condicao: doc.condicao,
  parceiro_id: doc.parceiro_id,
  parceiro_nome: refs.parceiro.nome,
  descricao: doc.descricao,
  documento_referencia: doc.documento_referencia,
  data_emissao: comoData(doc.data_emissao),
  data_operacional: doc.data_operacional ? comoData(doc.data_operacional) : null,
  valor_bruto: paraBanco(plano.valor_bruto, 4),
  valor_desconto: paraBanco(plano.valor_desconto, 4),
  valor_acrescimo: paraBanco(plano.valor_acrescimo, 4),
  valor_total: paraBanco(plano.valor_total, 4),
  rateio_modo: doc.rateio_modo,
  // D-PROD-156: sempre explícito em POST/PUT (NULL só nos documentos anteriores).
  rateio_escopo: doc.rateio_escopo,
  metodo_preferido: doc.metodo_preferido,
});

// ─── auditoria por allowlist ────────────────────────────────────────────────
const auditoriaDoc = (op, extra = {}) => ({
  id: op.id,
  numero: op.numero,
  empresa_id: op.empresa_id,
  status: op.status,
  direcao: op.direcao,
  conteudo: op.conteudo,
  condicao: op.condicao,
  moeda: op.moeda,
  valor_bruto: texto(op.valor_bruto, op.moeda_casas),
  valor_desconto: texto(op.valor_desconto, op.moeda_casas),
  valor_acrescimo: texto(op.valor_acrescimo, op.moeda_casas),
  valor_total: texto(op.valor_total, op.moeda_casas),
  versao: op.versao,
  ...extra,
});
const contagens = (plano) => ({
  itens_n: plano.itens.length,
  rateio_escopo: plano.rateio_escopo,
  rateios_n: plano.rateios.length,
  rateios_itens_n: plano.itens.reduce((t, i) => t + i.rateios.length, 0),
  parcelas_n: plano.parcelas.length,
  itens_estoque_n: plano.efeitos_estoque.entradas.length + plano.efeitos_estoque.saidas.length,
});

// ─── leitura: detalhe ───────────────────────────────────────────────────────
const INCLUDE_DETALHE = Object.freeze({
  criadoPor: USUARIO,
  confirmadoPor: USUARIO,
  canceladoPor: USUARIO,
  itens: {
    orderBy: { ordem: 'asc' },
    include: { consumos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, loteEntrada: { select: { custo_unitario: true } }, rateios: { orderBy: { ordem: 'asc' } } },
  },
  rateios: { orderBy: { ordem: 'asc' } },
  titulos: {
    orderBy: { numero_parcela: 'asc' },
    include: {
      liquidacoes: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { registradoPor: USUARIO, estornos: { include: { registradoPor: USUARIO } } },
      },
    },
  },
});

/** Percentual informativo do modo VALOR (calculado na leitura, 6 casas). */
const percentualInformativo = percentualDe;

/**
 * Linha de rateio gravada (geral ou por item) no DETALHE. `base` do percentual
 * informativo do modo VALOR: `valor_total` no geral; o LÍQUIDO do item na
 * linha por item (D-PROD-156).
 */
const linhaDeRateioDetalhe = (r, base, c) => ({
  ordem: r.ordem,
  natureza_id: r.natureza_id,
  natureza_nome: r.natureza_nome,
  natureza_tipo: r.natureza_tipo,
  centro_custo_id: r.centro_custo_id ?? null,
  centro_custo_nome: r.centro_custo_nome ?? null,
  centro_resultado_id: r.centro_resultado_id ?? null,
  centro_resultado_nome: r.centro_resultado_nome ?? null,
  percentual: texto(r.percentual ?? percentualInformativo(r.valor, base), CASAS_PERCENTUAL),
  valor: texto(r.valor, c),
});

/** Grupo do resumo consolidado (D-PROD-156) para a resposta: nomes do retrato da 1ª linha do grupo. */
const grupoConsolidadoPublico = (g, nomes, c) => ({
  natureza_id: g.natureza_id,
  natureza_nome: nomes.natureza_nome ?? null,
  centro_custo_id: g.centro_custo_id,
  centro_custo_nome: g.centro_custo_id ? nomes.centro_custo_nome ?? null : null,
  centro_resultado_id: g.centro_resultado_id,
  centro_resultado_nome: g.centro_resultado_id ? nomes.centro_resultado_nome ?? null : null,
  valor: texto(g.valor, c),
  percentual: texto(g.percentual, CASAS_PERCENTUAL),
});

/**
 * Resumo consolidado do DETALHE: no GERAL é o próprio rateio do documento (as
 * mesmas linhas e percentuais); no POR_ITEM, a soma por natureza + centros das
 * linhas de todos os itens (ordem dos itens, depois das linhas), Σ = total.
 */
const consolidadoDoDetalhe = (op, c) => {
  if ((op.rateio_escopo ?? ESCOPO_PADRAO) !== 'POR_ITEM') {
    return (op.rateios ?? []).map((r) => {
      const l = linhaDeRateioDetalhe(r, op.valor_total, c);
      return {
        natureza_id: l.natureza_id, natureza_nome: l.natureza_nome, centro_custo_id: l.centro_custo_id, centro_custo_nome: l.centro_custo_nome,
        centro_resultado_id: l.centro_resultado_id, centro_resultado_nome: l.centro_resultado_nome, valor: l.valor, percentual: l.percentual,
      };
    });
  }
  const linhas = (op.itens ?? []).flatMap((i) => i.rateios ?? []);
  return consolidarRateio(linhas, op.valor_total).map((g) => grupoConsolidadoPublico(g, g.linha, c));
};

/**
 * Custo por kg e resíduo da linha no DETALHE (só compra de mercadoria): com
 * lote gravado (confirmado/cancelado) o custo é o do LOTE; no rascunho, o do
 * líquido gravado. Resíduo = líquido − kg × custo (8 casas, exato).
 */
const custoDoItem = (op, i) => {
  if (op.direcao !== 'PAGAR' || i.tipo_item !== 'MERCADORIA' || i.quantidade_estoque == null) return { custo_kg: null, residuo_custo: null };
  const kg = dec(i.quantidade_estoque);
  const liquido = dec(i.valor_liquido);
  const custo = i.loteEntrada ? dec(i.loteEntrada.custo_unitario) : arredondar(liquido.dividedBy(kg), CASAS_CUSTO);
  return { custo_kg: texto(custo, CASAS_CUSTO), residuo_custo: texto(liquido.minus(kg.times(custo)), CASAS_RESIDUO) };
};

/** DETALHE (§5): datas de negócio AAAA-MM-DD; valores em string na escala. */
export const comoDetalhe = (op, historico = []) => {
  const c = op.moeda_casas;
  return {
    id: op.id,
    numero: op.numero,
    status: op.status,
    versao: op.versao,
    empresa_id: op.empresa_id,
    direcao: op.direcao,
    conteudo: op.conteudo,
    condicao: op.condicao,
    parceiro_id: op.parceiro_id,
    parceiro_nome: op.parceiro_nome,
    descricao: op.descricao ?? null,
    documento_referencia: op.documento_referencia ?? null,
    data_emissao: diaDe(op.data_emissao),
    data_operacional: diaDe(op.data_operacional),
    moeda: op.moeda,
    moeda_casas: c,
    valor_bruto: texto(op.valor_bruto, c),
    valor_desconto: texto(op.valor_desconto, c),
    valor_acrescimo: texto(op.valor_acrescimo, c),
    valor_total: texto(op.valor_total, c),
    rateio_modo: op.rateio_modo,
    rateio_escopo: op.rateio_escopo ?? ESCOPO_PADRAO,
    metodo_preferido: op.metodo_preferido ?? null,
    criado_por: usuarioPublico(op.criadoPor),
    confirmado_por: usuarioPublico(op.confirmadoPor),
    confirmado_em: isoDe(op.confirmado_em),
    cancelado_por: usuarioPublico(op.canceladoPor),
    cancelado_em: isoDe(op.cancelado_em),
    motivo_cancelamento: op.motivo_cancelamento ?? null,
    created_date: isoDe(op.createdAt),
    updated_date: isoDe(op.updatedAt),
    itens: (op.itens ?? []).map((i) => ({
      id: i.id,
      ordem: i.ordem,
      tipo_item: i.tipo_item,
      produto_id: i.produto_id ?? null,
      produto_nome: i.produto_nome ?? null,
      descricao: i.descricao ?? null,
      local_estoque_id: i.local_estoque_id ?? null,
      local_estoque_nome: i.local_estoque_nome ?? null,
      unidade: i.unidade,
      quantidade: texto(i.quantidade, CASAS_QUANTIDADE),
      fator_kg: texto(i.fator_kg, CASAS_QUANTIDADE),
      quantidade_estoque: texto(i.quantidade_estoque, CASAS_QUANTIDADE),
      valor_unitario: texto(i.valor_unitario, CASAS_PRECO),
      valor_total: texto(i.valor_total, c),
      valor_desconto_rateado: texto(i.valor_desconto_rateado, c),
      valor_acrescimo_rateado: texto(i.valor_acrescimo_rateado, c),
      valor_liquido: texto(i.valor_liquido, c),
      ...custoDoItem(op, i),
      movimentacao_estoque_id: i.movimentacao_estoque_id ?? null,
      estoque_lote_nota_id: i.estoque_lote_nota_id ?? null,
      movimentacao_estorno_id: i.movimentacao_estorno_id ?? null,
      consumos: (i.consumos ?? []).map((k) => ({
        estoque_lote_nota_id: k.estoque_lote_nota_id,
        quantidade: texto(k.quantidade, CASAS_QUANTIDADE),
        custo_unitario: texto(k.custo_unitario, CASAS_CUSTO),
      })),
      // D-PROD-156: sempre presente ([] no GERAL); percentual informativo sobre o LÍQUIDO do item.
      rateios: (i.rateios ?? []).map((r) => linhaDeRateioDetalhe(r, i.valor_liquido, c)),
    })),
    rateios: (op.rateios ?? []).map((r) => linhaDeRateioDetalhe(r, op.valor_total, c)),
    rateio_consolidado: consolidadoDoDetalhe(op, c),
    titulos: (op.titulos ?? []).map((t) => {
      const saldo = t.status === 'CANCELADO' ? ZERO : dec(t.valor).minus(dec(t.valor_liquidado));
      /** @type {any[]} */
      const liquidacoes = [];
      for (const l of t.liquidacoes ?? []) {
        const est = (l.estornos ?? [])[0] ?? null;
        liquidacoes.push({
          id: l.id, tipo: 'LIQUIDACAO', valor: texto(l.valor, c), data: diaDe(l.data), metodo: l.metodo, referencia: l.referencia ?? null,
          observacao: l.observacao ?? null, estorna_liquidacao_id: null, estornada: Boolean(est), estorno_id: est?.id ?? null, motivo: null,
          registrado_por: usuarioPublico(l.registradoPor), created_date: isoDe(l.createdAt),
        });
        if (est) {
          liquidacoes.push({
            id: est.id, tipo: 'ESTORNO', valor: texto(l.valor, c), data: diaDe(est.data), metodo: null, referencia: null, observacao: null,
            estorna_liquidacao_id: l.id, estornada: false, estorno_id: null, motivo: est.motivo,
            registrado_por: usuarioPublico(est.registradoPor), created_date: isoDe(est.createdAt),
          });
        }
      }
      liquidacoes.sort((a, b) => (a.created_date < b.created_date ? -1 : a.created_date > b.created_date ? 1 : 0));
      return {
        id: t.id,
        numero_parcela: t.numero_parcela,
        total_parcelas: t.total_parcelas,
        vencimento: diaDe(t.vencimento),
        valor: texto(t.valor, c),
        valor_liquidado: texto(t.valor_liquidado, c),
        saldo: texto(saldo, c),
        status: t.status,
        liquidacoes,
      };
    }),
    historico,
  };
};

const carregarDetalhe = async (db, clienteId, id) => {
  const op = await db.operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: clienteId, id } }, include: INCLUDE_DETALHE });
  if (!op) throw naoEncontrado();
  const eventos = await db.auditLog.findMany({
    where: { cliente_id: clienteId, entidade: ENTIDADE, entidade_id: id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { acao: true, createdAt: true, usuario: { select: { login: true } } },
  });
  return comoDetalhe(op, eventos.map((e) => ({ acao: e.acao, em: e.createdAt.toISOString(), usuario_login: e.usuario?.login ?? null })));
};

export const detalhar = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const op = await prisma.operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } }, select: { empresa_id: true } });
  if (!op || op.empresa_id !== empresaId) throw naoEncontrado();
  return carregarDetalhe(prisma, auth.clienteId, id);
};

// ─── leitura: lista keyset ──────────────────────────────────────────────────
export const LIMITE_LISTA_PADRAO = 50;
export const LIMITE_LISTA_MAXIMO = 100;

export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  const limit = normalizarLimite(query.limit, { padrao: LIMITE_LISTA_PADRAO, maximo: LIMITE_LISTA_MAXIMO });
  const cursor = query.cursor ? decodificarCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw invalido('cursor inválido', { field: 'cursor', reason: 'cursor_invalido' });
  for (const campo of ['emissao_de', 'emissao_ate', 'vencimento_de', 'vencimento_ate']) {
    if (query[campo] !== undefined && !diaValido(query[campo])) throw invalido(`${campo} não é um dia válido`, { field: campo, reason: 'data_invalida' });
  }
  /** @type {any} */
  const where = { cliente_id: auth.clienteId, empresa_id: empresaId };
  if (query.direcao) where.direcao = query.direcao;
  if (query.status) where.status = query.status;
  if (query.conteudo) where.conteudo = query.conteudo;
  if (query.parceiro_id) where.parceiro_id = query.parceiro_id;
  if (query.emissao_de || query.emissao_ate) {
    where.data_emissao = { ...(query.emissao_de ? { gte: comoData(query.emissao_de) } : {}), ...(query.emissao_ate ? { lte: comoData(query.emissao_ate) } : {}) };
  }
  /** @type {any[]} */
  const AND = [];
  if (query.vencimento_de || query.vencimento_ate) {
    AND.push({
      titulos: {
        some: { vencimento: { ...(query.vencimento_de ? { gte: comoData(query.vencimento_de) } : {}), ...(query.vencimento_ate ? { lte: comoData(query.vencimento_ate) } : {}) } },
      },
    });
  }
  if (query.com_estoque === 'true') AND.push({ itens: { some: { tipo_item: 'MERCADORIA' } } });
  if (query.com_estoque === 'false') AND.push({ itens: { none: { tipo_item: 'MERCADORIA' } } });
  const q = textoDeBusca(query.q);
  if (q) {
    // Busca literal: o `contains` do Prisma não escapa `%`/`_` (q=% casaria tudo).
    const literal = escaparCuringasLike(q);
    AND.push({
      OR: [
        { numero: { contains: literal } },
        { documento_referencia: { contains: literal, mode: 'insensitive' } },
        { parceiro_nome: { contains: literal, mode: 'insensitive' } },
        { descricao: { contains: literal, mode: 'insensitive' } },
      ],
    });
  }
  const filtro = { ...where, ...(AND.length ? { AND } : {}) };
  const total = await prisma.operacaoFinanceira.count({ where: filtro });
  const registros = await prisma.operacaoFinanceira.findMany({
    where: cursor ? { ...where, AND: [...AND, clausulaKeysetDesc(cursor)] } : filtro,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      titulos: { select: { status: true, valor: true, valor_liquidado: true, vencimento: true } },
      itens: { where: { tipo_item: 'MERCADORIA' }, select: { id: true }, take: 1 },
    },
  });
  return montarEnvelopeKeyset({
    registros,
    limit,
    total,
    mapItem: (op) => {
      const abertos = op.titulos.filter((t) => t.status === 'ABERTO' || t.status === 'PARCIAL');
      const saldo = abertos.reduce((s, t) => s.plus(dec(t.valor).minus(dec(t.valor_liquidado))), ZERO);
      const proximo = abertos.map((t) => diaDe(t.vencimento)).sort()[0] ?? null;
      return {
        id: op.id,
        numero: op.numero,
        status: op.status,
        direcao: op.direcao,
        conteudo: op.conteudo,
        condicao: op.condicao,
        rateio_escopo: op.rateio_escopo ?? ESCOPO_PADRAO,
        parceiro_nome: op.parceiro_nome,
        data_emissao: diaDe(op.data_emissao),
        valor_total: texto(op.valor_total, op.moeda_casas),
        moeda: op.moeda,
        moeda_casas: op.moeda_casas,
        saldo_aberto: texto(saldo, op.moeda_casas),
        proximo_vencimento: proximo,
        tem_estoque: op.itens.length > 0,
        created_date: isoDe(op.createdAt),
      };
    },
  });
};

// ─── rascunho: criar / substituir / descartar ───────────────────────────────
/**
 * POST — rascunho idempotente por `operation_id`. Toda a validação antes de
 * qualquer INSERT; moeda/casas copiadas do perfil AGORA (nunca recalculadas).
 */
export const criarRascunho = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { operation_id: operationKey, ...documento } = corpo;
  const fingerprint = fingerprintDePayload(canonico(documento));
  const cli = auth.clienteId;
  const r = await emTransacao(TX_RASCUNHO, (tx) =>
    executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey,
      tipoOperacao: TIPO_CRIAR,
      fingerprint,
      executar: async () => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, documento.empresa_id);
        const perfil = await lerPerfil(tx, cli, empresaId);
        const casas = /** @type {number} */ (casasDaMoeda(perfil.moeda));
        const doc = normalizarDocumento({ ...documento, empresa_id: empresaId }, casas);
        const refs = await carregarReferencias(tx, cli, empresaId, doc);
        exigirReferencias(doc, refs, perfil);
        const plano = planejarOperacao(doc, { casas, moeda: perfil.moeda, produtos: refs.produtos });
        // §8.4: produtos ANTES da sequência do tenant (quem espera produto não segura a sequência).
        await travarProdutosDoRascunho(tx, cli, plano.itens);
        const numero = await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT });
        const op = await tx.operacaoFinanceira.create({
          data: {
            cliente_id: cli,
            empresa_id: empresaId,
            numero: String(numero),
            status: 'RASCUNHO',
            ...camposDoCabecalho(doc, plano, refs),
            moeda: perfil.moeda,
            moeda_casas: casas,
            versao: 1,
            versao_contrato: VERSAO_CONTRATO,
            criado_por_usuario_id: auth.usuarioId,
          },
        });
        await gravarFilhos(tx, cli, op, plano, refs);
        await registrarEvento(contexto, { acao: 'operacao_financeira.criar', entidade: ENTIDADE, entidadeId: op.id, dadosNovos: auditoriaDoc(op, contagens(plano)) }, tx);
        return { httpStatus: 201, body: await carregarDetalhe(tx, cli, op.id) };
      },
    })
  );
  return { status: r.replay ? 200 : 201, body: { ...r.body, replay: r.replay } };
};

/**
 * PUT — substitui o rascunho inteiro (CAS por `versao`). Ordem: trava →
 * confere → apaga filhos → atualiza cabeçalho (pode trocar a direção) →
 * recria filhos (a FK do rateio com a direção é ON UPDATE RESTRICT).
 */
export const substituirRascunho = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { versao, ...documento } = corpo;
  const cli = auth.clienteId;
  return emTransacao(TX_RASCUNHO, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, documento.empresa_id);
    const atual = await travarCabecalho(tx, cli, empresaId, id, 'UPDATE');
    if (atual.status !== 'RASCUNHO') throw statusInvalido(atual.status, 'RASCUNHO');
    if (atual.versao !== versao) throw versaoConflito(atual.versao, versao);
    const perfil = await lerPerfil(tx, cli, empresaId);
    const casas = atual.moeda_casas;
    const doc = normalizarDocumento({ ...documento, empresa_id: empresaId }, casas);
    const refs = await carregarReferencias(tx, cli, empresaId, doc);
    exigirReferencias(doc, refs, perfil);
    const plano = planejarOperacao(doc, { casas, moeda: atual.moeda, produtos: refs.produtos });
    // §8.4: cabeçalho → produtos → só então apaga e recria os filhos.
    await travarProdutosDoRascunho(tx, cli, plano.itens);
    await apagarFilhosDoRascunho(tx, cli, empresaId, id);
    const r = await tx.operacaoFinanceira.updateMany({
      where: { cliente_id: cli, id, versao, status: 'RASCUNHO' },
      data: { ...camposDoCabecalho(doc, plano, refs), versao: { increment: 1 } },
    });
    if (r.count !== 1) throw versaoConflito(atual.versao, versao);
    const op = await tx.operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } } });
    await gravarFilhos(tx, cli, op, plano, refs);
    await registrarEvento(contexto, { acao: 'operacao_financeira.editar', entidade: ENTIDADE, entidadeId: id, dadosNovos: auditoriaDoc(op, contagens(plano)) }, tx);
    return carregarDetalhe(tx, cli, id);
  });
};

/** DELETE — descarta SÓ rascunho (CAS por `versao`), filhos antes do cabeçalho. */
export const descartarRascunho = async (contexto, id, query) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  await emTransacao(TX_RASCUNHO, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const atual = await travarCabecalho(tx, cli, empresaId, id, 'UPDATE');
    if (atual.status !== 'RASCUNHO') throw statusInvalido(atual.status, 'RASCUNHO');
    if (atual.versao !== query.versao) throw versaoConflito(atual.versao, query.versao);
    await apagarFilhosDoRascunho(tx, cli, empresaId, id);
    await tx.operacaoFinanceira.delete({ where: { cliente_id_id: { cliente_id: cli, id } } });
    // D-PROD-110: o recibo do POST que criou este rascunho vira marcador EXCLUIDO
    // (mesma transação). O replay da mesma chave responde 409
    // IDEMPOTENCY_EFEITO_EXCLUIDO — definitivo, a tela libera a pendência —,
    // nunca 200 com o corpo de um documento apagado.
    await tx.operacaoIdempotente.updateMany({
      where: { cliente_id: cli, tipo_operacao: TIPO_CRIAR, status: 'committed', response_json: { path: ['id'], equals: id } },
      data: { status: STATUS_EXCLUIDO },
    });
    await registrarEvento(contexto, { acao: 'operacao_financeira.descartar', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: { id, numero: atual.numero, empresa_id: empresaId } }, tx);
  });
};

// ─── prévia (sem gravar) ────────────────────────────────────────────────────
const comoBloqueio = (erro) => ({
  code: erro.code,
  field: typeof erro.details?.field === 'string' ? erro.details.field : null,
  reason: typeof erro.details?.reason === 'string' ? erro.details.reason : null,
  details: erro.details ?? {},
});

/** Estado de estoque para a simulação: `estoque_atual` e lotes FIFO por produto|local. */
const estadoDeEstoque = async (tx, clienteId, empresaId, plano, refs) => {
  const estoqueAtual = new Map([...refs.produtos].map(([id, p]) => [id, dec(p.estoque_atual)]));
  const lotes = new Map();
  for (const s of plano.efeitos_estoque.saidas) {
    const chave = `${s.produto_id}|${s.local_estoque_id}`;
    if (!lotes.has(chave)) lotes.set(chave, await lotesFifo(tx, clienteId, empresaId, s.produto_id, s.local_estoque_id));
  }
  return { estoqueAtual, lotes };
};

const comoPlanoPublico = (plano, simulacao, refs) => {
  const c = plano.casas;
  const nomeProduto = (id) => refs.produtos.get(id)?.nome_produto ?? null;
  const nomeLocal = (id) => refs.locais.get(id)?.nome ?? null;
  /** Nomes ATUAIS das referências (os mesmos que a confirmação retrata). */
  const nomesDaLinha = (r) => ({
    natureza_nome: refs.naturezas.get(r.natureza_id)?.nome ?? null,
    centro_custo_nome: r.centro_custo_id ? refs.centrosCusto.get(r.centro_custo_id)?.nome ?? null : null,
    centro_resultado_nome: r.centro_resultado_id ? refs.centrosResultado.get(r.centro_resultado_id)?.nome ?? null : null,
  });
  /** Linha por item na prévia: os campos da linha do detalhe; percentual informativo sobre o líquido do item. */
  const linhaDoItem = (r, liquido) => {
    const nomes = nomesDaLinha(r);
    return {
      ordem: r.ordem,
      natureza_id: r.natureza_id,
      natureza_nome: nomes.natureza_nome,
      natureza_tipo: refs.naturezas.get(r.natureza_id)?.tipo ?? null,
      centro_custo_id: r.centro_custo_id ?? null,
      centro_custo_nome: nomes.centro_custo_nome,
      centro_resultado_id: r.centro_resultado_id ?? null,
      centro_resultado_nome: nomes.centro_resultado_nome,
      percentual: texto(r.percentual ?? percentualInformativo(r.valor, liquido), CASAS_PERCENTUAL),
      valor: texto(r.valor, c),
    };
  };
  const saidas = simulacao?.saidas ?? plano.efeitos_estoque.saidas.map((s) => ({ ...s, disponivel: null, fatias: [], custo_total: null }));
  return {
    moeda: plano.moeda,
    moeda_casas: c,
    valor_bruto: texto(plano.valor_bruto, c),
    valor_desconto: texto(plano.valor_desconto, c),
    valor_acrescimo: texto(plano.valor_acrescimo, c),
    valor_total: texto(plano.valor_total, c),
    rateio_escopo: plano.rateio_escopo,
    itens: plano.itens.map((i) => ({
      ordem: i.ordem, tipo_item: i.tipo_item, produto_id: i.produto_id ?? null, local_estoque_id: i.local_estoque_id ?? null, unidade: i.unidade,
      quantidade: texto(i.quantidade, CASAS_QUANTIDADE), valor_unitario: texto(i.valor_unitario, CASAS_PRECO), valor_total: texto(i.valor_total, c),
      fator_kg: texto(i.fator_kg, CASAS_QUANTIDADE), quantidade_estoque: texto(i.quantidade_estoque, CASAS_QUANTIDADE),
      valor_desconto_rateado: texto(i.valor_desconto_rateado, c), valor_acrescimo_rateado: texto(i.valor_acrescimo_rateado, c), valor_liquido: texto(i.valor_liquido, c),
      custo_kg: texto(i.custo_kg, CASAS_CUSTO), residuo_custo: texto(i.residuo_custo, CASAS_RESIDUO),
      rateios: i.rateios.map((r) => linhaDoItem(r, i.valor_liquido)),
    })),
    rateios: plano.rateios.map((r) => ({
      ordem: r.ordem, natureza_id: r.natureza_id, centro_custo_id: r.centro_custo_id ?? null, centro_resultado_id: r.centro_resultado_id ?? null,
      valor: texto(r.valor, c), percentual: texto(r.percentual ?? percentualInformativo(r.valor, plano.valor_total), CASAS_PERCENTUAL),
    })),
    rateio_consolidado: plano.rateio_consolidado.map((g) => grupoConsolidadoPublico(g, nomesDaLinha(g), c)),
    parcelas: plano.parcelas.map((p) => ({ numero_parcela: p.numero_parcela, total_parcelas: p.total_parcelas, vencimento: p.vencimento, valor: texto(p.valor, c) })),
    efeitos_estoque: {
      entradas: plano.efeitos_estoque.entradas.map((e) => ({
        item_ordem: e.item_ordem, produto_id: e.produto_id, produto_nome: nomeProduto(e.produto_id), local_estoque_id: e.local_estoque_id,
        local_nome: nomeLocal(e.local_estoque_id), kg: texto(e.kg, CASAS_QUANTIDADE), custo_kg: texto(e.custo_kg, CASAS_CUSTO),
      })),
      saidas: saidas.map((s) => ({
        item_ordem: s.item_ordem, produto_id: s.produto_id, produto_nome: nomeProduto(s.produto_id), local_estoque_id: s.local_estoque_id,
        local_nome: nomeLocal(s.local_estoque_id), kg: texto(s.kg, CASAS_QUANTIDADE), disponivel: texto(s.disponivel, CASAS_QUANTIDADE),
        custo_total: texto(s.custo_total, CASAS_CUSTO),
        fatias: (s.fatias ?? []).map((f) => ({ lote_id: f.lote_id, quantidade: texto(f.quantidade, CASAS_QUANTIDADE), custo_unitario: texto(f.custo_unitario, CASAS_CUSTO) })),
      })),
    },
    resumo: { parcelas_n: plano.resumo.parcelas_n, itens_estoque_n: plano.resumo.itens_estoque_n, valor_titulos: texto(plano.valor_total, c), moeda: plano.moeda },
    avisos: plano.avisos,
  };
};

/**
 * Prévia do rascunho salvo: o MESMO plano da confirmação + bloqueios de ESTADO
 * (FIFO em sequência, `estoque_atual`, fuso/data futura, duplicidade
 * documental, referência que ficou inativa). 200 mesmo com bloqueios.
 */
export const previa = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(TX_RASCUNHO, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
    const op = await tx.operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } } });
    if (!op || op.empresa_id !== empresaId) throw naoEncontrado();
    if (op.status !== 'RASCUNHO') throw statusInvalido(op.status, 'RASCUNHO');
    const w = { cliente_id: cli, operacao_id: id };
    const [itens, rateios, titulos, itemRateios] = [
      await tx.operacaoFinanceiraItem.findMany({ where: w }),
      await tx.operacaoFinanceiraRateio.findMany({ where: w }),
      await tx.tituloFinanceiro.findMany({ where: w }),
      await lerItemRateios(tx, cli, empresaId, id),
    ];
    /** @type {any[]} */
    const bloqueios = [];
    const perfil = await tx.perfilFinanceiroEmpresa.findUnique({ where: { cliente_id_empresa_id: { cliente_id: cli, empresa_id: empresaId } } });
    if (!perfil) bloqueios.push(comoBloqueio(perfilAusente(empresaId)));
    const doc = documentoDoBanco(op, itens, rateios, titulos, itemRateios);
    const refs = await carregarReferencias(tx, cli, empresaId, doc);
    bloqueios.push(...problemasDeReferencia(doc, refs, perfil ?? { pais: null, moeda: op.moeda }));
    let plano = null;
    try {
      plano = planejarOperacao(doc, { casas: op.moeda_casas, moeda: op.moeda, produtos: refs.produtos });
    } catch (erro) {
      if (!(erro instanceof AppError)) throw erro;
      bloqueios.push(comoBloqueio(erro));
    }
    if (!plano) return { plano: null, bloqueios };
    if (plano.efeitos_estoque.entradas.length + plano.efeitos_estoque.saidas.length > 0) {
      try {
        const tempo = await hojeDaEmpresa(tx, cli, empresaId);
        if (doc.data_operacional > tempo.hoje) bloqueios.push(comoBloqueio(dataFutura(tempo, doc.data_operacional, 'data_operacional')));
      } catch (erro) {
        if (!(erro instanceof AppError)) throw erro;
        bloqueios.push(comoBloqueio(erro));
      }
    }
    if (doc.documento_referencia) {
      const dup = await tx.operacaoFinanceira.findFirst({
        where: { cliente_id: cli, empresa_id: empresaId, direcao: doc.direcao, parceiro_id: doc.parceiro_id, documento_chave_ativa: doc.documento_referencia, NOT: { id } },
        select: { id: true, numero: true },
      });
      if (dup) bloqueios.push(comoBloqueio(documentoDuplicado({ operacao_id: dup.id, numero: dup.numero })));
    }
    const simulacao = simularEfeitosEstoque(plano, await estadoDeEstoque(tx, cli, empresaId, plano, refs));
    bloqueios.push(...simulacao.bloqueios);
    return { plano: comoPlanoPublico(plano, simulacao, refs), bloqueios };
  });
};

// ─── confirmar ──────────────────────────────────────────────────────────────
const chaveDocumento = (cli, op) => `financeiro:documento:${cli}:${op.empresa_id}:${op.direcao}:${op.parceiro_id}:${op.documento_referencia}`;

/**
 * Snapshots de nomes no momento da confirmação, no rateio geral E nas linhas
 * por item (D-PROD-156): `modelo` é o delegate do Prisma da tabela da linha.
 */
const atualizarSnapshotsDoRateio = async (tx, cli, rateios, refs, modelo = tx.operacaoFinanceiraRateio) => {
  for (const r of rateios) {
    const dados = {
      natureza_nome: refs.naturezas.get(r.natureza_id)?.nome ?? r.natureza_nome,
      centro_custo_nome: r.centro_custo_id ? refs.centrosCusto.get(r.centro_custo_id)?.nome ?? r.centro_custo_nome : null,
      centro_resultado_nome: r.centro_resultado_id ? refs.centrosResultado.get(r.centro_resultado_id)?.nome ?? r.centro_resultado_nome : null,
    };
    if (dados.natureza_nome !== r.natureza_nome || dados.centro_custo_nome !== r.centro_custo_nome || dados.centro_resultado_nome !== r.centro_resultado_nome) {
      await modelo.update({ where: { cliente_id_id: { cliente_id: cli, id: r.id } }, data: dados });
    }
  }
};

/**
 * D-PROD-156: o valor de cada linha por item gravada é o do plano da
 * confirmação (a mesma conta do rascunho; regrava só se divergir) e cada linha
 * planejada tem a sua linha gravada (pelo id do item da ordem e a ordem da
 * linha). Nada de linha a mais ou a menos: o plano e o banco batem 1 a 1.
 * @param {any} tx @param {string} cli @param {any} plano @param {any[]} itens @param {any[]} itemRateios
 */
const conferirLinhasPorItem = async (tx, cli, plano, itens, itemRateios) => {
  const idPorOrdem = new Map(itens.map((i) => [i.ordem, i.id]));
  const gravadas = new Map(itemRateios.map((r) => [`${r.item_id}|${r.ordem}`, r]));
  let planejadas = 0;
  for (const item of plano.itens) {
    for (const linha of item.rateios) {
      planejadas += 1;
      const r = gravadas.get(`${idPorOrdem.get(item.ordem)}|${linha.ordem}`);
      if (!r) throw new Error(`linha ${linha.ordem} do item ${item.ordem} do rateio por item ausente no banco`);
      if (!dec(r.valor).eq(linha.valor)) {
        await tx.operacaoFinanceiraItemRateio.update({ where: { cliente_id_id: { cliente_id: cli, id: r.id } }, data: { valor: paraBanco(linha.valor, 4) } });
      }
    }
  }
  if (planejadas !== itemRateios.length) throw new Error(`rateio por item: ${itemRateios.length} linhas gravadas para ${planejadas} planejadas`);
};

/**
 * Confirma o rascunho: trava (cabeçalho → produtos → títulos), recarrega e
 * revalida TUDO, replaneja e aplica os efeitos de estoque por item em ordem
 * (ENTRADA na compra, SAÍDA FIFO na venda; serviço não mexe em estoque),
 * promove as parcelas a ABERTO e, à vista, registra a baixa no ato.
 */
export const confirmar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const fingerprint = fingerprintDePayload(canonico({ id, empresa_id: corpo.empresa_id, versao: corpo.versao, baixa_no_ato: corpo.baixa_no_ato ?? null }));
  const r = await emTransacao(
    TX_EFEITO,
    (tx) =>
      executarComIdempotencia(tx, {
        clienteId: cli,
        operationKey: corpo.operation_id,
        tipoOperacao: TIPO_CONFIRMAR,
        fingerprint,
        executar: async () => {
          const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
          const op = await travarCabecalho(tx, cli, empresaId, id, 'UPDATE');
          if (op.status !== 'RASCUNHO') throw statusInvalido(op.status, 'RASCUNHO');
          if (op.versao !== corpo.versao) throw versaoConflito(op.versao, corpo.versao);
          const w = { cliente_id: cli, operacao_id: id };
          const itens = await tx.operacaoFinanceiraItem.findMany({ where: w, orderBy: { ordem: 'asc' } });
          await travarProdutosEstoque(tx, cli, empresaId, itens.filter((i) => i.tipo_item === 'MERCADORIA').map((i) => i.produto_id));
          const titulosTravados = /** @type {any[]} */ (await travarTitulos(tx, cli, id));
          const titulos = await tx.tituloFinanceiro.findMany({ where: w });
          const rateios = await tx.operacaoFinanceiraRateio.findMany({ where: w });
          const itemRateios = await lerItemRateios(tx, cli, empresaId, id);
          const perfil = await lerPerfil(tx, cli, empresaId);
          const doc = documentoDoBanco(op, itens, rateios, titulos, itemRateios);
          const refs = await carregarReferencias(tx, cli, empresaId, doc);
          exigirReferencias(doc, refs, perfil);
          const plano = planejarOperacao(doc, { casas: op.moeda_casas, moeda: op.moeda, produtos: refs.produtos });
          const efeitos = [...plano.efeitos_estoque.entradas, ...plano.efeitos_estoque.saidas].sort((a, b) => a.item_ordem - b.item_ordem);
          const baixa = corpo.baixa_no_ato ?? null;
          const tempo = efeitos.length || baixa ? await hojeDaEmpresa(tx, cli, empresaId) : null;
          if (efeitos.length && doc.data_operacional > /** @type {any} */ (tempo).hoje) throw dataFutura(/** @type {any} */ (tempo), doc.data_operacional, 'data_operacional');
          /** @type {{metodo: string, data: string, referencia: string|null}|null} */
          let baixaValidada = null;
          if (baixa) {
            if (op.condicao !== 'AVISTA') throw invalido('a baixa no ato só existe para lançamento à vista', { field: 'baixa_no_ato', reason: 'baixa_no_ato_so_avista' });
            await exigirTela(contexto, TELAS.LANCAMENTOS_FINANCEIROS, 'liquidar', tx);
            exigirMetodo(perfil, baixa.metodo);
            if (!diaValido(baixa.data)) throw invalido('data da baixa não é um dia válido (AAAA-MM-DD)', { field: 'data', reason: 'data_invalida' });
            if (baixa.data > /** @type {any} */ (tempo).hoje) throw dataFutura(/** @type {any} */ (tempo), baixa.data, 'data');
            baixaValidada = { metodo: baixa.metodo, data: baixa.data, referencia: textoDoCorpo(baixa.referencia, 'referencia') ?? null };
          }
          if (op.documento_referencia) {
            await travarEscopo(tx, chaveDocumento(cli, op));
            const dup = await tx.operacaoFinanceira.findFirst({
              where: { cliente_id: cli, empresa_id: empresaId, direcao: op.direcao, parceiro_id: op.parceiro_id, documento_chave_ativa: op.documento_referencia, NOT: { id } },
              select: { id: true, numero: true },
            });
            if (dup) throw documentoDuplicado({ operacao_id: dup.id, numero: dup.numero });
          }
          // Sequência de movimentos SÓ no fim (§8.4 item 5): `numerarMovimentos`.
          const parceiro = { id: refs.parceiro.id, nome: refs.parceiro.nome };
          const documento = { numero: op.documento_referencia ?? op.numero, data: doc.data_emissao };
          const itensPorOrdem = new Map(plano.itens.map((i) => [i.ordem, i]));
          /** @type {string[]} */
          const movimentos = [];
          /** @type {string[]} */
          const lotes = [];
          for (const e of efeitos) {
            const itemPlano = itensPorOrdem.get(e.item_ordem);
            const itemBanco = /** @type {any} */ (itens.find((i) => i.ordem === e.item_ordem));
            const produto = refs.produtos.get(e.produto_id);
            const local = /** @type {any} */ (refs.locais.get(e.local_estoque_id));
            const comum = {
              empresaId, produto, local: { id: local.id, nome: local.nome }, quantidadeKg: e.kg, dia: /** @type {string} */ (doc.data_operacional),
              documento, parceiro, numeroMovimento: numeroProvisorio(), contextoErro: { colecao: 'itens', indice: e.indice, item_ordem: e.item_ordem, field: 'quantidade' },
            };
            /**
             * §8.2: o kg replanejado AGORA (peso por saco atual do produto) é o que
             * vai para lote, movimento, `estoque_atual` e fatias; o item guarda o
             * MESMO kg (e fator/subtotal/rateio do cabeçalho/líquido do plano),
             * porque o estorno lê do item.
             * @type {any}
             */
            const dadosItem = {
              produto_nome: produto?.nome_produto ?? itemBanco.produto_nome,
              local_estoque_nome: local.nome,
              fator_kg: paraBanco(itemPlano.fator_kg, CASAS_QUANTIDADE),
              quantidade_estoque: paraBanco(itemPlano.quantidade_estoque, CASAS_QUANTIDADE),
              valor_total: paraBanco(itemPlano.valor_total, 4),
              ...colunasDoLiquido(itemPlano),
            };
            if (op.direcao === 'PAGAR') {
              // Custo de aquisição LÍQUIDO: movimento = líquido da linha; lote = custo por kg do líquido.
              const ent = await aplicarEntradaEstoque(tx, contexto, {
                ...comum, custoUnitarioKg: e.custo_kg, valorTotal: e.valor_liquido, origem: { operacaoId: id, tipoDetalhado: 'compra_financeiro' },
              });
              dadosItem.movimentacao_estoque_id = ent.movimento.id;
              dadosItem.estoque_lote_nota_id = ent.lote.id;
              movimentos.push(ent.movimento.id);
              lotes.push(ent.lote.id);
            } else {
              const sai = await aplicarSaidaFifo(tx, contexto, { ...comum, origem: { operacaoId: id, tipoDetalhado: 'venda_financeiro' } });
              dadosItem.movimentacao_estoque_id = sai.movimento.id;
              movimentos.push(sai.movimento.id);
              await tx.operacaoFinanceiraConsumoLote.createMany({
                data: sai.fatias.map((f) => ({
                  cliente_id: cli, empresa_id: empresaId, item_id: itemBanco.id, estoque_lote_nota_id: f.lote_id,
                  quantidade: paraBanco(f.quantidade, CASAS_QUANTIDADE), custo_unitario: paraBanco(f.custo_unitario, CASAS_CUSTO),
                })),
              });
            }
            await tx.operacaoFinanceiraItem.update({ where: { cliente_id_id: { cliente_id: cli, id: itemBanco.id } }, data: dadosItem });
          }
          // Linhas sem efeito físico (serviço): o rateio do cabeçalho replanejado é regravado se mudou.
          const comEfeito = new Set(efeitos.map((e) => e.item_ordem));
          for (const itemPlano of plano.itens) {
            if (comEfeito.has(itemPlano.ordem)) continue;
            const itemBanco = /** @type {any} */ (itens.find((i) => i.ordem === itemPlano.ordem));
            const igual = ['valor_desconto_rateado', 'valor_acrescimo_rateado', 'valor_liquido'].every((k) => dec(itemBanco[k]).eq(itemPlano[k]));
            if (!igual) await tx.operacaoFinanceiraItem.update({ where: { cliente_id_id: { cliente_id: cli, id: itemBanco.id } }, data: colunasDoLiquido(itemPlano) });
          }
          await atualizarSnapshotsDoRateio(tx, cli, rateios, refs);
          // D-PROD-156: rateio POR ITEM replanejado do banco — o valor gravado da linha é o do plano (vale a confirmação).
          await conferirLinhasPorItem(tx, cli, plano, itens, itemRateios);
          await atualizarSnapshotsDoRateio(tx, cli, itemRateios, refs, tx.operacaoFinanceiraItemRateio);
          await tx.tituloFinanceiro.updateMany({ where: { ...w, status: 'PREVISTO' }, data: { status: 'ABERTO' } });
          /** @type {string|null} */
          let liquidacaoId = null;
          if (baixaValidada) {
            const unico = titulosTravados[0];
            const liq = await tx.liquidacaoFinanceira.create({
              data: {
                cliente_id: cli, empresa_id: empresaId, titulo_id: unico.id, valor: paraBanco(unico.valor, 4), data: comoData(baixaValidada.data),
                metodo: baixaValidada.metodo, referencia: baixaValidada.referencia, registrado_por_usuario_id: auth.usuarioId,
              },
            });
            liquidacaoId = liq.id;
            await recalcularTitulo(tx, cli, empresaId, unico);
          }
          const confirmado = await tx.operacaoFinanceira.update({
            where: { cliente_id_id: { cliente_id: cli, id } },
            data: {
              status: 'CONFIRMADO',
              confirmado_por_usuario_id: auth.usuarioId,
              confirmado_em: new Date(),
              documento_chave_ativa: op.documento_referencia,
              parceiro_nome: refs.parceiro.nome,
              versao: { increment: 1 },
            },
          });
          await registrarEvento(contexto, {
            acao: 'operacao_financeira.confirmar',
            entidade: ENTIDADE,
            entidadeId: id,
            dadosNovos: auditoriaDoc(confirmado, { ...contagens(plano), movimentos_estoque: movimentos, lotes_estoque: lotes, baixa_no_ato: Boolean(baixaValidada), liquidacao_id: liquidacaoId }),
          }, tx);
          await numerarMovimentos(tx, cli, movimentos);
          return { httpStatus: 200, body: await carregarDetalhe(tx, cli, id) };
        },
      }),
    { documento_chave_ativa: () => documentoDuplicado(), direcao_parceiro: () => documentoDuplicado() }
  );
  return { ...r.body, replay: r.replay };
};

// ─── cancelar ───────────────────────────────────────────────────────────────
/**
 * Cancela o documento CONFIRMADO sem liquidação ativa: trava (cabeçalho →
 * produtos → TODOS os títulos), estorna cada efeito de estoque vinculando os
 * movimentos (data = hoje da fazenda, exige fuso) e leva títulos a CANCELADO.
 */
export const cancelar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const fingerprint = fingerprintDePayload(canonico({ id, empresa_id: corpo.empresa_id, motivo: corpo.motivo }));
  const r = await emTransacao(TX_EFEITO, (tx) =>
    executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey: corpo.operation_id,
      tipoOperacao: TIPO_CANCELAR,
      fingerprint,
      executar: async () => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
        const motivo = motivoObrigatorio(corpo.motivo);
        const op = await travarCabecalho(tx, cli, empresaId, id, 'UPDATE');
        if (op.status !== 'CONFIRMADO') throw statusInvalido(op.status, 'CONFIRMADO');
        const w = { cliente_id: cli, operacao_id: id };
        const itens = await tx.operacaoFinanceiraItem.findMany({ where: w, orderBy: { ordem: 'asc' }, include: { consumos: true } });
        const mercadorias = itens.filter((i) => i.tipo_item === 'MERCADORIA');
        await travarProdutosEstoque(tx, cli, empresaId, mercadorias.map((i) => i.produto_id));
        const titulos = /** @type {any[]} */ (await travarTitulos(tx, cli, id));
        const comBaixa = titulos.filter((t) => dec(t.valor_liquidado).gt(0));
        if (comBaixa.length) {
          throw new AppError('OPERACAO_COM_LIQUIDACOES', 'o lançamento tem liquidação ativa; estorne as baixas antes de cancelar; nada foi alterado', {
            details: { titulos: comBaixa.map((t) => ({ id: t.id, numero_parcela: t.numero_parcela })) },
          });
        }
        const tempo = mercadorias.length ? await hojeDaEmpresa(tx, cli, empresaId) : null;
        // Sequência de movimentos SÓ no fim (§8.4 item 5): `numerarMovimentos`.
        const parceiro = await tx.fornecedor.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: op.parceiro_id } }, select: { id: true, nome: true } });
        // Rodada 2 (CRITICO-2): estornos EM LOTE — mesmo resultado e mesmas
        // recusas do laço item a item, com um número fixo de idas ao banco
        // (com 5–10 ms por ida, 200 itens passavam dos 25–30 s da transação).
        const estornos = await estornarEmLote(tx, contexto, {
          empresaId, direcao: op.direcao, itens: mercadorias, dia: /** @type {any} */ (tempo)?.hoje,
          documento: { numero: op.documento_referencia ?? op.numero, data: diaDe(op.data_emissao) },
          parceiro: { id: parceiro?.id ?? op.parceiro_id, nome: parceiro?.nome ?? op.parceiro_nome }, origem: { operacaoId: id }, numeroMovimento: numeroProvisorio,
        });
        if (estornos.length) {
          const ligados = await tx.$executeRaw`UPDATE "OperacaoFinanceiraItem" AS i
            SET movimentacao_estorno_id = v.estorno, "updatedAt" = (now() AT TIME ZONE 'UTC')
            FROM unnest(${mercadorias.map((item) => item.id)}::text[], ${estornos}::text[]) AS v(id, estorno)
            WHERE i.cliente_id = ${cli} AND i.id = v.id`;
          if (ligados !== estornos.length) throw new Error(`itens ligados ao estorno: ${ligados} de ${estornos.length}`);
        }
        await tx.tituloFinanceiro.updateMany({ where: w, data: { status: 'CANCELADO' } });
        const cancelado = await tx.operacaoFinanceira.update({
          where: { cliente_id_id: { cliente_id: cli, id } },
          data: {
            status: 'CANCELADO',
            cancelado_por_usuario_id: auth.usuarioId,
            cancelado_em: new Date(),
            motivo_cancelamento: motivo,
            documento_chave_ativa: null,
            versao: { increment: 1 },
          },
        });
        await registrarEvento(contexto, {
          acao: 'operacao_financeira.cancelar',
          entidade: ENTIDADE,
          entidadeId: id,
          dadosNovos: auditoriaDoc(cancelado, { motivo_informado: true, movimentos_estorno: estornos, titulos_n: titulos.length }),
        }, tx);
        await numerarMovimentos(tx, cli, estornos);
        return { httpStatus: 200, body: await carregarDetalhe(tx, cli, id) };
      },
    })
  );
  return { ...r.body, replay: r.replay };
};

// ─── liquidação e estorno ───────────────────────────────────────────────────
/** Recalcula `valor_liquidado` e a situação do título a partir dos FATOS (sob trava). */
// `empresa_id` no filtro (rodada 2, SCHEMA_OPS-1): só com ele a soma usa as 3
// colunas da unique (cliente_id, empresa_id, titulo_id, id) e não varre todas as
// liquidações do tenant enquanto o título está travado.
const recalcularTitulo = async (tx, cli, empresaId, titulo) => {
  const soma = await tx.liquidacaoFinanceira.aggregate({ _sum: { valor: true }, where: { cliente_id: cli, empresa_id: empresaId, titulo_id: titulo.id, estornos: { none: {} } } });
  const liquidado = soma._sum.valor == null ? ZERO : dec(soma._sum.valor);
  const valor = dec(titulo.valor);
  if (liquidado.gt(valor)) throw new AppError('LIQUIDACAO_EXCEDE_SALDO', 'as liquidações ultrapassariam o valor do título; nada foi gravado', { details: { titulo_id: titulo.id } });
  const status = liquidado.eq(0) ? 'ABERTO' : liquidado.lt(valor) ? 'PARCIAL' : 'QUITADO';
  await tx.tituloFinanceiro.update({ where: { cliente_id_id: { cliente_id: cli, id: titulo.id } }, data: { valor_liquidado: paraBanco(liquidado, 4), status } });
  return { liquidado, status };
};

/** Título travado (cabeçalho FOR SHARE antes; §8.4). */
const travarTitulo = async (tx, cli, tituloId) => {
  const [t] = /** @type {any[]} */ (await tx.$queryRaw`SELECT id, operacao_id, numero_parcela, status, valor, valor_liquidado FROM "TituloFinanceiro"
    WHERE cliente_id = ${cli} AND id = ${tituloId} FOR UPDATE`);
  return t ?? null;
};

/**
 * Liquidação MANUAL de um título ABERTO|PARCIAL (sem conciliação bancária):
 * valor ≤ saldo na escala da moeda, método do perfil, data ≤ hoje da fazenda.
 */
export const registrarLiquidacao = async (contexto, tituloId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const { operation_id: operationKey, ...resto } = corpo;
  const fingerprint = fingerprintDePayload(canonico({ titulo_id: tituloId, ...resto }));
  const r = await emTransacao(TX_RASCUNHO, (tx) =>
    executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey,
      tipoOperacao: TIPO_LIQUIDAR,
      fingerprint,
      executar: async () => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
        const lido = await tx.tituloFinanceiro.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: tituloId } }, select: { empresa_id: true, operacao_id: true } });
        if (!lido || lido.empresa_id !== empresaId) throw tituloNaoEncontrado();
        const op = await travarCabecalho(tx, cli, empresaId, lido.operacao_id, 'SHARE');
        const titulo = await travarTitulo(tx, cli, tituloId);
        if (!titulo) throw tituloNaoEncontrado();
        if (op.status !== 'CONFIRMADO' || !['ABERTO', 'PARCIAL'].includes(titulo.status)) {
          throw new AppError('TITULO_NAO_LIQUIDAVEL', `o título está ${titulo.status} (lançamento ${op.status}); só título ABERTO ou PARCIAL recebe liquidação; nada foi gravado`, {
            details: { status: titulo.status, operacao_status: op.status },
          });
        }
        const casas = op.moeda_casas;
        if (casasDecimais(corpo.valor) > casas) {
          throw invalido(`valor tem mais casas decimais do que a moeda permite (${casas})`, { field: 'valor', reason: 'casas_decimais_excedidas', casas });
        }
        const valor = dec(corpo.valor);
        if (!valor.gt(0)) throw valoresInvalidos('o valor da liquidação deve ser maior que zero', { field: 'valor', reason: 'valor_nao_positivo' });
        const perfil = await lerPerfil(tx, cli, empresaId);
        exigirMetodo(perfil, corpo.metodo);
        if (!diaValido(corpo.data)) throw invalido('data não é um dia válido (AAAA-MM-DD)', { field: 'data', reason: 'data_invalida' });
        const tempo = await hojeDaEmpresa(tx, cli, empresaId);
        if (corpo.data > tempo.hoje) throw dataFutura(tempo, corpo.data, 'data');
        const atual = await tx.liquidacaoFinanceira.aggregate({ _sum: { valor: true }, where: { cliente_id: cli, empresa_id: empresaId, titulo_id: tituloId, estornos: { none: {} } } });
        const saldo = dec(titulo.valor).minus(atual._sum.valor == null ? ZERO : dec(atual._sum.valor));
        if (valor.gt(saldo)) {
          throw new AppError('LIQUIDACAO_EXCEDE_SALDO', 'o valor é maior que o saldo do título; nada foi gravado', {
            details: { field: 'valor', reason: 'excede_saldo', saldo: saldo.toFixed(casas), valor: valor.toFixed(casas) },
          });
        }
        const liq = await tx.liquidacaoFinanceira.create({
          data: {
            cliente_id: cli, empresa_id: empresaId, titulo_id: tituloId, valor: paraBanco(valor, 4), data: comoData(corpo.data), metodo: corpo.metodo,
            referencia: textoDoCorpo(corpo.referencia, 'referencia') ?? null, observacao: textoDoCorpo(corpo.observacao, 'observacao') ?? null,
            registrado_por_usuario_id: auth.usuarioId,
          },
        });
        const depois = await recalcularTitulo(tx, cli, empresaId, titulo);
        await registrarEvento(contexto, {
          acao: 'titulo_financeiro.liquidar',
          entidade: ENTIDADE,
          entidadeId: op.id,
          dadosNovos: {
            operacao_id: op.id, numero: op.numero, empresa_id: empresaId, titulo_id: tituloId, numero_parcela: titulo.numero_parcela, liquidacao_id: liq.id,
            valor: valor.toFixed(casas), metodo: corpo.metodo, status_titulo: depois.status, valor_liquidado: depois.liquidado.toFixed(casas),
          },
        }, tx);
        return { httpStatus: 201, body: await carregarDetalhe(tx, cli, op.id) };
      },
    })
  );
  return { status: r.httpStatus, body: { ...r.body, replay: r.replay } };
};

/**
 * Estorno de UMA liquidação (fato novo; a liquidação nunca é alterada nem
 * apagada). Data = hoje da fazenda; o título volta a PARCIAL/ABERTO.
 */
export const estornarLiquidacao = async (contexto, liquidacaoId, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const { operation_id: operationKey, ...resto } = corpo;
  const fingerprint = fingerprintDePayload(canonico({ liquidacao_id: liquidacaoId, ...resto }));
  const r = await emTransacao(
    TX_RASCUNHO,
    (tx) =>
      executarComIdempotencia(tx, {
        clienteId: cli,
        operationKey,
        tipoOperacao: TIPO_ESTORNAR,
        fingerprint,
        executar: async () => {
          const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
          const motivo = motivoObrigatorio(corpo.motivo);
          const liq = await tx.liquidacaoFinanceira.findUnique({
            where: { cliente_id_id: { cliente_id: cli, id: liquidacaoId } },
            select: { id: true, empresa_id: true, titulo_id: true, valor: true },
          });
          if (!liq || liq.empresa_id !== empresaId) throw liquidacaoNaoEncontrada();
          const lido = await tx.tituloFinanceiro.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: liq.titulo_id } }, select: { operacao_id: true } });
          if (!lido) throw liquidacaoNaoEncontrada();
          const op = await travarCabecalho(tx, cli, empresaId, lido.operacao_id, 'SHARE');
          if (op.status !== 'CONFIRMADO') throw statusInvalido(op.status, 'CONFIRMADO');
          const titulo = await travarTitulo(tx, cli, liq.titulo_id);
          const ja = await tx.liquidacaoFinanceiraEstorno.findUnique({ where: { cliente_id_liquidacao_id: { cliente_id: cli, liquidacao_id: liquidacaoId } }, select: { id: true } });
          if (ja) throw jaEstornada(liquidacaoId);
          const tempo = await hojeDaEmpresa(tx, cli, empresaId);
          const estorno = await tx.liquidacaoFinanceiraEstorno.create({
            data: {
              cliente_id: cli, empresa_id: empresaId, titulo_id: liq.titulo_id, liquidacao_id: liquidacaoId, data: comoData(tempo.hoje), motivo,
              registrado_por_usuario_id: auth.usuarioId,
            },
          });
          const depois = await recalcularTitulo(tx, cli, empresaId, titulo);
          await registrarEvento(contexto, {
            acao: 'liquidacao_financeira.estornar',
            entidade: ENTIDADE,
            entidadeId: op.id,
            dadosNovos: {
              operacao_id: op.id, numero: op.numero, empresa_id: empresaId, titulo_id: liq.titulo_id, numero_parcela: titulo.numero_parcela,
              liquidacao_id: liquidacaoId, estorno_id: estorno.id, valor: texto(liq.valor, op.moeda_casas), motivo_informado: true,
              status_titulo: depois.status, valor_liquidado: depois.liquidado.toFixed(op.moeda_casas),
            },
          }, tx);
          return { httpStatus: 201, body: await carregarDetalhe(tx, cli, op.id) };
        },
      }),
    { liquidacao_id: () => jaEstornada(liquidacaoId) }
  );
  return { status: r.httpStatus, body: { ...r.body, replay: r.replay } };
};
