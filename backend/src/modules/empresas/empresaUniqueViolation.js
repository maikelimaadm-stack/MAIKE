/**
 * Traduz violações Prisma P2002 do model Empresa em AppError estáveis.
 *
 * D-PROD-195: em produção o runtime não é dono das tabelas e elas têm RLS; o
 * P2002 chega sem alvo e o nome em corrida virava 409 `CONCURRENCY_CONFLICT`
 * (o cliente repetia). Sem o alvo, a chave é CONFERIDA depois do rollback:
 * nome ocupado → `EMPRESA_NAME_CONFLICT`; número reservado ocupado →
 * `SEQUENCE_CONFLICT`. Com o alvo, nada muda.
 */
import { AppError } from '../../shared/errors/AppError.js';
import { alvoDaUnique, chaveOcupada } from '../../shared/prisma/transacaoConcorrente.js';

export const erroNomeConflitoEmpresa = () =>
  new AppError('EMPRESA_NAME_CONFLICT', 'Já existe uma empresa cadastrada com este nome.');
const erroNumeroEmpresa = () => new AppError('SEQUENCE_CONFLICT', 'Conflito na numeração da empresa.');
const erroConflitoEmpresa = () => new AppError('CONCURRENCY_CONFLICT', 'Conflito ao salvar a empresa.');

/**
 * Conferências das uniques de negócio da Empresa sem o alvo do P2002 (rodam
 * depois do rollback, numa leitura nova): a chave que a tentativa ocupava já
 * está ocupada? Ausente = não conferida.
 * @typedef {{ nome?: ((tx: any) => Promise<unknown>) | null, numero?: ((tx: any) => Promise<unknown>) | null }} ConferenciasEmpresa
 */

/**
 * @param {unknown} erro
 * @param {ConferenciasEmpresa} [conferencias]
 * @returns {Promise<false>} false se não é P2002 (senão lança o AppError traduzido)
 */
export const lancarSeP2002Empresa = async (erro, conferencias = {}) => {
  const prisma = /** @type {{ code?: string }} */ (erro);
  if (prisma?.code !== 'P2002') return false;

  const alvo = alvoDaUnique(erro);
  if (alvo !== null) {
    const campos = Array.isArray(alvo) ? alvo.map(String) : [];
    if (campos.includes('nome')) throw erroNomeConflitoEmpresa();
    if (campos.includes('numero_empresa')) throw erroNumeroEmpresa();
    throw erroConflitoEmpresa();
  }
  if (conferencias.nome && (await chaveOcupada(conferencias.nome))) throw erroNomeConflitoEmpresa();
  if (conferencias.numero && (await chaveOcupada(conferencias.numero))) throw erroNumeroEmpresa();
  throw erroConflitoEmpresa();
};
