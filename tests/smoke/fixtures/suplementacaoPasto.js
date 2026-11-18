/**
 * Dados de exemplo da aba Suplementação do Detalhes v12 (D-PROD-218), com as
 * MESMAS funções do sistema: o período fechado é o patch real de
 * `calcularFechamentoDePeriodo` (o que o serviço grava no evento) e o ponto é
 * decorado como o Mapa Geral faz (nível do SSOT + farol da leitura).
 *
 * O exemplo reproduz os números das capturas do v12 (Pasto 07, Cocho 07,
 * SAL MINERAL 80, HOJE 2026-11-15): 75 g/cab/dia (esperado 75 g), desvio -0,6
 * dentro de ±20% (faixa da formulação), 400 / 140,40 / 259,60 kg, 23,40 kg/dia,
 * 0,034% × 0,035% e "65% · restam 260 kg".
 */
import { calcularFechamentoDePeriodo } from "@/components/utils/consumoUtils";
import { calcularNivelCocho } from "@/domain/suplementacao/nivelSuplementacao";
import { descreverFarol, farolDoCocho } from "@/domain/suplementacao/leituraCocho";

export const EMPRESA = "emp-1";
export const AREA = "a-p07";
export const HOJE = "2026-11-15";

/** Cocho do Pasto 07. */
export const cocho = (id, nome, extra = {}) => ({
  id,
  empresa_id: EMPRESA,
  nome_ponto: nome,
  categoria_ponto: "COCHO",
  status: "Ativo",
  area_vinculada_id: AREA,
  area_vinculada_ids: [AREA],
  produto_padrao: "SAL MINERAL 80",
  ...extra,
});

/** Lançamento (ciclo aberto) com a taxa gravada pelo %PV, 314 cabeças. */
export const lancamento = (id, pontoId, extra = {}) => ({
  id,
  empresa_id: EMPRESA,
  ponto_suplementacao_id: pontoId,
  produto: "SAL MINERAL 80",
  produto_id: "p-sal",
  data_lancamento: "2026-11-09",
  quantidade_total_kg: 400,
  sobra_kg: 0,
  dias_periodo: null,
  consumo_esperado_pv_kg: 23.4,
  total_cabecas_afetadas: 314,
  cabecas_nao_consomem: 0,
  peso_medio_lotes_kg: 216.8,
  peso_vivo_consumo_kg: 68075.2,
  percentual_consumo_pv_usado: 0.0344,
  base_consumo: "PV",
  created_date: `${extra.data_lancamento ?? "2026-11-09"}T12:00:00.000Z`,
  ...extra,
});

/**
 * Fecha o período como o serviço: evento + `patchEvento` de `calcularFechamentoDePeriodo`.
 * @param {any} evento
 * @param {{ dias: number, sobraFinal: number, faixa?: number|null, compartilhado?: boolean, sobraInformada?: boolean }} p
 */
export const fechar = (evento, { dias, sobraFinal, faixa = null, compartilhado = false, sobraInformada = true }) => {
  const { patchEvento } = calcularFechamentoDePeriodo({
    evento,
    diasPeriodo: dias,
    sobraFinal,
    lotesDoEvento: [],
    alocacoes: [],
    sobraInformada,
    faixaPercentual: faixa,
    compartilhado,
  });
  return { ...evento, ...patchEvento };
};

/** Leitura de cocho (D-PROD-205). */
export const leitura = (id, pontoId, data, escore = "ADEQUADO") => ({
  id,
  empresa_id: EMPRESA,
  ponto_suplementacao_id: pontoId,
  data_leitura: data,
  escore,
  acesso: "BOM",
  estrutura: "BOA",
  created_date: `${data}T10:00:00.000Z`,
});

/**
 * Pontos decorados como no Mapa Geral (`pontosSuplementacaoDecorados`).
 * @param {any[]} pontos
 * @param {any[]} eventos
 * @param {any[]} [leituras]
 * @param {string} [hoje]
 */
export const decorar = (pontos, eventos, leituras = [], hoje = HOJE) =>
  pontos.map((ponto) => {
    const nivel = calcularNivelCocho({ ponto, eventos, hoje, pontos });
    const farol = farolDoCocho({ leituras, pontoId: ponto.id, hoje });
    return {
      ...ponto,
      indicador_percentual: nivel.fracaoParaSvg,
      indicador_neutro: nivel.neutro === true,
      indicador_titulo: nivel.descricao,
      indicador_farol: { cor: farol.cor, hex: farol.hex, rotulo: farol.rotulo, texto: descreverFarol(farol), avisos: farol.avisos.length },
      nivel_suplementacao: nivel,
    };
  });

/** Período anterior do Cocho 07: 27/10, 13 dias, 304,4 kg consumidos (23,415 kg/dia), faixa 20%. */
export const fechadoK07 = () =>
  fechar(
    lancamento("e-k07-1", "k07", {
      data_lancamento: "2026-10-27",
      quantidade_total_kg: 284.4,
      sobra_kg: 20,
      consumo_esperado_pv_kg: 23.55,
      percentual_consumo_pv_usado: 0.0346,
    }),
    { dias: 13, sobraFinal: 0, faixa: 20 },
  );

/**
 * O exemplo do v12: Cocho 07 com o ciclo aberto em 09/11 e o período anterior
 * fechado. `extras`: mais cochos/eventos/leituras do mesmo pasto.
 * @param {{ pontos?: any[], eventos?: any[], leituras?: any[] }} [extras]
 */
export function exemploV12(extras = {}) {
  const pontosBrutos = [cocho("k07", "Cocho 07"), ...(extras.pontos ?? [])];
  const eventos = [lancamento("e-k07-2", "k07"), fechadoK07(), ...(extras.eventos ?? [])];
  const leituras = [leitura("l-k07", "k07", "2026-11-14"), ...(extras.leituras ?? [])];
  return { pontos: decorar(pontosBrutos, eventos, leituras), eventos, leituras, hoje: HOJE };
}
