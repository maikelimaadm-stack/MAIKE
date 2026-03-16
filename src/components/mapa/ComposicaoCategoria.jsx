import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Cards de composição por categoria - texto compacto, estilo cocho/depósito.
 */
export default function ComposicaoCategoria({ lotes = [] }) {
  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones-global"],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((i) => i.ativo !== false);
    },
  });

  const porCategoria = lotes.reduce((acc, lote) => {
    const cat = lote.categoria?.toUpperCase() || "SEM CATEGORIA";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(lote);
    return acc;
  }, {});

  const categorias = Object.keys(porCategoria).sort();
  if (categorias.length === 0) return null;

  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
      <div className="text-[11px] font-bold text-slate-900">Composição por Categoria</div>
      <div className="space-y-1">
        {categorias.map((categoria) => {
          const lotesCategoria = porCategoria[categoria];
          const totalCab = lotesCategoria.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
          const pesosValidos = lotesCategoria.filter((l) => (l.peso_medio_kg || 0) > 0);
          const pesoMedio = pesosValidos.length > 0
            ? pesosValidos.reduce((s, l) => s + (l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0), 0) / pesosValidos.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0)
            : 0;

          const configIcone = iconesConfig.find(
            (ic) => ic.tipo_entidade === "Lote" && ic.categoria?.toUpperCase() === categoria
          );
          const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

          return (
            <div key={categoria} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-[10px]">
                    <div className="truncate font-medium text-slate-900">{categoria}</div>
                    <div className="whitespace-nowrap font-semibold text-slate-900">{totalCab} cab</div>
                    <div className="whitespace-nowrap font-semibold text-slate-900">{pesoMedio > 0 ? `${pesoMedio.toFixed(0)} kg` : "-"}</div>
                  </div>
                  <div className="text-[9px] text-slate-500 truncate mt-0.5">
                    Lotes: {lotesCategoria.map((l) => l.nome).join(", ")}
                  </div>
                </div>
                {iconeUrl && (
                  <img src={iconeUrl} alt={categoria} className="w-8 h-8 object-contain flex-shrink-0" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}