/**
 * Peso projetado do lote (D-PROD-198) — leitura pura, nada é gravado.
 *
 * O peso de uma posição (lote no mapa) num momento é:
 *
 *   peso projetado = peso da BASE + Σ GMD(dia) para cada dia depois da base
 *
 * onde GMD(dia) é o ganho médio diário do MÊS daquele dia na Curva de Ganho da
 * Categoria de Manejo da posição (D-PROD-194/195). A BASE é o último peso
 * gravado da posição (entrada, pesagem — inclusive a estimada "no olho" — ou
 * saldo de abertura).
 *
 * Peso DERIVADO: transferência, mudança de categoria e junção gravam no destino a
 * média ponderada do peso REGISTRADO das origens (`dados.pesos_derivados` do
 * evento). Usar esse número cru como base perderia o ganho das origens desde a
 * última pesagem delas — o boi que passou 30 dias no pasto e foi para o
 * confinamento "voltaria" ao peso de 30 dias atrás. Por isso a base derivada é
 * recalculada com o peso PROJETADO de cada origem (e do saldo que já estava no
 * destino) no instante do evento. Recursão com memória e limite de profundidade;
 * qualquer peso desconhecido cai para o valor gravado (nunca inventa).
 *
 * Arroba de peso vivo = kg ÷ 30 (decisão do proprietário).
 */

export const MESES_CURVA = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);
export const KG_POR_ARROBA = 30;
/** Horizonte máximo da busca da data em que o lote atinge o peso objetivo. */
export const HORIZONTE_OBJETIVO_DIAS = 1095;
const PROFUNDIDADE_MAXIMA = 60;

const DIA_MS = 86_400_000;
const msDoDia = (dia) => Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)));
const diaDeMs = (ms) => new Date(ms).toISOString().slice(0, 10);
export const somarDias = (dia, n) => diaDeMs(msDoDia(dia) + n * DIA_MS);
export const diasEntre = (de, ate) => Math.round((msDoDia(ate) - msDoDia(de)) / DIA_MS);
const ultimoDiaDoMes = (ano, mes0) => diaDeMs(Date.UTC(ano, mes0 + 1, 0));
const r2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** GMD (kg/dia) do mês `mes0` (0 = janeiro) na curva; curva ausente → 0. */
export const gmdDoMes = (curva, mes0) => (curva ? Number(curva[`gmd_${MESES_CURVA[mes0]}`] ?? 0) || 0 : 0);

/** GMD do mês de um dia AAAA-MM-DD. */
export const gmdDoDia = (curva, dia) => gmdDoMes(curva, Number(dia.slice(5, 7)) - 1);

/**
 * Ganho (kg) somando o GMD de cada dia em (de, ate] — o dia da base não conta,
 * o dia-alvo conta. `ate` ≤ `de` → 0. Mês a mês (não dia a dia).
 */
export const ganhoNoPeriodo = (curva, de, ate) => {
  if (!curva || !de || !ate || ate <= de) return 0;
  let ganho = 0;
  let cursor = somarDias(de, 1);
  while (cursor <= ate) {
    const ano = Number(cursor.slice(0, 4));
    const mes0 = Number(cursor.slice(5, 7)) - 1;
    const fimMes = ultimoDiaDoMes(ano, mes0);
    const fim = fimMes < ate ? fimMes : ate;
    ganho += gmdDoMes(curva, mes0) * (diasEntre(cursor, fim) + 1);
    cursor = somarDias(fim, 1);
  }
  return ganho;
};

/**
 * Primeiro dia depois de `de` em que `peso + ganho ≥ objetivo`, dentro do horizonte.
 * Já atingido → `de`. Curva sem ganho → null.
 */
export const diaQueAtinge = (curva, de, peso, objetivo, horizonte = HORIZONTE_OBJETIVO_DIAS) => {
  if (objetivo === null || objetivo === undefined || peso === null || peso === undefined) return null;
  if (peso >= objetivo) return de;
  let acumulado = peso;
  let dia = de;
  for (let i = 0; i < horizonte; i += 1) {
    dia = somarDias(dia, 1);
    acumulado += gmdDoDia(curva, dia);
    if (acumulado >= objetivo) return dia;
  }
  return null;
};

/** Combina [(cabeças, peso)] como o núcleo do ledger: peso desconhecido com cabeças → null. */
const combinar = (pares) => {
  const validos = pares.filter(([q]) => q > 0);
  if (!validos.length) return null;
  if (validos.some(([, w]) => w === null || w === undefined || !Number.isFinite(w))) return null;
  const total = validos.reduce((t, [q]) => t + q, 0);
  return validos.reduce((t, [q, w]) => t + q * w, 0) / total;
};

/**
 * Ordem total dos fatos, a mesma do núcleo (dia, registrado_em, id do evento).
 * @param {{dia: string, registrado_em: string, id: string}} ev
 */
const ordemDoEvento = (ev) => `${ev.dia}|${ev.registrado_em}|${ev.id}`;

/**
 * Projetor sobre os dados já carregados (puro: testável sem banco).
 * @param {{
 *   posicoes: Map<string, {categoria_manejo_id: string|null}>,
 *   categorias: Map<string, {curva: Record<string, unknown>|null, peso_objetivo_kg: number|null}>,
 *   eventos: Map<string, {id: string, tipo: string, dia: string, registrado_em: string, dados: any}>,
 *   pesos: Array<{posicao_id: string, evento_id: string, dia: string, peso: number|null, medido: boolean}>,
 *   partidas: Array<{posicao_id: string, evento_id: string, dia: string, delta: number}>,
 * }} dados
 */
export const criarProjetor = ({ posicoes, categorias, eventos, pesos, partidas }) => {
  /** @type {Map<string, Array<any>>} */
  const pesosPorPosicao = new Map();
  for (const w of pesos) {
    const ev = eventos.get(w.evento_id);
    if (!ev) continue;
    const item = { ...w, ordem: ordemDoEvento(ev), ev };
    const lista = pesosPorPosicao.get(w.posicao_id) ?? [];
    lista.push(item);
    pesosPorPosicao.set(w.posicao_id, lista);
  }
  for (const lista of pesosPorPosicao.values()) lista.sort((a, b) => (a.ordem < b.ordem ? -1 : a.ordem > b.ordem ? 1 : 0));
  /** @type {Map<string, Array<any>>} */
  const partidasPorPosicao = new Map();
  for (const x of partidas) {
    const ev = eventos.get(x.evento_id);
    if (!ev) continue;
    const lista = partidasPorPosicao.get(x.posicao_id) ?? [];
    lista.push({ ...x, ordem: ordemDoEvento(ev) });
    partidasPorPosicao.set(x.posicao_id, lista);
  }

  const categoriaDe = (posicaoId) => {
    const p = posicoes.get(posicaoId);
    return p?.categoria_manejo_id ? categorias.get(p.categoria_manejo_id) ?? null : null;
  };
  const curvaDe = (posicaoId) => categoriaDe(posicaoId)?.curva ?? null;

  /** Último peso da posição até o momento (inclusive, ou estritamente antes de `antesDe`). */
  const ultimoPeso = (posicaoId, momento) => {
    const lista = pesosPorPosicao.get(posicaoId) ?? [];
    for (let i = lista.length - 1; i >= 0; i -= 1) {
      const w = lista[i];
      if (momento.antesDe ? w.ordem < momento.antesDe && w.evento_id !== momento.eventoId : w.dia <= momento.dia) return w;
    }
    return null;
  };

  const saldoAntes = (posicaoId, ev) => (partidasPorPosicao.get(posicaoId) ?? [])
    .filter((x) => x.evento_id !== ev.id && x.ordem < ordemDoEvento(ev))
    .reduce((t, x) => t + x.delta, 0);

  const memo = new Map();

  /** Valor da base: o gravado, ou o derivado recalculado com o projetado das origens. */
  const valorDaBase = (posicaoId, w, profundidade) => {
    const gravado = w.peso === null || w.peso === undefined ? null : Number(w.peso);
    const desc = w.medido ? null : (Array.isArray(w.ev?.dados?.pesos_derivados) ? w.ev.dados.pesos_derivados : []).find((d) => d?.destino_posicao_id === posicaoId);
    if (!desc || profundidade >= PROFUNDIDADE_MAXIMA) return gravado;
    const antes = { antesDe: w.ordem, eventoId: w.ev.id, dia: w.dia };
    const pares = [];
    const s = saldoAntes(posicaoId, w.ev);
    if (s > 0) pares.push([s, projetarNoMomento(posicaoId, antes, profundidade + 1)?.peso ?? null]);
    for (const e of Array.isArray(desc.entradas) ? desc.entradas : []) {
      const q = Number(e?.q) || 0;
      const peso = e?.posicao_id ? projetarNoMomento(e.posicao_id, antes, profundidade + 1)?.peso ?? null : e?.peso_informado ?? null;
      pares.push([q, peso === null ? null : Number(peso)]);
    }
    const v = combinar(pares);
    return v === null ? gravado : v;
  };

  /**
   * Peso projetado da posição no fim do dia `momento.dia` (ou imediatamente antes de um evento).
   * @returns {{peso: number|null, base: any}|null}
   */
  function projetarNoMomento(posicaoId, momento, profundidade = 0) {
    const chave = `${posicaoId}@${momento.antesDe ?? momento.dia}`;
    if (memo.has(chave)) return memo.get(chave);
    const w = ultimoPeso(posicaoId, momento);
    let r = null;
    if (w) {
      const base = valorDaBase(posicaoId, w, profundidade);
      r = { peso: base === null ? null : base + ganhoNoPeriodo(curvaDe(posicaoId), w.dia, momento.dia), base: { ...w, valor: base } };
    }
    memo.set(chave, r);
    return r;
  }

  /**
   * Resumo público da projeção de uma posição em `hoje`.
   * @param {string} posicaoId
   * @param {string} hoje AAAA-MM-DD
   */
  const resumo = (posicaoId, hoje) => {
    const categoria = categoriaDe(posicaoId);
    const curva = categoria?.curva ?? null;
    const objetivo = categoria?.peso_objetivo_kg ?? null;
    const p = projetarNoMomento(posicaoId, { dia: hoje });
    if (!p || p.peso === null) {
      return { disponivel: false, motivo: p ? 'peso_desconhecido' : 'sem_peso', sem_curva: !curva, peso_objetivo_kg: objetivo };
    }
    const base = p.base;
    const dataAtinge = objetivo === null ? null : diaQueAtinge(curva, hoje, p.peso, objetivo);
    // Pesado × previsto: a última PESAGEM comparada com o projetado logo antes dela.
    const lista = pesosPorPosicao.get(posicaoId) ?? [];
    const pesagem = [...lista].reverse().find((w) => w.ev?.tipo === 'PESAGEM' && w.dia <= hoje && w.peso !== null);
    let ultimaPesagem = null;
    if (pesagem) {
      const previsto = projetarNoMomento(posicaoId, { antesDe: pesagem.ordem, eventoId: pesagem.ev.id, dia: pesagem.dia })?.peso ?? null;
      const pesado = Number(pesagem.peso);
      ultimaPesagem = {
        dia: pesagem.dia,
        peso_kg: r2(pesado),
        previsto_kg: r2(previsto),
        percentual_do_previsto: previsto ? r2((pesado / previsto) * 100) : null,
      };
    }
    const meses = [];
    let ano = Number(hoje.slice(0, 4));
    let mes0 = Number(hoje.slice(5, 7)) - 1;
    for (let i = 0; i < 12; i += 1) {
      const fim = ultimoDiaDoMes(ano, mes0);
      const peso = p.peso + ganhoNoPeriodo(curva, hoje, fim);
      meses.push({ mes: fim.slice(0, 7), dia: fim, peso_kg: r2(peso), arroba: r2(peso / KG_POR_ARROBA) });
      mes0 += 1;
      if (mes0 > 11) { mes0 = 0; ano += 1; }
    }
    return {
      disponivel: true,
      dia: hoje,
      peso_kg: r2(p.peso),
      arroba: r2(p.peso / KG_POR_ARROBA),
      sem_curva: !curva,
      gmd_hoje_kg: r2(gmdDoDia(curva, hoje)),
      base: {
        dia: base.dia,
        tipo: base.ev?.tipo ?? null,
        peso_gravado_kg: r2(base.peso === null ? null : Number(base.peso)),
        peso_kg: r2(base.valor),
        derivado: base.valor !== null && base.peso !== null && Math.abs(base.valor - Number(base.peso)) > 1e-9,
        dias: diasEntre(base.dia, hoje),
      },
      peso_objetivo_kg: objetivo,
      falta_kg: objetivo === null ? null : r2(Math.max(0, objetivo - p.peso)),
      atingiu_objetivo: objetivo === null ? null : p.peso >= objetivo,
      data_prevista_objetivo: dataAtinge,
      dias_para_objetivo: dataAtinge === null ? null : diasEntre(hoje, dataAtinge),
      ultima_pesagem: ultimaPesagem,
      projecao_mensal: meses,
    };
  };

  return { projetarNoMomento, resumo };
};

const diaIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/**
 * Carrega o que a projeção da empresa precisa (uma consulta por tabela) e
 * devolve o projetor. Inclui posições vazias: são origens de pesos derivados.
 * @param {any} db cliente Prisma (ou transação)
 * @param {string} clienteId
 * @param {string} empresaId
 */
export const carregarProjetorDaEmpresa = async (db, clienteId, empresaId) => {
  const [ps, cats, ws, xs] = await Promise.all([
    db.posicaoRebanho.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId }, select: { id: true, categoria_manejo_id: true } }),
    db.categoriaManejo.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId },
      select: { id: true, peso_objetivo_kg: true, curvaGanho: { select: Object.fromEntries(MESES_CURVA.map((m) => [`gmd_${m}`, true])) } },
    }),
    db.pesoRebanho.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, ativa: true },
      select: { posicao_id: true, evento_id: true, data_operacional: true, peso_medio_kg: true, medido: true },
    }),
    db.partidaRebanho.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, ativa: true },
      select: { posicao_id: true, evento_id: true, data_operacional: true, delta: true },
    }),
  ]);
  const idsEventos = [...new Set([...ws.map((w) => w.evento_id), ...xs.map((x) => x.evento_id)])];
  const evs = idsEventos.length
    ? await db.eventoRebanho.findMany({
        where: { cliente_id: clienteId, id: { in: idsEventos } },
        select: { id: true, tipo: true, data_operacional: true, registrado_em: true, dados: true },
      })
    : [];
  return criarProjetor({
    posicoes: new Map(ps.map((p) => [p.id, { categoria_manejo_id: p.categoria_manejo_id ?? null }])),
    categorias: new Map(cats.map((c) => [c.id, {
      curva: c.curvaGanho ?? null,
      peso_objetivo_kg: c.peso_objetivo_kg === null || c.peso_objetivo_kg === undefined ? null : Number(c.peso_objetivo_kg),
    }])),
    eventos: new Map(evs.map((e) => [e.id, {
      id: e.id, tipo: e.tipo, dia: diaIso(e.data_operacional),
      registrado_em: e.registrado_em instanceof Date ? e.registrado_em.toISOString() : String(e.registrado_em), dados: e.dados,
    }])),
    pesos: ws.map((w) => ({ posicao_id: w.posicao_id, evento_id: w.evento_id, dia: diaIso(w.data_operacional), peso: w.peso_medio_kg === null ? null : Number(w.peso_medio_kg), medido: Boolean(w.medido) })),
    partidas: xs.map((x) => ({ posicao_id: x.posicao_id, evento_id: x.evento_id, dia: diaIso(x.data_operacional), delta: x.delta })),
  });
};
