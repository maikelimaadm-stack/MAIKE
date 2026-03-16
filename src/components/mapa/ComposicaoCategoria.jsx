import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Cards de composição por categoria - mostra cada categoria com cabeças, peso, lotes e ícone.
 */
export default function ComposicaoCategoria({ lotes = [] }) {
  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones-global"],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((i) => i.ativo !== false);
    },
  });

  // Agrupar lotes por categoria
  const porCategoria = lotes.reduce((acc, lote) => {
    const cat = lote.categoria?.toUpperCase() || "SEM CATEGORIA";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(lote);
    return acc;
  }, {});

  const categorias = Object.keys(porCategoria).sort();

  if (categorias.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-bold text-slate-900">Composição por Categoria</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
            <div key={categoria} className="bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-slate-900">{categoria}</div>
                  <div className="text-lg font-bold text-slate-900 leading-tight">{totalCab} cab</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Peso médio: {pesoMedio > 0 ? `${pesoMedio.toFixed(0)} kg` : "-"}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    Lotes: {lotesCategoria.map((l) => l.nome).join(", ")}
                  </div>
                </div>
                {iconeUrl && (
                  <img src={iconeUrl} alt={categoria} className="w-12 h-12 object-contain flex-shrink-0" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}