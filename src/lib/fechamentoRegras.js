/**
 * D-PROD-291 (MAIKE-FECHAMENTO-AREA) — o "Finalizar" com "Fez o pasto todo?" e o resumo "Como ficou".
 *
 * As contas usam os lançamentos CONFIRMADOS da atividade (`GET /atividades/:id/apontamentos`) e só as linhas
 * CONFIRMADAS: jatos (o par lançamento × número do jato), dias com jato, horas de máquina (o uso das linhas que não são
 * de odômetro), o total de cada produto e o custo de tudo (produto, máquina, mão de obra e serviço). Por hectare = total
 * ÷ os hectares informados ao finalizar.
 */

const CONFIRMADO = 'CONFIRMADO';
const ehConfirmado = (/** @type {any} */ x) => x && x.status !== 'CANCELADO' && (x.status === undefined || x.status === CONFIRMADO);
/** @param {unknown} v */
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};
const arred = (/** @type {number} */ n, casas = 4) => Math.round(n * 10 ** casas) / 10 ** casas;

/**
 * @typedef {{ produto_id: string, rotulo: string, unidade: string|null, total: number }} TotalDoProduto
 * @typedef {{ jatos: number, diasComJato: number, horasMaquina: number|null, produtos: TotalDoProduto[], custoTotal: number|null }} Resumo
 */

/**
 * O resumo da atividade a partir dos lançamentos.
 * @param {any[]} apontamentos
 * @returns {Resumo}
 */
export const resumoDosLancamentos = (apontamentos) => {
  const confirmados = (Array.isArray(apontamentos) ? apontamentos : []).filter(ehConfirmado);
  const jatos = new Set();
  const diasComJato = new Set();
  /** @type {Map<string, TotalDoProduto>} */
  const produtos = new Map();
  let horas = 0;
  let temHoras = false;
  let custo = 0;
  let temCusto = false;
  const somarCusto = (/** @type {unknown} */ v) => {
    const n = num(v);
    if (n === null) return;
    custo += n;
    temCusto = true;
  };
  for (const ap of confirmados) {
    for (const l of (ap.produtos ?? []).filter(ehConfirmado)) {
      if (Number.isInteger(l.jato) && l.jato > 0) {
        jatos.add(`${ap.id}:${l.jato}`);
        if (ap.data_operacional) diasComJato.add(String(ap.data_operacional));
      }
      const q = num(l.quantidade);
      const id = String(l.produto_id ?? '');
      if (id && q !== null) {
        const t = produtos.get(id) ?? { produto_id: id, rotulo: String(l.produto?.nome ?? l.produto?.rotulo ?? ''), unidade: l.unidade ?? null, total: 0 };
        t.total = arred(t.total + q);
        produtos.set(id, t);
      }
      somarCusto(l.custo_total);
    }
    for (const l of (ap.maquinas ?? []).filter(ehConfirmado)) {
      if (l.medidor_tipo !== 'ODOMETRO') {
        const u = num(l.quantidade_uso);
        if (u !== null) {
          horas += u;
          temHoras = true;
        }
      }
      somarCusto(l.custo_total);
    }
    for (const l of (ap.mao_obra ?? []).filter(ehConfirmado)) somarCusto(l.custo_total);
    for (const l of (ap.servicos ?? []).filter(ehConfirmado)) somarCusto(l.valor_total);
  }
  return {
    jatos: jatos.size,
    diasComJato: diasComJato.size,
    horasMaquina: temHoras ? arred(horas, 2) : null,
    produtos: [...produtos.values()],
    custoTotal: temCusto ? arred(custo, 2) : null,
  };
};

/** "3,2" (pt-BR, até `casas`). @param {number} n @param {number} [casas] */
export const numeroBr = (n, casas = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
/** "R$ 4.375,00". @param {number} n */
export const reais = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** "L" / "kg". @param {string|null} u */
const rotuloUnidade = (u) => (u === 'KG' ? 'kg' : u === 'L' ? 'L' : u ? String(u).toLowerCase() : '');

/**
 * As linhas do "Como ficou" para os hectares informados (sem hectares, só os totais).
 * @param {Resumo} r @param {number|null} hectares
 * @returns {{ jatos: string|null, horas: string|null, porHectare: Array<{ rotulo: string, texto: string }>, custoTotal: string|null, custoPorHectare: string|null }}
 */
export const linhasDoResumo = (r, hectares) => {
  const ha = hectares !== null && hectares > 0 ? hectares : null;
  return {
    jatos: r.jatos ? `${r.jatos} ${r.jatos === 1 ? 'jato' : 'jatos'}${r.diasComJato > 1 ? ` em ${r.diasComJato} dias` : ''}` : null,
    horas: r.horasMaquina !== null ? `${numeroBr(r.horasMaquina, 1)} ${r.horasMaquina === 1 ? 'hora' : 'horas'}` : null,
    porHectare: r.produtos.map((p) => {
      const u = rotuloUnidade(p.unidade);
      return { rotulo: p.rotulo, texto: ha ? `${numeroBr(p.total / ha, 2)} ${u}/ha`.trim() : `${numeroBr(p.total, 2)} ${u}`.trim() };
    }),
    custoTotal: r.custoTotal !== null ? reais(r.custoTotal) : null,
    custoPorHectare: r.custoTotal !== null && ha ? reais(r.custoTotal / ha) : null,
  };
};

/**
 * Os hectares de uma área no "Fez o pasto todo?": "SIM" = o tamanho (a planejada da área ou o tamanho do pasto);
 * "PARTE" = o digitado (texto pt-BR "12,5"). Devolve o número ou um erro em palavras simples.
 * @param {{ escolha: 'SIM'|'PARTE'|'', digitado: string, tamanho: number|null, jaLancado: number }} a
 * @returns {{ hectares: number|null, erro: string|null }}
 */
export const hectaresDaEscolha = ({ escolha, digitado, tamanho, jaLancado }) => {
  if (escolha === 'SIM') {
    if (tamanho === null || !(tamanho > 0)) return { hectares: null, erro: 'Esta área não tem o tamanho cadastrado: escolha "Não" e digite os hectares.' };
    return { hectares: Math.max(tamanho, jaLancado), erro: null };
  }
  if (escolha === 'PARTE') {
    const n = num(String(digitado ?? '').trim().replace(/\./g, '').replace(',', '.'));
    if (n === null || !(n > 0)) return { hectares: null, erro: 'Digite quantos hectares fez.' };
    if (n < jaLancado) return { hectares: null, erro: `Já foram lançados ${numeroBr(jaLancado, 2)} ha nesta área.` };
    return { hectares: arred(n), erro: null };
  }
  return { hectares: null, erro: 'Escolha se fez o pasto todo.' };
};

/** Texto decimal para o servidor ("12.5"). @param {number} n */
export const hectaresParaCorpo = (n) => String(arred(n));
