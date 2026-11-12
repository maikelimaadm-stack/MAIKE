/**
 * Nível de COCHO e DEPÓSITO de suplementação — fonte única (SSOT), D-PROD-178.
 *
 * Funções PURAS: sem React, sem `window`, sem storage, sem rede e sem
 * `new Date()` sem argumento. O dia civil de "hoje" (AAAA-MM-DD, no fuso da
 * fazenda) chega sempre por parâmetro; quem chama usa `hojeNoFuso(fuso)` ou o
 * hook `useDiaCivil(fuso)`.
 *
 * Marcador do mapa, tooltip, detalhe do cocho, detalhe do depósito e alertas
 * leem daqui o MESMO número. Ninguém mais calcula saldo, taxa ou percentual.
 *
 * ── Cocho ────────────────────────────────────────────────────────────────
 *  - Ciclo = último evento do ponto. Aberto quando `dias_periodo == null`.
 *  - Base do ciclo aberto = `quantidade_total_kg` (fornecido) + `sobra_kg`
 *    (sobra anterior, saldo inicial legítimo do ciclo).
 *  - Taxa = `consumo_esperado_pv_kg` do evento (kg/dia do grupo, gravada UMA
 *    vez no lançamento pelo %PV do produto). É a ÚNICA fonte: sem fallback por
 *    lotes atuais, nome do produto, regra sugerida ou consumo ideal do ponto.
 *    `consumo_diario_grupo_kg` é o consumo REAL de um período fechado e nunca é
 *    usado como taxa futura.
 *  - Período fechado: o fechamento sobrescreve `sobra_kg` com a sobra FINAL;
 *    a base original se perde, então não há fração do ciclo (ícone neutro).
 *  - Cochos que atendem os mesmos animais com o mesmo produto gravam, cada um,
 *    o consumo do rebanho inteiro (não há rateio). A estimativa fica marcada
 *    como não confiável — nada de inventar 50/50.
 *
 * ── Limite operacional ──────────────────────────────────────────────────
 * `capacidade_cocho_kg` (cocho e depósito) é o LIMITE OPERACIONAL configurado
 * pelo proprietário: o máximo recomendado, que pode ser menor que a
 * capacidade física (esta não é armazenada). O campo é mutável e não tem
 * histórico: o percentual é sempre contra o limite configurado HOJE, inclusive
 * para lançamentos antigos. Percentuais de ocupação são BRUTOS (podem passar de
 * 100%); só as frações para desenho (`fracao*Svg`) são limitadas a 0..1.
 *
 * ── Depósito ────────────────────────────────────────────────────────────
 * Não consome com o tempo: o saldo é a soma dos lotes de estoque do local, em
 * kg, sem Produto em litros (D-PROD-162, P-11). `estoque_minimo_kg` é só o
 * gatilho inferior de reposição; nunca é divisor nem teto do percentual.
 */

import { diasEntre, ehDiaValido, formatarDia, somarDias } from '@/lib/diaCivil';
import { normalizarTexto } from '@/domain/mapa/pontoCascata';

// ── Tipos públicos ─────────────────────────────────────────────────────────

/**
 * @typedef {'info'|'alerta'|'critico'} SeveridadeNivel
 *
 * @typedef {Object} AlertaNivel
 * @property {string} tipo
 * @property {SeveridadeNivel} severidade
 * @property {string} titulo
 * @property {string} descricao
 */

/**
 * @typedef {'sem_lancamento'|'data_invalida'|'lancamento_futuro'|'ciclo_fechado'|'ciclo_aberto'} EstadoNivelCocho
 * @typedef {'estimada'|'indisponivel'|'compartilhada'} ConfiabilidadeNivelCocho
 */

/**
 * Nível do cocho. Campos numéricos `null` significam "não se sabe" — a tela
 * mostra a `mensagem`, nunca um zero inventado.
 *
 * @typedef {Object} NivelCocho
 * @property {'COCHO'} tipo
 * @property {string|null} pontoId
 * @property {string|null} hoje                    dia civil usado no cálculo
 * @property {EstadoNivelCocho} estado
 * @property {ConfiabilidadeNivelCocho|null} confiabilidade  só no ciclo aberto
 * @property {boolean} neutro                     ícone sem preenchimento
 * @property {any|null} evento                    último evento do ponto
 * @property {string|null} dataLancamento         AAAA-MM-DD (ou o texto bruto, se inválido)
 * @property {string|null} produto
 * @property {string|null} produtoId
 * @property {number|null} fornecidoKg            `quantidade_total_kg`
 * @property {number|null} sobraAnteriorKg        `sobra_kg` do evento aberto
 * @property {number|null} baseCicloKg            fornecido + sobra anterior (null se fechado)
 * @property {number|null} taxaConsumoKgDia       `consumo_esperado_pv_kg` (> 0) ou null
 * @property {'pv_no_lancamento'|null} fonteConsumo
 * @property {number|null} diasDecorridos         dias civis desde o lançamento
 * @property {number|null} consumoEstimadoKg      min(base, taxa × dias)
 * @property {number|null} saldoKg               estimado (aberto) ou informado (fechado)
 * @property {'estimado'|'informado'|null} saldoTipo
 * @property {number|null} fracaoCiclo           saldo ÷ base, 0..1
 * @property {number|null} diasRestantesEstimados sem arredondar (arredondar só na UI)
 * @property {string|null} dataEsgotamentoEstimada AAAA-MM-DD
 * @property {string[]} compartilhadoCom          ids dos outros cochos com o mesmo produto e animais
 * @property {number|null} limiteOperacionalKg    `capacidade_cocho_kg` > 0, ou null
 * @property {number|null} ocupacaoNoLancamentoPercentual base ÷ limite × 100, bruto
 * @property {number|null} excessoNoLancamentoKg   max(0, base − limite)
 * @property {number|null} ocupacaoAtualPercentual saldo ÷ limite × 100, bruto
 * @property {number|null} excessoAtualKg          max(0, saldo − limite)
 * @property {number|null} fracaoLimiteSvg         ocupação atual limitada a 0..1 (só desenho)
 * @property {string|null} mensagemLimite          "Limite operacional não configurado." quando falta
 * @property {number} fracaoParaSvg               fração do ciclo quantizada em 1% (0 se neutro)
 * @property {string} rotuloCurto                 "75%", "Sem estimativa", "Sem lançamento"…
 * @property {string} mensagem                    frase principal do estado
 * @property {string|null} motivo                 por que não há estimativa
 * @property {string} descricao                   tooltip: 1–2 frases com kg e %
 * @property {AlertaNivel[]} alertas
 */

/**
 * Nível do depósito.
 *
 * @typedef {Object} NivelDeposito
 * @property {'DEPOSITO'} tipo
 * @property {string|null} pontoId
 * @property {number} saldoKg                     Σ lotes em kg do local (sem L), sem truncar
 * @property {number} lotesConsiderados
 * @property {number} lotesEmLitrosIgnorados
 * @property {boolean} unidadesConfirmadas
 * @property {string|null} mensagemUnidade
 * @property {number|null} limiteOperacionalKg
 * @property {number|null} ocupacaoPercentual     saldo ÷ limite × 100, bruto
 * @property {number|null} excessoKg              max(0, saldo − limite)
 * @property {number} fracaoParaSvg              min(1, saldo ÷ limite) quantizada em 1%
 * @property {boolean} neutro                     sem limite ⇒ sem percentual
 * @property {string|null} mensagemLimite
 * @property {number|null} estoqueMinimoKg
 * @property {boolean} abaixoMinimo               saldo ≤ mínimo (mínimo configurado)
 * @property {number|null} margemMinimoKg         saldo − mínimo (pode ser negativa)
 * @property {string} mensagemMinimo
 * @property {number} necessidadeReposicaoKg      max(limite − saldo, 0); 0 sem limite
 * @property {string} rotuloCurto
 * @property {string} descricao
 * @property {AlertaNivel[]} alertas
 */

// ── Mensagens (pt-BR, sem culpar pessoas) ──────────────────────────────────

export const MENSAGENS_NIVEL = Object.freeze({
  semLancamento: 'Nenhum lançamento registrado neste cocho.',
  dataInvalida: 'Data do último lançamento inválida; não é possível estimar.',
  estimativaIndisponivel: 'Estimativa de consumo indisponível',
  motivoSemPv: 'o produto não tinha %PV no lançamento',
  motivoSemHoje: 'o dia de referência não foi informado',
  motivoCompartilhada: 'o consumo não é rateado entre cochos que atendem os mesmos animais',
  cicloSemQuantidade: 'Ciclo sem quantidade fornecida.',
  limiteNaoConfigurado: 'Limite operacional não configurado.',
  limiteNaoConfiguradoDeposito: 'Limite operacional não configurado; não há percentual.',
  minimoNaoConfigurado: 'Estoque mínimo não configurado.',
  unidadeNaoConfirmada: 'Unidade de alguns produtos não confirmada; o saldo em kg pode incluir itens de outra unidade.',
});

// ── Formatação (pt-BR) ─────────────────────────────────────────────────────

/** @param {number} valor @param {number} casas */
const numeroPtBR = (valor, casas) =>
  (Object.is(valor, -0) ? 0 : valor).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });

/** "150 kg", "166,67 kg", "5.000 kg" (até 2 casas, sem zeros à direita). @param {number} kg */
export const formatarKgNivel = (kg) => `${numeroPtBR(kg, 2)} kg`;

/** "166,67%", "125%" (valor já em pontos percentuais, até 2 casas). @param {number} percentual */
export const formatarPercentualNivel = (percentual) => `${numeroPtBR(percentual, 2)}%`;

/** "50 kg/dia". @param {number} kgDia */
export const formatarTaxaNivel = (kgDia) => `${numeroPtBR(kgDia, 2)} kg/dia`;

// ── Auxiliares ─────────────────────────────────────────────────────────────

/** Número finito vindo de documento JSON (aceita texto numérico); senão null. @param {unknown} valor */
const numeroOuNulo = (valor) => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Quantidade em kg não negativa (ausente/inválida → 0). @param {unknown} valor */
const kgOuZero = (valor) => Math.max(0, numeroOuNulo(valor) ?? 0);

/** Valor positivo ou null. @param {unknown} valor */
const positivoOuNulo = (valor) => {
  const n = numeroOuNulo(valor);
  return n != null && n > 0 ? n : null;
};

/** @param {number} valor */
const clamp01 = (valor) => (Number.isFinite(valor) ? Math.min(1, Math.max(0, valor)) : 0);

/** Fração 0..1 quantizada em 1%. @param {number} fracao */
const quantizar = (fracao) => Math.round(clamp01(fracao) * 100) / 100;

/**
 * Dia civil do lançamento: "AAAA-MM-DD"; com hora (legado), vale o dia antes
 * do "T" (mesma convenção de `formatDateBR`). Inválido → null.
 * @param {unknown} valor
 */
const diaDoLancamento = (valor) => {
  if (typeof valor !== 'string') return null;
  const dia = valor.includes('T') ? valor.split('T')[0] : valor;
  return ehDiaValido(dia) ? dia : null;
};

/** Instante de criação (ms) para desempate; sem marca → null. @param {any} evento */
const instanteCriacao = (evento) => {
  const bruto = evento?.created_date ?? evento?.createdAt ?? evento?.created_at;
  if (typeof bruto !== 'string' && typeof bruto !== 'number') return null;
  const t = new Date(bruto).getTime();
  return Number.isNaN(t) ? null : t;
};

/** @param {any} a @param {any} b */
const empresasDiferentes = (a, b) => Boolean(a?.empresa_id && b?.empresa_id && String(a.empresa_id) !== String(b.empresa_id));

/** @param {any} ponto @returns {string[]} */
const areasDoPonto = (ponto) => {
  if (Array.isArray(ponto?.area_vinculada_ids) && ponto.area_vinculada_ids.length) return ponto.area_vinculada_ids.filter(Boolean).map(String);
  return ponto?.area_vinculada_id ? [String(ponto.area_vinculada_id)] : [];
};

/** @param {any} ponto */
const ehCocho = (ponto) => normalizarTexto(ponto?.categoria_ponto || 'COCHO') === 'COCHO';

/** @param {any} ponto */
const ehAtivo = (ponto) => Boolean(ponto) && ponto.ativo !== false && (ponto.status == null || normalizarTexto(ponto.status) === 'ATIVO');

/** Mesmo produto: por `produto_id` quando ambos têm; senão pelo nome normalizado. @param {any} a @param {any} b */
const mesmoProduto = (a, b) => {
  if (a?.produto_id && b?.produto_id) return String(a.produto_id) === String(b.produto_id);
  const nomeA = normalizarTexto(a?.produto ?? '');
  return nomeA !== '' && nomeA === normalizarTexto(b?.produto ?? '');
};

// ── Último evento ──────────────────────────────────────────────────────────

/**
 * Último evento de suplementação do ponto.
 *
 *  - só eventos de `ponto.id`; com `empresa_id` nos dois lados e diferentes,
 *    o evento é de outra fazenda e fica fora;
 *  - vence a maior `data_lancamento` válida (texto AAAA-MM-DD);
 *  - empate → maior `created_date`/`createdAt`, quando há; senão o primeiro
 *    do array (a listagem vem por `createdAt` desc);
 *  - eventos com data inválida só entram se não houver nenhum válido.
 *
 * @param {any} ponto
 * @param {any[]|null|undefined} eventos
 * @returns {any|null}
 */
export function selecionarUltimoEventoDoPonto(ponto, eventos) {
  if (!ponto?.id || !Array.isArray(eventos)) return null;
  /** @type {any} */ let melhorValido = null;
  /** @type {string} */ let melhorDia = '';
  /** @type {any} */ let melhorInvalido = null;

  /** @param {any} candidato @param {any} atual */
  const criadoDepois = (candidato, atual) => {
    const tc = instanteCriacao(candidato);
    const ta = instanteCriacao(atual);
    return tc != null && (ta == null || tc > ta);
  };

  for (const evento of eventos) {
    if (!evento || String(evento.ponto_suplementacao_id) !== String(ponto.id)) continue;
    if (empresasDiferentes(ponto, evento)) continue;
    const dia = diaDoLancamento(evento.data_lancamento);
    if (dia == null) {
      if (!melhorInvalido || criadoDepois(evento, melhorInvalido)) melhorInvalido = evento;
      continue;
    }
    if (!melhorValido || dia > melhorDia || (dia === melhorDia && criadoDepois(evento, melhorValido))) {
      melhorValido = evento;
      melhorDia = dia;
    }
  }
  return melhorValido ?? melhorInvalido;
}

// ── Cocho ──────────────────────────────────────────────────────────────────

/**
 * Outros cochos ativos que atendem as mesmas áreas com o mesmo produto em
 * ciclo aberto (a taxa gravada em cada um conta o rebanho inteiro).
 * @param {any} ponto @param {any} ultimo @param {any[]} eventos @param {any[]} pontos
 * @returns {string[]}
 */
const cochosCompartilhando = (ponto, ultimo, eventos, pontos) => {
  const areas = new Set(areasDoPonto(ponto));
  if (!areas.size || !Array.isArray(pontos)) return [];
  /** @type {string[]} */
  const ids = [];
  for (const outro of pontos) {
    if (!outro?.id || String(outro.id) === String(ponto.id)) continue;
    if (!ehCocho(outro) || !ehAtivo(outro) || empresasDiferentes(ponto, outro)) continue;
    if (!areasDoPonto(outro).some((area) => areas.has(area))) continue;
    const eventoOutro = selecionarUltimoEventoDoPonto(outro, eventos);
    if (!eventoOutro || eventoOutro.dias_periodo != null) continue;
    if (empresasDiferentes(ultimo, eventoOutro)) continue;
    if (!mesmoProduto(ultimo, eventoOutro)) continue;
    ids.push(String(outro.id));
  }
  return ids;
};

/**
 * Nível do cocho no dia civil `hoje` (fuso da fazenda).
 *
 * O limite operacional é o configurado HOJE (`capacidade_cocho_kg` é mutável e
 * não tem histórico): mudar o cadastro muda o percentual de lançamentos antigos.
 *
 * @param {{ ponto: any, eventos?: any[], hoje: string, pontos?: any[] }} entrada
 *   `pontos`: todos os pontos de suplementação ativos (detecção de cochos
 *   compartilhando os mesmos animais). `eventos`: eventos da fazenda (todos os
 *   pontos — o compartilhamento olha o último evento dos outros cochos).
 * @returns {NivelCocho}
 */
export function calcularNivelCocho({ ponto, eventos = [], hoje, pontos = [] }) {
  const ultimo = selecionarUltimoEventoDoPonto(ponto, eventos);
  const limite = positivoOuNulo(ponto?.capacidade_cocho_kg);
  const hojeValido = ehDiaValido(hoje);

  /** @type {NivelCocho} */
  const n = {
    tipo: 'COCHO',
    pontoId: ponto?.id ?? null,
    hoje: hojeValido ? hoje : null,
    estado: 'sem_lancamento',
    confiabilidade: null,
    neutro: true,
    evento: ultimo,
    dataLancamento: null,
    produto: ultimo?.produto ?? null,
    produtoId: ultimo?.produto_id ?? null,
    fornecidoKg: null,
    sobraAnteriorKg: null,
    baseCicloKg: null,
    taxaConsumoKgDia: null,
    fonteConsumo: null,
    diasDecorridos: null,
    consumoEstimadoKg: null,
    saldoKg: null,
    saldoTipo: null,
    fracaoCiclo: null,
    diasRestantesEstimados: null,
    dataEsgotamentoEstimada: null,
    compartilhadoCom: [],
    limiteOperacionalKg: limite,
    ocupacaoNoLancamentoPercentual: null,
    excessoNoLancamentoKg: null,
    ocupacaoAtualPercentual: null,
    excessoAtualKg: null,
    fracaoLimiteSvg: null,
    mensagemLimite: limite == null ? MENSAGENS_NIVEL.limiteNaoConfigurado : null,
    fracaoParaSvg: 0,
    rotuloCurto: 'Sem lançamento',
    mensagem: MENSAGENS_NIVEL.semLancamento,
    motivo: null,
    descricao: MENSAGENS_NIVEL.semLancamento,
    alertas: [],
  };

  if (!ultimo) {
    n.alertas = [{ tipo: 'cocho_sem_lancamento', severidade: 'critico', titulo: 'Cocho sem lançamento', descricao: 'Não há lançamento de suplementação para este cocho.' }];
    return n;
  }

  const dia = diaDoLancamento(ultimo.data_lancamento);
  n.dataLancamento = dia ?? (typeof ultimo.data_lancamento === 'string' ? ultimo.data_lancamento : null);
  n.fornecidoKg = kgOuZero(ultimo.quantidade_total_kg);

  if (dia == null) {
    n.estado = 'data_invalida';
    n.rotuloCurto = 'Data inválida';
    n.mensagem = MENSAGENS_NIVEL.dataInvalida;
    n.descricao = n.mensagem;
    return n;
  }

  if (hojeValido && dia > hoje) {
    n.estado = 'lancamento_futuro';
    n.rotuloCurto = 'Lançamento futuro';
    n.mensagem = `Lançamento com data futura (${formatarDia(dia)}); a estimativa começa nessa data.`;
    n.descricao = n.mensagem;
    return n;
  }

  if (ultimo.dias_periodo != null) {
    // O fechamento sobrescreve `sobra_kg` com a sobra FINAL: a base se perdeu.
    n.estado = 'ciclo_fechado';
    n.saldoKg = kgOuZero(ultimo.sobra_kg);
    n.saldoTipo = 'informado';
    n.rotuloCurto = 'Período fechado';
    n.mensagem = `Período fechado; sobra informada de ${formatarKgNivel(n.saldoKg)}. Não há ciclo aberto.`;
    aplicarLimiteCocho(n);
    n.descricao = juntarFrases(n.mensagem, fraseLimiteCocho(n));
    n.alertas = alertaExcessoCocho(n);
    return n;
  }

  // ── Ciclo aberto ──
  n.estado = 'ciclo_aberto';
  n.sobraAnteriorKg = kgOuZero(ultimo.sobra_kg);
  const base = n.fornecidoKg + n.sobraAnteriorKg;
  n.baseCicloKg = base;
  const taxa = positivoOuNulo(ultimo.consumo_esperado_pv_kg);
  const compartilhados = taxa != null ? cochosCompartilhando(ponto, ultimo, eventos, pontos) : [];
  const dias = hojeValido ? diasEntre(dia, hoje) : null;

  if (taxa == null || dias == null) {
    n.confiabilidade = 'indisponivel';
    n.rotuloCurto = 'Sem estimativa';
    n.mensagem = MENSAGENS_NIVEL.estimativaIndisponivel;
    n.motivo = taxa == null ? MENSAGENS_NIVEL.motivoSemPv : MENSAGENS_NIVEL.motivoSemHoje;
  } else if (compartilhados.length) {
    n.confiabilidade = 'compartilhada';
    n.compartilhadoCom = compartilhados;
    n.rotuloCurto = 'Sem estimativa';
    n.mensagem = `Estimativa não confiável: ${compartilhados.length + 1} cochos com o mesmo produto atendem os mesmos animais e o consumo não é rateado entre eles.`;
    n.motivo = MENSAGENS_NIVEL.motivoCompartilhada;
  } else {
    const decorridos = Math.max(0, dias);
    n.confiabilidade = 'estimada';
    n.taxaConsumoKgDia = taxa;
    n.fonteConsumo = 'pv_no_lancamento';
    n.diasDecorridos = decorridos;
    n.consumoEstimadoKg = Math.min(base, taxa * decorridos);
    n.saldoKg = Math.max(0, base - taxa * decorridos);
    n.saldoTipo = 'estimado';
    n.diasRestantesEstimados = Math.max(0, base / taxa - decorridos);
    // Tolerância de ponto flutuante: 200/50 não pode virar 5 dias.
    n.dataEsgotamentoEstimada = somarDias(dia, Math.max(0, Math.ceil(base / taxa - 1e-9))) || null;
    if (base > 0) {
      n.fracaoCiclo = clamp01(n.saldoKg / base);
      n.neutro = false;
      n.fracaoParaSvg = quantizar(n.fracaoCiclo);
      n.rotuloCurto = `${Math.round(n.fracaoParaSvg * 100)}%`;
      n.mensagem = `Restante estimado: ${formatarKgNivel(n.saldoKg)} de ${formatarKgNivel(base)} (${formatarPercentualNivel(n.fracaoCiclo * 100)}).`;
    } else {
      n.rotuloCurto = 'Sem quantidade';
      n.mensagem = MENSAGENS_NIVEL.cicloSemQuantidade;
    }
  }

  aplicarLimiteCocho(n);
  const principal = n.motivo && n.confiabilidade === 'indisponivel' ? `${n.mensagem}: ${n.motivo}.` : n.mensagem;
  n.descricao = juntarFrases(principal, fraseLimiteCocho(n));

  /** @type {AlertaNivel[]} */
  const alertas = [];
  if (n.confiabilidade === 'estimada' && n.saldoKg != null && n.diasRestantesEstimados != null) {
    if (n.saldoKg <= 0) {
      alertas.push({ tipo: 'cocho_sem_produto', severidade: 'critico', titulo: 'Cocho sem produto', descricao: 'A cobertura estimada do cocho foi esgotada.' });
    } else if (n.diasRestantesEstimados <= 1) {
      alertas.push({ tipo: 'cocho_baixo', severidade: 'alerta', titulo: 'Reposição próxima', descricao: `Cobertura estimada restante: ${numeroPtBR(n.diasRestantesEstimados, 1)} dia(s).` });
    }
  }
  n.alertas = [...alertas, ...alertaExcessoCocho(n)];
  return n;
}

/** Preenche ocupação/excesso contra o limite operacional atual. @param {NivelCocho} n */
function aplicarLimiteCocho(n) {
  const limite = n.limiteOperacionalKg;
  if (limite == null) return;
  if (n.estado === 'ciclo_aberto' && n.baseCicloKg != null) {
    n.ocupacaoNoLancamentoPercentual = (n.baseCicloKg / limite) * 100;
    n.excessoNoLancamentoKg = Math.max(0, n.baseCicloKg - limite);
  }
  if (n.saldoKg != null) {
    n.ocupacaoAtualPercentual = (n.saldoKg / limite) * 100;
    n.excessoAtualKg = Math.max(0, n.saldoKg - limite);
    n.fracaoLimiteSvg = clamp01(n.ocupacaoAtualPercentual / 100);
  }
}

/** Frase curta de limite para o tooltip (ou null). @param {NivelCocho} n */
function fraseLimiteCocho(n) {
  const limite = n.limiteOperacionalKg;
  if (limite == null) return null;
  if (n.ocupacaoAtualPercentual != null) {
    const acima = n.excessoAtualKg ? ` (${formatarKgNivel(n.excessoAtualKg)} acima)` : '';
    return `Uso do limite operacional: ${formatarPercentualNivel(n.ocupacaoAtualPercentual)} de ${formatarKgNivel(limite)}${acima}.`;
  }
  if (n.ocupacaoNoLancamentoPercentual != null) {
    const acima = n.excessoNoLancamentoKg ? ` (${formatarKgNivel(n.excessoNoLancamentoKg)} acima)` : '';
    return `No lançamento: ${formatarPercentualNivel(n.ocupacaoNoLancamentoPercentual)} do limite operacional de ${formatarKgNivel(limite)}${acima}.`;
  }
  return null;
}

/** Alerta `cocho_acima_limite` (fornecimento ou sobra acima do limite). @param {NivelCocho} n @returns {AlertaNivel[]} */
function alertaExcessoCocho(n) {
  const titulo = 'Acima do limite operacional';
  if (n.excessoNoLancamentoKg != null && n.excessoNoLancamentoKg > 0 && n.ocupacaoNoLancamentoPercentual != null) {
    const agora = n.excessoAtualKg == null ? '.' : n.excessoAtualKg > 0 ? `; agora ${formatarKgNivel(n.excessoAtualKg)} acima.` : '; agora dentro do limite.';
    return [{
      tipo: 'cocho_acima_limite',
      severidade: 'alerta',
      titulo,
      descricao: `Fornecimento acima do limite operacional: ${formatarKgNivel(n.excessoNoLancamentoKg)} (${formatarPercentualNivel(n.ocupacaoNoLancamentoPercentual)}) no lançamento${agora}`,
    }];
  }
  if (n.excessoAtualKg != null && n.excessoAtualKg > 0 && n.ocupacaoAtualPercentual != null) {
    return [{
      tipo: 'cocho_acima_limite',
      severidade: 'alerta',
      titulo,
      descricao: `Sobra informada ${formatarKgNivel(n.excessoAtualKg)} acima do limite operacional (${formatarPercentualNivel(n.ocupacaoAtualPercentual)}).`,
    }];
  }
  return [];
}

/** @param {...(string|null)} frases */
const juntarFrases = (...frases) => frases.filter(Boolean).join(' ');

// ── Depósito ───────────────────────────────────────────────────────────────

/**
 * Nível do depósito: saldo em kg do local de estoque contra o limite
 * operacional configurado hoje; o mínimo só dispara a reposição.
 *
 * @param {{ deposito: any, estoqueLotes?: any[], produtos?: any[] }} entrada
 *   `estoqueLotes`: lotes de estoque (só os com `quantidade_disponivel > 0` do
 *   local contam). `produtos`: cadastro, para separar Produto em litros.
 * @returns {NivelDeposito}
 */
export function calcularNivelDeposito({ deposito, estoqueLotes = [], produtos = [] }) {
  const listaProdutos = Array.isArray(produtos) ? produtos.filter(Boolean) : [];
  const unidadePorProduto = new Map(listaProdutos.map((p) => [String(p.id), p.unidade_principal_estoque]));
  const local = deposito?.local_estoque_id;

  let saldoKg = 0;
  let lotesConsiderados = 0;
  let lotesEmLitrosIgnorados = 0;
  let unidadesConfirmadas = true;
  if (local != null && local !== '') {
    for (const lote of Array.isArray(estoqueLotes) ? estoqueLotes : []) {
      if (!lote || lote.local_estoque_id !== local) continue;
      const quantidade = numeroOuNulo(lote.quantidade_disponivel);
      if (quantidade == null || quantidade <= 0) continue;
      const chave = lote.produto_id != null ? String(lote.produto_id) : '';
      if (unidadePorProduto.get(chave) === 'L') {
        lotesEmLitrosIgnorados += 1;
        continue;
      }
      if (!unidadePorProduto.has(chave)) unidadesConfirmadas = false;
      saldoKg += quantidade;
      lotesConsiderados += 1;
    }
  }

  const limite = positivoOuNulo(deposito?.capacidade_cocho_kg);
  const minimo = positivoOuNulo(deposito?.estoque_minimo_kg);
  const ocupacaoPercentual = limite != null ? (saldoKg / limite) * 100 : null;
  const excessoKg = limite != null ? Math.max(0, saldoKg - limite) : null;
  const abaixoMinimo = minimo != null && saldoKg <= minimo;
  const margemMinimoKg = minimo != null ? saldoKg - minimo : null;

  /** @type {string} */
  let mensagemMinimo = MENSAGENS_NIVEL.minimoNaoConfigurado;
  if (minimo != null && margemMinimoKg != null) {
    if (margemMinimoKg < 0) mensagemMinimo = `Abaixo do mínimo de ${formatarKgNivel(minimo)} (faltam ${formatarKgNivel(-margemMinimoKg)}).`;
    else if (margemMinimoKg === 0) mensagemMinimo = `No mínimo de ${formatarKgNivel(minimo)}.`;
    else mensagemMinimo = `${formatarKgNivel(margemMinimoKg)} acima do mínimo de ${formatarKgNivel(minimo)}.`;
  }

  const principal = limite != null && ocupacaoPercentual != null
    ? `Saldo de ${formatarKgNivel(saldoKg)}: ${formatarPercentualNivel(ocupacaoPercentual)} do limite operacional de ${formatarKgNivel(limite)}${excessoKg ? ` (${formatarKgNivel(excessoKg)} acima)` : ''}.`
    : `Saldo de ${formatarKgNivel(saldoKg)}. ${MENSAGENS_NIVEL.limiteNaoConfiguradoDeposito}`;

  /** @type {AlertaNivel[]} */
  const alertas = [];
  if (saldoKg <= 0) {
    alertas.push({ tipo: 'deposito_sem_estoque', severidade: 'critico', titulo: 'Depósito sem produto', descricao: 'Não há saldo disponível no depósito.' });
  } else if (abaixoMinimo) {
    alertas.push({ tipo: 'deposito_estoque_minimo', severidade: 'alerta', titulo: 'Estoque mínimo atingido', descricao: `Saldo ${formatarKgNivel(saldoKg)} abaixo do mínimo configurado.` });
  }
  if (excessoKg != null && excessoKg > 0 && ocupacaoPercentual != null) {
    alertas.push({ tipo: 'deposito_acima_limite', severidade: 'alerta', titulo: 'Acima do limite operacional', descricao: `Saldo ${formatarKgNivel(excessoKg)} acima do limite operacional (${formatarPercentualNivel(ocupacaoPercentual)}).` });
  }

  return {
    tipo: 'DEPOSITO',
    pontoId: deposito?.id ?? null,
    saldoKg,
    lotesConsiderados,
    lotesEmLitrosIgnorados,
    unidadesConfirmadas,
    mensagemUnidade: unidadesConfirmadas ? null : MENSAGENS_NIVEL.unidadeNaoConfirmada,
    limiteOperacionalKg: limite,
    ocupacaoPercentual,
    excessoKg,
    fracaoParaSvg: limite != null ? quantizar(saldoKg / limite) : 0,
    neutro: limite == null,
    mensagemLimite: limite == null ? MENSAGENS_NIVEL.limiteNaoConfiguradoDeposito : null,
    estoqueMinimoKg: minimo,
    abaixoMinimo,
    margemMinimoKg,
    mensagemMinimo,
    necessidadeReposicaoKg: limite != null ? Math.max(limite - saldoKg, 0) : 0,
    rotuloCurto: ocupacaoPercentual != null ? `${Math.round(ocupacaoPercentual)}%` : 'Sem limite',
    descricao: juntarFrases(principal, abaixoMinimo ? mensagemMinimo : null),
    alertas,
  };
}
