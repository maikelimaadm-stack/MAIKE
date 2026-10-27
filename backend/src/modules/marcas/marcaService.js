/**
 * Serviço de Marca (P4.4-Marcas, D-PROD-42).
 *
 * Tenant do `auth_context`; numeração por `EntidadeCodigoSequencia` na mesma
 * transação da criação; nome normalizado em maiúsculas para paridade com o
 * cadastro Base1.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { marcaNotFound, marcaNomeConflito } from '../../shared/errors/AppError.js';
import {
  listarMarcas,
  buscarMarca,
  existeMarcaComNome,
  inserirMarca,
  atualizarMarcaPorId,
  excluirMarcaPorId,
} from './marcaRepository.js';

export const ENTIDADE_SEQUENCIA = 'Marca';

export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

/** Nome de negócio: maiúsculas, sem espaços nas pontas. */
const normalizarNome = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

/** @param {Record<string, unknown>} registro */
export const comoMarcaPublica = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  numero_marca: registro.numero_marca,
  nome: registro.nome,
  descricao: registro.descricao ?? null,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  nome: (v) => normalizarNome(v),
  descricao: (v) => {
    const limpo = textoOuNulo(v);
    if (limpo === undefined) return undefined;
    if (limpo === null) return null;
    return limpo.toUpperCase();
  },
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

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarMarcas(auth.clienteId);
  return registros.map(comoMarcaPublica);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criada = await prisma.$transaction(async (tx) => {
    const empresaId = String(campos.empresa_id);
    const nome = String(campos.nome);
    if (await existeMarcaComNome(auth.clienteId, empresaId, nome, undefined, tx)) {
      throw marcaNomeConflito();
    }

    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirMarca(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_marca: String(numero),
    });

    const publica = comoMarcaPublica(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'Marca',
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
    const anterior = await buscarMarca(auth.clienteId, id, tx);
    if (!anterior) throw marcaNotFound();

    const campos = camposDe(entrada);
    if (campos.nome && campos.nome !== anterior.nome) {
      const empresa = String(campos.empresa_id ?? anterior.empresa_id);
      const nome = String(campos.nome);
      if (await existeMarcaComNome(auth.clienteId, empresa, nome, id, tx)) {
        throw marcaNomeConflito();
      }
    }

    const registro = Object.keys(campos).length
      ? await atualizarMarcaPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publica = comoMarcaPublica(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Marca',
        entidadeId: id,
        dadosAnteriores: comoMarcaPublica(anterior),
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
    const anterior = await buscarMarca(auth.clienteId, id, tx);
    if (!anterior) throw marcaNotFound();

    await excluirMarcaPorId(tx, auth.clienteId, id);

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'Marca',
        entidadeId: id,
        dadosAnteriores: comoMarcaPublica(anterior),
      },
      tx
    );
  });
};
