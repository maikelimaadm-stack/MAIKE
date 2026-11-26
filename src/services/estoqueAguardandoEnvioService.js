/**
 * D-PROD-296 — o estoque como o aparelho deve mostrar: os lotes do servidor
 * MAIS o efeito do que foi lançado sem internet e ainda espera envio.
 *
 * Sem isto, depois de uma transferência (ou baixa do cocho) feita sem sinal, o
 * depósito continuaria mostrando o saldo de antes, e a pessoa poderia lançar de
 * novo um produto que já saiu. É só visão: nada daqui vai ao servidor, e quem
 * decide o saldo de verdade é o servidor quando o registro chega.
 *
 * Regras (as mesmas do servidor, aproximadas no aparelho):
 *  - a saída consome os lotes da origem em FIFO (data do documento, depois id);
 *  - a entrada aparece como um lote do destino, marcado `_aguardandoEnvio`;
 *  - os registros entram na ordem em que foram feitos.
 */

import {
  TIPO_TRANSFERENCIA_DEPOSITO,
  TIPO_LANCAMENTO_COCHO,
  TIPO_CANCELAMENTO_LANCAMENTO_COCHO,
  TIPO_CANCELAMENTO_TRANSFERENCIA,
} from '@/lib/offline/sincronizacao/tiposDeEnvio';
import { registrosDoAparelhoDoTipo } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { horaDaResposta } from '@/lib/offline/horaDasRespostas';
import { lerResposta } from '@/lib/offline/respostasOffline';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';

/**
 * @typedef {{ operationId: string, empresa_id: string, produto_id: string, quantidade: number,
 *   local_origem_id: string|null, local_destino_id: string|null, data: string|null }} MovimentoAguardando
 */

/** Tipos que mexem no estoque e como cada um vira movimento. */
const EFEITOS = [
  {
    tipo: TIPO_TRANSFERENCIA_DEPOSITO,
    /** @param {any} p @param {string} operationId @returns {MovimentoAguardando} */
    movimento: (p, operationId) => ({
      operationId,
      empresa_id: p?.empresa_id,
      produto_id: p?.produto_id,
      quantidade: Number(p?.quantidade) || 0,
      local_origem_id: p?.local_origem_id ?? null,
      local_destino_id: p?.local_destino_id ?? null,
      data: p?.data_movimentacao ?? null,
    }),
  },
  {
    // A baixa do depósito do lançamento do cocho (só saída; o destino é o cocho).
    tipo: TIPO_LANCAMENTO_COCHO,
    /** @param {any} p @param {string} operationId @returns {MovimentoAguardando|null} */
    movimento: (p, operationId) =>
      p?.saida
        ? {
            operationId,
            empresa_id: p.saida.empresa_id,
            produto_id: p.saida.produto_id,
            quantidade: Number(p.saida.quantidade) || 0,
            local_origem_id: p.saida.local_origem_id ?? null,
            local_destino_id: null,
            data: p.saida.data_movimentacao ?? null,
          }
        : null,
  },
  {
    // D-PROD-298: o cancelamento do lançamento devolve ao depósito a baixa dele.
    tipo: TIPO_CANCELAMENTO_LANCAMENTO_COCHO,
    /** @param {any} p @param {string} operationId @returns {MovimentoAguardando|null} */
    movimento: (p, operationId) =>
      p?.estorno?.local_id && p.estorno.produto_id
        ? {
            operationId,
            empresa_id: p.empresa_id,
            produto_id: p.estorno.produto_id,
            quantidade: Number(p.estorno.quantidade) || 0,
            local_origem_id: null,
            local_destino_id: p.estorno.local_id,
            data: p.estorno.data ?? null,
          }
        : null,
  },
  {
    // D-PROD-298: o cancelamento da transferência faz o caminho de volta (destino → origem).
    tipo: TIPO_CANCELAMENTO_TRANSFERENCIA,
    /** @param {any} p @param {string} operationId @returns {MovimentoAguardando|null} */
    movimento: (p, operationId) =>
      p?.estorno?.origem && p.estorno.destino && p.estorno.produto_id
        ? {
            operationId,
            empresa_id: p.empresa_id,
            produto_id: p.estorno.produto_id,
            quantidade: Number(p.estorno.quantidade) || 0,
            local_origem_id: p.estorno.destino,
            local_destino_id: p.estorno.origem,
            data: p.estorno.data ?? null,
          }
        : null,
  },
];

/**
 * Registra outro tipo que mexe no estoque (ex.: a baixa do lançamento do cocho).
 * @param {string} tipo
 * @param {(payload: any, operationId: string) => MovimentoAguardando|null} movimento
 */
export const registrarEfeitoNoEstoque = (tipo, movimento) => {
  if (!EFEITOS.some((e) => e.tipo === tipo)) EFEITOS.push({ tipo, movimento });
};

/**
 * D-PROD-318 (Etapa 4, a tela nunca "pisca"): a cópia dos lotes já mostra este registro?
 *  - nunca tentou subir: não (o servidor não o tem);
 *  - tentou (ou foi confirmado): a cópia é de ANTES da primeira tentativa → não (aplica); de depois → pode já
 *    mostrar (não aplica, para não contar duas vezes). As duas horas são do aparelho (sem diferença de relógio).
 *    Sem a hora da cópia, como antes: só o que nunca tentou.
 * Antes, o que tinha tentado nunca era aplicado: sem internet depois de uma tentativa, ou entre a confirmação e a
 * próxima leitura dos lotes, o saldo voltava ao de antes e depois pulava (100 → 70 → 100 → 70).
 * @param {{ tentado: boolean, tentado_em: string|null, criado_em: string }} r @param {number|string|null|undefined} copiaDe
 */
const aindaNaoNaCopia = (r, copiaDe) => {
  if (!r.tentado) return true;
  const copia = typeof copiaDe === 'number' ? copiaDe : Date.parse(copiaDe ?? '');
  const inicio = Date.parse(r.tentado_em ?? r.criado_em ?? '');
  return Number.isFinite(copia) && Number.isFinite(inicio) && copia < inicio;
};

/**
 * Movimentos de estoque desta sessão que a cópia dos lotes ainda não mostra, em ordem.
 * @param {{ ignorar?: string|null, copiaDe?: number|string|null }} [opcoes] `ignorar`: o registro que está sendo editado
 *        (o saldo do formulário não pode descontar o próprio registro). `copiaDe`: quando a cópia dos lotes foi
 *        gravada no aparelho (D-PROD-318).
 */
export const movimentosDeEstoqueAguardando = async (opcoes = {}) => {
  const porTipo = await Promise.all(
    EFEITOS.map(async ({ tipo, movimento }) =>
      (await registrosDoAparelhoDoTipo(tipo))
        // Recusado pelo servidor ("precisa de atenção"): não vale no saldo.
        .filter((r) => r.estado !== 'atencao' && r.operationId !== opcoes.ignorar && aindaNaoNaCopia(r, opcoes.copiaDe))
        .map((r) => ({ criado_em: r.criado_em, mov: movimento(r.payload, r.operationId) }))
    )
  );
  return porTipo
    .flat()
    .filter((x) => x.mov && x.mov.quantidade > 0)
    .sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0))
    .map((x) => /** @type {MovimentoAguardando} */ (x.mov));
};

/** @param {any} lote */
const dataFifo = (lote) => {
  const t = Date.parse(lote?.data_documento || lote?.created_date || '');
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
};

/**
 * Aplica os movimentos aos lotes (cópia; a lista recebida não muda).
 * @param {any[]} lotes
 * @param {MovimentoAguardando[]} movimentos
 * @returns {any[]}
 */
export const aplicarMovimentosAosLotes = (lotes, movimentos) => {
  const resultado = (Array.isArray(lotes) ? lotes : []).map((l) => ({ ...l }));
  for (const mov of movimentos) {
    let restante = mov.quantidade;
    /** @type {any} */
    let referencia = null;
    if (mov.local_origem_id) {
      const daOrigem = resultado
        .filter(
          (l) =>
            l.empresa_id === mov.empresa_id &&
            l.produto_id === mov.produto_id &&
            l.local_estoque_id === mov.local_origem_id &&
            l.status === 'Disponivel' &&
            (Number(l.quantidade_disponivel) || 0) > 0
        )
        .sort((a, b) => dataFifo(a) - dataFifo(b) || String(a.id).localeCompare(String(b.id)));
      for (const lote of daOrigem) {
        if (restante <= 0) break;
        const tira = Math.min(restante, Number(lote.quantidade_disponivel) || 0);
        lote.quantidade_disponivel = (Number(lote.quantidade_disponivel) || 0) - tira;
        restante -= tira;
        referencia = referencia ?? lote;
      }
    }
    // D-PROD-311: o destino recebe só o que de fato saiu da origem. Antes recebia a quantidade
    // inteira mesmo quando a origem não tinha tudo (ex.: desfazer sem internet uma transferência
    // cujo estoque o destino já usou) — o total crescia e dava para lançar com estoque que não
    // existe. A origem que não aparece nos lotes do aparelho (sem origem) não limita.
    const entrou = mov.local_origem_id ? mov.quantidade - Math.max(0, restante) : mov.quantidade;
    if (mov.local_destino_id && entrou > 0) {
      resultado.push({
        ...(referencia ? { custo_unitario: referencia.custo_unitario, produto_nome: referencia.produto_nome, numero_documento: referencia.numero_documento } : {}),
        id: `aguardando:${mov.operationId}`,
        empresa_id: mov.empresa_id,
        produto_id: mov.produto_id,
        local_estoque_id: mov.local_destino_id,
        quantidade_disponivel: entrou,
        status: 'Disponivel',
        data_documento: mov.data || new Date().toISOString().slice(0, 10),
        _aguardandoEnvio: true,
      });
    }
  }
  return resultado;
};

/** A leitura dos lotes de estoque (a mesma da porta `estoque-lotes-nota`). */
export const CAMINHO_DOS_LOTES = '/estoque-lotes-nota';

/**
 * D-PROD-318: de quando é a lista de lotes que o aparelho tem (a última resposta do servidor, ou a cópia guardada),
 * no relógio do aparelho. Desconhecida → `null`.
 * @returns {Promise<number|null>}
 */
export const horaDaCopiaDosLotes = async () => {
  const tenant = getOfflineTenant();
  if (!tenant) return null;
  const naMemoria = horaDaResposta(tenant, CAMINHO_DOS_LOTES);
  if (naMemoria !== null) return naMemoria;
  try {
    return (await lerResposta(tenant, CAMINHO_DOS_LOTES))?.pedido_em ?? null;
  } catch {
    return null;
  }
};

/**
 * Os lotes com o efeito do que espera envio. Sem nada esperando, devolve a
 * própria lista. Falha ao ler a fila nunca derruba a tela: devolve os lotes.
 * @param {any[]} lotes
 * @param {{ ignorar?: string|null, copiaDe?: number|string|null }} [opcoes] sem `copiaDe`, a hora da lista do
 *        aparelho (`horaDaCopiaDosLotes`)
 */
export const comEstoqueAguardandoEnvio = async (lotes, opcoes = {}) => {
  try {
    const copiaDe = opcoes.copiaDe !== undefined ? opcoes.copiaDe : await horaDaCopiaDosLotes();
    const movimentos = await movimentosDeEstoqueAguardando({ ...opcoes, copiaDe });
    return movimentos.length ? aplicarMovimentosAosLotes(lotes, movimentos) : lotes;
  } catch {
    return lotes;
  }
};
