/**
 * Service de locais de estoque (P1.4).
 *
 * Reúne numeração, CRUD, propagação de rename para o depósito do mapa e a
 * guarda de exclusão — tudo isso vivia dentro dos `mutationFn` de
 * `LocaisEstoque.jsx`, com `base44` chamado sete vezes em quatro entidades
 * diferentes.
 *
 * O rename é uma operação **composta** sem atomicidade: renomeia o local,
 * depois o ponto de suplementação, depois o ponto de referência, depois os
 * cochos. Se falhar no meio, o legado deixava o estado misto e a tela dizia
 * "Local atualizado!". Agora a falha vira `LOCAL_ESTOQUE_PARTIAL_OPERATION` com
 * as etapas concluídas em `details.etapas` — sem ACID, mas sem mentira.
 */

import {
  listLocais,
  createLocal,
  updateLocal,
  deleteLocal,
  listTodasMovimentacoes,
  listLotesNota,
} from '@/apis/estoque';
import { listPontosSuplementacao, updatePontoSuplementacao, listPontos, updatePonto } from '@/apis/mapa';
import { listProdutos } from '@/apis/produtos';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const CATEGORIA_DEPOSITO = 'DEPOSITO';

export const listarLocais = () => listLocais();

/** Próximo `numero_local`. `max + 1` sem concorrência segura (dívida aberta). */
export const proximoNumeroDeLocal = async () => {
  const todos = await listLocais();
  const numeros = todos.map((local) => Number.parseInt(local.numero_local, 10) || 0).filter((n) => n > 0);
  return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
};

export const criarLocal = async (dados) => {
  const numero = await proximoNumeroDeLocal();
  return createLocal({ ...dados, numero_local: String(numero) });
};

/**
 * Preenche `numero_local` nos registros antigos.
 *
 * @returns {Promise<{numerados: string[], falhas: string[]}>}
 */
export const numerarLocaisSemNumero = async (locais) => {
  const semNumero = (Array.isArray(locais) ? locais : []).filter((local) => !local.numero_local);
  const numerados = [];
  const falhas = [];

  for (const local of semNumero) {
    try {
      const numero = await proximoNumeroDeLocal();
      await updateLocal(local.id, { numero_local: String(numero) });
      numerados.push(local.id);
    } catch {
      falhas.push(local.id);
    }
  }

  return { numerados, falhas };
};

const mesmasCoordenadas = (a, b) =>
  Boolean(a && b) && a.lat === b.lat && a.lng === b.lng;

/**
 * Propaga o novo nome para o depósito vinculado, o ponto de referência que
 * ocupa as mesmas coordenadas e os cochos que apontam para esse depósito.
 *
 * @returns {Promise<string[]>} etapas concluídas, em ordem
 */
const propagarRename = async (localId, novoNome) => {
  const etapas = [];

  const pontosSuplementacao = await listPontosSuplementacao();
  const deposito = pontosSuplementacao.find(
    (ponto) => ponto.local_estoque_id === localId && ponto.categoria_ponto === CATEGORIA_DEPOSITO
  );
  if (!deposito) return etapas;

  await updatePontoSuplementacao(deposito.id, { nome_ponto: novoNome, local_estoque_nome: novoNome });
  etapas.push('deposito');

  const pontosReferencia = await listPontos();
  const referencia = pontosReferencia.find((ponto) => mesmasCoordenadas(ponto.coordenadas, deposito.coordenadas));
  if (referencia) {
    await updatePonto(referencia.id, { nome: novoNome });
    etapas.push('ponto_referencia');
  }

  const cochos = pontosSuplementacao.filter((ponto) => ponto.deposito_origem_id === deposito.id);
  for (const cocho of cochos) {
    await updatePontoSuplementacao(cocho.id, { deposito_origem_nome: novoNome });
  }
  if (cochos.length) etapas.push(`cochos:${cochos.length}`);

  return etapas;
};

/**
 * Atualiza o local e, quando o nome mudou, propaga para o mapa.
 *
 * @param {{id: string, dados: object, locais?: Array<object>}} p
 */
export const atualizarLocal = async ({ id, dados, locais = [] }) => {
  const anterior = locais.find((local) => local.id === id);
  const atualizado = await updateLocal(id, dados);

  const nomeMudou = Boolean(dados?.nome) && anterior && anterior.nome !== dados.nome;
  if (!nomeMudou) return { atualizado, etapas: [] };

  try {
    const etapas = await propagarRename(id, dados.nome);
    return { atualizado, etapas };
  } catch (erro) {
    throw new ApiError(API_ERROR_CODES.LOCAL_ESTOQUE_PARTIAL_OPERATION, {
      operation: 'atualizarLocal',
      resource: 'LocalEstoque',
      details: { id, etapas: ['local'] },
      cause: erro,
    });
  }
};

const bloquear = (motivo, detalhes) => {
  throw new ApiError(API_ERROR_CODES.LOCAL_ESTOQUE_DELETE_BLOCKED, {
    operation: 'excluirLocais',
    resource: 'LocalEstoque',
    details: { motivo, ...detalhes },
  });
};

/**
 * Exclui locais, verificando as quatro travas do legado.
 *
 * Ordem preservada: depósito do mapa, produto que referencia o **nome**,
 * movimentação que referencia o **id**, e lote de nota com saldo.
 *
 * @returns {Promise<{excluidos: string[], bloqueados: Array<{id: string, code: string, motivo?: string}>}>}
 */
export const excluirLocais = async (ids, { locais = [] } = {}) => {
  const alvos = Array.isArray(ids) ? ids : [ids];
  if (!alvos.length) return { excluidos: [], bloqueados: [] };

  const [produtos, movimentacoes, lotesNota, pontosSuplementacao] = await Promise.all([
    listProdutos(),
    listTodasMovimentacoes(),
    listLotesNota(),
    listPontosSuplementacao(),
  ]);

  const excluidos = [];
  const bloqueados = [];

  for (const id of alvos) {
    const local = locais.find((item) => item.id === id) || null;
    try {
      const deposito = pontosSuplementacao.find(
        (ponto) => ponto.local_estoque_id === id && ponto.categoria_ponto === CATEGORIA_DEPOSITO
      );
      if (deposito) bloquear('deposito_do_mapa', { id });

      if (produtos.some((produto) => produto.local_estoque === local?.nome)) {
        bloquear('produtos_vinculados', { id });
      }
      if (
        movimentacoes.some(
          (movimentacao) =>
            movimentacao.local_estoque_origem === id || movimentacao.local_estoque_destino === id
        )
      ) {
        bloquear('movimentacoes_vinculadas', { id });
      }
      if (lotesNota.some((lote) => lote.local_estoque_id === id && (lote.quantidade_disponivel || 0) > 0)) {
        bloquear('saldo_em_estoque', { id });
      }

      await deleteLocal(id);
      excluidos.push(id);
    } catch (erro) {
      bloqueados.push({
        id,
        code: erro?.code ?? API_ERROR_CODES.OPERATION_FAILED,
        motivo: erro?.details?.motivo,
      });
    }
  }

  return { excluidos, bloqueados };
};
