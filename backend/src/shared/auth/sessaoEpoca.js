/**
 * Épocas de sessão da fazenda (MAIKE-SAAS-ADMIN-S04-P1, D-PROD-143).
 *
 * `Cliente.sessao_epoca` e `Usuario.sessao_epoca` são INTEGER anuláveis
 * (migration EXPAND, D-PROD-107): NULL vale 0. O ÚNICO escritor é
 * `COALESCE(sessao_epoca, 0) + 1`, em SQL, dentro da transação de quem muda o
 * estado (suspensão, senha, `ativo`, papel). Sob o lock da linha o Postgres
 * soma em cima do valor mais novo: dois pedidos concorrentes somam 2, nunca
 * perdem incremento. No teto do INTEGER o UPDATE falha ("integer out of range")
 * e a transação inteira desfaz — falha fechada, a época nunca volta a zero.
 */

/** Época efetiva de uma linha (NULL = 0). */
export const epocaDe = (valor) => (Number.isSafeInteger(valor) ? valor : 0);

/**
 * Filtro Prisma "a época atual da linha é `n`" (NULL conta como 0).
 * @param {number} n
 */
export const filtroEpoca = (n) => (n === 0 ? { OR: [{ sessao_epoca: 0 }, { sessao_epoca: null }] } : { sessao_epoca: n });

/**
 * Encerra todas as sessões da conta. Chamar DENTRO da transação da mudança.
 * @param {{ $queryRaw: Function }} tx
 * @param {string} clienteId
 * @param {string} usuarioId
 * @returns {Promise<number>} época nova
 */
export const revogarSessoesUsuario = async (tx, clienteId, usuarioId) => {
  const linhas = await tx.$queryRaw`UPDATE "Usuario" SET "sessao_epoca" = COALESCE("sessao_epoca", 0) + 1
    WHERE "id" = ${usuarioId} AND "cliente_id" = ${clienteId} RETURNING "sessao_epoca"`;
  if (linhas.length !== 1) throw new Error('revogação de sessão sem a conta alvo');
  return linhas[0].sessao_epoca;
};

/**
 * Encerra todas as sessões da fazenda. Chamar DENTRO da transação da suspensão.
 * @param {{ $queryRaw: Function }} tx
 * @param {string} clienteId
 * @returns {Promise<number>} época nova
 */
export const revogarSessoesCliente = async (tx, clienteId) => {
  const linhas = await tx.$queryRaw`UPDATE "Cliente" SET "sessao_epoca" = COALESCE("sessao_epoca", 0) + 1
    WHERE "id" = ${clienteId} RETURNING "sessao_epoca"`;
  if (linhas.length !== 1) throw new Error('revogação de sessão sem o cliente alvo');
  return linhas[0].sessao_epoca;
};
