import React from "react";
import { NavLote } from "@/components/mapa/detalhes-lote/blocos";
import { BlocosLote } from "@/components/mapa/detalhes-lote/BlocosLote";
import { ordenarLotes } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";
import { useIndiceLote } from "@/components/mapa/detalhes-lote/useEstadoLotes";
import "@/styles/mk-dp-lotes.css";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Vista Lote da aba Lotes (v12): um lote por vez, na ordem dos nomes, com
 * ‹ "i de N" › e os blocos do lote. A posição fica lembrada por área na sessão.
 */
export function VistaLote() {
  const { modelo, dados } = usePasto();
  const lotes = React.useMemo(() => ordenarLotes(/** @type {ModeloDetalhes} */ (modelo).lotes, { chave: "nome", dir: 1 }), [modelo]);
  const [indice, irPara] = useIndiceLote(dados.areaId, lotes.length);
  const [direcao, setDirecao] = React.useState(/** @type {"aba-dir" | "aba-esq" | null} */ (null));
  const lote = lotes[indice];
  if (!lote) return null;

  /** @param {number} passo */
  const passar = (passo) => {
    setDirecao(passo > 0 ? "aba-dir" : "aba-esq");
    irPara(indice + passo);
  };

  return (
    <>
      <NavLote titulo={lote.nome} posicao={indice + 1} total={lotes.length} onAnterior={() => passar(-1)} onProximo={() => passar(1)} />
      <div key={lote.id} className={`mk-dp-lotes__blocos${direcao ? ` mk-dp-anim--${direcao}` : ""}`}>
        <BlocosLote lote={lote} />
      </div>
    </>
  );
}

export default VistaLote;
