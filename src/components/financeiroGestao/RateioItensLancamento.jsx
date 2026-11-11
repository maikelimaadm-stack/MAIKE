import React from "react";
import { comparar, formatarMoeda, formatarNumero, somar } from "@/lib/dinheiroDecimal";
import { escopoDoRateio } from "@/lib/rateioPorItem";

/**
 * Custo de aquisição líquido (D-PROD-155, rodada 4): por item, Subtotal,
 * Desconto rateado, Acréscimo rateado e Líquido; na compra de mercadoria também
 * o Custo/kg e a diferença de arredondamento do custo (fora do custo FIFO).
 * Só LÊ os campos do contrato (strings canônicas) — a conta é do servidor.
 * Celular: grade de 2 colunas, células `min-w-0` com quebra (sem tabela larga).
 */

const RE_NUMERO = /^-?\d+(?:\.\d+)?$/;

/** Valor do contrato (texto canônico) ou null. @param {unknown} v @returns {string|null} */
const lido = (v) => (typeof v === "string" && RE_NUMERO.test(v.trim()) ? v.trim() : null);

/** Soma exata na escala, ou null se faltar valor ou houver casas além da escala. @param {unknown[]} valores @param {number} casas */
const somaOuNada = (valores, casas) => {
  const xs = valores.map(lido);
  if (xs.some((x) => x === null)) return null;
  try {
    return somar(/** @type {string[]} */ (xs), casas);
  } catch {
    return null;
  }
};

/** O item veio com o rateio do cabeçalho (servidor da rodada 4)? @param {any} item */
export const temRateioDoItem = (item) => lido(item?.valor_liquido) !== null;

/** @typedef {{ locale: string, moeda: string, casas: number }} ContextoMoedaRateio */

/** @param {{ rotulo: string, testId?: string, destaque?: boolean, children: React.ReactNode }} props */
function Celula({ rotulo, testId = undefined, destaque = false, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--mg-text-3,#64748b)]">{rotulo}</p>
      <p data-testid={testId} className={`break-words text-[13px] ${destaque ? "font-semibold text-[var(--mg-text-1,#0f172a)]" : "font-medium text-[var(--mg-text-1,#0f172a)]"}`}>
        {children}
      </p>
    </div>
  );
}

/**
 * Valores rateados de UM item (grade de 2 colunas no celular).
 * @param {{ item: any, c: ContextoMoedaRateio, prefixo: string }} props
 */
export function ValoresRateadosDoItem({ item, c, prefixo }) {
  const dinheiro = (/** @type {unknown} */ v) => formatarMoeda(lido(v) ?? "", c);
  const custo = lido(item?.custo_kg);
  // D-PROD-162: item em litros mostra o custo por L; KG, SACO e UN, como antes (por kg).
  const porUnidade = item?.unidade === "L" ? "L" : "kg";
  const residuo = lido(item?.residuo_custo);
  const comRateio = temRateioDoItem(item);
  return (
    <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3" data-testid={`${prefixo}-grade`}>
      <Celula rotulo="Subtotal" testId={`${prefixo}-subtotal`}>
        {dinheiro(item?.valor_total)}
      </Celula>
      {comRateio ? (
        <>
          <Celula rotulo="Desconto rateado" testId={`${prefixo}-desconto`}>
            {dinheiro(item.valor_desconto_rateado)}
          </Celula>
          <Celula rotulo="Acréscimo rateado" testId={`${prefixo}-acrescimo`}>
            {dinheiro(item.valor_acrescimo_rateado)}
          </Celula>
          <Celula rotulo="Líquido" testId={`${prefixo}-liquido`} destaque>
            {dinheiro(item.valor_liquido)}
          </Celula>
        </>
      ) : null}
      {custo !== null ? (
        <Celula rotulo={`Custo/${porUnidade} (líquido)`} testId={`${prefixo}-custo-kg`}>
          {formatarMoeda(custo, { ...c, casasMax: 4 })}/{porUnidade}
        </Celula>
      ) : null}
      {residuo !== null ? (
        <Celula rotulo="Diferença de arredondamento do custo" testId={`${prefixo}-residuo`}>
          {formatarMoeda(residuo, { ...c, casasMax: 8 })}
        </Celula>
      ) : null}
    </div>
  );
}

/**
 * Totais do rateio: Σ subtotal, Σ desconto, Σ acréscimo e Σ líquido, conferidos
 * com o total do documento.
 * @param {{ itens: any[], valorTotal: unknown, c: ContextoMoedaRateio, testId: string }} props
 */
export function TotaisRateioItens({ itens, valorTotal, c, testId }) {
  const soma = (/** @type {string} */ campo) => somaOuNada(itens.map((i) => i?.[campo]), c.casas);
  const liquido = soma("valor_liquido");
  const total = lido(valorTotal);
  const confere = liquido !== null && total !== null && comparar(liquido, total) === 0;
  const dinheiro = (/** @type {string|null} */ v) => (v === null ? "—" : formatarMoeda(v, c));
  return (
    <div className="min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-slate-50 p-2" data-testid={testId}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Totais dos itens</p>
      <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <Celula rotulo="Subtotal" testId={`${testId}-subtotal`}>
          {dinheiro(soma("valor_total"))}
        </Celula>
        <Celula rotulo="Desconto rateado" testId={`${testId}-desconto`}>
          {dinheiro(soma("valor_desconto_rateado"))}
        </Celula>
        <Celula rotulo="Acréscimo rateado" testId={`${testId}-acrescimo`}>
          {dinheiro(soma("valor_acrescimo_rateado"))}
        </Celula>
        <Celula rotulo="Líquido" testId={`${testId}-liquido`} destaque>
          {dinheiro(liquido)}
        </Celula>
      </div>
      <p className={`mt-1 break-words text-[12px] ${confere ? "text-emerald-800" : "font-semibold text-red-700"}`} role={confere ? undefined : "alert"}>
        {confere
          ? `Σ líquido confere com o total do documento (${formatarMoeda(/** @type {string} */ (total), c)}).`
          : `Σ líquido NÃO confere com o total do documento (${total === null ? "—" : formatarMoeda(total, c)}). Recarregue antes de confirmar.`}
      </p>
    </div>
  );
}

/**
 * Explicação curta da diferença de arredondamento do custo. D-PROD-162: com
 * item em litros no documento (`comLitros`), o texto não fala em kg; sem item
 * em L, o texto de sempre.
 * @param {{ testId: string, comLitros?: boolean }} props
 */
export function NotaResiduoCusto({ testId, comLitros = false }) {
  return (
    <p className="min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)]" data-testid={testId}>
      {comLitros ? (
        <>
          Diferença de arredondamento do custo = líquido − quantidade × custo unitário. O custo unitário do estoque tem 4 casas: essa diferença fica fora
          do custo FIFO (não entra no lote) e o título continua com o valor total.
        </>
      ) : (
        <>
          Diferença de arredondamento do custo = líquido − kg × custo/kg. O custo por kg do estoque tem 4 casas: essa diferença fica fora do custo FIFO
          (não entra no lote) e o título continua com o valor total.
        </>
      )}
    </p>
  );
}

// ─── D-PROD-156 — rateio gerencial POR ITEM (só leitura) ───────────────────

/**
 * @typedef {{ naturezas: Map<string, string>, centrosCusto: Map<string, string>, centrosResultado: Map<string, string> }} NomesDasClassificacoes
 */

/**
 * Nomes das naturezas e dos centros do documento (detalhe), para as linhas que
 * chegam só com ids (o plano da prévia pode não trazer o nome).
 * @param {any} registro
 * @returns {NomesDasClassificacoes}
 */
export const nomesDasClassificacoes = (registro) => {
  const nomes = { naturezas: new Map(), centrosCusto: new Map(), centrosResultado: new Map() };
  const ler = (/** @type {any} */ l) => {
    if (l?.natureza_id && l.natureza_nome) nomes.naturezas.set(String(l.natureza_id), String(l.natureza_nome));
    if (l?.centro_custo_id && l.centro_custo_nome) nomes.centrosCusto.set(String(l.centro_custo_id), String(l.centro_custo_nome));
    if (l?.centro_resultado_id && l.centro_resultado_nome) nomes.centrosResultado.set(String(l.centro_resultado_id), String(l.centro_resultado_nome));
  };
  (Array.isArray(registro?.rateios) ? registro.rateios : []).forEach(ler);
  (Array.isArray(registro?.itens) ? registro.itens : []).forEach((/** @type {any} */ i) => (Array.isArray(i?.rateios) ? i.rateios : []).forEach(ler));
  (Array.isArray(registro?.rateio_consolidado) ? registro.rateio_consolidado : []).forEach(ler);
  return nomes;
};

/** @param {any} l @param {NomesDasClassificacoes|undefined} nomes */
const rotulosDaLinha = (l, nomes) => ({
  natureza: l?.natureza_nome || (l?.natureza_id ? nomes?.naturezas.get(String(l.natureza_id)) : null) || l?.natureza_id || "—",
  centroCusto: l?.centro_custo_nome || (l?.centro_custo_id ? nomes?.centrosCusto.get(String(l.centro_custo_id)) ?? l.centro_custo_id : null) || "—",
  centroResultado: l?.centro_resultado_nome || (l?.centro_resultado_id ? nomes?.centrosResultado.get(String(l.centro_resultado_id)) ?? l.centro_resultado_id : null) || "—",
});

/** "12,5%" (até 2 casas) a partir do percentual do contrato (6 casas). @param {unknown} v @param {string} locale */
const percentualCurto = (v, locale) => {
  const p = lido(v);
  return p === null ? null : `${formatarNumero(p, { locale, casasMin: 0, casasMax: 2 })}%`;
};

/**
 * Uma linha de classificação (natureza, centros, valor e percentual): 2 colunas
 * no celular, 4 a partir de `sm` — sem tabela larga.
 * @param {{ l: any, nomes?: NomesDasClassificacoes, c: ContextoMoedaRateio, rotuloPct: string, testId: string }} props
 */
function LinhaClassificacao({ l, nomes, c, rotuloPct, testId }) {
  const r = rotulosDaLinha(l, nomes);
  const pct = percentualCurto(l?.percentual, c.locale);
  return (
    <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 rounded border border-[var(--mg-divider,#cbd5e1)] bg-slate-50 p-2 sm:grid-cols-4" data-testid={testId}>
      <Celula rotulo="Natureza" testId={`${testId}-natureza`} destaque>
        <span className="uppercase">{r.natureza}</span>
      </Celula>
      <Celula rotulo="Centro de custo">
        <span className="uppercase">{r.centroCusto}</span>
      </Celula>
      <Celula rotulo="Centro de resultado">
        <span className="uppercase">{r.centroResultado}</span>
      </Celula>
      <Celula rotulo={`Valor (${rotuloPct})`} testId={`${testId}-valor`}>
        {formatarMoeda(lido(l?.valor) ?? "", c)}
        {pct ? ` · ${pct}` : ""}
      </Celula>
    </div>
  );
}

/**
 * Classificação de UM item (rateio por item): as linhas na ordem, com o
 * percentual sobre o LÍQUIDO do item.
 * @param {{ linhas: any[], nomes?: NomesDasClassificacoes, c: ContextoMoedaRateio, testId: string }} props
 */
export function ClassificacaoDoItem({ linhas, nomes = undefined, c, testId }) {
  const ordenadas = [...(Array.isArray(linhas) ? linhas : [])].sort((a, b) => (a?.ordem ?? 0) - (b?.ordem ?? 0));
  return (
    <div className="min-w-0 space-y-1" data-testid={testId}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--mg-text-3,#64748b)]">Classificação do item (% do líquido)</p>
      {ordenadas.length ? (
        ordenadas.map((l, k) => <LinhaClassificacao key={l?.ordem ?? k} l={l} nomes={nomes} c={c} rotuloPct="% do item" testId={`${testId}-linha-${l?.ordem ?? k + 1}`} />)
      ) : (
        <p className="text-[12px] text-[var(--mg-text-2,#475569)]">Sem classificação.</p>
      )}
    </div>
  );
}

/**
 * Resumo CONSOLIDADO por natureza e centros (soma das linhas de todos os itens,
 * sem duplicar montantes), conferido com o total do documento.
 * @param {{ linhas: any[], valorTotal: unknown, nomes?: NomesDasClassificacoes, c: ContextoMoedaRateio, testId: string }} props
 */
export function ResumoConsolidado({ linhas, valorTotal, nomes = undefined, c, testId }) {
  const lista = Array.isArray(linhas) ? linhas : [];
  const soma = somaOuNada(lista.map((l) => l?.valor), c.casas);
  const total = lido(valorTotal);
  const confere = soma !== null && total !== null && comparar(soma, total) === 0;
  return (
    <div className="min-w-0 space-y-1 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white p-2" data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">Resumo consolidado por natureza e centros</p>
      {lista.map((l, k) => (
        <LinhaClassificacao key={k} l={l} nomes={nomes} c={c} rotuloPct="% do total" testId={`${testId}-linha-${k + 1}`} />
      ))}
      <p className={`break-words text-[12px] ${confere ? "text-emerald-800" : "font-semibold text-red-700"}`} role={confere ? undefined : "alert"} data-testid={`${testId}-conferencia`}>
        {confere
          ? `Σ consolidado confere com o total do documento (${formatarMoeda(/** @type {string} */ (total), c)}): cada valor aparece uma vez só.`
          : `Σ consolidado NÃO confere com o total do documento (${total === null ? "—" : formatarMoeda(total, c)}). Recarregue antes de confirmar.`}
      </p>
    </div>
  );
}

/**
 * Bloco da PRÉVIA: um cartão por item, os totais e a nota do resíduo. No rateio
 * POR ITEM (D-PROD-156) cada cartão mostra também a classificação do item e,
 * no fim, o resumo consolidado. No GERAL, o visual de sempre.
 * @param {{ itens: any[], nomes: Map<number, string>, valorTotal: unknown, c: ContextoMoedaRateio, testId?: string,
 *   escopo?: unknown, consolidado?: any[]|null, nomesRateio?: NomesDasClassificacoes }} props
 */
export default function RateioItensLancamento({ itens, nomes, valorTotal, c, testId = "previa-rateio", escopo = "GERAL", consolidado = null, nomesRateio = undefined }) {
  const ordenados = [...itens].sort((a, b) => (a?.ordem ?? 0) - (b?.ordem ?? 0));
  const comResiduo = ordenados.some((i) => lido(i?.residuo_custo) !== null);
  const porItem = escopoDoRateio(escopo) === "POR_ITEM";
  return (
    <section className="min-w-0 space-y-2" data-testid={testId} aria-label={porItem ? "Valor líquido e classificação por item" : "Rateio do desconto e do acréscimo por item"}>
      <p className="text-[12px] font-semibold text-[var(--mg-text-1,#0f172a)]">{porItem ? "Líquido e classificação por item" : "Desconto e acréscimo por item"}</p>
      {ordenados.map((item) => (
        <div key={item.ordem} className="min-w-0 space-y-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white p-2" data-testid={`${testId}-item-${item.ordem}`}>
          <p className="mb-1 break-words text-[12px] font-semibold uppercase text-[var(--mg-text-1,#0f172a)]">
            Item {item.ordem}
            {nomes.get(item.ordem) ? ` · ${nomes.get(item.ordem)}` : ""}
          </p>
          <ValoresRateadosDoItem item={item} c={c} prefixo={`${testId}-item-${item.ordem}`} />
          {porItem ? <ClassificacaoDoItem linhas={item.rateios} nomes={nomesRateio} c={c} testId={`${testId}-item-${item.ordem}-classificacao`} /> : null}
        </div>
      ))}
      {ordenados.every(temRateioDoItem) ? <TotaisRateioItens itens={ordenados} valorTotal={valorTotal} c={c} testId={`${testId}-totais`} /> : null}
      {comResiduo ? <NotaResiduoCusto testId={`${testId}-nota-residuo`} comLitros={ordenados.some((i) => i?.unidade === "L")} /> : null}
      {porItem && Array.isArray(consolidado) ? <ResumoConsolidado linhas={consolidado} valorTotal={valorTotal} nomes={nomesRateio} c={c} testId={`${testId}-consolidado`} /> : null}
    </section>
  );
}
