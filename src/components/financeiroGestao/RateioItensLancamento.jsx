import React from "react";
import { comparar, formatarMoeda, somar } from "@/lib/dinheiroDecimal";

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
        <Celula rotulo="Custo/kg (líquido)" testId={`${prefixo}-custo-kg`}>
          {formatarMoeda(custo, { ...c, casasMax: 4 })}/kg
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

/** Explicação curta da diferença de arredondamento do custo. @param {{ testId: string }} props */
export function NotaResiduoCusto({ testId }) {
  return (
    <p className="min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)]" data-testid={testId}>
      Diferença de arredondamento do custo = líquido − kg × custo/kg. O custo por kg do estoque tem 4 casas: essa diferença fica fora do custo FIFO
      (não entra no lote) e o título continua com o valor total.
    </p>
  );
}

/**
 * Bloco da PRÉVIA: um cartão por item, os totais e a nota do resíduo.
 * @param {{ itens: any[], nomes: Map<number, string>, valorTotal: unknown, c: ContextoMoedaRateio, testId?: string }} props
 */
export default function RateioItensLancamento({ itens, nomes, valorTotal, c, testId = "previa-rateio" }) {
  const ordenados = [...itens].sort((a, b) => (a?.ordem ?? 0) - (b?.ordem ?? 0));
  const comResiduo = ordenados.some((i) => lido(i?.residuo_custo) !== null);
  return (
    <section className="min-w-0 space-y-2" data-testid={testId} aria-label="Rateio do desconto e do acréscimo por item">
      <p className="text-[12px] font-semibold text-[var(--mg-text-1,#0f172a)]">Desconto e acréscimo por item</p>
      {ordenados.map((item) => (
        <div key={item.ordem} className="min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white p-2" data-testid={`${testId}-item-${item.ordem}`}>
          <p className="mb-1 break-words text-[12px] font-semibold uppercase text-[var(--mg-text-1,#0f172a)]">
            Item {item.ordem}
            {nomes.get(item.ordem) ? ` · ${nomes.get(item.ordem)}` : ""}
          </p>
          <ValoresRateadosDoItem item={item} c={c} prefixo={`${testId}-item-${item.ordem}`} />
        </div>
      ))}
      {ordenados.every(temRateioDoItem) ? <TotaisRateioItens itens={ordenados} valorTotal={valorTotal} c={c} testId={`${testId}-totais`} /> : null}
      {comResiduo ? <NotaResiduoCusto testId={`${testId}-nota-residuo`} /> : null}
    </section>
  );
}
