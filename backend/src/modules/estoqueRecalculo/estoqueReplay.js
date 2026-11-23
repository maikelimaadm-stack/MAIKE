/**
 * D-PROD-273 (fatia 3) — REPLAY PURO do custo médio por produto × depósito.
 *
 * Recebe o que o leitor leu (todos os movimentos do produto na empresa, em qualquer situação, e todas as
 * camadas) e refaz, em memória, o que o motor (`estoqueFisicoMotor.js`) gravou, na ORDEM CANÔNICA da SPEC §1.3:
 * `numero_movimentacao` numérico; empate/legado por `createdAt`, `id`. Nada aqui lê ou grava banco.
 *
 * Regras reproduzidas (as do motor, sem cálculo próprio de custo):
 *  - ENTRADA (compra, entrada documentada): cria a camada com o custo do movimento; não reavalia;
 *  - SAÍDA (venda, abastecimento, atividade, cocho, saída manual): `consumirCustoMedio` do próprio motor sobre o
 *    poço do depósito; as camadas restantes vão para o médio de depois (`reavaliarCamadas`);
 *  - TRANSFERÊNCIA (par S/R, processado junto, como o motor faz numa só chamada): a origem sai pelo médio; o
 *    destino recebe uma camada por fatia com esse custo e o poço do destino é reavaliado (cascata: o custo
 *    recalculado chega ao destino e segue nas saídas dele);
 *  - ESTORNO de saída: devolve cada fatia à SUA camada e o VALOR do original (exato) e reavalia o poço; o estorno
 *    EM LOTE (financeiro e atividade, `estornarEmLote`) reavalia uma vez por poço no fim do lote;
 *  - ESTORNO de entrada: a camada sai pelo valor vigente dela (sem reavaliar o resto);
 *  - ESTORNO de transferência (par E_d/E_o): destino perde as camadas recebidas e o valor de S; origem recebe as
 *    fatias de volta e o valor de S; os dois poços são reavaliados;
 *  - LEGADO (antes do custo médio, D-PROD-256): saída com `modo_saida_fifo` ≠ 'CUSTO_MEDIO' aplica as fatias e o
 *    valor FIFO GRAVADOS (sem reavaliar); estorno anterior ao corte (`cutover`) devolve sem reavaliar. Quando a
 *    simulação de exclusão alcança o depósito dele, passa à regra atual (médio), como a SPEC §4.7 manda.
 *
 *  - SOBRA DE AJUSTE (D-PROD-272, `ajuste_sobra`): entrada cuja camada nasce ao custo médio do depósito NAQUELE
 *    ponto (`pocoDoDeposito`: valor ÷ saldo, `CASAS_CUSTO`), valor = quantidade × médio; não reavalia. O custo é
 *    refeito pelo replay (é custo derivado do estoque: na simulação, segue o médio recalculado), salvo quando a linha
 *    do ajuste diz `custo_informado` (depósito sem saldo; vale o gravado, como o valor de compra). Sobra sem a linha
 *    do ajuste, ou sem custo informado num poço vazio, para o replay (fail-closed). A FALTA é uma saída a médio comum.
 *  - AJUSTE DEPOIS DO EXCLUÍDO (escolha do proprietário, 2026-11-23): na simulação (`opcoes.excluir`), uma sobra/falta
 *    de ajuste VIGENTE num depósito que a exclusão já alcançou (o do excluído e, pela cascata, o destino de uma
 *    transferência processada depois) para a simulação com `ajuste_de_inventario_posterior`: o estoque nunca fica
 *    diferente do contado. Os pares marcados (exclusões com recálculo já gravadas) não contam: só `opcoes.excluir`.
 *
 * Movimento fora do protocolo (origem que o motor não grava, estorno sem original legível, entrada sem camada)
 * não é adivinhado: vira `problema` e o replay daquele produto é declarado não reproduzível (fail-closed).
 *
 * D-PROD-273 (fatia 4) — EXCLUSÃO COM RECÁLCULO gravada: o original e o estorno dele marcados com
 * `movimentacao_grupo_id = 'exclusao_recalculo:<id do original>'` (`marcaDoPar`) ficam FORA da sequência, como na
 * simulação: o recálculo gravou os posteriores como se o par nunca tivesse existido. Os pares excluídos pela regra
 * antiga (sem a marca) continuam na sequência como foram gravados. Marca incoerente → `problema` (fail-closed).
 * Transferência cujas fatias mudaram no recálculo: a camada de destino gravada na mesma posição é reaproveitada
 * quando a camada de origem é a mesma (a quantidade pode mudar); senão nasce uma nova (`novoIdCamada`), e a
 * gravada que sobrou fica 'Estornado' com disponível 0 (nunca se apaga camada).
 */
import { CASAS_CUSTO, CASAS_QUANTIDADE, Dec, ZERO, arredondar, dec, somar } from '../financeiro/decimalFinanceiro.js';
import {
  MODO_CUSTO_MEDIO, ORIGEM_AJUSTE_ESTOQUE, ORIGEM_APONTAMENTO, ORIGEM_SISTEMA, consumirCustoMedio, ordenarFifo,
  TIPO_ESTORNO_TRANSFERENCIA_ENVIADA, TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA, TIPO_FALTA_AJUSTE, TIPO_SOBRA_AJUSTE,
} from '../estoqueFisico/estoqueFisicoMotor.js';
import { ORIGENS_PROTOCOLO } from '../estoqueFisico/reconciliacaoEstoque.js';
import { MARCA_EXCLUSAO_RECALCULO } from '../estoqueFisico/movimentoPosterior.js';

export const CLASSE = Object.freeze({
  ENTRADA: 'entrada',
  SAIDA: 'saida',
  TRANSFERENCIA_ENVIADA: 'transferencia_enviada',
  TRANSFERENCIA_RECEBIDA: 'transferencia_recebida',
  ESTORNO_SAIDA: 'estorno_saida',
  ESTORNO_ENTRADA: 'estorno_entrada',
  ESTORNO_TRANSFERENCIA_RECEBIDA: 'estorno_transferencia_recebida',
  ESTORNO_TRANSFERENCIA_ENVIADA: 'estorno_transferencia_enviada',
  FORA_DO_PROTOCOLO: 'fora_do_protocolo',
});

/** Origens cujo estorno de saída é EM LOTE (`estornarEmLote`: reavaliação uma vez por poço, no fim). */
const ORIGENS_ESTORNO_EM_LOTE = new Set([ORIGEM_SISTEMA, ORIGEM_APONTAMENTO]);

const NUMERO_CANONICO = /^\d{1,18}$/;

/** D-PROD-273 (fatia 4): prefixo da marca do par excluído com recálculo (em `movimentacao_grupo_id`, sem migration). */
export { MARCA_EXCLUSAO_RECALCULO };
/** Marca do par (o original e o estorno dele) excluído com recálculo. @param {string} originalId */
export const marcaDoPar = (originalId) => `${MARCA_EXCLUSAO_RECALCULO}${originalId}`;
/** O movimento traz a marca de recálculo (qualquer). @param {any} m */
export const temMarcaDeRecalculo = (m) => typeof m?.movimentacao_grupo_id === 'string' && m.movimentacao_grupo_id.startsWith(MARCA_EXCLUSAO_RECALCULO);
const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d ?? 0).getTime());

/**
 * Chave de ordem canônica (a mesma da fatia 2, `estoqueConsultaService`).
 * @param {{ numero_movimentacao: string, createdAt: Date|string, id: string }} m
 */
export const chaveCanonica = (m) => ({
  n: typeof m.numero_movimentacao === 'string' && NUMERO_CANONICO.test(m.numero_movimentacao) ? BigInt(m.numero_movimentacao) : null,
  t: ms(m.createdAt),
  id: String(m.id),
});
/** Comparador da ordem canônica (SPEC §1.3). */
export const compararCanonico = (a, b) => {
  const x = chaveCanonica(a);
  const y = chaveCanonica(b);
  if (x.n !== null && y.n !== null && x.n !== y.n) return x.n < y.n ? -1 : 1;
  if (x.t !== y.t) return x.t - y.t;
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
};
/** @template T @param {T[]} movimentos @returns {T[]} */
export const ordenarCanonico = (movimentos) => [...movimentos].sort(compararCanonico);

const ehEstorno = (m) => typeof m.tipo_detalhado === 'string' && m.tipo_detalhado.startsWith('estorno_');

/**
 * Classe do movimento para o replay.
 * @param {any} m @param {Map<string, any>} porId
 */
export const classificar = (m, porId) => {
  if (!ORIGENS_PROTOCOLO.includes(m.origem_sistema)) return CLASSE.FORA_DO_PROTOCOLO;
  const td = m.tipo_detalhado;
  if (m.tipo_movimentacao === 'Saída' && td === 'transferencia_enviada') return CLASSE.TRANSFERENCIA_ENVIADA;
  if (m.tipo_movimentacao === 'Entrada' && td === 'transferencia_recebida') return CLASSE.TRANSFERENCIA_RECEBIDA;
  if (m.tipo_movimentacao === 'Saída' && td === TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA) return CLASSE.ESTORNO_TRANSFERENCIA_RECEBIDA;
  if (m.tipo_movimentacao === 'Entrada' && td === TIPO_ESTORNO_TRANSFERENCIA_ENVIADA) return CLASSE.ESTORNO_TRANSFERENCIA_ENVIADA;
  if (ehEstorno(m)) {
    const pai = m.movimento_pai_id ? porId.get(m.movimento_pai_id) : null;
    if (!pai) return CLASSE.FORA_DO_PROTOCOLO;
    if (m.tipo_movimentacao === 'Entrada' && pai.tipo_movimentacao === 'Saída') return CLASSE.ESTORNO_SAIDA;
    if (m.tipo_movimentacao === 'Saída' && pai.tipo_movimentacao === 'Entrada') return CLASSE.ESTORNO_ENTRADA;
    return CLASSE.FORA_DO_PROTOCOLO;
  }
  if (m.tipo_movimentacao === 'Entrada') return CLASSE.ENTRADA;
  if (m.tipo_movimentacao === 'Saída') return CLASSE.SAIDA;
  return CLASSE.FORA_DO_PROTOCOLO;
};

/** Dia UTC (meia-noite) de um instante — `comoDia(createdAt.toISOString().slice(0, 10))` do motor. */
const diaUtc = (d) => new Date(`${new Date(ms(d)).toISOString().slice(0, 10)}T00:00:00.000Z`);

export const fatiasGravadas = (json, { comDestino = false } = {}) => {
  if (!Array.isArray(json) || !json.length) return null;
  const saida = [];
  for (const f of json) {
    if (!f || typeof f !== 'object' || typeof f.lote_id !== 'string' || !f.lote_id) return null;
    let q;
    let c;
    try {
      q = new Dec(String(f.quantidade));
      c = f.custo_unitario === undefined || f.custo_unitario === null ? null : new Dec(String(f.custo_unitario));
    } catch {
      return null;
    }
    if (q.isNaN() || !q.gt(0) || (c !== null && c.isNaN())) return null;
    saida.push({ lote_id: f.lote_id, quantidade: q, custo_unitario: c, lote_destino_id: comDestino && typeof f.lote_destino_id === 'string' ? f.lote_destino_id : null });
  }
  return saida;
};

/** Erro de domínio do replay: o motor recusaria (ou o histórico não se explica) — a simulação para aqui. */
class Parada extends Error {
  /** @param {Record<string, unknown>} dados */
  constructor(dados) {
    super(String(dados.reason));
    this.dados = dados;
  }
}

/**
 * Estado do replay: as camadas vivas (custo vigente, disponível, situação) e as consultas do poço.
 * @param {Map<string, any>} fatos camadas lidas (fatos imutáveis: id, local, data, createdAt, entrada, movimento de entrada)
 */
const novoEstado = (fatos) => {
  /** @type {Map<string, { id: string, local: string, data_documento: Date|null, createdAt: Date, custo: any, entrada: any, disp: any, status: string, virtual: boolean }>} */
  const camadas = new Map();
  /** @type {Map<string, any[]>} índice por depósito (o replay consulta o poço a cada movimento) */
  const porLocal = new Map();
  const doLocal = (local) => porLocal.get(local) ?? [];
  const poco = (local) => doLocal(local).filter((l) => l.status === 'Disponivel' && l.disp.gt(0));
  const saldo = (local) => somar(doLocal(local).filter((l) => l.status === 'Disponivel').map((l) => l.disp));
  const valor = (local) => somar(poco(local).map((l) => l.disp.times(l.custo)));
  const comoLotes = (local) => poco(local).map((l) => ({ id: l.id, quantidade_disponivel: l.disp, custo_unitario: l.custo, data_documento: l.data_documento, createdAt: l.createdAt }));
  /** `reavaliarCamadas`: as camadas citadas, se ainda vivas, passam ao custo. */
  const reavaliar = (ids, custo) => {
    for (const id of ids) {
      const l = camadas.get(id);
      if (l && l.status === 'Disponivel' && l.disp.gt(0)) l.custo = custo;
    }
  };
  /** `reavaliarPoco`: todo o disponível do local vai para valor ÷ quantidade (0 se valor ≤ 0); devolve o médio. */
  const reavaliarPoco = (local, v, q) => {
    if (!q.gt(0)) return ZERO;
    const medio = arredondar(v.gt(0) ? v.dividedBy(q) : ZERO, CASAS_CUSTO);
    reavaliar(poco(local).map((l) => l.id), medio);
    return medio;
  };
  const criar = (c) => {
    const fato = fatos.get(c.id);
    if (camadas.has(c.id)) throw new Parada({ reason: 'camada_repetida', lote_id: c.id });
    const camada = {
      id: c.id,
      local: c.local,
      data_documento: fato ? fato.data_documento ?? null : c.data_documento,
      createdAt: fato ? fato.createdAt : c.createdAt,
      custo: dec(c.custo),
      entrada: dec(c.quantidade),
      disp: dec(c.quantidade),
      status: 'Disponivel',
      virtual: !fato,
    };
    camadas.set(c.id, camada);
    if (!porLocal.has(c.local)) porLocal.set(c.local, []);
    porLocal.get(c.local)?.push(camada);
  };
  return { camadas, poco, saldo, valor, comoLotes, reavaliar, reavaliarPoco, criar };
};

const medioDe = (v, q) => (q.gt(0) ? arredondar(v.dividedBy(q), CASAS_CUSTO) : ZERO);
export const texto4 = (x) => (x === null || x === undefined ? null : dec(x).toFixed(4));
export const fatiaComoTexto = (f) => ({
  lote_id: f.lote_id,
  quantidade: dec(f.quantidade).toFixed(CASAS_QUANTIDADE),
  custo_unitario: f.custo_unitario === null || f.custo_unitario === undefined ? null : dec(f.custo_unitario).toFixed(CASAS_CUSTO),
  ...(f.lote_destino_id ? { lote_destino_id: f.lote_destino_id } : {}),
});

/**
 * Consome `fatias` (lote_id, quantidade) das camadas de `local`; a camada tem de estar viva no local e ter o disponível.
 * @returns {void}
 */
const consumir = (estado, local, fatias, m) => {
  for (const f of fatias) {
    const l = estado.camadas.get(f.lote_id);
    if (!l || l.local !== local || l.status !== 'Disponivel' || l.disp.lt(f.quantidade)) {
      throw new Parada({ reason: 'fatia_gravada_inaplicavel', movimento_id: m.id, movimento_numero: m.numero_movimentacao, lote_id: f.lote_id });
    }
    l.disp = l.disp.minus(f.quantidade);
    l.status = l.disp.gt(0) ? 'Disponivel' : 'Esgotado';
  }
};

/**
 * FIFO puro pelo custo de cada camada (o `consumirFifo` de antes da D-PROD-256), só para saída legada sem fatias.
 * @param {Array<{ id: string, quantidade_disponivel: any, custo_unitario: any, data_documento: Date|null, createdAt: Date }>} lotes @param {any} kg
 */
const consumirFifoLegado = (lotes, kg) => {
  const elegiveis = ordenarFifo(lotes.filter((l) => dec(l.quantidade_disponivel).gt(0)));
  const fatias = [];
  let restante = dec(kg);
  for (const l of elegiveis) {
    if (!restante.gt(0)) break;
    const disp = dec(l.quantidade_disponivel);
    const q = disp.lt(restante) ? disp : restante;
    fatias.push({ lote_id: l.id, quantidade: q, custo_unitario: dec(l.custo_unitario) });
    restante = restante.minus(q);
  }
  const valorTotal = arredondar(somar(fatias.map((f) => f.quantidade.times(f.custo_unitario))), CASAS_CUSTO);
  return { suficiente: !restante.gt(0), fatias, valorTotal, valorUnitario: dec(kg).gt(0) ? arredondar(valorTotal.dividedBy(dec(kg)), CASAS_CUSTO) : ZERO };
};

/** Saldo negativo: o motor recusaria a saída; a simulação recusa a exclusão (SPEC §4.4). */
const saldoNegativo = (local, m, disponivel, pedido) =>
  new Parada({
    reason: 'saldo_negativo', local_estoque_id: local, movimento_id: m.id, movimento_numero: m.numero_movimentacao,
    saldo: disponivel.minus(pedido).toFixed(CASAS_QUANTIDADE),
  });

/**
 * Tira `kg` das camadas `ids` (as do documento: a camada da entrada estornada, as recebidas na transferência) e, se
 * a simulação deixou alguma delas consumida, o que faltar sai das outras camadas do poço em ordem FIFO, pelo custo
 * delas (reatribuição — SPEC §4.3). Devolve o valor retirado (Σ disponível × custo) e se houve reatribuição.
 */
const retirarCamadas = (estado, local, ids, m) => {
  let valor = ZERO;
  let falta = ZERO;
  for (const id of ids) {
    const l = estado.camadas.get(id);
    if (!l || l.local !== local) throw new Parada({ reason: 'camada_do_documento_ausente', movimento_id: m.id, movimento_numero: m.numero_movimentacao, lote_id: id });
    if (l.status === 'Disponivel') valor = valor.plus(l.disp.times(l.custo));
    falta = falta.plus(l.entrada.minus(l.status === 'Disponivel' ? l.disp : ZERO));
    l.disp = ZERO;
    l.status = 'Estornado';
  }
  if (!falta.gt(0)) return { valor, reatribuido: false };
  const plano = consumirFifoLegado(estado.comoLotes(local), falta);
  if (!plano.suficiente) throw saldoNegativo(local, m, estado.saldo(local), falta);
  consumir(estado, local, plano.fatias, m);
  return { valor: valor.plus(somar(plano.fatias.map((f) => f.quantidade.times(f.custo_unitario)))), reatribuido: true };
};

/** Devolve as fatias às suas camadas (o estorno de saída), como o CAS do motor (camada viva ou esgotada, até a entrada). */
const devolver = (estado, local, fatias, m) => {
  for (const f of fatias) {
    const l = estado.camadas.get(f.lote_id);
    if (!l || l.local !== local || !['Disponivel', 'Esgotado'].includes(l.status)) {
      throw new Parada({ reason: 'camada_indisponivel_para_devolucao', movimento_id: m.id, movimento_numero: m.numero_movimentacao, lote_id: f.lote_id });
    }
    if (l.disp.plus(f.quantidade).gt(l.entrada)) {
      throw new Parada({ reason: 'devolucao_excede_entrada', movimento_id: m.id, movimento_numero: m.numero_movimentacao, lote_id: f.lote_id });
    }
    l.disp = l.disp.plus(f.quantidade);
    l.status = 'Disponivel';
  }
};

/**
 * D-PROD-273 (fatias 4 e 5) — pares excluídos COM recálculo. A marca é `marcaDoPar(<id do original>)`, no original
 * 'Estornada' e no estorno dele (filho, `estorno_*`, pai = ele):
 *  - SAÍDA (fatia 4) e ENTRADA (fatia 5: entrada documentada, compra, sobra do ajuste): o estorno é o filho do original;
 *  - TRANSFERÊNCIA (fatia 5): dois pares, cada perna com o seu estorno — S `transferencia_enviada` + E_o
 *    (`estorno_transferencia_enviada`, pai = S) com a marca de S, e R `transferencia_recebida` + E_d
 *    (`estorno_transferencia_recebida`, filho de R) com a marca de R. Os DOIS pares têm de estar marcados.
 * Marca fora desse desenho → `problema` (o replay não adivinha).
 * @param {any[]} ordem @param {Map<string, any>} porId @param {any[]} problemas
 * @returns {Set<string>}
 */
const paresMarcados = (ordem, porId, problemas) => {
  /** @type {Map<string, any[]>} raiz (id do original) → movimentos com a marca dela */
  const grupos = new Map();
  for (const m of ordem) {
    if (!temMarcaDeRecalculo(m)) continue;
    const raiz = m.movimentacao_grupo_id.slice(MARCA_EXCLUSAO_RECALCULO.length);
    if (!grupos.has(raiz)) grupos.set(raiz, []);
    grupos.get(raiz)?.push(m);
  }
  /** O par (original, estorno) da raiz, pelo desenho do motor; null se incoerente. */
  const parDe = (raiz) => {
    const o = porId.get(raiz);
    if (!o || o.status !== 'Estornada' || ehEstorno(o) || !['Entrada', 'Saída'].includes(o.tipo_movimentacao)) return null;
    let e;
    if (o.tipo_movimentacao === 'Saída' && o.tipo_detalhado === 'transferencia_enviada') {
      e = ordem.find((x) => x.movimento_pai_id === o.id && x.tipo_movimentacao === 'Entrada' && x.tipo_detalhado === TIPO_ESTORNO_TRANSFERENCIA_ENVIADA);
    } else {
      e = o.movimento_filho_id ? porId.get(o.movimento_filho_id) : null;
      if (o.tipo_detalhado === 'transferencia_recebida' && e?.tipo_detalhado !== TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA) return null;
    }
    if (!e || e.movimento_pai_id !== o.id || !ehEstorno(e) || e.tipo_movimentacao === o.tipo_movimentacao) return null;
    const membros = grupos.get(raiz) ?? [];
    const marca = marcaDoPar(raiz);
    if (membros.length !== 2 || !membros.every((x) => (x.id === o.id || x.id === e.id) && x.movimentacao_grupo_id === marca)) return null;
    return [o, e];
  };
  /** @type {Set<string>} */
  const ids = new Set();
  for (const [raiz, membros] of grupos) {
    const par = parDe(raiz);
    let valido = Boolean(par);
    if (par && par[0].tipo_detalhado === 'transferencia_enviada') {
      const r = par[0].movimento_filho_id ? porId.get(par[0].movimento_filho_id) : null;
      valido = Boolean(r && r.movimento_pai_id === par[0].id && r.tipo_detalhado === 'transferencia_recebida' && parDe(r.id));
    } else if (par && par[0].tipo_detalhado === 'transferencia_recebida') {
      const s = par[0].movimento_pai_id ? porId.get(par[0].movimento_pai_id) : null;
      valido = Boolean(s && s.movimento_filho_id === par[0].id && s.tipo_detalhado === 'transferencia_enviada' && parDe(s.id));
    }
    if (!valido || !par) {
      for (const m of membros) problemas.push({ reason: 'marca_de_recalculo_incoerente', movimento_id: m.id, movimento_numero: m.numero_movimentacao });
      continue;
    }
    ids.add(par[0].id);
    ids.add(par[1].id);
  }
  return ids;
};

/**
 * O replay. `opcoes.excluir`: ids fora da sequência (a simulação de exclusão; o movimento e o par dele). Sem ele,
 * é o replay "sem exclusão" que tem de reproduzir o gravado.
 * `opcoes.novoIdCamada(r, k)`: id da camada de destino que a transferência `r` precisa criar na posição `k` (a escrita
 * da fatia 4 passa ids reais; a prévia usa `simulada:…`).
 * @param {{ movimentos: any[], camadas: any[], cutover?: Date|number|null, ajustes?: Array<{ movimentacao_estoque_id: string|null, custo_informado: boolean }> }} historico
 * @param {{ excluir?: string[], novoIdCamada?: (r: any, k: number) => string }} [opcoes]
 * @returns {{ resultados: Map<string, any>, camadas: Map<string, any>, problemas: any[], parada: any|null,
 *   afetados: Set<string>, ordem: any[], reproduzivel: boolean, marcados: Set<string> }}
 */
export const reproduzir = (historico, opcoes = {}) => {
  const ordem = ordenarCanonico(historico.movimentos);
  const porId = new Map(ordem.map((m) => [m.id, m]));
  const problemas = [];
  const marcados = paresMarcados(ordem, porId, problemas);
  const excluir = new Set([...(opcoes.excluir ?? []), ...marcados]);
  const novoIdCamada = opcoes.novoIdCamada ?? ((r, k) => `simulada:${r.id}:${k + 1}`);
  const fatos = new Map(historico.camadas.map((l) => [l.id, l]));
  /** D-PROD-272: movimento da sobra/falta do ajuste → a linha diz se o custo foi informado. */
  const linhasDeAjuste = new Map((historico.ajustes ?? []).filter((x) => x.movimentacao_estoque_id).map((x) => [x.movimentacao_estoque_id, x]));
  /** @type {Map<string, string[]>} */
  const camadasDaEntrada = new Map();
  for (const l of historico.camadas) {
    if (!l.movimentacao_entrada_id) continue;
    if (!camadasDaEntrada.has(l.movimentacao_entrada_id)) camadasDaEntrada.set(l.movimentacao_entrada_id, []);
    camadasDaEntrada.get(l.movimentacao_entrada_id)?.push(l.id);
  }
  // Corte do custo médio (D-PROD-256): estorno de saída lançado antes dele devolvia sem reavaliar. Número = ms (±Infinity aceito).
  const c0 = historico.cutover;
  const corte = c0 === null || c0 === undefined ? -Infinity : typeof c0 === 'number' ? c0 : ms(c0);
  const estado = novoEstado(fatos);
  /** @type {Map<string, any>} */
  const resultados = new Map();
  const afetados = new Set();
  const feitos = new Set();
  let parada = null;
  const afetado = (local) => afetados.has(local);
  /** Depósitos alcançados pela exclusão SIMULADA (`opcoes.excluir`; sem os pares já marcados): o ajuste neles recusa. */
  const alvo = new Set(opcoes.excluir ?? []);
  const alcancados = new Set();
  /** Sobra/falta de ajuste vigente num depósito alcançado → a simulação para (ver o topo). */
  const exigirSemAjusteAlcancado = (m, local) => {
    if (m.origem_sistema !== ORIGEM_AJUSTE_ESTOQUE || ![TIPO_SOBRA_AJUSTE, TIPO_FALTA_AJUSTE].includes(m.tipo_detalhado)) return;
    if (m.status !== 'Ativa' || m.movimento_filho_id || !alcancados.has(local)) return;
    throw new Parada({ reason: 'ajuste_de_inventario_posterior', local_estoque_id: local, movimento_id: m.id, movimento_numero: m.numero_movimentacao, ajuste_id: m.lancamento_origem_id ?? null });
  };
  const classes = new Map(ordem.map((m) => [m.id, classificar(m, porId)]));
  const filhoEstorno = (paiId, tipo) => ordem.find((x) => x.movimento_pai_id === paiId && x.tipo_detalhado === tipo) ?? null;

  const registrar = (m, r) => {
    feitos.add(m.id);
    resultados.set(m.id, { id: m.id, numero: m.numero_movimentacao, classe: classes.get(m.id), ...r });
  };

  const saida = (m) => {
    const local = m.local_estoque_origem;
    exigirSemAjusteAlcancado(m, local);
    const kg = dec(m.quantidade);
    const saldoAntes = estado.saldo(local);
    const legado = m.modo_saida_fifo !== MODO_CUSTO_MEDIO && !afetado(local);
    if (legado) {
      /** @type {Array<{ lote_id: string, quantidade: any, custo_unitario: any }>|null} */
      let fatias = fatiasGravadas(m.lotes_consumidos);
      let reconstruidas = false;
      if (!fatias) {
        const plano = consumirFifoLegado(estado.comoLotes(local), kg);
        if (!plano.suficiente) throw saldoNegativo(local, m, saldoAntes, kg);
        fatias = plano.fatias;
        reconstruidas = true;
      }
      consumir(estado, local, fatias, m);
      registrar(m, {
        regra: 'legado', local, saldo_antes: saldoAntes, saldo_depois: saldoAntes.minus(kg),
        valor_unitario: m.valor_unitario === null ? null : dec(m.valor_unitario), valor_total: m.valor_total === null ? null : dec(m.valor_total),
        custo_medio_antes: null, custo_medio_depois: null, fatias: fatias.map(fatiaComoTexto), fatias_reconstruidas: reconstruidas,
      });
      return;
    }
    const plano = consumirCustoMedio(estado.comoLotes(local), kg);
    if (!plano.suficiente) throw saldoNegativo(local, m, saldoAntes, kg);
    consumir(estado, local, plano.fatias, m);
    estado.reavaliar(plano.camadasRestantes, plano.custoMedioDepois);
    registrar(m, {
      regra: 'atual', local, saldo_antes: saldoAntes, saldo_depois: saldoAntes.minus(kg),
      valor_unitario: plano.valorUnitario, valor_total: plano.valorTotal,
      custo_medio_antes: plano.custoMedioAntes, custo_medio_depois: plano.custoMedioDepois, fatias: plano.fatias.map(fatiaComoTexto),
    });
  };

  const entrada = (m) => {
    const local = m.local_estoque_destino;
    const ids = camadasDaEntrada.get(m.id) ?? [];
    if (ids.length !== 1) throw new Parada({ reason: 'entrada_sem_camada', movimento_id: m.id, movimento_numero: m.numero_movimentacao });
    exigirSemAjusteAlcancado(m, local);
    const fato = /** @type {any} */ (fatos.get(ids[0]));
    const saldoAntes = estado.saldo(local);
    let valorUnitario = m.valor_unitario === null ? null : dec(m.valor_unitario);
    let valorTotal = m.valor_total === null ? null : dec(m.valor_total);
    if (m.origem_sistema === ORIGEM_AJUSTE_ESTOQUE && m.tipo_detalhado === TIPO_SOBRA_AJUSTE) {
      const linha = linhasDeAjuste.get(m.id);
      if (!linha) throw new Parada({ reason: 'sobra_de_ajuste_sem_linha', movimento_id: m.id, movimento_numero: m.numero_movimentacao });
      if (!linha.custo_informado) {
        // O motor: sobra ao médio do depósito (`pocoDoDeposito`); sem saldo ele exigiria o custo informado.
        if (!saldoAntes.gt(0)) throw new Parada({ reason: 'sobra_de_ajuste_sem_custo_medio', local_estoque_id: local, movimento_id: m.id, movimento_numero: m.numero_movimentacao });
        valorUnitario = medioDe(estado.valor(local), saldoAntes);
        valorTotal = arredondar(dec(m.quantidade).times(valorUnitario), CASAS_CUSTO);
      }
    }
    estado.criar({ id: fato.id, local: fato.local_estoque_id, quantidade: fato.quantidade_entrada, custo: valorUnitario ?? 0 });
    registrar(m, {
      regra: 'atual', local, saldo_antes: saldoAntes, saldo_depois: saldoAntes.plus(dec(m.quantidade)),
      valor_unitario: valorUnitario, valor_total: valorTotal,
      custo_medio_antes: null, custo_medio_depois: null, fatias: null,
    });
  };

  const transferencia = (s) => {
    const r = s.movimento_filho_id ? porId.get(s.movimento_filho_id) : null;
    if (!r || r.movimento_pai_id !== s.id || classes.get(r.id) !== CLASSE.TRANSFERENCIA_RECEBIDA) {
      throw new Parada({ reason: 'par_de_transferencia_incoerente', movimento_id: s.id, movimento_numero: s.numero_movimentacao });
    }
    const origem = s.local_estoque_origem;
    const destino = s.local_estoque_destino;
    const kg = dec(s.quantidade);
    const saldoOrigem = estado.saldo(origem);
    const legadoOrigem = s.modo_saida_fifo !== MODO_CUSTO_MEDIO && !afetado(origem);
    // Cascata: o custo recalculado na origem chega ao destino (e daí às saídas e transferências dele).
    if (afetado(origem)) afetados.add(destino);
    if (alcancados.has(origem)) alcancados.add(destino);
    const legadoDestino = s.modo_saida_fifo !== MODO_CUSTO_MEDIO && !afetado(destino);
    let fatias;
    let valorTotal;
    let valorUnitario;
    let medioAntes = null;
    let medioDepois = null;
    const gravadas = fatiasGravadas(s.lotes_consumidos, { comDestino: true });
    if (legadoOrigem) {
      fatias = gravadas;
      if (!fatias) throw new Parada({ reason: 'transferencia_legada_sem_fatias', movimento_id: s.id, movimento_numero: s.numero_movimentacao });
      consumir(estado, origem, fatias, s);
      valorTotal = dec(s.valor_total ?? 0);
      valorUnitario = dec(s.valor_unitario ?? 0);
    } else {
      const plano = consumirCustoMedio(estado.comoLotes(origem), kg);
      if (!plano.suficiente) throw saldoNegativo(origem, s, saldoOrigem, kg);
      consumir(estado, origem, plano.fatias, s);
      estado.reavaliar(plano.camadasRestantes, plano.custoMedioDepois);
      fatias = plano.fatias;
      valorTotal = plano.valorTotal;
      valorUnitario = plano.valorUnitario;
      medioAntes = plano.custoMedioAntes;
      medioDepois = plano.custoMedioDepois;
    }
    const vDestino = estado.valor(destino);
    const saldoDestino = estado.saldo(destino);
    // Camada de destino: a gravada na mesma posição quando a camada de origem é a mesma (replay = gravado; no
    // recálculo a quantidade pode mudar); senão, uma nova (`novoIdCamada`). A gravada que sobrar fica 'Estornado'.
    const recebidas = camadasDaEntrada.get(r.id) ?? [];
    const recebidasSet = new Set(recebidas);
    const usadas = new Set();
    const comDestino = fatias.map((f, k) => {
      const g = gravadas?.[k];
      const mesma = g && g.lote_id === f.lote_id && g.lote_destino_id && recebidasSet.has(g.lote_destino_id) && !usadas.has(g.lote_destino_id);
      const idDestino = mesma ? /** @type {string} */ (g.lote_destino_id) : novoIdCamada(r, k);
      usadas.add(idDestino);
      const fonte = estado.camadas.get(f.lote_id);
      estado.criar({
        id: idDestino, local: destino, quantidade: f.quantidade, custo: f.custo_unitario ?? ZERO,
        data_documento: fonte ? fonte.data_documento ?? diaUtc(fonte.createdAt) : null, createdAt: r.createdAt,
      });
      return { ...f, lote_destino_id: idDestino };
    });
    for (const id of recebidas) {
      if (usadas.has(id)) continue;
      const fato = /** @type {any} */ (fatos.get(id));
      estado.criar({ id, local: destino, quantidade: fato.quantidade_entrada, custo: fato.custo_unitario });
      const morta = /** @type {any} */ (estado.camadas.get(id));
      morta.disp = ZERO;
      morta.status = 'Estornado';
    }
    if (!legadoDestino) estado.reavaliarPoco(destino, vDestino.plus(valorTotal), saldoDestino.plus(kg));
    const comum = { valor_unitario: valorUnitario, valor_total: valorTotal, custo_medio_antes: medioAntes, custo_medio_depois: medioDepois };
    registrar(s, {
      regra: legadoOrigem ? 'legado' : 'atual', local: origem, saldo_antes: saldoOrigem, saldo_depois: saldoOrigem.minus(kg), ...comum,
      fatias: comDestino.map(fatiaComoTexto),
    });
    registrar(r, {
      regra: legadoDestino ? 'legado' : 'atual', local: destino, saldo_antes: saldoDestino, saldo_depois: saldoDestino.plus(kg), ...comum, fatias: null,
    });
  };

  /** Estorno de saída (item a item, ou o lote do financeiro/atividade: reavaliação uma vez por poço, no fim). */
  const estornosDeSaida = (lote) => {
    /** @type {Map<string, { v: any, legado: boolean }>} */
    const pocos = new Map();
    for (const e of lote) {
      const local = e.local_estoque_destino;
      const pai = porId.get(e.movimento_pai_id);
      const original = resultados.get(pai.id);
      if (!original) throw new Parada({ reason: 'original_nao_reproduzido', movimento_id: e.id, movimento_numero: e.numero_movimentacao });
      const kg = dec(e.quantidade);
      if (!pocos.has(local)) pocos.set(local, { v: estado.valor(local), legado: ms(e.createdAt) < corte && !afetado(local) });
      const saldoAntes = estado.saldo(local);
      const fatias = (original.fatias ?? []).map((f) => ({ lote_id: f.lote_id, quantidade: dec(f.quantidade) }));
      if (!fatias.length || !somar(fatias.map((f) => f.quantidade)).eq(kg)) {
        throw new Parada({ reason: 'fatias_inconsistentes', movimento_id: e.id, movimento_numero: e.numero_movimentacao });
      }
      devolver(estado, local, fatias, e);
      const p = /** @type {{ v: any, legado: boolean }} */ (pocos.get(local));
      p.v = p.v.plus(dec(original.valor_total ?? 0));
      registrar(e, {
        regra: p.legado ? 'legado' : 'atual', local, saldo_antes: saldoAntes, saldo_depois: saldoAntes.plus(kg),
        valor_unitario: original.valor_unitario, valor_total: original.valor_total, custo_medio_antes: null, custo_medio_depois: null, fatias: null,
      });
      if (lote.length === 1 && !p.legado) {
        estado.reavaliarPoco(local, p.v, estado.saldo(local));
        pocos.delete(local);
      }
    }
    for (const [local, p] of pocos) if (!p.legado) estado.reavaliarPoco(local, p.v, estado.saldo(local));
  };

  const estornoDeEntrada = (e) => {
    const local = e.local_estoque_origem;
    const pai = porId.get(e.movimento_pai_id);
    const original = resultados.get(pai.id);
    if (!original) throw new Parada({ reason: 'original_nao_reproduzido', movimento_id: e.id, movimento_numero: e.numero_movimentacao });
    const saldoAntes = estado.saldo(local);
    const { reatribuido } = retirarCamadas(estado, local, camadasDaEntrada.get(pai.id) ?? [], e);
    registrar(e, {
      regra: 'atual', local, saldo_antes: saldoAntes, saldo_depois: saldoAntes.minus(dec(e.quantidade)),
      valor_unitario: original.valor_unitario, valor_total: original.valor_total, custo_medio_antes: null, custo_medio_depois: null, fatias: null,
      ...(reatribuido ? { reatribuido: true } : {}),
    });
  };

  const estornoDeTransferencia = (m) => {
    const ed = classes.get(m.id) === CLASSE.ESTORNO_TRANSFERENCIA_RECEBIDA ? m : null;
    const eo = classes.get(m.id) === CLASSE.ESTORNO_TRANSFERENCIA_ENVIADA ? m : null;
    const r = ed ? porId.get(ed.movimento_pai_id) : null;
    const s = eo ? porId.get(eo.movimento_pai_id) : r ? porId.get(r.movimento_pai_id) : null;
    const rr = r ?? (s?.movimento_filho_id ? porId.get(s.movimento_filho_id) : null);
    const d = ed ?? (rr ? filhoEstorno(rr.id, TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA) : null);
    const o = eo ?? (s ? filhoEstorno(s.id, TIPO_ESTORNO_TRANSFERENCIA_ENVIADA) : null);
    const rs = s ? resultados.get(s.id) : null;
    if (!s || !rr || !d || !o || !rs) throw new Parada({ reason: 'estorno_de_transferencia_incoerente', movimento_id: m.id, movimento_numero: m.numero_movimentacao });
    const origem = s.local_estoque_origem;
    const destino = s.local_estoque_destino;
    if (afetado(origem) || afetado(destino)) {
      afetados.add(origem);
      afetados.add(destino);
    }
    if (alcancados.has(origem) || alcancados.has(destino)) {
      alcancados.add(origem);
      alcancados.add(destino);
    }
    const kg = dec(s.quantidade);
    const valorTotal = dec(rs.valor_total ?? 0);
    const fatias = (rs.fatias ?? []).map((f) => ({ lote_id: f.lote_id, lote_destino_id: f.lote_destino_id, quantidade: dec(f.quantidade) }));
    // Destino: sai o recebido e o valor de S; o poço é reavaliado.
    const vD = estado.valor(destino);
    const qD = estado.saldo(destino);
    retirarCamadas(estado, destino, fatias.map((f) => f.lote_destino_id), d);
    const restoD = vD.minus(valorTotal);
    const medioDepoisD = estado.reavaliarPoco(destino, restoD.gt(0) ? restoD : ZERO, qD.minus(kg));
    // Origem: as fatias voltam às camadas e o valor de S volta ao poço.
    const vO = estado.valor(origem);
    const qO = estado.saldo(origem);
    devolver(estado, origem, fatias, o);
    const medioDepoisO = estado.reavaliarPoco(origem, vO.plus(valorTotal), qO.plus(kg));
    const comum = { regra: 'atual', valor_unitario: rs.valor_unitario, valor_total: rs.valor_total };
    registrar(d, {
      ...comum, local: destino, saldo_antes: qD, saldo_depois: qD.minus(kg), custo_medio_antes: medioDe(vD, qD), custo_medio_depois: medioDepoisD,
      fatias: fatias.map((f) => fatiaComoTexto({ lote_id: f.lote_destino_id, quantidade: f.quantidade, custo_unitario: rs.valor_unitario ?? ZERO })),
    });
    registrar(o, {
      ...comum, local: origem, saldo_antes: qO, saldo_depois: qO.plus(kg), custo_medio_antes: medioDe(vO, qO), custo_medio_depois: medioDepoisO, fatias: null,
    });
  };

  /** Lote de estornos de saída do MESMO `estornarEmLote`: consecutivos, mesma origem, documento, rótulo e instante. */
  const loteDe = (i) => {
    const e = ordem[i];
    if (!ORIGENS_ESTORNO_EM_LOTE.has(e.origem_sistema) || !e.lancamento_origem_id) return [e];
    const lote = [e];
    for (let j = i + 1; j < ordem.length; j += 1) {
      const x = ordem[j];
      if (excluir.has(x.id) || classes.get(x.id) !== CLASSE.ESTORNO_SAIDA || x.origem_sistema !== e.origem_sistema
        || x.lancamento_origem_id !== e.lancamento_origem_id || x.tipo_detalhado !== e.tipo_detalhado || ms(x.createdAt) !== ms(e.createdAt)) break;
      lote.push(x);
    }
    return lote;
  };

  for (let i = 0; i < ordem.length; i += 1) {
    const m = ordem[i];
    if (feitos.has(m.id)) continue;
    if (excluir.has(m.id)) {
      for (const local of [m.local_estoque_origem, m.local_estoque_destino]) {
        if (!local) continue;
        afetados.add(local);
        if (alvo.has(m.id)) alcancados.add(local);
      }
      // D-PROD-273 (fatia 5): a camada de uma ENTRADA excluída (e as recebidas numa transferência excluída) fica
      // 'Estornado' com disponível 0, no custo e na entrada gravados — nunca apagada e nunca no poço. Quem consumiu dela
      // depois volta a consumir das outras camadas (FIFO, pelo médio do poço sem ela).
      for (const id of camadasDaEntrada.get(m.id) ?? []) {
        if (estado.camadas.has(id)) continue;
        const fato = /** @type {any} */ (fatos.get(id));
        estado.criar({ id, local: fato.local_estoque_id, quantidade: fato.quantidade_entrada, custo: fato.custo_unitario });
        const morta = /** @type {any} */ (estado.camadas.get(id));
        morta.disp = ZERO;
        morta.status = 'Estornado';
      }
      feitos.add(m.id);
      continue;
    }
    try {
      switch (classes.get(m.id)) {
        case CLASSE.ENTRADA: entrada(m); break;
        case CLASSE.SAIDA: saida(m); break;
        case CLASSE.TRANSFERENCIA_ENVIADA: transferencia(m); break;
        case CLASSE.TRANSFERENCIA_RECEBIDA: transferencia(porId.get(m.movimento_pai_id) ?? m); break;
        case CLASSE.ESTORNO_SAIDA: estornosDeSaida(loteDe(i)); break;
        case CLASSE.ESTORNO_ENTRADA: estornoDeEntrada(m); break;
        case CLASSE.ESTORNO_TRANSFERENCIA_RECEBIDA:
        case CLASSE.ESTORNO_TRANSFERENCIA_ENVIADA: estornoDeTransferencia(m); break;
        default:
          problemas.push({ reason: 'fora_do_protocolo', movimento_id: m.id, movimento_numero: m.numero_movimentacao, origem_sistema: m.origem_sistema });
          feitos.add(m.id);
      }
    } catch (erro) {
      if (!(erro instanceof Parada)) throw erro;
      parada = erro.dados;
      break;
    }
  }
  return { resultados, camadas: estado.camadas, problemas, parada, afetados, ordem, reproduzivel: !parada && !problemas.length, marcados };
};

export const CAMPOS_VALOR = Object.freeze(['valor_unitario', 'valor_total', 'saldo_antes', 'saldo_depois', 'custo_medio_antes', 'custo_medio_depois']);

/**
 * Prova "replay = gravado": cada movimento reproduzido contra o gravado (valores, saldos, médios quando gravados, fatias) e
 * cada camada no fim (disponível, custo, situação). Devolve as divergências (lista vazia = reproduz exatamente).
 * @param {ReturnType<typeof reproduzir>} replay
 * @param {{ movimentos: any[], camadas: any[] }} historico
 */
export const compararComGravado = (replay, historico) => {
  const divergencias = [];
  for (const m of historico.movimentos) {
    const r = replay.resultados.get(m.id);
    if (!r) continue;
    for (const campo of CAMPOS_VALOR) {
      const gravado = texto4(m[campo]);
      if (gravado === null) continue;
      const calculado = texto4(r[campo]);
      if (calculado === null) continue;
      if (gravado !== calculado) divergencias.push({ tipo: 'movimento', movimento_id: m.id, movimento_numero: m.numero_movimentacao, campo, gravado, calculado });
    }
    if (r.fatias && r.regra === 'atual') {
      const gravado = JSON.stringify((fatiasGravadas(m.lotes_consumidos, { comDestino: true }) ?? []).map(fatiaComoTexto));
      const calculado = JSON.stringify(r.fatias);
      if (gravado !== calculado) divergencias.push({ tipo: 'movimento', movimento_id: m.id, movimento_numero: m.numero_movimentacao, campo: 'lotes_consumidos', gravado, calculado });
    }
  }
  for (const l of historico.camadas) {
    const c = replay.camadas.get(l.id);
    if (!c) {
      divergencias.push({ tipo: 'camada', lote_id: l.id, campo: 'origem', gravado: 'existe', calculado: 'nao_reproduzida' });
      continue;
    }
    const pares = [['quantidade_disponivel', texto4(l.quantidade_disponivel), texto4(c.disp)], ['custo_unitario', texto4(l.custo_unitario), texto4(c.custo)], ['status', l.status, c.status]];
    for (const [campo, gravado, calculado] of pares) if (gravado !== calculado) divergencias.push({ tipo: 'camada', lote_id: l.id, campo, gravado, calculado });
  }
  for (const c of replay.camadas.values()) if (c.virtual) divergencias.push({ tipo: 'camada', lote_id: c.id, campo: 'origem', gravado: 'inexistente', calculado: 'criada' });
  return divergencias;
};

/** Resumo do poço no fim (saldo, valor, médio) por depósito. */
const pocosFinais = (camadas) => {
  /** @type {Map<string, { saldo: any, valor: any }>} */
  const porLocal = new Map();
  for (const c of camadas.values()) {
    const p = porLocal.get(c.local) ?? { saldo: ZERO, valor: ZERO };
    if (c.status === 'Disponivel') {
      p.saldo = p.saldo.plus(c.disp);
      p.valor = p.valor.plus(c.disp.times(c.custo));
    }
    porLocal.set(c.local, p);
  }
  return porLocal;
};

const valoresDe = (r) => (r ? Object.fromEntries(CAMPOS_VALOR.map((k) => [k, texto4(r[k])])) : null);

/**
 * Simulação da exclusão: o mesmo replay sem o movimento (e o par dele) contra o replay sem exclusão. Devolve o que
 * mudaria (movimentos, valores e saldos antes → depois, poços, camadas) ou a recusa (saldo negativo / inviável).
 * @param {{ movimentos: any[], camadas: any[], cutover?: Date|number|null }} historico
 * @param {ReturnType<typeof reproduzir>} base o replay sem exclusão (já provado igual ao gravado)
 * @param {string[]} excluir o movimento e o par
 */
export const simularExclusao = (historico, base, excluir) => {
  const sim = reproduzir(historico, { excluir });
  if (sim.parada) {
    const { reason, ...detalhes } = sim.parada;
    return { permitido: false, recusa: { reason, ...detalhes }, movimentos: [], depositos: [], camadas: [], afetados: [...sim.afetados] };
  }
  const movimentos = [];
  for (const m of base.ordem) {
    if (excluir.includes(m.id)) continue;
    const antes = base.resultados.get(m.id);
    const depois = sim.resultados.get(m.id);
    if (!antes || !depois) continue;
    const va = valoresDe(antes);
    const vd = valoresDe(depois);
    const fatiasMudaram = JSON.stringify(antes.fatias ?? null) !== JSON.stringify(depois.fatias ?? null);
    if (JSON.stringify(va) === JSON.stringify(vd) && !fatiasMudaram && antes.regra === depois.regra) continue;
    movimentos.push({
      id: m.id, numero: m.numero_movimentacao, tipo: m.tipo_movimentacao, tipo_detalhado: m.tipo_detalhado ?? null, origem_sistema: m.origem_sistema,
      local_estoque_id: depois.local, antes: va, depois: vd, fatias_mudaram: fatiasMudaram,
      ...(antes.regra !== depois.regra ? { regra: { antes: antes.regra, depois: depois.regra } } : {}),
      ...(depois.reatribuido ? { reatribuido: true } : {}),
    });
  }
  const pa = pocosFinais(base.camadas);
  const pd = pocosFinais(sim.camadas);
  const depositos = [...new Set([...pa.keys(), ...pd.keys()])].sort().map((local) => {
    const a = pa.get(local) ?? { saldo: ZERO, valor: ZERO };
    const d = pd.get(local) ?? { saldo: ZERO, valor: ZERO };
    return {
      local_estoque_id: local,
      saldo_antes: texto4(a.saldo), saldo_depois: texto4(d.saldo),
      valor_antes: texto4(arredondar(a.valor, CASAS_CUSTO)), valor_depois: texto4(arredondar(d.valor, CASAS_CUSTO)),
      custo_medio_antes: texto4(medioDe(a.valor, a.saldo)), custo_medio_depois: texto4(medioDe(d.valor, d.saldo)),
    };
  });
  const camadas = [];
  for (const id of [...new Set([...base.camadas.keys(), ...sim.camadas.keys()])].sort()) {
    const a = base.camadas.get(id);
    const d = sim.camadas.get(id);
    const ra = a ? { quantidade_disponivel: texto4(a.disp), custo_unitario: texto4(a.custo), status: a.status } : null;
    const rd = d ? { quantidade_disponivel: texto4(d.disp), custo_unitario: texto4(d.custo), status: d.status } : null;
    if (JSON.stringify(ra) !== JSON.stringify(rd)) camadas.push({ lote_id: id, local_estoque_id: (d ?? a).local, antes: ra, depois: rd, nova: Boolean(d?.virtual) });
  }
  return { permitido: true, recusa: null, movimentos, depositos, camadas, afetados: [...sim.afetados].sort() };
};
