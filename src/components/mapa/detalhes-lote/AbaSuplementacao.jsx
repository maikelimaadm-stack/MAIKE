import React from "react";
import { createPortal } from "react-dom";
import { Package } from "lucide-react";
import { urlIconeCocho } from "@/assets/icones/cocho-descoberto";
import { usePasto, useRodapeProprio } from "./pastoContexto";
import { Cartao, Celula, Grade, Item, Kpis, ListaItens, TituloBloco, Vazio } from "./blocos";
import { suplementacaoDoPasto } from "./suplementacaoDoPasto";
import AcoesCochoPasto from "./AcoesCochoPasto";

/*
 * Aba Suplementação do Detalhes do Lote v12 (D-PROD-218 — número definitivo
 * no PR; spec 06 §D.4). Tudo vem da casca (`usePasto()`):
 *  - cochos da área: os pontos decorados do Mapa Geral
 *    (`dados.suplementacao.pontos`, com `nivel_suplementacao` e
 *    `indicador_farol`), por nome;
 *  - KPIs, Fornecimento e Consumo esperado / real do PRIMEIRO cocho; com 2+
 *    cochos os títulos levam o nome dele (`suplementacaoDoPasto.js`);
 *  - item do cocho: o subícone do cocho com o nível do ciclo (o desenho dos
 *    detalhes, sem a bolinha do mapa, D-PROD-225), "65% ·
 *    restam 260 kg" ou o estado, o produto e a bolinha do farol da leitura; o
 *    toque abre o detalhe do cocho que já existe (`dados.onAbrirCocho`), só com
 *    `permissoes.detalhesCocho`;
 *  - rodapé próprio (Lançar · Leitura · Histórico, `AcoesCochoPasto`) por
 *    portal em `slotRodape`; sem cocho, ou sem nenhuma das permissões, fica o
 *    rodapé padrão do pasto.
 * Não faz consulta: os números são os do mapa (mesmo SSOT, mesmo dia).
 * Sem CSS próprio: só as peças e classes comuns (`blocos.jsx` +
 * `mk-detalhes-pasto.css`) já dão o desenho do v12.
 */

export default function AbaSuplementacao() {
  const { dados, permissoes, slotRodape } = usePasto();
  const supl = dados.suplementacao;
  const pontos = supl?.pontos;
  const eventos = supl?.eventos;
  const hoje = supl?.hoje;
  const visao = React.useMemo(
    () => suplementacaoDoPasto({ suplementacao: { pontos, eventos, hoje }, areaId: dados.areaId }),
    [pontos, eventos, hoje, dados.areaId],
  );
  const primeiro = visao.primeiro;
  const podeLancar = Boolean(permissoes.lancarSupl);
  const podeHistorico = Boolean(permissoes.historicoCocho);
  const rodapeProprio = Boolean(primeiro) && (podeLancar || podeHistorico);
  useRodapeProprio(rodapeProprio);

  const onAbrirCocho = permissoes.detalhesCocho && typeof dados.onAbrirCocho === "function" ? dados.onAbrirCocho : null;

  if (!primeiro) return <Vazio icone={Package}>Nenhum cocho neste pasto.</Vazio>;

  return (
    <>
      <Kpis itens={primeiro.kpis} colunas={2} />

      <TituloBloco>{visao.titulos.fornecimento}</TituloBloco>
      <Cartao>
        <Grade>
          {primeiro.fornecimento.map((c) => (
            <Celula key={c.chave} rotulo={c.rotulo} valor={c.valor} sub={c.sub} />
          ))}
        </Grade>
      </Cartao>

      <TituloBloco>{visao.titulos.consumo}</TituloBloco>
      <Cartao>
        <Grade>
          {primeiro.consumo.map((c) => (
            <Celula key={c.chave} rotulo={c.rotulo} valor={c.valor} bolinha={c.bolinha} />
          ))}
        </Grade>
      </Cartao>

      <TituloBloco>Cochos do pasto</TituloBloco>
      <ListaItens rotulo="Cochos do pasto">
        {visao.cochos.map((c) => (
          <Item
            key={c.id || c.nome}
            imagem={urlIconeCocho(c.fracaoIcone)}
            titulo={c.nome}
            meta={c.meta}
            sub={
              <>
                {c.produto}
                {c.farol?.texto ? <span className="sr-only">{` · ${c.farol.texto}`}</span> : null}
              </>
            }
            bolinha={c.farol?.hex ?? null}
            chevron={Boolean(onAbrirCocho)}
            title={c.farol?.texto || undefined}
            onClick={onAbrirCocho ? () => onAbrirCocho(c.ponto) : undefined}
          />
        ))}
      </ListaItens>

      {rodapeProprio && slotRodape
        ? createPortal(
            <AcoesCochoPasto
              ponto={primeiro.cocho.ponto}
              nivel={primeiro.cocho.nivel}
              hoje={typeof hoje === "string" ? hoje : null}
              podeLancar={podeLancar}
              podeHistorico={podeHistorico}
            />,
            slotRodape,
          )
        : null}
    </>
  );
}
