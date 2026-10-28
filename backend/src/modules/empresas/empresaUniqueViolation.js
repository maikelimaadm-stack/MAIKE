/**
 * Traduz violações Prisma P2002 do model Empresa em AppError estáveis.
 */
import { AppError } from '../../shared/errors/AppError.js';

export const erroNomeConflitoEmpresa = () =>
  new AppError('EMPRESA_NAME_CONFLICT', 'Já existe uma empresa cadastrada com este nome.');

/**
 * @param {unknown} erro
 * @returns {boolean} true se lançou AppError traduzido
 */
export const lancarSeP2002Empresa = (erro) => {
  const prisma = /** @type {{ code?: string, meta?: { target?: string[] } }} */ (erro);
  if (prisma?.code !== 'P2002') return false;

  const campos = Array.isArray(prisma.meta?.target) ? prisma.meta.target.map(String) : [];
  if (campos.includes('nome')) throw erroNomeConflitoEmpresa();
  if (campos.includes('numero_empresa')) {
    throw new AppError('SEQUENCE_CONFLICT', 'Conflito na numeração da empresa.');
  }
  throw new AppError('CONCURRENCY_CONFLICT', 'Conflito ao salvar a empresa.');
};
