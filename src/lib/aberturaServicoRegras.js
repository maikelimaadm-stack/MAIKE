/**
 * D-PROD-332 — a ABERTURA de um serviço no "Diário das atividades" (só a abertura: tipo → máquina, implemento, horímetro
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
import { comparar, ehCanonico, formatarNumero, lerNumeroLocal, somar, subtrair } from "./dinheiroDecimal.js";
import { confirmadosDoDia, normalizarPaginaDeOpcoes } from "./atividadeApontamentoRegras.js";
import { lerErroGestao } from "./gestaoErros.js";
import { rotuloDaUnidade } from "./abastecimentoRegras.js";
import { lerCarga } from "./cargaInsumoRegras.js";

/**
 * D-PROD-348: o início da linha de marcador (abertura, encerramento OU reabertura de serviço), com o fechamento `]` e a
 * quebra de linha (ou o fim do texto). Os prefixos são diferentes, então uma linha nunca é lida como outra.
 */
const LINHA_DO_MARCADOR = /^\[(?:(?:abertura|encerramento|reabertura)-servico|producao-encerramento)[^\]\n]*\](?:\r?\n|$)/;
/** D-PROD-352 (item 2): a linha da produção gravada no encerramento, `[producao-encerramento chave=<chave>]`. */
const CONTEUDO_DA_PRODUCAO = /^\[producao-encerramento((?: [a-z]+=[^\s\]]*)*)\](?:\r?\n|$)/;
/** O início da linha de abertura, com o fechamento `]` e a quebra de linha (ou o fim do texto). */
const LINHA_DA_ABERTURA = /^\[abertura-servico[^\]\n]*\](?:\r?\n|$)/;
/** A linha inteira, com os pares `chave=valor` (só a 1ª linha conta). */
const CONTEUDO_DA_LINHA = /^\[abertura-servico((?: [a-z]+=[^\s\]]*)*)\](?:\r?\n|$)/;
/** D-PROD-348: a linha inteira do encerramento de serviço (só a 1ª linha conta). */
const CONTEUDO_DO_ENCERRAMENTO = /^\[encerramento-servico((?: [a-z]+=[^\s\]]*)*)\](?:\r?\n|$)/;
/** D-PROD-348 (item 4): a linha inteira da reabertura de serviço (só a 1ª linha conta). */
const CONTEUDO_DA_REABERTURA = /^\[reabertura-servico((?: [a-z]+=[^\s\]]*)*)\](?:\r?\n|$)/;

/**
 * Os pares `chave=valor` de uma linha de marcador, já decodificados. Valor corrompido vira vazio (ver `decodificar`).
 * @param {string} conteudo a parte entre o nome do marcador e o `]`, com o espaço inicial de cada par
 * @returns {Record<string, string>}
 */
const paresDaLinha = (conteudo) =>
  Object.fromEntries(
    conteudo
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), p.slice(i + 1)];
      }),
  );

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
  const pares = paresDaLinha(m[1]);
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
 * O texto da pessoa numa observação: tudo menos a primeira linha de marcador (abertura, encerramento, reabertura ou a
 * produção do encerramento, D-PROD-352; sem ela, a observação inteira).
 * @param {unknown} observacao
 */
export const textoDaObservacao = (observacao) => {
  const s = String(observacao ?? "");
  const m = LINHA_DO_MARCADOR.exec(s);
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

// ─── Encerramento de uma frente (D-PROD-348) ─────

/**
 * D-PROD-348: a linha de encerramento de uma frente, no mesmo formato da abertura (sem responsável):
 * `[encerramento-servico bem=<id> impl=<id> hor=<decimal> bemn=<enc> impln=<enc>]`. A ordem é fixa (bem, impl, hor,
 * bemn, impln) e campo vazio não entra. O horímetro é o canônico (`parseHorimetroPtBr`), como na abertura.
 * @param {{ bemId?: unknown, implementoId?: unknown, horimetro?: unknown, bemNome?: unknown, implementoNome?: unknown }} e
 * @returns {string}
 */
export const marcadorDoEncerramento = (e) => {
  const pares = [
    ["bem", e?.bemId],
    ["impl", e?.implementoId],
    ["hor", e?.horimetro],
    ["bemn", e?.bemNome],
    ["impln", e?.implementoNome],
  ];
  const partes = pares
    .map(([chave, valor]) => [chave, texto(valor)])
    .filter(([, valor]) => valor !== "")
    .map(([chave, valor]) => `${chave}=${encodeURIComponent(/** @type {string} */ (valor))}`);
  return `[encerramento-servico${partes.map((p) => ` ${p}`).join("")}]`;
};

/**
 * D-PROD-348 (item 4): a linha de REABERTURA de uma frente, com a mesma chave (máquina + implemento) da abertura e do
 * encerramento: `[reabertura-servico bem=<id> impl=<id>]`. Sem horímetro e sem responsável: o cartão segue com a
 * abertura original. Campo vazio não entra (implemento vazio = frente sem implemento).
 * @param {{ bemId?: unknown, implementoId?: unknown }} r
 * @returns {string}
 */
export const marcadorDaReabertura = (r) => {
  const partes = [
    ["bem", r?.bemId],
    ["impl", r?.implementoId],
  ]
    .map(([chave, valor]) => [chave, texto(valor)])
    .filter(([, valor]) => valor !== "")
    .map(([chave, valor]) => `${chave}=${encodeURIComponent(/** @type {string} */ (valor))}`);
  return `[reabertura-servico${partes.map((p) => ` ${p}`).join("")}]`;
};

/**
 * D-PROD-348 (item 4): a reabertura gravada numa observação, ou `null` quando não há a linha ou ela não tem máquina. Só a
 * 1ª linha conta. O implemento é opcional (vazio = frente sem implemento).
 * @param {unknown} observacao
 * @returns {{ bemId: string, implementoId: string } | null}
 */
export const lerReabertura = (observacao) => {
  const m = CONTEUDO_DA_REABERTURA.exec(String(observacao ?? ""));
  if (!m) return null;
  const pares = paresDaLinha(m[1]);
  const bemId = decodificar(pares.bem);
  if (!bemId) return null;
  return { bemId, implementoId: decodificar(pares.impl) };
};

/**
 * D-PROD-348: o encerramento gravado numa observação, ou `null` quando não há linha ou ela está incompleta (sem máquina
 * ou com horímetro que não é decimal canônico). Só a 1ª linha conta e uma linha de abertura nunca vale aqui. O implemento
 * é opcional.
 * @param {unknown} observacao
 * @returns {{ bemId: string, implementoId: string, horimetro: string, bemNome: string, implementoNome: string } | null}
 */
export const lerEncerramento = (observacao) => {
  const m = CONTEUDO_DO_ENCERRAMENTO.exec(String(observacao ?? ""));
  if (!m) return null;
  const pares = paresDaLinha(m[1]);
  const bemId = decodificar(pares.bem);
  const horimetro = decodificar(pares.hor);
  if (!bemId || !ehCanonico(horimetro)) return null;
  return {
    bemId,
    implementoId: decodificar(pares.impl),
    horimetro,
    bemNome: decodificar(pares.bemn),
    implementoNome: decodificar(pares.impln),
  };
};

/**
 * D-PROD-348: a observação com o encerramento na primeira linha e o texto da pessoa depois. Troca a linha de marcador
 * que já estiver lá (abertura ou encerramento), como `observacaoComAbertura`.
 * @param {unknown} observacao
 * @param {Parameters<typeof marcadorDoEncerramento>[0]} encerramento
 */
export const observacaoComEncerramento = (observacao, encerramento) => {
  const marca = marcadorDoEncerramento(encerramento);
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
 * D-PROD-332 (emenda): o capim do Plantio de pastagem (`pedirCapim`) é exigido só quando pedido; sem ele, não há erro.
 * @param {{ operacaoId?: unknown, pedirOperacao?: boolean, bemId?: unknown, horimetro?: unknown, responsavelId?: unknown, pedirCapim?: boolean, culturaId?: unknown }} p
 * @returns {Partial<Record<"operacaoId" | "bemId" | "horimetro" | "responsavelId" | "culturaId", string>>}
 */
export const validarAbertura = ({ operacaoId, pedirOperacao = false, bemId, horimetro, responsavelId, pedirCapim = false, culturaId } = {}) => {
  /** @type {Partial<Record<"operacaoId" | "bemId" | "horimetro" | "responsavelId" | "culturaId", string>>} */
  const erros = {};
  if (pedirOperacao && !texto(operacaoId)) erros.operacaoId = "Escolha a operação.";
  if (!texto(bemId)) erros.bemId = "Escolha a máquina.";
  if (parseHorimetroPtBr(horimetro) === null) erros.horimetro = "Informe o horímetro inicial.";
  if (!texto(responsavelId)) erros.responsavelId = "Escolha o responsável.";
  if (pedirCapim && !texto(culturaId)) erros.culturaId = "Escolha o capim.";
  return erros;
};

// ─── Envio da abertura (D-PROD-332, emenda: máquina no contrato, fallback e paginação) ─────

/**
 * O erro é "campo desconhecido" (`REQUEST_VALIDATION_FAILED`, razão `unknown_field`) no campo `campo`: o servidor ainda não
 * aceita esse campo (o front chegou antes do backend). Lê o código, o campo e a razão com `lerErroGestao`.
 * @param {unknown} erro
 * @param {string} campo
 */
export const ehCampoDesconhecido = (erro, campo) => {
  const { code, field, reason } = lerErroGestao(erro);
  const publico = typeof /** @type {any} */ (erro)?.code === "string" ? /** @type {any} */ (erro).code : null;
  // O cliente HTTP traduz `REQUEST_VALIDATION_FAILED` para `API_INVALID_ARGUMENT` e guarda o corpo em `cause`
  // (`lerErroGestao` lê o código original da causa). Os dois códigos valem.
  const recusa = code === "REQUEST_VALIDATION_FAILED" || code === "API_INVALID_ARGUMENT" || publico === "REQUEST_VALIDATION_FAILED" || publico === "API_INVALID_ARGUMENT";
  return recusa && reason === "unknown_field" && field === campo;
};

/** Páginas no máximo ao juntar as opções (40 × 50 itens = 2.000; acima disso, o cadastro está fora do uso da tela). */
export const LIMITE_DE_PAGINAS_DAS_OPCOES = 40;

/**
 * Junta TODAS as páginas de uma lista de opções (bens, implementos, operadores): a 1ª chamada é `listar({})`, as seguintes
 * `listar({ cursor })`, enquanto `has_more` for verdadeiro (com o limite de páginas). Devolve a lista inteira.
 * @param {(opts: { cursor?: string }) => Promise<unknown>} listar
 * @param {number} [limitePaginas]
 * @returns {Promise<{ itens: any[], has_more: false, next_cursor: null }>}
 */
export const lerTodasAsPaginas = async (listar, limitePaginas = LIMITE_DE_PAGINAS_DAS_OPCOES) => {
  /** @type {any[]} */
  const itens = [];
  let cursor = null;
  for (let pagina = 0; pagina < limitePaginas; pagina++) {
    const atual = normalizarPaginaDeOpcoes(await listar(cursor ? { cursor } : {}));
    itens.push(...atual.itens);
    if (!atual.has_more || !atual.next_cursor) break;
    cursor = atual.next_cursor;
  }
  return { itens, has_more: false, next_cursor: null };
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

// ─── Frentes: uma abertura por máquina + implemento (D-PROD-341, emenda) ─────

/**
 * A chave de uma frente: a máquina e o implemento da abertura (`bemId|implementoId`). Implemento vazio vale como chave
 * própria (`bem-7|`), então a mesma máquina sem implemento e com um implemento são frentes diferentes.
 * @param {{ bemId?: unknown, implementoId?: unknown }} abertura
 * @returns {string}
 */
export const chaveDaFrente = (abertura) => `${texto(abertura?.bemId)}|${texto(abertura?.implementoId)}`;

/** Os apontamentos que não foram cancelados (qualquer ordem de entrada). @param {unknown} itens @returns {any[]} */
const naoCancelados = (itens) => (Array.isArray(itens) ? itens : []).filter((a) => a && typeof a === "object" && a.status !== "CANCELADO");

/**
 * D-PROD-348 (item 4): os apontamentos não cancelados em ORDEM CRONOLÓGICA (o dia, depois a hora de criação, depois a
 * posição na lista, que o servidor já devolve na ordem de criação dentro do dia). O último da lista é o mais recente.
 * @param {unknown} itens
 * @returns {any[]}
 */
const emOrdemCronologica = (itens) =>
  naoCancelados(itens)
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        String(x.a.data_operacional ?? "").localeCompare(String(y.a.data_operacional ?? "")) ||
        String(x.a.createdAt ?? "").localeCompare(String(y.a.createdAt ?? "")) ||
        x.i - y.i,
    )
    .map(({ a }) => a);

/**
 * As frentes de uma atividade: os apontamentos não cancelados agrupados pela chave (`chaveDaFrente`) da abertura da linha
 * de cada um. Cada frente sai uma vez, com a `abertura` mais recente dela e o `inicio` (o menor `data_operacional` com a
 * chave). Ordem: o início, depois a chave. Sem abertura nenhuma, `[]`.
 *
 * D-PROD-348 (item 4, reabertura): a frente está ENCERRADA só se o ÚLTIMO marcador dela (abertura, encerramento ou
 * reabertura, em ordem cronológica) for um encerramento. Uma reabertura depois do encerramento reabre a frente, e um
 * encerramento depois dela encerra de novo. Uma abertura nova também deixa a frente aberta. A reabertura não traz horímetro
 * nem responsável: o cartão segue com a abertura original. Encerramento ou reabertura de uma chave SEM abertura antes dela
 * é ignorado (não cria frente).
 *
 * Cada frente diz: `encerrada` (boolean), `horimetroFinal` (canônico, "" se aberta) e `fim` (o dia do último encerramento,
 * "" se aberta).
 * @param {unknown} itens a lista de apontamentos da atividade (qualquer ordem)
 * @returns {Array<{ chave: string, abertura: NonNullable<ReturnType<typeof lerAbertura>>, inicio: string, encerrada: boolean, horimetroFinal: string, fim: string }>}
 */
export const frentesDosApontamentos = (itens) => {
  /** @type {Map<string, { chave: string, abertura: any, inicio: string, encerrada: boolean, horimetroFinal: string, fim: string }>} */
  const porChave = new Map();
  for (const ap of emOrdemCronologica(itens)) {
    const dia = String(ap?.data_operacional ?? "");
    const encerramento = lerEncerramento(ap.observacao);
    if (encerramento) {
      const frente = porChave.get(chaveDaFrente(encerramento));
      if (frente) Object.assign(frente, { encerrada: true, horimetroFinal: encerramento.horimetro, fim: dia });
      continue;
    }
    const reabertura = lerReabertura(ap.observacao);
    if (reabertura) {
      const frente = porChave.get(chaveDaFrente(reabertura));
      if (frente) Object.assign(frente, { encerrada: false, horimetroFinal: "", fim: "" });
      continue;
    }
    const abertura = lerAbertura(ap.observacao);
    if (!abertura) continue;
    const chave = chaveDaFrente(abertura);
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, { chave, abertura, inicio: dia, encerrada: false, horimetroFinal: "", fim: "" });
    } else {
      // Abertura nova (a mais recente, por ordem cronológica) deixa a frente aberta e vira a abertura do cartão.
      Object.assign(atual, { abertura, encerrada: false, horimetroFinal: "", fim: "" });
      if (dia && (!atual.inicio || dia < atual.inicio)) atual.inicio = dia;
    }
  }
  return [...porChave.values()].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.chave.localeCompare(b.chave));
};

/**
 * Os apontamentos (não cancelados) cuja observação tem a abertura com a chave dada: só os desta frente. Sem chave que case,
 * `[]`. A ordem é a da lista recebida (quem precisa ordenar, ordena).
 * @param {unknown} itens
 * @param {string | null} chave
 * @returns {any[]}
 */
export const apontamentosDaFrente = (itens, chave) =>
  naoCancelados(itens).filter((ap) => {
    const abertura = lerAbertura(ap.observacao);
    return abertura !== null && chaveDaFrente(abertura) === chave;
  });

/**
 * D-PROD-352 (item 2): a observação da produção gravada no "Encerrar atividade" (um apontamento SÓ com a quantidade
 * produzida). A chave é a da TENTATIVA de encerramento: gravada uma vez, uma nova tentativa que ache essa linha na lista
 * não grava a produção de novo (o servidor soma `quantidade_produzida_dia`, então dobraria).
 * @param {string} chave
 * @returns {string}
 */
export const marcadorDaProducaoEncerramento = (chave) => `[producao-encerramento chave=${encodeURIComponent(texto(chave))}]`;

/**
 * A chave da linha de produção de uma observação, ou `null` sem linha (ou com a chave vazia). Só a 1ª linha conta.
 * @param {unknown} observacao
 * @returns {string | null}
 */
export const chaveDaProducaoEncerramento = (observacao) => {
  const m = CONTEUDO_DA_PRODUCAO.exec(String(observacao ?? ""));
  if (!m) return null;
  return decodificar(paresDaLinha(m[1]).chave) || null;
};

/**
 * D-PROD-352 (item 2): se a lista de apontamentos (qualquer ordem) já tem a produção com essa chave, não cancelada. Sem
 * chave, `false`.
 * @param {unknown} itens
 * @param {string | null} chave
 * @returns {boolean}
 */
export const producaoEncerramentoGravada = (itens, chave) => Boolean(chave) && naoCancelados(itens).some((ap) => chaveDaProducaoEncerramento(ap.observacao) === chave);

/**
 * D-PROD-348: os erros do encerramento por campo (vazio = válido). O horímetro final é o TEXTO do campo (pt-BR) e não
 * pode ser menor que o inicial da frente. O inicial pode vir canônico (a abertura guarda assim) ou, se não for, a
 * comparação é pulada. Igual ao inicial é válido.
 * @param {{ horimetroFinal?: unknown, horimetroInicial?: unknown }} p
 * @returns {{ horimetroFinal?: string }}
 */
export const validarEncerramento = ({ horimetroFinal, horimetroInicial } = {}) => {
  /** @type {{ horimetroFinal?: string }} */
  const erros = {};
  const final = parseHorimetroPtBr(horimetroFinal);
  if (final === null) {
    erros.horimetroFinal = "Informe o horímetro final.";
    return erros;
  }
  const inicial = ehCanonico(horimetroInicial) ? /** @type {string} */ (horimetroInicial) : null;
  if (inicial !== null && comparar(final, inicial) < 0) {
    erros.horimetroFinal = `O horímetro final não pode ser menor que o inicial (${formatarHorimetro(inicial)}).`;
  }
  return erros;
};

/**
 * D-PROD-348: quantas frentes estão abertas e quantas foram encerradas, e o total. Recebe a lista de `frentesDosApontamentos`.
 * @param {unknown} frentes
 * @returns {{ abertas: number, encerradas: number, total: number }}
 */
export const resumoDasFrentes = (frentes) => {
  const lista = Array.isArray(frentes) ? frentes : [];
  const encerradas = lista.filter((f) => f && f.encerrada === true).length;
  return { abertas: lista.length - encerradas, encerradas, total: lista.length };
};

/**
 * D-PROD-348: o texto do cabeçalho com a quantidade de frentes abertas (`abertas` é o número, de `resumoDasFrentes`).
 * @param {number} abertas
 * @returns {string}
 */
export const textoDasMaquinasEmCampo = (abertas) => {
  const n = Number.isFinite(Number(abertas)) ? Math.max(0, Math.trunc(Number(abertas))) : 0;
  if (n === 0) return "Sem máquina em campo";
  if (n === 1) return "1 máquina em campo";
  return `${n} máquinas em campo`;
};

// ─── Serviço aberto: "Lançado hoje" (D-PROD-332, emenda da tela 05) ─────

/** Unidade de quem é medido por tempo (a linha de mão de obra): "8 h", "1 diária", "2 tarefas". */
const UNIDADE_DA_MEDIDA = Object.freeze({ HORA: "h", DIARIA: "diária", TAREFA: "tarefa" });

/** Quantidade canônica ("1000.0000") → pt-BR ("1.000"); sem valor, "". @param {unknown} v */
const quantidadeTexto = (v) => (ehCanonico(v) ? formatarNumero(/** @type {string} */ (v), { locale: "pt-BR", casasMin: 0, casasMax: 4 }) : "");

/** A hora HH:MM de um instante no fuso da fazenda; sem instante válido ou fuso, "". @param {unknown} iso @param {string|null} fuso */
export const horaNoFuso = (iso, fuso) => {
  const ms = typeof iso === "string" || typeof iso === "number" ? Date.parse(String(iso)) : Number.NaN;
  if (!Number.isFinite(ms) || !fuso) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
  } catch {
    return "";
  }
};

/**
 * Os lançamentos CONFIRMADOS de UM dia da atividade, uma linha por linha lançada (produto, máquina, mão de obra e serviço
 * de terceiro), na ordem do horário. Sem valor em R$: a tela de campo não mostra custo. Só entram apontamentos
 * CONFIRMADO do `dia` e linhas CONFIRMADO. A hora é da LINHA (`createdAt`, com o do apontamento como reserva), no fuso
 * da fazenda. Quantidade vazia sai vazia; o sinal da linha não é conferido aqui (o servidor já validou).
 *
 * @param {any[]} apontamentos a lista de apontamentos da atividade (`itensDaLista`), em qualquer ordem
 * @param {string} dia o "hoje" da fazenda (AAAA-MM-DD)
 * @param {string|null} fuso o fuso IANA da fazenda
 * @returns {Array<{ chave: string, hora: string, tipo: "insumo"|"maquina"|"mao_obra"|"servico", titulo: string, sub: string, quantidade: string, instante: number }>}
 */
export const lancamentosDoDia = (apontamentos, dia, fuso) => {
  /** @type {ReturnType<typeof lancamentosDoDia>} */
  const linhas = [];
  const confirmada = (/** @type {any} */ l) => Boolean(l) && typeof l === "object" && l.status === "CONFIRMADO";
  /** @param {unknown} v */
  const sem = (v) => (v == null ? "" : String(v).trim());
  for (const ap of confirmadosDoDia(apontamentos, dia)) {
    /**
     * @param {"insumo"|"maquina"|"mao_obra"|"servico"} tipo @param {any} l @param {string} titulo @param {string} sub @param {string} quantidade
     */
    const monta = (tipo, l, titulo, sub, quantidade) => {
      const iso = l.createdAt ?? ap.createdAt;
      const ms = Date.parse(String(iso ?? ""));
      linhas.push({
        chave: `${ap.id}:${tipo}:${l.id ?? linhas.length}`,
        hora: horaNoFuso(iso, fuso),
        tipo,
        titulo,
        sub,
        quantidade,
        instante: Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY,
      });
    };
    const junta = (...partes) => partes.filter(Boolean).join(" ");
    for (const l of (ap.produtos ?? []).filter(confirmada)) {
      // D-PROD-334: a palavra visível é "Carga" (o campo `jato` do fio não muda).
      const titulo = l.jato != null ? `Insumo · Carga ${l.jato}` : "Insumo";
      monta("insumo", l, titulo, sem(l.produto?.nome), junta(quantidadeTexto(l.quantidade_lancamento ?? l.quantidade), sem(l.unidade_lancamento) || rotuloDaUnidade(l.unidade) || sem(l.unidade)));
    }
    for (const l of (ap.maquinas ?? []).filter(confirmada)) {
      // D-PROD-365: a linha com as duas leituras mostra "inicial → final" (a conta das horas); sem elas, o nome do bem.
      const leituras = ehCanonico(l.leitura_inicial) && ehCanonico(l.leitura_final) ? `${formatarHorimetro(l.leitura_inicial)} → ${formatarHorimetro(l.leitura_final)}` : "";
      const sub = leituras || sem(l.bem?.nome) || sem(l.implemento?.nome);
      monta("maquina", l, "Máquina", sub, junta(quantidadeTexto(l.quantidade_uso), sem(l.medidor_unidade)));
    }
    for (const l of (ap.mao_obra ?? []).filter(confirmada)) {
      const medida = sem(l.tipo_medida);
      const unidade = UNIDADE_DA_MEDIDA[/** @type {keyof typeof UNIDADE_DA_MEDIDA} */ (medida)] ?? medida.toLowerCase();
      monta("mao_obra", l, "Mão de obra", sem(l.parceiro?.nome), junta(quantidadeTexto(l.quantidade), unidade));
    }
    for (const l of (ap.servicos ?? []).filter(confirmada)) {
      monta("servico", l, "Serviço de terceiro", sem(l.servico?.nome) || sem(l.parceiro?.nome), junta(quantidadeTexto(l.quantidade), sem(l.unidade)));
    }
  }
  return linhas.sort((a, b) => a.instante - b.instante);
};

// ─── Horas da frente no dia (D-PROD-348, item 1: o "Hoje" do cartão da frente) ─────

/** A escala do horímetro e das horas: 4 casas (a mesma de `parseHorimetroPtBr`). Mais casas que isso não entram. */
const CASAS_DO_HORIMETRO = 4;
/** Zero na escala do horímetro. */
const ZERO_HORAS = "0.0000";

/** `a − b` na escala do horímetro; `null` se algum valor não couber nela (sem arredondar em silêncio). @param {string} a @param {string} b */
const diferencaSegura = (a, b) => {
  try {
    return subtrair(a, b, CASAS_DO_HORIMETRO);
  } catch {
    return null;
  }
};

/** A soma das parcelas na escala do horímetro; `null` se alguma não couber nela. @param {string[]} parcelas */
const somaSegura = (parcelas) => {
  try {
    return somar(parcelas, CASAS_DO_HORIMETRO);
  } catch {
    return null;
  }
};

/**
 * Os horímetros lidos numa observação de apontamento: a leitura FINAL das linhas de máquina confirmadas e o marcador
 * `[carga hor=…]` das linhas de produto confirmadas. Só valores canônicos.
 * @param {any} ap
 * @returns {string[]}
 */
const horimetrosLidosNoApontamento = (ap) => {
  /** @type {string[]} */
  const lidos = [];
  for (const l of Array.isArray(ap?.maquinas) ? ap.maquinas : []) {
    if (l?.status === "CONFIRMADO" && ehCanonico(l.leitura_final)) lidos.push(l.leitura_final);
  }
  for (const l of Array.isArray(ap?.produtos) ? ap.produtos : []) {
    if (l?.status !== "CONFIRMADO") continue;
    const carga = lerCarga(l.observacao);
    if (carga) lidos.push(carga.horimetro);
  }
  return lidos;
};

/**
 * D-PROD-348 (item 1): as horas que a FRENTE trabalhou no dia `dia` (o "Hoje" do cartão), em decimal canônico ("4.5000"),
 * ou `null` quando não há o que dizer ("Nada hoje").
 *
 * - Sem nenhum lançamento CONFIRMADO da frente no dia → `null`.
 * - Se alguma linha de máquina confirmada do dia tem leitura inicial E final, soma (final − inicial) dessas linhas (mais o uso digitado das linhas "sem medidor", D-PROD-365). Linha
 *   em que o medidor anda para trás não entra.
 * - Senão, usa os horímetros lidos no dia (a leitura final das máquinas e o `[carga hor=…]` das cargas): o MAIOR deles menos
 *   o último lido antes do dia (ou, se não houver, o horímetro inicial da abertura). Horímetro que não anda → "0.0000".
 * - Sem leitura no dia, ou sem base para comparar, → `null`.
 *
 * `itens` são os apontamentos da atividade (qualquer ordem); a frente é a da chave `chaveDaFrente`.
 * @param {unknown} itens
 * @param {string} chave a chave da frente (`chaveDaFrente` da abertura)
 * @param {string} dia o "hoje" da fazenda (AAAA-MM-DD)
 * @param {unknown} horimetroInicial o horímetro canônico da abertura da frente
 * @returns {string | null}
 */
export const horasDaFrenteNoDia = (itens, chave, dia, horimetroInicial) => {
  const daFrente = apontamentosDaFrente(itens, chave);
  if (lancamentosDoDia(daFrente, dia, null).length === 0) return null;

  const hoje = confirmadosDoDia(daFrente, dia);
  const linhasDeMaquinaHoje = hoje.flatMap((ap) => (Array.isArray(ap.maquinas) ? ap.maquinas : []).filter((l) => l?.status === "CONFIRMADO"));

  const pares = linhasDeMaquinaHoje.filter((l) => ehCanonico(l.leitura_inicial) && ehCanonico(l.leitura_final));
  // Máquina sem contador: a linha guarda só o uso (horas digitadas), sem leituras; entra na soma como está.
  const digitadas = linhasDeMaquinaHoje.filter(
    (l) => !(ehCanonico(l.leitura_inicial) && ehCanonico(l.leitura_final)) && l.sem_medidor === true && ehCanonico(l.quantidade_uso),
  );
  if (pares.length > 0 || digitadas.length > 0) {
    /** @type {string[]} */
    const parcelas = digitadas.map((l) => l.quantidade_uso);
    for (const l of pares) {
      if (comparar(l.leitura_final, l.leitura_inicial) < 0) continue;
      const diferenca = diferencaSegura(l.leitura_final, l.leitura_inicial);
      if (diferenca === null) return null;
      parcelas.push(diferenca);
    }
    return somaSegura(parcelas);
  }

  const lidosHoje = hoje.flatMap(horimetrosLidosNoApontamento);
  if (lidosHoje.length === 0) return null;
  const maiorHoje = lidosHoje.reduce((maior, v) => (comparar(v, maior) > 0 ? v : maior));

  const base = baseDoHorimetroDaFrente(itens, chave, dia, horimetroInicial)?.horimetro ?? null;
  if (base === null) return null;
  if (comparar(maiorHoje, base) <= 0) return ZERO_HORAS;
  return diferencaSegura(maiorHoje, base);
};

/**
 * D-PROD-365: a BASE do horímetro da frente antes do dia `dia` — o MAIOR entre as leituras de dias anteriores (a leitura
 * final das linhas de máquina confirmadas e o `[carga hor=…]` das cargas), o ENCERRAMENTO anterior da frente e as aberturas
 * dela em dias anteriores; sem nada disso, o horímetro inicial da abertura. Só valores canônicos. `origem` diz de onde veio.
 * É a lógica que `horasDaFrenteNoDia` sempre usou (movida para cá sem mudar o resultado).
 * @param {unknown} itens os apontamentos da atividade (qualquer ordem)
 * @param {string} chave a chave da frente (`chaveDaFrente`)
 * @param {string} dia o "hoje" da fazenda (AAAA-MM-DD)
 * @param {unknown} horimetroInicial o horímetro canônico da abertura da frente
 * @returns {{ horimetro: string, origem: "lancamento" | "encerramento" | "abertura" } | null}
 */
export const baseDoHorimetroDaFrente = (itens, chave, dia, horimetroInicial) => {
  const daFrente = apontamentosDaFrente(itens, chave);
  /** @type {{ horimetro: string, origem: "lancamento" | "encerramento" | "abertura" } | null} */
  let base = null;
  for (const ap of daFrente) {
    if (ap?.status !== "CONFIRMADO" || !(String(ap.data_operacional ?? "") < dia)) continue;
    for (const v of horimetrosLidosNoApontamento(ap)) {
      if (base === null || comparar(v, base.horimetro) > 0) base = { horimetro: v, origem: "lancamento" };
    }
  }
  // D-PROD-352 (item 3): o ENCERRAMENTO anterior da frente também é leitura. A reabertura não traz horímetro, então sem ele
  // a frente reaberta hoje partiria da abertura antiga (1000 em vez de 1050). Só de dia ANTES de hoje; as aberturas da mesma
  // frente nesses dias entram pelo mesmo critério (o maior horímetro vence).
  for (const ap of naoCancelados(itens)) {
    if (!(String(ap.data_operacional ?? "") < dia)) continue;
    const encerramento = lerEncerramento(ap.observacao);
    const marcado = encerramento ?? lerAbertura(ap.observacao);
    if (!marcado || chaveDaFrente(marcado) !== chave || !ehCanonico(marcado.horimetro)) continue;
    if (base === null || comparar(marcado.horimetro, base.horimetro) > 0) base = { horimetro: marcado.horimetro, origem: encerramento ? "encerramento" : "abertura" };
  }
  if (base === null && ehCanonico(horimetroInicial)) base = { horimetro: /** @type {string} */ (horimetroInicial), origem: "abertura" };
  return base;
};

/**
 * D-PROD-365: o último horímetro lido pela FRENTE, para a linha de máquina NOVA do dia (a inicial dela): o maior entre a
 * base de `baseDoHorimetroDaFrente` e as leituras das linhas CONFIRMADAS da frente hoje (a 2ª linha do dia parte da 1ª,
 * sem contar duas vezes). Só valores canônicos; `null` sem base.
 * @param {unknown} itens @param {string} chave @param {string} dia @param {unknown} horimetroInicial
 * @returns {{ horimetro: string, origem: "lancamento" | "encerramento" | "abertura" } | null}
 */
export const ultimoHorimetroLidoDaFrente = (itens, chave, dia, horimetroInicial) => {
  let ultimo = baseDoHorimetroDaFrente(itens, chave, dia, horimetroInicial);
  for (const v of confirmadosDoDia(apontamentosDaFrente(itens, chave), dia).flatMap(horimetrosLidosNoApontamento)) {
    if (ultimo === null || comparar(v, ultimo.horimetro) > 0) ultimo = { horimetro: v, origem: "lancamento" };
  }
  return ultimo;
};

/**
 * D-PROD-348 (item 1): o texto do "Hoje" de uma frente. Horas canônicas → "4,5 h" (pt-BR, até 2 casas); sem horas, "Nada hoje".
 * @param {unknown} horas o retorno de `horasDaFrenteNoDia`
 * @returns {string}
 */
export const textoDasHorasHoje = (horas) => (ehCanonico(horas) ? `${formatarNumero(/** @type {string} */ (horas), { locale: "pt-BR", casasMin: 0, casasMax: 2 })} h` : "Nada hoje");
