import React, { useMemo } from "react";
import CampoDl from "./CampoDl";

function fmt(value, digits = 2) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function InformacoesArea({ area, lotesNaArea = [] }) {
  const totalCabecas = lotesNaArea.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
  const hectares = area?.area_pastejada || area?.tamanho_hectares || 0;
  const isCurral = area?.tipo_cultura === 'Infraestrutura' && String(area?.tipo_infraestrutura || area?.tipo_pastagem || '').trim().toLowerCase() === 'curral';
  const tipoInfraestrutura = area?.tipo_infraestrutura || area?.tipo_pastagem || '-';

  const totalUA = useMemo(() => {
    const pesoTotal = lotesNaArea.reduce((s, l) => s + (l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0), 0);
    return pesoTotal / 450;
  }, [lotesNaArea]);

  const uaHa = hectares > 0 ? totalUA / hectares : 0;

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

  const pesoMedioGeral = useMemo(() => {
    const pesoTotal = lotesNaArea.reduce((s, l) => s + (l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0), 0);
    return totalCabecas > 0 ? pesoTotal / totalCabecas : 0;
  }, [lotesNaArea, totalCabecas]);

  if (!area) return null;

  return (
    <div className="mk-dl__cartao">
      <div className="mk-dl__cab">
        <span className="mk-dl__nome mk-dl__nome--area">Informações da Área: {area.nome}</span>
      </div>

      {isCurral ? (
        <div className="mk-dl__infos mk-dl__infos--2">
          <CampoDl rotulo="Tipo de infraestrutura">{tipoInfraestrutura}</CampoDl>
          <CampoDl rotulo="Tipo de área">{area.tipo_cultura || '-'}</CampoDl>
        </div>
      ) : (
        <div className="mk-dl__infos">
          <CampoDl rotulo="Hectares">{hectares > 0 ? `${fmt(hectares)} ha` : '-'}</CampoDl>
          <CampoDl rotulo="UA/ha">{fmt(uaHa)}</CampoDl>
          <CampoDl rotulo="UA total">{fmt(totalUA)}</CampoDl>
          <CampoDl rotulo="Pastagem">{area.tipo_pastagem || '-'}</CampoDl>
          <CampoDl rotulo="Qtd. Lotes">{lotesNaArea.length.toLocaleString('pt-BR')}</CampoDl>
          <CampoDl rotulo="Qtd. Cabeças">{totalCabecas.toLocaleString('pt-BR')}</CampoDl>
          <CampoDl rotulo="Média geral">{pesoMedioGeral > 0 ? `${fmt(pesoMedioGeral)} kg` : '-'}</CampoDl>
          <CampoDl rotulo="Dias pastejo">{diasPastejoMedio.toLocaleString('pt-BR')} dia(s)</CampoDl>
        </div>
      )}

    </div>
  );
}