import React from "react";
import CampoLotes from "@/components/estoque/CampoLotes";

const CTL = "h-10 w-full min-w-0 rounded-md border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-[14px] outline-none focus:border-emerald-500";

const quantidade = (/** @type {unknown} */ v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : String(v ?? "");
};

/**
 * D-PROD-282 em todas as telas — o lote na CONFIRMAÇÃO do lançamento financeiro (o servidor só recebe o lote ali,
 * em `lotes_por_item`; o rascunho não guarda lote). Um bloco por efeito de estoque de produto que controla lote:
 *  - compra: "Lote do fabricante" (obrigatório) e "Validade" (obrigatória se o produto controla validade), como na
 *    entrada do Estoque;
 *  - venda: o `CampoLotes` (sugestão FEFO, escolher e dividir, vencido pede confirmação).
 * Produto sem lote: o bloco não aparece. Empilhado (cabe em 390 px).
 * @param {{
 *   empresaId: string|null|undefined, direcao: string, efeitos: any[], estado: Record<string|number, any>,
 *   onMudar: (itemOrdem: number, patch: Record<string, unknown>) => void, desabilitado?: boolean, pendencia?: string,
 * }} props
 */
export default function LotesDaConfirmacao({ empresaId, direcao, efeitos, estado, onMudar, desabilitado = false, pendencia = "" }) {
  const comLote = (efeitos ?? []).filter((e) => e?.controla_lote);
  if (!comLote.length) return null;
  const compra = direcao === "PAGAR";
  return (
    <section className="space-y-2 rounded-md border border-[var(--mg-divider,#cbd5e1)] p-3 text-[13px]" data-testid="confirmacao-lotes">
      <p className="font-semibold">{compra ? "Lote da compra" : "Lote da venda"}</p>
      {comLote.map((e) => {
        const n = e.item_ordem;
        const s = estado?.[n] ?? {};
        const titulo = (
          <p className="text-[12px] text-[var(--mg-text-2,#475569)]">
            Item {n} · {e.produto_nome || "Produto"} · {quantidade(e.kg)} em {e.local_nome || "depósito"}
          </p>
        );
        if (compra) {
          return (
            <div key={n} className="space-y-1" data-testid={`confirmacao-lote-${n}`}>
              {titulo}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="min-w-0 text-[12px]">
                  Lote do fabricante *
                  <input
                    type="text"
                    className={CTL}
                    value={s.lote ?? ""}
                    maxLength={64}
                    disabled={desabilitado}
                    onChange={(ev) => onMudar(n, { lote: ev.target.value })}
                    aria-label={`Lote do fabricante do item ${n}`}
                    data-testid={`confirmacao-lote-${n}-lote`}
                  />
                </label>
                <label className="min-w-0 text-[12px]">
                  Validade{e.controla_validade ? " *" : ""}
                  <input
                    type="date"
                    className={CTL}
                    value={s.validade ?? ""}
                    disabled={desabilitado}
                    onChange={(ev) => onMudar(n, { validade: ev.target.value })}
                    aria-label={`Validade do item ${n}`}
                    data-testid={`confirmacao-lote-${n}-validade`}
                  />
                </label>
              </div>
            </div>
          );
        }
        return (
          <div key={n} className="space-y-1" data-testid={`confirmacao-lote-${n}-item`}>
            {titulo}
            <CampoLotes
              empresaId={empresaId}
              produto={{ id: e.produto_id, controla_lote: true, controla_validade: e.controla_validade === true }}
              localId={e.local_estoque_id}
              quantidade={Number(e.kg)}
              lotes={s.lotes}
              confirmaVencido={s.confirmaVencido}
              loteVencido={s.loteVencido}
              erroLote={s.erroLote}
              onMudar={(patch) => onMudar(n, patch)}
              desabilitado={desabilitado}
              className=""
              testId={`confirmacao-lote-${n}`}
            />
          </div>
        );
      })}
      {pendencia ? (
        <p className="text-[12px] text-red-700" role="alert" data-testid="confirmacao-lotes-pendencia">{pendencia}</p>
      ) : null}
    </section>
  );
}
