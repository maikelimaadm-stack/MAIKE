/**
 * D-PROD-334 — a "Carga de insumo" do serviço aberto (tela 06 da maquete): regras PURAS, sem React e sem rede.
 *
 * A carga é o número do produto (ou da mistura) colocado no implemento de UMA vez. Ela é numerada por serviço e por dia
 * (`proximaCarga`) e gravada no campo `jato` que a linha de produto já tem (D-PROD-283/293): o nome do campo no fio NÃO
 * muda; só a palavra visível passou a ser "Carga". Nada aqui conta estoque: a baixa é do servidor.
 *
 * O horímetro digitado na carga é opcional e vai no marcador `[carga hor=<canônico>]`, no início da OBSERVAÇÃO de cada
 * linha da carga (sem migration). Não há conferência de salto contra a leitura da máquina.
 */
import { comparar, ehCanonico } from "./dinheiroDecimal.js";
import { confirmadosDoDia } from "./atividadeApontamentoRegras.js";
import { corpoDaLinhaProduto } from "./atividadeLinhasRegras.js";

/** O marcador no início da observação: `[carga hor=1245.0]`. O horímetro é canônico (ponto decimal). */
const MARCADOR_DA_CARGA = /^\[carga hor=([0-9]+(?:\.[0-9]+)?)\](?:\r?\n|$)/;

/**
 * O número da carga de uma linha (`jato`): inteiro positivo, vindo como número ou como texto ("3"). Outro valor, 0.
 * @param {unknown} v
 * @returns {number}
 */
const numeroDaCarga = (v) => {
  if (Number.isInteger(v) && /** @type {number} */ (v) > 0) return /** @type {number} */ (v);
  if (typeof v === "string" && /^[1-9]\d*$/.test(v)) return Number(v);
  return 0;
};

/**
 * O número da próxima carga do dia: a maior carga entre as linhas de PRODUTO CONFIRMADAS dos apontamentos CONFIRMADOS de
 * `dia`, mais 1. Sem linha de carga no dia, 1. Canceladas e outros dias não contam.
 * @param {any[]} apontamentos a lista de apontamentos da atividade (qualquer ordem)
 * @param {string} dia o "hoje" da fazenda (AAAA-MM-DD)
 * @returns {number}
 */
export const proximaCarga = (apontamentos, dia) => {
  let maior = 0;
  for (const ap of confirmadosDoDia(apontamentos, dia)) {
    const linhas = Array.isArray(ap?.produtos) ? ap.produtos : [];
    for (const l of linhas) {
      if (!l || typeof l !== "object" || l.status !== "CONFIRMADO") continue;
      maior = Math.max(maior, numeroDaCarga(l.jato));
    }
  }
  return maior + 1;
};

/** O título da carga na janela e em "Lançado hoje". @param {number} n */
export const tituloDaCarga = (n) => `Carga ${n}`;

/**
 * A linha de apoio da carga: "Encher o <implemento>"; sem implemento, "Carga de insumo".
 * @param {unknown} implementoNome
 * @returns {string}
 */
export const subDaCarga = (implementoNome) => {
  const nome = typeof implementoNome === "string" ? implementoNome.trim() : "";
  return nome ? `Encher o ${nome}` : "Carga de insumo";
};

/**
 * O marcador de horímetro da carga, para a observação da linha. Sem horímetro (ou inválido), `null` (a observação fica
 * vazia). O valor entra canônico ("1245.0"); o texto pt-BR é convertido antes, por `parseHorimetroPtBr`.
 * @param {unknown} horimetroCanonico
 * @returns {string | null}
 */
export const marcadorDaCarga = (horimetroCanonico) => (ehCanonico(horimetroCanonico) ? `[carga hor=${horimetroCanonico}]` : null);

/**
 * O horímetro gravado na observação de uma linha de carga, ou `null` quando não há marcador (ou ele está malformado).
 * Tolerante: qualquer texto sem o marcador exato devolve `null`; o texto depois do marcador é da pessoa e não entra.
 * @param {unknown} observacao
 * @returns {{ horimetro: string } | null}
 */
export const lerCarga = (observacao) => {
  const m = MARCADOR_DA_CARGA.exec(String(observacao ?? ""));
  if (!m || !ehCanonico(m[1])) return null;
  return { horimetro: m[1] };
};

/**
 * O apontamento CONFIRMADO de `dia` que recebe as cargas do dia (o mais recente, se houver mais de um). Sem ele, `null`
 * (a primeira gravação do dia cria o apontamento).
 * @param {any[]} apontamentos
 * @param {string} dia
 * @returns {any | null}
 */
export const apontamentoDeHoje = (apontamentos, dia) => confirmadosDoDia(apontamentos, dia)[0] ?? null;

/**
 * Os corpos das linhas de produto de UMA carga (formulário já validado). Cada item é um formulário de linha de produto
 * (`produto`, `local_estoque_id`, `quantidade`); a carga vai em `jato` e o marcador do horímetro na observação.
 * Sem conversão de unidade: a quantidade digitada já é na unidade de estoque (D-PROD-310 não se aplica aqui).
 * @param {any[]} itens
 * @param {{ carga: number, horimetro?: string | null }} opcoes `horimetro` canônico ou nulo
 * @returns {Array<Record<string, any>>}
 */
export const linhasDaCarga = (itens, { carga, horimetro = null }) => {
  const marcador = marcadorDaCarga(horimetro);
  return (Array.isArray(itens) ? itens : []).map((item) => corpoDaLinhaProduto({ ...item, unidade: "", jato: carga, observacao: marcador ?? "" }));
};

/**
 * O local com MAIS saldo disponível (o escolhido sozinho quando há mais de um com saldo). Sem local, `""`.
 * @param {Array<{ local_estoque_id?: unknown, disponivel?: unknown }>} locais
 * @returns {string}
 */
export const localMaisCheio = (locais) => {
  let melhor = null;
  for (const l of Array.isArray(locais) ? locais : []) {
    if (!l || l.local_estoque_id == null) continue;
    const disponivel = ehCanonico(l.disponivel) ? String(l.disponivel) : "0";
    if (melhor === null || comparar(disponivel, melhor.disponivel) > 0) melhor = { local_estoque_id: String(l.local_estoque_id), disponivel };
  }
  return melhor ? melhor.local_estoque_id : "";
};
