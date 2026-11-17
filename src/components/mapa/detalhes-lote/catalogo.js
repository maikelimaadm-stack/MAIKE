/**
 * Catálogo de dados do "Detalhes do Lote" (v12, D-PROD-V12 — número definitivo no PR).
 *
 * Puro: sem React, sem rede, sem cache. Recebe o que o mapa já tem (área,
 * posições/lotes, movimentações, categorias de manejo) e devolve o modelo pronto
 * para a tela.
 *
 * Regras fixas:
 * - Só os dados que o sistema tem. Sem dado → "—" (VAZIO); nada é inventado.
 * - Um formatador único (fmtNum/fmtInt/fmtPct/fmtData) para todas as telas.
 * - A célula de um campo (grade e tabela) leva só o número: a unidade vai no
 *   rótulo ("Peso médio (kg)"). Os textos corridos do v12 levam a unidade depois
 *   do número ("449,5 kg", "62 cab", "38 cb · 38,0 UA · VACA"); são montados
 *   aqui, com o mesmo formatador (D12 da D-PROD-V12).
 * - Subícone (D-PROD-191): vem do CÓDIGO pela chave sexo + faixa de idade da
 *   Categoria de Manejo (`@/assets/icones/lotes`), nunca de upload. O modelo leva
 *   só a FIGURA ('femea-13-24'); a tela monta o desenho no tamanho em que o mostra.
 *   Nunca misto: cada lote e cada categoria aparece com o animal dele, na cor do
 *   sexo dele, mesmo quando o pasto mistura sexos.
 */
import { CORES_UA_HA } from '@/components/mapa/MapaFiltrosAvancados';
import { PESAGEM } from '@/domain/lotes/manejoRebanho';
import { ehMovimentoAtivo } from '@/domain/lotes/situacaoMovimento';
import { calcularSituacaoPasto } from '@/domain/mapa/mapaGeralDerivados';
import { figuraDaPosicao, figuraDoGrupo, mapaDeCategorias } from '@/assets/icones/lotes';

export const VAZIO = '—';
/** 1 UA = 450 kg de peso vivo — o mesmo de MapaInsights.jsx ("UA do animal = peso médio / 450"). */
export const UA_KG = 450;
/** Alerta "Pesagem atrasada" quando diasSemPesar > 60. */
export const DIAS_PESAGEM_ATRASADA = 60;
/** Alerta "Intervalo curto" quando o intervalo entre as 2 últimas pesagens < 28. */
export const INTERVALO_MINIMO = 28;
/** Próxima pesagem = última + 60 dias. */
export const PROXIMA_PESAGEM_DIAS = 60;

/** Seções dos campos do lote (grupos da tabela e do "Configurar tabela"). */
export const SECOES_LOTE = ['Alertas', 'Lotação', 'Pesagem', 'Identificação'];
/** Seções abertas na vista Lote e na tela do lote (os alertas viram avisos). */
export const SECOES_DO_LOTE = ['Lotação', 'Pesagem', 'Identificação'];
/** Seções das colunas padrão da Lista. */
export const SECOES_PADRAO = ['Alertas', 'Lotação', 'Pesagem'];

export const TONS = {
  ok: { texto: '#166534', fundo: '#f0fdf4', borda: '#bbf7d0' },
  atencao: { texto: '#b45309', fundo: '#fffbeb', borda: '#fde68a' },
  investigar: { texto: '#b91c1c', fundo: '#fef2f2', borda: '#fecaca' },
  neutro: { texto: '#374151', fundo: '#FAFCFE', borda: '#e2e8f0' },
};

/** Cor dos valores no v12 (padrão das células). */
const COR_TEXTO = '#1f2937';
/** Cor de "—" e dos textos apagados (status VAZIO). */
const COR_META = '#64748b';
const COR_ATENCAO = '#b45309';
const COR_INVESTIGAR = '#b91c1c';
/** Barra da "% da capacidade" acima de 100%. */
const COR_BARRA_ATENCAO = '#f59e0b';
const DIA_MS = 86400000;

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** @typedef {'ok'|'atencao'|'investigar'|'neutro'} Tom */

/**
 * texto = já formatado; cor = cor do texto (padrão #1f2937); ordem = chave de ordenação
 * ('' = vazio, vai sempre para o fim); dot = cor da bolinha antes do texto;
 * barra = 0..100 (barrinha depois do texto); quebra = true → o texto quebra em linhas.
 * @typedef {{ texto: string, cor?: string, ordem: number|string, dot?: string, barra?: number, quebra?: boolean }} Celula
 */

/**
 * pesagem:   nivel 2, tom 'atencao', rotuloTipo 'Pesagem atrasada', valor "76", frase "Faz 76 dias sem pesar"
 * intervalo: nivel 1, tom 'neutro',  rotuloTipo 'Intervalo curto',  valor "20", frase "Pesagens muito próximas (20 dias)"
 * @typedef {{ tipo: 'pesagem'|'intervalo', nivel: 1|2, rotuloTipo: string, valor: string, frase: string, tom: Tom }} Alerta
 */

/** Atenção se algum alerta nível 2; senão Em dia (tom 'ok'). @typedef {{ rotulo: 'Atenção'|'Em dia', tom: Tom }} Situacao */

/**
 * @typedef {{ ultima: string|null, medido: boolean|null, intervalo: number|null, proxima: string|null,
 *   n: number, pesoPrimeira: number|null, diasSemPesar: number|null }} PesagemVm
 */

/**
 * @typedef {{ sexo: string, sistema: string, identificador: string, identificadorCor: string|null,
 *   sigla: string, entrada: string|null, catManejo: string }} IdentVm
 */

/**
 * subicone = figura do animal da posição ('femea-13-24'), pela Categoria de Manejo dela
 * (reserva: sexo e categoria oficial gravados); null = sem sexo ou sem faixa conhecidos
 * (a tela mostra o quadrado tracejado). Nunca misto.
 * alertas = todos (a vista Lote mostra os dois níveis); alertasVisiveis = só os de nível 2
 * (os que mudam a situação e aparecem nas colunas de Alertas).
 * textos.meta = "38 cb · 38,0 UA · VACA"; textos.pesoKg = "449,5 kg" (item do Resumo).
 * @typedef {{
 *   id: string, nome: string, categoria: string, sexo: string, sub: string,
 *   subicone: string|null,
 *   cab: number, peso: number|null, pesoTotal: number|null, ua: number|null, uaHa: number|null, kgPvHa: number|null,
 *   partCab: number|null, partUA: number|null, diasPastejo: number|null,
 *   pesagem: PesagemVm,
 *   projecao: any,
 *   ident: IdentVm,
 *   alertas: Alerta[], alertasVisiveis: Alerta[],
 *   gravidade: number, situacao: Situacao,
 *   valores: Record<string, Celula>,
 *   textos: { meta: string, pesoKg: string },
 *   raw: any
 * }} LoteVm
 */

/**
 * largura = trilha da coluna na tabela (v12: 'minmax(84px, auto)' ou fixa).
 * @typedef {{ chave: string, secao: 'Alertas'|'Lotação'|'Pesagem'|'Identificação', rotulo: string, dica: string,
 *   largura: string,
 *   get: (l: LoteVm) => Celula, total: (m: ModeloDetalhes) => string }} CampoDef
 */

/**
 * Célula de texto pronta para a grade (rótulo, valor, cor, bolinha, sub, barra).
 * @typedef {{ chave?: string, rotulo: string, texto: string, cor?: string, dot?: string, barra?: number,
 *   corBarra?: string, quebra?: boolean, dica?: string }} CampoTexto
 */

/**
 * subicone = figura do grupo: a combinação sexo+faixa com mais cabeças entre as posições
 * da categoria (empate: a faixa mais velha), na cor do sexo dela; null = nenhuma conhecida.
 * descricao = "20% do pasto · peso 196 kg"; valor = "62 cab".
 * @typedef {{ nome: string, cab: number, pct: number, pctTexto: string, descricao: string, valor: string, subicone: string|null }} CategoriaVm
 */

/**
 * Aba Detalhes. `campos` são as células fixas do cartão da área; Setor e Status
 * entram por `camposDoCartaoDaArea` (o setor vem do mapa; o status depende das
 * movimentações). `lotacao` são as 9 células do bloco Lotação.
 * @typedef {{
 *   nome: string, sub: string,
 *   hectares: number|null, haPastejada: number|null, ha: number|null,
 *   cab: number,
 *   faixa: { rotulo: string, rotuloLongo: string, cor: string },
 *   campos: { hectares: CampoTexto, haPastejada: CampoTexto, pastagem: CampoTexto, dias: CampoTexto },
 *   lotacao: CampoTexto[],
 *   categorias: CategoriaVm[],
 *   alertas: Array<{ frase: string, tom: Tom }>,
 * }} AreaVm
 */

/**
 * @typedef {{
 *   area: AreaVm, lotes: LoteVm[],
 *   resumo: { pesoMedio: string, cab: string, uaHa: string, kgPvHa: string },
 *   totais: Record<string, string>,
 *   ctx: { ha: number|null, totalCab: number, uaTotal: number, pesoVivoTotal: number, hoje: Date }
 * }} ModeloDetalhes
 */

// ─── Números e datas ────────────────────────────────────────────────────────

/**
 * Número do servidor (pode vir string por causa do Decimal) → number; inválido → null.
 * @param {unknown} v
 * @returns {number|null}
 */
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/** Positivo ou null (peso/hectare 0 não é dado). @param {unknown} v */
const positivo = (v) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/**
 * Formata com `casas` decimais fixas em pt-BR. Nunca põe unidade.
 * @param {unknown} v
 * @param {number} [casas]
 */
export function fmtNum(v, casas = 2) {
  const n = num(v);
  if (n === null) return VAZIO;
  let r = Number(n.toFixed(casas));
  if (r === 0) r = 0; // evita "-0,00"
  return r.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Inteiro pt-BR (arredonda). @param {unknown} v */
export function fmtInt(v) {
  return fmtNum(v, 0);
}

/** v em 0..100 → "45%". @param {unknown} v */
export function fmtPct(v) {
  const t = fmtInt(v);
  return t === VAZIO ? VAZIO : `${t}%`;
}

/**
 * 'AAAA-MM-DD' (ou ISO, ou Date) → Date LOCAL à meia-noite; inválido → null.
 * Só a parte da data é lida: '2026-10-14T03:00:00Z' vale 14/10 (igual formatDateBR).
 * @param {unknown} v
 * @returns {Date|null}
 */
const dataLocal = (v) => {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  if (typeof v !== 'string' || !v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Date → 'AAAA-MM-DD' local. @param {Date} d */
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Dias de `a` até `b` (meia-noite local; Math.round absorve o horário de verão). @param {Date} a @param {Date} b */
const diasEntre = (a, b) => Math.round((b.getTime() - a.getTime()) / DIA_MS);

/** 'AAAA-MM-DD' + n dias → 'AAAA-MM-DD'. @param {string} s @param {number} n */
const somaDias = (s, n) => {
  const d = dataLocal(s);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return isoLocal(d);
};

/** 'AAAA-MM-DD' ou ISO → 'dd/mm/aaaa'. @param {unknown} v */
export function fmtData(v) {
  const d = dataLocal(v);
  if (!d) return VAZIO;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** → 'dd/mm'. @param {unknown} v */
export function fmtDataCurta(v) {
  const t = fmtData(v);
  return t === VAZIO ? VAZIO : t.slice(0, 5);
}

/** String maiúscula aparada ou VAZIO. @param {unknown} v */
export function texto(v) {
  if (v === null || v === undefined) return VAZIO;
  const s = String(v).trim();
  return s ? s.toLocaleUpperCase('pt-BR') : VAZIO;
}

/** Texto cru aparado (sem caixa alta) ou VAZIO. @param {unknown} v */
const cru = (v) => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s || VAZIO;
};

/** Junta as partes com " · ", sem as vazias. @param {Array<string|null|undefined>} partes */
const juntar = (partes) => partes.filter((t) => t && t !== VAZIO).join(' · ');

/** Timestamp da data (para ordenar) ou '' quando vazia. @param {unknown} v */
const ordemData = (v) => {
  const d = dataLocal(v);
  return d ? d.getTime() : '';
};

/** Número para ordenar ou '' quando vazio. @param {number|null|undefined} v */
const ordemNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : '');

/** Texto para ordenar ou '' quando vazio. @param {string} t */
const ordemTxt = (t) => (t === VAZIO ? '' : t);

/**
 * Célula pronta.
 * @param {string} t
 * @param {number|string} ordem
 * @param {Partial<Celula>} [extra]
 * @returns {Celula}
 */
const cel = (t, ordem, extra = {}) => ({ texto: t, cor: COR_TEXTO, ordem, ...extra });

// ─── Faixa de lotação (UA/ha) ───────────────────────────────────────────────

/**
 * Faixa pelas chaves/cores de CORES_UA_HA e pelos mesmos limites do mapa
 * (MapaGeral: < 0,8 · < 1,2 · < 1,8 · < 2,4 · resto). Sem cabeças → "Sem gado";
 * com cabeças mas sem peso ou sem hectares → faixa desconhecida (VAZIO).
 * @param {number} cab
 * @param {number|null} uaHa
 */
const faixaDe = (cab, uaHa) => {
  const chaves = Object.keys(CORES_UA_HA);
  /** @param {number} i */
  const de = (i) => ({ rotulo: chaves[i].split(' (')[0], rotuloLongo: chaves[i], cor: /** @type {Record<string,string>} */ (CORES_UA_HA)[chaves[i]] });
  if (!(cab > 0)) return de(0);
  if (uaHa === null) return { rotulo: VAZIO, rotuloLongo: VAZIO, cor: '#94a3b8' };
  if (uaHa < 0.8) return de(1);
  if (uaHa < 1.2) return de(2);
  if (uaHa < 1.8) return de(3);
  if (uaHa < 2.4) return de(4);
  return de(5);
};

// ─── Larguras da Lista (trilhas do grid; v12) ───────────────────────────────

/** Rótulo curto do fato que gravou a base da projeção. */
const ROTULO_BASE = Object.freeze({
  ENTRADA: 'ENTRADA', PESAGEM: 'PESAGEM', SALDO_ABERTURA: 'ABERTURA', TRANSFERENCIA: 'TRANSF.',
  MUDANCA_CATEGORIA: 'MUD. CAT.', JUNCAO: 'JUNÇÃO', NASCIMENTO: 'NASCIMENTO',
});

/** Colunas de largura fixa; as demais crescem com o conteúdo a partir de 84 px. */
/** @type {Record<string, string>} */
const LARGURA = { projMeses: '172px', alTipo: '128px', atinge: '128px', pesPrev: '116px', baseProj: '116px' };
const LARGURA_PADRAO = 'minmax(84px, auto)';

// ─── Catálogo de campos do lote ─────────────────────────────────────────────

/**
 * Soma ponderada por cabeça de um valor do lote (ignora lotes sem o valor).
 * @param {LoteVm[]} lotes
 * @param {(l: LoteVm) => number|null} valor
 */
const mediaPorCab = (lotes, valor) => {
  let soma = 0;
  let cab = 0;
  for (const l of lotes) {
    const v = valor(l);
    if (v === null || !(l.cab > 0)) continue;
    soma += v * l.cab;
    cab += l.cab;
  }
  return cab > 0 ? soma / cab : null;
};

/**
 * Soma de um valor dos lotes; null se nenhum lote tem o valor.
 * @param {LoteVm[]} lotes
 * @param {(l: LoteVm) => number|null} valor
 */
const somaDe = (lotes, valor) => {
  let soma = 0;
  let algum = false;
  for (const l of lotes) {
    const v = valor(l);
    if (v === null) continue;
    soma += v;
    algum = true;
  }
  return algum ? soma : null;
};

/** UA × dias de pastejo do lote. @param {LoteVm} l */
const ocupacaoDe = (l) => (l.ua !== null && l.diasPastejo !== null ? l.ua * l.diasPastejo : null);

/**
 * @param {string} chave
 * @param {CampoDef['secao']} secao
 * @param {string} rotulo
 * @param {string} dica
 * @param {(l: LoteVm) => Celula} get
 * @param {(m: ModeloDetalhes) => string} [total]
 * @returns {CampoDef}
 */
const campo = (chave, secao, rotulo, dica, get, total = () => '') => ({
  chave, secao, rotulo, dica, largura: LARGURA[chave] || LARGURA_PADRAO, get, total,
});

/** Cor dos alertas visíveis (nível 2) do lote; sem alerta, a cor de "—". @param {LoteVm} l */
const corAlerta = (l) => (l.alertasVisiveis.length ? TONS[l.alertasVisiveis[0].tom].texto : COR_META);

/**
 * Uma definição por campo: rótulo, seção, dica, largura, valor da célula e total.
 * As células são pré-calculadas em `LoteVm.valores` (use `valores[chave]`).
 * @type {CampoDef[]}
 */
export const CAMPOS_LOTE = [
  // Alertas
  campo('alNivel', 'Alertas', 'Situação', 'Atenção quando há alerta; senão Em dia', (l) => {
    const cor = TONS[l.situacao.tom].texto;
    return cel(l.situacao.rotulo.toLocaleUpperCase('pt-BR'), l.gravidade, { cor, dot: cor });
  }),
  campo('alTipo', 'Alertas', 'Tipo de alerta', 'o que disparou o alerta', (l) => {
    const v = l.alertasVisiveis;
    return cel(v.length ? v.map((a) => a.rotuloTipo).join(' · ') : VAZIO, v.length ? v[0].rotuloTipo : '', { cor: corAlerta(l) });
  }),
  campo('alValor', 'Alertas', 'Valor do alerta (dias)', 'valor que gerou o alerta', (l) => {
    const v = l.alertasVisiveis;
    return cel(v.length ? v.map((a) => a.valor).join(' · ') : VAZIO, v.length ? ordemNum(num(v[0].valor)) : '', { cor: corAlerta(l) });
  }),

  // Lotação
  campo('cab', 'Lotação', 'Cab.', '', (l) => cel(fmtInt(l.cab), l.cab),
    (m) => fmtInt(m.ctx.totalCab)),
  campo('peso', 'Lotação', 'Peso médio (kg)', 'peso médio atual do lote', (l) => cel(fmtNum(l.peso, 1), ordemNum(l.peso)),
    (m) => fmtNum(mediaPorCab(m.lotes, (l) => l.peso), 1)),
  campo('partCab', 'Lotação', '% área', 'participação nas cabeças da área', (l) => cel(fmtPct(l.partCab), ordemNum(l.partCab), l.partCab !== null ? { barra: l.partCab } : {}),
    (m) => (m.ctx.totalCab > 0 ? '100%' : '')),
  campo('ua', 'Lotação', 'UA', 'peso vivo ÷ 450', (l) => cel(fmtNum(l.ua), ordemNum(l.ua)),
    (m) => (m.lotes.some((l) => l.ua !== null) ? fmtNum(m.ctx.uaTotal) : '')),
  campo('partUA', 'Lotação', '% lotação', 'participação na UA da área', (l) => cel(fmtPct(l.partUA), ordemNum(l.partUA), l.partUA !== null ? { barra: l.partUA } : {}),
    (m) => (m.ctx.uaTotal > 0 ? '100%' : '')),
  campo('uaha', 'Lotação', 'UA/ha', 'UA do lote ÷ hectares da área', (l) => cel(fmtNum(l.uaHa), ordemNum(l.uaHa)),
    (m) => (m.ctx.ha !== null && m.lotes.some((l) => l.ua !== null) ? fmtNum(m.ctx.uaTotal / m.ctx.ha) : '')),
  campo('kgpvha', 'Lotação', 'kg PV/ha', 'peso vivo do lote ÷ hectares da área', (l) => cel(fmtInt(l.kgPvHa), ordemNum(l.kgPvHa)),
    (m) => (m.ctx.ha !== null && m.lotes.some((l) => l.pesoTotal !== null) ? fmtInt(m.ctx.pesoVivoTotal / m.ctx.ha) : '')),
  campo('dias', 'Lotação', 'Dias pastejo', 'dias desde a data de entrada', (l) => cel(fmtInt(l.diasPastejo), ordemNum(l.diasPastejo)),
    (m) => {
      const v = mediaPorCab(m.lotes, (l) => l.diasPastejo);
      return v === null ? '' : fmtInt(v);
    }),
  campo('pesoTotal', 'Lotação', 'Peso total (kg)', 'peso médio × cabeças', (l) => cel(fmtInt(l.pesoTotal), ordemNum(l.pesoTotal)),
    (m) => (m.lotes.some((l) => l.pesoTotal !== null) ? fmtInt(m.ctx.pesoVivoTotal) : '')),
  campo('ocupacao', 'Lotação', 'Ocupação (UA × dias)', 'UA do lote × dias de pastejo', (l) => cel(fmtInt(ocupacaoDe(l)), ordemNum(ocupacaoDe(l))),
    (m) => {
      const v = somaDe(m.lotes, ocupacaoDe);
      return v === null ? '' : fmtInt(v);
    }),

  // Pesagem — D-PROD-198: peso projetado pela curva de ganho da Categoria de Manejo (servidor).
  campo('projetado', 'Pesagem', 'Peso projetado (kg)', 'último peso + ganho diário da curva da categoria, até hoje', (l) => {
    const p = l.projecao;
    return cel(p ? fmtNum(p.peso_kg, 1) : VAZIO, ordemNum(p?.peso_kg ?? null), p?.sem_curva ? { cor: COR_ATENCAO } : {});
  }, (m) => fmtNum(mediaPorCab(m.lotes, (l) => (l.projecao ? num(l.projecao.peso_kg) : null)), 1)),
  campo('projArroba', 'Pesagem', '@ projetadas', 'peso projetado ÷ 30 (arroba de peso vivo, por cabeça)', (l) => cel(l.projecao ? fmtNum(l.projecao.arroba, 2) : VAZIO, ordemNum(l.projecao?.arroba ?? null))),
  campo('gmdMes', 'Pesagem', 'GMD do mês (kg/dia)', 'ganho diário deste mês na curva da categoria', (l) => {
    const p = l.projecao;
    if (!p) return cel(VAZIO, '');
    if (p.sem_curva) return cel('SEM CURVA', -1, { cor: COR_ATENCAO });
    return cel(fmtNum(p.gmd_hoje_kg, 3), ordemNum(p.gmd_hoje_kg));
  }),
  campo('baseProj', 'Pesagem', 'Base da projeção', 'de onde parte a projeção: último peso gravado e a data dele', (l) => {
    const b = l.projecao?.base;
    if (!b) return cel(VAZIO, '');
    return cel(`${ROTULO_BASE[b.tipo] ?? 'PESO'} ${fmtDataCurta(b.dia)}`, ordemData(b.dia));
  }),
  campo('objetivo', 'Pesagem', 'Peso objetivo (kg)', 'peso objetivo da categoria de manejo', (l) => cel(l.projecao?.peso_objetivo_kg != null ? fmtNum(l.projecao.peso_objetivo_kg, 0) : VAZIO, ordemNum(l.projecao?.peso_objetivo_kg ?? null))),
  campo('atinge', 'Pesagem', 'Atinge o objetivo', 'data em que o peso projetado chega ao objetivo da categoria', (l) => {
    const p = l.projecao;
    if (!p || p.peso_objetivo_kg == null) return cel(VAZIO, '');
    // Chaves numéricas, como as datas: ATINGIDO antes de qualquer data, SEM PREVISÃO depois.
    if (p.atingiu_objetivo) return cel('ATINGIDO', -1);
    if (!p.data_prevista_objetivo) return cel('SEM PREVISÃO', Number.MAX_SAFE_INTEGER, { cor: COR_ATENCAO });
    return cel(`${fmtData(p.data_prevista_objetivo)} (${fmtInt(p.dias_para_objetivo)} d)`, ordemData(p.data_prevista_objetivo));
  }),
  campo('pesPrev', 'Pesagem', 'Pesado × previsto', 'última pesagem ÷ peso que a curva previa para aquele dia', (l) => {
    const u = l.projecao?.ultima_pesagem;
    if (!u || u.percentual_do_previsto == null) return cel(VAZIO, '');
    const pct = u.percentual_do_previsto;
    // "97,7% do previsto": o percentual é do peso previsto, não a diferença.
    return cel(`${fmtNum(pct, 1)}% do previsto`, ordemNum(pct), { cor: pct < 100 ? COR_ATENCAO : COR_TEXTO });
  }),
  campo('projMeses', 'Pesagem', 'Projeção (fim do mês)', 'peso projetado no último dia dos próximos meses', (l) => {
    const meses = l.projecao?.projecao_mensal ?? [];
    if (!meses.length) return cel(VAZIO, '');
    return cel(meses.slice(0, 3).map((m) => `${fmtDataCurta(m.dia)}: ${fmtNum(m.peso_kg, 0)}`).join(' · '), '', { quebra: true });
  }),
  campo('ult', 'Pesagem', 'Última', 'data da última pesagem', (l) => cel(fmtData(l.pesagem.ultima), ordemData(l.pesagem.ultima))),
  campo('origem', 'Pesagem', 'Origem', 'MEDIDO: peso atual = peso da última pesagem; DERIVADO: peso atual veio de outro manejo', (l) => {
    const m = l.pesagem.medido;
    if (m === null) return cel(VAZIO, '');
    return cel(m ? 'MEDIDO' : 'DERIVADO', m ? 1 : 0, { cor: m ? COR_TEXTO : COR_ATENCAO });
  }),
  campo('intervalo', 'Pesagem', 'Intervalo (dias)', 'dias entre as duas últimas pesagens', (l) => {
    const i = l.pesagem.intervalo;
    return cel(fmtInt(i), ordemNum(i), { cor: i !== null && i < INTERVALO_MINIMO ? COR_ATENCAO : COR_TEXTO });
  }),
  campo('prox', 'Pesagem', 'Próxima', 'última pesagem + 60 dias', (l) => {
    const p = l.pesagem.proxima;
    const atrasada = l.pesagem.diasSemPesar !== null && l.pesagem.diasSemPesar > DIAS_PESAGEM_ATRASADA;
    return cel(p ? `até ${fmtDataCurta(p)}` : VAZIO, ordemData(p), { cor: p && atrasada ? COR_INVESTIGAR : COR_TEXTO });
  }),
  campo('nPes', 'Pesagem', 'Nº pesag.', 'pesagens registradas no histórico', (l) => cel(fmtInt(l.pesagem.n), l.pesagem.n)),
  campo('peso1', 'Pesagem', 'Peso na 1ª pesagem (kg)', '', (l) => cel(fmtNum(l.pesagem.pesoPrimeira, 1), ordemNum(l.pesagem.pesoPrimeira))),
  campo('semPesar', 'Pesagem', 'Dias sem pesar', 'desde a última pesagem (ou da entrada, sem pesagem)', (l) => cel(fmtInt(l.pesagem.diasSemPesar), ordemNum(l.pesagem.diasSemPesar))),

  // Identificação
  campo('sexo', 'Identificação', 'Sexo', '', (l) => cel(l.ident.sexo, ordemTxt(l.ident.sexo))),
  campo('sist', 'Identificação', 'Sist. Rep.', '', (l) => cel(l.ident.sistema, ordemTxt(l.ident.sistema))),
  campo('ident', 'Identificação', 'Identificador', '', (l) => cel(l.ident.identificador, ordemTxt(l.ident.identificador), l.ident.identificadorCor ? { dot: l.ident.identificadorCor } : {})),
  campo('sigla', 'Identificação', 'Sigla', '', (l) => cel(l.ident.sigla, ordemTxt(l.ident.sigla))),
  campo('entrada', 'Identificação', 'Entrada', 'data de entrada', (l) => cel(fmtData(l.ident.entrada), ordemData(l.ident.entrada))),
  campo('manejo', 'Identificação', 'Cat. de manejo', '', (l) => cel(l.ident.catManejo, ordemTxt(l.ident.catManejo))),
];

/** Colunas padrão da Lista (v12): Alertas + Lotação + Pesagem. */
export const COLUNAS_PADRAO = Object.freeze(CAMPOS_LOTE.filter((c) => SECOES_PADRAO.includes(c.secao)).map((c) => c.chave));

/** @param {string} secao @returns {CampoDef[]} */
export function camposDaSecao(secao) {
  return CAMPOS_LOTE.filter((c) => c.secao === secao);
}

/**
 * Colunas da Lista pelas chaves marcadas, sempre na ordem do catálogo (as seções
 * ficam juntas). Chave desconhecida é ignorada.
 * @param {readonly string[]|null|undefined} chaves
 * @returns {CampoDef[]}
 */
export function colunasPorChave(chaves) {
  const marcadas = new Set(Array.isArray(chaves) ? chaves : []);
  return CAMPOS_LOTE.filter((c) => marcadas.has(c.chave));
}

/**
 * Lista de chaves de colunas saneada: só as conhecidas, sem repetição, na ordem do
 * catálogo. Lista vazia é escolha do usuário e é respeitada; o que não for lista → null.
 * @param {unknown} valor
 * @returns {string[]|null}
 */
export function normalizarColunas(valor) {
  if (!Array.isArray(valor)) return null;
  return colunasPorChave(valor.map(String)).map((c) => c.chave);
}

/**
 * Células de uma seção do lote para a vista Lote e a tela do lote. A dica só
 * aparece nos campos de projeção da Pesagem (`proj*`); Identificação começa por
 * "Categoria" (que não é coluna da tabela).
 * @param {LoteVm} lote
 * @param {string} secao
 * @returns {CampoTexto[]}
 */
export function camposDoLote(lote, secao) {
  /** @type {CampoTexto[]} */
  const campos = camposDaSecao(secao).map((c) => {
    const v = lote.valores[c.chave] || cel(VAZIO, '');
    return {
      chave: c.chave,
      rotulo: c.rotulo,
      texto: v.texto,
      cor: v.cor,
      dot: v.dot,
      barra: v.barra,
      quebra: v.quebra,
      dica: secao === 'Pesagem' && c.chave.startsWith('proj') && c.dica ? c.dica : undefined,
    };
  });
  if (secao === 'Identificação') campos.unshift({ chave: 'categoria', rotulo: 'Categoria', texto: lote.categoria, cor: COR_TEXTO });
  return campos;
}

// ─── Ordenação ──────────────────────────────────────────────────────────────

/** @param {string} a @param {string} b */
const porNome = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

/**
 * Compara chaves de ordenação; '' (vazio) vai sempre para o fim, qualquer que seja `dir`.
 * @param {number|string} x @param {number|string} y @param {number} dir
 */
const comparaOrdem = (x, y, dir) => {
  const vx = x === '' || x === undefined || x === null;
  const vy = y === '' || y === undefined || y === null;
  if (vx || vy) return vx === vy ? 0 : vx ? 1 : -1;
  if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
  return porNome(String(x), String(y)) * dir;
};

/**
 * Cópia ordenada. chave null|'nome' → nome × dir; senão valores[chave].ordem × dir
 * (vazios no fim; empate → nome crescente).
 * @param {LoteVm[]} lotes
 * @param {{ chave?: string|null, dir?: number }} [opcoes]
 * @returns {LoteVm[]}
 */
export function ordenarLotes(lotes, { chave = null, dir = 1 } = {}) {
  const d = dir < 0 ? -1 : 1;
  return [...lotes].sort((a, b) => {
    if (!chave || chave === 'nome') return porNome(a.nome, b.nome) * d;
    const r = comparaOrdem(a.valores[chave]?.ordem ?? '', b.valores[chave]?.ordem ?? '', d);
    return r || porNome(a.nome, b.nome);
  });
}

// ─── Pesagens (do histórico de movimentações) ───────────────────────────────

/**
 * Pesagens do lote, por data asc. Uma por dia (a última lançada no dia vale).
 * @param {any[]} movimentacoes
 * @param {string} loteId
 * @returns {Array<{ data: string, peso: number|null }>}
 */
const pesagensDoLote = (movimentacoes, loteId) => {
  /** @type {Map<string, { data: string, peso: number|null, criado: string }>} */
  const porDia = new Map();
  for (const mov of movimentacoes) {
    if (!mov || mov.tipo !== PESAGEM || !ehMovimentoAtivo(mov)) continue;
    const data = String(mov.data_movimentacao || '').slice(0, 10);
    if (!dataLocal(data)) continue;
    const linha = (Array.isArray(mov.linhas) ? mov.linhas : []).find((l) => l && (l.posicao_id || l.lote_id) === loteId);
    if (!linha) continue;
    const criado = String(mov.created_date || mov.createdAt || '');
    const atual = porDia.get(data);
    if (!atual || criado >= atual.criado) porDia.set(data, { data, peso: positivo(linha.peso_novo_kg), criado });
  }
  return [...porDia.values()].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)).map(({ data, peso }) => ({ data, peso }));
};

/**
 * Origem do peso (MEDIDO/DERIVADO): `PesoRebanho.medido` NÃO chega ao front e esta fatia
 * não pode criar rota. Então é inferida aqui: o peso atual da posição é igual (± 0,01)
 * ao peso da última Pesagem do histórico → MEDIDO; tem peso mas não bate (junção,
 * nascimento, mudança de categoria…) → DERIVADO; sem peso atual → null (—).
 * @param {number|null} pesoAtual
 * @param {Array<{ data: string, peso: number|null }>} pesagens
 * @returns {boolean|null}
 */
const origemDoPeso = (pesoAtual, pesagens) => {
  if (pesoAtual === null) return null;
  const ultima = pesagens[pesagens.length - 1];
  return !!ultima && ultima.peso !== null && Math.abs(ultima.peso - pesoAtual) < 0.01;
};

/**
 * @param {any} raw lote/posição do servidor
 * @param {Date} hoje
 * @param {any[]} movimentacoes
 * @returns {PesagemVm}
 */
const pesagemDe = (raw, hoje, movimentacoes) => {
  const peso = positivo(raw?.peso_medio_kg);
  const ps = pesagensDoLote(movimentacoes, raw?.id);
  const n = ps.length;
  const ultima = n ? ps[n - 1].data : null;
  const dUlt = dataLocal(ultima);
  const dPen = n >= 2 ? dataLocal(ps[n - 2].data) : null;
  const base = dUlt || dataLocal(raw?.data_entrada);
  return {
    ultima,
    medido: origemDoPeso(peso, ps),
    intervalo: dUlt && dPen ? diasEntre(dPen, dUlt) : null,
    proxima: ultima ? somaDias(ultima, PROXIMA_PESAGEM_DIAS) : null,
    n,
    pesoPrimeira: n ? ps[0].peso : null,
    diasSemPesar: base ? Math.max(0, diasEntre(base, hoje)) : null,
  };
};

/**
 * Alertas do lote (só os dois da lista fechada).
 * @param {PesagemVm} p
 * @returns {Alerta[]}
 */
const alertasDe = (p) => {
  /** @type {Alerta[]} */
  const al = [];
  if (p.diasSemPesar !== null && p.diasSemPesar > DIAS_PESAGEM_ATRASADA) {
    al.push({ tipo: 'pesagem', nivel: 2, rotuloTipo: 'Pesagem atrasada', valor: String(p.diasSemPesar), frase: `Faz ${p.diasSemPesar} dias sem pesar`, tom: 'atencao' });
  }
  if (p.intervalo !== null && p.intervalo < INTERVALO_MINIMO) {
    al.push({ tipo: 'intervalo', nivel: 1, rotuloTipo: 'Intervalo curto', valor: String(p.intervalo), frase: `Pesagens muito próximas (${p.intervalo} dias)`, tom: 'neutro' });
  }
  return al;
};

// ─── Montagem do modelo ─────────────────────────────────────────────────────

/** Totais crus de um conjunto de lotes/posições. @param {any[]} lista @param {Date} hoje */
const agregados = (lista, hoje) => {
  let cab = 0;
  let cabComPeso = 0;
  let pesoVivo = 0;
  let somaDias = 0;
  let cabComDias = 0;
  for (const l of lista) {
    const c = num(l?.quantidade_cabecas) ?? 0;
    const p = positivo(l?.peso_medio_kg);
    cab += c;
    if (p !== null) { pesoVivo += p * c; cabComPeso += c; }
    const e = dataLocal(l?.data_entrada);
    if (e && c > 0) { somaDias += Math.max(0, diasEntre(e, hoje)) * c; cabComDias += c; }
  }
  return {
    cab,
    pesoVivo,
    temPeso: cabComPeso > 0,
    ua: pesoVivo / UA_KG,
    pesoMedio: cabComPeso > 0 ? pesoVivo / cabComPeso : null,
    dias: cabComDias > 0 ? Math.round(somaDias / cabComDias) : null,
  };
};

/**
 * Modelo da aba Detalhes (cartão da área, Lotação e Categorias).
 * @param {any} area @param {any[]} lista lotes ativos na área @param {Date} hoje
 * @param {Map<string, any>} categoriasPorId Categorias de Manejo por id (subícone)
 * @returns {AreaVm}
 */
const montarArea = (area, lista, hoje, categoriasPorId) => {
  const hectares = positivo(area?.tamanho_hectares);
  const haPastejada = positivo(area?.area_pastejada);
  const ha = haPastejada ?? hectares; // efetiva, igual MapaInsights
  const ag = agregados(lista, hoje);
  const ua = ag.temPeso ? ag.ua : null;
  const uaHa = ua !== null && ha !== null ? ua / ha : null;
  const faixa = faixaDe(ag.cab, uaHa);
  const capacidade = positivo(area?.capacidade_maxima); // UA TOTAL da área (MapaInsights)
  const capUAha = capacidade !== null && ha !== null ? capacidade / ha : null;
  const pctCap = capacidade !== null && ua !== null ? (ua / capacidade) * 100 : null;
  const acimaDaCapacidade = pctCap !== null && pctCap > 100;

  // Composição por categoria (ordem alfabética)
  /** @type {Map<string, { cab: number, peso: number, cabPeso: number, posicoes: any[] }>} */
  const porCat = new Map();
  for (const l of lista) {
    const nome = texto(l?.categoria);
    const c = num(l?.quantidade_cabecas) ?? 0;
    const p = positivo(l?.peso_medio_kg);
    const g = porCat.get(nome) || { cab: 0, peso: 0, cabPeso: 0, posicoes: [] };
    g.cab += c;
    if (p !== null) { g.peso += p * c; g.cabPeso += c; }
    g.posicoes.push(l);
    porCat.set(nome, g);
  }
  const categorias = [...porCat.keys()].sort(porNome).map((nome) => {
    const g = /** @type {{ cab: number, peso: number, cabPeso: number, posicoes: any[] }} */ (porCat.get(nome));
    const pct = ag.cab > 0 ? (g.cab / ag.cab) * 100 : 0;
    const pctTexto = fmtPct(pct);
    const peso = g.cabPeso > 0 ? fmtInt(g.peso / g.cabPeso) : VAZIO;
    return {
      nome,
      cab: g.cab,
      pct,
      pctTexto,
      // "20% do pasto · peso 196 kg" (sem peso, só a participação).
      descricao: peso === VAZIO ? `${pctTexto} do pasto` : `${pctTexto} do pasto · peso ${peso} kg`,
      valor: `${fmtInt(g.cab)} cab`,
      // D-PROD-191: o animal do grupo (mais cabeças; empate → faixa mais velha), nunca misto.
      subicone: figuraDoGrupo(g.posicoes, categoriasPorId)?.figura ?? null,
    };
  });

  /** @type {Array<{ frase: string, tom: Tom }>} */
  const alertas = [];
  if (acimaDaCapacidade) {
    alertas.push({
      frase: uaHa !== null && capUAha !== null
        ? `Lotação de ${fmtNum(uaHa)} UA/ha acima da capacidade cadastrada (${fmtNum(capUAha)} UA/ha).`
        : `Lotação de ${fmtNum(ua)} UA acima da capacidade cadastrada (${fmtNum(capacidade)} UA).`,
      tom: 'atencao',
    });
  }

  return {
    nome: area?.nome ? String(area.nome) : '',
    sub: [area?.tipo_cultura, area?.tipo_pastagem].map((v) => (v === null || v === undefined ? '' : String(v).trim())).filter(Boolean).join(' / '),
    hectares,
    haPastejada,
    ha,
    cab: ag.cab,
    faixa,
    campos: {
      hectares: { chave: 'hectares', rotulo: 'Hectares', texto: fmtNum(hectares ?? ha) },
      haPastejada: { chave: 'haPastejada', rotulo: 'Área pastejada (ha)', texto: fmtNum(haPastejada) },
      pastagem: { chave: 'pastagem', rotulo: 'Pastagem', texto: cru(area?.tipo_pastagem) },
      dias: { chave: 'dias', rotulo: 'Dias pastejo', texto: fmtInt(ag.dias) },
    },
    lotacao: [
      { chave: 'qtdLotes', rotulo: 'Qtd. Lotes', texto: fmtInt(lista.length) },
      { chave: 'qtdCab', rotulo: 'Qtd. Cabeças', texto: fmtInt(ag.cab) },
      { chave: 'uaTotal', rotulo: 'UA total', texto: fmtNum(ua ?? (ag.cab > 0 ? null : 0)), dica: 'peso vivo ÷ 450' },
      { chave: 'uaHa', rotulo: 'UA/ha', texto: fmtNum(uaHa), dot: faixa.cor, ...(faixa.rotuloLongo !== VAZIO ? { dica: faixa.rotuloLongo } : {}) },
      { chave: 'capacidade', rotulo: 'Capacidade (UA/ha)', texto: fmtNum(capUAha), dica: 'capacidade máxima ÷ hectares' },
      {
        chave: 'pctCap', rotulo: '% da capacidade', texto: fmtPct(pctCap), cor: acimaDaCapacidade ? COR_ATENCAO : COR_TEXTO,
        ...(pctCap !== null ? { barra: Math.min(100, pctCap) } : {}),
        ...(acimaDaCapacidade ? { corBarra: COR_BARRA_ATENCAO } : {}),
      },
      { chave: 'kgPvHa', rotulo: 'kg PV/ha', texto: ha !== null && ag.temPeso ? fmtInt(ag.pesoVivo / ha) : VAZIO },
      { chave: 'cabHa', rotulo: 'Cab/ha', texto: ha !== null && ag.cab > 0 ? fmtNum(ag.cab / ha) : VAZIO },
      { chave: 'pesoMedio', rotulo: 'Peso médio geral (kg)', texto: fmtNum(ag.pesoMedio) },
    ],
    categorias,
    alertas,
  };
};

/**
 * Status do cartão da área: OCUPADO com cabeças; vazio com saída registrada →
 * "VAZIO · descanso há N dias" desde a saída MAIS RECENTE (a mesma regra da
 * situação do pasto no mapa, `calcularSituacaoPasto`); senão VAZIO. Vazio em cinza.
 * @param {{ areaId?: string|null, cab: number, movimentacoes?: any[]|null, hoje?: Date }} p
 * @returns {{ texto: string, cor: string, descansoDias: number|null }}
 */
export function statusDaArea({ areaId, cab, movimentacoes, hoje }) {
  if (cab > 0) return { texto: 'OCUPADO', cor: COR_TEXTO, descansoDias: null };
  const id = areaId ? String(areaId) : '';
  const situacao = id
    ? calcularSituacaoPasto({ areas: [{ id }], lotes: [], movimentacoes: Array.isArray(movimentacoes) ? movimentacoes : [], agora: hoje instanceof Date ? hoje : new Date() })[id]
    : null;
  const dias = situacao?.tipo === 'descanso' && situacao.dias ? situacao.dias : null;
  if (dias === null) return { texto: 'VAZIO', cor: COR_META, descansoDias: null };
  return { texto: `VAZIO · descanso há ${fmtInt(dias)} ${dias === 1 ? 'dia' : 'dias'}`, cor: COR_META, descansoDias: dias };
}

/**
 * As 6 células do cartão da área, na ordem do v12: Setor · Hectares · Área
 * pastejada (ha) · Pastagem · Status · Dias pastejo.
 * @param {AreaVm} area
 * @param {{ setor?: string|null, status: { texto: string, cor: string } }} extra
 * @returns {CampoTexto[]}
 */
export function camposDoCartaoDaArea(area, { setor, status }) {
  return [
    { chave: 'setor', rotulo: 'Setor', texto: cru(setor) },
    area.campos.hectares,
    area.campos.haPastejada,
    area.campos.pastagem,
    { chave: 'status', rotulo: 'Status', texto: status.texto, cor: status.cor },
    area.campos.dias,
  ];
}

/**
 * Modelo de um lote/posição.
 * @param {any} raw
 * @param {{ hoje: Date, ha: number|null, totalCab: number, uaTotal: number, movimentacoes: any[], categoriasPorId: Map<string, any> }} ctx
 * @returns {LoteVm}
 */
const montarLote = (raw, ctx) => {
  const cab = num(raw?.quantidade_cabecas) ?? 0;
  const peso = positivo(raw?.peso_medio_kg);
  const pesoTotal = peso !== null ? peso * cab : null;
  const ua = pesoTotal !== null ? pesoTotal / UA_KG : null;
  const entrada = dataLocal(raw?.data_entrada);
  const categoria = texto(raw?.categoria);
  const sexo = texto(raw?.sexo);
  const pesagem = pesagemDe(raw, ctx.hoje, ctx.movimentacoes);
  const alertas = alertasDe(pesagem);
  const alertasVisiveis = alertas.filter((a) => a.nivel >= 2);
  const gravidade = alertas.reduce((m, a) => Math.max(m, a.nivel), 0);
  /** @type {Situacao} */
  const situacao = gravidade >= 2 ? { rotulo: 'Atenção', tom: 'atencao' } : { rotulo: 'Em dia', tom: 'ok' };
  const kgPvHa = pesoTotal !== null && ctx.ha !== null ? pesoTotal / ctx.ha : null;

  /** @type {LoteVm} */
  const vm = {
    id: String(raw?.id ?? ''),
    nome: raw?.nome ? String(raw.nome) : VAZIO,
    categoria,
    sexo,
    sub: juntar([categoria, sexo]) || VAZIO,
    // D-PROD-191: o animal desta posição, na cor do sexo dela (nunca misto).
    subicone: figuraDaPosicao(raw, ctx.categoriasPorId)?.figura ?? null,
    cab,
    peso,
    pesoTotal,
    ua,
    uaHa: ua !== null && ctx.ha !== null ? ua / ctx.ha : null,
    kgPvHa,
    partCab: ctx.totalCab > 0 ? (cab / ctx.totalCab) * 100 : null,
    partUA: ua !== null && ctx.uaTotal > 0 ? (ua / ctx.uaTotal) * 100 : null,
    diasPastejo: entrada ? Math.max(0, diasEntre(entrada, ctx.hoje)) : null,
    pesagem,
    // D-PROD-198: projeção do servidor (lista de posições); indisponível → null.
    projecao: raw?.projecao_peso && raw.projecao_peso.disponivel ? raw.projecao_peso : null,
    ident: {
      sexo,
      sistema: texto(raw?.sistema_produtivo),
      identificador: texto(raw?.identificador_nome),
      identificadorCor: raw?.identificador_cor ? String(raw.identificador_cor) : null,
      sigla: texto(raw?.identificador_sigla),
      entrada: entrada ? isoLocal(entrada) : null,
      catManejo: texto(raw?.categoria_manejo_nome),
    },
    alertas,
    alertasVisiveis,
    gravidade,
    situacao,
    valores: {},
    textos: {
      // "38 cb · 38,0 UA · VACA" (sem UA ou sem categoria, a parte some).
      meta: juntar([`${fmtInt(cab)} cb`, ua !== null ? `${fmtNum(ua, 1)} UA` : null, categoria]),
      pesoKg: peso !== null ? `${fmtNum(peso, 1)} kg` : VAZIO,
    },
    raw,
  };
  vm.valores = Object.fromEntries(CAMPOS_LOTE.map((c) => [c.chave, c.get(vm)]));
  return vm;
};

/**
 * Monta tudo o que o diálogo mostra.
 * - `lotes`: os do diálogo (as posições do pasto clicado) → LoteVm, % e totais da aba Lotes.
 * - `lotesDaArea`: todos os ativos na área → aba Detalhes (vazio → usa `lotes`).
 * - `movimentacoes`: cache 'movimentacoes' do mapa → pesagens (canceladas são ignoradas).
 * - `categoriasManejo`: cache 'categoriasManejo' do mapa (lista ou Map por id) → subícone de
 *   cada lote e de cada categoria da área (D-PROD-191). Ícone por upload (ConfiguracaoIcone)
 *   não entra aqui.
 * @param {{ area: any, lotes?: any[], lotesDaArea?: any[], movimentacoes?: any[], categoriasManejo?: any[]|Map<string, any>|null, hoje?: Date }} p
 * @returns {ModeloDetalhes}
 */
export function montarModeloDetalhes({ area, lotes = [], lotesDaArea = [], movimentacoes = [], categoriasManejo = [], hoje }) {
  const h = hoje instanceof Date && !Number.isNaN(hoje.getTime()) ? new Date(hoje) : new Date();
  h.setHours(0, 0, 0, 0);
  const lista = Array.isArray(lotes) ? lotes : [];
  const naArea = Array.isArray(lotesDaArea) && lotesDaArea.length ? lotesDaArea : lista;
  const movs = Array.isArray(movimentacoes) ? movimentacoes : [];
  const categoriasPorId = mapaDeCategorias(categoriasManejo);

  const areaVm = montarArea(area, naArea, h, categoriasPorId);
  const ha = areaVm.ha;
  const ag = agregados(lista, h);
  const lotesVm = lista.map((raw) => montarLote(raw, { hoje: h, ha, totalCab: ag.cab, uaTotal: ag.ua, movimentacoes: movs, categoriasPorId }));
  const uaHa = ag.temPeso && ha !== null ? ag.ua / ha : null;

  /** @type {ModeloDetalhes} */
  const modelo = {
    area: areaVm,
    lotes: lotesVm,
    resumo: {
      pesoMedio: fmtNum(ag.pesoMedio, 1),
      cab: fmtInt(ag.cab),
      uaHa: fmtNum(uaHa),
      kgPvHa: ag.temPeso && ha !== null ? fmtInt(ag.pesoVivo / ha) : VAZIO,
    },
    totais: {},
    ctx: { ha, totalCab: ag.cab, uaTotal: ag.ua, pesoVivoTotal: ag.pesoVivo, hoje: h },
  };
  modelo.totais = Object.fromEntries(CAMPOS_LOTE.map((c) => [c.chave, c.total(modelo)]));
  return modelo;
}
