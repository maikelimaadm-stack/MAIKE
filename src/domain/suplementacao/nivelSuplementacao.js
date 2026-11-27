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
 *  - Consumo por DIAS CIVIS: a data do abastecimento é a base, não o horário
 *    em que o registro foi digitado. No próprio dia, dias decorridos = 0;
 *    o primeiro consumo diário é descontado no dia seguinte. Um registro
 *    retroativo usa a data informada para estimar o saldo de hoje.
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
 *  - Critério de TEMPO do compartilhamento: um ciclo aberto só fecha quando
 *    chega um lançamento novo, então um cocho que parou de ser abastecido
 *    ficaria "aberto" para sempre. A janela de cada ciclo aberto é
 *    [lançamento, lançamento + ⌈base ÷ taxa⌉) — a duração MÍNIMA — mas só
 *    quando o cocho esteve SOZINHO com o rebanho nesse intervalo; se outro
 *    cocho das mesmas áreas teve ciclo do mesmo produto (aberto ou fechado)
 *    nesse intervalo, o fim é desconhecido e a janela fica aberta. Cochos com
 *    janelas que se cruzam formam um grupo (fecho transitivo, igual para todos
 *    os membros). Um ciclo desta classe que NÃO é o atual de um membro (fechado
 *    porque o gado saiu, trocado por outro produto) e cruza a janela também
 *    torna a estimativa não confiável. Ver `calcularCompartilhamentoDaClasse`.
 *  - Compartilhados e sem lançamento novo: quando nem a soma das bases do
 *    grupo, consumida pela menor taxa do grupo a partir do último lançamento,
 *    ainda teria produto, o aviso crítico `cocho_sem_produto` continua (o
 *    ícone segue neutro: não há saldo de cada cocho).
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
 * @property {number|null} taxaRegistradaKgDia    taxa do rebanho gravada no lançamento do ciclo aberto (qualquer confiabilidade); para a cobertura do depósito, NUNCA para estimar o saldo do cocho
 * @property {{ evento: any, taxaKgDia: number, dia: string }[]} consumosParaDeposito ciclos que puxam do depósito (o vigente e, se houver, o futuro), cada um com o próprio produto
 * @property {'pv_no_lancamento'|null} fonteConsumo
 * @property {number|null} diasDecorridos         dias civis desde o lançamento
 * @property {number|null} consumoEstimadoKg      min(base, taxa × dias)
 * @property {number|null} saldoKg               estimado (aberto) ou informado (fechado)
 * @property {'estimado'|'informado'|null} saldoTipo
 * @property {number|null} fracaoCiclo           saldo ÷ base, 0..1
 * @property {number|null} diasRestantesEstimados sem arredondar (arredondar só na UI)
 * @property {number|null} duracaoCicloEstimadaDias base ÷ taxa, sem arredondar (só estimada e base > 0)
 * @property {string|null} dataEsgotamentoEstimada AAAA-MM-DD
 * @property {string[]} compartilhadoCom          ids dos outros cochos com o mesmo produto e animais (janelas que se cruzam)
 * @property {string|null} dataEsgotamentoConjuntoEstimada AAAA-MM-DD; só compartilhada: último lançamento do grupo + Σ bases ÷ menor taxa
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
 * @property {number} lotesForaDoKgIgnorados  D-PROD-369: lotes de produto com estoque noutra unidade (SC, UN...)
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
  // D-PROD-201: o produto tinha %PV, mas nenhum lote do pasto tinha peso.
  motivoSemPeso: 'os lotes do pasto não tinham peso no lançamento',
  motivoSemHoje: 'o dia de referência não foi informado',
  motivoCompartilhada: 'o consumo não é rateado entre cochos que atendem os mesmos animais',
  cicloSemQuantidade: 'Ciclo sem quantidade fornecida.',
  limiteNaoConfigurado: 'Limite operacional não configurado.',
  limiteNaoConfiguradoDeposito: 'Limite operacional não configurado; não há percentual.',
  minimoNaoConfigurado: 'Estoque mínimo não configurado.',
  unidadeNaoConfirmada: 'Unidade de alguns produtos não confirmada; o saldo em kg pode incluir itens de outra unidade.',
  // Próximo passo nos estados neutros (detalhes do cocho e do depósito).
  orientacaoLimite: 'Configure o limite operacional no cadastro do ponto.',
  orientacaoSemPv: 'Cadastre o %PV do produto; a estimativa volta no próximo lançamento.',
  orientacaoSemPeso: 'Registre uma pesagem dos lotes; a estimativa volta no próximo lançamento.',
  orientacaoCompartilhada: 'A estimativa volta quando só um cocho com este produto atender estes animais.',
});

/**
 * D-PROD-201 — por que o lançamento ficou sem taxa: com %PV gravado (> 0) e sem
 * peso dos lotes, o motivo é o PESO (antes a tela dizia "Cadastre o %PV").
 * @param {any} evento
 */
const motivoSemTaxa = (evento) => {
  const pv = Number(evento?.percentual_consumo_pv_usado);
  const peso = Number(evento?.peso_medio_lotes_kg);
  return Number.isFinite(pv) && pv > 0 && !(Number.isFinite(peso) && peso > 0) ? MENSAGENS_NIVEL.motivoSemPeso : MENSAGENS_NIVEL.motivoSemPv;
};

/**
 * Textos do medidor de uso do limite operacional (cocho e depósito), no mesmo
 * padrão: linha visível "600 kg de 300 kg · 300 kg acima do limite" e o texto
 * acessível "200% do limite operacional: 600 kg de 300 kg, 300 kg acima".
 * @param {{ percentual: number, saldoKg: number, limiteKg: number, excessoKg?: number|null }} uso
 * @returns {{ descricao: string, textoAcessivel: string }}
 */
export function descreverUsoDoLimite({ percentual, saldoKg, limiteKg, excessoKg }) {
  const kg = `${formatarKgNivel(saldoKg)} de ${formatarKgNivel(limiteKg)}`;
  const acima = excessoKg != null && excessoKg > 0 ? formatarKgNivel(excessoKg) : null;
  return {
    descricao: `${kg} · ${acima ? `${acima} acima do limite` : 'dentro do limite'}`,
    textoAcessivel: `${formatarPercentualNivel(percentual)} do limite operacional: ${kg}, ${acima ? `${acima} acima` : 'dentro do limite'}`,
  };
}

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
 * Ciclos longos demais (taxa absurda, dado corrompido) não ganham data: a
 * conta de datas não é feita e a janela fica sem fim conhecido.
 */
const LIMITE_DIAS_CICLO = 36500;

/**
 * Fim (exclusivo) da janela MÍNIMA de um ciclo: lançamento + ⌈base ÷ taxa⌉.
 * `null` = sem fim conhecido (sem taxa ou ciclo longo demais).
 * @param {string} dia @param {number} base @param {number|null} taxa
 * @returns {string|null}
 */
const fimMinimoDoCiclo = (dia, base, taxa) => {
  if (taxa == null || !(taxa > 0)) return null;
  const dias = Math.max(0, Math.ceil(base / taxa - 1e-9));
  if (!Number.isFinite(dias) || dias > LIMITE_DIAS_CICLO) return null;
  return somarDias(dia, dias) || null;
};

/** Intervalos [ini, fim) de dias; `fim` null = sem fim. @param {{ini: string, fim: string|null}} a @param {{ini: string, fim: string|null}} b */
const intervalosSeCruzam = (a, b) => {
  // Intervalo vazio (ciclo de base 0, período de 0 dia) não divide nada.
  if ((a.fim != null && a.fim <= a.ini) || (b.fim != null && b.fim <= b.ini)) return false;
  return (b.fim == null || a.ini < b.fim) && (a.fim == null || b.ini < a.fim);
};

/**
 * Classes de produto: fecho transitivo de "mesmo produto" sobre todos os
 * eventos — mesmo `produto_id`; ou, quando um dos lados não tem id (legado),
 * mesmo nome normalizado. Um evento legado sem id junta as classes dos ids com
 * o mesmo nome: erra para o lado de "mesmo produto" (estimativa neutra), nunca
 * para número falso. Sem id e sem nome → `null` (não compartilha).
 * @param {any[]} eventos
 * @returns {(evento: any) => string|null}
 */
function montarClassesDeProduto(eventos) {
  /** @type {Map<string, string>} */
  const pai = new Map();
  const no = (/** @type {string} */ x) => { if (!pai.has(x)) pai.set(x, x); return x; };
  const achar = (/** @type {string} */ x) => {
    let raiz = no(x);
    while (pai.get(raiz) !== raiz) raiz = /** @type {string} */ (pai.get(raiz));
    let atual = x;
    while (pai.get(atual) !== raiz) { const proximo = /** @type {string} */ (pai.get(atual)); pai.set(atual, raiz); atual = proximo; }
    return raiz;
  };
  const nomesSemId = new Set();
  for (const evento of eventos) {
    if (!evento || evento.produto_id) continue;
    const nome = normalizarTexto(evento.produto ?? '');
    if (nome) nomesSemId.add(nome);
  }
  for (const evento of eventos) {
    if (!evento?.produto_id) continue;
    const nome = normalizarTexto(evento.produto ?? '');
    const raizId = achar(`id:${evento.produto_id}`);
    if (nome && nomesSemId.has(nome)) {
      const raizNome = achar(`nome:${nome}`);
      if (raizId !== raizNome) pai.set(raizId, raizNome);
    }
  }
  return (evento) => {
    if (evento?.produto_id) return achar(`id:${evento.produto_id}`);
    const nome = normalizarTexto(evento?.produto ?? '');
    return nome ? achar(`nome:${nome}`) : null;
  };
}

/**
 * @typedef {{ ini: string, fim: string|null, classe: string|null, evento: any }} CicloRegistrado
 * @typedef {{ id: string, ponto: any, areas: Set<string>, ciclos: CicloRegistrado[], atual: any|null, diaAtual: string|null }} CochoDoContexto
 * @typedef {{ compartilhadoCom: string[], conjunto: string|null }} CompartilhamentoDoCocho
 * @typedef {{
 *   classe: (evento: any) => string|null,
 *   cochos: Map<string, CochoDoContexto>,
 *   porArea: Map<string, string[]>,
 *   registrar: (ponto: any) => CochoDoContexto,
 *   grupos: Map<string, Map<string, CompartilhamentoDoCocho>>,
 * }} ContextoDosCochos
 */

/** Lista sem os excluídos, em cache pela identidade do array recebido (mantém os caches abaixo valendo entre cochos). */
const EVENTOS_SEM_EXCLUIDOS = new WeakMap();

/**
 * Eventos sem os EXCLUÍDOS (`situacao === 'cancelado'` no servidor). Devolve o
 * MESMO array quando não há excluído, e sempre o mesmo array filtrado para o
 * mesmo array de entrada, para os índices por identidade continuarem valendo.
 * Exportado para que toda leitura de lançamentos do mapa (alertas do lote, aba
 * Suplementação do pasto) possa usar a MESMA lista que o nível do cocho.
 * @param {any} eventos @returns {any[]}
 */
export function semExcluidos(eventos) {
  if (!Array.isArray(eventos)) return [];
  const emCache = EVENTOS_SEM_EXCLUIDOS.get(eventos);
  if (emCache) return emCache;
  const filtrados = eventos.some((evento) => evento?.situacao === 'cancelado')
    ? eventos.filter((evento) => evento?.situacao !== 'cancelado')
    : eventos;
  EVENTOS_SEM_EXCLUIDOS.set(eventos, filtrados);
  return filtrados;
}

/** Eventos agrupados por ponto, em cache pela identidade do array (o mapa calcula todos os cochos com o mesmo). */
const EVENTOS_POR_PONTO = new WeakMap();

/** Eventos do ponto, sem varrer o array inteiro a cada cocho. @param {any} ponto @param {any[]} eventos @returns {any[]} */
function eventosDoPonto(ponto, eventos) {
  if (!ponto?.id || !Array.isArray(eventos)) return [];
  let indice = EVENTOS_POR_PONTO.get(eventos);
  if (!indice) {
    indice = new Map();
    for (const evento of eventos) {
      if (!evento?.ponto_suplementacao_id) continue;
      const chave = String(evento.ponto_suplementacao_id);
      const lista = indice.get(chave);
      if (lista) lista.push(evento); else indice.set(chave, [evento]);
    }
    EVENTOS_POR_PONTO.set(eventos, indice);
  }
  return indice.get(String(ponto.id)) || [];
}

/** Contextos por (eventos, pontos, hoje): o mapa calcula todos os cochos com os MESMOS arrays. */
const CONTEXTOS = new WeakMap();

/**
 * Índice da fazenda para o compartilhamento, montado UMA vez por (eventos,
 * pontos, hoje) e reaproveitado por todos os cochos: ciclos de cada cocho,
 * último lançamento não futuro, classes de produto e vizinhos por área.
 * @param {any[]} eventos @param {any[]} pontos @param {string|null} hoje
 * @returns {ContextoDosCochos}
 */
function contextoDosCochos(eventos, pontos, hoje) {
  let porPontos = CONTEXTOS.get(eventos);
  if (!porPontos) { porPontos = new WeakMap(); CONTEXTOS.set(eventos, porPontos); }
  let porHoje = porPontos.get(pontos);
  if (!porHoje) { porHoje = new Map(); porPontos.set(pontos, porHoje); }
  const chave = hoje ?? '';
  let contexto = porHoje.get(chave);
  if (!contexto) { contexto = montarContextoDosCochos(eventos, pontos, hoje); porHoje.set(chave, contexto); }
  return contexto;
}

/** @param {any[]} eventos @param {any[]} pontos @param {string|null} hoje @returns {ContextoDosCochos} */
function montarContextoDosCochos(eventos, pontos, hoje) {
  const classe = montarClassesDeProduto(eventos);
  /** @type {Map<string, any[]>} */
  const eventosPorPonto = new Map();
  for (const evento of eventos) {
    if (!evento?.ponto_suplementacao_id) continue;
    const chave = String(evento.ponto_suplementacao_id);
    const lista = eventosPorPonto.get(chave);
    if (lista) lista.push(evento); else eventosPorPonto.set(chave, [evento]);
  }
  const naoFuturo = (/** @type {string} */ dia) => hoje == null || dia <= hoje;

  /** @param {any} ponto @returns {CochoDoContexto} */
  const registrar = (ponto) => {
    const id = String(ponto.id);
    const validos = (eventosPorPonto.get(id) || [])
      .filter((evento) => !empresasDiferentes(ponto, evento))
      .map((evento) => ({ evento, dia: diaDoLancamento(evento.data_lancamento) }))
      .filter((item) => item.dia != null)
      .sort((a, b) => (/** @type {string} */ (a.dia) < /** @type {string} */ (b.dia) ? -1 : a.dia === b.dia ? 0 : 1));
    // Ciclo atual: o último lançamento NÃO futuro (mesma escolha de `selecionarUltimoEventoDoPonto`).
    const atual = selecionarUltimoEventoDoPonto(ponto, validos.filter((item) => naoFuturo(/** @type {string} */ (item.dia))).map((item) => item.evento));
    /** @type {CicloRegistrado[]} */
    const ciclos = [];
    for (let indice = 0; indice < validos.length; indice += 1) {
      const { evento } = validos[indice];
      const ini = /** @type {string} */ (validos[indice].dia);
      if (!naoFuturo(ini)) continue;
      /** @type {string|null} */
      let fim = null;
      if (evento.dias_periodo != null) {
        // Fechado: o período registrado.
        const diasPeriodo = numeroOuNulo(evento.dias_periodo);
        fim = diasPeriodo != null && diasPeriodo >= 0 && diasPeriodo <= LIMITE_DIAS_CICLO ? somarDias(ini, Math.ceil(diasPeriodo)) || null : null;
      } else if (evento !== atual) {
        // Aberto e substituído: até o lançamento seguinte do mesmo cocho (mesmo
        // futuro). Irmão do MESMO dia do ciclo atual (lançamento duplicado que
        // ficou aberto) faz parte dele: intervalo vazio, nunca ciclo sem fim.
        fim = ini;
        for (let seguinte = indice + 1; seguinte < validos.length; seguinte += 1) {
          if (/** @type {string} */ (validos[seguinte].dia) > ini) { fim = /** @type {string} */ (validos[seguinte].dia); break; }
        }
        if (atual && diaDoLancamento(atual.data_lancamento) === ini) fim = ini;
      }
      ciclos.push({ ini, fim, classe: classe(evento), evento });
    }
    return { id, ponto, areas: new Set(areasDoPonto(ponto)), ciclos, atual, diaAtual: atual ? diaDoLancamento(atual.data_lancamento) : null };
  };

  /** @type {Map<string, CochoDoContexto>} */
  const cochos = new Map();
  for (const ponto of pontos) {
    if (!ponto?.id || cochos.has(String(ponto.id)) || !ehCocho(ponto) || !ehAtivo(ponto)) continue;
    cochos.set(String(ponto.id), registrar(ponto));
  }
  /** @type {Map<string, string[]>} */
  const porArea = new Map();
  for (const cocho of cochos.values()) {
    for (const area of cocho.areas) {
      const lista = porArea.get(area);
      if (lista) lista.push(cocho.id); else porArea.set(area, [cocho.id]);
    }
  }
  return { classe, cochos, porArea, registrar, grupos: new Map() };
}

/**
 * Compartilhamento de todos os cochos de uma classe de produto (D-PROD-178 §4).
 * A taxa gravada em cada lançamento é a do rebanho inteiro e não há rateio, então:
 *  - membros: cochos cujo último lançamento NÃO FUTURO é um ciclo ABERTO desta
 *    classe;
 *  - janela de um membro: [lançamento, lançamento + ⌈base ÷ taxa⌉) — a duração
 *    MÍNIMA (sem taxa, a menor taxa dos membros) — enquanto ele esteve SOZINHO
 *    com o rebanho nesse intervalo. Ela ABRE (fim desconhecido) se cruzar um
 *    ciclo desta classe de outro cocho das mesmas áreas que não seja o ciclo
 *    atual de um membro (fechado porque o gado saiu, substituído, de outro
 *    produto depois, encerrado por lançamento futuro) ou a JANELA de outro
 *    membro. Ponto fixo: começa com todas fechadas e só abre; um membro que se
 *    esgotou sozinho mantém a janela fechada e não contamina ninguém;
 *  - dois membros com áreas em comum e janelas que se cruzam dividem os
 *    animais (grupo = fecho transitivo, igual para todos); um membro cuja
 *    janela mínima cruza um ciclo externo também dividiu o rebanho;
 *  - conjunto: a partir do mais tarde entre o último lançamento do grupo e o
 *    fim dos ciclos externos que cruzam as janelas efetivas do grupo, a soma
 *    das bases pela menor taxa — limite superior do esgotamento (antes disso o
 *    produto só diminui). Ciclo externo sem fim → sem data.
 * @param {ContextoDosCochos} contexto @param {Map<string, CochoDoContexto>} cochos
 * @param {string} classeAlvo @param {any} pontoRef
 * @returns {Map<string, CompartilhamentoDoCocho>}
 */
function calcularCompartilhamentoDaClasse(contexto, cochos, classeAlvo, pontoRef) {
  const membros = [...cochos.values()].filter((cocho) => (
    cocho.atual
    && cocho.atual.dias_periodo == null
    && cocho.diaAtual != null
    && contexto.classe(cocho.atual) === classeAlvo
    && !empresasDiferentes(pontoRef, cocho.ponto)
    && !empresasDiferentes(pontoRef, cocho.atual)
  ));
  const porId = new Map(membros.map((membro) => [membro.id, membro]));

  /** Vizinhos (mesma fazenda, área em comum). @param {CochoDoContexto} cocho @returns {CochoDoContexto[]} */
  const vizinhos = (cocho) => {
    const ids = new Set();
    for (const area of cocho.areas) for (const id of contexto.porArea.get(area) || []) if (id !== cocho.id) ids.add(id);
    // Cocho fora do índice (registrado à parte) também enxerga quem tem área em comum.
    for (const outro of cochos.values()) if (outro.id !== cocho.id && !ids.has(outro.id) && [...outro.areas].some((area) => cocho.areas.has(area))) ids.add(outro.id);
    /** @type {CochoDoContexto[]} */
    const lista = [];
    for (const id of ids) {
      const outro = cochos.get(id);
      if (outro && !empresasDiferentes(pontoRef, outro.ponto)) lista.push(outro);
    }
    return lista;
  };
  /** @type {Map<string, { lista: CicloRegistrado[], maiorFimAte: (string|null)[] }>} */
  const externosPorCocho = new Map();
  /**
   * Ciclos desta classe que NÃO são o ciclo atual de um membro, em ordem de
   * início, com o maior fim até cada posição (null = sem fim) — calculados uma
   * vez por cocho, para parar de voltar no histórico assim que nada mais cruza.
   * @param {CochoDoContexto} cocho
   */
  const ciclosExternos = (cocho) => {
    let registro = externosPorCocho.get(cocho.id);
    if (!registro) {
      const lista = cocho.ciclos.filter((ciclo) => ciclo.classe === classeAlvo && !(porId.has(cocho.id) && ciclo.evento === cocho.atual));
      /** @type {(string|null)[]} */
      const maiorFimAte = [];
      /** @type {string|null|undefined} */
      let maior;
      for (const ciclo of lista) {
        maior = maior === null || ciclo.fim == null ? null : (maior === undefined || ciclo.fim > maior ? ciclo.fim : maior);
        maiorFimAte.push(maior);
      }
      registro = { lista, maiorFimAte };
      externosPorCocho.set(cocho.id, registro);
    }
    return registro;
  };

  /** @typedef {{ id: string, fim: string|null, sobraDisponivel: number }} CicloExterno */
  /** @type {Map<string, { ini: string, fimMinimo: string|null, aberta: boolean, base: number, taxa: number|null, vizinhos: CochoDoContexto[], externosMinimos: CicloExterno[], externosAbertos: CicloExterno[] }>} */
  const dados = new Map();
  for (const membro of membros) {
    const base = kgOuZero(membro.atual.quantidade_total_kg) + kgOuZero(membro.atual.sobra_kg);
    const ini = /** @type {string} */ (membro.diaAtual);
    const doMembro = vizinhos(membro);
    // Sem taxa gravada: a menor taxa dos membros que dividem área com ele (o
    // mesmo rebanho), nunca a de outro pasto; sem nenhuma, a janela fica aberta.
    let taxa = positivoOuNulo(membro.atual.consumo_esperado_pv_kg);
    if (taxa == null) {
      for (const outro of doMembro) {
        const taxaOutro = porId.has(outro.id) ? positivoOuNulo(outro.atual.consumo_esperado_pv_kg) : null;
        if (taxaOutro != null && (taxa == null || taxaOutro < taxa)) taxa = taxaOutro;
      }
    }
    const fimMinimo = fimMinimoDoCiclo(ini, base, taxa);
    const minima = { ini, fim: fimMinimo };
    const externosMinimos = [];
    const externosAbertos = [];
    const aPartirDoLancamento = { ini, fim: null };
    for (const outro of doMembro) {
      const { lista, maiorFimAte } = ciclosExternos(outro);
      // Do mais novo para trás; para quando nenhum ciclo anterior termina depois deste lançamento.
      for (let k = lista.length - 1; k >= 0; k -= 1) {
        const maiorFim = maiorFimAte[k];
        if (maiorFim != null && maiorFim <= ini) break;
        const ciclo = lista[k];
        if (!intervalosSeCruzam(ciclo, aPartirDoLancamento)) continue;
        // Fechado e último lançamento do cocho: a sobra informada continua lá, ao alcance do rebanho.
        const sobraDisponivel = ciclo.evento.dias_periodo != null && ciclo.evento === outro.atual ? kgOuZero(ciclo.evento.sobra_kg) : 0;
        const externo = { id: outro.id, fim: ciclo.fim, sobraDisponivel };
        externosAbertos.push(externo);
        if (intervalosSeCruzam(ciclo, minima)) externosMinimos.push(externo);
      }
    }
    // Janela vazia (base 0) não divide nada; sem fim (taxa absurda) já começa aberta.
    dados.set(membro.id, { ini, fimMinimo, aberta: fimMinimo == null || externosMinimos.length > 0, base, taxa, vizinhos: doMembro, externosMinimos, externosAbertos });
  }
  const efetiva = (/** @type {string} */ id) => { const d = /** @type {any} */ (dados.get(id)); return { ini: d.ini, fim: d.aberta ? null : d.fimMinimo }; };
  const minimaDe = (/** @type {string} */ id) => { const d = /** @type {any} */ (dados.get(id)); return { ini: d.ini, fim: d.fimMinimo }; };

  // Ponto fixo: abre a janela de quem cruza a janela efetiva de outro membro.
  const fila = [...membros.map((membro) => membro.id)];
  while (fila.length) {
    const id = /** @type {string} */ (fila.shift());
    const d = /** @type {any} */ (dados.get(id));
    for (const outro of d.vizinhos) {
      if (!porId.has(outro.id)) continue;
      const o = /** @type {any} */ (dados.get(outro.id));
      // id → outro: a janela efetiva de `id` abre a de `outro`, e vice-versa.
      if (!o.aberta && intervalosSeCruzam(efetiva(id), minimaDe(outro.id))) { o.aberta = true; fila.push(outro.id); }
      if (!d.aberta && intervalosSeCruzam(efetiva(outro.id), minimaDe(id))) { d.aberta = true; fila.push(id); }
    }
  }

  /** @type {Map<string, CompartilhamentoDoCocho>} */
  const resultado = new Map();
  const visitados = new Set();
  for (const inicio of membros) {
    if (visitados.has(inicio.id)) continue;
    const componente = [inicio];
    visitados.add(inicio.id);
    for (let k = 0; k < componente.length; k += 1) {
      const atual = componente[k];
      for (const outro of /** @type {any} */ (dados.get(atual.id)).vizinhos) {
        if (!porId.has(outro.id) || visitados.has(outro.id)) continue;
        if (!intervalosSeCruzam(efetiva(atual.id), efetiva(outro.id))) continue;
        visitados.add(outro.id);
        componente.push(/** @type {CochoDoContexto} */ (porId.get(outro.id)));
      }
    }
    const donosExternos = new Set();
    let inicioConjunto = '';
    let totalBase = 0;
    /** @type {number|null} */
    let menorTaxa = null;
    let semFimExterno = false;
    /** @type {Map<string, number>} sobra que ficou em cochos fechados, uma vez por cocho */
    const sobras = new Map();
    for (const membro of componente) {
      const d = /** @type {any} */ (dados.get(membro.id));
      if (d.ini > inicioConjunto) inicioConjunto = d.ini;
      totalBase += d.base;
      if (d.taxa != null && (menorTaxa == null || d.taxa < menorTaxa)) menorTaxa = d.taxa;
      for (const externo of d.externosMinimos) donosExternos.add(externo.id);
      // O conjunto só sai depois de todo ciclo externo que cruzou a janela efetiva.
      for (const externo of d.aberta ? d.externosAbertos : d.externosMinimos) {
        if (externo.fim == null) semFimExterno = true;
        else if (externo.fim > inicioConjunto) inicioConjunto = externo.fim;
        if (externo.sobraDisponivel > 0) sobras.set(externo.id, Math.max(sobras.get(externo.id) ?? 0, externo.sobraDisponivel));
      }
    }
    for (const sobra of sobras.values()) totalBase += sobra;
    const conjunto = semFimExterno ? null : fimMinimoDoCiclo(inicioConjunto, totalBase, menorTaxa);
    for (const membro of componente) {
      const outros = new Set([...componente.map((c) => c.id), ...donosExternos]);
      outros.delete(membro.id);
      resultado.set(membro.id, { compartilhadoCom: [...outros], conjunto: outros.size ? conjunto : null });
    }
  }
  return resultado;
}

/**
 * Com quem este cocho divide os animais (vazio = sozinho) e a data-limite do
 * conjunto. Usa o índice da fazenda em cache.
 * @param {any} ponto @param {any} ultimo @param {any[]} eventos @param {any[]} pontos @param {string|null} hoje
 * @returns {CompartilhamentoDoCocho}
 */
const compartilhamentoDoCocho = (ponto, ultimo, eventos, pontos, hoje) => {
  const vazio = { compartilhadoCom: [], conjunto: null };
  if (!ponto?.id || !areasDoPonto(ponto).length || !Array.isArray(pontos) || !Array.isArray(eventos)) return vazio;
  const contexto = contextoDosCochos(eventos, pontos, hoje);
  const classeAlvo = contexto.classe(ultimo);
  if (classeAlvo == null) return vazio;
  const id = String(ponto.id);
  if (contexto.cochos.has(id)) {
    const chave = `${classeAlvo}|${ponto.empresa_id ?? ''}`;
    let grupo = contexto.grupos.get(chave);
    if (!grupo) { grupo = calcularCompartilhamentoDaClasse(contexto, contexto.cochos, classeAlvo, ponto); contexto.grupos.set(chave, grupo); }
    return grupo.get(id) ?? vazio;
  }
  // Cocho fora da lista de ativos (ex.: detalhe de um inativo): conta sem cache.
  const cochos = new Map(contexto.cochos);
  cochos.set(id, contexto.registrar(ponto));
  return calcularCompartilhamentoDaClasse(contexto, cochos, classeAlvo, ponto).get(id) ?? vazio;
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
export function calcularNivelCocho({ ponto, eventos: eventosRecebidos = [], hoje, pontos = [] }) {
  // Lançamento EXCLUÍDO (situacao "cancelado" no servidor, inclusive os antigos
  // do mecanismo R2A/D-PROD-99) não conta para nada: nem para o último evento,
  // nem para o compartilhamento. O servidor já não lista; isto é defesa contra
  // uma cópia antiga guardada no aparelho — marcador, alertas e detalhe contam igual.
  const eventos = semExcluidos(eventosRecebidos);
  const doPonto = eventosDoPonto(ponto, eventos);
  let ultimo = selecionarUltimoEventoDoPonto(ponto, doPonto);
  // Um lançamento com data inválida criado DEPOIS do último válido: o ciclo
  // antigo não vale mais e a data do novo é desconhecida → estado neutro.
  const criadoUltimo = instanteCriacao(ultimo);
  if (ultimo && criadoUltimo != null && diaDoLancamento(ultimo.data_lancamento) != null) {
    for (const evento of doPonto) {
      if (empresasDiferentes(ponto, evento) || diaDoLancamento(evento.data_lancamento) != null) continue;
      const criado = instanteCriacao(evento);
      if (criado != null && criado > criadoUltimo && (instanteCriacao(ultimo) ?? -Infinity) < criado) ultimo = evento;
    }
  }
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
    taxaRegistradaKgDia: null,
    consumosParaDeposito: [],
    fonteConsumo: null,
    diasDecorridos: null,
    consumoEstimadoKg: null,
    saldoKg: null,
    saldoTipo: null,
    fracaoCiclo: null,
    diasRestantesEstimados: null,
    duracaoCicloEstimadaDias: null,
    dataEsgotamentoEstimada: null,
    compartilhadoCom: [],
    dataEsgotamentoConjuntoEstimada: null,
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
    // Cobertura do depósito: o rebanho continua comendo do ciclo que vale hoje;
    // vale a MAIOR entre a taxa do último lançamento não futuro e a do futuro.
    {
      const naoFuturos = hojeValido ? doPonto.filter((evento) => { const d = diaDoLancamento(evento.data_lancamento); return d != null && d <= hoje; }) : [];
      const vigente = selecionarUltimoEventoDoPonto(ponto, naoFuturos);
      const taxaFutura = positivoOuNulo(ultimo.consumo_esperado_pv_kg);
      const taxaVigente = positivoOuNulo(vigente?.consumo_esperado_pv_kg);
      const taxas = [taxaFutura, taxaVigente].filter((taxa) => taxa != null);
      n.taxaRegistradaKgDia = taxas.length ? Math.max(.../** @type {number[]} */ (taxas)) : null;
      // Cada ciclo com o próprio produto (o futuro pode ser de outro produto).
      n.consumosParaDeposito = [
        ...(vigente && taxaVigente != null ? [{ evento: vigente, taxaKgDia: taxaVigente, dia: /** @type {string} */ (diaDoLancamento(vigente.data_lancamento)) }] : []),
        ...(taxaFutura != null ? [{ evento: ultimo, taxaKgDia: taxaFutura, dia: /** @type {string} */ (hoje) }] : []),
      ];
    }
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
  n.taxaRegistradaKgDia = taxa;
  n.consumosParaDeposito = taxa != null ? [{ evento: ultimo, taxaKgDia: taxa, dia }] : [];
  const ciclo = taxa != null ? { dia, base, taxa } : null;
  const compartilhamento = ciclo ? compartilhamentoDoCocho(ponto, ultimo, eventos, pontos, hojeValido ? hoje : null) : { compartilhadoCom: [], conjunto: null };
  const dias = hojeValido ? diasEntre(dia, hoje) : null;

  if (taxa == null || dias == null) {
    n.confiabilidade = 'indisponivel';
    n.rotuloCurto = 'Sem estimativa';
    n.mensagem = MENSAGENS_NIVEL.estimativaIndisponivel;
    n.motivo = taxa == null ? motivoSemTaxa(ultimo) : MENSAGENS_NIVEL.motivoSemHoje;
  } else if (compartilhamento.compartilhadoCom.length) {
    n.confiabilidade = 'compartilhada';
    n.compartilhadoCom = compartilhamento.compartilhadoCom;
    n.dataEsgotamentoConjuntoEstimada = compartilhamento.conjunto;
    n.rotuloCurto = 'Sem estimativa';
    n.mensagem = `Estimativa não confiável: ${n.compartilhadoCom.length + 1} cochos com o mesmo produto atendem os mesmos animais e o consumo não é rateado entre eles.`;
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
    // Tolerância de ponto flutuante: 200/50 não pode virar 5 dias. Ciclo longo
    // demais (taxa absurda) fica sem data.
    n.dataEsgotamentoEstimada = fimMinimoDoCiclo(dia, base, taxa);
    if (base > 0) {
      n.duracaoCicloEstimadaDias = base / taxa;
      n.fracaoCiclo = clamp01(n.saldoKg / base);
      n.neutro = false;
      n.fracaoParaSvg = quantizar(n.fracaoCiclo);
      n.rotuloCurto = `${Math.round(n.fracaoParaSvg * 100)}%`;
      // Mesmo percentual do ícone e do rótulo (quantizado em 1%).
      n.mensagem = `Restante estimado: ${formatarKgNivel(n.saldoKg)} de ${formatarKgNivel(base)} (${n.rotuloCurto}).`;
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
  const avisoConfigurado = numeroOuNulo(ponto?.dias_alerta_reposicao);
  const diasAviso = avisoConfigurado != null && avisoConfigurado >= 0 ? Math.floor(avisoConfigurado) : 1;
  if (n.confiabilidade === 'estimada' && n.saldoKg != null && n.diasRestantesEstimados != null) {
    if (n.saldoKg <= 0) {
      alertas.push({ tipo: 'cocho_sem_produto', severidade: 'critico', titulo: 'Cocho sem produto', descricao: 'A cobertura estimada do cocho foi esgotada.' });
    } else if (n.diasRestantesEstimados <= diasAviso) {
      alertas.push({ tipo: 'cocho_baixo', severidade: 'alerta', titulo: 'Reposição próxima', descricao: `Cobertura estimada restante: ${numeroPtBR(n.diasRestantesEstimados, 1)} dia(s).` });
    }
  }
  // Compartilhado sem lançamento novo: nem a soma do grupo teria produto.
  if (n.confiabilidade === 'compartilhada' && hojeValido && n.dataEsgotamentoConjuntoEstimada && hoje >= n.dataEsgotamentoConjuntoEstimada) {
    alertas.push({ tipo: 'cocho_sem_produto', severidade: 'critico', titulo: 'Cocho sem produto', descricao: `A cobertura estimada dos ${n.compartilhadoCom.length + 1} cochos que atendem estes animais foi esgotada.` });
  }
  n.alertas = [...alertas, ...alertaExcessoCocho(n)];
  return n;
}

// ── Cartão do lançamento (detalhe e Histórico) ─────────────────────────────

/**
 * Base do ciclo de um lançamento, para o cartão de métricas:
 *  - aberto: fornecido + sobra anterior (a mesma base do nível);
 *  - fechado: o fechamento sobrescreve `sobra_kg` com a sobra FINAL, mas o
 *    consumo real gravado vem de consumo = fornecido + sobra inicial − sobra
 *    final; logo base = consumo real/dia × dias + sobra final. Sem consumo real
 *    gravado, a base não é conhecida (null) — nunca fornecido + sobra final.
 * O nível do cocho NÃO usa isto (período fechado não tem ciclo aberto).
 * @param {any} evento
 * @returns {number|null}
 */
export function baseDoCicloDoEvento(evento) {
  if (!evento) return null;
  if (evento.dias_periodo == null) return kgOuZero(evento.quantidade_total_kg) + kgOuZero(evento.sobra_kg);
  const consumoReal = numeroOuNulo(evento.consumo_diario_grupo_kg);
  const dias = numeroOuNulo(evento.dias_periodo);
  if (consumoReal == null || consumoReal < 0 || dias == null || dias <= 0) return null;
  return consumoReal * dias + kgOuZero(evento.sobra_kg);
}

/**
 * Projeção do cartão de métricas para o ÚLTIMO lançamento do cocho, pelo nível
 * — o detalhe e o Histórico passam o mesmo objeto, e nenhum dos dois refaz a
 * conta:
 *  - ciclo aberto: taxa, duração e próxima reposição do SSOT; sem estimativa
 *    confiável (sem %PV ou cochos compartilhados) tudo `null` (não projeta);
 *  - outros estados (fechado, futuro, data inválida, sem lançamento): `{}` — o
 *    cartão mostra o que ficou gravado no evento (comparação real × esperado).
 * @param {NivelCocho|null|undefined} nivel
 * @returns {{ consumoEsperadoDiaKg?: number|null, duracaoEstimada?: number|null, proximaReposicao?: string|null }}
 */
export function projecaoDoCartaoDoNivel(nivel) {
  if (nivel?.estado !== 'ciclo_aberto') return {};
  const estimado = nivel.confiabilidade === 'estimada' && nivel.taxaConsumoKgDia != null;
  return {
    consumoEsperadoDiaKg: estimado ? nivel.taxaConsumoKgDia : null,
    duracaoEstimada: estimado ? nivel.duracaoCicloEstimadaDias : null,
    proximaReposicao: estimado && nivel.dataEsgotamentoEstimada ? formatarDia(nivel.dataEsgotamentoEstimada) : null,
  };
}

/**
 * Consumo diário (kg/dia) que os cochos ligados a um depósito puxam dele,
 * contando cada REBANHO uma vez. A taxa gravada num lançamento é a do rebanho
 * de TODAS as áreas do cocho, então:
 *  - a ordem é: lançamento mais recente primeiro (data futura conta como hoje),
 *    depois mais áreas, depois a maior taxa;
 *  - um cocho do mesmo produto cujas áreas já estão todas cobertas pelos já
 *    contados é o mesmo rebanho: só entra a diferença, se a taxa dele passar a
 *    soma dos contados que cobrem essas áreas (nunca menos que um lançamento
 *    registrado);
 *  - um cocho com ALGUMA área ainda não coberta entra inteiro (sobreposição
 *    parcial: pode contar a mais, nunca a menos — para o depósito, avisar
 *    reposição cedo é o lado seguro);
 *  - entram ciclos abertos (estimados ou compartilhados — para o depósito
 *    importa o total do rebanho, não o rateio entre cochos) e lançamentos
 *    futuros (com a maior entre a taxa futura e a do ciclo que vale hoje);
 *    sem taxa gravada, o cocho fica fora.
 * @param {{ ponto: any, nivel: NivelCocho }[]} itens
 * @returns {number}
 */
export function consumoDiarioDosRebanhos(itens) {
  const candidatos = (Array.isArray(itens) ? itens : [])
    .filter(({ nivel }) => nivel?.estado === 'ciclo_aberto' || nivel?.estado === 'lancamento_futuro')
    .flatMap(({ ponto, nivel }) => (nivel.consumosParaDeposito || [])
      .filter((consumo) => consumo.taxaKgDia > 0)
      .map((consumo) => ({ areas: new Set(areasDoPonto(ponto)), evento: consumo.evento, dia: nivel.hoje && consumo.dia > nivel.hoje ? nivel.hoje : consumo.dia, taxa: consumo.taxaKgDia })));
  candidatos.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0) || (b.areas.size - a.areas.size) || (b.taxa - a.taxa));
  /** @type {{ areas: Set<string>, evento: any, contribuicao: number }[]} */
  const contados = [];
  let total = 0;
  for (const candidato of candidatos) {
    let contribuicao = candidato.taxa;
    if (candidato.areas.size) {
      const cobertas = new Set();
      let somaQueCobre = 0;
      for (const contado of contados) {
        if (!mesmoProduto(contado.evento, candidato.evento)) continue;
        if (![...contado.areas].some((area) => candidato.areas.has(area))) continue;
        for (const area of contado.areas) cobertas.add(area);
        somaQueCobre += contado.contribuicao;
      }
      if ([...candidato.areas].every((area) => cobertas.has(area))) contribuicao = Math.max(0, candidato.taxa - somaQueCobre);
    }
    total += contribuicao;
    contados.push({ areas: candidato.areas, evento: candidato.evento, contribuicao });
  }
  return total;
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
      descricao: `Sobra informada de ${formatarKgNivel(/** @type {number} */ (n.saldoKg))}, ${formatarKgNivel(n.excessoAtualKg)} acima do limite operacional (${formatarPercentualNivel(n.ocupacaoAtualPercentual)}).`,
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
  let lotesForaDoKgIgnorados = 0;
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
      // D-PROD-369 (trava até a UE-3): produto com estoque fora de KG (SC, UN, CX...) fica fora do saldo em kg, como o de
      // litros; o SACO legado guarda kg e conta.
      const unidadeDoLote = String(unidadePorProduto.get(chave) ?? '').trim().toUpperCase();
      if (unidadeDoLote && unidadeDoLote !== 'KG' && unidadeDoLote !== 'SACO' && unidadeDoLote !== 'L') {
        lotesForaDoKgIgnorados += 1;
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
    alertas.push({ tipo: 'deposito_acima_limite', severidade: 'alerta', titulo: 'Acima do limite operacional', descricao: `Saldo de ${formatarKgNivel(saldoKg)}, ${formatarKgNivel(excessoKg)} acima do limite operacional (${formatarPercentualNivel(ocupacaoPercentual)}).` });
  }

  return {
    tipo: 'DEPOSITO',
    pontoId: deposito?.id ?? null,
    saldoKg,
    lotesConsiderados,
    lotesEmLitrosIgnorados,
    lotesForaDoKgIgnorados,
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
    // Percentual BRUTO (pode passar de 100%), o mesmo número da descrição.
    rotuloCurto: ocupacaoPercentual != null ? formatarPercentualNivel(ocupacaoPercentual) : 'Sem limite',
    descricao: juntarFrases(principal, abaixoMinimo ? mensagemMinimo : null),
    alertas,
  };
}
