/**
 * Serviço de administração de Usuario (P6.0, D-PROD-34).
 *
 * CRUD mínimo para contas de acesso nativas: listar, criar, atualizar nome,
 * ativo e senha. Sem exclusão física — desativar via `ativo: false`.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { gerarSenhaHash } from '../auth/authService.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  usuarioLoginDuplicado,
  usuarioNotFound,
  usuarioSelfDeactivate,
} from '../../shared/errors/AppError.js';
import {
  listarUsuarios,
  buscarUsuario,
  inserirUsuario,
  atualizarUsuarioPorId,
} from './usuarioRepository.js';

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

/** @param {Record<string, unknown>} registro */
export const comoUsuarioPublico = (registro) => ({
  id: registro.id,
  nome: registro.nome,
  login: registro.login,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarUsuarios(auth.clienteId);
  return registros.map(comoUsuarioPublico);
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  const nome = textoOuNulo(entrada.nome);
  const login = textoOuNulo(entrada.login);
  const senha = typeof entrada.senha === 'string' ? entrada.senha : '';

  try {
    const criado = await prisma.$transaction(async (tx) => {
      const senha_hash = await gerarSenhaHash(senha);
      const registro = await inserirUsuario(tx, {
        cliente_id: auth.clienteId,
        nome,
        login,
        senha_hash,
        ativo: true,
      });

      const publico = comoUsuarioPublico(registro);

      await registrarEvento(
        contexto,
        {
          acao: 'create',
          entidade: 'Usuario',
          entidadeId: registro.id,
          dadosNovos: publico,
        },
        tx
      );

      return publico;
    });

    return criado;
  } catch (erro) {
    if (erro?.code === 'P2002') throw usuarioLoginDuplicado();
    throw erro;
  }
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} id
 * @param {Record<string, unknown>} entrada
 */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarUsuario(auth.clienteId, id, tx);
    if (!anterior) throw usuarioNotFound();

    /** @type {Record<string, unknown>} */
    const dados = {};

    if (Object.prototype.hasOwnProperty.call(entrada, 'nome')) {
      const nome = textoOuNulo(entrada.nome);
      if (!nome) throw usuarioNotFound('nome inválido');
      dados.nome = nome;
    }

    if (Object.prototype.hasOwnProperty.call(entrada, 'ativo')) {
      const ativo = Boolean(entrada.ativo);
      if (!ativo && id === auth.usuarioId) throw usuarioSelfDeactivate();
      dados.ativo = ativo;
    }

    if (Object.prototype.hasOwnProperty.call(entrada, 'nova_senha')) {
      const nova = typeof entrada.nova_senha === 'string' ? entrada.nova_senha : '';
      if (!nova) throw usuarioNotFound('senha inválida');
      dados.senha_hash = await gerarSenhaHash(nova);
    }

    const registro =
      Object.keys(dados).length > 0
        ? await atualizarUsuarioPorId(tx, auth.clienteId, id, dados)
        : anterior;

    const publico = comoUsuarioPublico(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Usuario',
        entidadeId: id,
        dadosAnteriores: comoUsuarioPublico(anterior),
        dadosNovos: publico,
      },
      tx
    );

    return publico;
  });
};
