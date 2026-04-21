import { consumoEsperadoGrupoDia } from "../suplementacao/consumoPVUtils";
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";

const DIA_MS = 86400000;

const parseDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const diffDays = (from, to = new Date()) => {
  const start = parseDate(from);
  if (!start) return Infinity;
  return Math.max(0, Math.floor((to - start) / DIA_MS));
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

export function buildMapaAlertasSuplementacao({
  lotes = [],
  pontosSuplementacao = [],
  eventosSupl = [],
  estoqueLotes = [],
  produtos = [],
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
      .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));

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
    const areaIds = getAreaIdsFromPonto(cocho);
    const consumoDiario = areaIds.reduce((total, areaId) => total + Number(areaConsumoMap.get(areaId)?.consumoDiarioEstimadoKg || 0), 0);
    const ultimoEvento = eventosSupl
      .filter((evento) => evento.ponto_suplementacao_id === cocho.id)
      .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0] || null;

    const cobertura = ultimoEvento ? buildEventoCobertura(ultimoEvento, consumoDiario) : null;
    const alertas = [];

    if (!ultimoEvento) {
      alertas.push({ tipo: "cocho_sem_lancamento", severidade: "critico", titulo: "Cocho sem lançamento", descricao: "Não há lançamento de suplementação para este cocho." });
    } else if (cobertura.diasRestantes <= 0) {
      alertas.push({ tipo: "cocho_sem_produto", severidade: "critico", titulo: "Cocho sem produto", descricao: "A cobertura estimada do cocho foi esgotada." });
    } else if (cobertura.diasRestantes <= 1) {
      alertas.push({ tipo: "cocho_baixo", severidade: "alerta", titulo: "Reposição próxima", descricao: `Cobertura estimada restante: ${cobertura.diasRestantes.toFixed(1)} dia(s).` });
    }

    alertasPonto.set(cocho.id, { consumoDiario, cobertura, alertas });
  });

  depositos.forEach((deposito) => {
    const saldoAtual = estoqueLotes
      .filter((item) => item.local_estoque_id === deposito.local_estoque_id && Number(item.quantidade_disponivel || 0) > 0)
      .reduce((total, item) => total + Number(item.quantidade_disponivel || 0), 0);

    const cochosDoDeposito = cochos.filter((cocho) => cocho.deposito_origem_id === deposito.id);
    const consumoDiario = cochosDoDeposito.reduce((total, cocho) => total + Number(alertasPonto.get(cocho.id)?.consumoDiario || 0), 0);
    const estoqueMinimo = Number(deposito.estoque_minimo_kg || 0);
    const diasCobertura = consumoDiario > 0 ? saldoAtual / consumoDiario : 0;
    const alertas = [];

    if (saldoAtual <= 0) {
      alertas.push({ tipo: "deposito_sem_estoque", severidade: "critico", titulo: "Depósito sem produto", descricao: "Não há saldo disponível no depósito." });
    } else if (estoqueMinimo > 0 && saldoAtual <= estoqueMinimo) {
      alertas.push({ tipo: "deposito_estoque_minimo", severidade: "alerta", titulo: "Estoque mínimo atingido", descricao: `Saldo ${saldoAtual.toFixed(0)} kg abaixo do mínimo configurado.` });
    }

    if (consumoDiario > 0 && diasCobertura <= 2) {
      alertas.push({ tipo: "deposito_cobertura_baixa", severidade: diasCobertura <= 1 ? "critico" : "alerta", titulo: "Baixa cobertura do depósito", descricao: `Saldo cobre cerca de ${diasCobertura.toFixed(1)} dia(s).` });
    }

    alertasPonto.set(deposito.id, { saldoAtual, estoqueMinimo, consumoDiario, diasCobertura, alertas, isDeposito: true });
  });

  return { alertasLote, alertasPonto };
}