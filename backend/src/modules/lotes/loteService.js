/**
 * Serviço de Lote (P5.1, D-PROD-47).
 *
 * Tenant do `auth_context`; `numero_lote` por sequência na mesma transação;
 * caches (`setor_nome`, `area_*_nome`) derivados das FKs nativas na escrita.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { loteNotFound, loteDeleteBlocked, setorNotFound, areaNotFound } from '../../shared/errors/AppError.js';
import { buscarSetor } from '../setores/setorRepository.js';
import { buscarArea } from '../areas/areaPastagemRepository.js';
import {
  listarLotes,
  buscarLote,
  inserirLote,
  atualizarLotePorId,
  excluirLotePorId,
  motivoBloqueioExclusaoLote,
} from './loteRepository.js';

export const ENTIDADE_SEQUENCIA = 'Lote';

export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const inteiroOuNulo = (valor) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const decimalOuNulo = (valor) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const comoNumero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

const comoDataIso = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
};

/** @param {Record<string, unknown>} registro */
export const comoLotePublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  numero_lote: registro.numero_lote,
  nome: registro.nome,
  identificador_nome: registro.identificador_nome ?? null,
  identificador_sigla: registro.identificador_sigla ?? null,
  identificador_cor: registro.identificador_cor ?? null,
  quantidade_cabecas: registro.quantidade_cabecas,
  quantidade_entrada: registro.quantidade_entrada,
  categoria: registro.categoria ?? null,
  categoria_entrada: registro.categoria_entrada ?? null,
  categoria_manejo_id: registro.categoria_manejo_id ?? null,
  categoria_manejo_nome: registro.categoria_manejo_nome ?? null,
  categoria_manejo_entrada_id: registro.categoria_manejo_entrada_id ?? null,
  categoria_manejo_entrada_nome: registro.categoria_manejo_entrada_nome ?? null,
  sexo: registro.sexo ?? null,
  peso_medio_kg: comoNumero(registro.peso_medio_kg),
  peso_entrada_kg: comoNumero(registro.peso_entrada_kg),
  idade_media_meses: registro.idade_media_meses ?? null,
  setor_id: registro.setor_id ?? null,
  setor_nome: registro.setor_nome ?? null,
  area_entrada_id: registro.area_entrada_id ?? null,
  area_entrada_nome: registro.area_entrada_nome ?? null,
  area_atual_id: registro.area_atual_id ?? null,
  area_atual_nome: registro.area_atual_nome ?? null,
  raca_predominante: registro.raca_predominante ?? null,
  sistema_produtivo: registro.sistema_produtivo ?? null,
  data_entrada: comoDataIso(registro.data_entrada),
  motivo_entrada: registro.motivo_entrada,
  origem: registro.origem ?? null,
  fornecedor_id: registro.fornecedor_id ?? null,
  fornecedor_nome: registro.fornecedor_nome ?? null,
  nota_fiscal: registro.nota_fiscal ?? null,
  chave_nfe: registro.chave_nfe ?? null,
  numero_gta: registro.numero_gta ?? null,
  cidade_origem: registro.cidade_origem ?? null,
  estado_origem: registro.estado_origem ?? null,
  valor_total_compra: comoNumero(registro.valor_total_compra),
  valor_por_cabeca: comoNumero(registro.valor_por_cabeca),
  valor_frete: comoNumero(registro.valor_frete),
  motivo_ajuste: registro.motivo_ajuste ?? null,
  motivo_outros: registro.motivo_outros ?? null,
  observacoes: registro.observacoes ?? null,
  status: registro.status,
  campos_personalizados: registro.campos_personalizados ?? {},
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  nome: (v) => textoOuNulo(v),
  identificador_nome: (v) => textoOuNulo(v),
  identificador_sigla: (v) => textoOuNulo(v),
  identificador_cor: (v) => textoOuNulo(v),
  quantidade_cabecas: (v) => inteiroOuNulo(v),
  categoria: (v) => textoOuNulo(v),
  categoria_manejo_id: (v) => textoOuNulo(v),
  categoria_manejo_nome: (v) => textoOuNulo(v),
  sexo: (v) => textoOuNulo(v),
  peso_medio_kg: (v) => decimalOuNulo(v),
  idade_media_meses: (v) => inteiroOuNulo(v),
  setor_id: (v) => textoOuNulo(v),
  area_atual_id: (v) => textoOuNulo(v),
  raca_predominante: (v) => textoOuNulo(v),
  sistema_produtivo: (v) => textoOuNulo(v),
  data_entrada: (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const texto = String(v).slice(0, 10);
    return new Date(`${texto}T00:00:00.000Z`);
  },
  motivo_entrada: (v) => textoOuNulo(v),
  origem: (v) => textoOuNulo(v),
  fornecedor_id: (v) => textoOuNulo(v),
  fornecedor_nome: (v) => textoOuNulo(v),
  nota_fiscal: (v) => textoOuNulo(v),
  chave_nfe: (v) => textoOuNulo(v),
  numero_gta: (v) => textoOuNulo(v),
  cidade_origem: (v) => textoOuNulo(v),
  estado_origem: (v) => textoOuNulo(v),
  valor_total_compra: (v) => decimalOuNulo(v),
  valor_por_cabeca: (v) => decimalOuNulo(v),
  valor_frete: (v) => decimalOuNulo(v),
  motivo_ajuste: (v) => textoOuNulo(v),
  motivo_outros: (v) => textoOuNulo(v),
  observacoes: (v) => textoOuNulo(v),
  status: (v) => textoOuNulo(v),
  campos_personalizados: (v) => (v === undefined ? undefined : v && typeof v === 'object' ? v : {}),
  area_entrada_id: (v) => textoOuNulo(v),
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

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string | null | undefined} setorId
 */
const resolverSetor = async (tx, clienteId, setorId) => {
  if (!setorId) return { setor_id: null, setor_nome: null };
  const setor = await buscarSetor(clienteId, setorId, tx);
  if (!setor) throw setorNotFound();
  return { setor_id: setorId, setor_nome: setor.nome };
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string | null | undefined} areaId
 */
const resolverArea = async (tx, clienteId, areaId) => {
  if (!areaId) return { id: null, nome: null };
  const area = await buscarArea(clienteId, areaId, tx);
  if (!area) throw areaNotFound();
  return { id: areaId, nome: area.nome };
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarLotes(auth.clienteId);
  return registros.map(comoLotePublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criado = await prisma.$transaction(async (tx) => {
    const empresaId = String(campos.empresa_id);
    const nome = String(campos.nome);
    const quantidade = Number(campos.quantidade_cabecas);
    const motivo = String(campos.motivo_entrada);

    const setorId =
      campos.setor_id === undefined || campos.setor_id === null
        ? null
        : String(campos.setor_id);
    const areaEntradaId =
      campos.area_entrada_id === undefined || campos.area_entrada_id === null
        ? null
        : String(campos.area_entrada_id);
    const areaAtualIdRaw =
      campos.area_atual_id === undefined || campos.area_atual_id === null
        ? areaEntradaId
        : String(campos.area_atual_id);

    const setor = await resolverSetor(tx, auth.clienteId, setorId);
    const areaEntrada = await resolverArea(tx, auth.clienteId, areaEntradaId);
    const areaAtual = await resolverArea(tx, auth.clienteId, areaAtualIdRaw);

    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const categoria = campos.categoria ?? null;
    const categoriaManejoId = campos.categoria_manejo_id ?? null;
    const categoriaManejoNome = campos.categoria_manejo_nome ?? null;
    const pesoMedio = campos.peso_medio_kg ?? null;

    const registro = await inserirLote(tx, {
      cliente_id: auth.clienteId,
      empresa_id: empresaId,
      numero_lote: String(numero),
      nome,
      identificador_nome: campos.identificador_nome ?? null,
      identificador_sigla: campos.identificador_sigla ?? null,
      identificador_cor: campos.identificador_cor ?? null,
      quantidade_cabecas: quantidade,
      quantidade_entrada: quantidade,
      categoria,
      categoria_entrada: categoria,
      categoria_manejo_id: categoriaManejoId,
      categoria_manejo_nome: categoriaManejoNome,
      categoria_manejo_entrada_id: categoriaManejoId,
      categoria_manejo_entrada_nome: categoriaManejoNome,
      sexo: campos.sexo ?? null,
      peso_medio_kg: pesoMedio,
      peso_entrada_kg: pesoMedio,
      idade_media_meses: campos.idade_media_meses ?? null,
      setor_id: setor.setor_id,
      setor_nome: setor.setor_nome,
      area_entrada_id: areaEntrada.id,
      area_entrada_nome: areaEntrada.nome,
      area_atual_id: areaAtual.id,
      area_atual_nome: areaAtual.nome,
      raca_predominante: campos.raca_predominante ?? null,
      sistema_produtivo: campos.sistema_produtivo ?? null,
      data_entrada: campos.data_entrada ?? null,
      motivo_entrada: motivo,
      origem: campos.origem ?? null,
      fornecedor_id: campos.fornecedor_id ?? null,
      fornecedor_nome: campos.fornecedor_nome ?? null,
      nota_fiscal: campos.nota_fiscal ?? null,
      chave_nfe: campos.chave_nfe ?? null,
      numero_gta: campos.numero_gta ?? null,
      cidade_origem: campos.cidade_origem ?? null,
      estado_origem: campos.estado_origem ?? null,
      valor_total_compra: campos.valor_total_compra ?? null,
      valor_por_cabeca: campos.valor_por_cabeca ?? null,
      valor_frete: campos.valor_frete ?? null,
      motivo_ajuste: campos.motivo_ajuste ?? null,
      motivo_outros: campos.motivo_outros ?? null,
      observacoes: campos.observacoes ?? null,
      status: campos.status ?? 'Ativo',
      campos_personalizados: campos.campos_personalizados ?? {},
    });

    const publico = comoLotePublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'Lote',
        entidadeId: registro.id,
        dadosNovos: publico,
      },
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
    const anterior = await buscarLote(auth.clienteId, id, tx);
    if (!anterior) throw loteNotFound();

    const campos = camposDe(entrada);
    /** @type {Record<string, unknown>} */
    const patch = { ...campos };

    if (Object.prototype.hasOwnProperty.call(patch, 'setor_id')) {
      const setorId =
        patch.setor_id === undefined || patch.setor_id === null
          ? null
          : String(patch.setor_id);
      const setor = await resolverSetor(tx, auth.clienteId, setorId);
      patch.setor_id = setor.setor_id;
      patch.setor_nome = setor.setor_nome;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'area_atual_id')) {
      const areaId =
        patch.area_atual_id === undefined || patch.area_atual_id === null
          ? null
          : String(patch.area_atual_id);
      const area = await resolverArea(tx, auth.clienteId, areaId);
      patch.area_atual_id = area.id;
      patch.area_atual_nome = area.nome;
    }

    const registro = Object.keys(patch).length
      ? await atualizarLotePorId(tx, auth.clienteId, id, patch)
      : anterior;

    const publico = comoLotePublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Lote',
        entidadeId: id,
        dadosAnteriores: comoLotePublico(anterior),
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
    const anterior = await buscarLote(auth.clienteId, id, tx);
    if (!anterior) throw loteNotFound();

    const motivo = await motivoBloqueioExclusaoLote(tx, auth.clienteId, id);
    if (motivo) {
      throw loteDeleteBlocked(motivo, { details: { id } });
    }

    await excluirLotePorId(tx, auth.clienteId, id);

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'Lote',
        entidadeId: id,
        dadosAnteriores: comoLotePublico(anterior),
      },
      tx
    );
  });
};
