import React from "react";
import { Beef, Sprout } from "lucide-react";
import { Aviso, Cartao, Linha, TituloBloco, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { IconeCategoria } from "@/components/mapa/detalhes-lote/pecas";
import { PartesDoCartao } from "@/components/mapa/detalhes-lote/BlocosLote";
import { camposDoCartaoDaArea, statusDaArea } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Aba Detalhes do pasto (v12, D-PROD-217): cartão da área (setor, hectares,
 * pastagem, status e dias de pastejo), aviso de capacidade, Lotação e a
 * composição por categoria. Tudo vem da casca (`usePasto()`); a área usa todas
 * as posições ativas dela (`lotesDaArea` do modelo), como antes.
 */
export function AbaDetalhes() {
  const { modelo, dados } = usePasto();
  const area = /** @type {ModeloDetalhes} */ (modelo).area;
  const status = React.useMemo(
    () => statusDaArea({ areaId: dados.areaId, cab: area.cab, movimentacoes: dados.movimentacoes, hoje: modelo.ctx?.hoje }),
    [dados.areaId, dados.movimentacoes, area.cab, modelo.ctx?.hoje],
  );
  const campos = camposDoCartaoDaArea(area, { setor: dados.setorNome, status });

  return (
    <>
      <Cartao icone={Sprout} titulo={area.nome || dados.areaNome} sub={area.sub || undefined}>
        <PartesDoCartao campos={campos} />
      </Cartao>
      {area.alertas.map((a) => (
        <Aviso key={a.frase} tom={a.tom === "atencao" ? "atencao" : "neutro"}>
          {a.frase}
        </Aviso>
      ))}
      <TituloBloco>Lotação</TituloBloco>
      <Cartao>
        <PartesDoCartao campos={area.lotacao} />
      </Cartao>
      {area.categorias.length ? (
        <>
          <TituloBloco>Categorias</TituloBloco>
          <Cartao>
            {area.categorias.map((c) => (
              <Linha
                key={c.nome}
                imagem={<IconeCategoria figura={c.subicone} tamanho={30} />}
                rotulo={c.nome}
                sub={c.descricao}
                valor={c.valor}
              />
            ))}
          </Cartao>
        </>
      ) : (
        <Vazio icone={Beef}>Nenhum lote neste pasto agora.</Vazio>
      )}
    </>
  );
}

export default AbaDetalhes;
