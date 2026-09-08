/**
 * Regra de autenticação.
 *
 * Decisões que este arquivo materializa:
 *
 *  - o cliente HTTP envia `cliente` (o `codigo` operacional), nunca
 *    `cliente_id`. O `cliente_id` é **resultado** da autenticação, não entrada
 *    dela — é essa inversão que impede tenant vindo do payload;
 *  - a mensagem de falha é a mesma para cliente inexistente, usuário
 *    inexistente, usuário inativo e senha errada. Distinguir os casos entrega
 *    ao atacante um oráculo de enumeração;
 *  - a comparação de senha roda mesmo quando o usuário não existe, contra um
 *    hash descartável. Sem isso, o tempo de resposta separa "usuário existe" de
 *    "não existe" e o oráculo volta pelo relógio.
 */

import bcrypt from 'bcryptjs';

import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { buscarClientePorCodigo, buscarUsuarioPorLogin } from './authRepository.js';

/** Custo do bcrypt. 10 é o equilíbrio usual entre segurança e latência. */
const BCRYPT_ROUNDS = 10;

/**
 * Hash com o mesmo custo do real, usado quando não há usuário. Comparar contra
 * ele mantém o tempo de resposta constante.
 */
const HASH_DESCARTAVEL = bcrypt.hashSync('__sem_usuario__', BCRYPT_ROUNDS);

/** Mensagem única para toda falha de credencial. */
const FALHA_DE_CREDENCIAL = 'credenciais inválidas';

export const gerarSenhaHash = async (senha) => bcrypt.hash(senha, BCRYPT_ROUNDS);

/**
 * @param {{cliente?: unknown, login?: unknown, senha?: unknown}} entrada
 */
const normalizarEntrada = (entrada) => ({
  cliente: typeof entrada?.cliente === 'string' ? entrada.cliente.trim() : '',
  login: typeof entrada?.login === 'string' ? entrada.login.trim() : '',
  senha: typeof entrada?.senha === 'string' ? entrada.senha : '',
});

/**
 * Autentica e devolve o material do `auth_context`.
 *
 * @param {{cliente?: unknown, login?: unknown, senha?: unknown}} entrada
 * @returns {Promise<{clienteId: string, usuarioId: string, login: string, nome: string}>}
 */
export const autenticar = async (entrada) => {
  const { cliente, login, senha } = normalizarEntrada(entrada);

  if (!cliente || !login || !senha) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', FALHA_DE_CREDENCIAL);
  }

  const clienteEncontrado = await buscarClientePorCodigo(cliente);
  const usuario =
    clienteEncontrado && clienteEncontrado.ativo
      ? await buscarUsuarioPorLogin(clienteEncontrado.id, login)
      : null;

  // Roda sempre — inclusive sem usuário — para não vazar existência pelo tempo.
  const hashParaComparar = usuario?.senha_hash || HASH_DESCARTAVEL;
  const senhaConfere = await bcrypt.compare(senha, hashParaComparar);

  if (!clienteEncontrado || !clienteEncontrado.ativo || !usuario || !usuario.ativo || !senhaConfere) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', FALHA_DE_CREDENCIAL);
  }

  return {
    clienteId: usuario.cliente_id,
    usuarioId: usuario.id,
    login: usuario.login,
    nome: usuario.nome,
  };
};

/**
 * Payload do token. Carrega identidade, nunca senha nem hash.
 * @param {{clienteId: string, usuarioId: string, login: string}} identidade
 */
export const montarPayloadDeSessao = ({ clienteId, usuarioId, login }) => ({
  cliente_id: clienteId,
  usuario_id: usuarioId,
  login,
});

export const ttlDaSessao = () => env.authTokenTtl;
