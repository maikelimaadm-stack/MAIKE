/**
 * D-PROD-264 (Estoque → Novo movimento → Saída) — cadastro de MOTIVOS de saída manual, por cliente.
 *
 *  - Padrões: Perda, Consumo interno, Doação e Vencimento, criados na PRIMEIRA leitura do cliente que
 *    ainda não tem nenhum motivo de saída (idempotente: `skipDuplicates` sobre o UNIQUE da chave).
 *  - O usuário cria, renomeia e ativa/desativa qualquer um (nenhum é fixo). Nome único por cliente sem
 *    diferença de maiúsculas e espaços (`chave`). Motivo usado numa saída não sai (FK RESTRICT); é desativado.
 *  - O tenant vem só do `auth_context`.
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { invalido } from '../gestao/gestaoComum.js';
import { normalizarNome } from '../estoqueEntradas/motivoEntradaEstoqueService.js';

export { NOME_MAXIMO } from '../estoqueEntradas/motivoEntradaEstoqueService.js';
export const ENTIDADE_MOTIVO = 'MotivoSaidaEstoque';
const TETO_LISTA = 200;

/** Os motivos padrão, na ordem em que aparecem (escolha do proprietário, D-PROD-264). */
export const MOTIVOS_SAIDA_PADRAO = Object.freeze(['Perda', 'Consumo interno', 'Doação', 'Vencimento']);

const comoMotivo = (m) => ({ id: m.id, nome: m.nome, ativo: m.ativo });
const naoEncontrado = () => new AppError('MOTIVO_SAIDA_NOT_FOUND', 'motivo de saída não encontrado');
const duplicado = (nome) => new AppError('MOTIVO_SAIDA_DUPLICADO', `já existe um motivo de saída chamado "${nome}"; nada foi gravado`, { details: { field: 'nome', reason: 'nome_duplicado' } });
const ehDuplicado = (erro) => /** @type {any} */ (erro)?.code === 'P2002';

/** Cria os padrões se o cliente ainda não tem nenhum motivo de saída. @param {any} db @param {string} cli */
export const garantirMotivosSaidaPadrao = async (db, cli) => {
  const existe = await db.motivoSaidaEstoque.findFirst({ where: { cliente_id: cli }, select: { id: true } });
  if (existe) return;
  await db.motivoSaidaEstoque.createMany({
    data: MOTIVOS_SAIDA_PADRAO.map((nome) => ({ cliente_id: cli, ...normalizarNome(nome), ativo: true })),
    skipDuplicates: true,
  });
};

/** Lista os motivos de saída do cliente (padrões criados na primeira vez). `ativos=true` só os ativos. @param {any} contexto @param {Record<string, any>} [query] */
export const listarMotivosSaida = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await garantirMotivosSaidaPadrao(prisma, auth.clienteId);
  const linhas = await prisma.motivoSaidaEstoque.findMany({
    where: { cliente_id: auth.clienteId, ...(query.ativos === true || query.ativos === 'true' ? { ativo: true } : {}) },
    orderBy: [{ chave: 'asc' }, { id: 'asc' }],
    take: TETO_LISTA,
  });
  return { items: linhas.map(comoMotivo) };
};

/** @param {any} contexto @param {Record<string, any>} corpo */
export const criarMotivoSaida = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { nome, chave } = normalizarNome(corpo?.nome);
  await garantirMotivosSaidaPadrao(prisma, auth.clienteId);
  try {
    const m = await prisma.motivoSaidaEstoque.create({ data: { cliente_id: auth.clienteId, nome, chave, ativo: true } });
    await registrarEvento(contexto, { acao: 'motivo_saida_estoque.criar', entidade: ENTIDADE_MOTIVO, entidadeId: m.id, dadosNovos: comoMotivo(m) });
    return comoMotivo(m);
  } catch (erro) {
    if (ehDuplicado(erro)) throw duplicado(nome);
    throw erro;
  }
};

/** Renomeia e/ou ativa/desativa um motivo de saída. @param {any} contexto @param {string} id @param {Record<string, any>} corpo */
export const editarMotivoSaida = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atual = await prisma.motivoSaidaEstoque.findFirst({ where: { cliente_id: auth.clienteId, id } });
  if (!atual) throw naoEncontrado();
  /** @type {Record<string, any>} */
  const data = {};
  if (corpo?.nome !== undefined) Object.assign(data, normalizarNome(corpo.nome));
  if (corpo?.ativo !== undefined) {
    if (typeof corpo.ativo !== 'boolean') throw invalido('ativo deve ser verdadeiro ou falso', { field: 'ativo', reason: 'tipo' });
    data.ativo = corpo.ativo;
  }
  const mudou = (data.nome !== undefined && data.nome !== atual.nome) || (data.ativo !== undefined && data.ativo !== atual.ativo);
  if (!mudou) throw invalido('nada mudou no motivo', { field: 'nome', reason: 'nada_a_alterar' });
  try {
    const m = await prisma.motivoSaidaEstoque.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } }, data });
    await registrarEvento(contexto, { acao: 'motivo_saida_estoque.editar', entidade: ENTIDADE_MOTIVO, entidadeId: id, dadosAnteriores: comoMotivo(atual), dadosNovos: comoMotivo(m) });
    return comoMotivo(m);
  } catch (erro) {
    if (ehDuplicado(erro)) throw duplicado(data.nome);
    throw erro;
  }
};

/** O motivo da saída, lido na transação: do cliente, ATIVO. @param {any} tx @param {string} cli @param {string} motivoId */
export const exigirMotivoSaidaAtivo = async (tx, cli, motivoId) => {
  const m = await tx.motivoSaidaEstoque.findFirst({ where: { cliente_id: cli, id: motivoId } });
  if (!m) throw new AppError('SAIDA_ESTOQUE_INVALIDA', 'motivo de saída não encontrado; nada foi gravado', { details: { field: 'motivo_id', reason: 'motivo_inexistente' } });
  if (!m.ativo) throw new AppError('SAIDA_ESTOQUE_INVALIDA', 'o motivo de saída está inativo; nada foi gravado', { details: { field: 'motivo_id', reason: 'motivo_inativo' } });
  return m;
};
