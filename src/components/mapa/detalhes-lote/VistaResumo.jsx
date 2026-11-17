import React from "react";
import { Item, Kpis, ListaItens } from "@/components/mapa/detalhes-lote/blocos";
import { IconeCategoria } from "@/components/mapa/detalhes-lote/pecas";
import { ChipSituacao } from "@/components/mapa/detalhes-lote/BlocosLote";
import { ordenarLotes } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Vista Resumo da aba Lotes (v12): 4 números do pasto e a lista dos lotes por
 * nome, cada um com a caixa de seleção (a seleção da casca: Mover lotes, Pesar e
 * Manejos levam só os marcados) e o toque que abre a tela do lote. O cabeçalho
 * marca/desmarca todos e diz quantos estão marcados.
 */
export function VistaResumo() {
  const { modelo, dados, empurrar, selecao, alternarSelecao, definirSelecao } = usePasto();
  const m = /** @type {ModeloDetalhes} */ (modelo);
  const lotes = React.useMemo(() => ordenarLotes(m.lotes, { chave: "nome", dir: 1 }), [m.lotes]);
  const ids = lotes.map((l) => l.id);
  const marcados = ids.filter((id) => selecao.has(id)).length;
  const marcacao = marcados === 0 ? "vazia" : marcados === ids.length ? "marcada" : "meio";
  const pasto = m.area?.nome || dados.areaNome;
  const titulo = `${pasto} (${m.resumo.cab})${marcados ? ` · ${marcados} ${marcados === 1 ? "selecionado" : "selecionados"}` : ""}`;

  return (
    <>
      <Kpis
        colunas={4}
        itens={[
          { chave: "peso", rotulo: "Peso médio (kg)", valor: m.resumo.pesoMedio },
          { chave: "cab", rotulo: "Cabeças", valor: m.resumo.cab },
          { chave: "uaha", rotulo: "UA/ha", valor: m.resumo.uaHa },
          { chave: "kgpvha", rotulo: "kg PV/ha", valor: m.resumo.kgPvHa },
        ]}
      />
      <ListaItens
        titulo={titulo}
        marcacao={marcacao}
        onMarcarTodos={() => definirSelecao(marcacao === "marcada" ? [] : ids)}
        rotuloTodos={marcacao === "marcada" ? "Desmarcar todos os lotes" : "Selecionar todos os lotes"}
        rotulo="Lotes do pasto"
      >
        {lotes.map((l) => (
          <Item
            key={l.id}
            marcado={selecao.has(l.id)}
            onMarcar={() => alternarSelecao(l.id)}
            imagem={<IconeCategoria figura={l.subicone} tamanho={34} />}
            cor={l.ident.identificadorCor}
            titulo={l.nome}
            meta={l.textos.meta}
            sub={l.textos.pesoKg}
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
