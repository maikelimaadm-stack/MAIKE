/**
 * D-PROD-257 (Estoque → Entradas; contrato P1-05a do Estoque P1, D-PROD-177) — entrada manual
 * documentada e saldo de implantação.
 *
 *  - Toda mudança de estoque passa pelo MOTOR (`aplicarEntradaDocumentada` e
 *    `estornarEntradaDocumentada`): este módulo não calcula custo à parte nem escreve em camada,
 *    movimento ou cache. Custo negativo é recusado pelo motor (M4); custo zero só com a declaração
 *    e o motivo (`conferirCustoZero`).
 *  - D-PROD-259: o motivo vem do CADASTRO de motivos (`motivo_id`, ativo); a natureza dele
 *    (SALDO_IMPLANTACAO | ENTRADA) é gravada em `motivo` e decide as regras. O motivo é IMUTÁVEL.
 *    Fornecedor (parceiro ativo da fazenda com papel de fornecedor/prestador, ou legado sem papel),
 *    centro de custo e centro de resultado (ativos, da fazenda) no cabeçalho; lote do fabricante e
 *    validade por item. A implantação não tem fornecedor nem documento.
 *  - Implantação: uma ativa por produto e empresa, e só para produto SEM histórico físico (as únicas
 *    exceções são os fatos das linhas JÁ ESTORNADAS de entrada manual, por FK).
 *  - Criar = confirmar numa só chamada, idempotente por `operation_id` (recibo + unique).
 *  - Editar: só observação e justificativa (classe M), com CAS de versão e evento `EDICAO/METADADOS`.
 *    A edição física por revisão versionada é a P1-05b e NÃO existe aqui.
 *  - Excluir: exclusão lógica (`EXCLUIDA`) com estorno integral pelo motor, só com a prova fail-closed
 *    de que a camada nunca foi tocada (`provaDeCamadaIntocada`).
 *  - Documento: a entrada é recusada se outra entrada confirmada ou um lançamento financeiro
 *    CONFIRMADO da fazenda já tem o mesmo documento. A consulta recíproca NO LADO DA P3 (compra →
 *    entrada) não faz parte desta PR (ver o relatório).
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
  aplicarEntradaDocumentada, estornarEntradaDocumentada, exigirLocaisEstoque, numerarMovimentos, numeroMovimentoProvisorio, travarProdutosEstoque,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { lerPapeis } from '../fornecedores/fornecedorDominio.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { comoData, diaDe, diaDoCorpo, listarKeyset, paginacaoOpcoes, paginarPorNome, termoDeBusca } from '../patrimonio/patrimonioComum.js';
import { hojeDaEmpresa } from '../rebanhoLedger/rebanhoLedgerTempo.js';
import { ESCOPO_TENANT, reservarNumero } from '../sequencias/entidadeCodigoService.js';
import {
  ENTIDADE, MOTIVO_IMPLANTACAO, ROTULOS_DA_NATUREZA, STATUS_CONFIRMADA, STATUS_EXCLUIDA, TIPO_CRIAR, TIPO_EXCLUIR,
  chaveDoDocumento, efeitoDoItem, fingerprintDaCriacao, fingerprintDaExclusao, normalizarCriacao, normalizarEdicao, normalizarExclusao,
} from './entradaEstoqueRegras.js';
import { exigirMotivoAtivo } from './motivoEntradaEstoqueService.js';

const LEITURA = Object.freeze({ maxWait: 2000, timeout: 9000, isolationLevel: /** @type {const} */ ('RepeatableRead') });
/** Teto da prova (contrato A8.3): acima dele a prova é INDETERMINADA e a exclusão é recusada (nunca varredura ilimitada). */
const TETO_MOVIMENTOS_COM_FATIAS = 5000;

// ─── erros ──────────────────────────────────────────────────────────────────
export const naoEncontrada = () => new AppError('ENTRADA_ESTOQUE_NOT_FOUND', 'entrada de estoque não encontrada nesta fazenda');
const statusInvalido = (status) => new AppError('ENTRADA_ESTOQUE_STATUS_INVALIDO', `a entrada está ${status}; a ação não é possível; nada foi alterado`, { details: { status } });
const versaoConflito = () => new AppError('ENTRADA_ESTOQUE_VERSAO_CONFLITO', 'a entrada mudou desde a leitura; recarregue e tente de novo; nada foi alterado');
const invalida = (field, reason, mensagem, extra = {}) => new AppError('ENTRADA_ESTOQUE_INVALIDA', `${mensagem}; nada foi gravado`, { details: { field, reason, ...extra } });
const dependencias = (reason, extra = {}) => new AppError('ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS', 'o estoque desta entrada já foi consumido, movimentado ou não se prova intocado; exclusão recusada; nada foi alterado', { details: { field: 'itens', reason, ...extra } });

// ─── leitura ────────────────────────────────────────────────────────────────
const INCLUIR_ITENS = {
  where: { revisao_fim: null },
  orderBy: [{ ordem: 'asc' }],
  include: { produto: { select: { nome_produto: true, codigo_interno: true, unidade_principal_estoque: true } }, localEstoque: { select: { nome: true } } },
};
/** D-PROD-259: os nomes do motivo, do fornecedor e dos centros, lidos junto do cabeçalho. */
const INCLUIR_CABECALHO = {
  motivoCadastro: { select: { nome: true } },
  fornecedor: { select: { nome: true } },
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
  local_estoque_nome: i.localEstoque?.nome ?? null,
  unidade: i.unidade,
  quantidade: d4(i.quantidade),
  fator_kg: d4(i.fator_kg),
  quantidade_estoque: d4(i.quantidade_estoque),
  unidade_estoque: i.produto?.unidade_principal_estoque === 'L' ? 'L' : 'KG',
  custo_unitario: c4(i.custo_unitario),
  custo_kg: c4(i.custo_kg),
  valor_total: c4(i.valor_total),
  custo_zero: i.custo_zero,
  estoque_lote_nota_id: i.estoque_lote_nota_id,
  movimentacao_estoque_id: i.movimentacao_estoque_id,
  movimentacao_estorno_id: i.movimentacao_estorno_id,
  lote_fabricante: i.lote_fabricante ?? null,
  data_validade: i.data_validade ? diaDe(i.data_validade) : null,
  revisao_inicio: i.revisao_inicio,
  revisao_fim: i.revisao_fim,
});

const comoResumo = (e) => ({
  id: e.id,
  empresa_id: e.empresa_id,
  numero: e.numero,
  status: e.status,
  versao: e.versao,
  revisao: e.revisao,
  motivo: e.motivo,
  motivo_id: e.motivo_id ?? null,
  motivo_nome: e.motivoCadastro?.nome ?? null,
  data_entrada: diaDe(e.data_entrada),
  fornecedor_id: e.fornecedor_id ?? null,
  fornecedor_nome: e.fornecedor?.nome ?? null,
  documento_numero: e.documento_numero,
  centro_custo_id: e.centro_custo_id ?? null,
  centro_custo_nome: e.centroCusto?.nome ?? null,
  centro_resultado_id: e.centro_resultado_id ?? null,
  centro_resultado_nome: e.centroResultado?.nome ?? null,
  observacao: e.observacao,
  excluida_em: iso(e.excluida_em),
  criada_em: iso(e.createdAt),
  itens: (e.itens ?? []).map(comoItem),
});

/** Detalhe: cabeçalho, linhas (todas as revisões) e eventos. */
export const carregarDetalhe = async (db, cli, empresaId, id) => {
  const e = await db.entradaEstoque.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, id },
    include: {
      ...INCLUIR_CABECALHO,
      itens: { orderBy: [{ ordem: 'asc' }, { revisao_inicio: 'asc' }], include: INCLUIR_ITENS.include },
      eventos: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (!e) throw naoEncontrada();
  return {
    ...comoResumo({ ...e, itens: e.itens.filter((i) => i.revisao_fim === null) }),
    confirmada_em: iso(e.confirmada_em),
    excluida_por_usuario_id: e.excluida_por_usuario_id,
    motivo_exclusao: e.motivo_exclusao,
    excluida_de: e.excluida_de,
    itens_historico: e.itens.filter((i) => i.revisao_fim !== null).map(comoItem),
    eventos: e.eventos.map((v) => ({
      id: v.id, tipo: v.tipo, modo: v.modo, revisao_anterior: v.revisao_anterior, revisao_nova: v.revisao_nova,
      versao_anterior: v.versao_anterior, versao_nova: v.versao_nova, motivo: v.motivo, usuario_id: v.usuario_id, criado_em: iso(v.createdAt),
    })),
  };
};

/** Lista keyset (createdAt desc, id desc) das entradas da fazenda. @param {any} contexto @param {Record<string, any>} [query] */
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
  for (const campo of ['status', 'motivo', 'motivo_id']) if (typeof query[campo] === 'string' && query[campo]) where[campo] = query[campo];
  if (typeof query.produto_id === 'string' && query.produto_id) where.itens = { some: { produto_id: query.produto_id, revisao_fim: null } };
  if (de || ate) where.data_entrada = { ...(de ? { gte: comoData(de) } : {}), ...(ate ? { lte: comoData(ate) } : {}) };
  const q = termoDeBusca(query.q);
  const busca = q ? [{ numero: { contains: q } }, { documento_numero: { contains: q, mode: 'insensitive' } }, { itens: { some: { produto: { nome_produto: { contains: q, mode: 'insensitive' } } } } }] : [];
  return listarKeyset(prisma.entradaEstoque, { where, busca, query, include: { ...INCLUIR_CABECALHO, itens: INCLUIR_ITENS }, mapItem: comoResumo });
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

/** Opções do formulário: produtos ATIVOS da fazenda (com unidade e peso do saco) e depósitos ATIVOS. */
export const opcoesProdutos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const cli = auth.clienteId;
  const empresaId = await exigirEmpresaDoTenant(prisma, cli, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: cli, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome_produto: { contains: q, mode: 'insensitive' } }, { codigo_interno: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(prisma.produto, {
    where: { AND: filtros },
    campoNome: 'nome_produto',
    select: { id: true, nome_produto: true, codigo_interno: true, unidade_principal_estoque: true, peso_por_saco_kg: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((p) => ({
      id: p.id, nome: p.nome_produto, codigo: p.codigo_interno ?? null,
      unidade_estoque: p.unidade_principal_estoque === 'L' ? 'L' : 'KG', peso_por_saco_kg: p.peso_por_saco_kg === null ? null : d4(p.peso_por_saco_kg),
    })),
  });
};

export const opcoesLocais = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true }];
  if (q) filtros.push({ nome: { contains: q, mode: 'insensitive' } });
  return paginarPorNome(prisma.localEstoque, {
    where: { AND: filtros }, campoNome: 'nome', select: { id: true, nome: true }, limit, cursor,
    mapear: (linhas) => linhas.map((l) => ({ id: l.id, nome: l.nome })),
  });
};

// ─── elegibilidade (sob a trava do produto) ─────────────────────────────────

/**
 * Implantação (contrato A3): o histórico físico do produto tem de estar VAZIO em todos os locais e
 * sem implantação ativa. As únicas exceções são os fatos (camada, movimento de entrada e de estorno)
 * ligados por FK a linhas JÁ ESTORNADAS de entrada manual. Chamar depois de `travarProdutosEstoque`.
 * @param {any} tx @param {string} cli @param {string[]} produtoIds
 */
const exigirImplantacaoElegivel = async (tx, cli, produtoIds) => {
  for (const produtoId of produtoIds) {
    const ativa = /** @type {any[]} */ (await tx.$queryRaw`SELECT e.numero FROM "EntradaEstoqueItem" i JOIN "EntradaEstoque" e ON e.cliente_id = i.cliente_id AND e.id = i.entrada_id
      WHERE i.cliente_id = ${cli} AND i.produto_id = ${produtoId} AND i.revisao_fim IS NULL AND e.status = 'CONFIRMADA' AND e.motivo = 'SALDO_IMPLANTACAO' LIMIT 1`);
    if (ativa.length) {
      throw new AppError('ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO', 'este produto já tem uma implantação ativa; corrija-a (edite ou exclua) em vez de lançar outra; nada foi gravado', {
        details: { field: 'produto_id', reason: 'implantacao_ativa', produto_id: produtoId, entrada_numero: ativa[0].numero },
      });
    }
    const lotes = /** @type {any[]} */ (await tx.$queryRaw`SELECT count(*)::int AS n FROM "EstoqueLoteNota" l WHERE l.cliente_id = ${cli} AND l.produto_id = ${produtoId}
      AND NOT EXISTS (SELECT 1 FROM "EntradaEstoqueItem" i WHERE i.cliente_id = l.cliente_id AND i.estoque_lote_nota_id = l.id AND i.movimentacao_estorno_id IS NOT NULL)`);
    const movimentos = /** @type {any[]} */ (await tx.$queryRaw`SELECT count(*)::int AS n FROM "MovimentacaoEstoque" m WHERE m.cliente_id = ${cli} AND m.produto_id = ${produtoId}
      AND NOT EXISTS (SELECT 1 FROM "EntradaEstoqueItem" i WHERE i.cliente_id = m.cliente_id AND i.movimentacao_estorno_id IS NOT NULL
        AND (i.movimentacao_estoque_id = m.id OR i.movimentacao_estorno_id = m.id))`);
    const cache = /** @type {any[]} */ (await tx.$queryRaw`SELECT estoque_atual FROM "Produto" WHERE cliente_id = ${cli} AND id = ${produtoId}`);
    const reason = lotes[0].n > 0 ? 'camadas_existentes' : movimentos[0].n > 0 ? 'movimentos_existentes' : cache[0] && !dec(cache[0].estoque_atual).eq(0) ? 'estoque_atual_nao_zero' : null;
    if (reason) {
      throw new AppError('ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO', 'o saldo de implantação só vale para produto sem histórico de estoque; este produto já teve movimento; nada foi gravado', {
        details: { field: 'produto_id', reason, produto_id: produtoId },
      });
    }
  }
};

/**
 * Documento (identidade = número normalizado na fazenda): outra entrada CONFIRMADA ou lançamento
 * financeiro CONFIRMADO com o mesmo documento recusa a entrada (nunca dupla contagem de estoque).
 * @param {any} tx @param {string} cli @param {string} empresaId @param {string|null} documento
 */
const exigirDocumentoLivre = async (tx, cli, empresaId, documento) => {
  const chave = chaveDoDocumento(documento);
  if (!chave) return;
  const outra = /** @type {any[]} */ (await tx.$queryRaw`SELECT numero FROM "EntradaEstoque" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND status = 'CONFIRMADA'
    AND upper(btrim(documento_numero)) = ${chave} LIMIT 1`);
  if (outra.length) {
    throw new AppError('ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE', 'já existe uma entrada confirmada com este documento nesta fazenda; nada foi gravado', { details: { field: 'documento_numero', reason: 'documento_duplicado', entrada_numero: outra[0].numero } });
  }
  const financeiro = await tx.operacaoFinanceira.findFirst({
    where: { cliente_id: cli, empresa_id: empresaId, status: 'CONFIRMADO', documento_chave_ativa: chave },
    select: { numero: true, direcao: true },
  });
  if (financeiro) {
    throw new AppError('ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE', 'este documento já está em um lançamento financeiro confirmado; a mercadoria entra por ele, não por entrada manual; nada foi gravado', {
      details: { field: 'documento_numero', reason: financeiro.direcao === 'RECEBER' ? 'documento_de_venda' : 'documento_de_compra', lancamento_numero: financeiro.numero },
    });
  }
};

/**
 * D-PROD-259 — fornecedor e centros do cabeçalho, lidos na transação: da fazenda, ativos; o fornecedor
 * com papel de fornecedor/prestador (ou legado, sem papel), como no lançamento de compra. A implantação
 * não tem fornecedor nem documento.
 * @param {any} tx @param {string} cli @param {string} empresaId @param {ReturnType<typeof normalizarCriacao>} entrada @param {string} natureza
 */
const exigirVinculosDoCabecalho = async (tx, cli, empresaId, entrada, natureza) => {
  if (natureza === MOTIVO_IMPLANTACAO) {
    if (entrada.fornecedor_id) throw invalida('fornecedor_id', 'implantacao_sem_fornecedor', 'o saldo de implantação não tem fornecedor');
    if (entrada.documento_numero) throw invalida('documento_numero', 'implantacao_sem_documento', 'o saldo de implantação não tem documento');
  }
  if (entrada.fornecedor_id) {
    const f = await tx.fornecedor.findFirst({ where: { cliente_id: cli, id: entrada.fornecedor_id }, select: { empresa_id: true, ativo: true, tipos: true } });
    if (!f || f.empresa_id !== empresaId) throw invalida('fornecedor_id', 'fornecedor_inexistente', 'fornecedor não encontrado nesta fazenda');
    if (!f.ativo) throw invalida('fornecedor_id', 'fornecedor_inativo', 'o fornecedor está inativo');
    const { papeis } = lerPapeis(f.tipos);
    const temPapel = !Array.isArray(f.tipos) || f.tipos.length === 0 || papeis.includes('fornecedor') || papeis.includes('prestador_servico');
    if (!temPapel) throw invalida('fornecedor_id', 'fornecedor_sem_papel', 'o parceiro não tem o papel de fornecedor');
  }
  for (const [campo, delegado, rotulo] of /** @type {const} */ ([['centro_custo_id', 'centroCusto', 'centro de custo'], ['centro_resultado_id', 'centroResultado', 'centro de resultado']])) {
    const id = entrada[campo];
    if (!id) continue;
    const c = await tx[delegado].findFirst({ where: { cliente_id: cli, empresa_id: empresaId, id }, select: { ativo: true } });
    if (!c) throw invalida(campo, `${delegado === 'centroCusto' ? 'centro_custo' : 'centro_resultado'}_inexistente`, `${rotulo} não encontrado nesta fazenda`);
    if (!c.ativo) throw invalida(campo, `${delegado === 'centroCusto' ? 'centro_custo' : 'centro_resultado'}_inativo`, `o ${rotulo} está inativo`);
  }
};

// ─── criar (confirmar) ──────────────────────────────────────────────────────

const paraAuditoria = (e, itens) => ({
  id: e.id, numero: e.numero, status: e.status, versao: e.versao, revisao: e.revisao, motivo: e.motivo, motivo_id: e.motivo_id ?? null,
  documento_informado: Boolean(e.documento_numero), fornecedor_id: e.fornecedor_id ?? null,
  centro_custo_id: e.centro_custo_id ?? null, centro_resultado_id: e.centro_resultado_id ?? null,
  itens: itens.map((i) => ({ id: i.id, produto_id: i.produto_id, local_estoque_id: i.local_estoque_id, estoque_lote_nota_id: i.estoque_lote_nota_id, movimentacao_estoque_id: i.movimentacao_estoque_id })),
});

/** @param {any} contexto @param {Record<string, any>} corpo */
export const criar = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const cli = auth.clienteId;
  const entrada = normalizarCriacao(corpo);
  const fingerprint = fingerprintDePayload(fingerprintDaCriacao(entrada));
  const r = await emTransacao(
    TRANSACAO_LONGA,
    (tx) =>
      executarComIdempotencia(tx, {
        clienteId: cli,
        operationKey: entrada.operation_id,
        tipoOperacao: TIPO_CRIAR,
        fingerprint,
        executar: async () => {
          const empresaId = await exigirEmpresaDoTenant(tx, cli, entrada.empresa_id);
          const tempo = await hojeDaEmpresa(tx, cli, empresaId);
          if (entrada.data_entrada > tempo.hoje) throw invalida('data_entrada', 'data_futura', `a data da entrada é posterior a hoje (${tempo.hoje}) na fazenda`, { hoje: tempo.hoje, fuso: tempo.fuso });
          const motivo = await exigirMotivoAtivo(tx, cli, entrada.motivo_id);
          const natureza = motivo.natureza;
          await exigirVinculosDoCabecalho(tx, cli, empresaId, entrada, natureza);
          const locais = await exigirLocaisEstoque(tx, cli, entrada.itens.map((i) => ({ id: i.local_estoque_id, field: 'local_destino_id', exigirAtivo: true })));
          const produtoIds = await travarProdutosEstoque(tx, cli, empresaId, entrada.itens.map((i) => i.produto_id));
          const produtos = new Map((await tx.produto.findMany({ where: { cliente_id: cli, empresa_id: empresaId, id: { in: produtoIds } } })).map((p) => [p.id, p]));
          for (const item of entrada.itens) {
            const p = produtos.get(item.produto_id);
            if (!p) throw invalida('produto_id', 'produto_inexistente', 'produto não encontrado nesta fazenda');
            if (!p.ativo) throw invalida('produto_id', 'produto_inativo', 'o produto está inativo');
          }
          if (natureza === MOTIVO_IMPLANTACAO) await exigirImplantacaoElegivel(tx, cli, produtoIds);
          await exigirDocumentoLivre(tx, cli, empresaId, entrada.documento_numero);
          const efeitos = entrada.itens.map((item) => efeitoDoItem(item, /** @type {any} */ (produtos.get(item.produto_id))));

          const id = randomUUID();
          const numero = String(await reservarNumero(tx, { clienteId: cli, entidade: ENTIDADE, escopoTipo: ESCOPO_TENANT }));
          const agora = new Date();
          const cabecalho = await tx.entradaEstoque.create({
            data: {
              id, cliente_id: cli, empresa_id: empresaId, numero, status: STATUS_CONFIRMADA, versao: 1, revisao: 1, motivo: natureza, motivo_id: motivo.id,
              data_entrada: comoData(entrada.data_entrada), fornecedor_id: entrada.fornecedor_id, documento_numero: entrada.documento_numero,
              centro_custo_id: entrada.centro_custo_id, centro_resultado_id: entrada.centro_resultado_id, observacao: entrada.observacao,
              confirmada_em: agora, confirmada_por_usuario_id: auth.usuarioId ?? null,
            },
          });
          const base = ROTULOS_DA_NATUREZA[/** @type {keyof typeof ROTULOS_DA_NATUREZA} */ (natureza)];
          const rotulo = { slug: base.slug, texto: natureza === MOTIVO_IMPLANTACAO ? base.texto : `${base.texto}: ${motivo.nome}`.slice(0, 200) };
          const movimentosIds = [];
          const linhas = [];
          for (const [indice, item] of entrada.itens.entries()) {
            const p = /** @type {any} */ (produtos.get(item.produto_id));
            const local = /** @type {any} */ (locais.get(item.local_estoque_id));
            const ef = efeitos[indice];
            const r = await aplicarEntradaDocumentada(tx, contexto, {
              empresaId,
              produto: p,
              local: { id: local.id, nome: local.nome },
              quantidadeKg: ef.quantidadeEstoque,
              custoUnitarioKg: ef.custoKg,
              valorTotal: ef.valorTotal,
              dia: entrada.data_entrada,
              documento: { numero: entrada.documento_numero, data: entrada.data_entrada },
              motivoSlug: rotulo.slug,
              origem: { operacaoId: id, motivo: rotulo.texto },
              numeroMovimento: numeroMovimentoProvisorio(),
              contextoErro: { field: 'itens', indice },
            });
            movimentosIds.push(r.movimento.id);
            linhas.push(await tx.entradaEstoqueItem.create({
              data: {
                cliente_id: cli, empresa_id: empresaId, entrada_id: id, ordem: indice + 1, produto_id: p.id, local_estoque_id: local.id,
                unidade: item.unidade, quantidade: item.quantidade, fator_kg: paraBanco(ef.fator, CASAS_QUANTIDADE),
                quantidade_estoque: paraBanco(ef.quantidadeEstoque, CASAS_QUANTIDADE), custo_unitario: item.custo_unitario,
                custo_kg: paraBanco(ef.custoKg, CASAS_CUSTO), valor_total: paraBanco(ef.valorTotal, CASAS_CUSTO), custo_zero: item.custo_zero,
                lote_fabricante: item.lote_fabricante, data_validade: item.data_validade ? comoData(item.data_validade) : null,
                estoque_lote_nota_id: r.lote.id, movimentacao_estoque_id: r.movimento.id, revisao_inicio: 1,
              },
            }));
          }
          await numerarMovimentos(tx, cli, movimentosIds);
          await tx.entradaEstoqueEvento.create({
            data: {
              cliente_id: cli, empresa_id: empresaId, entrada_id: id, tipo: 'CONFIRMACAO', revisao_anterior: 0, revisao_nova: 1, versao_anterior: 0, versao_nova: 1,
              motivo: `Entrada ${rotulo.texto.toLowerCase()}`, usuario_id: auth.usuarioId ?? null,
              snapshot_novo: { cabecalho: paraAuditoria(cabecalho, linhas), motivo_nome: motivo.nome, observacao: entrada.observacao },
            },
          });
          await registrarEvento(contexto, { acao: 'entrada_estoque.confirmar', entidade: ENTIDADE, entidadeId: id, dadosNovos: paraAuditoria(cabecalho, linhas) }, tx);
          return { httpStatus: 201, body: await carregarDetalhe(tx, cli, empresaId, id) };
        },
      }),
    // D-PROD-253: o mapa do `emTransacao` é `{ erro, conferir }`. Nenhuma unique gravada aqui tem `operation_id`:
    // a idempotência é o recibo (reservado por INSERT … ON CONFLICT DO NOTHING). Sem o alvo do P2002 (produção:
    // papel não dono + RLS), a chave é conferida no recibo depois do rollback: se outra operação já gravou o
    // recibo desta chave, o reenvio com a mesma operation_id cai no replay. Com o alvo, como antes.
    {
      operation_id: {
        erro: () => new AppError('ENTRADA_ESTOQUE_VERSAO_CONFLITO', 'outra operação alterou os mesmos registros; tente de novo com a mesma operation_id'),
        conferir: (tx) =>
          tx.operacaoIdempotente.findFirst({ where: { cliente_id: cli, operation_key: entrada.operation_id, tipo_operacao: TIPO_CRIAR }, select: { id: true } }),
      },
    },
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
    const [atual] = /** @type {any[]} */ (await tx.$queryRaw`SELECT * FROM "EntradaEstoque" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`);
    if (!atual) throw naoEncontrada();
    if (e.motivo_id !== undefined && e.motivo_id !== atual.motivo_id) throw new AppError('ENTRADA_ESTOQUE_MOTIVO_IMUTAVEL', 'o motivo da entrada nunca muda; exclua a entrada e lance outra; nada foi alterado', { details: { motivo_atual: atual.motivo } });
    if (e.campos_fisicos.length) throw new AppError('ENTRADA_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA', 'só a observação se edita; para mudar data, fornecedor, documento, centros, produto, quantidade, custo ou depósito, exclua a entrada e lance outra; nada foi alterado', { details: { campos: e.campos_fisicos } });
    if (atual.status !== STATUS_CONFIRMADA) throw statusInvalido(atual.status);
    if (!Number.isInteger(e.versao) || e.versao !== atual.versao) throw versaoConflito();
    const observacao = e.observacao === undefined ? atual.observacao : e.observacao;
    if (observacao === atual.observacao) throw invalida('observacao', 'nada_a_alterar', 'nada mudou na observação');
    await tx.entradaEstoque.update({ where: { cliente_id_id: { cliente_id: cli, id } }, data: { observacao, versao: atual.versao + 1, revisao: atual.revisao + 1 } });
    await tx.entradaEstoqueEvento.create({
      data: {
        cliente_id: cli, empresa_id: empresaId, entrada_id: id, tipo: 'EDICAO', modo: 'METADADOS', revisao_anterior: atual.revisao, revisao_nova: atual.revisao + 1,
        versao_anterior: atual.versao, versao_nova: atual.versao + 1, motivo: e.motivo_edicao, usuario_id: auth.usuarioId ?? null,
        snapshot_anterior: { observacao: atual.observacao }, snapshot_novo: { observacao },
      },
    });
    await registrarEvento(contexto, {
      acao: 'entrada_estoque.editar', entidade: ENTIDADE, entidadeId: id,
      dadosAnteriores: { versao: atual.versao, revisao: atual.revisao }, dadosNovos: { versao: atual.versao + 1, revisao: atual.revisao + 1, motivo_informado: true },
    }, tx);
    return carregarDetalhe(tx, cli, empresaId, id);
  });
};

// ─── excluir (estorno integral pelo motor) ──────────────────────────────────

/**
 * Prova fail-closed (contrato A8.3) de que as camadas da entrada NUNCA foram tocadas: camada
 * Disponível, disponível = entrada, custo igual ao da linha (nenhuma reavaliação do poço), nenhuma
 * fatia de consumo (financeiro, abastecimento, atividade) — nem de baixa depois estornada — e nenhuma
 * citação em `lotes_consumidos` (suplementação, transferência). Acima do teto, indeterminada.
 * Lida sob a trava do produto. Qualquer dúvida recusa.
 * @param {any} tx @param {string} cli @param {any[]} itens
 */
const provaDeCamadaIntocada = async (tx, cli, itens) => {
  for (const item of itens) {
    const loteId = item.estoque_lote_nota_id;
    const base = { item_ordem: item.ordem, lote_id: loteId };
    const [lote] = /** @type {any[]} */ (await tx.$queryRaw`SELECT status, quantidade_entrada, quantidade_disponivel, custo_unitario FROM "EstoqueLoteNota" WHERE cliente_id = ${cli} AND id = ${loteId}`);
    if (!lote) throw dependencias('camada_inexistente', base);
    if (lote.status !== 'Disponivel' || !dec(lote.quantidade_disponivel).eq(dec(lote.quantidade_entrada)) || !dec(lote.quantidade_entrada).eq(dec(item.quantidade_estoque))) throw dependencias('camada_consumida', base);
    if (!dec(lote.custo_unitario).eq(dec(item.custo_kg))) throw dependencias('custo_reavaliado', base);
    const fatias = /** @type {any[]} */ (await tx.$queryRaw`SELECT (
        (SELECT count(*) FROM "OperacaoFinanceiraConsumoLote" WHERE cliente_id = ${cli} AND estoque_lote_nota_id = ${loteId}) +
        (SELECT count(*) FROM "AbastecimentoBemConsumoLote" WHERE cliente_id = ${cli} AND estoque_lote_nota_id = ${loteId}) +
        (SELECT count(*) FROM "AtividadeApontamentoProdutoConsumoLote" WHERE cliente_id = ${cli} AND estoque_lote_nota_id = ${loteId}))::int AS n`);
    if (fatias[0].n > 0) throw dependencias('consumo_estornado', base);
    const [{ n: comFatias }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT count(*)::int AS n FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND produto_id = ${item.produto_id} AND lotes_consumidos IS NOT NULL`);
    if (comFatias > TETO_MOVIMENTOS_COM_FATIAS) throw dependencias('prova_indeterminada', { ...base, volume: comFatias });
    if (comFatias > 0) {
      const citada = /** @type {any[]} */ (await tx.$queryRaw`SELECT 1 FROM "MovimentacaoEstoque" WHERE cliente_id = ${cli} AND produto_id = ${item.produto_id} AND lotes_consumidos IS NOT NULL
        AND position(${loteId} in lotes_consumidos::text) > 0 LIMIT 1`);
      if (citada.length) throw dependencias('camada_citada_em_baixa', base);
    }
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
          const [atual] = /** @type {any[]} */ (await tx.$queryRaw`SELECT * FROM "EntradaEstoque" WHERE cliente_id = ${cli} AND empresa_id = ${empresaId} AND id = ${id} FOR UPDATE`);
          if (!atual) throw naoEncontrada();
          if (atual.status !== STATUS_CONFIRMADA) throw statusInvalido(atual.status);
          if (!Number.isInteger(e.versao) || e.versao !== atual.versao) throw versaoConflito();
          const itens = await tx.entradaEstoqueItem.findMany({ where: { cliente_id: cli, entrada_id: id, revisao_fim: null }, orderBy: [{ ordem: 'asc' }], include: { localEstoque: { select: { nome: true } } } });
          if (!itens.length) throw statusInvalido('sem_linhas_vigentes');
          await exigirLocaisEstoque(tx, cli, itens.map((i) => ({ id: i.local_estoque_id, field: 'local_destino_id', exigirAtivo: false })));
          await travarProdutosEstoque(tx, cli, empresaId, itens.map((i) => i.produto_id));
          await provaDeCamadaIntocada(tx, cli, itens);
          let estornos;
          try {
            estornos = await estornarEntradaDocumentada(tx, contexto, {
              empresaId,
              itens: itens.map((i) => ({
                produto_id: i.produto_id, local_estoque_id: i.local_estoque_id, local_estoque_nome: i.localEstoque?.nome, movimentacao_estoque_id: i.movimentacao_estoque_id,
                estoque_lote_nota_id: i.estoque_lote_nota_id, quantidade_estoque: i.quantidade_estoque.toString(), ordem: i.ordem, consumos: [],
              })),
              dia: tempo.hoje,
              documento: { numero: atual.documento_numero, data: tempo.hoje },
              origem: { operacaoId: id, motivoEstorno: `Exclusão da entrada ${atual.numero}: ${e.motivo}`.slice(0, 255) },
              numeroMovimento: numeroMovimentoProvisorio,
            });
          } catch (erro) {
            if (/** @type {any} */ (erro)?.code === 'ESTOQUE_JA_CONSUMIDO') throw dependencias(/** @type {any} */ (erro).details?.reason ?? 'estoque_ja_consumido', { lote_id: /** @type {any} */ (erro).details?.lote_id });
            throw erro;
          }
          for (const [indice, item] of itens.entries()) {
            await tx.entradaEstoqueItem.update({ where: { cliente_id_id: { cliente_id: cli, id: item.id } }, data: { movimentacao_estorno_id: estornos[indice], revisao_fim: atual.revisao } });
          }
          await numerarMovimentos(tx, cli, estornos);
          const depois = await tx.entradaEstoque.update({
            where: { cliente_id_id: { cliente_id: cli, id } },
            data: { status: STATUS_EXCLUIDA, versao: atual.versao + 1, excluida_em: new Date(), excluida_por_usuario_id: auth.usuarioId ?? null, motivo_exclusao: e.motivo, excluida_de: STATUS_CONFIRMADA },
          });
          await tx.entradaEstoqueEvento.create({
            data: {
              cliente_id: cli, empresa_id: empresaId, entrada_id: id, tipo: 'EXCLUSAO', revisao_anterior: atual.revisao, revisao_nova: atual.revisao, versao_anterior: atual.versao,
              versao_nova: atual.versao + 1, motivo: e.motivo, usuario_id: auth.usuarioId ?? null,
              snapshot_anterior: { status: atual.status, motivo: atual.motivo, itens: itens.map((i) => ({ id: i.id, produto_id: i.produto_id, estoque_lote_nota_id: i.estoque_lote_nota_id, movimentacao_estoque_id: i.movimentacao_estoque_id, quantidade_estoque: d4(i.quantidade_estoque) })) },
              snapshot_novo: { status: depois.status, estornos },
            },
          });
          await registrarEvento(contexto, {
            acao: 'entrada_estoque.excluir', entidade: ENTIDADE, entidadeId: id,
            dadosAnteriores: { status: atual.status, versao: atual.versao }, dadosNovos: { status: depois.status, versao: depois.versao, motivo_informado: true, estornos },
          }, tx);
          return { httpStatus: 200, body: await carregarDetalhe(tx, cli, empresaId, id) };
        },
      }),
  );
  return { status: 200, body: { ...r.body, replay: r.replay } };
};
