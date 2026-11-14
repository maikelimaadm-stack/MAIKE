/**
 * Regras do Apontamento de Atividade no navegador (D-PROD-190, Fatia C).
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
 *  - ITENS (D-PROD-191, Fatia D): só no apontamento CONFIRMADO e já gravado.
 *    PRODUTO baixa do estoque EXATAMENTE a quantidade digitada, na unidade
 *    EFETIVA do estoque do Produto (L; kg para KG e SACO), sem conversão; o
 *    custo é o FIFO dos lotes, que só o servidor conhece (sem prévia, D-5).
 *    SERVIÇO e OUTRO têm descrição livre, quantidade e valor unitário; o total
 *    que a tela mostra é só exibição (`totalDoItem`, 4 casas HALF_UP, sem
 *    float): o servidor refaz a conta e manda. Decimais vão em TEXTO.
 */

import {
  LIMITES,
  comparar,
  ehCanonico,
  ehPositivo,
  formatarMoeda,
  formatarNumero,
  lerNumeroLocal,
  multiplicarArredondar,
  paraTextoDeEdicao,
  somar,
} from './dinheiroDecimal.js';
import { ehDiaValido, formatarDia } from './diaCivil.js';
import { rotuloDaUnidade, rotuloDoBem, unidadeDoAbastecimentoDoProduto } from './abastecimentoRegras.js';
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

// ─── Itens do apontamento (D-PROD-191) ───────────────────────────────────

export const ITEM_PRODUTO = 'PRODUTO';
export const ITEM_SERVICO = 'SERVICO';
export const ITEM_OUTRO = 'OUTRO';
/** Tipos fechados do item (o mesmo domínio do servidor). SERVIÇO e OUTRO só diferem no rótulo (D-6). */
export const TIPOS_ITEM = Object.freeze([ITEM_PRODUTO, ITEM_SERVICO, ITEM_OUTRO]);
export const ROTULO_TIPO_ITEM = Object.freeze(/** @type {Record<string, string>} */ ({ PRODUTO: 'Produto', SERVICO: 'Serviço', OUTRO: 'Outro custo' }));
/** Até 200 itens por apontamento, contando os cancelados (D-9). */
export const MAX_ITENS_APONTAMENTO = 200;
export const MAX_DESCRICAO_ITEM = 255;
/** Quantidade: Decimal(14, 4) do servidor. */
export const LIMITES_QUANTIDADE_ITEM = LIMITES.QUANTIDADE;
/** Valor unitário de SERVIÇO/OUTRO: até 12 inteiros e 6 casas (o padrão do servidor). */
export const LIMITES_VALOR_UNITARIO_ITEM = LIMITES.PRECO;
/** Total do item com 4 casas, HALF_UP (D-7). */
export const CASAS_TOTAL_ITEM = 4;
/** Teto do total (Decimal(18, 4), o LIMITE_DINHEIRO do servidor). */
export const LIMITE_TOTAL_ITEM = '99999999999999.9999';

/** Caractere de controle (quebra de linha, tabulação…) ou marcação HTML: o servidor recusa com `caractere_invalido`. @param {string} t */
const temCaractereInvalido = (t) =>
  /[<>]/.test(t) ||
  [...t].some((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n < 0x20 || n === 0x7f;
  });

/**
 * @typedef {{ id: string, rotulo: string, unidade_principal_estoque: string|null }} ProdutoDoItem
 * @typedef {{
 *   tipo: string,
 *   produto: ProdutoDoItem|null,
 *   local_estoque_id: string|null,
 *   quantidade: string,
 *   descricao: string,
 *   valor_unitario: string,
 * }} RascunhoItem
 */

/** Rascunho em branco do item (um card por vez). @param {string} tipo @returns {RascunhoItem} */
export const itemVazio = (tipo) => ({
  tipo: TIPOS_ITEM.includes(tipo) ? tipo : ITEM_SERVICO,
  produto: null,
  local_estoque_id: null,
  quantidade: '',
  descricao: '',
  valor_unitario: '',
});

/**
 * Opção de Produto (rota de opções da tela) no rascunho: id, nome e a unidade
 * de estoque dele (L, KG, SACO…).
 * @param {any} o @returns {ProdutoDoItem|null}
 */
export const produtoDoItem = (o) =>
  o && typeof o === 'object' && o.id != null
    ? { id: String(o.id), rotulo: texto(o.nome) || String(o.id), unidade_principal_estoque: typeof o.unidade_principal_estoque === 'string' ? o.unidade_principal_estoque : null }
    : null;

/**
 * Unidade EFETIVA em que a quantidade do item de Produto é digitada e baixada:
 * `L` → `L`; `KG` e `SACO` → `KG` (SACO guarda kg); outra → null (o Produto não
 * pode ser item). Nunca converte.
 * @param {unknown} unidadePrincipal
 */
export const unidadeDoItem = (unidadePrincipal) => unidadeDoAbastecimentoDoProduto(unidadePrincipal);

/** Dica fixa sob a quantidade quando o Produto não é contado em litros. @param {unknown} u @returns {string|null} */
export const dicaDaUnidadeDoItem = (u) =>
  u === 'KG'
    ? 'Este Produto é controlado em quilos: digite a quantidade em kg.'
    : u === 'SACO'
      ? 'Este Produto é em sacos, com estoque em quilos: digite kg, não sacos.'
      : null;

/** "12,5 kg" / "80 L" (sem unidade conhecida, só o número). @param {unknown} v @param {unknown} unidade */
export const formatarQuantidadeItem = (v, unidade) => {
  if (!ehCanonico(v)) return '—';
  const numero = formatarNumero(/** @type {string} */ (v), { locale: LOCALE_APONTAMENTO, casasMin: 0, casasMax: LIMITES_QUANTIDADE_ITEM.casas });
  const rotulo = rotuloDaUnidade(unidade);
  return rotulo ? `${numero} ${rotulo}` : numero;
};

/** Valor em reais com até `casasMax` casas ("66.4063" → "R$ 66,4063"; "10.0000" → "R$ 10,00"). @param {unknown} v @param {number} [casasMax] */
export const formatarValorItem = (v, casasMax = CASAS_TOTAL_ITEM) => formatarMoeda(v, { locale: LOCALE_APONTAMENTO, moeda: 'BRL', casas: 2, casasMax });

/** Como cada decimal do item é chamado nas mensagens, e os limites dele. */
const DECIMAIS_DO_ITEM = Object.freeze({
  quantidade: { oque: 'a quantidade', nome: 'Quantidade', limites: LIMITES_QUANTIDADE_ITEM },
  valor_unitario: { oque: 'o valor unitário', nome: 'Valor unitário', limites: LIMITES_VALOR_UNITARIO_ITEM },
});

/** Texto da leitura recusada de um decimal do item. @param {string} motivo @param {'quantidade'|'valor_unitario'} campo */
const mensagemDoDecimal = (motivo, campo) => {
  const d = DECIMAIS_DO_ITEM[campo];
  if (motivo === 'vazio') return `Informe ${d.oque}.`;
  if (motivo === 'casas') return `Use no máximo ${d.limites.casas} casas decimais.`;
  if (motivo === 'limite') return `${d.nome} acima do limite permitido.`;
  return `${d.nome} em formato inválido: use 1.234,5.`;
};

/**
 * Total do item de SERVIÇO/OUTRO = quantidade × valor unitário, arredondado
 * HALF_UP em 4 casas, em BigInt (sem float). Só EXIBIÇÃO: o servidor refaz a
 * conta e manda o total gravado. Entrada canônica inválida → null.
 * @param {unknown} quantidade @param {unknown} valorUnitario @returns {string|null}
 */
export const totalDoItem = (quantidade, valorUnitario) =>
  ehCanonico(quantidade) && ehCanonico(valorUnitario)
    ? multiplicarArredondar(/** @type {string} */ (quantidade), /** @type {string} */ (valorUnitario), CASAS_TOTAL_ITEM)
    : null;

/**
 * Lê os decimais DIGITADOS do rascunho (pt-BR) como texto canônico; o que não
 * se lê fica null.
 * @param {RascunhoItem} item
 * @returns {{ quantidade: string|null, valor_unitario: string|null }}
 */
export const decimaisDoItem = (item) => {
  const q = lerNumeroLocal(texto(item?.quantidade), LOCALE_APONTAMENTO, LIMITES_QUANTIDADE_ITEM);
  const vu = lerNumeroLocal(texto(item?.valor_unitario), LOCALE_APONTAMENTO, LIMITES_VALOR_UNITARIO_ITEM);
  return { quantidade: q.ok ? /** @type {string} */ (q.valor) : null, valor_unitario: vu.ok ? /** @type {string} */ (vu.valor) : null };
};

/**
 * Validação local do rascunho (o servidor confere tudo de novo, sob trava).
 * `unidade`: a unidade de estoque do Produto escolhido (PRODUTO); `disponivel`:
 * o saldo do local escolhido (texto canônico). Passar do saldo é AVISO, não
 * bloqueio: o saldo pode mudar até o envio e quem decide é o servidor.
 * @param {RascunhoItem} item
 * @param {{ unidade?: string|null, disponivel?: string|null }} [ctx]
 * @returns {{ erros: Record<string, string>, aviso: string|null }}
 */
export const validarItem = (item, { unidade = null, disponivel = null } = {}) => {
  /** @type {Record<string, string>} */
  const erros = {};
  let aviso = null;
  const tipo = item?.tipo;
  if (!TIPOS_ITEM.includes(String(tipo))) {
    erros.tipo = 'Escolha o tipo do item.';
    return { erros, aviso };
  }
  const q = lerNumeroLocal(texto(item.quantidade), LOCALE_APONTAMENTO, LIMITES_QUANTIDADE_ITEM);
  if (!q.ok) erros.quantidade = mensagemDoDecimal(String(q.motivo), 'quantidade');
  else if (!ehPositivo(/** @type {string} */ (q.valor))) erros.quantidade = 'Informe uma quantidade maior que zero.';
  if (tipo === ITEM_PRODUTO) {
    const efetiva = unidadeDoItem(unidade ?? item.produto?.unidade_principal_estoque ?? null);
    if (!item.produto?.id) erros.produto = 'Escolha o Produto.';
    else if (!efetiva) erros.produto = 'O estoque deste Produto não está em litros (L), quilos (KG) nem sacos (SACO): ele não pode ser lançado como item.';
    if (item.produto?.id && !item.local_estoque_id) erros.local_estoque_id = 'Escolha o local do estoque de onde o Produto sai.';
    if (!erros.quantidade && q.ok && efetiva && ehCanonico(disponivel) && comparar(/** @type {string} */ (q.valor), /** @type {string} */ (disponivel)) > 0) {
      aviso = `A quantidade passa do saldo deste local (disponível ${formatarQuantidadeItem(disponivel, efetiva)}). Se faltar saldo, o servidor recusa e nada é gravado.`;
    }
    return { erros, aviso };
  }
  const descricao = texto(item.descricao);
  if (!descricao) erros.descricao = 'Descreva o item.';
  else if ([...descricao].length > MAX_DESCRICAO_ITEM) erros.descricao = `No máximo ${MAX_DESCRICAO_ITEM} caracteres.`;
  else if (temCaractereInvalido(String(item.descricao))) erros.descricao = 'A descrição não aceita os caracteres < e > nem quebra de linha.';
  const vu = lerNumeroLocal(texto(item.valor_unitario), LOCALE_APONTAMENTO, LIMITES_VALOR_UNITARIO_ITEM);
  if (!vu.ok) erros.valor_unitario = mensagemDoDecimal(String(vu.motivo), 'valor_unitario');
  if (!erros.quantidade && !erros.valor_unitario && q.ok && vu.ok) {
    const total = totalDoItem(q.valor, vu.valor);
    if (!total || !ehPositivo(total)) erros.valor_unitario = 'O total do item (quantidade × valor unitário) deu zero: informe um valor maior.';
    else if (comparar(total, LIMITE_TOTAL_ITEM) > 0) erros.valor_unitario = 'O total do item passa do limite permitido.';
  }
  return { erros, aviso };
};

/**
 * Corpo do item a partir do rascunho JÁ VALIDADO: só as chaves do TIPO (as do
 * outro tipo o servidor recusaria), decimais em texto canônico, nunca `null`.
 * Empresa, `versao` e `operation_id` entram no service.
 * @param {RascunhoItem} item
 * @returns {Record<string, string>}
 */
export const corpoDoItem = (item) => {
  const { quantidade, valor_unitario: valorUnitario } = decimaisDoItem(item);
  /** @type {Record<string, string>} */
  const corpo = { tipo: String(item.tipo) };
  if (item.tipo === ITEM_PRODUTO) {
    if (item.produto?.id) corpo.produto_id = String(item.produto.id);
    if (item.local_estoque_id) corpo.local_estoque_id = String(item.local_estoque_id);
    if (quantidade) corpo.quantidade = quantidade;
    return corpo;
  }
  const descricao = texto(item.descricao);
  if (descricao) corpo.descricao = descricao;
  if (quantidade) corpo.quantidade = quantidade;
  if (valorUnitario) corpo.valor_unitario = valorUnitario;
  return corpo;
};

/** Itens do detalhe (lista vazia quando o registro não os traz). @param {any} registro @returns {any[]} */
export const itensDoRegistro = (registro) => (Array.isArray(registro?.itens) ? registro.itens : []);

/** O apontamento tem item de Produto CONFIRMADO (a saída do estoque está na data dele: D-1). @param {any} registro */
export const temItemDeProdutoConfirmado = (registro) =>
  itensDoRegistro(registro).some((i) => i?.tipo === ITEM_PRODUTO && i?.status === STATUS_CONFIRMADO);

/**
 * Custo dos itens CONFIRMADOS (os cancelados ficam no histórico e não contam),
 * somado em 4 casas sem float. A tela prefere o `custo_itens` do servidor.
 * @param {any[]} itens
 * @returns {{ total: string, produto: string, servico: string, outro: string, itens_confirmados: number }}
 */
export const custoDosItens = (itens) => {
  const confirmados = (Array.isArray(itens) ? itens : []).filter((i) => i?.status === STATUS_CONFIRMADO && ehCanonico(i?.valor_total));
  const doTipo = (/** @type {string} */ tipo) => somar(confirmados.filter((i) => i.tipo === tipo).map((i) => i.valor_total), CASAS_TOTAL_ITEM);
  return {
    total: somar(confirmados.map((i) => i.valor_total), CASAS_TOTAL_ITEM),
    produto: doTipo(ITEM_PRODUTO),
    servico: doTipo(ITEM_SERVICO),
    outro: doTipo(ITEM_OUTRO),
    itens_confirmados: confirmados.length,
  };
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

/**
 * Códigos que significam "o apontamento (ou um item dele) não existe mais /
 * mudou": a tela relê a lista e o DETALHE (D-PROD-191: os itens vêm do detalhe).
 */
export const CODIGOS_RELER_APONTAMENTO = Object.freeze([
  'APONTAMENTO_ATIVIDADE_NOT_FOUND',
  'APONTAMENTO_ATIVIDADE_STATUS_INVALIDO',
  'APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO',
  'APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND',
  'APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO',
  'APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS',
  'APONTAMENTO_ATIVIDADE_DATA_COM_ITENS',
]);

/** @param {unknown} erro */
export const codigoDoErroApontamento = (erro) => lerErroGestao(erro).code;

/** Frase de cada recusa do item (`details.field` × `details.reason`), D-PROD-191. */
const ITEM_RECUSADO = Object.freeze(
  /** @type {Record<string, Record<string, string>>} */ ({
    produto_id: {
      inexistente: 'O Produto não foi encontrado nesta fazenda',
      outra_empresa: 'O Produto é de outra fazenda',
      inativo: 'O Produto está inativo',
      unidade_nao_aceita: 'O estoque deste Produto não está em litros (L), quilos (KG) nem sacos (SACO): ele não pode ser lançado como item',
      // D-8: Produto aceito por algum tanque é combustível — evita a dupla contagem com o abastecimento.
      combustivel_no_abastecimento: 'Este Produto é combustível (aceito por um tanque): combustível se lança no Abastecimento, não como item do apontamento',
    },
    local_estoque_id: { inexistente: 'O local de estoque não foi encontrado', inativo: 'O local de estoque está inativo' },
    quantidade: { quantidade_nao_positiva: 'A quantidade do item deve ser maior que zero' },
    valor_unitario: {
      total_zero: 'O total do item (quantidade × valor unitário) deu zero: informe um valor maior',
      valor_excede_limite: 'O total do item passa do limite permitido',
    },
  }),
);

/**
 * Por que o estorno exato não é seguro (`APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO`):
 * os motivos do abastecimento e os de vínculo/camada do motor.
 */
const MOTIVO_ESTORNO_BLOQUEADO = Object.freeze(
  /** @type {Record<string, string>} */ ({
    produto_mudou_de_fazenda: 'o Produto mudou de fazenda',
    unidade_mudou: 'a unidade de estoque do Produto mudou desde o lançamento',
    movimento_inexistente: 'o movimento de estoque do item não existe mais',
    movimento_estornado: 'o movimento de estoque já foi estornado',
    fatias_inconsistentes: 'os lotes consumidos não conferem com a quantidade baixada',
    lote_indisponivel_para_devolucao: 'um lote de origem foi estornado ou removido',
    devolucao_excede_entrada: 'a devolução passaria da entrada do lote de origem',
    estoque_excede_limite: 'o estoque do Produto passaria do limite',
    vinculo_divergente: 'o vínculo do lote com o movimento não confere',
    camada_divergente: 'a camada do lote não confere com o movimento',
  }),
);

/** Número canônico do servidor no formato do Brasil, sem float. @param {unknown} v */
const numeroBr = (v) => (ehCanonico(v) ? formatarNumero(/** @type {string} */ (v), { locale: LOCALE_APONTAMENTO, casasMin: 0, casasMax: 4 }) : '?');

/**
 * Contexto das mensagens: `unidade` = unidade do item de Produto (o saldo sai em
 * L ou kg, nunca "kg" fixo); `comandoIdempotente` = o envio leva `operation_id`
 * (item, cancelamentos), então repetir não duplica.
 * @typedef {{ unidade?: string|null, comandoIdempotente?: boolean }} ContextoMensagemApontamento
 */

/**
 * Mensagem clara da recusa do servidor (nunca vazia; a `message` do servidor
 * não é exibida). Referência, produção e item dizem QUAL campo; o resto cai no
 * catálogo de Gestão/`ApiError`.
 * @param {unknown} erro @param {string} fallback @param {ContextoMensagemApontamento} [contexto]
 */
export const mensagemErroApontamento = (erro, fallback, contexto = {}) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  if (code === 'APONTAMENTO_ATIVIDADE_ITEM_INVALIDO') {
    const frase = ITEM_RECUSADO[field ?? '']?.[reason ?? ''];
    return `${frase ?? 'O item foi recusado: Produto, local, quantidade ou valor não pode ser usado'}. Nada foi gravado.`;
  }
  if (code === 'APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO') return 'Este item já foi cancelado. Nada foi alterado.';
  if (code === 'APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND') return 'Este item não foi encontrado neste apontamento. O apontamento será relido. Nada foi alterado.';
  if (code === 'APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS') {
    const limite = Number.isInteger(details.limite) ? details.limite : MAX_ITENS_APONTAMENTO;
    return `Este apontamento já tem ${limite} itens, o máximo (contando os cancelados). Nada foi gravado.`;
  }
  if (code === 'APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO') {
    const motivo = MOTIVO_ESTORNO_BLOQUEADO[reason ?? ''] ?? 'o estoque de origem mudou';
    const doItem = Number.isInteger(details.item_ordem) ? ` no item ${details.item_ordem}` : '';
    return `O estorno exato do estoque não é seguro agora${doItem}: ${motivo}. Nada foi alterado.`;
  }
  if (code === 'APONTAMENTO_ATIVIDADE_DATA_COM_ITENS') {
    return 'A data não pode mudar: o apontamento tem item de Produto lançado, com a saída do estoque nesta data. Cancele os itens de Produto antes de mudar a data. Nada foi gravado.';
  }
  if (code === 'ESTOQUE_SALDO_INSUFICIENTE') {
    // A unidade é a do ITEM (L ou kg); sem ela, só o número.
    const rotulo = rotuloDaUnidade(contexto.unidade ?? null);
    const em = rotulo ? ` ${rotulo}` : '';
    if (reason === 'estoque_atual_insuficiente') {
      return `O estoque atual do Produto é menor que o pedido: atual ${numeroBr(details.estoque_atual)}${em}, pedido ${numeroBr(details.solicitado)}${em}. Nada foi gravado.`;
    }
    return `Saldo insuficiente deste Produto neste local: disponível ${numeroBr(details.disponivel)}${em}, pedido ${numeroBr(details.solicitado)}${em}. Nada foi gravado.`;
  }
  // Só o item de Produto chega ao motor nesta tela: quantidade ou custo FIFO acima do teto das colunas de estoque.
  if (code === 'OPERACAO_VALORES_INVALIDOS') {
    if (reason === 'quantidade_nao_positiva') return 'Informe uma quantidade maior que zero. Nada foi gravado.';
    return 'Quantidade ou custo acima do limite do estoque. Nada foi gravado.';
  }
  if (code === 'PRODUTO_NOT_FOUND') return 'O Produto não foi encontrado nesta fazenda. Escolha outro.';
  if (code === 'CONCURRENCY_CONFLICT' && contexto.comandoIdempotente) {
    return 'Outra operação mexeu nos mesmos dados ao mesmo tempo. Nada foi gravado. Repita o mesmo envio: não duplica.';
  }
  if (code === 'REQUEST_VALIDATION_FAILED' && field === 'motivo') {
    return reason === 'motivo_curto' ? 'Informe um motivo com pelo menos 3 caracteres. Nada foi alterado.' : 'Informe o motivo do cancelamento. Nada foi alterado.';
  }
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
