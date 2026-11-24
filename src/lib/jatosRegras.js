/**
 * D-PROD-283 (MAIKE-INSUMO-POR-JATO) — "Jatos de hoje": o insumo aplicado com implemento de tanque é lançado por jato.
 *
 * Cada produto de cada jato é um ITEM de insumo do registro de sempre (`itens.produtos`), com `form.jato` = o número do
 * jato no dia (1, 2, 3…). Assim a baixa, o saldo, a dose/ha e o envio são os de sempre; estas funções só agrupam,
 * repetem e somam. Sem cadastro de mistura: "Repetir o jato anterior" copia os produtos e as quantidades do último.
 */
import { corpoDaLinhaProduto, formatarQuantidadeLinha, jatoDoImplemento, unidadeDoProduto } from '@/lib/atividadeLinhasRegras';

/**
 * O tanque do implemento "por jato" entre as máquinas do registro (os itens e o editor aberto), ou `null`.
 * @param {Array<{ form?: any }>} maquinas @param {{ form?: any } | null} [editor]
 * @returns {{ capacidade: string, unidade: string|null } | null}
 */
export const tanqueDoRegistro = (maquinas, editor = null) => {
  for (const m of [...(maquinas ?? []), ...(editor ? [editor] : [])]) {
    const j = jatoDoImplemento(m?.form?.implemento);
    if (j) return j;
  }
  return null;
};

/** "2.000 L" (a capacidade do tanque). @param {{ capacidade: string, unidade: string|null } | null} tanque */
export const rotuloDoTanque = (tanque) => {
  if (!tanque) return '';
  const n = Number(tanque.capacidade);
  const cap = Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : String(tanque.capacidade);
  return tanque.unidade ? `${cap} ${tanque.unidade === 'KG' ? 'kg' : tanque.unidade}` : cap;
};

/**
 * Os jatos do dia, em ordem: `[{ numero, itens }]` (só os itens com jato).
 * @template {{ form: any }} T
 * @param {T[]} produtos
 * @returns {Array<{ numero: number, itens: T[] }>}
 */
export const jatosDosItens = (produtos) => {
  /** @type {Map<number, T[]>} */
  const porNumero = new Map();
  for (const i of produtos ?? []) {
    const n = i?.form?.jato;
    if (!Number.isInteger(n) || n < 1) continue;
    if (!porNumero.has(n)) porNumero.set(n, []);
    porNumero.get(n)?.push(i);
  }
  return [...porNumero.entries()].sort((a, b) => a[0] - b[0]).map(([numero, itens]) => ({ numero, itens }));
};

/** O próximo número de jato (o maior + 1; o primeiro é 1). @param {Array<{ form: any }>} produtos */
export const proximoJato = (produtos) => jatosDosItens(produtos).reduce((m, j) => Math.max(m, j.numero), 0) + 1;

/** A assinatura de um jato (produto, local e quantidade de cada linha, em ordem) para saber se dois são iguais. @param {any[]} itens */
const assinatura = (itens) =>
  JSON.stringify(
    itens.map((i) => {
      const c = corpoDaLinhaProduto(i.form);
      return [c.produto_id, c.local_estoque_id, c.quantidade];
    })
  );

/** O jato é igual ao anterior (mesmos produtos, locais e quantidades)? @param {{ itens: any[] }} a @param {{ itens: any[] }} b */
export const jatosIguais = (a, b) => Boolean(a && b) && assinatura(a.itens) === assinatura(b.itens);

/**
 * "Repetir o jato anterior": cópias dos itens do último jato com o número novo e chaves novas (o resto do formulário,
 * igual). Sem jato ainda, nada.
 * @param {Array<{ chave: string, form: any }>} produtos @param {() => string} novaChave
 */
export const repetirUltimoJato = (produtos, novaChave) => {
  const jatos = jatosDosItens(produtos);
  const ultimo = jatos.at(-1);
  if (!ultimo) return [];
  const numero = ultimo.numero + 1;
  return ultimo.itens.map((i) => ({ ...i, chave: novaChave(), form: { ...i.form, jato: numero } }));
};

/**
 * O total de cada produto nos jatos do dia, na ordem em que aparece: `[{ rotulo, texto }]` ("HERBICIDA", "34 L").
 * @param {Array<{ form: any }>} produtos
 */
export const totaisDosJatos = (produtos) => {
  /** @type {Map<string, { rotulo: string, soma: number, unidade: any }>} */
  const porProduto = new Map();
  for (const j of jatosDosItens(produtos)) {
    for (const i of j.itens) {
      const c = corpoDaLinhaProduto(i.form);
      const q = Number(c.quantidade);
      if (!c.produto_id || !Number.isFinite(q)) continue;
      const atual = porProduto.get(c.produto_id) ?? { rotulo: String(i.form?.produto?.rotulo ?? ''), soma: 0, unidade: unidadeDoProduto(i.form?.produto) };
      atual.soma = Math.round((atual.soma + q) * 10000) / 10000;
      porProduto.set(c.produto_id, atual);
    }
  }
  return [...porProduto.values()].map((t) => ({ rotulo: t.rotulo, texto: formatarQuantidadeLinha(String(t.soma), t.unidade) }));
};

/** "HERBICIDA · 10 L" de cada item do jato. @param {any[]} itens */
export const linhasDoJato = (itens) =>
  itens.map((i) => {
    const c = corpoDaLinhaProduto(i.form);
    return { chave: i.chave, rotulo: String(i.form?.produto?.rotulo ?? ''), texto: formatarQuantidadeLinha(c.quantidade, unidadeDoProduto(i.form?.produto)) };
  });

/**
 * D-PROD-291 — o dia já salvo: "3 jatos de 2.000 L · herbicida folha larga 34 L · adubo foliar 24 kg" a partir das linhas
 * de insumo gravadas (só as CONFIRMADAS com `jato`); o tanque vem do implemento das máquinas do dia (pode faltar). Sem
 * jato, null.
 * @param {any[]} linhasProduto @param {any[]} [linhasMaquina]
 * @returns {string|null}
 */
export const textoDosJatosSalvos = (linhasProduto, linhasMaquina = []) => {
  const ativas = (Array.isArray(linhasProduto) ? linhasProduto : []).filter((l) => l && l.status !== 'CANCELADO' && Number.isInteger(l.jato) && l.jato > 0);
  if (!ativas.length) return null;
  const numeros = new Set(ativas.map((l) => l.jato));
  const tanque = (Array.isArray(linhasMaquina) ? linhasMaquina : []).map((m) => jatoDoImplemento(m?.implemento)).find(Boolean) ?? null;
  /** @type {Map<string, { rotulo: string, soma: number, unidade: any }>} */
  const porProduto = new Map();
  for (const l of ativas) {
    const q = Number(l.quantidade);
    if (!Number.isFinite(q)) continue;
    const id = String(l.produto_id ?? l.produto?.id ?? '');
    const atual = porProduto.get(id) ?? { rotulo: String(l.produto?.nome ?? ''), soma: 0, unidade: l.unidade };
    atual.soma = Math.round((atual.soma + q) * 10000) / 10000;
    porProduto.set(id, atual);
  }
  const n = numeros.size;
  const cabeca = `${n} ${n === 1 ? 'jato' : 'jatos'}${tanque ? ` de ${rotuloDoTanque(tanque)}` : ''}`;
  const totais = [...porProduto.values()].map((t) => `${t.rotulo.toLowerCase()} ${formatarQuantidadeLinha(String(t.soma), t.unidade)}`.trim());
  return [cabeca, ...totais].join(' · ');
};

/**
 * D-PROD-292 — o tanque e o jato sugerido para a linha avulsa: o tanque do implemento das máquinas (do dia ou, sem ele, do
 * último lançamento da atividade) e o MAIOR jato já lançado no dia (sem nenhum, 1).
 * @param {any} apontamento @param {any[]} [outros]  os lançamentos da atividade (o último com máquina dá o tanque)
 * @returns {{ tanque: { capacidade: string, unidade: string|null } | null, jatoSugerido: number }}
 */
export const tanqueEJatoDoDia = (apontamento, outros = []) => {
  const doDia = (Array.isArray(apontamento?.maquinas) ? apontamento.maquinas : []).filter((m) => m?.status !== 'CANCELADO').map((m) => jatoDoImplemento(m?.implemento)).find(Boolean) ?? null;
  let tanque = doDia;
  if (!tanque) {
    const ordenados = (Array.isArray(outros) ? outros : [])
      .filter((a) => a && a.status !== 'CANCELADO')
      .slice()
      .sort((a, b) => String(b.data_operacional ?? '').localeCompare(String(a.data_operacional ?? '')));
    for (const a of ordenados) {
      const t = (a.maquinas ?? []).filter((m) => m?.status !== 'CANCELADO').map((m) => jatoDoImplemento(m?.implemento)).find(Boolean);
      if (t) {
        tanque = t;
        break;
      }
    }
  }
  const jatos = (Array.isArray(apontamento?.produtos) ? apontamento.produtos : []).filter((l) => l?.status !== 'CANCELADO' && Number.isInteger(l?.jato)).map((l) => l.jato);
  return { tanque, jatoSugerido: jatos.length ? Math.max(...jatos) : 1 };
};
