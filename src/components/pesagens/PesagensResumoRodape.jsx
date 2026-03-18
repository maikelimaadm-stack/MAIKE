import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function PesagensResumoRodape({ estatisticas, tipoManejo, motivoSaida, documentoSelecionado, resumoDoc, resumoEmbarque, pesagensDia, exportarExcel, n }) {
  const [mostrarMediaMarcas, setMostrarMediaMarcas] = useState(false);

  const resumoMarcasDia = useMemo(() => {
    const mapa = pesagensDia.reduce((acc, item) => {
      const chave = String(item.marca || '').trim() || 'Sem marca';
      if (!acc[chave]) {
        acc[chave] = { quantidade: 0, pesoTotal: 0 };
      }
      acc[chave].quantidade += 1;
      acc[chave].pesoTotal += Number(item.peso || 0);
      return acc;
    }, {});

    return Object.entries(mapa)
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .map(([marcaNome, dados]) => ({
        marcaNome,
        quantidade: dados.quantidade,
        pesoMedio: dados.quantidade > 0 ? dados.pesoTotal / dados.quantidade : 0,
      }));
  }, [pesagensDia]);

  return (
    <div className="flex items-center justify-between mt-2 bg-white rounded px-3 py-2 shadow-sm gap-3">
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-6 text-xs flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Total Animais</span>
            <span className="font-bold text-lg">{estatisticas.total}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Total Machos</span>
            <span className="font-bold text-lg">{estatisticas.machos}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Total Fêmeas</span>
            <span className="font-bold text-lg">{estatisticas.femeas}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Peso Médio</span>
            <span className="font-bold text-lg">{n(estatisticas.pesoMedio, 2)}</span>
          </div>
          {tipoManejo === 'Saída' && motivoSaida === 'Abate' &&
          <div className="flex items-center gap-1 ml-4">
              <span className="text-slate-500">{documentoSelecionado ? 'Doc Selecionado' : 'Embarque Selecionado'}</span>
              <span className="font-bold text-lg text-amber-500">{documentoSelecionado ? resumoDoc.total : resumoEmbarque.total}</span>
              <span className="text-slate-400">/</span>
              <span className="text-slate-500">M</span>
              <span className="font-bold text-lg text-amber-500">{documentoSelecionado ? resumoDoc.machos : resumoEmbarque.machos}</span>
              <span className="text-slate-400">/</span>
              <span className="text-slate-500">F</span>
              <span className="font-bold text-lg text-amber-500">{documentoSelecionado ? resumoDoc.femeas : resumoEmbarque.femeas}</span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-500">Média</span>
              <span className="font-bold text-lg text-amber-500">{n(documentoSelecionado ? resumoDoc.pesoMedio : resumoEmbarque.pesoMedio, 2)}</span>
            </div>
          }
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 flex-wrap">
            <button type="button" onClick={() => setMostrarMediaMarcas((prev) => !prev)} className="text-[13px] text-slate-500 hover:text-slate-700 font-medium">
              Marcas:
            </button>
            {resumoMarcasDia.map(({ marcaNome, quantidade }) =>
              <Badge key={marcaNome} variant="outline" className="text-[13px] px-1.5 py-0 border-slate-300 text-slate-700">
                {marcaNome}: {quantidade}
              </Badge>
            )}
          </div>
          {mostrarMediaMarcas && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[13px] text-slate-500">Média por marca:</span>
              {resumoMarcasDia.map(({ marcaNome, pesoMedio }) =>
                <Badge key={`${marcaNome}-media`} variant="outline" className="text-[13px] px-1.5 py-0 border-slate-300 text-slate-700">
                  {marcaNome}: {n(pesoMedio, 2)}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={exportarExcel} className="h-7 text-xs shrink-0">
        Exportar
      </Button>
    </div>);

}