/**
 * Repositório de Setor (P4.1, D-PROD-25).
 *
 * Única camada que fala Prisma. Duas regras governam tudo aqui:
 *
 *  1. **nenhuma consulta sem `cliente_id`.** Não existe `findUnique({where:
 *     {id}})` neste arquivo: um id é um palpite barato, e uma leitura por id
 *     solto devolveria o registro de outro tenant antes de qualquer barreira do
 *     service ter chance de reprovar. Toda leitura e toda escrita usam o
 *     unique composto `[cliente_id, id]`, que o schema declara justamente para
 *     isto;
 *  2. **o repositório não decide.** Ele não reserva número, não normaliza
 *     texto, não audita e não escolhe o que pode ser atualizado. Recebe dados
 *     já resolvidos e devolve a linha.
 *
 * `tx` é parâmetro explícito em toda escrita: a criação de Setor participa da
 * MESMA transação da reserva de número e do registro de auditoria. Reservar num
 * commit e gravar noutro deixa buraco na sequência quando o segundo falha.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * Campos devolvidos ao cliente HTTP.
 *
 * Lista literal, e não `include`/spread do registro inteiro: quando um campo
 * novo entrar no model, ele precisa ser adicionado aqui de propósito. O padrão
 * inverso — devolver tudo — publica campo interno no dia em que ele é criado,
 * sem ninguém decidir nada.
 */
const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero_setor: true,
  nome: true,
  sigla: true,
  tipo: true,
  responsavel: true,
  telefone: true,
  endereco: true,
  cidade: true,
  estado: true,
  area_total: true,
  capacidade_animais: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Lista os setores do tenant.
 *
 * Ordenação estável e explícita: `numero_setor` é String (o legado da Base44
 * grava assim), então a ordem alfabética colocaria "10" antes de "2". Ordenar
 * por `createdAt` devolve a ordem de criação, que é a ordem em que os números
 * foram atribuídos — mesmo resultado, sem depender de comparação numérica sobre
 * texto.
 *
 * @param {string} clienteId
 */
export const listarSetores = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.setor.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * Busca um setor do tenant. Devolve `null` quando não existe **ou** quando
 * pertence a outro cliente — para quem pergunta, os dois casos são o mesmo, e
 * distingui-los confirmaria a existência de registro alheio.
 *
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarSetor = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.setor.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * Insere o setor. `id` é deliberadamente omitido — quem o produz é o
 * `@default(cuid())` do Prisma, nunca o runtime e nunca o cliente HTTP.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} dados
 */
export const inserirSetor = async (tx, dados) =>
  tx.setor.create({ data: dados, select: SELECAO });

/**
 * Atualiza o setor pelo unique composto.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @param {object} dados
 */
export const atualizarSetorPorId = async (tx, clienteId, id, dados) =>
  tx.setor.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });
