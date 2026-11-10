/**
 * Regras PURAS da tela Abastecimentos (Patrimônio P1-02, D-PROD-159).
 *
 * Sem React, sem rede, sem `@/`: só imports relativos com `.js` — o teste de
 * integração do backend (INT-1) importa este módulo no Node e manda à API REAL
 * os corpos que ele monta. Quantidades viajam como TEXTO canônico ("80.5"):
 * nada de `Number`/`parseFloat` em litros, leitura, fator, KG ou custo.
 *
 * O formulário guarda o texto DIGITADO no formato do Brasil ("80,5"); os
 * `montarCorpo*` convertem para o canônico com `lerNumeroLocal` (nunca
 * arredondam: casa a mais é recusada). `estimarKg` é SÓ estimativa visual —
 * o KG que vale é o que o servidor converte (ROUND_HALF_UP, 4 casas, uma vez).
 */
import { comparar, ehCanonico, ehPositivo, formatarMoeda, formatarNumero, lerNumeroLocal, multiplicarArredondar, somar } from './dinheiroDecimal.js';
import { ehDiaValido, formatarDia } from './diaCivil.js';

export const LOCALE_ABASTECIMENTO = 'pt-BR';

export const LIMITES_ABASTECIMENTO = Object.freeze({
  LITROS: Object.freeze({ inteiros: 10, casas: 4 }),
  LEITURA: Object.freeze({ inteiros: 10, casas: 4 }),
  FATOR: Object.freeze({ inteiros: 2, casas: 6 }),
});

/** Teto do motor de estoque (quantidade e valor). */
export const LIMITE_ESTOQUE = '9999999999.9999';
/** Teto do fator kg/L (0 < f ≤ 10). */
export const FATOR_MAXIMO = '10';

export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
export const MEDIDORES_CONTADOR = Object.freeze(['HORIMETRO', 'ODOMETRO', 'CICLOS']);
export const STATUS_ABASTECIMENTO = Object.freeze(['CONFIRMADO', 'CANCELADO']);

/** @param {unknown} tipo */
export const medidorExigeLeitura = (tipo) => typeof tipo === 'string' && MEDIDORES_CONTADOR.includes(tipo);

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {unknown} v */
const textoOuNulo = (v) => (texto(v) ? texto(v) : null);
/** @param {unknown} v */
const idDe = (v) => (v && typeof v === 'object' && typeof (/** @type {any} */ (v).id) === 'string' ? /** @type {any} */ (v).id : typeof v === 'string' && v ? v : null);

/**
 * Lê o texto digitado (pt-BR) como canônico, ou null quando vazio/ inválido.
 * @param {unknown} digitado @param {{ inteiros: number, casas: number }} limites
 */
export const canonicoDoDigitado = (digitado, limites) => {
  const r = lerNumeroLocal(digitado, LOCALE_ABASTECIMENTO, limites);
  return r.ok ? /** @type {string} */ (r.valor) : null;
};

/**
 * Estimativa VISUAL do KG: litros × fator, ROUND_HALF_UP 4 casas, só quando o
 * resultado é > 0 e ≤ o teto do estoque (senão o servidor recusa e a tela não
 * promete número). Entradas são canônicas ("80.0000", "0.840000").
 * @param {unknown} litros @param {unknown} fator
 * @returns {string|null}
 */
export const estimarKg = (litros, fator) => {
  if (!ehCanonico(litros) || !ehCanonico(fator)) return null;
  try {
    const kg = multiplicarArredondar(/** @type {string} */ (litros), /** @type {string} */ (fator), 4);
    if (!ehPositivo(kg) || comparar(kg, LIMITE_ESTOQUE) > 0) return null;
    return kg;
  } catch {
    return null;
  }
};

/**
 * Formulário em branco. `bem` e `produto` são as OPÇÕES escolhidas (objetos do
 * servidor); os demais, ids ou texto digitado.
 * @param {string} hoje AAAA-MM-DD no fuso da fazenda
 */
export const formularioVazio = (hoje) => ({
  bem: null,
  tanque_id: null,
  tipo_combustivel_id: null,
  produto: null,
  local_estoque_id: null,
  data_operacional: hoje,
  quantidade_litros: '',
  medidor_leitura: '',
  tanque_cheio: false,
  observacao: '',
  referencia_externa: '',
});

/** Tipo do medidor do bem escolhido (opção `bens`: `medidor.tipo`). @param {any} form */
export const medidorDoFormulario = (form) => {
  const tipo = form?.bem?.medidor?.tipo;
  return typeof tipo === 'string' ? tipo : 'SEM_MEDIDOR';
};

/** @param {string} motivo */
const mensagemDoNumero = (motivo) =>
  motivo === 'casas' ? 'No máximo 4 casas decimais.' : motivo === 'limite' ? 'Número grande demais.' : 'Número inválido (use vírgula para decimais, ex.: 80,5).';

/**
 * Validação LOCAL (o servidor confere tudo de novo, sob trava). Mensagens em pt-BR.
 * @param {any} form
 * @param {{ hoje?: string|null, capacidadeLitros?: string|null }} [ctx]
 * @returns {{ erros: Record<string, string> }}
 */
export const validarFormulario = (form, ctx = {}) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!idDe(form?.bem)) erros.bem = 'Escolha o bem.';
  if (!idDe(form?.tanque_id)) erros.tanque_id = 'Escolha o tanque.';
  if (!idDe(form?.tipo_combustivel_id)) erros.tipo_combustivel_id = 'Escolha o combustível.';
  if (!idDe(form?.produto)) erros.produto = 'Escolha o produto.';
  if (!idDe(form?.local_estoque_id)) erros.local_estoque_id = 'Escolha o local de estoque.';
  const dia = texto(form?.data_operacional);
  if (!ehDiaValido(dia)) erros.data_operacional = 'Informe a data do abastecimento.';
  else if (ctx.hoje && ehDiaValido(ctx.hoje) && dia > ctx.hoje) erros.data_operacional = 'A data não pode ser posterior a hoje na fazenda.';
  const litros = lerNumeroLocal(form?.quantidade_litros, LOCALE_ABASTECIMENTO, LIMITES_ABASTECIMENTO.LITROS);
  if (!litros.ok) erros.quantidade_litros = litros.motivo === 'vazio' ? 'Informe os litros abastecidos.' : mensagemDoNumero(String(litros.motivo));
  else if (!ehPositivo(/** @type {string} */ (litros.valor))) erros.quantidade_litros = 'Informe litros maiores que zero.';
  else if (ehCanonico(ctx.capacidadeLitros) && comparar(/** @type {string} */ (litros.valor), /** @type {string} */ (ctx.capacidadeLitros)) > 0) {
    erros.quantidade_litros = 'Os litros passam da capacidade nominal do tanque.';
  }
  if (medidorExigeLeitura(medidorDoFormulario(form))) {
    const leitura = lerNumeroLocal(form?.medidor_leitura, LOCALE_ABASTECIMENTO, LIMITES_ABASTECIMENTO.LEITURA);
    if (!leitura.ok) erros.medidor_leitura = leitura.motivo === 'vazio' ? 'Informe a leitura do medidor.' : mensagemDoNumero(String(leitura.motivo));
  }
  if (texto(form?.observacao).length > 500) erros.observacao = 'No máximo 500 caracteres.';
  if (texto(form?.referencia_externa).length > 64) erros.referencia_externa = 'No máximo 64 caracteres.';
  return { erros };
};

/**
 * Corpo da PRÉVIA (A3): decimais canônicos, leitura null quando o bem não tem
 * contador, textos aparados ou null. Recusa (lança) o que não converte —
 * `validarFormulario` vem antes.
 * @param {string} empresaId @param {any} form
 */
export const montarCorpoPrevia = (empresaId, form) => {
  const litros = canonicoDoDigitado(form?.quantidade_litros, LIMITES_ABASTECIMENTO.LITROS);
  if (!litros) throw new RangeError('quantidade_litros_invalida');
  const contador = medidorExigeLeitura(medidorDoFormulario(form));
  const leitura = contador ? canonicoDoDigitado(form?.medidor_leitura, LIMITES_ABASTECIMENTO.LEITURA) : null;
  return {
    empresa_id: empresaId,
    bem_id: idDe(form?.bem),
    tanque_id: idDe(form?.tanque_id),
    tipo_combustivel_id: idDe(form?.tipo_combustivel_id),
    produto_id: idDe(form?.produto),
    local_estoque_id: idDe(form?.local_estoque_id),
    data_operacional: texto(form?.data_operacional),
    quantidade_litros: litros,
    medidor_leitura: leitura,
    tanque_cheio: form?.tanque_cheio === true,
    observacao: textoOuNulo(form?.observacao),
    referencia_externa: textoOuNulo(form?.referencia_externa),
  };
};

/**
 * Corpo da CONFIRMAÇÃO (A4) SEM `operation_id` (o serviço põe a chave
 * persistente): o mesmo da prévia + o fator (`conversao_id`/`conversao_versao`)
 * que a prévia mostrou. Sem fator no plano não há confirmação.
 * @param {string} empresaId @param {any} form @param {any} plano
 */
export const montarCorpoConfirmacao = (empresaId, form, plano) => {
  const conversao = plano?.conversao;
  if (!conversao || typeof conversao.id !== 'string' || !Number.isInteger(conversao.versao)) throw new RangeError('conversao_ausente_no_plano');
  return { ...montarCorpoPrevia(empresaId, form), conversao_id: conversao.id, conversao_versao: conversao.versao };
};

/**
 * Corpo do CANCELAMENTO (A5) SEM `operation_id`.
 * @param {string} empresaId @param {any} registro @param {string} motivo
 */
export const montarCorpoCancelamento = (empresaId, registro, motivo) => ({ empresa_id: empresaId, versao: registro?.versao, motivo: texto(motivo) });

/**
 * Corpo do NOVO FATOR (A14). `form.kg_por_litro` é o texto digitado (pt-BR);
 * `vigenteId` = id do fator vigente lido para o par (ou null quando não há).
 * @param {string} empresaId
 * @param {{ tipo_combustivel_id: string|null, produto_id: string|null, kg_por_litro: string, declara_estoque_em_kg: boolean }} form
 * @param {string|null} vigenteId
 */
export const montarCorpoConversao = (empresaId, form, vigenteId) => {
  const fator = canonicoDoDigitado(form?.kg_por_litro, LIMITES_ABASTECIMENTO.FATOR);
  if (!fator) throw new RangeError('kg_por_litro_invalido');
  return {
    empresa_id: empresaId,
    tipo_combustivel_id: idDe(form?.tipo_combustivel_id),
    produto_id: idDe(form?.produto_id),
    kg_por_litro: fator,
    declara_estoque_em_kg: form?.declara_estoque_em_kg === true,
    conversao_vigente_id: typeof vigenteId === 'string' && vigenteId ? vigenteId : null,
  };
};

/**
 * Validação local do fator: 0 < f ≤ 10, até 6 casas, declaração marcada.
 * @param {{ tipo_combustivel_id?: string|null, produto_id?: string|null, kg_por_litro?: string, declara_estoque_em_kg?: boolean }} form
 * @returns {{ erros: Record<string, string> }}
 */
export const validarConversao = (form) => {
  /** @type {Record<string, string>} */
  const erros = {};
  if (!idDe(form?.tipo_combustivel_id)) erros.tipo_combustivel_id = 'Escolha o combustível.';
  if (!idDe(form?.produto_id)) erros.produto_id = 'Escolha o produto.';
  const fator = lerNumeroLocal(form?.kg_por_litro, LOCALE_ABASTECIMENTO, LIMITES_ABASTECIMENTO.FATOR);
  if (!fator.ok) {
    erros.kg_por_litro =
      fator.motivo === 'vazio' ? 'Informe o fator kg/L.' : fator.motivo === 'casas' ? 'No máximo 6 casas decimais.' : 'Fator inválido (use vírgula para decimais, ex.: 0,84).';
  } else if (!ehPositivo(/** @type {string} */ (fator.valor)) || comparar(/** @type {string} */ (fator.valor), FATOR_MAXIMO) > 0) {
    erros.kg_por_litro = 'Informe um fator maior que zero e até 10.';
  }
  if (form?.declara_estoque_em_kg !== true) erros.declara_estoque_em_kg = 'Marque a declaração de que o estoque está em KG.';
  return { erros };
};

/**
 * Assinatura estável do que a prévia viu: se mudar depois da prévia, a prévia
 * deixa de valer (o botão Confirmar some até uma prévia nova).
 * @param {any} form
 */
export const assinaturaDoFormulario = (form) =>
  JSON.stringify([
    idDe(form?.bem),
    idDe(form?.tanque_id),
    idDe(form?.tipo_combustivel_id),
    idDe(form?.produto),
    idDe(form?.local_estoque_id),
    texto(form?.data_operacional),
    canonicoDoDigitado(form?.quantidade_litros, LIMITES_ABASTECIMENTO.LITROS) ?? texto(form?.quantidade_litros),
    canonicoDoDigitado(form?.medidor_leitura, LIMITES_ABASTECIMENTO.LEITURA) ?? texto(form?.medidor_leitura),
    form?.tanque_cheio === true,
    texto(form?.observacao),
    texto(form?.referencia_externa),
  ]);

// ─── Exibição (texto canônico → pt-BR, sem float) ───────────────────────

/** "80.0000" → "80,0000" (4 casas fixas). @param {unknown} v */
export const formatarLitros = (v) => formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 4, casasMax: 4 });
/** "67.2000" → "67,2000". @param {unknown} v */
export const formatarKg = (v) => formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 4, casasMax: 4 });
/** "0.840000" → "0,840000" (6 casas fixas). @param {unknown} v */
export const formatarFator = (v) => formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 6, casasMax: 6 });
/** Leitura do medidor ("1550.5000" → "1.550,5"). @param {unknown} v */
export const formatarLeitura = (v) => formatarNumero(v, { locale: LOCALE_ABASTECIMENTO, casasMin: 0, casasMax: 4 });
/** Custo em reais (até 4 casas: "5.2768" → "R$ 5,2768"; "354.6000" → "R$ 354,60"). @param {unknown} v */
export const formatarCusto = (v) => formatarMoeda(v, { locale: LOCALE_ABASTECIMENTO, moeda: 'BRL', casas: 2, casasMax: 4 });
/** @param {unknown} v */
export const formatarDiaAbastecimento = (v) => formatarDia(v, LOCALE_ABASTECIMENTO);

/** Unidade legível do medidor. */
export const UNIDADE_MEDIDOR = Object.freeze(/** @type {Record<string, string>} */ ({ HORIMETRO: 'h', ODOMETRO: 'km', CICLOS: 'ciclos' }));
/** Rótulo do campo de leitura conforme o medidor. */
export const ROTULO_LEITURA = Object.freeze(/** @type {Record<string, string>} */ ({ HORIMETRO: 'Horímetro (h)', ODOMETRO: 'Odômetro (km)', CICLOS: 'Ciclos' }));

/** "TP-02 — Trator TP-02" (ou só o nome). @param {any} bem */
export const rotuloDoBem = (bem) => {
  if (!bem || typeof bem !== 'object') return '';
  const codigo = texto(bem.codigo_frota);
  const nome = texto(bem.nome);
  return codigo && nome ? `${codigo} — ${nome}` : codigo || nome || (bem.numero != null ? `Bem nº ${bem.numero}` : '');
};

/**
 * Totais EXATOS (BigInt) de litros e KG dos abastecimentos CONFIRMADOS de uma
 * lista: "0.1" + "0.2" = "0.3", nunca 0,30000000000000004.
 * @param {any[]} itens
 * @returns {{ litros: string, kg: string, quantidade: number }}
 */
export const totaisConfirmados = (itens) => {
  const confirmados = (Array.isArray(itens) ? itens : []).filter((i) => i?.status === 'CONFIRMADO');
  const litros = confirmados.map((i) => i.quantidade_litros).filter(ehCanonico);
  const kg = confirmados.map((i) => i.quantidade_kg).filter(ehCanonico);
  return { litros: somar(litros, 4), kg: somar(kg, 4), quantidade: confirmados.length };
};

// ─── Conferência das respostas (§6.1) ───────────────────────────────────

const RE_4 = /^\d+\.\d{4}$/;
const RE_6 = /^\d+\.\d{6}$/;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} v @returns {v is Record<string, any>} */
const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {string[]} violacoes @param {string} onde
 * @param {Record<string, any>} obj @param {string[]} chaves
 */
const exigirChaves = (violacoes, onde, obj, chaves) => {
  for (const k of chaves) if (!Object.prototype.hasOwnProperty.call(obj, k)) violacoes.push(`${onde}.${k}: ausente`);
};
/** @param {string[]} v @param {string} onde @param {unknown} valor @param {RegExp} re @param {boolean} [nulo] */
const exigirFormato = (v, onde, valor, re, nulo = false) => {
  if (nulo && valor === null) return;
  if (typeof valor !== 'string' || !re.test(valor)) v.push(`${onde}: formato inválido (${JSON.stringify(valor)})`);
};

const CHAVES_DETALHE = [
  'id', 'empresa_id', 'numero', 'status', 'versao', 'data_operacional', 'bem', 'tanque', 'tipo_combustivel', 'produto', 'local_estoque', 'conversao',
  'quantidade_litros', 'kg_por_litro', 'quantidade_kg', 'custo_total', 'custo_unitario_kg', 'tanque_cheio', 'medidor', 'observacao', 'referencia_externa',
  'movimentacao', 'estorno', 'fatias', 'cancelamento', 'criado_por', 'consumo', 'efeito_cancelamento_medidor', 'created_date', 'updated_date',
];
const CHAVES_RESUMO = [
  'id', 'numero', 'status', 'versao', 'data_operacional', 'bem', 'tanque', 'tipo_combustivel', 'produto', 'local_estoque', 'quantidade_litros', 'quantidade_kg',
  'kg_por_litro', 'custo_total', 'tanque_cheio', 'medidor', 'referencia_externa', 'created_date', 'updated_date',
];
const CHAVES_CONVERSAO = [
  'id', 'empresa_id', 'tipo_combustivel', 'produto', 'sequencia', 'kg_por_litro', 'declara_estoque_em_kg', 'ativo', 'versao', 'encerrado_em', 'criado_por',
  'encerrado_por', 'created_date', 'updated_date',
];

/** @param {string[]} v @param {string} onde @param {any} m */
const conferirMovimento = (v, onde, m) => {
  if (m === null) return;
  if (!ehObjeto(m)) {
    v.push(`${onde}: não é objeto`);
    return;
  }
  exigirChaves(v, onde, m, ['id', 'numero', 'status', 'tipo_movimentacao', 'tipo_detalhado', 'quantidade_kg', 'valor_unitario', 'valor_total']);
  exigirFormato(v, `${onde}.quantidade_kg`, m.quantidade_kg, RE_4);
  exigirFormato(v, `${onde}.valor_unitario`, m.valor_unitario, RE_4);
  exigirFormato(v, `${onde}.valor_total`, m.valor_total, RE_4);
};

/** @param {string[]} v @param {string} onde @param {any} medidor */
const conferirMedidor = (v, onde, medidor) => {
  if (!ehObjeto(medidor)) {
    v.push(`${onde}: não é objeto`);
    return;
  }
  exigirFormato(v, `${onde}.leitura`, medidor.leitura, RE_4, true);
  if (medidor.tipo === 'SEM_MEDIDOR' && medidor.leitura !== null) v.push(`${onde}.leitura: SEM_MEDIDOR com leitura`);
};

/** @param {string[]} v @param {string} onde @param {any} fatias @param {string} chaveLote */
const conferirFatias = (v, onde, fatias, chaveLote) => {
  if (!Array.isArray(fatias)) {
    v.push(`${onde}: não é lista`);
    return;
  }
  fatias.forEach((f, i) => {
    const o = `${onde}[${i}]`;
    if (!ehObjeto(f)) {
      v.push(`${o}: não é objeto`);
      return;
    }
    if (!Number.isInteger(f.ordem)) v.push(`${o}.ordem: não é inteiro`);
    exigirFormato(v, `${o}.${chaveLote}`, f[chaveLote], RE_DIA, true);
    exigirFormato(v, `${o}.quantidade_kg`, f.quantidade_kg, RE_4);
    exigirFormato(v, `${o}.custo_unitario`, f.custo_unitario, RE_4);
    exigirFormato(v, `${o}.valor`, f.valor, RE_4);
  });
};

/** @param {string[]} v @param {string} onde @param {any} d @param {boolean} detalhe */
const conferirAbastecimento = (v, onde, d, detalhe) => {
  exigirChaves(v, onde, d, detalhe ? CHAVES_DETALHE : CHAVES_RESUMO);
  if (!STATUS_ABASTECIMENTO.includes(d.status)) v.push(`${onde}.status: inválido (${JSON.stringify(d.status)})`);
  if (!Number.isInteger(d.versao) || d.versao < 1) v.push(`${onde}.versao: inválida`);
  exigirFormato(v, `${onde}.data_operacional`, d.data_operacional, RE_DIA);
  exigirFormato(v, `${onde}.quantidade_litros`, d.quantidade_litros, RE_4);
  exigirFormato(v, `${onde}.kg_por_litro`, d.kg_por_litro, RE_6);
  exigirFormato(v, `${onde}.quantidade_kg`, d.quantidade_kg, RE_4);
  exigirFormato(v, `${onde}.custo_total`, d.custo_total, RE_4);
  if (typeof d.tanque_cheio !== 'boolean') v.push(`${onde}.tanque_cheio: não é booleano`);
  conferirMedidor(v, `${onde}.medidor`, d.medidor);
  if (!detalhe) return;
  exigirFormato(v, `${onde}.custo_unitario_kg`, d.custo_unitario_kg, RE_4);
  if (ehObjeto(d.tanque)) exigirFormato(v, `${onde}.tanque.capacidade_litros`, d.tanque.capacidade_litros, RE_4, true);
  conferirMovimento(v, `${onde}.movimentacao`, d.movimentacao);
  if (d.movimentacao === null) v.push(`${onde}.movimentacao: ausente`);
  conferirMovimento(v, `${onde}.estorno`, d.estorno);
  if (d.status === 'CANCELADO' && (d.estorno === null || d.cancelamento === null)) v.push(`${onde}: CANCELADO sem estorno/cancelamento`);
  if (d.status === 'CONFIRMADO' && (d.estorno !== null || d.cancelamento !== null)) v.push(`${onde}: CONFIRMADO com estorno/cancelamento`);
  conferirFatias(v, `${onde}.fatias`, d.fatias, 'data_lote');
};

/** @param {string[]} v @param {string} onde @param {any} c */
const conferirConversao = (v, onde, c) => {
  exigirChaves(v, onde, c, CHAVES_CONVERSAO);
  exigirFormato(v, `${onde}.kg_por_litro`, c.kg_por_litro, RE_6);
  if (!Number.isInteger(c.sequencia) || c.sequencia < 1) v.push(`${onde}.sequencia: inválida`);
  if (!Number.isInteger(c.versao) || c.versao < 1) v.push(`${onde}.versao: inválida`);
  if (c.declara_estoque_em_kg !== true) v.push(`${onde}.declara_estoque_em_kg: deve ser true`);
  if (typeof c.ativo !== 'boolean') v.push(`${onde}.ativo: não é booleano`);
};

/** @param {string[]} v @param {any} r */
const conferirPrevia = (v, r) => {
  if (!Array.isArray(r.bloqueios)) v.push('bloqueios: não é lista');
  else {
    r.bloqueios.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
      if (!ehObjeto(b) || typeof b.code !== 'string') v.push(`bloqueios[${i}].code: ausente`);
    });
  }
  const p = r.plano;
  if (!ehObjeto(p)) {
    v.push('plano: não é objeto');
    return;
  }
  exigirChaves(v, 'plano', p, ['empresa_id', 'data_operacional', 'hoje', 'bem', 'tanque', 'tipo_combustivel', 'produto', 'local_estoque', 'conversao', 'quantidade_litros', 'quantidade_kg', 'estoque', 'fifo', 'medidor', 'tanque_cheio', 'custo_e_estimativa']);
  exigirFormato(v, 'plano.data_operacional', p.data_operacional, RE_DIA);
  exigirFormato(v, 'plano.hoje', p.hoje, RE_DIA);
  exigirFormato(v, 'plano.quantidade_litros', p.quantidade_litros, RE_4);
  exigirFormato(v, 'plano.quantidade_kg', p.quantidade_kg, RE_4, true);
  if (p.conversao !== null) {
    if (!ehObjeto(p.conversao)) v.push('plano.conversao: não é objeto');
    else exigirFormato(v, 'plano.conversao.kg_por_litro', p.conversao.kg_por_litro, RE_6);
  }
  if (ehObjeto(p.tanque)) exigirFormato(v, 'plano.tanque.capacidade_litros', p.tanque.capacidade_litros, RE_4, true);
  if (ehObjeto(p.estoque)) {
    exigirFormato(v, 'plano.estoque.saldo_local_kg', p.estoque.saldo_local_kg, RE_4);
    exigirFormato(v, 'plano.estoque.estoque_atual_kg', p.estoque.estoque_atual_kg, RE_4);
  }
  if (ehObjeto(p.fifo)) {
    exigirFormato(v, 'plano.fifo.disponivel_kg', p.fifo.disponivel_kg, RE_4);
    exigirFormato(v, 'plano.fifo.custo_total_estimado', p.fifo.custo_total_estimado, RE_4, true);
    exigirFormato(v, 'plano.fifo.custo_unitario_estimado', p.fifo.custo_unitario_estimado, RE_4, true);
    conferirFatias(v, 'plano.fifo.fatias', p.fifo.fatias, 'data_lote');
  }
  if (ehObjeto(p.medidor)) exigirFormato(v, 'plano.medidor.leitura', p.medidor.leitura, RE_4, true);
};

/** @param {string[]} v @param {any} r */
const conferirConsumo = (v, r) => {
  exigirChaves(v, 'consumo', r, ['bem', 'situacao_geral', 'metrica', 'unidade_metrica', 'metodologia', 'intervalos']);
  if (!['DISPONIVEL', 'NAO_APLICAVEL'].includes(r.situacao_geral)) v.push('consumo.situacao_geral: inválida');
  (Array.isArray(r.intervalos) ? r.intervalos : []).forEach((/** @type {any} */ it, /** @type {number} */ i) => {
    const o = `consumo.intervalos[${i}]`;
    if (!['CALCULADO', 'DADOS_INSUFICIENTES'].includes(it?.situacao)) v.push(`${o}.situacao: inválida`);
    exigirFormato(v, `${o}.valor`, it?.valor, RE_4, true);
    exigirFormato(v, `${o}.litros`, it?.litros, RE_4, true);
    exigirFormato(v, `${o}.intervalo`, it?.intervalo, RE_4, true);
  });
};

/**
 * Violações do contrato §6.1 numa resposta do servidor (lista vazia = conforme).
 * Reconhece pela forma: prévia (`plano`), página (`items`), consumo
 * (`intervalos`), fator (`sequencia` + `declara_estoque_em_kg`) ou detalhe.
 * @param {unknown} body
 * @returns {string[]}
 */
export const conferirRespostaAbastecimento = (body) => {
  /** @type {string[]} */
  const v = [];
  if (!ehObjeto(body)) return ['resposta: não é objeto'];
  if (Object.prototype.hasOwnProperty.call(body, 'plano')) conferirPrevia(v, body);
  else if (Array.isArray(body.items)) {
    body.items.forEach((/** @type {any} */ item, /** @type {number} */ i) => {
      if (!ehObjeto(item)) v.push(`items[${i}]: não é objeto`);
      else if (Object.prototype.hasOwnProperty.call(item, 'sequencia')) conferirConversao(v, `items[${i}]`, item);
      else conferirAbastecimento(v, `items[${i}]`, item, false);
    });
  } else if (Array.isArray(body.intervalos)) conferirConsumo(v, body);
  else if (Object.prototype.hasOwnProperty.call(body, 'sequencia') && Object.prototype.hasOwnProperty.call(body, 'declara_estoque_em_kg')) conferirConversao(v, 'conversao', body);
  else conferirAbastecimento(v, 'abastecimento', body, true);
  return v;
};
