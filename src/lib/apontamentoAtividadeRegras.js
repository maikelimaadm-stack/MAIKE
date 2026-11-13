/**
 * Regras do Apontamento de Atividade no navegador (D-PROD-188, Fatia C).
 *
 * O apontamento é a EXECUÇÃO de um Tipo de Atividade: a TAREFA é a demanda; a
 * ATIVIDADE é a operação feita, que consome máquina, combustível e insumo.
 * Aqui ficam só regras PURAS do formulário (estado, validação, corpo do envio,
 * PATCH mínimo, rótulos e mensagens); quem decide de fato é o servidor.
 *
 *  - Datas de negócio são TEXTO de dia (AAAA-MM-DD); "hoje" é o da FAZENDA
 *    (fuso IANA da Empresa), como no abastecimento.
 *  - Hora início/fim: a pessoa digita HH:MM no relógio da fazenda; o envio é o
 *    instante ISO 8601 do dia da atividade com o deslocamento EXPLÍCITO do fuso
 *    (ex.: "2026-11-10T07:30:00-04:00"); sem fuso não há hora (o servidor
 *    recusaria a hora ambígua).
 *  - Quantidade produzida é TEXTO canônico ("12.5"), nunca Number; anda junto
 *    com a unidade (HA, CAB, TON, KM).
 *  - Centro de CUSTO (regra acordada com o proprietário): no apontamento NOVO
 *    ele vem preenchido com o centro de custo do bem escolhido (a opção do bem
 *    já traz `centro_custo` só quando o centro está ATIVO) e o usuário pode
 *    trocar antes de salvar; a escolha manual dele nunca é sobrescrita por uma
 *    troca de máquina. Na criação o servidor também copia o centro ativo do bem
 *    quando o corpo o deixa vazio. Depois de gravado é SNAPSHOT: na edição nada
 *    vem do bem, ele só muda se o usuário escolher outro.
 *  - Centro de RESULTADO: sempre escolhido pelo usuário numa lista normal de
 *    centros ativos; nunca vem do bem.
 */

import { comparar, ehCanonico, ehPositivo, formatarNumero, lerNumeroLocal, paraTextoDeEdicao } from './dinheiroDecimal.js';
import { ehDiaValido, formatarDia } from './diaCivil.js';
import { rotuloDoBem } from './abastecimentoRegras.js';
import { lerErroGestao, mensagemErroGestao } from './gestaoErros.js';

export { rotuloDoBem };

export const LOCALE_APONTAMENTO = 'pt-BR';
/** Decimal(14, 4) do servidor: até 10 inteiros e 4 casas. */
export const LIMITES_PRODUCAO = Object.freeze({ inteiros: 10, casas: 4 });
export const MAX_OBSERVACAO = 2000;
export const MOTIVO_MINIMO = 3;

export const STATUS_CONFIRMADO = 'CONFIRMADO';
export const STATUS_CANCELADO = 'CANCELADO';
export const ROTULO_STATUS_APONTAMENTO = Object.freeze({ CONFIRMADO: 'Confirmado', CANCELADO: 'Cancelado' });

/** Unidades da produção (hectare, cabeça, tonelada, quilômetro) — as mesmas do servidor. */
export const UNIDADES_PRODUCAO = Object.freeze(['HA', 'CAB', 'TON', 'KM']);
export const ROTULO_UNIDADE_PRODUCAO = Object.freeze(/** @type {Record<string, string>} */ ({ HA: 'ha', CAB: 'cab', TON: 't', KM: 'km' }));
export const NOME_UNIDADE_PRODUCAO = Object.freeze(
  /** @type {Record<string, string>} */ ({ HA: 'Hectare (ha)', CAB: 'Cabeça (cab)', TON: 'Tonelada (t)', KM: 'Quilômetro (km)' }),
);

/** Máquina/veículo que executa a atividade (as naturezas que o abastecimento também chama de máquina). */
export const NATUREZAS_MAQUINA = Object.freeze(['MAQUINA', 'VEICULO', 'EQUIPAMENTO']);
/** Implemento puxado pela máquina. */
export const NATUREZAS_IMPLEMENTO = Object.freeze(['IMPLEMENTO']);

const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {number} n */
const dois = (n) => String(n).padStart(2, '0');

// ─── Hora no fuso da fazenda ─────────────────────────────────────────────

/**
 * Deslocamento (minutos, + a leste de UTC) do fuso IANA no instante `ms`.
 * @param {number} ms @param {string} fuso
 */
const deslocamentoNoFuso = (ms, fuso) => {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    numberingSystem: 'latn',
  }).formatToParts(new Date(ms));
  const v = (/** @type {string} */ tipo) => Number(partes.find((p) => p.type === tipo)?.value ?? NaN);
  const comoUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour') % 24, v('minute'), v('second'));
  return Math.round((comoUtc - ms) / 60000);
};

/**
 * Instante ISO 8601 com o deslocamento EXPLÍCITO do fuso da fazenda para o
 * dia e a hora digitados (relógio da fazenda). Dia, hora ou fuso inválidos →
 * null.
 * @param {string} dia AAAA-MM-DD
 * @param {string} hora HH:MM
 * @param {string|null|undefined} fuso IANA (ex.: "America/Cuiaba")
 * @returns {string|null}
 */
export const instanteNoFuso = (dia, hora, fuso) => {
  const d = RE_DIA.exec(String(dia ?? ''));
  const h = RE_HORA.exec(String(hora ?? ''));
  if (!d || !h || !ehDiaValido(dia) || !fuso) return null;
  const local = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(h[1]), Number(h[2]));
  try {
    // Duas passadas: o deslocamento do instante corrigido vale na troca de horário.
    const primeira = deslocamentoNoFuso(local, fuso);
    const deslocamento = deslocamentoNoFuso(local - primeira * 60000, fuso);
    if (!Number.isFinite(deslocamento)) return null;
    const abs = Math.abs(deslocamento);
    const sinal = deslocamento < 0 ? '-' : '+';
    return `${dia}T${h[1]}:${h[2]}:00${sinal}${dois(Math.floor(abs / 60))}:${dois(abs % 60)}`;
  } catch {
    return null;
  }
};

/**
 * HH:MM de um instante ISO no relógio da fazenda (vazio quando ausente ou sem fuso válido).
 * @param {unknown} iso @param {string|null|undefined} fuso
 */
export const horaNoFuso = (iso, fuso) => {
  if (typeof iso !== 'string' || !iso || !fuso) return '';
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return '';
  try {
    const partes = new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' }).formatToParts(instante);
    const v = (/** @type {string} */ tipo) => partes.find((p) => p.type === tipo)?.value ?? '';
    return `${dois(Number(v('hour')) % 24)}:${v('minute')}`;
  } catch {
    return '';
  }
};

// ─── Rótulos ─────────────────────────────────────────────────────────────

/** @param {{ numero?: unknown, nome?: unknown } | null | undefined} c */
export const rotuloDoCentro = (c) => {
  if (!c || typeof c !== 'object') return '';
  const nome = texto(c.nome);
  return c.numero != null && String(c.numero) && nome ? `${String(c.numero)} — ${nome}` : nome;
};

/** @param {{ numero_area?: unknown, nome?: unknown } | null | undefined} a */
export const rotuloDaArea = (a) => {
  if (!a || typeof a !== 'object') return '';
  const nome = texto(a.nome);
  const numero = a.numero_area != null ? String(a.numero_area).trim() : '';
  return numero && nome ? `${numero} — ${nome}` : nome || numero;
};

/** @param {{ nome?: unknown } | null | undefined} u */
export const rotuloDoOperador = (u) => (u && typeof u === 'object' ? texto(u.nome) : '');

/** Dia para exibição ("10/11/2026"). @param {unknown} dia */
export const formatarDiaApontamento = (dia) => (dia ? formatarDia(dia, LOCALE_APONTAMENTO) : '');

/** "12,5 ha". Vazio sem quantidade. @param {unknown} quantidade @param {unknown} unidade */
export const formatarProducao = (quantidade, unidade) => {
  if (!ehCanonico(quantidade)) return '';
  const numero = formatarNumero(/** @type {string} */ (quantidade), { locale: LOCALE_APONTAMENTO, casasMax: LIMITES_PRODUCAO.casas });
  const sufixo = ROTULO_UNIDADE_PRODUCAO[String(unidade ?? '')] ?? '';
  return sufixo ? `${numero} ${sufixo}` : numero;
};

/** "07:30 – 11:15", "a partir de 07:30", "até 11:15" ou vazio. @param {any} r @param {string|null} fuso */
export const formatarHorario = (r, fuso) => {
  const inicio = horaNoFuso(r?.hora_inicio, fuso);
  const fim = horaNoFuso(r?.hora_fim, fuso);
  if (inicio && fim) return `${inicio} – ${fim}`;
  if (inicio) return `a partir de ${inicio}`;
  if (fim) return `até ${fim}`;
  return '';
};

// ─── Estado do formulário ────────────────────────────────────────────────

/** Origem do centro de custo no formulário NOVO: veio do bem escolhido ou o usuário escolheu à mão. */
export const ORIGEM_CENTRO_BEM = 'bem';
export const ORIGEM_CENTRO_USUARIO = 'usuario';

/**
 * @typedef {{ id: string, rotulo: string } | null} OpcaoEscolhida
 * @typedef {'bem' | 'usuario' | null} OrigemCentroCusto
 * @typedef {{
 *   tipo_atividade_id: string,
 *   data_operacional: string,
 *   bem: OpcaoEscolhida,
 *   implemento: OpcaoEscolhida,
 *   operador: OpcaoEscolhida,
 *   area_id: string,
 *   hora_inicio: string,
 *   hora_fim: string,
 *   quantidade_produzida: string,
 *   unidade_producao: string,
 *   observacao: string,
 *   centro_custo: OpcaoEscolhida,
 *   centro_custo_origem: OrigemCentroCusto,
 *   centro_custo_do_bem: OpcaoEscolhida,
 *   centro_resultado: OpcaoEscolhida,
 * }} FormularioApontamento
 */

/** Formulário em branco no "hoje" da fazenda. @param {string} hoje @returns {FormularioApontamento} */
export const formularioVazio = (hoje) => ({
  tipo_atividade_id: '',
  data_operacional: hoje || '',
  bem: null,
  implemento: null,
  operador: null,
  area_id: '',
  hora_inicio: '',
  hora_fim: '',
  quantidade_produzida: '',
  unidade_producao: '',
  observacao: '',
  centro_custo: null,
  centro_custo_origem: null,
  centro_custo_do_bem: null,
  centro_resultado: null,
});

/** @param {unknown} id @param {string} rotulo @returns {OpcaoEscolhida} */
const opcao = (id, rotulo) => (typeof id === 'string' && id ? { id, rotulo: rotulo || id } : null);

/**
 * Centro de custo que a opção de bem traz (`centro_custo`, preenchido pelo
 * servidor só quando o centro do bem está ATIVO), com o rótulo dos outros
 * centros; sem centro → null.
 * @param {any} opcaoDoBem @returns {OpcaoEscolhida}
 */
export const centroCustoDoBem = (opcaoDoBem) => {
  const c = opcaoDoBem?.centro_custo;
  if (!c || typeof c !== 'object' || c.id == null) return null;
  return opcao(String(c.id), rotuloDoCentro(c));
};

/**
 * Mudança do formulário ao escolher (ou limpar) a máquina/veículo. Trocar ou
 * limpar a máquina limpa o implemento. No apontamento NOVO o centro de custo
 * acompanha o bem (o do novo bem, ou vazio) enquanto não for escolha manual do
 * usuário; a escolha manual nunca é sobrescrita. O centro que o bem traz fica
 * guardado em `centro_custo_do_bem` (é o que o servidor copiaria se o campo
 * fosse enviado vazio). Na EDIÇÃO o centro é snapshot: nunca é relido do bem.
 * O centro de resultado nunca vem do bem.
 * @param {FormularioApontamento} form @param {any} opcaoDoBem @param {{ novo: boolean }} ctx
 * @returns {Partial<FormularioApontamento>}
 */
export const mudancaAoEscolherBem = (form, opcaoDoBem, { novo }) => {
  /** @type {Partial<FormularioApontamento>} */
  const mudanca = { bem: opcaoDoBem ? opcao(String(opcaoDoBem.id ?? ''), rotuloDoBem(opcaoDoBem)) : null, implemento: null };
  if (!novo) return mudanca;
  const centro = centroCustoDoBem(opcaoDoBem);
  if (form?.centro_custo_origem === ORIGEM_CENTRO_USUARIO) return { ...mudanca, centro_custo_do_bem: centro };
  return { ...mudanca, centro_custo: centro, centro_custo_origem: centro ? ORIGEM_CENTRO_BEM : null, centro_custo_do_bem: centro };
};

/**
 * Mudança do formulário ao escolher (ou limpar) o centro de custo à mão. No
 * apontamento NOVO com máquina cujo centro está ativo, limpar o campo traz de
 * volta o centro do bem: na criação, o servidor copia o centro do bem quando o
 * centro vem vazio (R-e), e a tela não pode mostrar vazio o que será gravado.
 * Na edição, limpar limpa (o servidor nunca relê o bem).
 * @param {any} opcaoDoCentro @param {FormularioApontamento|null} [form] @param {{ novo?: boolean }} [ctx]
 * @returns {Partial<FormularioApontamento>}
 */
export const mudancaAoEscolherCentroCusto = (opcaoDoCentro, form = null, { novo = false } = {}) => {
  const centro = opcaoDoCentro ? opcao(String(opcaoDoCentro.id ?? ''), rotuloDoCentro(opcaoDoCentro)) : null;
  if (centro) return { centro_custo: centro, centro_custo_origem: ORIGEM_CENTRO_USUARIO };
  const doBem = novo && form?.bem ? form.centro_custo_do_bem ?? null : null;
  return doBem ? { centro_custo: doBem, centro_custo_origem: ORIGEM_CENTRO_BEM } : { centro_custo: null, centro_custo_origem: null };
};

/**
 * Formulário a partir do registro gravado (detalhe/lista do servidor). Os
 * centros são os GRAVADOS no apontamento (snapshot; nunca relidos do bem, nem
 * ao trocar a máquina na edição).
 * @param {any} r @param {string|null|undefined} fuso @returns {FormularioApontamento}
 */
export const formularioDoRegistro = (r, fuso) => ({
  tipo_atividade_id: texto(r?.tipo_atividade_id),
  data_operacional: texto(r?.data_operacional),
  bem: opcao(r?.bem_id, rotuloDoBem(r?.bem)),
  implemento: opcao(r?.implemento_bem_id, rotuloDoBem(r?.implemento)),
  operador: opcao(r?.operador_usuario_id, rotuloDoOperador(r?.operador)),
  area_id: texto(r?.area_id),
  hora_inicio: horaNoFuso(r?.hora_inicio, fuso),
  hora_fim: horaNoFuso(r?.hora_fim, fuso),
  quantidade_produzida: paraTextoDeEdicao(r?.quantidade_produzida, LOCALE_APONTAMENTO, { casasMax: LIMITES_PRODUCAO.casas }),
  unidade_producao: texto(r?.unidade_producao),
  observacao: typeof r?.observacao === 'string' ? r.observacao : '',
  centro_custo: opcao(r?.centro_custo_id, rotuloDoCentro(r?.centro_custo)),
  centro_custo_origem: null,
  centro_custo_do_bem: null,
  centro_resultado: opcao(r?.centro_resultado_id, rotuloDoCentro(r?.centro_resultado)),
});

/** @param {string} motivo */
const mensagemDoNumero = (motivo) =>
  motivo === 'casas'
    ? `Use no máximo ${LIMITES_PRODUCAO.casas} casas decimais.`
    : motivo === 'limite'
      ? 'Quantidade acima do limite permitido.'
      : 'Quantidade inválida: use o formato 1.234,5.';

/**
 * Validação local (o servidor confere de novo). Devolve os erros por campo.
 * @param {FormularioApontamento} form
 * @param {{ hoje: string, fuso?: string|null }} ctx
 * @returns {Record<string, string>}
 */
export const validarFormulario = (form, { hoje, fuso = null }) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!texto(form?.tipo_atividade_id)) erros.tipo_atividade_id = 'Escolha o tipo de atividade.';
  const dia = texto(form?.data_operacional);
  if (!dia) erros.data_operacional = 'Informe a data da atividade.';
  else if (!ehDiaValido(dia)) erros.data_operacional = 'Data inválida.';
  else if (hoje && dia > hoje) erros.data_operacional = 'A data não pode ser posterior a hoje na fazenda: só se aponta atividade já executada.';
  if (form?.implemento?.id) {
    if (!form?.bem?.id) erros.implemento = 'Escolha a máquina ou o veículo antes do implemento.';
    else if (form.implemento.id === form.bem.id) erros.implemento = 'O implemento não pode ser a própria máquina ou veículo.';
  }
  const inicio = texto(form?.hora_inicio);
  const fim = texto(form?.hora_fim);
  if (inicio && !RE_HORA.test(inicio)) erros.hora_inicio = 'Hora inválida (HH:MM).';
  if (fim && !RE_HORA.test(fim)) erros.hora_fim = 'Hora inválida (HH:MM).';
  if (!erros.hora_inicio && !erros.hora_fim && inicio && fim && fim < inicio) erros.hora_fim = 'A hora de fim é anterior à hora de início.';
  // Sem o fuso da fazenda a hora seria ambígua (o servidor a recusaria): nunca some em silêncio.
  if ((inicio || fim) && !erros.hora_inicio && !erros.hora_fim && ehDiaValido(dia)) {
    const semFuso = 'Configure o fuso horário da fazenda (Empresa) para informar a hora.';
    if (inicio && !instanteNoFuso(dia, inicio, fuso)) erros.hora_inicio = semFuso;
    if (fim && !instanteNoFuso(dia, fim, fuso)) erros.hora_fim = semFuso;
  }
  const quantidade = texto(form?.quantidade_produzida);
  const unidade = texto(form?.unidade_producao);
  if (quantidade) {
    const lida = lerNumeroLocal(quantidade, LOCALE_APONTAMENTO, LIMITES_PRODUCAO);
    if (!lida.ok) erros.quantidade_produzida = mensagemDoNumero(String(lida.motivo));
    else if (!ehPositivo(/** @type {string} */ (lida.valor))) erros.quantidade_produzida = 'Informe uma quantidade maior que zero.';
    if (!unidade) erros.unidade_producao = 'Escolha a unidade da quantidade produzida.';
  } else if (unidade) {
    erros.quantidade_produzida = 'Informe a quantidade produzida da unidade escolhida.';
  }
  if (unidade && !UNIDADES_PRODUCAO.includes(unidade)) erros.unidade_producao = 'Unidade inválida.';
  if ((form?.observacao ?? '').length > MAX_OBSERVACAO) erros.observacao = `No máximo ${MAX_OBSERVACAO} caracteres.`;
  return erros;
};

/**
 * Corpo do envio a partir do formulário JÁ VALIDADO: exatamente as colunas que
 * o formulário edita (o resto do contrato não é tocado). Opcional vazio vai
 * `null`. O implemento sem máquina não vai (a máquina libera o implemento).
 * A origem do centro de custo (`centro_custo_origem`) é só estado da tela: não
 * vai no corpo; vai o centro escolhido, venha ele do bem ou do usuário.
 * @param {FormularioApontamento} form @param {string|null|undefined} fuso
 */
export const corpoDoFormulario = (form, fuso) => {
  const dia = texto(form.data_operacional);
  const quantidade = lerNumeroLocal(texto(form.quantidade_produzida), LOCALE_APONTAMENTO, LIMITES_PRODUCAO);
  const bemId = form.bem?.id ?? null;
  const inicio = texto(form.hora_inicio);
  const fim = texto(form.hora_fim);
  const observacao = texto(form.observacao);
  return {
    tipo_atividade_id: texto(form.tipo_atividade_id),
    data_operacional: dia,
    bem_id: bemId,
    implemento_bem_id: bemId ? (form.implemento?.id ?? null) : null,
    operador_usuario_id: form.operador?.id ?? null,
    area_id: texto(form.area_id) || null,
    hora_inicio: inicio ? instanteNoFuso(dia, inicio, fuso) : null,
    hora_fim: fim ? instanteNoFuso(dia, fim, fuso) : null,
    quantidade_produzida: quantidade.ok ? /** @type {string} */ (quantidade.valor) : null,
    unidade_producao: texto(form.unidade_producao) || null,
    observacao: observacao || null,
    centro_custo_id: form.centro_custo?.id ?? null,
    centro_resultado_id: form.centro_resultado?.id ?? null,
  };
};

/** @param {unknown} v */
const instanteMs = (v) => {
  if (typeof v !== 'string' || !v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * PATCH mínimo: só as chaves do corpo que mudaram em relação ao registro
 * gravado (hora comparada como instante; quantidade como decimal).
 * @param {any} original @param {Record<string, any>} corpo
 * @returns {Record<string, any>}
 */
export const camposAlteradosDoApontamento = (original, corpo) => {
  /** @type {Record<string, any>} */
  const saida = {};
  for (const [campo, valor] of Object.entries(corpo)) {
    const antes = original?.[campo] ?? null;
    let igual;
    if (campo === 'hora_inicio' || campo === 'hora_fim') igual = instanteMs(valor) === instanteMs(antes);
    else if (campo === 'quantidade_produzida') igual = valor === null || antes === null ? valor === antes : ehCanonico(antes) && comparar(valor, antes) === 0;
    else if (campo === 'observacao') igual = texto(valor) === texto(antes);
    else igual = (valor ?? null) === antes;
    if (!igual) saida[campo] = valor;
  }
  return saida;
};

// ─── Mensagens de erro do servidor ───────────────────────────────────────

/** Frase de cada referência recusada (`details.field` × `details.reason`). */
const REFERENCIAS = Object.freeze(
  /** @type {Record<string, Record<string, string>>} */ ({
    tipo_atividade_id: { inexistente: 'O tipo de atividade não foi encontrado', inativo: 'O tipo de atividade está inativo: escolha um tipo ativo' },
    bem_id: { inexistente: 'A máquina ou o veículo não foi encontrado', outra_empresa: 'A máquina ou o veículo é de outra fazenda', inativo: 'A máquina ou o veículo está inativo' },
    implemento_bem_id: { inexistente: 'O implemento não foi encontrado', outra_empresa: 'O implemento é de outra fazenda', inativo: 'O implemento está inativo' },
    operador_usuario_id: { inexistente: 'O operador não foi encontrado', inativo: 'O operador está inativo' },
    area_id: { inexistente: 'A área não foi encontrada', outra_empresa: 'A área é de outra fazenda', inativo: 'A área está inativa' },
    centro_custo_id: { inexistente: 'O centro de custo não foi encontrado', outra_empresa: 'O centro de custo é de outra fazenda', inativo: 'O centro de custo está inativo' },
    centro_resultado_id: {
      inexistente: 'O centro de resultado não foi encontrado',
      outra_empresa: 'O centro de resultado é de outra fazenda',
      inativo: 'O centro de resultado está inativo',
    },
    lancamento_tarefa_id: { inexistente: 'A tarefa não foi encontrada', outra_empresa: 'A tarefa é de outra fazenda' },
  }),
);

const PRODUCAO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    quantidade_sem_unidade: 'Escolha a unidade da quantidade produzida (ha, cab, t ou km).',
    unidade_sem_quantidade: 'Informe a quantidade produzida da unidade escolhida.',
    quantidade_nao_positiva: 'A quantidade produzida deve ser maior que zero.',
    horas_nao_positivas: 'As horas trabalhadas devem ser maiores que zero.',
  }),
);

/**
 * Horário recusado pelo servidor (um só código): `reason` diz qual regra e
 * `field` qual hora. `fim_antes_do_inicio` (R-b); `hora_futura` e
 * `hora_fora_do_dia` (R-c das horas, no fuso da fazenda).
 * @param {string|null} reason @param {string|null} field @returns {string|null}
 */
const fraseDoHorario = (reason, field) => {
  const qual = field === 'hora_inicio' ? 'início' : 'fim';
  if (reason === 'fim_antes_do_inicio') return 'A hora de fim é anterior à hora de início.';
  if (reason === 'hora_futura') return `A hora de ${qual} é posterior a agora na fazenda: só se aponta atividade já executada.`;
  if (reason === 'hora_fora_do_dia') {
    return field === 'hora_inicio'
      ? 'A hora de início tem de cair na data da atividade (no fuso da fazenda).'
      : 'A hora de fim tem de cair na data da atividade (no fuso da fazenda).';
  }
  return null;
};

/** Campo do formulário que cada coluna recusada destaca. */
export const CAMPO_DO_FORMULARIO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    tipo_atividade_id: 'tipo_atividade_id',
    data_operacional: 'data_operacional',
    bem_id: 'bem',
    implemento_bem_id: 'implemento',
    operador_usuario_id: 'operador',
    area_id: 'area_id',
    hora_inicio: 'hora_inicio',
    hora_fim: 'hora_fim',
    quantidade_produzida: 'quantidade_produzida',
    unidade_producao: 'unidade_producao',
    observacao: 'observacao',
    centro_custo_id: 'centro_custo',
    centro_resultado_id: 'centro_resultado',
  }),
);

/** Códigos que significam "o apontamento não existe mais / mudou": a tela relê a lista. */
export const CODIGOS_RELER_APONTAMENTO = Object.freeze([
  'APONTAMENTO_ATIVIDADE_NOT_FOUND',
  'APONTAMENTO_ATIVIDADE_STATUS_INVALIDO',
  'APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO',
]);

/** @param {unknown} erro */
export const codigoDoErroApontamento = (erro) => lerErroGestao(erro).code;

/**
 * Mensagem clara da recusa do servidor (nunca vazia; a `message` do servidor
 * não é exibida). Referência e produção dizem QUAL campo; o resto cai no
 * catálogo de Gestão/`ApiError`.
 * @param {unknown} erro @param {string} fallback
 */
export const mensagemErroApontamento = (erro, fallback) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  if (code === 'APONTAMENTO_ATIVIDADE_REFERENCIA_INVALIDA') {
    const frase = REFERENCIAS[field ?? '']?.[reason ?? ''];
    return `${frase ?? 'Um dos cadastros escolhidos não pode ser usado (não existe, é de outra fazenda ou está inativo)'}. Nada foi gravado.`;
  }
  if (code === 'APONTAMENTO_ATIVIDADE_PRODUCAO_INVALIDA') {
    return `${PRODUCAO[reason ?? ''] ?? 'Produção inválida: informe quantidade e unidade juntas, com quantidade maior que zero.'} Nada foi gravado.`;
  }
  if (code === 'APONTAMENTO_ATIVIDADE_IMPLEMENTO_INVALIDO') {
    return reason === 'implemento_sem_bem'
      ? 'Escolha a máquina ou o veículo antes do implemento. Nada foi gravado.'
      : 'O implemento não pode ser a própria máquina ou veículo. Nada foi gravado.';
  }
  if (code === 'APONTAMENTO_ATIVIDADE_HORARIO_INVALIDO') {
    const frase = fraseDoHorario(reason, field);
    if (frase) return `${frase} Nada foi gravado.`;
  }
  if (code === 'APONTAMENTO_ATIVIDADE_DATA_FUTURA') {
    const hoje = typeof details.hoje === 'string' ? ` (hoje na fazenda: ${formatarDia(details.hoje)})` : '';
    return `A data da atividade é posterior a hoje${hoje}: só se aponta atividade já executada. Nada foi gravado.`;
  }
  return mensagemErroGestao(erro, fallback);
};

/**
 * Campo do formulário que a recusa do servidor aponta (para destacar), ou null.
 * @param {unknown} erro
 */
export const campoDoErroApontamento = (erro) => {
  const { code, field } = lerErroGestao(erro);
  if (!code || !String(code).startsWith('APONTAMENTO_ATIVIDADE_')) return null;
  return CAMPO_DO_FORMULARIO[field ?? ''] ?? null;
};
