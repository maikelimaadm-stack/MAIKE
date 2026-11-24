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
 * Barras de participação do lote no pasto (v13): "% das cabeças" e "% da UA",
 * lado a lado. Serve à linha do Resumo (`curto`) e ao topo do bloco Lotação.
 * @param {{ cab?: { texto?: string, barra?: number | null } | null, ua?: { texto?: string, barra?: number | null } | null, curto?: boolean, cor?: string | null }} props
 */
export function BarrasParticipacao({ cab, ua, curto = false, cor = null }) {
  const itens = [
    { chave: "partCab", rotulo: curto ? "% cabeças" : "% das cabeças do pasto", dica: "% das cabeças do pasto", c: cab },
    { chave: "partUA", rotulo: curto ? "% da UA" : "% da UA do pasto", dica: "% da UA do pasto", c: ua },
  ];
  return (
    <span className="mk-dp-part" data-participacao="">
      {itens.map(({ chave, rotulo, dica, c }) => {
        const n = Number(c?.barra);
        const pct = c?.barra == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(100, n));
        return (
          <span key={chave} className="mk-dp-part__item" data-chave={chave} title={dica}>
            <span className="mk-dp-part__topo">
              <span className="mk-dp-part__rot">{rotulo}</span>
              <span className="mk-dp-part__val">{c?.texto || VAZIO}</span>
            </span>
            <span className="mk-dp-part__trilha" aria-hidden="true">
              {pct != null ? <span style={{ width: `${pct.toFixed(1)}%`, background: cor || undefined }} /> : null}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Grade compacta de um bloco do lote (v13): rótulo em cima e valor embaixo, 3
 * colunas no celular. Campo que quebra (`quebra`) ocupa a linha inteira.
 * @param {{ campos: CampoTexto[] }} props
 */
export function GradeDoLote({ campos }) {
  if (!campos.length) return null;
  return (
    <dl className="mk-dp-l13">
      {campos.map((c) => (
        <div key={c.chave ?? c.rotulo} className={`mk-dp-l13__c${c.quebra ? " is-larga" : ""}`} data-chave={c.chave || undefined}>
          <dt className="mk-dp-l13__rot" title={c.dica || undefined}>{c.rotulo}</dt>
          <dd className="mk-dp-l13__val" style={c.cor ? { color: c.cor } : undefined}>
            {c.dot ? <span className="mk-dp-bolinha" style={{ background: c.dot }} aria-hidden="true" /> : null}
            {c.texto}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Blocos de um lote (vista Lote e tela do lote, v13): cartão com o subícone, a
 * identidade e a situação; um aviso por alerta (nível 2 em âmbar, nível 1 em
 * informação); e os blocos em grade — Lotação (as duas barras de participação
 * no topo), Pesagem (a Origem vira etiqueta no título), Projeção de peso e
 * Identificação. Nenhum campo do v12 saiu; D-PROD-229: sem repetir nome,
 * categoria e sexo.
 * @param {{ lote: LoteVm, mostrarNome?: boolean, categoriaNoCabecalho?: boolean }} props
 */
export function BlocosLote({ lote, mostrarNome = true, categoriaNoCabecalho = false }) {
  const sub = [categoriaNoCabecalho || (mostrarNome && lote.categoria === lote.nome) ? null : lote.categoria, lote.sexo].filter((t) => t && t !== VAZIO).join(" · ");
  // Só reorganiza a apresentação: o catálogo da Lista e suas preferências
  // continuam completos. Categoria e sexo já estão na identidade/cabeçalho.
  const lotacao = camposDoLote(lote, "Lotação");
  const pesagem = camposDoLote(lote, "Pesagem");
  const chavesProjecao = new Set(["projetado", "projArroba", "gmdMes", "baseProj", "objetivo", "atinge", "pesPrev", "projMeses"]);
  const porChave = (/** @type {CampoTexto[]} */ lista, /** @type {string} */ chave) => lista.find((c) => c.chave === chave) || null;
  const origem = porChave(pesagem, "origem");
  const temOrigem = Boolean(origem && origem.texto && origem.texto !== VAZIO);
  const secoes = [
    { titulo: "Lotação", campos: lotacao.filter((c) => !["peso", "ocupacao", "partCab", "partUA"].includes(c.chave || "")) },
    { titulo: "Pesagem", campos: [...lotacao.filter((c) => c.chave === "peso"), ...pesagem.filter((c) => !chavesProjecao.has(c.chave || "") && !(temOrigem && c.chave === "origem"))] },
    { titulo: "Projeção de peso", campos: pesagem.filter((c) => chavesProjecao.has(c.chave || "") && c.chave !== "projMeses") },
    { titulo: "Identificação", campos: camposDoLote(lote, "Identificação").filter((c) => (c.chave !== "categoria" || lote.categoria === VAZIO) && (c.chave !== "sexo" || lote.sexo === VAZIO)) },
  ];
  return (
    <div className="mk-dp-lote-organizado mk-dp-lote13">
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
        <SecaoDetalhe
          key={titulo}
          titulo={titulo}
          className="mk-dp-lote-organizado__secao"
        >
          {/* Etiqueta na linha do título (fora do h3: o nome da seção continua "Pesagem"). */}
          {titulo === "Pesagem" && temOrigem ? (
            <Chip tom={origem?.texto === "MEDIDO" ? "ok" : "atencao"} className="mk-dp-l13__origem" title={origem?.dica || undefined}>
              Origem: {origem?.texto}
            </Chip>
          ) : null}
          <Cartao>
            {titulo === "Lotação" ? (
              <div className="mk-dp-l13__barras">
                <BarrasParticipacao cab={porChave(lotacao, "partCab")} ua={porChave(lotacao, "partUA")} />
              </div>
            ) : null}
            <GradeDoLote campos={campos} />
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
