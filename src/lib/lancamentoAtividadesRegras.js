/**
 * Regras do Lançamento de Atividades no navegador (D-PROD-200, Fatia 2).
 *
 * A ATIVIDADE é o cabeçalho aberto ("Cigarrinha Pasto 01"); os APONTAMENTOS são
 * os dias e turnos em que ela foi executada (sequência 1, 2… no mesmo dia e
 * turno = as passadas). Aqui ficam só regras PURAS: rótulos, formatação, o que
 * cada status deixa fazer e as mensagens das recusas do servidor. Quem decide
 * de fato é o servidor.
 *
 *  - Datas de negócio são TEXTO de dia (AAAA-MM-DD); "hoje" é o da FAZENDA.
 *  - Decimais chegam como TEXTO canônico com 4 casas ("12.5000"): nunca Number.
 *  - Setor vem da área; centro de custo, centro de resultado e unidade de
 *    produção vêm do tipo: ninguém digita, a tela só mostra (travados).
 *
 * Contrato: docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md (§3, §5, §10).
 */

import { ehCanonico, formatarNumero } from './dinheiroDecimal.js';
import { ehDiaValido, formatarDia } from './diaCivil.js';
import { rotuloDoBem } from './abastecimentoRegras.js';
import { lerErroGestao, mensagemErroGestao } from './gestaoErros.js';

export { rotuloDoBem };

export const LOCALE_ATIVIDADE = 'pt-BR';
/** Decimal(14, 4) do servidor: até 10 inteiros e 4 casas (áreas e produção). */
export const LIMITES_DECIMAL_ATIVIDADE = Object.freeze({ inteiros: 10, casas: 4 });
export const MAX_NOME_ATIVIDADE = 120;
export const MAX_SAFRA_ATIVIDADE = 32;
export const MAX_OBSERVACAO_ATIVIDADE = 2000;
/** Motivo de reabrir e de cancelar (§10): 3 a 500 caracteres úteis. */
export const MOTIVO_MINIMO = 3;
export const MOTIVO_MAXIMO = 500;

// ─── Status, turno e origem ──────────────────────────────────────────────

export const STATUS_ABERTA = 'ABERTA';
export const STATUS_CONCLUIDA = 'CONCLUIDA';
export const STATUS_CANCELADA = 'CANCELADA';
/** Status da atividade (CHECK no banco). */
export const STATUS_ATIVIDADE = Object.freeze([STATUS_ABERTA, STATUS_CONCLUIDA, STATUS_CANCELADA]);
export const ROTULO_STATUS_ATIVIDADE = Object.freeze(
  /** @type {Record<string, string>} */ ({ ABERTA: 'Aberta', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada' }),
);

/**
 * Chave de cor do selo existente (`Selo` da Central de Lançamentos) para cada
 * status: aberta = em andamento, concluída = feita, cancelada = cancelada.
 */
export const CHAVE_DO_SELO_ATIVIDADE = Object.freeze(
  /** @type {Record<string, string>} */ ({ ABERTA: 'ABERTO', CONCLUIDA: 'CONFIRMADO', CANCELADA: 'CANCELADO' }),
);

export const STATUS_CONFIRMADO = 'CONFIRMADO';
export const STATUS_CANCELADO = 'CANCELADO';
/** Status do apontamento (CHECK no banco). */
export const STATUS_APONTAMENTO = Object.freeze([STATUS_CONFIRMADO, STATUS_CANCELADO]);
export const ROTULO_STATUS_APONTAMENTO = Object.freeze(
  /** @type {Record<string, string>} */ ({ CONFIRMADO: 'Confirmado', CANCELADO: 'Cancelado' }),
);

export const TURNO_MANHA = 'MANHA';
export const TURNO_TARDE = 'TARDE';
export const TURNO_NOITE = 'NOITE';
/** Turnos do apontamento; sem turno = `null` (CHECK no banco). */
export const TURNOS = Object.freeze([TURNO_MANHA, TURNO_TARDE, TURNO_NOITE]);
export const ROTULO_TURNO = Object.freeze(/** @type {Record<string, string>} */ ({ MANHA: 'Manhã', TARDE: 'Tarde', NOITE: 'Noite' }));
export const ROTULO_SEM_TURNO = 'Sem turno';
/** @param {unknown} turno */
export const rotuloDoTurno = (turno) => ROTULO_TURNO[String(turno ?? '')] ?? ROTULO_SEM_TURNO;

export const ORIGEM_WEB = 'WEB';
export const ORIGEM_APP = 'APP';
/** Origem do apontamento (padrão WEB; CHECK no banco). */
export const ORIGENS = Object.freeze([ORIGEM_WEB, ORIGEM_APP]);
export const ROTULO_ORIGEM = Object.freeze(/** @type {Record<string, string>} */ ({ WEB: 'Web', APP: 'Aplicativo' }));

/** @param {unknown} status */
export const rotuloDoStatusAtividade = (status) => ROTULO_STATUS_ATIVIDADE[String(status ?? '')] ?? String(status ?? '');
/** @param {unknown} status */
export const rotuloDoStatusApontamento = (status) => ROTULO_STATUS_APONTAMENTO[String(status ?? '')] ?? String(status ?? '');

// ─── Rótulos ─────────────────────────────────────────────────────────────

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : '');

/** Centro de custo ou de resultado (`{ numero, nome }`): "12 — Pecuária de corte". @param {{ numero?: unknown, nome?: unknown } | null | undefined} c */
export const rotuloDoCentro = (c) => {
  if (!c || typeof c !== 'object') return '';
  const nome = texto(c.nome);
  return c.numero != null && String(c.numero) && nome ? `${String(c.numero)} — ${nome}` : nome;
};

/** Área (`{ numero_area, nome }`): "01 — Pasto 01". @param {{ numero_area?: unknown, nome?: unknown } | null | undefined} a */
export const rotuloDaArea = (a) => {
  if (!a || typeof a !== 'object') return '';
  const nome = texto(a.nome);
  const numero = a.numero_area != null ? String(a.numero_area).trim() : '';
  return numero && nome ? `${numero} — ${nome}` : nome || numero;
};

/**
 * Sigla do tipo de atividade no selo do card da lista (D-PROD-237): as 3 primeiras letras ou dígitos do nome, em
 * maiúsculas ("ADUBAÇÃO DE COBERTURA" → "ADU"); sem nome, "".
 * @param {unknown} nome
 */
export const siglaDoTipoAtividade = (nome) =>
  texto(nome)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, 3)
    .toLocaleUpperCase(LOCALE_ATIVIDADE);

/**
 * Paleta do selo do tipo (o cadastro de tipos não tem cor): tons escuros o bastante para o texto branco (contraste
 * ≥ 4,5:1), um por tipo, sempre o mesmo para o mesmo tipo.
 */
export const PALETA_TIPO_ATIVIDADE = Object.freeze([
  '#15803d',
  '#1d4ed8',
  '#0f766e',
  '#b45309',
  '#7c3aed',
  '#be185d',
  '#0369a1',
  '#4d7c0f',
]);

/**
 * Cor do selo do tipo, determinística pela chave (o id do tipo; sem ele, o nome): a mesma chave dá sempre a mesma cor.
 * Sem chave, a primeira cor.
 * @param {unknown} chave
 */
export const corDoTipoAtividade = (chave) => {
  const k = texto(chave);
  if (!k) return PALETA_TIPO_ATIVIDADE[0];
  let h = 0;
  for (const ch of k) h = (Math.imul(h, 31) + /** @type {number} */ (ch.codePointAt(0))) >>> 0;
  return PALETA_TIPO_ATIVIDADE[h % PALETA_TIPO_ATIVIDADE.length];
};

/** Usuário público (`{ id, nome }`), como o operador. @param {{ nome?: unknown } | null | undefined} u */
export const rotuloDoUsuario = (u) => (u && typeof u === 'object' ? texto(u.nome) : '');

/**
 * Tarefa de origem (o resumo do servidor: `{ id, titulo, status }`; aceita
 * também `numero`/`nome`): "Nº 12 — Roçar pasto" ou só o título.
 * @param {{ numero?: unknown, nome?: unknown, titulo?: unknown } | null | undefined} t
 */
export const rotuloDaTarefa = (t) => {
  if (!t || typeof t !== 'object') return '';
  const nome = texto(t.titulo) || texto(t.nome);
  const numero = t.numero != null ? String(t.numero).trim() : '';
  if (numero && nome) return `Nº ${numero} — ${nome}`;
  return numero ? `Tarefa nº ${numero}` : nome;
};

/**
 * Unidade de produção HERDADA do tipo: o cadastro (`{ sigla, descricao }`) ou,
 * sem ele, a sigla guardada na atividade (snapshot).
 * @param {any} atividade
 */
export const rotuloDaUnidadeDeProducao = (atividade) => {
  const u = atividade?.unidade_producao;
  const sigla = texto(u?.sigla) || texto(atividade?.unidade_producao_sigla);
  const descricao = texto(u?.descricao);
  return sigla && descricao ? `${sigla} — ${descricao}` : sigla || descricao;
};

/** Setor HERDADO da área (snapshot do nome). @param {any} atividade */
export const rotuloDoSetor = (atividade) => texto(atividade?.setor_nome);

// ─── Formatação ──────────────────────────────────────────────────────────

/** Dia para exibição ("10/11/2026"); vazio sem dia. @param {unknown} dia */
export const formatarDiaAtividade = (dia) => (ehDiaValido(dia) ? formatarDia(dia, LOCALE_ATIVIDADE) : '');

/** Decimal do servidor ("12.5000" → "12,5"); vazio quando ausente. @param {unknown} v */
export const formatarDecimalAtividade = (v) =>
  ehCanonico(v) ? formatarNumero(/** @type {string} */ (v), { locale: LOCALE_ATIVIDADE, casasMin: 0, casasMax: LIMITES_DECIMAL_ATIVIDADE.casas }) : '';

/** "12,5 / 40" (executada / planejada); "—" no lado sem valor; vazio sem nenhum dos dois. @param {any} atividade */
export const formatarAreaExecutadaPlanejada = (atividade) => {
  const executada = formatarDecimalAtividade(atividade?.area_executada);
  const planejada = formatarDecimalAtividade(atividade?.area_planejada);
  if (!executada && !planejada) return '';
  return `${executada || '—'} / ${planejada || '—'}`;
};

/** Produção somada dos apontamentos confirmados, com a unidade herdada ("120 KM"). @param {any} atividade */
export const formatarProducaoDaAtividade = (atividade) => {
  const quantidade = formatarDecimalAtividade(atividade?.quantidade_produzida);
  if (!quantidade) return '';
  const sigla = texto(atividade?.unidade_producao?.sigla) || texto(atividade?.unidade_producao_sigla);
  return sigla ? `${quantidade} ${sigla}` : quantidade;
};

// ─── O que cada status deixa fazer ───────────────────────────────────────

/**
 * Ações sobre UMA atividade, pela permissão da tela (`acoesDaTelaAtividades`)
 * e pelo status (§3): editar o cabeçalho, concluir, cancelar e mexer nos
 * apontamentos só na ABERTA; reabrir só a CONCLUIDA (permissão própria);
 * duplicar é uma abertura nova (vale para qualquer status). O servidor recusa
 * do mesmo jeito (409).
 * @param {any} atividade
 * @param {{ criar?: boolean, editar?: boolean, cancelar?: boolean, reabrir?: boolean,
 *   lancarApontamento?: boolean, editarApontamento?: boolean, cancelarApontamento?: boolean } | null | undefined} acoes
 */
export const acoesDaAtividade = (atividade, acoes) => {
  const existe = Boolean(atividade && typeof atividade === 'object' && atividade.id);
  const status = existe ? atividade.status : null;
  const aberta = status === STATUS_ABERTA;
  return {
    editar: Boolean(acoes?.editar) && aberta,
    concluir: Boolean(acoes?.editar) && aberta,
    reabrir: Boolean(acoes?.reabrir) && status === STATUS_CONCLUIDA,
    cancelar: Boolean(acoes?.cancelar) && aberta,
    duplicar: Boolean(acoes?.criar) && existe,
    lancarApontamento: Boolean(acoes?.lancarApontamento) && aberta,
    editarApontamento: Boolean(acoes?.editarApontamento) && aberta,
    cancelarApontamento: Boolean(acoes?.cancelarApontamento) && aberta,
  };
};

/**
 * Motivo de reabrir ou cancelar, conferido ANTES da rede (o servidor confere de
 * novo): 3 a 500 caracteres úteis, sem só espaços. `reason` no vocabulário do
 * servidor (`ATIVIDADE_MOTIVO_INVALIDO`).
 * @param {unknown} motivo
 * @returns {{ ok: boolean, motivo: string, reason: 'obrigatorio'|'curto'|'longo'|null }}
 */
export const lerMotivo = (motivo) => {
  const limpo = typeof motivo === 'string' ? motivo.trim() : '';
  const tamanho = [...limpo].length;
  if (!tamanho) return { ok: false, motivo: limpo, reason: 'obrigatorio' };
  if (tamanho < MOTIVO_MINIMO) return { ok: false, motivo: limpo, reason: 'curto' };
  if (tamanho > MOTIVO_MAXIMO) return { ok: false, motivo: limpo, reason: 'longo' };
  return { ok: true, motivo: limpo, reason: null };
};

/**
 * Data de conclusão (§3): obrigatória no formulário, nunca futura nem antes do
 * início da atividade. Devolve o texto do erro ou null.
 * @param {string} dia @param {{ hoje: string, dataInicio?: string|null }} ctx
 */
export const erroDaDataDeConclusao = (dia, { hoje, dataInicio = null }) => {
  if (!dia) return 'Informe a data de conclusão.';
  if (!ehDiaValido(dia)) return 'Data inválida.';
  if (hoje && dia > hoje) return 'A data de conclusão não pode ser futura.';
  if (dataInicio && ehDiaValido(dataInicio) && dia < dataInicio) {
    return `A data de conclusão não pode ser anterior ao início da atividade (${formatarDiaAtividade(dataInicio)}).`;
  }
  return null;
};

// ─── Mensagens das recusas do servidor ───────────────────────────────────

/**
 * Códigos que significam "a atividade (ou o apontamento) não existe mais ou
 * mudou": a tela relê a lista e o detalhe.
 */
export const CODIGOS_RELER_ATIVIDADE = Object.freeze([
  'ATIVIDADE_NOT_FOUND',
  'ATIVIDADE_APONTAMENTO_NOT_FOUND',
  'ATIVIDADE_LINHA_NOT_FOUND',
  'ATIVIDADE_STATUS_INVALIDO',
  'ATIVIDADE_VERSAO_CONFLITO',
]);

/** Código estável da recusa (o do servidor quando houver). @param {unknown} erro */
export const codigoDoErroAtividade = (erro) => lerErroGestao(erro).code;

/** Frase de cada referência recusada (`details.field` × `details.reason`). */
const REFERENCIAS = Object.freeze(
  /** @type {Record<string, Record<string, string>>} */ ({
    tipo_atividade_id: {
      inexistente: 'O tipo de atividade não foi encontrado',
      inativo: 'O tipo de atividade está inativo: escolha um tipo ativo',
      grupo_inativo: 'O grupo deste tipo de atividade está inativo: reative o grupo ou escolha outro tipo',
    },
    area_id: {
      inexistente: 'A área não foi encontrada',
      inativo: 'A área está inativa',
      outra_empresa: 'A área é de outra fazenda',
      duplicada: 'A mesma área foi escolhida duas vezes',
      ja_na_atividade: 'A área já está nesta atividade',
    },
    bem_id: {
      inexistente: 'A máquina não foi encontrada',
      inativo: 'A máquina está inativa',
      outra_empresa: 'A máquina é de outra fazenda',
      natureza: 'O bem escolhido não é máquina, veículo nem equipamento: escolha uma máquina',
    },
    lancamento_tarefa_id: { inexistente: 'A tarefa não foi encontrada', inativo: 'A tarefa não pode ser usada', outra_empresa: 'A tarefa é de outra fazenda' },
    operador_usuario_id: { inexistente: 'O operador não foi encontrado', inativo: 'O operador está inativo', outra_empresa: 'O operador não pode ser usado nesta fazenda' },
    // Herdados (nunca vêm do corpo): só somem entre a leitura e a escrita.
    grupo_atividade_id: { inexistente: 'O grupo do tipo de atividade não foi encontrado' },
    setor_id: { inexistente: 'O setor da área não foi encontrado' },
    centro_custo_id: { inexistente: 'O centro de custo padrão do tipo não foi encontrado' },
    centro_resultado_id: { inexistente: 'O centro de resultado padrão do tipo não foi encontrado' },
    unidade_producao_id: { inexistente: 'A unidade de produção do tipo não foi encontrada' },
    // MAIKE-ENTREGA3 (D-PROD-276): o "Faz parte de" (a reforma), o capim que vai ficar e a troca do capim na conclusão.
    planejamento_id: {
      inexistente: 'A reforma não foi encontrada nesta fazenda: tire o "Faz parte de" ou escolha outra',
      fechado: 'A reforma já foi concluída ou cancelada: a realização não entra mais nela (tire o "Faz parte de")',
      area_fora: 'A área desta realização não faz parte da reforma escolhida: tire o "Faz parte de" ou escolha outra',
    },
    cultura_alvo_id: {
      inexistente: 'O capim que vai ficar não foi encontrado no Cadastro de Culturas desta fazenda',
      inativo: 'O capim que vai ficar está inativo no Cadastro de Culturas: escolha um ativo',
    },
    trocar_capim: { sem_capim: 'A reforma não tem o capim que vai ficar: conclua sem trocar o capim' },
  }),
);

/** O que o tipo exige (`ATIVIDADE_EXIGIDA_PELO_TIPO`, `details.field`). */
const EXIGIDOS = Object.freeze(
  /** @type {Record<string, string>} */ ({
    area_id: 'Este tipo de atividade exige a área: escolha a área.',
    safra_ciclo: 'Este tipo de atividade exige a safra: informe a safra.',
    bem_id: 'Este tipo de atividade exige a máquina: escolha a máquina.',
    quantidade_produzida:
      'Este tipo de atividade exige produção para concluir: lance a produção nos apontamentos confirmados antes de concluir.',
  }),
);

/** Nome de cada data nas mensagens. */
const NOME_DA_DATA = Object.freeze(
  /** @type {Record<string, string>} */ ({
    data_inicio: 'data de início',
    data_prevista_fim: 'data prevista de fim',
    data_conclusao: 'data de conclusão',
    data_operacional: 'data do apontamento',
    // D-PROD-265: a data de término do registro de campo (Nova realização).
    data_termino: 'data de término',
    data_de: 'data inicial do período',
    data_ate: 'data final do período',
  }),
);

/** " (hoje na fazenda: 10/11/2026)" quando o servidor manda o dia. @param {Record<string, any>} details */
const hojeNaFazenda = (details) => (ehDiaValido(details.hoje) ? ` (hoje na fazenda: ${formatarDiaAtividade(details.hoje)})` : '');

/** @param {string|null} field @param {string|null} reason @param {Record<string, any>} details @returns {string|null} */
const fraseDaData = (field, reason, details) => {
  const nome = NOME_DA_DATA[field ?? ''] ?? 'data';
  if (reason === 'futura') return `A ${nome} não pode ser futura${hojeNaFazenda(details)}.`;
  if (reason === 'antes_do_inicio') {
    const inicio = ehDiaValido(details.data_inicio) ? ` (${formatarDiaAtividade(details.data_inicio)})` : '';
    return `A ${nome} não pode ser anterior ao início da atividade${inicio}.`;
  }
  if (reason === 'periodo_invertido') {
    return field === 'data_de' || field === 'data_ate'
      ? 'A data final do período é anterior à inicial.'
      : 'A data prevista de fim é anterior à data de início.';
  }
  if (reason === 'data_inexistente') return `A ${nome} não existe no calendário.`;
  // D-PROD-265: a data do lançamento depois do término gravado nele (Nova realização).
  if (reason === 'depois_do_termino') {
    const termino = ehDiaValido(details.data_termino) ? ` (${formatarDiaAtividade(details.data_termino)})` : '';
    return `A ${nome} não pode ser depois da data de término do serviço${termino}.`;
  }
  // D-PROD-267: concluir (a área ou a atividade) antes do último dia que já tem lançamento.
  if (reason === 'antes_do_ultimo_dia') {
    const ultimo = ehDiaValido(details.ultimo_dia) ? ` (${formatarDiaAtividade(details.ultimo_dia)})` : '';
    return `A ${nome} não pode ser antes do último dia lançado${ultimo}.`;
  }
  return null;
};

/**
 * Status recusado (`details.status` × `details.acao`): o status da atividade
 * (ABERTA, CONCLUIDA, CANCELADA) ou o do apontamento (CANCELADO).
 * @param {Record<string, any>} details
 */
const fraseDoStatus = (details) => {
  const status = typeof details.status === 'string' ? details.status : '';
  const acao = typeof details.acao === 'string' ? details.acao : '';
  // D-PROD-249/263: o status é de uma ÁREA da atividade (só a área em andamento recebe lançamento).
  // D-PROD-276: o status é da REFORMA (só a aberta é concluída ou cancelada).
  if (details.entidade === 'planejamento') {
    if (status === 'CONCLUIDO') return 'Esta reforma já está concluída. Nada foi alterado.';
    if (status === 'CANCELADO') return 'Esta reforma está cancelada. Nada foi alterado.';
  }
  if (details.entidade === 'area') {
    if (status === 'CONCLUIDA') return 'Esta área já está concluída na atividade: reabra a área (no card "Áreas da atividade") ou tire-a do registro. Nada foi gravado.';
    if (status === 'PLANEJADA') return 'Esta área ainda não foi iniciada na atividade: inicie a área antes de lançar. Nada foi gravado.';
  }
  if (status === STATUS_CANCELADO) return 'Este apontamento está cancelado: não aceita edição nem novo cancelamento. Nada foi alterado.';
  if (status === STATUS_CANCELADA) return 'Esta atividade está cancelada: não aceita mais alterações nem apontamentos. Nada foi alterado.';
  if (status === STATUS_CONCLUIDA) {
    return acao === 'cancelar'
      ? 'Esta atividade está concluída: para cancelar, reabra-a antes. Nada foi alterado.'
      : 'Esta atividade está concluída: reabra-a para editar o cabeçalho ou mexer nos apontamentos. Nada foi alterado.';
  }
  if (status === STATUS_ABERTA && acao === 'reabrir') return 'Esta atividade já está aberta: só a atividade concluída é reaberta. Nada foi alterado.';
  return null;
};

/**
 * Mensagem clara da recusa (nunca vazia; a `message` do servidor não é exibida).
 * Os códigos `ATIVIDADE_*` do contrato (§10) dizem QUAL campo ou QUAL status;
 * o resto cai no catálogo de Gestão / `ApiError` (`mensagemErroGestao`).
 * @param {unknown} erro
 * @param {string} [fallback]
 */
export const mensagemDeErroAtividade = (erro, fallback = 'Não foi possível concluir. Nada foi gravado.') => {
  const { code, field, reason, details } = lerErroGestao(erro);
  // `details.entidade` (atividade | apontamento) vem do servidor; sem ele, o recurso da chamada.
  const doApontamento = details.entidade === 'apontamento' || (details.entidade == null && /** @type {any} */ (erro)?.resource === 'AtividadeApontamento');
  switch (code) {
    case 'ATIVIDADE_NOT_FOUND':
      return 'Esta atividade não foi encontrada nesta fazenda. A lista será relida. Nada foi alterado.';
    // D-PROD-276: a reforma (de outra fazenda, de outro tenant ou que sumiu).
    case 'PLANEJAMENTO_NOT_FOUND':
      return 'Esta reforma não foi encontrada nesta fazenda. Atualize a lista e tente de novo. Nada foi alterado.';
    case 'ATIVIDADE_APONTAMENTO_NOT_FOUND':
      return 'Este apontamento não foi encontrado nesta atividade. Os apontamentos serão relidos. Nada foi alterado.';
    case 'ATIVIDADE_REFERENCIA_INVALIDA': {
      // `areas[n].area_id` (várias áreas, D-PROD-249/263) tem as frases de `area_id`.
      const frase = (REFERENCIAS[field ?? ''] ?? REFERENCIAS[String(field ?? '').replace(/^areas\[\d+\]\./, '')])?.[reason ?? ''];
      return `${frase ?? 'Um dos cadastros escolhidos não pode ser usado (não existe, está inativo ou é de outra fazenda)'}. Nada foi gravado.`;
    }
    case 'ATIVIDADE_EXIGIDA_PELO_TIPO':
      if (reason === 'permite_produto') return 'O tipo desta atividade não permite produto. Nada foi gravado.';
      if (reason === 'permite_implemento') return 'O tipo desta atividade não permite implemento. Nada foi gravado.';
      if (reason === 'permite_mao_obra') return 'O tipo desta atividade não permite mão de obra. Nada foi gravado.';
      if (reason === 'permite_servico') return 'O tipo desta atividade não permite serviço. Nada foi gravado.';
      return `${EXIGIDOS[field ?? ''] ?? 'O tipo de atividade exige um dado que não foi informado.'} Nada foi gravado.`;
    case 'ATIVIDADE_DATA_INVALIDA': {
      const frase = fraseDaData(field, reason, details);
      return `${frase ?? 'A data foi recusada: confira as datas da atividade.'} Nada foi gravado.`;
    }
    case 'ATIVIDADE_STATUS_INVALIDO':
      return (
        fraseDoStatus(details) ??
        'Esta ação não é permitida no status atual: só a atividade aberta aceita edição, conclusão, cancelamento e apontamentos, e só a concluída é reaberta. Nada foi alterado.'
      );
    case 'ATIVIDADE_VERSAO_CONFLITO':
      // D-PROD-276: a reforma mudou desde a leitura.
      if (details.entidade === 'planejamento') return 'Esta reforma foi alterada por outra pessoa desde que você a abriu. Ela será relida: confira e tente de novo. Nada foi gravado.';
      return doApontamento
        ? 'Este apontamento foi alterado por outra pessoa desde que você o abriu. Ele será relido: confira e tente de novo. Nada foi gravado.'
        : 'Esta atividade foi alterada por outra pessoa desde que você a abriu. Ela será relida: confira e tente de novo. Nada foi gravado.';
    case 'ATIVIDADE_MOTIVO_INVALIDO':
      return reason === 'longo'
        ? `O motivo pode ter no máximo ${MOTIVO_MAXIMO} caracteres. Nada foi alterado.`
        : `Informe o motivo com pelo menos ${MOTIVO_MINIMO} caracteres. Nada foi alterado.`;
    case 'ATIVIDADE_VINCULADA':
      return 'Não é possível excluir: há atividades ou apontamentos de atividade vinculados a este cadastro. Inative-o em vez de excluir. Nada foi apagado.';
    // D-PROD-202 (Fatia 3) — linhas de produto e de máquina (a janela da linha detalha em `mensagemDeErroLinha`).
    case 'ATIVIDADE_LINHA_NOT_FOUND':
      return 'Esta linha não foi encontrada neste apontamento. Os lançamentos serão relidos. Nada foi alterado.';
    case 'ATIVIDADE_LINHA_INVALIDA':
      return 'Uma linha do lançamento foi recusada: confira os produtos, as máquinas, a mão de obra e os serviços. Nada foi gravado.';
    case 'ATIVIDADE_SALTO_MEDIDOR':
      return 'O uso da máquina passa do teto de salto do medidor: informe a justificativa (3 a 500 caracteres) e envie de novo. Nada foi gravado.';
    case 'ATIVIDADE_ESTORNO_BLOQUEADO':
      return 'O estorno exato de um produto não é seguro agora: o lote de onde ele saiu já foi consumido, transferido ou mudou. Nada foi alterado.';
    // D-PROD-267: o registro acharia uma atividade parada há mais de 30 dias (a Nova realização pergunta).
    case 'ATIVIDADE_SERVICO_PARADO': {
      const desde = ehDiaValido(details.ultimo_dia) ? ` desde ${formatarDiaAtividade(details.ultimo_dia)}` : '';
      return `Este serviço está parado${desde}. Diga se é continuação dele ou um serviço novo. Nada foi gravado.`;
    }
    case 'ATIVIDADE_DATA_COM_LINHAS':
      return 'A data do apontamento não muda com linha de produto, máquina, mão de obra ou serviço confirmada: cancele o apontamento e lance de novo. Nada foi gravado.';
    default:
      return mensagemErroGestao(erro, fallback);
  }
};

/**
 * Campo do formulário que a recusa aponta (para destacar), no nome do
 * contrato (`area_id`, `data_inicio`, `motivo`…), ou null.
 * @param {unknown} erro
 */
export const campoDoErroAtividade = (erro) => {
  const { code, field } = lerErroGestao(erro);
  if (code === 'ATIVIDADE_MOTIVO_INVALIDO') return 'motivo';
  if (code === 'ATIVIDADE_REFERENCIA_INVALIDA' || code === 'ATIVIDADE_EXIGIDA_PELO_TIPO' || code === 'ATIVIDADE_DATA_INVALIDA') {
    return typeof field === 'string' && field ? field : null;
  }
  return null;
};

/**
 * Texto de um alerta da escrita de apontamento (§10: não bloqueia, o
 * apontamento foi gravado). `FORA_DO_INTERVALO`: o dia caiu fora de
 * `[data_inicio, data_prevista_fim]`.
 * @param {any} alerta
 */
export const mensagemDoAlertaAtividade = (alerta) => {
  if (alerta?.codigo === 'FORA_DO_INTERVALO') {
    const inicio = formatarDiaAtividade(alerta.data_inicio);
    const fim = formatarDiaAtividade(alerta.data_prevista_fim);
    const periodo = inicio && fim ? ` (de ${inicio} a ${fim})` : inicio ? ` (início em ${inicio})` : '';
    return `A data do apontamento está fora do período previsto da atividade${periodo}. O apontamento foi gravado.`;
  }
  return 'O apontamento foi gravado com um aviso do servidor.';
};
