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
 * destino) no instante do evento;
 * qualquer peso desconhecido cai para o valor gravado (nunca inventa). A conta é uma
 * programação dinâmica na ordem dos fatos (sem recursão nem limite de profundidade).
 *
 * Arroba de peso vivo = kg ÷ 30 (decisão do proprietário).
 */

export const MESES_CURVA = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);
export const KG_POR_ARROBA = 30;
/** Horizonte máximo da busca da data em que o lote atinge o peso objetivo. */
export const HORIZONTE_OBJETIVO_DIAS = 1095;

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
    // Tolerância: somar 0,7 várias vezes não dá exatamente o objetivo (ponto flutuante).
    if (acumulado >= objetivo - 1e-9) return dia;
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
 *
 * Programação dinâmica na ordem dos fatos: cada peso gravado recebe, uma vez, o
 * VALOR da base (o gravado, ou o derivado recalculado pelo projetado das origens
 * e do saldo que já estava no destino). Como um derivado só depende de pesos de
 * fatos ESTRITAMENTE anteriores, percorrer os pesos em ordem resolve tudo sem
 * recursão nem limite de profundidade (rodízio longo de pastos não trunca).
 * @param {{
 *   posicoes: Map<string, {categoria_manejo_id: string|null}>,
 *   categorias: Map<string, {curva: Record<string, unknown>|null, peso_objetivo_kg: number|null}>,
 *   eventos: Map<string, {id: string, tipo: string, dia: string, registrado_em: string, dados: any}>,
 *   pesos: Array<{posicao_id: string, evento_id: string, dia: string, peso: number|null, medido: boolean, criado_em?: string, id?: string}>,
 *   partidas: Array<{posicao_id: string, evento_id: string, dia: string, delta: number}>,
 * }} dados
 */
export const criarProjetor = ({ posicoes, categorias, eventos, pesos, partidas }) => {
  // Ordem total: a do fato (dia, registrado_em, id) e, dentro do mesmo fato, a
  // do núcleo (`createdAt`, `id` da observação) — a última gravada vale.
  const chaveDoPeso = (w) => `${w.ordem}|${w.criado_em ?? ''}|${w.id ?? ''}`;
  const todos = [];
  /** @type {Map<string, Array<any>>} */
  const pesosPorPosicao = new Map();
  for (const w of pesos) {
    const ev = eventos.get(w.evento_id);
    if (!ev) continue;
    const ordem = ordemDoEvento(ev);
    const item = { ...w, ordem, ev, valor: undefined, chave: chaveDoPeso({ ...w, ordem }) };
    todos.push(item);
    const lista = pesosPorPosicao.get(w.posicao_id) ?? [];
    lista.push(item);
    pesosPorPosicao.set(w.posicao_id, lista);
  }
  const porChave = (a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0);
  todos.sort(porChave);
  for (const lista of pesosPorPosicao.values()) lista.sort(porChave);
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

  const saldoAntes = (posicaoId, ev) => {
    const ordem = ordemDoEvento(ev);
    let s = 0;
    for (const x of partidasPorPosicao.get(posicaoId) ?? []) if (x.evento_id !== ev.id && x.ordem < ordem) s += x.delta;
    return s;
  };

  const gravadoDe = (w) => (w.peso === null || w.peso === undefined ? null : Number(w.peso));

  /**
   * Peso projetado da posição no fim do dia `momento.dia` (ou imediatamente antes de um evento).
   * Usa o VALOR já resolvido da base (a DP abaixo resolve todos antes de qualquer consulta).
   * @returns {{peso: number|null, base: any}|null}
   */
  const projetarNoMomento = (posicaoId, momento) => {
    const w = ultimoPeso(posicaoId, momento);
    if (!w) return null;
    const base = w.valor === undefined ? gravadoDe(w) : w.valor;
    return { peso: base === null ? null : base + ganhoNoPeriodo(curvaDe(posicaoId), w.dia, momento.dia), base: { ...w, valor: base } };
  };

  // DP: o valor de cada base, na ordem dos fatos. Há descritor para o destino →
  // recalcula SEMPRE (inclusive com `medido`: o núcleo marca medido olhando só as
  // entradas, mas o gravado mistura o saldo anterior com o peso REGISTRADO dele).
  for (const w of todos) {
    const gravado = gravadoDe(w);
    const desc = (Array.isArray(w.ev?.dados?.pesos_derivados) ? w.ev.dados.pesos_derivados : []).find((d) => d?.destino_posicao_id === w.posicao_id);
    if (!desc) { w.valor = gravado; continue; }
    const antes = { antesDe: w.ordem, eventoId: w.ev.id, dia: w.dia };
    const pares = [];
    const s = saldoAntes(w.posicao_id, w.ev);
    if (s > 0) pares.push([s, projetarNoMomento(w.posicao_id, antes)?.peso ?? null]);
    for (const e of Array.isArray(desc.entradas) ? desc.entradas : []) {
      const q = Number(e?.q) || 0;
      const peso = e?.posicao_id ? projetarNoMomento(e.posicao_id, antes)?.peso ?? null : e?.peso_informado ?? null;
      pares.push([q, peso === null ? null : Number(peso)]);
    }
    const v = combinar(pares);
    w.valor = v === null ? gravado : v;
  }

  /**
   * Resumo público da projeção de uma posição em `hoje`.
   * @param {string} posicaoId
   * @param {string} hoje AAAA-MM-DD
   */
  const resumo = (posicaoId, hoje) => {
    const categoria = categoriaDe(posicaoId);
    // Sem fuso configurado não há "hoje" da fazenda: a lista segue, sem projeção (D-PROD-122: leitura não exige fuso).
    if (!hoje) return { disponivel: false, motivo: 'sem_fuso', sem_curva: !categoria?.curva, peso_objetivo_kg: categoria?.peso_objetivo_kg ?? null };
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
 * Carrega o que a projeção da empresa precisa e devolve o projetor. Inclui
 * posições vazias: são origens de pesos derivados.
 *
 * Os eventos vêm por FILTRO da empresa (nunca uma lista `IN` de ids, que estoura
 * o limite de parâmetros do Postgres com dezenas de milhares de fatos), e do JSON
 * `dados` só o descritor `pesos_derivados` (o resto do documento não interessa).
 * @param {any} db cliente Prisma (ou transação)
 * @param {string} clienteId
 * @param {string} empresaId
 */
export const carregarProjetorDaEmpresa = async (db, clienteId, empresaId) => {
  const [ps, cats, ws, xs, evs] = await Promise.all([
    db.posicaoRebanho.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId }, select: { id: true, categoria_manejo_id: true } }),
    db.categoriaManejo.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId },
      select: { id: true, peso_objetivo_kg: true, curvaGanho: { select: Object.fromEntries(MESES_CURVA.map((m) => [`gmd_${m}`, true])) } },
    }),
    db.pesoRebanho.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, ativa: true },
      select: { id: true, posicao_id: true, evento_id: true, data_operacional: true, peso_medio_kg: true, medido: true, createdAt: true },
    }),
    db.partidaRebanho.findMany({
      where: { cliente_id: clienteId, empresa_id: empresaId, ativa: true },
      select: { posicao_id: true, evento_id: true, data_operacional: true, delta: true },
    }),
    /** @type {Promise<Array<{id: string, tipo: string, data_operacional: Date, registrado_em: Date, pesos_derivados: unknown}>>} */ (db.$queryRaw`
      SELECT e.id, e.tipo, e.data_operacional, e.registrado_em, e.dados -> 'pesos_derivados' AS pesos_derivados
        FROM "EventoRebanho" e
       WHERE e.cliente_id = ${clienteId} AND e.empresa_id = ${empresaId}`),
  ]);
  return criarProjetor({
    posicoes: new Map(ps.map((p) => [p.id, { categoria_manejo_id: p.categoria_manejo_id ?? null }])),
    categorias: new Map(cats.map((c) => [c.id, {
      curva: c.curvaGanho ?? null,
      peso_objetivo_kg: c.peso_objetivo_kg === null || c.peso_objetivo_kg === undefined ? null : Number(c.peso_objetivo_kg),
    }])),
    eventos: new Map(evs.map((e) => [e.id, {
      id: e.id, tipo: e.tipo, dia: diaIso(e.data_operacional),
      registrado_em: e.registrado_em instanceof Date ? e.registrado_em.toISOString() : String(e.registrado_em),
      dados: { pesos_derivados: Array.isArray(e.pesos_derivados) ? e.pesos_derivados : [] },
    }])),
    pesos: ws.map((w) => ({
      posicao_id: w.posicao_id, evento_id: w.evento_id, dia: diaIso(w.data_operacional), peso: w.peso_medio_kg === null ? null : Number(w.peso_medio_kg), medido: Boolean(w.medido),
      criado_em: w.createdAt instanceof Date ? w.createdAt.toISOString() : String(w.createdAt ?? ''), id: w.id,
    })),
    partidas: xs.map((x) => ({ posicao_id: x.posicao_id, evento_id: x.evento_id, dia: diaIso(x.data_operacional), delta: x.delta })),
  });
};
