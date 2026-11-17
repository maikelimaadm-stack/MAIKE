import React from "react";
import { Aviso, Cartao, Celula, Chip, Grade, Linha, TituloBloco } from "@/components/mapa/detalhes-lote/blocos";
import { IconeCategoria } from "@/components/mapa/detalhes-lote/pecas";
import { SECOES_DO_LOTE, VAZIO, camposDoLote } from "@/components/mapa/detalhes-lote/catalogo";
import { usePasto } from "@/components/mapa/detalhes-lote/pastoContexto";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').LoteVm} LoteVm */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').CampoTexto} CampoTexto */
/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').Situacao} Situacao */

/**
 * Chip da situação do lote: "Atenção" (âmbar) ou "Em dia" (verde), com bolinha.
 * @param {{ situacao: Situacao }} props
 */
export function ChipSituacao({ situacao }) {
  return <Chip tom={situacao?.tom === "atencao" ? "atencao" : "ok"}>{situacao?.rotulo || "Em dia"}</Chip>;
}

/**
 * Partes de um cartão a partir das células, com a regra do v12: células simples
 * seguidas viram uma grade; a que quebra (ex.: "Projeção (fim do mês)") vira uma
 * linha de ponta a ponta; uma célula simples sozinha também vira linha.
 * @param {{ campos: CampoTexto[] }} props
 */
export function PartesDoCartao({ campos }) {
  /** @type {Array<{ linha: CampoTexto } | { itens: CampoTexto[] }>} */
  const partes = [];
  /** @type {{ itens: CampoTexto[] } | null} */
  let grade = null;
  for (const c of campos) {
    if (c.quebra) {
      grade = null;
      partes.push({ linha: c });
      continue;
    }
    if (!grade) {
      grade = { itens: [] };
      partes.push(grade);
    }
    grade.itens.push(c);
  }
  return (
    <>
      {partes.map((p, i) => {
        const sozinha = "linha" in p ? p.linha : p.itens.length === 1 ? p.itens[0] : null;
        if (sozinha) {
          return (
            <Linha
              key={sozinha.chave ?? `l${i}`}
              rotulo={sozinha.rotulo}
              sub={sozinha.dica}
              valor={sozinha.texto}
              cor={sozinha.cor}
              bolinha={sozinha.dot}
              quebra={Boolean(sozinha.quebra)}
            />
          );
        }
        const itens = "itens" in p ? p.itens : [];
        return (
          <Grade key={itens[0]?.chave ?? `g${i}`}>
            {itens.map((c) => (
              <Celula
                key={c.chave ?? c.rotulo}
                rotulo={c.rotulo}
                valor={c.texto}
                cor={c.cor}
                bolinha={c.dot}
                sub={c.dica}
                barra={c.barra}
                corBarra={c.corBarra}
              />
            ))}
          </Grade>
        );
      })}
    </>
  );
}

/**
 * Blocos de um lote (vista Lote e tela do lote, v12): cartão com o subícone, o
 * nome, "CATEGORIA · SEXO · Pasto" e a situação; um aviso por alerta (nível 2 em
 * âmbar, nível 1 em informação); Lotação, Pesagem e Identificação abertas.
 * @param {{ lote: LoteVm }} props
 */
export function BlocosLote({ lote }) {
  const { modelo, dados } = usePasto();
  const areaNome = modelo?.area?.nome || dados.areaNome;
  const sub = [lote.categoria, lote.sexo, areaNome].filter((t) => t && t !== VAZIO).join(" · ");
  return (
    <>
      <Cartao
        imagem={<IconeCategoria figura={lote.subicone} tamanho={36} />}
        titulo={lote.nome}
        sub={sub || undefined}
        chip={<ChipSituacao situacao={lote.situacao} />}
      />
      {lote.alertas.map((a) => (
        <Aviso key={a.tipo} tom={a.nivel >= 2 ? "atencao" : "neutro"}>
          {a.frase}
        </Aviso>
      ))}
      {SECOES_DO_LOTE.map((secao) => (
        <React.Fragment key={secao}>
          <TituloBloco>{secao}</TituloBloco>
          <Cartao>
            <PartesDoCartao campos={camposDoLote(lote, secao)} />
          </Cartao>
        </React.Fragment>
      ))}
    </>
  );
}

export default BlocosLote;
