/**
 * Indicadores da área para o resumo do Mapa Geral.
 *
 * Puro e testável: recebe a área e os lotes que estão nela e devolve os mesmos
 * números que o mapa já usa (1 UA = 450 kg de peso vivo, taxa de lotação sobre
 * a área útil). Nada de requisição, nada de estado.
 */

/** 1 UA = 450 kg de peso vivo (padrão Embrapa, o mesmo do Mapa). */
export const PESO_DA_UA_KG = 450;

/** @param {unknown} valor */
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/** @param {unknown} data */
const diasDePastejo = (data) => {
  if (!data) return 0;
  const entrada = new Date(/** @type {string|number|Date} */ (data));
  if (Number.isNaN(entrada.getTime())) return 0;
  entrada.setHours(0, 0, 0, 0);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((hoje.getTime() - entrada.getTime()) / 86400000));
};

/**
 * @param {any} area
 * @param {any[]} [lotes] lotes (ou posições do ledger) que estão na área
 */
export const indicadoresDaArea = (area, lotes = []) => {
  const areaTotal = numero(area?.tamanho_hectares);
  const pastejada = numero(area?.area_pastejada);
  // Área útil é a pastejada; sem ela, vale a área total (mesma regra do mapa).
  const areaUtil = pastejada > 0 ? pastejada : areaTotal;

  let cabecas = 0;
  let pesoTotal = 0;
  let diasPonderados = 0;
  let cabecasComEntrada = 0;

  for (const lote of lotes || []) {
    const cab = numero(lote?.quantidade_cabecas);
    if (cab <= 0) continue;
    cabecas += cab;
    pesoTotal += numero(lote?.peso_medio_kg) * cab;
    const dias = diasDePastejo(lote?.data_entrada);
    if (!lote?.data_entrada) continue;
    diasPonderados += dias * cab;
    cabecasComEntrada += cab;
  }

  const cargaAnimal = pesoTotal / PESO_DA_UA_KG;

  return {
    lotes: (lotes || []).length,
    areaTotal,
    areaUtil,
    cabecas,
    pesoTotal,
    pesoMedio: cabecas > 0 ? pesoTotal / cabecas : 0,
    cargaAnimal,
    taxaDeLotacao: areaUtil > 0 ? cargaAnimal / areaUtil : 0,
    diasPastejados: cabecasComEntrada > 0 ? Math.round(diasPonderados / cabecasComEntrada) : 0,
  };
};

/**
 * Dias de pastejo de um lote, contados de `data_entrada` até hoje.
 * @param {unknown} dataEntrada
 */
export const diasPastejoDoLote = diasDePastejo;
