import React from "react";
import { useQuery } from "@tanstack/react-query";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { useCelular } from "@/components/common/MobileSheet";
import { listarLotesDisponiveis } from "@/services/estoqueConsultaService";
import { formatarCustoUnitario, formatarQtd } from "@/lib/estoqueConsultaRegras";
import { avisoDoLote } from "@/lib/estoqueLotesRegras";

const dataBr = (/** @type {string|null} */ d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

/**
 * D-PROD-281 — detalhe do saldo POR LOTE (produto que controla lote) num depósito: lote, validade, saldo, custo do lote
 * e o aviso de vencido / vencendo em até 30 dias. Lista empilhada (cabe em 390 px), já na ordem FEFO.
 * @param {{ empresaId: string, alvo: null | { produto_id: string, produto_nome: string, local_estoque_id: string, local_estoque_nome: string }, onFechar: () => void }} props
 */
export default function JanelaLotesSaldo({ empresaId, alvo, onFechar }) {
  const celular = useCelular();
  const { data, isLoading } = useQuery({
    queryKey: ["estoque", "lotes-disponiveis", empresaId, alvo?.produto_id, alvo?.local_estoque_id],
    queryFn: () => listarLotesDisponiveis(empresaId, alvo?.produto_id, alvo?.local_estoque_id),
    enabled: Boolean(alvo),
  });
  const lotes = data?.lotes ?? [];
  return (
    <B1Janela
      aberto={Boolean(alvo)}
      onFechar={onFechar}
      titulo={alvo ? `Lotes — ${alvo.produto_nome}` : "Lotes"}
      testId="janela-lotes-saldo"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ className: celular ? "b1-janela__camada--tela-cheia" : "" }}
    >
      <div className="min-w-0 text-[13px]" data-testid="lotes-saldo">
        <p className="mb-2 text-[12px] text-[var(--mg-text-2,#475569)]">{alvo?.local_estoque_nome} · o que vence primeiro aparece primeiro</p>
        {isLoading ? <p>Carregando…</p> : null}
        {!isLoading && !lotes.length ? <p>Nenhum lote com saldo.</p> : null}
        <ul className="space-y-2">
          {lotes.map((l) => (
            <li key={l.id} className="rounded border border-[var(--mg-border,#e2e8f0)] p-2" data-testid={`lote-saldo-${l.id}`}>
              <div className="flex flex-wrap justify-between gap-x-2 font-semibold">
                <span>Lote {l.lote_fabricante ?? "—"}</span>
                <span className="tabular-nums">{formatarQtd(l.quantidade_disponivel, data?.unidade)}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-x-2 text-[12px] text-[var(--mg-text-2,#475569)]">
                <span>Validade {dataBr(l.data_validade)}</span>
                <span>Custo {formatarCustoUnitario(l.custo_unitario)}</span>
              </div>
              {avisoDoLote(l) ? (
                <p className={`mt-1 text-[12px] font-semibold ${l.vencido ? "text-red-700" : "text-amber-700"}`} data-testid={`lote-saldo-aviso-${l.id}`}>{avisoDoLote(l)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </B1Janela>
  );
}
