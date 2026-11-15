/**
 * Serviço de UnidadeMedida (P4.5, D-PROD-44).
 *
 * D-PROD-197 — a unidade usada como unidade de produção padrão de um Tipo de
 * Atividade não é excluída: quem barra é a FK RESTRICT do tipo (este módulo
 * NUNCA consulta `TipoAtividade`, lição do hotfix #259), reconhecida no erro e
 * traduzida aqui em 409 `UNIDADE_MEDIDA_DELETE_BLOCKED` (antes, o P2003 caía no
 * 403 enganoso do `errorHandler`).
 *
 * D-PROD-200 — o mesmo para a unidade de produção HERDADA por uma atividade
 * (snapshot do tipo): a FK RESTRICT da `Atividade` barra, reconhecida pelo nome
 * (`shared/errors/vinculoAtividade.js`; este módulo não consulta `Atividade`),
 * e vira o mesmo 409 com `details.vinculo = 'atividade'`.
 *
 * D-PROD-203 — o mesmo para a unidade de medida de um SERVIÇO (cadastro da
 * Fatia 4): a FK RESTRICT do `Servico` barra, reconhecida pelo nome
 * (`shared/errors/vinculoServico.js`; este módulo não consulta `Servico`), e vira
 * o mesmo 409 com `details.vinculo = 'servico'`.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { unidadeMedidaDeleteBlocked, unidadeMedidaNotFound, unidadeMedidaSiglaConflito } from '../../shared/errors/AppError.js';
import { vinculoComAtividade } from '../../shared/errors/vinculoAtividade.js';
import { vinculoComTipoAtividadePadrao } from '../../shared/errors/vinculoTipoAtividadePadrao.js';
import { vinculoComServico } from '../../shared/errors/vinculoServico.js';
import {
  listarUnidades,
  listarUnidadesPagina,
  contarUnidades,
  buscarUnidade,
  existeUnidadeComSigla,
  inserirUnidade,
  atualizarUnidadePorId,
  excluirUnidadePorId,
} from './unidadeMedidaRepository.js';
import {
  decodificarCursor,
  normalizarLimite,
  montarEnvelopeKeyset,
} from '../../shared/pagination/keysetCursor.js';
import { AppError } from '../../shared/errors/AppError.js';

export const ENTIDADE_SEQUENCIA = 'UnidadeMedida';

export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const normalizarSigla = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

const normalizarDescricao = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

/** @param {Record<string, unknown>} registro */
export const comoUnidadePublica = (registro) => ({
  id: registro.id,
  numero_unidade: registro.numero_unidade,
  sigla: registro.sigla,
  descricao: registro.descricao,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  sigla: (v) => normalizarSigla(v),
  descricao: (v) => normalizarDescricao(v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
  numero_unidade: (v) => textoOuNulo(v),
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
  const registros = await listarUnidades(auth.clienteId);
  return registros.map(comoUnidadePublica);
};

/**
 * Listagem paginada keyset — motor Base1 (D-PROD-55).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} query
 */
export const listarPagina = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const limit = normalizarLimite(query.limit);
  const q = typeof query.q === 'string' ? query.q : null;
  let ativo = null;
  if (query.ativo === true || query.ativo === 'true' || query.ativo === '1') ativo = true;
  if (query.ativo === false || query.ativo === 'false' || query.ativo === '0') ativo = false;

  const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'cursor inválido', { details: { field: 'cursor', reason: 'cursor_invalido' } });
  }

  const filtro = { q, ativo, cursor, limit };
  const [registros, total] = await Promise.all([
    listarUnidadesPagina(auth.clienteId, filtro),
    contarUnidades(auth.clienteId, { q, ativo }),
  ]);

  return montarEnvelopeKeyset({
    registros,
    limit,
    total,
    mapItem: comoUnidadePublica,
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criada = await prisma.$transaction(async (tx) => {
    const sigla = String(campos.sigla);
    if (await existeUnidadeComSigla(auth.clienteId, sigla, undefined, tx)) {
      throw unidadeMedidaSiglaConflito();
    }

    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirUnidade(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_unidade: String(numero),
      sigla,
      descricao: String(campos.descricao),
    });

    const publica = comoUnidadePublica(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'UnidadeMedida',
        entidadeId: registro.id,
        dadosNovos: publica,
      },
      tx
    );

    return publica;
  });

  return criada;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarUnidade(auth.clienteId, id, tx);
    if (!anterior) throw unidadeMedidaNotFound();

    const campos = camposDe(entrada);
    if (campos.sigla && campos.sigla !== anterior.sigla) {
      const sigla = String(campos.sigla);
      if (await existeUnidadeComSigla(auth.clienteId, sigla, id, tx)) {
        throw unidadeMedidaSiglaConflito();
      }
    }

    const registro = Object.keys(campos).length
      ? await atualizarUnidadePorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publica = comoUnidadePublica(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'UnidadeMedida',
        entidadeId: id,
        dadosAnteriores: comoUnidadePublica(anterior),
        dadosNovos: publica,
      },
      tx
    );

    return publica;
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const anterior = await buscarUnidade(auth.clienteId, id, tx);
    if (!anterior) throw unidadeMedidaNotFound();

    try {
      await excluirUnidadePorId(tx, auth.clienteId, id);
    } catch (erro) {
      // D-PROD-197: a FK do padrão do tipo; D-PROD-200: a FK da unidade de produção da
      // atividade. As duas são reconhecidas pelo nome exato (uma não casa com a outra);
      // qualquer outro erro segue como antes.
      if (vinculoComTipoAtividadePadrao(erro)?.campo === 'unidade_producao_id') {
        throw unidadeMedidaDeleteBlocked(undefined, { cause: erro });
      }
      if (vinculoComAtividade(erro)?.campo === 'unidade_producao_id') {
        throw unidadeMedidaDeleteBlocked(undefined, { cause: erro, details: { vinculo: 'atividade' } });
      }
      // D-PROD-203: a FK da unidade de medida do serviço.
      if (vinculoComServico(erro)?.campo === 'unidade_medida_id') {
        throw unidadeMedidaDeleteBlocked(undefined, { cause: erro, details: { vinculo: 'servico' } });
      }
      throw erro;
    }

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'UnidadeMedida',
        entidadeId: id,
        dadosAnteriores: comoUnidadePublica(anterior),
      },
      tx
    );
  });
};
