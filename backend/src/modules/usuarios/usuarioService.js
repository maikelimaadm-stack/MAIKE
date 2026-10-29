/**
 * Serviço de administração de Usuario (P6.0, D-PROD-34).
 *
 * CRUD mínimo para contas de acesso nativas: listar, criar, atualizar nome,
 * ativo e senha. Sem exclusão física — desativar via `ativo: false`.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { gerarSenhaHash, senhaConfereComHash } from '../auth/authService.js';
import { atorDoTenant, ehAdminTenantAtivo, exigirAdminTenant } from '../../shared/auth/exigirAdminTenant.js';
import { buscarUsuarioAtivoPorLogin } from '../auth/authRepository.js';
import { registrarEvento } from '../auditoria/auditService.js';
import {
  usuarioLoginDuplicado,
  usuarioNotFound,
  usuarioSelfDeactivate,
  AppError,
} from '../../shared/errors/AppError.js';
import {
  decodificarCursor,
  normalizarLimite,
  montarEnvelopeKeyset,
} from '../../shared/pagination/keysetCursor.js';
import {
  listarUsuarios,
  listarUsuariosPagina,
  contarUsuarios,
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

/** Visão para o administrador da fazenda: inclui o papel (PR145-R4). */
const comoUsuarioParaAdmin = (registro) => ({ ...comoUsuarioPublico(registro), papel_tenant: registro.papel_tenant });

/** Usuário comum vê nomes/logins dos colegas (tarefas, responsáveis), nunca o papel. */
const mapeadorPara = async (contexto) =>
  ehAdminTenantAtivo(await atorDoTenant(contexto)) ? comoUsuarioParaAdmin : comoUsuarioPublico;

/**
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const [registros, mapear] = await Promise.all([listarUsuarios(auth.clienteId), mapeadorPara(contexto)]);
  return registros.map(mapear);
};

/**
 * Listagem paginada por keyset (SCALE-01) — `GET /usuarios/page`.
 *
 * `total` é contado só na primeira página (sem cursor): o motor Base1 lê o
 * total da página 0, e recontar o conjunto a cada "carregar mais" custaria um
 * COUNT por página. Nas páginas seguintes `total` é `null` — "não calculado
 * nesta página", nunca zero nem estimativa.
 *
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} [query]
 */
export const listarPagina = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const limit = normalizarLimite(query.limit);
  const q = typeof query.q === 'string' ? query.q : null;
  let ativo = null;
  if (query.ativo === true || query.ativo === 'true' || query.ativo === '1') ativo = true;
  if (query.ativo === false || query.ativo === 'false' || query.ativo === '0') ativo = false;

  const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'cursor inválido');
  }

  const [registros, total, mapear] = await Promise.all([
    listarUsuariosPagina(auth.clienteId, { q, ativo, cursor, limit }),
    cursor ? Promise.resolve(null) : contarUsuarios(auth.clienteId, { q, ativo }),
    mapeadorPara(contexto),
  ]);

  return montarEnvelopeKeyset({
    registros,
    limit,
    total: /** @type {number} */ (/** @type {unknown} */ (total)),
    mapItem: mapear,
  });
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} entrada
 */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  // PR145-R4: só o administrador ATIVO da fazenda cria contas (antes de qualquer
  // consulta, para não revelar logins a quem não pode criar). A conta nasce
  // `usuario`: o corpo não tem como definir papel.
  await exigirAdminTenant(contexto);

  const nome = textoOuNulo(entrada.nome);
  const loginBruto = textoOuNulo(entrada.login);
  const login = loginBruto ? loginBruto.toLowerCase() : loginBruto;
  const senha = typeof entrada.senha === 'string' ? entrada.senha : '';

  if (login) {
    const conflito = await buscarUsuarioAtivoPorLogin(login);
    if (conflito && conflito.cliente_id !== auth.clienteId) {
      throw usuarioLoginDuplicado();
    }
  }

  try {
    const criado = await prisma.$transaction(async (tx) => {
      await exigirAdminTenant(contexto, tx);
      const senha_hash = await gerarSenhaHash(senha);
      const registro = await inserirUsuario(tx, {
        cliente_id: auth.clienteId,
        nome,
        login,
        senha_hash,
        ativo: true,
        papel_tenant: 'usuario',
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
  // PR145-R4: outra conta → só administrador ATIVO da fazenda (403 antes de
  // consultar o id, então não revela nada). A própria conta → nome, e senha
  // somente com a senha atual conferida no servidor.
  const ehPropria = id === auth.usuarioId;
  if (!ehPropria) await exigirAdminTenant(contexto);

  return prisma.$transaction(async (tx) => {
    const ator = ehPropria ? await atorDoTenant(contexto, tx) : await exigirAdminTenant(contexto, tx);
    if (!ator?.ativo) throw new AppError('USUARIO_INATIVO', 'conta desativada');
    const anterior = await buscarUsuario(auth.clienteId, id, tx);
    if (!anterior) throw usuarioNotFound();

    if (ehPropria && Object.prototype.hasOwnProperty.call(entrada, 'nova_senha')) {
      if (!(await senhaConfereComHash(entrada.senha_atual, ator.senha_hash))) {
        throw new AppError('USUARIO_SENHA_ATUAL_INVALIDA', 'senha atual incorreta');
      }
    }

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
