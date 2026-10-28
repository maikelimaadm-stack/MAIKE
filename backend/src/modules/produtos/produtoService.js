/**
 * Serviço de Produto (P5.2, D-PROD-48).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import {
  decodificarCursor,
  montarEnvelopeKeyset,
  normalizarLimite,
} from '../../shared/pagination/keysetCursor.js';
import { AppError, produtoNotFound, produtoNomeConflito, produtoDeleteBlocked } from '../../shared/errors/AppError.js';
import {
  listarProdutos,
  listarProdutosPagina,
  contarProdutos,
  buscarProduto,
  existeProdutoComNome,
  inserirProduto,
  atualizarProdutoPorId,
  excluirProdutoPorId,
  contarMovimentacoesPorProduto,
} from './produtoRepository.js';

export const ENTIDADE_SEQUENCIA = 'Produto';
export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const normalizarNomeProduto = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

const decimalOuNulo = (valor) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const decimalComDefault = (valor, padrao) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return padrao;
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
};

const comoNumero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

/** @param {Record<string, unknown>} registro */
export const comoProdutoPublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  numero_produto: registro.numero_produto,
  nome_produto: registro.nome_produto,
  tipo_uso: registro.tipo_uso ?? null,
  codigo_interno: registro.codigo_interno ?? null,
  codigo_barras: registro.codigo_barras ?? null,
  categoria: registro.categoria ?? null,
  marca: registro.marca ?? null,
  descricao: registro.descricao ?? null,
  unidade_medida: registro.unidade_medida ?? null,
  preco_custo: comoNumero(registro.preco_custo),
  preco_venda: comoNumero(registro.preco_venda),
  estoque_atual: comoNumero(registro.estoque_atual) ?? 0,
  estoque_minimo: comoNumero(registro.estoque_minimo) ?? 0,
  local_estoque: registro.local_estoque ?? null,
  tipo_consumo: registro.tipo_consumo ?? null,
  percentual_consumo_pv: comoNumero(registro.percentual_consumo_pv),
  consumo_minimo_pv: comoNumero(registro.consumo_minimo_pv),
  consumo_maximo_pv: comoNumero(registro.consumo_maximo_pv),
  unidade_principal_estoque: registro.unidade_principal_estoque ?? 'KG',
  peso_por_saco_kg: comoNumero(registro.peso_por_saco_kg),
  observacoes: registro.observacoes ?? null,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  nome_produto: (v) => normalizarNomeProduto(v),
  tipo_uso: (v) => textoOuNulo(v),
  codigo_interno: (v) => {
    const limpo = textoOuNulo(v);
    return limpo === undefined || limpo === null ? limpo : limpo.toUpperCase();
  },
  codigo_barras: (v) => textoOuNulo(v),
  categoria: (v) => textoOuNulo(v),
  marca: (v) => textoOuNulo(v),
  descricao: (v) => textoOuNulo(v),
  unidade_medida: (v) => textoOuNulo(v),
  preco_custo: (v) => decimalOuNulo(v),
  preco_venda: (v) => decimalOuNulo(v),
  estoque_atual: (v) => decimalComDefault(v, 0),
  estoque_minimo: (v) => decimalComDefault(v, 0),
  local_estoque: (v) => textoOuNulo(v),
  tipo_consumo: (v) => textoOuNulo(v),
  percentual_consumo_pv: (v) => decimalOuNulo(v),
  consumo_minimo_pv: (v) => decimalOuNulo(v),
  consumo_maximo_pv: (v) => decimalOuNulo(v),
  unidade_principal_estoque: (v) => textoOuNulo(v) ?? undefined,
  peso_por_saco_kg: (v) => decimalOuNulo(v),
  observacoes: (v) => textoOuNulo(v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
});

/** @param {Record<string, unknown>} entrada */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, tratar] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    const valor = tratar(entrada[campo]);
    if (valor !== undefined) saida[campo] = valor;
  }
  return saida;
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {{empresa_id?: string, ativo?: boolean}} [filtros] */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarProdutos(auth.clienteId, filtros);
  return registros.map(comoProdutoPublico);
};

/**
 * Listagem paginada keyset — motor Base1 (D-PROD-55).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} query
 */
export const listarPagina = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const limit = normalizarLimite(query.limit);
  const empresaId =
    typeof query.empresa_id === 'string' && query.empresa_id.trim()
      ? query.empresa_id.trim()
      : null;
  if (!empresaId) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'empresa_id é obrigatório');
  }
  const q = typeof query.q === 'string' ? query.q : null;
  let ativo = null;
  if (query.ativo === true || query.ativo === 'true' || query.ativo === '1') ativo = true;
  if (query.ativo === false || query.ativo === 'false' || query.ativo === '0') ativo = false;

  const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'cursor inválido');
  }

  const filtro = { empresaId, q, ativo, cursor, limit };
  const [registros, total] = await Promise.all([
    listarProdutosPagina(auth.clienteId, filtro),
    contarProdutos(auth.clienteId, { empresaId, q, ativo }),
  ]);

  return montarEnvelopeKeyset({
    registros,
    limit,
    total,
    mapItem: comoProdutoPublico,
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criado = await prisma.$transaction(async (tx) => {
    const empresaId = String(campos.empresa_id);
    const nome = String(campos.nome_produto);
    if (await existeProdutoComNome(auth.clienteId, empresaId, nome, undefined, tx)) {
      throw produtoNomeConflito();
    }

    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirProduto(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_produto: String(numero),
      estoque_atual: campos.estoque_atual ?? 0,
      estoque_minimo: campos.estoque_minimo ?? 0,
      unidade_principal_estoque: campos.unidade_principal_estoque ?? 'KG',
    });

    const publico = comoProdutoPublico(registro);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'Produto', entidadeId: registro.id, dadosNovos: publico },
      tx
    );
    return publico;
  });

  return criado;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarProduto(auth.clienteId, id, tx);
    if (!anterior) throw produtoNotFound();

    const campos = camposDe(entrada);
    if (campos.nome_produto && campos.nome_produto !== anterior.nome_produto) {
      const empresa = String(campos.empresa_id ?? anterior.empresa_id);
      const nome = String(campos.nome_produto);
      if (await existeProdutoComNome(auth.clienteId, empresa, nome, id, tx)) {
        throw produtoNomeConflito();
      }
    }

    const registro = Object.keys(campos).length
      ? await atualizarProdutoPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoProdutoPublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Produto',
        entidadeId: id,
        dadosAnteriores: comoProdutoPublico(anterior),
        dadosNovos: publico,
      },
      tx
    );
    return publico;
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const anterior = await buscarProduto(auth.clienteId, id, tx);
    if (!anterior) throw produtoNotFound();

    const quantidade = await contarMovimentacoesPorProduto(tx, auth.clienteId, id);
    if (quantidade > 0) {
      throw produtoDeleteBlocked(quantidade, { details: { id, vinculo: 'movimentações de estoque' } });
    }

    await excluirProdutoPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'Produto',
        entidadeId: id,
        dadosAnteriores: comoProdutoPublico(anterior),
      },
      tx
    );
  });
};
