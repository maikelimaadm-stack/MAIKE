/**
 * Texto em português para a recusa de "Reatribuir códigos" das áreas.
 *
 * A renumeração é uma operação só do servidor (`POST /areas-pastagem/renumerar`),
 * atômica: quando ela falha, nenhum código muda. O servidor diz o motivo em
 * `details.reason` (e, quando há, o código em `details.codigo`/`details.codigos`);
 * aqui isso vira uma frase que o usuário entende. Sem motivo conhecido, a frase
 * genérica — sem nunca expor texto cru do provider.
 *
 * @param {unknown} erro
 * @returns {string}
 */
export const mensagemErroRenumeracao = (erro) => {
  const e = /** @type {any} */ (erro);
  const detalhes = e && typeof e === "object" && e.details && typeof e.details === "object" ? e.details : {};
  const reason = typeof detalhes.reason === "string" ? detalhes.reason : "";
  const nenhum = "Nenhum código foi mudado.";
  const lista = (valor) =>
    (Array.isArray(valor) ? valor : [valor]).filter((v) => typeof v === "string" || typeof v === "number").map(String);

  // `API_ERROR_CODES.PROVIDER_UNAVAILABLE` (src/apis/_core/ApiError.js): rede/timeout/5xx de gateway.
  if (e?.code === "API_PROVIDER_UNAVAILABLE") {
    return `Não foi possível reatribuir os códigos: sem conexão com o servidor. ${nenhum}`;
  }
  switch (reason) {
    case "codigo_em_uso": {
      const codigos = lista(detalhes.codigos);
      if (!codigos.length) {
        return `Não foi possível reatribuir os códigos: um dos códigos já pertence a outra área fora da seleção. ${nenhum}`;
      }
      const varios = codigos.length > 1;
      return `Não foi possível reatribuir os códigos: ${varios ? "os códigos" : "o código"} ${codigos.join(", ")} já ${varios ? "pertencem" : "pertence"} a outra área (ativa ou inativa) fora da seleção. ${nenhum}`;
    }
    case "codigo_repetido":
      return `Não foi possível reatribuir os códigos: o mesmo código foi pedido para mais de uma área. ${nenhum}`;
    case "area_repetida":
      return `Não foi possível reatribuir os códigos: a mesma área apareceu duas vezes. ${nenhum}`;
    case "codigo_vazio":
      return `Não foi possível reatribuir os códigos: o código não pode ficar vazio. ${nenhum}`;
    case "codigo_reservado":
      return `Não foi possível reatribuir os códigos: o código não pode começar com #. ${nenhum}`;
    default:
      break;
  }
  return `Não foi possível reatribuir os códigos: o servidor não aceitou a alteração. ${nenhum}`;
};
