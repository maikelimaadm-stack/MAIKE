/**
 * Serviço de BebedouroHistorico (P5.5).
 *
 * D-PROD-137 (frente M4a) — duas regras que antes viviam só no navegador:
 *  - BEB-03: todo lançamento pertence a um Bebedouro CADASTRADO do tenant
 *    (auth_context) e da mesma empresa do documento. Sem isso o "Lançar" de um
 *    ponto BEBEDOURO sem cadastro gravava um histórico órfão — que nenhuma tela
 *    mostra (ambas filtram por `bebedouro_id`) — e a tela dizia "registrado";
 *  - BEB-02: só o lançamento mais RECENTE de um bebedouro pode ser excluído,
 *    a mesma regra da linha do tempo (só o índice 0 tem "Excluir"). Apagar um
 *    antigo reescrevia o passado (e a "próxima limpeza/inspeção" calculada).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { documentoComoPublico, montarDocumento } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import { buscarRegistro as buscarBebedouro } from '../bebedouros/bebedouroRepository.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
  buscarLancamentoPosterior,
} from './bebedouroHistoricoRepository.js';

const ENTIDADE = 'BebedouroHistorico';
const erroNaoEncontrado = () => new AppError('BEBEDOUROHISTORICO_NOT_FOUND', 'BebedouroHistorico não encontrado');
// Inexistente, de outro tenant ou de outra empresa: a MESMA resposta (sem oráculo de existência).
const erroBebedouroNaoEncontrado = () => new AppError('BEBEDOURO_NOT_FOUND', 'bebedouro não encontrado nesta fazenda');
const erroSomenteUltimo = (bebedouroId) =>
  new AppError('BEBEDOUROHISTORICO_SOMENTE_ULTIMO', 'só o lançamento mais recente do bebedouro pode ser excluído', {
    details: { bebedouro_id: bebedouroId },
  });

/**
 * BEB-03: o documento (já montado, com `empresa_id` da coluna) cita um
 * Bebedouro do tenant e da mesma empresa. O nome gravado passa a ser o do
 * cadastro — o corpo do cliente não decide a qual bebedouro o lançamento "diz"
 * pertencer.
 * @template {{ empresa_id: string, dados: Record<string, unknown> }} T
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {T} documento
 * @returns {Promise<T>}
 */
const exigirBebedouroDoDocumento = async (tx, clienteId, documento) => {
  const bruto = documento.dados?.bebedouro_id;
  if (typeof bruto !== 'string' || !bruto.trim()) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'bebedouro_id é obrigatório: o lançamento precisa de um bebedouro cadastrado', {
      details: { field: 'bebedouro_id', reason: typeof bruto === 'string' || bruto === undefined || bruto === null ? 'required' : 'invalid' },
    });
  }
  const bebedouro = await buscarBebedouro(clienteId, bruto.trim(), tx);
  if (!bebedouro || bebedouro.empresa_id !== documento.empresa_id) throw erroBebedouroNaoEncontrado();
  return /** @type {T} */ ({ ...documento, dados: { ...documento.dados, bebedouro_id: bebedouro.id, bebedouro_nome: bebedouro.nome } });
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
    const dados = await exigirBebedouroDoDocumento(tx, auth.clienteId, montarDocumento(auth.clienteId, entrada));
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
      const dados = await exigirBebedouroDoDocumento(tx, auth.clienteId, montarDocumento(auth.clienteId, entrada));
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
    let patch = montarDocumento(auth.clienteId, { ...documentoComoPublico(existente), ...entrada }, { atualizacao: true, id, dadosAnteriores: existente.dados });
    // BEB-03: o PATCH não pode religar o lançamento a um bebedouro alheio (ou
    // a nenhum). Registro legado sem vínculo continua editável nos demais campos.
    const tinhaVinculo = typeof /** @type {any} */ (existente.dados)?.bebedouro_id === 'string';
    const entradaObj = /** @type {Record<string, unknown>} */ (entrada ?? {});
    if ('bebedouro_id' in entradaObj || ('empresa_id' in entradaObj && tinhaVinculo)) {
      patch = await exigirBebedouroDoDocumento(tx, auth.clienteId, patch);
    }
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
    // BEB-02: só o último do bebedouro (mesma ordem da listagem). Um órfão
    // legado (sem `bebedouro_id`) não está em linha do tempo nenhuma: pode ser
    // limpo sem reescrever a história de bebedouro algum.
    const bebedouroId = /** @type {any} */ (existente.dados)?.bebedouro_id;
    if (typeof bebedouroId === 'string' && bebedouroId) {
      const posterior = await buscarLancamentoPosterior(tx, auth.clienteId, existente, bebedouroId);
      if (posterior) throw erroSomenteUltimo(bebedouroId);
    }
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: documentoComoPublico(existente) },
      tx
    );
  });
};
