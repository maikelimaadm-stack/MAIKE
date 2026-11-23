/**
 * D-PROD-273 (fatia 4) — o resumo da PRÉVIA da exclusão com recálculo, dentro das janelas de exclusão das saídas
 * (saída manual, cocho, linha de atividade, abastecimento, venda): antes de confirmar, diz se o estorno é exato ou
 * quantos movimentos posteriores terão o custo recalculado, com uma tabela curta antes → depois. Só leitura (o
 * servidor não grava nada na prévia); sem os ids dos movimentos, não aparece. No celular (390px) a tabela vira
 * linhas empilhadas, sem rolagem lateral.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { previasDaExclusao } from "@/services/estoqueConsultaService";
import { mensagemRecusaRecalculo, resumoDaPrevia } from "@/lib/estoqueRecalculoExclusao";

/** @param {{ empresaId: string|null, movimentoIds: Array<string|null|undefined>, className?: string }} props */
export default function PreviaRecalculoExclusao({ empresaId, movimentoIds, className = "" }) {
  const ids = [...new Set((movimentoIds ?? []).filter((v) => typeof v === "string" && v))].sort();
  const consulta = useQuery({
    queryKey: ["estoque", "previa-exclusao", empresaId, ids.join(",")],
    queryFn: () => previasDaExclusao(empresaId, ids),
    enabled: Boolean(empresaId && ids.length),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (!empresaId || !ids.length) return null;
  const base = `col-span-12 min-w-0 rounded-md border border-[var(--mg-border,#e2e8f0)] bg-[var(--mg-surface-2,#f8fafc)] px-3 py-2 text-[13px] ${className}`;
  if (consulta.isLoading) {
    return (
      <div role="status" className={`${base} flex items-center gap-2 text-[var(--mg-text-2,#475569)]`} data-testid="previa-recalculo-carregando">
        <Loader2 size={14} className="animate-spin" aria-hidden /> Calculando o efeito da exclusão nos movimentos seguintes…
      </div>
    );
  }
  if (consulta.isError) {
    const recusa = mensagemRecusaRecalculo(consulta.error);
    return (
      <div role="alert" className={`${base} text-red-800`} data-testid="previa-recalculo-erro">
        {recusa ?? "Não foi possível calcular o efeito da exclusão agora. Ao confirmar, o servidor confere tudo de novo."}
      </div>
    );
  }
  const r = resumoDaPrevia(/** @type {any[]} */ (consulta.data ?? []));
  return (
    <div className={base} data-testid="previa-recalculo" data-estado={r.estado}>
      <p className={r.estado === "recusa" ? "text-red-800 font-medium" : "font-medium"} data-testid="previa-recalculo-mensagem">{r.mensagem}</p>
      {r.estado === "recalcula" ? (
        <>
          <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">
            O custo médio é refeito na ordem em que os movimentos foram lançados; quantidades e preços de venda não mudam.
          </p>
          <ul className="mt-2 divide-y divide-[var(--mg-border,#e2e8f0)]" data-testid="previa-recalculo-linhas">
            {r.linhas.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1" data-testid="previa-recalculo-linha">
                <span className="min-w-0 break-words">Nº {l.numero} · {l.tipo}</span>
                <span className="whitespace-nowrap tabular-nums">{l.antes} → <strong>{l.depois}</strong></span>
              </li>
            ))}
          </ul>
          {r.mais ? <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">e mais {r.mais}.</p> : null}
        </>
      ) : null}
    </div>
  );
}
