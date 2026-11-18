/**
 * D-PROD-252 — a organização do Lançamento de Atividades: uma tabela de áreas na atividade, uma tabela de lançamentos
 * na área e o Resumo das áreas. Só formatação e agrupamento do que o servidor já devolveu (lançamentos, abastecimentos
 * e `por_area` dos totais): nenhum número é calculado aqui além da soma das linhas mostradas, usada quando o total do
 * servidor ainda não chegou.
 */

import { areaDaAtividadePorId, areasDaAtividade, linhaDaAreaParaExibir, rotuloDaAreaDaAtividade, totaisDaArea } from './atividadeAreasRegras.js';
import {
  LINHA_MAO_OBRA,
  LINHA_MAQUINA,
  LINHA_PRODUTO,
  LINHA_SERVICO,
  formatarMoedaAtividade,
  formatarQuantidadeLinha,
  formatarQuantidadeMaoObra,
  formatarQuantidadeServico,
  formatarUso,
  linhasDoApontamento,
  rotuloDaMaoObraDaLinha,
  rotuloDaMaquinaDaLinha,
  rotuloDoImplementoDaLinha,
  rotuloDoProdutoDaLinha,
  rotuloDoServicoDaLinha,
  statusDaLinha,
} from './atividadeLinhasRegras.js';
import { formatarQuantidadeCurta, rotuloDoBem } from './abastecimentoRegras.js';
import { somar } from './dinheiroDecimal.js';
import { STATUS_CANCELADO, STATUS_CONFIRMADO, formatarDiaAtividade } from './lancamentoAtividadesRegras.js';

/** O tipo da linha de abastecimento (não é uma linha do lançamento: vem da tela Abastecimentos). */
export const LINHA_ABASTECIMENTO = 'abastecimento';

/** O rótulo de cada tipo na tabela da área e nos botões "+". */
export const ROTULO_DO_TIPO_NA_AREA = Object.freeze(
  /** @type {Record<string, string>} */ ({
    [LINHA_MAQUINA]: 'Máquina',
    [LINHA_PRODUTO]: 'Insumo',
    [LINHA_MAO_OBRA]: 'Mão de obra',
    [LINHA_SERVICO]: 'Serviço',
    [LINHA_ABASTECIMENTO]: 'Abastecimento',
  }),
);

const ORDEM_DO_TIPO = [LINHA_MAQUINA, LINHA_PRODUTO, LINHA_MAO_OBRA, LINHA_SERVICO, LINHA_ABASTECIMENTO];

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/**
 * @typedef {{
 *   id: string,
 *   tipo: string,
 *   rotuloDoTipo: string,
 *   dia: string,
 *   diaTexto: string,
 *   item: string,
 *   quantidade: string,
 *   valor: string|null,
 *   valorTexto: string,
 *   linha: any,
 *   apontamento: any,
 *   abastecimento: any,
 * }} LinhaDaArea
 */

/** @param {Partial<LinhaDaArea> & { id: string, tipo: string, dia: string }} p @returns {LinhaDaArea} */
const montar = (p) => ({
  rotuloDoTipo: ROTULO_DO_TIPO_NA_AREA[p.tipo] ?? p.tipo,
  diaTexto: formatarDiaAtividade(p.dia) || '—',
  item: '—',
  quantidade: '—',
  valor: null,
  valorTexto: '—',
  linha: null,
  apontamento: null,
  abastecimento: null,
  ...p,
});

/**
 * Todas as linhas CONFIRMADAS de uma área (todos os dias) e os abastecimentos CONFIRMADOS ligados aos lançamentos dela, numa
 * lista só: do dia mais novo para o mais antigo e, no mesmo dia, na ordem dos tipos. O implemento é texto da linha da
 * máquina ("com GR-01"): não tem linha própria nem custo próprio. Sem `areaId`, vale a atividade toda (atividade antiga,
 * sem áreas).
 * @param {{ apontamentos: any[], abastecimentos?: any[], areaId: string|null }} p
 * @returns {LinhaDaArea[]}
 */
export const linhasDaArea = ({ apontamentos, abastecimentos = [], areaId }) => {
  const dias = (Array.isArray(apontamentos) ? apontamentos : []).filter(
    (ap) => ap && ap.status === STATUS_CONFIRMADO && (!areaId || String(ap.atividade_area_id ?? '') === String(areaId)),
  );
  /** @type {LinhaDaArea[]} */
  const lista = [];
  for (const ap of dias) {
    const dia = texto(ap.data_operacional).slice(0, 10);
    const l = linhasDoApontamento(ap);
    for (const x of l.maquinas) {
      if (statusDaLinha(x) === STATUS_CANCELADO) continue;
      const impl = rotuloDoImplementoDaLinha(x);
      const maquina = rotuloDaMaquinaDaLinha(x) || 'Máquina';
      lista.push(
        montar({
          id: String(x.id),
          tipo: LINHA_MAQUINA,
          dia,
          item: impl ? `${maquina} com ${impl}` : maquina,
          quantidade: formatarUso(x.quantidade_uso, x.medidor_tipo, x.medidor_unidade) || '—',
          valor: x.custo_total ?? null,
          linha: x,
          apontamento: ap,
        }),
      );
    }
    for (const x of l.produtos) {
      if (statusDaLinha(x) === STATUS_CANCELADO) continue;
      lista.push(
        montar({
          id: String(x.id),
          tipo: LINHA_PRODUTO,
          dia,
          item: rotuloDoProdutoDaLinha(x) || 'Produto',
          quantidade: formatarQuantidadeLinha(x.quantidade, x.unidade || x.produto?.unidade_sigla || '') || '—',
          valor: x.custo_total ?? null,
          linha: x,
          apontamento: ap,
        }),
      );
    }
    for (const x of l.mao_obra) {
      if (statusDaLinha(x) === STATUS_CANCELADO) continue;
      lista.push(
        montar({
          id: String(x.id),
          tipo: LINHA_MAO_OBRA,
          dia,
          item: rotuloDaMaoObraDaLinha(x) || 'Mão de obra',
          quantidade: formatarQuantidadeMaoObra(x.quantidade, x.tipo_medida) || '—',
          valor: x.custo_total ?? null,
          linha: x,
          apontamento: ap,
        }),
      );
    }
    for (const x of l.servicos) {
      if (statusDaLinha(x) === STATUS_CANCELADO) continue;
      lista.push(
        montar({
          id: String(x.id),
          tipo: LINHA_SERVICO,
          dia,
          item: rotuloDoServicoDaLinha(x) || 'Serviço',
          quantidade: formatarQuantidadeServico(x.quantidade, x.unidade) || '—',
          valor: x.valor_total ?? x.custo_total ?? null,
          linha: x,
          apontamento: ap,
        }),
      );
    }
  }
  const idsDosDias = new Set(dias.map((ap) => String(ap.id)));
  for (const a of Array.isArray(abastecimentos) ? abastecimentos : []) {
    if (!a || a.status === STATUS_CANCELADO) continue;
    const apId = a.apontamento?.id != null ? String(a.apontamento.id) : '';
    if (!idsDosDias.has(apId)) continue;
    lista.push(
      montar({
        id: `abastecimento-${a.id}`,
        tipo: LINHA_ABASTECIMENTO,
        dia: texto(a.data_operacional).slice(0, 10),
        item: rotuloDoBem(a.bem) || 'Máquina',
        quantidade: formatarQuantidadeCurta(a.quantidade, a.unidade) || '—',
        valor: a.custo_total ?? null,
        abastecimento: a,
        apontamento: dias.find((ap) => String(ap.id) === apId) ?? null,
      }),
    );
  }
  for (const r of lista) r.valorTexto = formatarMoedaAtividade(r.valor) || '—';
  return lista.sort((a, b) => b.dia.localeCompare(a.dia) || ORDEM_DO_TIPO.indexOf(a.tipo) - ORDEM_DO_TIPO.indexOf(b.tipo));
};

/** A soma dos valores das linhas (2 casas na exibição). @param {LinhaDaArea[]} linhas */
export const somaDasLinhas = (linhas) => {
  const valores = linhas.map((r) => r.valor).filter((v) => typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v));
  return valores.length ? somar(/** @type {string[]} */ (valores), 4) : null;
};

/**
 * "20 de 40 ha" — o feito e o planejado da área (o texto do servidor, sem a unidade repetida). Sem feito, só o planejado.
 * @param {{ feita: string, planejada: string }} l
 */
export const textoFeitaDePlanejada = (l) => {
  const semHa = (/** @type {string} */ s) => s.replace(/\s*ha$/i, '');
  if (l.planejada === '—') return l.feita;
  if (l.feita === '—') return l.planejada;
  return `${semHa(l.feita)} de ${l.planejada}`;
};

/**
 * O Resumo das áreas (emenda da D-PROD-252): uma linha por área da atividade (a ordem do servidor) com os hectares ("20 de 40"),
 * o custo por tipo (máquinas, insumos, mão de obra, serviços, abastecimento), o total e o R$/ha, e a linha de total da
 * atividade. Tudo do `por_area` e dos totais do servidor, juntado pela área da atividade; zero ou sem valor mostra "—". O custo
 * do implemento já está em Máquinas: não há coluna de implemento.
 * @param {{ atividade: any, totais: any }} p
 */
export const resumoDasAreas = ({ atividade, totais }) => {
  const moeda = (/** @type {unknown} */ v) => {
    const t = formatarMoedaAtividade(v);
    return !t || Number(v) === 0 ? '—' : t;
  };
  const custos = (/** @type {any} */ cpt) => ({
    maquinas: moeda(cpt?.maquinas),
    insumos: moeda(cpt?.produtos),
    maoObra: moeda(cpt?.mao_obra),
    servicos: moeda(cpt?.servicos),
    abastecimento: moeda(cpt?.combustivel),
  });
  const linhas = areasDaAtividade(atividade).map((area) => {
    const n = totaisDaArea(totais, area.id);
    const l = linhaDaAreaParaExibir(area, n);
    return {
      id: String(area.id),
      nome: rotuloDaAreaDaAtividade(area),
      ha: textoFeitaDePlanejada(l),
      ...custos(n?.custo_por_tipo),
      total: moeda(n?.custo_total),
      porHa: moeda(n?.custo_por_ha),
    };
  });
  const executada = linhaDaAreaParaExibir({ area: null, area_planejada: totais?.area_planejada ?? atividade?.area_planejada }, { area_executada: totais?.area_executada ?? atividade?.area_executada });
  const total = {
    nome: 'Total',
    ha: textoFeitaDePlanejada(executada),
    ...custos(totais?.custo_por_tipo),
    total: moeda(totais?.custo_total),
    porHa: moeda(totais?.custo_por_ha),
  };
  return { linhas, total };
};

/**
 * Os hectares sobre os quais a dose/ha é calculada (emenda da D-PROD-252): a Feita da área quando já há (a soma do servidor);
 * sem ela, a planejada da área; atividade antiga, sem áreas, a da atividade. Canônico de 4 casas, ou null.
 * @param {{ atividade: any, totais: any, areaId?: string|null }} p
 */
export const hectaresParaDose = ({ atividade, totais, areaId = null }) => {
  const positivo = (/** @type {unknown} */ v) => (typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v) && Number(v) > 0 ? v : null);
  const area = areaId ? areaDaAtividadePorId(atividade, areaId) : null;
  if (area) return positivo(totaisDaArea(totais, area.id)?.area_executada) ?? positivo(area.area_planejada);
  return positivo(totais?.area_executada ?? atividade?.area_executada) ?? positivo(totais?.area_planejada ?? atividade?.area_planejada);
};

/**
 * Os lançamentos (apontamentos confirmados) de UMA área, do mais novo para o mais antigo (dia, sequência).
 * @param {any[]} apontamentos @param {string|null} areaId
 */
const apontamentosConfirmadosDaArea = (apontamentos, areaId) =>
  (Array.isArray(apontamentos) ? apontamentos : [])
    .filter((a) => a && a.status === STATUS_CONFIRMADO && String(a.atividade_area_id ?? '') === String(areaId ?? ''))
    .sort((a, b) => String(b.data_operacional).localeCompare(String(a.data_operacional)) || (Number(b.sequencia) || 0) - (Number(a.sequencia) || 0));

/**
 * O que gravar para a área ficar com `Feita = valor` hectares (D-PROD-252, emenda): o servidor soma `area_executada_dia` dos
 * lançamentos confirmados da área, então o valor digitado vai inteiro no lançamento mais novo e os outros ficam sem valor.
 * Só entra no plano quem muda. Sem lançamento confirmado na área, não há onde gravar: lista vazia e `semLancamento`.
 * @param {{ apontamentos: any[], areaId: string|null, valor: string|null }} p `valor`: canônico (ou null para limpar)
 * @returns {{ semLancamento: boolean, passos: { apontamento: any, area_executada_dia: string|null }[] }}
 */
export const planoDaFeita = ({ apontamentos, areaId, valor }) => {
  const lista = apontamentosConfirmadosDaArea(apontamentos, areaId);
  if (!lista.length) return { semLancamento: true, passos: [] };
  const mesmo = (/** @type {unknown} */ a, /** @type {unknown} */ b) => (a == null || a === '' ? null : Number(a)) === (b == null || b === '' ? null : Number(b));
  const passos = lista
    .map((ap, i) => ({ apontamento: ap, area_executada_dia: i === 0 ? valor : null }))
    .filter((p) => !mesmo(p.apontamento.area_executada_dia, p.area_executada_dia));
  return { semLancamento: false, passos };
};
