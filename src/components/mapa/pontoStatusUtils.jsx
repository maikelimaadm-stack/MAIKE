/**
 * Adaptadores de compatibilidade do indicador de cocho/depósito do Mapa Geral.
 *
 * D-PROD-178: TODA a matemática (último evento, dias civis, taxa, saldo,
 * percentuais, limite operacional, mínimo) vive no SSOT
 * `src/domain/suplementacao/nivelSuplementacao.js`. Estes adaptadores só
 * traduzem o nível para o formato antigo (`percent`, `badgeLabel`,
 * `helperLabel`, `latestRecord`, …) e devolvem o nível completo em `nivel`.
 */
import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { calcularNivelCocho, calcularNivelDeposito } from "@/domain/suplementacao/nivelSuplementacao";
import { ehDiaValido, hojeNoFuso } from "@/lib/diaCivil";

export function buildProgressIconUrl(baseIconUrl) {
  return baseIconUrl;
}

/**
 * Indicador do cocho.
 *
 * @param {any} ponto
 * @param {any[]} [eventos]  eventos de suplementação da fazenda (todos os pontos)
 * @param {{ hoje?: string, pontos?: any[] }} [opcoes]
 *   `hoje`: dia civil AAAA-MM-DD no fuso da fazenda (padrão/ inválido:
 *   `hojeNoFuso(null)`, o relógio do navegador). `pontos`: pontos de
 *   suplementação ativos, para detectar cochos compartilhando os mesmos animais.
 * @returns {{ percent: number, badgeLabel: string, helperLabel: string, latestRecord: any, saldoAtual: number|null, nivel: import("@/domain/suplementacao/nivelSuplementacao").NivelCocho }}
 */
export function getCochoIndicator(ponto, eventos = [], opcoes = {}) {
  const hoje = ehDiaValido(opcoes?.hoje) ? /** @type {string} */ (opcoes.hoje) : hojeNoFuso(null);
  const nivel = calcularNivelCocho({ ponto, eventos, hoje, pontos: Array.isArray(opcoes?.pontos) ? opcoes.pontos : [] });
  return {
    percent: nivel.fracaoParaSvg,
    badgeLabel: nivel.rotuloCurto,
    helperLabel: nivel.descricao,
    latestRecord: nivel.evento,
    saldoAtual: nivel.saldoKg,
    nivel,
  };
}

/**
 * Indicador do depósito: saldo em kg sobre o LIMITE OPERACIONAL
 * (`capacidade_cocho_kg`); o estoque mínimo só dispara a reposição.
 *
 * D-PROD-162 (padrão P-11): `produtos` (opcional) diz quais Produtos têm
 * estoque em LITROS; os lotes deles ficam fora do saldo em kg e o movimento
 * rotulado `L` fica fora do "último registro". Sem `produtos` o saldo é o de
 * antes, mas a unidade dos lotes fica "não confirmada" (`nivel.unidadesConfirmadas`).
 *
 * @param {any} deposito
 * @param {any[]} [cochos]
 * @param {any[]} [lotes]
 * @param {any[]} [estoqueLotes]
 * @param {any[]} [movimentacoes]
 * @param {any[]} [produtos]
 */
export function getDepositoIndicator(deposito, cochos = [], lotes = [], estoqueLotes = [], movimentacoes = [], produtos = []) {
  const nivel = calcularNivelDeposito({ deposito, estoqueLotes, produtos });

  const ultimoRegistro = movimentacoes
    .filter((item) => (item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id) && item.unidade_medida !== "L")
    .sort((a, b) => new Date(b.data_movimentacao).getTime() - new Date(a.data_movimentacao).getTime())[0] || null;

  return {
    percent: nivel.fracaoParaSvg,
    saldoAtual: nivel.saldoKg,
    estoqueMinimo: Number(deposito.estoque_minimo_kg || 0),
    capacidadeDeposito: Number(deposito.capacidade_cocho_kg || 0),
    necessidadeEstimada: necessidadeEstimadaLegada(deposito, cochos, lotes),
    necessidadeReposicao: nivel.necessidadeReposicaoKg,
    isCritical: nivel.abaixoMinimo,
    badgeLabel: nivel.rotuloCurto,
    helperLabel: nivel.descricao,
    latestRecord: ultimoRegistro,
    nivel,
  };
}

/**
 * @deprecated Sem consumidor na interface; mantido só por compatibilidade do
 * formato antigo. Soma `consumo_ideal_por_cabeca_kg × cabeças` por cocho
 * ligado — conta em dobro o rebanho de cochos que atendem os mesmos animais.
 * Não é nível nem alerta: a cobertura do depósito vem do SSOT.
 * @param {any} deposito @param {any[]} cochos @param {any[]} lotes
 */
function necessidadeEstimadaLegada(deposito, cochos, lotes) {
  return cochos
    .filter((ponto) => normalizeText(ponto.categoria_ponto || "COCHO") === "COCHO" && ponto.deposito_origem_id === deposito.id)
    .reduce((total, cocho) => {
      const areaIds = Array.isArray(cocho.area_vinculada_ids) && cocho.area_vinculada_ids.length > 0
        ? cocho.area_vinculada_ids
        : (cocho.area_vinculada_id ? [cocho.area_vinculada_id] : []);
      const cabecas = lotes
        .filter((lote) => areaIds.includes(lote.area_atual_id) && lote.status === "Ativo")
        .reduce((soma, lote) => soma + (lote.quantidade_cabecas || 0), 0);
      return total + (cocho.consumo_ideal_por_cabeca_kg || 0) * cabecas;
    }, 0);
}
