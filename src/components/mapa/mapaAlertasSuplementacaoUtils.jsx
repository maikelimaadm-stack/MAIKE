/**
 * Alertas de suplementação do Mapa Geral.
 *
 * D-PROD-178: os alertas de PONTO (cocho e depósito) vêm do SSOT
 * `src/domain/suplementacao/nivelSuplementacao.js` — o mesmo dia civil
 * (`hoje`), a mesma taxa (`consumo_esperado_pv_kg` do lançamento) e o mesmo
 * saldo (depósito sem Produto em L, P-11) do marcador e dos detalhes. Sem
 * estimativa não há "Cocho sem produto".
 *
 * Os alertas de LOTE (`suplementacao_pendente`) ficam como estavam — fora do
 * escopo da D-PROD-178 — e DIVERGEM conscientemente do SSOT em dois pontos:
 *  - sem `consumo_esperado_pv_kg` no evento, usam como taxa o MAIOR %PV entre
 *    todos os produtos da empresa aplicado às cabeças da área;
 *  - contam dias em blocos de 24 h a partir da meia-noite UTC da data, e não
 *    em dias civis no fuso da fazenda.
 */
import { consumoEsperadoGrupoDia } from "../suplementacao/consumoPVUtils";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { calcularNivelCocho, calcularNivelDeposito } from "@/domain/suplementacao/nivelSuplementacao";
import { hojeNoFuso } from "@/lib/diaCivil";

const DIA_MS = 86400000;

const parseDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const diffDays = (from, to = new Date()) => {
  const start = parseDate(from);
  if (!start) return Infinity;
  return Math.max(0, Math.floor((to.getTime() - start.getTime()) / DIA_MS));
};

const getAreaIdsFromPonto = (ponto) => {
  if (Array.isArray(ponto.area_vinculada_ids) && ponto.area_vinculada_ids.length) return ponto.area_vinculada_ids;
  if (ponto.area_vinculada_id) return [ponto.area_vinculada_id];
  if (ponto.area_id) return [ponto.area_id];
  return [];
};

const buildAreaConsumoMap = (lotes = [], produtos = []) => {
  const produtosMap = new Map(produtos.map((produto) => [produto.id, produto]));
  const areaMap = new Map();

  lotes.forEach((lote) => {
    if (!lote.area_atual_id || lote.status !== "Ativo") return;
    const current = areaMap.get(lote.area_atual_id) || {
      areaId: lote.area_atual_id,
      cabecas: 0,
      pesoTotal: 0,
      lotes: [],
      consumoDiarioEstimadoKg: 0,
    };

    const cabecas = Number(lote.quantidade_cabecas || 0);
    const peso = Number(lote.peso_medio_kg || 0);
    current.cabecas += cabecas;
    current.pesoTotal += peso * cabecas;
    current.lotes.push(lote);
    areaMap.set(lote.area_atual_id, current);
  });

  areaMap.forEach((item) => {
    const pesoMedio = item.cabecas > 0 ? item.pesoTotal / item.cabecas : 0;
    let maiorConsumo = 0;

    produtosMap.forEach((produto) => {
      const percentual = Number(produto.percentual_consumo_pv || 0);
      if (percentual <= 0) return;
      const consumo = consumoEsperadoGrupoDia(pesoMedio, percentual, item.cabecas);
      if (consumo > maiorConsumo) maiorConsumo = consumo;
    });

    item.pesoMedio = pesoMedio;
    item.consumoDiarioEstimadoKg = maiorConsumo;
  });

  return areaMap;
};

const buildEventoCobertura = (evento, fallbackConsumoDiario) => {
  const quantidade = Number(evento.quantidade_total_kg || 0);
  const sobra = Number(evento.sobra_kg || 0);
  const consumo = Number(evento.consumo_esperado_pv_kg || fallbackConsumoDiario || 0);
  const total = quantidade + sobra;
  const diasCobertura = consumo > 0 ? total / consumo : 0;
  const diasPassados = diffDays(evento.data_lancamento);
  const diasRestantes = Math.max(0, diasCobertura - diasPassados);

  return {
    quantidade,
    sobra,
    consumo,
    total,
    diasCobertura,
    diasPassados,
    diasRestantes,
  };
};

/** Dias com até 1 casa, em pt-BR ("2", "0,8"). @param {number} dias */
const formatarDias = (dias) => dias.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/**
 * @param {{ lotes?: any[], pontosSuplementacao?: any[], eventosSupl?: any[], estoqueLotes?: any[], produtos?: any[], hoje?: string }} entrada
 *   `hoje`: dia civil AAAA-MM-DD no fuso da fazenda (padrão: `hojeNoFuso(null)`,
 *   o relógio do navegador). Os alertas de ponto usam este dia.
 * @returns {{ alertasLote: Map<any, any[]>, alertasPonto: Map<any, any> }}
 */
export function buildMapaAlertasSuplementacao({
  lotes = [],
  pontosSuplementacao = [],
  eventosSupl = [],
  estoqueLotes = [],
  produtos = [],
  hoje = hojeNoFuso(null),
}) {
  const areaConsumoMap = buildAreaConsumoMap(lotes, produtos);
  const cochos = pontosSuplementacao.filter((ponto) => normalizeText(ponto.categoria_ponto || "COCHO") !== "DEPOSITO");
  const depositos = pontosSuplementacao.filter((ponto) => normalizeText(ponto.categoria_ponto || "") === "DEPOSITO");

  const alertasLote = new Map();
  const alertasPonto = new Map();

  areaConsumoMap.forEach((areaInfo, areaId) => {
    const cochosDaArea = cochos.filter((ponto) => getAreaIdsFromPonto(ponto).includes(areaId));
    const eventosDaArea = eventosSupl
      .filter((evento) => cochosDaArea.some((ponto) => ponto.id === evento.ponto_suplementacao_id))
      .sort((a, b) => new Date(b.data_lancamento).getTime() - new Date(a.data_lancamento).getTime());

    const ultimoEvento = eventosDaArea[0] || null;
    const cobertura = ultimoEvento ? buildEventoCobertura(ultimoEvento, areaInfo.consumoDiarioEstimadoKg) : null;
    const semCocho = cochosDaArea.length === 0;
    const semHistorico = !ultimoEvento;
    const semCobertura = cobertura ? cobertura.diasRestantes <= 0 : true;
    const semLancamentoRecente = ultimoEvento ? diffDays(ultimoEvento.data_lancamento) >= 2 : true;
    const precisaSuplementacao = semCocho || semHistorico || (semCobertura && semLancamentoRecente);

    areaInfo.lotes.forEach((lote) => {
      const alertas = [];
      if (precisaSuplementacao) {
        alertas.push({
          tipo: "suplementacao_pendente",
          severidade: semCocho || semHistorico ? "critico" : "alerta",
          titulo: semCocho ? "Área sem cocho vinculado" : semHistorico ? "Sem histórico de suplementação" : "Reposição de suplementação pendente",
          descricao: semCocho
            ? "O lote está em uma área sem cocho cadastrado."
            : semHistorico
              ? "O lote precisa de suplementação e ainda não possui lançamento registrado."
              : `A cobertura estimada acabou há ${Math.max(0, diffDays(ultimoEvento?.data_lancamento) - Math.floor(cobertura?.diasCobertura || 0))} dia(s).`,
          diasSemLancamento: ultimoEvento ? diffDays(ultimoEvento.data_lancamento) : null,
          diasCoberturaRestante: cobertura?.diasRestantes ?? 0,
        });
      }
      alertasLote.set(lote.id, alertas);
    });
  });

  cochos.forEach((cocho) => {
    const nivel = calcularNivelCocho({ ponto: cocho, eventos: eventosSupl, hoje, pontos: pontosSuplementacao });
    const estimada = nivel.confiabilidade === "estimada" && nivel.taxaConsumoKgDia != null;
    const consumoDiario = estimada ? nivel.taxaConsumoKgDia : 0;
    const base = nivel.baseCicloKg ?? 0;
    const cobertura = nivel.evento ? {
      quantidade: nivel.fornecidoKg ?? 0,
      sobra: nivel.sobraAnteriorKg ?? 0,
      consumo: consumoDiario,
      total: base,
      diasCobertura: estimada && consumoDiario > 0 ? base / consumoDiario : null,
      diasPassados: nivel.diasDecorridos,
      diasRestantes: nivel.diasRestantesEstimados,
    } : null;

    alertasPonto.set(cocho.id, { consumoDiario, cobertura, alertas: nivel.alertas, nivel });
  });

  depositos.forEach((deposito) => {
    const nivel = calcularNivelDeposito({ deposito, estoqueLotes, produtos });
    const saldoAtual = nivel.saldoKg;

    // Cobertura: só cochos ligados com taxa ESTIMADA (sem %PV ou com cochos
    // compartilhando os mesmos animais, a taxa não é confiável e fica fora).
    const cochosDoDeposito = cochos.filter((cocho) => cocho.deposito_origem_id === deposito.id);
    const consumoDiario = cochosDoDeposito.reduce((total, cocho) => total + Number(alertasPonto.get(cocho.id)?.consumoDiario || 0), 0);
    const estoqueMinimo = Number(deposito.estoque_minimo_kg || 0);
    const diasCobertura = consumoDiario > 0 ? saldoAtual / consumoDiario : null;
    const alertasNivel = nivel.alertas.filter((alerta) => alerta.tipo !== "deposito_acima_limite");
    const alertasExcesso = nivel.alertas.filter((alerta) => alerta.tipo === "deposito_acima_limite");
    const alertas = [...alertasNivel];

    if (diasCobertura != null && diasCobertura <= 2) {
      alertas.push({ tipo: "deposito_cobertura_baixa", severidade: diasCobertura <= 1 ? "critico" : "alerta", titulo: "Baixa cobertura do depósito", descricao: `Saldo cobre cerca de ${formatarDias(diasCobertura)} dia(s).` });
    }

    alertasPonto.set(deposito.id, { saldoAtual, estoqueMinimo, consumoDiario, diasCobertura, alertas: [...alertas, ...alertasExcesso], isDeposito: true, nivel });
  });

  return { alertasLote, alertasPonto };
}

