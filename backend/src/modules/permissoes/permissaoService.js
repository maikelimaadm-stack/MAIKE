/**
 * Serviço de Permissao (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { atorDoTenant, ehAdminTenantAtivo, exigirAdminTenant } from '../../shared/auth/exigirAdminTenant.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './permissaoRepository.js';



const erroNaoEncontrado = () => new AppError('PERMISSAO_NOT_FOUND', 'Permissao não encontrado');

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
  const [registros, ator] = await Promise.all([listarRegistros(auth.clienteId), atorDoTenant(contexto)]);
  if (ehAdminTenantAtivo(ator)) return registros.map(comoPublico);
  // PR145-R4: quem não é administrador da fazenda vê a PRÓPRIA linha inteira
  // (menu/mapa) e, das outras, só o nome de exibição (responsáveis de tarefa) —
  // nunca a matriz de privilégios alheia.
  return registros.map((r) =>
    r.user_email === auth.login ? comoPublico(r) : { id: r.id, user_email: r.user_email, user_nome: r.user_nome }
  );
};

/**
 * Campos que o corpo nunca define: identidade e tenant são do servidor.
 * @param {Record<string, unknown>} entrada
 */
const semCamposDoServidor = (entrada) => {
  // eslint-disable-next-line no-unused-vars -- descartados de propósito
  const { id, cliente_id, createdAt, updatedAt, ...resto } = entrada ?? {};
  return resto;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await exigirAdminTenant(contexto);
  const criado = await prisma.$transaction(async (tx) => {
    await exigirAdminTenant(contexto, tx);
    /** @type {Record<string, unknown>} */
    const dados = { ...semCamposDoServidor(entrada), cliente_id: auth.clienteId };

    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'Permissao', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await exigirAdminTenant(contexto);
  const atualizado = await prisma.$transaction(async (tx) => {
    await exigirAdminTenant(contexto, tx);
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, semCamposDoServidor(entrada));
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Permissao',
        entidadeId: id,
        dadosAnteriores: comoPublico(existente),
        dadosNovos: comoPublico(registro),
      },
      tx
    );
    return registro;
  });
  return comoPublico(atualizado);
};

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await exigirAdminTenant(contexto);
  await prisma.$transaction(async (tx) => {
    await exigirAdminTenant(contexto, tx);
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'Permissao', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  });
};
