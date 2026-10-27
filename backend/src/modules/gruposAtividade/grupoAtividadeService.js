/**
 * Serviço de GrupoAtividade (P5.0, D-PROD-45).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  grupoAtividadeNotFound,
  grupoAtividadeNomeConflito,
  grupoAtividadeDeleteBlocked,
} from '../../shared/errors/AppError.js';
import {
  listarGrupos,
  buscarGrupo,
  existeGrupoComNome,
  contarTiposDoGrupo,
  inserirGrupo,
  atualizarGrupoPorId,
  excluirGrupoPorId,
  propagarNomeGrupoNosTipos,
} from './grupoAtividadeRepository.js';
import {
  contarPorGrupoAtividade,
  propagarNomeGrupoAtividade,
} from '../lancamentosTarefa/lancamentoTarefaRepository.js';

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const normalizarNomeGrupo = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

/** @param {Record<string, unknown>} registro */
export const comoGrupoPublico = (registro) => ({
  id: registro.id,
  nome_grupo: registro.nome_grupo,
  ativo: registro.ativo,
  descricao: registro.descricao ?? null,
  cor_icone: registro.cor_icone ?? null,
  observacoes: registro.observacoes ?? null,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  nome_grupo: (v) => normalizarNomeGrupo(v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
  descricao: (v) => textoOuNulo(v),
  cor_icone: (v) => textoOuNulo(v),
  observacoes: (v) => textoOuNulo(v),
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

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarGrupos(auth.clienteId);
  return registros.map(comoGrupoPublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criado = await prisma.$transaction(async (tx) => {
    const nome = String(campos.nome_grupo);
    if (await existeGrupoComNome(auth.clienteId, nome, undefined, tx)) {
      throw grupoAtividadeNomeConflito();
    }

    const registro = await inserirGrupo(tx, {
      ...campos,
      cliente_id: auth.clienteId,
    });

    const publico = comoGrupoPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'GrupoAtividade',
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
    const anterior = await buscarGrupo(auth.clienteId, id, tx);
    if (!anterior) throw grupoAtividadeNotFound();

    const campos = camposDe(entrada);
    if (campos.nome_grupo && campos.nome_grupo !== anterior.nome_grupo) {
      const nome = String(campos.nome_grupo);
      if (await existeGrupoComNome(auth.clienteId, nome, id, tx)) {
        throw grupoAtividadeNomeConflito();
      }
    }

    const registro = Object.keys(campos).length
      ? await atualizarGrupoPorId(tx, auth.clienteId, id, campos)
      : anterior;

    if (campos.nome_grupo && campos.nome_grupo !== anterior.nome_grupo) {
      const nomeGrupo = String(registro.nome_grupo);
      await propagarNomeGrupoNosTipos(tx, auth.clienteId, id, nomeGrupo);
      await propagarNomeGrupoAtividade(tx, auth.clienteId, id, nomeGrupo);
    }

    const publico = comoGrupoPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'GrupoAtividade',
        entidadeId: id,
        dadosAnteriores: comoGrupoPublico(anterior),
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
    const anterior = await buscarGrupo(auth.clienteId, id, tx);
    if (!anterior) throw grupoAtividadeNotFound();

    const tipos = await contarTiposDoGrupo(tx, auth.clienteId, id);
    if (tipos > 0) {
      throw grupoAtividadeDeleteBlocked();
    }

    const lancamentos = await contarPorGrupoAtividade(tx, auth.clienteId, id);
    if (lancamentos > 0) {
      throw grupoAtividadeDeleteBlocked('não é possível excluir grupo com lançamentos de tarefa vinculados');
    }

    await excluirGrupoPorId(tx, auth.clienteId, id);

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'GrupoAtividade',
        entidadeId: id,
        dadosAnteriores: comoGrupoPublico(anterior),
      },
      tx
    );
  });
};
