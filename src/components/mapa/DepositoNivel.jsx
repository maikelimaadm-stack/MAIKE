import React from "react";
import { urlIconeDeposito } from "@/assets/icones/deposito-sal";

export default function DepositoNivel({ percent = 0, estoqueMinimo = 0, saldoAtual = 0 }) {
  const nivel = Math.round((Number.isFinite(percent) ? Math.max(0, Math.min(1, percent)) : 0) * 100);
  const configurado = estoqueMinimo > 0;
  const percentualMinimo = configurado && saldoAtual > 0 ? Math.round(saldoAtual / estoqueMinimo * 100) : nivel;
  return (
    <div className="flex flex-col items-center gap-1">
      <img src={urlIconeDeposito(percent)} alt={configurado ? `Depósito: ${percentualMinimo}% do estoque mínimo` : "Depósito: estoque mínimo não configurado"} className="h-auto w-[156px] max-w-full" />
      <span className="text-xs font-semibold text-slate-700">{configurado ? `${percentualMinimo}% do mínimo` : "Defina o estoque mínimo"}</span>
    </div>
  );
}
