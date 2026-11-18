/**
 * Regras puras dos FORMULÁRIOS e da LISTA POR DIA do Lançamento de Atividades
 * (D-PROD-200, Fatia 2): o formulário do cabeçalho (abrir e editar a
 * atividade), o do apontamento do dia e o agrupamento dos apontamentos por dia.
 * Quem decide é o servidor; aqui ficam o estado dos formulários, a validação
 * local, o corpo do envio, o PATCH mínimo e a prévia do que a atividade herda.
 * Rótulos, status, turnos, limites e mensagens de recusa são os da tela
 * (`lancamentoAtividadesRegras.js`): esta lib só os usa.
 *
 *  - Datas de negócio são TEXTO de dia (AAAA-MM-DD); "hoje" é o da FAZENDA.
 *  - Decimais (área planejada, área do dia, produção do dia) vão em TEXTO
 *    canônico ("12.5"), nunca Number: até 10 inteiros e 4 casas, o
 *    Decimal(14, 4) do servidor. Sinal não é aceito (todos são ≥ 0).
 *  - HERDADO, nunca digitado: o setor vem da área; centro de custo, centro de
 *    resultado e unidade de produção vêm do tipo na abertura e ficam como
 *    snapshot. Nenhum desses campos entra em corpo algum, e o corpo do
 *    apontamento não leva área, setor, safra, centros, unidade nem máquina:
 *    eles são do cabeçalho.
 *  - A empresa (`empresa_id`) não entra aqui: o serviço da tela a põe; e a
 *    porta tira as chaves vazias do corpo de criação (o servidor aplica o
 *    padrão), enquanto na edição o `null` limpa o campo.
 */

import { comparar, ehCanonico, lerNumeroLocal, paraTextoDeEdicao } from './dinheiroDecimal.js';
import { ehDiaValido } from './diaCivil.js';
import {
  CODIGOS_RELER_ATIVIDADE,
  LIMITES_DECIMAL_ATIVIDADE,
  LOCALE_ATIVIDADE,
  MAX_NOME_ATIVIDADE,
  MAX_OBSERVACAO_ATIVIDADE,
  MAX_SAFRA_ATIVIDADE,
  ROTULO_TURNO,
  STATUS_CONFIRMADO,
  TURNOS,
  campoDoErroAtividade,
  codigoDoErroAtividade,
  formatarDecimalAtividade,
  formatarDiaAtividade,
  rotuloDaUnidadeDeProducao,
  rotuloDoBem,
  rotuloDoCentro,
  rotuloDoUsuario,
} from './lancamentoAtividadesRegras.js';

/** Turnos válidos como lista de texto (para conferir o que veio do formulário). */
const TURNOS_VALIDOS = /** @type {readonly string[]} */ (TURNOS);

/** Opções do campo Turno (o vazio, "Sem turno", é o placeholder do campo). */
export const OPCOES_TURNO = Object.freeze(TURNOS_VALIDOS.map((t) => Object.freeze({ value: t, label: ROTULO_TURNO[t] ?? t })));

/** Raiz das consultas da tela; a lista dos apontamentos de uma atividade fica embaixo dela. */
export const RAIZ_CONSULTAS_ATIVIDADES = 'lancamento-atividades';

/**
 * Chave da lista dos apontamentos de UMA atividade da fazenda.
 * @param {string|null|undefined} empresaId @param {string|null|undefined} atividadeId
 */
export const chaveApontamentos = (empresaId, atividadeId) => [RAIZ_CONSULTAS_ATIVIDADES, 'apontamentos', empresaId ?? null, atividadeId ?? null];

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** Tamanho em caracteres (não em unidades UTF-16), como o servidor conta. @param {string} t */
const tamanho = (t) => [...t].length;

// ─── Rótulos do dia ──────────────────────────────────────────────────────

/** "1ª passada", "2ª passada"… (vazio sem sequência válida). @param {unknown} sequencia */
export const rotuloDaPassada = (sequencia) =>
  Number.isInteger(sequencia) && /** @type {number} */ (sequencia) >= 1 ? `${/** @type {number} */ (sequencia)}ª passada` : '';

/** Sigla da unidade de produção do CABEÇALHO (o snapshot; sem ele, a do cadastro incluído). @param {any} atividade */
export const siglaDaProducao = (atividade) => texto(atividade?.unidade_producao_sigla) || texto(atividade?.unidade_producao?.sigla);

/** "12,5 ha" / "30 SC" / "12,5" (sem sigla); vazio sem valor. @param {unknown} v @param {unknown} sigla */
export const formatarComUnidade = (v, sigla) => {
  const numero = formatarDecimalAtividade(v);
  if (!numero) return '';
  const s = texto(sigla);
  return s ? `${numero} ${s}` : numero;
};

/** "de 01/11/2026 a 10/11/2026", "a partir de 01/11/2026", "até 10/11/2026" ou vazio. @param {unknown} inicio @param {unknown} fim */
export const textoDoPeriodo = (inicio, fim) => {
  const i = formatarDiaAtividade(inicio);
  const f = formatarDiaAtividade(fim);
  if (i && f) return `de ${i} a ${f}`;
  if (i) return `a partir de ${i}`;
  if (f) return `até ${f}`;
  return '';
};

/**
 * O dia cai fora do período da atividade (antes do início ou depois do fim
 * previsto)? O servidor aceita e devolve o alerta FORA_DO_INTERVALO.
 * @param {unknown} dia @param {any} atividade
 */
export const foraDoPeriodo = (dia, atividade) => {
  if (!ehDiaValido(dia)) return false;
  const d = /** @type {string} */ (dia);
  const inicio = texto(atividade?.data_inicio);
  const fim = texto(atividade?.data_prevista_fim);
  return (ehDiaValido(inicio) && d < inicio) || (ehDiaValido(fim) && d > fim);
};

// ─── Herança do tipo (prévia do que o servidor grava) ────────────────────

/**
 * @typedef {{ rotulo: string, nota: string|null }} Herdado
 * @typedef {{ centro_custo: Herdado, centro_resultado: Herdado, unidade_producao: Herdado }} HerancaDoTipo
 */

const SEM_HERANCA = Object.freeze({ rotulo: '', nota: null });

/**
 * Centro padrão do tipo como o servidor o herda (`padroesParaAtividade`, Fatia
 * 1): só se existir, estiver ATIVO e for da MESMA fazenda da atividade.
 * @param {unknown} centro @param {string|null} empresaId @param {string} nome "centro de custo" | "centro de resultado"
 * @returns {Herdado}
 */
const centroHerdado = (centro, empresaId, nome) => {
  if (!ehObjeto(centro) || typeof centro.id !== 'string' || !centro.id) return SEM_HERANCA;
  if (centro.ativo !== true) return { rotulo: '', nota: `O ${nome} padrão do tipo está inativo: a atividade abre sem ${nome}.` };
  if (!empresaId || centro.empresa_id !== empresaId) {
    return { rotulo: '', nota: `O ${nome} padrão do tipo é de outra fazenda: a atividade abre sem ${nome}.` };
  }
  return { rotulo: rotuloDoCentro(centro) || centro.id, nota: null };
};

/**
 * O que a atividade NOVA herda do tipo escolhido, como o servidor faz na
 * abertura: centro de custo e de resultado padrão (ativos e da mesma fazenda)
 * e a unidade de produção (ativa). É só PRÉVIA, nunca vai no corpo: o servidor
 * relê o tipo e grava o snapshot.
 * @param {unknown} tipo o registro de `listarTiposAtividade` (com os objetos dos padrões)
 * @param {string|null} empresaId a fazenda selecionada
 * @returns {HerancaDoTipo}
 */
export const herancaDoTipo = (tipo, empresaId) => {
  if (!ehObjeto(tipo)) return { centro_custo: SEM_HERANCA, centro_resultado: SEM_HERANCA, unidade_producao: SEM_HERANCA };
  const unidade = tipo.unidade_producao;
  /** @type {Herdado} */
  let unidadeHerdada = SEM_HERANCA;
  if (ehObjeto(unidade) && typeof unidade.id === 'string' && unidade.id) {
    unidadeHerdada =
      unidade.ativo === true
        ? { rotulo: rotuloDaUnidadeDeProducao({ unidade_producao: unidade }) || unidade.id, nota: null }
        : { rotulo: '', nota: 'A unidade de produção padrão do tipo está inativa: a atividade abre sem unidade de produção.' };
  }
  return {
    centro_custo: centroHerdado(tipo.centro_custo_padrao, empresaId, 'centro de custo'),
    centro_resultado: centroHerdado(tipo.centro_resultado_padrao, empresaId, 'centro de resultado'),
    unidade_producao: unidadeHerdada,
  };
};

/**
 * Snapshot GRAVADO na atividade (edição): nunca relido do tipo. Os
 * convertidos da Fatia 2 só têm a sigla de texto da unidade (KM, HA).
 * @param {unknown} atividade
 * @returns {HerancaDoTipo}
 */
export const herancaGravada = (atividade) => {
  const a = ehObjeto(atividade) ? atividade : {};
  return {
    centro_custo: { rotulo: rotuloDoCentro(a.centro_custo) || (texto(a.centro_custo_id) ? 'Centro de custo gravado' : ''), nota: null },
    centro_resultado: {
      rotulo: rotuloDoCentro(a.centro_resultado) || (texto(a.centro_resultado_id) ? 'Centro de resultado gravado' : ''),
      nota: null,
    },
    unidade_producao: { rotulo: rotuloDaUnidadeDeProducao(a), nota: null },
  };
};

/**
 * O que o tipo exige na abertura (e de novo na edição): área, safra e máquina.
 * @param {unknown} tipo
 * @returns {{ area: boolean, safra: boolean, maquina: boolean }}
 */
export const exigenciasDoTipo = (tipo) => ({
  area: ehObjeto(tipo) && tipo.exige_area === true,
  safra: ehObjeto(tipo) && tipo.exige_safra === true,
  maquina: ehObjeto(tipo) && tipo.exige_maquina === true,
});

// ─── Decimais e PATCH mínimo ─────────────────────────────────────────────

/** @param {string} motivo @param {string} oque ex.: "A área planejada" */
const mensagemDoNumero = (motivo, oque) =>
  motivo === 'casas'
    ? `Use no máximo ${LIMITES_DECIMAL_ATIVIDADE.casas} casas decimais.`
    : motivo === 'limite'
      ? `${oque} passa do limite permitido.`
      : `${oque} está em formato inválido: use 1.234,5.`;

/**
 * Decimal digitado (pt-BR) → texto canônico; vazio → null; inválido → erro do campo.
 * @param {unknown} digitado @param {string} oque
 * @returns {{ valor: string|null, erro: string|null }}
 */
const lerDecimal = (digitado, oque) => {
  const t = texto(digitado);
  if (!t) return { valor: null, erro: null };
  const lida = lerNumeroLocal(t, LOCALE_ATIVIDADE, LIMITES_DECIMAL_ATIVIDADE);
  if (!lida.ok) return { valor: null, erro: mensagemDoNumero(String(lida.motivo), oque) };
  return { valor: /** @type {string} */ (lida.valor), erro: null };
};

/** Texto canônico gravado → texto do campo ("12.5000" → "12,5"). @param {unknown} v */
const decimalParaEdicao = (v) => paraTextoDeEdicao(v, LOCALE_ATIVIDADE, { casasMax: LIMITES_DECIMAL_ATIVIDADE.casas });

/**
 * Só as chaves do corpo que mudaram em relação ao registro gravado. Decimal
 * comparado como decimal ("12.5" = "12.5000"); texto aparado, vazio = null.
 * @param {any} original @param {Record<string, any>} corpo @param {readonly string[]} decimais
 * @returns {Record<string, any>}
 */
const diferencas = (original, corpo, decimais) => {
  /** @type {Record<string, any>} */
  const saida = {};
  for (const [campo, valor] of Object.entries(corpo)) {
    const antes = original?.[campo] ?? null;
    let igual;
    if (decimais.includes(campo)) {
      igual = valor === null || antes === null ? valor === antes : ehCanonico(antes) && ehCanonico(valor) && comparar(valor, antes) === 0;
    } else if (typeof valor === 'string' || typeof antes === 'string') {
      igual = (texto(valor) || null) === (texto(antes) || null);
    } else {
      igual = (valor ?? null) === antes;
    }
    if (!igual) saida[campo] = valor;
  }
  return saida;
};

/**
 * @typedef {{ id: string, rotulo: string } | null} OpcaoEscolhida
 */

/** @param {unknown} id @param {string} rotulo @returns {OpcaoEscolhida} */
const opcao = (id, rotulo) => (typeof id === 'string' && id ? { id, rotulo: rotulo || id } : null);

// ─── Formulário da atividade (cabeçalho) ─────────────────────────────────

/**
 * @typedef {{
 *   nome: string,
 *   tipo_atividade_id: string,
 *   area_id: string,
 *   bem: OpcaoEscolhida,
 *   safra_ciclo: string,
 *   data_inicio: string,
 *   data_prevista_fim: string,
 *   area_planejada: string,
 *   lancamento_tarefa_id: string,
 *   observacao: string,
 * }} FormularioAtividade
 */

/** Atividade nova, com a data de início no "hoje" da fazenda. @param {string} hoje @returns {FormularioAtividade} */
export const formularioAtividadeVazio = (hoje) => ({
  nome: '',
  tipo_atividade_id: '',
  area_id: '',
  bem: null,
  safra_ciclo: '',
  data_inicio: hoje || '',
  data_prevista_fim: '',
  area_planejada: '',
  lancamento_tarefa_id: '',
  observacao: '',
});

/** Formulário a partir da atividade gravada (lista/detalhe do servidor). @param {any} a @returns {FormularioAtividade} */
export const formularioDaAtividade = (a) => ({
  nome: typeof a?.nome === 'string' ? a.nome : '',
  tipo_atividade_id: texto(a?.tipo_atividade_id),
  area_id: texto(a?.area_id),
  bem: opcao(a?.bem_id, rotuloDoBem(a?.bem)),
  safra_ciclo: typeof a?.safra_ciclo === 'string' ? a.safra_ciclo : '',
  data_inicio: texto(a?.data_inicio),
  data_prevista_fim: texto(a?.data_prevista_fim),
  area_planejada: decimalParaEdicao(a?.area_planejada),
  lancamento_tarefa_id: texto(a?.lancamento_tarefa_id),
  observacao: typeof a?.observacao === 'string' ? a.observacao : '',
});

/**
 * Validação local da atividade (o servidor confere tudo de novo). As
 * exigências do tipo (área, safra, máquina) AVISAM antes de enviar; quem
 * decide é o servidor, com o tipo atual.
 * @param {FormularioAtividade} form
 * @param {{ hoje: string, novo: boolean, exigencias: { area: boolean, safra: boolean, maquina: boolean }, nomeDoTipo?: string }} ctx
 * @returns {Record<string, string>}
 */
export const validarFormularioAtividade = (form, { hoje, novo, exigencias, nomeDoTipo = '' }) => {
  /** @type {Record<string, string>} */
  const erros = {};
  const nome = texto(form?.nome);
  if (!nome) erros.nome = 'Informe o nome da atividade.';
  else if (tamanho(nome) > MAX_NOME_ATIVIDADE) erros.nome = `No máximo ${MAX_NOME_ATIVIDADE} caracteres.`;
  if (novo && !texto(form?.tipo_atividade_id)) erros.tipo_atividade_id = 'Escolha o tipo de atividade.';
  const doTipo = nomeDoTipo ? `O tipo ${nomeDoTipo} exige` : 'O tipo desta atividade exige';
  if (exigencias.area && !texto(form?.area_id)) erros.area_id = `${doTipo} a área.`;
  if (exigencias.maquina && !form?.bem?.id) erros.bem = `${doTipo} a máquina.`;
  const safra = texto(form?.safra_ciclo);
  if (!safra && exigencias.safra) erros.safra_ciclo = `${doTipo} a safra.`;
  else if (tamanho(safra) > MAX_SAFRA_ATIVIDADE) erros.safra_ciclo = `No máximo ${MAX_SAFRA_ATIVIDADE} caracteres.`;
  const inicio = texto(form?.data_inicio);
  if (!inicio) erros.data_inicio = 'Informe a data de início.';
  else if (!ehDiaValido(inicio)) erros.data_inicio = 'Data inválida.';
  else if (hoje && inicio > hoje) erros.data_inicio = 'A data de início não pode ser posterior a hoje na fazenda.';
  const fim = texto(form?.data_prevista_fim);
  if (fim) {
    if (!ehDiaValido(fim)) erros.data_prevista_fim = 'Data inválida.';
    else if (ehDiaValido(inicio) && fim < inicio) erros.data_prevista_fim = 'A data prevista de fim é anterior à data de início.';
  }
  const area = lerDecimal(form?.area_planejada, 'A área planejada');
  if (area.erro) erros.area_planejada = area.erro;
  if ((form?.observacao ?? '').length > MAX_OBSERVACAO_ATIVIDADE) erros.observacao = `No máximo ${MAX_OBSERVACAO_ATIVIDADE} caracteres.`;
  return erros;
};

/** Decimais do corpo da atividade (comparados como decimal no PATCH mínimo). */
const DECIMAIS_ATIVIDADE = /** @type {readonly string[]} */ (Object.freeze(['area_planejada']));

/**
 * Corpo do envio a partir do formulário JÁ VALIDADO: só os campos que o
 * formulário edita, opcional vazio = `null`. Na abertura vai o tipo; na edição
 * não (o tipo não muda). Centros, unidade, setor e grupo NUNCA entram: são
 * herdados.
 * @param {FormularioAtividade} form @param {{ novo: boolean }} ctx
 * @returns {Record<string, any>}
 */
export const corpoDaAtividade = (form, { novo }) => {
  const corpo = {
    nome: texto(form.nome),
    area_id: texto(form.area_id) || null,
    bem_id: form.bem?.id ?? null,
    safra_ciclo: texto(form.safra_ciclo) || null,
    data_inicio: texto(form.data_inicio) || null,
    data_prevista_fim: texto(form.data_prevista_fim) || null,
    area_planejada: lerDecimal(form.area_planejada, '').valor,
    lancamento_tarefa_id: texto(form.lancamento_tarefa_id) || null,
    observacao: texto(form.observacao) || null,
  };
  return novo ? { tipo_atividade_id: texto(form.tipo_atividade_id), ...corpo } : corpo;
};

/**
 * PATCH mínimo da atividade: só o que mudou em relação à gravada.
 * @param {any} original @param {Record<string, any>} corpo
 */
export const camposAlteradosDaAtividade = (original, corpo) => diferencas(original, corpo, DECIMAIS_ATIVIDADE);

// ─── Formulário do apontamento (dia) ─────────────────────────────────────

/**
 * @typedef {{
 *   data_operacional: string,
 *   turno: string,
 *   operador: OpcaoEscolhida,
 *   area_executada_dia: string,
 *   quantidade_produzida_dia: string,
 *   observacao: string,
 *   atividade_area_id?: string,
 * }} FormularioApontamento
 */

/** Lançamento novo no "hoje" da fazenda. @param {string} hoje @returns {FormularioApontamento} */
export const formularioApontamentoVazio = (hoje) => ({
  data_operacional: hoje || '',
  turno: '',
  operador: null,
  area_executada_dia: '',
  quantidade_produzida_dia: '',
  observacao: '',
  atividade_area_id: '',
});

/** Formulário a partir do apontamento gravado. @param {any} ap @returns {FormularioApontamento} */
export const formularioDoApontamento = (ap) => ({
  data_operacional: texto(ap?.data_operacional),
  turno: typeof ap?.turno === 'string' && TURNOS_VALIDOS.includes(ap.turno) ? ap.turno : '',
  operador: opcao(ap?.operador_usuario_id, rotuloDoUsuario(ap?.operador)),
  area_executada_dia: decimalParaEdicao(ap?.area_executada_dia),
  quantidade_produzida_dia: decimalParaEdicao(ap?.quantidade_produzida_dia),
  observacao: typeof ap?.observacao === 'string' ? ap.observacao : '',
  // D-PROD-238: a área da atividade do lançamento.
  atividade_area_id: texto(ap?.atividade_area_id),
});

/**
 * "Repetir": os dados de um lançamento (turno, operador, área do dia, produção
 * e observação — o que o duplicar do servidor copia) com a data de hoje, para
 * o operador só ajustar antes de salvar.
 * @param {any} base @param {string} hoje @returns {FormularioApontamento}
 */
export const formularioDaBase = (base, hoje) => ({ ...formularioDoApontamento(base), data_operacional: hoje || '' });

/**
 * Validação local do apontamento (o servidor confere de novo). Fora do
 * período da atividade NÃO é erro: o servidor grava e devolve o alerta.
 * @param {FormularioApontamento} form @param {{ hoje: string }} ctx
 * @returns {Record<string, string>}
 */
export const validarFormularioApontamento = (form, { hoje }) => {
  /** @type {Record<string, string>} */
  const erros = {};
  const dia = texto(form?.data_operacional);
  if (!dia) erros.data_operacional = 'Informe a data do lançamento.';
  else if (!ehDiaValido(dia)) erros.data_operacional = 'Data inválida.';
  else if (hoje && dia > hoje) erros.data_operacional = 'A data não pode ser posterior a hoje na fazenda: só se lança o que já foi feito.';
  const turno = texto(form?.turno);
  if (turno && !TURNOS_VALIDOS.includes(turno)) erros.turno = 'Turno inválido.';
  const area = lerDecimal(form?.area_executada_dia, 'A área do dia');
  if (area.erro) erros.area_executada_dia = area.erro;
  const producao = lerDecimal(form?.quantidade_produzida_dia, 'A produção do dia');
  if (producao.erro) erros.quantidade_produzida_dia = producao.erro;
  if ((form?.observacao ?? '').length > MAX_OBSERVACAO_ATIVIDADE) erros.observacao = `No máximo ${MAX_OBSERVACAO_ATIVIDADE} caracteres.`;
  return erros;
};

/** Decimais do corpo do apontamento (comparados como decimal no PATCH mínimo). */
const DECIMAIS_APONTAMENTO = /** @type {readonly string[]} */ (Object.freeze(['area_executada_dia', 'quantidade_produzida_dia']));

/**
 * Corpo do apontamento a partir do formulário JÁ VALIDADO: exatamente os
 * campos de dado do contrato (data, turno, operador, área do dia, produção do
 * dia, observação), opcional vazio = `null`. A sequência é do servidor; área,
 * setor, safra, centros, unidade e máquina são do cabeçalho e nunca vão.
 * @param {FormularioApontamento} form
 * @returns {Record<string, any>}
 */
export const corpoDoApontamento = (form) => ({
  data_operacional: texto(form.data_operacional),
  turno: texto(form.turno) || null,
  operador_usuario_id: form.operador?.id ?? null,
  area_executada_dia: lerDecimal(form.area_executada_dia, '').valor,
  quantidade_produzida_dia: lerDecimal(form.quantidade_produzida_dia, '').valor,
  observacao: texto(form.observacao) || null,
  // D-PROD-238: a área da atividade (nula na atividade sem área; com uma área só, o servidor usa ela).
  atividade_area_id: texto(form.atividade_area_id) || null,
});

/**
 * PATCH mínimo do apontamento: só o que mudou em relação ao gravado.
 * @param {any} original @param {Record<string, any>} corpo
 */
export const camposAlteradosDoApontamento = (original, corpo) => diferencas(original, corpo, DECIMAIS_APONTAMENTO);

/**
 * O formulário do "Repetir" continua com os dados da base (fora a data)? Então
 * o envio é o DUPLICAR do servidor (a cópia fiel, com a data escolhida); com
 * algum ajuste, é um lançamento novo com os dados ajustados.
 * @param {FormularioApontamento} form @param {any} base
 */
export const mesmoConteudoDaBase = (form, base) => {
  const { data_operacional: _data, ...dados } = corpoDoApontamento(form);
  return Object.keys(camposAlteradosDoApontamento(base, dados)).length === 0;
};

// ─── Lista por dia ───────────────────────────────────────────────────────

const ORDEM_TURNO = Object.freeze(/** @type {Record<string, number>} */ ({ MANHA: 0, TARDE: 1, NOITE: 2 }));
/** Manhã, tarde, noite e, por último, sem turno. @param {unknown} turno */
const ordemDoTurno = (turno) =>
  typeof turno === 'string' && Object.prototype.hasOwnProperty.call(ORDEM_TURNO, turno) ? ORDEM_TURNO[turno] : 3;
/** @param {unknown} iso */
const instante = (iso) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Itens da resposta da lista (`{ items }` do contrato; aceita também
 * `itens` ou a lista pura).
 * @param {unknown} resposta
 * @returns {any[]}
 */
export const itensDaLista = (resposta) => {
  if (Array.isArray(resposta)) return resposta;
  if (!ehObjeto(resposta)) return [];
  if (Array.isArray(resposta.items)) return resposta.items;
  if (Array.isArray(resposta.itens)) return resposta.itens;
  return [];
};

/**
 * Apontamentos agrupados por dia: o dia mais recente primeiro; no dia, turno
 * (manhã, tarde, noite, sem turno) e sequência das passadas. Os cancelados
 * ficam na lista.
 * @param {any[]} itens
 * @returns {Array<{ dia: string, itens: any[] }>}
 */
export const apontamentosPorDia = (itens) => {
  const lista = (Array.isArray(itens) ? itens : []).filter((a) => ehObjeto(a) && a.id != null);
  lista.sort((a, b) => {
    const da = texto(a.data_operacional);
    const db = texto(b.data_operacional);
    if (da !== db) return da < db ? 1 : -1;
    const ta = ordemDoTurno(a.turno);
    const tb = ordemDoTurno(b.turno);
    if (ta !== tb) return ta - tb;
    const sa = Number.isInteger(a.sequencia) ? a.sequencia : 0;
    const sb = Number.isInteger(b.sequencia) ? b.sequencia : 0;
    if (sa !== sb) return sa - sb;
    return instante(a.createdAt) - instante(b.createdAt);
  });
  /** @type {Array<{ dia: string, itens: any[] }>} */
  const dias = [];
  for (const a of lista) {
    const dia = texto(a.data_operacional);
    const ultimo = dias[dias.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.itens.push(a);
    else dias.push({ dia, itens: [a] });
  }
  return dias;
};

/**
 * O lançamento CONFIRMADO mais recente (o último lançado; empate pela data e
 * pela passada): a base do "Repetir último".
 * @param {any[]} itens
 * @returns {any|null}
 */
export const maisRecenteConfirmado = (itens) => {
  const confirmados = (Array.isArray(itens) ? itens : []).filter((a) => ehObjeto(a) && a.id != null && a.status === STATUS_CONFIRMADO);
  if (!confirmados.length) return null;
  return confirmados.reduce((melhor, a) => {
    const d = instante(a.createdAt) - instante(melhor.createdAt);
    if (d !== 0) return d > 0 ? a : melhor;
    const da = texto(a.data_operacional);
    const dm = texto(melhor.data_operacional);
    if (da !== dm) return da > dm ? a : melhor;
    return (Number(a.sequencia) || 0) > (Number(melhor.sequencia) || 0) ? a : melhor;
  });
};

/**
 * Os lançamentos CONFIRMADOS de UM dia, o mais recente primeiro (a maior passada; no empate, o criado por último): o
 * dia da janela por tipo (D-PROD-233) — nenhum = o primeiro item salvo cria o dia; um = os itens entram nele; mais de
 * um = a janela pergunta qual (padrão: o mais recente).
 * @param {any[]} itens @param {string} dia
 * @returns {any[]}
 */
export const confirmadosDoDia = (itens, dia) =>
  (Array.isArray(itens) ? itens : [])
    .filter((a) => ehObjeto(a) && a.id != null && a.status === STATUS_CONFIRMADO && texto(a.data_operacional) === texto(dia))
    .sort((a, b) => {
      const sa = Number.isInteger(a.sequencia) ? a.sequencia : 0;
      const sb = Number.isInteger(b.sequencia) ? b.sequencia : 0;
      if (sa !== sb) return sb - sa;
      return instante(b.createdAt) - instante(a.createdAt);
    });

// ─── Respostas e erros do servidor ───────────────────────────────────────

/**
 * Página de opções de um seletor no formato do `SeletorPaginadoGestao`
 * (`{ itens, has_more, next_cursor }`), aceitando também `items`.
 * @param {unknown} resposta
 * @returns {{ itens: any[], has_more: boolean, next_cursor: string|null }}
 */
export const normalizarPaginaDeOpcoes = (resposta) => {
  const r = ehObjeto(resposta) ? resposta : {};
  const proximo = typeof r.next_cursor === 'string' && r.next_cursor ? r.next_cursor : null;
  return {
    itens: itensDaLista(resposta).filter((o) => ehObjeto(o) && o.id != null),
    has_more: Boolean(r.has_more === true && proximo),
    next_cursor: proximo,
  };
};

/**
 * Resposta das escritas de apontamento: `{ apontamento, atividade, alertas }`.
 * @param {unknown} resposta
 * @returns {{ apontamento: any, atividade: any, alertas: any[] }}
 */
export const normalizarRespostaDeEscrita = (resposta) => {
  const r = ehObjeto(resposta) ? resposta : {};
  return {
    apontamento: ehObjeto(r.apontamento) ? r.apontamento : null,
    atividade: ehObjeto(r.atividade) ? r.atividade : null,
    alertas: Array.isArray(r.alertas) ? r.alertas.filter(ehObjeto) : [],
  };
};

/** Campo do formulário da atividade que cada coluna recusada pelo servidor destaca. */
export const CAMPO_DO_FORMULARIO_ATIVIDADE = Object.freeze(
  /** @type {Record<string, string>} */ ({
    nome: 'nome',
    tipo_atividade_id: 'tipo_atividade_id',
    area_id: 'area_id',
    bem_id: 'bem',
    safra_ciclo: 'safra_ciclo',
    data_inicio: 'data_inicio',
    data_prevista_fim: 'data_prevista_fim',
    area_planejada: 'area_planejada',
    lancamento_tarefa_id: 'lancamento_tarefa_id',
    observacao: 'observacao',
  }),
);

/** Campo do formulário do apontamento que cada coluna recusada pelo servidor destaca. */
export const CAMPO_DO_FORMULARIO_APONTAMENTO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    data_operacional: 'data_operacional',
    turno: 'turno',
    operador_usuario_id: 'operador',
    area_executada_dia: 'area_executada_dia',
    quantidade_produzida_dia: 'quantidade_produzida_dia',
    observacao: 'observacao',
  }),
);

/**
 * Campo do formulário que a recusa do servidor aponta (o `field` das recusas
 * `ATIVIDADE_*`), traduzido para o nome do campo da tela; ou null.
 * @param {unknown} erro @param {Record<string, string>} mapa
 */
export const campoDoFormulario = (erro, mapa) => {
  const campo = campoDoErroAtividade(erro);
  return campo && Object.prototype.hasOwnProperty.call(mapa, campo) ? mapa[campo] : null;
};

/** A recusa diz "a atividade ou o apontamento mudou ou sumiu": a tela relê a lista e o cabeçalho. @param {unknown} erro */
export const pedeReleitura = (erro) => /** @type {readonly string[]} */ (CODIGOS_RELER_ATIVIDADE).includes(String(codigoDoErroAtividade(erro) ?? ''));
