import React, { useMemo } from "react";
import { COR, CartaoDl, PilulaTitulo } from "@/components/mapa/detalhes-lote/pecas";
import { ordenarLotes } from "@/components/mapa/detalhes-lote/catalogo";
import LinhaLote from "./LinhaLote";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Aba Tudo no celular: "Lotes da área · N" com uma linha por lote (Atenção primeiro,
 * depois por nome). Toque leva a Lotes › Lote naquele lote. Mockup v8, linhas 128–135.
 *
 * @param {{ modelo: ModeloDetalhes, onAbrir: (id: string) => void }} props
 */
export default function ListaCompactaLotes({ modelo, onAbrir }) {
  const todos = modelo.lotes;
  const lotes = useMemo(() => ordenarLotes(todos, { porGravidade: true, chave: null, dir: 1 }), [todos]);
  if (!lotes.length) return null;

  return (
    <CartaoDl gap={0} padding="4px 10px">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0 4px" }}>
        <PilulaTitulo>{`Lotes da área · ${lotes.length}`}</PilulaTitulo>
        <span style={{ fontSize: 9, fontWeight: 600, color: COR.meta }}>toque para abrir</span>
      </div>
      {lotes.map((lote, i) => (
        <LinhaLote key={lote.id} lote={lote} primeira={i === 0 && !modelo.temVarios} onClick={() => onAbrir(lote.id)} />
      ))}
    </CartaoDl>
  );
}
