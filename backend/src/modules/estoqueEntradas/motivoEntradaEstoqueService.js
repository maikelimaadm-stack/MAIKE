/**
 * D-PROD-259 (Estoque → Novo movimento) — cadastro de MOTIVOS de entrada, por cliente.
 *
 *  - Natureza ENTRADA: Compra, Doação e os que o usuário criar (nome livre, único por cliente sem
 *    diferença de maiúsculas e espaços: `chave`). Renomear e ativar/desativar são livres.
 *  - Natureza SALDO_IMPLANTACAO: só o motivo padrão "Saldo de implantação", com as regras da implantação
 *    (produto sem histórico, sem fornecedor). Ninguém cria outro, nem renomeia ou desativa o padrão.
 *  - Os 3 padrões nascem na PRIMEIRA leitura do cliente que ainda não tem nenhum motivo (idempotente:
 *    `skipDuplicates` sobre o UNIQUE da chave). Motivo usado numa entrada não sai (FK RESTRICT); é desativado.
 *  - O tenant vem só do `auth_context`.
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { invalido } from '../gestao/gestaoComum.js';
import { MOTIVO_ENTRADA, MOTIVO_IMPLANTACAO } from './entradaEstoqueRegras.js';

export const ENTIDADE_MOTIVO = 'MotivoEntradaEstoque';
export const NOME_MINIMO = 2;
export const NOME_MAXIMO = 80;
const TETO_LISTA = 200;

/** Os motivos padrão, na ordem em que aparecem. */
export const MOTIVOS_PADRAO = Object.freeze([
  Object.freeze({ nome: 'Compra', natureza: MOTIVO_ENTRADA }),
  Object.freeze({ nome: 'Doação', natureza: MOTIVO_ENTRADA }),
  Object.freeze({ nome: 'Saldo de implantação', natureza: MOTIVO_IMPLANTACAO }),
]);

/** Nome higienizado (NFC, espaços únicos) e a chave de unicidade (o mesmo em maiúsculas). @param {unknown} bruto */
export const normalizarNome = (bruto) => {
  if (typeof bruto !== 'string') throw invalido('informe o nome do motivo', { field: 'nome', reason: 'obrigatorio' });
  const nome = bruto.normalize('NFC').replace(/\s+/g, ' ').trim();
  const n = [...nome].length;
  if (n < NOME_MINIMO) throw invalido(`o nome do motivo precisa de ao menos ${NOME_MINIMO} caracteres`, { field: 'nome', reason: 'curto' });
  if (n > NOME_MAXIMO) throw invalido(`o nome do motivo passa de ${NOME_MAXIMO} caracteres`, { field: 'nome', reason: 'longo' });
  return { nome, chave: nome.toLocaleUpperCase('pt-BR') };
};

const comoMotivo = (m) => ({ id: m.id, nome: m.nome, natureza: m.natureza, ativo: m.ativo, padrao: m.natureza === MOTIVO_IMPLANTACAO });
const naoEncontrado = () => new AppError('MOTIVO_ENTRADA_NOT_FOUND', 'motivo de entrada não encontrado');
const duplicado = (nome) => new AppError('MOTIVO_ENTRADA_DUPLICADO', `já existe um motivo chamado "${nome}"; nada foi gravado`, { details: { field: 'nome', reason: 'nome_duplicado' } });

/** Cria os padrões se o cliente ainda não tem nenhum motivo. @param {any} db @param {string} cli */
export const garantirMotivosPadrao = async (db, cli) => {
  const existe = await db.motivoEntradaEstoque.findFirst({ where: { cliente_id: cli }, select: { id: true } });
  if (existe) return;
  await db.motivoEntradaEstoque.createMany({
    data: MOTIVOS_PADRAO.map((m) => ({ cliente_id: cli, nome: m.nome, chave: normalizarNome(m.nome).chave, natureza: m.natureza, ativo: true })),
    skipDuplicates: true,
  });
};

/** Lista os motivos do cliente (padrões criados na primeira vez). `ativos=true` só os ativos. @param {any} contexto @param {Record<string, any>} [query] */
export const listarMotivos = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await garantirMotivosPadrao(prisma, auth.clienteId);
  const linhas = await prisma.motivoEntradaEstoque.findMany({
    where: { cliente_id: auth.clienteId, ...(query.ativos === true || query.ativos === 'true' ? { ativo: true } : {}) },
    orderBy: [{ natureza: 'asc' }, { chave: 'asc' }, { id: 'asc' }],
    take: TETO_LISTA,
  });
  return { items: linhas.map(comoMotivo) };
};

const ehDuplicado = (erro) => /** @type {any} */ (erro)?.code === 'P2002';

/** Cria um motivo de natureza ENTRADA. @param {any} contexto @param {Record<string, any>} corpo */
export const criarMotivo = async (contexto, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const { nome, chave } = normalizarNome(corpo?.nome);
  await garantirMotivosPadrao(prisma, auth.clienteId);
  try {
    const m = await prisma.motivoEntradaEstoque.create({ data: { cliente_id: auth.clienteId, nome, chave, natureza: MOTIVO_ENTRADA, ativo: true } });
    await registrarEvento(contexto, { acao: 'motivo_entrada_estoque.criar', entidade: ENTIDADE_MOTIVO, entidadeId: m.id, dadosNovos: comoMotivo(m) });
    return comoMotivo(m);
  } catch (erro) {
    if (ehDuplicado(erro)) throw duplicado(nome);
    throw erro;
  }
};

/** Renomeia e/ou ativa/desativa um motivo de natureza ENTRADA. @param {any} contexto @param {string} id @param {Record<string, any>} corpo */
export const editarMotivo = async (contexto, id, corpo) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atual = await prisma.motivoEntradaEstoque.findFirst({ where: { cliente_id: auth.clienteId, id } });
  if (!atual) throw naoEncontrado();
  if (atual.natureza === MOTIVO_IMPLANTACAO) {
    throw new AppError('MOTIVO_ENTRADA_PADRAO_FIXO', 'o motivo "Saldo de implantação" é fixo: não se renomeia nem se desativa; nada foi alterado', { details: { field: 'nome', reason: 'motivo_padrao' } });
  }
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
    const m = await prisma.motivoEntradaEstoque.update({ where: { cliente_id_id: { cliente_id: auth.clienteId, id } }, data });
    await registrarEvento(contexto, { acao: 'motivo_entrada_estoque.editar', entidade: ENTIDADE_MOTIVO, entidadeId: id, dadosAnteriores: comoMotivo(atual), dadosNovos: comoMotivo(m) });
    return comoMotivo(m);
  } catch (erro) {
    if (ehDuplicado(erro)) throw duplicado(data.nome);
    throw erro;
  }
};

/**
 * O motivo da entrada, lido na transação: do cliente, ATIVO. Devolve a natureza e o nome.
 * @param {any} tx @param {string} cli @param {string} motivoId
 */
export const exigirMotivoAtivo = async (tx, cli, motivoId) => {
  const m = await tx.motivoEntradaEstoque.findFirst({ where: { cliente_id: cli, id: motivoId } });
  if (!m) throw new AppError('ENTRADA_ESTOQUE_INVALIDA', 'motivo de entrada não encontrado; nada foi gravado', { details: { field: 'motivo_id', reason: 'motivo_inexistente' } });
  if (!m.ativo) throw new AppError('ENTRADA_ESTOQUE_INVALIDA', 'o motivo de entrada está inativo; nada foi gravado', { details: { field: 'motivo_id', reason: 'motivo_inativo' } });
  return m;
};
