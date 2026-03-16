import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function InformacoesArea({ area, lotesNaArea }) {
  if (!area) return null;

  const totalCabecas = lotesNaArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);

  // UA = soma(peso_medio * qtd_cabecas) / 450
  const totalUA = useMemo(() => {
    const pesoTotal = lotesNaArea.reduce((s, l) => s + ((l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0)), 0);
    return pesoTotal / 450;
  }, [lotesNaArea]);

  // UA/ha
  const hectares = area.area_pastejada || area.tamanho_hectares || 0;
  const uaHa = hectares > 0 ? totalUA / hectares : 0;

  // Dias de pastejo médio (média ponderada por cabeças)
  const diasPastejoMedio = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    let somaDias = 0;
    let somaCab = 0;
    for (const l of lotesNaArea) {
      const cab = l.quantidade_cabecas || 0;
      if (cab <= 0) continue;
      const entrada = l.data_entrada ? new Date(l.data_entrada) : null;
      if (!entrada) continue;
      entrada.setHours(0, 0, 0, 0);
      const dias = Math.max(0, Math.floor((hoje - entrada) / 86400000));
      somaDias += dias * cab;
      somaCab += cab;
    }
    return somaCab > 0 ? Math.round(somaDias / somaCab) : 0;
  }, [lotesNaArea]);

  // Peso médio geral ponderado
  const pesoMedioGeral = useMemo(() => {
    const pesoTotal = lotesNaArea.reduce((s, l) => s + ((l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0)), 0);
    return totalCabecas > 0 ? pesoTotal / totalCabecas : 0;
  }, [lotesNaArea, totalCabecas]);

  // Sistemas produtivos únicos
  const sistemasUnicos = [...new Set(lotesNaArea.map(l => l.sistema_produtivo).filter(Boolean))];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-900 text-xs">Informações da Área:</span>
        <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">
          {area.nome}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 text-[10px]">
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">UA total</div>
          <div className="font-semibold text-slate-900">{totalUA.toFixed(1)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">UA/ha</div>
          <div className="font-semibold text-slate-900">{uaHa.toFixed(2)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Dias pastejo (média)</div>
          <div className="font-semibold text-slate-900">{diasPastejoMedio} dia(s)</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Hectares</div>
          <div className="font-semibold text-slate-900">{hectares > 0 ? `${hectares.toLocaleString('pt-BR')} ha` : '-'}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Tipo de cultura</div>
          <div className="font-semibold text-slate-900">{area.tipo_cultura || '-'}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Tipo de pastagem</div>
          <div className="font-semibold text-slate-900">{area.tipo_pastagem || '-'}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Qtd lotes</div>
          <div className="font-semibold text-slate-900">{lotesNaArea.length}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
          <div className="text-slate-500">Peso médio geral</div>
          <div className="font-semibold text-slate-900">{pesoMedioGeral > 0 ? `${pesoMedioGeral.toFixed(1)} kg` : '-'}</div>
        </div>
      </div>

      {sistemasUnicos.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-slate-500">Sistemas:</span>
          {sistemasUnicos.map(s => (
            <Badge key={s} variant="outline" className="text-[9px] px-1.5 py-0 border-slate-300 text-slate-700">{s}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}