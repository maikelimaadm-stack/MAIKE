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
 *  - Critério de TEMPO do compartilhamento: um ciclo aberto só fecha quando
 *    chega um lançamento novo, então um cocho que parou de ser abastecido
 *    ficaria "aberto" para sempre. A janela de cada ciclo aberto é
 *    [lançamento, lançamento + ⌈base ÷ taxa⌉) — a duração MÍNIMA — mas só
 *    quando o cocho esteve SOZINHO com o rebanho nesse intervalo; se outro
 *    cocho das mesmas áreas teve ciclo do mesmo produto (aberto ou fechado)
 *    nesse intervalo, o fim é desconhecido e a janela fica aberta. Cochos com
 *    janelas que se cruzam formam um grupo (fecho transitivo, igual para todos
 *    os membros). Ver `grupoDeCochosCompartilhando`.
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
  // Próximo passo nos estados neutros (detalhes do cocho e do depósito).
  orientacaoLimite: 'Configure o limite operacional no cadastro do ponto.',
  orientacaoSemPv: 'Cadastre o %PV do produto; a estimativa volta no próximo lançamento.',
  orientacaoCompartilhada: 'A estimativa volta quando só um cocho com este produto atender estes animais.',
});

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
const intervalosSeCruzam = (a, b) => (b.fim == null || a.ini < b.fim) && (a.fim == null || b.ini < a.fim);

/**
 * @typedef {{ id: string, ponto: any, areas: Set<string>, ultimo: any, dia: string, base: number, taxa: number|null }} CicloAbertoDoGrupo
 */

/**
 * Cochos que dividem os mesmos animais com o MESMO produto (D-PROD-178 §4).
 *
 * A taxa gravada em cada lançamento é a do rebanho inteiro e não há rateio,
 * então dois ciclos abertos que se sobrepõem no tempo, nas mesmas áreas, não
 * têm estimativa por cocho. Regra (simétrica — o mesmo grupo vale para todos
 * os seus cochos):
 *  - membros: cochos ativos da mesma fazenda cujo último lançamento é um ciclo
 *    ABERTO do mesmo produto, com data válida e não futura;
 *  - janela de um membro Z: [lançamento, lançamento + ⌈base ÷ taxa⌉) — a
 *    duração MÍNIMA, porque a taxa é a do rebanho inteiro (sem taxa, a menor
 *    taxa dos membros). Ela só vale se, nesse intervalo, nenhum OUTRO cocho
 *    ativo das mesmas áreas teve ciclo do mesmo produto (aberto ou fechado):
 *    nesse caso Z esteve sozinho com o rebanho e de fato se esgotou no fim da
 *    janela. Se outro cocho dividiu o rebanho com Z, o fim de Z é desconhecido
 *    e a janela fica aberta;
 *  - dois membros com áreas em comum e janelas que se cruzam dividem os
 *    animais; o grupo é o fecho transitivo disso.
 * Assim um cocho abandonado que se esgotou SOZINHO não deixa o vizinho sem
 * estimativa, e cochos reabastecidos em dias diferentes continuam sem
 * estimativa (nada de dupla contagem nem 0% falso).
 *
 * @param {any} ponto @param {any} ultimo @param {any[]} eventos @param {any[]} pontos @param {string|null} hoje
 * @returns {CicloAbertoDoGrupo[]} os OUTROS cochos do grupo (vazio = sozinho)
 */
const grupoDeCochosCompartilhando = (ponto, ultimo, eventos, pontos, hoje) => {
  if (!areasDoPonto(ponto).length || !Array.isArray(pontos) || !Array.isArray(eventos)) return [];

  /** @type {Map<string, any[]>} */
  const eventosPorPonto = new Map();
  for (const evento of eventos) {
    if (!evento?.ponto_suplementacao_id) continue;
    const chave = String(evento.ponto_suplementacao_id);
    const lista = eventosPorPonto.get(chave);
    if (lista) lista.push(evento); else eventosPorPonto.set(chave, [evento]);
  }

  // Cochos ativos da mesma fazenda (o próprio ponto sempre entra).
  /** @type {Map<string, any>} */
  const cochos = new Map([[String(ponto.id), ponto]]);
  for (const outro of pontos) {
    if (!outro?.id || cochos.has(String(outro.id))) continue;
    if (!ehCocho(outro) || !ehAtivo(outro) || empresasDiferentes(ponto, outro)) continue;
    cochos.set(String(outro.id), outro);
  }

  const naoFuturo = (/** @type {string} */ dia) => hoje == null || dia <= hoje;

  // Ciclos (do mesmo produto, não futuros) de cada cocho, para conferir quem
  // dividiu o rebanho: fechado → [lançamento, lançamento + dias do período);
  // aberto → até o lançamento seguinte do mesmo cocho, ou sem fim se for o último.
  /** @type {Map<string, {ini: string, fim: string|null}[]>} */
  const ciclosPorCocho = new Map();
  for (const [id, cocho] of cochos) {
    const doCocho = (eventosPorPonto.get(id) || [])
      .filter((evento) => !empresasDiferentes(cocho, evento))
      .map((evento) => ({ evento, dia: diaDoLancamento(evento.data_lancamento) }))
      .filter((item) => item.dia != null && naoFuturo(/** @type {string} */ (item.dia)))
      .sort((a, b) => (/** @type {string} */ (a.dia) < /** @type {string} */ (b.dia) ? -1 : a.dia === b.dia ? 0 : 1));
    /** @type {{ini: string, fim: string|null}[]} */
    const ciclos = [];
    doCocho.forEach((item, indice) => {
      if (!mesmoProduto(ultimo, item.evento)) return;
      const ini = /** @type {string} */ (item.dia);
      const diasPeriodo = numeroOuNulo(item.evento.dias_periodo);
      if (item.evento.dias_periodo != null) {
        const fim = diasPeriodo != null && diasPeriodo >= 0 && diasPeriodo <= LIMITE_DIAS_CICLO ? somarDias(ini, Math.ceil(diasPeriodo)) || null : null;
        ciclos.push({ ini, fim });
      } else {
        const seguinte = doCocho.slice(indice + 1).find((outro) => /** @type {string} */ (outro.dia) > ini);
        ciclos.push({ ini, fim: seguinte ? /** @type {string} */ (seguinte.dia) : null });
      }
    });
    ciclosPorCocho.set(id, ciclos);
  }

  // Membros: último lançamento = ciclo aberto do mesmo produto, data válida e não futura.
  /** @type {CicloAbertoDoGrupo[]} */
  const membros = [];
  for (const [id, cocho] of cochos) {
    const ultimoDoCocho = id === String(ponto.id) ? ultimo : selecionarUltimoEventoDoPonto(cocho, eventosPorPonto.get(id) || []);
    if (!ultimoDoCocho || ultimoDoCocho.dias_periodo != null) continue;
    if (empresasDiferentes(ultimo, ultimoDoCocho) || !mesmoProduto(ultimo, ultimoDoCocho)) continue;
    const dia = diaDoLancamento(ultimoDoCocho.data_lancamento);
    if (dia == null || !naoFuturo(dia)) continue;
    membros.push({
      id,
      ponto: cocho,
      areas: new Set(areasDoPonto(cocho)),
      ultimo: ultimoDoCocho,
      dia,
      base: kgOuZero(ultimoDoCocho.quantidade_total_kg) + kgOuZero(ultimoDoCocho.sobra_kg),
      taxa: positivoOuNulo(ultimoDoCocho.consumo_esperado_pv_kg),
    });
  }
  const taxasConhecidas = membros.map((membro) => membro.taxa).filter((taxa) => taxa != null);
  const taxaReferencia = taxasConhecidas.length ? Math.min(.../** @type {number[]} */ (taxasConhecidas)) : null;

  const cruzamAreas = (/** @type {Set<string>} */ a, /** @type {Set<string>} */ b) => [...a].some((area) => b.has(area));

  /** @type {Map<string, {ini: string, fim: string|null}>} */
  const janelas = new Map();
  for (const membro of membros) {
    const fimMinimo = fimMinimoDoCiclo(membro.dia, membro.base, membro.taxa ?? taxaReferencia);
    let fim = fimMinimo;
    if (fimMinimo != null) {
      const minima = { ini: membro.dia, fim: fimMinimo };
      for (const [id, cocho] of cochos) {
        if (id === membro.id || !cruzamAreas(membro.areas, new Set(areasDoPonto(cocho)))) continue;
        if ((ciclosPorCocho.get(id) || []).some((ciclo) => intervalosSeCruzam(ciclo, minima))) { fim = null; break; }
      }
    }
    janelas.set(membro.id, { ini: membro.dia, fim });
  }

  // Fecho transitivo a partir deste cocho.
  const proprioId = String(ponto.id);
  if (!janelas.has(proprioId)) return [];
  const noGrupo = new Set([proprioId]);
  const fila = [proprioId];
  while (fila.length) {
    const idAtual = fila.shift();
    const atual = /** @type {CicloAbertoDoGrupo} */ (membros.find((membro) => membro.id === idAtual));
    const janelaAtual = /** @type {{ini: string, fim: string|null}} */ (janelas.get(atual.id));
    for (const membro of membros) {
      if (noGrupo.has(membro.id) || !cruzamAreas(atual.areas, membro.areas)) continue;
      if (!intervalosSeCruzam(janelaAtual, /** @type {{ini: string, fim: string|null}} */ (janelas.get(membro.id)))) continue;
      noGrupo.add(membro.id);
      fila.push(membro.id);
    }
  }
  return membros.filter((membro) => membro.id !== proprioId && noGrupo.has(membro.id));
};

/**
 * Dia em que o GRUPO de cochos compartilhados já teria esgotado: depois do
 * último lançamento do grupo, a soma das bases consumida pela menor taxa.
 * Limite superior (sem rateio): o rebanho consome a taxa de onde houver produto.
 * O mesmo para todos os cochos do grupo. `null` = longo demais para datar.
 * @param {{ dia: string, base: number, taxa: number }} ciclo @param {CicloAbertoDoGrupo[]} outros
 * @returns {string|null}
 */
const esgotamentoDoConjunto = (ciclo, outros) => {
  let ultimoDia = ciclo.dia;
  let totalBase = ciclo.base;
  let menorTaxa = ciclo.taxa;
  for (const outro of outros) {
    if (outro.dia > ultimoDia) ultimoDia = outro.dia;
    totalBase += outro.base;
    if (outro.taxa != null && outro.taxa < menorTaxa) menorTaxa = outro.taxa;
  }
  return fimMinimoDoCiclo(ultimoDia, totalBase, menorTaxa);
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
    taxaRegistradaKgDia: null,
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
  const ciclo = taxa != null ? { dia, base, taxa } : null;
  const compartilhados = ciclo ? grupoDeCochosCompartilhando(ponto, ultimo, eventos, pontos, hojeValido ? hoje : null) : [];
  const dias = hojeValido ? diasEntre(dia, hoje) : null;

  if (taxa == null || dias == null) {
    n.confiabilidade = 'indisponivel';
    n.rotuloCurto = 'Sem estimativa';
    n.mensagem = MENSAGENS_NIVEL.estimativaIndisponivel;
    n.motivo = taxa == null ? MENSAGENS_NIVEL.motivoSemPv : MENSAGENS_NIVEL.motivoSemHoje;
  } else if (compartilhados.length && ciclo) {
    n.confiabilidade = 'compartilhada';
    n.compartilhadoCom = compartilhados.map((outro) => outro.id);
    n.dataEsgotamentoConjuntoEstimada = esgotamentoDoConjunto(ciclo, compartilhados);
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
  if (n.confiabilidade === 'estimada' && n.saldoKg != null && n.diasRestantesEstimados != null) {
    if (n.saldoKg <= 0) {
      alertas.push({ tipo: 'cocho_sem_produto', severidade: 'critico', titulo: 'Cocho sem produto', descricao: 'A cobertura estimada do cocho foi esgotada.' });
    } else if (n.diasRestantesEstimados <= 1) {
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
 * contando cada REBANHO uma vez: cochos com ciclo aberto do mesmo produto e
 * áreas em comum (fecho transitivo) são o mesmo rebanho, e a taxa gravada em
 * cada um já é a do rebanho inteiro — somar as duas seria dupla contagem. Por
 * grupo vale a taxa do lançamento mais recente (empate: a maior). Entram os
 * ciclos abertos com taxa gravada, estimados ou compartilhados (para o
 * depósito importa o total do rebanho, não o rateio entre cochos); sem taxa,
 * o cocho fica fora.
 * @param {{ ponto: any, nivel: NivelCocho }[]} itens
 * @returns {number}
 */
export function consumoDiarioDosRebanhos(itens) {
  const comTaxa = (Array.isArray(itens) ? itens : []).filter(({ nivel }) => nivel?.estado === 'ciclo_aberto' && nivel.taxaRegistradaKgDia != null && nivel.taxaRegistradaKgDia > 0);
  const areas = comTaxa.map(({ ponto }) => new Set(areasDoPonto(ponto)));
  const visitado = new Array(comTaxa.length).fill(false);
  let total = 0;
  for (let i = 0; i < comTaxa.length; i += 1) {
    if (visitado[i]) continue;
    visitado[i] = true;
    const fila = [i];
    let melhor = comTaxa[i].nivel;
    while (fila.length) {
      const atual = /** @type {number} */ (fila.shift());
      for (let j = 0; j < comTaxa.length; j += 1) {
        if (visitado[j]) continue;
        const mesmasAreas = [...areas[atual]].some((area) => areas[j].has(area));
        if (!mesmasAreas || !mesmoProduto(comTaxa[atual].nivel.evento, comTaxa[j].nivel.evento)) continue;
        visitado[j] = true;
        fila.push(j);
        const candidato = comTaxa[j].nivel;
        const diaC = candidato.dataLancamento ?? '';
        const diaM = melhor.dataLancamento ?? '';
        if (diaC > diaM || (diaC === diaM && /** @type {number} */ (candidato.taxaRegistradaKgDia) > /** @type {number} */ (melhor.taxaRegistradaKgDia))) melhor = candidato;
      }
    }
    total += /** @type {number} */ (melhor.taxaRegistradaKgDia);
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
    alertas.push({ tipo: 'deposito_acima_limite', severidade: 'alerta', titulo: 'Acima do limite operacional', descricao: `Saldo de ${formatarKgNivel(saldoKg)}, ${formatarKgNivel(excessoKg)} acima do limite operacional (${formatarPercentualNivel(ocupacaoPercentual)}).` });
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
    // Percentual BRUTO (pode passar de 100%), o mesmo número da descrição.
    rotuloCurto: ocupacaoPercentual != null ? formatarPercentualNivel(ocupacaoPercentual) : 'Sem limite',
    descricao: juntarFrases(principal, abaixoMinimo ? mensagemMinimo : null),
    alertas,
  };
}
