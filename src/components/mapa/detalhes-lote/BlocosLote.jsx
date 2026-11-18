import React from "react";
import { Aviso, Cartao, Celula, Chip, Grade, Linha, SecaoDetalhe } from "@/components/mapa/detalhes-lote/blocos";
import { IconeCategoria } from "@/components/mapa/detalhes-lote/pecas";
import { VAZIO, camposDoLote, fmtDataCurta, fmtNum } from "@/components/mapa/detalhes-lote/catalogo";

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
              textoAutomatico
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
                textoAutomatico
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
 * identidade e situação; nome e categoria não se repetem quando já estão no cabeçalho; um aviso por alerta (nível 2 em
 * âmbar, nível 1 em informação); Lotação, Pesagem, Projeção de peso e
 * Identificação abertas. D-PROD-229: sem repetir nome, categoria e sexo.
 * @param {{ lote: LoteVm, mostrarNome?: boolean, categoriaNoCabecalho?: boolean }} props
 */
export function BlocosLote({ lote, mostrarNome = true, categoriaNoCabecalho = false }) {
  const sub = [categoriaNoCabecalho || (mostrarNome && lote.categoria === lote.nome) ? null : lote.categoria, lote.sexo].filter((t) => t && t !== VAZIO).join(" · ");
  // Só reorganiza a apresentação: o catálogo da Lista e suas preferências
  // continuam completos. Categoria e sexo já estão na identidade/cabeçalho.
  const lotacao = camposDoLote(lote, "Lotação").map((c) => c.chave === "ua" ? { ...c, dica: undefined } : c);
  const pesagem = camposDoLote(lote, "Pesagem").map((c) => ["projetado", "projArroba"].includes(c.chave || "") ? { ...c, dica: undefined } : c);
  const chavesProjecao = new Set(["projetado", "projArroba", "gmdMes", "baseProj", "objetivo", "atinge", "pesPrev", "projMeses"]);
  const secoes = [
    { titulo: "Lotação", campos: lotacao.filter((c) => c.chave !== "peso" && c.chave !== "ocupacao").map((c) => ({ ...c, rotulo: c.chave === "partCab" ? "% das cabeças do pasto" : c.chave === "partUA" ? "% da UA do pasto" : c.rotulo })) },
    { titulo: "Pesagem", campos: [...lotacao.filter((c) => c.chave === "peso"), ...pesagem.filter((c) => !chavesProjecao.has(c.chave || ""))] },
    { titulo: "Projeção de peso", campos: pesagem.filter((c) => chavesProjecao.has(c.chave || "") && c.chave !== "projMeses") },
    { titulo: "Identificação", campos: camposDoLote(lote, "Identificação").filter((c) => (c.chave !== "categoria" || lote.categoria === VAZIO) && (c.chave !== "sexo" || lote.sexo === VAZIO)) },
  ];
  return (
    <div className="mk-dp-lote-organizado">
      <Cartao
        imagem={<IconeCategoria figura={lote.subicone} tamanho={36} />}
        titulo={mostrarNome ? lote.nome : undefined}
        sub={sub || undefined}
        chip={<ChipSituacao situacao={lote.situacao} />}
      />
      {lote.alertas.map((a) => (
        <Aviso key={a.tipo} tom={a.nivel >= 2 ? "atencao" : "neutro"}>
          {a.frase}
        </Aviso>
      ))}
      {secoes.map(({ titulo, campos }) => (
        <SecaoDetalhe key={titulo} titulo={titulo} className="mk-dp-lote-organizado__secao">
          <Cartao>
            <PartesDoCartao campos={campos} />
            {titulo === "Projeção de peso" ? (
              <div className="mk-dp-projecao-mensal">
                <h4>Projeção de fim de mês</h4>
                {lote.projecao?.projecao_mensal?.length ? (
                  <Grade>
                    {lote.projecao.projecao_mensal.slice(0, 3).map((mes) => (
                      <Celula textoAutomatico key={mes.dia} rotulo={fmtDataCurta(mes.dia)} valor={`${fmtNum(mes.peso_kg, 0)} kg`} />
                    ))}
                  </Grade>
                ) : <Linha rotulo="Peso projetado (kg)" valor={VAZIO} />}
              </div>
            ) : null}
          </Cartao>
        </SecaoDetalhe>
      ))}
    </div>
  );
}

export default BlocosLote;
