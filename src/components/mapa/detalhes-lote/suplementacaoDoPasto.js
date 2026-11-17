/**
 * Aba Suplementação do Detalhes do Lote v12 (D-PROD-V12 — número definitivo no
 * PR): os cochos do pasto e os números do PRIMEIRO cocho (por nome).
 *
 * Puro: sem React, sem rede, sem storage e sem `new Date()`. Os números saem
 * do domínio da suplementação, sem conta nova:
 *  - nível do cocho (D-PROD-178): o `nivel_suplementacao` que o Mapa Geral já
 *    calculou para o marcador; ponto sem ele → `calcularNivelCocho` com os
 *    mesmos insumos (eventos e pontos da fazenda, dia civil da fazenda);
 *  - período fechado (D-PROD-206/210/212): `resumoDoFechamento` do último
 *    período FECHADO do cocho, escolhido como no detalhe do cocho
 *    (`DetalhesPontoSuplementacao`): maior `data_lancamento`, empate → o último
 *    da lista;
 *  - farol da leitura (D-PROD-205): o `indicador_farol` do ponto decorado.
 * Sem dado → "—" (nada de zero inventado).
 */

import { calcularNivelCocho } from "@/domain/suplementacao/nivelSuplementacao";
import { FAROL_CONSUMO, cabecasQueConsomem, resumoDoFechamento } from "@/domain/suplementacao/fechamentoConsumo";
import { COR_FAROL } from "@/domain/suplementacao/leituraCocho";
import { normalizarTexto } from "@/domain/mapa/pontoCascata";

/** @typedef {import("@/domain/suplementacao/nivelSuplementacao").NivelCocho} NivelCocho */
/** @typedef {ReturnType<typeof resumoDoFechamento>} ResumoFechamento */

/** Valor ausente. */
export const VAZIO = "—";

/** Verde e âmbar das notas do desvio (v12: `#16a34a` / `COR_ATENCAO`). */
export const COR_DENTRO = "#16a34a";
export const COR_FORA = "#b45309";
/** Nota "esperado N g" (v12: `COR_META`). */
export const COR_NOTA = "#64748b";

/** @param {unknown} v @returns {number|null} */
const numero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** @param {unknown} v @returns {number|null} */
const positivo = (v) => {
  const n = numero(v);
  return n !== null && n > 0 ? n : null;
};

/**
 * Número pt-BR com `casas` decimais FIXAS (como o catálogo do Detalhes); sem
 * "-0,0"; sem número → "—".
 * @param {unknown} v
 * @param {number} [casas]
 */
export function numeroBR(v, casas = 2) {
  const n = numero(v);
  if (n === null) return VAZIO;
  let r = Number(n.toFixed(casas));
  if (r === 0) r = 0;
  return r.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Faixa de tolerância em pontos percentuais ("15", "12,5"). @param {number} faixa */
const textoFaixa = (faixa) => faixa.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Áreas do ponto: `area_vinculada_ids` (lista) ou `area_vinculada_id` — a mesma
 * regra do nível e dos filtros do mapa.
 * @param {any} ponto
 * @returns {string[]}
 */
const areasDoPonto = (ponto) => {
  if (Array.isArray(ponto?.area_vinculada_ids) && ponto.area_vinculada_ids.length) return ponto.area_vinculada_ids.filter(Boolean).map(String);
  return ponto?.area_vinculada_id ? [String(ponto.area_vinculada_id)] : [];
};

/**
 * O ponto é um cocho que atende a área? (categoria vazia conta como COCHO, como no SSOT).
 * @param {any} ponto
 * @param {unknown} areaId
 */
export function cochoDaArea(ponto, areaId) {
  if (!ponto || areaId === null || areaId === undefined || areaId === "") return false;
  if (normalizarTexto(ponto.categoria_ponto || "COCHO") !== "COCHO") return false;
  return areasDoPonto(ponto).includes(String(areaId));
}

/** @param {any} ponto */
const nomeDoPonto = (ponto) => String(ponto?.nome_ponto ?? "").trim();

/**
 * Ordem por nome em pt-BR ("Cocho 2" antes de "Cocho 10"; acento não pesa);
 * empate → id.
 * @param {any} a
 * @param {any} b
 */
const porNome = (a, b) =>
  nomeDoPonto(a).localeCompare(nomeDoPonto(b), "pt-BR", { numeric: true, sensitivity: "base" }) ||
  String(a?.id ?? "").localeCompare(String(b?.id ?? ""));

/**
 * @typedef {{
 *   ponto: any,
 *   id: string,
 *   nome: string,
 *   nivel: NivelCocho,
 *   produto: string,
 *   meta: string,
 *   fracaoIcone: number,
 *   farol: null | { hex: string, texto: string },
 * }} CochoDoPasto
 */

/**
 * Produto do cocho: o do último lançamento; sem lançamento, o produto padrão
 * do cadastro do ponto.
 * @param {any} ponto
 * @param {NivelCocho} nivel
 */
const produtoDoCocho = (ponto, nivel) => {
  const doLancamento = String(nivel?.produto ?? "").trim();
  if (doLancamento) return doLancamento;
  const padrao = String(ponto?.produto_padrao ?? "").trim();
  return padrao || VAZIO;
};

/**
 * Linha de baixo do item: "65% · restam 260 kg" com estimativa; senão o rótulo
 * curto do SSOT ("Sem lançamento", "Sem estimativa", "Período fechado"…).
 * @param {NivelCocho} nivel
 */
export function metaDoCocho(nivel) {
  if (!nivel) return "Sem lançamento";
  if (!nivel.neutro && nivel.saldoKg !== null && nivel.saldoKg !== undefined) {
    return `${nivel.rotuloCurto} · restam ${numeroBR(nivel.saldoKg, 0)} kg`;
  }
  return nivel.rotuloCurto || "Sem lançamento";
}

/**
 * Cochos da área, por nome, cada um com o nível, o produto, a linha do item, a
 * fração do ícone (a mesma do marcador) e o farol da leitura.
 * @param {{ pontos?: any[] | null, eventos?: any[] | null, hoje?: string | null, areaId: unknown }} p
 * @returns {CochoDoPasto[]}
 */
export function cochosDoPasto({ pontos, eventos, hoje = null, areaId }) {
  const todos = Array.isArray(pontos) ? pontos : [];
  const evs = Array.isArray(eventos) ? eventos : [];
  return todos
    .filter((ponto) => cochoDaArea(ponto, areaId))
    .sort(porNome)
    .map((ponto) => {
      /** @type {NivelCocho} */
      const nivel = ponto.nivel_suplementacao && ponto.nivel_suplementacao.tipo === "COCHO"
        ? ponto.nivel_suplementacao
        : calcularNivelCocho({ ponto, eventos: evs, hoje, pontos: todos });
      const f = ponto.indicador_farol;
      const farol = f && typeof f.hex === "string" && f.hex
        ? { hex: f.hex, texto: typeof f.texto === "string" && f.texto ? f.texto : String(f.rotulo ?? "") }
        : null;
      return {
        ponto,
        id: String(ponto.id ?? ""),
        nome: nomeDoPonto(ponto) || VAZIO,
        nivel,
        produto: produtoDoCocho(ponto, nivel),
        meta: metaDoCocho(nivel),
        fracaoIcone: Number.isFinite(Number(nivel?.fracaoParaSvg)) ? Number(nivel.fracaoParaSvg) : 0,
        farol,
      };
    });
}

/**
 * O período FECHADO mais recente do cocho (`dias_periodo` > 0), como no
 * detalhe do cocho: maior `data_lancamento`; empate → o último da lista.
 * @param {any[] | null | undefined} eventos
 * @param {unknown} pontoId
 * @returns {any | null}
 */
export function ultimoPeriodoFechado(eventos, pontoId) {
  const lista = Array.isArray(eventos) ? eventos : [];
  /** @type {any} */
  let maisNovo = null;
  for (const evento of lista) {
    if (!evento || String(evento.ponto_suplementacao_id) !== String(pontoId)) continue;
    if (!(Number(evento.dias_periodo) > 0)) continue;
    if (!maisNovo || String(evento.data_lancamento ?? "") >= String(maisNovo.data_lancamento ?? "")) maisNovo = evento;
  }
  return maisNovo;
}

/**
 * Consumo ESPERADO por cabeça (g/cab/dia), a mesma meta do farol do fechamento:
 *  - base g/cab/dia (D-PROD-210): a meta gravada no fechamento;
 *  - base %PV: o esperado do fechamento (peso médio do período, D-PROD-212; evento
 *    antigo: o do lançamento) ÷ cabeças que consomem × 1000.
 * Sem fechamento ou sem esperado nele: o consumo ideal por cabeça do cadastro do
 * cocho. Nada → null.
 * @param {{ resumo: ResumoFechamento | null, fechado: any | null, ponto: any }} p
 * @returns {number | null}
 */
export function esperadoGramasCabDia({ resumo, fechado, ponto }) {
  if (resumo) {
    if (resumo.base_consumo_aplicada === "G_CAB_DIA") {
      const meta = positivo(resumo.consumo_esperado_g_cab_dia);
      if (meta !== null) return meta;
    } else {
      const kgDia = positivo(resumo.consumo_esperado_fechamento_kg_dia) ?? positivo(fechado?.consumo_esperado_pv_kg);
      const cab = cabecasQueConsomem(fechado);
      if (kgDia !== null && cab > 0) return (kgDia / cab) * 1000;
    }
  }
  const ideal = positivo(ponto?.consumo_ideal_por_cabeca_kg);
  return ideal !== null ? ideal * 1000 : null;
}

/**
 * @typedef {{ chave: string, rotulo: string, valor: string, nota?: string, corNota?: string }} KpiSupl
 * @typedef {{ chave: string, rotulo: string, valor: string, sub?: string, bolinha?: string }} CelulaSupl
 * @typedef {{
 *   cocho: CochoDoPasto,
 *   fechado: any | null,
 *   resumo: ResumoFechamento | null,
 *   kpis: KpiSupl[],
 *   fornecimento: CelulaSupl[],
 *   consumo: CelulaSupl[],
 * }} NumerosDoCocho
 */

/**
 * Números do cocho para a aba (KPIs, Fornecimento e Consumo esperado / real).
 *
 * KPIs (último período fechado): "Por cabeça (g/cab/dia)" = g/cab/dia real,
 * nota "esperado N g"; "Desvio da meta (%)" = (real ÷ esperado − 1) × 100, nota
 * "dentro de ±N%" (verde) ou "fora de ±N%" (âmbar) pelo farol do fechamento e
 * a faixa REAL aplicada (`faixa_tolerancia_aplicada`, padrão 15%). Cocho
 * compartilhado ou sem esperado ("sem referência") → "—".
 *
 * Fornecimento (ciclo atual, do nível): Produto · Total fornecido (base do
 * ciclo: fornecido + sobra anterior) · Total consumido (estimado) · Sobra (resta)
 * (estimada no ciclo aberto, informada no período fechado).
 *
 * Consumo esperado / real: Consumo do pasto (taxa do ciclo, kg/dia) ·
 * Esperado/cab/dia · Realizado/cab/dia (do fechamento) · %PV real × esperado
 * com a bolinha do farol do fechamento.
 * @param {CochoDoPasto} cocho
 * @param {{ eventos?: any[] | null }} [p]
 * @returns {NumerosDoCocho}
 */
export function numerosDoCocho(cocho, { eventos } = {}) {
  const { ponto, nivel } = cocho;
  const fechado = ultimoPeriodoFechado(eventos, ponto?.id);
  const resumo = fechado ? resumoDoFechamento(fechado) : null;
  const farol = resumo?.farol_consumo ?? null;
  const comReferencia = Boolean(farol) && farol !== "sem_referencia";

  const gReal = numero(resumo?.consumo_g_cab_dia);
  const gEsperado = esperadoGramasCabDia({ resumo, fechado, ponto });
  const relacao = comReferencia ? numero(resumo?.consumo_relacao_esperado) : null;
  const desvio = relacao !== null ? (relacao - 1) * 100 : null;
  const faixa = resumo ? resumo.faixa_tolerancia_aplicada : null;

  /** @type {KpiSupl[]} */
  const kpis = [
    {
      chave: "porCabeca",
      rotulo: "Por cabeça (g/cab/dia)",
      valor: numeroBR(gReal, 0),
      ...(gEsperado !== null ? { nota: `esperado ${numeroBR(gEsperado, 0)} g`, corNota: COR_NOTA } : {}),
    },
    {
      chave: "desvio",
      rotulo: "Desvio da meta (%)",
      valor: numeroBR(desvio, 1),
      ...(desvio !== null && typeof faixa === "number"
        ? farol === "dentro"
          ? { nota: `dentro de ±${textoFaixa(faixa)}%`, corNota: COR_DENTRO }
          : { nota: `fora de ±${textoFaixa(faixa)}%`, corNota: COR_FORA }
        : {}),
    },
  ];

  const sobraAnterior = positivo(nivel?.sobraAnteriorKg);
  /** @type {CelulaSupl[]} */
  const fornecimento = [
    { chave: "produto", rotulo: "Produto", valor: cocho.produto },
    {
      chave: "fornecido",
      rotulo: "Total fornecido (kg)",
      valor: numeroBR(nivel?.baseCicloKg, 2),
      ...(sobraAnterior !== null && nivel?.baseCicloKg !== null && nivel?.baseCicloKg !== undefined
        ? { sub: `inclui ${numeroBR(sobraAnterior, 2)} kg de sobra anterior` }
        : {}),
    },
    { chave: "consumido", rotulo: "Total consumido (kg)", valor: numeroBR(nivel?.consumoEstimadoKg, 2) },
    { chave: "sobra", rotulo: "Sobra (resta) (kg)", valor: numeroBR(nivel?.saldoKg, 2) },
  ];

  const pvReal = numero(resumo?.consumo_real_pv_percentual);
  const pvEsperado = numero(resumo?.consumo_esperado_pv_percentual);
  const corFarol = comReferencia && pvReal !== null && pvEsperado !== null ? corDoFarolConsumo(farol) : null;
  /** @type {CelulaSupl[]} */
  const consumo = [
    { chave: "consumoPasto", rotulo: "Consumo do pasto (kg/dia)", valor: numeroBR(nivel?.taxaConsumoKgDia, 2) },
    { chave: "esperadoCab", rotulo: "Esperado/cab/dia (kg)", valor: numeroBR(gEsperado === null ? null : gEsperado / 1000, 3) },
    { chave: "realizadoCab", rotulo: "Realizado/cab/dia (kg)", valor: numeroBR(gReal === null ? null : gReal / 1000, 3) },
    {
      chave: "pv",
      rotulo: "%PV real × esperado",
      valor: pvReal === null ? VAZIO : `${numeroBR(pvReal, 3)}% × ${pvEsperado === null ? VAZIO : `${numeroBR(pvEsperado, 3)}%`}`,
      ...(corFarol ? { bolinha: corFarol } : {}),
    },
  ];

  return { cocho, fechado, resumo, kpis, fornecimento, consumo };
}

/**
 * Cor da bolinha pelo farol do fechamento (verde/vermelho/azul); sem referência → null.
 * @param {string | null} farol
 * @returns {string | null}
 */
export function corDoFarolConsumo(farol) {
  const info = farol && Object.prototype.hasOwnProperty.call(FAROL_CONSUMO, farol) ? FAROL_CONSUMO[/** @type {keyof typeof FAROL_CONSUMO} */ (farol)] : null;
  if (!info || info.cor === "neutro") return null;
  return COR_FAROL[/** @type {keyof typeof COR_FAROL} */ (info.cor)] ?? null;
}

/**
 * @typedef {{
 *   cochos: CochoDoPasto[],
 *   primeiro: NumerosDoCocho | null,
 *   titulos: { fornecimento: string, consumo: string },
 * }} SuplementacaoDoPasto
 */

/**
 * Tudo o que a aba mostra. Com 2+ cochos os títulos levam o nome do cocho dos
 * números ("Fornecimento · Cocho 07").
 * @param {{ suplementacao: null | undefined | { pontos?: any[] | null, eventos?: any[] | null, hoje?: unknown }, areaId: unknown }} p
 * @returns {SuplementacaoDoPasto}
 */
export function suplementacaoDoPasto({ suplementacao, areaId }) {
  const eventos = Array.isArray(suplementacao?.eventos) ? suplementacao.eventos : [];
  const hoje = typeof suplementacao?.hoje === "string" ? suplementacao.hoje : null;
  const cochos = cochosDoPasto({ pontos: suplementacao?.pontos, eventos, hoje, areaId });
  const primeiro = cochos.length ? numerosDoCocho(cochos[0], { eventos }) : null;
  const sufixo = cochos.length > 1 ? ` · ${cochos[0].nome}` : "";
  return {
    cochos,
    primeiro,
    titulos: { fornecimento: `Fornecimento${sufixo}`, consumo: `Consumo esperado / real${sufixo}` },
  };
}
