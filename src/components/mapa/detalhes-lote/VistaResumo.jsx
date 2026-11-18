import React from "react";
import { Item, Kpis, ListaItens } from "@/components/mapa/detalhes-lote/blocos";
import { IconeCategoria } from "@/components/mapa/detalhes-lote/pecas";
import { ChipSituacao } from "@/components/mapa/detalhes-lote/BlocosLote";
import { ordenarLotes } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Vista Resumo da aba Lotes (v12): 4 números do pasto e a lista dos lotes por
 * nome e toque para abrir o lote. Os manejos continuam acessíveis para a área ou para o lote aberto.
 */
export function VistaResumo() {
  const { modelo, dados, empurrar } = usePasto();
  const m = /** @type {ModeloDetalhes} */ (modelo);
  const lotes = React.useMemo(() => ordenarLotes(m.lotes, { chave: "nome", dir: 1 }), [m.lotes]);
  const pasto = m.area?.nome || dados.areaNome;
  const titulo = `${pasto} (${m.resumo.cab})`;

  return (
    <>
      <Kpis
        colunas={4}
        itens={[
          { chave: "cab", rotulo: "Cabeças", valor: m.resumo.cab },
          { chave: "peso", rotulo: "Peso médio (kg)", valor: m.resumo.pesoMedio },
          { chave: "projetado", rotulo: "Peso médio projetado (kg)", valor: m.resumo.pesoMedioProjetado },
          { chave: "uaha", rotulo: "UA/ha", valor: m.resumo.uaHa },
        ]}
      />
      <ListaItens
        titulo={titulo}
        className="mk-dp-resumo-lotes"
        rotulo="Lotes do pasto"
      >
        {lotes.map((l) => (
          <Item
            key={l.id}
            imagem={<IconeCategoria figura={l.subicone} tamanho={30} />}
            cor={l.ident.identificadorCor}
            titulo={l.nome}
            title={`${l.nome}: ${l.textos.meta.replace(" cb ·", " cab ·")} · ${l.textos.pesoKg}`}
            meta={`${l.nome === l.categoria ? l.textos.meta.replace(" cb ·", " cab ·").replace(` · ${l.categoria}`, "") : l.textos.meta.replace(" cb ·", " cab ·")} · ${l.textos.pesoKg}`}
            chip={<ChipSituacao situacao={l.situacao} />}
            chevron
            onClick={() => empurrar({ tipo: "lote", loteId: l.id })}
          />
        ))}
      </ListaItens>
    </>
  );
}

export default VistaResumo;
