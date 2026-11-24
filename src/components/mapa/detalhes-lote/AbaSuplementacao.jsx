import React from "react";
import { createPortal } from "react-dom";
import { Package } from "lucide-react";
import { urlIconeCocho } from "@/assets/icones/cocho-descoberto";
import { usePasto, useRodapeProprio } from "./pastoContexto";
import { Cartao, Celula, Grade, Item, Kpis, ListaItens, TituloBloco, Vazio } from "./blocos";
import { numeroBR, percentualDoNivel, suplementacaoDoPasto } from "./suplementacaoDoPasto";
import "@/styles/mk-dp-supl-v13.css";
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
 * As peças e classes comuns (`blocos.jsx` + `mk-detalhes-pasto.css`) dão o desenho do v12;
 * o v13 acrescenta, com `mk-dp-supl-v13.css`: a régua do desvio, o gráfico esperado × real
 * (um ponto por período fechado), a barra consumido × sobra e a barra de nível de cada cocho.
 */

/**
 * Régua do desvio da meta: zona verde = dentro da faixa da formulação; o marcador fica
 * preso à borda quando o desvio passa da régua.
 * @param {{ regua: NonNullable<import("./suplementacaoDoPasto").NumerosDoCocho["regua"]> }} props
 */
export function ReguaDoDesvio({ regua }) {
  const faixa = regua.faixa.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return (
    <div className="mk-dp-supl-regua" role="img" aria-label={regua.texto} data-dentro={regua.dentro ? "sim" : "nao"} data-preso={regua.preso ? "sim" : "nao"}>
      <div className="mk-dp-supl-regua__trilho" aria-hidden="true">
        <span className="mk-dp-supl-regua__zona" style={{ left: `${regua.inicio}%`, width: `${regua.fim - regua.inicio}%` }} />
        <span className="mk-dp-supl-regua__marca" style={{ left: `${regua.posicao.toFixed(1)}%` }} />
      </div>
      <div className="mk-dp-supl-regua__escala" aria-hidden="true">
        <span style={{ left: `${regua.inicio}%` }}>{`-${faixa}%`}</span>
        <span style={{ left: "50%" }}>meta</span>
        <span style={{ left: `${regua.fim}%` }}>{`+${faixa}%`}</span>
      </div>
    </div>
  );
}

const GRAF = { w: 342, h: 96, esq: 8, dir: 8, topo: 10, base: 74 };

/**
 * Gráfico "Esperado × real" (g/cab/dia), um ponto por período fechado. Menos de 2 pontos:
 * só o texto. A lista escondida repete os números para o leitor de tela.
 * @param {{ serie: import("./suplementacaoDoPasto").NumerosDoCocho["serie"] }} props
 */
export function GraficoEsperadoReal({ serie }) {
  const pontos = Array.isArray(serie) ? serie : [];
  if (pontos.length < 2) return <p className="mk-dp-supl-graf__vazio">Ainda sem períodos fechados para comparar.</p>;
  const valores = pontos.flatMap((p) => (p.esperado !== null ? [p.real, p.esperado] : [p.real]));
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const folga = (max - min) * 0.15 || Math.max(1, max * 0.1);
  const y0 = min - folga;
  const y1 = max + folga;
  const x = (/** @type {number} */ i) => GRAF.esq + (i * (GRAF.w - GRAF.esq - GRAF.dir)) / (pontos.length - 1);
  const y = (/** @type {number} */ v) => GRAF.base - ((v - y0) / (y1 - y0)) * (GRAF.base - GRAF.topo);
  const linha = (/** @type {Array<{ i: number, v: number }>} */ ps) => ps.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const real = pontos.map((p, i) => ({ i, v: p.real }));
  const esperado = pontos.flatMap((p, i) => (p.esperado !== null ? [{ i, v: p.esperado }] : []));
  return (
    <figure className="mk-dp-supl-graf">
      <figcaption>
        <span className="mk-dp-supl-graf__titulo">Esperado × real (g/cab/dia)</span>
        <span className="mk-dp-supl-graf__legenda" aria-hidden="true">
          <span><i data-serie="esperado" />esperado</span>
          <span><i data-serie="real" />real</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${GRAF.w} ${GRAF.h}`} aria-hidden="true" focusable="false">
        <line x1="0" x2={GRAF.w} y1={GRAF.base} y2={GRAF.base} stroke="#edf1f5" />
        {esperado.length > 1 ? <polyline points={linha(esperado)} fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="5 4" /> : null}
        {esperado.length === 1 ? <circle cx={x(esperado[0].i)} cy={y(esperado[0].v)} r="2.5" fill="#64748b" /> : null}
        <polyline points={linha(real)} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinejoin="round" />
        {real.map((p) => (
          <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3.5" fill="#16a34a" />
        ))}
        {pontos.map((p, i) => (
          <text key={p.chave} x={x(i)} y={GRAF.h - 6} fontSize="10" fill="#64748b" textAnchor={i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle"}>
            {p.rotulo}
          </text>
        ))}
      </svg>
      <ol className="mk-dp-supl-graf__dados">
        {pontos.map((p) => (
          <li key={p.chave}>
            {`${p.rotulo}: real ${numeroBR(p.real, 0)} g${p.esperado !== null ? `, esperado ${numeroBR(p.esperado, 0)} g` : ""}`}
          </li>
        ))}
      </ol>
    </figure>
  );
}

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
      {primeiro.regua ? <ReguaDoDesvio regua={primeiro.regua} /> : null}
      <GraficoEsperadoReal serie={primeiro.serie} />

      <TituloBloco>{visao.titulos.fornecimento}</TituloBloco>
      <Cartao>
        {primeiro.barra ? (
          <div className="mk-dp-supl-forn" role="img" aria-label={primeiro.barra.texto}>
            <span className="mk-dp-supl-forn__consumido" style={{ width: `${primeiro.barra.consumido.toFixed(1)}%` }} />
            <span className="mk-dp-supl-forn__sobra" style={{ width: `${primeiro.barra.sobra.toFixed(1)}%` }} />
          </div>
        ) : null}
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
        {visao.cochos.map((c) => {
          const pct = percentualDoNivel(c.nivel);
          return (
          <Item
            key={c.id || c.nome}
            imagem={urlIconeCocho(c.fracaoIcone)}
            titulo={c.nome}
            meta={c.meta}
            sub={
              <>
                {c.produto}
                {c.farol?.texto ? <span className="sr-only">{` · ${c.farol.texto}`}</span> : null}
                {pct !== null ? (
                  <span className="mk-dp-supl-nivel" aria-hidden="true">
                    <span style={{ width: `${pct.toFixed(1)}%` }} />
                  </span>
                ) : null}
              </>
            }
            bolinha={c.farol?.hex ?? null}
            chevron={Boolean(onAbrirCocho)}
            title={c.farol?.texto || undefined}
            onClick={onAbrirCocho ? () => onAbrirCocho(c.ponto) : undefined}
          />
          );
        })}
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
