/**
 * Gestão de clientes pelo MAIKE Admin (MAIKE-SAAS-ADMIN-S03) — ESCRITAS.
 *
 * Só é chamada por rotas `/admin-maike/*` atrás de `exigirSessaoAdmin()`
 * (proprietário, MFA verificado, Origin permitida e CSRF da sessão). O ator
 * vem SEMPRE da sessão (`contexto.admin`), nunca do corpo.
 *
 * Regras:
 *  - criar cliente = `Cliente` + primeiro `Usuario` com `papel_tenant =
 *    'administrador'` numa única transação. Se o login ou o código colidirem
 *    (inclusive em corrida, pelo unique do banco), NADA fica gravado;
 *  - a senha inicial é gerada aqui (CSPRNG), devolvida UMA vez na resposta do
 *    POST e guardada só como hash (bcrypt de `authService`). Nunca vai para
 *    auditoria, log, GET ou URL. Não existe troca obrigatória no primeiro
 *    login: quem recebe a senha deve trocá-la pela tela de usuário;
 *  - não cria `Permissao` nem `Empresa`: a autoridade do administrador é o
 *    `papel_tenant`, e a empresa é criada depois pelo fluxo normal da fazenda;
 *  - suspender = `Cliente.ativo = false`. O login recusa cliente inativo e a
 *    guarda `autenticar` relê `cliente.ativo` a cada requisição, então tokens
 *    já emitidos perdem o acesso na hora. Nada é apagado;
 *  - toda escrita registra `EventoSegurancaAdminMaike` (ator = proprietário,
 *    request id, alvo, antes/depois) na MESMA transação. Não usa `AuditLog`
 *    do tenant: lá o ator é um usuário da fazenda, e o proprietário não é um.
 */

import { randomInt } from 'node:crypto';

import { getPrismaClient } from '../../database/prismaClient.js';
import { adminError } from '../../shared/errors/AppError.js';
import { gerarSenhaHash } from '../auth/authService.js';
import { PAPEL_ADMIN_TENANT } from '../../shared/auth/exigirAdminTenant.js';
import { registrarEventoSeguranca } from './adminService.js';

/** 3–64 caracteres, minúsculas/dígitos/hífen, sem hífen nas pontas. */
export const PADRAO_CODIGO = '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$';
/** Login do primeiro administrador: 3–120, sem espaço. */
export const PADRAO_LOGIN = '^[a-z0-9._@-]{3,120}$';
export const JUSTIFICATIVA_MIN = 10;

// Sem 0/O, 1/l/I: a senha é lida e digitada por uma pessoa.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** 16 símbolos de 57 (~93 bits), em grupos de 4: `Ab3d-Ef4g-Hj5k-Mn6p`. */
export const gerarSenhaTemporaria = () => {
  const s = Array.from({ length: 16 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
  return s.match(/.{4}/g).join('-');
};

const iso = (d) => (d instanceof Date ? d.toISOString() : null);
const comoCliente = (c) => ({ id: c.id, codigo: c.codigo, nome: c.nome, ativo: c.ativo, criado_em: iso(c.createdAt), atualizado_em: iso(c.updatedAt) });
const SELECT_CLIENTE = { id: true, codigo: true, nome: true, ativo: true, createdAt: true, updatedAt: true };

const clienteNaoEncontrado = () => adminError('ADMIN_ENTRADA_INVALIDA', 'cliente não encontrado');
const codigoDuplicado = () => adminError('ADMIN_CLIENTE_CODIGO_DUPLICADO', 'já existe um cliente com este código');
const loginDuplicado = () => adminError('ADMIN_LOGIN_DUPLICADO', 'este login já é usado por outra conta ativa');

/** Normaliza e valida (o schema da rota já recusou tipos e campos extras). */
const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const codigoDe = (v) => {
  const c = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!new RegExp(PADRAO_CODIGO).test(c)) {
    throw adminError('ADMIN_ENTRADA_INVALIDA', 'código: 3 a 64 caracteres, letras minúsculas, números e hífen (sem hífen no começo ou no fim)');
  }
  return c;
};
const nomeDe = (v, campo) => {
  const n = texto(v);
  if (n.length < 2) throw adminError('ADMIN_ENTRADA_INVALIDA', `${campo}: informe pelo menos 2 caracteres`);
  return n.slice(0, 255);
};
const loginDe = (v) => {
  const l = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!new RegExp(PADRAO_LOGIN).test(l)) {
    throw adminError('ADMIN_ENTRADA_INVALIDA', 'login: 3 a 120 caracteres, sem espaços (letras, números, ponto, hífen, sublinhado ou @)');
  }
  return l;
};

/** Unique do banco: `Cliente.codigo` ou o índice parcial global de login ativo. */
const traduzirUnique = (erro) => {
  if (erro?.code !== 'P2002') return erro;
  const alvo = JSON.stringify(erro.meta?.target ?? '');
  return /codigo/.test(alvo) ? codigoDuplicado() : loginDuplicado();
};

/** Login ativo em QUALQUER cliente (ativo ou suspenso), sem diferenciar maiúsculas. */
const loginEmUso = (db, login) =>
  db.usuario.findFirst({ where: { ativo: true, login: { equals: login, mode: 'insensitive' } }, select: { id: true } });

/**
 * `POST /admin-maike/clientes`.
 *
 * @param {{ nome: string, codigo: string, administrador: { nome: string, login: string } }} entrada
 * @param {{ admin: { id: string }, ip?: string, requestId: string }} ctx
 */
export const criarCliente = async (entrada, ctx) => {
  const nome = nomeDe(entrada.nome, 'nome do cliente');
  const codigo = codigoDe(entrada.codigo);
  const adminNome = nomeDe(entrada.administrador?.nome, 'nome do administrador');
  const login = loginDe(entrada.administrador?.login);
  const db = getPrismaClient();

  // Mensagens específicas no caminho comum; o unique do banco decide a corrida.
  if (await db.cliente.findUnique({ where: { codigo }, select: { id: true } })) throw codigoDuplicado();
  if (await loginEmUso(db, login)) throw loginDuplicado();

  const senha = gerarSenhaTemporaria();
  const senhaHash = await gerarSenhaHash(senha);
  try {
    const { cliente, usuario } = await db.$transaction(async (tx) => {
      const cliente = await tx.cliente.create({ data: { nome, codigo }, select: SELECT_CLIENTE });
      const usuario = await tx.usuario.create({
        data: { cliente_id: cliente.id, nome: adminNome, login, senha_hash: senhaHash, ativo: true, papel_tenant: PAPEL_ADMIN_TENANT },
        select: { id: true, nome: true, login: true },
      });
      await registrarEventoSeguranca(
        {
          adminId: ctx.admin.id,
          acao: 'cliente_criar',
          sucesso: true,
          ip: ctx.ip,
          requestId: ctx.requestId,
          dados: { cliente_id: cliente.id, depois: { nome, codigo }, administrador: { id: usuario.id, login } },
        },
        tx
      );
      return { cliente, usuario };
    });
    return { cliente: comoCliente(cliente), administrador: usuario, senha_temporaria: senha };
  } catch (erro) {
    throw traduzirUnique(erro);
  }
};

/**
 * `PATCH /admin-maike/clientes/:id` — só `nome` e `codigo`.
 *
 * @param {string} id
 * @param {{ nome?: string, codigo?: string }} entrada
 * @param {{ admin: { id: string }, ip?: string, requestId: string }} ctx
 */
export const editarCliente = async (id, entrada, ctx) => {
  const dados = {};
  if (entrada.nome !== undefined) dados.nome = nomeDe(entrada.nome, 'nome do cliente');
  if (entrada.codigo !== undefined) dados.codigo = codigoDe(entrada.codigo);
  const db = getPrismaClient();
  try {
    const cliente = await db.$transaction(async (tx) => {
      const atual = await tx.cliente.findUnique({ where: { id }, select: SELECT_CLIENTE });
      if (!atual) throw clienteNaoEncontrado();
      if (dados.codigo && dados.codigo !== atual.codigo && (await tx.cliente.findUnique({ where: { codigo: dados.codigo }, select: { id: true } }))) {
        throw codigoDuplicado();
      }
      const novo = await tx.cliente.update({ where: { id }, data: dados, select: SELECT_CLIENTE });
      await registrarEventoSeguranca(
        {
          adminId: ctx.admin.id,
          acao: 'cliente_editar',
          sucesso: true,
          ip: ctx.ip,
          requestId: ctx.requestId,
          dados: { cliente_id: id, antes: { nome: atual.nome, codigo: atual.codigo }, depois: { nome: novo.nome, codigo: novo.codigo } },
        },
        tx
      );
      return novo;
    });
    return { cliente: comoCliente(cliente) };
  } catch (erro) {
    throw traduzirUnique(erro);
  }
};

/**
 * `POST /admin-maike/clientes/:id/situacao` — suspender (`ativo: false`) ou
 * reativar (`ativo: true`), sempre com justificativa.
 *
 * @param {string} id
 * @param {{ ativo: boolean, justificativa: string }} entrada
 * @param {{ admin: { id: string }, ip?: string, requestId: string }} ctx
 */
export const alterarSituacaoCliente = async (id, entrada, ctx) => {
  const justificativa = texto(entrada.justificativa);
  if (justificativa.length < JUSTIFICATIVA_MIN) {
    throw adminError('ADMIN_ENTRADA_INVALIDA', `justificativa: pelo menos ${JUSTIFICATIVA_MIN} caracteres`);
  }
  const ativo = entrada.ativo === true;
  const db = getPrismaClient();
  const cliente = await db.$transaction(async (tx) => {
    const atual = await tx.cliente.findUnique({ where: { id }, select: SELECT_CLIENTE });
    if (!atual) throw clienteNaoEncontrado();
    if (atual.ativo === ativo) throw adminError('ADMIN_ENTRADA_INVALIDA', ativo ? 'o cliente já está ativo' : 'o cliente já está suspenso');
    // Condicional: duas suspensões simultâneas não registram dois eventos.
    const r = await tx.cliente.updateMany({ where: { id, ativo: atual.ativo }, data: { ativo } });
    if (r.count !== 1) throw adminError('ADMIN_ENTRADA_INVALIDA', 'a situação do cliente mudou em outra sessão; recarregue');
    await registrarEventoSeguranca(
      {
        adminId: ctx.admin.id,
        acao: ativo ? 'cliente_reativar' : 'cliente_suspender',
        sucesso: true,
        ip: ctx.ip,
        requestId: ctx.requestId,
        dados: { cliente_id: id, antes: { ativo: atual.ativo }, depois: { ativo }, justificativa: justificativa.slice(0, 500) },
      },
      tx
    );
    return tx.cliente.findUnique({ where: { id }, select: SELECT_CLIENTE });
  });
  return { cliente: comoCliente(cliente) };
};
