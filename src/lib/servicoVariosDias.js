/**
 * D-PROD-267 — SERVIÇO DE VÁRIOS DIAS e a SITUAÇÃO da lista (peças puras; quem decide é o servidor).
 *
 * "Abre uma vez e vai somando os dias": a lista mostra UMA linha por serviço (a atividade), com a situação que o servidor
 * manda em `andamento` (Planejada, Em andamento, Concluída, Cancelada), "12 de 40 ha (30%) · último dia 02/12" e, aos
 * 100% sem ninguém concluir, "100%, falta concluir". O "+ Lançar dia" abre a Nova realização já preenchida com o que o
 * serviço tem (operação, áreas em aberto, máquinas e equipe do último dia) e o "Concluir" pergunta só o último dia.
 * Nada conclui sozinho: a pessoa escolhe "Como fica depois de salvar?" (padrão pelo término).
 */

import { comparar, ehCanonico, somar } from './dinheiroDecimal.js';
import { formatarDecimalAtividade, formatarDiaAtividade } from './lancamentoAtividadesRegras.js';
import { STATUS_AREA, areasDaAtividade } from './atividadeAreasRegras.js';
import { TIPOS_FIXOS_ATIVIDADE, operacoesDoTipoFixo, rotuloDoTipoFixo, tipoFixoDaOperacao } from './tiposFixosAtividade.js';
import { formularioMaoObraDaBase, formularioMaquinaDaBase } from './atividadeLinhasRegras.js';
import { ehDiaValido } from './diaCivil.js';

/** As situações da lista, na ordem do filtro. */
export const SITUACOES_DO_SERVICO = Object.freeze(['PLANEJADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA']);

/** Como cada situação aparece. */
export const ROTULO_DA_SITUACAO = Object.freeze(
  /** @type {Record<string, string>} */ ({ PLANEJADA: 'Planejada', EM_ANDAMENTO: 'Em andamento', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' }),
);

/** A trava "serviço parado" (a mesma do servidor: `DIAS_PARADO_MAXIMO`). */
export const DIAS_PARADO_MAXIMO = 30;

/** O código da recusa "serviço parado". */
export const CODIGO_SERVICO_PARADO = 'ATIVIDADE_SERVICO_PARADO';

/** @param {unknown} v @returns {string} */
const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** "dd/mm" de um dia `AAAA-MM-DD` (vazio se inválido). @param {unknown} dia */
export const diaCurto = (dia) => (typeof dia === 'string' && ehDiaValido(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '');

/** Dias corridos de `de` até `ate` (`AAAA-MM-DD`). @param {string} de @param {string} ate */
export const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);

/**
 * A situação do serviço: a do servidor (`andamento.situacao`); sem ela (resposta antiga), pelo status (ABERTA = Em
 * andamento, como antes).
 * @param {any} item
 */
export const situacaoDoServico = (item) => {
  const s = texto(item?.andamento?.situacao);
  if (SITUACOES_DO_SERVICO.includes(s)) return s;
  const status = texto(item?.status);
  if (status === 'CONCLUIDA' || status === 'CANCELADA') return status;
  return 'EM_ANDAMENTO';
};

/** @param {any} item */
export const rotuloDaSituacaoDoServico = (item) => ROTULO_DA_SITUACAO[situacaoDoServico(item)] ?? '';

/** O tipo fixo da linha ("Roçada e tratos"): o do servidor; sem ele, o da operação na lista de tipos. @param {any} item @param {any[]} [tipos] */
export const tipoFixoDoServico = (item, tipos = []) => {
  const doServidor = texto(item?.andamento?.tipo_fixo);
  if (doServidor) return doServidor;
  const op = (Array.isArray(tipos) ? tipos : []).find((t) => String(t?.id) === String(item?.tipo_atividade_id ?? ''));
  return op ? tipoFixoDaOperacao(op) : '';
};

/** @param {any} item @param {any[]} [tipos] */
export const rotuloDoTipoDoServico = (item, tipos = []) => {
  const t = tipoFixoDoServico(item, tipos);
  return t ? rotuloDoTipoFixo(t) : '';
};

/** O nome da área como está no cadastro. @param {any} a a área do mapa (`{ nome }`) */
const nomeDaArea = (a) => texto(a?.nome) || texto(a?.numero_area);

/**
 * A coluna "Área": a primeira área e "+N" das outras ("Pasto da Aroeira +1"); sem áreas, a do cabeçalho; sem nenhuma, "".
 * D-PROD-270: o serviço sem área (Manutenção e Outros) mostra o local ("DIVISA NORTE").
 * @param {any} item
 */
export const textoDaAreaDoServico = (item) => {
  const areas = areasDaAtividade(item);
  if (!areas.length) return nomeDaArea(item?.area) || texto(item?.local);
  const primeira = nomeDaArea(areas[0]?.area);
  return areas.length > 1 ? `${primeira} +${areas.length - 1}` : primeira;
};

/**
 * A coluna "Data": em aberto, "28/11 –" (o início); concluída, "01/11 a 10/11" (o início e a conclusão; no mesmo dia,
 * só "12/11"); planejada e cancelada, o início.
 * @param {any} item
 */
export const textoDaDataDoServico = (item) => {
  const inicio = diaCurto(item?.data_inicio);
  const situacao = situacaoDoServico(item);
  if (situacao === 'CONCLUIDA') {
    const fim = diaCurto(item?.data_conclusao);
    if (!fim || fim === inicio) return inicio || fim;
    return inicio ? `${inicio} a ${fim}` : fim;
  }
  if (situacao === 'EM_ANDAMENTO') return inicio ? `${inicio} –` : '';
  return inicio;
};

/** "12" / "52,5" (hectares do servidor, sem casas a mais). @param {unknown} v */
const ha = (v) => (ehCanonico(v) ? formatarDecimalAtividade(v) : '');

/**
 * O % para a tela: inteiro; só mostra 100 quando chegou (99,6 fica 99), nunca passa de 100 na barra.
 * @param {unknown} percentual `"30.00"`
 * @returns {number|null}
 */
export const percentualInteiro = (percentual) => {
  if (!ehCanonico(percentual)) return null;
  const n = Number(percentual);
  if (!Number.isFinite(n)) return null;
  return n >= 100 ? 100 : Math.min(99, Math.round(n));
};

/** O andamento chegou a 100% (ou passou)? @param {any} item */
export const chegouA100 = (item) => {
  const p = item?.andamento?.percentual;
  return ehCanonico(p) && comparar(/** @type {string} */ (p), '100') >= 0;
};

/** Em andamento, aos 100%, ninguém concluiu: "100%, falta concluir". @param {any} item */
export const faltaConcluir = (item) => situacaoDoServico(item) === 'EM_ANDAMENTO' && chegouA100(item);

/**
 * "12 de 40 ha (30%)"; sem a área, "12 ha"; sem nada feito, "".
 * @param {unknown} feitos @param {unknown} area @param {unknown} percentual
 */
export const textoDosHectares = (feitos, area, percentual) => {
  const f = ha(feitos);
  if (!f) return '';
  const a = ha(area);
  const p = percentualInteiro(percentual);
  if (!a) return `${f} ha`;
  return `${f} de ${a} ha${p === null ? '' : ` (${p}%)`}`;
};

/**
 * A linha do andamento: "12 de 40 ha (30%) · último dia 02/12" (só Em andamento com dia lançado).
 * @param {any} item
 */
export const textoDoAndamento = (item) => {
  if (situacaoDoServico(item) !== 'EM_ANDAMENTO') return '';
  const a = item?.andamento ?? {};
  const hectares = textoDosHectares(a.hectares_feitos, a.hectares_area, a.percentual);
  const ultimo = diaCurto(a.ultimo_dia);
  return [hectares, ultimo ? `último dia ${ultimo}` : ''].filter(Boolean).join(' · ');
};

/** A barra (0 a 100) do andamento; sem %, null. @param {any} item */
export const barraDoAndamento = (item) => percentualInteiro(item?.andamento?.percentual);

/** "30 de 30 ha" da concluída (o card do celular). @param {any} item */
export const hectaresDaConcluida = (item) => {
  const a = item?.andamento ?? {};
  const f = ha(a.hectares_feitos);
  const t = ha(a.hectares_area);
  return f && t ? `${f} de ${t} ha` : f ? `${f} ha` : '';
};

// ─── O filtro "Tipo" (os 7 tipos fixos e, dentro de cada um, as operações) ──────

const PREFIXO_TIPO = 'tipo:';
const PREFIXO_OPERACAO = 'op:';

/**
 * As opções da pílula "Tipo": "Todos os tipos", cada tipo fixo e, logo abaixo, as operações dele ("Roçada e tratos ›
 * ROÇADA MECÂNICA"): a pílula substitui a antiga "Tipo de atividade" sem perder o filtro pela operação.
 * @param {any[]} tipos as operações (tipos de atividade) da fazenda, ativas e inativas
 */
export const opcoesDoFiltroTipo = (tipos) => [
  { value: '', label: 'Todos os tipos' },
  ...TIPOS_FIXOS_ATIVIDADE.flatMap((t) => [
    { value: `${PREFIXO_TIPO}${t.value}`, label: t.label },
    ...operacoesDoTipoFixo(
      (Array.isArray(tipos) ? tipos : []).map((o) => ({ ...o, ativo: true })),
      t.value,
    ).map((o) => {
      const inativa = (Array.isArray(tipos) ? tipos : []).find((x) => String(x?.id) === String(o.id))?.ativo === false;
      return { value: `${PREFIXO_OPERACAO}${o.id}`, label: `${t.label} › ${texto(o.nome_tipo)}${inativa ? ' (INATIVO)' : ''}` };
    }),
  ]),
];

/**
 * O valor da pílula "Tipo" → a query do servidor: `tipo_fixo` (o tipo) ou `tipo_atividade_id` (a operação).
 * @param {string} valor @returns {{ tipo_fixo: string|null, tipo_atividade_id: string|null }}
 */
export const filtroDoTipo = (valor) => {
  const v = texto(valor);
  if (v.startsWith(PREFIXO_TIPO)) return { tipo_fixo: v.slice(PREFIXO_TIPO.length) || null, tipo_atividade_id: null };
  if (v.startsWith(PREFIXO_OPERACAO)) return { tipo_fixo: null, tipo_atividade_id: v.slice(PREFIXO_OPERACAO.length) || null };
  return { tipo_fixo: null, tipo_atividade_id: null };
};

/** As opções da pílula "Situação". */
export const OPCOES_DA_SITUACAO = Object.freeze([
  { value: '', label: 'Todas as situações' },
  ...SITUACOES_DO_SERVICO.map((s) => ({ value: s, label: ROTULO_DA_SITUACAO[s] })),
]);

// ─── O "Concluir" da linha ──────────────────────────────────────────────

/**
 * O último dia do "Concluir": obrigatório, nunca futuro, nem antes do início nem do último dia lançado. Devolve a frase
 * do campo ou null.
 * @param {string} dia @param {{ hoje?: string|null, dataInicio?: string|null, ultimoDia?: string|null }} c
 */
export const erroDoUltimoDia = (dia, { hoje = null, dataInicio = null, ultimoDia = null }) => {
  if (!dia) return 'Informe o último dia.';
  if (!ehDiaValido(dia)) return 'Data inválida.';
  if (hoje && dia > hoje) return 'O último dia não pode ser depois de hoje.';
  if (dataInicio && ehDiaValido(dataInicio) && dia < dataInicio) return `O último dia não pode ser antes do início do serviço (${formatarDiaAtividade(dataInicio)}).`;
  if (ultimoDia && ehDiaValido(ultimoDia) && dia < ultimoDia) return `O último dia não pode ser antes do último dia lançado (${formatarDiaAtividade(ultimoDia)}).`;
  return null;
};

/** "Concluir <operação> · <área>". @param {any} item */
export const tituloDoConcluir = (item) => [texto(item?.tipo_atividade_nome), textoDaAreaDoServico(item)].filter(Boolean).join(' · ');

// ─── O "+ Lançar dia" (a Nova realização preenchida) ────────────────────

/**
 * O que a Nova realização herda do serviço ao "+ Lançar dia": as áreas em aberto da atividade (PLANEJADA ou EM_ANDAMENTO,
 * sem os hectares de hoje: a pessoa digita) e, do ÚLTIMO dia lançado (o apontamento confirmado mais recente), as
 * máquinas com o implemento (sem leitura: a inicial é a do medidor agora, que é a final do último dia) e a equipe (sem a
 * quantidade). Insumos e serviços de terceiro não vêm.
 * @param {{ atividade: any, apontamentos?: any[] }} p
 * @returns {{ areaIds: string[], maquinas: any[], equipe: any[], ultimo: any|null }}
 */
export const preenchimentoDoLancarDia = ({ atividade, apontamentos = [] }) => {
  const abertas = areasDaAtividade(atividade).filter((a) => a.status !== STATUS_AREA.CONCLUIDA);
  const areaIds = (abertas.length ? abertas.map((a) => a.area_id) : atividade?.area_id ? [atividade.area_id] : []).filter(Boolean).map(String);
  const confirmados = (Array.isArray(apontamentos) ? apontamentos : []).filter((a) => a && a.status !== 'CANCELADO');
  const fim = (/** @type {any} */ a) => (ehDiaValido(a?.data_termino) && a.data_termino > a.data_operacional ? a.data_termino : a?.data_operacional ?? '');
  const ultimo = confirmados.reduce((m, a) => (!m || fim(a) > fim(m) || (fim(a) === fim(m) && texto(a.createdAt) > texto(m.createdAt)) ? a : m), /** @type {any} */ (null));
  const ativas = (/** @type {any} */ l) => l && l.status !== 'CANCELADO';
  const vistas = new Set();
  const maquinas = (Array.isArray(ultimo?.maquinas) ? ultimo.maquinas : [])
    .filter(ativas)
    .filter((l) => {
      const k = String(l.bem_id ?? '');
      if (!k || vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
    .map((l) => ({ ...formularioMaquinaDaBase(l), quantidade_uso: '' }));
  const pessoas = new Set();
  const equipe = (Array.isArray(ultimo?.mao_obra) ? ultimo.mao_obra : [])
    .filter(ativas)
    .filter((l) => {
      const k = String(l.parceiro_id ?? '');
      if (!k || pessoas.has(k)) return false;
      pessoas.add(k);
      return true;
    })
    .map((l) => ({ ...formularioMaoObraDaBase(l), quantidade: '' }))
    .filter((f) => f.parceiro);
  return { areaIds, maquinas, equipe, ultimo };
};

// ─── "Como fica depois de salvar?" ──────────────────────────────────────

/**
 * A escolha que vale: a da pessoa (quando ela escolheu) ou o padrão pelo término (vazio = Em andamento; preenchido =
 * Concluída).
 * @param {string} termino @param {'EM_ANDAMENTO'|'CONCLUIDA'|null} escolhida
 * @returns {'EM_ANDAMENTO'|'CONCLUIDA'}
 */
export const situacaoDepoisDeSalvar = (termino, escolhida) => escolhida ?? (termino ? 'CONCLUIDA' : 'EM_ANDAMENTO');

/** "hoje", "ontem", "28/11" ou "de 30/11 a 02/12". @param {string} dia @param {string} termino @param {string|null|undefined} hoje */
export const textoDoDiaDoRegistro = (dia, termino, hoje) => {
  const um = (/** @type {string} */ d) => (hoje && d === hoje ? 'hoje' : hoje && diasEntre(d, hoje) === 1 ? 'ontem' : diaCurto(d));
  if (!dia) return '';
  if (termino && termino > dia) return `de ${diaCurto(dia)} a ${diaCurto(termino)}`;
  return um(dia);
};

/**
 * O resumo antes de salvar, numa frase ("Roçada mecânica no Pasto da Aroeira, hoje, 4 ha, Trator MF 4275, João 1 diária.
 * Vai ficar EM ANDAMENTO (12 de 40 ha)."). As partes vazias saem.
 * @param {{ operacao: string, areas: string[], quando: string, hectares: string|null, maquinas: string[], equipe: string[],
 *   situacao: 'EM_ANDAMENTO'|'CONCLUIDA', feitosDepois: string|null, areaTotal: string|null }} p
 */
export const resumoAntesDeSalvar = ({ operacao, areas, quando, hectares, maquinas, equipe, situacao, feitosDepois, areaTotal }) => {
  const onde = areas.length ? `${operacao ? `${operacao} no ` : ''}${areas.length > 2 ? `${areas[0]} e mais ${areas.length - 1}` : areas.join(' e ')}` : operacao;
  const partes = [onde, quando, hectares ? `${ha(hectares)} ha` : '', ...maquinas, ...equipe].filter(Boolean);
  const andamento = textoDosHectares(feitosDepois, areaTotal, null).replace(/ \(\d+%\)$/, '');
  const vai = `Vai ficar ${situacao === 'CONCLUIDA' ? 'CONCLUÍDA' : 'EM ANDAMENTO'}${andamento ? ` (${andamento})` : ''}.`;
  return { frase: partes.length ? `${partes.join(', ')}.` : '', vai };
};

/**
 * Os hectares do serviço DEPOIS deste registro: o que a atividade já tem (feitos e área total, do servidor) mais os de
 * hoje. Sem a atividade (nova): hoje de Σ dos tamanhos. Canônicos (4 casas) ou null.
 * @param {{ jaFeitos: string|null, areaTotal: string|null, hoje: string|null }} p
 */
export const hectaresDepoisDoRegistro = ({ jaFeitos, areaTotal, hoje }) => {
  const partes = [jaFeitos, hoje].filter((v) => ehCanonico(v));
  return { feitos: partes.length ? somar(/** @type {string[]} */ (partes), 4) : null, area: ehCanonico(areaTotal) ? areaTotal : null };
};
