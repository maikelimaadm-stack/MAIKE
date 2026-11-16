/**
 * Ordem do histórico do bebedouro pela data do lançamento (`data_lancamento` +
 * `hora_lancamento`), do mais recente para o mais antigo.
 *
 * O servidor devolve o histórico por ordem de criação (createdAt desc), e o
 * usuário pode lançar com data retroativa. "Último registro", "Próxima limpeza"
 * e "Próxima inspeção" precisam da data do lançamento — a mesma regra de
 * `buildBebedouroAlertas` (src/services/bebedouroService.js), para a ficha e a
 * lista não divergirem. A linha do tempo continua na ordem do servidor, porque
 * o "Excluir" só vale para o mais recente por criação.
 *
 * A ordenação é estável: empates de data/hora mantêm a ordem do servidor.
 * Lançamento sem data vai para o fim.
 */
const chaveData = (item) => {
  const data = String(item?.data_lancamento || "").split("T")[0];
  if (!data) return "";
  return `${data} ${String(item?.hora_lancamento || "")}`;
};

/**
 * @param {any[]} historico
 * @returns {any[]} cópia ordenada, sem alterar o array recebido
 */
export function ordenarHistoricoBebedouroPorData(historico = []) {
  return [...(Array.isArray(historico) ? historico : [])].sort((a, b) => chaveData(b).localeCompare(chaveData(a)));
}

/**
 * Datas de referência do resumo do bebedouro, todas pela data do lançamento.
 * Limpeza e inspeção só contam quando concluídas (como em `buildBebedouroAlertas`);
 * a inspeção cai na última avaliação de água quando não há inspeção concluída.
 *
 * @param {any[]} historico
 */
export function resumoHistoricoBebedouro(historico = []) {
  const porData = ordenarHistoricoBebedouroPorData(historico);
  const ultimaAvaliacaoAgua = porData.find((item) => item.qualidade_agua || item.escore_agua);
  const ultimaLimpeza = porData.find((item) => item.tipo_lancamento === "Limpeza" && item.status === "Concluído");
  const ultimaInspecao = porData.find((item) => item.tipo_lancamento === "Inspeção" && item.status === "Concluído") || ultimaAvaliacaoAgua;
  return {
    ultimoLancamento: porData[0],
    ultimaAvaliacaoAgua,
    ultimaLimpeza,
    ultimaInspecao,
  };
}
