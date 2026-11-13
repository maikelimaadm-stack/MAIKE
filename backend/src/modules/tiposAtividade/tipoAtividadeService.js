/**
 * Serviço de TipoAtividade (D-PROD-180).
 *
 * Espelho do serviço de TipoTarefa (D-PROD-45), sem o que é específico de
 * LancamentoTarefa: Tipo de Atividade não tem dependentes, então não há
 * propagação de nome nem bloqueio de exclusão. O nome do grupo fica em cache
 * em `grupo_atividade_nome` e é renovado quando o grupo do tipo muda.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { buscarGrupo } from '../gruposAtividade/grupoAtividadeRepository.js';
import {
  tipoAtividadeNotFound,
  tipoAtividadeNomeConflito,
  grupoAtividadeNotFound,
} from '../../shared/errors/AppError.js';
import {
  listarTipos,
  buscarTipo,
  existeTipoComNomeNoGrupo,
  inserirTipo,
  atualizarTipoPorId,
  excluirTipoPorId,
} from './tipoAtividadeRepository.js';

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

/** Mesmo normalizador do Tipo de Tarefa: o nome é gravado em MAIÚSCULAS. */
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

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const obter = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registro = await buscarTipo(auth.clienteId, id);
  if (!registro) throw tipoAtividadeNotFound();
  return comoTipoPublico(registro);
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
      throw tipoAtividadeNomeConflito();
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
        entidade: 'TipoAtividade',
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
    if (!anterior) throw tipoAtividadeNotFound();

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
        throw tipoAtividadeNomeConflito();
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
        entidade: 'TipoAtividade',
        entidadeId: id,
        dadosAnteriores: comoTipoPublico(anterior),
        dadosNovos: publico,
      },
      tx
    );

    return publico;
  });
};

/**
 * Exclusão física, mesma política do Tipo de Tarefa. Tipo de Atividade não tem
 * dependentes (D-PROD-180), então não há bloqueio além do 404.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id
 */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const anterior = await buscarTipo(auth.clienteId, id, tx);
    if (!anterior) throw tipoAtividadeNotFound();

    await excluirTipoPorId(tx, auth.clienteId, id);

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'TipoAtividade',
        entidadeId: id,
        dadosAnteriores: comoTipoPublico(anterior),
      },
      tx
    );
  });
};
