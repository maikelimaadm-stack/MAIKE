/**
 * D-PROD-159 (Patrimônio P1-02) — regras PURAS do abastecimento (sem banco):
 * normalização dos corpos, fingerprint canônico da idempotência, conversão
 * L → kg UMA vez (ROUND_HALF_UP 4 casas), série do medidor e o PLANO único
 * que a prévia mostra e a confirmação executa (mesma função, mesmo estado).
 *
 * Nada aqui infere fator: o kg/L vem SEMPRE da conversão vigente informada
 * pelo responsável (nunca do nome, do combustível, do preço ou de fonte
 * externa) e 1 L nunca vale 1 kg. Decimais em `Dec` (decimalFinanceiro),
 * nunca Number.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, LIMITE_ESTOQUE, arredondar, dec, somar } from '../financeiro/decimalFinanceiro.js';
import { consumirFifo } from '../estoqueFisico/estoqueFisicoMotor.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { MEDIDORES_CONTADOR, ehContador } from './abastecimentoMedidor.js';
import { diaDe, diaDoCorpo } from './patrimonioComum.js';
import { CAPACIDADES_POR_NATUREZA, UNIDADE_DO_MEDIDOR } from './patrimonioDominio.js';

export const ENTIDADE = 'AbastecimentoBem';
export const ENTIDADE_CONVERSAO = 'ConversaoCombustivelProduto';
export const TIPO_CONFIRMAR = 'confirmar_abastecimento_bem';
export const TIPO_CANCELAR = 'cancelar_abastecimento_bem';
/** Naturezas com tanque (MAQUINA, VEICULO, EQUIPAMENTO), da matriz da P1-01. */
export const NATUREZAS_COM_TANQUE = Object.freeze(Object.entries(CAPACIDADES_POR_NATUREZA).filter(([, c]) => c.tanques).map(([n]) => n));
export const CASAS_LITROS = 4;
export const CASAS_FATOR = 6;
export const CASAS_LEITURA = 4;
export const FATOR_MAXIMO = dec('10');
export const PADRAO_LITROS = /^\d{1,10}(\.\d{1,4})?$/;
export const PADRAO_LEITURA = /^\d{1,10}(\.\d{1,4})?$/;
export const PADRAO_FATOR = /^\d{1,2}(\.\d{1,6})?$/;
export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
export const STATUS_CONFIRMADO = 'CONFIRMADO';
export const STATUS_CANCELADO = 'CANCELADO';

const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// ─── anti-coerção (antes do AJV) ────────────────────────────────────────────

const DECIMAIS_DO_CORPO = Object.freeze(['quantidade_litros', 'medidor_leitura', 'kg_por_litro']);

/**
 * `preValidation` do plugin: decimal presente, não-null e não-string → 400
 * `REQUEST_VALIDATION_FAILED` reason `valor_deve_ser_texto` (o AJV coergiria o
 * número em string já corrompida pelo float).
 * @param {unknown} corpo
 */
export const recusarCoercaoAbastecimento = (corpo) => {
  if (!ehObjeto(corpo)) return;
  const c = /** @type {Record<string, any>} */ (corpo);
  for (const chave of DECIMAIS_DO_CORPO) {
    if (!Object.prototype.hasOwnProperty.call(c, chave)) continue;
    const v = c[chave];
    if (v !== null && v !== undefined && typeof v !== 'string') {
      throw new AppError('REQUEST_VALIDATION_FAILED', `${chave} deve ser texto decimal (ex.: "80.5"), nunca número`, {
        details: { field: chave, reason: 'valor_deve_ser_texto', campo: chave },
      });
    }
  }
};

// ─── normalização ───────────────────────────────────────────────────────────

const decimalDoCorpo = (valor, campo, padrao, casas) => {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string' || !padrao.test(valor)) throw invalido(`${campo} tem formato inválido`, { field: campo, reason: 'formato' });
  return dec(valor).toFixed(casas);
};

const dataOperacionalDoCorpo = (v) => {
  const d = diaDoCorpo(v, 'data_operacional');
  if (!d) throw invalido('data_operacional é obrigatória', { field: 'data_operacional', reason: 'obrigatorio' });
  return d;
};

const basesDoCorpo = (c) => ({
  empresa_id: c.empresa_id,
  bem_id: c.bem_id,
  tanque_id: c.tanque_id,
  tipo_combustivel_id: c.tipo_combustivel_id,
  produto_id: c.produto_id,
  local_estoque_id: c.local_estoque_id,
  data_operacional: dataOperacionalDoCorpo(c.data_operacional),
  quantidade_litros: /** @type {string} */ (decimalDoCorpo(c.quantidade_litros, 'quantidade_litros', PADRAO_LITROS, CASAS_LITROS)),
  medidor_leitura: decimalDoCorpo(c.medidor_leitura, 'medidor_leitura', PADRAO_LEITURA, CASAS_LEITURA),
  tanque_cheio: c.tanque_cheio === true,
  observacao: textoDoCorpo(c.observacao, 'observacao') ?? null,
  referencia_externa: textoDoCorpo(c.referencia_externa, 'referencia_externa') ?? null,
});

/** Corpo da prévia (A3) → Entrada (sem operation_id nem conversão vista). */
export const normalizarPrevia = (corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  if (c.quantidade_litros === undefined || c.quantidade_litros === null) throw invalido('quantidade_litros é obrigatória', { field: 'quantidade_litros', reason: 'obrigatorio' });
  return { ...basesDoCorpo(c), operation_id: null, conversao_id: null, conversao_versao: null };
};

/** Corpo da confirmação (A4) → Entrada canônica. */
export const normalizarConfirmacao = (corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  if (c.quantidade_litros === undefined || c.quantidade_litros === null) throw invalido('quantidade_litros é obrigatória', { field: 'quantidade_litros', reason: 'obrigatorio' });
  if (typeof c.operation_id !== 'string' || !PADRAO_OPERATION_ID.test(c.operation_id)) {
    throw invalido('operation_id inválido', { field: 'operation_id', reason: 'formato' });
  }
  return { ...basesDoCorpo(c), operation_id: c.operation_id, conversao_id: c.conversao_id, conversao_versao: c.conversao_versao };
};

/** Corpo do cancelamento (A5). Motivo obrigatório (3..500, aparado). */
export const normalizarCancelamento = (id, corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  if (typeof c.operation_id !== 'string' || !PADRAO_OPERATION_ID.test(c.operation_id)) {
    throw invalido('operation_id inválido', { field: 'operation_id', reason: 'formato' });
  }
  const motivo = textoDoCorpo(c.motivo, 'motivo');
  if (!motivo) throw invalido('informe o motivo do cancelamento', { field: 'motivo', reason: 'obrigatorio' });
  if ([...motivo].length < 3) throw invalido('o motivo do cancelamento deve ter ao menos 3 caracteres', { field: 'motivo', reason: 'motivo_curto' });
  return { id, empresa_id: c.empresa_id, versao: c.versao, operation_id: c.operation_id, motivo };
};

/** Corpo do fator kg/L (A14). A faixa de negócio (0 < f <= 10) é conferida no serviço, sob a trava. */
export const normalizarConversao = (corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  if (typeof c.kg_por_litro !== 'string' || !PADRAO_FATOR.test(c.kg_por_litro)) {
    throw new AppError('ABASTECIMENTO_CONVERSAO_INVALIDA', 'o fator kg/L deve ser um número com até 2 dígitos inteiros e 6 casas; nada foi gravado', {
      details: { field: 'kg_por_litro', reason: 'formato' },
    });
  }
  return {
    empresa_id: c.empresa_id,
    tipo_combustivel_id: c.tipo_combustivel_id,
    produto_id: c.produto_id,
    kg_por_litro: dec(c.kg_por_litro).toFixed(CASAS_FATOR),
    declara_estoque_em_kg: c.declara_estoque_em_kg === true,
    conversao_vigente_id: c.conversao_vigente_id ?? null,
  };
};

// ─── fingerprint canônico (ordem FIXA de chaves) ────────────────────────────

/** @param {any} e Entrada normalizada da confirmação */
export const fingerprintDaConfirmacao = (e) => ({
  v: 1,
  empresa_id: e.empresa_id,
  bem_id: e.bem_id,
  tanque_id: e.tanque_id,
  tipo_combustivel_id: e.tipo_combustivel_id,
  produto_id: e.produto_id,
  local_estoque_id: e.local_estoque_id,
  data_operacional: e.data_operacional,
  quantidade_litros: e.quantidade_litros,
  medidor_leitura: e.medidor_leitura,
  tanque_cheio: e.tanque_cheio,
  observacao: e.observacao,
  referencia_externa: e.referencia_externa,
  conversao_id: e.conversao_id,
  conversao_versao: e.conversao_versao,
});

/** @param {any} e Entrada normalizada do cancelamento */
export const fingerprintDoCancelamento = (e) => ({ v: 1, id: e.id, empresa_id: e.empresa_id, versao: e.versao, motivo: e.motivo });

// ─── conversão L → kg ───────────────────────────────────────────────────────

/** kg = ROUND_HALF_UP(litros × fator, 4), UMA vez. */
export const converterLitrosEmKg = (litros, fator) => arredondar(dec(litros).times(dec(fator)), CASAS_QUANTIDADE);

// ─── bloqueios e mensagens ──────────────────────────────────────────────────

/**
 * @param {string} code @param {string} field @param {string} reason @param {Record<string, unknown>} [details]
 * @returns {{ code: string, field: string, reason: string, details: Record<string, unknown> }}
 */
const bloqueio = (code, field, reason, details = {}) => ({ code, field, reason, details });

/** Mensagem por código e motivo (pt-BR; toda recusa diz que nada foi gravado). */
const MENSAGENS = Object.freeze({
  OPERACAO_VALORES_INVALIDOS: {
    quantidade_nao_positiva: () => 'a quantidade de litros deve ser maior que zero; nada foi gravado',
    quantidade_estoque_zero: () => 'a quantidade convertida em kg arredonda para zero: informe mais litros; nada foi gravado',
    valor_excede_limite_estoque: () => 'quantidade ou valor acima do limite das colunas de estoque (9.999.999.999,9999); nada foi gravado',
  },
  ABASTECIMENTO_DATA_FUTURA: { _: (b) => `a data do abastecimento é posterior a hoje na fazenda (${b.details.hoje}); nada foi gravado` },
  ABASTECIMENTO_BEM_INELEGIVEL: {
    bem_inativo: () => 'o bem está inativo: reative-o antes de registrar abastecimento; nada foi gravado',
    natureza_sem_tanque: () => 'só máquinas, veículos e equipamentos com tanque recebem abastecimento; nada foi gravado',
  },
  ABASTECIMENTO_TANQUE_INVALIDO: {
    tanque_inexistente: () => 'tanque não encontrado neste bem; nada foi gravado',
    tanque_inativo: () => 'o tanque está inativo: escolha um tanque ativo do bem; nada foi gravado',
  },
  COMBUSTIVEL_PRODUTO_INVALIDO: {
    tipo_inexistente: () => 'tipo de combustível não encontrado; nada foi gravado',
    tipo_inativo: () => 'o tipo de combustível está inativo; nada foi gravado',
    inexistente: () => 'produto não encontrado nesta fazenda; nada foi gravado',
    outra_empresa: () => 'o produto pertence a outra fazenda: só produtos da fazenda do bem podem ser baixados; nada foi gravado',
    inativo: () => 'o produto está inativo; nada foi gravado',
    sem_vinculo_ativo: () => 'o produto não tem vínculo ativo com este tipo de combustível nesta fazenda; nada foi gravado',
  },
  TANQUE_COMBUSTIVEL_INCOMPATIVEL: {
    unidade_nao_litro: () => 'este combustível não é medido em litros: o abastecimento só aceita combustível em litros; nada foi gravado',
    nao_aceito_pelo_tanque: () => 'o tanque escolhido não aceita este tipo de combustível; nada foi gravado',
  },
  ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL: {
    _: (b) => `o estoque do produto está em ${b.details.unidade ?? '—'}, não em KG: a baixa em kg não é possível; nada foi gravado`,
  },
  ABASTECIMENTO_CONVERSAO_AUSENTE: {
    _: () => 'não há fator kg/L vigente para este produto e combustível nesta fazenda: configure o fator antes de abastecer; nada foi gravado',
  },
  ABASTECIMENTO_CONVERSAO_ALTERADA: { _: () => 'o fator kg/L vigente mudou desde a prévia: refaça a prévia antes de confirmar; nada foi gravado' },
  ABASTECIMENTO_LOCAL_INVALIDO: {
    local_inexistente: () => 'local de estoque não encontrado; nada foi gravado',
    local_inativo: () => 'o local de estoque está inativo; nada foi gravado',
  },
  ABASTECIMENTO_EXCEDE_CAPACIDADE: {
    _: (b) => `os litros informados passam da capacidade do tanque (${b.details.capacidade_litros} L); nada foi gravado`,
  },
  MEDIDOR_LEITURA_INVALIDA: {
    sem_medidor: () => 'o bem não tem medidor: não informe leitura; nada foi gravado',
    obrigatoria: () => 'informe a leitura do medidor do bem; nada foi gravado',
  },
  MEDIDOR_LEITURA_REGRESSIVA: {
    _: (b) => `a leitura informada é menor que a leitura anterior do medidor (${b.details.leitura_referencia} em ${b.details.data_referencia}); nada foi gravado`,
  },
  MEDIDOR_LEITURA_ACIMA_POSTERIOR: {
    _: (b) => `a leitura informada é maior que a leitura de data posterior do medidor (${b.details.leitura_posterior} em ${b.details.data_posterior}); nada foi gravado`,
  },
  ESTOQUE_SALDO_INSUFICIENTE: {
    saldo_lote_insuficiente: (b) => `saldo insuficiente nos lotes deste produto neste local (disponível ${b.details.disponivel} kg); nada foi gravado`,
    estoque_atual_insuficiente: (b) => `o estoque atual do produto (${b.details.estoque_atual} kg) é menor que a quantidade pedida; nada foi gravado`,
  },
});

/** Texto do bloqueio (o mesmo da prévia e do erro). @param {{code: string, reason: string, details: any}} b */
export const mensagemDoBloqueio = (b) => {
  const porCodigo = /** @type {Record<string, (b: any) => string>|undefined} */ (/** @type {any} */ (MENSAGENS)[b.code]);
  const fn = porCodigo?.[b.reason] ?? porCodigo?._;
  return fn ? fn(b) : 'o abastecimento foi recusado; nada foi gravado';
};

/** Bloqueio → AppError (field/reason sobem ao topo pelo tradutor HTTP). */
export const erroDoBloqueio = (b) =>
  new AppError(b.code, mensagemDoBloqueio(b), { details: { field: b.field, reason: b.reason, ...b.details } });

// ─── medidor (B9) ───────────────────────────────────────────────────────────

const maiorLeitura = (pontos) =>
  pontos.filter(Boolean).reduce((m, p) => (!m || dec(p.leitura).gt(dec(m.leitura)) || (dec(p.leitura).eq(dec(m.leitura)) && p.data > m.data) ? p : m), null);
const menorLeitura = (pontos) =>
  pontos.filter(Boolean).reduce((m, p) => (!m || dec(p.leitura).lt(dec(m.leitura)) || (dec(p.leitura).eq(dec(m.leitura)) && p.data < m.data) ? p : m), null);

/**
 * Série monotônica por data (D4): a leitura `r` na data `d` vale sse
 * r >= toda leitura de ponto com data <= d E r <= toda leitura com data > d.
 * Pontos = cadastro do bem + abastecimentos CONFIRMADOS (vizinhos já lidos).
 * @param {{ tipo: string|null, leitura: string|null, dia: string, cadastro: any, anterior: any, posterior: any }} a
 * @returns {{ bloqueio: any, anterior: any, posterior: any }}
 */
export const avaliarLeitura = ({ tipo, leitura, dia, cadastro, anterior, posterior }) => {
  if (!ehContador(tipo)) {
    return { bloqueio: leitura !== null ? bloqueio('MEDIDOR_LEITURA_INVALIDA', 'medidor_leitura', 'sem_medidor') : null, anterior: null, posterior: null };
  }
  const ant = maiorLeitura([cadastro && cadastro.data <= dia ? cadastro : null, anterior]);
  const post = menorLeitura([cadastro && cadastro.data > dia ? cadastro : null, posterior]);
  if (leitura === null) return { bloqueio: bloqueio('MEDIDOR_LEITURA_INVALIDA', 'medidor_leitura', 'obrigatoria'), anterior: ant, posterior: post };
  const r = dec(leitura);
  if (ant && r.lt(dec(ant.leitura))) {
    return {
      bloqueio: bloqueio('MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva', {
        leitura_referencia: ant.leitura, data_referencia: ant.data, origem_referencia: ant.origem, abastecimento_id: ant.abastecimento_id ?? null,
      }),
      anterior: ant,
      posterior: post,
    };
  }
  if (post && r.gt(dec(post.leitura))) {
    return {
      bloqueio: bloqueio('MEDIDOR_LEITURA_ACIMA_POSTERIOR', 'medidor_leitura', 'leitura_acima_posterior', {
        leitura_posterior: post.leitura, data_posterior: post.data, origem_posterior: post.origem, abastecimento_id: post.abastecimento_id ?? null,
      }),
      anterior: ant,
      posterior: post,
    };
  }
  return { bloqueio: null, anterior: ant, posterior: post };
};

// ─── plano ──────────────────────────────────────────────────────────────────

const q4 = (v) => dec(v).toFixed(CASAS_QUANTIDADE);

/**
 * Plano ÚNICO da prévia e da confirmação: devolve sempre o plano (subcampos
 * null quando a base falta) e a lista ORDENADA de bloqueios (B0..B10); a
 * confirmação lança o primeiro. Bloqueios dependentes são pulados quando a
 * base falta (sem tanque não avalia combustível no tanque nem capacidade; sem
 * fator não avalia kg nem estoque; sem produto/local não avalia estoque).
 * @param {any} entrada Entrada normalizada
 * @param {any} estado `carregarEstado` (o mesmo formato na prévia e na confirmação)
 * @param {{ comando: boolean }} opcoes
 */
export const planejarAbastecimento = (entrada, estado, { comando }) => {
  /** @type {Array<ReturnType<typeof bloqueio>>} */
  const bloqueios = [];
  const { bem, tanque, tipo, vinculo, conversao, local, produto, lotes } = estado;
  const litros = dec(entrada.quantidade_litros);

  // B0
  if (!litros.gt(0)) bloqueios.push(bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', 'quantidade_nao_positiva'));
  // B1
  if (entrada.data_operacional > estado.hoje) {
    bloqueios.push(bloqueio('ABASTECIMENTO_DATA_FUTURA', 'data_operacional', 'data_futura', { hoje: estado.hoje, fuso: estado.fuso }));
  }
  // B2
  if (!bem.ativo) bloqueios.push(bloqueio('ABASTECIMENTO_BEM_INELEGIVEL', 'bem_id', 'bem_inativo'));
  if (!NATUREZAS_COM_TANQUE.includes(bem.natureza)) bloqueios.push(bloqueio('ABASTECIMENTO_BEM_INELEGIVEL', 'bem_id', 'natureza_sem_tanque', { natureza: bem.natureza }));
  // B3
  if (!tanque) bloqueios.push(bloqueio('ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inexistente'));
  else if (!tanque.ativo) bloqueios.push(bloqueio('ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inativo'));
  // B4a / B4b
  if (!tipo) bloqueios.push(bloqueio('COMBUSTIVEL_PRODUTO_INVALIDO', 'tipo_combustivel_id', 'tipo_inexistente'));
  else if (!tipo.ativo) bloqueios.push(bloqueio('COMBUSTIVEL_PRODUTO_INVALIDO', 'tipo_combustivel_id', 'tipo_inativo'));
  if (tipo && tipo.unidade !== 'L') {
    bloqueios.push(bloqueio('TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'tipo_combustivel_id', 'unidade_nao_litro', { unidade: tipo.unidade }));
  } else if (tipo && tanque && !tanque.combustiveis.some((c) => c.combustivel_id === tipo.id)) {
    bloqueios.push(bloqueio('TANQUE_COMBUSTIVEL_INCOMPATIVEL', 'tipo_combustivel_id', 'nao_aceito_pelo_tanque'));
  }
  // B5a / B5b
  if (!produto) bloqueios.push(bloqueio('COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inexistente'));
  else if (produto.empresa_id !== bem.empresa_id) bloqueios.push(bloqueio('COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa'));
  else if (!produto.ativo) bloqueios.push(bloqueio('COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'inativo'));
  else if (!vinculo || !vinculo.ativo) bloqueios.push(bloqueio('COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'));
  if (produto && produto.unidade_principal_estoque !== 'KG') {
    bloqueios.push(bloqueio('ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_estoque_nao_kg', { unidade: produto.unidade_principal_estoque }));
  }
  // B6a / B6b (só com tipo e produto: sem eles o par não existe)
  if (tipo && produto) {
    if (!conversao) {
      bloqueios.push(bloqueio('ABASTECIMENTO_CONVERSAO_AUSENTE', 'conversao_id', 'sem_conversao_vigente', { tipo_combustivel_id: tipo.id, produto_id: produto.id }));
    } else if (comando && (entrada.conversao_id !== conversao.id || entrada.conversao_versao !== conversao.versao)) {
      bloqueios.push(bloqueio('ABASTECIMENTO_CONVERSAO_ALTERADA', 'conversao_id', 'conversao_alterada', { conversao_vigente_id: conversao.id, conversao_vigente_versao: conversao.versao }));
    }
  }
  // B7
  if (!local) bloqueios.push(bloqueio('ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inexistente'));
  else if (!local.ativo) bloqueios.push(bloqueio('ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inativo'));
  // B8a
  if (tanque && litros.gt(dec(tanque.capacidade_litros))) {
    bloqueios.push(bloqueio('ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade_litros', 'excede_capacidade_tanque', { capacidade_litros: q4(tanque.capacidade_litros) }));
  }
  // B8b
  const fator = conversao && tipo && produto ? dec(conversao.kg_por_litro) : null;
  const kg = fator && litros.gt(0) ? converterLitrosEmKg(litros, fator) : null;
  let kgValido = false;
  if (kg) {
    if (!kg.gt(0)) bloqueios.push(bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', 'quantidade_estoque_zero', { quantidade_kg: q4(kg) }));
    else if (kg.gt(LIMITE_ESTOQUE)) bloqueios.push(bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', 'valor_excede_limite_estoque', { quantidade_kg: q4(kg) }));
    else kgValido = true;
  }
  // B9
  const tipoMedidor = bem.medidor_tipo ?? 'SEM_MEDIDOR';
  const medidor = avaliarLeitura({
    tipo: tipoMedidor,
    leitura: entrada.medidor_leitura,
    dia: entrada.data_operacional,
    cadastro: estado.medidor.cadastro,
    anterior: estado.medidor.anterior,
    posterior: estado.medidor.posterior,
  });
  if (medidor.bloqueio) bloqueios.push(medidor.bloqueio);
  // B10
  let fifo = null;
  if (kgValido && produto && local) {
    const sim = consumirFifo(lotes, /** @type {any} */ (kg));
    if (!sim.suficiente) {
      bloqueios.push(bloqueio('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade_litros', 'saldo_lote_insuficiente', { disponivel: q4(sim.disponivel), solicitado: q4(kg) }));
    } else if (dec(produto.estoque_atual).lt(/** @type {any} */ (kg))) {
      bloqueios.push(bloqueio('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade_litros', 'estoque_atual_insuficiente', { estoque_atual: q4(produto.estoque_atual), solicitado: q4(kg) }));
    } else if (sim.valorTotal.gt(LIMITE_ESTOQUE)) {
      bloqueios.push(bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade_litros', 'valor_excede_limite_estoque', { valor_total: sim.valorTotal.toFixed(CASAS_CUSTO) }));
    }
    const porId = new Map(lotes.map((l) => [l.id, l]));
    fifo = {
      suficiente: sim.suficiente,
      disponivel_kg: q4(sim.disponivel),
      fatias: sim.fatias.map((f, i) => ({
        ordem: i + 1,
        lote_id: f.lote_id,
        data_lote: diaDe(porId.get(f.lote_id)?.data_documento ?? porId.get(f.lote_id)?.createdAt ?? null),
        quantidade_kg: q4(f.quantidade),
        custo_unitario: dec(f.custo_unitario).toFixed(CASAS_CUSTO),
        valor: arredondar(f.quantidade.times(f.custo_unitario), CASAS_CUSTO).toFixed(CASAS_CUSTO),
      })),
      custo_total_estimado: sim.valorTotal.toFixed(CASAS_CUSTO),
      custo_unitario_estimado: sim.valorUnitario.toFixed(CASAS_CUSTO),
    };
  }

  const plano = {
    empresa_id: bem.empresa_id,
    data_operacional: entrada.data_operacional,
    hoje: estado.hoje,
    bem: { id: bem.id, numero: bem.numero, codigo_frota: bem.codigo_frota ?? null, nome: bem.nome, natureza: bem.natureza, ativo: bem.ativo },
    tanque: tanque ? { id: tanque.id, identificador: tanque.identificador, capacidade_litros: q4(tanque.capacidade_litros), ativo: tanque.ativo } : null,
    tipo_combustivel: tipo ? { id: tipo.id, codigo: tipo.codigo, nome: tipo.nome, unidade: tipo.unidade } : null,
    produto: produto
      ? { id: produto.id, nome: produto.nome_produto, codigo_interno: produto.codigo_interno ?? null, unidade_principal_estoque: produto.unidade_principal_estoque }
      : null,
    local_estoque: local ? { id: local.id, nome: local.nome } : null,
    conversao: conversao && tipo && produto
      ? { id: conversao.id, versao: conversao.versao, sequencia: conversao.sequencia, kg_por_litro: dec(conversao.kg_por_litro).toFixed(CASAS_FATOR) }
      : null,
    quantidade_litros: litros.toFixed(CASAS_LITROS),
    quantidade_kg: kg ? q4(kg) : null,
    estoque: produto && local ? { saldo_local_kg: q4(somar(lotes.map((l) => l.quantidade_disponivel))), estoque_atual_kg: q4(produto.estoque_atual) } : null,
    fifo,
    medidor: {
      tipo: tipoMedidor,
      unidade: ehContador(tipoMedidor) ? UNIDADE_DO_MEDIDOR[tipoMedidor] : null,
      leitura: entrada.medidor_leitura,
      anterior: medidor.anterior,
      posterior: medidor.posterior,
    },
    tanque_cheio: entrada.tanque_cheio,
    custo_e_estimativa: true,
  };
  return { plano, bloqueios };
};

// ─── auditoria (allowlist; sem texto livre) ─────────────────────────────────

const texto4 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(CASAS_QUANTIDADE));

/**
 * @param {any} r linha de `AbastecimentoBem`
 * @param {Array<{ estoque_lote_nota_id: string, quantidade: any, custo_unitario: any }>} fatias
 */
export const paraAuditoria = (r, fatias) => ({
  id: r.id,
  empresa_id: r.empresa_id,
  numero: r.numero,
  status: r.status,
  versao: r.versao,
  bem_id: r.bem_id,
  tanque_id: r.tanque_id,
  tipo_combustivel_id: r.tipo_combustivel_id,
  produto_id: r.produto_id,
  local_estoque_id: r.local_estoque_id,
  conversao_id: r.conversao_id,
  data_operacional: diaDe(r.data_operacional),
  quantidade_litros: texto4(r.quantidade_litros),
  kg_por_litro: dec(r.kg_por_litro).toFixed(CASAS_FATOR),
  quantidade_kg: texto4(r.quantidade_kg),
  custo_total: texto4(r.custo_total),
  custo_unitario_kg: texto4(r.custo_unitario_kg),
  tanque_cheio: r.tanque_cheio,
  medidor_tipo: r.medidor_tipo,
  medidor_leitura: texto4(r.medidor_leitura),
  movimentacao_estoque_id: r.movimentacao_estoque_id,
  movimentacao_estorno_id: r.movimentacao_estorno_id ?? null,
  fatias: fatias.map((f) => ({ lote_id: f.estoque_lote_nota_id, quantidade: texto4(f.quantidade), custo_unitario: texto4(f.custo_unitario) })),
  tem_observacao: Boolean(r.observacao),
  tem_referencia_externa: Boolean(r.referencia_externa),
});

export { MEDIDORES_CONTADOR };
