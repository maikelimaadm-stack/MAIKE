/**
 * D-PROD-329 — a ABERTURA de um serviço no "Diário das atividades" (só a abertura: tipo → máquina, implemento, horímetro
 * inicial e responsável → serviço iniciado).
 *
 * Sem migration: a abertura é guardada como PRIMEIRA LINHA da observação do apontamento do dia (o que o servidor já
 * grava), no formato `[abertura-servico bem=<id> impl=<id> hor=<decimal> resp=<id> bemn=<enc> impln=<enc> respn=<enc>]`.
 * Campos vazios saem da linha; o nome vai `encodeURIComponent`, então a linha nunca tem espaço dentro de um valor. O
 * texto depois da linha é da pessoa e é preservado. Limite: é texto; editar a linha à mão pode apagá-la (a leitura
 * devolve `null` e a tela mostra "Abertura não registrada"). Os números reais do horímetro chegam com o "Encerrar o dia".
 *
 * Horímetro: o campo é pt-BR (ponto = milhar, vírgula = decimal); o valor guardado é canônico ("1245.0").
 */
import { ehCanonico, formatarNumero, lerNumeroLocal } from "./dinheiroDecimal.js";

/** O início da linha de abertura, com o fechamento `]` e a quebra de linha (ou o fim do texto). */
const LINHA_DA_ABERTURA = /^\[abertura-servico[^\]\n]*\](?:\r?\n|$)/;
/** A linha inteira, com os pares `chave=valor` (só a 1ª linha conta). */
const CONTEUDO_DA_LINHA = /^\[abertura-servico((?: [a-z]+=[^\s\]]*)*)\](?:\r?\n|$)/;

/** @param {unknown} v */
const texto = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/** Decodifica um valor da linha; um valor corrompido vira vazio (a abertura inválida não quebra a tela). @param {string|undefined} v */
const decodificar = (v) => {
  if (!v) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return "";
  }
};

/**
 * A linha de abertura de um objeto (a ordem fixa: bem, impl, hor, resp, bemn, impln, respn). Campo vazio não entra.
 * @param {{ bemId?: unknown, implementoId?: unknown, horimetro?: unknown, responsavelId?: unknown, bemNome?: unknown, implementoNome?: unknown, responsavelNome?: unknown }} a
 * @returns {string}
 */
export const marcadorDaAbertura = (a) => {
  const pares = [
    ["bem", a?.bemId],
    ["impl", a?.implementoId],
    ["hor", a?.horimetro],
    ["resp", a?.responsavelId],
    ["bemn", a?.bemNome],
    ["impln", a?.implementoNome],
    ["respn", a?.responsavelNome],
  ];
  const partes = pares
    .map(([chave, valor]) => [chave, texto(valor)])
    .filter(([, valor]) => valor !== "")
    .map(([chave, valor]) => `${chave}=${encodeURIComponent(/** @type {string} */ (valor))}`);
  return `[abertura-servico${partes.map((p) => ` ${p}`).join("")}]`;
};

/**
 * A abertura gravada numa observação, ou `null` quando não há linha ou ela está incompleta (sem máquina, sem responsável
 * ou com horímetro que não é decimal canônico). O implemento é opcional.
 * @param {unknown} observacao
 * @returns {{ bemId: string, implementoId: string, horimetro: string, responsavelId: string, bemNome: string, implementoNome: string, responsavelNome: string } | null}
 */
export const lerAbertura = (observacao) => {
  const m = CONTEUDO_DA_LINHA.exec(String(observacao ?? ""));
  if (!m) return null;
  const pares = Object.fromEntries(
    m[1]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), p.slice(i + 1)];
      }),
  );
  const bemId = decodificar(pares.bem);
  const horimetro = decodificar(pares.hor);
  const responsavelId = decodificar(pares.resp);
  if (!bemId || !responsavelId || !ehCanonico(horimetro)) return null;
  return {
    bemId,
    implementoId: decodificar(pares.impl),
    horimetro,
    responsavelId,
    bemNome: decodificar(pares.bemn),
    implementoNome: decodificar(pares.impln),
    responsavelNome: decodificar(pares.respn),
  };
};

/**
 * O texto da pessoa numa observação: tudo menos a primeira linha de abertura (sem ela, a observação inteira).
 * @param {unknown} observacao
 */
export const textoDaObservacao = (observacao) => {
  const s = String(observacao ?? "");
  const m = LINHA_DA_ABERTURA.exec(s);
  return m ? s.slice(m[0].length) : s;
};

/**
 * A observação com a abertura na primeira linha e o texto da pessoa depois (o texto existente é preservado).
 * @param {unknown} observacao a observação atual (pode já ter uma linha de abertura, que é trocada)
 * @param {Parameters<typeof marcadorDaAbertura>[0]} abertura
 */
export const observacaoComAbertura = (observacao, abertura) => {
  const marca = marcadorDaAbertura(abertura);
  const resto = textoDaObservacao(observacao);
  return resto.trim() ? `${marca}\n${resto}` : marca;
};

/**
 * Horímetro digitado em pt-BR ("1.245,0") → canônico ("1245.0"). Vazio, negativo ou sem formato de número → `null`.
 * @param {unknown} digitado
 * @returns {string | null}
 */
export const parseHorimetroPtBr = (digitado) => {
  const lida = lerNumeroLocal(texto(digitado), "pt-BR", { casas: 4, inteiros: 10 });
  if (!lida.ok || lida.valor === undefined) return null;
  return lida.valor.includes(".") ? lida.valor : `${lida.valor}.0`;
};

/**
 * Horímetro canônico → texto pt-BR com uma casa no mínimo ("1245.0" → "1.245,0"). Sem valor canônico, "".
 * @param {unknown} canonico
 */
export const formatarHorimetro = (canonico) => (ehCanonico(canonico) ? formatarNumero(/** @type {string} */ (canonico), { locale: "pt-BR", casasMin: 1, casasMax: 4 }) : "");

/**
 * Os erros da abertura por campo (vazio = válida). A operação só é exigida quando `pedirOperacao` (o tipo tem mais de uma).
 * O horímetro é o TEXTO do campo (pt-BR), não o canônico.
 * @param {{ operacaoId?: unknown, pedirOperacao?: boolean, bemId?: unknown, horimetro?: unknown, responsavelId?: unknown }} p
 * @returns {Partial<Record<"operacaoId" | "bemId" | "horimetro" | "responsavelId", string>>}
 */
export const validarAbertura = ({ operacaoId, pedirOperacao = false, bemId, horimetro, responsavelId } = {}) => {
  /** @type {Partial<Record<"operacaoId" | "bemId" | "horimetro" | "responsavelId", string>>} */
  const erros = {};
  if (pedirOperacao && !texto(operacaoId)) erros.operacaoId = "Escolha a operação.";
  if (!texto(bemId)) erros.bemId = "Escolha a máquina.";
  if (parseHorimetroPtBr(horimetro) === null) erros.horimetro = "Informe o horímetro inicial.";
  if (!texto(responsavelId)) erros.responsavelId = "Escolha o responsável.";
  return erros;
};

/**
 * A abertura mais recente das observações de uma atividade (a lista de apontamentos, em qualquer ordem). Cancelados
 * não contam; no mesmo dia, vale o primeiro da lista. Sem linha de abertura, `null`.
 * @param {unknown} itens
 */
export const aberturaDosApontamentos = (itens) => {
  const lista = (Array.isArray(itens) ? itens : []).filter((a) => a && typeof a === "object" && a.status !== "CANCELADO");
  const ordenados = [...lista].sort((a, b) => String(b.data_operacional ?? "").localeCompare(String(a.data_operacional ?? "")));
  for (const apontamento of ordenados) {
    const abertura = lerAbertura(apontamento.observacao);
    if (abertura) return abertura;
  }
  return null;
};
