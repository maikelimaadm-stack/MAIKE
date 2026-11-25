/**
 * D-PROD-296 — adaptador de TESTE para os testes do formulário de lançamento
 * escritos antes do motor de sincronização.
 *
 * O formulário agora chama `registrarLancamentoDoCocho` (um registro só, com a
 * baixa, o lançamento e o fechamento do período anterior). Estes testes
 * simulam os três passos com as funções de antes (`registrarSaidaSuplementacao`,
 * `registrarLancamento`, `fecharPeriodoSuplementacao`); o adaptador faz a
 * mesma sequência do serviço real e passa por elas, com a regra do servidor
 * de não repetir a baixa do mesmo código (`operation_id`).
 *
 * O serviço real (com o motor) é testado em `lancamentoCochoOffline.test.js`.
 */

/** @param {any} movimento */
const custoDaSaida = (movimento) => {
  const v = movimento?.valor_unitario;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * @param {{ saida: Function, lancar: Function, fechar?: Function }} passos
 */
export const criarShimLancamentoDoCocho = ({ saida, lancar, fechar }) => {
  /** operation_id → baixa já gravada (o servidor devolve a mesma). */
  const baixas = new Map();
  return async (dados, { operationId }) => {
    let mov = null;
    if (dados.saida) {
      if (baixas.has(operationId)) {
        mov = baixas.get(operationId);
      } else {
        const c = dados.saida;
        const r = await saida({
          empresaId: c.empresa_id,
          produto: { id: c.produto_id },
          quantidade: c.quantidade,
          localOrigemId: c.local_origem_id,
          localOrigemNome: c.local_origem_nome,
          areaId: c.area_id,
          areaNome: c.area_nome,
          observacoes: c.observacoes,
          depositoId: c.deposito_id,
          pontoSuplementacaoId: c.ponto_suplementacao_id,
          dataMovimentacao: c.data_movimentacao,
          operationId,
          // D-PROD-309: a unidade de conversão do corpo da baixa (só quando veio).
          ...(c.unidade_lancamento ? { unidadeLancamento: c.unidade_lancamento, quantidadeLancamento: c.quantidade_lancamento } : {}),
        });
        mov = r?.movimentacao ?? null;
        baixas.set(operationId, mov);
      }
    }
    const evento = { ...dados.evento, movimentacao_estoque_id: mov?.id ?? null, custo_unitario_kg: custoDaSaida(mov) };
    let novo;
    try {
      novo = await lancar({ evento, lotes: dados.lotes, operationId, eventoAnteriorId: dados.eventoAnterior?.id ?? null });
    } catch (erro) {
      if (mov && erro && typeof erro === 'object') erro.saidaFeita = mov;
      throw erro;
    }
    let fechamento = 'nenhum';
    if (dados.fechamento && dados.eventoAnterior && fechar) {
      try {
        await fechar({ evento: dados.eventoAnterior, ...dados.fechamento, fechadoPorEventoId: novo.id });
        fechamento = 'feito';
      } catch {
        fechamento = 'falhou';
      }
    }
    return { aguardandoEnvio: false, evento: novo, fechamento };
  };
};
