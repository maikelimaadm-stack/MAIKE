import React from "react";
import { Beef, Sprout } from "lucide-react";
import { Aviso, Cartao, Celula, Grade, Linha, SecaoDetalhe, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { IconeCategoria } from "@/components/mapa/detalhes-lote/pecas";
import { PartesDoCartao } from "@/components/mapa/detalhes-lote/BlocosLote";
import { camposDoCartaoDaArea, statusDaArea, VAZIO } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Aba Detalhes do pasto (v12, D-PROD-218): cartão da área (setor, hectares,
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
  const pastagemNoSubtitulo = area.campos.pastagem.texto !== VAZIO && area.sub.includes(area.campos.pastagem.texto);
  const campos = camposDoCartaoDaArea(area, { setor: dados.setorNome, status })
    .filter((campo) => !["setor", "hectares", "haPastejada"].includes(campo.chave || "") && (campo.chave !== "pastagem" || !pastagemNoSubtitulo));

  return (
    <div className="mk-dp-area-organizada">
      <Cartao icone={Sprout} titulo={area.nome || dados.areaNome} sub={area.sub || undefined} className="mk-dp-area-resumo">
        <Grade className="mk-dp-area-superficies">
          <Celula textoAutomatico rotulo="Área (ha)" valor={area.campos.hectares.texto} />
          <Celula textoAutomatico rotulo="Área pastejada (ha)" valor={area.campos.haPastejada.texto} />
        </Grade>
        <PartesDoCartao campos={campos} />
      </Cartao>
      <SecaoDetalhe titulo="Lotação" className="mk-dp-area-organizada__lotacao">
        <Cartao className="mk-dp-area-lotacao">
          <PartesDoCartao campos={area.lotacao.map((campo) => (["uaTotal", "capacidade"].includes(campo.chave || "") || (campo.chave === "uaHa" && (campo.dica === "Superlotação (> 2,4 UA/ha)" || campo.dica?.startsWith("Ideal (")))) ? { ...campo, dica: undefined } : campo)} />
        </Cartao>
      </SecaoDetalhe>
      {area.alertas.map((a) => (
        <Aviso key={a.frase} tom={a.tom === "atencao" ? "atencao" : "neutro"}>
          {a.frase}
        </Aviso>
      ))}
      {area.categorias.length ? (
        <SecaoDetalhe titulo="Categorias" className="mk-dp-area-organizada__categorias">
          <Cartao>
            {area.categorias.map((c) => (
              <Linha
                textoAutomatico
                key={c.nome}
                imagem={<IconeCategoria figura={c.subicone} tamanho={26} />}
                rotulo={c.nome}
                sub={c.descricao}
                valor={c.valor}
              />
            ))}
          </Cartao>
        </SecaoDetalhe>
      ) : (
        <Vazio icone={Beef}>Nenhum lote neste pasto agora.</Vazio>
      )}
    </div>
  );
}

export default AbaDetalhes;
