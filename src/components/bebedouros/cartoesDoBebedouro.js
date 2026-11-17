import { ClipboardList, Droplet, Droplets, Eye, FlaskConical, Sparkles, TestTube, TriangleAlert, Wrench } from "lucide-react";
import { VAZIO, rotuloDoDia } from "@/components/mapa/detalhes-lote/historicoDoPasto";

/*
 * Lançamentos do bebedouro na tela. O resumo do detalhe (os últimos, pela data
 * do lançamento) é a linha do tempo do Detalhes do Lote v12 (D-PROD-220,
 * `diasDoHistorico`); o histórico completo (todos, na ordem do servidor, com o
 * "Excluir") usa o cartão dos históricos do manejo (D-PROD-221,
 * `BebedouroTimeline`). Os dois mostram as MESMAS linhas (`linhasDoLancamento`).
 * Funções puras, sem estado.
 */

/** @param {unknown} value @param {number} [digits] */
export const formatDecimal = (value, digits = 2) =>
  Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** @param {unknown} valor */
export const temTexto = (valor) => valor != null && String(valor).trim() !== "";

/**
 * Texto do cadastro, ou "—". O ponto sem cadastro chega com "-" em campos
 * vazios (montado pelo MapaGeral): também vira "—".
 * @param {unknown} valor
 */
export const textoOuVazio = (valor) => (temTexto(valor) && String(valor).trim() !== "-" ? String(valor) : VAZIO);

/** @param {unknown} valor */
export const numeroValido = (valor) => temTexto(valor) && Number.isFinite(Number(valor));

/** @param {unknown} valor */
export const fmtMoeda = (valor) => `R$ ${formatDecimal(valor)}`;

/**
 * Quantidade ou escore como foram gravados: número em pt-BR (até 2 casas);
 * texto (registro antigo) como está.
 * @param {unknown} valor
 */
export const fmtNumeroLivre = (valor) =>
  numeroValido(valor) ? Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : String(valor).trim();

/**
 * Ícone da linha do tempo por tipo de lançamento (BEBEDOURO_HISTORICO_TIPOS).
 * Limpeza e Inspeção são os do v12; os demais seguem o assunto do tipo.
 * @type {Record<string, import("lucide-react").LucideIcon>}
 */
export const ICONE_DO_TIPO = {
  Limpeza: Sparkles,
  "Inspeção": Eye,
  "Tratamento da água": FlaskConical,
  "Aplicação de produto": FlaskConical,
  "Análise da água": TestTube,
  "Contaminação": TriangleAlert,
  "Manutenção": Wrench,
  Vazamento: Droplets,
  "Troca de boia": Wrench,
  "Troca de encanamento": Wrench,
  Abastecimento: Droplet,
};

/**
 * Status fora do normal (Pendente, Emergencial) ou "" no normal (Concluído) e
 * sem status.
 * @param {any} item
 */
export const statusForaDoNormal = (item) => (temTexto(item?.status) && item.status !== "Concluído" ? String(item.status) : "");

/**
 * Dia do lançamento como no selo de data dos históricos do manejo
 * ("dd/mm/aaaa"), pela parte da data (sem fuso); sem data, "Sem data".
 * @param {unknown} valor `data_lancamento` (AAAA-MM-DD ou ISO)
 */
export function diaDoLancamento(valor) {
  const dia = String(valor ?? "").trim().split("T")[0];
  if (!dia) return "Sem data";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const data = new Date(String(valor));
  return Number.isNaN(data.getTime()) ? dia : data.toLocaleDateString("pt-BR");
}

/**
 * Linhas do cartão de um lançamento: a descrição sempre (o cartão nunca fica
 * vazio); o resto só quando o lançamento tem o dado. O status só aparece fora
 * do normal (Pendente, Emergencial). "Registrado por" é o `responsavel`, que o
 * lançamento grava com o usuário da sessão. `comHora` (histórico completo):
 * a hora do lançamento antes da descrição, quando gravada. `comStatus: false`
 * (histórico completo, D-PROD-221): o status vai para um selo do cartão, não
 * para uma linha.
 * @param {any} item
 * @param {{ comHora?: boolean, comStatus?: boolean }} [opcoes]
 * @returns {Array<{ rotulo: string, valor: string }>}
 */
export function linhasDoLancamento(item, { comHora = false, comStatus = true } = {}) {
  const linhas = [];
  if (comHora && temTexto(item?.hora_lancamento)) linhas.push({ rotulo: "Hora", valor: String(item.hora_lancamento) });
  linhas.push({ rotulo: "Descrição", valor: textoOuVazio(item?.descricao) });
  if (temTexto(item?.responsavel)) linhas.push({ rotulo: "Registrado por", valor: String(item.responsavel) });
  const status = statusForaDoNormal(item);
  if (comStatus && status) linhas.push({ rotulo: "Status", valor: status });
  if (numeroValido(item?.custo)) linhas.push({ rotulo: "Custo", valor: fmtMoeda(item.custo) });
  if (temTexto(item?.produto_utilizado)) linhas.push({ rotulo: "Produto", valor: String(item.produto_utilizado) });
  if (temTexto(item?.quantidade_utilizada)) linhas.push({ rotulo: "Quantidade", valor: fmtNumeroLivre(item.quantidade_utilizada) });
  if (temTexto(item?.qualidade_agua)) linhas.push({ rotulo: "Qualidade da água", valor: String(item.qualidade_agua) });
  if (temTexto(item?.escore_agua)) linhas.push({ rotulo: "Escore da água", valor: fmtNumeroLivre(item.escore_agua) });
  return linhas;
}

/**
 * Dias da linha do tempo do resumo do detalhe: os lançamentos NA ORDEM RECEBIDA
 * (a da data do lançamento), agrupados por dia seguido ("10 NOV. 2026"); sem
 * data, "DATA NÃO INFORMADA".
 * @param {any[]} lista
 */
export function diasDoHistorico(lista) {
  /** @type {Array<{ chave: string, rotulo: string, cartoes: Array<{ chave: string, Icone: import("lucide-react").LucideIcon, titulo: string, linhas: Array<{ rotulo: string, valor: string }> }> }>} */
  const dias = [];
  /** @type {Set<string>} */
  const chavesUsadas = new Set();
  let diaDoGrupo = /** @type {string | null} */ (null);
  (Array.isArray(lista) ? lista : []).forEach((item, i) => {
    const dia = String(item?.data_lancamento || "").split("T")[0];
    const chave = dia || "sem-data";
    let grupo = dias[dias.length - 1];
    if (!grupo || diaDoGrupo !== chave) {
      // O mesmo dia pode voltar mais adiante na lista: a chave do grupo fica única.
      const chaveDoGrupo = chavesUsadas.has(chave) ? `${chave}-${i}` : chave;
      chavesUsadas.add(chave);
      diaDoGrupo = chave;
      grupo = { chave: chaveDoGrupo, rotulo: rotuloDoDia(dia), cartoes: [] };
      dias.push(grupo);
    }
    grupo.cartoes.push({
      chave: String(item?.id ?? `lancamento-${i}`),
      Icone: ICONE_DO_TIPO[item?.tipo_lancamento] || ClipboardList,
      titulo: item?.tipo_lancamento || "Lançamento",
      linhas: linhasDoLancamento(item),
    });
  });
  return dias;
}
