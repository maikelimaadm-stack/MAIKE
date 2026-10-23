import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { linhaGeograficaNotFound } from '../../shared/errors/AppError.js';
import {
  listarLinhas,
  buscarLinha,
  inserirLinha,
  atualizarLinhaPorId,
} from './linhaGeograficaRepository.js';

export const ENTIDADE_SEQUENCIA = 'LinhaGeografica';
export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const comoNumero = (valor) => (valor === null || valor === undefined ? null : Number(valor));

/** @param {Record<string, unknown>} registro */
export const comoLinhaPublica = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  numero_linha: registro.numero_linha,
  nome: registro.nome,
  sigla: registro.sigla ?? null,
  tipo: registro.tipo,
  coordenadas: registro.coordenadas ?? null,
  comprimento_metros: comoNumero(registro.comprimento_metros),
  cor: registro.cor ?? null,
  observacoes: registro.observacoes ?? null,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  nome: (v) => textoOuNulo(v),
  sigla: (v) => textoOuNulo(v),
  tipo: (v) => textoOuNulo(v),
  coordenadas: (v) => (v === undefined ? undefined : v),
  comprimento_metros: (v) => (v === null || v === undefined ? null : v),
  cor: (v) => textoOuNulo(v),
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

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarLinhas(auth.clienteId);
  return registros.map(comoLinhaPublica);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const campos = camposDe(entrada);
    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirLinha(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_linha: String(numero),
    });
    const publico = comoLinhaPublica(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'LinhaGeografica',
        entidadeId: registro.id,
        dadosNovos: publico,
      },
      tx
    );
    return publico;
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarLinha(auth.clienteId, id, tx);
    if (!anterior) throw linhaGeograficaNotFound();

    const campos = camposDe(entrada);
    const registro = Object.keys(campos).length
      ? await atualizarLinhaPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoLinhaPublica(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'LinhaGeografica',
        entidadeId: id,
        dadosAnteriores: comoLinhaPublica(anterior),
        dadosNovos: publico,
      },
      tx
    );
    return publico;
  });
};
