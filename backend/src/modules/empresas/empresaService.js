/**
 * Serviço de Empresa (P5.4 + EMPRESA-NUM-01).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './empresaRepository.js';
import { reservarNumeroEmpresa } from './empresaSequencia.js';

const CAMPOS_GRAVAVEIS = Object.freeze([
  'apelido',
  'nome',
  'tipo_pessoa',
  'cpf',
  'rg',
  'cnpj',
  'inscricao_estadual',
  'telefone',
  'email',
  'endereco',
  'cidade',
  'estado',
  'cep',
  'logotipo_url',
  'observacoes',
]);

const erroNaoEncontrado = () => new AppError('EMPRESA_NOT_FOUND', 'Empresa não encontrado');
const erroNomeConflito = () =>
  new AppError('EMPRESA_NAME_CONFLICT', 'Já existe uma empresa cadastrada com este nome.');
const erroCampoImutavel = (campo) =>
  new AppError('REQUEST_VALIDATION_FAILED', `Campo não permitido na escrita: ${campo}`);

/** @param {Record<string, unknown>} entrada */
const rejeitarCamposProibidos = (entrada) => {
  if (!entrada || typeof entrada !== 'object') return;
  if ('numero_empresa' in entrada) throw erroCampoImutavel('numero_empresa');
  if ('cliente_id' in entrada) throw erroCampoImutavel('cliente_id');
  if ('id' in entrada) throw erroCampoImutavel('id');
};

/** @param {Record<string, unknown>} entrada */
const normalizarEntrada = (entrada) => {
  rejeitarCamposProibidos(entrada);
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const campo of CAMPOS_GRAVAVEIS) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    let valor = entrada[campo];
    if (campo === 'nome' || campo === 'apelido') {
      valor = typeof valor === 'string' ? valor.trim().toUpperCase() : valor;
    }
    if (
      ['cpf', 'rg', 'cnpj', 'inscricao_estadual', 'telefone', 'email', 'endereco', 'cidade', 'estado', 'cep', 'logotipo_url', 'observacoes'].includes(
        campo,
      ) &&
      (valor === '' || valor === undefined)
    ) {
      valor = null;
    }
    saida[campo] = valor;
  }
  return saida;
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} clienteId @param {string} nome @param {string|null} ignorarId */
const existeNome = async (tx, clienteId, nome, ignorarId = null) => {
  const alvo = typeof nome === 'string' ? nome.trim().toUpperCase() : '';
  if (!alvo) return false;
  const registros = await tx.empresa.findMany({
    where: { cliente_id: clienteId },
    select: { id: true, nome: true },
  });
  return registros.some(
    (r) => r.id !== ignorarId && String(r.nome || '').trim().toUpperCase() === alvo,
  );
};

/** @param {Record<string, unknown>} registro */
export const comoPublico = (registro) => {
  // eslint-disable-next-line no-unused-vars -- tenant não exposto na API pública
  const { createdAt, updatedAt, cliente_id, ...resto } = registro;
  return {
    ...resto,
    created_date: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    updated_date: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  void filtros;
  const registros = await listarRegistros(auth.clienteId);
  return registros.map(comoPublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const dados = normalizarEntrada(/** @type {Record<string, unknown>} */ (entrada ?? {}));
  const prisma = getPrismaClient();

  try {
    const criado = await prisma.$transaction(async (tx) => {
      if (await existeNome(tx, auth.clienteId, String(dados.nome ?? ''))) {
        throw erroNomeConflito();
      }

      const numero = await reservarNumeroEmpresa(tx, auth.clienteId);
      const registro = await inserirRegistro(tx, {
        ...dados,
        cliente_id: auth.clienteId,
        numero_empresa: numero,
      });
      await registrarEvento(
        contexto,
        { acao: 'create', entidade: 'Empresa', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
        tx,
      );
      return registro;
    });
    return comoPublico(criado);
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    if (/** @type {{code?: string}} */ (erro)?.code === 'P2002') throw erroNomeConflito();
    throw erro;
  }
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const dados = normalizarEntrada(/** @type {Record<string, unknown>} */ (entrada ?? {}));
  const prisma = getPrismaClient();

  try {
    const atualizado = await prisma.$transaction(async (tx) => {
      const existente = await buscarRegistro(auth.clienteId, id, tx);
      if (!existente) throw erroNaoEncontrado();
      if (dados.nome && (await existeNome(tx, auth.clienteId, String(dados.nome), id))) {
        throw erroNomeConflito();
      }
      const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, { ...dados });
      await registrarEvento(
        contexto,
        {
          acao: 'update',
          entidade: 'Empresa',
          entidadeId: id,
          dadosAnteriores: comoPublico(existente),
          dadosNovos: comoPublico(registro),
        },
        tx,
      );
      return registro;
    });
    return comoPublico(atualizado);
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    if (/** @type {{code?: string}} */ (erro)?.code === 'P2002') throw erroNomeConflito();
    throw erro;
  }
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
      { acao: 'delete', entidade: 'Empresa', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx,
    );
  });
};
