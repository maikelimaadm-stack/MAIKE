import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirVersaoEsperada, separarVersaoEsperada } from '../../shared/sincronizacao/versaoDoRegistro.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { pontoReferenciaNotFound } from '../../shared/errors/AppError.js';
import {
  listarPontos,
  buscarPonto,
  inserirPonto,
  atualizarPontoPorId,
  excluirPontoPorId,
} from './pontoReferenciaRepository.js';
import {
  listarPorPontoReferencia,
  motivosHistoricoBebedouro,
  excluirRegistroPorId as excluirBebedouroPorId,
  atualizarRegistroPorId as atualizarBebedouroPorId,
} from '../bebedouros/bebedouroRepository.js';
import { erroBebedouroComHistorico, comoPublico as comoBebedouroPublico } from '../bebedouros/bebedouroService.js';

export const ENTIDADE_SEQUENCIA = 'PontoReferencia';
export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

/** @param {Record<string, unknown>} registro */
export const comoPontoPublico = (registro) => ({
  id: registro.id,
  empresa_id: registro.empresa_id,
  numero_ponto: registro.numero_ponto,
  nome: registro.nome,
  sigla: registro.sigla ?? null,
  tipo: registro.tipo,
  configuracao_icone_id: registro.configuracao_icone_id ?? null,
  icone_url: registro.icone_url ?? null,
  sub_icone_url: registro.sub_icone_url ?? null,
  coordenadas: registro.coordenadas ?? null,
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
  configuracao_icone_id: (v) => textoOuNulo(v),
  icone_url: (v) => textoOuNulo(v),
  sub_icone_url: (v) => textoOuNulo(v),
  coordenadas: (v) => (v === undefined ? undefined : v),
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
  const registros = await listarPontos(auth.clienteId);
  return registros.map(comoPontoPublico);
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

    const registro = await inserirPonto(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_ponto: String(numero),
    });
    const publico = comoPontoPublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'PontoReferencia',
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
    const { versaoEsperada } = separarVersaoEsperada(entrada);
    // D-PROD-344: versão conferida sob a trava da linha (como no lote, D-PROD-316).
    if (versaoEsperada) await tx.$queryRaw`SELECT id FROM "PontoReferencia" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR NO KEY UPDATE`;
    const anterior = await buscarPonto(auth.clienteId, id, tx);
    if (!anterior) throw pontoReferenciaNotFound();
    await exigirVersaoEsperada(tx, { clienteId: auth.clienteId, entidade: 'PontoReferencia', registro: anterior, versaoEsperada, rotulo: 'O ponto', pedido: camposDe(entrada) });

    const campos = camposDe(entrada);
    const registro = Object.keys(campos).length
      ? await atualizarPontoPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoPontoPublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'PontoReferencia',
        entidadeId: id,
        dadosAnteriores: comoPontoPublico(anterior),
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

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarPonto(auth.clienteId, id, tx);
    if (!anterior) throw pontoReferenciaNotFound();

    // O bebedouro é ligado ao ponto SÓ por `ponto_referencia_id`, na mesma transação:
    //  - sem histórico → sai junto (antes ficava ativo, sem ponto e sem como apagar);
    //  - INATIVO com histórico (o ponto deixou de ser bebedouro) → fica, inativo,
    //    com o histórico, e só é desligado do ponto (`ponto_referencia_id = null`);
    //    antes ele travava para sempre a exclusão do ponto;
    //  - ATIVO com histórico → 409, nada sai (inative-o trocando o tipo do ponto).
    const bebedouros = await listarPorPontoReferencia(tx, auth.clienteId, id);
    const destino = [];
    for (const bebedouro of bebedouros) {
      const motivos = await motivosHistoricoBebedouro(tx, auth.clienteId, bebedouro.id);
      if (!motivos.length) destino.push({ bebedouro, acao: 'excluir' });
      else if (bebedouro.ativo === false) destino.push({ bebedouro, acao: 'desligar' });
      else throw erroBebedouroComHistorico(bebedouro.id, motivos);
    }
    for (const { bebedouro, acao } of destino) {
      if (acao === 'excluir') {
        await excluirBebedouroPorId(tx, auth.clienteId, bebedouro.id);
        await registrarEvento(
          contexto,
          { acao: 'delete', entidade: 'Bebedouro', entidadeId: bebedouro.id, dadosAnteriores: comoBebedouroPublico(bebedouro) },
          tx
        );
      } else {
        const desligado = await atualizarBebedouroPorId(tx, auth.clienteId, bebedouro.id, { ponto_referencia_id: null });
        await registrarEvento(
          contexto,
          {
            acao: 'update',
            entidade: 'Bebedouro',
            entidadeId: bebedouro.id,
            dadosAnteriores: comoBebedouroPublico(bebedouro),
            dadosNovos: comoBebedouroPublico(desligado),
          },
          tx
        );
      }
    }

    await excluirPontoPorId(tx, auth.clienteId, id);
    const publico = comoPontoPublico(anterior);
    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'PontoReferencia',
        entidadeId: id,
        dadosAnteriores: publico,
      },
      tx
    );
    return publico;
  });
};
