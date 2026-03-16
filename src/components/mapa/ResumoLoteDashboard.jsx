import React from "react";

/**
 * Card de resumo compacto dos lotes - mostra informações consolidadas.
 */
export default function ResumoLoteDashboard({ lotes = [], areaAtual }) {
  if (lotes.length === 0) return null;

  const totalCabecas = lotes.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
  const pesosValidos = lotes.filter((l) => (l.peso_medio_kg || 0) > 0);
  const pesoMedioGeral = pesosValidos.length > 0
    ? pesosValidos.reduce((s, l) => s + (l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0), 0) / pesosValidos.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0)
    : 0;

  const categoriasUnicas = [...new Set(lotes.map((l) => l.categoria || "Sem categoria"))];
  const sistemasUnicos = [...new Set(lotes.map((l) => l.sistema_produtivo).filter(Boolean))];

  const ultimaEntrada = lotes
    .map((l) => l.data_entrada)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];

  const campos = [
    { label: "Total de cabeças", valor: totalCabecas.toLocaleString("pt-BR") },
    { label: "Peso médio", valor: pesoMedioGeral > 0 ? `${pesoMedioGeral.toFixed(0)} kg` : "-" },
    { label: "Qtd. lotes", valor: lotes.length },
    { label: "Categorias", valor: categoriasUnicas.join(", ") },
    { label: "Sistema", valor: sistemasUnicos.join(", ") || "-" },
    { label: "Última mov.", valor: ultimaEntrada ? new Date(ultimaEntrada).toLocaleDateString("pt-BR") : "-" },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
      <div className="text-xs font-bold text-slate-900 mb-2">Resumo dos Lotes</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
        {campos.map((c) => (
          <div key={c.label} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">{c.label}</div>
            <div className="text-sm font-semibold text-slate-900 leading-tight">{c.valor}</div>
          </div>
        ))}
      </div>
    </div>
  );
}