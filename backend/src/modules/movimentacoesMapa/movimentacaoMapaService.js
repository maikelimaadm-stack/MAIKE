/**
 * Serviço de MovimentacaoMapa (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { documentoComoPublico, montarDocumento } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
  buscarNomesDeAreas,
} from './movimentacaoMapaRepository.js';

const ENTIDADE = 'MovimentacaoMapa';
const erroNaoEncontrado = () => new AppError('MOVIMENTACAOMAPA_NOT_FOUND', 'MovimentacaoMapa não encontrado');

/** Pares id → nome de área gravados no documento da movimentação. */
const CAMPOS_DE_AREA = Object.freeze([
  ['area_origem_id', 'area_origem_nome'],
  ['area_destino_id', 'area_destino_nome'],
  ['area_id', 'area_nome'],
]);

/**
 * O id da área é a fonte de verdade; o nome é cópia de leitura. O cliente
 * mandava o nome a partir de um cache local que podia não ter a área recém-
 * criada, e gravava `area_destino_nome: ""` com o id certo. Aqui o nome vem
 * do banco (mesmo tenant e empresa). Id que não resolve fica como veio: não
 * recusa histórico nem fila offline, só não inventa nome.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Record<string, any>} documento já montado (`montarDocumento`)
 */
const comNomesDeAreaResolvidos = async (tx, clienteId, documento) => {
  const dados = documento.dados && typeof documento.dados === 'object' ? documento.dados : {};
  const ids = [
    ...new Set(
      CAMPOS_DE_AREA.map(([campoId]) => dados[campoId]).filter((id) => typeof id === 'string' && id.trim() !== '')
    ),
  ];
  if (!ids.length) return documento;
  const nomes = await buscarNomesDeAreas(tx, clienteId, documento.empresa_id, ids);
  const resolvidos = { ...dados };
  for (const [campoId, campoNome] of CAMPOS_DE_AREA) {
    const nome = nomes.get(dados[campoId]);
    if (nome) resolvidos[campoNome] = nome;
  }
  return { ...documento, dados: resolvidos };
};

export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(documentoComoPublico);
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    const dados = await comNomesDeAreaResolvidos(tx, auth.clienteId, montarDocumento(auth.clienteId, entrada));
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: documentoComoPublico(registro) },
      tx
    );
    return registro;
  });
  return documentoComoPublico(criado);
};

export const criarEmLote = async (contexto, registros) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!Array.isArray(registros) || registros.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'lista vazia');
  }
  const prisma = getPrismaClient();
  const criados = await prisma.$transaction(async (tx) => {
    const saida = [];
    for (const entrada of registros) {
      const dados = await comNomesDeAreaResolvidos(tx, auth.clienteId, montarDocumento(auth.clienteId, entrada));
      const registro = await inserirRegistro(tx, dados);
      saida.push(registro);
    }
    return saida;
  });
  return criados.map(documentoComoPublico);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const patch = await comNomesDeAreaResolvidos(
      tx,
      auth.clienteId,
      montarDocumento(auth.clienteId, { ...documentoComoPublico(existente), ...entrada }, { atualizacao: true, id, dadosAnteriores: existente.dados })
    );
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, patch);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: documentoComoPublico(existente),
        dadosNovos: documentoComoPublico(registro),
      },
      tx
    );
    return registro;
  });
  return documentoComoPublico(atualizado);
};

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: documentoComoPublico(existente) },
      tx
    );
  });
};
