import React from "react";
import { Beef } from "lucide-react";
import { Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { BlocosLote } from "@/components/mapa/detalhes-lote/BlocosLote";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";

/**
 * Tela empilhada do lote (v12): os mesmos blocos da vista Lote, sem a
 * navegação ‹ ›. Título, sub e o rodapé Mover · Pesar · Manejos são da casca.
 * @param {{ loteId: string }} props
 */
export function TelaLote({ loteId }) {
  const { modelo } = usePasto();
  const lote = (modelo?.lotes || []).find((/** @type {{ id: string }} */ l) => l.id === String(loteId));
  if (!lote) return <Vazio icone={Beef}>Este lote não está mais neste pasto.</Vazio>;
  return <BlocosLote lote={lote} mostrarNome={false} />;
}

export default TelaLote;
