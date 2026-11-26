/**
 * O SERVIÇO ABERTO do Diário das atividades (D-PROD-324, entrada e fluxo).
 *
 * Sem coluna nova (sem migration): a máquina, o implemento e as horas do serviço vão numa linha estruturada no INÍCIO da
 * OBSERVAÇÃO do lançamento do dia, no formato `[diario-servico inicio=07:30 bem=<id> impl=<id> fim=17:05]`. O texto que
 * vem depois da linha é do usuário e é preservado. O responsável é o `operador_usuario_id` do próprio lançamento.
 *
 * Limite (no relatório): a linha é texto. Quem edita a observação à mão pelo "Lançamento de hoje" pode apagá-la; aí o
 * diário mostra o serviço como não aberto (e deixa abrir outro). Não há busca por hora nem por máquina no servidor.
 */

export const MARCADOR_SERVICO = "diario-servico";

const RE_MARCADOR = /^\[diario-servico([^\]]*)\]\s*/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Uma hora `HH:MM` (00:00 a 23:59). @param {unknown} v */
export const horaValida = (v) => RE_HORA.test(String(v ?? "").trim());

/**
 * A linha do serviço. Sem máquina/implemento/fim, os campos saem (a linha fica enxuta).
 * @param {{ inicio: string, bemId?: string|null, implementoId?: string|null, fim?: string|null }} s
 */
export const marcadorDoServico = ({ inicio, bemId = null, implementoId = null, fim = null }) => {
  const partes = [`inicio=${inicio}`];
  if (bemId) partes.push(`bem=${bemId}`);
  if (implementoId) partes.push(`impl=${implementoId}`);
  if (fim) partes.push(`fim=${fim}`);
  return `[${MARCADOR_SERVICO} ${partes.join(" ")}]`;
};

/**
 * Lê o serviço da observação de um lançamento. Sem a linha (ou com a hora de início inválida), é `null`.
 * @param {unknown} observacao
 * @returns {{ inicio: string, bemId: string|null, implementoId: string|null, fim: string|null } | null}
 */
export const lerServico = (observacao) => {
  const m = RE_MARCADOR.exec(String(observacao ?? "").trimStart());
  if (!m) return null;
  const campos = Object.fromEntries(
    m[1]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return i > 0 ? [p.slice(0, i), p.slice(i + 1)] : [p, ""];
      }),
  );
  if (!horaValida(campos.inicio)) return null;
  return {
    inicio: String(campos.inicio).trim(),
    bemId: campos.bem || null,
    implementoId: campos.impl || null,
    fim: horaValida(campos.fim) ? String(campos.fim).trim() : null,
  };
};

/** O texto da observação SEM a linha do serviço (o que o usuário escreveu). @param {unknown} observacao */
export const textoDaObservacao = (observacao) => String(observacao ?? "").trimStart().replace(RE_MARCADOR, "");

/**
 * A observação com o serviço: a linha nova no início e o texto do usuário depois (a linha antiga sai).
 * @param {unknown} observacaoAtual @param {{ inicio: string, bemId?: string|null, implementoId?: string|null, fim?: string|null }} servico
 */
export const observacaoComServico = (observacaoAtual, servico) => {
  const resto = textoDaObservacao(observacaoAtual).trim();
  const marcador = marcadorDoServico(servico);
  return resto ? `${marcador}\n${resto}` : marcador;
};

/** Aberto = tem hora de início e ainda não tem a de fim. @param {{ inicio?: string|null, fim?: string|null }|null} s */
export const servicoAberto = (s) => Boolean(s && s.inicio && !s.fim);

/**
 * A hora `HH:MM` no fuso da fazenda (sem fuso, a do aparelho). @param {string|null|undefined} fuso @param {Date} [agora]
 */
export const horaNoFuso = (fuso, agora = new Date()) => {
  /** @param {string|undefined} timeZone */
  const formatar = (timeZone) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn" }).format(agora);
  try {
    return formatar(fuso || undefined);
  } catch {
    return formatar(undefined);
  }
};

/**
 * O formulário "Abrir serviço": máquina e responsável obrigatórios; implemento opcional; hora válida; a operação só é
 * pedida quando o pasto não tem atividade em andamento (sem ela não há atividade a abrir).
 * @param {{ bemId: string, responsavelId: string, inicio: string, tipoId?: string, pedirOperacao?: boolean }} v
 * @returns {Record<string, string>} os erros por campo (vazio = válido)
 */
export const validarAbrirServico = ({ bemId, responsavelId, inicio, tipoId = "", pedirOperacao = false }) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!String(bemId ?? "").trim()) erros.bem = "Escolha a máquina.";
  if (!String(responsavelId ?? "").trim()) erros.responsavel = "Escolha o responsável.";
  if (!horaValida(inicio)) erros.inicio = "Informe a hora de início (HH:MM).";
  if (pedirOperacao && !String(tipoId ?? "").trim()) erros.tipo = "Escolha a operação.";
  return erros;
};
