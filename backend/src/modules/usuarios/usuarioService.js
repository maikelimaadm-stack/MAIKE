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
import { carregarAutorizacao, acessoTotal, telaPermite } from '../../shared/auth/autorizacaoTela.js';
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
  listarPermissoesParaElegibilidade,
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

/** `/usuarios/page` é só do administrador real (rota); o mapeador fica como defesa. */
const mapeadorPara = async (contexto) =>
  ehAdminTenantAtivo(await atorDoTenant(contexto)) ? comoUsuarioParaAdmin : comoUsuarioPublico;

/**
 * Tela de tarefas do menu legado (`gestao-tarefas`/`gt-lancamentos`): a mesma
 * regra que o Mapa Geral usa para abrir o painel de tarefas a quem não tem
 * acesso total (`podeUsarTarefasMapa`).
 */
const TELA_TAREFAS = Object.freeze({ modulo: 'gestao-tarefas', tela: 'gt-lancamentos' });

/**
 * D-PROD-137 (GET-05) — pode ser responsável de tarefa: conta ATIVA que abre
 * tarefas — administrador real (com ou sem linha de Permissão), concessão
 * `is_admin` ou a tela de tarefas. Calculado POR CONTA no servidor, com a mesma
 * avaliação de tela do resto da autorização (`telaPermite`); antes o formulário
 * recalculava sobre a matriz alheia, que quem não é admin real não recebe, e
 * só listava a si mesmo.
 * @param {{ ativo: boolean, papel_tenant: string, login: string }} usuario
 * @param {Map<string, any>} permissaoPorLogin
 */
const elegivelResponsavel = (usuario, permissaoPorLogin) => {
  if (!usuario.ativo) return false;
  if (ehAdminTenantAtivo(usuario)) return true;
  const registro = permissaoPorLogin.get(usuario.login) ?? null;
  return telaPermite({ ativo: true, adminReal: false, registro }, TELA_TAREFAS, 'visualizar');
};

/**
 * `GET /usuarios` — D-PROD-137 (GET-02/USR-01/GET-05). Projeção por quem pede:
 *  - administrador real → todas as contas (inativas também), com papel e datas
 *    (telas Usuários/Permissões) + `responsavel_elegivel`;
 *  - acesso total (`is_admin`, quem abre e grava tarefas) → só contas ATIVAS,
 *    `{id, nome, login, ativo, responsavel_elegivel}` — o formulário de tarefa
 *    junta por login com `/permissoes` (nome de exibição); sem papel nem datas;
 *  - demais → SÓ a própria conta. Antes, quem só via o mapa recebia o login (a
 *    credencial, D-PROD-35) e o estado de todos os colegas, sem tela que use.
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const aut = await carregarAutorizacao(contexto);
  if (!acessoTotal(aut)) {
    const proprio = await buscarUsuario(auth.clienteId, auth.usuarioId);
    return proprio ? [comoUsuarioPublico(proprio)] : [];
  }
  const [registros, permissoes] = await Promise.all([
    listarUsuarios(auth.clienteId),
    listarPermissoesParaElegibilidade(auth.clienteId),
  ]);
  const permissaoPorLogin = new Map(permissoes.map((p) => [p.user_email, p]));
  const elegivel = (r) => elegivelResponsavel(/** @type {any} */ (r), permissaoPorLogin);
  if (aut.adminReal) return registros.map((r) => ({ ...comoUsuarioParaAdmin(r), responsavel_elegivel: elegivel(r) }));
  return registros
    .filter((r) => r.ativo)
    .map((r) => ({ id: r.id, nome: r.nome, login: r.login, ativo: r.ativo, responsavel_elegivel: elegivel(r) }));
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
