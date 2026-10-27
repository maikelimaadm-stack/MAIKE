/**
 * Serviço de TipoTarefa (P5.0, D-PROD-45).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { buscarGrupo } from '../gruposAtividade/grupoAtividadeRepository.js';
import {
  tipoTarefaNotFound,
  tipoTarefaNomeConflito,
  grupoAtividadeNotFound,
} from '../../shared/errors/AppError.js';
import {
  listarTipos,
  buscarTipo,
  existeTipoComNomeNoGrupo,
  inserirTipo,
  atualizarTipoPorId,
  excluirTipoPorId,
} from './tipoTarefaRepository.js';

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const normalizarNomeTipo = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

/** @param {Record<string, unknown>} registro */
export const comoTipoPublico = (registro) => ({
  id: registro.id,
  nome_tipo: registro.nome_tipo,
  grupo_atividade_id: registro.grupo_atividade_id,
  grupo_atividade_nome: registro.grupo_atividade_nome,
  ativo: registro.ativo,
  descricao: registro.descricao ?? null,
  exige_area: registro.exige_area,
  pode_ter_produto: registro.pode_ter_produto,
  pode_ter_maquina: registro.pode_ter_maquina,
  pode_ter_implemento: registro.pode_ter_implemento,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  nome_tipo: (v) => normalizarNomeTipo(v),
  grupo_atividade_id: (v) => textoOuNulo(v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
  descricao: (v) => textoOuNulo(v),
  exige_area: (v) => (v === undefined ? undefined : Boolean(v)),
  pode_ter_produto: (v) => (v === undefined ? undefined : Boolean(v)),
  pode_ter_maquina: (v) => (v === undefined ? undefined : Boolean(v)),
  pode_ter_implemento: (v) => (v === undefined ? undefined : Boolean(v)),
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
 * @param {string} grupoId
 */
const resolverGrupo = async (tx, clienteId, grupoId) => {
  const grupo = await buscarGrupo(clienteId, grupoId, tx);
  if (!grupo) throw grupoAtividadeNotFound();
  return grupo;
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarTipos(auth.clienteId);
  return registros.map(comoTipoPublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criado = await prisma.$transaction(async (tx) => {
    const grupoId = String(campos.grupo_atividade_id);
    const grupo = await resolverGrupo(tx, auth.clienteId, grupoId);
    const nome = String(campos.nome_tipo);

    if (await existeTipoComNomeNoGrupo(auth.clienteId, grupoId, nome, undefined, tx)) {
      throw tipoTarefaNomeConflito();
    }

    const registro = await inserirTipo(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      grupo_atividade_id: grupoId,
      grupo_atividade_nome: grupo.nome_grupo,
    });

    const publico = comoTipoPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'TipoTarefa',
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
    const anterior = await buscarTipo(auth.clienteId, id, tx);
    if (!anterior) throw tipoTarefaNotFound();

    const campos = camposDe(entrada);
    const grupoId = String(campos.grupo_atividade_id ?? anterior.grupo_atividade_id);
    let nomeGrupo = anterior.grupo_atividade_nome;

    if (campos.grupo_atividade_id && campos.grupo_atividade_id !== anterior.grupo_atividade_id) {
      const grupo = await resolverGrupo(tx, auth.clienteId, grupoId);
      nomeGrupo = grupo.nome_grupo;
    }
    if (nomeGrupo !== anterior.grupo_atividade_nome) {
      campos.grupo_atividade_nome = nomeGrupo;
    }

    const nomeTipo = campos.nome_tipo ? String(campos.nome_tipo) : anterior.nome_tipo;
    if (
      (campos.nome_tipo && campos.nome_tipo !== anterior.nome_tipo) ||
      (campos.grupo_atividade_id && campos.grupo_atividade_id !== anterior.grupo_atividade_id)
    ) {
      if (await existeTipoComNomeNoGrupo(auth.clienteId, grupoId, nomeTipo, id, tx)) {
        throw tipoTarefaNomeConflito();
      }
    }

    const registro = Object.keys(campos).length
      ? await atualizarTipoPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoTipoPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'TipoTarefa',
        entidadeId: id,
        dadosAnteriores: comoTipoPublico(anterior),
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
    const anterior = await buscarTipo(auth.clienteId, id, tx);
    if (!anterior) throw tipoTarefaNotFound();

    await excluirTipoPorId(tx, auth.clienteId, id);

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'TipoTarefa',
        entidadeId: id,
        dadosAnteriores: comoTipoPublico(anterior),
      },
      tx
    );
  });
};
