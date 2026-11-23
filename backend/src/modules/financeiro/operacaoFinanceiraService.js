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
 *
 * D-PROD-158 (Gestão P3-03) — EDITAR (retificar), EXCLUIR (lógico) e DUPLICAR:
 *  - elegibilidade de fonte ÚNICA (`avaliarElegibilidade`): o GET responde em
 *    REPEATABLE READ sem trava; os comandos repetem a MESMA avaliação depois das
 *    travas (mudou desde o GET → 409 específico com os motivos);
 *  - retificar: NO_LUGAR (mesmo registro, `versao+1`) quando a assinatura física
 *    não muda; senão SUBSTITUIÇÃO atômica — estorno do antigo pelo núcleo do
 *    cancelamento + documento novo confirmado pelo núcleo da confirmação, com o
 *    MESMO número (o antigo vira `<numero>/r<versao>`);
 *  - excluir: lógico (estorna como o cancelamento, `excluido_em`); nunca DELETE
 *    de documento confirmado;
 *  - os dois gravam um evento com o snapshot da versão anterior (tabela de
 *    eventos, com FKs) e o AuditLog; duplicar é o POST de criação com
 *    `duplicado_de_id` (só proveniência no AuditLog).
 */

import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../../database/prismaClient.js';
import { aplicarExclusaoComRecalculo, planejarExclusaoComRecalculo } from '../estoqueRecalculo/estoqueExclusaoRecalculo.js';
import { MARCA_EXCLUSAO_RECALCULO } from '../estoqueFisico/movimentoPosterior.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { TELAS, carregarAutorizacao, exigirTela, telaPermite } from '../../shared/auth/autorizacaoTela.js';
import { AppError } from '../../shared/errors/AppError.js';
import { STATUS_EXCLUIDO, executarComIdempotencia, fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { emTransacao } from '../../shared/prisma/transacaoConcorrente.js';
import { clausulaKeysetDesc, decodificarCursor, montarEnvelopeKeyset, normalizarLimite } from '../../shared/pagination/keysetCursor.js';
import { registrarEvento, registrarEventosEmLote } from '../auditoria/auditService.js';
import { lerPapeis } from '../fornecedores/fornecedorDominio.js';
import { escaparCuringasLike } from '../usuarios/usuarioRepository.js';
import { exigirEmpresaDoTenant, invalido, textoDeBusca, textoDoCorpo, travarEscopo } from '../gestao/gestaoComum.js';
import { entradaManualComDocumento, travarDocumentoDeEstoque } from '../estoqueFisico/documentoDeEstoque.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero, reservarNumeros } from '../sequencias/entidadeCodigoService.js';
import {
  CAMPOS_PROCEDENCIA_LOTE, ENTIDADE_MOVIMENTO, ORIGEM_SISTEMA, aplicarEntradaEstoque, aplicarSaida, atualizarProcedencia, estornarEmLote, lotesFifo, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { casasDaMoeda, metodosPermitidos, VERSAO_CONTRATO } from './financeiroCatalogo.js';
import {
  CASAS_CUSTO, CASAS_PERCENTUAL, CASAS_PRECO, CASAS_QUANTIDADE, CASAS_RESIDUO, ZERO, arredondar, casasDecimais, dec, paraBanco, somar, texto,
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
/** D-PROD-158: comandos de retificação e de exclusão lógica (idempotentes por `operation_id`). */
export const TIPO_RETIFICAR = 'retificar_operacao_financeira';
export const TIPO_EXCLUIR = 'excluir_operacao_financeira';
/** D-PROD-158 (revisão DE-02/BC-01): AuditLog do lote cuja procedência a retificação NO_LUGAR atualizou (escritor benigno). */
export const ACAO_PROCEDENCIA_LOTE = 'operacao_financeira.retificar_procedencia';

/** Transações (§8.4): rascunho 20 s; efeitos (confirmar/cancelar) 30 s. */
const TX_RASCUNHO = { maxWait: 10000, timeout: 20000 };
const TX_EFEITO = { maxWait: 10000, timeout: 30000 };
/** Leitura do detalhe: um snapshot só para cabeçalho, itens e linhas (D-PROD-156). */
const TX_LEITURA = { maxWait: 10000, timeout: 20000, isolationLevel: 'RepeatableRead' };

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
/** D-PROD-261 (R-DEDUPE): a mercadoria deste documento já entrou no estoque por uma entrada manual. */
const documentoDeEntradaManual = (entrada) =>
  new AppError('OPERACAO_DOCUMENTO_DUPLICADO', 'este documento já está numa entrada manual confirmada do estoque; a mercadoria já entrou por ela; lance só o pagamento (sem produtos) ou exclua a entrada; nada foi gravado', {
    details: { field: 'documento_referencia', reason: 'documento_de_entrada_manual', entrada_id: entrada.id, entrada_numero: entrada.numero },
  });
/** Lançamento com mercadoria (mexe no estoque)? */
const mexeNoEstoque = (plano) => plano.efeitos_estoque.entradas.length + plano.efeitos_estoque.saidas.length > 0;
/**
 * D-PROD-261 (R-DEDUPE): um lançamento COM produtos não confirma com o documento de uma entrada
 * manual CONFIRMADA da fazenda (a compra entraria no estoque duas vezes). Sem produtos, passa.
 * Mesma trava do documento que a entrada manual toma (`documentoDeEstoque.js`).
 */
const exigirDocumentoForaDeEntradaManual = async (tx, cli, empresaId, documento, plano) => {
  if (!documento || !mexeNoEstoque(plano)) return;
  await travarDocumentoDeEstoque(tx, cli, empresaId, documento);
  const entrada = await entradaManualComDocumento(tx, cli, empresaId, documento);
  if (entrada) throw documentoDeEntradaManual(entrada);
};
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
  // D-PROD-162: item em L × Produto não-L (ou o contrário); o `reason` é o mesmo.
  unidade_invalida_litros: 'unidade incompatível com o produto (litros (L) só para produto com estoque em L, e produto em L só com a unidade L)',
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
    } else if ((it.unidade === 'L') !== (prod.unidade_principal_estoque === 'L')) {
      // D-PROD-162 (§4.7): item L só com Produto em L, e Produto em L só com item L.
      add('unidade', 'unidade_invalida', { ...extra, unidade_produto: prod.unidade_principal_estoque ?? null });
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
  if (!primeiro) return;
  // D-PROD-162: a recusa L × não-L leva `unidade_produto` e o texto próprio; as de antes, o mesmo texto.
  const chave = primeiro.reason === 'unidade_invalida' && 'unidade_produto' in primeiro.details ? 'unidade_invalida_litros' : primeiro.reason;
  throw new AppError(primeiro.code, `${MENSAGENS[/** @type {keyof typeof MENSAGENS} */ (chave)] ?? 'referência inválida'}; nada foi gravado`, { details: primeiro.details });
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
 * D-PROD-158: a retificação NO_LUGAR mantém as linhas de MERCADORIA (com os
 * seus movimentos) — `mantidos`, ordem → id — e cria só as demais; os títulos
 * da retificação nascem `ABERTO` (`statusTitulos`), como na confirmação.
 * @param {any} tx @param {string} clienteId @param {any} op @param {any} plano @param {any} refs
 * @param {{ mantidos?: Map<number, string>, statusTitulos?: string }} [opcoes]
 */
const gravarFilhos = async (tx, clienteId, op, plano, refs, { mantidos = new Map(), statusTitulos = 'PREVISTO' } = {}) => {
  const base = { cliente_id: clienteId, empresa_id: op.empresa_id };
  /** @type {Map<number, string>} */
  const itemPorOrdem = new Map(mantidos);
  const novos = plano.itens.filter((i) => !mantidos.has(i.ordem));
  if (novos.length) {
    const criados = await tx.operacaoFinanceiraItem.createManyAndReturn({
      select: { id: true, ordem: true },
      data: novos.map((i) => ({
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
  }
  if (itemPorOrdem.size !== plano.itens.length) throw new Error(`itens gravados: ${itemPorOrdem.size} de ${plano.itens.length}`);
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
      status: statusTitulos,
    })),
  });
};

/**
 * D-PROD-156: toda linha por item do documento aponta um item DELE, e nenhum
 * item dele tem linha de OUTRO documento. A FK do item é (cliente_id,
 * empresa_id, item_id) e não amarra o item ao mesmo documento da linha: uma
 * linha gravada fora da API (SQL, script de ops) pode cruzar dois documentos
 * da mesma empresa. Aqui isso vira 422 explícito (prévia, confirmação, PUT e
 * descarte), em vez de 500, 403 de tenant ou consolidado acima do total.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} operacaoId
 */
const exigirLinhasDoDocumento = async (tx, clienteId, empresaId, operacaoId) => {
  const cruzada = await tx.operacaoFinanceiraItemRateio.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      OR: [
        { operacao_id: operacaoId, item: { operacao_id: { not: operacaoId } } },
        { operacao_id: { not: operacaoId }, item: { operacao_id: operacaoId } },
      ],
    },
    select: { operacao_id: true, item: { select: { operacao_id: true, ordem: true } } },
  });
  if (!cruzada) return;
  // Item DESTE documento com linha de outro: aponta o item; linha deste documento num item de outro: sem índice.
  const posicao = cruzada.item.operacao_id === operacaoId ? { indice: cruzada.item.ordem - 1 } : {};
  throw new AppError('OPERACAO_RATEIO_INVALIDO', 'há linha de rateio por item ligada a um item de outro documento (gravada fora da API); nada foi gravado', {
    details: { field: 'rateios', reason: 'linha_de_item_fora_do_documento', colecao: 'itens', ...posicao, subcolecao: 'rateios' },
  });
};

/**
 * Apaga os filhos do rascunho (PUT recria; DELETE descarta). As linhas por
 * item (D-PROD-156) saem ANTES dos itens (FK RESTRICT): item removido no PUT
 * leva as linhas dele na mesma transação. O filtro com `empresa_id` usa o
 * índice (cliente_id, empresa_id, operacao_id) da tabela nova. Linha cruzada
 * com outro documento → 422 antes de apagar (`exigirLinhasDoDocumento`).
 */
const apagarFilhosDoRascunho = async (tx, clienteId, empresaId, operacaoId) => {
  await exigirLinhasDoDocumento(tx, clienteId, empresaId, operacaoId);
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
    include: { consumos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, rateios: { orderBy: { ordem: 'asc' } } },
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
 * Linhas por item do DETALHE: o include vem pelo item, então uma linha de OUTRO
 * documento gravada fora da API no item deste (a FK não impede) fica de fora;
 * prévia e confirmação recusam o documento (`exigirLinhasDoDocumento`).
 */
const linhasDoProprioDocumento = (op, i) => (i.rateios ?? []).filter((r) => r.operacao_id === op.id);

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
  const linhas = (op.itens ?? []).flatMap((i) => linhasDoProprioDocumento(op, i));
  return consolidarRateio(linhas, op.valor_total).map((g) => grupoConsolidadoPublico(g, g.linha, c));
};

/**
 * Custo por kg e resíduo da linha no DETALHE (só compra de mercadoria): o custo é o de aquisição (líquido gravado ÷ kg; D-PROD-256: o `custo_unitario` do lote é o valor vigente no poço, não o de aquisição). Resíduo = líquido − kg × custo (8 casas, exato).
 */
const custoDoItem = (op, i) => {
  if (op.direcao !== 'PAGAR' || i.tipo_item !== 'MERCADORIA' || i.quantidade_estoque == null) return { custo_kg: null, residuo_custo: null };
  const kg = dec(i.quantidade_estoque);
  const liquido = dec(i.valor_liquido);
  // D-PROD-256: o custo da camada passa a ser o valor vigente no poço (reavaliado a cada saída); o de aquisição é o líquido ÷ kg gravado no item.
  const custo = arredondar(liquido.dividedBy(kg), CASAS_CUSTO);
  return { custo_kg: texto(custo, CASAS_CUSTO), residuo_custo: texto(liquido.minus(kg.times(custo)), CASAS_RESIDUO) };
};

/**
 * DETALHE (§5): datas de negócio AAAA-MM-DD; valores em string na escala.
 * D-PROD-158: `revisao` traz exclusão, substituição (nos dois sentidos), a
 * cadeia de eventos (sem o snapshot) e a origem da cópia (`duplicado_de_id`).
 * @param {any} op @param {any[]} [historico]
 * @param {{ exclusao?: any, substituido_por?: any, substitui?: any, eventos?: any[], duplicado_de_id?: string|null }} [revisao]
 */
export const comoDetalhe = (op, historico = [], revisao = {}) => {
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
    // D-PROD-158: exclusão lógica e retificação (substituição).
    excluido_em: isoDe(op.excluido_em),
    retificado_em: isoDe(op.retificado_em),
    exclusao: revisao.exclusao ?? null,
    substituido_por: revisao.substituido_por ?? null,
    substitui: revisao.substitui ?? null,
    duplicado_de_id: revisao.duplicado_de_id ?? null,
    eventos: revisao.eventos ?? [],
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
      rateios: linhasDoProprioDocumento(op, i).map((r) => linhaDeRateioDetalhe(r, i.valor_liquido, c)),
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

// ─── leitura: revisões (D-PROD-158) ──────────────────────────────────────────
/** Teto da cadeia de eventos no detalhe (e de passos ao percorrer a cadeia). */
export const LIMITE_EVENTOS_DETALHE = 50;

const SELECT_EVENTO = Object.freeze({
  id: true, tipo: true, modo: true, operacao_id: true, operacao_nova_id: true, numero_original: true, versao_anterior: true, versao_nova: true,
  motivo: true, createdAt: true, usuario: USUARIO, operacao: { select: { id: true, numero: true } }, operacaoNova: { select: { id: true, numero: true } },
});

/** Evento no detalhe (nunca o snapshot). */
const eventoPublico = (e) => ({
  tipo: e.tipo,
  modo: e.modo ?? null,
  em: isoDe(e.createdAt),
  por: usuarioPublico(e.usuario),
  motivo: e.motivo,
  versao_anterior: e.versao_anterior,
  versao_nova: e.versao_nova,
  numero_original: e.numero_original,
  operacao_id: e.operacao_id,
  operacao_numero: e.operacao?.numero ?? null,
  operacao_nova_id: e.operacao_nova_id ?? null,
  operacao_nova_numero: e.operacaoNova?.numero ?? null,
});

/**
 * Exclusão, substituição nos dois sentidos, cadeia lógica de eventos (até 50,
 * os mais recentes, em ordem cronológica) e origem da cópia. A cadeia segue as
 * substituições para trás (de quem este documento nasceu) e para frente (quem o
 * substituiu), por CTE recursiva limitada; só o tenant e a empresa do documento.
 * @param {any} db @param {string} clienteId @param {any} op
 */
const lerRevisoes = async (db, clienteId, op) => {
  const emp = op.empresa_id;
  const proprios = await db.operacaoFinanceiraEvento.findMany({
    where: { cliente_id: clienteId, empresa_id: emp, OR: [{ operacao_id: op.id }, { operacao_nova_id: op.id }] },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECT_EVENTO,
  });
  const exclusao = proprios.find((e) => e.tipo === 'EXCLUSAO' && e.operacao_id === op.id) ?? null;
  const substituicao = proprios.find((e) => e.modo === 'SUBSTITUICAO' && e.operacao_id === op.id) ?? null;
  const origem = proprios.find((e) => e.operacao_nova_id === op.id) ?? null;
  const cadeia = /** @type {Array<{id: string}>} */ (await db.$queryRaw`WITH RECURSIVE tras(id, n) AS (
      SELECT ${op.id}::text, 0
      UNION ALL
      SELECT e.operacao_id, t.n + 1 FROM "OperacaoFinanceiraEvento" e JOIN tras t
        ON e.cliente_id = ${clienteId} AND e.empresa_id = ${emp} AND e.operacao_nova_id = t.id
      WHERE t.n < ${LIMITE_EVENTOS_DETALHE}
    ), frente(id, n) AS (
      SELECT ${op.id}::text, 0
      UNION ALL
      SELECT e.operacao_nova_id, f.n + 1 FROM "OperacaoFinanceiraEvento" e JOIN frente f
        ON e.cliente_id = ${clienteId} AND e.empresa_id = ${emp} AND e.operacao_id = f.id AND e.operacao_nova_id IS NOT NULL
      WHERE f.n < ${LIMITE_EVENTOS_DETALHE}
    )
    SELECT id FROM tras UNION SELECT id FROM frente`);
  const eventos = await db.operacaoFinanceiraEvento.findMany({
    where: { cliente_id: clienteId, empresa_id: emp, operacao_id: { in: cadeia.map((r) => r.id) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LIMITE_EVENTOS_DETALHE,
    select: SELECT_EVENTO,
  });
  const criacao = await db.auditLog.findFirst({
    where: { cliente_id: clienteId, entidade: ENTIDADE, entidade_id: op.id, acao: 'operacao_financeira.criar' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { dados_novos: true },
  });
  const dadosCriacao = /** @type {any} */ (criacao?.dados_novos);
  return {
    exclusao: exclusao ? { em: isoDe(exclusao.createdAt), por: usuarioPublico(exclusao.usuario), motivo: exclusao.motivo } : null,
    substituido_por: substituicao?.operacaoNova ? { id: substituicao.operacaoNova.id, numero: substituicao.operacaoNova.numero } : null,
    substitui: origem?.operacao ? { id: origem.operacao.id, numero: origem.operacao.numero } : null,
    eventos: eventos.reverse().map(eventoPublico),
    duplicado_de_id: typeof dadosCriacao?.duplicado_de_id === 'string' ? dadosCriacao.duplicado_de_id : null,
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
  const revisao = await lerRevisoes(db, clienteId, op);
  return comoDetalhe(op, eventos.map((e) => ({ acao: e.acao, em: e.createdAt.toISOString(), usuario_login: e.usuario?.login ?? null })), revisao);
};

/**
 * GET do detalhe numa transação REPEATABLE READ (só leitura, sem trava): o
 * include do Prisma lê cabeçalho, itens e linhas por item em comandos
 * separados, e as linhas são associadas pelo `item_id`, que todo PUT recria.
 * Em READ COMMITTED, um PUT que confirmava entre os comandos devolvia itens sem
 * linhas e um consolidado vazio; com um snapshot só, tudo é do mesmo instante.
 */
export const detalhar = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  return emTransacao(TX_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, auth.clienteId, query.empresa_id);
    const op = await tx.operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } }, select: { empresa_id: true } });
    if (!op || op.empresa_id !== empresaId) throw naoEncontrado();
    return carregarDetalhe(tx, auth.clienteId, id);
  });
};

// ─── leitura: lista keyset ──────────────────────────────────────────────────
export const LIMITE_LISTA_PADRAO = 50;
export const LIMITE_LISTA_MAXIMO = 100;
/**
 * D-PROD-158: situação da lista. OPERACIONAIS (padrão) = nem excluído nem
 * retificado (a versão substituída sai; a atual fica); EXCLUIDOS = só os
 * excluídos logicamente; TODOS = tudo, inclusive versões substituídas.
 */
export const SITUACOES_LISTA = Object.freeze(['OPERACIONAIS', 'EXCLUIDOS', 'TODOS']);

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
  // D-PROD-158: a mesma semântica vale para o total (`count`) e a página (mesmo `where`).
  const situacao = query.situacao ?? 'OPERACIONAIS';
  if (situacao === 'OPERACIONAIS') Object.assign(where, { excluido_em: null, retificado_em: null });
  else if (situacao === 'EXCLUIDOS') where.excluido_em = { not: null };
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
        excluido_em: isoDe(op.excluido_em),
        retificado_em: isoDe(op.retificado_em),
        created_date: isoDe(op.createdAt),
      };
    },
  });
};

// ─── rascunho: criar / substituir / descartar ───────────────────────────────
/**
 * D-PROD-158 (duplicar): o lançamento de origem da cópia tem de ser do MESMO
 * tenant e da MESMA empresa; senão 422 (sem revelar se existe noutro lugar). É
 * só proveniência (AuditLog da criação): nada acopla os dois documentos.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string} id
 */
const exigirOrigemDaCopia = async (tx, cli, empresaId, id) => {
  const origem = await tx.operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } }, select: { id: true, empresa_id: true, numero: true } });
  if (!origem || origem.empresa_id !== empresaId) {
    throw new AppError('OPERACAO_REFERENCIA_INVALIDA', 'o lançamento de origem da cópia não existe nesta empresa; nada foi gravado', {
      details: { field: 'duplicado_de_id', reason: 'duplicado_de_nao_encontrado' },
    });
  }
  return origem;
};

/**
 * POST — rascunho idempotente por `operation_id`. Toda a validação antes de
 * qualquer INSERT; moeda/casas copiadas do perfil AGORA (nunca recalculadas).
 * D-PROD-158: `duplicado_de_id` opcional (cópia de outro lançamento) entra no
 * fingerprint e só no AuditLog da criação.
 */
export const criarRascunho = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { operation_id: operationKey, ...entrada } = corpo;
  const fingerprint = fingerprintDePayload(canonico(entrada));
  const { duplicado_de_id: duplicadoDeId, ...documento } = entrada;
  const cli = auth.clienteId;
  const r = await emTransacao(TX_RASCUNHO, (tx) =>
    executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey,
      tipoOperacao: TIPO_CRIAR,
      fingerprint,
      executar: async () => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, documento.empresa_id);
        const origem = duplicadoDeId === undefined || duplicadoDeId === null ? null : await exigirOrigemDaCopia(tx, cli, empresaId, duplicadoDeId);
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
        const proveniencia = origem ? { duplicado_de_id: origem.id, duplicado_de_numero: origem.numero } : {};
        await registrarEvento(contexto, { acao: 'operacao_financeira.criar', entidade: ENTIDADE, entidadeId: op.id, dadosNovos: auditoriaDoc(op, { ...contagens(plano), ...proveniencia }) }, tx);
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
 *
 * O cabeçalho é lido com FOR SHARE: PUT, descartar e confirmar travam FOR
 * UPDATE, então cabeçalho, itens e linhas são do MESMO instante. Sem a trava,
 * um PUT que confirma entre a leitura dos itens e a das linhas por item
 * (associadas pelo `item_id`, que o PUT recria) montava o POR_ITEM sem linhas
 * e a prévia acusava "item sem rateio" num documento válido (D-PROD-156).
 */
export const previa = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(TX_RASCUNHO, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
    const op = await travarCabecalho(tx, cli, empresaId, id, 'SHARE');
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
      await exigirLinhasDoDocumento(tx, cli, empresaId, id);
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
      const entrada = mexeNoEstoque(plano) ? await entradaManualComDocumento(tx, cli, empresaId, doc.documento_referencia) : null;
      if (entrada) bloqueios.push(comoBloqueio(documentoDeEntradaManual(entrada)));
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
 * NÚCLEO dos efeitos de estoque da confirmação (recebe `tx`; nunca abre
 * transação): por item, em ordem, ENTRADA na compra (custo de aquisição
 * LÍQUIDO) e SAÍDA FIFO na venda (com as fatias), gravando no item o kg e os
 * valores do plano e os ids de movimento/lote. Serviço não mexe em estoque.
 * Usado pela confirmação e pela retificação por SUBSTITUIÇÃO (D-PROD-158).
 * Quem chama já travou cabeçalho → produtos → títulos e numera os movimentos
 * no FIM (`numerarMovimentos`, §8.4 item 5).
 * @param {any} tx @param {any} contexto
 * @param {{ cli: string, empresaId: string, operacaoId: string, direcao: string, dia: string|null, plano: any, itens: any[],
 *   refs: any, documento: {numero: string, data: string}, parceiro: {id: string, nome: string} }} a
 * @returns {Promise<{ movimentos: string[], lotes: string[], comEfeito: Set<number> }>}
 */
const aplicarEfeitosDoPlano = async (tx, contexto, a) => {
  const { cli, empresaId, plano, itens, refs } = a;
  const efeitos = [...plano.efeitos_estoque.entradas, ...plano.efeitos_estoque.saidas].sort((x, y) => x.item_ordem - y.item_ordem);
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
      empresaId, produto, local: { id: local.id, nome: local.nome }, quantidadeKg: e.kg, dia: /** @type {string} */ (a.dia),
      documento: a.documento, parceiro: a.parceiro, numeroMovimento: numeroProvisorio(), contextoErro: { colecao: 'itens', indice: e.indice, item_ordem: e.item_ordem, field: 'quantidade' },
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
    if (a.direcao === 'PAGAR') {
      // Custo de aquisição LÍQUIDO: movimento = líquido da linha; lote = custo por kg do líquido.
      const ent = await aplicarEntradaEstoque(tx, contexto, {
        ...comum, custoUnitarioKg: e.custo_kg, valorTotal: e.valor_liquido, origem: { operacaoId: a.operacaoId, tipoDetalhado: 'compra_financeiro' },
      });
      dadosItem.movimentacao_estoque_id = ent.movimento.id;
      dadosItem.estoque_lote_nota_id = ent.lote.id;
      movimentos.push(ent.movimento.id);
      lotes.push(ent.lote.id);
    } else {
      const sai = await aplicarSaida(tx, contexto, { ...comum, origem: { operacaoId: a.operacaoId, tipoDetalhado: 'venda_financeiro' } });
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
  return { movimentos, lotes, comEfeito: new Set(efeitos.map((e) => e.item_ordem)) };
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
          await exigirLinhasDoDocumento(tx, cli, empresaId, id);
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
            await exigirDocumentoForaDeEntradaManual(tx, cli, empresaId, op.documento_referencia, plano);
          }
          // Sequência de movimentos SÓ no fim (§8.4 item 5): `numerarMovimentos`.
          const { movimentos, lotes, comEfeito } = await aplicarEfeitosDoPlano(tx, contexto, {
            cli, empresaId, operacaoId: id, direcao: op.direcao, dia: doc.data_operacional, plano, itens, refs,
            documento: { numero: op.documento_referencia ?? op.numero, data: doc.data_emissao }, parceiro: { id: refs.parceiro.id, nome: refs.parceiro.nome },
          });
          // Linhas sem efeito físico (serviço): o rateio do cabeçalho replanejado é regravado se mudou.
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
 * NÚCLEO do estorno do cancelamento (recebe `tx`; nunca abre transação):
 * estorna EM LOTE os efeitos de estoque dos itens de MERCADORIA (data = hoje
 * da fazenda) e liga cada item ao seu movimento de estorno. Usado pelo
 * cancelamento, pela exclusão lógica e pela retificação por SUBSTITUIÇÃO
 * (D-PROD-158). Quem chama já travou cabeçalho → produtos → títulos e numera
 * os estornos no FIM (`numerarMovimentos`).
 * @param {any} tx @param {any} contexto
 * D-PROD-273 (fatia 5): `camadaPeloRecalculo` (compra cancelada com recálculo) — os originais cuja camada o recálculo
 * regrava (ver `estornarEmLote`).
 * @param {{ cli: string, empresaId: string, op: any, mercadorias: any[], dia: string|undefined, camadaPeloRecalculo?: string[] }} a
 * @returns {Promise<string[]>} ids dos movimentos de estorno, na ordem dos itens
 */
const estornarEfeitosDoDocumento = async (tx, contexto, { cli, empresaId, op, mercadorias, dia, camadaPeloRecalculo = undefined }) => {
  const parceiro = await tx.fornecedor.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: op.parceiro_id } }, select: { id: true, nome: true } });
  // Rodada 2 (CRITICO-2): estornos EM LOTE — mesmo resultado e mesmas
  // recusas do laço item a item, com um número fixo de idas ao banco
  // (com 5–10 ms por ida, 200 itens passavam dos 25–30 s da transação).
  const estornos = await estornarEmLote(tx, contexto, {
    empresaId, direcao: op.direcao, itens: mercadorias, dia: /** @type {any} */ (dia),
    documento: { numero: op.documento_referencia ?? op.numero, data: diaDe(op.data_emissao) },
    parceiro: { id: parceiro?.id ?? op.parceiro_id, nome: parceiro?.nome ?? op.parceiro_nome }, origem: { operacaoId: op.id }, numeroMovimento: numeroProvisorio,
    ...(camadaPeloRecalculo ? { camadaPeloRecalculo } : {}),
  });
  if (estornos.length) {
    const ligados = await tx.$executeRaw`UPDATE "OperacaoFinanceiraItem" AS i
      SET movimentacao_estorno_id = v.estorno, "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM unnest(${mercadorias.map((item) => item.id)}::text[], ${estornos}::text[]) AS v(id, estorno)
      WHERE i.cliente_id = ${cli} AND i.id = v.id`;
    if (ligados !== estornos.length) throw new Error(`itens ligados ao estorno: ${ligados} de ${estornos.length}`);
  }
  return estornos;
};

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
        // D-PROD-273 (fatia 4): na VENDA, com outro movimento do produto no depósito depois, o cancelamento recalcula
        // o custo médio do que veio depois (o preço não muda; só o custo derivado do estoque). Prova antes do estorno.
        // Fatia 5: na COMPRA também — a entrada sai da sequência e quem consumiu dela volta a consumir das outras camadas
        // (o valor de compra não muda); saldo negativo em qualquer ponto → 409; sem estorno exato como saída.
        const comMovimento = mercadorias.filter((i) => i.movimentacao_estoque_id);
        const compra = op.direcao === 'PAGAR';
        const planos = comMovimento.length
          ? await planejarExclusaoComRecalculo(tx, cli, { empresaId, movimentos: comMovimento.map((i) => ({ id: i.movimentacao_estoque_id, produtoId: i.produto_id, localId: i.local_estoque_id })), estornoExatoSeInviavel: !compra })
          : [];
        // Sequência de movimentos SÓ no fim (§8.4 item 5): `numerarMovimentos`.
        const estornos = await estornarEfeitosDoDocumento(tx, contexto, {
          cli, empresaId, op, mercadorias, dia: tempo?.hoje, ...(compra ? { camadaPeloRecalculo: planos.flatMap((p) => p.excluirIds) } : {}),
        });
        const recalculo = planos.length
          ? await aplicarExclusaoComRecalculo(tx, contexto, planos, {
            empresaId, origem: ORIGEM_SISTEMA, motivo: [...`Cancelamento do lançamento ${op.numero}: ${motivo}`].slice(0, 255).join(''),
            estornos: new Map(mercadorias.map((i, k) => [i.movimentacao_estoque_id, estornos[k]])),
          })
          : null;
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
          dadosNovos: auditoriaDoc(cancelado, { motivo_informado: true, movimentos_estorno: estornos, titulos_n: titulos.length, recalculo }),
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

// ─── D-PROD-158: elegibilidade, retificação e exclusão lógica ───────────────
/** Tela das ações (as permissões entram como motivo `sem_permissao`, sem máscara). */
const TELA_LANC = TELAS.LANCAMENTOS_FINANCEIROS;
/** Comandos de estoque cujo recibo de idempotência guarda o rateio FIFO por lote (`rateio[].lote_id`). */
const TIPOS_COMANDO_ESTOQUE = Object.freeze(['saida_suplementacao', 'transferencia_locais']);
/** Folga para trás ao procurar recibos: o recibo é reservado ANTES de a baixa esperar a trava do produto. */
const FOLGA_RECIBO_MS = 60 * 60 * 1000;

/** Motivo de bloqueio/restrição: `{ codigo, mensagem, entidade?, id?, numero?, item_ordem?, ... }`. */
const motivoDe = (codigo, mensagem, extra = {}) => ({ codigo, mensagem, ...extra });

/**
 * 409 específico com os motivos; nada é alterado (a transação é desfeita). O
 * tradutor HTTP só expõe `reason` junto de `field`: `field` é o documento
 * (`id`, ou `moeda`) e `reason` o código do primeiro motivo; a lista completa
 * vai em `details.motivos`.
 * @param {'OPERACAO_RETIFICACAO_BLOQUEADA'|'OPERACAO_EXCLUSAO_BLOQUEADA'} code @param {any[]} motivos
 */
const bloqueado = (code, motivos, extra = {}) =>
  new AppError(
    code,
    `${code === 'OPERACAO_RETIFICACAO_BLOQUEADA' ? 'a correção' : 'a exclusão'} deste lançamento não é permitida: ${motivos.map((m) => m.mensagem).join('; ')}; nada foi alterado`,
    { details: { field: 'id', reason: motivos[0]?.codigo ?? 'bloqueado', motivos, ...extra } },
  );
const retificacaoBloqueada = (motivos, extra) => bloqueado('OPERACAO_RETIFICACAO_BLOQUEADA', motivos, extra);
const exclusaoBloqueada = (motivos, extra) => bloqueado('OPERACAO_EXCLUSAO_BLOQUEADA', motivos, extra);

/** Texto cortado em `max` caracteres (pontos de código, como o VARCHAR do PostgreSQL). */
const cortar = (t, max) => [...t].slice(0, max).join('');

/** Permissões do usuário para as ações da elegibilidade (relidas do banco: `carregarAutorizacao`). */
const permissoesDe = (aut) => {
  const pode = (...acoes) => acoes.some((acao) => telaPermite(aut, TELA_LANC, acao));
  return {
    editar: pode('editar', 'salvar'),
    confirmar: pode('confirmar'),
    cancelar: pode('cancelar'),
    excluir: pode('excluir'),
    criar: pode('novo', 'salvar'),
  };
};
const semPermissao = (acao, faltam) =>
  motivoDe('sem_permissao', `você não tem permissão para ${acao} (falta: ${faltam.join(', ')})`, { exige: faltam });

/**
 * Motivo do documento HISTÓRICO (cancelado, excluído ou versão substituída).
 * Na substituição, aponta a versão atual.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} op
 */
const motivoHistorico = async (tx, cli, empresaId, op) => {
  if (op.retificado_em) {
    const ev = await tx.operacaoFinanceiraEvento.findFirst({
      where: { cliente_id: cli, empresa_id: empresaId, operacao_id: op.id, modo: 'SUBSTITUICAO' },
      select: { operacaoNova: { select: { id: true, numero: true } } },
    });
    const nova = ev?.operacaoNova ?? null;
    return motivoDe('documento_historico', `esta é uma versão anterior, substituída por retificação${nova ? ` (versão atual: lançamento nº ${nova.numero})` : ''}; corrija ou exclua a versão atual`,
      nova ? { entidade: 'OperacaoFinanceira', id: nova.id, numero: nova.numero } : {});
  }
  if (op.excluido_em) return motivoDe('documento_historico', 'o lançamento foi excluído; o histórico não muda');
  return motivoDe('documento_historico', 'o lançamento está cancelado; o histórico não muda');
};

/** Dia-instante de uma coluna TIMESTAMP(3) (UTC) para comparar no SQL sem fuso. */
const instanteSql = (d) => d.toISOString().replace('Z', '');

/**
 * D-PROD-158 §3 — PROVA DE PROVENIÊNCIA da compra: a reversão física do item só
 * é permitida se o lote L que ele criou nunca foi tocado por mais ninguém.
 * Inventário dos escritores e das referências a lote cobertos (relatório):
 *  - fatias FIFO de lançamento (`OperacaoFinanceiraConsumoLote`), de QUALQUER
 *    documento e situação (inclusive venda cancelada: a fatia fica);
 *  - movimentos com `lotes_consumidos` (JSON) citando L — saída FIFO do
 *    lançamento e qualquer movimento gravado pelo POST administrativo;
 *  - suplementação e transferência entre locais (baixa FIFO por lote sem
 *    fatia própria): o recibo de idempotência guarda `rateio[].lote_id`;
 *  - estado do lote (`Disponivel`, disponível = entrada = kg do item) e o
 *    movimento de entrada original ainda 'Ativa' e sem filho;
 *  - `updatedAt` = `createdAt` (o Prisma grava os dois iguais na criação); os
 *    únicos escritores benignos são o PATCH de `local_estoque_nome` (renomear o
 *    depósito, de qualquer conta) e a retificação NO_LUGAR do próprio
 *    lançamento que leva a PROCEDÊNCIA (fornecedor e nº do documento) ao lote
 *    (`atualizarProcedencia`, AuditLog `ACAO_PROCEDENCIA_LOTE`): aceito só se
 *    TODO AuditLog de L for um desses e o último explicar o `updatedAt` atual;
 *  - `estoque_atual` do produto ≥ Σ kg a estornar.
 * Um motivo por item (o mais informativo), com o documento/movimento que
 * impede quando se conhece. Só o tenant (as FKs amarram o lote ao tenant).
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any[]} itens  mercadorias do documento
 */
const provaDaCompra = async (tx, cli, empresaId, itens) => {
  /** @type {any[]} */
  const motivos = [];
  const loteIds = unicos(itens.map((i) => i.estoque_lote_nota_id));
  const lotes = new Map((loteIds.length ? await tx.estoqueLoteNota.findMany({ where: { cliente_id: cli, id: { in: loteIds } } }) : []).map((l) => [l.id, l]));
  const consumos = loteIds.length
    ? await tx.operacaoFinanceiraConsumoLote.findMany({
      where: { cliente_id: cli, estoque_lote_nota_id: { in: loteIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { estoque_lote_nota_id: true, item: { select: { operacao: { select: { id: true, numero: true, status: true } } } } },
    })
    : [];
  const desde = [...lotes.values()].reduce((m, l) => Math.min(m, l.createdAt.getTime()), Date.now()) - FOLGA_RECIBO_MS;
  const emMovimentos = /** @type {any[]} */ (loteIds.length
    ? await tx.$queryRaw`SELECT x.lote_id, m.id, m.numero_movimentacao FROM "MovimentacaoEstoque" m
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.lotes_consumidos::jsonb) = 'array' THEN m.lotes_consumidos::jsonb ELSE '[]'::jsonb END) AS e(elem)
        CROSS JOIN LATERAL (SELECT COALESCE(e.elem ->> 'lote_id', e.elem ->> 'estoque_lote_nota_id', e.elem ->> 'lote_nota_id', e.elem #>> '{}') AS lote_id) AS x
        WHERE m.cliente_id = ${cli} AND m.empresa_id = ${empresaId} AND m.lotes_consumidos IS NOT NULL AND x.lote_id = ANY(${loteIds}::text[])
        ORDER BY m."createdAt", m.id`
    : []);
  const emRecibos = /** @type {any[]} */ (loteIds.length
    ? await tx.$queryRaw`SELECT e.elem ->> 'lote_id' AS lote_id, o.tipo_operacao,
          COALESCE(o.response_json -> 'movimentacao' ->> 'id', o.response_json -> 'movimentacao_saida' ->> 'id') AS movimento_id,
          COALESCE(o.response_json -> 'movimentacao' ->> 'numero_movimentacao', o.response_json -> 'movimentacao_saida' ->> 'numero_movimentacao') AS numero
        FROM "OperacaoIdempotente" o
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.response_json::jsonb -> 'rateio') = 'array' THEN o.response_json::jsonb -> 'rateio' ELSE '[]'::jsonb END) AS e(elem)
        WHERE o.cliente_id = ${cli} AND o.tipo_operacao = ANY(${[...TIPOS_COMANDO_ESTOQUE]}::text[]) AND o."createdAt" >= ${instanteSql(new Date(desde))}::timestamp(3)
          AND o.response_json IS NOT NULL AND (e.elem ->> 'lote_id') = ANY(${loteIds}::text[])
        ORDER BY o."createdAt", o.id`
    : []);
  const tocados = [...lotes.values()].filter((l) => l.updatedAt.getTime() !== l.createdAt.getTime());
  const auditorias = tocados.length
    ? await tx.auditLog.findMany({
      where: { cliente_id: cli, entidade: 'EstoqueLoteNota', entidade_id: { in: tocados.map((l) => l.id) } },
      select: { entidade_id: true, acao: true, dados_anteriores: true, dados_novos: true },
    })
    : [];
  /**
   * O AuditLog do lote só mostra escritores benignos — renomeação do local
   * (PATCH) ou procedência levada pela retificação NO_LUGAR — e explica o
   * `updatedAt` atual. Quantidade, situação, local e datas nunca são benignos.
   * Custo no AuditLog também não: a reavaliação do poço (D-PROD-256) é reconhecida
   * à parte, pelo médio vigente + movimento posterior no mesmo produto × local.
   */
  const soBenigno = (l) => {
    const lista = auditorias.filter((a) => a.entidade_id === l.id);
    const permitidas = { update: ['local_estoque_nome'], [ACAO_PROCEDENCIA_LOTE]: CAMPOS_PROCEDENCIA_LOTE };
    const benigno = (a) => {
      const antes = /** @type {any} */ (a.dados_anteriores) ?? {};
      const depois = /** @type {any} */ (a.dados_novos) ?? {};
      const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)]);
      const livres = /** @type {Record<string, readonly string[]>} */ (permitidas)[a.acao];
      return Boolean(livres) && [...chaves].every((k) => k === 'updated_date' || livres.includes(k) || JSON.stringify(antes[k]) === JSON.stringify(depois[k]));
    };
    return lista.length > 0 && lista.every(benigno) && lista.some((a) => /** @type {any} */ (a.dados_novos)?.updated_date === l.updatedAt.toISOString());
  };
  const originalIds = unicos(itens.map((i) => i.movimentacao_estoque_id));
  const originais = new Map((originalIds.length
    ? await tx.movimentacaoEstoque.findMany({ where: { cliente_id: cli, id: { in: originalIds } }, select: { id: true, status: true, movimento_filho_id: true } })
    : []).map((m) => [m.id, m]));
  // D-PROD-256: o motor reavalia o custo das camadas irmãs do poço (sem consumir
  // a quantidade). Isso muda `custo_unitario` e `updatedAt`, mas não é edição.
  // Só aceitamos quando o custo vigente é o médio do poço e houve movimento
  // posterior no mesmo produto × local, além da própria entrada. SQL isolado ou
  // custo diferente do médio continua `lote_alterado`.
  const reavaliacaoDoMotor = new Set();
  if (tocados.length) {
    const chavePoco = (l) => `${l.produto_id}\t${l.local_estoque_id}`;
    const pares = [...new Map(tocados.map((l) => [chavePoco(l), { produto_id: l.produto_id, local_estoque_id: l.local_estoque_id }])).values()];
    const produtosPoco = unicos(pares.map((p) => p.produto_id));
    const locaisPoco = unicos(pares.map((p) => p.local_estoque_id));
    const camadasPoco = await tx.estoqueLoteNota.findMany({
      where: { cliente_id: cli, empresa_id: empresaId, status: 'Disponivel', produto_id: { in: produtosPoco }, local_estoque_id: { in: locaisPoco } },
      select: { produto_id: true, local_estoque_id: true, quantidade_disponivel: true, custo_unitario: true },
    });
    const medioDoPoco = new Map();
    for (const p of pares) {
      const cs = camadasPoco.filter((c) => c.produto_id === p.produto_id && c.local_estoque_id === p.local_estoque_id);
      const q = somar(cs.map((c) => c.quantidade_disponivel));
      const v = somar(cs.map((c) => dec(c.quantidade_disponivel).times(dec(c.custo_unitario))));
      medioDoPoco.set(`${p.produto_id}\t${p.local_estoque_id}`, q.gt(0) ? arredondar(v.dividedBy(q), CASAS_CUSTO) : null);
    }
    const desdePoco = new Date(Math.min(...tocados.map((l) => l.createdAt.getTime())));
    const movimentosPoco = await tx.movimentacaoEstoque.findMany({
      where: {
        cliente_id: cli, empresa_id: empresaId, produto_id: { in: produtosPoco }, createdAt: { gte: desdePoco },
        OR: [{ local_estoque_origem: { in: locaisPoco } }, { local_estoque_destino: { in: locaisPoco } }],
      },
      select: { id: true, produto_id: true, local_estoque_origem: true, local_estoque_destino: true, createdAt: true },
    });
    const entradas = new Set(originalIds);
    for (const l of tocados) {
      const medio = medioDoPoco.get(chavePoco(l));
      if (medio == null || !dec(l.custo_unitario).eq(medio)) continue;
      const posterior = movimentosPoco.some((mv) => mv.produto_id === l.produto_id
        && (mv.local_estoque_origem === l.local_estoque_id || mv.local_estoque_destino === l.local_estoque_id)
        && mv.createdAt.getTime() >= l.createdAt.getTime()
        && !entradas.has(mv.id));
      if (posterior) reavaliacaoDoMotor.add(l.id);
    }
  }
  for (const item of itens) {
    const base = { item_ordem: item.ordem };
    const linha = `linha ${item.ordem}${item.produto_nome ? ` (${item.produto_nome})` : ''}`;
    const l = item.estoque_lote_nota_id ? lotes.get(item.estoque_lote_nota_id) : null;
    if (!l) {
      motivos.push(motivoDe('lote_alterado', `o lote de entrada da ${linha} não existe mais`, base));
      continue;
    }
    const doLote = { ...base, lote_id: l.id };
    const fatia = consumos.find((c) => c.estoque_lote_nota_id === l.id);
    if (fatia) {
      const outro = fatia.item.operacao;
      motivos.push(motivoDe('lote_consumido', `o lote da ${linha} foi consumido pelo lançamento nº ${outro.numero}${outro.status === 'CANCELADO' ? ' (mesmo cancelado, a venda já o consumiu)' : ''}`,
        { ...doLote, entidade: 'OperacaoFinanceira', id: outro.id, numero: outro.numero }));
      continue;
    }
    const mov = emMovimentos.find((m) => m.lote_id === l.id);
    if (mov) {
      motivos.push(motivoDe('lote_consumido', `o lote da ${linha} é citado pelo movimento de estoque nº ${mov.numero_movimentacao}`,
        { ...doLote, entidade: 'MovimentacaoEstoque', id: mov.id, numero: mov.numero_movimentacao }));
      continue;
    }
    const recibo = emRecibos.find((r) => r.lote_id === l.id);
    if (recibo) {
      const oque = recibo.tipo_operacao === 'saida_suplementacao' ? 'pela suplementação' : 'pela transferência entre locais';
      motivos.push(motivoDe('lote_consumido', `o lote da ${linha} foi baixado ${oque}${recibo.numero ? ` (movimento nº ${recibo.numero})` : ''}`,
        { ...doLote, entidade: 'MovimentacaoEstoque', ...(recibo.movimento_id ? { id: recibo.movimento_id } : {}), ...(recibo.numero ? { numero: recibo.numero } : {}) }));
      continue;
    }
    const entrada = dec(l.quantidade_entrada);
    const disponivel = dec(l.quantidade_disponivel);
    const kg = dec(item.quantidade_estoque);
    if (l.status !== 'Disponivel' || !disponivel.eq(entrada) || !entrada.eq(kg)) {
      const consumido = ['Disponivel', 'Esgotado'].includes(l.status) && disponivel.lt(entrada);
      motivos.push(motivoDe(consumido ? 'lote_consumido' : 'lote_alterado',
        `o lote da ${linha} ${consumido ? 'já foi consumido' : 'foi alterado'} (situação ${l.status}, disponível ${disponivel.toFixed(CASAS_QUANTIDADE)} de ${entrada.toFixed(CASAS_QUANTIDADE)} kg)`, doLote));
      continue;
    }
    const original = originais.get(item.movimentacao_estoque_id);
    if (!original || original.status !== 'Ativa' || original.movimento_filho_id) {
      motivos.push(motivoDe('lote_alterado', `o movimento de entrada da ${linha} foi alterado ou estornado`, { ...doLote, entidade: 'MovimentacaoEstoque', ...(original ? { id: original.id } : {}) }));
      continue;
    }
    if (l.updatedAt.getTime() !== l.createdAt.getTime() && !soBenigno(l) && !reavaliacaoDoMotor.has(l.id)) {
      motivos.push(motivoDe('lote_alterado', `o lote da ${linha} foi alterado depois da entrada`, doLote));
    }
  }
  // `estoque_atual` do produto ≥ Σ kg a estornar (o estorno em lote recusaria).
  /** @type {Map<string, any>} */
  const porProduto = new Map();
  for (const i of itens) porProduto.set(i.produto_id, (porProduto.get(i.produto_id) ?? ZERO).plus(dec(i.quantidade_estoque)));
  const produtos = porProduto.size
    ? await tx.produto.findMany({ where: { cliente_id: cli, id: { in: [...porProduto.keys()] } }, select: { id: true, nome_produto: true, estoque_atual: true } })
    : [];
  for (const p of produtos) {
    const kg = porProduto.get(p.id);
    if (dec(p.estoque_atual).lt(kg)) {
      motivos.push(motivoDe('estoque_atual_insuficiente', `o estoque atual de ${p.nome_produto} (${dec(p.estoque_atual).toFixed(CASAS_QUANTIDADE)} kg) é menor que a compra a estornar (${kg.toFixed(CASAS_QUANTIDADE)} kg)`,
        { entidade: 'Produto', id: p.id }));
    }
  }
  return motivos;
};

/**
 * D-PROD-158 §3 — prova da VENDA: os lotes das fatias aceitam a devolução
 * (como o cancelamento: situação, entrada e soma), não há movimento da MESMA
 * empresa + produto + local POSTERIOR ao movimento original (exceto os do
 * próprio documento) e nenhuma fatia de OUTRO documento consumiu esses lotes
 * depois da venda. "Posterior" falha fechado pela UNIÃO de dois relógios:
 * `createdAt` maior ou igual (empate conta) OU número de movimento maior (os
 * escritores do protocolo numeram sob a trava do produto, então o número segue
 * a ordem real mesmo com relógios diferentes entre instâncias).
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} op @param {any[]} itens  mercadorias com `consumos`
 */
const provaDaVenda = async (tx, cli, empresaId, op, itens) => {
  /** @type {any[]} */
  const motivos = [];
  const loteIds = unicos(itens.flatMap((i) => (i.consumos ?? []).map((c) => c.estoque_lote_nota_id)));
  const lotes = new Map((loteIds.length ? await tx.estoqueLoteNota.findMany({ where: { cliente_id: cli, id: { in: loteIds } } }) : [])
    .map((l) => [l.id, { status: l.status, disp: dec(l.quantidade_disponivel), entrada: dec(l.quantidade_entrada) }]));
  /** @type {Set<number>} */
  const comMotivo = new Set();
  for (const item of itens) {
    const linha = `linha ${item.ordem}${item.produto_nome ? ` (${item.produto_nome})` : ''}`;
    const devolvido = somar((item.consumos ?? []).map((c) => c.quantidade));
    if (!devolvido.eq(dec(item.quantidade_estoque))) {
      motivos.push(motivoDe('lote_alterado', `as fatias FIFO da ${linha} não somam a quantidade do item`, { item_ordem: item.ordem }));
      comMotivo.add(item.ordem);
      continue;
    }
    for (const c of item.consumos ?? []) {
      const l = lotes.get(c.estoque_lote_nota_id);
      const novo = l ? l.disp.plus(dec(c.quantidade)) : null;
      if (!l || !['Disponivel', 'Esgotado'].includes(l.status) || /** @type {any} */ (novo).gt(l.entrada)) {
        motivos.push(motivoDe('lote_alterado', `um lote da ${linha} não pode receber a devolução (situação ${l?.status ?? 'inexistente'})`, { item_ordem: item.ordem, lote_id: c.estoque_lote_nota_id }));
        comMotivo.add(item.ordem);
        break;
      }
      Object.assign(l, { status: 'Disponivel', disp: novo });
    }
  }
  const proprios = unicos(itens.flatMap((i) => [i.movimentacao_estoque_id, i.movimentacao_estorno_id]));
  const originais = new Map((proprios.length
    ? await tx.movimentacaoEstoque.findMany({ where: { cliente_id: cli, id: { in: proprios } }, select: { id: true, createdAt: true, numero_movimentacao: true } })
    : []).map((m) => [m.id, m]));
  const consultar = itens.filter((i) => originais.has(i.movimentacao_estoque_id));
  const posteriores = /** @type {any[]} */ (consultar.length
    ? await tx.$queryRaw`SELECT DISTINCT ON (v.ordem) v.ordem, m.id, m.numero_movimentacao
        FROM unnest(${consultar.map((i) => i.ordem)}::int[], ${consultar.map((i) => i.produto_id)}::text[], ${consultar.map((i) => i.local_estoque_id)}::text[],
          ${consultar.map((i) => instanteSql(/** @type {any} */ (originais.get(i.movimentacao_estoque_id)).createdAt))}::text[],
          ${consultar.map((i) => i.movimentacao_estoque_id)}::text[],
          ${consultar.map((i) => /** @type {any} */ (originais.get(i.movimentacao_estoque_id)).numero_movimentacao)}::text[]) AS v(ordem, produto_id, local_id, instante, original_id, numero)
        JOIN "MovimentacaoEstoque" m ON m.cliente_id = ${cli} AND m.empresa_id = ${empresaId} AND m.produto_id = v.produto_id
          AND (m.local_estoque_origem = v.local_id OR m.local_estoque_destino = v.local_id)
          AND (m."createdAt" > v.instante::timestamp(3) OR (m."createdAt" = v.instante::timestamp(3) AND m.id <> v.original_id)
            OR (m.numero_movimentacao ~ '^[0-9]{1,18}$' AND v.numero ~ '^[0-9]{1,18}$' AND m.numero_movimentacao::numeric > v.numero::numeric))
          AND NOT (m.id = ANY(${proprios}::text[]))
          -- D-PROD-273 (fatia 4): o par excluído com recálculo está fora da sequência (a regra de movimentoPosterior.js).
          AND NOT starts_with(COALESCE(m.movimentacao_grupo_id, ''), ${MARCA_EXCLUSAO_RECALCULO})
        ORDER BY v.ordem, m."createdAt", m.id`
    : []);
  for (const p of posteriores) {
    if (comMotivo.has(p.ordem)) continue;
    const item = itens.find((i) => i.ordem === p.ordem);
    motivos.push(motivoDe('venda_com_movimento_posterior',
      `há o movimento de estoque nº ${p.numero_movimentacao} depois da venda no mesmo produto e local (linha ${p.ordem}${item?.produto_nome ? `, ${item.produto_nome}` : ''})`,
      { item_ordem: p.ordem, entidade: 'MovimentacaoEstoque', id: p.id, numero: p.numero_movimentacao }));
    comMotivo.add(p.ordem);
  }
  const primeiraFatia = itens.flatMap((i) => i.consumos ?? []).reduce((m, c) => Math.min(m, c.createdAt.getTime()), Number.POSITIVE_INFINITY);
  const outras = loteIds.length && Number.isFinite(primeiraFatia)
    ? await tx.operacaoFinanceiraConsumoLote.findMany({
      where: { cliente_id: cli, empresa_id: empresaId, estoque_lote_nota_id: { in: loteIds }, item: { operacao_id: { not: op.id } }, createdAt: { gte: new Date(primeiraFatia) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { estoque_lote_nota_id: true, item: { select: { operacao: { select: { id: true, numero: true } } } } },
    })
    : [];
  for (const o of outras) {
    const item = itens.find((i) => !comMotivo.has(i.ordem) && (i.consumos ?? []).some((c) => c.estoque_lote_nota_id === o.estoque_lote_nota_id));
    if (!item) continue;
    motivos.push(motivoDe('venda_com_movimento_posterior', `um lote da linha ${item.ordem} foi consumido depois da venda pelo lançamento nº ${o.item.operacao.numero}`,
      { item_ordem: item.ordem, lote_id: o.estoque_lote_nota_id, entidade: 'OperacaoFinanceira', id: o.item.operacao.id, numero: o.item.operacao.numero }));
    comMotivo.add(item.ordem);
  }
  return motivos.sort((a, b) => (a.item_ordem ?? 0) - (b.item_ordem ?? 0));
};

/**
 * Dependência física do documento confirmado: motivos que impedem REVERTER o
 * efeito de estoque (vazio = `efeito_fisico_permitido`). Sem mercadoria → vazio.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} op @param {any[]} mercadorias  itens MERCADORIA com `consumos`
 */
const dependenciaFisica = async (tx, cli, empresaId, op, mercadorias) => {
  if (!mercadorias.length) return [];
  return op.direcao === 'PAGAR' ? provaDaCompra(tx, cli, empresaId, mercadorias) : provaDaVenda(tx, cli, empresaId, op, mercadorias);
};

/** Mercadorias do documento (com as fatias), em ordem. */
const lerMercadorias = (tx, cli, operacaoId) =>
  tx.operacaoFinanceiraItem.findMany({ where: { cliente_id: cli, operacao_id: operacaoId, tipo_item: 'MERCADORIA' }, orderBy: { ordem: 'asc' }, include: { consumos: true } });

/**
 * D-PROD-158 §3 — elegibilidade de fonte ÚNICA. O GET chama em REPEATABLE READ
 * sem trava; os comandos chamam DEPOIS das travas (cabeçalho → produtos →
 * títulos), então a resposta é a mesma regra no mesmo estado que vão alterar.
 *  - RASCUNHO: editar RASCUNHO, excluir DESCARTE (como hoje);
 *  - CONFIRMADO sem liquidação: editar RETIFICACAO (`efeito_fisico_permitido`
 *    pela prova de proveniência; os motivos da restrição física vêm em
 *    `editar.motivos` mesmo com `permitido`), excluir LOGICA só se a reversão
 *    física for permitida;
 *  - com QUALQUER liquidação (ativa ou estornada): editar e excluir bloqueados;
 *  - cancelado/excluído/retificado: bloqueados (`documento_historico`);
 *  - duplicar: sempre que o usuário puder criar.
 * `permitido` é a decisão; `modo` só existe quando permitido.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} op  linha do cabeçalho
 * @param {{ aut: any, mercadorias?: any[] }} opcoes  autorização relida; mercadorias já lidas (com `consumos`)
 */
export const avaliarElegibilidade = async (tx, cli, empresaId, op, opcoes) => {
  const pode = permissoesDe(opcoes.aut);
  const rascunho = op.status === 'RASCUNHO';
  // Mesmas ações das guardas das rotas: PUT/DELETE do rascunho = editar; retificar = editar + confirmar; excluir = cancelar + excluir.
  const faltam = (pares) => pares.filter(([ok]) => !ok).map(([, acao]) => acao);
  const faltaEditar = rascunho ? faltam([[pode.editar, 'editar']]) : faltam([[pode.editar, 'editar'], [pode.confirmar, 'confirmar']]);
  const faltaExcluir = rascunho ? faltam([[pode.editar, 'editar']]) : faltam([[pode.cancelar, 'cancelar'], [pode.excluir, 'excluir']]);
  const me = faltaEditar.length ? [semPermissao(rascunho ? 'editar o rascunho' : 'corrigir lançamento confirmado', faltaEditar)] : [];
  const mx = faltaExcluir.length ? [semPermissao(rascunho ? 'descartar o rascunho' : 'excluir lançamento confirmado', faltaExcluir)] : [];
  const duplicar = { permitido: pode.criar, motivos: pode.criar ? [] : [semPermissao('duplicar (criar lançamento)', ['novo'])] };
  const resposta = (editar, excluir) => ({ id: op.id, versao: op.versao, status: op.status, editar, excluir, duplicar });
  if (rascunho) {
    return resposta(
      { permitido: !me.length, modo: me.length ? null : 'RASCUNHO', efeito_fisico_permitido: true, motivos: me },
      { permitido: !mx.length, modo: mx.length ? null : 'DESCARTE', motivos: mx },
    );
  }
  if (op.status !== 'CONFIRMADO' || op.excluido_em || op.retificado_em) {
    const historico = await motivoHistorico(tx, cli, empresaId, op);
    return resposta(
      { permitido: false, modo: null, efeito_fisico_permitido: false, motivos: [historico, ...me] },
      { permitido: false, modo: null, motivos: [historico, ...mx] },
    );
  }
  const liquidacoes = await tx.liquidacaoFinanceira.findMany({
    where: { cliente_id: cli, empresa_id: empresaId, titulo: { operacao_id: op.id } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, titulo: { select: { numero_parcela: true } }, estornos: { select: { id: true }, take: 1 } },
  });
  const comLiquidacao = liquidacoes.map((l) => {
    const estornada = l.estornos.length > 0;
    return motivoDe('tem_liquidacao', `a parcela ${l.titulo.numero_parcela} tem liquidação registrada${estornada ? ' (já estornada)' : ''}; lançamento com baixa não é corrigido nem excluído`,
      { entidade: 'LiquidacaoFinanceira', id: l.id, numero_parcela: l.titulo.numero_parcela, estornada });
  });
  const mercadorias = opcoes.mercadorias ?? await lerMercadorias(tx, cli, op.id);
  const fisicos = await dependenciaFisica(tx, cli, empresaId, op, mercadorias);
  const bloqueiosEditar = [...comLiquidacao, ...me];
  const bloqueiosExcluir = [...comLiquidacao, ...fisicos, ...mx];
  return resposta(
    { permitido: !bloqueiosEditar.length, modo: bloqueiosEditar.length ? null : 'RETIFICACAO', efeito_fisico_permitido: !fisicos.length, motivos: [...bloqueiosEditar, ...fisicos] },
    { permitido: !bloqueiosExcluir.length, modo: bloqueiosExcluir.length ? null : 'LOGICA', motivos: bloqueiosExcluir },
  );
};

/** GET da elegibilidade: REPEATABLE READ, sem trava de escrita; outro tenant/empresa → 404. */
export const elegibilidade = async (contexto, id, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  return emTransacao(TX_LEITURA, async (tx) => {
    const empresaId = await exigirEmpresaDoTenant(tx, cli, query.empresa_id);
    const op = await tx.operacaoFinanceira.findUnique({ where: { cliente_id_id: { cliente_id: cli, id } } });
    if (!op || op.empresa_id !== empresaId) throw naoEncontrado();
    return avaliarElegibilidade(tx, cli, empresaId, op, { aut: await carregarAutorizacao(contexto, tx) });
  });
};

/**
 * Snapshot verificável da versão anterior (só registro histórico; nenhuma regra
 * o lê): cabeçalho, itens com ids de movimento/lote/estorno e fatias, rateios
 * geral e por item, títulos. Decimais em texto na escala da coluna.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {any} op
 */
const montarSnapshot = async (tx, cli, empresaId, op) => {
  const w = { cliente_id: cli, operacao_id: op.id };
  const itens = await tx.operacaoFinanceiraItem.findMany({ where: w, orderBy: { ordem: 'asc' }, include: { consumos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
  const rateios = await tx.operacaoFinanceiraRateio.findMany({ where: w, orderBy: { ordem: 'asc' } });
  const itemRateios = await lerItemRateios(tx, cli, empresaId, op.id);
  const titulos = await tx.tituloFinanceiro.findMany({ where: w, orderBy: { numero_parcela: 'asc' } });
  const t = (v, casas) => (v === null || v === undefined ? null : texto(v, casas));
  const linha = (r) => ({
    id: r.id, ordem: r.ordem, natureza_id: r.natureza_id, natureza_nome: r.natureza_nome, natureza_tipo: r.natureza_tipo,
    centro_custo_id: r.centro_custo_id ?? null, centro_custo_nome: r.centro_custo_nome ?? null, centro_resultado_id: r.centro_resultado_id ?? null,
    centro_resultado_nome: r.centro_resultado_nome ?? null, percentual: t(r.percentual, CASAS_PERCENTUAL), valor: t(r.valor, 4),
  });
  return {
    cabecalho: {
      id: op.id, numero: op.numero, status: op.status, versao: op.versao, empresa_id: op.empresa_id, direcao: op.direcao, conteudo: op.conteudo,
      condicao: op.condicao, parceiro_id: op.parceiro_id, parceiro_nome: op.parceiro_nome, descricao: op.descricao ?? null,
      documento_referencia: op.documento_referencia ?? null, data_emissao: diaDe(op.data_emissao), data_operacional: diaDe(op.data_operacional),
      moeda: op.moeda, moeda_casas: op.moeda_casas, valor_bruto: t(op.valor_bruto, 4), valor_desconto: t(op.valor_desconto, 4),
      valor_acrescimo: t(op.valor_acrescimo, 4), valor_total: t(op.valor_total, 4), rateio_modo: op.rateio_modo, rateio_escopo: op.rateio_escopo ?? null,
      metodo_preferido: op.metodo_preferido ?? null, criado_por_usuario_id: op.criado_por_usuario_id ?? null,
      confirmado_por_usuario_id: op.confirmado_por_usuario_id ?? null, confirmado_em: isoDe(op.confirmado_em),
    },
    itens: itens.map((i) => ({
      id: i.id, ordem: i.ordem, tipo_item: i.tipo_item, produto_id: i.produto_id ?? null, produto_nome: i.produto_nome ?? null, descricao: i.descricao ?? null,
      local_estoque_id: i.local_estoque_id ?? null, local_estoque_nome: i.local_estoque_nome ?? null, unidade: i.unidade,
      quantidade: t(i.quantidade, CASAS_QUANTIDADE), fator_kg: t(i.fator_kg, CASAS_QUANTIDADE), quantidade_estoque: t(i.quantidade_estoque, CASAS_QUANTIDADE),
      valor_unitario: t(i.valor_unitario, CASAS_PRECO), valor_total: t(i.valor_total, 4), valor_desconto_rateado: t(i.valor_desconto_rateado, 4),
      valor_acrescimo_rateado: t(i.valor_acrescimo_rateado, 4), valor_liquido: t(i.valor_liquido, 4),
      movimentacao_estoque_id: i.movimentacao_estoque_id ?? null, estoque_lote_nota_id: i.estoque_lote_nota_id ?? null,
      movimentacao_estorno_id: i.movimentacao_estorno_id ?? null,
      consumos: i.consumos.map((c) => ({ id: c.id, estoque_lote_nota_id: c.estoque_lote_nota_id, quantidade: t(c.quantidade, CASAS_QUANTIDADE), custo_unitario: t(c.custo_unitario, CASAS_CUSTO) })),
      rateios: itemRateios.filter((r) => r.item_id === i.id).sort((a, b) => a.ordem - b.ordem).map(linha),
    })),
    rateios: rateios.map(linha),
    titulos: titulos.map((x) => ({
      id: x.id, numero_parcela: x.numero_parcela, total_parcelas: x.total_parcelas, vencimento: diaDe(x.vencimento), moeda: x.moeda,
      valor: t(x.valor, 4), valor_liquidado: t(x.valor_liquidado, 4), status: x.status,
    })),
  };
};

/**
 * Assinatura FÍSICA do documento (§4.5): direção, dia operacional e, por item
 * MERCADORIA, (ordem, tipo, produto, local, unidade, quantidade, kg, fator) e,
 * só na compra, o líquido (custo do lote). Igual → NO_LUGAR; diferente →
 * SUBSTITUIÇÃO. A quantidade digitada também entra (mais conservador: kg igual
 * com quantidade diferente nunca é revisado no lugar).
 * @param {string} direcao @param {string|null} dataOperacional @param {any[]} itens  do banco ou do plano
 */
const assinaturaFisica = (direcao, dataOperacional, itens) => JSON.stringify({
  direcao,
  data_operacional: dataOperacional ?? null,
  itens: itens.filter((i) => i.tipo_item === 'MERCADORIA').sort((a, b) => a.ordem - b.ordem).map((i) => [
    i.ordem, i.tipo_item, i.produto_id, i.local_estoque_id, i.unidade, texto(i.quantidade, CASAS_QUANTIDADE), texto(i.quantidade_estoque, CASAS_QUANTIDADE),
    texto(i.fator_kg, CASAS_QUANTIDADE), direcao === 'PAGAR' ? texto(i.valor_liquido, 4) : null,
  ]),
});

/**
 * O documento sob trava é CONFIRMADO e vigente; RASCUNHO → 409 de situação (o
 * rascunho usa PUT/DELETE); histórico → 409 específico (`documento_historico`).
 */
const exigirVigente = async (tx, cli, empresaId, op, erro) => {
  if (op.status === 'RASCUNHO') throw statusInvalido(op.status, 'CONFIRMADO');
  if (op.status !== 'CONFIRMADO' || op.excluido_em || op.retificado_em) throw erro([await motivoHistorico(tx, cli, empresaId, op)]);
};

/**
 * Produtos a travar (§8.4): os do documento antigo e os do corpo novo que são
 * DESTA empresa (um id de outra empresa no corpo é recusado depois pelas
 * referências, sem travar a linha alheia). Ordem crescente (`travarProdutosEstoque`).
 */
const produtosATravar = async (tx, cli, empresaId, antigos, novos) => {
  const candidatos = unicos(novos).filter((p) => !antigos.includes(p));
  const daEmpresa = candidatos.length
    ? (await tx.produto.findMany({ where: { cliente_id: cli, empresa_id: empresaId, id: { in: candidatos } }, select: { id: true } })).map((p) => p.id)
    : [];
  return unicos([...antigos, ...daEmpresa]);
};

/** Chave da trava do documento de referência (mesma da confirmação). */
const exigirDocumentoUnico = async (tx, cli, empresaId, doc, ignorar) => {
  if (!doc.documento_referencia) return;
  await travarEscopo(tx, chaveDocumento(cli, { empresa_id: empresaId, direcao: doc.direcao, parceiro_id: doc.parceiro_id, documento_referencia: doc.documento_referencia }));
  const dup = await tx.operacaoFinanceira.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, direcao: doc.direcao, parceiro_id: doc.parceiro_id, documento_chave_ativa: doc.documento_referencia, NOT: { id: ignorar } },
    select: { id: true, numero: true },
  });
  if (dup) throw documentoDuplicado({ operacao_id: dup.id, numero: dup.numero });
};

/**
 * D-PROD-158 (revisão DE-01): na retificação, o peso por saco de um produto que
 * o documento JÁ tinha em SACO é o GRAVADO no item (`fator_kg` do recebimento),
 * não o do cadastro atual — o saco recebido não muda de peso porque o cadastro
 * mudou depois. Sem isso, uma correção só informativa replanejava o kg com o
 * peso novo e virava SUBSTITUIÇÃO (outro kg e outro custo por kg no estoque) ou
 * 409 com o lote consumido; e um produto que passou a ser medido em KG recusava
 * a linha já recebida (`unidade_invalida`). Produto que entra no documento pela
 * primeira vez usa o peso atual. É a mesma regra da tela (`comPesoGravado` em
 * `lancamentoModelo`). Para corrigir o kg de fato recebido, a linha usa KG.
 * Num documento, todas as linhas SACO de um produto têm o mesmo fator (a
 * confirmação planeja todas com o mesmo peso; esta regra preserva isso).
 * @param {any} refs  de `carregarReferencias` @param {any[]} mercadorias  itens MERCADORIA gravados, por ordem
 */
const comPesoGravado = (refs, mercadorias) => {
  /** @type {Map<string, any>} */
  const gravado = new Map();
  for (const i of mercadorias) {
    if (i.unidade === 'SACO' && i.produto_id && i.fator_kg != null && !gravado.has(i.produto_id)) gravado.set(i.produto_id, i.fator_kg);
  }
  if (!gravado.size) return refs;
  const produtos = new Map([...refs.produtos].map(([id, p]) => [id, gravado.has(id) ? { ...p, unidade_principal_estoque: 'SACO', peso_por_saco_kg: gravado.get(id) } : p]));
  return { ...refs, produtos };
};

/**
 * D-PROD-158 (revisão DE-02/BC-01): no NO_LUGAR, parceiro, nº do documento e
 * emissão trocados chegam aos registros físicos ORIGINAIS, que guardam cópias
 * deles (lote: fornecedor e nº; movimento: fornecedor/cliente, nº e data do
 * documento). Sem isso a procedência do lote contradizia o lançamento, uma
 * transferência posterior copiava o fornecedor velho e o par original/estorno
 * saía com parceiros diferentes. Mesmos ids; quantidade, custo e situação
 * intactos. Cada lote gravado ganha um AuditLog `ACAO_PROCEDENCIA_LOTE` — o
 * escritor benigno que a prova de procedência aceita. Sem mercadoria ou sem
 * troca desses campos: nada.
 * @param {any} tx @param {any} contexto
 * @param {{ op: any, doc: any, refs: any, mercadorias: any[] }} a
 */
const levarProcedencia = async (tx, contexto, { op, doc, refs, mercadorias }) => {
  const trocou = op.parceiro_id !== doc.parceiro_id || (op.documento_referencia ?? null) !== (doc.documento_referencia ?? null)
    || diaDe(op.data_emissao) !== doc.data_emissao;
  if (!mercadorias.length || !trocou) return { movimentos: 0, lotes: 0 };
  const movimentoIds = unicos(mercadorias.map((i) => i.movimentacao_estoque_id));
  const lotes = await atualizarProcedencia(tx, contexto, {
    direcao: op.direcao, loteIds: mercadorias.map((i) => i.estoque_lote_nota_id), movimentoIds,
    documento: { numero: doc.documento_referencia ?? op.numero, data: doc.data_emissao }, parceiro: { id: refs.parceiro.id, nome: refs.parceiro.nome },
  });
  const publico = (l) => ({
    operacao_id: op.id, fornecedor_id: l.fornecedor_id, fornecedor_nome: l.fornecedor_nome, numero_documento: l.numero_documento, updated_date: l.updatedAt.toISOString(),
  });
  await registrarEventosEmLote(contexto, lotes.map(({ antes, depois }) => ({
    acao: ACAO_PROCEDENCIA_LOTE, entidade: 'EstoqueLoteNota', entidadeId: antes.id, dadosAnteriores: publico(antes), dadosNovos: publico(depois),
  })), tx);
  return { movimentos: movimentoIds.length, lotes: lotes.length };
};

/**
 * POST /operacoes-financeiras/:id/retificar (§4). Uma transação (TX_EFEITO) e
 * idempotência por `operation_id` (fingerprint canônico do corpo):
 *  1. trava o cabeçalho; CONFIRMADO vigente; `versao` do corpo;
 *  2. normaliza, trava produtos (antigo ∪ novo) e títulos, carrega e exige as
 *     referências e replaneja com o planejador ÚNICO; moeda do perfil = do documento;
 *  3. elegibilidade sob trava (liquidação → 409 com os motivos);
 *  4. assinatura física igual → NO_LUGAR; diferente → exige a reversão física
 *     permitida e faz a SUBSTITUIÇÃO (estorno + documento novo com o mesmo número);
 *  5. evento com snapshot + AuditLog; movimentos numerados no fim.
 * Resposta: detalhe do documento ATUAL + `retificacao` + `replay`.
 */
export const retificar = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const { operation_id: operationKey, ...entrada } = corpo;
  const fingerprint = fingerprintDePayload(canonico({ id, ...entrada }));
  const r = await emTransacao(
    TX_EFEITO,
    (tx) =>
      executarComIdempotencia(tx, {
        clienteId: cli,
        operationKey,
        tipoOperacao: TIPO_RETIFICAR,
        fingerprint,
        executar: async () => {
          const { versao, motivo: motivoInformado, ...documento } = entrada;
          const empresaId = await exigirEmpresaDoTenant(tx, cli, documento.empresa_id);
          const motivo = motivoObrigatorio(motivoInformado);
          const op = await travarCabecalho(tx, cli, empresaId, id, 'UPDATE');
          await exigirVigente(tx, cli, empresaId, op, retificacaoBloqueada);
          if (op.versao !== versao) throw versaoConflito(op.versao, versao);
          const perfil = await lerPerfil(tx, cli, empresaId);
          if (perfil.moeda !== op.moeda) {
            throw retificacaoBloqueada([motivoDe('moeda_mudou', `a moeda do perfil da empresa (${perfil.moeda}) não é a do lançamento (${op.moeda})`)], {
              field: 'moeda', moeda_documento: op.moeda, moeda_perfil: perfil.moeda,
            });
          }
          const casas = op.moeda_casas;
          const doc = normalizarDocumento({ ...documento, empresa_id: empresaId }, casas);
          const w = { cliente_id: cli, operacao_id: id };
          const itens = await tx.operacaoFinanceiraItem.findMany({ where: w, orderBy: { ordem: 'asc' }, include: { consumos: true } });
          const mercadorias = itens.filter((i) => i.tipo_item === 'MERCADORIA');
          // §8.4: cabeçalho → produtos (antigo ∪ novo, crescente) → títulos → lotes/movimentos (motor) → sequências.
          await travarProdutosEstoque(tx, cli, empresaId,
            await produtosATravar(tx, cli, empresaId, unicos(mercadorias.map((i) => i.produto_id)), doc.itens.map((i) => i.produto_id)));
          await travarTitulos(tx, cli, id);
          // DE-01: produto que o documento já tinha em SACO replaneja com o peso GRAVADO (o do recebimento).
          const refs = comPesoGravado(await carregarReferencias(tx, cli, empresaId, doc), mercadorias);
          exigirReferencias(doc, refs, perfil);
          const plano = planejarOperacao(doc, { casas, moeda: op.moeda, produtos: refs.produtos });
          const eleg = await avaliarElegibilidade(tx, cli, empresaId, op, { aut: await carregarAutorizacao(contexto, tx), mercadorias });
          if (!eleg.editar.permitido) throw retificacaoBloqueada(eleg.editar.motivos);
          await exigirDocumentoUnico(tx, cli, empresaId, doc, id);
          await exigirDocumentoForaDeEntradaManual(tx, cli, empresaId, doc.documento_referencia, plano);
          const snapshot = await montarSnapshot(tx, cli, empresaId, op);
          const modo = assinaturaFisica(op.direcao, diaDe(op.data_operacional), itens) === assinaturaFisica(doc.direcao, doc.data_operacional, plano.itens)
            ? 'NO_LUGAR'
            : 'SUBSTITUICAO';
          const agora = new Date();
          const evento = (extra) => ({
            cliente_id: cli, empresa_id: empresaId, operacao_id: id, tipo: 'RETIFICACAO', numero_original: op.numero, versao_anterior: op.versao,
            versao_nova: op.versao + 1, motivo, usuario_id: auth.usuarioId, snapshot_anterior: snapshot, ...extra,
          });
          if (modo === 'NO_LUGAR') {
            // Sem efeito físico: as linhas de mercadoria ficam (com os movimentos); serviço, rateios e títulos são recriados.
            await exigirLinhasDoDocumento(tx, cli, empresaId, id);
            await tx.tituloFinanceiro.deleteMany({ where: w });
            await tx.operacaoFinanceiraRateio.deleteMany({ where: w });
            await tx.operacaoFinanceiraItemRateio.deleteMany({ where: { ...w, empresa_id: empresaId } });
            await tx.operacaoFinanceiraItem.deleteMany({ where: { ...w, tipo_item: { not: 'MERCADORIA' } } });
            const atualizado = await tx.operacaoFinanceira.update({
              where: { cliente_id_id: { cliente_id: cli, id } },
              data: { ...camposDoCabecalho(doc, plano, refs), documento_chave_ativa: doc.documento_referencia, versao: { increment: 1 } },
            });
            const porOrdem = new Map(mercadorias.map((i) => [i.ordem, i]));
            const mantidas = plano.itens.filter((i) => i.tipo_item === 'MERCADORIA');
            if (mantidas.length) {
              const col = (f) => mantidas.map(f);
              const n = await tx.$executeRaw`UPDATE "OperacaoFinanceiraItem" AS i
                SET valor_unitario = v.vu::numeric, valor_total = v.vt::numeric, valor_desconto_rateado = v.d::numeric, valor_acrescimo_rateado = v.a::numeric,
                  valor_liquido = v.l::numeric, produto_nome = v.pn, local_estoque_nome = v.ln, descricao = v.de, "updatedAt" = (now() AT TIME ZONE 'UTC')
                FROM unnest(${col((i) => /** @type {any} */ (porOrdem.get(i.ordem)).id)}::text[], ${col((i) => paraBanco(i.valor_unitario, CASAS_PRECO))}::text[],
                  ${col((i) => paraBanco(i.valor_total, 4))}::text[], ${col((i) => paraBanco(i.valor_desconto_rateado, 4))}::text[],
                  ${col((i) => paraBanco(i.valor_acrescimo_rateado, 4))}::text[], ${col((i) => paraBanco(i.valor_liquido, 4))}::text[],
                  ${col((i) => refs.produtos.get(i.produto_id)?.nome_produto ?? /** @type {any} */ (porOrdem.get(i.ordem)).produto_nome)}::text[],
                  ${col((i) => refs.locais.get(i.local_estoque_id)?.nome ?? /** @type {any} */ (porOrdem.get(i.ordem)).local_estoque_nome)}::text[],
                  ${col((i) => i.descricao ?? null)}::text[]) AS v(id, vu, vt, d, a, l, pn, ln, de)
                WHERE i.cliente_id = ${cli} AND i.id = v.id AND i.operacao_id = ${id}`;
              if (n !== mantidas.length) throw new Error(`linhas de mercadoria atualizadas: ${n} de ${mantidas.length}`);
            }
            await gravarFilhos(tx, cli, atualizado, plano, refs, { mantidos: new Map(mantidas.map((i) => [i.ordem, /** @type {any} */ (porOrdem.get(i.ordem)).id])), statusTitulos: 'ABERTO' });
            // DE-02/BC-01: parceiro/nº/emissão trocados chegam ao lote e ao movimento originais (mesmos ids).
            const procedencia = await levarProcedencia(tx, contexto, { op, doc, refs, mercadorias });
            await tx.operacaoFinanceiraEvento.create({ data: evento({ modo: 'NO_LUGAR', operacao_nova_id: null }) });
            await registrarEvento(contexto, {
              acao: 'operacao_financeira.retificar', entidade: ENTIDADE, entidadeId: id,
              dadosNovos: auditoriaDoc(atualizado, { ...contagens(plano), modo, operacao_anterior_id: id, operacao_atual_id: id, motivo_informado: true, procedencia }),
            }, tx);
            const retificacao = { modo, operacao_anterior_id: id, operacao_atual_id: id };
            return { httpStatus: 200, body: { ...(await carregarDetalhe(tx, cli, id)), retificacao } };
          }
          // SUBSTITUIÇÃO: muda o efeito físico — só com a reversão física provada.
          if (!eleg.editar.efeito_fisico_permitido) {
            throw retificacaoBloqueada(eleg.editar.motivos.filter((m) => !['tem_liquidacao', 'sem_permissao'].includes(m.codigo)), { efeito_fisico_permitido: false });
          }
          const efeitos = plano.efeitos_estoque.entradas.length + plano.efeitos_estoque.saidas.length;
          const tempo = mercadorias.length || efeitos ? await hojeDaEmpresa(tx, cli, empresaId) : null;
          if (efeitos && doc.data_operacional > /** @type {any} */ (tempo).hoje) throw dataFutura(/** @type {any} */ (tempo), doc.data_operacional, 'data_operacional');
          const numeroAntigo = `${op.numero}/r${op.versao}`;
          if ([...numeroAntigo].length > 32) throw new Error(`número da versão anterior passa de 32 caracteres: ${numeroAntigo}`);
          // 1. estorno do antigo pelo núcleo do cancelamento; títulos CANCELADO.
          const estornos = await estornarEfeitosDoDocumento(tx, contexto, { cli, empresaId, op, mercadorias, dia: tempo?.hoje });
          await tx.tituloFinanceiro.updateMany({ where: w, data: { status: 'CANCELADO' } });
          // 2. antigo renomeado ANTES do novo (unique (cliente_id, numero)) e fora da lista operacional.
          const antigo = await tx.operacaoFinanceira.update({
            where: { cliente_id_id: { cliente_id: cli, id } },
            data: {
              status: 'CANCELADO', cancelado_por_usuario_id: auth.usuarioId, cancelado_em: agora, motivo_cancelamento: cortar(`Retificado: ${motivo}`, 500),
              documento_chave_ativa: null, retificado_em: agora, numero: numeroAntigo, versao: { increment: 1 },
            },
          });
          // 3. documento novo, já confirmado, com o MESMO número, pelo núcleo da confirmação.
          const novo = await tx.operacaoFinanceira.create({
            data: {
              cliente_id: cli, empresa_id: empresaId, numero: op.numero, status: 'CONFIRMADO', ...camposDoCabecalho(doc, plano, refs),
              moeda: op.moeda, moeda_casas: op.moeda_casas, versao: op.versao + 1, versao_contrato: VERSAO_CONTRATO,
              criado_por_usuario_id: auth.usuarioId, confirmado_por_usuario_id: auth.usuarioId, confirmado_em: agora, documento_chave_ativa: doc.documento_referencia,
            },
          });
          await gravarFilhos(tx, cli, novo, plano, refs, { statusTitulos: 'ABERTO' });
          const itensNovos = await tx.operacaoFinanceiraItem.findMany({ where: { cliente_id: cli, operacao_id: novo.id }, orderBy: { ordem: 'asc' } });
          const { movimentos, lotes } = await aplicarEfeitosDoPlano(tx, contexto, {
            cli, empresaId, operacaoId: novo.id, direcao: novo.direcao, dia: doc.data_operacional, plano, itens: itensNovos, refs,
            documento: { numero: novo.documento_referencia ?? novo.numero, data: doc.data_emissao }, parceiro: { id: refs.parceiro.id, nome: refs.parceiro.nome },
          });
          await tx.operacaoFinanceiraEvento.create({ data: evento({ modo, operacao_nova_id: novo.id }) });
          await registrarEvento(contexto, {
            acao: 'operacao_financeira.retificar', entidade: ENTIDADE, entidadeId: id,
            dadosNovos: auditoriaDoc(antigo, { modo, operacao_anterior_id: id, operacao_atual_id: novo.id, movimentos_estorno: estornos, motivo_informado: true }),
          }, tx);
          await registrarEvento(contexto, {
            acao: 'operacao_financeira.retificar', entidade: ENTIDADE, entidadeId: novo.id,
            dadosNovos: auditoriaDoc(novo, { ...contagens(plano), modo, operacao_anterior_id: id, operacao_atual_id: novo.id, movimentos_estoque: movimentos, lotes_estoque: lotes }),
          }, tx);
          await numerarMovimentos(tx, cli, [...estornos, ...movimentos]);
          const retificacao = { modo, operacao_anterior_id: id, operacao_atual_id: novo.id };
          return { httpStatus: 200, body: { ...(await carregarDetalhe(tx, cli, novo.id)), retificacao } };
        },
      }),
    { documento_chave_ativa: () => documentoDuplicado(), direcao_parceiro: () => documentoDuplicado() }
  );
  return { ...r.body, replay: r.replay };
};

/**
 * POST /operacoes-financeiras/:id/excluir (§5): exclusão LÓGICA de documento
 * CONFIRMADO. Mesma transação, idempotência e travas do cancelamento;
 * elegibilidade sob trava (sem nenhuma liquidação; reversão física provada).
 * Estorna como o cancelamento, títulos CANCELADO, documento CANCELADO com
 * `excluido_em`; evento EXCLUSAO com snapshot + AuditLog. Nunca DELETE.
 */
export const excluirConfirmado = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const fingerprint = fingerprintDePayload(canonico({ id, empresa_id: corpo.empresa_id, versao: corpo.versao, motivo: corpo.motivo }));
  const r = await emTransacao(TX_EFEITO, (tx) =>
    executarComIdempotencia(tx, {
      clienteId: cli,
      operationKey: corpo.operation_id,
      tipoOperacao: TIPO_EXCLUIR,
      fingerprint,
      executar: async () => {
        const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
        const motivo = motivoObrigatorio(corpo.motivo);
        const op = await travarCabecalho(tx, cli, empresaId, id, 'UPDATE');
        await exigirVigente(tx, cli, empresaId, op, exclusaoBloqueada);
        if (op.versao !== corpo.versao) throw versaoConflito(op.versao, corpo.versao);
        const w = { cliente_id: cli, operacao_id: id };
        const mercadorias = await lerMercadorias(tx, cli, id);
        await travarProdutosEstoque(tx, cli, empresaId, mercadorias.map((i) => i.produto_id));
        const titulos = /** @type {any[]} */ (await travarTitulos(tx, cli, id));
        const eleg = await avaliarElegibilidade(tx, cli, empresaId, op, { aut: await carregarAutorizacao(contexto, tx), mercadorias });
        if (!eleg.excluir.permitido) throw exclusaoBloqueada(eleg.excluir.motivos);
        const snapshot = await montarSnapshot(tx, cli, empresaId, op);
        const tempo = mercadorias.length ? await hojeDaEmpresa(tx, cli, empresaId) : null;
        // Sequência de movimentos SÓ no fim (§8.4 item 5): `numerarMovimentos`.
        const estornos = await estornarEfeitosDoDocumento(tx, contexto, { cli, empresaId, op, mercadorias, dia: tempo?.hoje });
        await tx.tituloFinanceiro.updateMany({ where: w, data: { status: 'CANCELADO' } });
        const agora = new Date();
        const excluido = await tx.operacaoFinanceira.update({
          where: { cliente_id_id: { cliente_id: cli, id } },
          data: {
            status: 'CANCELADO', cancelado_por_usuario_id: auth.usuarioId, cancelado_em: agora, motivo_cancelamento: cortar(`Excluído: ${motivo}`, 500),
            documento_chave_ativa: null, excluido_em: agora, versao: { increment: 1 },
          },
        });
        await tx.operacaoFinanceiraEvento.create({
          data: {
            cliente_id: cli, empresa_id: empresaId, operacao_id: id, tipo: 'EXCLUSAO', modo: null, operacao_nova_id: null, numero_original: op.numero,
            versao_anterior: op.versao, versao_nova: op.versao + 1, motivo, usuario_id: auth.usuarioId, snapshot_anterior: snapshot,
          },
        });
        await registrarEvento(contexto, {
          acao: 'operacao_financeira.excluir', entidade: ENTIDADE, entidadeId: id,
          dadosNovos: auditoriaDoc(excluido, { motivo_informado: true, movimentos_estorno: estornos, titulos_n: titulos.length }),
        }, tx);
        await numerarMovimentos(tx, cli, estornos);
        return { httpStatus: 200, body: await carregarDetalhe(tx, cli, id) };
      },
    })
  );
  return { ...r.body, replay: r.replay };
};
