import { getPrismaClient } from '../../database/prismaClient.js';
import { criarComIdDoAparelho, foiExcluidoNoHistorico, idDoAparelhoDe } from '../../shared/idempotency/idDoAparelho.js';
import { consultarMudancas } from '../../shared/sincronizacao/mudancasIncrementais.js';
import { exigirVersaoEsperada, separarVersaoEsperada } from '../../shared/sincronizacao/versaoDoRegistro.js';
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

/**
 * D-PROD-345 — o que mudou nas linhas desde a última sincronização do aparelho. Linha não é excluída (sai com
 * `ativo: false`, que volta como item alterado).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {{desde?: string, cursor?: string, limite?: number}} query
 */
export const mudancas = async (contexto, query) => {
  const auth = exigirAuthContext(contexto?.auth);
  return consultarMudancas({ clienteId: auth.clienteId, query, modelo: 'linhaGeografica', entidadeAuditoria: 'LinhaGeografica', publico: comoLinhaPublica });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
/** @param {any} contexto @param {Record<string, unknown>} entrada @param {string|null} idDoAparelho */
const criarComId = async (contexto, entrada, idDoAparelho) => {
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
      ...(idDoAparelho ? { id: idDoAparelho } : {}),
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

/**
 * D-PROD-355 — cria com o id gerado no aparelho (como lote e cocho, D-PROD-308): repetir a MESMA criação (resposta
 * perdida com o sinal fraco, app fechado no meio) devolve o registro já criado em vez de gravar outro em dobro.
 * Sem id do aparelho, o servidor gera o id, como antes.
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { registro } = await criarComIdDoAparelho({
    id: idDoAparelhoDe(entrada?.id),
    clienteId: auth.clienteId,
    entidade: 'LinhaGeografica',
    buscar: async (id) => {
      const registro = await getPrismaClient().linhaGeografica.findUnique({ where: { id } });
      if (registro) return { cliente_id: registro.cliente_id, registro: registro.cliente_id === auth.clienteId ? comoLinhaPublica(registro) : null };
      return (await foiExcluidoNoHistorico(auth.clienteId, 'LinhaGeografica', id)) ? { cliente_id: auth.clienteId, excluido: true, registro: null } : null;
    },
    criar: (id) => criarComId(contexto, entrada, id),
  });
  return registro;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const { versaoEsperada } = separarVersaoEsperada(entrada);
    // D-PROD-344: versão conferida sob a trava da linha (como no lote, D-PROD-316).
    if (versaoEsperada) await tx.$queryRaw`SELECT id FROM "LinhaGeografica" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR NO KEY UPDATE`;
    const anterior = await buscarLinha(auth.clienteId, id, tx);
    if (!anterior) throw linhaGeograficaNotFound();
    await exigirVersaoEsperada(tx, { clienteId: auth.clienteId, entidade: 'LinhaGeografica', registro: anterior, versaoEsperada, rotulo: 'A linha', pedido: camposDe(entrada) });

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
