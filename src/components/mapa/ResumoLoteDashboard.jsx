import React from "react";

/**
 * Card de resumo compacto dos lotes - estilo CardSection igual ao cocho/depósito.
 */
export default function ResumoLoteDashboard({ lotes = [], areaAtual }) {
  if (lotes.length === 0) return null;

  const totalCabecas = lotes.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
  const pesosValidos = lotes.filter((l) => (l.peso_medio_kg || 0) > 0);
  const pesoMedioGeral = pesosValidos.length > 0
    ? pesosValidos.reduce((s, l) => s + (l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0), 0) / pesosValidos.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0)
    : 0;

  const sistemasUnicos = [...new Set(lotes.map((l) => l.sistema_produtivo).filter(Boolean))];

  const ultimaEntrada = lotes
    .map((l) => l.data_entrada)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];

  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
      <div className="text-[11px] font-bold text-slate-900">Resumo dos Lotes</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
        <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
          <div className="text-slate-500">Total de cabeças</div>
          <div className="font-semibold text-slate-900">{totalCabecas.toLocaleString("pt-BR")}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
          <div className="text-slate-500">Peso médio</div>
          <div className="font-semibold text-slate-900">{pesoMedioGeral > 0 ? `${pesoMedioGeral.toFixed(0)} kg` : "-"}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
          <div className="text-slate-500">Qtd. lotes</div>
          <div className="font-semibold text-slate-900">{lotes.length}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
          <div className="text-slate-500">Sistema</div>
          <div className="font-semibold text-slate-900">{sistemasUnicos.join(", ") || "-"}</div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
          <div className="text-slate-500">Última mov.</div>
          <div className="font-semibold text-slate-900">{ultimaEntrada ? new Date(ultimaEntrada).toLocaleDateString("pt-BR") : "-"}</div>
        </div>
      </div>
    </div>
  );
}