import React, { useMemo } from "react";

function fmt(value, digits = 2) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * Célula da faixa compacta: rótulo pequeno em cima, valor em destaque abaixo.
 * @param {{ rotulo: string, valor: string }} props
 */
function Item({ rotulo, valor }) {
  return (
    <div className="mk-dl__num" title={`${rotulo}: ${valor}`}>
      <span className="mk-dl__num-rotulo">{rotulo}</span>
      <span className="mk-dl__num-valor">{valor}</span>
    </div>
  );
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
    <div className="mk-dl__cartao mk-dl__cartao--area">
      <div className="mk-dl__cab">
        <span className="mk-dl__nome mk-dl__nome--area">Informações da Área: {area.nome}</span>
      </div>

      <div className="mk-dl__numeros">
        {isCurral ? (
          <>
            <Item rotulo="Tipo de infraestrutura" valor={tipoInfraestrutura} />
            <Item rotulo="Tipo de área" valor={area.tipo_cultura || '-'} />
          </>
        ) : (
          <>
            <Item rotulo="Hectares" valor={hectares > 0 ? `${fmt(hectares)} ha` : '-'} />
            <Item rotulo="UA/ha" valor={fmt(uaHa)} />
            <Item rotulo="UA total" valor={fmt(totalUA)} />
            <Item rotulo="Pastagem" valor={area.tipo_pastagem || '-'} />
            <Item rotulo="Qtd. Lotes" valor={lotesNaArea.length.toLocaleString('pt-BR')} />
            <Item rotulo="Qtd. Cabeças" valor={totalCabecas.toLocaleString('pt-BR')} />
            <Item rotulo="Média geral" valor={pesoMedioGeral > 0 ? `${fmt(pesoMedioGeral)} kg` : '-'} />
            <Item rotulo="Dias pastejo" valor={`${diasPastejoMedio.toLocaleString('pt-BR')} dia(s)`} />
          </>
        )}
      </div>
    </div>
  );
}
