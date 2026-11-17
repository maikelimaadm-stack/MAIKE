/**
 * Linha do tempo da aba Histórico do pasto (Detalhes do Lote v12, D-PROD-217 —
 * número definitivo no PR). Funções puras: nada de rede, cache ou React.
 *
 * Entra: as movimentações do pasto (servidor H2, ordem por ocorrência,
 * D-PROD-123; ou a cópia do aparelho) e os eventos de suplementação da área.
 * Sai: cartões por tipo, agrupados por dia ("09 NOV. 2026"), o mais recente
 * primeiro, na MESMA ordem do servidor (a chave H2 de cada registro).
 *
 * Um cartão por lote quando o registro traz uma linha por lote (transferência,
 * pesagem) ou a distribuição por lote (morte, saída). Só dado real: o que o
 * registro não guarda não vira linha — "Registrado por" e o "Peso médio" da
 * transferência do ledger não existem como dado e ficam fora; o nome de um
 * lote que o registro não traz não é deduzido.
 */

import {
  TRANSFERENCIA,
  chaveDeRegistro,
  chaveDoMovimento,
  compararChavesDesc,
  fluxoNaArea,
  recortarPelaFronteira,
} from "@/domain/lotes/historicoMovimentacoes";
import { ABATE, JUNCAO, MORTE, MUDANCA_CATEGORIA, NASCIMENTO, PESAGEM } from "@/domain/lotes/manejoRebanho";
import { nomeDaAreaDoMovimento } from "@/domain/lotes/movimentacaoLote";
import { ehMovimentoCancelado } from "@/domain/lotes/situacaoMovimento";

/** @typedef {import("@/domain/lotes/historicoMovimentacoes").ChaveDeOrdem} ChaveDeOrdem */
/** @typedef {"todos" | "mov" | "pes" | "man" | "sup"} FiltroHistorico */
/** @typedef {"mov" | "pes" | "man" | "sup"} GrupoHistorico */
/**
 * Chave do ícone (o componente troca pelo desenho): movimentação, pesagem,
 * nascimento, morte, saída (abate), mudança de categoria, junção,
 * suplementação ou registro (tipo sem desenho próprio).
 * @typedef {"movimentacao" | "pesagem" | "nascimento" | "morte" | "saida" | "mudanca" | "juncao" | "suplementacao" | "registro"} IconeHistorico
 */
/** @typedef {{ rotulo: string, valor: string }} LinhaHistorico */
/**
 * @typedef {{
 *   chave: string,
 *   grupo: GrupoHistorico,
 *   icone: IconeHistorico,
 *   titulo: string,
 *   linhas: LinhaHistorico[],
 *   cancelado: boolean,
 *   ordem: ChaveDeOrdem,
 * }} CartaoHistorico
 */
/** @typedef {{ chave: string, rotulo: string, cartoes: CartaoHistorico[] }} DiaHistorico */
/**
 * @typedef {{ areaId: string | null, areaNome?: string | null, areas?: Array<{ id?: string, nome?: string }> }} ContextoPasto
 */

export const VAZIO = "—";

/** Opções do "Mostrar", na ordem do v12. */
export const FILTROS_DO_HISTORICO = Object.freeze(
  /** @type {ReadonlyArray<{ valor: FiltroHistorico, rotulo: string }>} */ ([
    { valor: "todos", rotulo: "Todos os registros" },
    { valor: "mov", rotulo: "Movimentações" },
    { valor: "pes", rotulo: "Pesagens" },
    { valor: "man", rotulo: "Manejos" },
    { valor: "sup", rotulo: "Suplementação" },
  ])
);

/** @type {FiltroHistorico} */
export const FILTRO_PADRAO = "todos";

/**
 * Filtro conhecido, ou o padrão ("Todos os registros").
 * @param {unknown} valor
 * @returns {FiltroHistorico}
 */
export const filtroValido = (valor) => FILTROS_DO_HISTORICO.find((f) => f.valor === valor)?.valor ?? FILTRO_PADRAO;

/** @param {unknown} valor */
export const rotuloDoFiltro = (valor) => FILTROS_DO_HISTORICO.find((f) => f.valor === filtroValido(valor))?.rotulo ?? "";

const MESES = ["JAN.", "FEV.", "MAR.", "ABR.", "MAIO", "JUN.", "JUL.", "AGO.", "SET.", "OUT.", "NOV.", "DEZ."];

/** Grupo dos registros sem data da ocorrência (vão para o fim, nunca com data inventada). */
export const DIA_NAO_INFORMADO = "DATA NÃO INFORMADA";

/**
 * "2026-11-09" → "09 NOV. 2026" (v12). Sem dia válido → "DATA NÃO INFORMADA".
 * @param {string | null | undefined} dia dia literal 'YYYY-MM-DD'
 */
export function rotuloDoDia(dia) {
  const m = typeof dia === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia) : null;
  const mes = m ? MESES[Number(m[2]) - 1] : undefined;
  return m && mes ? `${m[3]} ${mes} ${m[1]}` : DIA_NAO_INFORMADO;
}

/** @param {unknown} v @returns {number | null} */
const numero = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Número pt-BR com `casas` decimais; sem número → "—".
 * @param {unknown} v @param {number} [casas]
 */
export function fmtNumero(v, casas = 0) {
  const n = numero(v);
  if (n === null) return VAZIO;
  let r = Number(n.toFixed(casas));
  if (r === 0) r = 0; // evita "-0"
  return r.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** @param {unknown} v @returns {string | null} */
const texto = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** @param {unknown} v @returns {string | null} */
const maiusculas = (v) => texto(v)?.toLocaleUpperCase("pt-BR") ?? null;
/** @param {unknown} v */
const positivo = (v) => {
  const n = numero(v);
  return n !== null && n > 0 ? n : null;
};

/** @param {string} rotulo @param {string | null | undefined} valor @returns {LinhaHistorico} */
const linha = (rotulo, valor) => ({ rotulo, valor: valor ?? VAZIO });

/**
 * Linhas opcionais: só entram com valor (o que o registro não tem não vira "—").
 * @param {Array<[string, string | null | undefined]>} pares
 * @returns {LinhaHistorico[]}
 */
const opcionais = (pares) => pares.filter(([, v]) => v != null && v !== "").map(([r, v]) => linha(r, v));

/** @param {any} mov @returns {any[]} */
const linhasDo = (mov) => (Array.isArray(mov?.linhas) ? mov.linhas.filter((l) => l && typeof l === "object") : []);

/**
 * @param {any} mov @param {ContextoPasto} ctx @param {"origem" | "destino"} lado
 * @param {any} [doItem] linha da transferência (cada lote pode vir de uma área)
 */
const nomeDaArea = (mov, ctx, lado, doItem) => {
  const id = lado === "origem" ? (doItem?.area_origem_id ?? mov?.area_origem_id) : mov?.area_destino_id;
  const gravado = lado === "origem" ? (doItem?.area_origem_nome ?? mov?.area_origem_nome) : mov?.area_destino_nome;
  const areas = [...(ctx.areas ?? []), ...(ctx.areaId ? [{ id: ctx.areaId, nome: ctx.areaNome ?? "" }] : [])];
  return texto(nomeDaAreaDoMovimento(gravado, id, areas)) ?? VAZIO;
};

/** Linha extra dos cancelados: o motivo, quando o cancelamento o guardou. @param {any} mov */
const motivoDoCancelamento = (mov) =>
  ehMovimentoCancelado(mov) ? opcionais([["Motivo do cancelamento", texto(mov?.cancelamento?.motivo)]]) : [];

/**
 * @typedef {{ titulo: string, grupo: GrupoHistorico, icone: IconeHistorico, linhas: LinhaHistorico[] }} CartaoBase
 */

/** @param {any} mov @param {ContextoPasto} ctx @returns {CartaoBase[]} */
function cartoesDaTransferencia(mov, ctx) {
  const titulo = (/** @type {string} */ fluxo) =>
    fluxo === "Entrada" ? "Movimentação · entrada" : fluxo === "Saída" ? "Movimentação · saída" : "Movimentação";
  /** @type {CartaoBase[]} */
  const cartoes = [];
  // Ledger (R2E): uma linha por posição/lote, cada uma com a sua área de origem.
  for (const item of linhasDo(mov)) {
    const fluxo = fluxoNaArea(
      { tipo: TRANSFERENCIA, area_origem_id: item.area_origem_id ?? mov.area_origem_id, area_destino_id: mov.area_destino_id },
      ctx.areaId
    );
    if (fluxo === "Transferência") continue; // lote que não passou por este pasto
    cartoes.push({
      titulo: titulo(fluxo),
      grupo: "mov",
      icone: "movimentacao",
      linhas: [
        linha("Lote", texto(item.nome) ?? texto(mov.lote)),
        linha("Cabeças", fmtNumero(item.quantidade)),
        linha("De", nomeDaArea(mov, ctx, "origem", item)),
        linha("Até", nomeDaArea(mov, ctx, "destino")),
      ],
    });
  }
  if (cartoes.length) return cartoes;
  // Registro antigo (um lote, sem linhas): os campos do próprio documento.
  return [
    {
      titulo: titulo(fluxoNaArea(mov, ctx.areaId)),
      grupo: "mov",
      icone: "movimentacao",
      linhas: [
        linha("Lote", texto(mov.lote)),
        linha("Cabeças", fmtNumero(mov.quantidade_animais)),
        linha("De", nomeDaArea(mov, ctx, "origem")),
        linha("Até", nomeDaArea(mov, ctx, "destino")),
        // Só o registro antigo guardava peso na transferência.
        ...opcionais([["Peso médio (kg)", positivo(mov.peso_medio) !== null ? fmtNumero(mov.peso_medio, 1) : null]]),
      ],
    },
  ];
}

/** @param {any} mov @returns {CartaoBase[]} */
function cartoesDaPesagem(mov) {
  const base = { titulo: "Pesagem", grupo: /** @type {GrupoHistorico} */ ("pes"), icone: /** @type {IconeHistorico} */ ("pesagem") };
  const itens = linhasDo(mov);
  if (itens.length) {
    // Uma linha por lote pesado (cada lote com o seu peso; nunca "um lote só").
    return itens.map((item) => ({
      ...base,
      linhas: [
        linha("Lote", texto(item.lote_nome) ?? texto(item.nome)),
        linha("Cabeças pesadas", fmtNumero(item.quantidade_cabecas)),
        linha("Peso médio (kg)", fmtNumero(item.peso_novo_kg ?? item.peso_medio_kg, 1)),
        linha("Origem", "MEDIDO"),
      ],
    }));
  }
  return [
    {
      ...base,
      linhas: [
        linha("Lote", texto(mov.lote)),
        linha("Cabeças pesadas", positivo(mov.quantidade_animais) !== null ? fmtNumero(mov.quantidade_animais) : null),
        linha("Peso médio (kg)", fmtNumero(mov.peso_medio, 1)),
        linha("Origem", "MEDIDO"),
      ],
    },
  ];
}

/** @param {any} mov @returns {CartaoBase[]} */
function cartoesDoNascimento(mov) {
  const base = { titulo: "Nascimento", grupo: /** @type {GrupoHistorico} */ ("man"), icone: /** @type {IconeHistorico} */ ("nascimento") };
  const itens = linhasDo(mov);
  if (!itens.length) {
    return [
      {
        ...base,
        linhas: [
          linha("Lote", texto(mov.lote)),
          linha("Quantidade", fmtNumero(mov.quantidade_animais)),
          ...opcionais([
            ["Sexo", maiusculas(mov.sexo)],
            ["Peso médio (kg)", positivo(mov.peso_medio) !== null ? fmtNumero(mov.peso_medio, 1) : null],
          ]),
        ],
      },
    ];
  }
  // O documento guarda o nome só do 1º lote que recebeu os bezerros (`lote`).
  // Linha que foi para outro lote mostra a categoria do bezerro, não um nome deduzido.
  const primeiraPosicao = itens[0].posicao_id ?? null;
  return itens.map((item, i) => {
    const nome =
      texto(item.lote_nome) ?? (i === 0 || (primeiraPosicao && item.posicao_id === primeiraPosicao) ? texto(mov.lote) : null);
    return {
      ...base,
      linhas: [
        nome ? linha("Lote", nome) : linha("Categoria", maiusculas(item.categoria_filhote)),
        linha("Quantidade", fmtNumero(item.quantidade)),
        linha("Sexo", maiusculas(item.sexo)),
        linha("Peso médio (kg)", fmtNumero(item.peso_medio_kg, 1)),
      ],
    };
  });
}

/**
 * Morte e Saída (abate): um cartão por lote da distribuição (cada linha da
 * baixa é uma categoria, dividida entre os lotes pelo servidor).
 * @param {any} mov @returns {CartaoBase[]}
 */
function cartoesDaBaixa(mov) {
  const morte = mov.tipo === MORTE;
  const base = morte
    ? { titulo: "Morte", grupo: /** @type {GrupoHistorico} */ ("man"), icone: /** @type {IconeHistorico} */ ("morte") }
    : { titulo: "Saída", grupo: /** @type {GrupoHistorico} */ ("man"), icone: /** @type {IconeHistorico} */ ("saida") };
  /** @param {any} item */
  const destino = (item) => {
    const d = texto(item?.destino);
    const nome = texto(item?.destino_nome);
    return d ? maiusculas(nome ? `${d} (${nome})` : d) : null;
  };
  /** @param {any} item @param {boolean} umLote o peso total da linha só é do lote quando a linha é de um lote só */
  const extras = (item, umLote) =>
    morte
      ? [linha("Causa", maiusculas(item?.causa_morte))]
      : opcionais([
          ["Destino", destino(item)],
          ["Peso vivo total (kg)", umLote && positivo(item?.peso_vivo_total_kg) !== null ? fmtNumero(item.peso_vivo_total_kg, 1) : null],
          ["Peso de carcaça total (kg)", umLote && positivo(item?.peso_carcaca_total_kg) !== null ? fmtNumero(item.peso_carcaca_total_kg, 1) : null],
        ]);
  const itens = linhasDo(mov);
  if (!itens.length) {
    return [{ ...base, linhas: [linha("Lote", texto(mov.lote)), linha("Quantidade", fmtNumero(mov.quantidade_animais)), ...extras(mov, true)] }];
  }
  /** @type {CartaoBase[]} */
  const cartoes = [];
  for (const item of itens) {
    const dist = Array.isArray(item.distribuicao) ? item.distribuicao.filter((d) => d && typeof d === "object") : [];
    if (!dist.length) {
      cartoes.push({
        ...base,
        linhas: [linha("Lote", itens.length === 1 ? texto(mov.lote) : null), linha("Quantidade", fmtNumero(item.quantidade)), ...extras(item, true)],
      });
      continue;
    }
    for (const d of dist) {
      cartoes.push({
        ...base,
        linhas: [linha("Lote", texto(d.nome)), linha("Quantidade", fmtNumero(d.quantidade)), ...extras(item, dist.length === 1)],
      });
    }
  }
  return cartoes;
}

/** @param {any} mov @returns {CartaoBase[]} */
function cartoesDaMudancaDeCategoria(mov) {
  const base = {
    titulo: "Mudança de Categoria",
    grupo: /** @type {GrupoHistorico} */ ("man"),
    icone: /** @type {IconeHistorico} */ ("mudanca"),
  };
  const itens = linhasDo(mov);
  if (!itens.length) {
    return [{ ...base, linhas: [linha("Lote", texto(mov.lote)), linha("Quantidade", fmtNumero(mov.quantidade_animais))] }];
  }
  // O `lote` do documento é a 1ª posição de origem: só identifica a linha quando
  // ela é a única e saiu de um lote só.
  const loteConhecido = itens.length === 1 && (Array.isArray(itens[0].partes) ? itens[0].partes.length : 0) <= 1;
  return itens.map((item) => ({
    ...base,
    linhas: [
      ...(loteConhecido && texto(mov.lote) ? [linha("Lote", texto(mov.lote))] : []),
      linha("Quantidade", fmtNumero(item.quantidade)),
      linha("Categoria anterior", maiusculas(item.categoria_atual)),
      linha("Categoria nova", maiusculas(item.categoria_nova)),
      ...opcionais([["Cat. de manejo", maiusculas(item.categoria_manejo_nome)]]),
    ],
  }));
}

/** @param {any} mov @returns {CartaoBase[]} */
function cartoesDaJuncao(mov) {
  const origens = linhasDo(mov)
    .map((l) => texto(l.nome))
    .filter(Boolean)
    .join(" · ");
  return [
    {
      titulo: "Junção de Lotes",
      grupo: "man",
      icone: "juncao",
      linhas: [
        linha("Lote", texto(mov?.juncao?.principal?.nome) ?? texto(mov.lote)),
        ...opcionais([["Lotes juntados", origens || null]]),
        linha("Quantidade", fmtNumero(mov.quantidade_animais)),
      ],
    },
  ];
}

/** Tipo sem desenho próprio (registro antigo): título do próprio documento. @param {any} mov @returns {CartaoBase[]} */
function cartoesDeOutroTipo(mov) {
  return [
    {
      titulo: texto(mov.motivo) ?? texto(mov.tipo) ?? "Registro",
      grupo: "man",
      icone: "registro",
      linhas: [
        linha("Lote", texto(mov.lote)),
        ...opcionais([["Quantidade", positivo(mov.quantidade_animais) !== null ? fmtNumero(mov.quantidade_animais) : null]]),
      ],
    },
  ];
}

/**
 * Cartões de UMA movimentação, do ponto de vista do pasto.
 * @param {any} mov
 * @param {ContextoPasto} ctx
 * @param {{ doServidor?: boolean }} [opcoes] `doServidor`: veio do endpoint H2 (datas `historico_*` valem)
 * @returns {CartaoHistorico[]}
 */
export function cartoesDaMovimentacao(mov, ctx, { doServidor = false } = {}) {
  if (!mov || typeof mov !== "object") return [];
  const tipo = mov.tipo;
  const bases =
    tipo === TRANSFERENCIA
      ? cartoesDaTransferencia(mov, ctx)
      : tipo === PESAGEM
        ? cartoesDaPesagem(mov)
        : tipo === NASCIMENTO
          ? cartoesDoNascimento(mov)
          : tipo === MORTE || tipo === ABATE
            ? cartoesDaBaixa(mov)
            : tipo === MUDANCA_CATEGORIA
              ? cartoesDaMudancaDeCategoria(mov)
              : tipo === JUNCAO
                ? cartoesDaJuncao(mov)
                : cartoesDeOutroTipo(mov);
  const ordem = chaveDoMovimento(mov, { doServidor });
  const cancelado = ehMovimentoCancelado(mov);
  const extra = motivoDoCancelamento(mov);
  return bases.map((b, i) => ({
    ...b,
    linhas: [...b.linhas, ...extra],
    chave: `mov-${mov.id ?? "sem-id"}-${i}`,
    cancelado,
    ordem,
  }));
}

/**
 * O evento de suplementação é deste pasto? (`area_id` ou `area_ids`, e a empresa quando informada)
 * @param {any} evento @param {string | null} areaId @param {string | null} [empresaId]
 */
export function eventoDoPasto(evento, areaId, empresaId = null) {
  if (!evento || !areaId) return false;
  if (empresaId && evento.empresa_id && evento.empresa_id !== empresaId) return false;
  return evento.area_id === areaId || (Array.isArray(evento.area_ids) && evento.area_ids.includes(areaId));
}

/**
 * Cartão de um lançamento de suplementação: Cocho, Produto, Quantidade (kg) e
 * Sacos (os lançados em saco; senão kg ÷ peso do saco, quando o produto tem saco).
 * @param {any} evento
 * @returns {CartaoHistorico}
 */
export function cartaoDaSuplementacao(evento) {
  const kg = numero(evento?.quantidade_total_kg);
  const sacos = positivo(evento?.quantidade_sacos) ?? (kg !== null && positivo(evento?.peso_por_saco_kg) !== null ? kg / Number(evento.peso_por_saco_kg) : null);
  const id = `sup-${evento?.id ?? "sem-id"}`;
  return {
    chave: id,
    grupo: "sup",
    icone: "suplementacao",
    titulo: "Suplementação",
    linhas: [
      linha("Cocho", texto(evento?.ponto_nome)),
      linha("Produto", texto(evento?.produto)),
      linha("Quantidade (kg)", fmtNumero(kg, 2)),
      linha("Sacos", fmtNumero(sacos, 2)),
    ],
    cancelado: false,
    ordem: chaveDeRegistro(evento?.data_lancamento, evento?.created_date, id),
  };
}

/**
 * Agrupa por dia da ocorrência, na ordem em que os cartões chegam (já ordenados).
 * @param {CartaoHistorico[]} cartoes
 * @returns {DiaHistorico[]}
 */
export function agruparPorDia(cartoes) {
  /** @type {DiaHistorico[]} */
  const dias = [];
  for (const c of cartoes) {
    const chave = c.ordem.oc ?? "sem-data";
    let dia = dias[dias.length - 1];
    if (!dia || dia.chave !== chave) {
      dia = { chave, rotulo: rotuloDoDia(c.ordem.oc), cartoes: [] };
      dias.push(dia);
    }
    dia.cartoes.push(c);
  }
  return dias;
}

/**
 * Linha do tempo do pasto.
 *
 * Os eventos de suplementação vêm do cache do aparelho, inteiros; as
 * movimentações vêm por páginas. Com "Todos os registros" e mais páginas por
 * carregar, um evento mais antigo que a última movimentação carregada espera
 * a próxima página (ficaria fora do lugar): a lista mostrada é sempre um
 * prefixo certo da ordem global (mesma regra do histórico de hoje).
 *
 * @param {{
 *   movimentacoes?: any[],
 *   eventos?: any[],
 *   areaId: string | null,
 *   areaNome?: string | null,
 *   areas?: Array<{ id?: string, nome?: string }>,
 *   empresaId?: string | null,
 *   doServidor?: boolean,
 *   haMaisPaginas?: boolean,
 *   filtro?: unknown,
 * }} p
 * @returns {{ dias: DiaHistorico[], total: number, adiados: number }}
 */
export function montarHistoricoDoPasto({
  movimentacoes = [],
  eventos = [],
  areaId,
  areaNome = null,
  areas = [],
  empresaId = null,
  doServidor = false,
  haMaisPaginas = false,
  filtro = FILTRO_PADRAO,
}) {
  const f = filtroValido(filtro);
  /** @type {ContextoPasto} */
  const ctx = { areaId, areaNome, areas };
  const movs = (Array.isArray(movimentacoes) ? movimentacoes : []).filter((m) => m && typeof m === "object");
  const deMovimentos = f === "sup" ? [] : movs.flatMap((m) => cartoesDaMovimentacao(m, ctx, { doServidor }));
  const deEventos =
    f === "todos" || f === "sup"
      ? (Array.isArray(eventos) ? eventos : []).filter((e) => eventoDoPasto(e, areaId, empresaId)).map(cartaoDaSuplementacao)
      : [];

  let adiados = 0;
  let eventosVisiveis = deEventos;
  if (f === "todos" && haMaisPaginas && movs.length) {
    const fronteira = movs.map((m) => chaveDoMovimento(m, { doServidor })).sort(compararChavesDesc).at(-1) ?? null;
    const recorte = recortarPelaFronteira(deEventos, fronteira);
    eventosVisiveis = recorte.visiveis;
    adiados = recorte.adiados;
  }

  const cartoes = [...deMovimentos.filter((c) => f === "todos" || c.grupo === f), ...eventosVisiveis].sort((a, b) =>
    compararChavesDesc(a.ordem, b.ordem)
  );
  return { dias: agruparPorDia(cartoes), total: cartoes.length, adiados };
}
