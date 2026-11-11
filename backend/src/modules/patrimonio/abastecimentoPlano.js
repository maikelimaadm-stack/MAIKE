/**
 * D-PROD-159 (Patrimônio P1-02), revisto pela D-PROD-162 (SIMPLIFICA-01) —
 * regras PURAS do abastecimento (sem banco): normalização dos corpos,
 * fingerprint canônico da idempotência (v2), série do medidor e o PLANO único
 * que a prévia mostra e a confirmação executa (mesma função, mesmo estado).
 *
 * D-PROD-162: o abastecimento baixa do estoque EXATAMENTE a quantidade
 * digitada, na unidade de estoque do Produto (`L` ou `KG`), com 4 casas.
 * Nenhuma conversão entre unidades (nem fator, nem densidade, nem `1 L = 1 KG`):
 * o número digitado é o número que o motor de estoque recebe. A capacidade do
 * tanque (em litros) só é conferida para Produto em `L`. Decimais em `Dec`
 * (decimalFinanceiro), nunca Number.
 *
 * D-PROD-163: Produto em QUALQUER unidade do cadastro (L, KG ou SACO). A
 * unidade do abastecimento é a unidade EFETIVA do estoque: `L` para L e `KG`
 * para KG e SACO (SACO guarda estoque em kg); a quantidade digitada é em kg
 * para SACO, sem conversão por peso do saco.
 */

import { AppError } from '../../shared/errors/AppError.js';
import { CASAS_CUSTO, CASAS_QUANTIDADE, LIMITE_ESTOQUE, arredondar, dec, somar } from '../financeiro/decimalFinanceiro.js';
import { consumirFifo } from '../estoqueFisico/estoqueFisicoMotor.js';
import { invalido, textoDoCorpo } from '../gestao/gestaoComum.js';
import { MEDIDORES_CONTADOR, ehContador } from './abastecimentoMedidor.js';
import { diaDe, diaDoCorpo } from './patrimonioComum.js';
import { CAPACIDADES_POR_NATUREZA, UNIDADE_DO_MEDIDOR, unidadeEfetivaDoEstoque } from './patrimonioDominio.js';

export const ENTIDADE = 'AbastecimentoBem';
/**
 * D-PROD-162: tipos NOVOS do recibo de idempotência. O recibo v1
 * (`confirmar_abastecimento_bem`/`cancelar_abastecimento_bem`, corpo com litros,
 * tipo e fator) nunca é reaproveitado: o unique do recibo inclui o tipo.
 */
export const TIPO_CONFIRMAR = 'confirmar_abastecimento_bem_v2';
export const TIPO_CANCELAR = 'cancelar_abastecimento_bem_v2';
/** Naturezas com tanque (MAQUINA, VEICULO, EQUIPAMENTO), da matriz da P1-01. */
export const NATUREZAS_COM_TANQUE = Object.freeze(Object.entries(CAPACIDADES_POR_NATUREZA).filter(([, c]) => c.tanques).map(([n]) => n));
export const CASAS_QUANTIDADE_ABASTECIMENTO = 4;
export const CASAS_LEITURA = 4;
export const PADRAO_QUANTIDADE = /^\d{1,10}(\.\d{1,4})?$/;
export const PADRAO_LEITURA = /^\d{1,10}(\.\d{1,4})?$/;
export const PADRAO_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
export const STATUS_CONFIRMADO = 'CONFIRMADO';
export const STATUS_CANCELADO = 'CANCELADO';

/**
 * A unidade de estoque do Produto é uma das que o tanque aceita (L, KG ou SACO;
 * D-PROD-163)? A unidade do abastecimento é a EFETIVA (`unidadeEfetivaDoEstoque`).
 * @param {unknown} u
 */
export const unidadeDoAbastecimento = (u) => unidadeEfetivaDoEstoque(u) !== null;
/** Rótulo curto da unidade nas mensagens (`L` / `kg`). @param {string|null|undefined} u */
export const rotuloDaUnidade = (u) => (u === 'L' ? 'L' : u === 'KG' ? 'kg' : (u ?? '—'));

const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// ─── anti-coerção (antes do AJV) ────────────────────────────────────────────

const DECIMAIS_DO_CORPO = Object.freeze(['quantidade', 'medidor_leitura']);

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

const quantidadeObrigatoria = (c) => {
  if (c.quantidade === undefined || c.quantidade === null) throw invalido('quantidade é obrigatória', { field: 'quantidade', reason: 'obrigatorio' });
};

const basesDoCorpo = (c) => ({
  empresa_id: c.empresa_id,
  bem_id: c.bem_id,
  tanque_id: c.tanque_id,
  produto_id: c.produto_id,
  local_estoque_id: c.local_estoque_id,
  data_operacional: dataOperacionalDoCorpo(c.data_operacional),
  quantidade: /** @type {string} */ (decimalDoCorpo(c.quantidade, 'quantidade', PADRAO_QUANTIDADE, CASAS_QUANTIDADE_ABASTECIMENTO)),
  medidor_leitura: decimalDoCorpo(c.medidor_leitura, 'medidor_leitura', PADRAO_LEITURA, CASAS_LEITURA),
  tanque_cheio: c.tanque_cheio === true,
  observacao: textoDoCorpo(c.observacao, 'observacao') ?? null,
  referencia_externa: textoDoCorpo(c.referencia_externa, 'referencia_externa') ?? null,
});

/** Corpo da prévia (A3) → Entrada (sem operation_id). */
export const normalizarPrevia = (corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  quantidadeObrigatoria(c);
  return { ...basesDoCorpo(c), operation_id: null };
};

/** Corpo da confirmação (A4) → Entrada canônica. */
export const normalizarConfirmacao = (corpo) => {
  const c = /** @type {Record<string, any>} */ (corpo ?? {});
  quantidadeObrigatoria(c);
  if (typeof c.operation_id !== 'string' || !PADRAO_OPERATION_ID.test(c.operation_id)) {
    throw invalido('operation_id inválido', { field: 'operation_id', reason: 'formato' });
  }
  return { ...basesDoCorpo(c), operation_id: c.operation_id };
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

// ─── fingerprint canônico (ordem FIXA de chaves; v2 da D-PROD-162) ──────────

/** @param {any} e Entrada normalizada da confirmação */
export const fingerprintDaConfirmacao = (e) => ({
  v: 2,
  empresa_id: e.empresa_id,
  bem_id: e.bem_id,
  tanque_id: e.tanque_id,
  produto_id: e.produto_id,
  local_estoque_id: e.local_estoque_id,
  data_operacional: e.data_operacional,
  quantidade: e.quantidade,
  medidor_leitura: e.medidor_leitura,
  tanque_cheio: e.tanque_cheio,
  observacao: e.observacao,
  referencia_externa: e.referencia_externa,
});

/** @param {any} e Entrada normalizada do cancelamento */
export const fingerprintDoCancelamento = (e) => ({ v: 2, id: e.id, empresa_id: e.empresa_id, versao: e.versao, motivo: e.motivo });

// ─── bloqueios e mensagens ──────────────────────────────────────────────────

/**
 * @param {string} code @param {string} field @param {string} reason @param {Record<string, unknown>} [details]
 * @returns {{ code: string, field: string, reason: string, details: Record<string, unknown> }}
 */
const bloqueio = (code, field, reason, details = {}) => ({ code, field, reason, details });

/** Mensagem por código e motivo (pt-BR; toda recusa diz que nada foi gravado). */
const MENSAGENS = Object.freeze({
  OPERACAO_VALORES_INVALIDOS: {
    quantidade_nao_positiva: () => 'a quantidade abastecida deve ser maior que zero; nada foi gravado',
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
  ABASTECIMENTO_PRODUTO_INVALIDO: {
    inexistente: () => 'produto não encontrado nesta fazenda; nada foi gravado',
    outra_empresa: () => 'o produto pertence a outra fazenda: só produtos da fazenda do bem podem ser baixados; nada foi gravado',
    inativo: () => 'o produto está inativo; nada foi gravado',
  },
  ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL: {
    _: (b) => `o estoque do produto está em ${b.details.unidade ?? '—'}, não em L, KG nem SACO: o abastecimento não é possível; nada foi gravado`,
  },
  ABASTECIMENTO_PRODUTO_NAO_ACEITO: {
    _: () => 'o tanque escolhido não aceita este produto: marque-o nos Produtos aceitos do tanque em Bens Patrimoniais; nada foi gravado',
  },
  ABASTECIMENTO_LOCAL_INVALIDO: {
    local_inexistente: () => 'local de estoque não encontrado; nada foi gravado',
    local_inativo: () => 'o local de estoque está inativo; nada foi gravado',
  },
  ABASTECIMENTO_EXCEDE_CAPACIDADE: {
    _: (b) => `a quantidade em litros passa da capacidade do tanque (${b.details.capacidade_litros} L); nada foi gravado`,
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
    saldo_lote_insuficiente: (b) =>
      `saldo insuficiente nos lotes deste produto neste local (disponível ${b.details.disponivel} ${rotuloDaUnidade(b.details.unidade)}); nada foi gravado`,
    estoque_atual_insuficiente: (b) =>
      `o estoque atual do produto (${b.details.estoque_atual} ${rotuloDaUnidade(b.details.unidade)}) é menor que a quantidade pedida; nada foi gravado`,
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
 * base falta (sem tanque ou sem produto não avalia o aceite; sem unidade L não
 * confere a capacidade; sem produto/local válidos não avalia o estoque).
 * D-PROD-162: a prévia e a confirmação têm EXATAMENTE os mesmos bloqueios (sem
 * fator visto na prévia não há o que divergir entre as duas).
 * @param {any} entrada Entrada normalizada
 * @param {any} estado `carregarEstado` (o mesmo formato na prévia e na confirmação)
 */
export const planejarAbastecimento = (entrada, estado) => {
  /** @type {Array<ReturnType<typeof bloqueio>>} */
  const bloqueios = [];
  const { bem, tanque, local, produto, lotes } = estado;
  const quantidade = dec(entrada.quantidade);

  // B0
  const quantidadePositiva = quantidade.gt(0);
  if (!quantidadePositiva) bloqueios.push(bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade', 'quantidade_nao_positiva'));
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
  // B4 (inexistente = outro tenant também: sem oráculo)
  let produtoValido = false;
  if (!produto) bloqueios.push(bloqueio('ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'inexistente'));
  else if (produto.empresa_id !== bem.empresa_id) bloqueios.push(bloqueio('ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'outra_empresa'));
  else if (!produto.ativo) bloqueios.push(bloqueio('ABASTECIMENTO_PRODUTO_INVALIDO', 'produto_id', 'inativo'));
  else produtoValido = true;
  // B5
  const unidadeAceita = Boolean(produto) && unidadeDoAbastecimento(produto.unidade_principal_estoque);
  if (produto && !unidadeAceita) {
    bloqueios.push(bloqueio('ABASTECIMENTO_PRODUTO_UNIDADE_INCOMPATIVEL', 'produto_id', 'unidade_nao_aceita', { unidade: produto.unidade_principal_estoque }));
  }
  /** Unidade EFETIVA do estoque (D-PROD-163: SACO → KG). @type {'L'|'KG'|null} */
  const unidade = unidadeAceita ? unidadeEfetivaDoEstoque(produto.unidade_principal_estoque) : null;
  // B6 (só com tanque e produto: sem eles o par não existe)
  if (tanque && produto && !(tanque.produtos ?? []).some((a) => a.produto_id === produto.id && a.ativo)) {
    bloqueios.push(bloqueio('ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque'));
  }
  // B7
  if (!local) bloqueios.push(bloqueio('ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inexistente'));
  else if (!local.ativo) bloqueios.push(bloqueio('ABASTECIMENTO_LOCAL_INVALIDO', 'local_estoque_id', 'local_inativo'));
  // B8a — a capacidade do tanque é em litros: só conferida para Produto em L (D-PROD-162)
  const confereCapacidade = unidade === 'L';
  if (confereCapacidade && tanque && quantidade.gt(dec(tanque.capacidade_litros))) {
    bloqueios.push(bloqueio('ABASTECIMENTO_EXCEDE_CAPACIDADE', 'quantidade', 'excede_capacidade_tanque', { capacidade_litros: q4(tanque.capacidade_litros) }));
  }
  // B8b (defensivo: o padrão de 10+4 dígitos já cabe no limite)
  const dentroDoLimite = !quantidade.gt(LIMITE_ESTOQUE);
  if (!dentroDoLimite) bloqueios.push(bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade', 'valor_excede_limite_estoque', { quantidade: q4(quantidade) }));
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
  // B10 — FIFO com a quantidade digitada (só com produto e unidade válidos, local ativo e quantidade válida)
  const produtoOk = produtoValido && unidadeAceita;
  let fifo = null;
  if (quantidadePositiva && dentroDoLimite && produtoOk && local && local.ativo) {
    const sim = consumirFifo(lotes, quantidade);
    if (!sim.suficiente) {
      bloqueios.push(bloqueio('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'saldo_lote_insuficiente', { disponivel: q4(sim.disponivel), solicitado: q4(quantidade), unidade }));
    } else if (dec(produto.estoque_atual).lt(quantidade)) {
      bloqueios.push(bloqueio('ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'estoque_atual_insuficiente', { estoque_atual: q4(produto.estoque_atual), solicitado: q4(quantidade), unidade }));
    } else if (sim.valorTotal.gt(LIMITE_ESTOQUE)) {
      bloqueios.push(bloqueio('OPERACAO_VALORES_INVALIDOS', 'quantidade', 'valor_excede_limite_estoque', { valor_total: sim.valorTotal.toFixed(CASAS_CUSTO) }));
    }
    const porId = new Map(lotes.map((l) => [l.id, l]));
    fifo = {
      suficiente: sim.suficiente,
      disponivel: q4(sim.disponivel),
      fatias: sim.fatias.map((f, i) => ({
        ordem: i + 1,
        lote_id: f.lote_id,
        data_lote: diaDe(porId.get(f.lote_id)?.data_documento ?? porId.get(f.lote_id)?.createdAt ?? null),
        quantidade: q4(f.quantidade),
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
    produto: produto
      ? {
          id: produto.id,
          nome: produto.nome_produto,
          codigo_interno: produto.codigo_interno ?? null,
          unidade_principal_estoque: produto.unidade_principal_estoque,
          unidade_abastecimento: unidadeEfetivaDoEstoque(produto.unidade_principal_estoque),
        }
      : null,
    local_estoque: local ? { id: local.id, nome: local.nome } : null,
    quantidade: q4(quantidade),
    unidade,
    confere_capacidade: confereCapacidade,
    estoque: produtoOk && local ? { saldo_local: q4(somar(lotes.map((l) => l.quantidade_disponivel))), estoque_atual: q4(produto.estoque_atual), unidade } : null,
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
  produto_id: r.produto_id,
  local_estoque_id: r.local_estoque_id,
  data_operacional: diaDe(r.data_operacional),
  quantidade: texto4(r.quantidade),
  unidade: r.unidade,
  custo_total: texto4(r.custo_total),
  custo_unitario: texto4(r.custo_unitario),
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
