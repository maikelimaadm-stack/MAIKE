import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { configuracaoIconeNotFound } from '../../shared/errors/AppError.js';
import {
  listarIcones,
  buscarIcone,
  inserirIcone,
  atualizarIconePorId,
} from './configuracaoIconeRepository.js';

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

/** @param {Record<string, unknown>} registro */
export const comoIconePublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id ?? null,
  tipo_entidade: registro.tipo_entidade,
  categoria: registro.categoria,
  icone_url: registro.icone_url ?? null,
  sub_icone_url: registro.sub_icone_url ?? null,
  cor_padrao: registro.cor_padrao ?? null,
  descricao: registro.descricao ?? null,
  categorias_misto: registro.categorias_misto ?? null,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  empresa_id: (v) => textoOuNulo(v),
  tipo_entidade: (v) => textoOuNulo(v),
  categoria: (v) => textoOuNulo(v),
  icone_url: (v) => textoOuNulo(v),
  sub_icone_url: (v) => textoOuNulo(v),
  cor_padrao: (v) => textoOuNulo(v),
  descricao: (v) => textoOuNulo(v),
  categorias_misto: (v) => (v === undefined ? undefined : v),
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
  const registros = await listarIcones(auth.clienteId);
  return registros.map(comoIconePublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const campos = camposDe(entrada);
    const registro = await inserirIcone(tx, {
      ...campos,
      cliente_id: auth.clienteId,
    });
    const publico = comoIconePublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'ConfiguracaoIcone',
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
    const anterior = await buscarIcone(auth.clienteId, id, tx);
    if (!anterior) throw configuracaoIconeNotFound();

    const campos = camposDe(entrada);
    const registro = Object.keys(campos).length
      ? await atualizarIconePorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoIconePublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'ConfiguracaoIcone',
        entidadeId: id,
        dadosAnteriores: comoIconePublico(anterior),
        dadosNovos: publico,
      },
      tx
    );
    return publico;
  });
};
