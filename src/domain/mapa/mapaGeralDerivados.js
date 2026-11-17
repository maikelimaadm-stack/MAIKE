/**
 * Dados derivados do Mapa Geral que não dependem de React nem do mapa:
 * filtros por área (setor, tipo de uso, tipo de pastagem), ocupação da área,
 * situação do pasto e o bebedouro do ponto de referência clicado.
 *
 * Puro: sem React, sem provider, sem `window`, sem storage.
 */
import { filtroInclui, filtroSemRestricao } from '@/lib/mapaFiltroSelecao';

const TRANSFERENCIA = 'Transferência de Área';
const UMA_UA_KG = 450;
const DIA_MS = 86400000;

/** @param {unknown} valor */
const normalizar = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();

/** @param {any} ponto */
const ehDeposito = (ponto) => normalizar(ponto?.categoria_ponto) === 'DEPOSITO';

/** @param {any} ponto @returns {string[]} */
const areasDoPonto = (ponto) => {
  if (Array.isArray(ponto?.area_vinculada_ids) && ponto.area_vinculada_ids.length) return ponto.area_vinculada_ids;
  return ponto?.area_vinculada_id ? [ponto.area_vinculada_id] : [];
};

/**
 * Algum filtro que esconde áreas está ligado? Setor, tipo de uso (cultura) ou
 * tipo de pastagem. O que fica numa área escondida some junto com ela.
 *
 * @param {{ filtroSetor?: any, filtroTipoCultura?: any, filtroTipoPastagem?: any }} filtros
 */
export const filtroDeAreaAtivo = ({ filtroSetor, filtroTipoCultura, filtroTipoPastagem }) =>
  !filtroSemRestricao(filtroSetor) || !filtroSemRestricao(filtroTipoCultura) || !filtroSemRestricao(filtroTipoPastagem);

/**
 * Lotes (posições) cuja área continua visível.
 *
 * @param {any[]} lotes
 * @param {{ filtroAreaAtivo: boolean, areaIdsFiltrados: Set<string> }} contexto
 */
export const filtrarLotesPorArea = (lotes, { filtroAreaAtivo, areaIdsFiltrados }) => {
  if (!filtroAreaAtivo) return lotes;
  return lotes.filter((lote) => areaIdsFiltrados.has(lote?.area_atual_id));
};

/**
 * Cochos e depósitos depois dos filtros de área.
 *
 * - Cocho com área vinculada: aparece se alguma das suas áreas estiver visível.
 * - Cocho sem área: com filtro de setor, vale o `setor_id` dele; sem filtro de
 *   setor (só tipo de uso/pastagem) continua visível (não está numa área escondida).
 * - Depósito não tem área (o formulário grava `setor_id` e área vazia): com
 *   filtro de setor vale o `setor_id`; depósito antigo sem setor aparece se
 *   abastece (`deposito_origem_id`) algum cocho visível. Sem filtro de setor ele
 *   continua visível.
 *
 * @param {any[]} pontos
 * @param {{ filtroSetor: any, filtroAreaAtivo: boolean, areaIdsFiltrados: Set<string> }} contexto
 */
export const filtrarPontosSuplementacaoPorArea = (pontos, { filtroSetor, filtroAreaAtivo, areaIdsFiltrados }) => {
  if (!filtroAreaAtivo) return pontos;
  const setorAtivo = !filtroSemRestricao(filtroSetor);

  const cochoVisivel = (ponto) => {
    const ids = areasDoPonto(ponto);
    if (ids.length) return ids.some((id) => areaIdsFiltrados.has(id));
    return setorAtivo ? filtroInclui(filtroSetor, ponto?.setor_id) : true;
  };
  const cochosVisiveis = new Set(pontos.filter((p) => !ehDeposito(p) && cochoVisivel(p)).map((p) => p.id));
  const depositosDosCochosVisiveis = new Set(
    pontos.filter((p) => cochosVisiveis.has(p.id) && p.deposito_origem_id).map((p) => p.deposito_origem_id),
  );

  const depositoVisivel = (ponto) => {
    if (!setorAtivo) return true;
    if (ponto?.setor_id) return filtroInclui(filtroSetor, ponto.setor_id);
    const ids = areasDoPonto(ponto);
    if (ids.length) return ids.some((id) => areaIdsFiltrados.has(id));
    return depositosDosCochosVisiveis.has(ponto?.id);
  };

  return pontos.filter((p) => (ehDeposito(p) ? depositoVisivel(p) : cochosVisiveis.has(p.id)));
};

/**
 * Tarefas do mapa depois dos filtros de área.
 *
 * Tarefa com área: some se a área estiver escondida. Só com o filtro de setor
 * (sem tipo de uso/pastagem) o nome do setor também vale, como antes.
 * Tarefa sem área: com filtro de setor, vale o nome do setor; sem ele, continua.
 *
 * @param {any[]} tarefas
 * @param {{ filtroSetor: any, filtroTipoCultura?: any, filtroTipoPastagem?: any, areaIdsFiltrados: Set<string>, nomesSetores: Set<string> }} contexto
 */
export const filtrarTarefasPorArea = (tarefas, { filtroSetor, filtroTipoCultura, filtroTipoPastagem, areaIdsFiltrados, nomesSetores }) => {
  if (!filtroDeAreaAtivo({ filtroSetor, filtroTipoCultura, filtroTipoPastagem })) return tarefas;
  const setorAtivo = !filtroSemRestricao(filtroSetor);
  const tipoAtivo = !filtroSemRestricao(filtroTipoCultura) || !filtroSemRestricao(filtroTipoPastagem);
  return tarefas.filter((tarefa) => {
    if (tarefa?.area_id) {
      if (areaIdsFiltrados.has(tarefa.area_id)) return true;
      return setorAtivo && !tipoAtivo && nomesSetores.has(tarefa.setor_nome);
    }
    return setorAtivo ? nomesSetores.has(tarefa?.setor_nome) : true;
  });
};

// ─── Ocupação ───────────────────────────────────────────────────────────

export const STATUS_OCUPACAO = Object.freeze(['Disponível', 'Médio', 'Alto', 'Sobrepastoreado']);

/**
 * Ocupação da área a partir dos lotes (posições) que o próprio mapa mostra
 * nela, e não do `status_ocupacao` gravado na área (que ficava "Disponível"
 * com lote ativo dentro).
 *
 * - Sem cabeças: "Disponível".
 * - Com cabeças, capacidade (UA, `capacidade_maxima`) e peso: UA atual /
 *   capacidade, nas mesmas faixas dos Insights do Mapa (até 70% "Médio", até
 *   110% "Alto", acima "Sobrepastoreado").
 * - Com cabeças sem como medir: o status do servidor quando ele já diz que está
 *   ocupada; senão "Médio".
 *
 * @param {any} area
 * @param {any[]} lotesDaArea
 * @returns {'Disponível'|'Médio'|'Alto'|'Sobrepastoreado'}
 */
export const statusOcupacaoDaArea = (area, lotesDaArea) => {
  let cabecas = 0;
  let ua = 0;
  for (const lote of lotesDaArea || []) {
    const cab = Number(lote?.quantidade_cabecas) || 0;
    if (cab <= 0) continue;
    cabecas += cab;
    const peso = Number(lote?.peso_medio_kg) || 0;
    if (peso > 0) ua += (peso * cab) / UMA_UA_KG;
  }
  if (cabecas <= 0) return 'Disponível';
  const capacidade = Number(area?.capacidade_maxima) || 0;
  if (capacidade > 0 && ua > 0) {
    const pct = (ua / capacidade) * 100;
    if (pct <= 70) return 'Médio';
    if (pct <= 110) return 'Alto';
    return 'Sobrepastoreado';
  }
  const doServidor = area?.status_ocupacao;
  if (doServidor && doServidor !== 'Disponível' && STATUS_OCUPACAO.includes(doServidor)) return doServidor;
  return 'Médio';
};

/**
 * @param {any[]} areas
 * @param {any[]} lotes lotes/posições ativos do mapa (com `area_atual_id`)
 * @returns {Record<string, string>}
 */
export const statusOcupacaoPorArea = (areas, lotes) => {
  /** @type {Map<string, any[]>} */
  const porArea = new Map();
  for (const lote of lotes || []) {
    if (!lote?.area_atual_id) continue;
    if (!porArea.has(lote.area_atual_id)) porArea.set(lote.area_atual_id, []);
    porArea.get(lote.area_atual_id).push(lote);
  }
  /** @type {Record<string, string>} */
  const m = {};
  for (const area of areas || []) m[area.id] = statusOcupacaoDaArea(area, porArea.get(area.id) || []);
  return m;
};

// ─── Situação do pasto ──────────────────────────────────────────────────

/**
 * Data operacional. "AAAA-MM-DD" é o dia civil (meia-noite local, não UTC).
 *
 * @param {unknown} valor
 * @returns {Date|null}
 */
const lerData = (valor) => {
  if (!valor) return null;
  const s = String(valor);
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = dia ? new Date(Number(dia[1]), Number(dia[2]) - 1, Number(dia[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Dias civis inteiros entre `de` e `ate` (nunca negativo). */
const diasEntre = (de, ate) => {
  const a = new Date(de.getFullYear(), de.getMonth(), de.getDate());
  const b = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate());
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / DIA_MS));
};

/**
 * A transferência trouxe ESTE lote/posição? No ledger a posição de destino vem
 * em `linhas[].destino_posicao_id` e em `lote_ids`; no modelo antigo o lote vem
 * em `lote_id`/`lote_ids`/`lote_destino_id`. Só o id do próprio item conta
 * (`lote_entrada_id` é compartilhado por grupos diferentes).
 *
 * @param {any} mv
 * @param {any} lote
 */
const transferenciaTrouxe = (mv, lote) => {
  const id = lote?.id;
  if (!id) return false;
  if (Array.isArray(mv?.linhas) && mv.linhas.some((l) => l?.destino_posicao_id === id)) return true;
  if (Array.isArray(mv?.lote_ids) && mv.lote_ids.includes(id)) return true;
  return mv?.lote_id === id || mv?.lote_destino_id === id;
};

/** @param {any} mv @param {string} areaId */
const transferenciaSaiuDe = (mv, areaId) =>
  mv?.area_origem_id === areaId || (Array.isArray(mv?.linhas) && mv.linhas.some((l) => l?.area_origem_id === areaId));

/** Quantidade de cabeças de uma linha da transferência; `null` se não veio. */
const quantidadeDaLinha = (linha) => {
  const q = Number(linha?.quantidade);
  return Number.isFinite(q) && q > 0 ? q : null;
};

/**
 * Desde quando ESTE lote/posição ocupa a área SEM INTERRUPÇÃO.
 *
 * No ledger a posição é por (área, identidade) e é REAPROVEITADA: o grupo que
 * sai em parte e volta para o mesmo pasto entra na mesma posição. Contar da
 * transferência mais recente zerava os dias de um pasto ocupado sem parar. Por
 * isso o saldo da posição é refeito de trás para a frente a partir da
 * quantidade atual, pelas linhas das transferências (`destino_posicao_id` soma,
 * `origem_posicao_id` subtrai, por dia operacional): a ocupação começou na
 * chegada em que o saldo de antes era zero. Sem saldo zero no histórico, vale a
 * `data_entrada` (entrou direto nesta área).
 *
 * Sem quantidade para conferir (modelo antigo, linha sem `quantidade`, lote sem
 * `quantidade_cabecas`), não há como provar que o pasto seguiu ocupado: vale a
 * chegada mais recente, como antes.
 *
 * @param {any} lote
 * @param {string} areaId
 * @param {any[]} transferencias
 * @returns {Date|null}
 */
const inicioDaOcupacao = (lote, areaId, transferencias) => {
  const id = lote?.id;
  /** @type {Map<number, { data: Date, delta: number, chegou: boolean, incerto: boolean }>} */
  const porDia = new Map();
  const doDia = (/** @type {Date} */ d) => {
    const k = d.getTime();
    if (!porDia.has(k)) porDia.set(k, { data: d, delta: 0, chegou: false, incerto: false });
    return /** @type {{ data: Date, delta: number, chegou: boolean, incerto: boolean }} */ (porDia.get(k));
  };
  for (const mv of transferencias) {
    const d = lerData(mv.data_movimentacao);
    if (!d) continue;
    const linhas = Array.isArray(mv.linhas) ? mv.linhas : [];
    if (mv.area_destino_id === areaId && transferenciaTrouxe(mv, lote)) {
      const r = doDia(d);
      r.chegou = true;
      const entradas = linhas.filter((l) => l?.destino_posicao_id === id);
      const qs = entradas.map(quantidadeDaLinha);
      if (!entradas.length || qs.some((q) => q === null)) r.incerto = true;
      else r.delta += qs.reduce((a, b) => a + (b ?? 0), 0);
    }
    if (!id) continue;
    for (const l of linhas) {
      if (l?.origem_posicao_id !== id) continue;
      const r = doDia(d);
      const q = quantidadeDaLinha(l);
      if (q === null) r.incerto = true;
      else r.delta -= q;
    }
  }

  const atual = Number(lote?.quantidade_cabecas);
  /** @type {number|null} */
  let saldo = Number.isFinite(atual) && atual > 0 ? atual : null;
  /** @type {Date|null} */
  let primeiraChegada = null;
  const dias = [...porDia.values()].sort((a, b) => b.data.getTime() - a.data.getTime());
  for (const r of dias) {
    if (r.chegou) primeiraChegada = r.data;
    if (saldo === null || r.incerto) {
      if (r.chegou) return r.data;
      saldo = null;
      continue;
    }
    const antes = saldo - r.delta;
    if (r.chegou && antes <= 0) return r.data;
    saldo = antes;
  }
  return lerData(lote?.data_entrada) ?? primeiraChegada;
};

/**
 * Situação de cada área para a coloração "Situação do pasto".
 *
 * - Ocupada: dias desde que o lote/posição chegou NAQUELE pasto e ficou nele
 *   sem interrupção (`inicioDaOcupacao`); sem transferência para a área,
 *   `data_entrada` (entrou direto nela). Com vários lotes, vale a chegada mais
 *   antiga entre os presentes.
 * - Vazia com saída registrada: descanso desde a saída MAIS RECENTE por data
 *   (não pela ordem da lista, que vem por data de criação).
 * - Vazia sem histórico: "vazia".
 *
 * @param {{ areas: any[], lotes: any[], movimentacoes: any[], agora?: Date }} entrada
 * @returns {Record<string, { tipo: 'ocupado'|'descanso'|'vazia', dias: number|null }>}
 */
export const calcularSituacaoPasto = ({ areas, lotes, movimentacoes, agora = new Date() }) => {
  const transferencias = (movimentacoes || []).filter((mv) => mv?.tipo === TRANSFERENCIA);

  /** @param {any} lote @param {string} areaId */
  const chegadaNaArea = (lote, areaId) => inicioDaOcupacao(lote, areaId, transferencias);

  /** @type {Record<string, { tipo: 'ocupado'|'descanso'|'vazia', dias: number|null }>} */
  const m = {};
  for (const area of areas || []) {
    const lotesNaArea = (lotes || []).filter((l) => l?.area_atual_id === area.id);
    if (lotesNaArea.length > 0) {
      const chegadas = lotesNaArea.map((l) => chegadaNaArea(l, area.id) ?? agora);
      const maisAntiga = chegadas.reduce((a, b) => (b < a ? b : a));
      m[area.id] = { tipo: 'ocupado', dias: diasEntre(maisAntiga, agora) };
      continue;
    }
    /** @type {Date|null} */
    let ultimaSaida = null;
    for (const mv of transferencias) {
      if (!transferenciaSaiuDe(mv, area.id)) continue;
      const d = lerData(mv.data_movimentacao);
      if (d && (!ultimaSaida || d > ultimaSaida)) ultimaSaida = d;
    }
    m[area.id] = ultimaSaida ? { tipo: 'descanso', dias: diasEntre(ultimaSaida, agora) } : { tipo: 'vazia', dias: null };
  }
  return m;
};

// ─── Bebedouro do ponto de referência ───────────────────────────────────

/**
 * Bebedouro ligado ao ponto de referência clicado: SOMENTE por
 * `ponto_referencia_id`. Nome, sigla, número e coordenada não ligam — "BEB
 * PASTO 12" contém "2" e abria (e recebia o lançamento) no lugar do bebedouro
 * do ponto "2".
 *
 * @param {any} ponto
 * @param {any[]} bebedouros
 * @returns {any|null}
 */
export const bebedouroDoPonto = (ponto, bebedouros) => {
  if (!ponto?.id) return null;
  const ligados = (Array.isArray(bebedouros) ? bebedouros : []).filter((b) => b?.ponto_referencia_id === ponto.id);
  return ligados.find((b) => b?.ativo !== false) || ligados[0] || null;
};
