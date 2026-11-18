/**
 * D-PROD-238 — VÁRIAS ÁREAS POR ATIVIDADE (regras puras da tela; quem decide é o servidor).
 *
 * "Eu tenho uma atividade que é combate contra cigarrinha, e nessa atividade são vários pastos que vou fazendo ao
 * decorrer do tempo [...] cada custo e lançamento é feito para aquela área." Uma atividade, várias áreas; cada
 * lançamento (o dia) é de UMA área. O ciclo de cada área: A iniciar (PLANEJADA) → Em andamento (EM_ANDAMENTO, com a data
 * de início) → Concluída (CONCLUIDA, com a data de conclusão); reabrir volta a Em andamento. Só a área Em andamento
 * recebe lançamento.
 *
 * Aqui: os rótulos, a ordem e os grupos das áreas, a coluna "Área" da lista, os contadores do card, as linhas da
 * abertura (a área planejada padrão = o tamanho) e o corpo `areas[]`, e os números de cada área (`por_area` de
 * `GET /atividades/:id/totais`, sem inventar nada: sem o valor, "—").
 */

import { comparar, ehCanonico, lerNumeroLocal, paraTextoDeEdicao, somar } from './dinheiroDecimal.js';
import { LIMITES_DECIMAL_ATIVIDADE, LOCALE_ATIVIDADE, formatarDiaAtividade, rotuloDaArea } from './lancamentoAtividadesRegras.js';
import { formatarDecimalLinha, formatarMoedaAtividade } from './atividadeLinhasRegras.js';

/** O ciclo da área (o CHECK do banco). */
export const STATUS_AREA = Object.freeze({ PLANEJADA: 'PLANEJADA', EM_ANDAMENTO: 'EM_ANDAMENTO', CONCLUIDA: 'CONCLUIDA' });

/** Como cada status aparece na tela. */
export const ROTULO_DO_STATUS_AREA = Object.freeze(
  /** @type {Record<string, string>} */ ({ PLANEJADA: 'A iniciar', EM_ANDAMENTO: 'Em andamento', CONCLUIDA: 'Concluída' }),
);

/** O selo do status (as chaves de cor do `Selo` do sistema). */
export const CHAVE_DO_SELO_AREA = Object.freeze(
  /** @type {Record<string, string>} */ ({ PLANEJADA: 'RASCUNHO', EM_ANDAMENTO: 'ABERTO', CONCLUIDA: 'CONFIRMADO' }),
);

/** Os grupos do card "Áreas da atividade", nesta ordem (o pedido do proprietário). */
export const GRUPOS_DE_AREA = Object.freeze([
  { status: STATUS_AREA.EM_ANDAMENTO, titulo: 'Em andamento', recolhido: false },
  { status: STATUS_AREA.PLANEJADA, titulo: 'A iniciar', recolhido: false },
  { status: STATUS_AREA.CONCLUIDA, titulo: 'Concluídas', recolhido: true },
]);

/** @param {unknown} v @returns {string} */
const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** @param {unknown} status */
export const rotuloDoStatusArea = (status) => ROTULO_DO_STATUS_AREA[texto(status)] ?? texto(status);

/**
 * As áreas da atividade (do servidor), na ordem em que entraram.
 * @param {any} atividade @returns {any[]}
 */
export const areasDaAtividade = (atividade) =>
  (Array.isArray(atividade?.areas) ? atividade.areas : [])
    .filter((a) => a && typeof a === 'object' && a.id != null)
    .slice()
    .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));

/** A atividade tem áreas (várias áreas, D-PROD-238)? @param {any} atividade */
export const temAreas = (atividade) => areasDaAtividade(atividade).length > 0;

/** Só as áreas EM ANDAMENTO (as que recebem lançamento). @param {any} atividade */
export const areasEmAndamento = (atividade) => areasDaAtividade(atividade).filter((a) => a.status === STATUS_AREA.EM_ANDAMENTO);

/** O nome da área de uma área da atividade ("01 — PASTO 01"). @param {any} areaDaAtividade */
export const rotuloDaAreaDaAtividade = (areaDaAtividade) => rotuloDaArea(areaDaAtividade?.area) || 'Área';

/** A área da atividade pelo id dela. @param {any} atividade @param {unknown} id */
export const areaDaAtividadePorId = (atividade, id) => areasDaAtividade(atividade).find((a) => String(a.id) === String(id ?? '')) ?? null;

/**
 * Contadores do card: `{ emAndamento, aIniciar, concluidas, total }`.
 * @param {any} atividade
 */
export const contadoresDasAreas = (atividade) => {
  const areas = areasDaAtividade(atividade);
  const de = (/** @type {string} */ s) => areas.filter((a) => a.status === s).length;
  return { emAndamento: de(STATUS_AREA.EM_ANDAMENTO), aIniciar: de(STATUS_AREA.PLANEJADA), concluidas: de(STATUS_AREA.CONCLUIDA), total: areas.length };
};

/** "2 em andamento · 3 a iniciar · 0 concluídas". @param {any} atividade */
export const textoDosContadores = (atividade) => {
  const c = contadoresDasAreas(atividade);
  return `${c.emAndamento} em andamento · ${c.aIniciar} a iniciar · ${c.concluidas} ${c.concluidas === 1 ? 'concluída' : 'concluídas'}`;
};

/**
 * A coluna "Área" da lista: a atividade de uma área mostra o nome dela; a de várias, "2 de 5 em andamento" (sem
 * nenhuma em andamento: "5 áreas a iniciar", "5 áreas concluídas" ou "5 áreas"). Sem área nenhuma: a área do cabeçalho
 * (a atividade antiga) ou "".
 * @param {any} atividade
 */
export const textoDaColunaArea = (atividade) => {
  const areas = areasDaAtividade(atividade);
  if (areas.length === 0) return rotuloDaArea(atividade?.area);
  if (areas.length === 1) return rotuloDaAreaDaAtividade(areas[0]);
  const c = contadoresDasAreas(atividade);
  if (c.emAndamento > 0) return `${c.emAndamento} de ${c.total} em andamento`;
  if (c.aIniciar === c.total) return `${c.total} áreas a iniciar`;
  if (c.concluidas === c.total) return `${c.total} áreas concluídas`;
  return `${c.total} áreas`;
};

/**
 * As áreas da atividade nos grupos do card (Em andamento, A iniciar, Concluídas), cada grupo com as suas, na ordem.
 * @param {any} atividade
 */
export const gruposDasAreas = (atividade) => {
  const areas = areasDaAtividade(atividade);
  return GRUPOS_DE_AREA.map((g) => ({ ...g, areas: areas.filter((a) => a.status === g.status) }));
};

// ─── Os números de cada área (por_area do servidor) ─────────────────────

/**
 * Os números da área em `por_area` dos totais (nulo sem eles).
 * @param {any} totais @param {unknown} atividadeAreaId
 */
export const totaisDaArea = (totais, atividadeAreaId) =>
  (Array.isArray(totais?.por_area) ? totais.por_area : []).find((p) => String(p?.atividade_area_id) === String(atividadeAreaId ?? '')) ?? null;

/** Porcentagem (texto do servidor, 2 casas) → largura da barra 0..100; sem valor, null. @param {unknown} percentual */
export const larguraDaBarra = (percentual) => {
  if (!ehCanonico(percentual)) return null;
  const n = Number(percentual);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
};

/**
 * Uma linha do card, pronta para exibir: planejada, feita, %, custo, custo/ha, início, conclusão e último lançamento.
 * Só o que o servidor deu (a área da atividade e `por_area`); sem valor, "—".
 * @param {any} area  a área da atividade @param {any} numeros  a entrada de `por_area` (ou null)
 */
export const linhaDaAreaParaExibir = (area, numeros) => {
  const ha = (/** @type {unknown} */ v) => (formatarDecimalLinha(v) ? `${formatarDecimalLinha(v)} ha` : '—');
  const pct = ehCanonico(numeros?.percentual) ? `${formatarDecimalLinha(numeros.percentual)}%` : '—';
  return {
    nome: rotuloDaAreaDaAtividade(area),
    setor: texto(area?.setor_nome),
    planejada: ha(area?.area_planejada),
    feita: ha(numeros?.area_executada),
    percentual: pct,
    barra: larguraDaBarra(numeros?.percentual),
    custo: formatarMoedaAtividade(numeros?.custo_total) || '—',
    custoPorHa: formatarMoedaAtividade(numeros?.custo_por_ha) || '—',
    inicio: formatarDiaAtividade(area?.data_inicio) || '—',
    conclusao: formatarDiaAtividade(area?.data_conclusao) || '—',
    ultimo: formatarDiaAtividade(numeros?.ultimo_lancamento) || '—',
    lancamentos: Number.isInteger(numeros?.lancamentos_confirmados) ? numeros.lancamentos_confirmados : 0,
    cancelados: Number.isInteger(numeros?.lancamentos_cancelados) ? numeros.lancamentos_cancelados : 0,
  };
};

/**
 * A área pode sair da atividade? Só a A iniciar (PLANEJADA) e sem nenhum lançamento (nem cancelado) — a regra do
 * servidor, que confere de novo.
 * @param {any} area @param {any} numeros
 */
export const podeRemoverArea = (area, numeros) =>
  area?.status === STATUS_AREA.PLANEJADA && !(Number(numeros?.lancamentos_confirmados) > 0) && !(Number(numeros?.lancamentos_cancelados) > 0);

// ─── A abertura: as áreas escolhidas ────────────────────────────────────

/**
 * @typedef {{ area_id: string, area_planejada: string }} LinhaDaAbertura
 */

/**
 * Tamanho / área em hectares (o texto canônico do servidor da atividade ou o número da API das áreas) → canônico com 4
 * casas; inválido ou negativo → null.
 * @param {unknown} v @returns {string|null}
 */
export const hectaresCanonicos = (v) => {
  if (ehCanonico(v)) return /** @type {string} */ (v);
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v.toFixed(LIMITES_DECIMAL_ATIVIDADE.casas);
  return null;
};

/** Decimal canônico (ou o número da área) → texto do campo ("10.0000" → "10"). @param {unknown} v */
export const planejadaParaEdicao = (v) => {
  const c = hectaresCanonicos(v);
  return c === null ? '' : paraTextoDeEdicao(c, LOCALE_ATIVIDADE, { casasMax: LIMITES_DECIMAL_ATIVIDADE.casas });
};

/**
 * Marca ou desmarca uma área do mapa na lista da abertura (a marcada entra no fim, com a planejada padrão = o tamanho).
 * @param {LinhaDaAbertura[]} linhas @param {any} areaDoMapa @returns {LinhaDaAbertura[]}
 */
export const alternarAreaNaAbertura = (linhas, areaDoMapa) => {
  const id = String(areaDoMapa?.id ?? '');
  if (!id) return linhas;
  if (linhas.some((l) => l.area_id === id)) return linhas.filter((l) => l.area_id !== id);
  return [...linhas, { area_id: id, area_planejada: planejadaParaEdicao(areaDoMapa?.tamanho_hectares) }];
};

/**
 * Lê a área planejada digitada (pt-BR) → canônico; vazio → null; inválido → a mensagem.
 * @param {unknown} digitado @returns {{ valor: string|null, erro: string|null }}
 */
export const lerPlanejada = (digitado) => {
  const t = texto(digitado);
  if (!t) return { valor: null, erro: null };
  const lida = lerNumeroLocal(t, LOCALE_ATIVIDADE, LIMITES_DECIMAL_ATIVIDADE);
  if (!lida.ok) return { valor: null, erro: 'A área planejada está em formato inválido: use 1.234,5.' };
  return { valor: /** @type {string} */ (lida.valor), erro: null };
};

/**
 * Erros das linhas da abertura (por área: a planejada inválida). Sem linha nenhuma e o tipo exigindo área, o erro do
 * campo `areas`.
 * @param {LinhaDaAbertura[]} linhas @param {{ exigeArea: boolean, nomeDoTipo?: string }} ctx
 * @returns {Record<string, string>}
 */
export const errosDasAreasDaAbertura = (linhas, { exigeArea, nomeDoTipo = '' }) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (exigeArea && !linhas.length) erros.areas = `${nomeDoTipo ? `O tipo ${nomeDoTipo} exige` : 'O tipo desta atividade exige'} ao menos uma área.`;
  for (const l of linhas) {
    const lida = lerPlanejada(l.area_planejada);
    if (lida.erro) erros[`area:${l.area_id}`] = lida.erro;
  }
  return erros;
};

/**
 * O corpo `areas[]` da abertura: `[{ area_id, area_planejada? }]` (a planejada vazia fica fora: o servidor usa o tamanho).
 * @param {LinhaDaAbertura[]} linhas
 */
export const corpoDasAreasDaAbertura = (linhas) =>
  linhas.map((l) => {
    const p = lerPlanejada(l.area_planejada).valor;
    return p === null ? { area_id: l.area_id } : { area_id: l.area_id, area_planejada: p };
  });

/**
 * O total da área planejada das linhas (canônico, 4 casas) e do tamanho das áreas escolhidas; sem nenhum, null.
 * @param {LinhaDaAbertura[]} linhas @param {any[]} areasDoMapa
 */
export const totaisDaAbertura = (linhas, areasDoMapa) => {
  const planejadas = linhas.map((l) => lerPlanejada(l.area_planejada).valor).filter((v) => v !== null);
  const tamanhos = linhas
    .map((l) => hectaresCanonicos(areasDoMapa.find((a) => String(a?.id) === l.area_id)?.tamanho_hectares))
    .filter((v) => v !== null);
  return {
    planejada: planejadas.length ? somar(/** @type {string[]} */ (planejadas), 4) : null,
    tamanho: tamanhos.length ? somar(/** @type {string[]} */ (tamanhos), 4) : null,
  };
};

/** A planejada passa do tamanho da área? (só aviso: o servidor aceita). @param {unknown} planejada @param {unknown} tamanho */
export const planejadaMaiorQueArea = (planejada, tamanho) => {
  const p = lerPlanejada(planejada).valor;
  const t = hectaresCanonicos(tamanho);
  if (p === null || t === null) return false;
  return comparar(p, t) > 0;
};
