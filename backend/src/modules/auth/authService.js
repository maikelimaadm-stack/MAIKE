/**
 * Regra de autenticação.
 *
 * Decisões que este arquivo materializa:
 *
 *  - o cliente HTTP envia **apenas** `login` e `senha`. O `cliente_id` é
 *    **resultado** da autenticação (via linha do `Usuario`), nunca entrada —
 *    é essa inversão que impede tenant vindo do payload (D-PROD-33);
 *  - a mensagem de falha é a mesma para usuário inexistente, login ambíguo,
 *    usuário inativo e senha errada. Distinguir os casos entrega oráculo de
 *    enumeração;
 *  - a comparação de senha roda mesmo quando o usuário não existe, contra um
 *    hash descartável. Sem isso, o tempo de resposta separa "usuário existe" de
 *    "não existe" e o oráculo volta pelo relógio.
 */

import bcrypt from 'bcryptjs';

import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { buscarUsuarioAtivoPorLogin } from './authRepository.js';

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
 * @param {{login?: unknown, senha?: unknown}} entrada
 */
const normalizarEntrada = (entrada) => {
  const bruto = typeof entrada?.login === 'string' ? entrada.login.trim() : '';
  return {
    login: bruto ? bruto.toLowerCase() : '',
    senha: typeof entrada?.senha === 'string' ? entrada.senha : '',
  };
};

/**
 * Autentica e devolve o material do `auth_context`.
 *
 * @param {{login?: unknown, senha?: unknown}} entrada
 * @returns {Promise<{clienteId: string, usuarioId: string, login: string, nome: string}>}
 */
export const autenticar = async (entrada) => {
  const { login, senha } = normalizarEntrada(entrada);

  if (!login || !senha) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', FALHA_DE_CREDENCIAL);
  }

  const usuario = await buscarUsuarioAtivoPorLogin(login);

  // Roda sempre — inclusive sem usuário — para não vazar existência pelo tempo.
  const hashParaComparar = usuario?.senha_hash || HASH_DESCARTAVEL;
  const senhaConfere = await bcrypt.compare(senha, hashParaComparar);

  if (!usuario || !senhaConfere) {
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
