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
import { PAPEL_ADMIN_TENANT } from '../../shared/auth/exigirAdminTenant.js';
import { buscarPapelTenant, buscarUsuarioAtivoPorLogin } from './authRepository.js';

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

/** Confere uma senha contra o hash gravado (troca da própria senha, PR145-R4). */
export const senhaConfereComHash = async (senha, hash) =>
  typeof senha === 'string' && typeof hash === 'string' && hash ? bcrypt.compare(senha, hash) : false;

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
 * @returns {Promise<{clienteId: string, usuarioId: string, login: string, nome: string, clienteSessaoEpoca: number, usuarioSessaoEpoca: number}>}
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
    clienteSessaoEpoca: usuario.cliente.sessao_epoca,
    usuarioSessaoEpoca: usuario.sessao_epoca,
  };
};

/**
 * Payload do token. Carrega identidade, nunca senha nem hash.
 *
 * S04-P1: também as épocas de sessão do cliente e da conta lidas no login.
 * `app.autenticar` compara com o banco a cada requisição; qualquer diferença
 * (suspensão, desativação, troca de senha ou de papel depois do login) recusa
 * o token para sempre.
 *
 * @param {{clienteId: string, usuarioId: string, login: string, clienteSessaoEpoca: number, usuarioSessaoEpoca: number}} identidade
 */
export const montarPayloadDeSessao = ({ clienteId, usuarioId, login, clienteSessaoEpoca, usuarioSessaoEpoca }) => ({
  cliente_id: clienteId,
  usuario_id: usuarioId,
  login,
  cliente_sessao_epoca: clienteSessaoEpoca,
  usuario_sessao_epoca: usuarioSessaoEpoca,
});

/**
 * Validade do token. Com "Manter conectado" (D-PROD-136) usa
 * `AUTH_TOKEN_TTL_LEMBRAR` (padrão 30 dias); sem, `AUTH_TOKEN_TTL` (8 h).
 *
 * @param {{ lembrar?: boolean }} [opcoes]
 */
export const ttlDaSessao = (opcoes = {}) => (opcoes?.lembrar === true ? env.authTokenTtlLembrar : env.authTokenTtl);

/**
 * A conta é administradora da fazenda? Só para a interface decidir o menu;
 * a autorização real continua em cada rota (`exigirAdminTenant`).
 *
 * @param {{clienteId: string, usuarioId: string}} auth
 */
export const ehAdministradorDaFazenda = async ({ clienteId, usuarioId }) =>
  (await buscarPapelTenant(clienteId, usuarioId)) === PAPEL_ADMIN_TENANT;
